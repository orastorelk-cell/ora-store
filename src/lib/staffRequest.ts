// All responses must be real JSON acknowledgments. An HTML gateway error or a
// stalled connection must not leave a staff action spinning or appear saved.
export const staffJsonRequest=async(url:string,options:RequestInit={},timeoutMs=25_000)=>{
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted)cancel();
  const timer=setTimeout(cancel,timeoutMs);
  try{
    const headers=new Headers(options.headers);
    if(url.startsWith('/api/orders?')&&new URLSearchParams(url.split('?')[1]).get('format')==='snapshots')headers.set('x-ora-order-journal','1');
    const response=await fetch(url,{...options,headers,cache:'no-store',signal:controller.signal});
    const raw=await response.text();
    let data:any;try{data=JSON.parse(raw);}catch{data=null;}
    if(!response.ok||!data||typeof data!=='object'){
      const resourceLimit=/\berror(?: code)?:?\s*1102\b/i.test(raw)||response.headers.get('cf-error-code')==='1102';
      const error:any=new Error(data?.error||(resourceLimit?'The website server reached its processing limit. The save has not been confirmed.':!response.ok?`Request failed (${response.status}, ${options.method||'GET'} ${url.split('?')[0]})`:'Server response was incomplete.'));
      error.status=response.ok?503:response.status;error.path=url.split('?')[0];
      if(typeof data?.retry_required==='boolean')error.retryRequired=data.retry_required;
      error.requestId=response.headers.get('cf-ray')||'';
      if(resourceLimit)error.code='WORKER_RESOURCE_LIMIT';
      error.retryAfterMs=Number(response.headers.get('Retry-After'))*1000;throw error;
    }
    if(data.snapshot_changes!==undefined){
      const incomplete=()=>{const error:any=new Error('The server order history could not be verified.');error.status=503;throw error;};
      if(!Array.isArray(data.snapshots)||!Array.isArray(data.snapshot_changes))incomplete();
      const rows=new Map<string,any>();
      for(const row of data.snapshots){if(!row?.order_id||rows.has(String(row.order_id)))incomplete();rows.set(String(row.order_id),row);}
      const changed=new Set<string>();
      for(const row of data.snapshot_changes){const id=String(row?.order_id||'');if(!id||changed.has(id)||row.deleted!==true&&!row.payload)incomplete();changed.add(id);if(row.deleted===true)rows.delete(id);else rows.set(id,row);}
      if(data.snapshot_count!==undefined&&data.snapshot_count!==rows.size)incomplete();
      data.snapshots=Array.from(rows.values());delete data.snapshot_changes;
    }
    return data;
  }catch(error:any){
    if(error?.name==='AbortError'&&!options.signal?.aborted){const timeout:any=new Error('Server request timed out. Retrying the saved action is safe.');timeout.status=503;throw timeout;}
    throw error;
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
};
