import { jsPDF } from 'jspdf';
import { profitAdvertisingSummary, profitMoney, PROFIT_PACKING_COST, type PaidWaybillProfitReport, type PaymentAmountBasis } from './paidWaybillProfit';
import { facebookAllocatedAdvertisingSummary, type FacebookAdAllocation } from './facebookProfitAds';

export interface ProfitPdfOptions {
  facebook: string;
  tiktok: string;
  sourceName: string;
  paymentBasis: PaymentAmountBasis;
  generatedAt?: Date;
  facebookAllocation?: FacebookAdAllocation;
  advertisingError?: string;
  facebookReportingPeriods?: Array<{ from: string; to: string }>;
}

export function createPaidWaybillProfitPdf(report: PaidWaybillProfitReport, options: ProfitPdfOptions) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const allocation = options.facebookAllocation;
  const computed = allocation ? facebookAllocatedAdvertisingSummary(report, allocation, options.tiktok) : profitAdvertisingSummary(report, options.facebook, options.tiktok);
  const advertising = options.advertisingError ? { ...computed, netProfit: null } : computed;
  const width = 273, left = 12, bottom = 194;
  const text = (value: unknown) => String(value ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const money = (value: number | null) => value === null ? 'Pending' : profitMoney(value);
  const generated = (options.generatedAt || new Date()).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour12: false });
  const title = (subtitle: string) => {
    doc.setFillColor(17, 24, 39); doc.rect(0, 0, 297, 27, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
    doc.text('O-RA STORE | PAID WAYBILL PROFIT REPORT', left, 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(subtitle, left, 21);
    doc.setTextColor(31, 41, 55);
  };
  title('Financial summary');
  doc.setFontSize(9);
  const fileLines = doc.splitTextToSize(`Report source: ${text(options.sourceName || 'Saved COD Received and paid online orders')}`, width);
  doc.text(fileLines, left, 35);
  let y = 35 + fileLines.length * 4 + 2;
  doc.text(`Selected: ${report.rows.length} ${allocation?.waybillScoped ? 'uploaded waybills' : 'paid orders'} | Complete: ${report.totals.ready} | Needs review: ${report.totals.review}`, left, y);
  y += 9;
  const summaryStart = y;
  const rows: Array<[string, number | null]> = [
    ['Recorded gross revenue (including customer delivery)', report.totals.received],
    ['Item sales at saved selling prices', report.totals.sales],
    ['Purchasing cost from Purchase History', -report.totals.purchasing],
    ['Actual Fardar delivery cost', -report.totals.courier],
    [`Packing (${report.totals.ready} orders x Rs. ${PROFIT_PACKING_COST})`, -report.totals.packing],
    ['PROFIT BEFORE ADVERTISING', report.totals.beforeAds],
    [allocation ? 'Facebook (paid orders + ad losses + Commercial)' : 'Facebook advertising cost', advertising.facebook === null && report.ranges.Facebook ? null : -(advertising.facebook ?? 0)],
    ['TikTok advertising cost', advertising.tiktok === null && report.ranges.TikTok ? null : -(advertising.tiktok ?? 0)],
  ];
  rows.forEach(([label, value], index) => {
    doc.setFillColor(index === 5 ? 229 : index % 2 ? 249 : 255, index === 5 ? 231 : index % 2 ? 250 : 255, index === 5 ? 235 : index % 2 ? 251 : 255);
    doc.rect(left, y - 4.5, 159, 8, 'F');
    doc.setFont('helvetica', index === 5 ? 'bold' : 'normal'); doc.setFontSize(8.5);
    doc.text(label, left + 3, y); doc.text(money(value), left + 156, y, { align: 'right' }); y += 8;
  });
  const cardX = 181;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('ADVERTISING DATE RANGES', cardX, summaryStart);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(options.facebookReportingPeriods ? 'Facebook dates: cost CSV reporting period.' : 'Order arrival dates in the system (Sri Lanka).', cardX, summaryStart + 6);
  let rangeY = summaryStart + 16;
  for (const source of ['Facebook', 'TikTok'] as const) {
    const range = report.ranges[source];
    doc.setFont('helvetica', 'bold'); doc.text(source, cardX, rangeY);
    const csvPeriods = source === 'Facebook' ? options.facebookReportingPeriods : undefined;
    const dateText = csvPeriods ? csvPeriods.length ? csvPeriods.length <= 2 ? csvPeriods.map(period => `${period.from} to ${period.to}`).join(' / ')
      : `${csvPeriods[0].from} to ${csvPeriods.at(-1)!.to} (${csvPeriods.length} CSV periods)` : 'No Facebook cost CSV selected'
      : range ? `${range.from} to ${range.to} (${range.count} orders)` : 'No paid orders from this source';
    doc.setFont('helvetica', 'normal'); const lines = doc.splitTextToSize(dateText, 103); doc.text(lines, cardX, rangeY + 5);
    rangeY += Math.max(16, lines.length * 4 + 8);
  }
  doc.text(`COD amount basis: ${options.paymentBasis}`, cardX, rangeY);
  doc.text(`Packing: Rs. ${PROFIT_PACKING_COST} per order`, cardX, rangeY + 6);
  y += 5;
  const complete = advertising.netProfit !== null;
  const positive = complete && advertising.netProfit! >= 0;
  doc.setFillColor(complete ? positive ? 236 : 254 : 255, complete ? positive ? 253 : 242 : 251, complete ? positive ? 245 : 242 : 235);
  doc.roundedRect(left, y - 4, width, 24, 2, 2, 'F');
  doc.setTextColor(complete ? positive ? 6 : 185 : 146, complete ? positive ? 95 : 28 : 64, complete ? positive ? 70 : 28 : 14);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(allocation ? complete ? allocation.waybillScoped ? 'UPLOADED-WAYBILL PROFIT AFTER ADVERTISING' : 'PAID-ORDER PROFIT AFTER ADVERTISING' : 'PROFIT - PENDING REVIEW' : complete ? 'FINAL NET PROFIT' : 'FINAL NET PROFIT - PENDING REVIEW', left + 4, y + 4);
  doc.setFontSize(19); doc.text(money(advertising.netProfit), left + width - 4, y + 6, { align: 'right' });
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(complete ? 'Gross revenue - Purchasing - Fardar - Packing - Facebook - TikTok' : options.advertisingError ? text(options.advertisingError).slice(0, 140) : allocation ? 'Review missing costs, lead matching or delivery confirmation. Pending / unmatched ad spend is shown separately.' : `${report.totals.review} paid order(s) need review. ${advertising.missing.length ? `Enter ${advertising.missing.join(' / ')} cost (0 if none).` : 'Review missing amounts before treating this as a final profit.'}`, left + 4, y + 14);
  doc.setTextColor(55, 65, 81); y += 31;
  const notes = [
    'Summary totals include complete orders only. Every selected paid order is listed in the detail pages.',
    'Purchasing uses FIFO history. Items with incomplete history use their full quantity at the latest matching Purchasing price. Product-form Buy Price is not used.',
    'Sale lines show the saved selling prices. Profit uses recorded gross receipts, so order discounts, customer delivery and bank advances are accounted for.',
    'An identified net Fardar remittance is reconciled to gross receipts before subtracting the courier charge once.',
  ];
  doc.setFontSize(8);
  notes.forEach(note => { const lines = doc.splitTextToSize(note, width); if (y + lines.length * 4 > bottom) { doc.addPage(); title('Report notes'); y = 35; } doc.text(lines, left, y); y += lines.length * 4 + 1; });

  if (allocation) {
    doc.addPage(); title('Facebook cost allocation | Average cost per original form lead'); y = 35;
    const intro = [
      `Selected paid-order cost: ${money(allocation.paidCost)} | Known ad losses: ${money(allocation.lostCost)} | Commercial included: ${money(allocation.commercialCost)}`,
      `Pending lead cost: ${money(allocation.pendingCost)} | Unmatched lead cost: ${money(allocation.unmatchedCost)} | Total recorded spend (all saved reports): ${money(allocation.totalSpend)}`,
      'Original Facebook lead dates link each order to its saved cost period. Older records without a lead date use their system date.',
      'Pending costs remain separate until delivered and paid. Full incurred spend remains recorded; this is a management allocation for paid orders.',
      ...(allocation.waybillScoped ? ['The summary selects uploaded waybills. This table shows all leads in the cost periods; costs for other leads remain separate.'] : []),
    ];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    intro.forEach(note => { const lines = doc.splitTextToSize(note, width); doc.text(lines, left, y); y += lines.length * 4 + 2; }); y += 3;
    const adsWidths = [38, 46, 27, 16, 36, 36, 36, 38];
    const adHeader = () => {
      doc.setFillColor(243, 244, 246); doc.rect(left, y - 4, width, 9, 'F');
      let x = left; doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      ['CODE', 'LEAD PERIOD', 'SPEND', 'LEADS', 'PAID', 'PENDING', 'AD LOSS', 'UNMATCHED'].forEach((label, i) => { doc.text(label, x + 2, y); x += adsWidths[i]; }); y += 9;
    };
    adHeader();
    allocation.cohorts.forEach((row, index) => {
      const values = [row.code, `${row.from} to ${row.to}`, money(row.spend), `${row.leads} / ${row.matched}`,
        `${row.paid} leads / ${money(row.paidCost)}`, `${row.pending} leads / ${money(row.pendingCost)}`,
        `${row.lost} leads / ${money(row.lostCost)}`, `${row.unmatched} leads / ${money(row.unmatchedCost)}`];
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      const cells = values.map((value, i) => doc.splitTextToSize(text(value), adsWidths[i] - 4));
      const height = Math.max(...cells.map(lines => lines.length)) * 4 + 5;
      if (y + height > bottom) { doc.addPage(); title('Facebook cost allocation - continued'); y = 35; adHeader(); }
      if (!(index % 2)) { doc.setFillColor(249, 250, 251); doc.rect(left, y - 3, width, height, 'F'); }
      let x = left; doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(31, 41, 55);
      cells.forEach((lines, i) => { doc.text(lines, x + 2, y); x += adsWidths[i]; }); y += height;
      const warnings = [...row.issues, ...(row.fallbackDates ? [`${row.fallbackDates} lead(s) use system dates.`] : [])];
      for (const note of warnings) for (const line of doc.splitTextToSize(text(note), width - 6)) {
        if (y + 4 > bottom) { doc.addPage(); title('Facebook allocation review'); y = 35; }
        doc.setTextColor(146, 64, 14); doc.text(line, left + 3, y); y += 4;
      }
      doc.setTextColor(31, 41, 55); y += 2;
    });
    for (const warning of [...allocation.issues, ...(allocation.missingOrderIds.length ? [`${allocation.missingOrderIds.length} paid Facebook orders have no completed ad-cost match.`] : [])]) {
      for (const line of doc.splitTextToSize(text(warning), width - 6)) {
        if (y + 4 > bottom) { doc.addPage(); title('Facebook allocation review'); y = 35; }
        doc.setTextColor(146, 64, 14); doc.text(line, left + 3, y); y += 4;
      }
    }
    doc.setTextColor(31, 41, 55);
  }

  const columns = [
    { label: 'WAYBILL / ORDER', width: 30 }, { label: 'SYSTEM DATE', width: 24 }, { label: 'ITEM / QUANTITY', width: 64 },
    { label: 'SALE / RECEIVED', width: 36 }, { label: 'PURCHASING', width: 36 }, { label: 'FARDAR', width: 25 },
    { label: 'PACKING', width: 24 }, { label: 'PROFIT*', width: 34 },
  ];
  const header = () => {
    title(allocation ? 'Order details | Profit before ads, FB cost and After FB. Shared ad losses / Commercial are in the summary.' : 'Order details | * Order profit is before advertising costs. All amounts are LKR.');
    y = 35; doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setFillColor(243, 244, 246); doc.rect(left, y - 4, width, 9, 'F');
    let x = left;
    columns.forEach(column => { doc.text(column.label, x + 2, y + 1); x += column.width; }); y += 9;
  };
  doc.addPage(); header();
  report.rows.forEach((row, rowIndex) => {
    const savedCost = row.orderId ? allocation?.orderCosts.get(row.orderId) : undefined;
    const afterFacebook = savedCost?.state === 'paid' && row.profit !== null ? row.profit - savedCost.cost : null;
    const purchaseLines = row.items.flatMap(item => [money(item.purchasing), ...item.allocations.map(allocation => `${allocation.costBasis === 'latest-purchase' ? 'Latest price / ' : ''}${text(allocation.reference)}: ${allocation.quantity} x ${money(allocation.unitCost)}`)]);
    const saleLines = row.items.map(item => `${item.quantity} x ${money(item.unitSale)} = ${money(item.sales)}`);
    const cellValues = [
      [text(row.waybill || 'Not assigned'), text(row.orderNumber || 'Not found'), text(row.source || ''), row.issues.length ? 'NEEDS REVIEW' : 'COMPLETE'],
      [row.systemDate || '-'],
      row.items.length ? row.items.flatMap(item => [text(item.name), `${text(item.sku)} | Qty ${item.quantity}`]) : ['No matched order'],
      [...saleLines, `Received: ${money(row.received)}`],
      [...purchaseLines, row.items.length > 1 ? `Total: ${money(row.purchasing)}` : ''],
      [money(row.courier)], [money(row.packing)], [money(row.profit), ...(allocation && row.source === 'Facebook'
        ? savedCost?.state === 'paid' ? [`FB ad: ${money(savedCost.cost)}`, `After FB: ${money(afterFacebook)}`] : ['FB ad: Pending match'] : [])],
    ];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    const cells = cellValues.map((values, index) => values.filter(Boolean).flatMap(value => doc.splitTextToSize(value, columns[index].width - 4)));
    const profitLineValues = cellValues[7].filter(Boolean).flatMap((value, index) => doc.splitTextToSize(value, columns[7].width - 4)
      .map(() => index === 0 ? row.profit : value.startsWith('After FB:') ? afterFacebook : null));
    const issues = row.issues.flatMap(issue => doc.splitTextToSize(`Review: ${text(issue)}`, width - 6));
    let offset = 0;
    const length = Math.max(1, ...cells.map(lines => lines.length));
    while (offset < length) {
      const availableLines = Math.floor((bottom - y - 5) / 3.5);
      if (availableLines < 2) { doc.addPage(); header(); continue; }
      const count = Math.min(length - offset, availableLines);
      const height = count * 3.5 + 5;
      if (rowIndex % 2 === 0) { doc.setFillColor(249, 250, 251); doc.rect(left, y - 3, width, height, 'F'); }
      let x = left;
      cells.forEach((lines, index) => {
        const visible = lines.slice(offset, offset + count);
        doc.setTextColor(31, 41, 55);
        doc.setFont('helvetica', index === 0 || index === 7 ? 'bold' : 'normal');
        if (index === 7) visible.forEach((line, lineIndex) => {
          const value = profitLineValues[offset + lineIndex];
          doc.setTextColor(...(value === null ? [31, 41, 55] : value >= 0 ? [6, 95, 70] : [185, 28, 28]) as [number, number, number]);
          doc.text(line, x + columns[index].width - 2, y + lineIndex * 3.5, { align: 'right' });
        });
        else if (visible.length) doc.text(visible, index >= 3 ? x + columns[index].width - 2 : x + 2, y, { align: index >= 3 ? 'right' : 'left', lineHeightFactor: 1.32 });
        x += columns[index].width;
      });
      y += height; offset += count;
      if (offset < length) { doc.addPage(); header(); }
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(146, 64, 14);
    issues.forEach(line => { if (y + 4 > bottom) { doc.addPage(); header(); } doc.text(line, left + 3, y); y += 3.5; });
    doc.setDrawColor(229, 231, 235); doc.line(left, y, left + width, y); y += 5;
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(107, 114, 128);
    doc.text(`O-RA STORE | Generated ${generated} (Sri Lanka)`, left, 203);
    doc.text(`Page ${page} of ${pages}`, 285, 203, { align: 'right' });
  }
  return doc;
}
