import { jsPDF } from 'jspdf';
import { profitAdvertisingSummary, profitMoney, PROFIT_PACKING_COST, type PaidWaybillProfitReport, type PaymentAmountBasis } from './paidWaybillProfit';
import { facebookAllocatedAdvertisingSummary, facebookOrderAdvertisingCost, type FacebookAdAllocation } from './facebookProfitAds';
import { currentCsvProfitSummary, type CurrentFacebookCsv, type CurrentCsvAllocation } from './currentCsvProfit';

export interface ProfitPdfOptions {
  facebook: string;
  tiktok: string;
  sourceName: string;
  paymentBasis: PaymentAmountBasis;
  generatedAt?: Date;
  facebookAllocation?: FacebookAdAllocation;
  advertisingError?: string;
  facebookReportingPeriods?: Array<{ from: string; to: string }>;
  currentFacebookCsv?: CurrentFacebookCsv;
  currentCsvAllocation?: CurrentCsvAllocation;
  itemCodeBreakdown?: Array<{ sku: string; quantity: number; received: number; purchasing: number; delivery: number; returnFee: number; packing: number; advertising: number; profit: number }>;
  includeAccountNet?: boolean;
}

export function createPaidWaybillProfitPdf(report: PaidWaybillProfitReport, options: ProfitPdfOptions) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const allocation = options.facebookAllocation;
  const currentCsv = options.currentFacebookCsv;
  const computed = currentCsv ? currentCsvProfitSummary(report, currentCsv, options.tiktok, options.currentCsvAllocation) : allocation ? facebookAllocatedAdvertisingSummary(report, allocation, options.tiktok) : profitAdvertisingSummary(report, options.facebook, options.tiktok);
  const advertising = options.advertisingError ? { ...computed, netProfit: null, recordedCostProfit: null } : computed;
  const width = 273, left = 12, bottom = 194;
  const text = (value: unknown) => String(value ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const money = (value: number | null) => value === null ? 'Pending' : profitMoney(value);
  const generated = (options.generatedAt || new Date()).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour12: false });
  const title = (subtitle: string) => {
    doc.setFillColor(17, 24, 39); doc.rect(0, 0, 297, 27, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
    doc.text('O-RA STORE | WAYBILL PROFIT REPORT', left, 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(subtitle, left, 21);
    doc.setTextColor(31, 41, 55);
  };
  title('Financial summary');
  doc.setFontSize(9);
  const fileLines = doc.splitTextToSize(`Report source: ${text(options.sourceName || 'Saved COD Received and paid online orders')}`, width);
  doc.text(fileLines, left, 35);
  let y = 35 + fileLines.length * 4 + 2;
  doc.text(`Selected: ${report.rows.length} ${currentCsv || allocation?.waybillScoped ? 'uploaded waybills' : 'paid orders'} | Financial records complete: ${report.totals.ready} | Financial review: ${report.totals.review}${allocation ? ` | FB cost review: ${allocation.missingOrderIds.length}` : ''}`, left, y);
  y += 9;
  const summaryStart = y;
  const rows: Array<[string, number | null]> = [
    ['Recorded gross revenue (including customer delivery)', report.totals.received],
    ['Item sales at saved selling prices', report.totals.sales],
    ['Purchasing cost from Purchase History', -report.totals.purchasing],
    ['Actual Fardar delivery cost', -report.totals.courier],
    ['Actual Fardar Return Fees (deducted once)', -report.totals.returnFees],
    ['Packing cost (Rs.100 per delivered order; waived when returned stock is reused)', -report.totals.packing],
    ['PROFIT BEFORE ADVERTISING', report.totals.beforeAds],
    ...(allocation ? [
      ['Facebook item-ad cost', -allocation.paidCost],
      ['Facebook cost for selected returned waybills', -allocation.returnedCost],
      ['FB loss deducted (cancelled / returned / zero leads)', -allocation.lostCost],
      ['Commercial / promotion share deducted', -allocation.commercialCost],
    ] as Array<[string, number]> : [[currentCsv ? 'Facebook paid / returned lead shares only' : 'Facebook advertising cost', advertising.facebook === null && report.ranges.Facebook ? null : -(advertising.facebook ?? 0)]] as Array<[string, number | null]>),
    ['TikTok advertising cost', advertising.tiktok === null && report.ranges.TikTok ? null : -(advertising.tiktok ?? 0)],
    ...((options.includeAccountNet && currentCsv ? [['NET AFTER FULL META ACCOUNT SPEND', currentCsvProfitSummary(report, currentCsv, options.tiktok, options.currentCsvAllocation).accountNetProfit]] : []) as Array<[string, number | null]>),
  ];
  rows.forEach(([label, value], index) => {
    const total = label === 'PROFIT BEFORE ADVERTISING';
    doc.setFillColor(total ? 229 : index % 2 ? 249 : 255, total ? 231 : index % 2 ? 250 : 255, total ? 235 : index % 2 ? 251 : 255);
    doc.rect(left, y - 4.3, 159, 6.5, 'F');
    doc.setFont('helvetica', total ? 'bold' : 'normal'); doc.setFontSize(8.5);
    doc.text(label, left + 3, y); doc.text(money(value), left + 156, y, { align: 'right' }); y += 6.5;
  });
  const cardX = 181;
  const facebookCostSource = currentCsv?.fileName.startsWith('Facebook API · ') ? 'Meta Ads account reporting period.' : 'Facebook cost report period.';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('ADVERTISING DATE RANGES', cardX, summaryStart);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(options.facebookReportingPeriods ? `Facebook dates: ${facebookCostSource}` : 'Order arrival dates in the system (Sri Lanka).', cardX, summaryStart + 6);
  let rangeY = summaryStart + 16;
  for (const source of ['Facebook', 'TikTok'] as const) {
    const range = report.ranges[source];
    doc.setFont('helvetica', 'bold'); doc.text(source, cardX, rangeY);
    const csvPeriods = source === 'Facebook' ? options.facebookReportingPeriods : undefined;
    const dateText = csvPeriods ? csvPeriods.length ? csvPeriods.length <= 2 ? csvPeriods.map(period => `${period.from} to ${period.to}`).join(' / ')
      : `${csvPeriods[0].from} to ${csvPeriods.at(-1)!.to} (${csvPeriods.length} cost periods)` : 'No Facebook cost source selected'
      : range ? `${range.from} to ${range.to} (${range.count} orders)` : 'No paid orders from this source';
    doc.setFont('helvetica', 'normal'); const lines = doc.splitTextToSize(dateText, 103); doc.text(lines, cardX, rangeY + 5);
    rangeY += Math.max(16, lines.length * 4 + 8);
  }
  doc.text(`COD amount basis: ${options.paymentBasis}`, cardX, rangeY);
  doc.text(`Packing: Rs. ${PROFIT_PACKING_COST} per delivered order; waived if a good returned-stock lot is reused; Rs.0 per return / undelivered order`, cardX, rangeY + 6);
  y += 5;
  const complete = advertising.netProfit !== null;
  const shownProfit = advertising.netProfit ?? advertising.recordedCostProfit;
  const positive = shownProfit !== null && shownProfit >= 0;
  doc.setFillColor(complete ? positive ? 236 : 254 : 255, complete ? positive ? 253 : 242 : 251, complete ? positive ? 245 : 242 : 235);
  doc.roundedRect(left, y - 4, width, 24, 2, 2, 'F');
  doc.setTextColor(complete ? positive ? 6 : 185 : 146, complete ? positive ? 95 : 28 : 64, complete ? positive ? 70 : 28 : 14);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(!complete && shownProfit !== null ? 'PROVISIONAL PROFIT - RECORDED COSTS' : allocation ? complete ? allocation.waybillScoped ? 'UPLOADED-WAYBILL PROFIT AFTER ADVERTISING' : 'PAID-ORDER PROFIT AFTER ADVERTISING' : 'PROFIT - PENDING REVIEW' : complete ? currentCsv ? 'ALLOCATED NET PROFIT - SELECTED WAYBILLS' : 'FINAL NET PROFIT' : 'FINAL NET PROFIT - PENDING REVIEW', left + 4, y + 4);
  doc.setFontSize(19); doc.text(money(shownProfit), left + width - 4, y + 6, { align: 'right' });
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(currentCsv && shownProfit !== null ? complete ? 'Paid / returned lead shares deducted; pending and other lead shares held separately.' : 'Provisional: unresolved FB matches or TikTok cost must be reviewed before final profit.' : complete ? 'Sales: receipts - Purchasing - actual delivery fee - packing - FB. Returns: - Return Fee - FB only. Cancelled orders: no sale/courier/packing; matched FB cost applies.' : options.advertisingError ? text(options.advertisingError).slice(0, 140) : shownProfit !== null ? `Not final: ${allocation?.missingOrderIds.length || 0} FB cost matches need review. Their unresolved costs are not yet deducted.` : allocation ? 'Review missing costs, lead matching or delivery confirmation. Pending / unmatched ad spend is shown separately.' : `${report.totals.review} order(s) need review. ${advertising.missing.length ? `Enter ${advertising.missing.join(' / ')} cost (0 if none).` : 'Review missing amounts before treating this as a final profit.'}`, left + 4, y + 14);
  doc.setTextColor(55, 65, 81); y += 31;
  const notes = [
    'Summary totals include report-ready orders. Latest-price estimates are identified in the order details.',
    'Available FIFO Purchasing costs are kept. Only uncovered quantities use the latest saved item/variant unit price; those portions are estimates and are marked Latest price in the order details.',
    'Sale lines show the saved selling prices. Profit uses recorded gross receipts, so order discounts, customer delivery and bank advances are accounted for.',
    'An identified net Fardar remittance is reconciled to gross receipts before subtracting the courier charge once.',
    currentCsv ? 'Returned waybills deduct their actual Return Fee and their own FB share once. Purchasing and packing are zero. Pending lead costs are not deducted.' : 'Returned waybills deduct the actual Return Fee and their Facebook cost once. Purchasing and packing are zero. Their own FB cost is removed from the shared loss pool.',
  ];
  doc.setFontSize(8);
  notes.forEach(note => { const lines = doc.splitTextToSize(note, width); if (y + lines.length * 4 > bottom) { doc.addPage(); title('Report notes'); y = 35; } doc.text(lines, left, y); y += lines.length * 4 + 1; });

  if (currentCsv) {
    const metaLive = currentCsv.fileName.startsWith('Facebook API · ');
    doc.addPage(); title(metaLive ? 'LIVE META ADS COSTS | Paid / returned shares; pending costs reserved' : 'CURRENT FACEBOOK CSV | Paid / returned shares; pending costs reserved'); y = 35;
    const intro = [
      `${metaLive ? 'Meta source' : 'Current file'}: ${text(currentCsv.fileName)}`,
      `Full Facebook spend: ${money(currentCsv.totalSpend)} | Item ads: ${money(currentCsv.itemSpend)} | Commercial: ${money(currentCsv.commercialSpend)}`,
      'Only the current Facebook cost source is used. Previous reports and browser cost values are never loaded.',
      'Only selected paid / returned lead shares are deducted. Pending leads keep their shares until paid or returned.',
      `Order shares: ${money(options.currentCsvAllocation?.assignedSpend || 0)} | All other spend held separately: ${money(options.currentCsvAllocation?.unassignedSpend || 0)}`,
      `Pending: ${money(options.currentCsvAllocation?.pendingSpend || 0)} | Other orders: ${money(options.currentCsvAllocation?.otherSpend || 0)} | Unmatched: ${money(options.currentCsvAllocation?.unmatchedSpend || 0)}`,
      options.currentCsvAllocation?.missingOrderIds.length ? `${options.currentCsvAllocation.missingOrderIds.length} selected Facebook orders have unresolved cost matches. Their costs are NOT assumed to be zero; profit is provisional.` : 'All selected Facebook waybills matched. Pending cost remains separate.',
      'Acquisition cost is an average across ALL unique leads in each original lead-date / ad-ID or form-code cohort. Commercial uses the same lead pool.',
    ];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    intro.forEach(note => { const lines = doc.splitTextToSize(note, width); doc.text(lines, left, y); y += lines.length * 4 + 2; }); y += 4;
    const csvHeader = () => {
      doc.setFillColor(243, 244, 246); doc.rect(left, y - 4, width, 8, 'F'); doc.setFont('helvetica', 'bold');
      doc.text('CODE / AD', left + 2, y); doc.text('COST PERIOD', left + 123, y); doc.text('LEADS', left + 216, y, { align: 'right' }); doc.text('SPEND', left + width - 2, y, { align: 'right' }); y += 9;
    };
    csvHeader();
    currentCsv.rows.forEach((row, index) => {
      const lines = doc.splitTextToSize(`${row.code || 'Commercial'} | ${text(row.campaign)} / ${text(row.adSet)}`, 117);
      const height = Math.max(9, lines.length * 4 + 3);
      if (y + height > bottom) { doc.addPage(); title('Current Facebook costs | continued'); y = 35; csvHeader(); }
      if (index % 2 === 0) { doc.setFillColor(249, 250, 251); doc.rect(left, y - 3, width, height, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.text(lines, left + 2, y); doc.text(`${row.from} to ${row.to}`, left + 123, y); doc.text(String(row.leads), left + 216, y, { align: 'right' }); doc.text(money(row.spend), left + width - 2, y, { align: 'right' }); y += height;
    });
  }

  if (allocation) {
    doc.addPage(); title('Facebook cost allocation | Average cost per original form lead'); y = 35;
    const intro = [
      `Selected sale ads: ${money(allocation.paidCost)} | Selected return ads: ${money(allocation.returnedCost)} | Other loss share: ${money(allocation.lostCost)} | Promotion: ${money(allocation.commercialCost)}`,
      `Pending lead cost: ${money(allocation.pendingCost)} | Unmatched lead cost: ${money(allocation.unmatchedCost)} | ${allocation.waybillScoped ? 'Selected CSV spend' : 'Total saved spend'}: ${money(allocation.totalSpend)}`,
      allocation.waybillScoped ? `${allocation.outsidePeriodOrderIds.size} selected waybills have lead dates outside the selected CSV periods. They receive Rs.0 FB cost in this report; historical cost is not added.` : 'Original Facebook lead dates link each order to its saved cost period. Older records without a lead date use their system date.',
      'Pending costs remain separate until delivered and paid. Full incurred spend remains recorded; this is a management allocation for paid orders.',
      'Code-free promotion share = period spend / allocation leads x selected sales and returns. Messages and views are not form leads.',
      ...(allocation.waybillScoped ? [`Known FB loss: ${money(allocation.lossSpend)} | Loss deducted: ${money(allocation.lostCost)} | Other / pending loss share: ${money(allocation.lossRemainingCost)}`,
        'Known loss share = period cancelled / returned / zero-lead spend / remaining form leads x selected paid orders.'] : []),
      ...(allocation.waybillScoped ? ['Selected returns pay their own ad cost once; this cost is excluded from the shared loss pool. Other leads remain separate.'] : []),
    ];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    intro.forEach(note => { const lines = doc.splitTextToSize(note, width); doc.text(lines, left, y); y += lines.length * 4 + 2; }); y += 3;
    if (allocation.commercialCohorts.length) {
      const widths = [46, 44, 28, 32, 58, 65];
      const promotionHeader = () => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('COMMERCIAL / CODE-FREE PROMOTION ALLOCATION', left, y); y += 8;
        doc.setFillColor(239, 246, 255); doc.rect(left, y - 4, width, 9, 'F');
        let x = left; doc.setFontSize(7.5);
        ['CSV PERIOD', 'RECORDED SPEND', 'LEADS USED', 'SALE / RETURN', 'SHARE INCLUDED', 'OTHER / PENDING SHARE'].forEach((label, i) => { doc.text(label, x + 2, y); x += widths[i]; }); y += 9;
      };
      if (y + 30 > bottom) { doc.addPage(); title('Commercial / promotion allocation'); y = 35; }
      promotionHeader();
      allocation.commercialCohorts.forEach(row => {
        const values = [`${row.from} to ${row.to}`, money(row.spend), String(row.leads), `${row.selectedPaid} / ${row.selectedReturned}`, money(row.selectedCost), money(row.remainingCost)];
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        const cells = values.map((value, i) => doc.splitTextToSize(value, widths[i] - 4));
        const height = Math.max(...cells.map(lines => lines.length)) * 4 + 5;
        if (y + height > bottom) { doc.addPage(); title('Commercial / promotion allocation - continued'); y = 35; promotionHeader(); }
        let x = left; doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        cells.forEach((lines, i) => { doc.text(lines, x + 2, y); x += widths[i]; }); y += height;
      });
      y += 8;
    }
    const adsWidths = [38, 46, 27, 16, 36, 36, 36, 38];
    const adHeader = () => {
      doc.setFillColor(243, 244, 246); doc.rect(left, y - 4, width, 9, 'F');
      let x = left; doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      ['CODE', 'LEAD PERIOD', 'SPEND', 'LEADS', 'PAID', 'PENDING', 'AD LOSS', 'UNMATCHED'].forEach((label, i) => { doc.text(label, x + 2, y); x += adsWidths[i]; }); y += 9;
    };
    if (y + 25 > bottom) { doc.addPage(); title('Facebook item-ad cost allocation'); y = 35; }
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
      const warnings = [...row.issues, ...row.warnings, ...(row.fallbackDates ? [`${row.fallbackDates} lead(s) use system dates.`] : [])];
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

  if (options.itemCodeBreakdown?.length) {
    doc.addPage();
    title('Profit by item code | order-level costs allocated by item sales value');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Received, delivery, packing and advertising are allocated across item codes by saved item sales value. TikTok invoice cost is divided evenly by included TikTok order, then by item sales value.', left, 35);
    const itemColumns = [
      { label: 'ITEM CODE', width: 34 }, { label: 'QTY', width: 19 }, { label: 'RECEIVED', width: 34 },
      { label: 'PURCHASING', width: 34 }, { label: 'DELIVERY', width: 31 }, { label: 'RETURN FEE', width: 29 },
      { label: 'PACKING', width: 26 }, { label: 'ADS', width: 27 }, { label: 'NET PROFIT', width: 39 },
    ];
    const itemHeader = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setFillColor(243, 244, 246); doc.rect(left, 43, width, 9, 'F');
      let x = left; itemColumns.forEach(column => { doc.text(column.label, x + 2, 49); x += column.width; });
    };
    itemHeader(); let itemY = 57;
    options.itemCodeBreakdown.forEach((item, index) => {
      if (itemY > bottom - 5) { doc.addPage(); title('Profit by item code | continued'); itemHeader(); itemY = 57; }
      const vals = [item.sku, String(item.quantity), money(item.received), money(item.purchasing), money(item.delivery), money(item.returnFee), money(item.packing), money(item.advertising), money(item.profit)];
      let x = left; const rowHeight = 7;
      if (index % 2 === 0) { doc.setFillColor(249, 250, 251); doc.rect(left, itemY - 4, width, rowHeight, 'F'); }
      vals.forEach((value, columnIndex) => {
        const column = itemColumns[columnIndex]; doc.setFont('helvetica', columnIndex === 0 || columnIndex === vals.length - 1 ? 'bold' : 'normal');
        doc.setFontSize(7); const textColor: [number, number, number] = columnIndex === vals.length - 1 ? (item.profit >= 0 ? [6, 95, 70] : [185, 28, 28]) : [31, 41, 55]; doc.setTextColor(...textColor);
        doc.text(doc.splitTextToSize(text(value), column.width - 4).slice(0, 1), columnIndex < 2 ? x + 2 : x + column.width - 2, itemY, { align: columnIndex < 2 ? 'left' : 'right' }); x += column.width;
      });
      itemY += rowHeight;
    });
    doc.setTextColor(31, 41, 55);
  }

  const columns = [
    { label: 'WAYBILL / ORDER', width: 30 }, { label: 'SYSTEM DATE', width: 24 }, { label: 'ITEM / QUANTITY', width: 64 },
    { label: 'SALE / RECEIVED', width: 36 }, { label: 'PURCHASING', width: 36 }, { label: 'FARDAR', width: 25 },
    { label: 'PACKING', width: 24 }, { label: 'PROFIT*', width: 34 },
  ];
  const header = () => {
    title(currentCsv ? 'Order details | Current final Fardar order FB shares only. Processing shares are excluded.' : allocation ? allocation.waybillScoped ? 'Order details | After FB deducts item ads, FB loss share and Commercial share.' : 'Order details | After FB deducts item ads and Commercial; ad losses are in the summary.' : 'Order details | * Order profit is before advertising costs. All amounts are LKR.');
    y = 35; doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setFillColor(243, 244, 246); doc.rect(left, y - 4, width, 9, 'F');
    let x = left;
    columns.forEach(column => { doc.text(column.label, x + 2, y + 1); x += column.width; }); y += 9;
  };
  doc.addPage(); header();
  report.rows.forEach((row, rowIndex) => {
    const savedCost = row.orderId ? allocation?.orderCosts.get(row.orderId) : undefined;
    const currentCost = row.orderId ? options.currentCsvAllocation?.orderCosts.get(row.orderId) : undefined;
    const fullFacebookCost = currentCsv ? row.source === 'Facebook' ? currentCost?.total ?? null : 0 : allocation ? facebookOrderAdvertisingCost(allocation, row.orderId) : null;
    const afterFacebook = fullFacebookCost !== null && row.profit !== null ? Math.round((row.profit - fullFacebookCost) * 100) / 100 : null;
    const purchaseLines = row.outcome === 'returned' ? ['Rs.0 - returned items'] : row.outcome === 'cancelled' ? ['Rs.0 - cancelled order'] : row.items.flatMap(item => [money(item.purchasing), ...item.allocations.map(allocation => `${allocation.returnedStock ? 'Returned stock / ' : ''}${allocation.costBasis === 'latest-purchase' ? 'Latest price / ' : ''}${text(allocation.reference)}: ${allocation.quantity} x ${money(allocation.unitCost)}`)]);
    const saleLines = row.outcome === 'returned' ? ['Returned parcel - no sale'] : row.outcome === 'cancelled' ? ['Cancelled order - no sale'] : row.items.map(item => `${item.quantity} x ${money(item.unitSale)} = ${money(item.sales)}`);
    const cellValues = [
      [text(row.waybill || 'Not assigned'), text(row.orderNumber || 'Not found'), text(row.source || ''), ...(row.outcome === 'returned' ? ['RETURN COMPLETE'] : row.outcome === 'cancelled' ? ['CANCELLED - AD COST ONLY'] : row.reusedReturnPackaging ? ['RETURN PACKAGING REUSED - NO RS.100 CHARGE'] : []), row.issues.length ? 'NEEDS REVIEW' : row.estimatedPurchasing ? 'PURCHASING ESTIMATE' : 'COMPLETE'],
      [row.systemDate || '-'],
      row.items.length ? row.items.flatMap(item => [text(item.name), `${text(item.sku)} | Qty ${item.quantity}`]) : ['No matched order'],
      [...saleLines, `Received: ${money(row.received)}`],
      [...purchaseLines, row.items.length > 1 ? `Total: ${money(row.purchasing)}` : ''],
      row.outcome === 'returned' ? [`Return Fee: ${money(row.returnFee ?? null)}`] : [money(row.courier)], [money(row.packing)], [money(row.profit), ...(currentCsv && row.source === 'Facebook' ? [`FB item: ${money(currentCost?.item ?? null)}`, `Commercial: ${money(currentCost?.commercial ?? null)}`, `After FB: ${money(afterFacebook)}`] : allocation && row.source === 'Facebook'
        ? fullFacebookCost !== null && savedCost ? [`FB item: ${money(savedCost.cost)}`, ...(row.outcome !== 'returned' ? [`FB loss: ${money(savedCost.lossCost)}`] : []), `Commercial: ${money(savedCost.promotionCost)}`, `After FB: ${money(afterFacebook)}`] : ['FB ad: Pending match'] : [])],
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
