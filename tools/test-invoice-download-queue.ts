import assert from 'node:assert/strict';
import { createInvoiceDownloadQueue } from '../src/lib/invoiceDownloadQueue';
import { invoiceDownloadBatches, mergeInvoiceDownloadReceipt } from '../src/lib/invoiceDownloadStatus';
import { orderJournalShard } from '../src/lib/orderJournalShard';

class MemoryStorage implements Storage {
  values=new Map<string,string>(); full=false;
  get length(){return this.values.size;}
  key(index:number){return [...this.values.keys()][index]||null;}
  getItem(key:string){return this.values.get(key)||null;}
  setItem(key:string,value:string){if(this.full)throw new Error('Quota exceeded');this.values.set(key,value);}
  removeItem(key:string){this.values.delete(key);}
  clear(){this.values.clear();}
}
const storage=new MemoryStorage(), states:any[]=[], calls:any[]=[], saved:any[]=[];
let fail=503;
const response=(body:any)=>({ok:true,orders:body.orderIds.map((id:string)=>({id,invoice_pack_downloaded_at:body.downloadedAt,
  invoice_pack_downloaded_by:body.downloadedBy,...(body.downloadSet?{invoice_pack_download_set_date:body.downloadSet.date,invoice_pack_download_set_number:body.downloadSet.number}:{})}))});
const request=async(_url:string,options?:RequestInit)=>{
  const body=JSON.parse(String(options?.body));calls.push(body);
  if(fail){const error:any=new Error('Synthetic '+fail);error.status=fail;throw error;}
  return response(body);
};
const make=(user='staff-a',other:Record<string,any>={})=>createInvoiceDownloadQueue({storage,user,request,pause:async()=>{},onSaved:orders=>saved.push(...orders),onState:state=>states.push(state),...other});
const queue=make();
queue.enqueue(['order-0'],'Packing Staff',{date:'2026-10-19',number:2});
assert.equal(queue.hasPendingOrderIds(['order-0']),true,'downloaded PDFs stay pending until the server acknowledges');
assert.equal(storage.length,1,'The receipt is durable before the first network result');
assert.deepEqual(queue.pendingSets(),[{date:'2026-10-19',number:2,orderIds:['order-0']}],'Pending PDFs reserve their filename set without falsely marking Downloaded');
await queue.flush();
assert.equal(calls.length,4);assert.equal(saved.length,0);assert.equal(storage.length,1);
assert.equal(states.at(-1).canRetry,true);assert.match(states.at(-1).message,/retry automatically/);
assert(calls.every(body=>JSON.stringify(body)===JSON.stringify(calls[0])),'Every attempt retains the exact original event');
const originalEvent=JSON.stringify(calls[0]);queue.dispose();
const other=make('staff-b');await other.flush();assert.equal(calls.length,4,'Another staff account cannot publish this receipt');other.dispose();
fail=0;const recovered=make();await recovered.flush();
assert.equal(JSON.stringify(calls.at(-1)),originalEvent,'Reload retries the original timestamp, staff and PDF set');
assert.equal(storage.length,0);assert.equal(saved.length,1);assert.equal(states.at(-1).message,'Invoice download status saved.');
assert.equal(recovered.hasPendingOrderIds(['order-0']),false,'acknowledged order leaves the pending-save queue');
assert.deepEqual(recovered.pendingSets(),[]);
recovered.dispose();

// Every group fits one journal shard, including a large mixed/duplicate list.
const ids=Array.from({length:913},(_,index)=>'order-'+index), groups=invoiceDownloadBatches([...ids,...ids],'Packing Staff');
assert.equal(new Set(groups.flatMap(body=>body.orderIds)).size,ids.length);
assert(groups.every(body=>body.orderIds.length<=50&&new Set(body.orderIds.map(orderJournalShard)).size===1));
assert.equal(new Set(groups.map(body=>body.downloadedAt)).size,1);
const current={id:'order-0',address:'New address',stock_allocated:true,waybill_number:'CURRENT-WB',invoice_pack_downloaded_at:'2026-10-19T12:00:00Z'};
const older={...current,address:'Stale address',stock_allocated:false,waybill_number:'STALE-WB',invoice_pack_downloaded_at:'2026-10-19T11:00:00Z'};
assert.deepEqual(mergeInvoiceDownloadReceipt(current,older),current,'A delayed receipt cannot roll back a newer download');
assert.deepEqual(mergeInvoiceDownloadReceipt(current,{...older,invoice_pack_downloaded_at:'2026-10-19T13:00:00Z'}),current,'A receipt for another parcel cannot change this invoice');
const merged=mergeInvoiceDownloadReceipt(current,{...older,waybill_number:current.waybill_number,invoice_pack_downloaded_at:'2026-10-19T13:00:00Z',invoice_pack_downloaded_by:'Packing Staff'});
assert.equal(merged.address,current.address);assert.equal(merged.stock_allocated,true);assert.equal(merged.waybill_number,current.waybill_number);
assert.equal(merged.invoice_pack_downloaded_at,'2026-10-19T13:00:00Z','Receipts merge metadata without replacing other local work');

// Two tabs retain separate receipts. An acknowledged event cannot erase a
// different download or cause the PDF to be generated a second time.
fail=503;const firstTab=make(),secondTab=make();
firstTab.enqueue(['order-1'],'Packing Staff');secondTab.enqueue(['order-2'],'Packing Staff');
await Promise.all([firstTab.flush(),secondTab.flush()]);assert.equal(storage.length,2);
firstTab.dispose();secondTab.dispose();fail=0;
const both=make();await both.flush();assert.equal(storage.length,0);both.dispose();

// A permanent rejection stays visible without an automatic retry loop.
fail=404;const rejected=make();rejected.enqueue(['missing-order'],'Packing Staff');await rejected.flush();
const before=calls.length;await rejected.flush();assert.equal(calls.length,before);
assert.match(states.at(-1).message,/Synthetic 404/);assert.equal(storage.length,1);
fail=0;await rejected.flush(true);assert.equal(storage.length,0);rejected.dispose();

// Full browser storage retains the event in memory and never claims recovery
// will survive a reload. A later retry still saves without another PDF.
storage.full=true;fail=503;const quota=make();quota.enqueue(['order-3'],'Packing Staff');await quota.flush();
assert.equal(storage.length,0);assert.match(states.at(-1).message,/Keep this tab open/);
storage.full=false;fail=0;await quota.flush();assert.equal(storage.length,0);quota.dispose();

// Sign-out during a request cannot populate the next staff user's order list.
let release!:(value:any)=>void, started!:(value?:unknown)=>void;
const ready=new Promise(resolve=>{started=resolve;});const lateSaved:any[]=[];
const late=make('late-user',{onSaved:(orders:any[])=>lateSaved.push(...orders),request:async(_url:string,options:RequestInit)=>{
  started();return new Promise(resolve=>{release=()=>resolve(response(JSON.parse(String(options.body))));});
}});
late.enqueue(['order-4'],'Packing Staff');await ready;late.dispose();release(null);await late.flush();
assert.equal(lateSaved.length,0);assert.equal(storage.length,0,'A confirmed old-user event is still safely acknowledged');

// Broken records are preserved for review without blocking valid receipts.
storage.setItem('ora_invoice_download_pending_v1:staff-a:broken','{');
const corrupt=make();corrupt.enqueue(['order-5'],'Packing Staff');await corrupt.flush();
assert.equal(storage.length,1);assert.match(states.at(-1).message,/could not be verified/);corrupt.dispose();storage.clear();
console.log('PASS: bounded single-shard metadata groups; durable receipts before requests; 503/reload exact retries; independent tabs/staff; verified acknowledgments; permanent rejections; full storage; late sign-out; corrupt receipt isolation.');
