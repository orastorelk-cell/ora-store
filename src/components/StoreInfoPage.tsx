import React from 'react';
import { ArrowLeft, Bot, Building2, Mail, MapPin, Phone, ShieldCheck, ShoppingBag, MessageCircle } from 'lucide-react';
import { useStore } from '../context/StoreContext';

export type StoreInfoPageKind = 'return' | 'contact' | 'about' | 'privacy' | 'terms' | 'dataDeletion';

const PAGE_META: Record<StoreInfoPageKind, { en: string; si: string }> = {
  return: { en: 'Return & Refund Policy', si: 'Return සහ Refund ප්‍රතිපත්තිය' },
  contact: { en: 'Contact Us', si: 'අප අමතන්න' },
  about: { en: 'About Us', si: 'අප ගැන' },
  privacy: { en: 'Privacy Policy', si: 'පෞද්ගලිකත්ව ප්‍රතිපත්තිය' },
  terms: { en: 'Terms & Conditions', si: 'නියම සහ කොන්දේසි' },
  dataDeletion: { en: 'User Data Deletion', si: 'පරිශීලක දත්ත මකාදැමීම' },
};

const splitContent = (value: string) => String(value || '').split(/\n{2,}/).map(v => v.trim()).filter(Boolean);

const applyBusinessDetails = (value:string, settings:any) => String(value || '')
  .replace(/\{\{HOTLINE\}\}/gi, String(settings.hotline_number || ''))
  .replace(/\{\{WHATSAPP\}\}/gi, String(settings.whatsapp_number || settings.hotline_number || ''))
  .replace(/\{\{EMAIL\}\}/gi, String(settings.company_email || ''))
  .replace(/\{\{ADDRESS\}\}/gi, String(settings.company_address || ''));

const navHome = () => {
  window.history.pushState({}, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

export const StoreInfoPage: React.FC<{ kind: StoreInfoPageKind }> = ({ kind }) => {
  const { language, settings } = useStore();
  const si = language === 'si';
  const title = si ? PAGE_META[kind].si : PAGE_META[kind].en;
  const enabled = kind === 'dataDeletion' ? true
    : kind === 'return' ? settings.return_policy_page_enabled !== false
    : kind === 'contact' ? settings.contact_page_enabled !== false
    : kind === 'about' ? settings.about_page_enabled !== false
    : kind === 'privacy' ? settings.privacy_page_enabled !== false
    : settings.terms_page_enabled !== false;

  const dataDeletionContent = si
    ? `O-RA Store වෙත Facebook / Meta Lead Form එකක් හරහා ලබාදුන් ඔබගේ පුද්ගලික දත්ත මකාදැමීමට ඉල්ලීමක් කළ හැක.

දත්ත මකාදැමීම සඳහා අපගේ support email වෙත email එකක් එවන්න: {{EMAIL}}

Email Subject එක ලෙස “Facebook Data Deletion Request” යොදන්න. ඔබව නිවැරදිව හඳුනාගැනීමට ඔබ Lead Form එකේ භාවිතා කළ නම සහ phone number එක පමණක් සඳහන් කරන්න. Passwords, card details හෝ වෙනත් අනවශ්‍ය sensitive information එවන්න එපා.

ඉල්ලීම තහවුරු කළ පසු O-RA Store විසින් අපගේ Facebook lead/order records තුළ O-RA Store විසින් පාලනය කරන අදාළ පුද්ගලික දත්ත සාධාරණ කාලයක් තුළ මකාදැමීමට හෝ anonymize කිරීමට කටයුතු කරයි. නීතිමය, ගිණුම්කරණ, fraud-prevention හෝ dispute-resolution අවශ්‍යතා සඳහා තබාගැනීමට අවශ්‍ය දත්ත මෙයට යටත් නොවිය හැක.

ප්‍රශ්න සඳහා: {{EMAIL}}`
    : `You may request deletion of personal data that you submitted to O-RA Store through a Facebook / Meta Lead Form.

To request deletion, email our support address: {{EMAIL}}

Use the subject “Facebook Data Deletion Request”. To help us identify the correct record, include only the name and phone number you used on the Lead Form. Do not send passwords, card details, or other unnecessary sensitive information.

After we verify the request, O-RA Store will delete or anonymize the relevant personal data that O-RA Store controls in our Facebook lead/order records within a reasonable period. Some information may need to be retained where required for legal, accounting, fraud-prevention, or dispute-resolution purposes.

Questions: {{EMAIL}}`;

  const rawContent = kind === 'dataDeletion' ? dataDeletionContent
    : kind === 'return' ? (si ? settings.return_policy_si : settings.return_policy_en)
    : kind === 'contact' ? (si ? settings.contact_intro_si : settings.contact_intro_en)
    : kind === 'about' ? (si ? settings.about_page_si : settings.about_page_en)
    : kind === 'privacy' ? (si ? settings.privacy_policy_si : settings.privacy_policy_en)
    : (si ? settings.terms_conditions_si : settings.terms_conditions_en);
  const content = applyBusinessDetails(String(rawContent || ''), settings);

  if (!enabled) {
    return <main className="mx-auto max-w-4xl px-4 py-16 text-center">
      <h1 className="text-2xl font-black text-gray-900">{title}</h1>
      <p className="mt-4 text-sm text-gray-500">{si ? 'මෙම පිටුව දැනට ප්‍රකාශයට පත් කර නැත.' : 'This page is not currently published.'}</p>
      <button onClick={navHome} className="mt-6 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-bold text-white"><ArrowLeft className="mr-2 inline h-4 w-4" />{si ? 'Store එකට යන්න' : 'Back to Store'}</button>
    </main>;
  }

  return (
    <main className="min-h-[70vh] bg-slate-50">
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="text-xs font-semibold text-gray-500">{si ? 'මුල් පිටුව' : 'Home'} / <span className="text-gray-900">{title}</span></div>
        <div className="mt-10 flex flex-col gap-3 sm:mt-14 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">O-RA STORE</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-5xl">{title}</h1>
          </div>
          {settings.website_info_last_updated && kind !== 'contact' && (
            <span className="w-fit rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700">
              {si ? 'අවසන් යාවත්කාලීන කිරීම' : 'Last Updated'}: {settings.website_info_last_updated}
            </span>
          )}
        </div>

        <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 lg:p-10">
          <div className="space-y-5 text-sm leading-7 text-slate-600 sm:text-[15px]">
            {splitContent(content || '').map((para, i) => <p key={i}>{para}</p>)}
          </div>

          {kind === 'contact' && (
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {settings.hotline_number && <a href={`tel:${settings.hotline_number.replace(/\s+/g, '')}`} className="rounded-2xl border border-slate-200 p-4 hover:border-orange-300"><Phone className="mb-2 h-5 w-5 text-orange-600"/><p className="text-xs font-black text-slate-900">{si ? 'දුරකථන' : 'Phone'}</p><p className="mt-1 text-sm text-slate-600">{settings.hotline_number}</p></a>}
              {settings.company_email && <a href={`mailto:${settings.company_email}`} className="rounded-2xl border border-slate-200 p-4 hover:border-orange-300"><Mail className="mb-2 h-5 w-5 text-orange-600"/><p className="text-xs font-black text-slate-900">Email</p><p className="mt-1 break-all text-sm text-slate-600">{settings.company_email}</p></a>}
              {settings.company_address && <div className="rounded-2xl border border-slate-200 p-4 sm:col-span-2"><MapPin className="mb-2 h-5 w-5 text-orange-600"/><p className="text-xs font-black text-slate-900">{si ? 'ලිපිනය' : 'Address'}</p><p className="mt-1 text-sm text-slate-600">{settings.company_address}</p></div>}
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('ora:assistant-open'))} className="rounded-2xl bg-orange-600 p-4 text-left text-white sm:col-span-2 hover:bg-orange-700"><Bot className="mb-2 h-5 w-5"/><p className="text-sm font-black">24/7 O-RA Assistant</p><p className="mt-1 text-xs text-orange-50">සිංහල • English • தமிழ்</p></button>
            </div>
          )}

          {kind === 'about' && settings.business_registration_enabled && (
            <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
              <div className="flex items-center gap-2 text-emerald-800"><Building2 className="h-5 w-5"/><h2 className="font-black">{si ? 'ව්‍යාපාර ලියාපදිංචි තොරතුරු' : 'Business Registration'}</h2></div>
              {settings.business_registration_name && <p className="mt-3 text-sm text-emerald-900"><b>{si ? 'නම' : 'Registered Name'}:</b> {settings.business_registration_name}</p>}
              {settings.business_registration_number && <p className="mt-1 text-sm text-emerald-900"><b>{si ? 'අංකය' : 'Registration No.'}:</b> {settings.business_registration_number}</p>}
              {settings.business_registration_copy_url && <a href={settings.business_registration_copy_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black text-white"><ShieldCheck className="mr-2 h-4 w-4"/>{si ? 'ලියාපදිංචි පිටපත බලන්න' : 'View Registration Copy'}</a>}
            </div>
          )}

          {kind !== 'contact' && (settings.hotline_number || settings.whatsapp_number || settings.company_email || settings.company_address) && (
            <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-wider text-slate-700">{si ? 'වත්මන් O-RA සම්බන්ධතා' : 'Current O-RA Business Contact'}</p>
              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                {settings.hotline_number && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-orange-600"/><span>{settings.hotline_number}</span></div>}
                {(settings.whatsapp_number || settings.hotline_number) && <div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-600"/><span>{settings.whatsapp_number || settings.hotline_number}</span></div>}
                {settings.company_email && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-blue-600"/><span className="break-all">{settings.company_email}</span></div>}
                {settings.company_address && <div className="flex items-start gap-2 sm:col-span-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500"/><span>{settings.company_address}</span></div>}
              </div>
            </div>
          )}

          <div className="mt-9 flex flex-wrap gap-3 border-t border-slate-100 pt-6">
            <button onClick={navHome} className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-black text-white"><ShoppingBag className="mr-2 inline h-4 w-4"/>{si ? 'භාණ්ඩ බලන්න' : 'Shop O-RA'}</button>
            {kind !== 'contact' && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('ora:assistant-open'))} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-black text-slate-700"><Bot className="mr-2 inline h-4 w-4"/>{si ? 'සහාය ලබාගන්න' : 'Get Help'}</button>}
          </div>
        </div>
      </section>
    </main>
  );
};
