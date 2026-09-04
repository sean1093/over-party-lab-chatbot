import CONFIG, { ColumnKey } from './config';
import logService, { errorMessage } from './logService';
import properties, { isConfigurationError } from './properties';
import timeService from './timeService';

interface SaveData {
    search: string;
    user: string;
}

/** A matched row, limited to the requested columns. */
export type SheetRow = Partial<Record<ColumnKey, string>>;

/**
 * Opened lazily: the spreadsheet ID comes from a script property, and reading
 * it at module load would throw while the bundle is still initialising.
 */
let cachedSpreadSheet: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;
const getSpreadSheet = (): GoogleAppsScript.Spreadsheet.Spreadsheet => {
    if (!cachedSpreadSheet) {
        cachedSpreadSheet = SpreadsheetApp.openById(properties.spreadsheetId());
    }
    return cachedSpreadSheet;
};

/**
 * Data rows of a tab, read once per execution.
 *
 * Every read is a round trip to the Sheets backend, and a webhook delivery can
 * carry several events, each needing the same two tabs. One read per tab per
 * execution replaces one `getSheetValues` call per column per lookup, which is
 * what made the cost scale with the number of events instead of the number of
 * tabs.
 *
 * An Apps Script execution is a fresh runtime, so this cache lives exactly as
 * long as one request: no staleness window, no eviction to reason about.
 */
const rowCache: Record<string, string[][]> = {};

/** Cells arrive as strings, numbers, booleans or Dates; comparisons need text. */
const asText = (cell: unknown): string =>
    cell === '' || cell === null || cell === undefined ? '' : String(cell);

/**
 * Widest column the mapping refers to. Reading up to here instead of to
 * `getLastColumn()` keeps a stray value in some far-right column from
 * multiplying the payload by the width of the sheet.
 */
const MAX_MAPPED_COLUMN = Math.max(...Object.keys(CONFIG.COLUMN_KEY_MAPPING).map(
    (key) => CONFIG.COLUMN_KEY_MAPPING[key as ColumnKey]
));

const readRows = (sheetName: string): string[][] => {
    const cached = rowCache[sheetName];
    if (cached) {
        return cached;
    }

    const sheet = getSpreadSheet().getSheetByName(sheetName);
    if (!sheet) {
        logService.log(`[sheetService] Error: Sheet "${sheetName}" not found`);
        rowCache[sheetName] = [];
        return rowCache[sheetName];
    }

    // Row 1 is the header, so a tab with fewer than two rows has no data. An
    // explicit range also keeps the read anchored at column A regardless of
    // where the used range happens to begin.
    const lastRow = sheet.getLastRow();
    const width = Math.min(MAX_MAPPED_COLUMN, sheet.getMaxColumns());
    const rows =
        lastRow < 2
            ? []
            : sheet
                  .getRange(2, 1, lastRow - 1, width)
                  .getValues()
                  .map((row) => row.map(asText));
    logService.log(`[sheetService] Read ${rows.length} rows from ${sheetName}`);
    rowCache[sheetName] = rows;
    return rows;
};

/**
 * Normalises a cell or user input for comparison.
 *
 * Sheets returns a Number for numerically-formatted cells (a cocktail called
 * "007", a year, a volume), so the value has to be stringified before it is
 * trimmed — otherwise the lookup throws, the error is swallowed, and the bot
 * reports "not found" for a drink that exists.
 */
const formatText = (text: unknown): string => (text ? String(text).trim().toLowerCase() : '');

/** 0-based position of `colName` within a row. */
const columnIndex = (colName: ColumnKey): number => CONFIG.COLUMN_KEY_MAPPING[colName] - 1;

/**
 * How long to wait for the analytics write lock.
 *
 * Deliberately short. The Apps Script script runtime is 6 minutes, but that is
 * not the binding deadline: LINE records a `request_timeout` webhook error when
 * the bot server does not respond within **2 seconds**, and the lock is taken
 * once per event, so a batched delivery multiplies this. Waiting briefly
 * serialises the collision this protects against; waiting long would spend the
 * response budget on an index number, and the write proceeds either way.
 */
const LOCK_TIMEOUT_MS = 500;

const sheetService = {
    /**
     * First row where any of the `where` columns equals the given value,
     * limited to the `select` columns; `null` when nothing matches.
     */
    findRow: (from: string, where: SheetRow, select: ColumnKey[]): SheetRow | null => {
        try {
            const rows = readRows(from);
            const targets = (Object.keys(where) as ColumnKey[])
                .map((column) => ({ column, value: formatText(where[column]) }))
                // An empty search value would match the first blank cell in the
                // column and leak an unrelated row.
                .filter((target) => target.value !== '');

            for (const { column, value } of targets) {
                const index = columnIndex(column);
                const match = rows.find((row) => formatText(row[index]) === value);
                if (match) {
                    const row: SheetRow = {};
                    for (const selected of select) {
                        row[selected] = match[columnIndex(selected)] ?? '';
                    }
                    logService.log(row);
                    return row;
                }
            }

            logService.log(`[sheetService.findRow] ${from}: no match`);
            return null;
        } catch (error) {
            // A misconfigured deployment must fail loudly, not answer "not found".
            if (isConfigurationError(error)) throw error;
            logService.log('[sheetService.findRow] Error: ' + errorMessage(error));
            return null;
        }
    },

    /** Every value of one column, excluding the header row. */
    columnValues: (from: string, colName: ColumnKey): string[] => {
        try {
            const index = columnIndex(colName);
            return readRows(from).map((row) => row[index] ?? '');
        } catch (error) {
            if (isConfigurationError(error)) throw error;
            logService.log('[sheetService.columnValues] Error: ' + errorMessage(error));
            return [];
        }
    },

    /**
     * Appends one row to USER_ACTION.
     *
     * `appendRow` targets the bottom of the data region server-side, so unlike
     * the previous `getLastRow()`-then-`setValues` it can never overwrite an
     * existing row: the worst a concurrent execution can do is repeat an index.
     * The script lock closes that gap too, and the write still goes ahead if
     * the lock cannot be taken — losing an analytics row would be worse than
     * a duplicate index.
     *
     * The index stays a number, as it has always been: `appendRow` interprets a
     * leading `=` as a formula, and a formula would renumber itself whenever the
     * tab is sorted or a row is inserted.
     */
    save: (params: SaveData): void => {
        try {
            const { search, user } = params;
            logService.log([search, user]);
            const userActionSheet = getSpreadSheet().getSheetByName(CONFIG.SHEET_NAMES.USER_ACTION);

            if (!userActionSheet) {
                logService.log(
                    `[sheetService.save] Error: Sheet "${CONFIG.SHEET_NAMES.USER_ACTION}" not found`
                );
                return;
            }

            const lock = LockService.getScriptLock();
            const locked = lock.tryLock(LOCK_TIMEOUT_MS);
            if (!locked) {
                logService.log('[sheetService.save] Lock unavailable; index may repeat');
            }
            try {
                // The header occupies row 1 and appendRow lands on the row after
                // the last one, so this is the same 0-based index as before.
                const index = userActionSheet.getLastRow() - 1;
                userActionSheet.appendRow([index, search, user, timeService.getCurrentTime()]);
            } finally {
                if (locked) {
                    lock.releaseLock();
                }
            }
            logService.log('[sheetService.save] User action saved successfully');
        } catch (error) {
            if (isConfigurationError(error)) throw error;
            logService.log('[sheetService.save] Error: ' + errorMessage(error));
        }
    }
};

export default sheetService;
