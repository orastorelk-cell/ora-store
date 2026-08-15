import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Bell, Image as ImageIcon, Plus, Trash2, Upload } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { HeroBannerSlide } from '../../types';
import { compressImageFile, uploadPublicImage } from '../../lib/imageUpload';
import { displayUnitPrice } from '../../lib/productVariants';

const newBanner = (order:number, type:'custom'|'product'='custom'): HeroBannerSlide => ({
  id:`banner-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
  type,
  enabled:true,
  order,
  image:'',
  product_id:'',
  tag_en:'', tag_si:'', title_en:'', title_si:'', sub_en:'', sub_si:'', button_en:'Shop Now', button_si:'දැන් බලන්න',
  link_type:type==='product'?'product':'products', link_value:'',
});

const staffRequest = async (url:string, init:RequestInit={}) => {
  const token=localStorage.getItem('ora_staff_session_token')||'';
  const response=await fetch(url,{...init,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(init.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error||'Request failed.');
  return data;
};

export const BannersPanel: React.FC = () => {
  const { settings, updateSettings, products, categories, adminUser } = useStore();
  const [uploadingId,setUploadingId]=useState('');
  const [notifyOnNextSave,setNotifyOnNextSave]=useState<Record<string,boolean>>({});
  const canNotify=adminUser?.role==='admin' || Boolean(adminUser?.permissions?.includes('notifications'));

  const legacy:HeroBannerSlide={
    id:'legacy-main-banner', type:'custom', enabled:true, order:1,
    image:settings.hero_banner_image||'', tag_en:settings.hero_banner_tag_en||'', tag_si:settings.hero_banner_tag_si||'',
    title_en:settings.hero_banner_title_en||'', title_si:settings.hero_banner_title_si||'', sub_en:settings.hero_banner_sub_en||'', sub_si:settings.hero_banner_sub_si||'',
    button_en:settings.hero_banner_button_en||'Shop Now', button_si:settings.hero_banner_button_si||'දැන් බලන්න', link_type:'products', link_value:'',
  };
  const slides=useMemo(()=>{
    const source=Array.isArray(settings.hero_banners)&&settings.hero_banners.length?settings.hero_banners:[legacy];
    return [...source].sort((a,b)=>Number(a.order||0)-Number(b.order||0)).slice(0,10);
  },[settings.hero_banners,settings.hero_banner_image,settings.hero_banner_title_en,settings.hero_banner_title_si,settings.hero_banner_tag_en,settings.hero_banner_tag_si,settings.hero_banner_sub_en,settings.hero_banner_sub_si,settings.hero_banner_button_en,settings.hero_banner_button_si]);

  const saveSlides=(next:HeroBannerSlide[])=>updateSettings({hero_banners:next.map((row,index)=>({...row,order:index+1})).slice(0,10)});
  const patch=(id:string,updates:Partial<HeroBannerSlide>)=>saveSlides(slides.map((row)=>row.id===id?{...row,...updates}:row));
  const add=(type:'custom'|'product')=>{ if(slides.length>=10)return alert('Maximum 10 banners.'); saveSlides([...slides,newBanner(slides.length+1,type)]); };
  const remove=(id:string)=>{ if(!confirm('Delete this banner?'))return; saveSlides(slides.filter((row)=>row.id!==id)); };
  const move=(id:string,direction:-1|1)=>{
    const current=[...slides]; const index=current.findIndex((row)=>row.id===id); const target=index+direction;
    if(index<0||target<0||target>=current.length)return; [current[index],current[target]]=[current[target],current[index]]; saveSlides(current);
  };
  const upload=async(id:string,file?:File|null)=>{
    if(!file)return; setUploadingId(id);
    try{const compressed=await compressImageFile(file,1600,420_000);const url=await uploadPublicImage(compressed,'product');patch(id,{image:url});}
    catch(error:any){alert(error?.message||'Banner upload failed.');}finally{setUploadingId('');}
  };
  const sendNotification=async(slide:HeroBannerSlide)=>{
    if(!canNotify||!notifyOnNextSave[slide.id])return;
    const product=products.find((p)=>p.id===slide.product_id);
    const title=(slide.title_en||product?.name_en||'New at O-RA').trim();
    const body=(slide.sub_en|| (product?`Now available for Rs. ${displayUnitPrice(product,settings).toLocaleString()}.`:'See the latest O-RA update.')).trim();
    try{await staffRequest('/api/admin/customer-notifications',{method:'POST',body:JSON.stringify({title,body,url:'/'})});setNotifyOnNextSave((prev)=>({...prev,[slide.id]:false}));alert('Banner saved and customer notification published.');}
    catch(error:any){alert(`Banner saved, but notification failed: ${error?.message||'Unknown error'}`);}
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-fuchsia-400">Storefront Slider</p><h2 className="mt-1 text-xl font-black text-white">Banners ({slides.length}/10)</h2><p className="mt-1 text-xs text-neutral-400">Mix custom designed banners and automatic product banners. Storefront auto-slides and also has manual arrows/dots.</p></div>
      <div className="flex gap-2"><button type="button" onClick={()=>add('product')} className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-black text-white"><Plus className="mr-1 inline h-4 w-4"/>Auto Product</button><button type="button" onClick={()=>add('custom')} className="rounded-xl bg-fuchsia-500 px-3 py-2 text-xs font-black text-white"><Plus className="mr-1 inline h-4 w-4"/>Custom Banner</button></div>
    </div>

    <div className="space-y-4">
      {slides.map((slide,index)=>{
        const product=products.find((p)=>p.id===slide.product_id);
        const previewImage=slide.type==='product'?(slide.image||product?.images?.[0]||''):slide.image;
        const previewTitle=slide.title_en||product?.name_en||'Banner title';
        const previewSub=slide.sub_en||product?.description_en||'';
        return <div key={slide.id} className="rounded-3xl border border-neutral-800 bg-neutral-900 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="rounded-lg bg-neutral-950 px-2 py-1 font-mono text-[10px] font-black text-neutral-400">#{index+1}</span><span className={`rounded-full px-2 py-1 text-[9px] font-black ${slide.type==='product'?'bg-violet-500/10 text-violet-300':'bg-fuchsia-500/10 text-fuchsia-300'}`}>{slide.type==='product'?'AUTO PRODUCT':'CUSTOM IMAGE'}</span><label className="flex items-center gap-2 text-[10px] font-black text-neutral-300"><input type="checkbox" checked={slide.enabled!==false} onChange={(e)=>patch(slide.id,{enabled:e.target.checked})} className="accent-orange-500"/>Enabled</label></div><div className="flex gap-1"><button type="button" onClick={()=>move(slide.id,-1)} className="rounded-lg bg-neutral-800 p-2 text-neutral-300"><ArrowUp className="h-3.5 w-3.5"/></button><button type="button" onClick={()=>move(slide.id,1)} className="rounded-lg bg-neutral-800 p-2 text-neutral-300"><ArrowDown className="h-3.5 w-3.5"/></button><button type="button" onClick={()=>remove(slide.id)} className="rounded-lg bg-red-950 p-2 text-red-300"><Trash2 className="h-3.5 w-3.5"/></button></div></div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-[10px] font-bold text-neutral-400">Banner Type<select value={slide.type} onChange={(e)=>patch(slide.id,{type:e.target.value as 'custom'|'product',link_type:e.target.value==='product'?'product':'products'})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"><option value="product">Auto Product Banner</option><option value="custom">Custom Designed Banner</option></select></label>
                {slide.type==='product'?<label className="text-[10px] font-bold text-neutral-400">Product<select value={slide.product_id||''} onChange={(e)=>patch(slide.id,{product_id:e.target.value,link_value:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"><option value="">Choose product...</option>{products.filter((p)=>p.status!=='Draft').map((p)=><option key={p.id} value={p.id}>{p.sku} — {p.name_en}</option>)}</select></label>:<label className="text-[10px] font-bold text-neutral-400">Banner Image<input type="file" accept="image/*" onChange={(e)=>void upload(slide.id,e.target.files?.[0])} className="mt-1 block w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-[10px] text-neutral-300"/><span className="mt-1 block text-[9px] font-normal text-neutral-600">{uploadingId===slide.id?'Uploading...':'Upload your finished banner design.'}</span></label>}
              </div>
              {slide.type==='product'&&<label className="block text-[10px] font-bold text-neutral-400">Optional custom banner image (leave empty to use product image)<input type="file" accept="image/*" onChange={(e)=>void upload(slide.id,e.target.files?.[0])} className="mt-1 block w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-[10px] text-neutral-300"/></label>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-[10px] font-bold text-neutral-400">Small Label EN<input value={slide.tag_en||''} onChange={(e)=>patch(slide.id,{tag_en:e.target.value})} placeholder="GREAT DEALS" className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
                <label className="text-[10px] font-bold text-neutral-400">Small Label SI<input value={slide.tag_si||''} onChange={(e)=>patch(slide.id,{tag_si:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
                <label className="text-[10px] font-bold text-neutral-400">Title EN<input value={slide.title_en||''} onChange={(e)=>patch(slide.id,{title_en:e.target.value})} placeholder={slide.type==='product'?'Blank = product name':'Banner title'} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
                <label className="text-[10px] font-bold text-neutral-400">Title SI<input value={slide.title_si||''} onChange={(e)=>patch(slide.id,{title_si:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
                <label className="text-[10px] font-bold text-neutral-400">Subtitle EN<textarea rows={2} value={slide.sub_en||''} onChange={(e)=>patch(slide.id,{sub_en:e.target.value})} placeholder={slide.type==='product'?'Blank = product description':'Optional subtitle'} className="mt-1 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
                <label className="text-[10px] font-bold text-neutral-400">Subtitle SI<textarea rows={2} value={slide.sub_si||''} onChange={(e)=>patch(slide.id,{sub_si:e.target.value})} className="mt-1 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
                <label className="text-[10px] font-bold text-neutral-400">Button EN<input value={slide.button_en||''} onChange={(e)=>patch(slide.id,{button_en:e.target.value})} placeholder="Shop Now" className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
                <label className="text-[10px] font-bold text-neutral-400">Button SI<input value={slide.button_si||''} onChange={(e)=>patch(slide.id,{button_si:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
              </div>
              {slide.type==='custom'&&<div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-[10px] font-bold text-neutral-400">Button Action<select value={slide.link_type||'products'} onChange={(e)=>patch(slide.id,{link_type:e.target.value as any})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"><option value="products">All Products</option><option value="category">Category</option><option value="product">Product</option><option value="url">Custom URL</option></select></label>{slide.link_type==='category'?<label className="text-[10px] font-bold text-neutral-400">Category<select value={slide.link_value||''} onChange={(e)=>patch(slide.id,{link_value:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"><option value="">Choose...</option>{categories.map((c)=><option key={c.id} value={c.slug}>{c.name_en}</option>)}<option value="combo-pack">Combo Pack</option></select></label>:slide.link_type==='product'?<label className="text-[10px] font-bold text-neutral-400">Product<select value={slide.link_value||''} onChange={(e)=>patch(slide.id,{link_value:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"><option value="">Choose...</option>{products.map((p)=><option key={p.id} value={p.id}>{p.sku} — {p.name_en}</option>)}</select></label>:slide.link_type==='url'?<label className="text-[10px] font-bold text-neutral-400">URL<input value={slide.link_value||''} onChange={(e)=>patch(slide.id,{link_value:e.target.value})} placeholder="/shop" className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>:<div/>}</div>}
              {canNotify&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-500/20 bg-orange-500/5 p-3"><label className="flex items-center gap-2 text-[10px] font-black text-orange-200"><input type="checkbox" checked={Boolean(notifyOnNextSave[slide.id])} onChange={(e)=>setNotifyOnNextSave((prev)=>({...prev,[slide.id]:e.target.checked}))} className="accent-orange-500"/><Bell className="h-3.5 w-3.5"/>Notify customers about this banner</label><button type="button" disabled={!notifyOnNextSave[slide.id]} onClick={()=>void sendNotification(slide)} className="rounded-lg bg-orange-500 px-3 py-2 text-[10px] font-black text-black disabled:opacity-40">Publish Notification</button></div>}
            </div>
            <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-black min-h-[220px] relative">
              {previewImage?<img src={previewImage} alt="banner preview" className="absolute inset-0 h-full w-full object-cover opacity-55"/>:<div className="absolute inset-0 flex items-center justify-center text-neutral-700"><ImageIcon className="h-10 w-10"/></div>}
              <div className="relative z-10 flex min-h-[220px] flex-col justify-end p-5 text-white"><p className="text-[9px] font-black uppercase tracking-wider text-orange-300">{slide.tag_en|| (slide.type==='product'?'PRODUCT PICK':'O-RA')}</p><p className="mt-2 text-xl font-black leading-tight">{previewTitle}</p>{previewSub&&<p className="mt-2 line-clamp-2 text-[11px] text-neutral-200">{previewSub}</p>}{product&&slide.type==='product'&&<p className="mt-2 text-lg font-black text-orange-300">Rs. {displayUnitPrice(product,settings).toLocaleString()}</p>}<span className="mt-3 w-fit rounded-full bg-white px-4 py-2 text-[10px] font-black text-black">{slide.button_en||'Shop Now'}</span></div>
            </div>
          </div>
        </div>;
      })}
      {!slides.length&&<div className="rounded-3xl border border-dashed border-fuchsia-500/30 p-10 text-center text-xs text-fuchsia-300">No banners. Add an Auto Product or Custom Banner.</div>}
    </div>
  </div>;
};
