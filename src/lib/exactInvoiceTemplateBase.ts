
import { Order, StoreSettings } from '../types';
import { formatLkr } from './currency';

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const money = (v: number) => formatLkr(Math.max(0, Number(v || 0)));

const code39: Record<string,string> = {
  '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011',
  '5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101',
  'A':'110101001011','B':'101101001011','C':'110110100101','D':'101011001011','E':'110101100101',
  'F':'101101100101','G':'101010011011','H':'110101001101','I':'101101001101','J':'101011001101',
  'K':'110101010011','L':'101101010011','M':'110110101001','N':'101011010011','O':'110101101001',
  'P':'101101101001','Q':'101010110011','R':'110101011001','S':'101101011001','T':'101011011001',
  'U':'110010101011','V':'100110101011','W':'110011010101','X':'100101101011','Y':'110010110101',
  'Z':'100110110101','-':'100101011011','.':'110010101101',' ':'100110101101','$':'100100100101',
  '/':'100100101001','+':'100101001001','%':'101001001001','*':'100101101101',
};

function barcodeSvg(value:string, x:number, y:number, width:number, height:number) {
  const clean = String(value || '').toUpperCase();
  if (!clean || [...clean].some(c=>!code39[c])) return '';
  const bits = `*${clean}*`.split('').map(c=>code39[c]+'0').join('');
  const module = width / bits.length;
  let out = '';
  bits.split('').forEach((b,i)=>{
    if (b==='1') out += `<rect x="${x+i*module}" y="${y}" width="${Math.max(module,0.8)}" height="${height}" fill="#000"/>`;
  });
  return out;
}

function phoneIconSvg(x:number,y:number,s=22) {
  return `<g transform="translate(${x} ${y}) scale(${s/24})" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z"/>
  </g>`;
}

function locationIconSvg(x:number,y:number,s=22) {
  return `<g transform="translate(${x} ${y}) scale(${s/24})" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </g>`;
}

function whatsappIconSvg(x:number,y:number,s=22) {
  return `<g transform="translate(${x} ${y}) scale(${s/24})" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.2A8.5 8.5 0 1 1 21 11.5z"/>
    <path d="M8.7 8.3c.4 2.1 2.8 4.5 4.9 4.9"/>
    <path d="M8.7 8.3l1.4-.7 1.1 2-1.1.8"/>
    <path d="M13.6 13.2l.8-1.1 2 1.1-.7 1.4"/>
  </g>`;
}

function facebookIconSvg(x:number,y:number,s=22) {
  return `<g transform="translate(${x} ${y}) scale(${s/24})" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M13.5 8H15V5.5h-1.8C10.8 5.5 10 7 10 9v2H8v2.5h2V19h3v-5.5h2.2L15.6 11H13V9.3c0-.8.2-1.3.5-1.3z"/>
  </g>`;
}

function webIconSvg(x:number,y:number,s=22) {
  return `<g transform="translate(${x} ${y}) scale(${s/24})" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </g>`;
}



export function buildExactInvoiceSvg(
  order: Order,
  settings: StoreSettings,
  sample = false,
  pageItems?: Order['items'],
  pageIndex = 0,
  totalPages = 1
) {
  const brand = settings.brand_store_name || 'O-RA';
  const logo = settings.invoice_logo || '';
  const logoScale = Number(settings.invoice_logo_scale || 1);
  const logoX = Number(settings.invoice_logo_x || 0);
  const logoY = Number(settings.invoice_logo_y || 0);
  const logoW = Number(settings.invoice_logo_width || 54) * 7.25 * logoScale;
  const logoH = Number(settings.invoice_logo_height || 25) * 7.25 * logoScale;

  const hotline = settings.hotline_number || settings.top_banner_phone || '';
  const whatsapp = settings.whatsapp_number || '';
  const email = settings.company_email || '';
  const website = settings.invoice_website_url || 'orastore.com.lk';
  const facebook = (settings as any).facebook_page_url || 'facebook.com/orastore';
  const iconCfg = (key:string, fallbackSize:number) => ({
    size: Number((settings as any)[`invoice_icon_${key}_size`] || fallbackSize),
    x: Number((settings as any)[`invoice_icon_${key}_x`] || 0),
    y: Number((settings as any)[`invoice_icon_${key}_y`] || 0),
    image: String((settings as any)[`invoice_icon_${key}_image`] || ''),
  });
  const callIcon = iconCfg('call',22);
  const locationIcon = iconCfg('location',22);
  const whatsappIcon = iconCfg('whatsapp',25);
  const facebookIcon = iconCfg('facebook',24);
  const webIcon = iconCfg('web',22);
  const renderIcon = (kind:'call'|'location'|'whatsapp'|'facebook'|'web', x:number, y:number, fallbackSize:number) => {
    const cfg = kind==='call'?callIcon:kind==='location'?locationIcon:kind==='whatsapp'?whatsappIcon:kind==='facebook'?facebookIcon:webIcon;
    const xx=x+cfg.x, yy=y+cfg.y, s=cfg.size || fallbackSize;
    if(cfg.image) return `<image data-icon-id="${kind}" x="${xx}" y="${yy}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet" href="${esc(cfg.image)}"/>`;
    const svg = kind==='call'?phoneIconSvg(xx,yy,s):kind==='location'?locationIconSvg(xx,yy,s):kind==='whatsapp'?whatsappIconSvg(xx,yy,s):kind==='facebook'?facebookIconSvg(xx,yy,s):webIconSvg(xx,yy,s);
    return svg.replace('<g ', `<g data-icon-id="${kind}" `);
  };

  const companyAddress = settings.company_address || settings.invoice_company_address || 'Company address';

  const customFonts = (() => {
    try { return JSON.parse(settings.invoice_custom_fonts_json || '[]') as Array<{name:string;data:string;format?:string}>; }
    catch { return []; }
  })();
  const fontFaceCss = customFonts.map((f, i) =>
    `@font-face{font-family:"${esc(f.name)}";src:url("${f.data}") format("${f.format || 'truetype'}");font-display:block;}`
  ).join('');

  const ff = (group:string, fallback='Arial') => esc(String((settings as any)[`invoice_font_${group}_family`] || fallback));
  const fs = (group:string, fallback:number) => Number((settings as any)[`invoice_font_${group}_size`] || fallback);
  const fw = (group:string, fallback:number) => Number((settings as any)[`invoice_font_${group}_weight`] || fallback);
  const ls = (group:string) => Number((settings as any)[`invoice_font_${group}_spacing`] || 0);

  const displayItems = (pageItems || order.items || []).slice(0,4);
  const rows = [...displayItems];
  while (rows.length < 4) rows.push({
    product_id:'', product_name:'', sku:'', buying_price:0, unit_price:0, quantity:0, subtotal:0
  } as any);

  const deliveryFree = order.delivery_included_in_item_price || Number(order.delivery_fee || 0) <= 0;
  const supplierOfferDiscount = Math.max(0, (order.items || []).reduce((sum, item) => {
    const perUnit = Math.max(0, Number(item.supplier_offer_discount_per_unit || 0));
    return sum + perUnit * Math.max(0, Number(item.quantity || 0));
  }, 0));
  // `special_offer_discount` is the existing quantity/multi-buy offer snapshot.
  // Keep it separate from the saved supplier-price offer so the invoice stays clear.
  const qtyOfferDiscount = Math.max(0, Number(order.special_offer_discount || 0));
  const normalSubtotal = Math.max(0, Number(order.subtotal || 0) + supplierOfferDiscount);
  const wrappingCost = order.gift_wrap_selected ? Math.max(0, Number(order.gift_wrap_fee || 0)) : 0;
  const paid = order.payment_status === 'Paid' ? order.total_amount : 0;
  const balance = Math.max(0, order.total_amount-paid);
  const dynamicAdvancePct = Math.min(100, Math.max(1, Number(settings.advance_percentage ?? 50)));
  const detectedPaid = Number(order.payment_received_amount || order.payment_detected_amount || 0);
  const dynamicPaymentLabel = order.payment_method === 'COD'
    ? 'COD'
    : order.payment_paid_type === 'Full' || (detectedPaid > 0 && detectedPaid >= Number(order.total_amount || 0) * 0.98)
      ? 'FULLY PAID'
      : order.payment_paid_type === 'Advance' || (order.is_advance_required && order.advance_confirmed)
        ? `${dynamicAdvancePct}% ADVANCE PAID`
        : order.payment_status === 'Paid'
          ? 'FULLY PAID'
          : 'BANK PAYMENT';
  // Backward compatibility is intentional: already-locked legacy invoices that
  // predate the snapshot field keep their old payment_method text forever.
  const paymentLabel = order.invoice_payment_label_snapshot
    || (order.invoice_locked ? String(order.payment_method) : dynamicPaymentLabel);
  const wb = String(order.waybill_number || '');

  const customerLines = String(order.address || '').match(/.{1,36}(?:\s|$)/g) || [''];
  const address1 = customerLines[0]?.trim() || '';
  const address2 = customerLines.slice(1).join(' ').trim();

  const rowY = [569, 607, 645, 683];

  // Combo codes are longer than normal SKUs. Keep them inside the ITEM CODE
  // column by wrapping at the last hyphen; normal/variant SKU rendering is unchanged.
  const renderInvoiceItemCode = (skuValue: unknown, y: number) => {
    const sku = String(skuValue || '').trim();
    if (!sku) return `<text class="t table" x="155" y="${y}"></text>`;
    if (!/^CB-/i.test(sku) || sku.length <= 11) {
      return `<text class="t table" x="155" y="${y}">${esc(sku)}</text>`;
    }
    const splitAt = sku.lastIndexOf('-');
    const first = splitAt > 2 ? `${sku.slice(0, splitAt + 1)}` : sku.slice(0, 9);
    const second = splitAt > 2 ? sku.slice(splitAt + 1) : sku.slice(9);
    return `<text class="t table" x="145" y="${y-8}" font-size="18" font-weight="600"><tspan x="145" dy="0">${esc(first)}</tspan><tspan x="145" dy="20">${esc(second)}</tspan></text>`;
  };

  const itemRows = rows;
  const itemStartY = 475;
  const itemRowH = 54;

  // Always render exactly FOUR physical item rows.
  // Keeps all Invoice Design text IDs stable for 1/2/3/4 items.
  const visibleRows = 4;
  const itemTableBottom = itemStartY + 48 + visibleRows * itemRowH;
  const policyY = itemTableBottom + 18;

  const isFinalPage = pageIndex >= totalPages - 1;
  const invoiceTotalLines = [
    { label:'Sub Total', value:money(normalSubtotal) },
    ...(supplierOfferDiscount > 0 ? [{ label:'Special Offer', value:`- ${money(supplierOfferDiscount)}` }] : []),
    ...(qtyOfferDiscount > 0 ? [{ label:'Qty Offer', value:`- ${money(qtyOfferDiscount)}` }] : []),
    ...(wrappingCost > 0 ? [{ label:'Wrapping Cost', value:money(wrappingCost) }] : []),
    { label:'Delivery', value:deliveryFree ? 'FREE' : money(order.delivery_fee) },
  ];
  const invoiceTotalLineGap = invoiceTotalLines.length >= 5 ? 28 : 34;
  const invoiceTotalLinesSvg = invoiceTotalLines.map((line,index) => {
    const y = policyY + 30 + index * invoiceTotalLineGap;
    return `<text class="t label" x="1005" y="${y}">${esc(line.label)}</text><text class="t table" x="1475" y="${y}" text-anchor="end">${esc(line.value)}</text>`;
  }).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1090" width="1536" height="1090"${sample ? ' style="width:100%;height:auto;display:block"' : ''}>
<rect width="1536" height="1090" fill="#fff"/>
<style>
${fontFaceCss}
.t{fill:#111;font-family:Arial,Helvetica,sans-serif}
.company{font-family:"${ff('company')}";font-size:${fs('company',34)}px;font-weight:${fw('company',800)};letter-spacing:${ls('company')}px}
.heading{font-family:"${ff('heading')}";font-size:${fs('heading',29)}px;font-weight:${fw('heading',800)};letter-spacing:${ls('heading')}px}
.label{font-family:"${ff('labels')}";font-size:${fs('labels',25)}px;font-weight:${fw('labels',700)};letter-spacing:${ls('labels')}px}
.value{font-family:"${ff('values')}";font-size:${fs('values',25)}px;font-weight:${fw('values',500)};letter-spacing:${ls('values')}px}
.table{font-family:"${ff('table')}";font-size:${fs('table',24)}px;font-weight:${fw('table',600)};letter-spacing:${ls('table')}px}
.totals{font-family:"${ff('totals')}";font-size:${fs('totals',27)}px;font-weight:${fw('totals',800)};letter-spacing:${ls('totals')}px}
.notice{font-family:"${ff('notice')}";font-size:${fs('notice',21)}px;font-weight:${fw('notice',600)};letter-spacing:${ls('notice')}px}
.footer{font-family:"${ff('footer')}";font-size:${fs('footer',19)}px;font-weight:${fw('footer',500)};letter-spacing:${ls('footer')}px}
.si{font-family:"Nirmala UI","Iskoola Pota","Noto Sans Sinhala",sans-serif}
.siNotice{font-size:24px;font-weight:600}
.line{stroke:#111;stroke-width:1.5}.soft{stroke:#aaa;stroke-width:1}
</style>

<!-- Readability-first header: low ink -->
<rect x="28" y="24" width="1480" height="170" rx="15" fill="#fff" stroke="#111" stroke-width="1.5"/>
${logo ? `<image x="${65+logoX}" y="${45+logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" href="${esc(logo)}"/>`
: `<text class="t company" x="65" y="95">${esc(brand)} STORE</text>`}
<text class="t company" x="430" y="62">${esc(brand)} STORE</text>
${renderIcon('location',430,78,22)}<text class="t value" x="462" y="99">${esc(companyAddress)}</text>
${renderIcon('call',430,116,22)}<text class="t label" x="462" y="137">Hotline</text><text class="t value" x="565" y="137">${esc(hotline)}</text>
${renderIcon('web',430,151,20)}<text class="t footer" x="462" y="171">${esc(website)}</text>

<rect x="1190" y="40" width="292" height="137" rx="12" fill="#fff" stroke="#111" stroke-width="1.5"/>
<text class="t heading" x="1212" y="74">INVOICE</text>
<text class="t label" x="1212" y="108">No.</text><text class="t value" x="1270" y="108">${esc(order.invoice_number || order.order_number)}</text>
<text class="t label" x="1212" y="140">Date</text><text class="t value" x="1270" y="140">${esc(new Date(order.created_at).toLocaleDateString())}</text>
<text class="t label" x="1212" y="170">${esc(paymentLabel)}</text>

<!-- Large customer block -->
<rect x="28" y="211" width="955" height="244" rx="14" fill="#fff" stroke="#111" stroke-width="1.5"/>
<text class="t heading" x="55" y="250">CUSTOMER &amp; DELIVERY DETAILS</text>
<line x1="55" y1="265" x2="955" y2="265" class="soft"/>
<text class="t label" x="55" y="307">Name</text><text class="t label" x="166" y="307">-</text><text class="t value" x="205" y="307">${esc(order.customer_name)}</text>
<text class="t label" x="55" y="350">Phone</text><text class="t label" x="166" y="350">-</text><text class="t value" x="205" y="350">${esc(order.phone)}</text>
<text class="t label" x="55" y="393">Address</text><text class="t label" x="166" y="393">-</text><text class="t value" x="205" y="393">${esc(address1)}</text>
<text class="t value" x="205" y="431">${esc(address2)}</text>
<text class="t label" x="650" y="307">City</text><text class="t label" x="722" y="307">-</text><text class="t value" x="755" y="307">${esc(order.fardar_city || order.city)}</text>

<!-- Waybill: no redundant courier name -->
<rect x="1003" y="211" width="505" height="244" rx="14" fill="#fff" stroke="#111" stroke-width="1.5"/>
<text class="t heading" x="1030" y="250">WAYBILL</text>
<line x1="1030" y1="265" x2="1480" y2="265" class="soft"/>
${wb && wb !== 'PENDING' && wb !== '-' ? `${barcodeSvg(wb,1045,292,420,92)}
<text class="t heading" x="1255" y="420" text-anchor="middle">${esc(wb)}</text>` :
`<text class="t label" x="1255" y="350" text-anchor="middle">WAYBILL PENDING</text>
<text class="t footer" x="1255" y="386" text-anchor="middle">Barcode appears after a real waybill is assigned.</text>`}

<!-- Large item rows -->
<rect x="28" y="${itemStartY}" width="1480" height="${itemTableBottom-itemStartY}" rx="12" fill="#fff" stroke="#111" stroke-width="1.5"/>
<rect x="28" y="${itemStartY}" width="1480" height="48" rx="12" fill="#f0f0f0"/>
${[130,305,955,1060,1245].map(x=>`<line x1="${x}" y1="${itemStartY}" x2="${x}" y2="${itemTableBottom}" class="soft"/>`).join('')}
<text class="t table" x="65" y="${itemStartY+32}">#</text>
<text class="t table" x="155" y="${itemStartY+32}">ITEM CODE</text>
<text class="t table" x="335" y="${itemStartY+32}">ITEM / DESCRIPTION</text>
<text class="t table" x="980" y="${itemStartY+32}">QTY</text>
<text class="t table" x="1090" y="${itemStartY+32}">UNIT PRICE</text>
<text class="t table" x="1280" y="${itemStartY+32}">TOTAL</text>
${Array.from({length:visibleRows}).map((_,i)=>{
 const item:any=itemRows[i]; const y=itemStartY+48+(i+1)*itemRowH; const ty=y-18;
 return `${i<visibleRows-1?`<line x1="28" y1="${y}" x2="1508" y2="${y}" class="soft"/>`:''}
 <text class="t table" x="65" y="${ty}">${item?pageIndex*4+i+1:''}</text>
 ${item?renderInvoiceItemCode(item.sku,ty):''}
 <text class="t table" x="335" y="${ty}">${item?esc(`${item.product_name}${item.variant_name?` - ${item.variant_name}`:''}`):''}</text>
 <text class="t table" x="990" y="${ty}">${item?item.quantity:''}</text>
 <text class="t table" x="1090" y="${ty}">${item?money(item.unit_price):''}</text>
 <text class="t table" x="1280" y="${ty}">${item?money(item.subtotal):''}</text>`;
}).join('')}

<!-- Short, readable bilingual policy -->
<rect x="28" y="${policyY}" width="930" height="220" rx="14" fill="#fff" stroke="#111" stroke-width="1.5"/>
<text class="t heading" x="55" y="${policyY+35}">IMPORTANT NOTICE / වැදගත්</text>
<text class="si notice siNotice" x="55" y="${policyY+72}">මුදල් ගෙවීමට පෙර පාර්සලය විවෘත නොකරන්න.</text>
<text class="si notice siNotice" x="55" y="${policyY+108}">විවෘත කළ පාර්සල් නැවත භාරගනු නොලැබේ.</text>
<text class="si notice siNotice" x="55" y="${policyY+144}">ගැටලුවක් හෝ පැමිණිල්ලක් සඳහා Complaint WhatsApp අංකයට දැනුම් දෙන්න.</text>
<text class="t notice" x="55" y="${policyY+178}">Do not open the parcel before payment. Opened parcels cannot be returned.</text>
<text class="t notice" x="55" y="${policyY+205}">For complaints, contact our Complaint WhatsApp.</text>

<!-- Readable totals -->
<rect x="978" y="${policyY}" width="530" height="220" rx="14" fill="#fff" stroke="#111" stroke-width="1.5"/>
${isFinalPage ? `
${invoiceTotalLinesSvg}
<line x1="995" y1="${policyY+153}" x2="1482" y2="${policyY+153}" class="line"/>
<text class="t value" x="1005" y="${policyY+191}" style="font-weight:400">TOTAL LKR</text>
<text class="t table" x="1475" y="${policyY+191}" text-anchor="end">${money(order.total_amount)}</text>
` : `
<text class="t heading" data-system-continuation="1" x="1005" y="${policyY+58}">PAGE</text><text class="t heading" data-system-continuation="1" x="1475" y="${policyY+58}" text-anchor="end">${pageIndex+1} / ${totalPages}</text>
<text class="t label" data-system-continuation="1" x="1005" y="${policyY+108}">CONTINUED</text><text class="t table" data-system-continuation="1" x="1475" y="${policyY+108}" text-anchor="end">→</text>
<text class="t label" data-system-continuation="1" x="1005" y="${policyY+142}"></text><text class="t table" data-system-continuation="1" x="1475" y="${policyY+142}" text-anchor="end"></text>
<line x1="995" y1="${policyY+156}" x2="1482" y2="${policyY+156}" class="line"/>
<text class="t footer" data-system-continuation="1" x="1005" y="${policyY+192}">Full Order Total</text>
<text class="t footer" data-system-continuation="1" x="1475" y="${policyY+192}" text-anchor="end">Final Page</text>
`}

<!-- FIXED BOTTOM CONTACT BAND -->
<rect x="28" y="997" width="1480" height="72" rx="10" fill="#fff" stroke="#111" stroke-width="1.2"/>

<text class="t heading" x="55" y="1025" style="font-family:&quot;Segoe Script&quot;,&quot;Brush Script MT&quot;,cursive;font-size:30px;font-weight:700">Thank You For</text>
<text class="t heading" x="55" y="1056" style="font-family:&quot;Segoe Script&quot;,&quot;Brush Script MT&quot;,cursive;font-size:30px;font-weight:700">Your Order!</text>

${renderIcon('whatsapp',410,1010,25)}
<text class="t value" x="448" y="1028" style="font-weight:400">Complaint / Support</text>
<text class="t value" x="448" y="1057" style="font-weight:400">${esc(whatsapp)}</text>

${renderIcon('facebook',825,1011,24)}
<text class="t footer" x="862" y="1038">${esc(facebook)}</text>

<text class="t footer" x="1482" y="1049" text-anchor="end">Generated by O-RA Store System</text>
</svg>`;
  const textContent = (() => {
    try { return JSON.parse((settings as any).invoice_text_content_json || '{}') as Record<string,string>; }
    catch { return {}; }
  })();

  const textStyles = (() => {
    try { return JSON.parse(settings.invoice_text_styles_json || '{}') as Record<string, {family?:string;size?:number;weight?:number;spacing?:number}>; }
    catch { return {}; }
  })();

  let textIndex = 0;
  return svg.replace(/<text([^>]*)>([\s\S]*?)<\/text>/g, (full, attrs, content) => {
    const id = `invoice-text-${textIndex++}`;
    const classMatch = String(attrs).match(/class="([^"]*)"/);
    const cls = classMatch ? classMatch[1] : '';
    let group = 'values';
    if (cls.includes('company')) group='company';
    else if (cls.includes('heading')) group='heading';
    else if (cls.includes('label')) group='labels';
    else if (cls.includes('table')) group='table';
    else if (cls.includes('totals')) group='totals';
    else if (cls.includes('notice')) group='notice';
    else if (cls.includes('footer')) group='footer';

    const override = textStyles[id] || {};
    const styleParts:string[] = [];
    if (override.family) styleParts.push(`font-family:'${esc(override.family)}'`);
    if (Number.isFinite(Number(override.size))) styleParts.push(`font-size:${Number(override.size)}px`);
    if (Number.isFinite(Number(override.weight))) styleParts.push(`font-weight:${Number(override.weight)}`);
    if (Number.isFinite(Number(override.spacing))) styleParts.push(`letter-spacing:${Number(override.spacing)}px`);

    const existingStyle = String(attrs).match(/style="([^"]*)"/)?.[1] || '';
    let cleanAttrs = String(attrs).replace(/\sstyle="[^"]*"/, '');

    // Explicit SVG presentation attributes make selected-text edits reliable,
    // including TOTAL LKR / amount and text that already has a class/default style.
    if (override.family) {
      cleanAttrs = cleanAttrs.replace(/\sfont-family="[^"]*"/g,'');
      cleanAttrs += ` font-family="${esc(override.family)}"`;
    }
    if (Number.isFinite(Number(override.size))) {
      cleanAttrs = cleanAttrs.replace(/\sfont-size="[^"]*"/g,'');
      cleanAttrs += ` font-size="${Number(override.size)}"`;
    }
    if (Number.isFinite(Number(override.weight))) {
      cleanAttrs = cleanAttrs.replace(/\sfont-weight="[^"]*"/g,'');
      cleanAttrs += ` font-weight="${Number(override.weight)}"`;
    }
    if (Number.isFinite(Number(override.spacing))) {
      cleanAttrs = cleanAttrs.replace(/\sletter-spacing="[^"]*"/g,'');
      cleanAttrs += ` letter-spacing="${Number(override.spacing)}"`;
    }
    const forcedStyleParts:string[] = [];
    if (override.family) forcedStyleParts.push(`font-family:'${esc(override.family)}' !important`);
    if (Number.isFinite(Number(override.size))) forcedStyleParts.push(`font-size:${Number(override.size)}px !important`);
    if (Number.isFinite(Number(override.weight))) forcedStyleParts.push(`font-weight:${Number(override.weight)} !important`);
    if (Number.isFinite(Number(override.spacing))) forcedStyleParts.push(`letter-spacing:${Number(override.spacing)}px !important`);
    const combinedStyle = [existingStyle, ...styleParts, ...forcedStyleParts].filter(Boolean).join(';');

    const isSystemContinuation = String(attrs).includes('data-system-continuation="1"');
    const overrideContent = !isSystemContinuation && Object.prototype.hasOwnProperty.call(textContent, id)
      ? String(textContent[id] ?? '')
      : null;
    let renderedContent = content;
    if (overrideContent !== null) {
      const x = String(cleanAttrs).match(/\sx="([^"]+)"/)?.[1] || '0';
      const lines = overrideContent.split(/\r?\n/);
      renderedContent = lines.map((line, i) =>
        `<tspan x="${x}" dy="${i === 0 ? '0' : '1.18em'}">${esc(line)}</tspan>`
      ).join('');
    }

    return `<text${cleanAttrs} data-text-id="${id}" data-font-group="${group}"${combinedStyle ? ` style="${combinedStyle}"` : ''}>${renderedContent}</text>`;
  });
}

export async function svgToBrowserPngBytes(
  svg: string,
  width = 1536,
  height = 1090
): Promise<Uint8Array> {
  try {
    // Validate the final SVG after all Invoice Design text/font overrides.
    const parsed=new DOMParser().parseFromString(svg,'image/svg+xml');
    const parserError=parsed.querySelector('parsererror');
    if(parserError){
      throw new Error(`Invoice SVG invalid: ${parserError.textContent?.replace(/\s+/g,' ').trim() || 'XML parse error'}`);
    }

    // Use the same browser font environment as the working Invoice Design Preview.
    try { await (document as any).fonts?.ready; } catch {}

    // Chromium/Chrome renders the SVG itself; no Canvg text/font interpretation.
    const sourceBlob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});
    const sourceUrl=URL.createObjectURL(sourceBlob);
    const image=new Image();
    image.width=width;
    image.height=height;
    image.decoding='sync';

    try {
      await new Promise<void>((resolve,reject)=>{
        image.onload=()=>resolve();
        image.onerror=()=>reject(new Error('Browser could not render the invoice SVG.'));
        image.src=sourceUrl;
      });

      const canvas=document.createElement('canvas');
      canvas.width=width;
      canvas.height=height;

      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx) throw new Error('Invoice canvas unavailable.');

      ctx.fillStyle='#ffffff';
      ctx.fillRect(0,0,width,height);
      ctx.drawImage(image,0,0,width,height);

      // Reject an empty page before making the PDF.
      const pixels=ctx.getImageData(0,0,width,height).data;
      let darkSamples=0;
      for(let i=0;i<pixels.length;i+=4*48){
        const r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=pixels[i+3];
        if(a>0 && (r<235 || g<235 || b<235)){
          darkSamples++;
          if(darkSamples>=20) break;
        }
      }
      if(darkSamples<20) throw new Error('Browser invoice render is blank.');

      const pngBlob=await new Promise<Blob>((resolve,reject)=>{
        canvas.toBlob((value)=>{
          if(value) resolve(value);
          else reject(new Error('Browser could not encode invoice PNG.'));
        },'image/png');
      });

      const bytes=new Uint8Array(await pngBlob.arrayBuffer());
      const signature=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
      if(!signature.every((v,i)=>bytes[i]===v)){
        throw new Error('Browser produced an invalid PNG.');
      }

      return bytes;
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  } catch(err:any) {
    console.error('Browser-native invoice render failed:',err);
    throw new Error(`Invoice render failed: ${err?.message || 'unknown render error'}`);
  }
}
