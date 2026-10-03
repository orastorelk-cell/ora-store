export const orderCancellationLinkPatch=()=>({
  name:'ora-order-cancellation-link-patch',enforce:'pre' as const,
  transform(code:string,rawId:string){
    if(!rawId.split('?')[0].replace(/\\/g,'/').endsWith('/src/components/admin/AdminDashboard.tsx'))return null;
    const marker="                    {order.order_status !== 'Cancelled' && (";
    if(code.split(marker).length!==2)throw new Error('[O-RA cancellation] order action marker must be unique');
    const link=`                    {adminUser?.role==='admin' && order.waybill_number && order.dispatch_status!=='Handed Over' && !['Shipped','Delivered'].includes(order.order_status) && (
                      <a href={'/cancel-order#waybill='+encodeURIComponent(order.waybill_number)} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black text-amber-300">Cancel Before Dispatch</a>
                    )}\n`;
    return {code:code.replace(marker,link+marker),map:null};
  },
});
