import React, { useEffect, useState } from 'react';
import {
  X,
  CheckCircle2,
  Truck,
  ShieldCheck,
  Download,
  MessageSquare,
  Sparkles,
  AlertCircle,
  Copy,
  Check,
  Upload,
  Image as ImageIcon,
  Loader2,
  FileCheck,
  Eye,
  Minus,
  Plus,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useStore } from '../context/StoreContext';
import { PaymentMethod, Order } from '../types';
import { getTranslation } from '../lib/i18n';
import { displayUnitPrice } from '../lib/productVariants';
import { generateOrderInvoicePDF } from '../lib/pdfGenerator';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { analyzeReceiptLocally } from '../lib/receiptOcr';
import { compressImageFile, uploadPublicImage } from '../lib/imageUpload';

export const CheckoutModal: React.FC = () => {
  const {
    language,
    cart,
    isCheckoutOpen,
    setIsCheckoutOpen,
    closeCheckoutAndRestoreCart,
    cartSubtotal,
    cartItemCount,
    cartSpecialOfferDiscount,
    cartMultiBuyDiscountRate,
    cartFinalProductsTotal,
    settings,
    placeOrder,
    lastPlacedOrder,
    orders,
    updateCartQuantity,
  } = useStore();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('COD');
  const [formData, setFormData] = useState({
    customer_name: '',
    phone: '',
    whatsapp: '',
    address: '',
    city: '',
    notes: '',
    bank_receipt_url: '',
  });

  const [bankReceiptImage, setBankReceiptImage] = useState<string | null>(null);
  const [isAnalyzingSlip, setIsAnalyzingSlip] = useState(false);
  const [isSlipVerified, setIsSlipVerified] = useState(false);
  const [autoCheckPassed, setAutoCheckPassed] = useState(false);
  const [paymentCheckNotes, setPaymentCheckNotes] = useState('');
  const [slipError, setSlipError] = useState<string | null>(null);
  const [detectedSlipInfo, setDetectedSlipInfo] = useState<{ bank?: string; amount?: number; ref?: string; accountMatch?: boolean; amountMatch?: boolean; receiptLike?: boolean; confidence?: number } | null>(null);
  const [showEnlargedReceipt, setShowEnlargedReceipt] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [copiedPaymentField, setCopiedPaymentField] = useState<'bank' | 'branch' | 'holder' | 'account' | 'amount' | 'all' | null>(null);
  const [giftWrapSelected, setGiftWrapSelected] = useState(false);
  const [customerSession, setCustomerSession] = useState<any>(null);
  const [customerProfileLoaded, setCustomerProfileLoaded] = useState(false);
  const [customerAuthBusy, setCustomerAuthBusy] = useState(false);
  const [showAllCheckoutItems, setShowAllCheckoutItems] = useState(false);

  useEffect(() => {
    if (isCheckoutOpen) setShowAllCheckoutItems(false);
  }, [isCheckoutOpen]);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setCustomerSession(data.session);
      if (data.session && localStorage.getItem('ora_resume_checkout') === '1') {
        localStorage.removeItem('ora_resume_checkout');
        setIsCheckoutOpen(true);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return;
      setCustomerSession(nextSession);
      if (nextSession && localStorage.getItem('ora_resume_checkout') === '1') {
        localStorage.removeItem('ora_resume_checkout');
        setIsCheckoutOpen(true);
      }
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [setIsCheckoutOpen]);

  useEffect(() => {
    if (!isCheckoutOpen || !customerSession?.access_token || customerProfileLoaded) return;
    let cancelled = false;
    setCustomerAuthBusy(true);
    fetch('/api/customer/profile', { headers: { Authorization: `Bearer ${customerSession.access_token}` } })
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (cancelled || !ok || !data?.profile) return;
        const profile = data.profile;
        setFormData((prev) => ({
          ...prev,
          customer_name: prev.customer_name || String(profile.real_name || ''),
          phone: prev.phone || String(profile.phone || ''),
          whatsapp: prev.whatsapp || String(profile.whatsapp || ''),
          address: prev.address || String(profile.address || ''),
          city: prev.city || String(profile.city || ''),
        }));
        setCustomerProfileLoaded(true);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setCustomerAuthBusy(false); });
    return () => { cancelled = true; };
  }, [isCheckoutOpen, customerSession?.access_token, customerProfileLoaded]);

  const continueCheckoutWithGoogle = async () => {
    if (!supabase || !isSupabaseConfigured) return;
    setCustomerAuthBusy(true);
    localStorage.setItem('ora_resume_checkout', '1');
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
    } finally {
      setCustomerAuthBusy(false);
    }
  };

  if (!isCheckoutOpen) return null;

  const deliveryFee = settings.free_delivery_enabled ? 0 : Math.max(0, Number(settings.delivery_fee || 0));
  const giftWrapFee = settings.gift_wrap_enabled && giftWrapSelected ? Math.max(0, Number(settings.gift_wrap_fee || 0)) : 0;
  const finalTotal = cartFinalProductsTotal + deliveryFee + giftWrapFee;

  // Configurable advance rule controlled by Main Admin
  const advanceQtyThreshold = Math.max(0, Number(settings.advance_qty_threshold ?? 4));
  const advancePercentage = Math.min(100, Math.max(1, Number(settings.advance_percentage ?? 50)));
  const isAdvanceRequired = cartItemCount > advanceQtyThreshold;
  const advanceAmount = isAdvanceRequired ? Math.round(finalTotal * (advancePercentage / 100)) : 0;
  const bankTransferAmount = isAdvanceRequired ? advanceAmount : finalTotal;
  const hasSavedBankDetails = Boolean(
    settings.bank_details_saved &&
    settings.bank_name?.trim() &&
    settings.bank_account_holder?.trim() &&
    settings.bank_account_number?.trim() &&
    settings.bank_branch?.trim()
  );

  const copyPaymentText = async (value: string, field: 'bank' | 'branch' | 'holder' | 'account' | 'amount' | 'all') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedPaymentField(field);
      window.setTimeout(() => setCopiedPaymentField(null), 1800);
    } catch {
      alert('Copy failed. Please select and copy the details manually.');
    }
  };

  const handleCopyBankDetails = (amount = bankTransferAmount) => {
    const info = `Bank: ${settings.bank_name}
Branch: ${settings.bank_branch}
Account Holder: ${settings.bank_account_holder}
Account Number: ${settings.bank_account_number}
Amount to Pay: Rs. ${Number(amount || 0).toLocaleString()}`;
    void copyPaymentText(info, 'all');
  };

  const handleReceiptFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !completedOrder) return;

    if (completedOrder.payment_method !== 'Bank Payment') {
      setSlipError('This is a Cash on Delivery order. A bank-transfer receipt is not required.');
      return;
    }
    if (completedOrder.payment_verification_status === 'Approved') {
      setSlipError('This payment has already been approved.');
      return;
    }
    if (completedOrder.bank_receipt_url && completedOrder.payment_verification_status !== 'Rejected') {
      setSlipError('A payment receipt is already waiting for bank confirmation.');
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      setSlipError('Please upload a valid image file (PNG, JPG, WEBP).');
      return;
    }

    setSlipError(null);
    setIsAnalyzingSlip(true);
    setIsSlipVerified(false);
    setAutoCheckPassed(false);
    setPaymentCheckNotes('');
    setDetectedSlipInfo(null);

    try {
      const expectedAmount = completedOrder.is_advance_required && !completedOrder.advance_confirmed
        ? Math.max(0, Number(completedOrder.advance_amount || 0))
        : Math.max(0, Number(completedOrder.total_amount || 0));
      let analysis: Awaited<ReturnType<typeof analyzeReceiptLocally>> | null = null;
      let compressed = '';
      try {
        analysis = await analyzeReceiptLocally(file, settings.bank_account_number, expectedAmount);
        compressed = analysis.compressedDataUrl;
      } catch {
        compressed = await compressImageFile(file, 1400, 320_000);
      }

      const receiptUrl = await uploadPublicImage(compressed, 'payment-receipt');
      const phoneLast4 = String(completedOrder.phone || '').replace(/\D/g, '').slice(-4);
      const response = await fetch('/api/assistant/payment-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: completedOrder.order_number,
          phoneLast4,
          receiptUrl,
          analysis: analysis ? {
            receiptLike: analysis.receiptLike,
            accountMatch: analysis.accountMatch,
            amountMatch: analysis.amountMatch,
            detectedAmount: analysis.detectedAmount,
            detectedReference: analysis.detectedReference,
            detectedBank: analysis.detectedBank,
            confidence: analysis.confidence,
            notes: analysis.notes,
          } : null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Payment receipt could not be submitted.');

      const passed = Boolean(analysis?.receiptLike && analysis?.accountMatch && analysis?.amountMatch);
      setBankReceiptImage(receiptUrl);
      setIsSlipVerified(true);
      setAutoCheckPassed(passed);
      setDetectedSlipInfo(analysis ? {
        bank: analysis.detectedBank || 'Bank Transfer',
        amount: analysis.detectedAmount,
        ref: analysis.detectedReference,
        accountMatch: analysis.accountMatch,
        amountMatch: analysis.amountMatch,
        receiptLike: analysis.receiptLike,
        confidence: analysis.confidence,
      } : null);
      setPaymentCheckNotes(analysis?.notes || 'Receipt received. Final approval requires an admin to confirm the bank credit.');
      setCompletedOrder((prev) => prev ? {
        ...prev,
        bank_receipt_url: receiptUrl,
        payment_verification_status: data?.status || (passed ? 'Auto Check Passed' : 'Needs Review'),
        payment_detected_bank: analysis?.detectedBank || undefined,
        payment_detected_amount: analysis?.detectedAmount,
        payment_reference: analysis?.detectedReference,
        payment_account_match: analysis?.accountMatch,
        payment_amount_match: analysis?.amountMatch,
        payment_receipt_like: analysis?.receiptLike,
        payment_ocr_confidence: analysis?.confidence,
        payment_check_notes: `${analysis?.notes || 'Receipt received.'} Final approval requires an admin to confirm the bank credit.`,
      } : prev);
      setSlipError(null);
    } catch (err: any) {
      console.error('Payment receipt submission failed:', err);
      setSlipError(err?.message || 'Payment receipt could not be submitted. Please try again or use O-RA Assistant later.');
    } finally {
      setIsAnalyzingSlip(false);
      e.target.value = '';
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizeSriLankaPhone = (value: string) => {
      const digits = String(value || '').replace(/\D/g, '');
      if (digits.startsWith('94') && digits.length === 11) return `0${digits.slice(2)}`;
      return digits;
    };
    const phone = normalizeSriLankaPhone(formData.phone);
    const whatsapp = normalizeSriLankaPhone(formData.whatsapp || formData.phone);
    if (!formData.customer_name.trim() || !formData.address.trim() || !formData.city.trim()) {
      alert('Please fill in all required fields (Name, Phone, Address, City).');
      return;
    }
    if (!/^07\d{8}$/.test(phone)) {
      alert('Please enter a valid Sri Lankan mobile number, for example 0771234567.');
      return;
    }
    if (formData.whatsapp && !/^07\d{8}$/.test(whatsapp)) {
      alert('Please enter a valid WhatsApp number, for example 0771234567.');
      return;
    }
    if (formData.customer_name.trim().length < 3 || formData.address.trim().length < 8 || formData.city.trim().length < 2) {
      alert('Please enter valid customer details. Name, address and city are too short.');
      return;
    }

    try {
      const guardResponse = await fetch('/api/order-guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, whatsapp, items: cart.map((i) => ({ id: i.product.id, variant_id: i.variant?.id, qty: i.quantity })) }),
      });
      const guard = await guardResponse.json();
      if (!guardResponse.ok || guard.allowed === false) {
        alert(guard.message || 'This order was blocked as a duplicate or suspicious request.');
        return;
      }
    } catch {
      // Local duplicate and blacklist protection in StoreContext still applies if server guard is unavailable.
    }

    // Orders above the admin-defined quantity threshold require the configured bank advance before confirmation.
    if (isAdvanceRequired && !hasSavedBankDetails) {
      alert(`⚠️ Bank Transfer is temporarily unavailable.\n\nThis order requires a ${advancePercentage}% advance payment, but the store has not published bank account details yet. Please use O-RA Assistant to contact a representative before placing this high-quantity order.\n\nමෙම ඇණවුම සඳහා ${advancePercentage}% අත්තිකාරම් ගෙවීමක් අවශ්‍යයි. නමුත් බැංකු ගිණුම් විස්තර තවම ප්‍රසිද්ධ කර නැත. කරුණාකර O-RA Assistant හරහා අපගේ නියෝජිතයෙකු සම්බන්ධ කරගන්න.`);
      return;
    }

    if (isAdvanceRequired && paymentMethod === 'COD') {
      alert(`⚠️ ${advancePercentage}% Advance Payment Required / ${advancePercentage}% අත්තිකාරම් ගෙවීම අවශ්‍යයි\n\nThis order contains more than ${advanceQtyThreshold} items. Please select Bank Transfer and pay at least Rs. ${advanceAmount.toLocaleString()} as the required advance. The remaining balance can be collected on delivery.\n\nමෙම ඇණවුමේ භාණ්ඩ ${advanceQtyThreshold}කට වඩා වැඩිය. කරුණාකර Bank Transfer තෝරා අවම වශයෙන් Rs. ${advanceAmount.toLocaleString()} ක ${advancePercentage}% අත්තිකාරම් මුදල ගෙවන්න. ඉතිරි මුදල භාණ්ඩ ලැබෙන විට ගෙවිය හැක.`);
      return;
    }

    if (paymentMethod === 'Bank Payment' && !hasSavedBankDetails) {
      alert('Bank Transfer is currently unavailable. Please select Cash on Delivery or contact our support team.');
      return;
    }

    setIsSubmitting(true);

    try {
      const customerSession = supabase ? (await supabase.auth.getSession()).data.session : null;
      const order = await placeOrder({
        customer_name: formData.customer_name,
        phone,
        whatsapp,
        address: formData.address,
        city: formData.city,
        payment_method: paymentMethod,
        notes: formData.notes,
        bank_receipt_url: '',
        payment_verification_status: paymentMethod === 'Bank Payment' ? 'Awaiting Receipt' : 'Not Required',
        payment_detected_bank: undefined,
        payment_detected_amount: undefined,
        payment_reference: undefined,
        payment_account_match: undefined,
        payment_amount_match: undefined,
        payment_receipt_like: undefined,
        payment_ocr_confidence: undefined,
        payment_check_notes: paymentMethod === 'Bank Payment' ? 'Order created. Awaiting customer bank-transfer receipt.' : '',
        gift_wrap_selected: giftWrapSelected,
        customer_access_token: customerSession?.access_token,
      });

      setCompletedOrder(order);

      // Trigger Confetti Celebration
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err: any) {
      alert(err.message || 'Error placing order');
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeCheckout = () => {
    setCompletedOrder(null);
    setBankReceiptImage(null);
    setIsSlipVerified(false);
    setAutoCheckPassed(false);
    setPaymentCheckNotes('');
    setSlipError(null);
    setGiftWrapSelected(false);
    closeCheckoutAndRestoreCart();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-3rem)] bg-white border border-gray-100 rounded-3xl shadow-2xl overflow-y-auto overflow-x-hidden my-auto text-gray-900">
        {/* Close Button */}
        <button
          onClick={closeCheckout}
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-gray-100 text-gray-500 hover:text-black hover:bg-gray-200 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {completedOrder ? (
          /* Success Screen */
          <div className="p-6 sm:p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-2">
              <span className="px-3.5 py-1 rounded-full bg-orange-50 text-orange-600 text-xs font-mono font-bold border border-orange-100">
                ORDER ID: {completedOrder.order_number}
              </span>
              <h2 className="text-2xl font-extrabold text-gray-900">
                {completedOrder.payment_method === 'Bank Payment' && completedOrder.payment_verification_status !== 'Approved' ? 'Order Created — Payment Pending' : 'Thank You! Order Successfully Placed'}
              </h2>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                {completedOrder.payment_method === 'Bank Payment' && completedOrder.payment_verification_status !== 'Approved' ? (completedOrder.bank_receipt_url ? 'Your payment receipt has been received for verification. The order stays on hold until an admin confirms the bank credit.' : 'Your Order ID is ready. Complete the bank transfer below, then upload the receipt. You can also upload it later from O-RA Assistant.') : 'We have received your order details. Our team is processing your dispatch. You can download your official PDF invoice below.'}
              </p>
              <p className="mx-auto max-w-md rounded-xl bg-blue-50 px-3 py-2 text-[10px] leading-4 text-blue-700">
                {language === 'si' ? 'Order ID එක සුරැකිව තබා ගන්න. එය අමතක වුණත් O-RA Assistant හරහා order එක ලබාදුන් මාධ්‍යය සහ phone number verify කර පසුව order එක නැවත සොයාගත හැක.' : 'Save your Order ID. If you lose it, you can later recover the order through O-RA Assistant by verifying the order source and phone number.'}
              </p>
            </div>

            {/* Advance payment notice if required */}
            {completedOrder.is_advance_required && (
              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-xs text-orange-900 text-left space-y-1">
                <div className="flex items-center space-x-1.5 font-bold text-orange-600">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{advancePercentage}% Advance Payment Notice / {advancePercentage}% අත්තිකාරම් ගෙවීමේ දැනුම්දීම</span>
                </div>
                <p className="text-[11px] text-orange-800 leading-relaxed">
                  Please deposit the {advancePercentage}% advance payment of <b>Rs. {completedOrder.advance_amount.toLocaleString()}</b> to our bank account. After the transfer, upload the receipt below. Final payment approval is done only after an admin confirms the bank credit.
                </p>
                <p className="text-[11px] text-orange-800 leading-relaxed">
                  කරුණාකර <b>Rs. {completedOrder.advance_amount.toLocaleString()}</b> ක {advancePercentage}% අත්තිකාරම් මුදල අපගේ බැංකු ගිණුමට තැන්පත් කරන්න. මුදල් හුවමාරුවෙන් පසු receipt එක පහළින් upload කරන්න. බැංකු ගිණුමට මුදල් ලැබී ඇති බව Admin තහවුරු කළ පසු පමණක් ගෙවීම අනුමත වේ.
                </p>
              </div>
            )}

            {completedOrder.payment_method === 'Bank Payment' && hasSavedBankDetails && completedOrder.payment_verification_status !== 'Approved' && (
              <div className="space-y-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 text-left">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-orange-800">Bank Transfer for {completedOrder.order_number}</p>
                    <p className="mt-0.5 text-[10px] text-orange-700">Use this Order ID for your payment proof. Transfer the exact amount shown below.</p>
                  </div>
                  <button type="button" onClick={() => handleCopyBankDetails(completedOrder.is_advance_required && !completedOrder.advance_confirmed ? Number(completedOrder.advance_amount || 0) : Number(completedOrder.total_amount || 0))} className="shrink-0 rounded-xl border border-orange-200 bg-white px-3 py-2 text-[10px] font-black text-orange-700">
                    {copiedPaymentField === 'all' ? 'Copied All ✓' : 'Copy All'}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
                  <div className="rounded-xl border border-gray-100 bg-white p-3">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-gray-400">Bank Name</span>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-900">{settings.bank_name}</span>
                      <button type="button" onClick={() => void copyPaymentText(settings.bank_name, 'bank')} className="shrink-0 rounded-lg border border-orange-200 px-2.5 py-1.5 text-[10px] font-black text-orange-700">{copiedPaymentField === 'bank' ? 'Copied ✓' : 'Copy'}</button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white p-3">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-gray-400">Branch</span>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-900">{settings.bank_branch}</span>
                      <button type="button" onClick={() => void copyPaymentText(settings.bank_branch, 'branch')} className="shrink-0 rounded-lg border border-orange-200 px-2.5 py-1.5 text-[10px] font-black text-orange-700">{copiedPaymentField === 'branch' ? 'Copied ✓' : 'Copy'}</button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white p-3 sm:col-span-2">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-gray-400">Account Holder Name</span>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-900">{settings.bank_account_holder}</span>
                      <button type="button" onClick={() => void copyPaymentText(settings.bank_account_holder, 'holder')} className="shrink-0 rounded-lg border border-orange-200 px-2.5 py-1.5 text-[10px] font-black text-orange-700">{copiedPaymentField === 'holder' ? 'Copied ✓' : 'Copy'}</button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border-2 border-orange-200 bg-white p-3">
                    <span className="block text-[9px] font-black uppercase tracking-wider text-orange-500">Account Number</span>
                    <div className="mt-1 flex items-center justify-between gap-2"><span className="break-all font-mono text-base font-black text-gray-950">{settings.bank_account_number}</span><button type="button" onClick={() => void copyPaymentText(settings.bank_account_number, 'account')} className="rounded-lg border border-orange-200 px-2.5 py-1.5 text-[10px] font-black text-orange-700">{copiedPaymentField === 'account' ? 'Copied ✓' : 'Copy'}</button></div>
                  </div>
                  <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3">
                    <span className="block text-[9px] font-black uppercase tracking-wider text-emerald-600">{completedOrder.is_advance_required && !completedOrder.advance_confirmed ? `${advancePercentage}% Advance to Transfer Now` : 'Amount to Transfer Now'}</span>
                    <div className="mt-1 flex items-center justify-between gap-2"><span className="text-base font-black text-emerald-800">Rs. {(completedOrder.is_advance_required && !completedOrder.advance_confirmed ? Number(completedOrder.advance_amount || 0) : Number(completedOrder.total_amount || 0)).toLocaleString()}</span><button type="button" onClick={() => void copyPaymentText(String(completedOrder.is_advance_required && !completedOrder.advance_confirmed ? Number(completedOrder.advance_amount || 0) : Number(completedOrder.total_amount || 0)), 'amount')} className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[10px] font-black text-emerald-700">{copiedPaymentField === 'amount' ? 'Copied ✓' : 'Copy'}</button></div>
                  </div>
                </div>

                {!completedOrder.bank_receipt_url ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-center gap-2 text-xs font-black text-gray-900"><Upload className="h-4 w-4 text-orange-600"/>Upload Payment Receipt</div>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">Upload a clear JPG/PNG/WEBP receipt after the transfer. OCR is only a pre-check; it can never approve the payment.</p>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleReceiptFileUpload} className="mt-2 block w-full text-[10px] file:mr-2 file:rounded-lg file:border-0 file:bg-orange-100 file:px-3 file:py-2 file:font-bold file:text-orange-700" disabled={isAnalyzingSlip}/>
                    {isAnalyzingSlip && <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-orange-700"><Loader2 className="h-4 w-4 animate-spin"/>Reading receipt and sending it to Bank Transfer Check...</div>}
                    {slipError && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-[10px] font-semibold text-red-700">{slipError}</div>}
                  </div>
                ) : (
                  <div className={`rounded-xl border p-3 ${completedOrder.payment_verification_status === 'Approved' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                    <div className="flex items-center justify-between gap-2"><div><p className="text-xs font-black text-gray-900">Receipt received for verification</p><p className="mt-1 text-[10px] text-gray-600">{completedOrder.payment_verification_status === 'Approved' ? 'Payment approved.' : 'Waiting for Admin to confirm the bank credit. The order remains on hold until then.'}</p>{isSlipVerified && <p className="mt-1 text-[9px] font-bold text-gray-500">OCR pre-check: {autoCheckPassed ? 'Likely match — still not approved' : 'Needs manual review'}</p>}</div><button type="button" onClick={() => setShowEnlargedReceipt(true)} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-700"><Eye className="h-4 w-4"/></button></div>
                  </div>
                )}
              </div>
            )}

            {/* Order Summary Box */}
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 text-left text-xs space-y-2">
              <div className="flex justify-between font-bold text-gray-900 pb-2 border-b border-gray-200">
                <span>Customer: {completedOrder.customer_name}</span>
                <span>Phone: {completedOrder.phone}</span>
              </div>
              <div className="text-gray-500 space-y-1">
                <p>Address: {completedOrder.address}, {completedOrder.city}</p>
                <p>Payment Method: {completedOrder.payment_method}</p>
                <p>Total Items: {completedOrder.items.reduce((s, i) => s + i.quantity, 0)}</p>
              </div>

              {/* Verified Bank Receipt Attachment Notice */}
              {completedOrder.bank_receipt_url && (
                <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 flex items-center justify-between mt-2">
                  <div className="flex items-center space-x-2">
                    <FileCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold text-emerald-900 text-[11px]">Receipt Uploaded &amp; Saved</p>
                      <p className="text-[10px] text-emerald-700">{completedOrder.payment_verification_status === 'Approved' ? 'Payment approved' : 'Waiting for admin bank confirmation'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowEnlargedReceipt(true)}
                    className="p-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-800 text-[10px] font-bold flex items-center space-x-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Slip</span>
                  </button>
                </div>
              )}

              <div className="flex justify-between font-extrabold text-orange-600 pt-2 border-t border-gray-200 text-sm">
                <span>Total Amount Payable:</span>
                <span>Rs. {completedOrder.total_amount.toLocaleString()}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {completedOrder.invoice_locked ? (
                <button
                  onClick={() => generateOrderInvoicePDF(completedOrder, settings)}
                  className="py-3 px-4 rounded-full bg-black hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-md transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PDF Invoice</span>
                </button>
              ) : (
                <div className="py-3 px-4 rounded-full bg-orange-50 border border-orange-100 text-orange-700 font-bold text-xs text-center">Invoice will be available after stock allocation &amp; admin processing.</div>
              )}

              <button
                type="button"
                onClick={() => {
                  closeCheckout();
                  window.setTimeout(() => window.dispatchEvent(new CustomEvent('ora:assistant-open')), 80);
                }}
                className="py-3 px-4 rounded-full bg-orange-50 border border-orange-100 text-orange-700 hover:bg-orange-100 font-bold text-xs flex items-center justify-center space-x-2 transition-colors"
              >
                <MessageSquare className="w-4 h-4 text-orange-600" />
                <span>Open O-RA Assistant</span>
              </button>
            </div>
          </div>
        ) : (
          /* Checkout Form */
          <form onSubmit={handleSubmitOrder} className="p-6 sm:p-8 space-y-5">
            <div>
              <div className="flex items-center space-x-2 text-orange-600">
                <Sparkles className="w-5 h-5" />
                <h2 className="text-lg font-bold text-gray-900">
                  {getTranslation(language, 'checkoutTitle')}
                </h2>
              </div>
              <p className="text-xs text-gray-500">
                {getTranslation(language, 'customerInfo')}
              </p>
            </div>

            <div className={`rounded-2xl border p-3.5 ${customerSession ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
              {customerSession ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-emerald-900">Google account connected</p>
                    <p className="mt-1 text-[10px] text-emerald-700">
                      {customerAuthBusy ? 'Loading saved customer details…' : `Signed in as ${customerSession.user?.email || 'customer'}. Saved profile details are filled automatically when available.`}
                    </p>
                  </div>
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black text-gray-900">Guest Checkout</p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">No account is required. Or sign in with Google to keep your customer profile and order history together.</p>
                  </div>
                  <button
                    type="button"
                    disabled={!isSupabaseConfigured || customerAuthBusy}
                    onClick={() => void continueCheckoutWithGoogle()}
                    className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-800 hover:border-orange-300 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {customerAuthBusy ? 'Opening…' : 'Continue with Google (Optional)'}
                  </button>
                </div>
              )}
            </div>

            {/* Checkout Item & Quantity Editor - works for both Buy Now and normal Cart checkout */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-900">Order Items</h3>
                <span className="text-[10px] font-bold text-gray-500">{cartItemCount} item{cartItemCount === 1 ? '' : 's'}</span>
              </div>

              <div className={`${showAllCheckoutItems && cart.length > 3 ? 'max-h-[340px] overflow-y-auto pr-1' : ''} space-y-2`}>
                {(showAllCheckoutItems || cart.length <= 3 ? cart : cart.slice(0, 3)).map((item) => {
                  const unitPrice = displayUnitPrice(item.product, settings, item.variant);
                  return (
                    <div key={item.line_id || `${item.product.id}::${item.variant?.id || 'base'}`} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                      <img
                        src={item.variant?.image || item.product.images[0]}
                        alt={item.product.name_en}
                        className="h-14 w-14 shrink-0 rounded-xl object-cover border border-gray-200 bg-white"
                        referrerPolicy="no-referrer"
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-gray-900">
                          {language === 'si' ? item.product.name_si : item.product.name_en}
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-500">SKU: {item.variant?.sku || item.product.sku}{item.variant?.option_value ? ` • ${item.variant.option_value}` : ''}</p>
                        <p className="mt-1 text-xs font-black text-orange-600">
                          Rs. {(unitPrice * item.quantity).toLocaleString()}
                        </p>
                      </div>

                      <div className="shrink-0">
                        <p className="mb-1 text-center text-[9px] font-bold uppercase tracking-wide text-gray-400">Qty</p>
                        <div className="flex items-center rounded-xl border border-gray-200 bg-white p-1 shadow-xs">
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(item.line_id || `${item.product.id}::${item.variant?.id || 'base'}`, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-8 px-1 text-center text-sm font-black text-gray-900">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(item.line_id || `${item.product.id}::${item.variant?.id || 'base'}`, item.quantity + 1)}
                            disabled={item.quantity >= 999}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-1 text-center text-[9px] text-gray-400">Choose your quantity</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {cart.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllCheckoutItems((value) => !value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-black text-gray-700 hover:border-orange-300 hover:text-orange-700"
                >
                  {showAllCheckoutItems ? `Hide Items ▲` : `Show all ${cart.length} product lines ▼`}
                </button>
              )}

              <div className="rounded-2xl border border-gray-100 bg-white px-3 py-2.5 text-[11px]">
                <div className="flex justify-between text-gray-500">
                  <span>Products Subtotal</span>
                  <span className="font-bold text-gray-800">Rs. {cartSubtotal.toLocaleString()}</span>
                </div>
                {cartSpecialOfferDiscount > 0 && (
                  <div className="my-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
                    <div className="flex items-center justify-between text-orange-700">
                      <span className="font-black">🎉 SPECIAL MULTI-BUY OFFER • {cartMultiBuyDiscountRate}% OFF</span>
                      <span className="font-black">- Rs. {cartSpecialOfferDiscount.toLocaleString()}</span>
                    </div>
                    <p className="mt-0.5 text-[9px] font-semibold text-orange-600">You save more when you buy more!</p>
                  </div>
                )}
                <div className="mt-1 flex justify-between text-gray-500">
                  <span>Delivery</span>
                  <span className="font-bold text-gray-800">{settings.free_delivery_enabled ? 'FREE' : `Rs. ${deliveryFee.toLocaleString()}`}</span>
                </div>
                {settings.gift_wrap_enabled && giftWrapSelected && (
                  <div className="mt-1 flex justify-between text-gray-500">
                    <span>Gift Wrapping</span>
                    <span className="font-bold text-gray-800">Rs. {giftWrapFee.toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm font-black text-gray-900">
                  <span>Total</span>
                  <span className="text-orange-600">Rs. {finalTotal.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Configurable Advance Warning if required */}
            {isAdvanceRequired && (
              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-3.5 text-xs text-orange-900 space-y-1">
                <div className="flex items-center space-x-2 font-bold text-orange-600">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{advancePercentage}% Advance Payment Required / {advancePercentage}% අත්තිකාරම් ගෙවීම අවශ්‍යයි</span>
                </div>
                <p className="text-[11px] text-orange-800 leading-relaxed">
                  Your cart contains <b>{cartItemCount} items</b> (&gt; {advanceQtyThreshold} items). A {advancePercentage}% advance payment of <b>Rs. {advanceAmount.toLocaleString()}</b> is required.
                </p>
                <p className="text-[11px] text-orange-800 leading-relaxed">
                  ඔබගේ කරත්තයේ <b>භාණ්ඩ {cartItemCount}ක්</b> ඇත ({advanceQtyThreshold}කට වැඩි). <b>Rs. {advanceAmount.toLocaleString()}</b> ක {advancePercentage}% අත්තිකාරම් ගෙවීමක් අවශ්‍ය වේ.
                </p>
              </div>
            )}

            {settings.gift_wrap_enabled && (
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-pink-100 bg-pink-50 p-3.5 cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-gray-900">Gift Wrapping</p>
                  <p className="text-[10px] text-gray-500">Add gift wrapping for Rs. {Math.max(0, Number(settings.gift_wrap_fee || 0)).toLocaleString()}</p>
                </div>
                <input type="checkbox" checked={giftWrapSelected} onChange={(e) => setGiftWrapSelected(e.target.checked)} className="h-4 w-4 accent-orange-600" />
              </label>
            )}

            {/* Form Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-gray-700 font-bold mb-1">
                  {getTranslation(language, 'fullName')} *
                </label>
                <input
                  type="text"
                  required
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  placeholder="e.g. Sahan Wickramasinghe"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-bold mb-1">
                  {getTranslation(language, 'phone')} *
                </label>
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/[^0-9+]/g, '').slice(0, 12) })}
                  placeholder="e.g. 0771234567"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-bold mb-1">
                  {getTranslation(language, 'whatsapp')}
                </label>
                <input
                  type="tel"
                  value={formData.whatsapp}
                  onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value.replace(/[^0-9+]/g, '').slice(0, 12) })}
                  placeholder="Same as phone if left empty"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-bold mb-1">
                  {getTranslation(language, 'city')} *
                </label>
                <input
                  type="text"
                  required
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="e.g. Colombo, Kandy, Galle..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-gray-700 font-bold mb-1">
                  {getTranslation(language, 'address')} *
                </label>
                <textarea
                  required
                  rows={2}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="House number, street name, landmarks..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-700">
                {getTranslation(language, 'paymentMethod')}
              </label>

              <div className={`grid gap-3 ${hasSavedBankDetails ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('COD')}
                  className={`p-3 rounded-2xl border text-xs font-bold flex items-center space-x-2 transition-all ${
                    paymentMethod === 'COD'
                      ? 'bg-orange-50 border-orange-600 text-orange-900'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <Truck className="w-4 h-4 text-orange-600" />
                  <span>Cash on Delivery</span>
                </button>

                {hasSavedBankDetails && (
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Bank Payment')}
                    className={`p-3 rounded-2xl border text-xs font-bold flex items-center space-x-2 transition-all ${
                      paymentMethod === 'Bank Payment'
                        ? 'bg-orange-50 border-orange-600 text-orange-900'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <Copy className="w-4 h-4 text-orange-600" />
                    <span>Bank Transfer</span>
                  </button>
                )}
              </div>

              {!hasSavedBankDetails && isAdvanceRequired && (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-900">
                  This order requires an advance payment, but Bank Transfer details are temporarily unavailable. Please use O-RA Assistant to contact a representative before placing the order.<br />
                  මෙම ඇණවුම සඳහා අත්තිකාරම් ගෙවීමක් අවශ්‍යයි. බැංකු ගිණුම් විස්තර තවම ලබාදී නොමැති නිසා O-RA Assistant හරහා නියෝජිතයෙකු සම්බන්ධ කරගන්න.
                </div>
              )}
            </div>

            {/* Bank Transfer - order first, receipt second */}
            {paymentMethod === 'Bank Payment' && hasSavedBankDetails && (
              <div className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4 text-xs text-orange-950">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                  <div className="space-y-1">
                    <p className="font-black">Order ID first → Bank Transfer → Receipt Upload</p>
                    <p className="text-[10px] leading-4 text-orange-800">Your order will be created first. On the next screen you will see the Order ID, saved bank details and the exact amount to transfer. Upload the payment receipt only after the transfer.</p>
                    <p className="text-[10px] leading-4 text-orange-800">මුලින් Order ID එක සෑදෙයි. ඊළඟ screen එකේ bank details සහ ගෙවිය යුතු නිවැරදි මුදල පෙන්වයි. මුදල් හුවමාරුවෙන් පසු receipt එක upload කරන්න.</p>
                    <p className="pt-1 text-[9px] font-bold text-orange-700">A receipt never means “Paid” automatically. Final approval requires an Admin to confirm the bank credit.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Total Summary Row */}
            <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200 flex items-center justify-between text-xs">
              <span className="text-gray-700 font-bold">Total Amount Payable:</span>
              <span className="text-base font-black text-orange-600">
                Rs. {finalTotal.toLocaleString()}
              </span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-full bg-black hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm shadow-md transition-colors flex items-center justify-center space-x-2"
            >
              <span>{isSubmitting ? 'Processing Order...' : paymentMethod === 'Bank Payment' ? 'Create Order & Continue to Bank Transfer' : getTranslation(language, 'placeOrder')}</span>
            </button>
          </form>
        )}
      </div>
      {/* Enlarged Bank Receipt Preview Modal */}
      {showEnlargedReceipt && (bankReceiptImage || completedOrder?.bank_receipt_url) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative max-w-lg w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
            <button
              type="button"
              onClick={() => setShowEnlargedReceipt(false)}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-neutral-800 text-neutral-300 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <FileCheck className="w-4 h-4 text-emerald-400" />
              <span>Bank Payment Transfer Receipt / Screenshot</span>
            </h3>
            <div className="rounded-xl overflow-hidden border border-neutral-800 bg-black max-h-[70vh] flex items-center justify-center">
              <img
                src={bankReceiptImage || completedOrder?.bank_receipt_url}
                alt="Bank Transfer Receipt"
                className="max-h-[68vh] w-auto object-contain"
              />
            </div>
            <p className="text-[10px] text-neutral-400 text-center">
              Verified &amp; attached to order ID #{completedOrder?.order_number || 'Pending'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
