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
 * Normalises a cell or user input for comparison.
 *
 * Sheets returns a Number for numerically-formatted cells (a cocktail called
 * "007", a year, a volume), so the value has to be stringified before it is
 * trimmed — otherwise the lookup throws, the error is swallowed, and the bot
 * reports "not found" for a drink that exists.
 */
const formatText = (text: unknown): string => (text ? String(text).trim().toLowerCase() : '');

/** Values of one column, excluding the header row. */
const columnData = (
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    rowCount: number,
    colName: ColumnKey
): string[] => {
    const firstCol = CONFIG.COLUMN_KEY_MAPPING[colName];
    return sheet
        .getSheetValues(2, firstCol, rowCount, 1)
        .map((row) => (row[0] === '' || row[0] === null || row[0] === undefined ? '' : String(row[0])));
};

/** 0-based index of the first value equal to `target`, or -1. */
const indexOfValue = (values: string[], target: string): number => {
    for (let i = 0; i < values.length; i++) {
        if (target === formatText(values[i])) {
            return i;
        }
    }
    return -1;
};

const sheetService = {
    /**
     * First row where any of the `where` columns equals the given value,
     * limited to the `select` columns; `null` when nothing matches.
     */
    findRow: (from: string, where: SheetRow, select: ColumnKey[]): SheetRow | null => {
        try {
            logService.log(`[sheetService.findRow] ${from}`);
            const sheet = getSpreadSheet().getSheetByName(from);

            if (!sheet) {
                logService.log(`[sheetService.findRow] Error: Sheet "${from}" not found`);
                return null;
            }

            const rowCount = sheet.getLastRow() - 1;
            if (rowCount < 1) {
                return null;
            }

            let found = -1;
            for (const column of Object.keys(where) as ColumnKey[]) {
                const value = formatText(where[column]);
                // An empty search value would match the first blank cell in the
                // column and leak an unrelated row.
                if (!value) {
                    continue;
                }
                found = indexOfValue(columnData(sheet, rowCount, column), value);
                if (found !== -1) {
                    break;
                }
            }
            if (found === -1) {
                logService.log(`[sheetService.findRow] ${from}: no match`);
                return null;
            }

            const row: SheetRow = {};
            for (const column of select) {
                row[column] = columnData(sheet, rowCount, column)[found];
            }
            logService.log(row);
            return row;
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
            const sheet = getSpreadSheet().getSheetByName(from);

            if (!sheet) {
                logService.log(`[sheetService.columnValues] Error: Sheet "${from}" not found`);
                return [];
            }

            const rowCount = sheet.getLastRow() - 1;
            return rowCount < 1 ? [] : columnData(sheet, rowCount, colName);
        } catch (error) {
            if (isConfigurationError(error)) throw error;
            logService.log('[sheetService.columnValues] Error: ' + errorMessage(error));
            return [];
        }
    },

    save: (params: SaveData): void => {
        try {
            logService.log('[sheetService.save] Save user action');
            const SHEET_NAME_USER = CONFIG.SHEET_NAMES.USER_ACTION;
            const userActionSheet = getSpreadSheet().getSheetByName(SHEET_NAME_USER);

            if (!userActionSheet) {
                logService.log(`[sheetService.save] Error: Sheet "${SHEET_NAME_USER}" not found`);
                return;
            }

            // insert config
            const lastRow = userActionSheet.getLastRow();
            const insertRow = lastRow + 1;
            const range = userActionSheet.getRange(SHEET_NAME_USER + '!A' + insertRow + ':D' + insertRow);

            // get insert value
            const index = insertRow - 2; // start from 0
            const time = timeService.getCurrentTime();
            const { search, user } = params;
            logService.log([search, user]);

            // call setValue api
            range.setValues([[index, search, user, time]]);
            logService.log('[sheetService.save] User action saved successfully');
        } catch (error) {
            if (isConfigurationError(error)) throw error;
            logService.log('[sheetService.save] Error: ' + errorMessage(error));
        }
    }
};

export default sheetService;
