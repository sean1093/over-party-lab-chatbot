import CONFIG from './config';
import logService from './logService';
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

const spreadSheet = SpreadsheetApp.openById(CONFIG.GOOGLE_SHEET.API_KEY);
const formatText = text => text && text.trim().toLowerCase();

const sheetService = {
    query: (params: QueryCriteria): object => {
        logService.log('[sheetService.query] Query data');
        const { select, from, where } = params;
        const sheet = spreadSheet.getSheetByName(from);
        const lastRow = sheet.getLastRow();
        const rowCount = lastRow - 1;
        const result = {};
        
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
    },
    getColumnData: (sheet, rowCount, colName) => {
        const firstCol = CONFIG.COLUMN_KEY_MAPPING[colName];
        const rawData = sheet.getSheetValues(2, firstCol, rowCount, 1);
        let array = [];
        for(let i = 0; i < rawData.length; i++) {
            array = array.concat(rawData[i]);
        } 
        return array;
    },
    findElement: (targetArray, target) => {
        for(let i = 0; i < targetArray.length; i++) {
            if (target == formatText(targetArray[i])) {
                return i+1;
            }
        }
        return -1;
    },
    save: (params: SaveData) => {
        logService.log('[sheetService.save] Save user action');
        const SHEET_NAME_USER = 'USER_ACTION';
        const userActionSheet = spreadSheet.getSheetByName(SHEET_NAME_USER);

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
    }
};

export default sheetService;
