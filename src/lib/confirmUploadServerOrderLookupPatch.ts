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
    // durable order mirror before resolving CSV Order IDs; local state is fallback only.
    let persisted:Order[]=[];try{persisted=JSON.parse(localStorage.getItem('ora_orders')||'[]');}catch{}
    let serverOrders:Order[]=[];
    try{
      if(getStaffSessionToken()){
        const serverData=await sharedStaffRequest('/api/orders');
        serverOrders=Array.isArray(serverData?.orders)?serverData.orders:[];
      }
    }catch(error:any){
      console.warn('Confirm upload durable order refresh failed; using current cache:',error?.message||error);
    }
    const mergedBase=serverOrders.length?serverOrders:orders;
    const merged=[
      ...mergedBase,
      ...orders.filter(saved=>!mergedBase.some(cur=>cur.id===saved.id)),
      ...persisted.filter(saved=>!mergedBase.some(cur=>cur.id===saved.id) && !orders.some(cur=>cur.id===saved.id)),
    ];
    const existing=new Map(merged.map(o=>[String(o.order_number||'').toUpperCase(),o] as [string,Order]));`;

    return { code: code.replace(oldBlock, newBlock), map: null };
  },
});
