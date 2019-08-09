import CONFIG from './config';
import logService from './logService';
import timeService from './timeService';

var spreadSheet = SpreadsheetApp.openById(CONFIG.GOOGLE_SHEET.API_KEY);
//var sheet = spreadSheet.getSheetByName(SHEET_NAME);
const COLUMN_KEY_MAPPING = {
  index: 1,
  name: 2,
  nameen: 3,
  link: 4,
  recommandation: 4,
  detail: 5
};

const sheetService = {
  query: function(params) {
    var select = params.select;
    var from = params.from;
    var where = params.where;
    logService.log('[sheetService.query] Query data');
    //logService.log(params);
    //logService.log(select);
    //logService.log(from);
    //logService.log(where);
    var sheet = spreadSheet.getSheetByName(from);
    var lastRow = sheet.getLastRow();
    var rowCount = lastRow - 1;
    var result = {};
    
    if (where) { 
      var targetWhereArray = {};
      var find = -1;
      for (var i in where) {
        var elementArray = sheetService.getColumnData(sheet, rowCount, i);
        var value = where[i] && where[i].trim().toLowerCase();
        find = sheetService.findElement(elementArray, value);
        if (find !== -1) {
          break;
        }
      }
      logService.log(find);
      for (var i = 0; i < select.length; i++) {
        var elementArray = sheetService.getColumnData(sheet, rowCount, select[i]);
        result[select[i]] = elementArray[(find - 1)];
      }
      logService.log(result);
    } else {
      for (var i = 0; i < select.length; i++) {
        var elementArray = sheetService.getColumnData(sheet, rowCount, select[i]);
        result[select[i]] = elementArray;
      }
    }
    
    logService.log('[sheetService.query] Query data finish');
    return result;
  },
  query_backup: function(name) {
    logService.log('[sheetService.query] Query data');
    var name = name && name.trim().toLowerCase();
    var lastRow = sheet.getLastRow();
    var rowCount = lastRow - 1;
    
    var nameArray = sheetService.getColumnData(rowCount, 'name');
    var nameEnArray = sheetService.getColumnData(rowCount, 'nameen');
    var linkArray = sheetService.getColumnData(rowCount, 'link');
    var detailArray = sheetService.getColumnData(rowCount, 'detail');
    // Logger.log(nameArray);
    // Logger.log(nameEnArray);
    // Logger.log(linkArray);
    
    // find
    var idx = sheetService.findElement(nameArray, name);
    if (idx == -1) {
      idx = sheetService.findElement(nameEnArray, name);
    }
    var link = linkArray[(idx - 1)];
    var detail = detailArray[(idx - 1)];
    return { link: link, detail: detail };  
  },
  getColumnData: function (sheet, rowCount, colName) {
    var firstCol = COLUMN_KEY_MAPPING[colName];
    var rawData = sheet.getSheetValues(2, firstCol, rowCount, 1);
    var array = [];
    for(var i = 0; i < rawData.length; i++) {
      array = array.concat(rawData[i]);
    } 
    return array;
  },
  findElement: function (targetArray, target) {
    for(var i = 0; i < targetArray.length; i++) {
      if (targetArray[i] && target == targetArray[i].trim().toLowerCase()) {
        return i+1;
      }
    }
    return -1;
  },
  save: function(params) {
    logService.log('[sheetService.save] Save user action');
    var SHEET_NAME_USER = 'USER_ACTION';
    var userActionSheet = spreadSheet.getSheetByName(SHEET_NAME_USER);
    // insert config
    var lastRow = userActionSheet.getLastRow();
    var insertRow = lastRow + 1;  
    var range = userActionSheet.getRange(SHEET_NAME_USER+'!A'+insertRow+':D'+insertRow);
    
    // get insert value
    var index = insertRow - 2; // start from 0
    var search = params.search;
    var user = params.user;
    var time = timeService.getCurrentTime();
    
    // call setValue api
    range.setValues([[index, search, user, time]]);
  }
};

export default sheetService;
