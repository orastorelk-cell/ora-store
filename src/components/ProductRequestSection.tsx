import React, { useState } from 'react';
import { ImagePlus, Lightbulb, Send } from 'lucide-react';
import { compressImageFile, uploadPublicImage } from '../lib/imageUpload';
import { supabase } from '../lib/supabase';

export const ProductRequestSection: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [form, setForm] = useState({ product_name: '', description: '', reference_link: '', expected_price: '', customer_name: '', contact: '' });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (form.product_name.trim().length < 2) { setMessage('Please enter the product name or idea.'); return; }
    setSubmitting(true);
    try {
      let image_url = '';
      if (imageFile) image_url = await uploadPublicImage(await compressImageFile(imageFile), 'product-request');
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      const response = await fetch('/api/product-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          product_name: form.product_name.trim(),
          description: form.description.trim(),
          product_link: form.reference_link.trim() || undefined,
          expected_price: form.expected_price ? Number(form.expected_price) : undefined,
          reference_image_url: image_url || undefined,
          customer_name: form.customer_name.trim() || undefined,
          contact: form.contact.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not send product suggestion.');
      setForm({ product_name: '', description: '', reference_link: '', expected_price: '', customer_name: '', contact: '' });
      setImageFile(null);
      setMessage('Thanks! Your product idea was sent to O-RA. This is a suggestion, not an order.');
    } catch (error: any) { setMessage(error?.message || 'Could not send product suggestion.'); }
    finally { setSubmitting(false); }
  };

  return (
    <section className="rounded-3xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full p-5 sm:p-6 flex items-center justify-between gap-4 text-left hover:bg-orange-50/30">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-orange-50 flex items-center justify-center"><Lightbulb className="w-5 h-5 text-orange-600" /></div>
          <div>
            <h2 className="font-black text-gray-900">Want a product we don’t sell yet?</h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">Suggest a new item. If many customers want it, O-RA can consider adding it to the store.</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-black text-white px-4 py-2 text-xs font-bold">{open ? 'Close' : 'Request New Product'}</span>
      </button>

      {open && (
        <form onSubmit={submit} className="border-t border-gray-100 p-5 sm:p-6 space-y-3 bg-gray-50/60">
          <div className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-xs text-orange-800 font-semibold">
            This is for new product ideas/demand only. It does not create an order or reserve an item.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder="Product name / item idea *" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" required />
            <input value={form.expected_price} onChange={(e) => setForm({ ...form, expected_price: e.target.value })} type="number" min="0" placeholder="Expected price (optional)" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          </div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Describe the item, size, model, features, etc." className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm resize-none" />
          <input value={form.reference_link} onChange={(e) => setForm({ ...form, reference_link: e.target.value })} placeholder="Reference product link (optional)" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="Your name (optional)" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Phone / WhatsApp (optional)" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer"><ImagePlus className="w-4 h-4" />{imageFile ? imageFile.name : 'Reference image (optional)'}<input type="file" accept="image/*" className="hidden" onChange={(e) => setImageFile(e.target.files?.[0] || null)} /></label>
            <button disabled={submitting} className="rounded-xl bg-orange-600 text-white px-5 py-2.5 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"><Send className="w-4 h-4" />{submitting ? 'Sending…' : 'Send Product Idea'}</button>
          </div>
          {message && <p className="text-xs font-semibold text-gray-600">{message}</p>}
        </form>
      )}
    </section>
  );
};
