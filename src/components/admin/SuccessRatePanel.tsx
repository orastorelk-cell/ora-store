import React, { useMemo, useState } from 'react';
import { BarChart3, Package, Search, Trophy } from 'lucide-react';
import type { Order, Product } from '../../types';

type SuccessRatePanelProps = {
  orders: Order[];
  products: Product[];
};

type SuccessRow = {
  code: string;
  name: string;
  image?: string;
  total: number;
  confirmed: number;
  cancelled: number;
  pending: number;
  successRate: number;
  cancelRate: number;
};

const keyOf = (value: unknown) => String(value || '').trim().toUpperCase();

export const SuccessRatePanel: React.FC<SuccessRatePanelProps> = ({ orders, products }) => {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'orders' | 'success' | 'cancel'>('orders');

  const rows = useMemo<SuccessRow[]>(() => {
    const productById = new Map(products.map((product) => [String(product.id), product] as const));
    const productBySku = new Map(products.map((product) => [keyOf(product.sku), product] as const));

    type Working = {
      code: string;
      name: string;
      image?: string;
      orderIds: Set<string>;
      confirmedIds: Set<string>;
      cancelledIds: Set<string>;
    };

    const grouped = new Map<string, Working>();

    orders
      .filter((order) => !order.is_test_order && !order.is_duplicate_order)
      .forEach((order) => {
        const perOrderCodes = new Set<string>();

        (order.items || []).forEach((item) => {
          const product = productById.get(String(item.product_id || ''));
          const code = keyOf(item.main_sku || product?.sku || item.sku);
          if (!code || perOrderCodes.has(code)) return;
          perOrderCodes.add(code);

          const catalogProduct = product || productBySku.get(code);
          const current = grouped.get(code) || {
            code,
            name: String(catalogProduct?.name_en || item.product_name || code),
            image: catalogProduct?.images?.[0] || item.image,
            orderIds: new Set<string>(),
            confirmedIds: new Set<string>(),
            cancelledIds: new Set<string>(),
          };

          const orderKey = String(order.id || order.order_number);
          current.orderIds.add(orderKey);

          if (order.call_center_status === 'Confirmed') current.confirmedIds.add(orderKey);
          if (order.call_center_status === 'Cancelled' || order.order_status === 'Cancelled') current.cancelledIds.add(orderKey);

          if (!current.image) current.image = item.image;
          if (!current.name || current.name === current.code) current.name = String(item.product_name || current.name || current.code);
          grouped.set(code, current);
        });
      });

    return Array.from(grouped.values())
      .map((row) => {
        const total = row.orderIds.size;
        const confirmed = row.confirmedIds.size;
        const cancelled = row.cancelledIds.size;
        const pending = Math.max(0, total - confirmed - cancelled);
        return {
          code: row.code,
          name: row.name,
          image: row.image,
          total,
          confirmed,
          cancelled,
          pending,
          successRate: total > 0 ? (confirmed / total) * 100 : 0,
          cancelRate: total > 0 ? (cancelled / total) * 100 : 0,
        };
      })
      .filter((row) => row.total > 0);
  }, [orders, products]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((row) => row.code.toLowerCase().includes(q) || row.name.toLowerCase().includes(q))
      : rows;

    return [...filtered].sort((a, b) => {
      if (sortBy === 'success') return b.successRate - a.successRate || b.total - a.total;
      if (sortBy === 'cancel') return b.cancelRate - a.cancelRate || b.total - a.total;
      return b.total - a.total || b.successRate - a.successRate;
    });
  }, [rows, search, sortBy]);

  const realOrders = useMemo(
    () => orders.filter((order) => !order.is_test_order && !order.is_duplicate_order),
    [orders]
  );
  const confirmedOrders = realOrders.filter((order) => order.call_center_status === 'Confirmed').length;
  const cancelledOrders = realOrders.filter((order) => order.call_center_status === 'Cancelled' || order.order_status === 'Cancelled').length;
  const overallRate = realOrders.length ? (confirmedOrders / realOrders.length) * 100 : 0;

  const statusFor = (row: SuccessRow) => {
    if (row.total < 3) return { label: 'LOW DATA', className: 'border-neutral-700 bg-neutral-800 text-neutral-300' };
    if (row.successRate >= 70) return { label: 'GOOD', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' };
    if (row.successRate >= 50) return { label: 'WATCH', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' };
    return { label: 'NEEDS ATTENTION', className: 'border-red-500/30 bg-red-500/10 text-red-300' };
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-orange-400" />
              <h2 className="text-lg font-black text-white">Item Success Rate</h2>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-400">
              Variant orders are grouped under their Main Code. Combo Packs stay under the Combo Code. Success Rate = Confirmed Orders ÷ All Real Orders for that item.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative min-w-[230px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search item code / name..."
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-orange-500"
              />
            </label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as 'orders' | 'success' | 'cancel')}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-bold text-white"
            >
              <option value="orders">Most Orders</option>
              <option value="success">Best Success Rate</option>
              <option value="cancel">Highest Cancel Rate</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Real Orders</div>
          <div className="mt-1 text-2xl font-black text-white">{realOrders.length}</div>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400/70">Confirmed</div>
          <div className="mt-1 text-2xl font-black text-emerald-300">{confirmedOrders}</div>
        </div>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="text-[10px] font-black uppercase tracking-wider text-red-400/70">Cancelled</div>
          <div className="mt-1 text-2xl font-black text-red-300">{cancelledOrders}</div>
        </div>
        <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4">
          <div className="text-[10px] font-black uppercase tracking-wider text-orange-400/70">Overall Success</div>
          <div className="mt-1 text-2xl font-black text-orange-300">{overallRate.toFixed(1)}%</div>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <Package className="mx-auto h-8 w-8 text-neutral-600" />
          <p className="mt-2 text-sm font-bold text-neutral-400">No item order data found.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3 sm:hidden">
            {filteredRows.map((row) => {
              const status = statusFor(row);
              return (
                <div key={row.code} className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
                  <div className="flex items-center gap-3 border-b border-neutral-800 p-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                      {row.image ? (
                        <img src={row.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center"><Package className="h-5 w-5 text-neutral-600" /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs font-black text-orange-300">{row.code}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs font-bold text-white">{row.name}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[8px] font-black ${status.className}`}>{status.label}</span>
                  </div>
                  <div className="grid grid-cols-4 divide-x divide-neutral-800">
                    <div className="p-2 text-center"><div className="text-[8px] uppercase text-neutral-500">Orders</div><div className="mt-1 font-black text-white">{row.total}</div></div>
                    <div className="p-2 text-center"><div className="text-[8px] uppercase text-neutral-500">Confirm</div><div className="mt-1 font-black text-emerald-300">{row.confirmed}</div></div>
                    <div className="p-2 text-center"><div className="text-[8px] uppercase text-neutral-500">Cancel</div><div className="mt-1 font-black text-red-300">{row.cancelled}</div></div>
                    <div className="p-2 text-center"><div className="text-[8px] uppercase text-neutral-500">Success</div><div className="mt-1 font-black text-orange-300">{row.successRate.toFixed(1)}%</div></div>
                  </div>
                  <div className="px-3 pb-3 pt-2">
                    <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, row.successRate)}%` }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[9px] font-bold text-neutral-500">
                      <span>Pending / No Answer: {row.pending}</span>
                      <span>Cancel Rate: {row.cancelRate.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 sm:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="bg-neutral-950 text-[10px] uppercase text-neutral-500">
                  <tr>
                    <th className="p-3">Item</th>
                    <th className="p-3">Main / Combo Code</th>
                    <th className="p-3 text-center">Orders</th>
                    <th className="p-3 text-center">Confirmed</th>
                    <th className="p-3 text-center">Cancelled</th>
                    <th className="p-3 text-center">Pending</th>
                    <th className="p-3 text-center">Success Rate</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {filteredRows.map((row) => {
                    const status = statusFor(row);
                    return (
                      <tr key={row.code} className="hover:bg-neutral-800/40">
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                              {row.image ? (
                                <img src={row.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center"><Package className="h-4 w-4 text-neutral-600" /></div>
                              )}
                            </div>
                            <span className="max-w-[320px] font-bold text-white">{row.name}</span>
                          </div>
                        </td>
                        <td className="p-3 font-mono font-black text-orange-300">{row.code}</td>
                        <td className="p-3 text-center font-black text-white">{row.total}</td>
                        <td className="p-3 text-center font-black text-emerald-300">{row.confirmed}</td>
                        <td className="p-3 text-center font-black text-red-300">{row.cancelled}</td>
                        <td className="p-3 text-center font-bold text-neutral-300">{row.pending}</td>
                        <td className="p-3">
                          <div className="mx-auto w-32">
                            <div className="flex items-center justify-between">
                              <span className="font-black text-orange-300">{row.successRate.toFixed(1)}%</span>
                              <BarChart3 className="h-3.5 w-3.5 text-neutral-600" />
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, row.successRate)}%` }} />
                            </div>
                            <div className="mt-1 text-[8px] text-neutral-600">Cancel {row.cancelRate.toFixed(1)}%</div>
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-black ${status.className}`}>{status.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <p className="text-[10px] leading-5 text-neutral-500">
        Test orders and duplicate orders are excluded. A single order counts once per Main / Combo Code even if quantity is more than 1.
      </p>
    </div>
  );
};
