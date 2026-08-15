import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronLeft, ChevronRight, Edit, Image as ImageIcon, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { BundleComponent, Product, ProductItemDetail } from '../../types';
import {
  activeVariants,
  displayUnitPrice,
  effectiveBuyingPrice,
  normalizedProductType,
  normalizeSku,
  variantById,
  variantOptionSummary,
} from '../../lib/productVariants';
import { compressImageFile, uploadPublicImage } from '../../lib/imageUpload';

const COMBO_DISCOUNT = 50;

const compactComboPartName = (raw: string) => {
  const clean = String(raw || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[_|/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'Item';
  const words = clean.split(' ');
  if (clean.length <= 30 && words.length <= 5) return clean;

  const lower = words.map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const identity = ['kids', 'kid', 'mens', "men's", 'men', 'ladies', "ladies'", 'women', 'womens', 'girls', 'boys', 'baby'];
  const identityIndex = lower.findIndex((word) => identity.includes(word));
  if (identityIndex >= 0 && identityIndex < words.length - 1) {
    return `${words[identityIndex]} ${words[identityIndex + 1]}`.replace(/[^a-z0-9' -]/gi, '').trim();
  }

  const descriptor = new Set([
    'new','premium','high','quality','best','special','latest','original','rechargeable','foldable','adjustable','portable','professional','automatic','smart','heavy','duty','with','for','and','the','a','an','led','light','lights','set','pack',
  ]);
  const filtered = words.filter((word, index) => !descriptor.has(lower[index])).map((word) => word.replace(/[^a-z0-9' -]/gi, '')).filter(Boolean);
  if (identityIndex === words.length - 1 && filtered.length) {
    const noun = filtered.find((word) => !identity.includes(word.toLowerCase())) || filtered[0];
    return `${words[identityIndex]} ${noun}`.trim();
  }
  const candidate = (filtered.length >= 2 ? filtered.slice(0, 4) : words.slice(0, 4)).join(' ').trim();
  return candidate.length > 34 ? `${candidate.slice(0, 31).trim()}…` : candidate;
};

interface ComboPacksPanelProps {
  initialEditId?: string;
  onInitialEditHandled?: () => void;
}

interface ComboFormState {
  components: BundleComponent[];
  name_en: string;
  name_si: string;
  description_en: string;
  description_si: string;
  item_details: ProductItemDetail[];
  category_slug: string;
  images: string[];
  auto_price: boolean;
  manual_display_price: number;
}

export const ComboPacksPanel: React.FC<ComboPacksPanelProps> = ({ initialEditId, onInitialEditHandled }) => {
  const { products, settings, addProduct, updateProduct, deleteProduct, adminUser } = useStore();
  const combos = useMemo(() => products.filter((product) => normalizedProductType(product) === 'bundle'), [products]);
  const [editingCombo, setEditingCombo] = useState<Product | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [comboSearch, setComboSearch] = useState('');
  const [comboPage, setComboPage] = useState(1);
  const [notifyCustomers, setNotifyCustomers] = useState(false);
  const [comboContentBusy, setComboContentBusy] = useState(false);
  const [manualEnglishContent, setManualEnglishContent] = useState(false);
  const [manualSinhalaContent, setManualSinhalaContent] = useState(false);
  const lastAutoContentSignature = useRef('');
  const COMBO_PAGE_SIZE = 25;
  const canNotify = adminUser?.role === 'admin' || Boolean(adminUser?.permissions?.includes('notifications'));
  const [form, setForm] = useState<ComboFormState>({
    components: [],
    name_en: '',
    name_si: '',
    description_en: '',
    description_si: '',
    item_details: [],
    category_slug: 'combo-pack',
    images: [],
    auto_price: true,
    manual_display_price: 0,
  });

  const selectableItems = useMemo(() => {
    const rows: Array<{ product_id: string; variant_id?: string; code: string; name: string; detail?: string }> = [];
    for (const product of products) {
      if (normalizedProductType(product) === 'bundle' || product.id === editingCombo?.id) continue;
      if (normalizedProductType(product) === 'variant') {
        for (const variant of activeVariants(product)) {
          rows.push({ product_id: product.id, variant_id: variant.id, code: normalizeSku(variant.sku), name: product.name_en, detail: variantOptionSummary(variant) });
        }
      } else {
        rows.push({ product_id: product.id, code: normalizeSku(product.sku), name: product.name_en });
      }
    }
    return rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [products, editingCombo?.id]);

  const filteredCombos = useMemo(() => {
    const query = comboSearch.trim().toLowerCase();
    if (!query) return combos;
    return combos.filter((combo) => {
      const componentText = (combo.bundle_components || []).map((component) => {
        const product = products.find((row) => row.id === component.product_id);
        const variant = product ? variantById(product, component.variant_id) : undefined;
        return `${normalizeSku(variant?.sku || product?.sku)} ${product?.name_en || ''}`;
      }).join(' ');
      return `${combo.sku} ${combo.name_en} ${combo.name_si || ''} ${componentText}`.toLowerCase().includes(query);
    });
  }, [combos, comboSearch, products]);
  const comboPageCount = Math.max(1, Math.ceil(filteredCombos.length / COMBO_PAGE_SIZE));
  const comboRows = filteredCombos.slice((comboPage - 1) * COMBO_PAGE_SIZE, comboPage * COMBO_PAGE_SIZE);
  useEffect(() => { setComboPage(1); }, [comboSearch]);
  useEffect(() => { if (comboPage > comboPageCount) setComboPage(comboPageCount); }, [comboPage, comboPageCount]);

  const publishComboNotification = async (name: string, price: number) => {
    if (!canNotify || !notifyCustomers) return;
    const token = localStorage.getItem('ora_staff_session_token') || '';
    const response = await fetch('/api/admin/customer-notifications', { method:'POST', headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})}, body:JSON.stringify({title:`New Combo Pack: ${name}`,body:`Now available for Rs. ${price.toLocaleString()}.`,url:'/'}) });
    if (!response.ok) { const data=await response.json().catch(()=>({})); throw new Error(data?.error || 'Customer notification failed.'); }
  };

  const resolveComponent = (component: BundleComponent) => {
    const product = products.find((row) => row.id === component.product_id);
    const variant = product ? variantById(product, component.variant_id) : undefined;
    return { product, variant, code: normalizeSku(variant?.sku || product?.sku) };
  };

  const autoName = (components = form.components) => {
    const parts = components
      .map((component) => products.find((product) => product.id === component.product_id)?.name_en)
      .filter(Boolean)
      .map((name) => compactComboPartName(String(name)));
    return parts.length ? `${parts.join(' + ')} Combo Pack` : '';
  };

  const uniqueComboCode = (components = form.components, editingId = editingCombo?.id) => {
    const codes = components.map((component) => resolveComponent(component).code).filter(Boolean);
    if (codes.length < 2) return 'CB-SELECT-ITEMS';
    const base = `CB-${codes.join('-')}`;
    const used = new Set(products.filter((product) => product.id !== editingId).flatMap((product) => [normalizeSku(product.sku), ...(product.variants || []).map((variant) => normalizeSku(variant.sku))]));
    if (!used.has(normalizeSku(base))) return normalizeSku(base);
    let i = 2;
    let candidate = `${base}-${String(i).padStart(2, '0')}`;
    while (used.has(normalizeSku(candidate))) candidate = `${base}-${String(++i).padStart(2, '0')}`;
    return normalizeSku(candidate);
  };

  const autoDisplayPrice = useMemo(() => {
    const total = form.components.reduce((sum, component) => {
      const { product, variant } = resolveComponent(component);
      if (!product) return sum;
      return sum + displayUnitPrice(product, settings, variant) * Math.max(1, Number(component.quantity || 1));
    }, 0);
    return Math.max(0, total - (form.components.length >= 2 ? COMBO_DISCOUNT : 0));
  }, [form.components, products, settings]);

  const displayedComboPrice = form.auto_price ? autoDisplayPrice : Math.max(0, Number(form.manual_display_price || 0));
  const comboCode = uniqueComboCode();

  const resetNew = () => {
    setEditingCombo(null);
    setNameTouched(false);
    setForm({
      components: [],
      name_en: '',
      name_si: '',
      description_en: '',
      description_si: '',
      item_details: [],
      category_slug: 'combo-pack',
      images: [],
      auto_price: true,
      manual_display_price: 0,
    });
    setNotifyCustomers(false);
    setManualEnglishContent(false);
    setManualSinhalaContent(false);
    lastAutoContentSignature.current = '';
    setShowEditor(true);
  };

  const openEdit = (combo: Product) => {
    setEditingCombo(combo);
    setNameTouched(true);
    setForm({
      components: (combo.bundle_components || []).map((component) => ({ ...component })),
      name_en: combo.name_en,
      name_si: combo.name_si || '',
      description_en: combo.description_en || '',
      description_si: combo.description_si || '',
      item_details: (combo.item_details || []).map((detail) => ({ ...detail })),
      category_slug: 'combo-pack',
      images: [...(combo.images || [])],
      auto_price: combo.bundle_auto_price === true,
      manual_display_price: displayUnitPrice(combo, settings),
    });
    setNotifyCustomers(false);
    setManualEnglishContent(true);
    setManualSinhalaContent(true);
    lastAutoContentSignature.current = '';
    setShowEditor(true);
  };

  useEffect(() => {
    if (!initialEditId) return;
    const combo = combos.find((row) => row.id === initialEditId);
    if (combo) openEdit(combo);
    onInitialEditHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditId]);

  const updateComponent = (index: number, choiceCode: string) => {
    const choice = selectableItems.find((row) => row.code === choiceCode);
    if (!choice) return;
    setForm((previous) => {
      const nextComponents = [...previous.components];
      nextComponents[index] = { product_id: choice.product_id, variant_id: choice.variant_id, quantity: Math.max(1, Number(nextComponents[index]?.quantity || 1)) };
      return {
        ...previous,
        components: nextComponents,
        category_slug: 'combo-pack',
        name_en: nameTouched ? previous.name_en : autoName(nextComponents),
      };
    });
  };

  const regenerateName = () => {
    setNameTouched(false);
    setForm((previous) => ({ ...previous, name_en: autoName(previous.components) }));
  };

  const componentContentSignature = (components: BundleComponent[]) => components
    .filter((component) => component.product_id)
    .map((component) => `${component.product_id}:${component.variant_id || 'base'}:${Math.max(1, Number(component.quantity || 1))}`)
    .join('|');

  const translateSinhalaBatch = async (texts: string[]) => {
    const token = localStorage.getItem('ora_staff_session_token') || '';
    const translated: string[] = [];
    for (let index = 0; index < texts.length; index += 12) {
      const chunk = texts.slice(index, index + 12);
      const response = await fetch('/api/admin/translate-sinhala', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ texts: chunk }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Sinhala translation failed.');
      translated.push(...(Array.isArray(data?.translations) ? data.translations.map((value: any) => String(value || '').trim()) : []));
    }
    if (translated.length !== texts.length) throw new Error('Sinhala translation result count mismatch.');
    return translated;
  };

  const generateComboContent = async (components = form.components, force = false) => {
    const cleanComponents = components.filter((component) => component.product_id);
    if (cleanComponents.length < 2) return;
    const signature = componentContentSignature(cleanComponents);
    if (!force && manualEnglishContent) return;
    if (!force && lastAutoContentSignature.current === signature) return;

    const sourceRows = cleanComponents.map((component) => {
      const { product, variant, code } = resolveComponent(component);
      if (!product) return null;
      return {
        code,
        name: product.name_en,
        name_si: product.name_si || '',
        short_name: compactComboPartName(product.name_en),
        short_name_si: compactComboPartName(product.name_si || product.name_en),
        quantity: Math.max(1, Number(component.quantity || 1)),
        variant: variant ? variantOptionSummary(variant) : '',
        brand: product.brand || '',
        description: product.description_en || '',
        description_si: product.description_si || '',
        item_details: (product.item_details || []).map((detail) => ({
          label: detail.label_en,
          value: detail.value_en,
          label_si: detail.label_si || '',
          value_si: detail.value_si || '',
        })),
        specifications: (product.specifications || []).map((detail) => ({
          label: detail.label,
          value: detail.value,
          unit: detail.unit || '',
          label_si: detail.label,
          value_si: detail.value,
        })),
      };
    }).filter(Boolean);
    if (sourceRows.length < 2) return;

    setComboContentBusy(true);
    try {
      const token = localStorage.getItem('ora_staff_session_token') || '';
      const response = await fetch('/api/admin/generate-combo-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ components: sourceRows }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Combo content generation failed.');

      const descriptionEn = String(data?.description_en || '').trim();
      const generatedDetails = (Array.isArray(data?.item_details) ? data.item_details : [])
        .slice(0, 10)
        .map((detail: any, index: number): ProductItemDetail => ({
          id: `combo-detail-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 5)}`,
          label_en: String(detail?.label_en || '').trim(),
          value_en: String(detail?.value_en || '').trim(),
          label_si: String(detail?.label_si || '').trim(),
          value_si: String(detail?.value_si || '').trim(),
        }))
        .filter((detail: ProductItemDetail) => detail.label_en && detail.value_en);
      if (!descriptionEn) throw new Error('Generated Combo description was empty.');

      const englishName = String(form.name_en || autoName(cleanComponents)).trim();
      let nameSi = String(data?.combo_name_si || form.name_si || '').trim();
      let descriptionSi = String(data?.description_si || form.description_si || '').trim();
      let translatedDetails = generatedDetails;

      if (!manualSinhalaContent || force) {
        // Exact English -> Sinhala is preferred, but Combo generation must never fail
        // just because the external translation service is unavailable.
        try {
          const translationInputs = [englishName, descriptionEn, ...generatedDetails.flatMap((detail) => [detail.label_en, detail.value_en])];
          const translations = await translateSinhalaBatch(translationInputs);
          nameSi = translations[0] || nameSi;
          descriptionSi = translations[1] || descriptionSi;
          translatedDetails = generatedDetails.map((detail, index) => ({
            ...detail,
            label_si: translations[2 + (index * 2)] || detail.label_si || '',
            value_si: translations[3 + (index * 2)] || detail.value_si || '',
          }));
        } catch (translationError: any) {
          console.warn('O-RA Combo Sinhala translation fallback:', translationError?.message || translationError);
          // Keep the server-provided Sinhala built from the selected source products.
        }
      }

      setForm((previous) => {
        if (componentContentSignature(previous.components) !== signature) return previous;
        return {
          ...previous,
          description_en: descriptionEn,
          description_si: (!manualSinhalaContent || force) ? descriptionSi : previous.description_si,
          name_si: (!manualSinhalaContent || force) ? nameSi : previous.name_si,
          item_details: (!manualSinhalaContent || force)
            ? translatedDetails
            : generatedDetails.map((detail, index) => ({
                ...detail,
                label_si: previous.item_details[index]?.label_si || '',
                value_si: previous.item_details[index]?.value_si || '',
              })),
        };
      });
      lastAutoContentSignature.current = signature;
      if (force) {
        setManualEnglishContent(false);
        setManualSinhalaContent(false);
      }
    } catch (error: any) {
      if (force) alert(error?.message || 'Combo content generation failed. You can enter the fields manually.');
      else console.warn('O-RA automatic Combo content generation:', error?.message || error);
    } finally {
      setComboContentBusy(false);
    }
  };

  useEffect(() => {
    if (!showEditor || editingCombo || manualEnglishContent) return;
    if (form.components.filter((component) => component.product_id).length < 2) return;
    const timer = window.setTimeout(() => { void generateComboContent(form.components); }, 700);
    return () => window.clearTimeout(timer);
    // Auto-fill only while the admin has not manually edited English Combo content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEditor, editingCombo?.id, manualEnglishContent, form.components.map((component) => `${component.product_id}:${component.variant_id || 'base'}:${component.quantity}`).join('|')]);

  const handleImages = async (files?: FileList | null) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const slots = Math.max(0, 6 - form.images.filter(Boolean).length);
    if (!slots) return alert('Maximum 6 combo images.');
    setImageUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of selected.slice(0, slots)) {
        const compressed = await compressImageFile(file, 1280, 280_000);
        uploaded.push(await uploadPublicImage(compressed, 'product'));
      }
      setForm((previous) => ({ ...previous, images: [...previous.images, ...uploaded] }));
    } catch (error: any) {
      alert(error?.message || 'Combo image upload failed.');
    } finally {
      setImageUploading(false);
    }
  };

  const saveCombo = async (event: React.FormEvent) => {
    event.preventDefault();
    const components = form.components.filter((component) => component.product_id).map((component) => ({ ...component, quantity: Math.max(1, Number(component.quantity || 1)) }));
    if (components.length < 2) return alert('Select at least 2 exact Item Codes for the Combo Pack.');
    const exactComponentKeys = components.map((component) => `${component.product_id}::${component.variant_id || 'base'}`);
    if (new Set(exactComponentKeys).size !== exactComponentKeys.length) return alert('The same exact Item Code is added twice. Keep one row and increase Pack Qty instead.');
    if (components.some((component) => normalizedProductType(products.find((product) => product.id === component.product_id)) === 'variant' && !component.variant_id)) return alert('Select the exact variant Item Code for every variant product.');
    const code = uniqueComboCode(components);
    const rawName = String(form.name_en || autoName(components)).trim();
    const name = /combo\s*pack/i.test(rawName) ? rawName : `${rawName} Combo Pack`.trim();
    if (!rawName) return alert('Combo Pack name is required.');

    const customerDisplayPrice = form.auto_price
      ? Math.max(0, components.reduce((sum, component) => {
          const { product, variant } = resolveComponent(component);
          return sum + (product ? displayUnitPrice(product, settings, variant) * Math.max(1, Number(component.quantity || 1)) : 0);
        }, 0) - COMBO_DISCOUNT)
      : Math.max(0, Number(form.manual_display_price || 0));
    if (customerDisplayPrice <= 0) return alert('Combo customer price must be greater than 0.');

    const includedDelivery = settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0;
    const storedBaseSelling = Math.max(0, customerDisplayPrice - includedDelivery);
    const totalBuying = components.reduce((sum, component) => {
      const { product, variant } = resolveComponent(component);
      return sum + (product ? effectiveBuyingPrice(product, variant) * Math.max(1, Number(component.quantity || 1)) : 0);
    }, 0);

    const data = {
      sku: code,
      name_en: name,
      name_si: form.name_si.trim(),
      description_en: form.description_en.trim(),
      description_si: form.description_si.trim(),
      brand: '',
      search_keywords: `${name}, combo pack, ${components.map((component) => resolveComponent(component).code).join(', ')}`,
      source_shop_name: '',
      source_shop_price: 0,
      category_id: 'combo-pack',
      category_slug: 'combo-pack',
      images: form.images.filter(Boolean),
      buying_price: totalBuying,
      selling_price: storedBaseSelling,
      discount_price: storedBaseSelling,
      discount_enabled: false,
      auto_price_enabled: false,
      auto_discount_on_cost_drop: false,
      stock_quantity: 0,
      status: 'Active' as const,
      product_type: 'bundle' as const,
      variants: [],
      bundle_components: components,
      bundle_auto_price: form.auto_price,
      bundle_discount_amount: COMBO_DISCOUNT,
      specifications: [],
      item_details: (form.item_details || []).filter((detail) => String(detail.label_en || '').trim() && String(detail.value_en || '').trim()).map((detail) => ({
        ...detail,
        label_en: String(detail.label_en || '').trim(),
        label_si: String(detail.label_si || '').trim(),
        value_en: String(detail.value_en || '').trim(),
        value_si: String(detail.value_si || '').trim(),
      })),
      is_test_product: false,
    };

    try {
      if (editingCombo) updateProduct({ ...editingCombo, ...data });
      else addProduct(data);
      try { await publishComboNotification(name, customerDisplayPrice); } catch (notifyError:any) { alert(`Combo saved, but notification failed: ${notifyError?.message || 'Unknown error'}`); }
      setNotifyCustomers(false);
      setShowEditor(false);
      setEditingCombo(null);
      setNameTouched(false);
    } catch (error: any) {
      alert(error?.message || 'Combo Pack save failed.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-400">Dedicated Combo Workspace</p>
          <h2 className="mt-1 text-xl font-black text-white">Combo Packs ({combos.length})</h2>
          <p className="mt-1 text-xs text-neutral-400">Combo Packs stay separate from Single Products. Stock remains linked to the exact component Item Codes and Qty.</p>
        </div>
        <button type="button" onClick={resetNew} className="rounded-xl bg-cyan-400 px-4 py-3 text-xs font-black text-neutral-950"><Plus className="mr-1 inline h-4 w-4" />Create Combo Pack</button>
      </div>

      {showEditor && (
        <form onSubmit={saveCombo} className="rounded-3xl border border-cyan-500/25 bg-neutral-900 p-4 sm:p-5 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-base font-black text-white">{editingCombo ? 'Edit Combo Pack' : 'New Combo Pack'}</h3><p className="mt-1 text-[10px] text-neutral-500">Select exact existing Item Codes. Combo stock is never stored separately.</p></div>
            <button type="button" onClick={() => { setShowEditor(false); setEditingCombo(null); }} className="rounded-full bg-neutral-800 p-2 text-neutral-300"><X className="h-4 w-4" /></button>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-xs font-black text-cyan-300">Items inside one Combo Pack</p><p className="text-[10px] text-neutral-500">Choose the exact Item Code and enter how many units of it go into one pack.</p></div>
              <button type="button" onClick={() => setForm((previous) => ({ ...previous, components: [...previous.components, { product_id: '', quantity: 1 }] }))} className="rounded-lg bg-cyan-500 px-3 py-2 text-[10px] font-black text-neutral-950"><Plus className="mr-1 inline h-3 w-3" />Add Item</button>
            </div>
            {form.components.map((component, index) => {
              const resolved = resolveComponent(component);
              return <div key={`${index}-${component.product_id}-${component.variant_id || ''}`} className="grid grid-cols-1 gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3 sm:grid-cols-[minmax(0,1fr)_90px_38px] items-end">
                <label className="text-[10px] font-bold text-neutral-400">Exact Single Item Code
                  <select value={resolved.code} onChange={(event) => updateComponent(index, event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-white">
                    <option value="">Choose Item Code...</option>
                    {selectableItems.map((item) => <option key={`${item.product_id}-${item.variant_id || 'base'}`} value={item.code}>{item.code} — {item.name}{item.detail ? ` / ${item.detail}` : ''}</option>)}
                  </select>
                </label>
                <label className="text-[10px] font-bold text-neutral-400">Pack Qty<input type="number" min="1" value={component.quantity} onChange={(event) => setForm((previous) => { const next = [...previous.components]; next[index] = { ...next[index], quantity: Math.max(1, Number(event.target.value || 1)) }; return { ...previous, components: next }; })} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-white" /></label>
                <button type="button" onClick={() => setForm((previous) => ({ ...previous, components: previous.components.filter((_, rowIndex) => rowIndex !== index) }))} className="h-9 rounded-lg bg-red-950 text-red-300"><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
              </div>;
            })}
            {!form.components.length && <div className="rounded-xl border border-dashed border-cyan-500/30 p-4 text-center text-[10px] text-cyan-300">Add at least 2 Item Codes.</div>}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-neutral-300">Auto Combo Code
              <input readOnly value={comboCode} className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-neutral-950 px-3 py-2 font-mono text-cyan-300" />
              <span className="mt-1 block text-[9px] font-normal text-neutral-500">Example: S0004 + S0019 → CB-S0004-S0019. Duplicate combinations receive -02, -03 automatically.</span>
            </label>
            <label className="text-xs font-bold text-neutral-300">Category
              <input readOnly value="Combo Pack" className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-neutral-950 px-3 py-2 font-black text-cyan-300" />
              <span className="mt-1 block text-[9px] font-normal text-neutral-500">Combo products always stay in the dedicated Combo Pack customer category.</span>
            </label>

            <label className="text-xs font-bold text-neutral-300 sm:col-span-2">Combo Name (English)
              <div className="mt-1 flex gap-2"><input required value={form.name_en} onChange={(event) => { setNameTouched(true); setForm((previous) => ({ ...previous, name_en: event.target.value })); }} placeholder="Kids Scooter + Kids Helmet Combo Pack" className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" /><button type="button" onClick={regenerateName} className="shrink-0 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 text-cyan-300" title="Regenerate from selected products"><Sparkles className="h-4 w-4" /></button></div>
              <span className="mt-1 block text-[9px] font-normal text-neutral-500">Long source product names are shortened automatically. “Combo Pack” is always included in the generated name; you can still edit it.</span>
            </label>
            <label className="text-xs font-bold text-neutral-300">Combo Name (Sinhala)<input value={form.name_si} onChange={(event) => { setManualSinhalaContent(true); setForm((previous) => ({ ...previous, name_si: event.target.value })); }} className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" /></label>
            <div className="flex items-end justify-end"><button type="button" disabled={comboContentBusy || form.components.filter((component) => component.product_id).length < 2} onClick={() => void generateComboContent(form.components, true)} className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[10px] font-black text-violet-300 disabled:opacity-30"><Sparkles className="h-3.5 w-3.5" />{comboContentBusy ? 'Generating…' : 'Regenerate Description + Specs'}</button></div>

            <label className="text-xs font-bold text-neutral-300">Description (English)<textarea rows={5} value={form.description_en} onChange={(event) => { setManualEnglishContent(true); setForm((previous) => ({ ...previous, description_en: event.target.value })); }} placeholder="Auto-created from the selected single items. You can edit it manually." className="mt-1 w-full resize-y rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" /></label>
            <label className="text-xs font-bold text-neutral-300">Description (Sinhala)<textarea rows={5} value={form.description_si} onChange={(event) => { setManualSinhalaContent(true); setForm((previous) => ({ ...previous, description_si: event.target.value })); }} placeholder="English description එකට ගැලපෙන Sinhala auto fill වෙයි." className="mt-1 w-full resize-y rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" /></label>
            <div className="sm:col-span-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-[10px] leading-4 text-violet-200">
              Selected single items 2ක් හෝ වැඩි ගණනක් දාපු ගමන්, ඒ items වල English description / item details / measurements බලලා Combo එකට ගැලපෙන English description + useful specifications auto හදනවා. Sinhala එක ඒ generated English එකෙන්ම හදනවා. Manual edit කළාම auto overwrite වෙන්නේ නැහැ; නැවත හදන්න ඕන නම් Regenerate button එක use කරන්න.
            </div>
          </div>

          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-xs font-black text-violet-300">Combo Item Details / Specifications <span className="text-[9px] text-neutral-500">(Optional)</span></p><p className="mt-1 text-[10px] text-neutral-500">Useful details are auto-created only from the selected products. Empty details are never shown to customers.</p></div>
              <button type="button" onClick={() => { setManualEnglishContent(true); setForm((previous) => ({ ...previous, item_details: [...previous.item_details, { id: `combo-custom-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, label_en: '', value_en: '', label_si: '', value_si: '' }] })); }} className="rounded-lg border border-violet-500/30 bg-neutral-950 px-3 py-2 text-[10px] font-black text-violet-300"><Plus className="mr-1 inline h-3 w-3" />Custom Detail</button>
            </div>
            {form.item_details.map((detail, index) => <div key={detail.id} className="grid grid-cols-1 gap-2 rounded-xl border border-neutral-800 bg-neutral-950/70 p-2.5 lg:grid-cols-[1fr_1.3fr_1fr_1.3fr_36px] lg:items-end">
              <label className="text-[10px] text-neutral-400">Detail (English)<input value={detail.label_en} onChange={(event) => { setManualEnglishContent(true); const value=event.target.value; setForm((previous) => ({ ...previous, item_details: previous.item_details.map((row,rowIndex) => rowIndex===index ? { ...row, label_en:value } : row) })); }} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" /></label>
              <label className="text-[10px] text-neutral-400">Value (English)<input value={detail.value_en} onChange={(event) => { setManualEnglishContent(true); const value=event.target.value; setForm((previous) => ({ ...previous, item_details: previous.item_details.map((row,rowIndex) => rowIndex===index ? { ...row, value_en:value } : row) })); }} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" /></label>
              <label className="text-[10px] text-neutral-400">Detail (Sinhala)<input value={detail.label_si || ''} onChange={(event) => { setManualSinhalaContent(true); const value=event.target.value; setForm((previous) => ({ ...previous, item_details: previous.item_details.map((row,rowIndex) => rowIndex===index ? { ...row, label_si:value } : row) })); }} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" /></label>
              <label className="text-[10px] text-neutral-400">Value (Sinhala)<input value={detail.value_si || ''} onChange={(event) => { setManualSinhalaContent(true); const value=event.target.value; setForm((previous) => ({ ...previous, item_details: previous.item_details.map((row,rowIndex) => rowIndex===index ? { ...row, value_si:value } : row) })); }} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" /></label>
              <button type="button" onClick={() => { setManualEnglishContent(true); setForm((previous) => ({ ...previous, item_details: previous.item_details.filter((_, rowIndex) => rowIndex !== index) })); }} className="h-9 rounded-lg bg-red-950 text-red-300"><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
            </div>)}
            {!form.item_details.length && <p className="text-[10px] text-neutral-600">No Combo specifications yet. With 2+ selected items, they will auto-generate when source details are available.</p>}
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black text-emerald-300">Combo Price</p><p className="text-[10px] text-neutral-500">AUTO = current customer-visible price of every component × Pack Qty, then Rs.50 off once.</p></div><div className="flex rounded-xl border border-neutral-700 bg-neutral-950 p-1"><button type="button" onClick={() => setForm((previous) => ({ ...previous, auto_price: true }))} className={`rounded-lg px-3 py-1.5 text-[10px] font-black ${form.auto_price ? 'bg-emerald-500 text-black' : 'text-neutral-400'}`}>AUTO</button><button type="button" onClick={() => setForm((previous) => ({ ...previous, auto_price: false, manual_display_price: previous.manual_display_price || autoDisplayPrice }))} className={`rounded-lg px-3 py-1.5 text-[10px] font-black ${!form.auto_price ? 'bg-amber-500 text-black' : 'text-neutral-400'}`}>MANUAL</button></div></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"><p className="text-[9px] font-bold text-neutral-500">SINGLE ITEMS TOTAL</p><p className="mt-1 text-lg font-black text-white">Rs. {(autoDisplayPrice + (form.components.length >= 2 ? COMBO_DISCOUNT : 0)).toLocaleString()}</p></div>
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"><p className="text-[9px] font-bold text-neutral-500">COMBO SAVING</p><p className="mt-1 text-lg font-black text-cyan-300">Rs. {form.components.length >= 2 ? COMBO_DISCOUNT : 0}</p></div>
              <label className="rounded-xl border border-emerald-500/20 bg-neutral-950 p-3 text-[9px] font-bold text-neutral-500">CUSTOMER COMBO PRICE<input type="number" min="0" readOnly={form.auto_price} value={form.auto_price ? autoDisplayPrice : form.manual_display_price} onChange={(event) => setForm((previous) => ({ ...previous, manual_display_price: Math.max(0, Number(event.target.value || 0)) }))} className={`mt-1 w-full border-0 bg-transparent p-0 text-lg font-black outline-none ${form.auto_price ? 'text-emerald-300' : 'text-amber-300'}`} /></label>
            </div>
            <p className="text-[10px] text-emerald-200">Example: Rs.1,750 + Rs.1,700 = Rs.3,450 → Combo = Rs.3,400. Existing FREE-delivery reserve logic is kept; it is not added twice to the saved Combo price.</p>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-black text-white">Combo Images</p><p className="text-[10px] text-neutral-500">Own customer-facing images, just like a normal product. Maximum 6.</p></div><label htmlFor="ora-combo-images" className="cursor-pointer rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-black text-cyan-300"><Upload className="mr-1 inline h-3 w-3" />{imageUploading ? 'Uploading…' : 'Upload Images'}</label><input id="ora-combo-images" type="file" accept="image/*" multiple className="hidden" onChange={(event) => { void handleImages(event.target.files); event.target.value = ''; }} /></div>
            <div className="mt-3 flex flex-wrap gap-2">{form.images.map((image, index) => <div key={`${image}-${index}`} className="relative h-20 w-20 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"><img src={image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /><button type="button" onClick={() => setForm((previous) => ({ ...previous, images: previous.images.filter((_, rowIndex) => rowIndex !== index) }))} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X className="h-3 w-3" /></button></div>)}{!form.images.length && <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-neutral-700 text-neutral-600"><ImageIcon className="h-5 w-5" /></div>}</div>
          </div>

          {canNotify && <label className="flex items-center gap-2 rounded-xl border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-[10px] font-black text-orange-200"><input type="checkbox" checked={notifyCustomers} onChange={(e)=>setNotifyCustomers(e.target.checked)} className="accent-orange-500"/><Bell className="h-3.5 w-3.5"/>Send customer notification when this Combo Pack is saved</label>}

          <div className="flex justify-end gap-2"><button type="button" onClick={() => { setShowEditor(false); setEditingCombo(null); }} className="rounded-xl border border-neutral-700 px-4 py-2 text-xs font-black text-neutral-300">Cancel</button><button type="submit" className="rounded-xl bg-cyan-400 px-5 py-2 text-xs font-black text-neutral-950">{editingCombo ? 'Save Combo Changes' : 'Create Combo Pack'} • Rs. {displayedComboPrice.toLocaleString()}</button></div>
        </form>
      )}

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-neutral-800 p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 sm:max-w-lg"><Search className="h-4 w-4 text-neutral-500"/><input value={comboSearch} onChange={(e)=>setComboSearch(e.target.value)} placeholder="Search Combo Code, name or component Item Code..." className="w-full bg-transparent text-xs text-white outline-none"/></label>
          <p className="text-[10px] font-bold text-neutral-500">Showing {filteredCombos.length ? ((comboPage-1)*COMBO_PAGE_SIZE)+1 : 0}–{Math.min(comboPage*COMBO_PAGE_SIZE,filteredCombos.length)} of {filteredCombos.length}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-left text-xs text-neutral-300">
            <thead className="bg-neutral-950 text-[10px] uppercase text-neutral-500"><tr><th className="p-3">Image</th><th className="p-3">Combo Code</th><th className="p-3">Combo Name</th><th className="p-3">Price</th><th className="p-3">Components</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-neutral-800">{comboRows.map((combo)=><tr key={combo.id} className="hover:bg-neutral-950/60">
              <td className="p-3">{combo.images?.[0]?<img src={combo.images[0]} alt="" className="h-12 w-12 rounded-lg object-cover" referrerPolicy="no-referrer"/>:<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-950 text-neutral-700"><ImageIcon className="h-4 w-4"/></div>}</td>
              <td className="p-3"><span className="font-mono text-[10px] font-black text-cyan-300">{combo.sku}</span><p className="mt-1 text-[9px] font-black text-neutral-600">COMBO PACK</p></td>
              <td className="p-3"><p className="max-w-[300px] font-black text-white">{combo.name_en}</p>{combo.name_si&&<p className="mt-1 max-w-[300px] truncate text-[10px] text-neutral-500">{combo.name_si}</p>}</td>
              <td className="p-3"><p className="font-black text-orange-400">Rs. {displayUnitPrice(combo,settings).toLocaleString()}</p><p className="mt-1 text-[9px] text-neutral-600">{combo.bundle_auto_price===true?'AUTO − Rs.50':'Manual'}</p></td>
              <td className="p-3"><p className="max-w-[360px] text-[10px] leading-5 text-neutral-400">{(combo.bundle_components||[]).map((component)=>{const {product,variant,code}=resolveComponent(component);return `${code||'Missing'} ×${Math.max(1,Number(component.quantity||1))}${variant?` (${variantOptionSummary(variant)})`:''}${product?` — ${product.name_en}`:''}`;}).join(' + ')||'No components saved'}</p></td>
              <td className="p-3"><div className="flex justify-end gap-1"><button type="button" onClick={()=>openEdit(combo)} className="rounded-lg bg-neutral-800 p-2 text-amber-300"><Edit className="h-3.5 w-3.5"/></button><button type="button" onClick={()=>{if(confirm(`Delete Combo Pack ${combo.name_en}? Historical orders remain unchanged.`)){try{deleteProduct(combo.id);}catch(error:any){alert(error?.message||'Delete failed.');}}}} className="rounded-lg bg-red-950 p-2 text-red-300"><Trash2 className="h-3.5 w-3.5"/></button></div></td>
            </tr>)}</tbody>
          </table>
          {!comboRows.length&&<div className="p-10 text-center text-xs text-neutral-500">{combos.length?'No Combo Packs match this search.':'No Combo Packs yet.'}</div>}
        </div>
        {comboPageCount>1&&<div className="flex items-center justify-between border-t border-neutral-800 px-3 py-3"><button type="button" disabled={comboPage<=1} onClick={()=>setComboPage((page)=>Math.max(1,page-1))} className="inline-flex items-center gap-1 rounded-lg border border-neutral-700 px-3 py-2 text-[10px] font-black text-neutral-300 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5"/>Previous</button><span className="text-[10px] font-black text-neutral-500">Page {comboPage} / {comboPageCount}</span><button type="button" disabled={comboPage>=comboPageCount} onClick={()=>setComboPage((page)=>Math.min(comboPageCount,page+1))} className="inline-flex items-center gap-1 rounded-lg border border-neutral-700 px-3 py-2 text-[10px] font-black text-neutral-300 disabled:opacity-30">Next<ChevronRight className="h-3.5 w-3.5"/></button></div>}
      </div>
    </div>
  );
};
