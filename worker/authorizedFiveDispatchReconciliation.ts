import { readDataTable, replaceDataTable, mutateDataTable } from './cloudflareData';
import { AUTHORIZED_DISPATCH_WAYBILLS, reconcileAuthorizedDispatch } from '../src/lib/authorizedDispatchReconciliation';

export const AUTHORIZED_DISPATCH_RECONCILIATION_KEY='maintenance:five-delivered-dispatch-20261026-v2';

// Read existing completed operation receipts and current order snapshots.
// Running again is safe: there is no R2 order write for already reconciled rows.
export const runAuthorizedFiveDispatchReconciliation=async(env:unknown)=>{
  const adminRows=await readDataTable(env,'admin_data_store');
  const now=new Date().toISOString();
  const result=await replaceDataTable(env,'order_snapshots',rows=>{
    const outcome=reconcileAuthorizedDispatch(rows,now,adminRows);
    return {rows:outcome.rows as typeof rows,result:{
      reconciled:outcome.reconciled,already_saved:outcome.already_saved,skipped:outcome.skipped,
    }};
  });
  if(result.reconciled.length)
    console.info('Authorized delivered dispatch reconciled: '+result.reconciled.join(', '));
  if(result.skipped.length)
    console.warn('Authorized delivered dispatch blocked: '+result.skipped.map(item=>item.order_number+': '+item.reason).join(' | '));
  if(result.reconciled.length+result.already_saved.length===AUTHORIZED_DISPATCH_WAYBILLS.length){
    await mutateDataTable(env,'admin_data_store',rows=>{
      const existing=rows.find(row=>row.key===AUTHORIZED_DISPATCH_RECONCILIATION_KEY);
      if(existing?.payload?.phase==='complete')return;
      rows.push({key:AUTHORIZED_DISPATCH_RECONCILIATION_KEY,payload:{
        phase:'complete',completed_at:now,order_waybills:AUTHORIZED_DISPATCH_WAYBILLS,
        evidence:'Saved Delivered order status or matching delivered courier invoice and payment',
      },updated_at:now});
    });
  }
  return result;
};
