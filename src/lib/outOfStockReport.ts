import type { Product, ProductVariant } from '../types';

/** The same physical item rows shown on the Out of Stock page. */
export interface OutOfStockNeedRow {
  product: Product;
  variant?: ProductVariant;
  itemCode: string;
  itemLabel: string;
  currentStock: number;
  pendingOrders: number;
  neededQty: number;
  /** Staff-visible Order IDs, e.g. FB-001234, rather than database UUIDs. */
  orderIds: string[];
}

export interface OutOfStockReportItem {
  itemCode: string;
  itemLabel: string;
  imageSources: string[];
  shopName: string;
  seenPrice: number | null;
  currentStock: number;
  pendingOrders: number;
  neededQty: number;
  orderIds: string[];
}

const nonnegative = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

/** Copy display data before asynchronous image loading; never mutate catalog/orders. */
export function snapshotOutOfStockNeeds(rows: readonly OutOfStockNeedRow[]): OutOfStockReportItem[] {
  return rows.map(row => {
    const price = row.product.source_shop_price;
    return {
      itemCode: String(row.itemCode || row.product.sku || '').trim(),
      itemLabel: String(row.itemLabel || row.product.name_en || '').trim(),
      imageSources: Array.from(new Set([row.variant?.image, ...(row.product.images || [])]
        .map(value => String(value || '').trim()).filter(Boolean))).slice(0, 3),
      shopName: String(row.product.source_shop_name || '').trim(),
      // This is the saved reference-shop price, never the current buying/selling price.
      seenPrice: price !== undefined && price !== null && Number.isFinite(Number(price)) && Number(price) > 0
        ? Number(price) : null,
      currentStock: nonnegative(row.currentStock),
      pendingOrders: nonnegative(row.pendingOrders),
      neededQty: nonnegative(row.neededQty),
      orderIds: Array.from(new Set(row.orderIds.map(id => String(id).trim()).filter(Boolean))),
    };
  });
}
