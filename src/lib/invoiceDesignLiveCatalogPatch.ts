const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA invoice live catalog] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Invoice Design Studio preview/test data only.
 * Builds memory-only invoice orders from the currently loaded product catalog and
 * current pricing/offer settings. It never creates an order, changes stock, writes
 * Google Sheets, or changes packing/download history.
 */
export const invoiceDesignLiveCatalogPatch = () => ({
  name: 'ora-invoice-design-live-catalog-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/InvoiceDesignPanel.tsx')) return null;

    let text = code;

    text = replaceRequired(
      text,
      "import { buildExactInvoiceSvg } from '../../lib/exactInvoiceTemplate';\nimport { generateOrderInvoicePDF, generatePackingTestA6AndMultiPagePDF, generatePackingTestA4FourUpPDF } from '../../lib/pdfGenerator';",
      "import { buildExactInvoiceSvg } from '../../lib/exactInvoiceTemplate';\nimport { generateOrderInvoicePDF, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF } from '../../lib/pdfGenerator';\nimport { useStore } from '../../context/StoreContext';\nimport { activeVariants, displayUnitPrice, normalizedProductType, regularDisplayUnitPrice, variantById, variantOptionSummary } from '../../lib/productVariants';\nimport { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../../lib/roundSpecialOffer';",
      'imports',
    );

    const panelMarker = "export const InvoiceDesignPanel:React.FC<Props>=({settings,updateSettings})=>{";
    const helpers = `const liveMoney=(value:unknown)=>Math.max(0,Math.round(Number(value||0)*100)/100);\n\nconst liveQtyOfferRate=(settings:StoreSettings,qty:number)=>{\n  if(settings.multi_buy_discount_enabled===false || qty<=1) return 0;\n  const t1Min=Math.max(2,Number(settings.multi_buy_tier1_min??2));\n  const t1Max=Math.max(t1Min,Number(settings.multi_buy_tier1_max??3));\n  const t1Rate=Math.max(0,Math.min(100,Number(settings.multi_buy_tier1_rate??5)));\n  const t2Min=Math.max(t1Max+1,Number(settings.multi_buy_tier2_min??4));\n  const t2Max=Math.max(t2Min,Number(settings.multi_buy_tier2_max??5));\n  const t2Rate=Math.max(0,Math.min(100,Number(settings.multi_buy_tier2_rate??7.5)));\n  const t3Min=Math.max(t2Max+1,Number(settings.multi_buy_tier3_min??6));\n  const t3Rate=Math.max(0,Math.min(100,Number(settings.multi_buy_tier3_rate??10)));\n  if(qty>=t1Min && qty<=t1Max) return t1Rate;\n  if(qty>=t2Min && qty<=t2Max) return t2Rate;\n  if(qty>=t3Min) return t3Rate;\n  return 0;\n};\n\nconst liveSelectionFor=(product:any)=>{\n  const type=normalizedProductType(product);\n  const variant=type==='variant' ? activeVariants(product)[0] : undefined;\n  return {type,variant};\n};\n\nconst livePriceSnapshot=(product:any,settings:StoreSettings)=>{\n  const {type,variant}=liveSelectionFor(product);\n  const actualUnit=liveMoney(displayUnitPrice(product,settings,variant));\n  const savedRegular=liveMoney(regularDisplayUnitPrice(product,settings,variant));\n  const hasSavedOffer=savedRegular>actualUnit+0.001;\n  const roundPreview=calculateRoundSpecialOffer({\n    currentPrice:actualUnit,\n    enabled:type!=='bundle' && roundSpecialOfferEnabledForProduct(product),\n    percent:roundSpecialOfferPercentForSelection(product,variant),\n    hasExistingDiscount:hasSavedOffer,\n  });\n  const referenceUnit=liveMoney(hasSavedOffer?savedRegular:(roundPreview.active?roundPreview.regularPrice:actualUnit));\n  return {type,variant,actualUnit,referenceUnit,specialPerUnit:liveMoney(Math.max(0,referenceUnit-actualUnit))};\n};\n\nconst liveCatalogRows=(products:any[],settings:StoreSettings)=>{\n  return (products||[])\n    .filter((product:any)=>{\n      if(!product || product.status==='Draft') return false;\n      const snapshot=livePriceSnapshot(product,settings);\n      if(snapshot.type==='variant' && !snapshot.variant) return false;\n      return snapshot.actualUnit>0;\n    })\n    .map((product:any,index:number)=>({product,index,offer:livePriceSnapshot(product,settings).specialPerUnit>0?1:0}))\n    .sort((a:any,b:any)=>b.offer-a.offer || a.index-b.index)\n    .map((row:any)=>row.product);\n};\n\nconst buildLiveInvoiceItem=(product:any,settings:StoreSettings,catalog:any[],quantity=1)=>{\n  const {type,variant,actualUnit,referenceUnit,specialPerUnit}=livePriceSnapshot(product,settings);\n  const qty=Math.max(1,Number(quantity||1));\n  const components=type==='bundle' ? (product.bundle_components||[]).map((component:any)=>{\n    const child=catalog.find((row:any)=>row.id===component.product_id);\n    const childVariant=child && component.variant_id ? variantById(child,component.variant_id) : undefined;\n    return {\n      product_id:component.product_id,\n      variant_id:component.variant_id,\n      sku:childVariant?.sku || child?.sku || component.sku || '',\n      product_name:child?.name_en || component.product_name || 'Combo Item',\n      quantity_per_bundle:Math.max(1,Number(component.quantity||component.quantity_per_bundle||1)),\n    };\n  }) : undefined;\n  return {\n    product_id:product.id,\n    product_name:product.name_en,\n    sku:variant?.sku || product.sku,\n    main_sku:product.sku,\n    variant_id:variant?.id,\n    variant_name:variant ? variantOptionSummary(variant) : undefined,\n    product_type:type,\n    bundle_components:components,\n    buying_price:liveMoney(variant?.buying_price ?? product.buying_price),\n    unit_price:actualUnit,\n    regular_unit_price:referenceUnit,\n    supplier_offer_discount_per_unit:specialPerUnit,\n    quantity:qty,\n    subtotal:liveMoney(actualUnit*qty),\n    image:variant?.image || product.images?.[0],\n  } as any;\n};\n\nconst buildLiveCatalogTestOrder=(products:any[],settings:StoreSettings,tag:string,itemCount:number,preferBundle=false,startIndex=0):Order=>{\n  const live=liveCatalogRows(products,settings);\n  if(!live.length) return {...sampleOrder,id:\`preview-fallback-\${tag}\`,order_number:\`TEST-\${tag}\`,invoice_number:\`INV-TEST-\${tag}\`,created_at:new Date().toISOString()};\n  let pool=live;\n  if(preferBundle){\n    const bundles=live.filter((product:any)=>normalizedProductType(product)==='bundle');\n    if(!bundles.length) throw new Error('No live Combo Pack is available for the Combo invoice test.');\n    pool=bundles;\n  }\n  const count=Math.max(1,itemCount);\n  const items=Array.from({length:count},(_,index)=>{\n    const product=pool[(startIndex+index)%pool.length];\n    return buildLiveInvoiceItem(product,settings,products,1);\n  });\n  const subtotal=liveMoney(items.reduce((sum:number,item:any)=>sum+Number(item.subtotal||0),0));\n  const totalQty=items.reduce((sum:number,item:any)=>sum+Math.max(1,Number(item.quantity||1)),0);\n  const qtyRate=liveQtyOfferRate(settings,totalQty);\n  const qtyDiscount=liveMoney(subtotal*(qtyRate/100));\n  const delivery=settings.free_delivery_enabled?0:liveMoney(settings.delivery_fee);\n  const total=liveMoney(Math.max(0,subtotal-qtyDiscount+delivery));\n  return {\n    ...sampleOrder,\n    id:\`preview-live-\${tag}-\${startIndex}\`,\n    order_number:\`TEST-\${tag}\`,\n    invoice_number:\`INV-TEST-\${tag}\`,\n    customer_name:'Live Catalog Test Customer',\n    address:'Memory-only live catalog invoice test. Nothing is saved.',\n    items,\n    subtotal,\n    delivery_fee:delivery,\n    internal_delivery_fee:liveMoney(settings.delivery_fee),\n    delivery_included_in_item_price:Boolean(settings.free_delivery_enabled),\n    special_offer_discount:qtyDiscount,\n    total_amount:total,\n    is_advance_required:false,\n    advance_amount:0,\n    gift_wrap_selected:false,\n    gift_wrap_fee:0,\n    waybill_number:\`TESTLIVE\${String(startIndex+1).padStart(4,'0')}\`,\n    stock_status:'Allocated',\n    stock_allocated:true,\n    invoice_locked:true,\n    created_at:new Date().toISOString(),\n  } as Order;\n};\n\n${panelMarker}`;
    text = replaceRequired(text, panelMarker, helpers, 'live catalog helpers');

    text = replaceRequired(
      text,
      "export const InvoiceDesignPanel:React.FC<Props>=({settings,updateSettings})=>{\n  const [draft,setDraft]=useState<StoreSettings>({...settings});",
      "export const InvoiceDesignPanel:React.FC<Props>=({settings,updateSettings})=>{\n  const { products } = useStore();\n  const [draft,setDraft]=useState<StoreSettings>({...settings});",
      'live products hook',
    );

    text = replaceRequired(
      text,
      "  const set=(patch:Partial<StoreSettings>)=>setDraft(prev=>({...prev,...patch}));\n  const previewSvg=useMemo(()=>buildExactInvoiceSvg(sampleOrder,draft,true),[draft]);",
      "  const set=(patch:Partial<StoreSettings>)=>setDraft(prev=>({...prev,...patch}));\n  const previewOrder=useMemo(()=>buildLiveCatalogTestOrder(products,settings,'PREVIEW',Math.min(4,Math.max(1,products.length))),[products,settings]);\n  const previewSvg=useMemo(()=>buildExactInvoiceSvg(previewOrder,draft,true),[previewOrder,draft]);",
      'live preview order',
    );

    const oldDownload = `      const order=kind==='single'\n        ? buildSingleItemTestOrder(settings)\n        : kind==='combo'\n          ? buildComboItemTestOrder(settings)\n          : buildTenItemTestOrder(settings);\n      await generateOrderInvoicePDF(order,settings);`;
    const newDownload = `      const order=kind==='single'\n        ? buildLiveCatalogTestOrder(products,settings,'1ITEM',1)\n        : kind==='combo'\n          ? buildLiveCatalogTestOrder(products,settings,'COMBO',1,true)\n          : buildLiveCatalogTestOrder(products,settings,'10ITEM',10);\n      await generateOrderInvoicePDF(order,settings);`;
    text = replaceRequired(text, oldDownload, newDownload, 'single/combo/ten test PDFs');

    text = replaceRequired(
      text,
      "      await generatePackingTestA6AndMultiPagePDF(settings);",
      "      const rows=[buildLiveCatalogTestOrder(products,settings,'PACK-SINGLE',1, false, 0),buildLiveCatalogTestOrder(products,settings,'PACK-MULTI',10, false, 1)];\n      await generateBatchInvoicesPDF(rows,settings,'O-RA_TEST_PACKING_LIVE_A6_AND_MULTI_PAGE.pdf');",
      'packing live PDF',
    );

    text = replaceRequired(
      text,
      "      await generatePackingTestA4FourUpPDF(settings);",
      "      const rows=[0,1,2,3].map((index)=>buildLiveCatalogTestOrder(products,settings,\`A4-\${index+1}\`,1,false,index));\n      await generateA4FourUpInvoicesPDF(rows,settings,'O-RA_TEST_A4_4-UP_LIVE.pdf');",
      'A4 live PDF',
    );

    return { code: text, map: null };
  },
});
