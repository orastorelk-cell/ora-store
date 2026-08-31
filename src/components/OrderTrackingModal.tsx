import React, { useState } from 'react';
import {
  X,
  Package,
  Search,
  AlertCircle,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { formatLkr } from '../lib/currency';

const trackingSteps = [
  'Confirmed',
  'Waiting Stock',
  'Stock Ready',
  'Waybill Assigned',
  'Packed',
  'Handed to Courier',
  'Delivered',
];

export const OrderTrackingModal: React.FC = () => {
  const { orders, isTrackingOpen, setIsTrackingOpen } = useStore();
  const [query, setQuery] = useState('');
  const [searchTriggered, setSearchTriggered] = useState(false);

  if (!isTrackingOpen) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const foundOrders = searchTriggered && normalizedQuery
    ? orders.filter(
        (o) =>
          o.order_number.toLowerCase().includes(normalizedQuery) ||
          o.phone.includes(query.trim()) ||
          String(o.waybill_number || '').toLowerCase().includes(normalizedQuery)
      )
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-xl bg-white border border-gray-100 rounded-3xl shadow-2xl overflow-hidden my-auto p-6 sm:p-8 space-y-5 text-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center space-x-2 text-orange-600">
            <Package className="w-5 h-5" />
            <h2 className="text-base font-bold text-gray-900">Track Order Delivery</h2>
          </div>
          <button
            onClick={() => setIsTrackingOpen(false)}
            className="p-1.5 rounded-full bg-gray-100 text-gray-500 hover:text-black hover:bg-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input */}
        <div className="flex space-x-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchTriggered(false);
              }}
              placeholder="Enter Order ID, Phone Number or Waybill Number"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
          <button
            onClick={() => setSearchTriggered(true)}
            className="px-5 py-2.5 rounded-full bg-black text-white font-bold text-xs hover:bg-orange-600 transition-colors shadow-sm"
          >
            Track
          </button>
        </div>

        {/* Results Section */}
        {searchTriggered && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {foundOrders.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-xs space-y-1">
                <AlertCircle className="w-8 h-8 text-gray-300 mx-auto" />
                <p>No orders found matching "{query}". Please check your Order ID, phone number or waybill number.</p>
              </div>
            ) : (
              foundOrders.map((order) => {
                const currentStepIndex =
                  order.order_status === 'Delivered' ? 6 :
                  (order.dispatch_status === 'Handed Over' || order.order_status === 'Shipped') ? 5 :
                  order.order_status === 'Packed' ? 4 :
                  Boolean(order.waybill_number) ? 3 :
                  order.stock_allocated ? 2 :
                  order.call_center_status === 'Confirmed' ? 1 :
                  0;
                const currentTrackingLabel = trackingSteps[currentStepIndex];

                return (
                  <div
                    key={order.id}
                    className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-4"
                  >
                    {/* Header Row */}
                    <div className="flex justify-between items-center text-xs pb-3 border-b border-gray-200">
                      <div>
                        <span className="font-mono font-bold text-orange-600">{order.order_number}</span>
                        <span className="text-[10px] text-gray-400 block">
                          Date: {new Date(order.created_at).toLocaleDateString()}
                        </span>
                        {order.waybill_number && (
                          <span className="text-[10px] text-gray-500 block mt-1">
                            Waybill: <span className="font-mono font-bold text-gray-700">{order.waybill_number}</span>
                          </span>
                        )}
                      </div>
                      <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-900 font-bold border border-orange-200">
                        {currentTrackingLabel}
                      </span>
                    </div>

                    {/* Step Timeline */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        Delivery Status Progress:
                      </p>
                      <div className="flex items-center justify-between relative">
                        {trackingSteps.map((step, idx) => {
                          const isDone = idx <= currentStepIndex;
                          return (
                            <div key={step} className="flex flex-col items-center z-10">
                              <div
                                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                  isDone
                                    ? 'bg-orange-600 text-white shadow-sm'
                                    : 'bg-gray-200 text-gray-500'
                                }`}
                              >
                                {isDone ? '✓' : idx + 1}
                              </div>
                              <span className="text-[9px] text-gray-500 mt-1 hidden sm:block font-medium">
                                {step}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Items & Total */}
                    <div className="text-xs space-y-1 text-gray-600 pt-2 border-t border-gray-200">
                      <p className="font-bold text-gray-900">Items Ordered:</p>
                      {order.items.map((it, i) => (
                        <p key={i} className="text-gray-500">
                          • {it.product_name}{it.variant_name ? ` - ${it.variant_name}` : ''} (x{it.quantity}) - Rs. {formatLkr(it.subtotal)}
                        </p>
                      ))}
                      <div className="flex justify-between font-extrabold text-orange-600 pt-2 border-t border-gray-200">
                        <span>Total Amount:</span>
                        <span>Rs. {formatLkr(order.total_amount)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
