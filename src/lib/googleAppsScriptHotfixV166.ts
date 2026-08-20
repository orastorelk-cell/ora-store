export const GOOGLE_APPS_SCRIPT_HOTFIX_V166 = String.raw`
ORA_VERSION = "O-RA Store Google Sheet Sync V16.6";
function oraApplyValidationsV166_(sh,start,count){if(!count)return;var hm=oraHeaderMap_(sh);try{if(hm["Item Action"])sh.getRange(start,hm["Item Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["KEEP ITEM","CANCEL ITEM"],true).setAllowInvalid(false).build());}catch(e){}try{if(hm["Order Action"])sh.getRange(start,hm["Order Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["PENDING","CONFIRM ORDER","NO ANSWER","CANCEL ENTIRE ORDER"],true).setAllowInvalid(false).build());}catch(e){}try{if(hm["Apply Item Change"])sh.getRange(start,hm["Apply Item Change"],count,1).insertCheckboxes();}catch(e){}}
var oraWriteOrderV166Base_=oraWriteOrder_;
oraWriteOrder_=function(ss,o){var sh=ss.getSheetByName(oraSheetName_(o.source))||oraEnsureOrderSheet_(ss,oraSheetName_(o.source));var n=oraWriteOrderV166Base_(ss,o);if(n>0)oraApplyValidationsV166_(sh,sh.getLastRow()-n+1,n);return n;};
`;
