import { Order } from '../types';

export const normalizeCustomerPhone = (value: string) =>
  String(value || '').replace(/\D/g, '').replace(/^94(?=7\d{8}$)/, '0');

export const getMembershipLevel = (successfulOrders: number) => {
  const count = Math.max(0, Number(successfulOrders || 0));
  if (count >= 20) return 'VIP MEMBER';
  if (count >= 11) return 'GOLD MEMBER';
  if (count >= 6) return 'SILVER MEMBER';
  if (count >= 3) return 'BRONZE MEMBER';
  return 'NEW CUSTOMER';
};

export const isSuccessfulMembershipOrder = (order: Order) =>
  !order.is_test_order &&
  !order.is_duplicate_order &&
  order.order_status !== 'Cancelled' &&
  (order.order_status === 'Delivered' || order.payment_status === 'Paid' || Boolean(order.cod_payment_received));

export const getCustomerMembership = (orders: Order[], phone: string) => {
  const normalized = normalizeCustomerPhone(phone);
  const successfulOrders = orders.filter(
    (order) => normalizeCustomerPhone(order.phone) === normalized && isSuccessfulMembershipOrder(order),
  ).length;
  return { successfulOrders, level: getMembershipLevel(successfulOrders) };
};
