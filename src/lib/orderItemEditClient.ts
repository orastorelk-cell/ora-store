import { staffJsonRequest } from './staffRequest';
import { ORDER_ITEM_EDIT_API, type ItemEditInput } from './orderItemEdit';
export const orderItemEditRequest = async (query = '', input?: ItemEditInput) => {
  const result = await staffJsonRequest(ORDER_ITEM_EDIT_API + query, {
    method: input ? 'POST' : 'GET', headers: {'content-type': 'application/json',
      authorization: 'Bearer ' + (localStorage.getItem('ora_staff_session_token') || '')},
    ...(input ? {body: JSON.stringify(input)} : {}),
  });
  if (result.ok !== true || !result.order?.id || !Array.isArray(result.order.items) ||
      input && (result.operation_id !== input.operation_id || result.order.id !== input.order_id) ||
      !input && (!Array.isArray(result.products) || typeof result.expected_identity !== 'string' || !result.draft)) {
    const error: any = new Error('The saved item details could not be verified. Retry the same edit.'); error.status = 503; throw error;
  }
  return result;
};
