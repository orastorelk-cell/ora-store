
import { jsPDF } from 'jspdf';
import { Order, StoreSettings } from '../types';
import { buildExactInvoiceSvg, svgToBrowserPngBytes } from './exactInvoiceTemplate';

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


export function getInvoicePageCount(order: Order): number {
  return splitInvoiceItems(order).length;
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
