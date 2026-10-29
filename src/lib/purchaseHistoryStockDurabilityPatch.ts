/**
 * Previous behavior rebuilt EVERY product's sellable stock as
 * localStorage Purchasing History - every historic allocated order.
 * Purchasing History was browser-local and incomplete after changing browsers:
 * a browser holding only today's four receipts erased years of starting stock
 * and propagated zero stock to the shared server catalog. The FIFO "hard cap"
 * duplicated the exact same unsafe calculation.
 *
 * We must not use incomplete/non-authoritative history to rewrite live stock.
 * Actual stock remains the shared server catalog updated by purchase/returns
 * and order reservation. Historical purchases are now synced to a durable R2
 * receipt ledger for audit, NEVER replayed as a second stock credit.
 *
 * A later historical stock adjustment requires verified opening balances and
 * an explicit audit/reconciliation operation; guessing from partial receipts
 * is dangerous and may create duplicate invoices.
 */
export const purchaseHistoryStockDurabilityPatch = () => ({
  name:'ora-purchase-history-stock-authority-safe',
  enforce:'pre' as const,
  transform(_code:string,_rawId:string){return null;},
});
