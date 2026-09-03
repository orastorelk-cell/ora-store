import type { Plugin } from 'vite';

/**
 * Keeps the large AdminDashboard source untouched and patches only the overview
 * finance calculations/cards at build time.
 */
export const adminDashboardConfirmedFinancePatch = (): Plugin => ({
  name: 'ora-admin-dashboard-confirmed-finance-patch',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let next = code;

    const oldCalculations = `  // Calculations for Reports Dashboard
  const totalSalesRevenue = orders
    .filter((o) => o.payment_status === 'Paid' || o.order_status !== 'Cancelled')
    .reduce((sum, o) => sum + o.total_amount, 0);

  const totalProfit = orders
    .filter((o) => o.payment_status === 'Paid' || o.order_status !== 'Cancelled')
    .reduce((sum, o) => {
      const orderProfit = o.items.reduce(
        (iSum, item) => iSum + (item.unit_price - item.buying_price) * item.quantity,
        0
      );
      return sum + orderProfit;
    }, 0);`;

    const newCalculations = `  // Dashboard finance metrics: count only call-center Confirmed orders.
  // Delivery is kept separate so the admin can see gross confirmed sales,
  // the amount remaining after the delivery reserve, and item profit clearly.
  const confirmedRevenueOrders = orders.filter((o) =>
    o.call_center_status === 'Confirmed' && o.order_status !== 'Cancelled'
  );

  const totalSalesRevenue = confirmedRevenueOrders
    .reduce((sum, o) => sum + Math.max(0, Number(o.total_amount || 0)), 0);

  const confirmedDeliveryTotal = confirmedRevenueOrders
    .reduce((sum, o) => sum + Math.max(0, Number(o.internal_delivery_fee ?? o.delivery_fee ?? 0)), 0);

  const confirmedProductSales = Math.max(0, totalSalesRevenue - confirmedDeliveryTotal);

  const confirmedBuyingCost = confirmedRevenueOrders.reduce((sum, o) => {
    const orderBuyingCost = o.items.reduce(
      (itemSum, item) => itemSum + Math.max(0, Number(item.buying_price || 0)) * Math.max(0, Number(item.quantity || 0)),
      0
    );
    return sum + orderBuyingCost;
  }, 0);

  const totalProfit = confirmedProductSales - confirmedBuyingCost;`;

    if (!next.includes(oldCalculations)) {
      throw new Error('Confirmed finance patch: dashboard calculation anchor not found.');
    }
    next = next.replace(oldCalculations, newCalculations);

    next = next.replace(
      'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
      'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4'
    );
    next = next.replace('<span>Total Revenue Sales</span>', '<span>Confirmed Sales Total</span>');
    next = next.replace(
      '<p className="text-[10px] text-neutral-500">Gross revenue across all order channels</p>',
      '<p className="text-[10px] text-neutral-500">Confirmed orders only</p>'
    );
    next = next.replace('<span>Net Calculated Profit</span>', '<span>Confirmed Profit</span>');
    next = next.replace(
      '<p className="text-[10px] text-neutral-500">Selling Price minus Buying Price margin</p>',
      '<p className="text-[10px] text-neutral-500">Product sales minus confirmed buying cost</p>'
    );

    const totalOrdersCardAnchor = `            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-neutral-400 text-xs">
                <span>Total Orders Placed</span>`;

    const extraFinanceCards = `            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-neutral-400 text-xs">
                <span>Product Sales</span>
                <DollarSign className="w-4 h-4 text-sky-400" />
              </div>
              <p className="text-2xl font-bold text-sky-400">
                Rs. {confirmedProductSales.toLocaleString()}
              </p>
              <p className="text-[10px] text-neutral-500">Confirmed sales after delivery reserve</p>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-neutral-400 text-xs">
                <span>Delivery Total</span>
                <Truck className="w-4 h-4 text-violet-400" />
              </div>
              <p className="text-2xl font-bold text-violet-400">
                Rs. {confirmedDeliveryTotal.toLocaleString()}
              </p>
              <p className="text-[10px] text-neutral-500">Delivery reserve for confirmed orders</p>
            </div>

${totalOrdersCardAnchor}`;

    if (!next.includes(totalOrdersCardAnchor)) {
      throw new Error('Confirmed finance patch: Total Orders card anchor not found.');
    }
    next = next.replace(totalOrdersCardAnchor, extraFinanceCards);

    return { code: next, map: null };
  },
});
