export const sharedWaybillPoolPatch=()=>({
  name:'ora-shared-waybill-pool',enforce:'pre' as const,
  transform(code:string,rawId:string){
    const id=rawId.split('?')[0].replace(/\\/g,'/');
    if(id.endsWith('/src/components/admin/AdminDashboard.tsx')){
      let text=code;const at=text.indexOf('const result = importWaybillCsv(text,');
      if(at<0)throw new Error('Waybill file reader marker missing.');
      const reader=text.lastIndexOf('reader.onload = (event) => {',at);
      if(reader<0)throw new Error('Waybill file reader callback missing.');
      text=text.slice(0,reader)+text.slice(reader).replace('reader.onload = (event) => {','reader.onload = async (event) => {');
      text=text.replace('const result = importWaybillCsv(text, settings.courier_provider || \'Fardar\');',"let result:any;\n      try{result=await importWaybillCsv(text, settings.courier_provider || 'Fardar');}catch(error:any){setWaybillImportMessage('WAYBILL CSV NOT IMPORTED: '+(error?.message||error));return;}");
      text=text.replace('        importWaybillCsv(`Waybill','        await importWaybillCsv(`Waybill');
      return {code:text,map:null};
    }
    if(!id.endsWith('/src/context/StoreContext.tsx'))return null;
    let text=code;
    const marker='  const [sharedStoreReady, setSharedStoreReady] = useState(false);';
    if(!text.includes(marker))throw new Error('Shared waybill state insertion marker missing.');
    text=text.replace(marker,marker+String.raw`
  const [sharedWaybillPoolReady,setSharedWaybillPoolReady]=useState(false);
  const [waybillPoolRetry,setWaybillPoolRetry]=useState(0);
  const automaticWaybillRunRef=useRef(false);
  const automaticWaybillRetryTimerRef=useRef<number|null>(null);
  useEffect(()=>()=>{if(automaticWaybillRetryTimerRef.current!==null)window.clearTimeout(automaticWaybillRetryTimerRef.current);},[]);
  useEffect(()=>{
    if(!adminUser||!getStaffSessionToken())return;
    let stopped=false,busy=false,migrated=false;
    const localPool:WaybillRecord[]=waybillRecords.slice();
    const refresh=async()=>{
      if(busy)return;busy=true;
      try{
        let data=await confirmCsvRequestWithRetry(sharedStaffRequest,'/api/courier/waybills');
        if(!data?.ok||!Array.isArray(data.records))throw new Error('Shared waybill pool was not returned.');
        if(!migrated){
          const known=new Map(data.records.map((r:any)=>[r.waybill_number,r]));
          const missing=localPool.filter(r=>/[0-9]/.test(String(r.waybill_number))&&(!known.has(r.waybill_number)||(known.get(r.waybill_number) as any)?.status==='Available'&&r.status!=='Available'));
          for(let offset=0;offset<missing.length;offset+=50)await confirmCsvRequestWithRetry(sharedStaffRequest,'/api/courier/waybills/import',{method:'POST',body:JSON.stringify({records:missing.slice(offset,offset+50)})});
          if(missing.length)data=await sharedStaffRequest('/api/courier/waybills');
          migrated=true;
        }
        if(!stopped){
          setWaybillRecords(prev=>JSON.stringify(prev)===JSON.stringify(data.records)?prev:data.records);
          setSharedWaybillPoolReady(true);setWaybillPoolRetry(n=>n+1);
        }
      }catch(error:any){console.warn('Shared waybill pool load failed; existing records have been kept:',error?.message||error);}
      finally{busy=false;}
    };
    setSharedWaybillPoolReady(false);void refresh();
    const timer=window.setInterval(()=>void refresh(),30000);
    return()=>{stopped=true;window.clearInterval(timer);};
  },[adminUser?.id]);
`);
    const start=text.indexOf("  const assignNextWaybill = async (orderId: string,");
    const end=text.indexOf('  const unassignWaybill =',start);
    if(start<0||end<0)throw new Error('Shared waybill assignment markers missing.');
    text=text.slice(0,start)+String.raw`  const assignNextWaybill = async(orderId:string,courierName=settings.courier_provider||'Fardar'):Promise<string|null>=>{
    const current=orders.find(o=>o.id===orderId);
    if(!current||!sharedWaybillPoolReady||waybillAssignmentOrderInFlightRef.current.has(orderId))return null;
    if(current.waybill_number)return current.waybill_number;
    waybillAssignmentOrderInFlightRef.current.add(orderId);
    try{
      const data=await confirmCsvRequestWithRetry(sharedStaffRequest,'/api/orders/waybill/assign',{method:'POST',body:JSON.stringify({order_id:orderId,courier_name:courierName})});
      if(!data?.ok||data.order?.id!==orderId||!data.order.waybill_number)throw new Error('Waybill was not durably acknowledged.');
      const saved=data.order as Order;
      setOrders(prev=>prev.map(o=>o.id===orderId?saved:o));
      setWaybillRecords(prev=>prev.map(w=>w.waybill_number===saved.waybill_number?{...w,status:'Assigned',assigned_order_id:saved.id,assigned_order_number:saved.order_number}:w));
      logActivity({action:'Waybill Assigned',module:'Delivery',target_id:orderId,target_label:saved.order_number,details:saved.waybill_number});
      return saved.waybill_number;
    }catch(error:any){console.warn('Shared waybill assignment will retry:',current.order_number,error?.message||error);return null;}
    finally{waybillAssignmentOrderInFlightRef.current.delete(orderId);}
  };

`+text.slice(end);
    const allocator='  useEffect(() => {\n    const allocatorSignature=JSON.stringify({';
    if(!text.includes(allocator))throw new Error('Shared pool allocator marker missing.');
    text=text.replace(allocator,"  useEffect(() => {\n    if(!sharedWaybillPoolReady||!sharedStoreReady||!sharedOrdersReady||!adminUser||!getStaffSessionToken())return;\n    const allocatorSignature=JSON.stringify({waybillPoolRetry,");
    text=text.replace('  }, [orders, products, waybillRecords]);','  }, [orders, products, waybillRecords, sharedWaybillPoolReady, sharedStoreReady, sharedOrdersReady, waybillPoolRetry]);');
    text=text.replace('importWaybillCsv: (csvText: string, courierName?: string) => { importedCount: number; duplicateCount: number };','importWaybillCsv: (csvText: string, courierName?: string) => Promise<{ importedCount: number; duplicateCount: number }>;');
    text=text.replace('  const importWaybillCsv = (csvText: string,','  const importWaybillCsv = async (csvText: string,');
    const automaticStart='    if(readyWithoutWaybill.length){\n      void (async()=>{\n        for(const ready of readyWithoutWaybill){';
    if(!text.includes(automaticStart))throw new Error('Automatic waybill queue marker missing.');
    text=text.replace(automaticStart,'    if(readyWithoutWaybill.length&&!automaticWaybillRunRef.current){\n      automaticWaybillRunRef.current=true;\n      void (async()=>{\n        for(const ready of readyWithoutWaybill){');
    const automaticEnd='      })();\n    }\n  }, [orders, products, waybillRecords, sharedWaybillPoolReady, sharedStoreReady, sharedOrdersReady, waybillPoolRetry]);';
    if(!text.includes(automaticEnd))throw new Error('Automatic waybill completion marker missing.');
    text=text.replace(automaticEnd,String.raw`      })().finally(()=>{
        automaticWaybillRunRef.current=false;
        if(automaticWaybillRetryTimerRef.current===null)automaticWaybillRetryTimerRef.current=window.setTimeout(()=>{
          automaticWaybillRetryTimerRef.current=null;setWaybillPoolRetry(n=>n+1);
        },5000);
      });
    }
  }, [orders, products, waybillRecords, sharedWaybillPoolReady, sharedStoreReady, sharedOrdersReady, waybillPoolRetry]);`);
    const importMarker='    if (additions.length) setWaybillRecords((prev) => [...prev, ...additions]);';
    if(!text.includes(importMarker))throw new Error('Durable waybill import marker missing.');
    text=text.replace(importMarker,String.raw`    for(let offset=0;offset<additions.length;offset+=50)await confirmCsvRequestWithRetry(sharedStaffRequest,'/api/courier/waybills/import',{method:'POST',body:JSON.stringify({records:additions.slice(offset,offset+50)})});
    const sharedPool=await sharedStaffRequest('/api/courier/waybills');
    if(!sharedPool?.ok||!Array.isArray(sharedPool.records))throw new Error('Waybill import was not acknowledged.');
    setWaybillRecords(sharedPool.records);setSharedWaybillPoolReady(true);setWaybillPoolRetry(n=>n+1);`);
    return {code:text,map:null};
  }
});
