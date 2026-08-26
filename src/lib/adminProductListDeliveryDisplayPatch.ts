const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA admin product list delivery display] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Admin Product List display-only fix.
 *
 * The list must follow the current Free Delivery setting instead of forcing delivery
 * into the displayed customer price. Stored product prices, storefront pricing,
 * orders, invoices, Google Sheets and stock are untouched.
 */
export const adminProductListDeliveryDisplayPatch = () => ({
  name: 'ora-admin-product-list-delivery-display-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    text = replaceRequired(
      text,
      "  const range = productPriceRange(product, { ...settings, free_delivery_enabled:true });",
      "  const range = productPriceRange(product, settings);",
      'customer price helper',
    );

    text = replaceRequired(
      text,
      '<th className="p-3 whitespace-nowrap"><span className="block">Customer Price</span><span className="text-[8px] normal-case text-emerald-400">With Delivery</span></th>',
      '<th className="p-3 whitespace-nowrap"><span className="block">Customer Price</span><span className="text-[8px] normal-case text-emerald-400">{settings.free_delivery_enabled ? \'With Delivery\' : \'Delivery Separate\'}</span></th>',
      'customer price heading',
    );

    text = replaceRequired(
      text,
      '<p className="mt-0.5 text-[9px] text-neutral-500">Includes Rs. {Math.max(0, Number(settings.delivery_fee || 0)).toLocaleString()} delivery</p>',
      '<p className="mt-0.5 text-[9px] text-neutral-500">{settings.free_delivery_enabled ? <>Includes Rs. {Math.max(0, Number(settings.delivery_fee || 0)).toLocaleString()} delivery</> : <>Delivery Rs. {Math.max(0, Number(settings.delivery_fee || 0)).toLocaleString()} added separately</>}</p>',
      'delivery note',
    );

    return { code: text, map: null };
  },
});
