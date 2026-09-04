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
 * carry several events, each needing the same two tabs. One
 * `getDataRange().getValues()` per tab per execution replaces one
 * `getSheetValues` call per column per lookup, which is what used to make the
 * cost scale with the number of events instead of the number of tabs.
 *
 * An Apps Script execution is a fresh runtime, so this cache lives exactly as
 * long as one request: no staleness window, no eviction to reason about.
 */
const rowCache: Record<string, string[][]> = {};

/** Cells arrive as strings, numbers, booleans or Dates; comparisons need text. */
const asText = (cell: unknown): string =>
    cell === '' || cell === null || cell === undefined ? '' : String(cell);

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

    // Drop the header row; a tab holding only a header yields no data rows.
    const rows = sheet
        .getDataRange()
        .getValues()
        .slice(1)
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
     * `appendRow` finds the next empty row server-side and writes atomically.
     * The previous read-modify-write (`getLastRow()` then `setValues` on the
     * computed range) let two concurrent webhook deliveries compute the same
     * target row, so the second write silently overwrote the first.
     *
     * The index column keeps its place in the sheet as a formula, since it is
     * derived from the row's position and cannot be known before the append.
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

            userActionSheet.appendRow(['=ROW()-1', search, user, timeService.getCurrentTime()]);
            logService.log('[sheetService.save] User action saved successfully');
        } catch (error) {
            if (isConfigurationError(error)) throw error;
            logService.log('[sheetService.save] Error: ' + errorMessage(error));
        }
    }
};

export default sheetService;
