import { confirmCsvRequestWithRetry } from './confirmCsvSave';
import { invoiceComplete } from './invoiceQueue';
import { staffJsonRequest } from './staffRequest';

export const invoiceRecoveryPath='/api/orders/invoices/recovery';
export const invoiceRecoveryRequest=(path:string,body?:unknown)=>confirmCsvRequestWithRetry(async(url,options)=>{
  const data=await staffJsonRequest(url,{...options,headers:{'content-type':'application/json',authorization:'Bearer '+(localStorage.getItem('ora_staff_session_token')||'')}});
  if(data.ok!==true){const error:any=new Error('Server did not acknowledge the recovery action.');error.status=503;throw error;}
  return data;
},path,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});

export const finishInvoiceRecovery=async(id:string,request=invoiceRecoveryRequest)=>{
  for(let step=0;step<6;step++){
    const data=await request(invoiceRecoveryPath,{operation_id:id,advance:step>0});
    if(data.operation_id!==id)throw new Error('The server returned a different recovery batch. Retry Double Check.');
    if(data.pending){if(!['prepared','stock_saved'].includes(data.phase))throw new Error('The saved recovery needs review.');continue;}
    if(data.batch_id!=='PACK-RECOVERY-'+id||!Array.isArray(data.orders)||!data.skipped||
      data.orders.some((order:any)=>!invoiceComplete(order)||order.return_packing_operation!==id||order.invoice_pack_batch_id!==data.batch_id))throw new Error('Recovery invoices were not completely verified. Retry Double Check.');
    return data;
  }
  throw new Error('The recovery is still finishing. Press Resume Double Check to continue.');
};
