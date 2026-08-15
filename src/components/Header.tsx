import React, { useState } from 'react';
import {
  Search,
  ShoppingBag,
  Package,
  ShieldCheck,
  Globe,
  Store,
  Sparkles,
  Menu,
  X,
  PhoneCall,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTranslation } from '../lib/i18n';
import { productSearchScore } from '../lib/productSearch';
import { InstallAppButton } from './InstallAppButton';
import { CustomerAccountButton } from './CustomerAccount';
import { CustomerNotifications } from './CustomerNotifications';

export const Header: React.FC = () => {
  const {
    language,
    setLanguage,
    searchQuery,
    setSearchQuery,
    cartItemCount,
    cartSubtotal,
    cartSpecialOfferDiscount,
    cartFinalProductsTotal,
    setIsCartOpen,
    setIsTrackingOpen,
    isAdminView,
    setIsAdminView,
    adminUser,
    products,
    categories,
    setSelectedProduct,
    settings,
  } = useStore();

  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const configuredAnnouncement =
    language === 'si'
      ? settings.top_announcement_si || settings.top_announcement_en || ''
      : settings.top_announcement_en || '';

  const deliveryFee = Math.max(0, Number(settings.delivery_fee || 0));
  const deliveryStatusText =
    language === 'si'
      ? settings.free_delivery_enabled
        ? 'දිවයින පුරා නොමිලේ බෙදාහැරීම'
        : `දිවයිනටම බෙදාහැරීම රු. ${deliveryFee.toLocaleString()}`
      : settings.free_delivery_enabled
        ? 'Islandwide FREE Delivery'
        : `Islandwide Delivery Rs. ${deliveryFee.toLocaleString()}`;

  // Keep any custom non-delivery announcement parts, but always generate the
  // delivery part from the current Store Settings so an old fixed fee can
  // never remain visible after Free Delivery is switched on/off.
  const customAnnouncementParts = configuredAnnouncement
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/delivery/i.test(part) && !/බෙදාහැරීම|බෙදා හැරීම/.test(part));

  const announcementText = [deliveryStatusText, ...customAnnouncementParts].join(' | ');

  const phoneNumber = settings.hotline_number || settings.top_banner_phone || '';
  const showTopBar = settings.top_banner_active !== false;
  const goTo = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setMobileMenuOpen(false);
    if (path === '/shop' || path === '/') window.setTimeout(() => document.getElementById('products-section')?.scrollIntoView({ behavior: 'smooth' }), 50);
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const navItems = [
    { path:'/', en:'Home', si:'මුල් පිටුව', enabled:true },
    { path:'/shop', en:'Shop', si:'භාණ්ඩ', enabled:true },
    { path:'/return-refund', en:'Return & Refund', si:'Return / Refund', enabled:settings.return_policy_page_enabled !== false },
    { path:'/contact', en:'Contact Us', si:'අප අමතන්න', enabled:settings.contact_page_enabled !== false },
    { path:'/about', en:'About Us', si:'අප ගැන', enabled:settings.about_page_enabled !== false },
    { path:'/privacy', en:'Privacy Policy', si:'Privacy Policy', enabled:settings.privacy_page_enabled !== false },
    { path:'/terms', en:'Terms & Conditions', si:'Terms & Conditions', enabled:settings.terms_page_enabled !== false },
  ].filter(x=>x.enabled);

  // Smart autocomplete: names, descriptions, category, brand, SKU and admin search keywords.
  const searchResults = searchQuery.trim()
    ? products
        .map((p) => ({ product: p, score: productSearchScore(p, searchQuery, categories) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((row) => row.product)
    : [];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-gray-100 text-gray-900">
      {/* Top Bar Announcement */}
      {showTopBar && (
        <div className="bg-black text-white font-semibold">
          {/* Mobile: show guarantee + hotline on first row, announcement on second row */}
          <div className="md:hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[10px] sm:text-[11px] border-b border-white/10">
              <div className="flex items-center gap-1.5 min-w-0">
                <ShieldCheck className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="truncate">100% Genuine Quality Guaranteed</span>
              </div>
              {phoneNumber && <a
                href={`tel:${phoneNumber.replace(/\s+/g, '')}`}
                className="flex items-center gap-1.5 whitespace-nowrap hover:text-orange-400"
              >
                <PhoneCall className="w-3.5 h-3.5 shrink-0" />
                <span>{phoneNumber}</span>
              </a>}
            </div>
            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] sm:text-[11px] text-center leading-tight">
              <Sparkles className="w-3.5 h-3.5 text-orange-500 animate-pulse shrink-0" />
              <span>{announcementText}</span>
            </div>
          </div>

          {/* Desktop: keep the existing single-row layout */}
          <div className="hidden md:flex text-xs py-1.5 px-4 text-center items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-3.5 h-3.5 text-orange-500" />
              <span>{getTranslation(language, 'guarantee')}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Sparkles className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
              <span>{announcementText}</span>
            </div>
            <div className="flex items-center space-x-3">
              {phoneNumber && <a
                href={`tel:${phoneNumber.replace(/\s+/g, '')}`}
                className="hover:text-orange-400 flex items-center space-x-1"
              >
                <PhoneCall className="w-3 h-3" />
                <span>{phoneNumber}</span>
              </a>}
            </div>
          </div>
        </div>
      )}

      {/* Main Header Container */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-10 py-3">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand Logo & Name */}
          <div className="flex items-center space-x-3 shrink-0">
            <button
              onClick={() => {
                setIsAdminView(false);
                goTo('/');
              }}
              className="flex items-center space-x-3 group text-left shrink-0"
            >
              {(settings.mobile_logo || settings.website_logo) ? (
                <>
                  <img
                    src={settings.mobile_logo || settings.website_logo}
                    alt={settings.brand_store_name || 'O-RA'}
                    className="sm:hidden object-contain object-left shrink-0"
                    style={{
                      width: `${Math.max(80, Math.min(180, Number(settings.mobile_logo_width || 130)))}px`,
                      maxWidth: '46vw',
                      minWidth: `${Math.min(120, Math.max(80, Number(settings.mobile_logo_width || 130)))}px`,
                      flexShrink: 0,
                      maxHeight: `${Math.max(32, Math.min(64, Number(settings.mobile_logo_max_height || 52)))}px`,
                      height: 'auto',
                    }}
                  />
                  <img
                    src={settings.website_logo || settings.mobile_logo}
                    alt={settings.brand_store_name || 'O-RA'}
                    className="hidden sm:block object-contain object-left"
                    style={{
                      width: `${Math.max(120, Math.min(280, Number(settings.desktop_logo_width || 190)))}px`,
                      maxHeight: '60px',
                      height: 'auto',
                    }}
                  />
                </>
              ) : (
                <div className="text-2xl font-black tracking-tighter text-black">
                  {settings.brand_store_name || 'O-RA'}
                </div>
              )}
              <span className="hidden sm:inline-block text-[10px] uppercase tracking-widest text-gray-400 font-bold border-l border-gray-200 pl-3">
                {settings.brand_tagline || 'Online Store'}
              </span>
            </button>

          </div>

          {/* Search Bar - Center */}
          <div className="relative flex-1 max-w-xl lg:max-w-2xl mx-2 hidden sm:block">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                placeholder={getTranslation(language, 'searchPlaceholder')}
                className="w-full bg-gray-100 border-none rounded-full py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-orange-500/20 focus:outline-none transition-all"
              />
              <Search className="w-4 h-4 text-gray-400 absolute left-4 top-2.5" />
            </div>

            {/* Instant Search Autocomplete Dropdown */}
            {isSearchFocused && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden z-50 divide-y divide-gray-100">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProduct(p);
                      setSearchQuery('');
                    }}
                    className="w-full p-2.5 flex items-center space-x-3 hover:bg-gray-50 text-left transition-colors"
                  >
                    <img
                      src={p.images[0]}
                      alt={p.name_en}
                      className="w-10 h-10 object-cover rounded-lg border border-gray-200"
                      referrerPolicy="no-referrer"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">
                        {language === 'si' ? p.name_si : p.name_en}
                      </p>
                      <p className="text-[11px] text-orange-600 font-bold">
                        Rs. {(((p.discount_enabled !== false && p.discount_price && p.discount_price < p.selling_price ? p.discount_price : p.selling_price)) + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0)).toLocaleString()}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-1 sm:space-x-3 shrink-0">
            <div className="hidden lg:block"><InstallAppButton /></div>
            <div className="lg:hidden"><InstallAppButton compact /></div>
            <CustomerAccountButton />
            <CustomerNotifications />
            {/* Language Switcher */}
            <button
              onClick={() => setLanguage(language === 'en' ? 'si' : 'en')}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-full bg-gray-100 text-xs font-bold text-gray-600 hover:text-black transition-colors"
              title="Switch Language"
            >
              <Globe className="w-3.5 h-3.5 text-gray-400" />
              <span><span className={language === 'en' ? 'text-black' : ''}>EN</span> / <span className={language === 'si' ? 'text-black' : ''}>සිං</span></span>
            </button>

            {/* Track Order Button */}
            <button
              onClick={() => setIsTrackingOpen(true)}
              className="hidden md:flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-gray-100 text-xs font-bold text-gray-600 hover:text-black transition-colors"
            >
              <Package className="w-3.5 h-3.5 text-gray-400" />
              <span>{getTranslation(language, 'trackOrder')}</span>
            </button>

            {adminUser && !isAdminView && (
              <button
                type="button"
                onClick={() => { setIsAdminView(true); goTo('/system'); }}
                className="hidden md:flex items-center gap-1.5 rounded-full bg-black px-3.5 py-1.5 text-xs font-bold text-white hover:bg-orange-600 transition-colors"
                title="Return to O-RA System"
              >
                <Store className="w-3.5 h-3.5 text-orange-400" />
                <span>Back to Manager</span>
              </button>
            )}

            {/* Desktop My Basket with compact hover summary */}
            <div className="relative hidden sm:block group">
              <button
                onClick={() => setIsCartOpen(true)}
                className={`relative flex items-center gap-2 rounded-full border px-3 py-2 transition-all duration-200 ${
                  cartItemCount > 0
                    ? 'bg-orange-600 border-orange-600 text-white shadow-lg shadow-orange-200 ring-2 ring-orange-100 hover:bg-orange-700'
                    : 'bg-orange-50 border-orange-200 text-orange-700 shadow-sm hover:bg-orange-100 hover:border-orange-300'
                }`}
                title="My Basket"
              >
                <ShoppingBag className="w-5 h-5" />
                <span className="hidden lg:inline text-xs font-black">My Basket</span>
                {cartItemCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-black text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center rounded-full font-black border-2 border-white">
                    {cartItemCount}
                  </span>
                )}
              </button>

              <div className="invisible absolute right-0 top-full z-[70] w-72 pt-2 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100">
                <div className="rounded-2xl border border-gray-200 bg-white p-4 text-gray-900 shadow-2xl">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-black">My Basket</p>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-600">{cartItemCount} item{cartItemCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>Rs. {cartSubtotal.toLocaleString()}</span></div>
                    <div className="flex justify-between text-emerald-700"><span>Offer Saving</span><span>- Rs. {cartSpecialOfferDiscount.toLocaleString()}</span></div>
                    <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-black"><span>Total</span><span>Rs. {cartFinalProductsTotal.toLocaleString()}</span></div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCartOpen(true)}
                    className="mt-3 w-full rounded-xl bg-black px-3 py-2.5 text-xs font-black text-white hover:bg-orange-600"
                  >
                    View Basket
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile basket stays icon-only */}
            <button
              onClick={() => setIsCartOpen(true)}
              className={`relative sm:hidden p-2.5 rounded-full border transition-all duration-200 ${
                cartItemCount > 0
                  ? 'bg-orange-600 border-orange-600 text-white shadow-lg shadow-orange-200 ring-2 ring-orange-100'
                  : 'bg-orange-50 border-orange-200 text-orange-600 shadow-sm'
              }`}
              title="My Basket"
            >
              <ShoppingBag className="w-5 h-5" />
              {cartItemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-black text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center rounded-full font-black border-2 border-white">
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Search Bar Row */}
        <div className="mt-2.5 sm:hidden relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
            placeholder={getTranslation(language, 'searchPlaceholder')}
            className="w-full bg-gray-100 border-none rounded-full py-2 pl-9 pr-4 text-xs text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-orange-500/20"
          />
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />

          {/* Mobile Search Results */}
          {isSearchFocused && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 divide-y divide-gray-100">
              {searchResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedProduct(p);
                    setSearchQuery('');
                  }}
                  className="w-full p-2 flex items-center space-x-3 text-left"
                >
                  <img
                    src={p.images[0]}
                    alt={p.name_en}
                    className="w-8 h-8 object-cover rounded-lg"
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">{p.name_en}</p>
                    <p className="text-[10px] text-orange-600 font-bold">
                      Rs. {(((p.discount_enabled !== false && p.discount_price && p.discount_price < p.selling_price ? p.discount_price : p.selling_price)) + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0)).toLocaleString()}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="mt-3 border-t border-gray-100 pt-2" aria-label="Store pages">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {navItems.map(item => (
              <button key={item.path} type="button" onClick={()=>goTo(item.path)} className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold text-gray-600 hover:bg-orange-50 hover:text-orange-700">
                {language==='si' ? item.si : item.en}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
};
