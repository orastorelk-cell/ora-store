/** Exact SKU first, then an unambiguous exact option label. Never guess a color. */
type Candidate={id:string;sku?:string;option_value?:string;options?:Array<{value:string}>};
type ProductLike={id:string;sku?:string;variants?:Candidate[];product_type?:string};
const key=(value:unknown)=>String(value||'').trim().toUpperCase();
export const safeVariantForStock=(product:ProductLike|undefined,variantId:unknown,sku:unknown,variantName:unknown):Candidate|undefined=>{
  if(!product||!Array.isArray(product.variants)||!product.variants.length)return undefined;
  const existing=product.variants.find(v=>String(v.id)===String(variantId||'')) ;
  // A saved exact variant ID is authoritative unless the exact SKU clearly
  // contradicts it. Never automatically reassign a conflicting colour.
  if(existing){
    // Refuse an order that explicitly names another colour's SKU. A stale
    // variant ID must not silently debit BLACK to print a GREY parcel.
    const explicit=key(sku);
    const other=product.variants.filter(v=>key(v.sku)===explicit && v.id!==existing.id);
    return other.length ? undefined : existing;
  }
  if(variantId)return undefined;
  const code=key(sku);
  const foundBySku=product.variants.filter(v=>key(v.sku)===code&&code!==key(product.sku));
  if(foundBySku.length===1)return foundBySku[0];
  if(foundBySku.length>1)return undefined;
  const name=key(variantName);
  if(!name)return undefined;
  const foundByName=product.variants.filter(v=>key(v.option_value)===name||
    (v.options||[]).some(option=>key(option.value)===name));
  return foundByName.length===1?foundByName[0]:undefined;
};

export const normalizeOrderMissingStockVariants=<T extends {items?:any[]}>(order:T,products:ProductLike[]):T=>{
  if(!Array.isArray(order.items))return order;
  const byId=new Map(products.map(p=>[String(p.id),p] as const));
  let changed=false;
  const normalize=(item:any,sku:string,variantName:string)=>{
    const product=byId.get(String(item.product_id||''));
    if(!product?.variants?.length||item.variant_id)return item;
    const variant=safeVariantForStock(product,item.variant_id,sku,variantName);
    if(!variant)return item;
    changed=true;
    return {...item,variant_id:variant.id,variant_name:item.variant_name||variant.option_value,
      sku:key(sku)===key(product.sku)?variant.sku||item.sku:item.sku};
  };
  const items=order.items.map(item=>{
    const original=normalize(item,item.sku||item.main_sku,item.variant_name);
    if(!Array.isArray(item.bundle_components)||!item.bundle_components.length)return original;
    const components=item.bundle_components.map((component:any)=>normalize(component,component.sku,component.variant_name));
    if(components.every((component:any,i:number)=>component===item.bundle_components[i]))return original;
    changed=true;
    return {...original,bundle_components:components};
  });
  return changed?{...order,items} as T:order;
};

/** Protect existing explicit variant IDs from a conflicting saved colour SKU. */
export const hasConflictingVariantOrderItems=(order:{items?:any[]},products:ProductLike[])=>{
  const byId=new Map(products.map(p=>[String(p.id),p] as const));
  const contradicts=(item:any)=>{
    if(!item?.variant_id||!item?.sku)return false;
    const product=byId.get(String(item.product_id||''));
    if(!product?.variants?.length)return false;
    const matchingSku=product.variants.filter(v=>key(v.sku)===key(item.sku));
    return matchingSku.length===1&&String(matchingSku[0].id)!==String(item.variant_id);
  };
  return (order.items||[]).some(item=>contradicts(item)||
    (item.bundle_components||[]).some(contradicts));
};
