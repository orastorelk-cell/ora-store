export const GOOGLE_APPS_SCRIPT_HOTFIX_V167 = String.raw`
ORA_VERSION = "O-RA Store Google Sheet Sync V16.7";

var oraSyncCatalogV167Base_=oraSyncCatalog_;
oraSyncCatalog_=function(ss,body){
  var result=oraSyncCatalogV167Base_(ss,body),sh=ss.getSheetByName(ORA_CATALOG_TAB);
  if(!sh||sh.getLastRow()<2)return result;
  var rows=sh.getLastRow()-1,urls=sh.getRange(2,10,rows,1).getDisplayValues(),formulas=[];
  for(var i=0;i<rows;i++){
    var url=String(urls[i][0]||'').trim();
    formulas.push([url?'=IFERROR(IMAGE("'+url.replace(/"/g,'""')+'",4,70,70),"")':'']);
  }
  sh.getRange(2,1,rows,1).setFormulas(formulas);
  try{sh.setRowHeights(2,rows,76);sh.setColumnWidth(1,90);}catch(e){}
  return result;
};
`;
