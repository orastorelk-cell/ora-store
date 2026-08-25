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

    const districtDrawMarker = "  const svg = buildExactInvoiceSvg(order,settings,false,pageItems,pageIndex,totalPages);\n  const district = await resolveInvoiceDistrict(order, settings);";
    const districtDrawReplacement = "  const svg = buildExactInvoiceSvg(order,settings,false,pageItems,pageIndex,totalPages);\n  if (String((order as any).district || '').trim()) return svg;\n  const district = await resolveInvoiceDistrict(order, settings);";
    if (!text.includes(districtDrawReplacement)) {
      if (!text.includes(districtDrawMarker)) throw new Error('[O-RA PDF performance] district render marker not found');
      text = text.replace(districtDrawMarker, districtDrawReplacement);
    }

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
  const value=String(offer||'');
  if(/no\s+qty\s+offer/i.test(value)) return 0;
  const match=value.match(/qty\s+offer\s*(?:rs\.?\s*)?([0-9,.]+)/i);
  return match?repairMoney(match[1]):0;
};
const repairItemCancelled = (value:unknown) => ['cancel','cancelled','canceled','cancel item'].includes(String(value||'').trim().toLowerCase());

const invoiceConfirmMismatchReasons = (order:Order):string[] => {
  const snapshot=(order as any).invoice_confirm_snapshot as InvoiceRepairSnapshot|undefined;
  if(!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length) return [];
  const reasons:string[]=[];
  const expected=snapshot.items.filter(row=>!repairItemCancelled(row.item_action));
  const actual=Array.isArray(order.items)?order.items:[];
  if(expected.length!==actual.length) reasons.push('item count');
  const count=Math.min(expected.length,actual.length);
  for(let i=0;i<count;i++){
    const e=expected[i], a=actual[i];
    const eCode=String(e.item_code||'').trim().toUpperCase();
    const codes=[String(a.sku||''),String(a.main_sku||'')].map(v=>v.trim().toUpperCase());
    if(eCode && !codes.includes(eCode)) reasons.push('item '+(i+1)+' code');
    if(Math.max(1,Number(e.qty||1))!==Math.max(1,Number(a.quantity||1))) reasons.push('item '+(i+1)+' qty');
    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-repairMoney(a.unit_price))>0.01) reasons.push('item '+(i+1)+' price');
    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-repairMoney(a.subtotal))>0.01) reasons.push('item '+(i+1)+' total');
  }
  const wrapText=String(snapshot.gift_wrap||'').trim().toLowerCase();
  if(wrapText){
    const expectedWrap=['yes','true','1','on','add wrap','gift wrap'].includes(wrapText);
    if(expectedWrap!==Boolean(order.gift_wrap_selected)) reasons.push('gift wrap');
    if(expectedWrap && repairMoney(snapshot.wrapping_cost)>0 && Math.abs(repairMoney(snapshot.wrapping_cost)-repairMoney(order.gift_wrap_fee))>0.01) reasons.push('wrapping cost');
  }
  if(repairMoney(snapshot.final_total)>0 && Math.abs(repairMoney(snapshot.final_total)-repairMoney(order.total_amount))>0.01) reasons.push('final total');
  return Array.from(new Set(reasons));
};
const assertInvoiceConfirmSnapshot = (orders:Order[]) => {
  const bad=(orders||[]).map(order=>({order,reasons:invoiceConfirmMismatchReasons(order)})).filter(row=>row.reasons.length);
  if(!bad.length) return;
  const sample=bad.slice(0,5).map(row=>String(row.order.order_number)+': '+row.reasons.join(', ')).join(' | ');
  throw new Error('Invoice safety check stopped '+bad.length+' mismatched invoice(s). '+sample+'. Use Repair Invoice / Repair from CSV instead of printing a wrong bill.');
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
  const kept=(snapshot.items||[]).filter(row=>!repairItemCancelled(row.item_action));
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
    invoice_confirm_snapshot:snapshot,
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

const parseInvoiceRepairCsvLine = (line:string) => {
  const out:string[]=[]; let cur=''; let quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted && line[i+1]==='"'){cur+='"';i++;}
      else quoted=!quoted;
    }else if(ch===',' && !quoted){out.push(cur.trim());cur='';}
    else cur+=ch;
  }
  out.push(cur.trim());
  return out;
};
const repairCsvKey=(value:string)=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const repairSnapshotFromCsv=(order:Order,csvText:string):InvoiceRepairSnapshot=>{
  const lines=String(csvText||'').split(/\r?\n/).filter(line=>line.trim());
  if(lines.length<2) throw new Error('Selected CSV has no data rows.');
  const headers=parseInvoiceRepairCsvLine(lines[0]).map(repairCsvKey);
  const col=(names:string[])=>headers.findIndex(h=>names.includes(h));
  const idI=col(['order_id','order_number','order']);
  const codeI=col(['item_code','variant_code','actual_sku','sku']);
  const itemNameI=col(['item_name','product_name']);
  const variantI=col(['variant_color','variant','color','colour','option']);
  const qtyI=col(['qty','quantity']);
  const unitI=col(['unit_price_rs','unit_price','price']);
  const lineI=col(['line_total_rs','line_total']);
  const itemActionI=col(['item_action','item_status']);
  const normalI=col(['normal_total_rs','normal_total']);
  const offerI=col(['offer']);
  const discountI=col(['discount_rs','discount']);
  const deliveryI=col(['delivery_fee_rs','delivery_fee']);
  const giftI=col(['gift_wrap','gift_wrapping','wrap']);
  const wrappingI=col(['wrapping_cost_rs','wrapping_cost','gift_wrap_fee','wrapping_fee_rs','wrapping_fee']);
  const finalI=col(['final_total_rs','final_total']);
  const cityI=col(['city']);
  const districtI=col(['district']);
  if(idI<0 || codeI<0) throw new Error('Selected CSV does not contain Order ID and Item Code columns.');
  const wanted=String(order.order_number||'').trim().toUpperCase();
  const rows=lines.slice(1).map(parseInvoiceRepairCsvLine).filter(row=>String(row[idI]||'').trim().toUpperCase()===wanted);
  if(!rows.length) throw new Error('Selected CSV has no rows for '+wanted+'.');
  const firstText=(i:number)=>i>=0?String(rows.map(row=>row[i]).find(v=>String(v||'').trim())||'').trim():'';
  const firstMoney=(i:number)=>repairMoney(firstText(i));
  return {
    captured_at:new Date().toISOString(),
    city:firstText(cityI),
    district:firstText(districtI),
    normal_total:firstMoney(normalI),
    offer:firstText(offerI),
    discount:firstMoney(discountI),
    delivery_fee:firstMoney(deliveryI),
    gift_wrap:firstText(giftI),
    wrapping_cost:firstMoney(wrappingI),
    final_total:firstMoney(finalI),
    items:rows.map(row=>({
      item_code:String(row[codeI]||'').trim(),
      item_name:itemNameI>=0?String(row[itemNameI]||'').trim():'',
      variant:variantI>=0?String(row[variantI]||'').trim():'',
      qty:Math.max(1,Number(qtyI>=0?row[qtyI]:1)||1),
      unit_price:unitI>=0?repairMoney(row[unitI]):0,
      line_total:lineI>=0?repairMoney(row[lineI]):0,
      item_action:itemActionI>=0?String(row[itemActionI]||'').trim():'',
    }))
  };
};

export async function generateRepairedOrderInvoicePDFFromCsv(order:Order, settings:StoreSettings = {} as StoreSettings, csvText='') {
  const snapshot=repairSnapshotFromCsv(order,csvText);
  const withSnapshot={...(order as any),invoice_confirm_snapshot:snapshot} as Order;
  await generateRepairedOrderInvoicePDF(withSnapshot,settings);
}

export async function generateRepairedBatchInvoicesPDFFromCsv(orders:Order[], settings:StoreSettings = {} as StoreSettings, csvText='', fileName?:string) {
  if(!orders.length) throw new Error('No invoices are available in this packing batch.');
  if(orders.length>120) throw new Error('Repair batch is over 120 orders. Repair it in separate packing parts.');
  const repaired:Order[]=[];
  for(const order of orders){
    const snapshot=repairSnapshotFromCsv(order,csvText);
    repaired.push(await buildRepairedInvoiceOrder({...(order as any),invoice_confirm_snapshot:snapshot} as Order,settings));
  }
  await generateBatchInvoicesPDF(repaired,settings,fileName || ('O-RA_REPAIRED_BATCH_'+Date.now()+'.pdf'));
}

`;
      text = text.replace(repairInsertMarker, repairCode + repairInsertMarker);
    }

    const orderSafetyOld = "  const reasons=validateInvoiceOrder(order);\n  if(!order.invoice_locked && reasons.length) throw new Error(`Invoice cannot be generated: ${reasons.join(', ')}`);";
    const orderSafetyNew = orderSafetyOld + "\n  assertInvoiceConfirmSnapshot([order]);";
    if (!text.includes(orderSafetyNew)) {
      if (!text.includes(orderSafetyOld)) throw new Error('[O-RA PDF performance] single invoice safety marker not found');
      text = text.replace(orderSafetyOld, orderSafetyNew);
    }

    const a4SafetyOld = "  const invalid=singles.filter(o=>validateInvoiceOrder(o).length>0);\n  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);";
    const a4SafetyNew = a4SafetyOld + "\n  assertInvoiceConfirmSnapshot(singles);";
    if (!text.includes(a4SafetyNew)) {
      if (!text.includes(a4SafetyOld)) throw new Error('[O-RA PDF performance] A4 invoice safety marker not found');
      text = text.replace(a4SafetyOld, a4SafetyNew);
    }

    const a6SafetyOld = "  const invalid=batch.filter(o=>validateInvoiceOrder(o).length>0);\n  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);";
    const a6SafetyNew = a6SafetyOld + "\n  assertInvoiceConfirmSnapshot(batch);";
    if (!text.includes(a6SafetyNew)) {
      if (!text.includes(a6SafetyOld)) throw new Error('[O-RA PDF performance] A6 invoice safety marker not found');
      text = text.replace(a6SafetyOld, a6SafetyNew);
    }

    return text === code ? null : { code: text, map: null };
  },
});
