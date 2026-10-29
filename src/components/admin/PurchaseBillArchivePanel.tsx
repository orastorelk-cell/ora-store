import React,{useState} from 'react';
import {staffJsonRequest} from '../../lib/staffRequest';
type Photo={key:string;url:string;size:number;uploaded_at:string|null};
const endpoint='/api/admin/purchase-bill-archive';
export const PurchaseBillArchivePanel=()=>{
  const [photos,setPhotos]=useState<Photo[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const scan=async(next?:string)=>{
    if(busy)return;setBusy(true);setMessage('');
    try{
      const token=localStorage.getItem('ora_staff_session_token');
      if(!token)throw new Error('Super Admin login is required.');
      const response=await staffJsonRequest(endpoint+(next?'?cursor='+encodeURIComponent(next):''),{
        headers:{authorization:'Bearer '+token}
      },30000);
      if(!response?.ok||!Array.isArray(response.photos))throw new Error('Purchase bill archive search failed.');
      setPhotos(previous=>next?[...previous,...response.photos]:response.photos);
      setCursor(response.next_cursor||null);setChecked(true);
      if(!response.photos.length&&!next)setMessage('No purchase-bill images found in this Cloudflare media bucket. Older files may have been uploaded to a different storage provider; original browser/history is another recovery source.');
    }catch(error:any){setMessage(error?.message||'Original bill image archive not accessible.');}
    finally{setBusy(false);}
  };
  return <section className="rounded-2xl border border-sky-500/40 bg-neutral-900 p-4 text-neutral-200">
    <h3 className="text-sm font-bold text-sky-200">Original Purchase Bill Photo Archive</h3>
    <p className="mt-1 text-xs text-neutral-400">
      Purchase History and uploaded receipt photos were stored separately.
      Scan original photos that may survive when browser-only Purchase records disappear.
      Viewing these images never changes Stock or Profit.
    </p>
    <div className="mt-3 flex items-center gap-3">
      <button type="button" disabled={busy} onClick={()=>void scan()}
        className="rounded-lg border border-sky-500 px-3 py-2 text-xs font-bold disabled:opacity-50">
        {busy?'Checking original images…':'Find Old Purchasing Bill Photos'}
      </button>
      <span className="text-xs text-neutral-400">{checked?photos.length+' photo(s) found':'Not scanned'}</span>
    </div>
    {message&&<p role="status" className="mt-3 text-xs text-amber-200">{message}</p>}
    {photos.length>0&&<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map(photo=><div key={photo.key} className="overflow-hidden rounded-xl border border-neutral-700">
        <a href={photo.url} target="_blank" rel="noopener noreferrer">
          <img src={photo.url} alt="Original supplier bill image" className="h-36 w-full object-contain bg-neutral-950" loading="lazy" />
        </a>
        <div className="p-2 text-[11px] text-neutral-300">
          <p>{photo.uploaded_at?new Date(photo.uploaded_at).toLocaleString('en-LK'):'Date not saved'}</p>
          <a className="mt-1 block break-words text-sky-300 underline" href={photo.url}
            target="_blank" rel="noopener noreferrer">Open original bill photo</a>
        </div>
      </div>)}
    </div>}
    {cursor&&<button type="button" disabled={busy} onClick={()=>void scan(cursor)}
      className="mt-4 rounded-lg border border-neutral-600 px-3 py-2 text-xs font-bold disabled:opacity-40">
      Load More Original Bill Photos
    </button>}
    {checked&&photos.length>0&&<p className="mt-3 text-xs text-amber-200">
      These are preserved photo files, not automatically recovered purchasing rows.
      Supplier, Item Code, Qty, buying price and original date must be verified against each image
      before restoring historical records. Never add stock again.
    </p>}
  </section>;
};
