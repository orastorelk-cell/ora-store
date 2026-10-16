// Invoice/demand quantities remain historical. Only inventory consumers use
// this view of the quantity actually deducted for the parcel.
export const STOCK_QUANTITY_PREFIX = 'order-stock-quantity-v1:';
export const stockConsumedItems = <T extends {items?: any[]; stock_quantity_correction?: {item_quantities: number[]}}>(order: T): NonNullable<T['items']> => {
  const items = order.items || [], quantities = order.stock_quantity_correction?.item_quantities;
  if (!quantities) return items as NonNullable<T['items']>;
  if (quantities.length !== items.length || quantities.some((qty, index) => !Number.isSafeInteger(qty) || qty < 0 || qty > Number(items[index].quantity)))
    throw new Error('The saved order stock quantities require review.');
  return items.flatMap((item, index) => quantities[index] ? [{...item, quantity: quantities[index]}] : []) as NonNullable<T['items']>;
};

export const stockItemQuantities = (order: {items: any[]; stock_quantity_correction?: {item_quantities: number[]}}): number[] => {
  stockConsumedItems(order); // Validate the saved override before displaying it.
  return order.stock_quantity_correction?.item_quantities || order.items.map(item => Number(item.quantity));
};

export const activeOrderPackingLock = (order: Record<string, any>, admin: readonly Record<string, any>[]) => {
  const lock = order.return_packing_lock;
  if (!lock || (typeof lock === 'object' && !Array.isArray(lock) && !Object.keys(lock).length)) return false;
  const operation = String(lock.operation_id || ''), journal = admin.find(row => row.key === 'return-packing-v1:' + operation)?.payload;
  return !(operation && journal?.phase === 'complete' && order.return_packing_operation === operation &&
    journal.batch_id === order.invoice_pack_batch_id && journal.order_ids?.includes(String(order.id)) &&
    journal.plans?.some((plan: Record<string, any>) => String(plan.id) === String(order.id) && String(plan.waybill) === String(order.waybill_number)));
};
