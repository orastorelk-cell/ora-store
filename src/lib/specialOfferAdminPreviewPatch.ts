const replaceRequired = (text: string, from: string, to: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error('[O-RA special offer admin preview] preview marker not found');
  return text.replace(from, to);
};

/**
 * UI-only Admin follow-up. Keeps all Special Offer pricing/order logic unchanged.
 * Makes the Product Add/Edit preview easier to read and clearly shows ON/OFF state.
 */
export const specialOfferAdminPreviewPatch = () => ({
  name: 'ora-special-offer-admin-preview-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    const oldPreview = `                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px]">\n                        <span className="text-neutral-500">Actual: <b className="text-emerald-300">Rs. {customerPrice.toLocaleString()}</b></span>\n                        <span className="text-neutral-500">Crossed: <b className="text-orange-300">{preview.active ? \`Rs. \${preview.regularPrice.toLocaleString()}\` : '—'}</b></span>\n                        <span className="text-neutral-500">Badge: <b className="text-orange-300">{enabled ? \`\${offerPercent}% OFF\` : 'OFF'}</b></span>\n                      </div>`;

    const newPreview = `                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">\n                        <div className="rounded-xl border border-emerald-500/20 bg-neutral-950 px-3 py-2.5">\n                          <p className="text-[9px] font-black uppercase tracking-wide text-neutral-500">Actual Price</p>\n                          <p className="mt-0.5 text-base font-black text-emerald-300">Rs. {customerPrice.toLocaleString()}</p>\n                        </div>\n                        <div className="rounded-xl border border-orange-500/20 bg-neutral-950 px-3 py-2.5">\n                          <p className="text-[9px] font-black uppercase tracking-wide text-neutral-500">Crossed Price</p>\n                          <p className="mt-0.5 text-base font-black text-orange-300">{preview.active ? \`Rs. \${preview.regularPrice.toLocaleString()}\` : '—'}</p>\n                        </div>\n                        <div className={\`rounded-xl border px-3 py-2.5 \${enabled ? 'border-orange-500/30 bg-orange-500/10' : 'border-neutral-800 bg-neutral-950'}\`}>\n                          <p className="text-[9px] font-black uppercase tracking-wide text-neutral-500">Offer Preview</p>\n                          <div className="mt-0.5 flex flex-wrap items-center gap-2">\n                            <span className={\`text-sm font-black \${enabled ? 'text-orange-300' : 'text-neutral-600'}\`}>{enabled ? \`\${offerPercent}% OFF\` : 'OFF'}</span>\n                            <span className={\`rounded-full px-2 py-1 text-[8px] font-black \${enabled ? 'bg-orange-500 text-black' : 'bg-neutral-800 text-neutral-500'}\`}>SPECIAL OFFER {enabled ? 'ON' : 'OFF'}</span>\n                          </div>\n                        </div>\n                      </div>`;

    const text = replaceRequired(code, oldPreview, newPreview);
    return { code: text, map: null };
  },
});
