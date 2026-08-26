const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (!text.includes(from)) throw new Error(`[O-RA product share] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Adds a customer-facing Share button to the existing Product Detail view.
 * The existing App deep-link handler already opens /?product=<id> directly in
 * the matching product modal, so this patch does not touch routing, cart,
 * checkout, orders, stock, pricing or invoice logic.
 */
export const productSharePatch = () => ({
  name: 'ora-product-share-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/ProductDetailModal.tsx')) return null;

    let text = code;

    text = replaceRequired(
      text,
      "import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Image as ImageIcon, MessageSquare, ShoppingBag, X, Zap } from 'lucide-react';",
      "import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Image as ImageIcon, MessageSquare, Share2, ShoppingBag, X, Zap } from 'lucide-react';",
      'Share2 import',
    );

    text = replaceRequired(
      text,
      "  const openAssistantInquiry = () => {\n    setSelectedProduct(null);\n    if (window.history.state?.oraProductModal) window.history.back();\n    window.dispatchEvent(new CustomEvent('ora:assistant-open', { detail: { product: selectedProduct.name_en, sku: exactSku, variant: variantOptionSummary(selectedVariant) } }));\n  };",
      "  const openAssistantInquiry = () => {\n    setSelectedProduct(null);\n    if (window.history.state?.oraProductModal) window.history.back();\n    window.dispatchEvent(new CustomEvent('ora:assistant-open', { detail: { product: selectedProduct.name_en, sku: exactSku, variant: variantOptionSummary(selectedVariant) } }));\n  };\n\n  const handleShareProduct = async () => {\n    const shareUrl = new URL('/', window.location.origin);\n    shareUrl.searchParams.set('product', selectedProduct.id);\n    const url = shareUrl.toString();\n    const shareData = {\n      title: selectedProduct.name_en,\n      text: `Check this product at O-RA Store: ${selectedProduct.name_en}`,\n      url,\n    };\n    try {\n      if (typeof navigator.share === 'function') {\n        await navigator.share(shareData);\n        return;\n      }\n      if (navigator.clipboard?.writeText) {\n        await navigator.clipboard.writeText(url);\n        alert('Product link copied.');\n        return;\n      }\n      const input = document.createElement('textarea');\n      input.value = url;\n      input.setAttribute('readonly', '');\n      input.style.position = 'fixed';\n      input.style.opacity = '0';\n      document.body.appendChild(input);\n      input.select();\n      const copied = document.execCommand('copy');\n      document.body.removeChild(input);\n      if (!copied) throw new Error('Copy failed');\n      alert('Product link copied.');\n    } catch (error: any) {\n      if (error?.name !== 'AbortError') alert('Could not share the product link. Please try again.');\n    }\n  };",
      'share handler',
    );

    text = replaceRequired(
      text,
      "          <button onClick={close} className=\"rounded-full bg-gray-100 p-2 text-gray-500 hover:text-black\"><X className=\"h-5 w-5\" /></button>",
      "          <div className=\"flex shrink-0 items-center gap-2\">\n            <button type=\"button\" onClick={() => void handleShareProduct()} aria-label=\"Share product\" title=\"Share product\" className=\"rounded-full border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700\">\n              <Share2 className=\"h-5 w-5\" />\n            </button>\n            <button onClick={close} aria-label=\"Close product\" className=\"rounded-full bg-gray-100 p-2 text-gray-500 hover:text-black\"><X className=\"h-5 w-5\" /></button>\n          </div>",
      'top-bar share button',
    );

    return { code: text, map: null };
  },
});
