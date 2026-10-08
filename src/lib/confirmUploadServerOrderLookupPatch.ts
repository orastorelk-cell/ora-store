import type { Plugin } from 'vite';

/**
 * Confirm/Cancel CSV must resolve orders from the durable server, not only the
 * current React/localStorage snapshot. This fixes fresh Website/FB/TikTok orders
 * being reported Not Found / left Pending when the admin tab is stale.
 */
export const confirmUploadServerOrderLookupPatch = (): Plugin => ({
  name: 'ora-confirm-upload-server-order-lookup-patch',
  enforce: 'pre',
  transform(code, rawId) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;
    if (code.includes('CONFIRM UPLOAD DURABLE ORDER LOOKUP')) return null;

    const oldBlock = "    let persisted:Order[]=[];try{persisted=JSON.parse(localStorage.getItem('ora_orders')||'[]');}catch{}\n    const merged=[...orders,...persisted.filter(saved=>!orders.some(cur=>cur.id===saved.id))];\n    const existing=new Map(merged.map(o=>[o.order_number.toUpperCase(),o] as [string,Order]));";
    if (!code.includes(oldBlock)) {
      throw new Error('[O-RA confirm server lookup] existing-order lookup marker not found');
    }

    const newBlock = String.raw`    // CONFIRM UPLOAD DURABLE ORDER LOOKUP
    // A Website/Meta order can arrive after this Admin tab loaded. Always query the
    // durable order mirror before resolving CSV Order IDs. Stop on a failed read
    // rather than building financial/stock decisions from a stale browser cache.
    let persisted:Order[]=[];try{persisted=JSON.parse(localStorage.getItem('ora_orders')||'[]');}catch{}
    let serverOrders:Order[]=[];
    if(!getStaffSessionToken())throw new Error('Sign in before uploading Confirm CSV.');
    const serverData=await confirmCsvRequestWithRetry(async(url,options)=>{
      const data=await sharedStaffRequest(url,options);
      const orders=Array.isArray(data?.snapshots)?data.snapshots.map((row:any)=>row?.payload):data?.orders;
      if(!Array.isArray(orders)){const error:any=new Error('The durable order list could not be verified.');error.status=503;throw error;}
      return {orders};
    },'/api/orders?format=snapshots');
    serverOrders=serverData.orders.filter((order:any)=>order?.id&&order.order_number);
    const merged=serverOrders;
    const existing=new Map(merged.map(o=>[String(o.order_number||'').toUpperCase(),o] as [string,Order]));`;

    return { code: code.replace(oldBlock, newBlock), map: null };
  },
});
