
import { jsPDF } from 'jspdf';
import { Order, StoreSettings } from '../types';
import { buildExactInvoiceSvg, svgToBrowserPngBytes } from './exactInvoiceTemplate';
import { ExchangeInvoiceRecord } from '../types';

export function validateInvoiceOrder(order: Order): string[] {
  const reasons:string[]=[];
  if(order.is_duplicate_order) reasons.push('Duplicate order');
  if(!order.stock_allocated || order.stock_status!=='Allocated') reasons.push('Stock not allocated');
  if(!order.waybill_number) reasons.push('Waybill required');
  if(order.order_status==='Cancelled') reasons.push('Cancelled');
  return reasons;
}

const escapeInvoiceSvgText = (value: unknown) => String(value ?? '')
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;');

const APPS_SCRIPT_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i;

const resolveInvoiceDistrict = async (order: Order, settings: StoreSettings) => {
  const existing = String((order as any).district || '').trim();
  if (existing) return existing;

  const webhookUrl = String((settings as any).google_sheet_webhook_url || '').trim();
  const orderId = String(order.order_number || '').trim();
  if (!orderId || !APPS_SCRIPT_URL_PATTERN.test(webhookUrl)) return '';

  try {
    const response = await fetch('/api/google-sheets/proxy', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        webhookUrl,
        payload:{ action:'order_details', orderId },
      }),
    });
    const data = await response.json().catch(()=>({}));
    const result = data?.result || {};
    if (!response.ok || data?.ok === false || result?.ok === false) return '';
    return String(result?.district || '').trim();
  } catch {
    return '';
  }
};

// Keep Invoice V6 layout untouched. If a District exists on the system order use
// it directly; otherwise read the current Call Center Sheet value. This matters
// for FB/TikTok leads where staff fills City/District during the phone call.
const buildInvoiceSvg = async (
  order: Order,
  settings: StoreSettings,
  pageItems: Order['items'],
  pageIndex: number,
  totalPages: number,
) => {
  const svg = buildExactInvoiceSvg(order,settings,false,pageItems,pageIndex,totalPages);
  const district = await resolveInvoiceDistrict(order, settings);
  if (!district) return svg;

  const anchor = '\n<!-- Waybill: no redundant courier name -->';
  if (!svg.includes(anchor)) return svg;
  const districtRow = [
    '<text class="t label" x="650" y="350">District</text>',
    '<text class="t label" x="722" y="350">-</text>',
    `<text class="t value" x="755" y="350">${escapeInvoiceSvgText(district)}</text>`,
  ].join('');
  return svg.replace(anchor, `\n${districtRow}\n${anchor}`);
};

async function addExactPage(
  doc: jsPDF,
  order: Order,
  settings: StoreSettings,
  pageItems: Order['items'],
  pageIndex: number,
  totalPages: number
) {
  const svg=await buildInvoiceSvg(order,settings,pageItems,pageIndex,totalPages);
  const pngBytes=await svgToBrowserPngBytes(svg);

  const pageW=148;
  const pageH=105;
  const imageH=pageW*(1090/1536);
  const y=Math.max(0,(pageH-imageH)/2);

  doc.addImage(pngBytes,'PNG',0,y,pageW,imageH,undefined,'FAST');
}

function splitInvoiceItems(order: Order): Order['items'][] {
  const items=order.items || [];
  if(!items.length) return [[]];

  const pages: Order['items'][]=[];
  for(let i=0;i<items.length;i+=4){
    pages.push(items.slice(i,i+4));
  }
  return pages;
}

function downloadPdfBlob(doc: jsPDF, fileName: string) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}


function buildPackingTestOrder(settings: StoreSettings, index = 1, itemCount = 1): Order {
  const items = Array.from({ length: Math.max(1, itemCount) }, (_,i) => {
    const unit = 1450 + ((index + i) % 5) * 250;
    return {
      product_id:`packing-test-${index}-${i+1}`,
      product_name:`Packing Test Product ${i+1}`,
      sku:`PT${String(index).padStart(2,'0')}${String(i+1).padStart(2,'0')}`,
      main_sku:`PT${String(index).padStart(2,'0')}${String(i+1).padStart(2,'0')}`,
      product_type:'normal' as const,
      buying_price:0,
      unit_price:unit,
      quantity:1,
      subtotal:unit,
    };
  });
  const subtotal=items.reduce((sum,item)=>sum+item.subtotal,0);
  const delivery=settings.free_delivery_enabled ? 0 : Math.max(0,Number(settings.delivery_fee||0));
  return {
    id:`packing-test-${index}`,
    order_number:`TEST-PACK-${String(index).padStart(3,'0')}`,
    invoice_number:`INV-TEST-PACK-${String(index).padStart(3,'0')}`,
    customer_name:`Packing Test Customer ${index}`,
    phone:'077 000 0000',
    whatsapp:'077 000 0000',
    address:'Memory-only packing PDF test. Nothing is saved.',
    city:'Colombo',
    payment_method:'COD',
    payment_status:'Pending',
    order_status:'Processing',
    items,
    subtotal,
    delivery_fee:delivery,
    internal_delivery_fee:Math.max(0,Number(settings.delivery_fee||0)),
    delivery_included_in_item_price:Boolean(settings.free_delivery_enabled),
    special_offer_discount:0,
    total_amount:subtotal+delivery,
    is_advance_required:false,
    advance_amount:0,
    advance_confirmed:false,
    order_source:'Website',
    is_synced_google_sheets:true,
    courier_name:'Fardar Delivery',
    waybill_number:`TESTWB${String(index).padStart(5,'0')}`,
    stock_status:'Allocated',
    stock_allocated:true,
    invoice_locked:true,
    created_at:new Date().toISOString(),
  };
}

export async function generateOrderInvoicePDF(order: Order, settings: StoreSettings = {} as StoreSettings) {
  const reasons=validateInvoiceOrder(order);
  if(!order.invoice_locked && reasons.length) throw new Error(`Invoice cannot be generated: ${reasons.join(', ')}`);

  const itemPages=splitInvoiceItems(order);
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a6',compress:true});

  for(let pageIndex=0;pageIndex<itemPages.length;pageIndex++){
    if(pageIndex>0) doc.addPage('a6','landscape');
    await addExactPage(doc,order,settings,itemPages[pageIndex],pageIndex,itemPages.length);
  }

  downloadPdfBlob(doc, `O-RA_Invoice_${order.invoice_number || order.order_number}.pdf`);
}

const exchangeBarcodePatterns:Record<string,string>={
  '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011',
  '5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101',
  '-':'100101011011','*':'100101101101',
};

const exchangeBarcodeSvg=(value:string,x:number,y:number,width:number,height:number)=>{
  const clean=String(value||'').toUpperCase();
  if(!clean||[...clean].some(char=>!exchangeBarcodePatterns[char]))return '';
  const bits=`*${clean}*`.split('').map(char=>exchangeBarcodePatterns[char]+'0').join('');
  const module=width/bits.length;
  return bits.split('').map((bit,index)=>bit==='1'?`<rect x="${x+index*module}" y="${y}" width="${Math.max(module,0.8)}" height="${height}" fill="#142c36"/>`:'').join('');
};

const buildExchangeInvoiceSvg=(exchange:ExchangeInvoiceRecord,settings:StoreSettings,items:Order['items'],pageIndex:number,totalPages:number)=>{
  const width=1536,height=1083;
  const safe=(value:unknown)=>escapeInvoiceSvgText(value);
  const brand=safe(settings.brand_store_name||'O-RA STORE');
  const address=safe(settings.invoice_company_address||settings.company_address||'Nabuluwa, Pasyala');
  const website=safe(settings.invoice_website_url||'www.orastore.com.lk');
  const logo=String(settings.invoice_logo||'');
  const itemRows=items.length?items:[{sku:'0',product_name:'',quantity:0} as any];
  const rowHeight=itemRows.length>4?35:46;
  const tableX=40,tableY=418,tableW=1456,headerH=52;
  const columns=[40,125,330,1020,1160,1312,1496];
  const bodyRows=itemRows.map((item,index)=>{
    const y=tableY+headerH+index*rowHeight;
    const code=safe(item.sku||item.main_sku||'0');
    const name=safe(item.product_name||'');
    const qty=Math.max(0,Number(item.quantity||0));
    const fs=rowHeight>40?22:18;
    return `<rect x="${tableX}" y="${y}" width="${tableW}" height="${rowHeight}" fill="${index%2?'#f4f8f8':'#ffffff'}"/><path d="M${tableX} ${y+rowHeight}H${tableX+tableW}" stroke="#d9e3e4"/><text class="body" x="${columns[0]+18}" y="${y+rowHeight*.68}" font-size="${fs}">${index+1}</text><text class="body code" x="${columns[1]+16}" y="${y+rowHeight*.68}" font-size="${fs}">${code}</text><text class="body" x="${columns[2]+16}" y="${y+rowHeight*.68}" font-size="${fs}">${name}</text><text class="body center" x="${columns[4]-24}" y="${y+rowHeight*.68}" font-size="${fs}">${qty}</text><text class="body center" x="${columns[5]-20}" y="${y+rowHeight*.68}" font-size="${fs}">0</text><text class="body center" x="${columns[6]-82}" y="${y+rowHeight*.68}" font-size="${fs}">0</text>`;
  }).join('');
  const tableBottom=tableY+headerH+itemRows.length*rowHeight;
  const noteY=Math.max(650,tableBottom+84);
  const noteH=height-noteY-42;
  const pageLabel=totalPages>1?`<text class="muted page" x="1490" y="1048" text-anchor="end">Page ${pageIndex+1} / ${totalPages}</text>`:'';
  const fontList=(()=>{try{return JSON.parse(settings.invoice_custom_fonts_json||'[]') as Array<{name:string;data:string;format?:string}>}catch{return []}})();
  const fontFaces=fontList.map(font=>`@font-face{font-family:"${safe(font.name)}";src:url("${font.data}") format("${safe(font.format||'truetype')}");font-display:block;}`).join('');
  const latinFont=safe((settings as any).invoice_font_values_family||'Arial');
  const sinhaleseFont=safe((settings as any).invoice_font_notice_family||(settings as any).invoice_font_values_family||'Nirmala UI');
  const logoMarkup=logo?`<image href="${safe(logo)}" x="68" y="52" width="172" height="92" preserveAspectRatio="xMidYMid meet"/>`:`<text class="brand" x="75" y="112">O-RA</text>`;
  const barcode=exchangeBarcodeSvg(exchange.new_waybill,1010,283,400,74);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1083" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="top" x1="0" x2="1"><stop offset="0" stop-color="#12303a"/><stop offset="1" stop-color="#1c5962"/></linearGradient></defs>
  <style>${fontFaces}
    .latin{font-family:"${latinFont}",Arial,sans-serif}.si{font-family:"${sinhaleseFont}","Noto Sans Sinhala",Arial,sans-serif}
    .brand{font:800 38px "${latinFont}",Arial,sans-serif;fill:#ffffff;letter-spacing:.5px}.muted{font:500 18px "${latinFont}",Arial,sans-serif;fill:#d6e4e5}
    .title{font:800 29px "${latinFont}",Arial,sans-serif;fill:#163640;letter-spacing:.7px}.label{font:700 17px "${latinFont}",Arial,sans-serif;fill:#60757a;letter-spacing:.5px}
    .body{font-family:"${latinFont}",Arial,sans-serif;fill:#183239;font-weight:500}.code{font-weight:700}.center{text-anchor:middle}.id{font:800 34px "${latinFont}",Arial,sans-serif;fill:#163640}
    .date{font:500 15px "${latinFont}",Arial,sans-serif;fill:#53696e}
    .noteSi{font-family:"${sinhaleseFont}","Nirmala UI","Iskoola Pota","Noto Sans Sinhala",Arial,sans-serif;font-size:23px;font-weight:650;fill:#243b40}
    .noteEn{font:600 18px "${latinFont}",Arial,sans-serif;fill:#53696e}.page{font:500 14px "${latinFont}",Arial,sans-serif}
  </style>
  <rect width="1536" height="1083" fill="#f2f6f6"/>
  <rect x="28" y="24" width="1480" height="150" rx="22" fill="url(#top)"/>
  ${logoMarkup}
  <text class="brand" x="270" y="80">${brand}</text>
  <text class="muted" x="272" y="111">${address}</text>
  <text class="muted" x="272" y="141">www.orastore.com.lk  ·  HOTLINE +94 76 772 9424</text>
  <rect x="1088" y="42" width="390" height="114" rx="16" fill="#ffffff"/>
  <text class="label" x="1115" y="72">EXCHANGE ORDER ID</text>
  <text class="id" x="1115" y="116">${safe(exchange.id)}</text>
  <text class="date" x="1117" y="143">${safe(new Date(exchange.created_at).toLocaleDateString('en-GB'))}${totalPages>1?`  ·  ${pageIndex+1}/${totalPages}`:''}</text>

  <rect x="40" y="194" width="880" height="196" rx="18" fill="#ffffff" stroke="#d8e2e3" stroke-width="2"/>
  <text class="title" x="66" y="233">CUSTOMER DETAILS</text>
  <path d="M66 249H894" stroke="#e3ebeb" stroke-width="2"/>
  <text class="label" x="68" y="282">NAME</text><text class="body" x="190" y="282" font-size="23">${safe(exchange.customer_name)}</text>
  <text class="label" x="68" y="321">PHONE</text><text class="body" x="190" y="321" font-size="22">${safe(exchange.phone)}</text>
  <text class="label" x="68" y="360">ADDRESS</text><text class="body" x="190" y="360" font-size="19">${safe([exchange.address,exchange.city,exchange.district].filter(Boolean).join(', '))}</text>

  <rect x="940" y="194" width="556" height="196" rx="18" fill="#ffffff" stroke="#d8e2e3" stroke-width="2"/>
  <text class="title" x="966" y="233">NEW WAYBILL</text>
  <path d="M966 249H1470" stroke="#e3ebeb" stroke-width="2"/>
  ${barcode}
  ${barcode?`<text class="body code center" x="1218" y="378" font-size="29">${safe(exchange.new_waybill)}</text>`:`<text class="body code center" x="1218" y="326" font-size="35">${safe(exchange.new_waybill)}</text>`}

  <rect x="40" y="418" width="1456" height="${headerH}" rx="12" fill="#e5eeee"/>
  <text class="label" x="60" y="451">#</text><text class="label" x="141" y="451">ITEM CODE</text><text class="label" x="346" y="451">ITEM / DESCRIPTION</text>
  <text class="label center" x="1136" y="451">QTY</text><text class="label center" x="1236" y="451">UNIT</text><text class="label center" x="1405" y="451">TOTAL</text>
  <path d="M125 418V${tableBottom}M330 418V${tableBottom}M1020 418V${tableBottom}M1160 418V${tableBottom}M1312 418V${tableBottom}M1496 418V${tableBottom}" stroke="#d4dfdf" stroke-width="1.5"/>
  ${bodyRows}
  <rect x="1045" y="${tableBottom+10}" width="451" height="52" rx="13" fill="#fff3df" stroke="#f3d7a8"/>
  <text class="label" x="1070" y="${tableBottom+43}" fill="#845719">COD DUE</text>
  <text class="body code" x="1468" y="${tableBottom+45}" text-anchor="end" font-size="27" fill="#a35f00">Rs. 0</text>

  <rect x="40" y="${noteY}" width="1456" height="${noteH}" rx="20" fill="#fffaf1" stroke="#e8b963" stroke-width="3"/>
  <rect x="40" y="${noteY}" width="17" height="${noteH}" rx="8" fill="#e5a23c"/>
  <text class="title" x="76" y="${noteY+44}" fill="#875719">EXCHANGE PARCEL - RIDER NOTE</text>
  <text class="noteSi" x="76" y="${noteY+88}">මෙය හුවමාරු පාර්සලයකි. පාරිභෝගිකයා සතු භාණ්ඩය අප වෙත ලබා ගැනීමට කටයුතු කරන්න.</text>
  <text class="noteSi" x="76" y="${noteY+126}">පාරිභෝගිකයාගෙන් භාණ්ඩය ලැබෙන තුරු එහි වගකීම බෙදාහැරීමේ රයිඩර් සතුය.</text>
  <text class="noteEn" x="76" y="${noteY+160}">Please collect the customer's original item. The delivery rider is responsible until it is received.</text>
  <rect x="75" y="${noteY+noteH-49}" width="535" height="36" rx="10" fill="#f4dfbc"/>
  <text class="body code" x="93" y="${noteY+noteH-25}" font-size="19" fill="#734a13">ISSUE? CALL +94 76 772 9424</text>
  ${pageLabel}
  </svg>`;
};

/** Print an exchange document without entering the normal stock/invoice queue. */
export async function generateExchangeInvoicePDF(exchange: ExchangeInvoiceRecord, settings: StoreSettings = {} as StoreSettings) {
  const pages=Array.from({length:Math.max(1,Math.ceil((exchange.items||[]).length/6))},(_,pageIndex)=>({
    pageIndex,items:(exchange.items||[]).slice(pageIndex*6,(pageIndex+1)*6),
  }));
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a5',compress:true});
  for(let index=0;index<pages.length;index++){
    if(index)doc.addPage('a5','landscape');
    const page=pages[index];
    const svg=buildExchangeInvoiceSvg(exchange,settings,page.items,page.pageIndex,pages.length);
    const png=await svgToBrowserPngBytes(svg,1536,1083);
    doc.addImage(png,'PNG',0,0,210,148,undefined,'FAST');
  }
  downloadPdfBlob(doc,`O-RA_Exchange_${exchange.id}_A5.pdf`);
}


export function getInvoicePageCount(order: Order): number {
  return splitInvoiceItems(order).length;
}

// Every physical invoice page occupies a slot, including fifth and later item
// rows. The existing invoice artwork and four-item pagination are reused.
export async function generateA4InvoicePagesPDF(orders: Order[], settings: StoreSettings, fileName: string) {
  if (!orders.length || orders.some(order => !order.invoice_locked || validateInvoiceOrder(order).length)) throw new Error('A valid allocated invoice is required.');
  const doc = new jsPDF({orientation: 'landscape', unit: 'mm', format: 'a4', compress: true});
  let rendered = 0;
  for (const order of orders) {
    const pages = splitInvoiceItems(order);
    for (let index = 0; index < pages.length; index++) {
      if (rendered && rendered % 4 === 0) doc.addPage('a4', 'landscape');
      const slot = rendered % 4, x = slot % 2 * 148.5 + 0.25, y = Math.floor(slot / 2) * 105;
      const svg = await buildInvoiceSvg(order, settings, pages[index], index, pages.length);
      const png = await svgToBrowserPngBytes(svg);
      doc.addImage(png, 'PNG', x, y, 148, 105, undefined, 'FAST');
      rendered++;
    }
  }
  downloadPdfBlob(doc, fileName);
}

export async function generateA4FourUpInvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {
  const singles=orders.filter(o=>getInvoicePageCount(o)===1).slice(0,200);
  if(!singles.length) throw new Error('No single-page A6 invoices are available for A4 4-up printing.');

  const invalid=singles.filter(o=>validateInvoiceOrder(o).length>0);
  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);

  // A4 landscape is 297 x 210 mm. Four A6 landscape invoices fit exactly
  // in a 2 x 2 layout (each A6 slot is 148 x 105 mm, with a tiny centre gap).
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});

  const addCutGuides=()=>{
    // Subtle crop/cut marks for the 2 x 2 A6 layout. Keep the marks only
    // at the outer edges so no guide line crosses invoice content.
    const centreX=148.5;
    const centreY=105;
    const mark=6;
    doc.setDrawColor(120,120,120);
    doc.setLineWidth(0.18);
    // Horizontal cut: left + right edge marks.
    doc.line(0,centreY,mark,centreY);
    doc.line(297-mark,centreY,297,centreY);
    // Vertical cut: top + bottom edge marks.
    doc.line(centreX,0,centreX,mark);
    doc.line(centreX,210-mark,centreX,210);
  };

  for(let i=0;i<singles.length;i++){
    if(i>0 && i%4===0) {
      addCutGuides();
      doc.addPage('a4','landscape');
    }

    const order=singles[i];
    const slot=i%4;
    const col=slot%2;
    const row=Math.floor(slot/2);
    const x=col*148.5+0.25;
    const y=row*105;

    try {
      const svg=await buildInvoiceSvg(order,settings,order.items || [],0,1);
      const pngBytes=await svgToBrowserPngBytes(svg);
      doc.addImage(pngBytes,'PNG',x,y,148,105,undefined,'FAST');
    } catch (e:any) {
      throw new Error(`${order.order_number}: ${e?.message || 'Invoice render failed'}`);
    }
  }

  // Add guides to the last A4 page too (also useful when it has fewer than 4 invoices).
  addCutGuides();

  downloadPdfBlob(doc, fileName || `O-RA_A4_4-Up_Invoices_${singles.length}_${Date.now()}.pdf`);
}

export async function generateBatchInvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {
  const batch=orders.slice(0,50);
  if(!batch.length) throw new Error('No invoices selected.');

  const invalid=batch.filter(o=>validateInvoiceOrder(o).length>0);
  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);

  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a6',compress:true});
  let pdfPageIndex=0;

  for(const order of batch){
    const itemPages=splitInvoiceItems(order);

    for(let orderPageIndex=0;orderPageIndex<itemPages.length;orderPageIndex++){
      if(pdfPageIndex>0) doc.addPage('a6','landscape');

      try {
        await addExactPage(doc,order,settings,itemPages[orderPageIndex],orderPageIndex,itemPages.length);
      } catch (e:any) {
        throw new Error(`${order.order_number}: ${e?.message || 'Invoice render failed'}`);
      }

      pdfPageIndex++;
    }
  }

  downloadPdfBlob(doc, fileName || `O-RA_Batch_Invoices_${batch.length}_${Date.now()}.pdf`);
}


export async function generatePackingTestA6SinglePDF(settings: StoreSettings = {} as StoreSettings) {
  await generateBatchInvoicesPDF([buildPackingTestOrder(settings,1,1)], settings, 'O-RA_TEST_A6_SINGLE.pdf');
}

export async function generatePackingTestA6AndMultiPagePDF(settings: StoreSettings = {} as StoreSettings) {
  // Memory-only test: first order is a single A6 page, second order spans multiple A6 pages.
  // No order, Sheet row, packing history or New/Downloaded flag is touched.
  const rows=[buildPackingTestOrder(settings,1,1),buildPackingTestOrder(settings,9,10)];
  await generateBatchInvoicesPDF(rows, settings, 'O-RA_TEST_PACKING_A6_AND_MULTI_PAGE.pdf');
}

export async function generatePackingTestA4FourUpPDF(settings: StoreSettings = {} as StoreSettings) {
  const rows=[1,2,3,4].map((n)=>buildPackingTestOrder(settings,n,1));
  await generateA4FourUpInvoicesPDF(rows, settings, 'O-RA_TEST_A4_4-UP.pdf');
}

export async function generatePackingTestMultiPagePDF(settings: StoreSettings = {} as StoreSettings) {
  await generateBatchInvoicesPDF([buildPackingTestOrder(settings,9,10)], settings, 'O-RA_TEST_MULTI_PAGE.pdf');
}

// Same invoice artwork as the existing packing downloads, collected into the
// Return batch ZIP so its PDF and courier CSV always contain the same orders.
export async function buildReturnPackingInvoiceBlob(orders: Order[], settings: StoreSettings,maximum=50): Promise<Blob> {
  if (!Number.isSafeInteger(maximum) || maximum<1 || maximum>1000 || !orders.length || orders.length > maximum) throw new Error('Choose 1 to '+maximum+' orders per PDF.');
  if (orders.some(order => validateInvoiceOrder(order).length)) throw new Error('Packing invoice validation failed.');
  const doc = new jsPDF({ orientation: 'landscape',unit: 'mm',format: 'a6',compress: true }); let pages = 0;
  // Resolve missing districts once per order, with four bounded requests at a
  // time. Multiple invoice pages must not repeatedly wait on the same Sheet.
  const prepared:Order[]=[];
  for(let offset=0;offset<orders.length;offset+=4)prepared.push(...await Promise.all(orders.slice(offset,offset+4).map(async order=>{
    const district=await resolveInvoiceDistrict(order,settings);return district?{...order,district}:order;
  })));
  const invoiceSettings={...settings,google_sheet_webhook_url:''};
  for (const order of prepared) {
    const items = splitInvoiceItems(order);
    for (let page = 0; page < items.length; page++) {
      if (pages++) doc.addPage('a6','landscape');
      await addExactPage(doc,order,invoiceSettings,items[page],page,items.length);
    }
  }
  return doc.output('blob');
}
