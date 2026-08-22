export const leadItemCodeBlankDefaultPatch = () => ({
  name: 'ora-lead-item-code-blank-default-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    // Never preselect the first product. A lead CSV must only be tied to a
    // product after the staff member explicitly types a valid Item Code.
    const oldState = "  const [selectedLeadItemCode, setSelectedLeadItemCode] = useState(products[0]?.sku || '');";
    const blankState = "  const [selectedLeadItemCode, setSelectedLeadItemCode] = useState('');";
    if (text.includes(oldState)) text = text.replace(oldState, blankState);
    else if (!text.includes(blankState)) throw new Error('[O-RA lead item code] item-code state marker not found');

    // Products can grow into the thousands, so do not render a giant datalist.
    // Staff types the exact code in one box; the matching product name appears
    // read-only in the box beside it. The existing upload handler still blocks
    // blank and invalid codes before a CSV can be parsed/sent.
    const oldPicker = /                <input\s+[\s\S]*?list="ora-lead-item-codes"[\s\S]*?                <\/p>/;
    if (!oldPicker.test(text)) throw new Error('[O-RA lead item code] legacy lead item picker marker not found');

    const newPicker = `                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-amber-800">Item Code</label>
                    <input
                      value={selectedLeadItemCode}
                      onChange={e=>setSelectedLeadItemCode(e.target.value.toUpperCase())}
                      placeholder="Type Item Code"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm font-black uppercase outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-amber-800">Item Name</label>
                    <input
                      value={products.find(p=>String(p.sku||'').trim().toUpperCase()===String(selectedLeadItemCode||'').trim().toUpperCase())?.name_en || ''}
                      readOnly
                      placeholder={String(selectedLeadItemCode||'').trim() ? 'No matching product' : 'Type Item Code first'}
                      className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-bold text-neutral-800 outline-none"
                    />
                  </div>
                </div>
                <p className="mt-1 text-[11px] font-bold text-amber-800">
                  {String(selectedLeadItemCode||'').trim() && !products.find(p=>String(p.sku||'').trim().toUpperCase()===String(selectedLeadItemCode||'').trim().toUpperCase())
                    ? 'Invalid Item Code — CSV upload is blocked until a valid code is entered.'
                    : 'No default product is selected. Type the Item Code manually; the matching Item Name appears automatically.'}
                </p>`;

    text = text.replace(oldPicker, newPicker);
    return text === code ? null : { code: text, map: null };
  },
});
