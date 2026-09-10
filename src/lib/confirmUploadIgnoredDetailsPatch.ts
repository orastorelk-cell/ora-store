import type { Plugin } from 'vite';

/**
 * Makes Confirm/Cancel CSV "Ignored" results actionable.
 * Every ignored ORDER row gets an explicit Order ID + reason + next action, while
 * metadata/date rows are silently skipped and no longer inflate the ignored count.
 * The unified Confirm Upload result exposes a clickable Ignored counter.
 */
export const confirmUploadIgnoredDetailsPatch = (): Plugin => ({
  name: 'ora-confirm-upload-ignored-details-patch',
  enforce: 'pre',
  transform(code, rawId) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      if (text.includes('CONFIRM UPLOAD IGNORED ORDER DETAILS')) return null;

      const counterMarker = "    const errors:string[]=[]; const orderNumbers:string[]=[]; let notFoundCount=0,ignoredCount=0;";
      if (!text.includes(counterMarker)) {
        throw new Error('[O-RA confirm ignored details] counter marker not found');
      }
      text = text.replace(
        counterMarker,
        counterMarker + "\n    // CONFIRM UPLOAD IGNORED ORDER DETAILS\n    const recordIgnored=(message:string)=>{ignoredCount++;errors.push('[IGNORED] '+message);};"
      );

      const loopStart = "    lines.slice(1).forEach((line,rowNo)=>{";
      const loopEnd = "groups.set(id,[...(groups.get(id)||[]),c]);});";
      const start = text.indexOf(loopStart);
      const end = text.indexOf(loopEnd, start);
      if (start < 0 || end < 0) {
        throw new Error('[O-RA confirm ignored details] CSV row grouping markers not found');
      }
      const rowLoop = String.raw`    lines.slice(1).forEach((line,rowNo)=>{
      const c=parse(line);
      const id=String(c[idI]||'').trim().toUpperCase();
      // DATE / helper / blank rows are not orders, so they must not inflate Ignored.
      if(!id || id.startsWith('DATE:')) return;
      if(wantedPrefix && !id.startsWith(wantedPrefix+'-')){
        recordIgnored('Row '+(rowNo+2)+' • '+id+' • Wrong channel for this upload. FIX: use the ALL CHANNELS Confirm Upload or upload it under '+wantedPrefix+'.');
        return;
      }
      if(!/^(WEB|FB|TK)-\d{6}$/.test(id) && !/^WEB-TEST-\d{3}$/.test(id)){
        recordIgnored('Row '+(rowNo+2)+' • '+id+' • Invalid Order ID format. FIX: use the exact WEB-000000 / FB-000000 / TK-000000 Order ID from the Sheet.');
        return;
      }
      groups.set(id,[...(groups.get(id)||[]),c]);
    });`;
      text = text.slice(0, start) + rowLoop + text.slice(end + loopEnd.length);

      const sourceMismatch = "      if(source && order.order_source!==source){ignoredCount++;return;}";
      if (text.includes(sourceMismatch)) {
        text = text.replace(
          sourceMismatch,
          "      if(source && order.order_source!==source){recordIgnored(id+' • Source mismatch. System source is '+String(order.order_source||'Unknown')+'. FIX: check the Order ID / Source, then upload through ALL CHANNELS.');return;}"
        );
      }

      const pendingIgnored = "      if(!rawCall || ['pending','blank','no answer','noanswer','reschedule','rescheduled'].includes(rawCall)){ignoredCount++;return;}";
      if (!text.includes(pendingIgnored)) {
        throw new Error('[O-RA confirm ignored details] pending ignored marker not found');
      }
      text = text.replace(
        pendingIgnored,
        "      if(!rawCall || ['pending','blank','no answer','noanswer','reschedule','rescheduled'].includes(rawCall)){recordIgnored(id+' • Order Action is '+(rawCall ? rawCall.toUpperCase() : 'BLANK')+'. FIX: set CONFIRM ORDER or CANCEL ENTIRE ORDER in the Sheet, then upload again.');return;}"
      );

      const cancelledIgnored = "      if(order.order_status==='Cancelled'){\n        ignoredCount++;\n        return;\n      }";
      if (!text.includes(cancelledIgnored)) {
        throw new Error('[O-RA confirm ignored details] already-cancelled marker not found');
      }
      text = text.replace(
        cancelledIgnored,
        "      if(order.order_status==='Cancelled'){\n        recordIgnored(id+' • Order is already Cancelled in O-RA. No action is needed.');\n        return;\n      }"
      );

      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      if (text.includes('Ignored Orders • Click to view reasons')) return null;

      const ignoredChip = '<span className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-amber-800">Pending / Ignored {unifiedConfirmBatch.ignored}</span>';
      if (!text.includes(ignoredChip)) {
        throw new Error('[O-RA confirm ignored details] unified ignored chip marker not found');
      }
      const ignoredButton = String.raw`<button
                        type="button"
                        disabled={unifiedConfirmBatch.ignored===0}
                        onClick={()=>{
                          const issues=unifiedConfirmBatch.errors.filter((message)=>message.includes('[IGNORED]'));
                          alert(issues.length ? 'Ignored Orders — Reason + Fix\n\n'+issues.join('\n') : 'No ignored-order details were captured for this upload.');
                        }}
                        title="Ignored Orders • Click to view reasons"
                        className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-amber-800 hover:bg-amber-200 disabled:cursor-default disabled:opacity-60"
                      >Ignored {unifiedConfirmBatch.ignored} • View</button>`;
      text = text.replace(ignoredChip, ignoredButton);

      const oldErrors = `{unifiedConfirmBatch.errors.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">{unifiedConfirmBatch.errors.slice(0,10).map((e,i)=><div key={i}>• {e}</div>)}</div>}`;
      if (!text.includes(oldErrors)) {
        throw new Error('[O-RA confirm ignored details] unified error panel marker not found');
      }
      const detailedPanels = String.raw`{unifiedConfirmBatch.errors.some((message)=>message.includes('[IGNORED]')) && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800">
                    <div className="mb-1 font-black">Ignored order details • reason + what to fix</div>
                    {unifiedConfirmBatch.errors.filter((message)=>message.includes('[IGNORED]')).slice(0,20).map((e,i)=><div key={i}>• {e.replace('[IGNORED] ','')}</div>)}
                  </div>
                )}
                {unifiedConfirmBatch.errors.some((message)=>!message.includes('[IGNORED]')) && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">
                    <div className="mb-1 font-black">Upload errors</div>
                    {unifiedConfirmBatch.errors.filter((message)=>!message.includes('[IGNORED]')).slice(0,10).map((e,i)=><div key={i}>• {e}</div>)}
                  </div>
                )}`;
      text = text.replace(oldErrors, detailedPanels);

      return { code: text, map: null };
    }

    return null;
  },
});
