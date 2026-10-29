/**
 * Safety gate for incomplete legacy Purchasing History.
 *
 * Existing purchase orders and stock history were stored only in browser
 * localStorage, whereas inventory was published to the shared catalog.
 * A different browser can have only today's receipts while older confirmed
 * orders remain. Recomputing stock as
 *
 *   local purchase history - all historical allocated orders
 *
 * is not safe: it reduces real stock to zero and can republish that zero.
 *
 * Until a complete verified central history and opening balances are
 * recovered, keep actual existing product/variant balances as authoritative.
 * The normal FIFO allocator still decrements shared stock for newly confirmed
 * orders; it must not "hard cap" inventory using a partial local journal.
 *
 * Importantly this does not create stock, correct an unknown opening balance,
 * remove receipts or rewrite any order, invoice or waybill.
 */
export const purchaseHistoryStockDurabilityPatch = () => ({
  name:'ora-purchase-history-safe-legacy-gate',
  enforce:'pre' as const,
  transform(_code:string,_rawId:string){return null;},
});
