import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Zap,
  ShieldCheck,
  Truck,
  Bot,
  ChevronRight,
  ChevronLeft,
  Pin,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { displayUnitPrice } from '../lib/productVariants';
import { formatLkr } from '../lib/currency';
import { HeroBannerSlide } from '../types';

interface HeroBannerProps {
  onBrowseAll: () => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({ onBrowseAll }) => {
  const { language, setSelectedCategorySlug, products, settings, setSelectedProduct } = useStore();
  const [slideIndex, setSlideIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const legacySlide: HeroBannerSlide = {
    id:'legacy-main-banner', type:'custom', enabled:true, order:1,
    image:settings.hero_banner_image || '/src/assets/images/ora_hero_banner_1786042346918.jpg',
    tag_en:settings.hero_banner_tag_en || 'Season Sale', tag_si:settings.hero_banner_tag_si || 'සමකාලීන වට්ටම්',
    title_en:settings.hero_banner_title_en || 'Premium Quality. Crafted for You.', title_si:settings.hero_banner_title_si || 'ශ්‍රී ලංකාවේ උසස්ම සුඛෝපභෝගී භාණ්ඩ එකතුව',
    sub_en:settings.hero_banner_sub_en || 'Explore useful everyday products with Cash on Delivery.', sub_si:settings.hero_banner_sub_si || 'ප්‍රයෝජනවත් භාණ්ඩ පහසුවෙන් ඇණවුම් කරන්න.',
    button_en:settings.hero_banner_button_en || 'Shop Collection', button_si:settings.hero_banner_button_si || 'දැන්ම මිලදී ගන්න',
    link_type:'products', link_value:'',
  };

  const activeSlides = useMemo(() => {
    const source = Array.isArray(settings.hero_banners) && settings.hero_banners.length ? settings.hero_banners : [legacySlide];
    const rows = source.filter((slide)=>slide.enabled !== false).sort((a,b)=>Number(a.order||0)-Number(b.order||0)).slice(0,10);
    return rows.length ? rows : [legacySlide];
  }, [settings.hero_banners, settings.hero_banner_image, settings.hero_banner_tag_en, settings.hero_banner_tag_si, settings.hero_banner_title_en, settings.hero_banner_title_si, settings.hero_banner_sub_en, settings.hero_banner_sub_si, settings.hero_banner_button_en, settings.hero_banner_button_si]);

  useEffect(() => { if (slideIndex >= activeSlides.length) setSlideIndex(0); }, [activeSlides.length, slideIndex]);
  useEffect(() => {
    if (paused || activeSlides.length <= 1) return;
    const timer = window.setInterval(() => setSlideIndex((index)=>(index+1)%activeSlides.length), 5200);
    return () => window.clearInterval(timer);
  }, [activeSlides.length, paused]);

  const slide = activeSlides[slideIndex] || activeSlides[0];
  const slideProduct = slide?.type === 'product' ? products.find((product)=>product.id===slide.product_id) : undefined;
  const heroImage = slide?.image || slideProduct?.images?.[0] || legacySlide.image || '';
  const isProductBanner = slide?.type === 'product';
  const heroTag = language === 'si'
    ? (slide?.tag_si || slide?.tag_en || (isProductBanner ? 'විශේෂ භාණ්ඩය' : ''))
    : (slide?.tag_en || (isProductBanner ? 'PRODUCT PICK' : ''));
  const heroTitle = language === 'si'
    ? (slide?.title_si || slide?.title_en || (isProductBanner ? (slideProduct?.name_si || slideProduct?.name_en || '') : ''))
    : (slide?.title_en || (isProductBanner ? (slideProduct?.name_en || '') : ''));
  const heroSub = language === 'si'
    ? (slide?.sub_si || slide?.sub_en || (isProductBanner ? (slideProduct?.description_si || slideProduct?.description_en || '') : ''))
    : (slide?.sub_en || (isProductBanner ? (slideProduct?.description_en || '') : ''));
  const heroButton = language === 'si'
    ? (slide?.button_si || slide?.button_en || (isProductBanner ? 'දැන් බලන්න' : ''))
    : (slide?.button_en || (isProductBanner ? 'Shop Now' : ''));
  const hasBannerOverlay = Boolean(heroTag || heroTitle || heroSub || heroButton || isProductBanner);

  const goSlide = (direction:-1|1) => setSlideIndex((index)=>(index+direction+activeSlides.length)%activeSlides.length);
  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setPaused(true);
  };
  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    setPaused(false);
    const touch = event.changedTouches[0];
    if (!start || !touch || activeSlides.length <= 1) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    goSlide(deltaX < 0 ? 1 : -1);
  };
  const handleTouchCancel = () => {
    touchStartRef.current = null;
    setPaused(false);
  };
  const openSlide = () => {
    if (slide?.type === 'product' && slideProduct) { setSelectedProduct(slideProduct); return; }
    const type=slide?.link_type || 'products'; const value=slide?.link_value || '';
    if (type === 'product') { const target=products.find((product)=>product.id===value); if(target){setSelectedProduct(target);return;} }
    if (type === 'category') { setSelectedCategorySlug(value || null); window.setTimeout(()=>document.getElementById('products-section')?.scrollIntoView({behavior:'smooth'}),50); return; }
    if (type === 'url' && value) { if(/^https:\/\//i.test(value)||value.startsWith('/')) window.location.assign(value); return; }
    onBrowseAll();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="lg:col-span-2 relative bg-black rounded-3xl overflow-hidden flex flex-col justify-between p-6 sm:p-8 min-h-[280px] sm:min-h-[340px] text-white group shadow-sm touch-pan-y"
          onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchCancel}
        >
          {hasBannerOverlay && <div className="absolute top-0 right-0 p-8 opacity-10 text-8xl sm:text-9xl font-black select-none pointer-events-none">O-RA</div>}
          {heroImage && <img src={heroImage} alt={heroTitle || 'O-RA Promotional Banner'} className={`absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 pointer-events-none ${hasBannerOverlay?'opacity-45':'opacity-100'}`} referrerPolicy="no-referrer" />}
          {hasBannerOverlay && <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-black/10 pointer-events-none" />}

          <div className="relative z-10 flex items-center justify-between gap-3">
            {heroTag ? <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-orange-600 text-white text-[11px] font-bold uppercase tracking-wider"><Sparkles className="w-3 h-3"/><span>{heroTag}</span></span> : <span/>}
            {slideProduct && <span className="rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[11px] font-black text-orange-300 backdrop-blur-sm">Rs. {formatLkr(displayUnitPrice(slideProduct,settings))}</span>}
          </div>

          <div className="relative z-10 space-y-3 mt-6 max-w-2xl">
            {heroTitle && <h1 className="text-2xl sm:text-4xl font-extrabold leading-tight tracking-tight">{heroTitle}</h1>}
            {heroSub && <p className="text-xs sm:text-sm text-gray-200 max-w-xl line-clamp-3">{heroSub}</p>}
            {heroButton && <div className="pt-2"><button onClick={openSlide} className="bg-white text-black text-xs sm:text-sm font-bold py-3 px-8 rounded-full hover:bg-orange-600 hover:text-white transition-colors flex items-center space-x-2 shadow-lg"><span>{heroButton}</span><ChevronRight className="w-4 h-4"/></button></div>}
          </div>

          {activeSlides.length > 1 && <>
            <button type="button" aria-label="Previous banner" onClick={()=>goSlide(-1)} className="hidden md:block absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/15 bg-black/35 p-2 text-white opacity-90 backdrop-blur-sm hover:bg-black/65"><ChevronLeft className="h-5 w-5"/></button>
            <button type="button" aria-label="Next banner" onClick={()=>goSlide(1)} className="hidden md:block absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/15 bg-black/35 p-2 text-white opacity-90 backdrop-blur-sm hover:bg-black/65"><ChevronRight className="h-5 w-5"/></button>
            <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5">{activeSlides.map((row,index)=><button key={row.id} type="button" aria-label={`Banner ${index+1}`} onClick={()=>setSlideIndex(index)} className={`h-2 rounded-full transition-all ${index===slideIndex?'w-6 bg-orange-500':'w-2 bg-white/65 hover:bg-white'}`}/>)}</div>
          </>}
        </div>

        <div className="bg-gray-100 border border-gray-200 rounded-3xl p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between mb-4"><span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Why Choose O-RA</span><span className="w-2 h-2 rounded-full bg-orange-300" /></div>
            <div className="p-5 bg-orange-50 rounded-2xl border border-orange-100"><p className="text-sm font-bold text-gray-900">{language === 'si' ? 'පහසු සහ විශ්වාසදායක මිලදී ගැනීමක්' : 'A Better Way to Shop'}</p><p className="text-[11px] leading-relaxed text-gray-600 mt-2">Carefully selected everyday products at fair prices, with a simple and reliable shopping experience.</p></div>
            <div className="grid grid-cols-3 gap-2 mt-4"><div className="bg-white border border-gray-200/80 rounded-xl px-2 py-3 text-center"><p className="text-[10px] font-bold text-gray-800">{language === 'si' ? 'පහසු මිලදී ගැනීම' : 'Easy Shopping'}</p></div><div className="bg-white border border-gray-200/80 rounded-xl px-2 py-3 text-center"><p className="text-[10px] font-bold text-gray-800">{language === 'si' ? 'ප්‍රයෝජනවත් භාණ්ඩ' : 'Useful Products'}</p></div><div className="bg-white border border-gray-200/80 rounded-xl px-2 py-3 text-center"><p className="text-[10px] font-bold text-gray-800">{language === 'si' ? 'හිතවත් සහාය' : 'Friendly Support'}</p></div></div>
          </div>
          <div className="w-full rounded-2xl border border-orange-200 bg-white px-4 py-3.5 shadow-sm"><div className="flex items-start gap-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Pin className="h-4 w-4" aria-hidden="true" /></div><div className="min-w-0"><p className="text-[12px] font-extrabold leading-snug text-gray-900">Order multiple products together — add each item to your Cart, then checkout once.</p><p lang="si" className="mt-1.5 text-[12px] font-extrabold leading-[1.7] text-gray-800" style={{fontFamily:"'Noto Sans Sinhala', sans-serif"}}>භාණ්ඩ කිහිපයක් එකවර ඇණවුම් කළ හැක. අවශ්‍ය භාණ්ඩ Cart එකට එක් කර අවසානයේ එක්වර Checkout කරන්න.</p></div></div></div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center space-x-3 shadow-xs hover:border-gray-200 transition-all"><div className="p-2.5 rounded-xl bg-orange-50 text-orange-600 shrink-0"><Truck className="w-5 h-5" /></div><div><p className="text-xs font-bold text-gray-900">{settings.free_delivery_enabled ? 'FREE Islandwide Delivery' : `Flat Rs. ${formatLkr(settings.delivery_fee || 0)} Delivery`}</p><p className="text-[10px] text-gray-500">{settings.free_delivery_enabled ? 'No Delivery Fee • Islandwide' : 'Islandwide Express Dispatch'}</p></div></div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center space-x-3 shadow-xs hover:border-gray-200 transition-all"><div className="p-2.5 rounded-xl bg-orange-50 text-orange-600 shrink-0"><ShieldCheck className="w-5 h-5" /></div><div><p className="text-xs font-bold text-gray-900">100% Genuine</p><p className="text-[10px] text-gray-500">Quality Verified Products</p></div></div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center space-x-3 shadow-xs hover:border-gray-200 transition-all"><div className="p-2.5 rounded-xl bg-orange-50 text-orange-600 shrink-0"><Zap className="w-5 h-5" /></div><div><p className="text-xs font-bold text-gray-900">COD &amp; Bank Transfer</p><p className="text-[10px] text-gray-500">Flexible Payment Options</p></div></div>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('ora:assistant-open'))} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center space-x-3 shadow-xs hover:border-orange-200 transition-all text-left"><div className="p-2.5 rounded-xl bg-orange-50 text-orange-600 shrink-0"><Bot className="w-5 h-5" /></div><div><p className="text-xs font-bold text-gray-900">24/7 O-RA Assistant</p><p className="text-[10px] text-gray-500">සිංහල • English • தமிழ்</p></div></button>
      </div>
    </div>
  );
};