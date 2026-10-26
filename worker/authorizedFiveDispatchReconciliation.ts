import { readDataTable, replaceDataTable, mutateDataTable } from './cloudflareData';
import { AUTHORIZED_DISPATCH_WAYBILLS, reconcileAuthorizedDispatch } from '../src/lib/authorizedDispatchReconciliation';

export const AUTHORIZED_DISPATCH_RECONCILIATION_KEY='maintenance:five-delivered-dispatch-20261026-v1';

// One-time cron repair, not a public endpoint. Source checks are repeated inside
// the R2 compare-and-swap operation so concurrent courier/stock edits are safe.
export const runAuthorizedFiveDispatchReconciliation=async(env:unknown)=>{
  const receipt=(await readDataTable(env,'admin_data_store')).find(row=>row.key===AUTHORIZED_DISPATCH_RECONCILIATION_KEY);
  if(receipt?.payload?.phase==='complete')return {already_complete:true,reconciled:[],skipped:[]};
  const now=new Date().toISOString();
  const result=await replaceDataTable(env,'order_snapshots',rows=>{
    const outcome=reconcileAuthorizedDispatch(rows,now);
    return {rows:outcome.rows as typeof rows,result:{
      reconciled:outcome.reconciled,already_saved:outcome.already_saved,skipped:outcome.skipped,
    }};
  });
  if(result.reconciled.length)console.info('Authorized five-waybill dispatch reconciliation: '+result.reconciled.join(', '));
  if(result.reconciled.length+result.already_saved.length===AUTHORIZED_DISPATCH_WAYBILLS.length){
    await mutateDataTable(env,'admin_data_store',rows=>{
      const existing=rows.find(row=>row.key===AUTHORIZED_DISPATCH_RECONCILIATION_KEY);
      if(existing?.payload?.phase==='complete')return;
      rows.push({key:AUTHORIZED_DISPATCH_RECONCILIATION_KEY,payload:{
        phase:'complete',completed_at:now,order_waybills:AUTHORIZED_DISPATCH_WAYBILLS,
        evidence:'Saved Delivered order state or matching Fardar Delivered invoice with COD settlement',
      },updated_at:now});
    });
  }
  return result;
};
