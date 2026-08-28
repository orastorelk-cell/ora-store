import React from 'react';
import { StoreProvider, useStore } from './context/StoreContext';
import { Header } from './components/Header';
import { HeroBanner } from './components/HeroBanner';
import { ProductCard } from './components/ProductCard';
import { CatalogPriceRange, CatalogSortMode, ProductFilterBar } from './components/ProductFilterBar';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { ProductDetailModal } from './components/ProductDetailModal';
import { OrderTrackingModal } from './components/OrderTrackingModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import { OraAssistant } from './components/OraAssistant';
import { StoreInfoPage, StoreInfoPageKind } from './components/StoreInfoPage';
import { StoreFooter } from './components/StoreFooter';
import { ProductRequestSection } from './components/ProductRequestSection';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminLoginModal } from './components/admin/AdminLoginModal';
import { getTranslation } from './lib/i18n';
import { customerProductSearchScore } from './lib/productSearch';
import { activeVariants, displayUnitPrice, normalizedProductType } from './lib/productVariants';
import { Sparkles, ShieldCheck, Truck, Headphones, Flame } from 'lucide-react';

const CustomerStorefront: React.FC = () => {
  const {
    language,
    products,
    categories,
    selectedCategorySlug,
    setSelectedCategorySlug,
    searchQuery,
    setSearchQuery,
    isAdminView,
    setIsAdminView,
    adminUser,
    loginAdmin,
    staffUsers,
    settings,
    setSelectedProduct,
  } = useStore();
  const [storePath, setStorePath] = React.useState(() => window.location.pathname.replace(/\/+$/,'') || '/');

  React.useEffect(() => {
    const onPath = () => setStorePath(window.location.pathname.replace(/\/+$/,'') || '/');
    window.addEventListener('popstate', onPath);
    return () => window.removeEventListener('popstate', onPath);
  }, []);

  // Customer-notification deep link. Wait until the shared catalog contains the
  // exact product, then clear the one-shot query before opening the existing
  // Product Details modal so closing it returns to the normal storefront.
  React.useEffect(() => {
    if (isAdminView || storePath !== '/') return;
    const params = new URLSearchParams(window.location.search);
    const productId = String(params.get('product') || '').trim();
    if (!productId) return;
    const product = products.find((row) => row.id === productId && row.status !== 'Draft');
    if (!product) return;
    params.delete('product');
    const query = params.toString();
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', cleanUrl);
    setSelectedProduct(product);
  }, [isAdminView, products, setSelectedProduct, storePath]);

  React.useEffect(() => {
    document.title = isAdminView && adminUser ? 'O-RA Store System Manager' : 'O-RA Online Store';
    let icon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.type = 'image/png';
    icon.href = new URL('./assets/ora-favicon.png', import.meta.url).href;
  }, [isAdminView, adminUser?.id]);

  React.useEffect(() => {
    const canonicalAdminPath = '/system';
    const configuredLegacyPath = `/${String(settings.admin_secret_path || 'system')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g,'')}`;
    const syncPath = () => {
      const current = window.location.pathname.replace(/\/+$/,'') || '/';
      const isLegacyManagerPath = current === '/ora-manager' || (configuredLegacyPath !== canonicalAdminPath && current === configuredLegacyPath);
      if (isLegacyManagerPath) {
        window.history.replaceState({}, '', canonicalAdminPath);
        setStorePath(canonicalAdminPath);
        setIsAdminView(true);
        return;
      }
      setIsAdminView(current === canonicalAdminPath);
    };
    syncPath();
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, [settings.admin_secret_path, setIsAdminView]);

  // Lightweight first-party visitor analytics. A random browser ID is counted;
  // no IP address is stored. Staff/Admin storefront previews are excluded.
  React.useEffect(() => {
    if (isAdminView || adminUser || localStorage.getItem('ora_staff_session_token')) return;
    const publicPath = storePath || '/';
    if (publicPath === '/system' || publicPath === '/ora-manager') return;
    let visitorId = localStorage.getItem('ora_visitor_id') || '';
    if (!visitorId) {
      visitorId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `ora-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem('ora_visitor_id', visitorId);
    }
    const stampKey = `ora_analytics_stamp:${publicPath}`;
    const now = Date.now();
    const last = Number(sessionStorage.getItem(stampKey) || 0);
    if (now - last < 5000) return;
    sessionStorage.setItem(stampKey, String(now));
    fetch('/api/analytics/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, path: publicPath }),
      keepalive: true,
    }).catch(() => undefined);
  }, [storePath, isAdminView, adminUser?.id]);


  const PAGE_SIZE = 24;
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [sortMode, setSortMode] = React.useState<CatalogSortMode>('relevance');
  const [priceRange, setPriceRange] = React.useState<CatalogPriceRange>('all');

  const resetCatalogFilters = React.useCallback((scrollToProducts = false) => {
    setSelectedCategorySlug(null);
    setSearchQuery('');
    setPriceRange('all');
    setSortMode('relevance');
    setVisibleCount(PAGE_SIZE);
    if (scrollToProducts) {
      window.setTimeout(() => document.getElementById('products-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }, [setSearchQuery, setSelectedCategorySlug]);

  // Static footer SHOP links stay useful even while admin-created product categories grow.
  React.useEffect(() => {
    const newest = () => {
      setSelectedCategorySlug(null);
      setSearchQuery('');
      setPriceRange('all');
      setSortMode('newest');
      window.setTimeout(()=>document.getElementById('products-section')?.scrollIntoView({behavior:'smooth',block:'start'}),60);
    };
    const offers = () => {
      setSelectedCategorySlug(null);
      setSearchQuery('');
      setPriceRange('all');
      setSortMode('relevance');
      window.setTimeout(()=>{
        const target=document.getElementById('flash-deals-section') || document.getElementById('products-section');
        target?.scrollIntoView({behavior:'smooth',block:'start'});
      },60);
    };
    window.addEventListener('ora:shop-newest', newest);
    window.addEventListener('ora:shop-offers', offers);
    return () => {
      window.removeEventListener('ora:shop-newest', newest);
      window.removeEventListener('ora:shop-offers', offers);
    };
  }, [setSelectedCategorySlug, setSearchQuery]);

  // Price filters must use the exact customer-facing unit price, including the
  // hidden FREE-delivery reserve and each active variant's own price. A product
  // matches a range only when at least one purchasable selection is actually in it.
  const customerPrices = React.useCallback((product: typeof products[number]) => {
    if (normalizedProductType(product) === 'variant') {
      const rows = activeVariants(product).map((variant) => displayUnitPrice(product, settings, variant));
      return rows.length ? rows : [displayUnitPrice(product, settings)];
    }
    return [displayUnitPrice(product, settings)];
  }, [settings]);

  const customerPrice = React.useCallback((product: typeof products[number]) => {
    const rows = customerPrices(product);
    return rows.length ? Math.min(...rows) : 0;
  }, [customerPrices]);

  const matchesPriceRange = React.useCallback((price: number) => {
    if (priceRange === '100-500') return price >= 100 && price <= 500;
    if (priceRange === '500-1000') return price > 500 && price <= 1000;
    if (priceRange === '1000-2000') return price > 1000 && price <= 2000;
    if (priceRange === '2000-3500') return price > 2000 && price <= 3500;
    if (priceRange === '3500-5000') return price > 3500 && price <= 5000;
    if (priceRange === '5000-plus') return price > 5000;
    return true;
  }, [priceRange]);

  // Smart customer search: product name, Sinhala/English descriptions, SKU, category, brand and admin keywords.
  // Small spelling mistakes are tolerated by productSearchScore().
  const filteredProducts = React.useMemo(() => {
    const query = searchQuery.trim();
    const rows = products
      .filter((p) => selectedCategorySlug === 'combo-pack' ? normalizedProductType(p) === 'bundle' : (selectedCategorySlug ? (normalizedProductType(p) !== 'bundle' && p.category_slug === selectedCategorySlug) : true))
      .filter((p) => customerPrices(p).some(matchesPriceRange))
      .map((p) => ({ product: p, score: query ? customerProductSearchScore(p, query, categories) : 1 }))
      .filter((row) => row.score > 0);

    rows.sort((a, b) => {
      if (sortMode === 'price-low') {
        return customerPrice(a.product) - customerPrice(b.product);
      }
      if (sortMode === 'price-high') {
        return customerPrice(b.product) - customerPrice(a.product);
      }
      if (sortMode === 'newest') {
        return new Date(b.product.created_at || 0).getTime() - new Date(a.product.created_at || 0).getTime();
      }
      return b.score - a.score;
    });

    return rows.map((row) => row.product);
  }, [products, categories, selectedCategorySlug, searchQuery, sortMode, priceRange, customerPrice, customerPrices, matchesPriceRange]);

  React.useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedCategorySlug, searchQuery, sortMode, priceRange]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMoreProducts = visibleCount < filteredProducts.length;

  const categoryFilterOptions = React.useMemo(() => {
    const rows = categories
      .filter((category) => category.slug !== 'combo-pack')
      .map((category) => ({
        slug: category.slug,
        label: language === 'si' ? category.name_si : category.name_en,
        icon: category.icon,
        count: products.filter((product) => normalizedProductType(product) !== 'bundle' && product.category_slug === category.slug).length,
      }))
      .filter((category) => category.count > 0);
    const comboCount = products.filter((product) => normalizedProductType(product) === 'bundle').length;
    return [
      { slug: null, label: getTranslation(language, 'allCategories'), icon: '✦', count: products.length },
      ...rows,
      ...(comboCount > 0 ? [{ slug: 'combo-pack', label: 'Combo Pack', icon: '🎁', count: comboCount }] : []),
    ];
  }, [categories, language, products]);

  const selectedCategoryLabel = categoryFilterOptions.find((option) => option.slug === selectedCategorySlug)?.label;
  const hasActiveCatalogFilters = Boolean(selectedCategorySlug || searchQuery.trim() || priceRange !== 'all' || sortMode !== 'relevance');

  const discountProducts = products.filter((p) => {
    const discounted = normalizedProductType(p) === 'variant'
      ? activeVariants(p).some((v) => v.discount_enabled !== false && Number(v.discount_price || 0) > 0 && Number(v.discount_price || 0) < Number(v.selling_price || 0))
      : p.discount_enabled !== false && Number(p.discount_price || 0) > 0 && Number(p.discount_price || 0) < Number(p.selling_price || 0);
    return discounted && customerPrices(p).some(matchesPriceRange);
  });

  // Admin conditional returns must stay after all hooks above.
  if (isAdminView) {
    if (!adminUser) {
      return (
        <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
          <Header />
          <AdminLoginModal
            isOpen={true}
            onClose={() => setIsAdminView(false)}
            onLoginSuccess={(u) => loginAdmin(u)}
            staffUsers={staffUsers}
          />
        </div>
      );
    }
    return <AdminDashboard />;
  }

  if (settings.maintenance_mode) {
    return (
      <div className="ora-storefront min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
            <ShieldCheck className="h-7 w-7 text-orange-600" />
          </div>
          <h1 className="text-2xl font-black">O-RA Store</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            {settings.maintenance_message || 'Website is currently under maintenance. Please check back soon.'}
          </p>
          <p className="mt-5 text-xs text-gray-400">We will be back shortly.</p>
        </div>
      </div>
    );
  }

  const infoMap: Record<string, StoreInfoPageKind> = {
    '/return-refund': 'return', '/contact': 'contact', '/about': 'about', '/privacy': 'privacy', '/terms': 'terms'
  };
  const infoKind = infoMap[storePath];
  if (infoKind) {
    return (
      <div className="ora-storefront min-h-screen bg-gray-50 text-gray-900 pb-20 md:pb-12 font-sans">
        <Header />
        <StoreInfoPage kind={infoKind} />
        <StoreFooter />
        <CartDrawer /><CheckoutModal /><ProductDetailModal /><OrderTrackingModal /><OraAssistant /><MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="ora-storefront min-h-screen bg-gray-50 text-gray-900 pb-20 md:pb-12 font-sans selection:bg-orange-100 selection:text-orange-900">
      <Header />

      {/* Main Container */}
      <main className="ora-store-main max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-10 pt-6 space-y-10">
        {/* Hero Section */}
        <HeroBanner onBrowseAll={() => resetCatalogFilters(true)} />

        {/* Flash Deals / Discount Products Section (If no active category filter) */}
        {!selectedCategorySlug && !searchQuery && discountProducts.length > 0 && (
          <section id="flash-deals-section" className="space-y-4">
            <div className="flex items-center space-x-2 border-b border-gray-200 pb-2">
              <Flame className="w-5 h-5 text-orange-600 animate-bounce" />
              <h2 className="text-lg font-bold text-gray-900">
                {getTranslation(language, 'flashDeals')}
              </h2>
            </div>

            <div className="ora-product-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 xl:gap-5">
              {discountProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        )}

        {/* Primary Product Grid Section */}
        <section id="products-section" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-orange-600" />
              <span>
                {selectedCategorySlug
                  ? `${selectedCategoryLabel || selectedCategorySlug} Collection`
                  : getTranslation(language, 'featuredProducts')}
              </span>
            </h2>
          </div>

          <ProductFilterBar
            language={language}
            categories={categoryFilterOptions}
            selectedCategorySlug={selectedCategorySlug}
            priceRange={priceRange}
            sortMode={sortMode}
            visibleCount={Math.min(visibleCount, filteredProducts.length)}
            totalCount={filteredProducts.length}
            hasActiveFilters={hasActiveCatalogFilters}
            onCategoryChange={setSelectedCategorySlug}
            onPriceChange={setPriceRange}
            onSortChange={setSortMode}
            onClearAll={() => resetCatalogFilters(false)}
          />

          {filteredProducts.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-3xl border border-gray-100 space-y-2">
              <p className="text-sm text-gray-500 font-medium">
                No products found matching your search criteria.
              </p>
            </div>
          ) : (
            <div className="ora-product-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 xl:gap-5">
              {visibleProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}

          {hasMoreProducts && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="px-6 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-orange-600 transition-colors"
              >
                Load 24 More
              </button>
            </div>
          )}
        </section>

        <ProductRequestSection />
      </main>

      <StoreFooter />

      {/* Floating & Modal Widgets */}
      <CartDrawer />
      <CheckoutModal />
      <ProductDetailModal />
      <OrderTrackingModal />
      <OraAssistant />
      <MobileBottomNav />
    </div>
  );
};

export default function App() {
  return (
    <StoreProvider>
      <CustomerStorefront />
    </StoreProvider>
  );
}
