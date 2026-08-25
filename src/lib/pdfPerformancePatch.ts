export const pdfPerformancePatch = () => ({
  name: 'ora-pdf-performance-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/lib/pdfGenerator.ts')) return null;
    let text = code;

    const fnMarker = "const resolveInvoiceDistrict = async (order: Order, settings: StoreSettings) => {";
    if (!text.includes('const invoiceDistrictCache = new Map<string,string>();')) {
      if (!text.includes(fnMarker)) throw new Error('[O-RA PDF performance] district resolver marker not found');
      text = text.replace(fnMarker, "const invoiceDistrictCache = new Map<string,string>();\n\n" + fnMarker);
    }

    const existingMarker = "  const existing = String((order as any).district || '').trim();\n  if (existing) return existing;";
    const existingReplacement = "  const existing = String((order as any).district || '').trim();\n  if (existing) return existing;\n  const cacheKey = String(order.order_number || order.id || '').trim();\n  if (cacheKey && invoiceDistrictCache.has(cacheKey)) return invoiceDistrictCache.get(cacheKey) || '';";
    if (!text.includes(existingReplacement)) {
      if (!text.includes(existingMarker)) throw new Error('[O-RA PDF performance] district cache marker not found');
      text = text.replace(existingMarker, existingReplacement);
    }

    const fetchMarker = "    const response = await fetch('/api/google-sheets/proxy', {\n      method:'POST',\n      headers:{'Content-Type':'application/json'},\n      body:JSON.stringify({\n        webhookUrl,\n        payload:{ action:'order_details', orderId },\n      }),\n    });";
    const fetchReplacement = "    const controller = new AbortController();\n    const timeout = window.setTimeout(() => controller.abort(), 700);\n    const response = await fetch('/api/google-sheets/proxy', {\n      method:'POST',\n      headers:{'Content-Type':'application/json'},\n      body:JSON.stringify({\n        webhookUrl,\n        payload:{ action:'order_details', orderId },\n      }),\n      signal: controller.signal,\n    }).finally(() => window.clearTimeout(timeout));";
    if (!text.includes(fetchReplacement)) {
      if (!text.includes(fetchMarker)) throw new Error('[O-RA PDF performance] district fetch marker not found');
      text = text.replace(fetchMarker, fetchReplacement);
    }

    const successMarker = "    return String(result?.district || '').trim();";
    const successReplacement = "    const district = String(result?.district || '').trim();\n    if (cacheKey) invoiceDistrictCache.set(cacheKey, district);\n    return district;";
    if (!text.includes(successReplacement)) {
      if (!text.includes(successMarker)) throw new Error('[O-RA PDF performance] district result marker not found');
      text = text.replace(successMarker, successReplacement);
    }

    // exactInvoiceTemplate.ts already renders a durable order.district. Only inject a
    // Sheet fallback when the durable snapshot has no district, otherwise it is drawn twice.
    const districtDrawMarker = "  const svg = buildExactInvoiceSvg(order,settings,false,pageItems,pageIndex,totalPages);\n  const district = await resolveInvoiceDistrict(order, settings);";
    const districtDrawReplacement = "  const svg = buildExactInvoiceSvg(order,settings,false,pageItems,pageIndex,totalPages);\n  if (String((order as any).district || '').trim()) return svg;\n  const district = await resolveInvoiceDistrict(order, settings);";
    if (!text.includes(districtDrawReplacement)) {
      if (!text.includes(districtDrawMarker)) throw new Error('[O-RA PDF performance] district render marker not found');
      text = text.replace(districtDrawMarker, districtDrawReplacement);
    }

    // Never silently drop order 51+. One logical upload can safely render up to 120
    // orders in one A6 PDF; the Packing UI chunks larger logical batches separately.
    const batchMarker = "  const batch=orders.slice(0,50);";
    const batchReplacement = "  if(orders.length>120) throw new Error('This A6 PDF contains more than 120 orders. Use the Packing All-A6 download, which safely creates multiple parts.');\n  const batch=orders;";
    if (!text.includes(batchReplacement)) {
      if (!text.includes(batchMarker)) throw new Error('[O-RA PDF performance] batch limit marker not found');
      text = text.replace(batchMarker, batchReplacement);
    }

    const repairInsertMarker = "export async function generateOrderInvoicePDF(order: Order, settings: StoreSettings = {} as StoreSettings) {";
    if (!text.includes('export async function generateRepairedOrderInvoicePDF')) {
      if (!text.includes(repairInsertMarker)) throw new Error('[O-RA PDF performance] repair insertion marker not found');
      const repairCode = String.raw`
type InvoiceRepairRow = {
  item_code:string; item_name?:string; variant?:string; qty:number; unit_price:number; line_total:number; item_action?:string;
};
type InvoiceRepairSnapshot = {
  captured_at?:string; city?:string; district?:string; normal_total?:number; offer?:string; discount?:number;
  delivery_fee?:number; gift_wrap?:string; wrapping_cost?:number; final_total?:number; items?:InvoiceRepairRow[];
};

const repairMoney = (value:unknown) => {
  const n=Number(String(value ?? '').replace(/[^0-9.-]/g,''));
  return Number.isFinite(n)?Math.max(0,n):0;
};
const repairQtyOffer = (offer:unknown) => {
  const text=String(offer||'');
  if(/no\s+qty\s+offer/i.test(text)) return 0;
  const match=text.match(/qty\s+offer\s*(?:rs\.?\s*)?([0-9,.]+)/i);
  return match?repairMoney(match[1]):0;
};

const readInvoiceRepairSnapshot = async (order:Order, settings:StoreSettings):Promise<InvoiceRepairSnapshot> => {
  const saved=(order as any).invoice_confirm_snapshot as InvoiceRepairSnapshot|undefined;
  if(saved && Array.isArray(saved.items) && saved.items.length) return saved;

  const webhookUrl=String((settings as any).google_sheet_webhook_url||'').trim();
  if(!APPS_SCRIPT_URL_PATTERN.test(webhookUrl)) throw new Error('Repair needs the connected Google Sheet or a saved Confirm snapshot.');
  const response=await fetch('/api/google-sheets/proxy',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({webhookUrl,payload:{action:'invoice_repair_details',orderId:order.order_number}}),
  });
  const data=await response.json().catch(()=>({}));
  const result=data?.result||{};
  if(!response.ok || data?.ok===false || result?.ok===false) throw new Error(result?.message||data?.error||'Could not read invoice repair details from Google Sheet.');
  if(!Array.isArray(result?.items) || !result.items.length) throw new Error('No confirmed Sheet rows were found for this order.');
  return result as InvoiceRepairSnapshot;
};

const buildRepairedInvoiceOrder = async (order:Order, settings:StoreSettings):Promise<Order> => {
  const snapshot=await readInvoiceRepairSnapshot(order,settings);
  const sourceItems=Array.isArray(order.items)?order.items:[];
  const kept=(snapshot.items||[]).filter(row=>!['cancel','cancelled','canceled','cancel item'].includes(String(row.item_action||'').trim().toLowerCase()));
  if(!kept.length) throw new Error('Repair data has no invoice items.');

  const repairedItems=kept.map((row,index)=>{
    const code=String(row.item_code||'').trim().toUpperCase();
    const prior=sourceItems.find(it=>[String(it.sku||''),String(it.main_sku||'')].some(v=>v.trim().toUpperCase()===code)) || sourceItems[index];
    const qty=Math.max(1,Number(row.qty||1));
    const unit=repairMoney(row.unit_price);
    const line=repairMoney(row.line_total) || Math.round(unit*qty*100)/100;
    return {
      ...(prior || { product_id:'invoice-repair-'+index, buying_price:0 }),
      product_name:String(row.item_name||prior?.product_name||code||'Item'),
      sku:code || String(prior?.sku||''),
      main_sku:String(prior?.main_sku||code||prior?.sku||''),
      variant_name:String(row.variant||prior?.variant_name||'') || undefined,
      quantity:qty,
      unit_price:unit,
      subtotal:line,
      supplier_offer_discount_per_unit:0,
    } as Order['items'][number];
  });

  const subtotal=Math.round(repairedItems.reduce((sum,item)=>sum+repairMoney(item.subtotal),0)*100)/100;
  const normalTotal=repairMoney(snapshot.normal_total) || subtotal;
  const displaySpecial=Math.max(0,Math.round((normalTotal-subtotal)*100)/100);
  if(displaySpecial>0 && repairedItems[0]){
    repairedItems[0]={...repairedItems[0],supplier_offer_discount_per_unit:displaySpecial/Math.max(1,Number(repairedItems[0].quantity||1))};
  }
  const qtyOffer=repairQtyOffer(snapshot.offer);
  const wrapText=String(snapshot.gift_wrap||'').trim().toLowerCase();
  const giftWrap=['yes','true','1','on','add wrap','gift wrap'].includes(wrapText);
  const wrapFee=giftWrap?repairMoney(snapshot.wrapping_cost):0;
  const delivery=repairMoney(snapshot.delivery_fee);
  const computed=Math.max(0,Math.round((subtotal-qtyOffer+delivery+wrapFee)*100)/100);
  const finalTotal=repairMoney(snapshot.final_total) || computed;

  return {
    ...order,
    city:String(snapshot.city||order.city||''),
    district:String(snapshot.district||(order as any).district||''),
    items:repairedItems,
    subtotal,
    special_offer_discount:qtyOffer,
    delivery_fee:delivery,
    delivery_included_in_item_price:delivery<=0,
    gift_wrap_selected:giftWrap,
    gift_wrap_fee:wrapFee,
    total_amount:finalTotal,
  } as Order;
};

export async function generateRepairedOrderInvoicePDF(order:Order, settings:StoreSettings = {} as StoreSettings) {
  const repaired=await buildRepairedInvoiceOrder(order,settings);
  const reasons=validateInvoiceOrder(repaired);
  if(!repaired.invoice_locked && reasons.length) throw new Error('Invoice cannot be repaired: '+reasons.join(', '));
  const itemPages=splitInvoiceItems(repaired);
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a6',compress:true});
  for(let pageIndex=0;pageIndex<itemPages.length;pageIndex++){
    if(pageIndex>0) doc.addPage('a6','landscape');
    await addExactPage(doc,repaired,settings,itemPages[pageIndex],pageIndex,itemPages.length);
  }
  downloadPdfBlob(doc, 'O-RA_REPAIRED_'+String(repaired.invoice_number || repaired.order_number)+'.pdf');
}

`;
      text = text.replace(repairInsertMarker, repairCode + repairInsertMarker);
    }

    return text === code ? null : { code: text, map: null };
  },
});
