import React, { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Send, Star, X, ZoomIn } from 'lucide-react';
import type { Product, CustomerReview } from '../types';
import { compressImageFile, uploadPublicImage } from '../lib/imageUpload';
import { supabase } from '../lib/supabase';

const Stars: React.FC<{ value: number; size?: string }> = ({ value, size = 'w-4 h-4' }) => (
  <div className="flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
    {[1,2,3,4,5].map((star) => (
      <Star key={star} className={`${size} ${star <= Math.round(value) ? 'fill-orange-400 text-orange-400' : 'text-gray-300'}`} />
    ))}
  </div>
);

export const ProductReviews: React.FC<{ product: Product }> = ({ product }) => {
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [form, setForm] = useState({ customer_name: '', rating: 5, review_text: '' });

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/reviews?productId=${encodeURIComponent(product.id)}`);
      const data = await response.json().catch(() => ({}));
      if (response.ok) setReviews(Array.isArray(data?.reviews) ? data.reviews : []);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [product.id]);

  const average = useMemo(() => reviews.length ? reviews.reduce((sum, row) => sum + Number(row.rating || 0), 0) / reviews.length : 0, [reviews]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (form.customer_name.trim().length < 2 || form.review_text.trim().length < 3) {
      setMessage('Please enter your name and review.');
      return;
    }
    setSubmitting(true);
    try {
      let image_url = '';
      if (imageFile) {
        // Review photos are intentionally kept compact: one optimized image only,
        // so customer photos stay clear without wasting Storage/egress.
        const compressed = await compressImageFile(imageFile, 960, 260_000);
        image_url = await uploadPublicImage(compressed, 'review');
      }
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          product_id: product.id,
          product_name: product.name_en,
          customer_name: form.customer_name.trim(),
          rating: form.rating,
          review_text: form.review_text.trim(),
          image_url: image_url || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not submit review.');
      setForm({ customer_name: '', rating: 5, review_text: '' });
      setImageFile(null);
      setMessage('Thank you! Your review is waiting for admin approval.');
    } catch (error: any) {
      setMessage(error?.message || 'Could not submit review.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="border-t border-gray-100 px-6 sm:px-8 py-6 bg-gray-50/70">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-black text-gray-900">Product Reviews</h3>
          <div className="mt-1 flex items-center gap-2">
            <Stars value={average} />
            <span className="text-xs font-bold text-gray-600">{reviews.length ? average.toFixed(1) : 'No rating yet'} {reviews.length ? `(${reviews.length})` : ''}</span>
          </div>
        </div>
      </div>

      {loading ? <p className="text-xs text-gray-400">Loading reviews…</p> : reviews.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 max-h-72 overflow-y-auto">
          {reviews.map((review) => (
            <article key={review.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black text-gray-900 truncate">{review.customer_name}</p>
                <Stars value={review.rating} size="w-3.5 h-3.5" />
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-600 whitespace-pre-wrap">{review.review_text}</p>
              {review.image_url && (
                <button
                  type="button"
                  onClick={() => setPreviewImage(review.image_url || null)}
                  className="group relative mt-3 block w-24 h-24 sm:w-28 sm:h-28 overflow-hidden rounded-xl border border-gray-100 bg-gray-50 text-left"
                  aria-label="Open customer review photo"
                  title="Click to view larger"
                >
                  <img
                    src={review.image_url}
                    alt="Customer review"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                  <span className="absolute bottom-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </span>
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Customer review photo preview"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-4 top-4 sm:right-6 sm:top-6 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-900 shadow-lg"
            aria-label="Close image preview"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={previewImage}
            alt="Customer review enlarged"
            className="max-h-[88vh] max-w-[94vw] rounded-2xl object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <p className="text-xs font-black text-gray-900">Write a review for {product.name_en}</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
          <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="Your real name" className="rounded-xl border border-gray-200 px-3 py-2 text-xs" />
          <select value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold">
            {[5,4,3,2,1].map((n) => <option key={n} value={n}>{n} Star{n > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <textarea value={form.review_text} onChange={(e) => setForm({ ...form, review_text: e.target.value })} rows={3} placeholder="How was this product?" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs resize-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-600">
            <ImagePlus className="w-4 h-4" />
            <span>{imageFile ? imageFile.name : 'Add product photo (optional)'}</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
          </label>
          <button disabled={submitting} className="rounded-xl bg-black text-white px-4 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
            <Send className="w-4 h-4" />{submitting ? 'Submitting…' : 'Submit Review'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400">Reviews appear on this product only after admin approval. Images are compressed before upload to save storage.</p>
        {message && <p className="text-xs font-semibold text-orange-600">{message}</p>}
      </form>
    </div>
  );
};
