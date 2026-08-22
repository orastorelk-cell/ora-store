export const customerCartWordingPatch = () => ({
  name: 'ora-customer-cart-wording-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.includes('/src/') || (!id.endsWith('.tsx') && !id.endsWith('.ts'))) return null;

    let text = code;

    // Customer-facing terminology only. Do not rename cart variables/functions,
    // routes, state, or business logic.
    text = text.replace(/My Basket/g, 'My Cart');
    text = text.replace(/Your Basket/g, 'Your Cart');
    text = text.replace(/your Basket/g, 'your Cart');

    // The shared translation is used by CartDrawer and other customer UI.
    if (id.endsWith('/src/lib/i18n.ts')) {
      text = text.replace("cart: 'Cart',", "cart: 'My Cart',");
    }

    return text === code ? null : { code: text, map: null };
  },
});
