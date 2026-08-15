import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, ChevronDown, Languages, Loader2, MessageCircle, Send, ShieldCheck, Upload, UserRound } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { analyzeReceiptLocally } from '../lib/receiptOcr';
import { compressImageFile, uploadPublicImage } from '../lib/imageUpload';
import { productSearchScore } from '../lib/productSearch';

type ChatMessage = { id: string; role: 'assistant' | 'user' | 'agent'; text: string };
type FlowMode = 'chat' | 'track-method' | 'track-a-order' | 'track-a-phone' | 'track-b-phone' | 'track-b-name' | 'track-c-order' | 'track-c-name' | 'track-c-last4' | 'payment-id' | 'payment-phone' | 'payment-upload' | 'agent-awaiting-message' | 'agent-live';
type AssistantLanguage = 'en' | 'si' | 'ta';

type VerifiedOrder = {
  order_number: string;
  customer_name?: string;
  phone?: string;
  address?: string;
  city?: string;
  status: string;
  payment_method?: string;
  payment_status: string;
  payment_verification_status?: string;
  payment_paid_type?: 'Advance' | 'Full' | 'COD';
  advance_confirmed?: boolean;
  advance_amount?: number;
  advance_percentage?: number;
  receipt_received?: boolean;
  delivery_status?: string;
  tracking_status?: string;
  waybill_number?: string;
  invoice_generated?: boolean;
  packing_pdf_downloaded?: boolean;
  packing_pdf_downloaded_at?: string;
  subtotal?: number;
  special_offer_discount?: number;
  delivery_fee?: number;
  total_amount: number;
  order_source?: string;
  created_at?: string;
  expected_payment_amount?: number;
  is_advance_required?: boolean;
  payment_eligible?: boolean;
  items?: { name: string; sku?: string; main_sku?: string; variant_name?: string; quantity: number; unit_price?: number; subtotal?: number }[];
};

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const digits = (v: string) => v.replace(/\D/g, '');
const hasAny = (text: string, words: string[]) => words.some((w) => text.includes(w));
const restrictedProductIntent = (text: string) => /\b(weapon|gun|firearm|ammo|ammunition|knife|blade|taser|pepper\s*spray)\b/i.test(text);

const languageName: Record<AssistantLanguage, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };

const copy = {
  en: {
    welcome: 'Hello! I’m O-RA Assistant. I can help with products, orders, payments, delivery, returns and store support.',
    trackAskId: 'Please type your Order ID. Example: WEB-000123',
    trackPhoneAsk: 'Now type the FULL phone number used for this order. Order details are shown only when both match.',
    trackPhoneInvalid: 'Please enter the full phone number used for this order.',
    paymentAskId: 'To check a payment, please type your Order ID first.',
    phoneAsk: 'For privacy, type only the LAST 4 digits of the phone number used for this order.',
    phoneInvalid: 'Please enter exactly the last 4 phone digits.',
    orderNotVerified: 'I could not verify that order. Please check the Order ID and the last 4 phone digits.',
    paymentNotEligible: 'This order cannot accept a new bank-transfer receipt right now.',
    paymentAlreadyReceived: 'We already received a payment receipt for this order. It is waiting for bank confirmation by an O-RA representative.',
    paymentApproved: 'This bank payment has already been approved.',
    paymentRejected: 'Your previous payment receipt could not be verified and was rejected. Please upload the correct bank-transfer receipt again.',
    codNoReceipt: 'This is a Cash on Delivery (COD) order, so you do not need to upload a bank-transfer receipt.',
    expectedPayment: (amount: number) => `Order verified. Amount to verify: Rs. ${amount.toLocaleString()}. Please upload the real bank-transfer receipt/screenshot here.`,
    aiUnavailable: 'Smart AI is temporarily unavailable, but O-RA Basic Support is still online.',
    receiptSelected: (id: string) => `Receipt selected for ${id}`,
    proofSaved: 'Payment receipt received. It is now waiting for manual bank confirmation. This does NOT mean the payment is approved yet.',
    proofFailed: 'The receipt could not be submitted. Please try again with a clear screenshot/photo.',
    paymentProofOnly: 'Payment receipt verification',
    paymentProofInfo: 'OCR only helps the pre-check. An O-RA representative approves the payment only after confirming the money in the bank account.',
    uploadReceipt: 'Upload Payment Receipt',
    trackOrder: 'Track Order',
    paymentDone: 'I Paid',
    paymentHelpButton: 'Payment Help',
    deliveryButton: 'Delivery',
    agentButton: 'Agent Support',
    placeholder: 'Ask O-RA Assistant...',
    checkingProof: 'Checking receipt...',
    typing: 'O-RA Assistant is typing...',
    noAutoApprove: 'Receipts are never auto-approved.',
    fallbackOn: 'Human handoff available',
    restricted: 'I can’t help find or buy restricted or dangerous items. I can help with other O-RA products and orders.',
    howToOrder: 'Add the products you need to the Cart, then Checkout once. You can combine several different products in one order.',
    returns: 'For a return, keep the invoice safely. The returned parcel is checked before refund or stock handling.',
    handoffAsk: 'If you need help from one of our representatives, please briefly type your inquiry or issue.',
    handoffSent: 'Thank you. Your message has been sent to O-RA Assistant Chats. One of our representatives will get in touch with you shortly.',
    agentTyping: 'Sending to O-RA representative...',
    resolved: 'This support conversation was marked as resolved. You can continue asking O-RA Assistant if you need anything else.',
  },
  si: {
    welcome: 'ආයුබෝවන්! මම O-RA Assistant. භාණ්ඩ, ඇණවුම්, ගෙවීම්, බෙදාහැරීම, රිටර්න් සහ store support ගැන උදව් කරන්න පුළුවන්.',
    trackAskId: 'ඔබගේ Order ID එක type කරන්න. උදා: WEB-000123',
    trackPhoneAsk: 'දැන් මේ order එකට භාවිතා කළ සම්පූර්ණ Phone Number එක type කරන්න. Order ID + Phone Number දෙකම match වුණොත් විතරයි details පෙන්වන්නේ.',
    trackPhoneInvalid: 'මෙම order එකට භාවිතා කළ සම්පූර්ණ Phone Number එක ඇතුළත් කරන්න.',
    paymentAskId: 'ගෙවීමක් පරීක්ෂා කිරීමට මුලින් Order ID එක type කරන්න.',
    phoneAsk: 'ආරක්ෂාව සඳහා මෙම order එකට භාවිතා කළ දුරකථන අංකයේ අවසන් අංක 4 විතරක් type කරන්න.',
    phoneInvalid: 'දුරකථන අංකයේ අවසන් අංක 4 නිවැරදිව ඇතුළත් කරන්න.',
    orderNotVerified: 'Order එක verify කරන්න බැරි වුණා. Order ID එක සහ phone number එකේ අවසන් අංක 4 නැවත බලන්න.',
    paymentNotEligible: 'මෙම order එකට දැන් අලුත් Bank Transfer receipt එකක් submit කරන්න බැහැ.',
    paymentAlreadyReceived: 'මෙම order එක සඳහා payment receipt එක දැනටමත් ලැබී ඇත. O-RA නියෝජිතයෙකු bank account එක පරීක්ෂා කර තහවුරු කරනතුරු එය pending වේ.',
    paymentApproved: 'මෙම Bank Transfer ගෙවීම දැනටමත් approve කර ඇත.',
    paymentRejected: 'ඔබ කලින් යොමු කළ payment receipt එක තහවුරු කළ නොහැකි නිසා reject කර ඇත. කරුණාකර නිවැරදි Bank Transfer receipt එක නැවත upload කරන්න.',
    codNoReceipt: 'මෙය Cash on Delivery (COD) order එකක්. ඒ නිසා Bank Transfer receipt එකක් upload කරන්න අවශ්‍ය නැහැ.',
    expectedPayment: (amount: number) => `Order එක verify වුණා. පරීක්ෂා කළ යුතු මුදල: Rs. ${amount.toLocaleString()}. දැන් සැබෑ Bank Transfer receipt/screenshot එක upload කරන්න.`,
    aiUnavailable: 'Smart AI තාවකාලිකව ලබාගත නොහැක. O-RA Basic Support තවම online.',
    receiptSelected: (id: string) => `${id} සඳහා receipt එක තෝරාගෙන ඇත`,
    proofSaved: 'Payment receipt එක ලැබුණා. දැන් එය bank account එක අතින් පරීක්ෂා කර තහවුරු කිරීමට බලාපොරොත්තු වේ. මේක Payment Approved කියන එක නොවේ.',
    proofFailed: 'Receipt එක submit කරන්න බැරි වුණා. පැහැදිලි screenshot/photo එකකින් නැවත උත්සාහ කරන්න.',
    paymentProofOnly: 'Payment receipt පරීක්ෂාව',
    paymentProofInfo: 'OCR එක pre-check එකකට විතරයි. මුදල් bank account එකට ඇත්තටම ලැබී ඇති බව O-RA නියෝජිතයෙකු පරීක්ෂා කළ පසු විතරයි payment approve වෙන්නේ.',
    uploadReceipt: 'Payment Receipt Upload කරන්න',
    trackOrder: 'Order එක Track කරන්න',
    paymentDone: 'Payment කළා',
    paymentHelpButton: 'Payment උදව්',
    deliveryButton: 'Delivery',
    agentButton: 'නියෝජිත සහාය',
    placeholder: 'O-RA ගැන අහන්න...',
    checkingProof: 'Receipt එක පරීක්ෂා කරමින්...',
    typing: 'O-RA Assistant පිළිතුර සකස් කරමින්...',
    noAutoApprove: 'Receipt එකකින් payment auto approve වෙන්නේ නැහැ.',
    fallbackOn: 'නියෝජිත සහාය ලබාගත හැක',
    restricted: 'සීමා කළ හෝ අනතුරුදායක භාණ්ඩ සෙවීමට හෝ මිලදී ගැනීමට මට උදව් කරන්න බැහැ. O-RA හි අනෙකුත් භාණ්ඩ සහ orders ගැන උදව් කරන්න පුළුවන්.',
    howToOrder: 'අවශ්‍ය භාණ්ඩ Cart එකට එක් කර අවසානයේ එක්වර Checkout කරන්න. වෙනස් භාණ්ඩ කිහිපයක් එකම order එකකට එකතු කරන්න පුළුවන්.',
    returns: 'Return කිරීම සඳහා invoice එක සුරක්ෂිතව තබාගන්න. Refund හෝ stock ක්‍රියාවලියට පෙර ආපසු ලැබෙන parcel එක පරීක්ෂා කරයි.',
    handoffAsk: 'අපගේ නියෝජිතයෙකුගේ සහාය අවශ්‍ය නම්, ඔබගේ විමසුම හෝ ගැටලුව කෙටියෙන් ටයිප් කර එවන්න.',
    handoffSent: 'ස්තූතියි. ඔබගේ පණිවිඩය O-RA Assistant Chats වෙත යවා ඇත. අපගේ නියෝජිතයෙකු ඔබ හා ඉක්මනින් සම්බන්ධ වනු ඇත.',
    agentTyping: 'O-RA නියෝජිතයා වෙත යවමින්...',
    resolved: 'මෙම support chat එක විසඳා අවසන් ලෙස සලකුණු කර ඇත. අවශ්‍ය නම් O-RA Assistantගෙන් තවත් ප්‍රශ්නයක් අහන්න පුළුවන්.',
  },
  ta: {
    welcome: 'வணக்கம்! நான் O-RA Assistant. பொருட்கள், ஆர்டர்கள், கட்டணம், டெலிவரி, ரிட்டர்ன் மற்றும் store support குறித்து உதவ முடியும்.',
    trackAskId: 'உங்கள் Order ID-ஐ உள்ளிடவும். உதாரணம்: WEB-000123',
    trackPhoneAsk: 'இப்போது இந்த order-க்கு பயன்படுத்திய முழு Phone Number-ஐ உள்ளிடவும். Order ID + Phone Number இரண்டும் பொருந்தினால் மட்டுமே details காட்டப்படும்.',
    trackPhoneInvalid: 'இந்த order-க்கு பயன்படுத்திய முழு Phone Number-ஐ உள்ளிடவும்.',
    paymentAskId: 'கட்டணத்தைச் சரிபார்க்க முதலில் Order ID-ஐ உள்ளிடவும்.',
    phoneAsk: 'பாதுகாப்பிற்காக இந்த order-க்கு பயன்படுத்திய தொலைபேசி எண்ணின் கடைசி 4 இலக்கங்களை மட்டும் உள்ளிடவும்.',
    phoneInvalid: 'தொலைபேசி எண்ணின் கடைசி 4 இலக்கங்களை சரியாக உள்ளிடவும்.',
    orderNotVerified: 'Order-ஐ உறுதிப்படுத்த முடியவில்லை. Order ID மற்றும் கடைசி 4 phone இலக்கங்களைச் சரிபார்க்கவும்.',
    paymentNotEligible: 'இந்த order-க்கு இப்போது புதிய Bank Transfer receipt சமர்ப்பிக்க முடியாது.',
    paymentAlreadyReceived: 'இந்த order-க்கு payment receipt ஏற்கனவே கிடைத்துள்ளது. O-RA பிரதிநிதி bank account-ஐ சரிபார்த்து உறுதிப்படுத்தும் வரை அது pending ஆக இருக்கும்.',
    paymentApproved: 'இந்த Bank Transfer payment ஏற்கனவே approve செய்யப்பட்டுள்ளது.',
    paymentRejected: 'நீங்கள் முன்பு அனுப்பிய payment receipt-ஐ உறுதிப்படுத்த முடியாததால் அது நிராகரிக்கப்பட்டது. சரியான Bank Transfer receipt-ஐ மீண்டும் upload செய்யவும்.',
    codNoReceipt: 'இது Cash on Delivery (COD) order. Bank Transfer receipt upload செய்ய தேவையில்லை.',
    expectedPayment: (amount: number) => `Order உறுதிப்படுத்தப்பட்டது. சரிபார்க்க வேண்டிய தொகை: Rs. ${amount.toLocaleString()}. உண்மையான Bank Transfer receipt/screenshot-ஐ upload செய்யவும்.`,
    aiUnavailable: 'Smart AI தற்காலிகமாக கிடைக்கவில்லை. O-RA Basic Support இன்னும் online.',
    receiptSelected: (id: string) => `${id} க்கான receipt தேர்ந்தெடுக்கப்பட்டது`,
    proofSaved: 'Payment receipt பெறப்பட்டது. Bank account-ல் பணம் வந்ததா என்பதை மனிதர் சரிபார்க்கும் வரை இது pending. இது Payment Approved என்று பொருள் அல்ல.',
    proofFailed: 'Receipt submit செய்ய முடியவில்லை. தெளிவான screenshot/photo கொண்டு மீண்டும் முயற்சிக்கவும்.',
    paymentProofOnly: 'Payment receipt verification',
    paymentProofInfo: 'OCR ஒரு pre-check மட்டும். Bank account-ல் பணம் வந்ததை O-RA பிரதிநிதி உறுதிப்படுத்திய பிறகே payment approve செய்யப்படும்.',
    uploadReceipt: 'Payment Receipt Upload',
    trackOrder: 'Order Track',
    paymentDone: 'Payment Done',
    paymentHelpButton: 'Payment Help',
    deliveryButton: 'Delivery',
    agentButton: 'பிரதிநிதி உதவி',
    placeholder: 'O-RA பற்றி கேளுங்கள்...',
    checkingProof: 'Receipt சரிபார்க்கப்படுகிறது...',
    typing: 'O-RA Assistant பதில் தயாரிக்கிறது...',
    noAutoApprove: 'Receipt மூலம் payment auto approve ஆகாது.',
    fallbackOn: 'Human support available',
    restricted: 'கட்டுப்படுத்தப்பட்ட அல்லது ஆபத்தான பொருட்களைத் தேட அல்லது வாங்க உதவ முடியாது. மற்ற O-RA products மற்றும் orders குறித்து உதவ முடியும்.',
    howToOrder: 'தேவையான products-ஐ Cart-ல் சேர்த்து இறுதியில் ஒருமுறை Checkout செய்யவும். பல வேறு products-ஐ ஒரே order-ல் சேர்க்கலாம்.',
    returns: 'Return செய்ய invoice-ஐ பாதுகாப்பாக வைத்திருக்கவும். Refund அல்லது stock process முன் திரும்பிய parcel சரிபார்க்கப்படும்.',
    handoffAsk: 'எங்கள் பிரதிநிதியின் உதவி தேவையெனில், உங்கள் கேள்வி அல்லது பிரச்சினையை சுருக்கமாக டைப் செய்து அனுப்பவும்.',
    handoffSent: 'நன்றி. உங்கள் செய்தி O-RA Assistant Chats-க்கு அனுப்பப்பட்டது. எங்கள் பிரதிநிதிகளில் ஒருவர் விரைவில் உங்களை தொடர்புகொள்வார்.',
    agentTyping: 'O-RA பிரதிநிதியிடம் அனுப்பப்படுகிறது...',
    resolved: 'இந்த support chat தீர்க்கப்பட்டதாக குறிக்கப்பட்டுள்ளது. தேவையெனில் O-RA Assistant-ஐ தொடர்ந்து பயன்படுத்தலாம்.',
  },
};

const statusTranslations: Record<AssistantLanguage, Record<string,string>> = {
  en: { 'New Orders':'Order received', 'Pending Payment':'Waiting for payment verification', Processing:'Preparing your order', Packed:'Packed', Shipped:'Handed to courier', Delivered:'Delivered', Cancelled:'Cancelled', Pending:'Pending', 'Waybill Assigned':'Waybill assigned', 'Not Shipped':'Not shipped yet' },
  si: { 'New Orders':'ඇණවුම ලැබී ඇත', 'Pending Payment':'ගෙවීම තහවුරු කිරීමට බලාපොරොත්තු වේ', Processing:'ඇණවුම සකස් කරමින් පවතී', Packed:'පාර්සලය සකස් කර ඇත', Shipped:'Courier වෙත භාරදී ඇත', Delivered:'බෙදාහැර අවසන්', Cancelled:'අවලංගු කර ඇත', Pending:'බලාපොරොත්තු වේ', 'Waybill Assigned':'Waybill එක නිකුත් කර ඇත', 'Not Shipped':'තවම courier වෙත භාරදී නැත' },
  ta: { 'New Orders':'Order பெறப்பட்டது', 'Pending Payment':'Payment verification pending', Processing:'Order தயாராகிறது', Packed:'Packed', Shipped:'Courier-க்கு அனுப்பப்பட்டது', Delivered:'Delivered', Cancelled:'Cancelled', Pending:'Pending', 'Waybill Assigned':'Waybill assigned', 'Not Shipped':'Not shipped yet' },
};
const translateStatus = (value: string | undefined, lang: AssistantLanguage) => statusTranslations[lang][String(value || '')] || String(value || '');

export const OraAssistant: React.FC = () => {
  const { products, categories, settings } = useStore();
  const [open, setOpen] = useState(false);
  const [assistantLanguage, setAssistantLanguage] = useState<AssistantLanguage | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<FlowMode>('chat');
  const [pendingOrderId, setPendingOrderId] = useState('');
  const [pendingPhoneLast4, setPendingPhoneLast4] = useState('');
  const [pendingTrackPhone, setPendingTrackPhone] = useState('');
  const [pendingTrackName, setPendingTrackName] = useState('');
  const [verifiedOrder, setVerifiedOrder] = useState<VerifiedOrder | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const seenAgentMessageIds = useRef<Set<string>>(new Set());
  const [supportSessionId] = useState(() => {
    const existing = localStorage.getItem('ora_assistant_support_session');
    if (existing && existing.length >= 8) return existing;
    const created = `oas-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
    localStorage.setItem('ora_assistant_support_session', created);
    return created;
  });

  const lang: AssistantLanguage = assistantLanguage || 'en';
  const t = copy[lang];
  const secureTrackText = {
    notVerified: lang==='si' ? 'Order එක verify කරන්න බැරි වුණා. දුන් තොරතුරු නැවත බලන්න.' : lang==='ta' ? 'Order-ஐ verify செய்ய முடியவில்லை. கொடுத்த தகவலை மீண்டும் சரிபார்க்கவும்.' : 'I could not verify that order. Please check the details you entered.',
  };
  const trackText = lang === 'si' ? {
    method: 'Order එක verify කරන ක්‍රමය තෝරන්න:\n1 — Order ID + Full Phone Number\n2 — Full Phone Number + Customer Name එකේ වචනයක්\n3 — Order ID + Customer Name එකේ වචනයක් + Phone last 4 digits',
    askOrder: 'Order ID එක type කරන්න. උදා: WEB-000123',
    askFullPhone: 'මේ order එකට භාවිතා කළ සම්පූර්ණ Phone Number එක type කරන්න.',
    askPhoneForName: 'සම්පූර්ණ Phone Number එක type කරන්න.',
    askName: 'Order එකේ Customer Name එක type කරන්න. නමේ වචන කිහිපයක් තිබුණත් එක නිවැරදි වචනයක් ප්‍රමාණවත්.',
    askLast4: 'Phone Number එකේ අවසන් අංක 4 type කරන්න.',
    choose: '1, 2 හෝ 3 type කරන්න.',
  } : lang === 'ta' ? {
    method: 'Order verification முறையை தேர்ந்தெடுக்கவும்:\n1 — Order ID + Full Phone Number\n2 — Full Phone Number + Customer Name-இன் ஒரு பகுதி\n3 — Order ID + Customer Name-இன் ஒரு பகுதி + Phone last 4 digits',
    askOrder: 'Order ID-ஐ உள்ளிடவும். உதாரணம்: WEB-000123',
    askFullPhone: 'இந்த order-க்கு பயன்படுத்திய முழு Phone Number-ஐ உள்ளிடவும்.',
    askPhoneForName: 'முழு Phone Number-ஐ உள்ளிடவும்.',
    askName: 'Customer Name-ஐ உள்ளிடவும். பெயரில் உள்ள ஒரு சரியான பகுதி போதும்.',
    askLast4: 'Phone Number-ன் கடைசி 4 இலக்கங்களை உள்ளிடவும்.',
    choose: '1, 2 அல்லது 3 உள்ளிடவும்.',
  } : {
    method: 'Choose an order verification method:\n1 — Order ID + Full Phone Number\n2 — Full Phone Number + one part of Customer Name\n3 — Order ID + one part of Customer Name + last 4 phone digits',
    askOrder: 'Type the Order ID. Example: WEB-000123',
    askFullPhone: 'Type the FULL phone number used for this order.',
    askPhoneForName: 'Type the FULL phone number used for the order.',
    askName: 'Type the Customer Name. If the name has several words, one correct name part is enough.',
    askLast4: 'Type the LAST 4 digits of the phone number.',
    choose: 'Please type 1, 2 or 3.',
  };
  const bankDetailsReady = Boolean(settings.bank_details_saved && settings.bank_account_number && settings.bank_name && settings.bank_branch);

  useEffect(() => {
    const openAssistant = () => setOpen(true);
    window.addEventListener('ora:assistant-open', openAssistant as EventListener);
    return () => window.removeEventListener('ora:assistant-open', openAssistant as EventListener);
  }, []);

  // Re-open an unfinished human-support conversation after page refresh/close.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const restore = async () => {
      try {
        const response = await fetch(`/api/assistant/handoff/${encodeURIComponent(supportSessionId)}`);
        if (!response.ok) return;
        const data = await response.json();
        const chat = data?.chat;
        if (cancelled || !chat || chat.status === 'Resolved') return;
        const restoredLang: AssistantLanguage = chat.language === 'si' || chat.language === 'ta' ? chat.language : 'en';
        setAssistantLanguage((current) => current || restoredLang);
        const restoredMessages: ChatMessage[] = (Array.isArray(chat.messages) ? chat.messages : []).slice(-24).map((m:any) => ({
          id: String(m.id || uid()),
          role: m.role === 'agent' ? 'agent' : m.role === 'customer' ? 'user' : 'assistant',
          text: String(m.text || ''),
        }));
        for (const m of (Array.isArray(chat.messages) ? chat.messages : [])) if (m.role === 'agent') seenAgentMessageIds.current.add(String(m.id || ''));
        if (restoredMessages.length) setMessages(restoredMessages);
        setPendingOrderId(String(chat.order_number || ''));
        setFlow('agent-live');
      } catch {}
    };
    void restore();
    return () => { cancelled = true; };
  }, [open, supportSessionId]);

  const publicProducts = useMemo(() => products
    .filter((p) => p.status !== 'Draft' && !restrictedProductIntent(`${p.name_en} ${p.name_si} ${p.search_keywords || ''}`))
    .slice(0, 250), [products]);

  const addMessage = (role: ChatMessage['role'], text: string) => setMessages((prev) => [...prev.slice(-28), { id: uid(), role, text }]);

  const selectLanguage = (next: AssistantLanguage) => {
    setAssistantLanguage(next);
    setMessages([{ id: uid(), role: 'assistant', text: copy[next].welcome }]);
    setFlow('chat'); setPendingOrderId(''); setPendingPhoneLast4(''); setVerifiedOrder(null); setInput('');
  };
  const changeLanguage = () => { setAssistantLanguage(null); setMessages([]); setFlow('chat'); setPendingOrderId(''); setPendingPhoneLast4(''); setVerifiedOrder(null); setInput(''); };

  const paymentHelp = () => {
    const advance = Math.min(100, Math.max(1, Number(settings.advance_percentage ?? 50)));
    const threshold = Math.max(0, Number(settings.advance_qty_threshold ?? 4));
    if (lang === 'si') return bankDetailsReady
      ? `භාණ්ඩ ගණන ${threshold} දක්වා නම් COD හෝ Bank Transfer තෝරාගත හැක. මුළු quantity එක ${threshold}කට වැඩි නම් ${advance}% advance ගෙවීම අනිවාර්යයි. Bank Transfer තෝරන විට ගෙවිය යුතු නිවැරදි මුදල සහ Copy buttons පෙන්වයි.`
      : `භාණ්ඩ ගණන ${threshold} දක්වා නම් COD භාවිතා කළ හැක. මුළු quantity එක ${threshold}කට වැඩි නම් ${advance}% advance අවශ්‍යයි; Bank Transfer details publish කර නොමැති නම් එවැනි order එක checkout කළ නොහැක.`;
    if (lang === 'ta') return bankDetailsReady
      ? `${threshold} பொருட்கள் வரை COD அல்லது Bank Transfer தேர்வு செய்யலாம். மொத்த quantity ${threshold}-ஐ கடந்தால் ${advance}% advance கட்டாயம். Bank Transfer தேர்வு செய்தால் சரியான amount மற்றும் Copy buttons காட்டப்படும்.`
      : `${threshold} பொருட்கள் வரை COD பயன்படுத்தலாம். மொத்த quantity ${threshold}-ஐ கடந்தால் ${advance}% advance தேவை; Bank Transfer details publish செய்யப்படவில்லை என்றால் அந்த order checkout செய்ய முடியாது.`;
    return bankDetailsReady
      ? `Up to ${threshold} total items, you can use COD or Bank Transfer. Above ${threshold} items, a ${advance}% advance is required. Checkout shows the exact amount and Copy buttons.`
      : `Up to ${threshold} total items, COD is available. Above ${threshold} items, a ${advance}% advance is required; checkout is blocked until the store publishes Bank Transfer details.`;
  };

  const deliveryHelp = () => {
    const fee = Number(settings.delivery_fee || 0).toLocaleString();
    if (lang === 'si') return settings.free_delivery_enabled ? 'දැනට දිවයින පුරා Delivery FREE. Order ID එකෙන් delivery/dispatch status බලන්න පුළුවන්.' : `Delivery fee එක Rs. ${fee}. Order ID එකෙන් dispatch status track කරන්න පුළුවන්.`;
    if (lang === 'ta') return settings.free_delivery_enabled ? 'தற்போது நாடு முழுவதும் Delivery FREE. Order ID மூலம் delivery/dispatch status பார்க்கலாம்.' : `Delivery fee Rs. ${fee}. Order ID மூலம் dispatch status track செய்யலாம்.`;
    return settings.free_delivery_enabled ? 'Delivery is currently FREE islandwide. You can check delivery/dispatch status with your Order ID.' : `Delivery fee is Rs. ${fee}. You can track dispatch status with your Order ID.`;
  };

  const localIntentReply = (raw: string): string | null => {
    const text = raw.toLowerCase();
    if (restrictedProductIntent(text)) return t.restricted;
    if (hasAny(text, ['how to order','place order','order karanne','order krnne','ඇණවුම්','ஆர்டர் செய்வது','order எப்படி'])) return t.howToOrder;
    if (hasAny(text, ['delivery','shipping','courier','ඩිලිවරි','බෙදාහැර','டெலிவரி','விநியோகம்'])) return deliveryHelp();
    if (hasAny(text, ['return','refund','රිටන්','ආපසු','ரிட்டர்ன்','திரும்ப'])) return t.returns;
    if (hasAny(text, ['payment help','bank transfer','cod','advance rule','payment method','ගෙවීම්','கட்டணம்','பணம்'])) return paymentHelp();
    return null;
  };

  const lookupOrder = async (orderNumber: string, phoneLast4: string): Promise<VerifiedOrder> => {
    const response = await fetch('/api/assistant/order-status', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({orderNumber,phoneLast4}) });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data?.error || 'Order could not be verified.');
    return data.order as VerifiedOrder;
  };

  const paymentLine = (order: VerifiedOrder) => {
    if (order.payment_method === 'COD') {
      if (lang === 'si') return 'Cash on Delivery (COD) — පාර්සලය ලැබෙන විට ගෙවන්න';
      if (lang === 'ta') return 'Cash on Delivery (COD) — parcel கிடைக்கும் போது செலுத்தவும்';
      return 'Cash on Delivery (COD) — pay when the parcel arrives';
    }
    if (order.payment_verification_status === 'Approved') {
      if (order.payment_paid_type === 'Advance' || (order.is_advance_required && order.advance_confirmed)) {
        const pct = Math.round(Number(order.advance_percentage || settings.advance_percentage || 50));
        if (lang === 'si') return `${pct}% Advance Paid — ඉතිරි මුදල delivery වෙලාවේ`;
        if (lang === 'ta') return `${pct}% Advance Paid — மீதியை delivery போது செலுத்தவும்`;
        return `${pct}% Advance Paid — balance due on delivery`;
      }
      return lang === 'si' ? 'Bank Transfer — සම්පූර්ණ ගෙවීම තහවුරු කර ඇත' : lang === 'ta' ? 'Bank Transfer — Full Payment Approved' : 'Bank Transfer — Fully Paid';
    }
    if (order.receipt_received) return lang === 'si' ? 'Bank Transfer — receipt ලැබී ඇත, bank confirmation බලාපොරොත්තු වේ' : lang === 'ta' ? 'Bank Transfer — receipt received, bank confirmation pending' : 'Bank Transfer — receipt received, bank confirmation pending';
    return lang === 'si' ? 'Bank Transfer — payment receipt තවම ලැබී නැත' : lang === 'ta' ? 'Bank Transfer — payment receipt not received yet' : 'Bank Transfer — payment receipt not received yet';
  };

  const packingLine = (order: VerifiedOrder) => {
    if (!order.packing_pdf_downloaded) return '';
    if (lang === 'si') return '📦 පැකින්: ඔබගේ ඇණවුම පාර්සල් කිරීමට Packing Section එකට යවා ඇත.';
    if (lang === 'ta') return '📦 Packing: உங்கள் ஆர்டர் பார்சல் தயாரிப்பிற்காக Packing Section-க்கு அனுப்பப்பட்டுள்ளது.';
    return '📦 Packing: Your order has been sent to the Packing Section for parcel preparation.';
  };

  const presentOrder = (order: VerifiedOrder) => {
    const itemLines = (order.items || []).slice(0,5).map((x)=>`• ${x.name}${x.variant_name ? ` - ${x.variant_name}` : ''} [${x.sku || x.main_sku || '-'}] ×${x.quantity}`);
    const more = Math.max(0,(order.items || []).length-5);
    const fullAddress = [order.address, order.city].filter(Boolean).join(', ');
    const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString() : '';
    if (lang === 'si') return [
      `📦 Order ${order.order_number}`,
      order.customer_name ? `👤 Customer: ${order.customer_name}` : '',
      order.phone ? `📞 Phone: ${order.phone}` : '',
      fullAddress ? `📍 Address: ${fullAddress}` : '',
      orderDate ? `🗓️ Date: ${orderDate}` : '',
      `තත්ත්වය: ${translateStatus(order.status,lang)}`,
      `💵 ගෙවීම: ${paymentLine(order)}`,
      order.waybill_number ? `🚚 Delivery: ${translateStatus(order.delivery_status || 'Waybill Assigned',lang)}` : `🚚 Delivery: ${translateStatus(order.delivery_status || order.tracking_status || 'Pending',lang)}`,
      order.waybill_number ? `Waybill: ${order.waybill_number}` : '',
      packingLine(order),
      `සාමාන්‍ය එකතුව: Rs. ${Number(order.subtotal||0).toLocaleString()}`,
      Number(order.special_offer_discount||0)>0 ? `🏷️ Offer / Discount: -Rs. ${Number(order.special_offer_discount||0).toLocaleString()}` : `🏷️ Offer / Discount: Rs. 0`,
      `💰 අවසන් මුදල: Rs. ${Number(order.total_amount||0).toLocaleString()}`,
      itemLines.length ? `🛍️ භාණ්ඩ (${(order.items||[]).reduce((s,x)=>s+x.quantity,0)}):\n${itemLines.join('\n')}${more?`\n• තවත් ${more} භාණ්ඩ`:''}` : '',
    ].filter(Boolean).join('\n');
    if (lang === 'ta') return [
      `📦 Order ${order.order_number}`,
      order.customer_name ? `👤 Customer: ${order.customer_name}` : '',
      order.phone ? `📞 Phone: ${order.phone}` : '',
      fullAddress ? `📍 Address: ${fullAddress}` : '',
      orderDate ? `🗓️ Date: ${orderDate}` : '',
      `நிலை: ${translateStatus(order.status,lang)}`,
      `💵 Payment: ${paymentLine(order)}`,
      `🚚 Delivery: ${translateStatus(order.delivery_status || order.tracking_status || 'Pending',lang)}`,
      order.waybill_number ? `Waybill: ${order.waybill_number}` : '',
      packingLine(order),
      `Normal Total: Rs. ${Number(order.subtotal||0).toLocaleString()}`,
      `Offer / Discount: -Rs. ${Number(order.special_offer_discount||0).toLocaleString()}`,
      `💰 Final Amount: Rs. ${Number(order.total_amount||0).toLocaleString()}`,
      itemLines.length ? `🛍️ Items:\n${itemLines.join('\n')}${more?`\n• மேலும் ${more}`:''}` : '',
    ].filter(Boolean).join('\n');
    return [
      `📦 Order ${order.order_number}`,
      order.customer_name ? `👤 Customer: ${order.customer_name}` : '',
      order.phone ? `📞 Phone: ${order.phone}` : '',
      fullAddress ? `📍 Address: ${fullAddress}` : '',
      orderDate ? `🗓️ Date: ${orderDate}` : '',
      `Status: ${translateStatus(order.status,lang)}`,
      `💵 Payment: ${paymentLine(order)}`,
      `🚚 Delivery: ${translateStatus(order.delivery_status || order.tracking_status || 'Pending',lang)}`,
      order.waybill_number ? `Waybill: ${order.waybill_number}` : '',
      packingLine(order),
      `Normal Total: Rs. ${Number(order.subtotal||0).toLocaleString()}`,
      `Offer / Discount: -Rs. ${Number(order.special_offer_discount||0).toLocaleString()}`,
      `💰 Final Amount: Rs. ${Number(order.total_amount||0).toLocaleString()}`,
      itemLines.length ? `🛍️ Items:\n${itemLines.join('\n')}${more?`\n• ${more} more`:''}` : '',
    ].filter(Boolean).join('\n');
  };


  const lookupTrackedOrder = async (orderNumber:string, fullPhone:string) => {
    const response=await fetch('/api/assistant/track-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderNumber,phone:fullPhone})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error||secureTrackText.notVerified);
    return data.order as VerifiedOrder;
  };

  const lookupFlexibleOrder = async (payload: Record<string, unknown>) => {
    const response=await fetch('/api/assistant/track-order-flex',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error||secureTrackText.notVerified);
    return data as {order?:VerifiedOrder;orders?:VerifiedOrder[]};
  };

  const startTrack = () => {
    if(!assistantLanguage)return;
    setFlow('track-method');
    setPendingOrderId('');
    setPendingTrackPhone('');
    setPendingTrackName('');
    setVerifiedOrder(null);
    addMessage('assistant',trackText.method);
  };
  const startPayment = () => { if(!assistantLanguage)return; setFlow('payment-id');setPendingOrderId('');setPendingPhoneLast4('');setVerifiedOrder(null);addMessage('assistant',t.paymentAskId); };
  const startAgent = () => { if(!assistantLanguage)return; setFlow('agent-awaiting-message');addMessage('assistant',t.handoffAsk); };

  const sendAiMessage = async (text: string) => {
    const scored = publicProducts.map((p)=>({p,score:productSearchScore(p,text,categories)})).filter((x)=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,10).map(({p})=>({sku:p.sku,name:p.name_en,name_si:p.name_si,price:p.discount_enabled!==false&&p.discount_price&&p.discount_price<p.selling_price?p.discount_price:p.selling_price}));
    const response = await fetch('/api/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,language:lang,publicContext:{storeName:settings.brand_store_name||'O-RA',freeDelivery:Boolean(settings.free_delivery_enabled),deliveryFee:Number(settings.delivery_fee||0),advancePercentage:Number(settings.advance_percentage??50),advanceQtyThreshold:Number(settings.advance_qty_threshold??4),bankTransferAvailable:bankDetailsReady,matchedProducts:scored},history:messages.slice(-6).map((m)=>({role:m.role==='user'?'user':'assistant',text:m.text}))})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error||'Assistant unavailable.');
    return {reply:String(data.reply||''),needsAgent:Boolean(data.needsAgent)};
  };

  const submitHandoff = async (message: string) => {
    const response = await fetch('/api/assistant/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:supportSessionId,message,language:lang,orderNumber:pendingOrderId||undefined,history:messages.slice(-6).map((m)=>({role:m.role==='user'?'user':'assistant',text:m.text}))})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error||'Handoff failed.');
  };

  useEffect(()=>{
    if(flow!=='agent-live')return;
    let cancelled=false;
    const poll=async()=>{
      try{
        const response=await fetch(`/api/assistant/handoff/${encodeURIComponent(supportSessionId)}`);
        if(!response.ok)return;
        const data=await response.json();
        if(cancelled||!data?.chat)return;
        const publicMessages=Array.isArray(data.chat.messages)?data.chat.messages:[];
        for(const m of publicMessages){
          if(m.role==='agent'&&!seenAgentMessageIds.current.has(String(m.id))){
            seenAgentMessageIds.current.add(String(m.id));
            addMessage('agent',String(m.text||''));
          }
        }
        if(data.chat.status==='Resolved'){
          addMessage('assistant',t.resolved);
          setFlow('chat');
        }
      }catch{}
    };
    void poll();
    const timer=window.setInterval(()=>void poll(),8000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[flow,supportSessionId,lang]);

  const handleSend = async () => {
    if(!assistantLanguage)return;
    const text=input.trim();
    if(!text||busy)return;
    setInput(''); addMessage('user',text);

    if(flow==='agent-awaiting-message'){
      setBusy(true);
      try{await submitHandoff(text);addMessage('assistant',t.handoffSent);setFlow('agent-live');}
      catch{addMessage('assistant',t.aiUnavailable);setFlow('chat');}
      finally{setBusy(false);} return;
    }
    if(flow==='agent-live'){
      setBusy(true);
      try{
        const response=await fetch(`/api/assistant/handoff/${encodeURIComponent(supportSessionId)}/message`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});
        if(!response.ok)throw new Error();
      }catch{addMessage('assistant',t.aiUnavailable);}finally{setBusy(false);} return;
    }

    if(flow==='track-method'){
      const choice=text.replace(/\D/g,'').slice(0,1);
      if(choice==='1'){setFlow('track-a-order');addMessage('assistant',trackText.askOrder);return;}
      if(choice==='2'){setFlow('track-b-phone');addMessage('assistant',trackText.askPhoneForName);return;}
      if(choice==='3'){setFlow('track-c-order');addMessage('assistant',trackText.askOrder);return;}
      addMessage('assistant',trackText.choose);return;
    }
    if(flow==='track-a-order'){
      const orderId=text.trim().toUpperCase();
      if(orderId.length<4){addMessage('assistant',trackText.askOrder);return;}
      setPendingOrderId(orderId);setFlow('track-a-phone');addMessage('assistant',trackText.askFullPhone);return;
    }
    if(flow==='track-a-phone'){
      const phone=digits(text);
      if(phone.length<9){addMessage('assistant',trackText.askFullPhone);return;}
      setBusy(true);
      try{
        const result=await lookupFlexibleOrder({method:'order_phone',orderNumber:pendingOrderId,phone});
        if(!result.order)throw new Error(secureTrackText.notVerified);
        setVerifiedOrder(result.order);addMessage('assistant',presentOrder(result.order));
      }catch(e:any){addMessage('assistant',e?.message||secureTrackText.notVerified);}
      finally{setFlow('chat');setBusy(false);}return;
    }
    if(flow==='track-b-phone'){
      const phone=digits(text);
      if(phone.length<9){addMessage('assistant',trackText.askPhoneForName);return;}
      setPendingTrackPhone(phone);setFlow('track-b-name');addMessage('assistant',trackText.askName);return;
    }
    if(flow==='track-b-name'){
      const name=text.trim();
      if(name.length<2){addMessage('assistant',trackText.askName);return;}
      setBusy(true);
      try{
        const result=await lookupFlexibleOrder({method:'phone_name',phone:pendingTrackPhone,name});
        const rows=result.orders||[];
        if(!rows.length)throw new Error(secureTrackText.notVerified);
        setVerifiedOrder(rows[0]);
        addMessage('assistant',rows.map(presentOrder).join('\n\n──────────\n\n'));
      }catch(e:any){addMessage('assistant',e?.message||secureTrackText.notVerified);}
      finally{setFlow('chat');setBusy(false);}return;
    }
    if(flow==='track-c-order'){
      const orderId=text.trim().toUpperCase();
      if(orderId.length<4){addMessage('assistant',trackText.askOrder);return;}
      setPendingOrderId(orderId);setFlow('track-c-name');addMessage('assistant',trackText.askName);return;
    }
    if(flow==='track-c-name'){
      const name=text.trim();
      if(name.length<2){addMessage('assistant',trackText.askName);return;}
      setPendingTrackName(name);setFlow('track-c-last4');addMessage('assistant',trackText.askLast4);return;
    }
    if(flow==='track-c-last4'){
      const last4=digits(text).slice(-4);
      if(last4.length!==4){addMessage('assistant',trackText.askLast4);return;}
      setBusy(true);
      try{
        const result=await lookupFlexibleOrder({method:'order_name_last4',orderNumber:pendingOrderId,name:pendingTrackName,phoneLast4:last4});
        if(!result.order)throw new Error(secureTrackText.notVerified);
        setVerifiedOrder(result.order);addMessage('assistant',presentOrder(result.order));
      }catch(e:any){addMessage('assistant',e?.message||secureTrackText.notVerified);}
      finally{setFlow('chat');setBusy(false);}return;
    }
    if(flow==='payment-id'){
      setPendingOrderId(text.toUpperCase());setFlow('payment-phone');addMessage('assistant',t.phoneAsk);return;
    }
    if(flow==='payment-phone'){
      const last4=digits(text).slice(-4); if(last4.length!==4){addMessage('assistant',t.phoneInvalid);return;}
      setPendingPhoneLast4(last4);setBusy(true);
      try{
        const order=await lookupOrder(pendingOrderId,last4);setVerifiedOrder(order);
        if(order.payment_method==='COD'){addMessage('assistant',t.codNoReceipt);setFlow('chat');}
        else if(order.payment_verification_status==='Approved'){addMessage('assistant',t.paymentApproved);setFlow('chat');}
        else if(order.payment_verification_status==='Rejected'){
          addMessage('assistant',t.paymentRejected);
          if(!order.payment_eligible){addMessage('assistant',t.paymentNotEligible);setFlow('chat');}
          else{setFlow('payment-upload');addMessage('assistant',t.expectedPayment(Number(order.expected_payment_amount||0)));}
        }
        else if(order.receipt_received){addMessage('assistant',t.paymentAlreadyReceived);setFlow('chat');}
        else if(!order.payment_eligible){addMessage('assistant',t.paymentNotEligible);setFlow('chat');}
        else{setFlow('payment-upload');addMessage('assistant',t.expectedPayment(Number(order.expected_payment_amount||0)));}
      }catch{addMessage('assistant',t.orderNotVerified);setFlow('chat');}finally{setBusy(false);}return;
    }

    const lower=text.toLowerCase();
    if(hasAny(lower,['payment done','paid','i paid','salli gew','salli gewa','gewwa','ගෙව්වා','මුදල් ගෙව්','பணம் செலுத்தினேன்','செலுத்திவிட்டேன்','கட்டணம் செய்தேன்'])){startPayment();return;}
    if(hasAny(lower,['track order','order status','mage order','where is my order','ඇණවුම කොහෙද','ஆர்டர் நிலை','என் order'])){startTrack();return;}
    if(hasAny(lower,['agent','representative','human','niyojitha','නියෝජිත','මනුස්සයෙක්','பிரதிநிதி'])){startAgent();return;}
    const basic=localIntentReply(text);if(basic){addMessage('assistant',basic);return;}

    setBusy(true);
    try{
      const result=await sendAiMessage(text);
      if(result.needsAgent||!result.reply){addMessage('assistant',t.handoffAsk);setFlow('agent-awaiting-message');}
      else addMessage('assistant',result.reply);
    }catch{addMessage('assistant',t.handoffAsk);setFlow('agent-awaiting-message');}
    finally{setBusy(false);}
  };

  const handleReceipt = async (file?: File) => {
    if(!file||!verifiedOrder||!pendingOrderId||!pendingPhoneLast4||!assistantLanguage)return;
    setReceiptBusy(true);addMessage('user',t.receiptSelected(pendingOrderId));
    try{
      const expected=Number(verifiedOrder.expected_payment_amount||0);let analysis:any=null;let compressed:string;
      try{analysis=await analyzeReceiptLocally(file,settings.bank_account_number||'',expected);compressed=analysis.compressedDataUrl;}catch{compressed=await compressImageFile(file,1400,320_000);}
      const receiptUrl=await uploadPublicImage(compressed,'payment-receipt');
      const response=await fetch('/api/assistant/payment-proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderNumber:pendingOrderId,phoneLast4:pendingPhoneLast4,receiptUrl,analysis:analysis?{receiptLike:analysis.receiptLike,accountMatch:analysis.accountMatch,amountMatch:analysis.amountMatch,detectedAmount:analysis.detectedAmount,detectedReference:analysis.detectedReference,detectedBank:analysis.detectedBank,confidence:analysis.confidence,notes:analysis.notes}:null})});
      const data=await response.json().catch(()=>({})); if(!response.ok)throw new Error(data?.error||'Payment proof could not be submitted.');
      addMessage('assistant',t.proofSaved);setFlow('chat');setVerifiedOrder(null);setPendingOrderId('');setPendingPhoneLast4('');
    }catch(e:any){addMessage('assistant',e?.message||t.proofFailed);}finally{setReceiptBusy(false);if(fileRef.current)fileRef.current.value='';}
  };

  const assistantFont=assistantLanguage==='si'?{fontFamily:"'Noto Sans Sinhala', sans-serif"}:assistantLanguage==='ta'?{fontFamily:"'Noto Sans Tamil', sans-serif"}:undefined;

  return <>
    <button type="button" onClick={()=>setOpen(true)} className={`fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-3 text-xs font-black text-white shadow-2xl ring-1 ring-orange-500/30 transition hover:bg-orange-600 md:bottom-6 ${open?'hidden':''}`} aria-label="Open O-RA Assistant"><MessageCircle className="h-5 w-5"/>O-RA Assistant<span className="h-2 w-2 rounded-full bg-emerald-400"/></button>
    {open&&<div style={assistantFont} className="fixed inset-x-3 bottom-20 z-50 mx-auto flex h-[70vh] max-h-[680px] w-auto max-w-md flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-2xl md:inset-x-auto md:bottom-6 md:right-6 md:h-[620px] md:w-[390px]">
      <div className="flex items-center justify-between bg-neutral-950 px-4 py-3 text-white"><div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-neutral-950"><Bot className="h-5 w-5"/></div><div><div className="text-sm font-black">O-RA Assistant</div><div className="text-[10px] text-emerald-300">Online • {assistantLanguage?languageName[assistantLanguage]:'English / සිංහල / தமிழ்'}</div></div></div><div className="flex items-center gap-1">{assistantLanguage&&<button type="button" onClick={changeLanguage} title="Change language" className="rounded-full p-2 hover:bg-white/10"><Languages className="h-4 w-4"/></button>}<button type="button" onClick={()=>setOpen(false)} className="rounded-full p-2 hover:bg-white/10"><ChevronDown className="h-5 w-5"/></button></div></div>
      {!assistantLanguage?<div className="flex flex-1 flex-col justify-center bg-neutral-50 p-5"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-orange-600"><Languages className="h-7 w-7"/></div><h3 className="text-center text-base font-black text-neutral-900">Choose Language • භාෂාව තෝරන්න • மொழியைத் தேர்ந்தெடுக்கவும்</h3><p className="mx-auto mt-2 max-w-xs text-center text-xs leading-5 text-neutral-500">Select one language. All replies will stay in that language.</p><div className="mt-5 grid gap-3"><button onClick={()=>selectLanguage('si')} className="rounded-2xl border border-orange-200 bg-white px-4 py-4 text-left shadow-sm hover:bg-orange-50"><div className="text-sm font-black">සිංහල</div><div className="mt-1 text-[11px] text-neutral-500">සියලු පිළිතුරු සිංහලෙන්</div></button><button onClick={()=>selectLanguage('en')} className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-left shadow-sm hover:bg-orange-50"><div className="text-sm font-black">English</div><div className="mt-1 text-[11px] text-neutral-500">All replies in English</div></button><button onClick={()=>selectLanguage('ta')} className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-left shadow-sm hover:bg-orange-50"><div className="text-sm font-black">தமிழ்</div><div className="mt-1 text-[11px] text-neutral-500">அனைத்து பதில்களும் தமிழில்</div></button></div></div>:<>
        <div className="flex-1 space-y-3 overflow-y-auto bg-neutral-50 p-3">{messages.map((m)=><div key={m.id} className={`flex ${m.role==='user'?'justify-end':'justify-start'}`}><div className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3 py-2 text-xs leading-5 ${m.role==='user'?'bg-orange-500 font-semibold text-neutral-950':m.role==='agent'?'border border-sky-200 bg-sky-50 text-sky-950':'border border-neutral-200 bg-white text-neutral-700'}`}>{m.role==='agent'&&<div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase text-sky-600"><UserRound className="h-3 w-3"/>O-RA Representative</div>}{m.text}</div></div>)}{(busy||receiptBusy)&&<div className="flex items-center gap-2 text-[11px] text-neutral-500"><Loader2 className="h-4 w-4 animate-spin"/>{receiptBusy?t.checkingProof:flow==='agent-live'?t.agentTyping:t.typing}</div>}</div>
        <div className="border-t border-neutral-200 bg-white p-3">
          {flow==='payment-upload'&&<div className="mb-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center gap-2 text-xs font-black text-emerald-900"><ShieldCheck className="h-4 w-4"/>{t.paymentProofOnly}</div><p className="mt-1 text-[10px] leading-4 text-emerald-800">{t.paymentProofInfo}</p><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e)=>handleReceipt(e.target.files?.[0])}/><button type="button" disabled={receiptBusy} onClick={()=>fileRef.current?.click()} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><Upload className="h-4 w-4"/>{t.uploadReceipt}</button></div>}
          {flow==='chat'&&<div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 text-[10px] font-bold"><button onClick={startTrack} className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5">{t.trackOrder}</button><button onClick={startPayment} className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5">{t.paymentDone}</button><button onClick={()=>addMessage('assistant',paymentHelp())} className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5">{t.paymentHelpButton}</button><button onClick={()=>addMessage('assistant',deliveryHelp())} className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5">{t.deliveryButton}</button><button onClick={startAgent} className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-700">{t.agentButton}</button></div>}
          {flow==='track-method'&&<div className="mb-2 grid grid-cols-1 gap-1.5 text-[10px] font-bold sm:grid-cols-3"><button type="button" onClick={()=>{setFlow('track-a-order');addMessage('user','1');addMessage('assistant',trackText.askOrder);}} className="rounded-xl border border-neutral-200 px-2 py-2 text-left">1 • ID + Phone</button><button type="button" onClick={()=>{setFlow('track-b-phone');addMessage('user','2');addMessage('assistant',trackText.askPhoneForName);}} className="rounded-xl border border-neutral-200 px-2 py-2 text-left">2 • Phone + Name</button><button type="button" onClick={()=>{setFlow('track-c-order');addMessage('user','3');addMessage('assistant',trackText.askOrder);}} className="rounded-xl border border-neutral-200 px-2 py-2 text-left">3 • ID + Name + Last 4</button></div>}
          <div className="flex items-end gap-2"><textarea value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void handleSend();}}} rows={1} placeholder={t.placeholder} className="max-h-24 flex-1 resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-900 outline-none focus:border-orange-400"/><button type="button" onClick={()=>void handleSend()} disabled={busy||!input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-neutral-950 disabled:opacity-40"><Send className="h-4 w-4"/></button></div>
        </div>
      </>}
    </div>}
  </>;
};
