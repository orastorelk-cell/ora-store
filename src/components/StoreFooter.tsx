import React from 'react';
import { Bot, Facebook, Headphones, Mail, MapPin, MessageCircle, PackageCheck, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';
import { useStore } from '../context/StoreContext';

const go = (path:string) => {
  window.history.pushState({},'',path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({top:0,behavior:'smooth'});
};

const digitsOnly = (value:string) => String(value || '').replace(/\D/g,'');

export const StoreFooter: React.FC = () => {
  const { settings, language, setSelectedCategorySlug } = useStore();
  const si=language==='si';
  const storeName=settings.brand_store_name||'O-RA';
  const ownerName=String(settings.business_registration_name||storeName).trim()||storeName;
  const whatsappDigits=digitsOnly(settings.whatsapp_number||'');
  const facebookUrl=String(settings.website_facebook_page_url || 'https://www.facebook.com/orastoreofficial').trim();

  const shop = (slug:string|null) => {
    go('/');
    setSelectedCategorySlug(slug);
    window.setTimeout(()=>document.getElementById('products-section')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
  };


  return <footer className="mt-16 border-t border-slate-200 bg-slate-50 text-slate-600">
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto grid max-w-none grid-cols-1 gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><Truck className="h-5 w-5"/></div>
          <div><p className="text-xs font-black text-slate-900">{si?'දිවයින පුරා බෙදාහැරීම':'Islandwide Delivery'}</p><p className="mt-0.5 text-[10px] text-slate-500">{settings.free_delivery_enabled ? (si?'දැනට Delivery FREE':'Free delivery currently available') : (si?'විශ්වාසදායක courier delivery':'Reliable courier delivery')}</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><Headphones className="h-5 w-5"/></div>
          <div><p className="text-xs font-black text-slate-900">24/7 O-RA Assistant</p><p className="mt-0.5 text-[10px] text-slate-500">සිංහල • English • தமிழ்</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><ShieldCheck className="h-5 w-5"/></div>
          <div><p className="text-xs font-black text-slate-900">{si?'Order Support':'Order Support'}</p><p className="mt-0.5 text-[10px] text-slate-500">{si?'Order tracking, returns සහ support':'Tracking, returns and customer help'}</p></div>
        </div>
      </div>
    </div>

    <div className="mx-auto max-w-none px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
      <div className="grid grid-cols-1 gap-9 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
        <div className="space-y-4 lg:pr-5">
          {settings.website_logo
            ? <img src={settings.website_logo} alt={storeName} className="h-14 w-auto max-w-[220px] object-contain"/>
            : <div className="text-3xl font-black tracking-tighter text-black">{storeName}</div>}
          <p className="max-w-xs text-[11px] leading-5 text-slate-500">{si
            ? 'තෝරාගත් භාණ්ඩ, Combo Packs සහ පහසු online ordering එක්ක ඔබට විශ්වාසයෙන් shopping කරන්න පුළුවන් O-RA Online Store.'
            : 'Shop selected products and combo packs with simple online ordering, islandwide delivery and O-RA customer support.'}</p>
          <div className="space-y-2 text-[11px]">
            {settings.company_email&&<a href={`mailto:${settings.company_email}`} className="flex items-start gap-2 hover:text-orange-600"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span>{settings.company_email}</span></a>}
            {settings.hotline_number&&<a href={`tel:${digitsOnly(settings.hotline_number)}`} className="flex items-start gap-2 hover:text-orange-600"><Headphones className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span>{settings.hotline_number}</span></a>}
            {settings.company_address&&<div className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span>{settings.company_address}</span></div>}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-900">{si?'Shop':'Shop'}</p>
          <button onClick={()=>shop(null)} className="block text-left text-[11px] hover:text-orange-600">{si?'සියලු භාණ්ඩ':'All Products'}</button>
          <button onClick={()=>shop('combo-pack')} className="block text-left text-[11px] hover:text-orange-600">Combo Packs</button>
          <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('ora:shop-newest'))} className="block text-left text-[11px] hover:text-orange-600">{si?'අලුත්ම භාණ්ඩ':'New Arrivals'}</button>
          <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('ora:shop-offers'))} className="block text-left text-[11px] hover:text-orange-600">{si?'විශේෂ Offers':'Special Offers'}</button>
          <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('ora:assistant-open'))} className="block text-left text-[11px] hover:text-orange-600">{si?'Order එක Track කරන්න':'Track an Order'}</button>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-900">Customer Support</p>
          <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('ora:assistant-open'))} className="flex items-center gap-2 text-left text-[11px] font-bold text-orange-600 hover:text-orange-700"><Bot className="h-3.5 w-3.5"/>24/7 O-RA Assistant</button>
          {whatsappDigits&&<a href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[11px] hover:text-orange-600"><MessageCircle className="h-3.5 w-3.5"/>{si?'Complaint / WhatsApp Support':'Complaint / WhatsApp Support'}</a>}
          {settings.contact_page_enabled!==false&&<button onClick={()=>go('/contact')} className="block text-left text-[11px] hover:text-orange-600">{si?'අප අමතන්න':'Contact Us'}</button>}
          {settings.return_policy_page_enabled!==false&&<button onClick={()=>go('/return-refund')} className="block text-left text-[11px] hover:text-orange-600">{si?'Return සහ Refund':'Return & Refund Policy'}</button>}
        </div>

        <div className="space-y-3">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-900">{si?'Information':'Information'}</p>
          {settings.about_page_enabled!==false&&<button onClick={()=>go('/about')} className="block text-left text-[11px] hover:text-orange-600">{si?'අප ගැන':'About Us'}</button>}
          {settings.privacy_page_enabled!==false&&<button onClick={()=>go('/privacy')} className="block text-left text-[11px] hover:text-orange-600">{si?'පෞද්ගලිකත්ව ප්‍රතිපත්තිය':'Privacy Policy'}</button>}
          {settings.terms_page_enabled!==false&&<button onClick={()=>go('/terms')} className="block text-left text-[11px] hover:text-orange-600">{si?'නියම සහ කොන්දේසි':'Terms & Conditions'}</button>}
          <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('ora:assistant-open'))} className="block text-left text-[11px] hover:text-orange-600">{si?'Order එක Track කරන්න':'Track an Order'}</button>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-900">Follow O-RA</p>
          <a href={facebookUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[11px] hover:text-orange-600"><Facebook className="h-4 w-4"/>Facebook</a>
          <button type="button" onClick={()=>shop(null)} className="flex items-center gap-2 text-left text-[11px] hover:text-orange-600"><ShoppingBag className="h-4 w-4"/>{si?'Shop O-RA':'Shop O-RA'}</button>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5"><PackageCheck className="h-4 w-4 text-orange-600"/><span className="text-[10px] font-semibold text-slate-600">{si?'Invoice එක සුරැකිව තබා ගන්න':'Keep your invoice for support & returns'}</span></div>
        </div>
      </div>

      <div className="mt-10 border-t border-slate-200 pt-5 text-[10px] leading-5 text-slate-500">
        <div className="space-y-1.5 md:hidden">
          <p>{si?'Online Store • Customer Support • Islandwide Delivery':'Online Store • Customer Support • Islandwide Delivery'}</p>
          <div className="space-y-0.5 pt-2">
            <p>© 2026 {storeName}. All rights reserved.</p>
            <p>Owned and Managed by {ownerName}</p>
            <p className="pt-1 font-semibold text-slate-400">Designed &amp; Developed by UDN</p>
          </div>
        </div>

        <div className="hidden md:grid md:grid-cols-3 md:items-center md:gap-6">
          <div className="text-left">
            <p>© 2026 {storeName}. All rights reserved.</p>
            <p className="mt-0.5">Owned and Managed by {ownerName}</p>
          </div>
          <p className="text-center font-semibold text-slate-400">Designed &amp; Developed by UDN</p>
          <p className="text-right">{si?'Online Store • Customer Support • Islandwide Delivery':'Online Store • Customer Support • Islandwide Delivery'}</p>
        </div>
      </div>
    </div>
  </footer>;
};
