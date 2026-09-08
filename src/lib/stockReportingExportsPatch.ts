export const stockReportingExportsPatch = () => ({
  name: 'ora-stock-reporting-exports-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    // jsPDF is already a project dependency. Add the named import only when needed.
    if (!text.includes("import { jsPDF } from 'jspdf';")) {
      const marker = "import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';";
      if (text.includes(marker)) text = text.replace(marker, marker + "\nimport { jsPDF } from 'jspdf';");
    }

    // Signed stock report balance. Sellable stock elsewhere remains safely clamped to >= 0.
    if (!text.includes('const stockReportAdjustmentNetForSku=')) {
      const marker = '  const stockItemReportRows = useMemo(() => {';
      if (text.includes(marker)) {
        const helper = [
          "  const stockReportAdjustmentNetForSku=(sku:string)=>{",
          "    const key=String(sku||'').trim().toUpperCase();",
          "    const product=products.find((p)=>String(p.sku||'').trim().toUpperCase()===key||(p.variants||[]).some((v)=>String(v.sku||'').trim().toUpperCase()===key));",
          '    if(!product)return 0;',
          "    const variant=(product.variants||[]).find((v)=>String(v.sku||'').trim().toUpperCase()===key);",
          '    return stockHistory.reduce((sum,log)=>{',
          '      if(String(log.product_id)!==String(product.id))return sum;',
          "      if(log.change_type!=='Increase'&&log.change_type!=='Decrease')return sum;",
          '      if(variant){',
          "        const label=String(log.product_name||'').toLowerCase();",
          "        const option=String(variant.option_value||'').trim().toLowerCase();",
          "        const logId=String(log.id||'');",
          '        if(option&&!label.includes(option)&&!logId.includes(String(variant.id)))return sum;',
          "      }else if(normalizedProductType(product)==='variant')return sum;",
          '      const qty=Math.max(0,Number(log.quantity||0));',
          "      return sum+(log.change_type==='Increase'?qty:-qty);",
          '    },0);',
          '  };',
          '',
          marker,
        ].join('\n');
        text = text.replace(marker, helper);
      }
    }

    if (!text.includes('const reportAvailable=purchases.length')) {
      const from = [
        '      const movement=stockMovementBySku.get(row.sku) || {totalPacked:0,todayPacked:0,todayPurchased:0};',
        '      const currentPhysical=Math.max(0,row.available + row.packing);',
        "      const stockHealth=row.available<=0?'OUT OF STOCK':row.available<=5?'LOW STOCK':'STOCK OK';",
        '      return {',
        '        ...row,',
      ].join('\n');
      const to = [
        '      const movement=stockMovementBySku.get(row.sku) || {totalPacked:0,todayPacked:0,todayPurchased:0};',
        '      const adjustmentNet=stockReportAdjustmentNetForSku(row.sku);',
        '      const reportAvailable=purchases.length ? totalPurchased+adjustmentNet-movement.totalPacked : row.available;',
        '      const currentPhysical=reportAvailable + row.packing;',
        "      const stockHealth=reportAvailable<0?'SHORTAGE':reportAvailable===0?'OUT OF STOCK':reportAvailable<=5?'LOW STOCK':'STOCK OK';",
        '      return {',
        '        ...row,',
        '        available:reportAvailable,',
        '        shortage:Math.max(0,-reportAvailable),',
      ].join('\n');
      if (text.includes(from)) text = text.replace(from, to);
    }

    // Export helpers. Every insertion is optional/non-fatal so another UI patch can
    // never break the production build just because whitespace or layout changed.
    if (!text.includes('const packedProfitRows = useMemo(')) {
      const marker = [
        '  const selectedStockMovementRows = useMemo(',
        '    () => selectedStockDailyReport.filter((row)=>row.purchased>0 || row.packed>0).slice().reverse(),',
        '    [selectedStockDailyReport]',
        '  );',
      ].join('\n');

      if (text.includes(marker)) {
        const block = [
          marker,
          '',
          '  const packedProfitRows = useMemo(() => {',
          "    const grouped=new Map<string,{sku:string;name:string;qty:number;revenue:number;cost:number;profit:number;orders:Set<string>}>();",
          "    orders.filter((order)=>order.stock_allocated&&order.order_status!=='Cancelled'&&!order.is_duplicate_order&&!order.is_test_order).forEach((order)=>{",
          '      (order.items||[]).forEach((item)=>{',
          "        const sku=String(item.sku||item.main_sku||'').trim().toUpperCase();",
          '        if(!sku)return;',
          '        const qty=Math.max(1,Number(item.quantity||1));',
          '        const revenue=Math.max(0,Number(item.unit_price||0))*qty;',
          '        const cost=Math.max(0,Number(item.buying_price||0))*qty;',
          "        const current=grouped.get(sku)||{sku,name:String(item.product_name||sku),qty:0,revenue:0,cost:0,profit:0,orders:new Set<string>()};",
          '        current.qty+=qty;',
          '        current.revenue+=revenue;',
          '        current.cost+=cost;',
          '        current.profit+=revenue-cost;',
          '        current.orders.add(String(order.order_number||order.id));',
          '        grouped.set(sku,current);',
          '      });',
          '    });',
          "    return Array.from(grouped.values()).map((row)=>({...row,orderCount:row.orders.size})).sort((a,b)=>a.sku.localeCompare(b.sku,undefined,{numeric:true,sensitivity:'base'}));",
          '  },[orders]);',
          '',
          '  const downloadStockReportCsv=()=>{',
          "    if(!stockItemReportRows.length){alert('No stock rows to export.');return;}",
          "    const headers=['Item Code','Item Name','Variant / Type','Today Purchase','Today Packed','Total Purchased','Total Packed','Packing Now','Available Balance','Shortage Qty','Physical Now','Stock Status'];",
          '    const rows=stockItemReportRows.map((row)=>[row.sku,row.name,row.variant||row.type,row.todayPurchased,row.todayPacked,row.totalPurchased,row.totalPacked,row.packing,row.available,Math.max(0,Number((row as any).shortage||0)),row.currentPhysical,row.stockHealth]);',
          "    const csv='\\uFEFF'+[headers,...rows].map((row)=>row.map(csvEscape).join(',')).join('\\r\\n');",
          "    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});",
          "    const url=URL.createObjectURL(blob);",
          "    const link=document.createElement('a');",
          '    link.href=url;',
          "    link.download='O-RA_Stock_Report_'+new Date().toISOString().slice(0,10)+'.csv';",
          '    document.body.appendChild(link);',
          '    link.click();',
          '    link.remove();',
          '    URL.revokeObjectURL(url);',
          '  };',
          '',
          '  const downloadPackedProfitPdf=()=>{',
          "    if(!packedProfitRows.length){alert('No packed / allocated item data to export.');return;}",
          "    const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});",
          '    const money=(value:number)=>Math.round(value).toLocaleString();',
          '    const totalQty=packedProfitRows.reduce((sum,row)=>sum+row.qty,0);',
          '    const totalRevenue=packedProfitRows.reduce((sum,row)=>sum+row.revenue,0);',
          '    const totalCost=packedProfitRows.reduce((sum,row)=>sum+row.cost,0);',
          '    const totalProfit=totalRevenue-totalCost;',
          '    let y=16;',
          "    doc.setFont('helvetica','bold');doc.setFontSize(17);doc.text('O-RA STORE - PACKED ITEM EXPENSE & PROFIT REPORT',14,y);",
          "    doc.setFont('helvetica','normal');doc.setFontSize(9);y+=7;doc.text('Grouped by Item Code | Non-cancelled stock-allocated orders.',14,y);",
          "    y+=5;doc.text('Generated: '+new Date().toLocaleString(),14,y);",
          "    y+=8;doc.setFont('helvetica','bold');doc.text('Packed Qty: '+totalQty+'    Sales: Rs. '+money(totalRevenue)+'    Item Cost: Rs. '+money(totalCost)+'    Profit/Loss: Rs. '+money(totalProfit),14,y);",
          '    y+=9;',
          "    const columns=[['Code',14],['Item',36],['Orders',126],['Qty',150],['Sales',169],['Cost',204],['Profit/Loss',237],['Margin',273]] as Array<[string,number]>;",
          "    const drawHeader=()=>{doc.setFont('helvetica','bold');doc.setFontSize(8);columns.forEach(([label,x])=>doc.text(label,x,y));y+=2;doc.line(14,y,287,y);y+=5;};",
          '    drawHeader();',
          '    packedProfitRows.forEach((row)=>{',
          '      if(y>194){doc.addPage();y=16;drawHeader();}',
          '      const margin=row.revenue>0?(row.profit/row.revenue)*100:0;',
          "      const itemName=String(row.name||'').length>42?String(row.name).slice(0,39)+'...':String(row.name||'');",
          "      doc.setFont('helvetica','normal');doc.setFontSize(7.5);",
          "      doc.text(row.sku,14,y);doc.text(itemName,36,y);doc.text(String(row.orderCount),132,y,{align:'right'});doc.text(String(row.qty),158,y,{align:'right'});",
          "      doc.text('Rs. '+money(row.revenue),199,y,{align:'right'});doc.text('Rs. '+money(row.cost),232,y,{align:'right'});doc.text('Rs. '+money(row.profit),270,y,{align:'right'});doc.text(margin.toFixed(1)+'%',287,y,{align:'right'});",
          '      y+=6;',
          '    });',
          "    if(y>185){doc.addPage();y=16;}y+=4;doc.line(14,y,287,y);y+=6;doc.setFont('helvetica','bold');doc.setFontSize(9);",
          "    doc.text('TOTAL',14,y);doc.text(String(totalQty),158,y,{align:'right'});doc.text('Rs. '+money(totalRevenue),199,y,{align:'right'});doc.text('Rs. '+money(totalCost),232,y,{align:'right'});doc.text('Rs. '+money(totalProfit),270,y,{align:'right'});",
          "    doc.save('O-RA_Packed_Expense_Profit_By_Item_'+new Date().toISOString().slice(0,10)+'.pdf');",
          '  };',
        ].join('\n');
        text = text.replace(marker, block);
      }
    }

    // Put the two export buttons inside the stock report card header, not beside
    // the Add Purchase button. This location is plain JSX and cannot be trapped
    // inside another patch's conditional/button expression.
    if (!text.includes('Download Stock CSV')) {
      const marker = [
        '              <p className="mt-2 text-[10px] text-neutral-500">',
        "                Showing {stockItemReportRows.length} of {stockByItemCodeRows.length} item code{stockByItemCodeRows.length===1?'':'s'}",
        '              </p>',
      ].join('\n');
      if (text.includes(marker)) {
        const controls = [
          marker,
          '              <div className="mt-3 flex flex-wrap gap-2">',
          '                <button type="button" onClick={downloadStockReportCsv} className="inline-flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[10px] font-black text-sky-300 hover:bg-sky-500/20">',
          '                  <Download className="h-3.5 w-3.5"/> Download Stock CSV',
          '                </button>',
          '                <button type="button" onClick={downloadPackedProfitPdf} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black text-emerald-300 hover:bg-emerald-500/20">',
          '                  <FileText className="h-3.5 w-3.5"/> Packed Profit PDF',
          '                </button>',
          '              </div>',
        ].join('\n');
        text = text.replace(marker, controls);
      }
    }

    // Negative balance visual cue in the stock table/report.
    if (!text.includes("row.stockHealth==='SHORTAGE'?'bg-red-600 text-white'")) {
      text = text.replace(
        "(row.stockHealth==='OUT OF STOCK'?'bg-red-500/15 text-red-300':row.stockHealth==='LOW STOCK'?'bg-amber-500/15 text-amber-300':'bg-emerald-500/15 text-emerald-300')",
        "(row.stockHealth==='SHORTAGE'?'bg-red-600 text-white':row.stockHealth==='OUT OF STOCK'?'bg-red-500/15 text-red-300':row.stockHealth==='LOW STOCK'?'bg-amber-500/15 text-amber-300':'bg-emerald-500/15 text-emerald-300')"
      );
      text = text.replace(
        "(selectedStockReportRow.stockHealth==='OUT OF STOCK'?'bg-red-500/15 text-red-300':selectedStockReportRow.stockHealth==='LOW STOCK'?'bg-amber-500/15 text-amber-300':'bg-emerald-500/15 text-emerald-300')",
        "(selectedStockReportRow.stockHealth==='SHORTAGE'?'bg-red-600 text-white':selectedStockReportRow.stockHealth==='OUT OF STOCK'?'bg-red-500/15 text-red-300':selectedStockReportRow.stockHealth==='LOW STOCK'?'bg-amber-500/15 text-amber-300':'bg-emerald-500/15 text-emerald-300')"
      );
    }

    return text === code ? null : { code: text, map: null };
  },
});
