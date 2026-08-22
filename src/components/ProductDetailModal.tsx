import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Image as ImageIcon, MessageSquare, ShoppingBag, X, Zap } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { ProductReviews } from './ProductReviews';
import { ProductCard } from './ProductCard';
import {
  activeVariants,
  displayUnitPrice,
  normalizedProductType,
  regularDisplayUnitPrice,
  selectionDiscountPercent,
  variantById,
  variantMatchesOptions,
  variantOptions,
  variantOptionSummary,
} from '../lib/productVariants';
import { formatLkr } from '../lib/currency';

const LEGACY_DEFAULT_IMAGE = 'photo-1523275335684-37898b6baf30';

const cleanImages = (values: Array<string | undefined>) => {
  const seen = new Set<string>();
  const rows = values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  const realRows = rows.filter((value) => !value.includes(LEGACY_DEFAULT_IMAGE));
  return realRows.length ? realRows : rows;
};

const similarScore = (base: any, candidate: any) => {
  let score = base.category_slug === candidate.category_slug ? 20 : 0;
  if (base.brand && candidate.brand && String(base.brand).toLowerCase() === String(candidate.brand).toLowerCase()) score += 3;
  const tokens = (value: string) => new Set(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3));
  const a = tokens(`${base.name_en} ${base.search_keywords || ''}`);
  const b = tokens(`${candidate.name_en} ${candidate.search_keywords || ''}`);
  for (const token of a) if (b.has(token)) score += 1;
  return score;
};

export const ProductDetailModal: React.FC = () => {
  const { language, selectedProduct, setSelectedProduct, addToCart, startBuyNow, settings, products } = useStore();
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [addedToCart, setAddedToCart] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedProduct) {
      setSelectedVariantId('');
      setSelectedOptions({});
      setQuantity(1);
      setActiveImageIndex(0);
      setFailedImages(new Set());
      setAddedToCart(false);
      return;
    }
    const first = normalizedProductType(selectedProduct) === 'variant' ? activeVariants(selectedProduct)[0] : undefined;
    setSelectedVariantId(first?.id || '');
    setSelectedOptions(Object.fromEntries(variantOptions(first).map((option) => [option.name, option.value])));
    setQuantity(1);
    setActiveImageIndex(0);
    setFailedImages(new Set());
    setAddedToCart(false);
    requestAnimationFrame(() => overlayRef.current?.scrollTo({ top: 0, behavior: 'auto' }));
  }, [selectedProduct?.id]);

  useEffect(() => {
    if (!selectedProduct) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!window.history.state?.oraProductModal) {
      window.history.pushState({ ...(window.history.state || {}), oraProductModal: true }, '');
    }
    const onPopState = () => setSelectedProduct(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (window.history.state?.oraProductModal) window.history.back();
        else setSelectedProduct(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKey);
    };
  }, [Boolean(selectedProduct), setSelectedProduct]);

  const similarProducts = useMemo(() => {
    if (!selectedProduct) return [];
    return products
      .filter((p) => p.id !== selectedProduct.id && p.status !== 'Draft')
      .map((p) => ({ p, score: similarScore(selectedProduct, p) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.p.created_at || 0).getTime() - new Date(a.p.created_at || 0).getTime())
      .slice(0, 6)
      .map((row) => row.p);
  }, [selectedProduct, products]);

  if (!selectedProduct) return null;

  const type = normalizedProductType(selectedProduct);
  const variants = type === 'variant' ? activeVariants(selectedProduct) : [];
  const selectedVariant = type === 'variant' ? variantById(selectedProduct, selectedVariantId) : undefined;
  const unitPrice = displayUnitPrice(selectedProduct, settings, selectedVariant);
  const regularUnitPrice = regularDisplayUnitPrice(selectedProduct, settings, selectedVariant);
  const discountPercent = selectionDiscountPercent(selectedProduct, selectedVariant, settings);
  const hasDiscount = discountPercent > 0;
  const galleryImages = cleanImages([
    ...(selectedVariant?.image ? [selectedVariant.image] : []),
    ...(selectedProduct.images || []),
  ]);
  const visibleGalleryImages = galleryImages.filter((image) => !failedImages.has(image));
  const shownImage = visibleGalleryImages[activeImageIndex] || visibleGalleryImages[0] || '';
  const exactSku = selectedVariant?.sku || selectedProduct.sku;
  const canOrder = type !== 'variant' || Boolean(selectedVariant);
  const specifications = (selectedProduct.specifications || []).filter((spec) => spec.label && spec.value);
  const itemDetails = [
    ...(String(selectedProduct.brand || '').trim() ? [{ id:'brand', label: language === 'si' ? 'වෙළඳ නාමය' : 'Brand', value:String(selectedProduct.brand || '').trim() }] : []),
    ...(selectedProduct.item_details || [])
      .filter((detail) => String(detail.label_en || '').trim() && String(detail.value_en || '').trim())
      .map((detail) => ({
        id: detail.id,
        label: language === 'si' && String(detail.label_si || '').trim() ? String(detail.label_si).trim() : String(detail.label_en).trim(),
        value: language === 'si' && String(detail.value_si || '').trim() ? String(detail.value_si).trim() : String(detail.value_en).trim(),
      })),
  ];
  const description = language === 'si' && selectedProduct.description_si ? selectedProduct.description_si : selectedProduct.description_en;

  const optionGroups = type === 'variant'
    ? variants.reduce<Array<{ name: string; values: string[] }>>((groups, variant) => {
        for (const option of variantOptions(variant)) {
          let group = groups.find((row) => row.name.toLowerCase() === option.name.toLowerCase());
          if (!group) {
            group = { name: option.name, values: [] };
            groups.push(group);
          }
          if (!group.values.some((value) => value.toLowerCase() === option.value.toLowerCase())) group.values.push(option.value);
        }
        return groups;
      }, [])
    : [];

  const comboLines = type === 'bundle'
    ? (selectedProduct.bundle_components || []).map((component) => {
        const product = products.find((p) => p.id === component.product_id);
        const variant = product ? variantById(product, component.variant_id) : undefined;
        return `${product?.name_en || 'Item'}${variant ? ` - ${variantOptionSummary(variant)}` : ''} ×${Math.max(1, Number(component.quantity || 1))}`;
      })
    : [];

  const close = () => {
    if (window.history.state?.oraProductModal) window.history.back();
    else setSelectedProduct(null);
  };

  const selectOption = (name: string, value: string) => {
    const requested = { ...selectedOptions, [name]: value };
    let candidate = variants.find((variant) => variantMatchesOptions(variant, requested));
    if (!candidate) {
      candidate = variants.find((variant) => variantOptions(variant).some((option) => option.name.toLowerCase() === name.toLowerCase() && option.value.toLowerCase() === value.toLowerCase()));
    }
    if (!candidate) return;
    setSelectedVariantId(candidate.id);
    setSelectedOptions(Object.fromEntries(variantOptions(candidate).map((option) => [option.name, option.value])));
    setQuantity(1);
    setActiveImageIndex(0);
  };

  const handleBuyNow = () => {
    if (!canOrder) return;
    setSelectedProduct(null);
    if (window.history.state?.oraProductModal) window.history.back();
    startBuyNow(selectedProduct, quantity, selectedVariant?.id);
  };
  const handleAddToCart = () => {
    if (!canOrder) return;
    addToCart(selectedProduct, quantity, selectedVariant?.id);
    setAddedToCart(true);
    window.setTimeout(() => setAddedToCart(false), 1800);
  };
  const openAssistantInquiry = () => {
    setSelectedProduct(null);
    if (window.history.state?.oraProductModal) window.history.back();
    window.dispatchEvent(new CustomEvent('ora:assistant-open', { detail: { product: selectedProduct.name_en, sku: exactSku, variant: variantOptionSummary(selectedVariant) } }));
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 overflow-y-auto bg-white text-gray-900">
      {addedToCart && (
        <div className="fixed left-1/2 top-20 z-[80] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-gray-900">{language === 'si' ? 'Cart එකට එකතු කළා' : 'Added to Cart'}</p>
              <p className="truncate text-[11px] font-bold text-gray-500">
                {language === 'si' ? 'තෝරාගත් භාණ්ඩය සාර්ථකව Cart එකට එකතු වුණා.' : 'Your selected item was added successfully.'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <button onClick={close} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm hover:border-orange-300 hover:text-orange-700">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="min-w-0 px-3 text-center">
            <p className="truncate text-xs font-black text-gray-900 sm:text-sm">{selectedProduct.name_en}</p>
            <p className="text-[9px] font-mono text-gray-400">{exactSku}</p>
          </div>
          <button onClick={close} className="rounded-full bg-gray-100 p-2 text-gray-500 hover:text-black"><X className="h-5 w-5" /></button>
        </div>
      </div>

      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1.08fr)_minmax(380px,.92fr)]">
          <section className="space-y-3">
            <div className="relative aspect-square max-h-[680px] overflow-hidden rounded-3xl border border-gray-100 bg-gray-50">
              {shownImage ? (
                <img src={shownImage} alt={selectedProduct.name_en} className="h-full w-full object-contain sm:object-cover" referrerPolicy="no-referrer" onError={() => { setFailedImages((prev) => new Set(prev).add(shownImage)); setActiveImageIndex(0); }} />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center text-gray-300"><ImageIcon className="h-14 w-14" /><p className="mt-2 text-xs font-bold">Image coming soon</p></div>
              )}
              {hasDiscount && <span className="absolute left-4 top-4 rounded-xl bg-orange-600 px-3 py-2 text-sm font-black text-white shadow-lg">{discountPercent}% OFF</span>}
              {visibleGalleryImages.length > 1 && <span className="absolute right-4 top-4 rounded-full bg-black/70 px-3 py-1.5 text-xs font-black text-white">{Math.min(activeImageIndex + 1, visibleGalleryImages.length)}/{visibleGalleryImages.length}</span>}
            </div>

            {visibleGalleryImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {visibleGalleryImages.map((img, idx) => <button key={`${img}-${idx}`} onClick={() => setActiveImageIndex(idx)} className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 ${activeImageIndex === idx ? 'border-orange-600' : 'border-gray-200'}`}><img src={img} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setFailedImages((prev) => new Set(prev).add(img))} /></button>)}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
            <div>
              <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold uppercase text-gray-600">{type === 'bundle' ? 'Combo Pack' : selectedProduct.category_slug}</span><span className="font-mono text-[10px] text-gray-400">SKU: {exactSku}</span></div>
              <h1 className="mt-3 text-2xl font-black leading-tight text-gray-900 sm:text-3xl">{language === 'si' && selectedProduct.name_si ? selectedProduct.name_si : selectedProduct.name_en}</h1>
              {selectedVariant && <p className="mt-1 text-sm font-black text-orange-600">{variantOptionSummary(selectedVariant)}</p>}
            </div>

            <div className="rounded-3xl border border-gray-100 bg-gray-50 p-5">
              {hasDiscount && <div className="mb-1 text-sm font-bold text-gray-400 line-through">Rs. {formatLkr(regularUnitPrice)}</div>}
              <div className="flex flex-wrap items-center gap-2"><span className="text-3xl font-black text-orange-600">Rs. {formatLkr(unitPrice)}</span>{hasDiscount && <span className="rounded-full bg-orange-100 px-2 py-1 text-[10px] font-black text-orange-700">SPECIAL OFFER</span>}</div>
              <p className="mt-1 text-[10px] text-gray-500">{settings.free_delivery_enabled ? 'Displayed unit price follows current FREE delivery pricing rule.' : 'Delivery fee is added separately at checkout.'}</p>
            </div>

            {type === 'variant' && optionGroups.length > 0 && (
              <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4 space-y-3">
                {optionGroups.map((group) => (
                  <div key={group.name}>
                    <p className="mb-2 text-xs font-black text-gray-800">Choose {group.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {group.values.map((value) => {
                        const active = String(selectedOptions[group.name] || '').toLowerCase() === value.toLowerCase();
                        const imageVariant = variants.find((variant) => variantOptions(variant).some((option) => option.name.toLowerCase() === group.name.toLowerCase() && option.value.toLowerCase() === value.toLowerCase()) && variant.image);
                        return <button key={`${group.name}-${value}`} type="button" onClick={() => selectOption(group.name, value)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border-2 px-3 py-2 text-xs font-black transition ${active ? 'border-orange-600 bg-white text-orange-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300'}`}>
                          {group.name.toLowerCase() === 'color' && imageVariant?.image && !failedImages.has(imageVariant.image) && <img src={imageVariant.image} alt="" className="h-7 w-7 rounded-lg object-cover" referrerPolicy="no-referrer" onError={() => setFailedImages((prev) => new Set(prev).add(String(imageVariant.image)))} />}
                          <span>{value}</span>
                        </button>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-gray-700">Quantity:</span>
              <div className="flex items-center rounded-xl border border-gray-200 bg-gray-100"><button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="px-3 py-2 font-black">-</button><span className="px-3 text-xs font-black">{quantity}</span><button onClick={() => setQuantity((q) => Math.min(999, q + 1))} className="px-3 py-2 font-black">+</button></div>
              {type === 'variant' && selectedVariant && <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{variantOptionSummary(selectedVariant)} • {selectedVariant.sku}</div>}
            </div>

            <div className="grid grid-cols-2 gap-2"><button disabled={!canOrder} onClick={handleAddToCart} className="rounded-full border border-orange-200 bg-orange-50 py-3 text-xs font-black text-orange-700 transition disabled:opacity-40"><ShoppingBag className="mr-1 inline h-4 w-4" />Add to Cart</button><button disabled={!canOrder} onClick={handleBuyNow} className="rounded-full bg-black py-3 text-xs font-black text-white disabled:opacity-40"><Zap className="mr-1 inline h-4 w-4" />Buy Now</button></div>
            <button onClick={openAssistantInquiry} className="w-full rounded-full border border-emerald-100 bg-emerald-50 py-2.5 text-xs font-bold text-emerald-700"><MessageSquare className="mr-2 inline h-4 w-4" />Ask O-RA Assistant • 24/7</button>

            {description && (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="mb-2 text-xs font-black text-gray-900">Description</p>
                <p className="whitespace-pre-line text-sm leading-6 text-gray-600">{description}</p>
              </div>
            )}

            {specifications.length > 0 && (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="mb-3 text-xs font-black text-gray-900">Size / Measurements</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {specifications.map((spec) => <React.Fragment key={spec.id}><span className="font-bold text-gray-500">{spec.label}</span><span className="font-black text-gray-800">{spec.value}{spec.unit ? ` ${spec.unit}` : ''}</span></React.Fragment>)}
                </div>
              </div>
            )}

            {type === 'bundle' && (
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
                <p className="text-xs font-black text-cyan-900">Combo Pack includes</p>
                <div className="mt-2 space-y-1 text-xs font-bold text-cyan-800">{comboLines.map((line, index) => <p key={index}>• {line}</p>)}</div>
              </div>
            )}
          </section>
        </div>

        {itemDetails.length > 0 && (
          <section className="mt-8 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="border-b border-gray-100 pb-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-600">About this Item</p>
              <h2 className="mt-1 text-xl font-black text-gray-900">{language === 'si' ? 'භාණ්ඩයේ විශේෂ විස්තර' : 'Item Specifications'}</h2>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-1 md:grid-cols-2">
              {itemDetails.map((detail) => (
                <div key={detail.id} className="grid grid-cols-[minmax(115px,.42fr)_minmax(0,1fr)] gap-3 border-b border-gray-50 py-3 text-sm">
                  <span className="font-bold text-gray-500">{detail.label}</span>
                  <span className="font-black text-gray-900 break-words">{detail.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-10 border-t border-gray-100 pt-8"><ProductReviews product={selectedProduct} /></div>

        {similarProducts.length > 0 && (
          <section className="mt-10 border-t border-gray-100 pt-8">
            <div className="mb-4"><h2 className="text-xl font-black text-gray-900">Similar Items</h2><p className="mt-1 text-xs text-gray-500">You may also like these related O-RA products.</p></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{similarProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div>
          </section>
        )}
      </main>
    </div>
  );
};
