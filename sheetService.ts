import CONFIG from './config';
import logService from './logService';
import properties from './properties';
import timeService from './timeService';

interface SaveData {
  search: string;
  user: string;
};

interface QueryCriteria {
    select: Array<string>;
    from: string;
    where: Object;
};

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
 * Formats text to lowercase and trimmed for consistent comparison
 * @param text - The text to format
 * @returns Formatted text or empty string if input is null/undefined
 */
const formatText = (text: string): string => text ? text.trim().toLowerCase() : '';

const sheetService = {
    query: (params: QueryCriteria): object => {
        try {
            logService.log('[sheetService.query] Query data');
            const { select, from, where } = params;
            const sheet = getSpreadSheet().getSheetByName(from);

            if (!sheet) {
                logService.log(`[sheetService.query] Error: Sheet "${from}" not found`);
                return {};
            }

            const lastRow = sheet.getLastRow();
            const rowCount = lastRow - 1;
            const result: any = {};

            if (where && Object.keys(where).length > 0) {
                let find = -1;
                for (let i in where) {
                    const elementArray = sheetService.getColumnData(sheet, rowCount, i);
                    const value = formatText(where[i]);
                    find = sheetService.findElement(elementArray, value);
                    if (find !== -1) {
                        break;
                    }
                }
                logService.log(find);
                for (let i = 0; i < select.length; i++) {
                    const elementArray = sheetService.getColumnData(sheet, rowCount, select[i]);
                    result[select[i]] = elementArray[(find - 1)];
                }
                logService.log(result);
            } else {
                for (let i = 0; i < select.length; i++) {
                    const elementArray = sheetService.getColumnData(sheet, rowCount, select[i]);
                    result[select[i]] = elementArray;
                }
            }

            logService.log('[sheetService.query] Query data finish');
            return result;
        } catch (error) {
            logService.log('[sheetService.query] Error: ' + error.message);
            return {};
        }
    },
    /**
     * Gets column data from a sheet
     * @param sheet - The Google Sheet object
     * @param rowCount - Number of rows to retrieve
     * @param colName - Column name as defined in COLUMN_KEY_MAPPING
     * @returns Array of values from the specified column
     */
    getColumnData: (sheet: GoogleAppsScript.Spreadsheet.Sheet, rowCount: number, colName: string): Array<any> => {
        const firstCol = CONFIG.COLUMN_KEY_MAPPING[colName];
        const rawData = sheet.getSheetValues(2, firstCol, rowCount, 1);
        let array: Array<any> = [];
        for(let i = 0; i < rawData.length; i++) {
            array = array.concat(rawData[i]);
        }
        return array;
    },

    /**
     * Finds an element in an array (case-insensitive)
     * @param targetArray - Array to search in
     * @param target - Target string to find
     * @returns 1-based index if found, -1 otherwise
     */
    findElement: (targetArray: Array<any>, target: string): number => {
        for(let i = 0; i < targetArray.length; i++) {
            if (target === formatText(targetArray[i])) {
                return i + 1;
            }
        }
        return -1;
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
            const range = userActionSheet.getRange(SHEET_NAME_USER+'!A'+insertRow+':D'+insertRow);

            // get insert value
            const index = insertRow - 2; // start from 0
            const time = timeService.getCurrentTime();
            const { search, user } = params;
            logService.log([search, user]);

            // call setValue api
            range.setValues([[index, search, user, time]]);
            logService.log('[sheetService.save] User action saved successfully');
        } catch (error) {
            logService.log('[sheetService.save] Error: ' + error.message);
        }
    }
};

export default sheetService;
