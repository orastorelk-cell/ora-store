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

    if (!text.includes("| 'dispatch' | 'delivered_csv_upload' | 'cod_payments'")) {
      text = text.replace("| 'delivery' | 'dispatch' | 'cod_payments'", "| 'delivery' | 'dispatch' | 'delivered_csv_upload' | 'cod_payments'");
    }

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

    // Simple and deterministic delivered importer:
    // DELIVERY STATUS must be Delivered, and matching is ONLY by CSV ORDER ID
    // against the system order_number. Waybill is not used to decide which order changes.
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
          "    const orderIdI=column(['ORDER ID','ORDER NUMBER','ORDER NO']);",
          "    const statusI=column(['DELIVERY STATUS','STATUS']);",
          "    const scanI=column(['LAST SCAN DATE','LAST SCAN','DELIVERED DATE','DELIVERY DATE']);",
          "    const deliveryFeeI=column(['DELIVERY FEE','DELIVERY COST','COURIER FEE']);",
          "    if(orderIdI<0||statusI<0){alert('Invalid delivery report. ORDER ID and DELIVERY STATUS columns are required.');return;}",
          "    const key=(value:unknown)=>String(value||'').trim().toUpperCase();",
          "    const money=(value:unknown)=>{const n=Number(String(value||'').replace(/,/g,'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?Math.max(0,n):undefined;};",
          "    const scanIso=(value:unknown)=>{const rawValue=String(value||'').trim();if(!rawValue)return new Date().toISOString();const parsed=new Date(rawValue.replace(/^\\s+|\\s+$/g,'').replace(' ','T'));return Number.isNaN(parsed.getTime())?new Date().toISOString():parsed.toISOString();};",
          "    const deliveredRows=rows.slice(1).filter((row)=>key(row[statusI])==='DELIVERED');",
          "    if(!deliveredRows.length){alert('This CSV has no DELIVERY STATUS = Delivered rows. Nothing was changed.');return;}",
          '    const uniqueRows=new Map<string,string[]>();',
          '    deliveredRows.forEach((row)=>{const orderId=key(row[orderIdI]);if(orderId&&!uniqueRows.has(orderId))uniqueRows.set(orderId,row);});',
          "    if(!uniqueRows.size){alert('No ORDER ID values were found in Delivered rows. Nothing was changed.');return;}",
          '',
          '    let updated=0,alreadyDelivered=0,notFound=0,failed=0;',
          '    const notFoundIds:string[]=[];const failedIds:string[]=[];',
          "    const token=localStorage.getItem('ora_staff_session_token')||'';",
          '',
          '    for(const [csvOrderId,row] of uniqueRows.entries()){',
          '      const order=orders.find((candidate)=>key(candidate.order_number)===csvOrderId);',
          '      if(!order){notFound+=1;notFoundIds.push(csvOrderId);continue;}',
          "      if(order.order_status==='Delivered'){alreadyDelivered+=1;continue;}",
          '      const at=scanI>=0?scanIso(row[scanI]):new Date().toISOString();',
          '      const actualDeliveryFee=deliveryFeeI>=0?money(row[deliveryFeeI]):undefined;',
          "      const history=Array.isArray(order.fardar_tracking_history)?order.fardar_tracking_history:[];",
          "      const updatedOrder={...order,order_status:'Delivered' as OrderStatus,delivery_status:'Delivered',tracking_status:'Delivered',fardar_tracking_updated_at:at,...(actualDeliveryFee!==undefined?{internal_delivery_fee:actualDeliveryFee}:{}),fardar_tracking_history:[...history,{status:'Delivered',at,note:'Delivered CSV Upload - matched by ORDER ID'}]};",
          '      try{',
          "        const response=await fetch('/api/orders/'+encodeURIComponent(order.id),{method:'PUT',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({order:updatedOrder})});",
          "        const data=await response.json().catch(()=>({}));",
          "        if(!response.ok)throw new Error(data?.error||'Server update failed');",
          "        updateOrderStatus(order.id,'Delivered');",
          '        updated+=1;',
          "      }catch(error:any){failed+=1;failedIds.push(csvOrderId+' ('+String(error?.message||'Update failed')+')');}",
          '    }',
          '',
          "    const details=[notFoundIds.length?'ORDER ID not found: '+notFoundIds.slice(0,12).join(', '):'',failedIds.length?'Failed: '+failedIds.slice(0,8).join(', '):''].filter(Boolean).join('\\n');",
          "    alert('Delivered CSV processed by ORDER ID.\\n\\nDelivered ORDER IDs: '+uniqueRows.size+'\\nUpdated to Delivered: '+updated+'\\nAlready Delivered: '+alreadyDelivered+'\\nORDER ID Not Found: '+notFound+'\\nFailed: '+failed+(details?'\\n\\n'+details:''));",
          '    if(updated>0)window.setTimeout(()=>window.location.reload(),150);',
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

    if (deliveredHandlerReady && !text.includes("{ id:'delivered_csv_upload', label:'Delivered CSV Upload'")) {
      const sidebarMarker = "      { id:'dispatch', label:`Dispatch Scan (${orders.filter((o)=>o.dispatch_status==='Handed Over').length})`, icon:ScanLine },";
      if (text.includes(sidebarMarker)) {
        text = text.replace(
          sidebarMarker,
          sidebarMarker + "\n      { id:'delivered_csv_upload', label:'Delivered CSV Upload', icon:CheckCircle2 },"
        );
      }
    }

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
          '                <p className="mt-1 text-xs leading-5 text-neutral-400">Simple mode: the system reads the CSV ORDER ID column. If DELIVERY STATUS is Delivered and that exact ORDER ID exists in O-RA, that order is changed to Delivered. Waybill matching is not used.</p>',
          '              </div>',
          '            </div>',
          '            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">',
          "              <div className=\"rounded-xl border border-neutral-800 bg-neutral-950 p-3\"><p className=\"text-[10px] font-bold uppercase text-neutral-500\">System Shipped</p><p className=\"mt-1 text-xl font-black text-sky-300\">{orders.filter((o)=>o.order_status==='Shipped').length}</p></div>",
          "              <div className=\"rounded-xl border border-neutral-800 bg-neutral-950 p-3\"><p className=\"text-[10px] font-bold uppercase text-neutral-500\">System Delivered</p><p className=\"mt-1 text-xl font-black text-emerald-300\">{orders.filter((o)=>o.order_status==='Delivered').length}</p></div>",
          '              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"><p className="text-[10px] font-bold uppercase text-neutral-500">Match Key</p><p className="mt-1 text-sm font-black text-white">ORDER ID ONLY</p></div>',
          '            </div>',
          '          </div>',
          '',
          '          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">',
          '            <h3 className="text-sm font-black text-white">Upload Delivered Report</h3>',
          '            <p className="mt-1 text-[11px] leading-5 text-neutral-500">Example: CSV ORDER ID = FB-000089 → system FB-000089 becomes Delivered. The CSV DELIVERY FEE is also saved as actual delivery cost and LAST SCAN DATE is saved as the delivery time.</p>',
          '            <button type="button" onClick={chooseDeliveredCsvStatusUpload} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-neutral-950 hover:bg-emerald-400">',
          '              <Upload className="h-4 w-4"/> Upload Delivered CSV',
          '            </button>',
          '            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] leading-5 text-amber-200">Only CSV rows with DELIVERY STATUS = Delivered are used. Rows whose ORDER ID does not exist in O-RA are skipped and listed in the result message. Waybill number never decides which order is updated.</div>',
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
