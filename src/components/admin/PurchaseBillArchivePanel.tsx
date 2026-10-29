import React,{useState} from 'react';
import {useStore} from '../../context/StoreContext';
import {staffJsonRequest} from '../../lib/staffRequest';
import type {Product} from '../../types';

type Photo={key:string;url:string;size:number;uploaded_at:string|null};
type Line={key:string;product_id:string;variant_id:string;quantity:number;unit_buying_price:number};
const endpoint='/api/admin/purchase-bill-archive';
const historyEndpoint='/api/admin/inventory-history';
const photoDate=(key:string)=>{
  const match=key.match(/media\/purchase-bill\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return match?match[1]+'-'+match[2]+'-'+match[3]:'';
};
const makeLine=():Line=>({
  key:'line-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
  product_id:'',variant_id:'',quantity:1,unit_buying_price:0
});
const formatDate=(value:string)=>value?new Date(value+'T12:00:00+05:30').toLocaleDateString('en-LK'):'Date not available';

export const PurchaseBillArchivePanel=()=>{
  const {products}=useStore();
  const eligibleProducts=products.filter(product=>product.product_type!=='bundle'&&!product.bundle_components?.length);
  const [photos,setPhotos]=useState<Photo[]>([]);
  const [savedPhotoUrls,setSavedPhotoUrls]=useState<Set<string>>(new Set());
  const [showSaved,setShowSaved]=useState(false);
  const [cursor,setCursor]=useState<string|null>(null);
  const [checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [entryPhoto,setEntryPhoto]=useState<Photo|null>(null);
  const [purchaseDate,setPurchaseDate]=useState('');
  const [supplier,setSupplier]=useState('');
  const [invoiceRef,setInvoiceRef]=useState('');
  const [notes,setNotes]=useState('');
  const [lines,setLines]=useState<Line[]>([]);
  const [itemQueries,setItemQueries]=useState<Record<string,string>>({});
  const [activeSearchKey,setActiveSearchKey]=useState<string|null>(null);
  const [saving,setSaving]=useState(false);
  const [saveMessage,setSaveMessage]=useState('');
  const scan=async(next?:string)=>{
    if(busy)return;setBusy(true);setMessage('');
    try{
      const token=localStorage.getItem('ora_staff_session_token');
      if(!token)throw new Error('Super Admin login is required.');
      const [response,history]=await Promise.all([
        staffJsonRequest(endpoint+(next?'?cursor='+encodeURIComponent(next):''),{
          headers:{authorization:'Bearer '+token}
        },30000),
        staffJsonRequest(historyEndpoint,{headers:{authorization:'Bearer '+token}},30000)
      ]);
      if(!response?.ok||!Array.isArray(response.photos))throw new Error('Purchase bill archive search failed.');
      if(!history?.ok||!Array.isArray(history.purchases))throw new Error('Saved Purchase History could not be checked; bill list was not changed.');
      const saved=new Set<string>(history.purchases.map((purchase:any)=>String(purchase.bill_image_url||'')).filter(Boolean));
      setSavedPhotoUrls(saved);
      setPhotos(previous=>next?[...previous,...response.photos]:response.photos);
      setCursor(response.next_cursor||null);setChecked(true);
      if(!response.photos.length&&!next)setMessage('No purchase-bill images found in this Cloudflare media bucket.');
    }catch(error:any){setMessage(error?.message||'Original bill image archive not accessible.');}
    finally{setBusy(false);}
  };
  const openEntry=(photo:Photo)=>{
    setEntryPhoto(photo);setPurchaseDate(photoDate(photo.key));setSupplier('');setInvoiceRef('');setNotes('');
    setLines([makeLine()]);setItemQueries({});setActiveSearchKey(null);setSaveMessage('');
  };
  const updateLine=(key:string,patch:Partial<Line>)=>
    setLines(previous=>previous.map(line=>line.key===key?{...line,...patch}:line));
  const chooseProduct=(line:Line,product:Product)=>{
    updateLine(line.key,{product_id:product.id,variant_id:''});
    setItemQueries(previous=>{const next={...previous};delete next[line.key];return next;});
    setActiveSearchKey(null);
  };
  const saveHistoryOnly=async()=>{
    if(!entryPhoto||saving)return;
    if(!supplier.trim())return setSaveMessage('Enter the supplier name from the bill.');
    if(!purchaseDate||!Number.isFinite(Date.parse(purchaseDate)))return setSaveMessage('Enter the original bill date.');
    if(!lines.length)return setSaveMessage('Add at least one item line.');
    const selected=lines.map((line,index)=>{
      const product=eligibleProducts.find(item=>item.id===line.product_id);
      const variant=product?.variants?.find(item=>item.id===line.variant_id);
      return {line,index,product,variant};
    });
    if(selected.some(item=>!item.product||item.product.variants?.length&&!item.variant&&item.line.variant_id!=='__variant_split_unknown__'||
      !Number.isSafeInteger(item.line.quantity)||item.line.quantity<=0||
      !Number.isFinite(item.line.unit_buying_price)||item.line.unit_buying_price<0))
      return setSaveMessage('Search for an item code, choose the exact item/variant, then enter a valid quantity and buying cost for every line.');
    setSaving(true);setSaveMessage('');
    try{
      const token=localStorage.getItem('ora_staff_session_token');
      if(!token)throw new Error('Super Admin login is required.');
      const createdAt=new Date(purchaseDate+'T12:00:00+05:30').toISOString();
      const fileName=entryPhoto.key.split('/').pop()||'bill';
      const fileToken=fileName.replace(/\.[^.]+$/,'').replace(/[^A-Za-z0-9_-]/g,'-');
      const records=selected.map(({line,index,product,variant})=>{
        const id='bill-archive-'+fileToken+'-'+(index+1);
        const poNumber='ARCHIVE-'+purchaseDate.replace(/-/g,'')+'-'+fileToken.slice(-8).toUpperCase()+'-'+(index+1);
        return {
          id,po_number:poNumber,supplier_name:supplier.trim(),product_id:product!.id,
          product_name:product!.name_en,sku:variant?.sku||product!.sku,
          ...(variant?{variant_id:variant.id,variant_name:variant.option_value,variant_sku:variant.sku}:{}),
          quantity_added:line.quantity,unit_buying_price:line.unit_buying_price,
          total_cost:line.quantity*line.unit_buying_price,invoice_ref:invoiceRef.trim()||undefined,
          bill_image_url:entryPhoto.url,
          notes:[notes.trim(),line.variant_id==='__variant_split_unknown__'?'Variant quantities were not split on the bill; saved as combined product quantity.':'','Recovered from archived bill photo: '+entryPhoto.key].filter(Boolean).join(' • '),
          performed_by:'Historical bill recovery',created_at:createdAt
        };
      });
      const response=await staffJsonRequest(historyEndpoint,{
        method:'POST',
        headers:{authorization:'Bearer '+token,'content-type':'application/json'},
        body:JSON.stringify({action:'merge-history',purchases:records})
      },30000);
      if(response?.ok!==true||response?.stock_changed!==false||response?.r2_backup_saved!==true)
        throw new Error(response?.error||'History-only save was not confirmed. No stock change is assumed.');
      if(Array.isArray(response.conflicts)&&response.conflicts.length){
        setSaveMessage((Number(response.added_purchases)>0?Number(response.added_purchases)+' new line(s) saved. ':'')+'Some line IDs already exist with different details. Check Purchase History before retrying; no stock was changed.');
        return;
      }
      setSavedPhotoUrls(previous=>new Set([...previous,entryPhoto.url]));
      setMessage('Bill saved to Purchase History and its separate R2 data backup; removed from the unprocessed list. Stock and product buying prices were not changed.');
      setEntryPhoto(null);
      setSaveMessage('');
    }catch(error:any){setSaveMessage(error?.message||'History-only save failed. No stock was changed.');}
    finally{setSaving(false);}
  };
  const savedCount=photos.filter(photo=>savedPhotoUrls.has(photo.url)).length;
  const visiblePhotos=photos.filter(photo=>showSaved?savedPhotoUrls.has(photo.url):!savedPhotoUrls.has(photo.url));
  return <section className="rounded-2xl border border-sky-500/40 bg-neutral-900 p-4 text-neutral-200">
    <h3 className="text-sm font-bold text-sky-200">Original Purchase Bill Photo Archive</h3>
    <p className="mt-1 text-xs text-neutral-400">
      Open a bill, search by Item Code or name, and save verified purchase lines to Purchase History and a separate R2 data backup.
      Current stock and product buying prices are not changed. If the bill does not split variant quantities, save the combined item total without assigning guessed quantities.
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={()=>void scan()}
        className="rounded-lg border border-sky-500 px-3 py-2 text-xs font-bold disabled:opacity-50">
        {busy?'Checking original images…':'Find Old Purchasing Bill Photos'}
      </button>
      <span className="text-xs text-neutral-400">{checked?visiblePhotos.length+' to review • '+savedCount+' saved':'Not scanned'}</span>
      {checked&&savedCount>0&&<button type="button" onClick={()=>setShowSaved(value=>!value)}
        className="rounded-lg border border-neutral-600 px-3 py-2 text-xs font-bold">
        {showSaved?'Hide saved bills':'Show saved bills ('+savedCount+')'}
      </button>}
    </div>
    {message&&<p role="status" className="mt-3 text-xs text-emerald-200">{message}</p>}
    {checked&&photos.length>0&&visiblePhotos.length===0&&
      <p className="mt-3 text-xs text-neutral-400">All archived bills have been saved to Purchase History. Use “Show saved bills” to review them.</p>}
    {visiblePhotos.length>0&&<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {visiblePhotos.map(photo=>{
        const isSaved=savedPhotoUrls.has(photo.url);
        return <div key={photo.key} className="overflow-hidden rounded-xl border border-neutral-700">
          <button type="button" onClick={()=>openEntry(photo)} aria-label="View bill and enter historical purchase"
            className="block w-full">
            <img src={photo.url} alt="View original supplier bill and enter its purchase details" className="h-36 w-full object-contain bg-neutral-950" loading="lazy" />
          </button>
          <div className="p-2 text-[11px] text-neutral-300">
            <p>Archive date: {formatDate(photoDate(photo.key))}</p>
            <p className="text-neutral-500">{photo.uploaded_at?new Date(photo.uploaded_at).toLocaleString('en-LK'):'Upload time not saved'}</p>
            {isSaved?<p className="mt-2 rounded-lg bg-emerald-500/10 px-2 py-2 text-center font-bold text-emerald-200">Saved to Purchase History</p>:
              <button type="button" onClick={()=>openEntry(photo)}
                className="mt-2 w-full rounded-lg border border-emerald-500/70 px-2 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/10">
                View Bill & Enter Purchase
              </button>}
          </div>
        </div>;
      })}
    </div>}
    {cursor&&<button type="button" disabled={busy} onClick={()=>void scan(cursor)}
      className="mt-4 rounded-lg border border-neutral-600 px-3 py-2 text-xs font-bold disabled:opacity-40">
      Load More Original Bill Photos
    </button>}
    {checked&&photos.length>0&&<p className="mt-3 text-xs text-amber-200">
      Check supplier, printed date, item code/variant, quantity and unit cost on each bill before saving. If Pink/Grey are known but their quantities are not, record the bill's combined total without guessing the split.
      Saved bills disappear from the review list and can be shown again with the saved bills filter.
    </p>}
    {entryPhoto&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-6">
      <section role="dialog" aria-modal="true" aria-label="Add historical purchase from bill photo"
        className="max-h-[95vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-emerald-500/40 bg-neutral-950 p-4 text-neutral-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><h4 className="text-base font-black text-emerald-200">Add to Purchase History — No Stock Change</h4>
            <p className="mt-1 break-all text-[11px] text-neutral-400">{entryPhoto.key}</p></div>
          <button type="button" onClick={()=>setEntryPhoto(null)} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs">Close</button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[260px_1fr]">
          <a href={entryPhoto.url} target="_blank" rel="noopener noreferrer">
            <img src={entryPhoto.url} alt="Bill being entered into historical purchase records"
              className="max-h-[55vh] w-full rounded-lg bg-neutral-900 object-contain" />
          </a>
          <div className="space-y-3">
            <label className="block text-xs font-bold">Date printed on bill
              <input type="date" value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-bold">Supplier
              <input value={supplier} onChange={e=>setSupplier(e.target.value)} maxLength={200}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-bold">Invoice / bill number
              <input value={invoiceRef} onChange={e=>setInvoiceRef(e.target.value)} maxLength={180}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" />
            </label>
            <div className="space-y-3">
              <p className="text-xs font-bold">Bill item lines</p>
              {lines.map((line,index)=>{
                const product=eligibleProducts.find(item=>item.id===line.product_id);
                const variants=product?.variants||[];
                const query=itemQueries[line.key]||'';
                const searchText=query|| (product?product.sku+' — '+product.name_en:'');
                const matches=eligibleProducts.filter(item=>{
                  const haystack=[item.sku,item.name_en,item.name_si,...(item.variants||[]).flatMap(variant=>[variant.sku,variant.option_value])]
                    .join(' ').toLowerCase();
                  return !query||haystack.includes(query.toLowerCase());
                }).slice(0,8);
                return <div key={line.key} className="grid gap-2 rounded-xl border border-neutral-800 p-3 sm:grid-cols-2">
                  <div className="relative text-[11px] font-bold sm:col-span-2">
                    <label htmlFor={'item-search-'+line.key}>Search Item Code or Item Name</label>
                    <input id={'item-search-'+line.key} type="search" autoComplete="off"
                      value={searchText}
                      placeholder="Type Item Code or Item Name..."
                      onFocus={()=>setActiveSearchKey(line.key)}
                      onBlur={()=>setActiveSearchKey(null)}
                      onChange={e=>{
                        const value=e.target.value;
                        setItemQueries(previous=>({...previous,[line.key]:value}));
                        updateLine(line.key,{product_id:'',variant_id:''});
                        setActiveSearchKey(line.key);
                      }}
                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs" />
                    {activeSearchKey===line.key&&<div role="listbox" className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-950 shadow-xl">
                      {matches.length?matches.map(item=><button key={item.id} type="button" role="option"
                        onMouseDown={event=>event.preventDefault()}
                        onClick={()=>chooseProduct(line,item)}
                        className="block w-full border-b border-neutral-800 px-3 py-2 text-left text-xs hover:bg-neutral-800">
                        <b className="text-emerald-200">{item.sku}</b> — {item.name_en}
                      </button>):<p className="px-3 py-2 text-xs text-neutral-400">No matching item code or name.</p>}
                    </div>}
                  </div>
                  {variants.length>0&&<label className="text-[11px] font-bold">Exact variant
                    <select value={line.variant_id} onChange={e=>updateLine(line.key,{variant_id:e.target.value})}
                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-xs">
                      <option value="">Select exact variant</option>
                      <option value="__variant_split_unknown__">Variants known, quantity split unknown — save total only</option>
                      {variants.map(variant=><option key={variant.id} value={variant.id}>{variant.sku+' — '+variant.option_value}</option>)}
                    </select>
                  </label>}
                  <label className="text-[11px] font-bold">Quantity
                    <input type="number" min="1" step="1" value={line.quantity}
                      onChange={e=>updateLine(line.key,{quantity:Number(e.target.value)})}
                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-xs" />
                  </label>
                  <label className="text-[11px] font-bold">Unit buying cost (Rs.)
                    <input type="number" min="0" step="0.01" value={line.unit_buying_price}
                      onChange={e=>updateLine(line.key,{unit_buying_price:Number(e.target.value)})}
                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-xs" />
                  </label>
                  {lines.length>1&&<button type="button" onClick={()=>setLines(previous=>previous.filter(item=>item.key!==line.key))}
                    className="text-left text-[11px] text-red-300 underline">Remove this line</button>}
                </div>;
              })}
              <button type="button" onClick={()=>setLines(previous=>[...previous,makeLine()])}
                className="rounded-lg border border-neutral-700 px-3 py-2 text-xs">Add another bill line</button>
            </div>
            <label className="block text-xs font-bold">Notes
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={1000} rows={2}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs" />
            </label>
            {saveMessage&&<p role="status" className="rounded-lg bg-neutral-900 p-3 text-xs text-amber-200">{saveMessage}</p>}
            <button type="button" disabled={saving||!eligibleProducts.length} onClick={()=>void saveHistoryOnly()}
              className="w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-neutral-950 disabled:opacity-50">
              {saving?'Saving history…':'Save Purchase History Only — Stock Unchanged'}
            </button>
          </div>
        </div>
      </section>
    </div>}
  </section>;
};
