export const GOOGLE_APPS_SCRIPT_DIAGNOSTICS = String.raw`
var oraDoPostDiagBase_ = doPost;
doPost = function(e){
  var raw = '';
  try{ raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : ''; }catch(_e){}
  try{
    var body = raw ? JSON.parse(raw) : {};
    var action = String(body.action||body.type||body.payload_type||'').trim();
    var normalized = [];
    try{ if(action==='sync_orders'||action==='orders_sync'||action==='order_batch_sync'||action==='orders_batch_sync'||action==='order_sync'||action==='sync_order') normalized = oraNormalizeIncoming_(body); }catch(_n){}
    console.log('[ORA-DIAG] action=' + action + ' normalizedOrders=' + normalized.length + ' bodyChars=' + raw.length);
  }catch(parseErr){ console.error('[ORA-DIAG] parse error: ' + parseErr); }
  try{
    var out = oraDoPostDiagBase_(e);
    console.log('[ORA-DIAG] doPost completed');
    return out;
  }catch(err){
    console.error('[ORA-DIAG] uncaught: ' + (err && err.stack ? err.stack : err));
    throw err;
  }
};
`;
