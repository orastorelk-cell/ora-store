/**
 * Runs AFTER every legacy FIFO/waybill plugin. Replaces the previous
 * client-side two-write allocation with a server-atomic receipt per order.
 * Order/stock never changes on the browser before the durable server response.
 */
export const serverFifoAllocationPatch=()=>({
  name:'ora-server-idempotent-fifo',
  enforce:'pre' as const,
  transform(code:string,rawId:string){
    const path=rawId.split('?')[0].replace(/\\/g,'/');
    if(!path.endsWith('/src/context/StoreContext.tsx'))return null;
    if(code.includes('SERVER ATOMIC FIFO ALLOCATOR'))return null;
    const start=code.indexOf('  // FIFO stock + waybill allocator. Variants use their own stock.');
    const end=code.indexOf('  // AUTO INVOICE QUEUE:',start);
    if(start<0||end<0)throw new Error('[O-RA atomic FIFO] Final previous FIFO region is missing');
    const insert=String.raw`  const serverFifoInFlightRef=useRef(false);
  // SERVER ATOMIC FIFO ALLOCATOR — one durable stock debit receipt per order.
  // Browser refresh, failed order mirroring and a second PC can never create
  // a second debit for the same order ID.
  useEffect(()=>{
    if(!adminUser||!getStaffSessionToken()||!sharedStoreReady||!sharedOrdersReady||
       !sharedWaybillPoolReady||returnStockTransactionPending)return;
    // Do not use a locally edited but unsaved product catalog to allocate.
    if(sharedStoreSnapshotRef.current?.products!==products)return;
    const confirmed=orders.filter(o=>o.order_status!=='Cancelled'&&o.call_center_status==='Confirmed'&&
      !o.is_duplicate_order&&!o.is_test_order&&!o.sheet_confirm_hold)
      .sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
    const waiting=confirmed.filter(o=>!o.stock_allocated);
    if(waiting.length&&!serverFifoInFlightRef.current){
      serverFifoInFlightRef.current=true;
      void (async()=>{
        for(const order of waiting.slice(0,16)){
          try{
            // This API owns both the inventory CAS and the retryable order
            // allocation receipt. Never call setProducts before it succeeds.
            const saved=await sharedStaffRequest('/api/orders/stock/allocate',{
              method:'POST',body:JSON.stringify({order_id:order.id})
            });
            if(!saved?.ok||!saved.order)throw new Error('Server allocation was not confirmed.');
            const fresh=await sharedStaffRequest('/api/admin/storefront/state');
            if(!fresh?.initialized||!fresh.state)throw new Error('Server stock refresh required before continuing FIFO.');
            if(Number(fresh.state.version||0)>=sharedStoreVersionRef.current)
              applySharedStorefrontState(fresh.state,true);
            setOrders(prev=>prev.map(item=>item.id===saved.order.id?saved.order:item));
            if(Array.isArray(saved.logs)){
              const ids=new Set(saved.logs.map((log:StockHistory)=>String(log.id)));
              setStockHistory(prev=>[...saved.logs,...prev.filter(log=>!ids.has(String(log.id)))]);
            }
            // Commit only ONE successfully reserved order per render. Next
            // render uses fresh server products and sees all earlier credits.
            break;
          }catch(error:any){
            if(!String(error?.message||'').includes('Waiting for Stock'))
              console.warn('Server FIFO allocation held for '+order.order_number+':',error?.message||error);
          }
        }
      })().finally(()=>{serverFifoInFlightRef.current=false;});
    }

    // Existing durable waybill reservation remains server-first. An invoice
    // is queued only after the new order snapshot confirms stock allocated.
    const ready=confirmed.filter(o=>o.stock_allocated&&o.stock_status==='Allocated'&&
      !o.waybill_number&&!o.invoice_locked&&!o.invoice_number&&!o.invoice_generated_at);
    if(ready.length&&!automaticWaybillRunRef.current){
      automaticWaybillRunRef.current=true;
      void (async()=>{
        for(const order of ready.slice(0,20)){
          try{await assignNextWaybill(order.id,settings.courier_provider||'Fardar');}
          catch(error:any){console.warn('Server waybill pending:',order.order_number,error?.message||error);}
        }
      })().finally(()=>{
        automaticWaybillRunRef.current=false;
        if(automaticWaybillRetryTimerRef.current===null)
          automaticWaybillRetryTimerRef.current=window.setTimeout(()=>{
            automaticWaybillRetryTimerRef.current=null;setWaybillPoolRetry(n=>n+1);
          },5000);
      });
    }
  },[orders,products,sharedStoreReady,sharedOrdersReady,sharedWaybillPoolReady,
     adminUser?.id,returnStockTransactionPending,waybillPoolRetry]);

`;
    return {code:code.slice(0,start)+insert+code.slice(end),map:null};
  }
});
