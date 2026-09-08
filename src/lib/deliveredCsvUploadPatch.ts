export const deliveredCsvUploadPatch = () => ({
  name: 'ora-delivered-csv-upload-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/types.ts')) {
      if (!text.includes("| 'delivered_csv_upload'")) {
        text = text.replace("  | 'dispatch'\n", "  | 'dispatch'\n  | 'delivered_csv_upload'\n");
      }
      return text === code ? null : { code: text, map: null };
    }

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      if (!text.includes("'dispatch','delivered_csv_upload','cod_payments'")) {
        text = text.replace("'delivery','dispatch','cod_payments'", "'delivery','dispatch','delivered_csv_upload','cod_payments'");
      }
      return text === code ? null : { code: text, map: null };
    }

    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    // Active tab type.
    if (!text.includes("| 'dispatch' | 'delivered_csv_upload' | 'cod_payments'")) {
      text = text.replace("| 'delivery' | 'dispatch' | 'cod_payments'", "| 'delivery' | 'dispatch' | 'delivered_csv_upload' | 'cod_payments'");
    }

    // Staff permission catalog.
    if (!text.includes("'dispatch','delivered_csv_upload','returns'")) {
      text = text.replace(
        "'packing','delivery','dispatch','returns'",
        "'packing','delivery','dispatch','delivered_csv_upload','returns'"
      );
    }
    if (!text.includes("delivered_csv_upload: 'Delivered CSV Upload'")) {
      text = text.replace(
        "dispatch: 'Dispatch Scan', cod_payments:",
        "dispatch: 'Dispatch Scan', delivered_csv_upload: 'Delivered CSV Upload', cod_payments:"
      );
    }

    // Fardar Delivered report CSV importer. It uses the exact report fields:
    // WAYBILL ID, DELIVERY STATUS, LAST SCAN DATE, ORDER ID and DELIVERY FEE.
    // IMPORTANT: the UI is only injected after this handler is confirmed to exist.
    // This prevents a broken sidebar page from crashing the full Admin Dashboard.
    let deliveredHandlerReady = text.includes('const chooseDeliveredCsvStatusUpload=');
    if (!deliveredHandlerReady) {
      const functionMarkers = [
        '  const csvEscape = (value: unknown) => {',
        '  const downloadStockReportCsv=()=>{',
        '  const saveBrandingChanges = () => {',
      ];
      const functionMarker = functionMarkers.find((marker) => text.includes(marker));
      if (functionMarker) {
        const functions = [
          '  const applyDeliveredCsvStatusFile=async(file:File)=>{',
          "    const raw=await file.text();",
          "    const lines=String(raw||'').split(/\\r?\\n/).filter((line)=>line.trim());",
          "    if(lines.length<2){alert('Delivered CSV is empty or has no rows.');return;}",
          '    const parseLine=(line:string)=>{',
          "      const out:string[]=[];let cur='';let quoted=false;",
          '      for(let i=0;i<line.length;i+=1){',
          '        const ch=line[i];',
          "        if(ch==='\\\"'){if(quoted&&line[i+1]==='\\\"'){cur+='\\\"';i+=1;}else quoted=!quoted;}",
          "        else if(ch===','&&!quoted){out.push(cur.trim());cur='';}",
          '        else cur+=ch;',
          '      }',
          '      out.push(cur.trim());',
          "      return out.map((value)=>String(value||'').replace(/^\\uFEFF/,'').trim());",
          '    };',
          '    const rows=lines.map(parseLine);',
          "    const header=rows[0].map((value)=>String(value||'').replace(/^\\uFEFF/,'').trim().toUpperCase().replace(/[_-]+/g,' ').replace(/\\s+/g,' '));",
          "    const column=(names:string[])=>header.findIndex((name)=>names.includes(name));",
          "    const waybillI=column(['WAYBILL ID','WAYBILL','WAYBILL NO','WAYBILL NUMBER','AWB','AWB NO','AWB NUMBER']);",
          "    const statusI=column(['DELIVERY STATUS','STATUS']);",
          "    const scanI=column(['LAST SCAN DATE','LAST SCAN','DELIVERED DATE','DELIVERY DATE']);",
          "    const orderIdI=column(['ORDER ID','ORDER NUMBER']);",
          "    const deliveryFeeI=column(['DELIVERY FEE','DELIVERY COST','COURIER FEE']);",
          "    if(waybillI<0||statusI<0){alert('Invalid Fardar delivery report. WAYBILL ID and DELIVERY STATUS columns are required.');return;}",
          "    const key=(value:unknown)=>String(value||'').trim().toLowerCase();",
          "    const money=(value:unknown)=>{const n=Number(String(value||'').replace(/,/g,'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?Math.max(0,n):undefined;};",
          "    const scanIso=(value:unknown)=>{const rawValue=String(value||'').trim();if(!rawValue)return new Date().toISOString();const parsed=new Date(rawValue.replace(/^\\s+|\\s+$/g,'').replace(' ','T'));return Number.isNaN(parsed.getTime())?new Date().toISOString():parsed.toISOString();};",
          '    const deliveredRows=rows.slice(1).filter((row)=>key(row[statusI])===\'delivered\');',
          "    if(!deliveredRows.length){alert('This CSV has no rows with DELIVERY STATUS = Delivered. Nothing was changed.');return;}",
          '    const uniqueRows=new Map<string,string[]>();',
          '    deliveredRows.forEach((row)=>{const wb=key(row[waybillI]);if(wb&&!uniqueRows.has(wb))uniqueRows.set(wb,row);});',
          '',
          '    let updated=0,alreadyDelivered=0,notFound=0,notShipped=0,orderIdMismatch=0,failed=0;',
          '    const notFoundWaybills:string[]=[];const statusSkipped:string[]=[];const mismatchRows:string[]=[];const failedRows:string[]=[];',
          "    const token=localStorage.getItem('ora_staff_session_token')||'';",
          '',
          '    for(const [wb,row] of uniqueRows.entries()){',
          '      const order=orders.find((candidate)=>key(candidate.waybill_number)===wb);',
          '      if(!order){notFound+=1;notFoundWaybills.push(String(row[waybillI]||wb));continue;}',
          "      const csvOrderId=orderIdI>=0?String(row[orderIdI]||'').trim():'';",
          "      if(/^(FB|TK|WEB|MAN)-/i.test(csvOrderId)&&key(csvOrderId)!==key(order.order_number)){orderIdMismatch+=1;mismatchRows.push(String(row[waybillI]||wb)+' CSV '+csvOrderId+' != System '+order.order_number);continue;}",
          "      if(order.order_status==='Delivered'){alreadyDelivered+=1;continue;}",
          "      if(order.order_status!=='Shipped'){notShipped+=1;statusSkipped.push(String(row[waybillI]||wb)+' ('+order.order_number+' = '+order.order_status+')');continue;}",
          '      const at=scanI>=0?scanIso(row[scanI]):new Date().toISOString();',
          '      const actualDeliveryFee=deliveryFeeI>=0?money(row[deliveryFeeI]):undefined;',
          "      const history=Array.isArray(order.fardar_tracking_history)?order.fardar_tracking_history:[];",
          "      const updatedOrder={...order,order_status:'Delivered' as OrderStatus,delivery_status:'Delivered',tracking_status:'Delivered',fardar_tracking_updated_at:at,...(actualDeliveryFee!==undefined?{internal_delivery_fee:actualDeliveryFee}:{}),fardar_tracking_history:[...history,{status:'Delivered',at,note:'Fardar Delivered CSV Upload'}]};",
          '      try{',
          "        const response=await fetch('/api/orders/'+encodeURIComponent(order.id),{method:'PUT',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({order:updatedOrder})});",
          "        const data=await response.json().catch(()=>({}));",
          "        if(!response.ok)throw new Error(data?.error||'Server update failed');",
          "        updateOrderStatus(order.id,'Delivered');",
          '        updated+=1;',
          '      }catch(error:any){failed+=1;failedRows.push(String(row[waybillI]||wb)+\' (\'+order.order_number+\'): \'+String(error?.message||\'Update failed\'));}',
          '    }',
          '',
          "    const details=[notFoundWaybills.length?'Not found: '+notFoundWaybills.slice(0,8).join(', '):'',statusSkipped.length?'Not Shipped: '+statusSkipped.slice(0,6).join(', '):'',mismatchRows.length?'Order ID mismatch: '+mismatchRows.slice(0,6).join(', '):'',failedRows.length?'Failed: '+failedRows.slice(0,6).join(', '):''].filter(Boolean).join('\\n');",
          "    alert('Delivered CSV processed.\\n\\nDelivered rows: '+uniqueRows.size+'\\nUpdated Shipped → Delivered: '+updated+'\\nAlready Delivered: '+alreadyDelivered+'\\nWaybill Not Found: '+notFound+'\\nSkipped (not Shipped): '+notShipped+'\\nOrder ID mismatch: '+orderIdMismatch+'\\nFailed: '+failed+(details?'\\n\\n'+details:''));",
          '    if(updated>0)window.setTimeout(()=>window.location.reload(),100);',
          '  };',
          '',
          '  const chooseDeliveredCsvStatusUpload=()=>{',
          "    const picker=document.createElement('input');",
          "    picker.type='file';picker.accept='.csv,text/csv';",
          '    picker.onchange=()=>{const file=picker.files?.[0];if(file)void applyDeliveredCsvStatusFile(file);};',
          '    picker.click();',
          '  };',
          '',
        ].join('\n');
        text = text.replace(functionMarker, functions + functionMarker);
        deliveredHandlerReady = text.includes('const chooseDeliveredCsvStatusUpload=');
      }
    }

    // Sidebar entry under ORDERS. Only expose the page if its handler exists.
    if (deliveredHandlerReady && !text.includes("{ id:'delivered_csv_upload', label:'Delivered CSV Upload'")) {
      const sidebarMarker = "      { id:'dispatch', label:`Dispatch Scan (${orders.filter((o)=>o.dispatch_status==='Handed Over').length})`, icon:ScanLine },";
      if (text.includes(sidebarMarker)) {
        text = text.replace(
          sidebarMarker,
          sidebarMarker + "\n      { id:'delivered_csv_upload', label:'Delivered CSV Upload', icon:CheckCircle2 },"
        );
      }
    }

    // Sidebar page UI. Never inject a reference to an undefined click handler.
    if (deliveredHandlerReady && !text.includes("activeTab === 'delivered_csv_upload'")) {
      const panelMarker = "      {activeTab === 'invoices' && (";
      if (text.includes(panelMarker)) {
        const panel = [
          "      {activeTab === 'delivered_csv_upload' && canAccessTab('delivered_csv_upload') && (",
          '        <div className="space-y-5">',
          '          <div className="rounded-2xl border border-emerald-500/25 bg-neutral-900 p-5">',
          '            <div className="flex items-start gap-3">',
          '              <div className="rounded-xl bg-emerald-500/10 p-2.5"><CheckCircle2 className="h-5 w-5 text-emerald-300"/></div>',
          '              <div className="min-w-0">',
          '                <h2 className="text-lg font-black text-white">Delivered CSV Upload</h2>',
          '                <p className="mt-1 text-xs leading-5 text-neutral-400">Upload the Fardar Delivery Report CSV. Only rows where DELIVERY STATUS is Delivered are processed. Orders are matched by WAYBILL ID and only current Shipped orders are changed to Delivered.</p>',
          '              </div>',
          '            </div>',
          '            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">',
          "              <div className=\"rounded-xl border border-neutral-800 bg-neutral-950 p-3\"><p className=\"text-[10px] font-bold uppercase text-neutral-500\">System Shipped</p><p className=\"mt-1 text-xl font-black text-sky-300\">{orders.filter((o)=>o.order_status==='Shipped').length}</p></div>",
          "              <div className=\"rounded-xl border border-neutral-800 bg-neutral-950 p-3\"><p className=\"text-[10px] font-bold uppercase text-neutral-500\">System Delivered</p><p className=\"mt-1 text-xl font-black text-emerald-300\">{orders.filter((o)=>o.order_status==='Delivered').length}</p></div>",
          '              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"><p className="text-[10px] font-bold uppercase text-neutral-500">Match Key</p><p className="mt-1 text-sm font-black text-white">WAYBILL ID</p></div>',
          '            </div>',
          '          </div>',
          '',
          '          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">',
          '            <h3 className="text-sm font-black text-white">Upload Fardar Delivered Report</h3>',
          '            <p className="mt-1 text-[11px] leading-5 text-neutral-500">The importer also saves Fardar DELIVERY FEE as the order’s actual internal delivery cost and saves LAST SCAN DATE as the delivery tracking time. Rows that are not currently Shipped are skipped for safety.</p>',
          '            <button type="button" onClick={chooseDeliveredCsvStatusUpload} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-neutral-950 hover:bg-emerald-400">',
          '              <Upload className="h-4 w-4"/> Upload Delivered CSV',
          '            </button>',
          '            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] leading-5 text-amber-200">Safety: DELIVERY STATUS must be Delivered. If Fardar ORDER ID contains an FB/TK/WEB/MAN order number and it does not match the system order attached to that waybill, that row is blocked instead of changing the wrong order.</div>',
          '          </div>',
          '        </div>',
          '      )}',
          '',
          panelMarker,
        ].join('\n');
        text = text.replace(panelMarker, panel);
      }
    }

    return text === code ? null : { code: text, map: null };
  },
});
