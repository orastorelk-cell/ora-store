import { jsPDF } from 'jspdf';
import { fardarParcelDescription } from './csv';
import { actualReturnItems, wrongReturnQty, parcelFullyReceived, pendingReturnQty, summarizeReturnSheet, type ReturnSheet } from './returnSheets';

export const downloadReturnBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),30000);
};
export const returnPackingCsv = (orders: any[], settings: any) => {
  const phone = (value: any) => { let digits = String(value || '').replace(/\D/g,''); if (digits.startsWith('0094') && digits.length >= 13) digits = '0' + digits.slice(4); else if (digits.startsWith('94') && digits.length === 11) digits = '0' + digits.slice(2); else if (digits.length === 9 && digits.startsWith('7')) digits = '0' + digits; return digits; };
  const escape = (value: any) => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g,'""') + '"' : text; };
  const header = ['Waybill ID','Order ID','Parcel Type','Parcel Description','Recipient Name','Recipient Mobile','Recipient Mobile','Recipient Address','Recipient City','COD Amount','Exchange (0 or 1)'];
  return '\uFEFF' + [header.join(','),...orders.map(order => {
    const cod = order.payment_paid_type === 'Advance' && Number(order.payment_received_amount || 0) > 0 ? Math.max(0,Math.round(Number(order.total_amount || 0) - Number(order.payment_received_amount || 0))) : order.payment_method === 'COD' ? Math.round(Number(order.total_amount || 0)) : 0;
    return [order.waybill_number,order.order_number,settings.fardar_parcel_type || '',fardarParcelDescription(order.items),order.customer_name,phone(order.phone),phone(order.whatsapp || order.phone),order.address,order.fardar_city || order.city,cod,0].map(escape).join(',');
  })].join('\r\n');
};

export const buildReturnSheetPdf = (sheet: ReturnSheet) => {
  const doc = new jsPDF({ unit: 'mm',format: 'a4',compress: true }), summary = summarizeReturnSheet(sheet);
  const width = 182, x = 14, bottom = 276; let y = 20, section = '';
  const clean = (value: unknown) => String(value ?? '').replace(/[^\x20-\x7e\n]/g,' ').replace(/\s+/g,' ').trim();
  const text = (value: unknown,atX: number,atY: number,size = 9,bold = false) => { doc.setFont('helvetica',bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(35,42,51); doc.text(clean(value),atX,atY); };
  const heading = () => { text('O-RA STORE | RETURN SHEET ' + sheet.id,x,18,15,true); text(sheet.filename + ' | Uploaded ' + sheet.uploaded_at.slice(0,10) + ' by ' + sheet.uploaded_by,x,25,8); text('Updated ' + summary.updated_at.replace('T',' ').slice(0,19) + ' UTC',x,30,8); doc.setDrawColor(210,215,221); doc.line(x,34,x + width,34); y = 42; };
  const columns = [x,x + 42,x + 116,x + 132,x + 148,x + 164];
  const tableHead = () => { doc.setFillColor(237,241,245); doc.rect(x,y - 5,width,9,'F'); ['Order / Waybill','Item / SKU','Expected','Good','Damage','Pending'].forEach((value,i) => text(value,columns[i] + 2,y,8,true)); y += 8; };
  const startSection = (label: string) => { section = label; if (y > bottom - 27) { doc.addPage(); heading(); } text(label,x,y,11,true); y += 10; tableHead(); };
  const nextPage = () => { doc.addPage(); heading(); text(section + ' (continued)',x,y,11,true); y += 10; tableHead(); };
  heading();
  text(summary.all_received ? 'ALL RECEIVED' : 'PENDING RETURNS',x,y,12,true); y += 9;
  text('Parcels: ' + summary.completed_parcels + ' completed / ' + summary.parcels + ' total | Item lines confirmed: ' + summary.confirmed_items + ' / ' + summary.item_lines,x,y,9); y += 7;
  text('Units: ' + summary.expected_qty + ' expected | ' + summary.good_qty + ' good | ' + summary.damaged_qty + ' damaged | ' + summary.pending_qty + ' pending',x,y,9); y += 7;
  if (summary.wrong_item_qty) { text('Packing mistakes: ' + summary.wrong_item_qty + ' units received as different items. Stock credited to actual items.',x,y,8); y += 7; } y += 5;
  for (const [label,parcels] of [
    ['Pending / needs review',sheet.parcels.filter(parcel => !parcelFullyReceived(parcel))],
    ['Completed parcels',sheet.parcels.filter(parcelFullyReceived)],
    ['Damaged items',sheet.parcels.filter(parcel => parcel.items.some(item => item.damaged_qty > 0))],
    ['Different items received',sheet.parcels.filter(parcel => parcel.items.some(wrongReturnQty))],
  ] as const) {
    startSection(label + ' (' + parcels.length + ' parcels)');
    if (!parcels.length) { text('None',x + 2,y,9); y += 12; continue; }
    for (const parcel of parcels) {
      const items = label === 'Damaged items' ? parcel.items.filter(item => item.damaged_qty > 0) : label === 'Different items received' ? parcel.items.filter(wrongReturnQty) : parcel.items;
      const lines = items.length ? items : [null];
      for (const item of lines) {
        doc.setFontSize(8); doc.setFont('helvetica','normal');
        const itemText = item ? clean(item.name + ' | ' + item.sku) + (wrongReturnQty(item) ? ' | Actually received: ' + actualReturnItems(item).map(value => clean(value.name + ' / ' + value.sku) + ' (good ' + value.good_qty + ', damaged ' + value.damaged_qty + ')').join('; ') : '') + (item.damage_photo_ids?.length ? ' | Photos: ' + item.damage_photo_ids.length : '') : clean(parcel.review_reason);
        const wrapped = doc.splitTextToSize(itemText,69) as string[];
        const orderLines = doc.splitTextToSize(clean(parcel.order_number || parcel.csv_order_id || 'Unmatched') + '\n' + parcel.waybill,37) as string[];
        const height = Math.max(12,Math.max(wrapped.length,orderLines.length) * 4 + 5);
        if (y + height > bottom) nextPage();
        if (parcelFullyReceived(parcel)) { doc.setFillColor(244,251,246); doc.rect(x,y - 3,width,height,'F'); }
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(35,42,51); doc.text(orderLines,columns[0] + 2,y + 1); doc.text(wrapped,columns[1] + 2,y + 1);
        [item?.expected_qty ?? '-',item?.good_qty ?? '-',item?.damaged_qty ?? '-',item ? pendingReturnQty(item) : '-'].forEach((value,i) => text(value,columns[i + 2] + 2,y + 1,9));
        y += height; doc.setDrawColor(225,230,235); doc.line(x,y - 4,x + width,y - 4);
      }
      if (parcel.notes || parcel.review_reason || parcel.checked_by) {
        doc.setFontSize(7); const info = doc.splitTextToSize(clean([parcel.review_reason,parcel.notes,parcel.checked_by ? 'Checked: ' + parcel.checked_by + ' / ' + (parcel.checked_at || '').slice(0,19) : ''].filter(Boolean).join(' | ')),177) as string[];
        const height = info.length * 3.5 + 4; if (y + height > bottom) nextPage(); doc.text(info,x + 2,y); y += height;
      }
    }
    y += 7;
  }
  const pages = doc.getNumberOfPages(); for (let page = 1; page <= pages; page++) { doc.setPage(page); text('Sheet ' + sheet.id + ' | Good units enter stock; damaged units remain separate.',x,286,7); text(page + ' / ' + pages,180,286,7); }
  return doc;
};
export const downloadReturnSheetPdf = (sheet: ReturnSheet) => downloadReturnBlob(buildReturnSheetPdf(sheet).output('blob'),'O-RA_Return_Sheet_' + sheet.id + '.pdf');
