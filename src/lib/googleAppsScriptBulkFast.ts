export const GOOGLE_APPS_SCRIPT_BULK_FAST = String.raw`
// ============================================================
// O-RA STORE - RELIABLE BULK LEAD SYNC
// FB/TikTok CSV imports can contain many independent orders.
// Keep one server -> Apps Script request, but write EVERY order through the
// final stable order writer. Correctness is more important than the old fast
// block append optimisation, which could leave only part of a bulk import
// physically visible in the Sheet.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Reliable Bulk Leads';

var oraSyncOrdersReliableBase_ = oraSyncOrders_;

// Single-order writes/resyncs keep the existing exact path unchanged.
// True multi-order imports are processed under one lock and every normalized
// order is passed through the final oraWriteOrder_ wrapper chain. That preserves
// stable rows, actions, City/District corrections, pricing, validations and
// visual grouping for each FB/TikTok lead independently.
oraSyncOrders_ = function(body) {
  var orders = oraNormalizeOrders_(body);
  if (orders.length <= 1) return oraSyncOrdersReliableBase_(body);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = oraTarget_();
    var rows = 0;
    var written = 0;

    for (var i = 0; i < orders.length; i++) {
      var count = oraWriteOrder_(ss, orders[i]);
      rows += Number(count || 0);
      written++;
    }

    SpreadsheetApp.flush();
    return {
      ok: true,
      status: 'orders_synced',
      synced: written,
      rows: rows,
      existing: 0,
      bulk_reliable: true,
      version: ORA_VERSION,
      spreadsheet_id: ss.getId(),
      spreadsheet_name: ss.getName()
    };
  } finally {
    lock.releaseLock();
  }
};
`;
