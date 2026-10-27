import assert from 'node:assert/strict';
import type { Order } from '../src/types';
import { validateInvoiceOrder } from '../src/lib/pdfGenerator';

// Printing an EXISTING locked PDF must not require stock to still be in
// the original warehouse allocation state after shipping/delivery.
const fresh={
  id:'pdf-invoice-1',order_number:'FB-TEST-001',
  invoice_locked:true,invoice_number:'INV-FB-TEST-001',
  invoice_pack_batch_id:'PACK-001',invoice_generated_at:'2026-10-14T06:00:00Z',
  waybill_number:'18160742',stock_allocated:true,stock_status:'Allocated',
  order_status:'Processing',items:[{sku:'TEST',quantity:1,unit_price:500,subtotal:500}],
} as unknown as Order;
assert.deepEqual(validateInvoiceOrder(fresh),[],'normal saved invoice is printable');
const shipped={...fresh,stock_allocated:false,stock_status:'Handed Over',order_status:'Shipped'};
assert.deepEqual(validateInvoiceOrder(shipped),[],'dispatched historical invoice can be printed again');
const delivered={...shipped,order_status:'Delivered',stock_status:'Out of Stock'};
assert.deepEqual(validateInvoiceOrder(delivered),[],'delivered historical invoice remains printable');
assert(validateInvoiceOrder({...fresh,invoice_locked:false,stock_allocated:false}).includes('Stock not allocated'),
  'new invoice cannot bypass allocation checks');
assert(validateInvoiceOrder({...fresh,invoice_pack_batch_id:'',stock_allocated:false}).includes('Stock not allocated'),
  'incomplete invoice lock cannot bypass allocation checks');
assert(validateInvoiceOrder({...fresh,invoice_generated_at:'invalid',stock_allocated:false}).includes('Stock not allocated'),
  'invalid timestamp cannot bypass allocation checks');
assert(validateInvoiceOrder({...shipped,waybill_number:''}).includes('Waybill required'),
  'a locked invoice does not bypass waybill identity safety');
assert(validateInvoiceOrder({...shipped,order_status:'Cancelled'}).includes('Cancelled'),
  'cancellations remain blocked');
assert(validateInvoiceOrder({...shipped,is_duplicate_order:true}).includes('Duplicate order'),
  'duplicate parcels remain blocked');
console.log('PASS: historical generated invoices re-download after stock transitions, while new invoices, cancelled orders, missing waybills and duplicates remain safe.');
