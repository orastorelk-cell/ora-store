import type { Plugin } from 'vite';

/**
 * Adds a virtual Confirmed filter to Admin > Orders without changing the durable
 * logistics order_status. Confirmed is derived from call_center_status so the
 * existing Processing/Packed/Shipped/Delivered workflow stays intact.
 */
export const adminOrdersConfirmedFilterPatch = (): Plugin => ({
  name: 'ora-admin-orders-confirmed-filter-patch',
  enforce: 'pre',
  transform(code, rawId) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (code.includes('ADMIN ORDERS CONFIRMED FILTER')) return null;

    let text = code;

    const stateOld = "  const [orderFilter, setOrderFilter] = useState<OrderStatus | 'All'>('All');";
    const stateNew = "  // ADMIN ORDERS CONFIRMED FILTER\n  const [orderFilter, setOrderFilter] = useState<OrderStatus | 'All' | 'Confirmed' | 'COD Received' | 'COD Pending' | 'Online Payment'>('All');";
    if (!text.includes(stateOld)) throw new Error('[O-RA confirmed filter] orderFilter state marker not found');
    text = text.replace(stateOld, stateNew);

    const filterOld = "    if (orderFilter !== 'All' && o.order_status !== orderFilter) return false;";
    const filterNew = String.raw`    if (orderFilter === 'Confirmed') {
      // Keep logistics status untouched; this tab is a call-center decision view.
      if (o.call_center_status !== 'Confirmed' || o.order_status === 'Cancelled') return false;
    } else if (orderFilter === 'COD Received') {
      if (o.payment_method !== 'COD' || o.cod_payment_received !== true) return false;
    } else if (orderFilter === 'COD Pending') {
      if (o.payment_method !== 'COD' || o.cod_payment_received === true || o.order_status === 'Cancelled') return false;
    } else if (orderFilter === 'Online Payment') {
      if (o.payment_method !== 'Bank Payment') return false;
    } else if (orderFilter === 'New Orders') {
      // A confirmed order must never keep appearing to staff as a new/unconfirmed order.
      if (o.order_status !== 'New Orders' || o.call_center_status === 'Confirmed') return false;
    } else if (orderFilter !== 'All' && o.order_status !== orderFilter) return false;`;
    if (!text.includes(filterOld)) throw new Error('[O-RA confirmed filter] filteredOrders marker not found');
    text = text.replace(filterOld, filterNew);

    const buttonsOld = "['All', 'New Orders', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Cancelled']";
    const buttonsNew = "['All', 'New Orders', 'Confirmed', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'COD Received', 'COD Pending', 'Online Payment']";
    if (!text.includes(buttonsOld)) throw new Error('[O-RA confirmed filter] status button marker not found');
    text = text.replace(buttonsOld, buttonsNew);

    return { code: text, map: null };
  },
});
