export const GOOGLE_APPS_SCRIPT_HOTFIX_V163_CITY = String.raw`
// V16.3 city/district completion layer.
function oraDistrictForCity_(ss,cityName){
  var city=String(cityName||"").trim();if(!city)return "";
  var fast=oraFastCitySheet_(ss);if(!fast||fast.getLastRow()<2)return "";
  try{
    var found=fast.getRange(2,1,fast.getLastRow()-1,1).createTextFinder(city).matchEntireCell(true).findNext();
    return found?String(fast.getRange(found.getRow(),2).getDisplayValue()||"").trim():"";
  }catch(e){return "";}
}

var oraWriteOrderV163Base_ = oraWriteOrder_;
oraWriteOrder_ = function(ss,o){
  if(!o.district&&o.city)o.district=oraDistrictForCity_(ss,o.city);
  return oraWriteOrderV163Base_(ss,o);
};

var onEditV163Base_ = onEdit;
onEdit = function(e){
  try{onEditV163Base_(e);}catch(err){}
  try{
    var sh=e&&e.range?e.range.getSheet():null;
    if(!sh||ORA_ORDER_SHEETS.indexOf(sh.getName())<0||e.range.getRow()<2)return;
    var hm=oraHeaderMap_(sh);
    if(!hm["City"]||!hm["District"]||e.range.getColumn()!==hm["City"])return;
    var city=String(e.range.getDisplayValue()||"").trim();
    if(!city)return;
    var district=oraDistrictForCity_(sh.getParent(),city);
    if(district)sh.getRange(e.range.getRow(),hm["District"]).setValue(district);
  }catch(err){}
};
`;
