// All responses must be real JSON acknowledgments. An HTML gateway error or a
// stalled connection must not leave a staff action spinning or appear saved.
export const staffJsonRequest=async(url:string,options:RequestInit={},timeoutMs=25_000)=>{
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted)cancel();
  const timer=setTimeout(cancel,timeoutMs);
  try{
    const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data||typeof data!=='object'){
      const error:any=new Error(data?.error||(!response.ok?`Request failed (${response.status}, ${options.method||'GET'} ${url.split('?')[0]})`:'Server response was incomplete.'));
      error.status=response.ok?503:response.status;error.path=url.split('?')[0];
      error.retryAfterMs=Number(response.headers.get('Retry-After'))*1000;throw error;
    }
    return data;
  }catch(error:any){
    if(error?.name==='AbortError'&&!options.signal?.aborted){const timeout:any=new Error('Server request timed out. Retrying the saved action is safe.');timeout.status=503;throw timeout;}
    throw error;
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
};
