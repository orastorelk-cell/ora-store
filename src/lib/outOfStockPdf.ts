import { jsPDF } from 'jspdf';
import type { OutOfStockReportItem } from './outOfStockReport';

export interface OutOfStockPhoto {
  dataUrl: string;
  width: number;
  height: number;
}

export interface OutOfStockPdfOptions {
  generatedAt?: Date;
  onProgress?: (done: number, total: number) => void;
}

const clean = (value: unknown) => String(value ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const money = (price: number | null) => price === null ? 'Not recorded' : 'Rs. ' + price.toLocaleString('en-GB', { maximumFractionDigits: 2 });
const fontFamily = 'Arial, "Noto Sans Sinhala", "Nirmala UI", "Iskoola Pota", sans-serif';
const unicode = (value: string) => /[^\x20-\x7e]/.test(value);

/** Public image reads only, with a timeout and a small compressed thumbnail. */
export function loadOutOfStockPhoto(source: string, timeoutMs = 10_000): Promise<OutOfStockPhoto | null> {
  return new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const finish = (photo: OutOfStockPhoto | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (!photo) image.removeAttribute('src');
      resolve(photo);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      try {
        if (!image.naturalWidth || !image.naturalHeight) return finish(null);
        const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return finish(null);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        finish({ dataUrl: canvas.toDataURL('image/jpeg', 0.84), width: canvas.width, height: canvas.height });
      } catch { finish(null); }
    };
    image.onerror = () => finish(null);
    image.src = source;
  });
}

export async function prepareOutOfStockPhotos(
  items: readonly OutOfStockReportItem[],
  onProgress?: OutOfStockPdfOptions['onProgress'],
  loadPhoto = loadOutOfStockPhoto,
) {
  const photos: Array<OutOfStockPhoto | null> = Array(items.length).fill(null);
  const cache = new Map<string, Promise<OutOfStockPhoto | null>>();
  let next = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      for (const source of items[index].imageSources) {
        let pending = cache.get(source);
        if (!pending) {
          pending = Promise.resolve().then(() => loadPhoto(source)).catch(() => null);
          cache.set(source, pending);
        }
        const photo = await pending;
        if (photo) { photos[index] = photo; break; }
      }
      onProgress?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return { photos, missingImages: photos.filter(photo => !photo).length };
}

/** A read-only report; PDF creation does not reserve stock or assign invoices. */
export async function buildOutOfStockPdf(
  items: readonly OutOfStockReportItem[],
  photos: readonly (OutOfStockPhoto | null)[] = [],
  options: OutOfStockPdfOptions = {},
) {
  if (!items.length) throw new Error('There are no waiting items to export.');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const left = 12, width = 186, bottom = 278;
  const generated = (options.generatedAt || new Date()).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour12: false });
  const uniqueOrders = new Set(items.flatMap(item => item.orderIds));
  const totalQty = items.reduce((sum, item) => sum + item.neededQty, 0);
  const missingImages = items.filter((_, index) => !photos[index]).length;
  let y = 0;

  const font = (size: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
  };
  const measureCanvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const measureContext = measureCanvas?.getContext('2d');
  const pixelScale = 3;
  const pixelsPerMm = pixelScale * 72 / 25.4;
  const wrap = (value: string, maxWidth: number, size: number, bold = false): string[] => {
    const text = clean(value);
    font(size, bold);
    if (!unicode(text)) return doc.splitTextToSize(text, maxWidth);
    if (!measureContext) throw new Error('This text requires a browser to render the PDF.');
    measureContext.font = `${bold ? 'bold ' : ''}${size * pixelScale}px ${fontFamily}`;
    const limit = maxWidth * pixelsPerMm;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const combined = line ? line + ' ' + word : word;
      if (measureContext.measureText(combined).width <= limit) { line = combined; continue; }
      if (line) { lines.push(line); line = ''; }
      // Keep Sinhala combining sequences together even for an unusually long word.
      const parts = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word), part => part.segment)
        : Array.from(word);
      for (const part of parts) {
        if (line && measureContext.measureText(line + part).width > limit) { lines.push(line); line = ''; }
        line += part;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };
  const write = (lines: readonly string[], x: number, atY: number, size: number, bold = false, lineHeight = 4) => {
    font(size, bold);
    doc.setTextColor(31, 41, 55);
    if (!lines.some(unicode)) {
      lines.forEach((line, index) => doc.text(line, x, atY + index * lineHeight));
      return;
    }
    // Browser text shaping preserves saved Sinhala/Tamil shop names. Latin text
    // and order IDs stay searchable vector text in the PDF.
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context || !measureContext) throw new Error('Could not render the saved shop name.');
    const canvasFont = `${bold ? 'bold ' : ''}${size * pixelScale}px ${fontFamily}`;
    measureContext.font = canvasFont;
    canvas.width = Math.ceil(Math.max(...lines.map(line => measureContext.measureText(line).width), 1) + 8);
    canvas.height = Math.ceil(size * pixelScale * 1.7 + (lines.length - 1) * lineHeight * pixelsPerMm);
    context.font = canvasFont;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#1f2937';
    context.textBaseline = 'alphabetic';
    const baseline = size * pixelScale * 1.2;
    lines.forEach((line, index) => context.fillText(line, 2, baseline + index * lineHeight * pixelsPerMm));
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, atY - baseline / pixelsPerMm,
      canvas.width / pixelsPerMm, canvas.height / pixelsPerMm);
  };
  const heading = () => {
    doc.setFillColor(17, 24, 39); doc.rect(0, 0, 210, 30, 'F');
    font(16, true); doc.setTextColor(255, 255, 255); doc.text('O-RA STORE | OUT OF STOCK', left, 14);
    font(9); doc.text('Confirmed orders waiting for stock', left, 22);
    write([`${items.length} item codes   |   ${uniqueOrders.size} waiting orders   |   ${totalQty} needed units`], left, 39, 9, true);
    write([`Generated ${generated} (Sri Lanka)`], left, 45, 8);
    doc.setDrawColor(229, 231, 235); doc.line(left, 49, left + width, 49);
    y = 55;
  };
  const nextPage = () => { doc.addPage(); heading(); };
  heading();

  for (let index = 0; index < items.length; index++) {
    const item = items[index], photo = photos[index];
    const nameLines = wrap(item.itemLabel || 'Unnamed item', 96, 10, true);
    const shopLines = wrap('Shop: ' + (item.shopName || 'Not recorded'), 96, 8);
    const codeLines = wrap(item.itemCode, 96, 9, true);
    // Keep photos, counts and the first metadata lines together. Unusually long
    // names/references continue as text without truncating their saved values.
    const metadata = [
      ...codeLines.map(text => ({ text, size: 9, bold: true })),
      ...nameLines.map(text => ({ text, size: 10, bold: true })),
      ...shopLines.map(text => ({ text, size: 8, bold: false })),
      { text: 'Seen price: ' + money(item.seenPrice), size: 8, bold: false },
    ];
    const initialCount = Math.min(metadata.length, 9);
    const bodyHeight = Math.max(38, initialCount * 4.3 + 8);
    if (y + bodyHeight + 13 > bottom) nextPage();
    doc.setDrawColor(229, 231, 235);
    doc.roundedRect(left, y, width, bodyHeight, 2, 2);
    doc.setFillColor(249, 250, 251); doc.roundedRect(16, y + 4, 28, 28, 1, 1, 'F');
    if (photo) {
      const scale = Math.min(26 / photo.width, 26 / photo.height);
      const imageWidth = photo.width * scale, imageHeight = photo.height * scale;
      doc.addImage(photo.dataUrl, 'JPEG', 17 + (26 - imageWidth) / 2, y + 5 + (26 - imageHeight) / 2, imageWidth, imageHeight);
    } else {
      write(['Photo', 'unavailable'], 20, y + 16, 7, false, 3.5);
    }
    write([`Stock: ${item.currentStock}`], 16, y + 36, 7);
    metadata.slice(0, initialCount).forEach((line, lineIndex) => write([line.text], 50, y + 7 + lineIndex * 4.3, line.size, line.bold));
    doc.setFillColor(255, 247, 237); doc.roundedRect(153, y + 4, 41, bodyHeight - 8, 2, 2, 'F');
    font(7); doc.setTextColor(107, 114, 128); doc.text('WAITING ORDERS', 173.5, y + 10, { align: 'center' });
    font(15, true); doc.setTextColor(31, 41, 55); doc.text(String(item.pendingOrders), 173.5, y + 17, { align: 'center' });
    font(7); doc.setTextColor(107, 114, 128); doc.text('NEEDED QTY', 173.5, y + 25, { align: 'center' });
    font(15, true); doc.setTextColor(194, 65, 12); doc.text(String(item.neededQty), 173.5, y + 32, { align: 'center' });
    y += bodyHeight + 5;
    const continuation = () => {
      nextPage();
      const lines = wrap(item.itemCode + ' - continued', width - 8, 9, true);
      write(lines, left + 4, y, 9, true);
      y += lines.length * 4 + 4;
    };
    for (const line of metadata.slice(initialCount)) {
      if (y + 5 > bottom) continuation();
      write([line.text], 50, y, line.size, line.bold); y += 4.3;
    }
    const orderLines = wrap('Order IDs: ' + item.orderIds.map(id => '(' + id + ')').join('  '), width - 8, 8);
    for (const line of orderLines) {
      if (y + 5 > bottom) continuation();
      write([line], left + 4, y, 8); y += 4;
    }
    doc.setDrawColor(229, 231, 235); doc.line(left, y, left + width, y); y += 6;
    if (index % 15 === 14) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); font(7); doc.setTextColor(107, 114, 128);
    doc.text(missingImages ? `${missingImages} item photo(s) unavailable. All item and order details included.` : 'Shop and seen price use the saved product reference.', left, 287);
    doc.text(`Page ${page} of ${pages}`, 198, 287, { align: 'right' });
  }
  doc.setProperties({ title: 'O-RA Out of Stock - Orders Waiting', subject: 'Stock requirements and saved sourcing references', creator: 'O-RA STORE' });
  return doc;
}

export async function downloadOutOfStockPdf(items: readonly OutOfStockReportItem[], options: OutOfStockPdfOptions = {}) {
  const { photos, missingImages } = await prepareOutOfStockPhotos(items, options.onProgress);
  let fontTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (document.fonts?.status === 'loading') {
      await Promise.race([document.fonts.ready, new Promise<void>(resolve => { fontTimer = setTimeout(resolve, 2_000); })]);
    }
  } catch { /* Native font fallback remains available. */ }
  finally { if (fontTimer) clearTimeout(fontTimer); }
  const doc = await buildOutOfStockPdf(items, photos, options);
  const date = options.generatedAt || new Date();
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const url = URL.createObjectURL(doc.output('blob'));
  const link = document.createElement('a');
  link.href = url;
  link.download = `O-RA_Out_Of_Stock_${stamp}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { missingImages, pages: doc.getNumberOfPages() };
}
