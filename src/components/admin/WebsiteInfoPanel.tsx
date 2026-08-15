import React, { useState } from 'react';
import { Building2, ExternalLink, FileText, Image as ImageIcon, Save, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { StoreSettings } from '../../types';
import { compressImageFile, uploadPublicImage } from '../../lib/imageUpload';
import { initialSettings } from '../../data/initialData';

export const WebsiteInfoPanel: React.FC<{ settings: StoreSettings; updateSettings: (patch: Partial<StoreSettings>) => void }> = ({ settings, updateSettings }) => {
  const [uploading, setUploading] = useState(false);
  const pageRows = [
    ['about_page_enabled','About Us'],['return_policy_page_enabled','Return & Refund'],['contact_page_enabled','Contact Us'],['privacy_page_enabled','Privacy Policy'],['terms_page_enabled','Terms & Conditions'],
  ] as const;
  const textRows = [
    ['about_page_en','about_page_si','About Us'],['return_policy_en','return_policy_si','Return & Refund Policy'],['contact_intro_en','contact_intro_si','Contact Intro'],['privacy_policy_en','privacy_policy_si','Privacy Policy'],['terms_conditions_en','terms_conditions_si','Terms & Conditions'],
  ] as const;

  const uploadBr = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compressImageFile(file, 1600, 0.86);
      const url = await uploadPublicImage(compressed, 'branding');
      updateSettings({ business_registration_copy_url: url });
    } catch (e:any) { alert(e?.message || 'BR image upload failed.'); }
    finally { setUploading(false); }
  };

  const resetWebsitePolicies = () => {
    if (!confirm('Reset Website Info & Policies text to the O-RA default templates? Business address, Hotline, WhatsApp, Email, branding and other Store Settings will NOT be changed.')) return;
    updateSettings({
      about_page_enabled: initialSettings.about_page_enabled,
      return_policy_page_enabled: initialSettings.return_policy_page_enabled,
      contact_page_enabled: initialSettings.contact_page_enabled,
      privacy_page_enabled: initialSettings.privacy_page_enabled,
      terms_page_enabled: initialSettings.terms_page_enabled,
      website_info_last_updated: new Date().toISOString().slice(0,10),
      about_page_en: initialSettings.about_page_en,
      about_page_si: initialSettings.about_page_si,
      return_policy_en: initialSettings.return_policy_en,
      return_policy_si: initialSettings.return_policy_si,
      contact_intro_en: initialSettings.contact_intro_en,
      contact_intro_si: initialSettings.contact_intro_si,
      privacy_policy_en: initialSettings.privacy_policy_en,
      privacy_policy_si: initialSettings.privacy_policy_si,
      terms_conditions_en: initialSettings.terms_conditions_en,
      terms_conditions_si: initialSettings.terms_conditions_si,
    });
  };


  return <div className="space-y-6">
    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3"><FileText className="mt-0.5 h-6 w-6 text-orange-600"/><div><h2 className="text-lg font-black text-gray-900">Website Information & Legal Pages</h2><p className="mt-1 text-xs leading-5 text-gray-500">Edit the public Sinhala / English pages without touching code. Keep information accurate and publish only what O-RA can actually provide.</p></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {pageRows.map(([key,label]) => <label key={key} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 p-3 text-xs font-bold text-gray-700"><span>{label}</span><input type="checkbox" checked={(settings[key] as boolean | undefined) !== false} onChange={e=>updateSettings({[key]:e.target.checked} as Partial<StoreSettings>)} className="h-4 w-4 accent-orange-500"/></label>)}
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block text-xs font-bold text-gray-700">Last Updated date<input type="date" value={settings.website_info_last_updated || ''} onChange={e=>updateSettings({website_info_last_updated:e.target.value})} className="mt-1 block rounded-xl border border-gray-200 px-3 py-2 text-sm"/></label>
        <button type="button" onClick={resetWebsitePolicies} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-black text-red-700"><Trash2 className="mr-1 inline h-4 w-4"/>Reset Website Info & Policies Only</button>
      </div>
      <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] leading-5 text-blue-800"><b>FULL LIVE START RESET does not erase these policy/page texts.</b> Address, Hotline, WhatsApp and Email are read live from Store Settings on the public pages, so changing those business details updates the customer-facing contact information automatically.</div>
    </div>

    {textRows.map(([enKey,siKey,title]) => <div key={title} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="font-black text-gray-900">{title}</h3>
      <p className="mt-1 text-[11px] text-gray-500">Customer-facing content. Blank lines create separate paragraphs.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="text-xs font-bold text-gray-700">English<textarea rows={8} value={String(settings[enKey] || '')} onChange={e=>updateSettings({[enKey]:e.target.value} as Partial<StoreSettings>)} className="mt-1 w-full rounded-2xl border border-gray-200 p-3 text-sm font-normal leading-6 outline-none focus:border-orange-400"/></label>
        <label className="text-xs font-bold text-gray-700">සිංහල<textarea rows={8} value={String(settings[siKey] || '')} onChange={e=>updateSettings({[siKey]:e.target.value} as Partial<StoreSettings>)} className="mt-1 w-full rounded-2xl border border-gray-200 p-3 text-sm font-normal leading-6 outline-none focus:border-orange-400"/></label>
      </div>
    </div>)}

    <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3"><Building2 className="mt-0.5 h-6 w-6 text-emerald-600"/><div><h3 className="font-black text-gray-900">Business Registration (Optional)</h3><p className="mt-1 text-xs leading-5 text-gray-500">Keep OFF until you have real registration details. When ON, the About page can show the registered name, number and a copy image.</p></div></div>
      <label className="mt-4 flex items-center gap-3 text-sm font-bold text-gray-800"><input type="checkbox" checked={Boolean(settings.business_registration_enabled)} onChange={e=>updateSettings({business_registration_enabled:e.target.checked})} className="h-5 w-5 accent-emerald-600"/>Show Business Registration on About page</label>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-bold text-gray-700">Registered Business Name<input value={settings.business_registration_name || ''} onChange={e=>updateSettings({business_registration_name:e.target.value})} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal"/></label>
        <label className="text-xs font-bold text-gray-700">Registration Number<input value={settings.business_registration_number || ''} onChange={e=>updateSettings({business_registration_number:e.target.value})} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal"/></label>
      </div>
      <div className="mt-4 rounded-2xl border border-dashed border-gray-300 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white"><Upload className="mr-1 inline h-4 w-4"/>{uploading?'Uploading…':'Upload BR Copy Image'}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e=>void uploadBr(e.target.files?.[0])}/></label>
          {settings.business_registration_copy_url && <><a href={settings.business_registration_copy_url} target="_blank" rel="noreferrer" className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700"><ExternalLink className="mr-1 inline h-4 w-4"/>Preview</a><button onClick={()=>updateSettings({business_registration_copy_url:''})} className="rounded-xl border border-red-200 px-4 py-2 text-xs font-bold text-red-600"><Trash2 className="mr-1 inline h-4 w-4"/>Remove</button></>}
        </div>
        {settings.business_registration_copy_url && <img src={settings.business_registration_copy_url} alt="Business registration copy" className="mt-4 max-h-72 rounded-2xl border border-gray-200 object-contain"/>}
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-[11px] text-emerald-800"><ShieldCheck className="h-4 w-4 shrink-0"/>Only publish genuine registration information. This section is OFF by default.</div>
    </div>

    <div className="rounded-2xl bg-gray-900 p-4 text-xs text-gray-300"><Save className="mr-2 inline h-4 w-4 text-orange-400"/>Changes save through the existing Store Settings system. No separate database or new login is used.</div>
  </div>;
};
