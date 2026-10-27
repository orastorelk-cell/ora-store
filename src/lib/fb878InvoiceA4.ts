import { jsPDF } from 'jspdf';
import type { Order, StoreSettings } from '../types';
import { buildExactInvoiceSvg, svgToBrowserPngBytes } from './exactInvoiceTemplate';
import { parseCsv } from './csv';
import { confirmedFB878CsvTotal } from './fb878InvoiceRepair';

type SnapshotItem = {
  item_code:string; item_name?:string; variant?:string; qty:number;
  unit_price:number; line_total:number; item_action?:string;
};
type Snapshot = {
  final_total?:number|string; normal_total?:number|string;
  discount?:number|string;delivery_fee?:number|string;
  gift_wrap?:string;wrapping_cost?:number|string;
  district?:string; city?:string; items:SnapshotItem[];
};
const number = (value:unknown):number => {
  const text=String(value??'').trim().replace(/^(?:Rs\.?|LKR)\s*/i,'').replace(/,/g,'');
  if(!/^\d+(?:\.\d+)?$/.test(text))return 0;
  return Number(text);
};
const header=(value:string)=>String(value||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
const sameOrder=(value:unknown)=>String(value||'').trim().toUpperCase()==='FB-000878';

export function fb878SnapshotFromCsv(csvText:string):Snapshot {
  const parsed=parseCsv(csvText);
  const byHeader=new Map(parsed.headers.map(name=>[header(name),name]));
  const pick=(row:Record<string,string>,choices:string[]):string=>{
    for(const choice of choices){const key=byHeader.get(choice);if(key&&row[key]!=null)return String(row[key]).trim();}
    return '';
  };
  const orderColumn=['order_id','order_number','order'].map(name=>byHeader.get(name)).find(Boolean);
  const finalColumn=['final_total_rs','final_total'].map(name=>byHeader.get(name)).find(Boolean);
  if(!orderColumn||!finalColumn)throw new Error('Confirm CSV requires Order ID and Final Total columns. Fardar courier CSV is not a Confirm CSV.');
  const rows=parsed.rows.filter(row=>sameOrder(row[orderColumn]));
  if(!rows.length)throw new Error('Selected Confirm CSV has no FB-000878 rows.');
  const get=(choices:string[])=>pick(rows[0],choices);
  const items=rows.filter(row=>!['cancel','cancelled','canceled','cancel item'].includes(pick(row,['item_action','item_status']).toLowerCase())).map(row=>({
    item_code:pick(row,['item_code','variant_code','actual_sku','sku']),
    item_name:pick(row,['item_name','product_name']),
    variant:pick(row,['variant_color','variant','color','colour','option']),
    qty:Math.max(1,Number(pick(row,['qty','quantity'])||1)),
    unit_price:number(pick(row,['unit_price_rs','unit_price','price'])),
    line_total:number(pick(row,['line_total_rs','line_total'])),
    item_action:pick(row,['item_action','item_status']),
  }));
  if(items.some(item=>!item.item_code||!Number.isSafeInteger(item.qty)||item.qty<1))
    throw new Error('FB-000878 CSV must provide valid Item Code and Quantity for every uncancelled item.');
  const snapshot:Snapshot={
    final_total:get(['final_total_rs','final_total']),
    normal_total:get(['normal_total_rs','normal_total']),
    discount:get(['discount_rs','discount']),
    delivery_fee:get(['delivery_fee_rs','delivery_fee']),
    gift_wrap:get(['gift_wrap','gift_wrapping','wrap']),
    wrapping_cost:get(['wrapping_cost_rs','wrapping_cost','gift_wrap_fee']),
    district:get(['district']),city:get(['city']),
    items,
  };
  confirmedFB878CsvTotal('FB-000878',snapshot);
  return snapshot;
}

export const resolveFB878InvoiceSnapshot=async(order:Order,settings:StoreSettings,csvText?:string):Promise<Snapshot>=>{
  if(csvText)return fb878SnapshotFromCsv(csvText);
  const saved=(order as any).invoice_confirm_snapshot as Snapshot|undefined;
  if(saved && Number(saved.final_total)===1250 && Array.isArray(saved.items) && saved.items.length)
    return saved;
  const webhookUrl=String((settings as any).google_sheet_webhook_url||'').trim();
  if(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhookUrl)){
    try{
      const response=await fetch('/api/google-sheets/proxy',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({webhookUrl,payload:{action:'invoice_repair_details',orderId:'FB-000878'}}),
      });
      const data=await response.json().catch(()=>({}));
      const result=data?.result||{};
      if(response.ok && data?.ok!==false && result?.ok!==false &&
        Array.isArray(result.items)&&result.items.length&&Number(result.final_total)===1250)
        return result as Snapshot;
    }catch{ /* The original Confirm CSV can be uploaded as a fallback. */ }
  }
  throw new Error('FB-000878: the saved invoice has an incorrect total. Select Confirm CSV → A4 2×A5 and upload the correct CSV with Final Total Rs. 1,250.');
};

export function correctedFB878PrintOrder(order:Order,snapshot:Snapshot):Order {
  confirmedFB878CsvTotal(order.order_number,snapshot);
  if(!order.invoice_locked||!String(order.invoice_number||'').trim()||!order.waybill_number ||
    order.order_status==='Cancelled'||order.is_duplicate_order)
    throw new Error('FB-000878 must be a generated, non-cancelled invoice with its original waybill.');
  const oldItems=Array.isArray(order.items)?order.items:[];
  const items=snapshot.items.filter(item=>!['cancel','cancelled','canceled','cancel item'].includes(String(item.item_action||'').toLowerCase())).map((entry,i)=>{
    const old=oldItems.find(item=>[item.sku,item.main_sku].some(code=>String(code||'').trim().toUpperCase()===String(entry.item_code).trim().toUpperCase()))||oldItems[i];
    if(!old && (!entry.item_code || !entry.unit_price))
      throw new Error('FB-000878: original invoice item details do not match this Confirm CSV.');
    const quantity=Math.max(1,Number(entry.qty)||1);
    const unit=number(entry.unit_price)||number(old?.unit_price);
    const subtotal=number(entry.line_total)||Math.round(unit*quantity*100)/100;
    return {
      ...(old||{product_id:'confirmed-invoice-item-'+i,buying_price:0}),
      sku:entry.item_code||old?.sku||'',
      product_name:entry.item_name||old?.product_name||entry.item_code,
      variant_name:entry.variant||old?.variant_name||undefined,
      quantity, unit_price:unit, subtotal,
      supplier_offer_discount_per_unit:0,
    };
  });
  if(!items.length)throw new Error('FB-000878: no active invoice items in the Confirm CSV.');
  const subtotal=items.reduce((sum,item)=>sum+number(item.subtotal),0);
  const delivery=number(snapshot.delivery_fee);
  const discount=number(snapshot.discount);
  const wrapText=String(snapshot.gift_wrap||'').toLowerCase().trim();
  const wrapped=['yes','true','1','on','add wrap','gift wrap'].includes(wrapText);
  const wrap=wrapped?number(snapshot.wrapping_cost):0;
  // Subtotal here is the actual confirmed item-line subtotal. Reference/regular
  // totals can include already-discounted supplier offers and must not replace it.
  const computed=Math.round((subtotal-discount+delivery+wrap)*100)/100;
  // The confirmed CSV's Final Total is authoritative, but the component
  // breakdown should agree. Otherwise don't print an internally wrong bill.
  if(Math.abs(computed-1250)>1)
    throw new Error('FB-000878: Confirm CSV Final Total is 1,250 but its item/discount/delivery breakdown differs ('+computed+'). Review that CSV before printing.');
  return {
    ...order, items, subtotal,
    special_offer_discount:discount,
    delivery_fee:delivery,
    delivery_included_in_item_price:delivery===0,
    gift_wrap_selected:wrapped,
    gift_wrap_fee:wrap,
    total_amount:1250,
    city:snapshot.city||order.city,
    district:snapshot.district||(order as any).district,
    // Print-only normalization. The saved Confirm CSV is still authoritative,
    // but reference/regular totals can differ from the actual item-line subtotal.
    // Make the printed breakdown internally consistent so downstream Invoice V6
    // snapshot rendering does not recalculate Rs. 1,250 back to the old Rs. 1,000.
    invoice_confirm_snapshot:{
      ...snapshot,normal_total:subtotal,discount,delivery_fee:delivery,
      gift_wrap:wrapped?'Yes':'No',wrapping_cost:wrap,final_total:1250,
    },
  } as Order;
}

// PDF-only operation: two identical A5 invoice copies on each A4 sheet.
// No writes to orders, stock allocations, payments, Fardar or invoices.
export async function downloadFB878CorrectA4TwoA5(
  order:Order,settings:StoreSettings,csvText?:string
):Promise<void>{
  if(!sameOrder(order.order_number))throw new Error('This correction is for FB-000878 only.');
  const snapshot=await resolveFB878InvoiceSnapshot(order,settings,csvText);
  const corrected=correctedFB878PrintOrder(order,snapshot);
  const parts=corrected.items.length
    ? Array.from({length:Math.ceil(corrected.items.length/4)},(_,i)=>corrected.items.slice(i*4,(i+1)*4))
    : [];
  if(!parts.length)throw new Error('FB-000878 has no invoice pages.');
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  const h=148,w=h*(148/105),x=(210-w)/2;
  for(let i=0;i<parts.length;i++){
    if(i)doc.addPage('a4','portrait');
    const svg=buildExactInvoiceSvg(corrected,settings,false,parts[i],i,parts.length);
    const png=await svgToBrowserPngBytes(svg);
    doc.addImage(png,'PNG',x,0.25,w,h,undefined,'FAST');
    doc.addImage(png,'PNG',x,148.75,w,h,undefined,'FAST');
    doc.setDrawColor(120,120,120);doc.setLineWidth(0.18);
    doc.line(0,148.5,6,148.5);doc.line(204,148.5,210,148.5);
  }
  const blob=doc.output('blob');
  if(!blob.size)throw new Error('The corrected PDF is empty.');
  const url=URL.createObjectURL(blob);
  const filename='FB-000878_Correct_1250_A4_2xA5.pdf';
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;anchor.style.display='none';
  document.body.appendChild(anchor);
  try{anchor.click();}finally{anchor.remove();}

  // Keep a user-clickable fallback after async SVG rendering (Chrome may
  // suppress the automatic Blob download if the original click expired).
  const existing=document.getElementById('ora-fb878-ready-pdf');
  existing?.remove();
  const tray=document.createElement('div');
  tray.id='ora-fb878-ready-pdf';
  tray.setAttribute('role','status');
  tray.style.cssText='position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#063f36;color:white;padding:14px;border:1px solid #7dd3b2;border-radius:12px;max-width:390px;box-shadow:0 10px 30px #0008;';
  const save=document.createElement('a');
  save.textContent='Save corrected FB-000878 — Rs 1,250 (A4 2×A5)';
  save.href=url;save.download=filename;
  save.style.cssText='display:block;background:#0d9488;color:white;padding:10px;border-radius:8px;text-decoration:none;font-weight:700;';
  tray.appendChild(save);
  const close=document.createElement('button');
  close.textContent='Dismiss';
  close.style.cssText='display:block;margin-top:8px;background:transparent;color:white;border:0;cursor:pointer;';
  close.type='button';tray.appendChild(close);
  document.body.appendChild(tray);
  let removed=false;
  const dispose=()=>{if(removed)return;removed=true;tray.remove();URL.revokeObjectURL(url);};
  close.addEventListener('click',dispose,{once:true});
  window.setTimeout(dispose,10*60_000);
}
