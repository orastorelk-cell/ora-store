const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA special offer percentage rule] ${label} marker not found`);
  return text.replace(from, to);
};

const replaceAllRequired = (text: string, from: string, to: string, label: string) => {
  if (!text.includes(from)) {
    if (text.includes(to)) return text;
    throw new Error(`[O-RA special offer percentage rule] ${label} marker not found`);
  }
  return text.split(from).join(to);
};

/**
 * Runs immediately after roundSpecialOfferPatch.
 *
 * Storefront appearance stays unchanged. The real customer price is never edited by
 * this feature. Product Add/Edit owns the Special Offer controls; variants inherit
 * the product percentage unless an exact variant gets its own override. Product List
 * is read-only for this feature and shows only the saved % + crossed-price preview.
 */
export const specialOfferPercentageRulePatch = () => ({
  name: 'ora-special-offer-percentage-rule-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/lib/productVariants.ts')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from './roundSpecialOffer';",
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from './roundSpecialOffer';",
        'productVariants helper import',
      );
      text = replaceRequired(
        text,
        "    enabled: normalizedProductType(product) !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n    freeDeliveryEnabled: Boolean(settings?.free_delivery_enabled),",
        "    enabled: normalizedProductType(product) !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n    percent: roundSpecialOfferPercentForSelection(product, variant),\n    freeDeliveryEnabled: Boolean(settings?.free_delivery_enabled),",
        'order snapshot percentage',
      );
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductCard.tsx')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../lib/roundSpecialOffer';",
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../lib/roundSpecialOffer';",
        'ProductCard helper import',
      );
      text = text.replace(
        /enabled: roundSpecialOfferEnabledForProduct\(product\),\n\s*freeDeliveryEnabled:/g,
        "enabled: roundSpecialOfferEnabledForProduct(product),\n          percent: roundSpecialOfferPercentForSelection(product, variant),\n          freeDeliveryEnabled:",
      );
      text = text.replace(
        /enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct\(product\),\n\s*freeDeliveryEnabled:/g,
        "enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n        percent: roundSpecialOfferPercentForSelection(product),\n        freeDeliveryEnabled:",
      );
      if (!text.includes('percent: roundSpecialOfferPercentForSelection(product')) {
        throw new Error('[O-RA special offer percentage rule] ProductCard percentage markers not found');
      }
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductDetailModal.tsx')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../lib/roundSpecialOffer';",
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../lib/roundSpecialOffer';",
        'ProductDetail helper import',
      );
      text = replaceRequired(
        text,
        "    enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct(selectedProduct),\n    freeDeliveryEnabled: Boolean(settings.free_delivery_enabled),",
        "    enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct(selectedProduct),\n    percent: roundSpecialOfferPercentForSelection(selectedProduct, selectedVariant),\n    freeDeliveryEnabled: Boolean(settings.free_delivery_enabled),",
        'ProductDetail percentage',
      );
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../../lib/roundSpecialOffer';",
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../../lib/roundSpecialOffer';",
        'Admin helper import',
      );

      // Product form state: new products start OFF with a harmless 5% draft value.
      text = replaceAllRequired(
        text,
        "    auto_price_enabled: true,\n    auto_discount_on_cost_drop: true,\n    offer_buying_price:",
        "    auto_price_enabled: true,\n    auto_discount_on_cost_drop: true,\n    auto_round_special_offer_enabled: false,\n    auto_round_special_offer_percent: 5,\n    offer_buying_price:",
        'product form default fields',
      );
      text = replaceRequired(
        text,
        "      auto_price_enabled: true, auto_discount_on_cost_drop: true, offer_buying_price:",
        "      auto_price_enabled: true, auto_discount_on_cost_drop: true, auto_round_special_offer_enabled: false, auto_round_special_offer_percent: 5, offer_buying_price:",
        'new workspace default fields',
      );
      text = replaceRequired(
        text,
        "                            auto_price_enabled: p.auto_price_enabled !== false,\n                            auto_discount_on_cost_drop: p.auto_discount_on_cost_drop !== false,\n                            offer_buying_price: p.offer_buying_price,",
        "                            auto_price_enabled: p.auto_price_enabled !== false,\n                            auto_discount_on_cost_drop: p.auto_discount_on_cost_drop !== false,\n                            auto_round_special_offer_enabled: Boolean((p as any).auto_round_special_offer_enabled),\n                            auto_round_special_offer_percent: roundSpecialOfferPercentForSelection(p),\n                            offer_buying_price: p.offer_buying_price,",
        'existing product edit fields',
      );

      // Put the ON/OFF + main percentage beside the existing O-RA Price Calculator.
      const calculatorMarker = `                    <div className=\"rounded-xl border border-emerald-500/20 bg-neutral-950 p-3\"><p className=\"text-[9px] font-bold text-neutral-500\">CUSTOMER DISPLAY</p><p className=\"mt-1 text-lg font-black text-emerald-300\">Rs. {(Number(productForm.selling_price||0)+(settings.free_delivery_enabled?Math.max(0,Number(settings.delivery_fee||0)):0)).toLocaleString()}</p><p className=\"text-[9px] text-neutral-500\">{settings.free_delivery_enabled?'FREE delivery shown':'delivery separate'}</p></div>\n                  </div>\n                  <div className=\"grid grid-cols-2 gap-1 text-[9px] text-neutral-500 sm:grid-cols-5\">`;
      const calculatorWithOffer = `                    <div className=\"rounded-xl border border-emerald-500/20 bg-neutral-950 p-3\"><p className=\"text-[9px] font-bold text-neutral-500\">CUSTOMER DISPLAY</p><p className=\"mt-1 text-lg font-black text-emerald-300\">Rs. {(Number(productForm.selling_price||0)+(settings.free_delivery_enabled?Math.max(0,Number(settings.delivery_fee||0)):0)).toLocaleString()}</p><p className=\"text-[9px] text-neutral-500\">{settings.free_delivery_enabled?'FREE delivery shown':'delivery separate'}</p></div>\n                  </div>\n                  {(() => {\n                    const enabled = Boolean(productForm.auto_round_special_offer_enabled);\n                    const offerPercent = Math.max(1, Math.min(80, Number(productForm.auto_round_special_offer_percent || 5)));\n                    const customerPrice = Number(productForm.selling_price || 0) + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0);\n                    const existingSavedOffer = productForm.discount_enabled !== false && Number(productForm.discount_price || 0) > 0 && Number(productForm.discount_price || 0) < Number(productForm.selling_price || 0);\n                    const preview = calculateRoundSpecialOffer({ currentPrice:customerPrice, enabled, percent:offerPercent, hasExistingDiscount:existingSavedOffer });\n                    return <div className=\"rounded-xl border border-orange-500/25 bg-orange-500/5 p-3\">\n                      <div className=\"flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between\">\n                        <div><p className=\"text-[10px] font-black text-orange-300\">SPECIAL OFFER DISPLAY</p><p className=\"text-[9px] text-neutral-500\">Keeps the real customer price unchanged and calculates only the higher crossed price.</p></div>\n                        <div className=\"flex items-center gap-2\">\n                          <button type=\"button\" onClick={()=>setProductForm(prev=>({...prev,auto_round_special_offer_enabled:!prev.auto_round_special_offer_enabled}))} className={\`rounded-lg border px-3 py-2 text-[9px] font-black \${enabled?'border-orange-400 bg-orange-500 text-black':'border-neutral-700 bg-neutral-950 text-neutral-400'}\`}>SPECIAL OFFER {enabled?'ON':'OFF'}</button>\n                          <label className=\"flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[9px] font-black text-neutral-400\"><input type=\"number\" min=\"1\" max=\"80\" step=\"1\" disabled={!enabled} value={offerPercent} onChange={(e)=>setProductForm(prev=>({...prev,auto_round_special_offer_percent:Math.max(1,Math.min(80,Number(e.target.value||5)))}))} className=\"w-12 bg-transparent text-center text-sm font-black text-white outline-none disabled:text-neutral-600\"/>%</label>\n                        </div>\n                      </div>\n                      <div className=\"mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px]\">\n                        <span className=\"text-neutral-500\">Actual: <b className=\"text-emerald-300\">Rs. {customerPrice.toLocaleString()}</b></span>\n                        <span className=\"text-neutral-500\">Crossed: <b className=\"text-orange-300\">{preview.active ? \`Rs. \${preview.regularPrice.toLocaleString()}\` : '—'}</b></span>\n                        <span className=\"text-neutral-500\">Badge: <b className=\"text-orange-300\">{enabled ? \`\${offerPercent}% OFF\` : 'OFF'}</b></span>\n                      </div>\n                      {productForm.product_type==='variant' && enabled && <p className=\"mt-2 text-[9px] font-bold text-violet-300\">All variants inherit {offerPercent}% automatically. Use a variant override below only when that sub-item needs a different %.</p>}\n                      {existingSavedOffer && enabled && <p className=\"mt-2 text-[9px] font-bold text-amber-300\">Existing saved Supplier Offer has priority over this display offer.</p>}\n                    </div>;\n                  })()}\n                  <div className=\"grid grid-cols-2 gap-1 text-[9px] text-neutral-500 sm:grid-cols-5\">`;
      text = replaceRequired(text, calculatorMarker, calculatorWithOffer, 'price calculator special offer control');

      // Variant editor: default = inherit main %, optional exact-variant override.
      text = replaceRequired(
        text,
        "                      <div className=\"grid grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,1.7fr)_110px_110px_90px_150px] items-start\">",
        "                      <div className=\"grid grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,1.7fr)_110px_110px_150px_90px_150px] items-start\">",
        'variant editor grid',
      );
      const sellingField = `                        <label className=\"text-[10px] text-neutral-400\">Selling Rs.<input type=\"number\" min=\"0\" value={v.selling_price} onChange={(e)=>{const next=[...productForm.variants];next[index]={...v,selling_price:Number(e.target.value||0)};setProductForm(prev=>({...prev,variants:next}));}} className=\"mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-2 text-white\"/></label>`;
      const sellingWithOffer = `                        <label className=\"text-[10px] text-neutral-400\">Selling Rs.<input type=\"number\" min=\"0\" value={v.selling_price} onChange={(e)=>{const next=[...productForm.variants];next[index]={...v,selling_price:Number(e.target.value||0)};setProductForm(prev=>({...prev,variants:next}));}} className=\"mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-2 text-white\"/></label>\n                        {productForm.auto_round_special_offer_enabled ? (()=>{\n                          const customPercent = (v as any).auto_round_special_offer_percent;\n                          const offerPercent = roundSpecialOfferPercentForSelection(productForm, v);\n                          const customerPrice = Number(v.selling_price || 0) + (settings.free_delivery_enabled ? Math.max(0,Number(settings.delivery_fee||0)) : 0);\n                          const existingSavedOffer = (v as any).discount_enabled !== false && Number((v as any).discount_price || 0) > 0 && Number((v as any).discount_price || 0) < Number(v.selling_price || 0);\n                          const preview = calculateRoundSpecialOffer({ currentPrice:customerPrice, enabled:true, percent:offerPercent, hasExistingDiscount:existingSavedOffer });\n                          return <div className=\"rounded-lg border border-orange-500/20 bg-orange-500/5 p-2\">\n                            <div className=\"flex items-center justify-between gap-1\"><span className=\"text-[9px] font-black text-orange-300\">Offer %</span>{customPercent!==undefined&&customPercent!==null&&<button type=\"button\" onClick={()=>{const next=[...productForm.variants];next[index]={...v,auto_round_special_offer_percent:undefined} as any;setProductForm(prev=>({...prev,variants:next}));}} className=\"text-[8px] font-black text-violet-300\">Use Main</button>}</div>\n                            <div className=\"mt-1 flex items-center gap-1\"><input type=\"number\" min=\"1\" max=\"80\" step=\"1\" value={offerPercent} onChange={(e)=>{const value=Math.max(1,Math.min(80,Number(e.target.value||5)));const next=[...productForm.variants];next[index]={...v,auto_round_special_offer_percent:value} as any;setProductForm(prev=>({...prev,variants:next}));}} className=\"w-12 rounded-md border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-center text-[10px] font-black text-white\"/><span className=\"text-[9px] font-black text-neutral-500\">%</span></div>\n                            <p className=\"mt-1 text-[8px] leading-3 text-neutral-500\">{customPercent===undefined||customPercent===null?'Main %':'Custom %'} • Crossed {preview.active ? \`Rs. \${preview.regularPrice.toLocaleString()}\` : '—'}</p>\n                          </div>;\n                        })() : <div className=\"rounded-lg border border-neutral-800 bg-neutral-900/40 p-2 text-[8px] text-neutral-600\">Offer OFF</div>}`;
      text = replaceRequired(text, sellingField, sellingWithOffer, 'variant offer override');

      // Product List is display-only for Special Offer. Editing happens inside Product Edit.
      const oldListBlock = `                      {normalizedProductType(p) !== 'bundle' && (() => {\n                        const enabled = roundSpecialOfferEnabledForProduct(p);\n                        const currentPrice = displayUnitPrice(p, settings);\n                        const hasExistingDiscount = normalizedProductType(p) !== 'variant' && p.discount_enabled !== false && Number(p.discount_price || 0) > 0 && Number(p.discount_price || 0) < Number(p.selling_price || 0);\n                        const preview = calculateRoundSpecialOffer({ currentPrice, enabled, freeDeliveryEnabled:Boolean(settings.free_delivery_enabled), hasExistingDiscount });\n                        const note = enabled\n                          ? !settings.free_delivery_enabled\n                            ? 'Waiting for Free Delivery ON'\n                            : normalizedProductType(p) === 'variant'\n                              ? 'Checks each variant price automatically'\n                              : preview.active\n                                ? \`Rs. \${preview.regularPrice.toLocaleString()} → Rs. \${preview.offerPrice.toLocaleString()}\`\n                                : preview.reason === 'existing-offer'\n                                  ? 'Existing saved offer has priority'\n                                  : 'Current customer price is already round'\n                          : 'Works only on non-round customer prices';\n                        return <div className=\"mt-1.5\">\n                          <button\n                            type=\"button\"\n                            onClick={() => updateProduct({ ...(p as any), auto_round_special_offer_enabled: !enabled } as any)}\n                            className={\`rounded-full border px-2 py-1 text-[8px] font-black \${enabled ? 'border-orange-500/40 bg-orange-500/10 text-orange-300' : 'border-neutral-700 bg-neutral-950 text-neutral-500'}\`}\n                            title=\"Automatic Special Offer works only while Free Delivery is ON. It never changes the actual charged customer price.\"\n                          >\n                            SPECIAL OFFER {enabled ? 'ON' : 'OFF'}\n                          </button>\n                          <p className=\"mt-1 max-w-[190px] whitespace-normal text-[8px] leading-3 text-neutral-500\">{note}</p>\n                        </div>;\n                      })()}`;
      const newListBlock = `                      {normalizedProductType(p) !== 'bundle' && (() => {\n                        const enabled = roundSpecialOfferEnabledForProduct(p);\n                        if (!enabled) return <p className=\"mt-1 text-[8px] font-bold text-neutral-600\">Special Offer OFF</p>;\n                        const selections:any[] = normalizedProductType(p)==='variant' ? ((p.variants||[]).filter((v:any)=>v.status!=='Draft')) : [undefined];\n                        const previews = selections.map((variant:any)=>{\n                          const target:any = variant || p;\n                          const currentPrice = displayUnitPrice(p, settings, variant);\n                          const hasExistingDiscount = target.discount_enabled !== false && Number(target.discount_price || 0) > 0 && Number(target.discount_price || 0) < Number(target.selling_price || 0);\n                          const percent = roundSpecialOfferPercentForSelection(p, variant);\n                          return calculateRoundSpecialOffer({ currentPrice, enabled:true, percent, hasExistingDiscount });\n                        }).filter((preview:any)=>preview.active);\n                        if (!previews.length) return <p className=\"mt-1 text-[8px] font-bold text-amber-400\">Existing saved offer has priority</p>;\n                        const percents=[...new Set(previews.map((preview:any)=>preview.percent))];\n                        const crossed=previews.map((preview:any)=>preview.regularPrice);\n                        const minCrossed=Math.min(...crossed), maxCrossed=Math.max(...crossed);\n                        return <div className=\"mt-1.5\">\n                          <p className=\"text-[9px] font-black text-orange-300\">{percents.length===1 ? \`\${percents[0]}% OFF\` : \`\${Math.min(...percents)}–\${Math.max(...percents)}% OFF\`}</p>\n                          <p className=\"mt-0.5 text-[8px] font-bold text-neutral-500\">Crossed: {minCrossed===maxCrossed ? \`Rs. \${minCrossed.toLocaleString()}\` : \`Rs. \${minCrossed.toLocaleString()} – \${maxCrossed.toLocaleString()}\`}</p>\n                        </div>;\n                      })()}`;
      text = replaceRequired(text, oldListBlock, newListBlock, 'Product List read-only offer summary');

      return { code: text, map: null };
    }

    return null;
  },
});
