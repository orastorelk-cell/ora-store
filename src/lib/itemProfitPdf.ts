import { jsPDF } from 'jspdf';
import type { ProfitByItemCodeRow } from './paidWaybillProfit';
import type { OutOfStockPhoto } from './outOfStockPdf';

export interface ItemProfitPdfEntry extends ProfitByItemCodeRow {
  imageUrl?: string;
}

const clean = (value: unknown) => String(value ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const money = (value: number) => `Rs. ${value.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface PdfPhoto { dataUrl: string; width: number; height: number; }
const loadPdfPhoto = (source: string, timeoutMs = 4000): Promise<PdfPhoto | null> => new Promise(resolve => {
  const image = new Image(); let settled = false;
  const finish = (photo: PdfPhoto | null) => {
    if (settled) return; settled = true; clearTimeout(timer); image.onload = null; image.onerror = null;
    if (!photo) image.removeAttribute('src'); resolve(photo);
  };
  const timer = window.setTimeout(() => finish(null), timeoutMs);
  image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer';
  image.onload = () => {
    try {
      if (!image.naturalWidth || !image.naturalHeight) return finish(null);
      const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) return finish(null);
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      finish({ dataUrl: canvas.toDataURL('image/jpeg', 0.84), width: canvas.width, height: canvas.height });
    } catch { finish(null); }
  };
  image.onerror = () => finish(null); image.src = source;
});

/** A printable item-by-item profit list with catalog thumbnails and full cost details. */
export async function createItemProfitPdf(items: readonly ItemProfitPdfEntry[], dateRange: string, generatedAt = new Date()) {
  if (!items.length) throw new Error('No item profit rows are available to export.');
  const photos: Array<PdfPhoto | null> = Array(items.length).fill(null);
  let next = 0, missingImages = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      photos[index] = items[index].imageUrl ? await loadPdfPhoto(items[index].imageUrl!) : null;
      if (!photos[index]) missingImages++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const left = 12, width = 273, bottom = 193, rowHeight = 38, rowsPerPage = 4;
  const generated = generatedAt.toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour12: false });
  const drawHeader = (continued = false) => {
    doc.setFillColor(17, 24, 39); doc.rect(0, 0, 297, 25, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(`O-RA STORE | ITEM PROFIT LIST${continued ? ' (CONTINUED)' : ''}`, left, 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(clean(dateRange), left, 19);
    doc.setTextColor(31, 41, 55);
  };
  drawHeader();
  items.forEach((item, index) => {
    const position = index % rowsPerPage;
    if (position === 0 && index > 0) { doc.addPage('a4', 'landscape'); drawHeader(true); }
    const y = 30 + position * rowHeight;
    doc.setFillColor(position % 2 === 0 ? 249 : 255, position % 2 === 0 ? 250 : 255, position % 2 === 0 ? 251 : 255);
    doc.roundedRect(left, y, width, rowHeight - 2, 2, 2, 'F');
    doc.setDrawColor(226, 232, 240); doc.roundedRect(left, y, width, rowHeight - 2, 2, 2, 'S');
    const imageX = left + 2, imageY = y + 2, imageSize = 22;
    doc.setFillColor(241, 245, 249); doc.roundedRect(imageX, imageY, imageSize, imageSize, 1, 1, 'F');
    if (photos[index]?.dataUrl) {
      const photo = photos[index]!;
      const scale = Math.min(imageSize / photo.width, imageSize / photo.height);
      const imageWidth = photo.width * scale, imageHeight = photo.height * scale;
      doc.addImage(photo.dataUrl, 'JPEG', imageX + (imageSize - imageWidth) / 2, imageY + (imageSize - imageHeight) / 2, imageWidth, imageHeight, undefined, 'FAST');
    } else {
      doc.setTextColor(148, 163, 184); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text('—', imageX + imageSize / 2, imageY + imageSize / 2 + 1, { align: 'center' });
    }
    doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text(`${index + 1}. ${clean(item.sku)}`, left + 28, y + 6);
    doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    const nameLines = doc.splitTextToSize(clean(item.name), 166).slice(0, 2);
    doc.text(nameLines, left + 28, y + 12);
    doc.setTextColor(item.profit >= 0 ? 6 : 185, item.profit >= 0 ? 95 : 28, item.profit >= 0 ? 70 : 28);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(money(item.profit), left + width - 3, y + 8, { align: 'right' });
    doc.setFontSize(6.5); doc.text('ITEM PROFIT', left + width - 3, y + 3.5, { align: 'right' });

    const details: Array<[string, string]> = [
      ['QTY', String(item.quantity)], ['UNIT BUY', item.deliveredUnits ? money(item.unitBuyingPrice) : '—'],
      ['DELIVERED', String(item.deliveredOrders)], ['RETURNS', String(item.returnOrders)],
      ['DELIVERY %', `${item.deliveryRate.toFixed(1)}%`], ['RETURN %', `${item.returnRate.toFixed(1)}%`],
      ['RECEIVED', money(item.received)], ['PURCHASING', money(item.purchasing)],
      ['DELIVERY FEE', money(item.delivery)], ['RETURN FEE', money(item.returnFee)],
      ['PACKING', money(item.packing)], ['ADS', money(item.advertising)],
    ];
    const gridX = left + 28, gridWidth = width - 31, cellWidth = gridWidth / 6;
    details.forEach(([label, value], detailIndex) => {
      const col = detailIndex % 6, row = Math.floor(detailIndex / 6);
      const x = gridX + col * cellWidth, detailY = y + 22 + row * 7;
      doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.7);
      doc.text(label, x, detailY);
      doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
      doc.text(doc.splitTextToSize(clean(value), cellWidth - 2).slice(0, 1), x, detailY + 3.4);
    });
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setTextColor(107, 114, 128); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(`O-RA STORE | Generated ${generated} (Sri Lanka)`, left, 202);
    doc.text(`Page ${page} of ${pages}`, 285, 202, { align: 'right' });
  }
  return { doc, missingImages };
}
