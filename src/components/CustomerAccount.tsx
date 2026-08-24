import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogIn, LogOut, UserCircle2, ArrowLeft, Package, Award, Save } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { CustomerProfile, Order } from '../types';
import { formatLkr } from '../lib/currency';

const authHeaders = (session: Session | null) => ({
  'Content-Type': 'application/json',
  ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
});

export const CustomerAccountButton: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [membership, setMembership] = useState<{ successful_orders: number; level: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ real_name: '', phone: '', whatsapp: '', address: '', city: '' });

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open || !session) return;
    void loadAccount(session);
  }, [open, session?.access_token]);

  const loadAccount = async (current: Session) => {
    setLoading(true);
    setMessage('');
    try {
      const [profileResponse, ordersResponse] = await Promise.all([
        fetch('/api/customer/profile', { headers: authHeaders(current) }),
        fetch('/api/customer/orders', { headers: authHeaders(current) }),
      ]);
      const profileData = await profileResponse.json().catch(() => ({}));
      const ordersData = await ordersResponse.json().catch(() => ({}));
      if (!profileResponse.ok) throw new Error(profileData?.error || 'Could not load profile.');
      if (!ordersResponse.ok) throw new Error(ordersData?.error || 'Could not load orders.');
      const nextProfile = (profileData?.profile || null) as CustomerProfile | null;
      setProfile(nextProfile);
      setForm({
        real_name: nextProfile?.real_name || '',
        phone: nextProfile?.phone || '',
        whatsapp: nextProfile?.whatsapp || '',
        address: nextProfile?.address || '',
        city: nextProfile?.city || '',
      });
      setOrders(Array.isArray(ordersData?.orders) ? ordersData.orders : []);
      setMembership(ordersData?.membership || null);
    } catch (error: any) {
      setMessage(error?.message || 'Could not load customer account.');
    } finally {
      setLoading(false);
    }
  };

  const signIn = async () => {
    if (!supabase) {
      setOpen(true);
      return;
    }
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setOrders([]);
    setMembership(null);
    setOpen(false);
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) return;
    if (form.real_name.trim().length < 3) {
      setMessage('Please type your real name. Gmail display name is not used automatically.');
      return;
    }
    const phone = form.phone.replace(/\D/g, '').replace(/^94(?=7\d{8}$)/, '0');
    if (!/^07\d{8}$/.test(phone)) {
      setMessage('Please enter a valid Sri Lankan phone number, e.g. 0771234567.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/customer/profile', {
        method: 'PUT',
        headers: authHeaders(session),
        body: JSON.stringify({ ...form, real_name: form.real_name.trim(), phone }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not save profile.');
      setProfile(data.profile || null);
      setMessage('Profile saved.');
      await loadAccount(session);
    } catch (error: any) {
      setMessage(error?.message || 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  const email = session?.user?.email || '';
  const badge = membership?.level || 'NEW CUSTOMER';
  const profileComplete = Boolean(profile?.real_name && profile?.phone);
  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [orders],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => (session ? setOpen(true) : signIn())}
        className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-xs font-bold text-gray-700 hover:bg-gray-200 transition-colors"
        title={session ? 'My Profile' : 'Continue with Google'}
      >
        {session ? <UserCircle2 className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
        <span>{session ? 'My Profile' : 'Google Sign In'}</span>
      </button>

      <button
        type="button"
        onClick={() => (session ? setOpen(true) : signIn())}
        className="sm:hidden p-1.5 rounded-full bg-gray-100 text-gray-700"
        aria-label={session ? 'My Profile' : 'Google Sign In'}
      >
        {session ? <UserCircle2 className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
      </button>

      {open && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[9999] bg-gray-50 overflow-y-auto text-gray-900">
          <div className="min-h-screen w-full bg-gray-50">
            <div className="sticky top-0 z-20 flex items-center justify-between gap-4 px-4 sm:px-8 py-4 border-b border-gray-200 bg-white/95 backdrop-blur-md">
              <div>
                <h2 className="font-black text-lg text-gray-900">My O-RA Profile</h2>
                <p className="text-xs text-gray-500">Google verifies your account. You type your real customer name yourself.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="shrink-0 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 hover:bg-gray-100 transition-colors"><ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Back to Store</span></button>
            </div>

            {!isSupabaseConfigured ? (
              <div className="mx-auto max-w-3xl p-7 text-sm text-gray-600">
                Google customer login will become available after Supabase Auth is configured for the live website.
              </div>
            ) : !session ? (
              <div className="mx-auto max-w-3xl p-7 text-center space-y-4">
                <p className="text-sm text-gray-600">Sign in with Google to create your O-RA customer profile.</p>
                <button onClick={signIn} className="px-5 py-3 rounded-2xl bg-black text-white font-bold text-sm">Continue with Google</button>
              </div>
            ) : loading ? (
              <div className="p-10 text-center text-sm text-gray-500">Loading your account…</div>
            ) : (
              <div className="mx-auto grid w-full max-w-6xl grid-cols-1 lg:grid-cols-2 bg-white sm:my-6 sm:rounded-3xl sm:border sm:border-gray-100 sm:shadow-sm overflow-hidden">
                <form onSubmit={saveProfile} className="p-5 sm:p-7 space-y-4 border-b lg:border-b-0 lg:border-r border-gray-100">
                  <div className="rounded-2xl bg-orange-50 border border-orange-100 p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">Membership</p>
                      <p className="font-black text-gray-900">{badge}</p>
                      <p className="text-xs text-gray-500">{membership?.successful_orders || 0} successful purchase(s)</p>
                    </div>
                    <Award className="w-8 h-8 text-orange-500" />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-700">Google Email</label>
                    <input value={email} readOnly className="mt-1 w-full rounded-xl bg-gray-100 border border-gray-200 px-3 py-2 text-sm text-gray-500" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-700">Real Name *</label>
                    <input value={form.real_name} onChange={(e) => setForm({ ...form, real_name: e.target.value })} placeholder="Type your actual name" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" required />
                    <p className="mt-1 text-[11px] text-gray-400">Your Gmail profile name is not copied automatically.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-gray-700">Phone *</label>
                      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0771234567" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" required />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-700">WhatsApp</label>
                      <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-700">Address</label>
                    <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-700">City</label>
                    <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  {message && <p className="text-xs rounded-xl bg-gray-50 border border-gray-100 p-3 text-gray-600">{message}</p>}
                  <div className="flex gap-2">
                    <button disabled={saving} className="flex-1 rounded-xl bg-orange-600 text-white px-4 py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save Profile'}</button>
                    <button type="button" onClick={signOut} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600"><LogOut className="w-4 h-4" /></button>
                  </div>
                  {!profileComplete && <p className="text-[11px] text-orange-600 font-semibold">Complete your profile to keep your customer details ready for future orders.</p>}
                </form>

                <div className="p-5 sm:p-7">
                  <div className="flex items-center gap-2 mb-4"><Package className="w-4 h-4 text-orange-600" /><h3 className="font-black text-sm">My Orders</h3></div>
                  {sortedOrders.length === 0 ? (
                    <div className="rounded-2xl bg-gray-50 border border-gray-100 p-6 text-center text-xs text-gray-500">Future orders placed while signed in will appear here.</div>
                  ) : (
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                      {sortedOrders.map((order) => (
                        <div key={order.id} className="rounded-2xl border border-gray-100 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-black text-xs text-gray-900">{order.order_number}</p>
                            <span className="text-[10px] rounded-full bg-gray-100 px-2 py-1 font-bold text-gray-600">{order.order_status}</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString()} • Rs. {formatLkr(order.total_amount)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ), document.body)}
    </>
  );
};
