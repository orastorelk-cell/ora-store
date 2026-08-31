import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  Language,
  Product,
  Category,
  CartItem,
  Order,
  Customer,
  StockHistory,
  StoreSettings,
  OrderStatus,
  PaymentMethod,
  OrderSource,
  AdminUser,
  PurchaseOrder,
  WaybillRecord,
  PaymentVerificationStatus,
  BlockedCustomer,
  ActivityLog,
  FardarCity,
  FardarCityMapping,
  ReturnRecord,
  ProductVariant,
} from '../types';
import {
  initialCategories,
  initialProducts,
  initialOrders,
  initialSettings,
  initialStaffAccounts,
} from '../data/initialData';
import { syncOrderToGoogleSheets, syncOrdersBatchToGoogleSheets, syncProductCatalogToGoogleSheets, clearGoogleSheetTestData, clearGoogleSheetLiveStartData, deleteOrderFromGoogleSheets } from '../lib/googleSheets';
import { buildOrderItemSnapshot, displayUnitPrice, effectiveBuyingPrice, findProductSelection, normalizeProductForStorage, normalizedProductType, productDisplayStock, variantById, variantBySku, repriceAfterBuyingCostChange } from '../lib/productVariants';

export interface BulkOrderItemInput {
  order_id?: string;
  platform_lead_id?: string;
  lead_created_at?: string;
  variant_value?: string;
  is_confirmed?: boolean;
  item_code: string;
  quantity: number;
  customer_name: string;
  phone: string;
  whatsapp?: string;
  address: string;
  city: string;
  order_source?: OrderSource;
  payment_method?: PaymentMethod;
  notes?: string;
}

interface StoreContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  products: Product[];
  categories: Category[];
  cart: CartItem[];
  orders: Order[];
  customers: Customer[];
  stockHistory: StockHistory[];
  purchaseOrders: PurchaseOrder[];
  waybillRecords: WaybillRecord[];
  returnRecords: ReturnRecord[];
  findReturnOrderByWaybill: (waybill: string) => Order | null;
  confirmReturn: (input: {
    orderId: string;
    checkedBy?: string;
    items: { product_id: string; variant_id?: string; good_qty: number; damaged_qty: number }[];
    wrong_item_note?: string;
    notes?: string;
  }) => { success: boolean; message: string };
  fardarCities: FardarCity[];
  fardarCityMappings: FardarCityMapping[];
  refreshFardarCities: () => Promise<void>;
  importFardarCityList: (csvText: string) => Promise<{ importedCount: number }>;
  saveFardarCityMapping: (inputCity: string, fardarCity: string) => Promise<void>;
  resolveFardarCity: (inputCity: string) => { city?: string; source?: 'exact' | 'saved_mapping' };
  setOrderFardarCity: (orderId: string, fardarCity: string, saveMapping?: boolean) => Promise<void>;
  blockedCustomers: BlockedCustomer[];
  activityLogs: ActivityLog[];
  logActivity: (entry: { action: string; module: string; target_id?: string; target_label?: string; details?: string; actor?: AdminUser | null; actor_name?: string; actor_role?: ActivityLog['actor_role']; }) => void;
  blockCustomer: (phone: string, reason: string, createdBy?: string) => void;
  unblockCustomer: (id: string) => void;
  isCustomerBlocked: (phone: string, whatsapp?: string) => boolean;
  addPurchaseOrder: (poData: {
    supplier_name: string;
    product_id: string;
    variant_id?: string;
    quantity_added: number;
    unit_buying_price: number;
    invoice_ref?: string;
    bill_image_url?: string;
    notes?: string;
    performed_by?: string;
    po_number?: string;
  }) => void;
  settings: StoreSettings;
  /** True after the authoritative shared storefront state has finished its first load attempt. */
  sharedStoreReady: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategorySlug: string | null;
  setSelectedCategorySlug: (slug: string | null) => void;
  
  // UI Modal states
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  isCheckoutOpen: boolean;
  setIsCheckoutOpen: (open: boolean) => void;
  startBuyNow: (product: Product, quantity?: number, variantId?: string) => void;
  closeCheckoutAndRestoreCart: () => void;
  isTrackingOpen: boolean;
  setIsTrackingOpen: (open: boolean) => void;
  isBrandModalOpen: boolean;
  setIsBrandModalOpen: (open: boolean) => void;
  selectedProduct: Product | null;
  setSelectedProduct: (p: Product | null) => void;
  lastPlacedOrder: Order | null;
  setLastPlacedOrder: (order: Order | null) => void;
  isAdminView: boolean;
  setIsAdminView: (admin: boolean) => void;

  // Admin Auth & Roles
  adminUser: AdminUser | null;
  staffUsers: AdminUser[];
  loginAdmin: (user: AdminUser) => void;
  logoutAdmin: () => void;
  updateAdminPassword: (userId: string, newPass: string) => boolean;
  addStaffAccount: (account: Omit<AdminUser, 'id'>) => void;
  deleteStaffAccount: (userId: string) => void;
  updateStaffAccount: (userId: string, updates: Partial<AdminUser>) => void;
  resetSystemData: () => void;
  clearOperationalTestData: () => Promise<void>;
  fullLiveStartReset: () => Promise<void>;
  refreshOrdersFromServer: () => Promise<void>;

  // Cart operations
  addToCart: (product: Product, quantity?: number, variantId?: string) => void;
  removeFromCart: (lineIdOrProductId: string) => void;
  updateCartQuantity: (lineIdOrProductId: string, quantity: number) => void;
  clearCart: () => void;
  cartSubtotal: number;
  cartItemCount: number;
  cartSpecialOfferDiscount: number;
  cartMultiBuyDiscountRate: number;
  cartFinalProductsTotal: number;

  // Order operations
  placeOrder: (formData: {
    customer_name: string;
    phone: string;
    whatsapp: string;
    address: string;
    city: string;
    district?: string;
    payment_method: PaymentMethod;
    notes?: string;
    order_source?: OrderSource;
    bank_receipt_url?: string;
    payment_verification_status?: PaymentVerificationStatus;
    payment_detected_bank?: string;
    payment_detected_amount?: number;
    payment_reference?: string;
    payment_account_match?: boolean;
    payment_amount_match?: boolean;
    payment_receipt_like?: boolean;
    payment_ocr_confidence?: number;
    payment_check_notes?: string;
    gift_wrap_selected?: boolean;
    customer_access_token?: string;
  }) => Promise<Order>;
  importBulkOrders: (items: BulkOrderItemInput[]) => Promise<{
    importedCount: number;
    failedCount: number;
    errors: string[];
    importedOrderNumbers: string[];
    ignoredCount: number;
  }>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  updateOrderDeliveryDetails: (orderId: string, details: { address: string; city: string; district?: string }) => Promise<{ success: boolean; sheetSynced: boolean; message: string }>;
  updatePaymentStatus: (orderId: string, status: 'Pending' | 'Paid' | 'Refunded') => void;
  confirmAdvancePayment: (orderId: string) => void;
  reviewPayment: (orderId: string, decision: 'approve' | 'reject', reviewer?: string, receivedAmount?: number) => void;
  importWaybillCsv: (csvText: string, courierName?: string) => { importedCount: number; duplicateCount: number };
  importCallCenterResultsCsv: (csvText: string) => { updatedCount: number; notFoundCount: number; errors: string[] };
  importWebsiteConfirmedCsv: (csvText: string) => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };
  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource) => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };
  assignNextWaybill: (orderId: string, courierName?: string) => string | null;
  unassignWaybill: (orderId: string) => void;
  markInvoicesGenerated: (orderIds: string[], generatedBy?: string) => Order[];
  markInvoiceBatchDownloaded: (orderIds: string[], downloadedBy?: string, downloadSet?: { date: string; number: number }) => Promise<void>;
  scanDispatchBarcode: (barcode: string, scannedBy?: string) => Promise<{ success: boolean; message: string; order?: Order }>;
  recordCodPayments: (entries: { waybill: string; amount?: number; received_at?: string; reference?: string; source?: 'Fardar CSV' | 'Manual' | 'System' }[], recordedBy?: string) => Promise<{ updatedCount: number; notFound: string[] }>;
  syncOrderToSheet: (orderId: string) => Promise<boolean>;
  syncAllUnsyncedOrders: () => Promise<number>;
  createWebsiteTestOrder: (itemCount?: 1 | 5) => Promise<Order | null>;
  createSourceTestOrder: (source: 'Facebook Ads' | 'TikTok Ads') => Promise<Order | null>;
  deleteWebsiteTestOrders: () => Promise<number>;
  deleteSourceTestOrders: (source: 'Facebook Ads' | 'TikTok Ads') => Promise<number>;
  deleteOrder: (orderId: string, reason: string, deletedBy?: string) => Promise<{ success: boolean; message: string; sheetDeleted?: boolean }>;


  // Product CRUD
  addProduct: (productData: Omit<Product, 'id' | 'created_at'>) => Product;
  updateProduct: (product: Product) => void;
  deleteProduct: (productId: string) => void;
  adjustStock: (productId: string, quantityChange: number, reason: string, performedBy?: string, variantId?: string) => void;
  restoreProductBackup: (backup: unknown) => Promise<{ restoredProducts: number; restoredCategories: number }>;


  // Category CRUD
  addCategory: (category: Omit<Category, 'id'>) => Category;
  updateCategory: (category: Category) => void;
  deleteCategory: (categoryId: string) => void;

  // Settings
  updateSettings: (newSettings: Partial<StoreSettings>) => void;
}


const ALL_STAFF_PERMISSIONS = ['overview','add_product','combo_packs','supplier_offer','products','stock','orders','out_of_stock','returns','lead_import','confirm_upload','invoices','packing','invoice_design','delivery','dispatch','cod_payments','bank_transfer_check','assistant_chats','complaints','notifications','reports','reviews','product_requests','sheets','customers','categories','banners','activity','branding','website_info','settings','deploy','user_access'] as const;

const legacyPermissions = (role: string): any[] => {
  if (role === 'order_manager') return ['overview','orders','invoices','invoice_design','delivery','dispatch','customers','sheets'];
  if (role === 'stock_manager') return ['overview','products','stock','categories'];
  if (role === 'call_center' || role === 'staff') return ['orders','lead_import','confirm_upload','delivery','dispatch','customers','sheets'];
  if (role === 'viewer') return ['overview','orders','customers'];
  return ['orders'];
};

const normalizedPhoneForFingerprint = (value: string) => String(value || '').replace(/\D/g, '').replace(/^94(?=7\d{8}$)/, '0');
const makeOrderFingerprint = (phone: string, items: { product_id: string; variant_id?: string; quantity: number }[]) => {
  const itemPart = [...items].map((i) => `${i.product_id}:${i.variant_id || 'base'}:${i.quantity}`).sort().join('|');
  return `${normalizedPhoneForFingerprint(phone)}::${itemPart}`;
};

const deriveInvoicePaymentLabel = (order: Order, settings: StoreSettings) => {
  if (order.payment_method === 'COD') return 'COD';
  const paidAmount = Number(order.payment_received_amount || order.payment_detected_amount || 0);
  const total = Number(order.total_amount || 0);
  if (order.payment_paid_type === 'Full' || (paidAmount > 0 && total > 0 && paidAmount >= total * 0.98)) return 'FULLY PAID';
  if (order.payment_paid_type === 'Advance' || (order.is_advance_required && order.advance_confirmed)) {
    const pct = Math.min(100, Math.max(1, Number(settings.advance_percentage ?? 50)));
    return `${pct}% ADVANCE PAID`;
  }
  if (order.payment_status === 'Paid') return 'FULLY PAID';
  return 'BANK PAYMENT';
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const LEGACY_DEFAULT_CATEGORY_IDS = new Set(['cat-1','cat-2','cat-3','cat-4','cat-5','cat-6']);
const V9_SAMPLE_FLAG = 'ora_v9_kids_bottle_sample_added';

const nextDemoMainSku = (rows: Product[]) => {
  let max = 0;
  rows.forEach((p) => {
    const m = String(p.sku || '').trim().toUpperCase().match(/^S(\d{4})$/);
    if (m) max = Math.max(max, Number(m[1] || 0));
  });
  return `S${String(max + 1).padStart(4, '0')}`;
};

const buildKidsWaterBottleSample = (sku: string): Product => {
  const now = new Date().toISOString();
  const image = 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=800&q=80';
  return normalizeProductForStorage({
    id: 'prod-v9-kids-water-bottle-sample',
    sku,
    name_en: 'Kids Water Bottle',
    name_si: 'ළමා වතුර බෝතලය',
    description_en: 'Testing sample for one product with two colour variants and different prices. Remove before live use or clear with FULL LIVE START RESET.',
    description_si: 'වර්ණ දෙකක් සහ වෙනස් මිල දෙකක් සහිත variant product test එකක්.',
    category_id: 'auto-kids-items',
    category_slug: 'kids-items',
    images: [image],
    buying_price: 500,
    selling_price: 1500,
    discount_price: 1500,
    discount_enabled: false,
    stock_quantity: 20,
    status: 'Active',
    product_type: 'variant',
    variants: [
      { id:'v9-kids-bottle-blue', sku:`${sku}-BLUE`, option_name:'Color', option_value:'Blue', image, buying_price:500, selling_price:1500, stock_quantity:10, status:'Active' },
      { id:'v9-kids-bottle-pink', sku:`${sku}-PINK`, option_name:'Color', option_value:'Pink', image, buying_price:600, selling_price:1700, stock_quantity:10, status:'Active' },
    ],
    bundle_components: [],
    search_keywords: 'kids water bottle, kids bottle, children bottle, blue bottle, pink bottle, ළමා වතුර බෝතලය',
    is_test_product: true,
    created_at: now,
  } as Product);
};

const decodeStaffSessionExpiry = (token: string) => {
  try {
    const payload = String(token || '').split('.')[0] || '';
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const data = JSON.parse(window.atob(base64));
    return Number(data?.exp || 0);
  } catch {
    return 0;
  }
};
const getStaffSessionToken = () => {
  const token = localStorage.getItem('ora_staff_session_token') || '';
  if (!token) return '';
  const exp = decodeStaffSessionExpiry(token);
  if (!exp || exp <= Date.now() + 5_000) {
    localStorage.removeItem('ora_staff_session_token');
    return '';
  }
  return token;
};
const isLocalStorefrontHost = () => {
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};
const localStorefrontRequest = async (body: any) => {
  const response = await fetch('/api/storefront/local-state', {
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error || `Local shared storefront save failed (${response.status})`);
  return data;
};
const sharedStaffRequest = async (url: string, options: RequestInit = {}) => {
  const token = getStaffSessionToken();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error:any = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
};

const refreshStaffSessionToken = async () => {
  const token = getStaffSessionToken();
  if (!token) return '';
  const exp = decodeStaffSessionExpiry(token);
  // Existing staff sessions are 12 hours. Renew only in the final 6 hours so
  // active dashboards stay signed in without creating unnecessary requests.
  if (exp - Date.now() > 6 * 60 * 60 * 1000) return token;
  const response = await fetch('/api/staff/session/refresh', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error:any = new Error(data?.error || `Session refresh failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const nextToken = String(data?.token || '');
  if (!nextToken || !decodeStaffSessionExpiry(nextToken)) throw new Error('Server returned an invalid refreshed session.');
  localStorage.setItem('ora_staff_session_token', nextToken);
  return nextToken;
};

const publicOrderSave = async (order: Order, customerAccessToken?: string, deferSheetSync = false, waitForSheetSync = false): Promise<Order> => {
  const headers: Record<string,string> = {'Content-Type':'application/json'};
  if (customerAccessToken) headers.Authorization = `Bearer ${customerAccessToken}`;
  const response = await fetch('/api/orders', {
    method:'POST',
    headers,
    body:JSON.stringify({order,defer_sheet_sync:deferSheetSync,wait_sheet_sync:waitForSheetSync}),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error || `Order server save failed (${response.status})`);
  return (data?.order || order) as Order;
};

const staffBulkOrderSaveAndSheetSync = async (orders: Order[]): Promise<{orders:Order[];sheetSync:any}> => {
  const data=await sharedStaffRequest('/api/admin/orders/bulk-import',{
    method:'POST',
    body:JSON.stringify({orders}),
  });
  return {orders:Array.isArray(data?.orders)?data.orders:orders,sheetSync:data?.sheet_sync||null};
};


export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load state from localStorage or initial fallback
  const [language, setLanguage] = useState<Language>(() => {
    return (localStorage.getItem('ora_lang') as Language) || 'en';
  });

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('ora_products');
    let list: Product[] = [];
    // Existing Admin browser data is preserved for the one-time shared-store
    // migration. A brand-new customer browser starts empty instead of showing
    // seeded/demo products while the authoritative shared catalog is loading.
    try { list = saved ? JSON.parse(saved) : []; } catch { list = []; }
    // Keep the old sample migration only for browsers that already had a real
    // local catalog. Never seed a fresh customer browser with demo products.
    if (saved && localStorage.getItem(V9_SAMPLE_FLAG) !== '1' && !list.some((p:any) => p?.id === 'prod-v9-kids-water-bottle-sample')) {
      const sampleSku = nextDemoMainSku(list);
      list = [...list, buildKidsWaterBottleSample(sampleSku)];
      localStorage.setItem(V9_SAMPLE_FLAG, '1');
    }
    const used = new Set<string>();
    return list.map((raw, idx) => {
      const fallback = `S${String(idx + 1).padStart(4, '0')}`;
      let sku = String(raw?.sku || fallback).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (!sku) sku = fallback;
      while (used.has(sku)) sku = `${fallback}-${idx + 1}`;
      used.add(sku);
      return normalizeProductForStorage({ ...raw, sku } as Product);
    });
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem('ora_categories');
    let list: Category[] = [];
    try { list = saved ? JSON.parse(saved) : []; } catch { list = []; }
    // Remove only the six old seeded demo categories. User-created categories are preserved,
    // and the system can create unlimited new categories from product-name matching.
    return list.filter((c) => !LEGACY_DEFAULT_CATEGORY_IDS.has(String(c.id || '')));
  });

  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem('ora_cart');
    return saved ? JSON.parse(saved) : [];
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('ora_orders');
    const list: Order[] = saved ? JSON.parse(saved) : initialOrders;
    // Orders created before the stock-allocation update already had stock deducted.
    // Treat those legacy records as allocated so they are never deducted twice.
    return list.map((o: any) => ({
      ...o,
      stock_status: o.stock_status || 'Allocated',
      stock_allocated: o.stock_allocated !== undefined ? o.stock_allocated : true,
      dispatch_status: o.dispatch_status || 'Not Scanned',
      call_center_status: o.call_center_status || (['Processing','Packed','Shipped','Delivered'].includes(o.order_status) ? 'Confirmed' : o.order_status === 'Cancelled' ? 'Cancelled' : 'Pending'),
    }));
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ora_customers') || '[]');
      return (Array.isArray(saved) ? saved : []).filter((row:any) => !['cust-1','cust-2'].includes(String(row?.id || '')));
    } catch {
      return [];
    }
  });

  const [stockHistory, setStockHistory] = useState<StockHistory[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ora_stock_history') || '[]');
      return (Array.isArray(saved) ? saved : []).filter((row:any) => !['stk-1','stk-2'].includes(String(row?.id || '')));
    } catch {
      return [];
    }
  });

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ora_purchase_orders') || '[]');
      return (Array.isArray(saved) ? saved : []).filter((row:any) => !['po-1','po-2','po-3'].includes(String(row?.id || '')));
    } catch {
      return [];
    }
  });

  const [waybillRecords, setWaybillRecords] = useState<WaybillRecord[]>(() => {
    const saved = localStorage.getItem('ora_waybill_records');
    return saved ? JSON.parse(saved) : [];
  });
  const [returnRecords, setReturnRecords] = useState<ReturnRecord[]>(() => {
    const saved = localStorage.getItem('ora_return_records');
    return saved ? JSON.parse(saved) : [];
  });


  const [fardarCities, setFardarCities] = useState<FardarCity[]>([]);
  const [fardarCityMappings, setFardarCityMappings] = useState<FardarCityMapping[]>([]);

  const [blockedCustomers, setBlockedCustomers] = useState<BlockedCustomer[]>(() => {
    const saved = localStorage.getItem('ora_blocked_customers');
    return saved ? JSON.parse(saved) : [];
  });

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(() => {
    const saved = localStorage.getItem('ora_activity_logs');
    return saved ? JSON.parse(saved) : [];
  });

  const [settings, setSettings] = useState<StoreSettings>(() => {
    const saved = localStorage.getItem('ora_settings');
    if (!saved) return initialSettings;

    try {
      const parsed = JSON.parse(saved);
      const topAnnouncementEn = String(parsed.top_announcement_en ?? initialSettings.top_announcement_en ?? '')
        .replace(/Bank QR/gi, 'Bank Transfer')
        .replace(/QR Code/gi, 'Bank Transfer');
      const topAnnouncementSi = String(parsed.top_announcement_si ?? initialSettings.top_announcement_si ?? '')
        .replace(/බැංකු\s*QR\s*ගෙවීම්/g, 'බැංකු හුවමාරු ගෙවීම්')
        .replace(/QR\s*ගෙවීම්/g, 'බැංකු හුවමාරු ගෙවීම්');

      return {
        ...initialSettings,
        ...parsed,
        top_announcement_en: topAnnouncementEn,
        top_announcement_si: topAnnouncementSi,
        // Existing installs did not have an explicit publish/save flag.
        // Keep bank details private until Main Admin presses "Save & Publish Bank Details".
        bank_details_saved: parsed.bank_details_saved === true,
      };
    } catch {
      return initialSettings;
    }
  });

  // Load shared settings from the server so ALL visitors see admin changes
useEffect(() => {
  fetch(`/api/storefront/state?fresh=${Date.now()}`, { cache:'no-store' })
    .then((r) => r.json())
    .then((data) => {
      const serverSettings = data && data.state && data.state.settings;
      if (serverSettings && typeof serverSettings === 'object') {
        setSettings((prev) => ({ ...prev, ...serverSettings }));
        try { localStorage.setItem('ora_settings', JSON.stringify({ ...initialSettings, ...serverSettings })); } catch (e) {}
      }
    })
    .catch(() => {});
}, []);


  // Admin User & Staff Accounts
  const [adminUser, setAdminUser] = useState<AdminUser | null>(() => {
    const saved = localStorage.getItem('ora_admin_user');
    if (!saved) return null;
    if (!isLocalStorefrontHost() && !getStaffSessionToken()) {
      // Do not trust a remembered admin profile after its real server session
      // has expired. Otherwise product edits look saved in this Chrome only.
      localStorage.removeItem('ora_admin_user');
      return null;
    }
    try {
      const parsed = JSON.parse(saved);
      const { password: _legacyPassword, ...safeParsed } = parsed || {};
      const isAdmin = safeParsed.role === 'admin';
      return { ...safeParsed, role: isAdmin ? 'admin' : 'staff', permissions: isAdmin ? undefined : (safeParsed.permissions || legacyPermissions(safeParsed.role)), is_active: safeParsed.is_active !== false };
    } catch {
      localStorage.removeItem('ora_admin_user');
      return null;
    }
  });

  const [staffUsers, setStaffUsers] = useState<AdminUser[]>(() => {
    const saved = localStorage.getItem('ora_staff_accounts');
    const list = saved ? JSON.parse(saved) : initialStaffAccounts;
    return list.map((u: any) => {
      const { password: _legacyPassword, ...safeUser } = u || {};
      const isAdmin = safeUser.role === 'admin';
      return { ...safeUser, role: isAdmin ? 'admin' : 'staff', permissions: isAdmin ? undefined : (safeUser.permissions || legacyPermissions(safeUser.role)), is_active: safeUser.is_active !== false };
    });
  });

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategorySlug, setSelectedCategorySlug] = useState<string | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [buyNowCartBackup, setBuyNowCartBackup] = useState<CartItem[] | null>(null);
  const [isTrackingOpen, setIsTrackingOpen] = useState(false);
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [lastPlacedOrder, setLastPlacedOrder] = useState<Order | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [sharedStoreReady, setSharedStoreReady] = useState(false);
  const sharedStoreVersionRef = useRef(0);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('ora_lang', language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem('ora_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('ora_categories', JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    localStorage.setItem('ora_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    try {
      const compact = orders.map(o => ({
        ...o,
        items:(o.items||[]).map(it=>({...it,image:undefined})),
        bank_receipt_url:String(o.bank_receipt_url||'').startsWith('data:') ? undefined : o.bank_receipt_url,
      }));
      localStorage.setItem('ora_orders', JSON.stringify(compact));
    } catch (e) {
      console.warn('Local order cache could not be written. Server order store remains authoritative.', e);
    }
  }, [orders]);

  useEffect(() => {
    localStorage.setItem('ora_customers', JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    localStorage.setItem('ora_stock_history', JSON.stringify(stockHistory));
  }, [stockHistory]);

  useEffect(() => {
    localStorage.setItem('ora_purchase_orders', JSON.stringify(purchaseOrders));
  }, [purchaseOrders]);

  useEffect(() => {
    localStorage.setItem('ora_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!settings.favicon_logo) return;
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = settings.favicon_logo;
  }, [settings.favicon_logo]);

  useEffect(() => {
    localStorage.setItem('ora_waybill_records', JSON.stringify(waybillRecords));
  }, [waybillRecords]);

  useEffect(() => {
    localStorage.setItem('ora_return_records', JSON.stringify(returnRecords));
  }, [returnRecords]);

  useEffect(() => {
    localStorage.setItem('ora_blocked_customers', JSON.stringify(blockedCustomers));
  }, [blockedCustomers]);

  useEffect(() => {
    localStorage.setItem('ora_activity_logs', JSON.stringify(activityLogs.slice(0, 5000)));
  }, [activityLogs]);

  useEffect(() => {
    if (adminUser) {
      const { password: _legacyPassword, ...safeAdminUser } = adminUser as any;
      localStorage.setItem('ora_admin_user', JSON.stringify(safeAdminUser));
    } else {
      localStorage.removeItem('ora_admin_user');
    }
  }, [adminUser]);

  useEffect(() => {
    const safeUsers = staffUsers.map((user:any) => { const { password: _legacyPassword, ...safeUser } = user || {}; return safeUser; });
    localStorage.setItem('ora_staff_accounts', JSON.stringify(safeUsers));
  }, [staffUsers]);

  // Rolling Admin/Staff session refresh. Customer storefront/order APIs do not use
  // this token, so this keep-alive is isolated to authenticated staff activity.
  useEffect(() => {
    if (!adminUser || isLocalStorefrontHost()) return;
    let cancelled = false;
    const keepSessionAlive = async () => {
      try {
        await refreshStaffSessionToken();
      } catch (err:any) {
        if (Number(err?.status || 0) !== 401 || cancelled) return;
        localStorage.removeItem('ora_staff_session_token');
        localStorage.removeItem('ora_admin_user');
        setAdminUser(null);
      }
    };
    keepSessionAlive();
    const timer = window.setInterval(keepSessionAlive, 15 * 60 * 1000);
    const onFocus = () => { keepSessionAlive(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') keepSessionAlive(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [adminUser?.id]);


  // ---------------------------------------------------------------------------
  // Shared storefront catalog.
  // The server/Supabase copy is authoritative across Chrome profiles, phones and
  // the live domain. localStorage remains only a fast cache for the current browser.
  // ---------------------------------------------------------------------------
  const applySharedStorefrontState = (state: any, includePrivateSettings: boolean) => {
    if (!state || typeof state !== 'object') return;
    if (Array.isArray(state.products)) {
      const used = new Set<string>();
      const normalized = state.products.map((raw:any, idx:number) => {
        const fallback = `S${String(idx + 1).padStart(4, '0')}`;
        let sku = String(raw?.sku || fallback).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
        if (!sku) sku = fallback;
        while (used.has(sku)) sku = `${fallback}-${idx + 1}`;
        used.add(sku);
        return normalizeProductForStorage({ ...raw, sku } as Product);
      });
      setProducts(normalized);
    }
    if (Array.isArray(state.categories)) setCategories(state.categories as Category[]);
    if (state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings)) {
      setSettings((prev) => ({ ...prev, ...state.settings } as StoreSettings));
    }
    sharedStoreVersionRef.current = Math.max(sharedStoreVersionRef.current, Number(state.version || 0));
  };

  useEffect(() => {
    let cancelled = false;
    const loadSharedStore = async () => {
      try {
        const hasStaffSession = Boolean(adminUser && getStaffSessionToken());
        let data:any;
        if (hasStaffSession) {
          data = await sharedStaffRequest('/api/admin/storefront/state');
        } else {
          const response = await fetch(`/api/storefront/state?fresh=${Date.now()}`, { cache:'no-store' });
          data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || `Shared storefront load failed (${response.status})`);
        }
        if (cancelled) return;

        if (data?.initialized && data?.state) {
          applySharedStorefrontState(data.state, hasStaffSession);
        } else if (adminUser?.role === 'admin') {
          // One-time migration: the current Super Admin browser owns the existing
          // catalog. Authenticated live installs publish through the private API.
          // Older localhost installs may have a legacy Admin session without a
          // server token, so use the loopback-only bridge to preserve the real
          // local products/logo/settings and make them visible to every Chrome.
          const saved = hasStaffSession
            ? await sharedStaffRequest('/api/admin/storefront/state', {
                method:'PUT',
                body:JSON.stringify({ products, categories, settings }),
              })
            : isLocalStorefrontHost()
              ? await localStorefrontRequest({ products, categories, settings })
              : null;
          if (saved) sharedStoreVersionRef.current = Math.max(sharedStoreVersionRef.current, Number(saved?.version || 1));
        }
      } catch (err:any) {
        if (Number(err?.status || 0) === 401 && adminUser && !isLocalStorefrontHost()) {
          localStorage.removeItem('ora_staff_session_token');
          localStorage.removeItem('ora_admin_user');
          if (!cancelled) setAdminUser(null);
          console.warn('Admin session expired. Login again before editing the shared storefront.');
        } else {
          console.warn('Shared storefront load failed; using this browser cache temporarily:', err?.message || err);
        }
      } finally {
        if (!cancelled) setSharedStoreReady(true);
      }
    };
    loadSharedStore();
    return () => { cancelled = true; };
    // Deliberately reload when the staff identity changes. The current local catalog
    // is used only for the one-time Super Admin migration when the server is empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminUser?.id]);

  // Publish catalog/category/store-setting edits from authenticated staff only.
  // Debouncing collapses rapid product/stock edits into one shared write.
  useEffect(() => {
    if (!sharedStoreReady || !adminUser) return;
    const hasStaffSession = Boolean(getStaffSessionToken());
    if (!hasStaffSession && !isLocalStorefrontHost()) {
      localStorage.removeItem('ora_admin_user');
      setAdminUser(null);
      window.alert('Admin session expired. Please login again before saving products. Unsynced changes are not live on other devices.');
      return;
    }
    const timer = window.setTimeout(() => {
      const publish = hasStaffSession
        ? sharedStaffRequest('/api/admin/storefront/state', {
            method:'PUT',
            body:JSON.stringify({ products, categories, settings }),
          })
        : localStorefrontRequest({ products, categories, settings });
      publish.then((data) => {
        sharedStoreVersionRef.current = Math.max(sharedStoreVersionRef.current, Number(data?.version || 0));
      }).catch((err:any) => {
        if (Number(err?.status || 0) === 401 && !isLocalStorefrontHost()) {
          localStorage.removeItem('ora_staff_session_token');
          localStorage.removeItem('ora_admin_user');
          setAdminUser(null);
          window.alert('Admin session expired. Please login again, then save the product again so it publishes to all devices.');
          return;
        }
        // One automatic retry covers short network/server hiccups. Never leave an
        // Admin believing a product is live when only this browser cache changed.
        window.setTimeout(() => {
          const retry = getStaffSessionToken()
            ? sharedStaffRequest('/api/admin/storefront/state', {
                method:'PUT',
                body:JSON.stringify({ products, categories, settings }),
              })
            : Promise.reject(new Error('Admin session is no longer active.'));
          retry.then((data) => {
            sharedStoreVersionRef.current = Math.max(sharedStoreVersionRef.current, Number(data?.version || 0));
          }).catch((retryErr:any) => {
            console.warn('Shared storefront publish failed after retry:', retryErr?.message || retryErr);
            window.alert('Website sync failed. This change may be visible only in this browser. Please login again and save once more.');
          });
        }, 1500);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [products, categories, settings, sharedStoreReady, adminUser?.id]);

  // Public storefront freshness:
  // Facebook/Instagram in-app browsers can restore an old page from memory/BFCache
  // without remounting React. Re-read the authoritative shared catalog whenever
  // the page is shown again or becomes visible, as well as on focus/interval.
  useEffect(() => {
    if (adminUser && getStaffSessionToken()) return;
    let cancelled = false;
    const refreshPublicStore = async () => {
      try {
        const response = await fetch(`/api/storefront/state?fresh=${Date.now()}`, { cache:'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled || !data?.initialized || !data?.state) return;
        const version = Number(data.state.version || 0);
        if (version && version <= sharedStoreVersionRef.current) return;
        applySharedStorefrontState(data.state, false);
      } catch {}
    };
    const onPageShow = () => { void refreshPublicStore(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void refreshPublicStore(); };
    const timer = window.setInterval(refreshPublicStore, isLocalStorefrontHost() ? 5_000 : 30_000);
    window.addEventListener('focus', refreshPublicStore);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshPublicStore);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminUser?.id]);

  // Super Admin account list comes from the shared server store. In local development
  // the Express server uses one JSON file shared by every browser. When Supabase
  // service-role configuration is present, the same API stores users in Supabase.
  useEffect(() => {
    if (adminUser?.role !== 'admin' || !getStaffSessionToken()) return;
    let cancelled = false;
    sharedStaffRequest('/api/staff/accounts')
      .then((data) => {
        if (!cancelled && Array.isArray(data?.users)) {
          setStaffUsers(data.users.map((u: any) => ({ ...u, role: u.role === 'admin' ? 'admin' : 'staff' })));
        }
      })
      .catch((err) => console.warn('Shared staff refresh failed:', err?.message || err));
    return () => { cancelled = true; };
  }, [adminUser?.id, adminUser?.role]);

  const refreshOrdersFromServer = async () => {
    if (!adminUser || !getStaffSessionToken()) return;
    const data = await sharedStaffRequest('/api/orders');
    const serverOrders: Order[] = Array.isArray(data?.orders) ? data.orders : [];
    const sortedServerOrders = [...serverOrders].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());

    // Customer DB is derived from the same durable order snapshots for every
    // authenticated Admin/Staff browser. Local browser demo data is never authoritative.
    const phoneKey = (value: unknown) => {
      let digits = String(value || '').replace(/\D/g, '');
      if (digits.startsWith('94') && digits.length === 11) digits = '0' + digits.slice(2);
      return digits;
    };
    const customerMap = new Map<string, Customer>();
    [...sortedServerOrders]
      .filter((order:any) =>
        !order?.is_test_order &&
        !/^(WEB-TEST-|TEST-FB-|TEST-TK-|ORA-DIAG-)/i.test(String(order?.order_number || ''))
      )
      .sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime())
      .forEach((order) => {
        const key = phoneKey(order.phone);
        if (!key) return;
        const previous = customerMap.get(key);
        if (previous) {
          customerMap.set(key, {
            ...previous,
            name: String(order.customer_name || previous.name),
            phone: String(order.phone || previous.phone),
            whatsapp: String(order.whatsapp || order.phone || previous.whatsapp || ''),
            address: String(order.address || previous.address || ''),
            city: String(order.city || previous.city || ''),
            total_orders: Number(previous.total_orders || 0) + 1,
            total_spent: Number(previous.total_spent || 0) + Number(order.total_amount || 0),
          });
          return;
        }
        customerMap.set(key, {
          id: 'cust-order-' + key,
          name: String(order.customer_name || 'Customer'),
          phone: String(order.phone || ''),
          whatsapp: String(order.whatsapp || order.phone || ''),
          address: String(order.address || ''),
          city: String(order.city || ''),
          total_orders: 1,
          total_spent: Number(order.total_amount || 0),
          created_at: String(order.created_at || new Date().toISOString()),
        });
      });
    const serverCustomers = Array.from(customerMap.values())
      .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());

    setOrders(sortedServerOrders);
    setCustomers(serverCustomers);
    try {
      localStorage.setItem('ora_orders', JSON.stringify(sortedServerOrders));
      localStorage.setItem('ora_customers', JSON.stringify(serverCustomers));
    } catch {}
  };

  // Server is the authoritative order mirror. On Admin login, replace the browser
  // order cache with the durable server list instead of merging stale local orders back.
  useEffect(() => {
    if (!adminUser || !getStaffSessionToken()) return;
    refreshOrdersFromServer().catch(err=>console.warn('Order server refresh failed:',err?.message||err));
  }, [adminUser?.id]);


  // Keep admin payment/order queues reasonably fresh while an admin page is open.
  // 90 seconds avoids aggressive polling on free-tier storage/API usage.
  useEffect(() => {
    if (!adminUser || !getStaffSessionToken()) return;
    const timer = window.setInterval(() => {
      refreshOrdersFromServer().catch(err=>console.warn('Background order refresh failed:',err?.message||err));
    }, 90_000);
    return () => window.clearInterval(timer);
  }, [adminUser?.id]);

  // Keep a visible Call Center product catalog current. Debounced to avoid spamming
  // Apps Script during rapid edits.
  useEffect(() => {
    if (!adminUser || !settings.google_sheet_webhook_url) return;
    const timer=window.setTimeout(()=>{
      syncProductCatalogToGoogleSheets(products,settings.google_sheet_webhook_url,settings)
        .catch(()=>undefined);
    },800);
    return ()=>window.clearTimeout(timer);
  }, [products, settings.google_sheet_webhook_url, settings.free_delivery_enabled, settings.delivery_fee, settings.multi_buy_discount_enabled, settings.multi_buy_tier1_min, settings.multi_buy_tier1_max, settings.multi_buy_tier1_rate, settings.multi_buy_tier2_min, settings.multi_buy_tier2_max, settings.multi_buy_tier2_rate, settings.multi_buy_tier3_min, settings.multi_buy_tier3_max, settings.multi_buy_tier3_rate, adminUser?.id]);

  const mirrorOrderUpdate = (order: Order) => {
    if (!getStaffSessionToken()) return;
    sharedStaffRequest(`/api/orders/${encodeURIComponent(order.id)}`, {
      method:'PUT',
      body:JSON.stringify({order}),
    }).catch(err=>console.warn('Order mirror update failed:',err?.message||err));
  };

  const logActivity = (entry: { action: string; module: string; target_id?: string; target_label?: string; details?: string; actor?: AdminUser | null; actor_name?: string; actor_role?: ActivityLog['actor_role']; }) => {
    const actor = entry.actor === undefined ? adminUser : entry.actor;
    const log: ActivityLog = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actor_id: actor?.id,
      actor_name: entry.actor_name || actor?.name || 'System',
      actor_username: actor?.username,
      actor_role: entry.actor_role || actor?.role || 'system',
      action: entry.action,
      module: entry.module,
      target_id: entry.target_id,
      target_label: entry.target_label,
      details: entry.details,
      created_at: new Date().toISOString(),
    };
    setActivityLogs((prev) => [log, ...prev].slice(0, 5000));
  };

  // Admin Auth Handlers
  const loginAdmin = (user: AdminUser) => {
    const sessionToken = String((user as any)._sessionToken || '');
    if (sessionToken) localStorage.setItem('ora_staff_session_token', sessionToken);
    const cleanUser = { ...user } as any;
    delete cleanUser._sessionToken;
    setAdminUser(cleanUser);
    logActivity({ action: 'Login', module: 'Authentication', actor: cleanUser, target_id: cleanUser.id, target_label: cleanUser.name });
  };

  const logoutAdmin = () => {
    if (adminUser) logActivity({ action: 'Logout', module: 'Authentication', actor: adminUser, target_id: adminUser.id, target_label: adminUser.name });
    localStorage.removeItem('ora_staff_session_token');
    setAdminUser(null);
    window.history.replaceState({}, '', '/system');
    setIsAdminView(true);
  };

  const updateAdminPassword = (userId: string, newPass: string): boolean => {
    if (adminUser?.role === 'admin') {
      sharedStaffRequest(`/api/staff/accounts/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ password: newPass }) })
        .catch((err) => alert(`Shared password update failed: ${err.message}`));
    }
    logActivity({ action: 'Password Changed', module: 'User Access', target_id: userId, target_label: staffUsers.find((u) => u.id === userId)?.name || userId });
    return true;
  };

  const addStaffAccount = (accountData: Omit<AdminUser, 'id'>) => {
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newUser: AdminUser = {
      ...accountData,
      username: accountData.username.trim().toLowerCase(),
      password: accountData.password?.trim(),
      name: accountData.name.trim(),
      email: accountData.email?.trim() || '',
      role: accountData.role === 'admin' ? 'admin' : 'staff',
      permissions: accountData.role === 'admin' ? undefined : (accountData.permissions || []),
      is_active: accountData.is_active !== false,
      id: tempId,
      created_at: new Date().toISOString(),
    };
    setStaffUsers((prev) => [...prev, newUser]);

    sharedStaffRequest('/api/staff/accounts', {
      method: 'POST',
      body: JSON.stringify({
        username: newUser.username, password: newUser.password, name: newUser.name, email: newUser.email,
        role: newUser.role, permissions: newUser.permissions || [], is_active: newUser.is_active !== false,
      }),
    }).then((data) => {
      if (!data?.user) return;
      setStaffUsers((prev) => prev.map((u) => u.id === tempId ? data.user : u));
    }).catch((err) => {
      setStaffUsers((prev) => prev.filter((u) => u.id !== tempId));
      alert(`Staff account was not created: ${err.message}`);
    });
    logActivity({ action: 'Staff Account Created', module: 'User Access', target_id: tempId, target_label: newUser.name, details: `Role: ${newUser.role}` });
  };

  const deleteStaffAccount = (userId: string) => {
    const target = staffUsers.find((u) => u.id === userId);
    const previous = staffUsers;
    setStaffUsers((prev) => prev.filter((u) => u.id !== userId));
    sharedStaffRequest(`/api/staff/accounts/${encodeURIComponent(userId)}`, { method: 'DELETE' })
      .catch((err) => { setStaffUsers(previous); alert(`Shared account delete failed: ${err.message}`); });
    logActivity({ action: 'Staff Account Deleted', module: 'User Access', target_id: userId, target_label: target?.name || userId });
  };

  const updateStaffAccount = (userId: string, updates: Partial<AdminUser>) => {
    const target = staffUsers.find((u) => u.id === userId);
    const cleanUpdates: Partial<AdminUser> = { ...updates };
    if (cleanUpdates.username !== undefined) cleanUpdates.username = cleanUpdates.username.trim().toLowerCase();
    setStaffUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...cleanUpdates } : u)));
    if (adminUser?.id === userId) setAdminUser((prev) => (prev ? { ...prev, ...cleanUpdates } : null));
    sharedStaffRequest(`/api/staff/accounts/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(cleanUpdates) })
      .then((data) => {
        if (data?.user) setStaffUsers((prev) => prev.map((u) => u.id === userId ? data.user : u));
      })
      .catch((err) => alert(`Shared account update failed: ${err.message}`));
    logActivity({ action: 'Staff Account Updated', module: 'User Access', target_id: userId, target_label: target?.name || userId, details: Object.keys(cleanUpdates).join(', ') });
  };

  // SAFE RESET MODES
  const clearOperationalTestData = async () => {
    if (!adminUser || adminUser.role !== 'admin') throw new Error('Super Admin login required.');

    const sheetWebhookForClear = settings.google_sheet_webhook_url;

    const result = await sharedStaffRequest('/api/operational-test-data', { method:'DELETE' });
    if (!result?.ok) throw new Error('Server did not confirm the clear operation.');

    setOrders([]);
    setCustomers([]);
    setStockHistory([]);
    setPurchaseOrders([]);
    setWaybillRecords([]);
    setReturnRecords([]);
    setActivityLogs([]);
    setCart([]);
    setLastPlacedOrder(null);
    [
      'ora_orders','ora_customers','ora_stock_history','ora_purchase_orders',
      'ora_waybill_records','ora_return_records','ora_activity_logs','ora_cart'
    ].forEach((key)=>localStorage.setItem(key,'[]'));
    localStorage.removeItem('ora_admin_last_seen_order_at');

    const verify=await sharedStaffRequest('/api/orders');
    const remaining:Order[]=Array.isArray(verify?.orders)?verify.orders:[];
    setOrders(remaining);
    if(remaining.length>0) throw new Error(`Clear failed: ${remaining.length} order(s) still remain on the server.`);
    if (sheetWebhookForClear) {
      flushPendingOrderSheetSyncs();
      enqueueSheetTask('operational clear', async () => {
        const sheetResult = await clearGoogleSheetTestData(sheetWebhookForClear);
        if (!sheetResult.success) throw new Error(sheetResult.message);
      });
    }
  };

  // One-time/live-start reset: removes demo/business data but keeps login, staff accounts,
  // Google Sheet URL, API connection settings, branding/settings and the sheet connection itself.
  const fullLiveStartReset = async () => {
    if (!adminUser || adminUser.role !== 'admin') throw new Error('Super Admin login required.');

    if(settings.google_sheet_webhook_url){
      flushPendingOrderSheetSyncs();
      await sheetTaskChainRef.current;
      const sheetResult=await clearGoogleSheetLiveStartData(settings.google_sheet_webhook_url);
      if(!sheetResult.success) throw new Error(`Google Sheet was not cleared, so the system reset was stopped: ${sheetResult.message}`);
    }

    const result = await sharedStaffRequest('/api/live-start-reset', { method:'DELETE' });
    if (!result?.ok) throw new Error('Server did not confirm FULL LIVE START RESET.');

    setProducts([]);
    setCategories([]);
    setOrders([]);
    setCustomers([]);
    setStockHistory([]);
    setPurchaseOrders([]);
    setWaybillRecords([]);
    setReturnRecords([]);
    setBlockedCustomers([]);
    setActivityLogs([]);
    setCart([]);
    setLastPlacedOrder(null);
    setSelectedProduct(null);

    // Clean demo/public business details for the real-store start, while preserving
    // technical connections, login access, branding and invoice design settings.
    setSettings((prev) => ({
      ...prev,
      bank_name: '', bank_account_holder: '', bank_account_number: '', bank_branch: '', bank_details_saved: false,
      whatsapp_number: '', hotline_number: '', company_email: '', company_address: '', top_banner_phone: '',
      business_registration_enabled: false, business_registration_name: '', business_registration_number: '', business_registration_copy_url: '',
    }));

    const emptyKeys = [
      'ora_products','ora_categories','ora_orders','ora_customers','ora_stock_history',
      'ora_purchase_orders','ora_waybill_records','ora_return_records','ora_blocked_customers',
      'ora_activity_logs','ora_cart'
    ];
    emptyKeys.forEach((key)=>localStorage.setItem(key,'[]'));
    localStorage.removeItem('ora_admin_last_seen_order_at');
    localStorage.removeItem('ora_assistant_support_session');

    // Never clear ora_settings / auth session / shared staff accounts here.
    logActivity({ action:'Full Live Start Reset', module:'Settings', details:'Operational/demo data and public business contact/payment details cleared. Website Info & Policy text, login/staff access, Google Sheet connection, technical connections, branding and invoice design preserved.' });
  };

  // Legacy reset entry now points to the safe live-start reset so it can never restore demo data
  // or erase the Google Sheet connection/login by accident.
  const resetSystemData = () => {
    void fullLiveStartReset().catch((err)=>alert(err?.message || 'Reset failed.'));
  };


  // Cart operations (variant-safe)
  const cartLineId = (product: Product, variant?: ProductVariant) => `${product.id}::${variant?.id || 'base'}`;

  const addToCart = (product: Product, quantity = 1, variantId?: string) => {
    const type = normalizedProductType(product);
    const variant = type === 'variant' ? variantById(product, variantId) : undefined;
    if (type === 'variant' && !variant) throw new Error(`Please select a color / option for ${product.name_en}.`);
    const line_id = cartLineId(product, variant);
    setCart((prev) => {
      const existing = prev.find((item) => (item.line_id || cartLineId(item.product,item.variant)) === line_id);
      if (existing) {
        return prev.map((item) => (item.line_id || cartLineId(item.product,item.variant)) === line_id
          ? { ...item, quantity: Math.min(999, item.quantity + quantity), line_id }
          : item
        );
      }
      return [...prev, { product, variant, line_id, quantity: Math.min(999, Math.max(1, quantity)) }];
    });
  };

  const removeFromCart = (lineIdOrProductId: string) => {
    setCart((prev) => prev.filter((item) => {
      const key=item.line_id || cartLineId(item.product,item.variant);
      return key !== lineIdOrProductId && item.product.id !== lineIdOrProductId;
    }));
  };

  const updateCartQuantity = (lineIdOrProductId: string, quantity: number) => {
    if (quantity <= 0) { removeFromCart(lineIdOrProductId); return; }
    setCart((prev) => prev.map((item) => {
      const key=item.line_id || cartLineId(item.product,item.variant);
      if(key !== lineIdOrProductId && item.product.id !== lineIdOrProductId) return item;
      return { ...item, quantity: Math.min(999, Math.max(1, quantity)), line_id:key };
    }));
  };

  const clearCart = () => setCart([]);

  const startBuyNow = (product: Product, quantity = 1, variantId?: string) => {
    const type=normalizedProductType(product);
    const variant=type==='variant'?variantById(product,variantId):undefined;
    if(type==='variant' && !variant) throw new Error(`Please select a color / option for ${product.name_en}.`);
    setBuyNowCartBackup(cart);
    setCart([{ product, variant, line_id:cartLineId(product,variant), quantity: Math.min(999, Math.max(1, quantity)) }]);
    setIsCartOpen(false);
    setIsCheckoutOpen(true);
  };

  const closeCheckoutAndRestoreCart = () => {
    setIsCheckoutOpen(false);
    if (buyNowCartBackup !== null) { setCart(buyNowCartBackup); setBuyNowCartBackup(null); }
  };

  const cartSubtotal = cart.reduce((sum, item) => sum + displayUnitPrice(item.product,settings,item.variant) * item.quantity, 0);

  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const getMultiBuyDiscountRate = (qty: number) => {
    if (settings.multi_buy_discount_enabled === false || qty <= 1) return 0;
    const t1Min = Math.max(2, Number(settings.multi_buy_tier1_min ?? 2));
    const t1Max = Math.max(t1Min, Number(settings.multi_buy_tier1_max ?? 3));
    const t1Rate = Math.max(0, Math.min(100, Number(settings.multi_buy_tier1_rate ?? 5)));
    const t2Min = Math.max(t1Max + 1, Number(settings.multi_buy_tier2_min ?? 4));
    const t2Max = Math.max(t2Min, Number(settings.multi_buy_tier2_max ?? 5));
    const t2Rate = Math.max(0, Math.min(100, Number(settings.multi_buy_tier2_rate ?? 7.5)));
    const t3Min = Math.max(t2Max + 1, Number(settings.multi_buy_tier3_min ?? 6));
    const t3Rate = Math.max(0, Math.min(100, Number(settings.multi_buy_tier3_rate ?? 10)));
    if (qty >= t1Min && qty <= t1Max) return t1Rate;
    if (qty >= t2Min && qty <= t2Max) return t2Rate;
    if (qty >= t3Min) return t3Rate;
    return 0;
  };

  const cartMultiBuyDiscountRate = getMultiBuyDiscountRate(cartItemCount);
  const cartSpecialOfferDiscount = Math.round(cartSubtotal * (cartMultiBuyDiscountRate / 100) * 100) / 100;
  const cartFinalProductsTotal = Math.max(0, cartSubtotal - cartSpecialOfferDiscount);


  const normalizePhone = (value: string) => String(value || '').replace(/\D/g, '').replace(/^94(?=7\d{8}$)/, '0');
  const isCustomerBlocked = (phone: string, whatsapp?: string) => {
    const p = normalizePhone(phone);
    const w = normalizePhone(whatsapp || '');
    return blockedCustomers.some((b) => {
      const bp = normalizePhone(b.phone);
      const bw = normalizePhone(b.whatsapp || '');
      return Boolean((p && bp === p) || (w && (bp === w || (bw && bw === w))));
    });
  };
  const blockCustomer = (phone: string, reason: string, createdBy?: string) => {
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    const entry: BlockedCustomer = { id: `blk-${Date.now()}`, phone: normalized, reason: reason || 'Blocked by admin', created_at: new Date().toISOString(), created_by: createdBy };
    setBlockedCustomers((prev) => prev.some((b) => normalizePhone(b.phone) === normalized) ? prev : [entry, ...prev]);
    logActivity({ action: 'Customer Blocked', module: 'Customers', target_id: entry.id, target_label: normalized, details: entry.reason });
  };
  const unblockCustomer = (id: string) => {
    const target = blockedCustomers.find((b) => b.id === id);
    setBlockedCustomers((prev) => prev.filter((b) => b.id !== id));
    logActivity({ action: 'Customer Unblocked', module: 'Customers', target_id: id, target_label: target?.phone || id });
  };

  const nextSourceOrderNumber = (source: OrderSource, extraOrders: Order[] = []) => {
    const prefix = source === 'Website' ? 'WEB' : source === 'Facebook Ads' ? 'FB' : source === 'TikTok Ads' ? 'TK' : 'MAN';
    const all = [...orders, ...extraOrders];
    const max = all.reduce((m, o) => {
      const match = String(o.order_number || '').match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    return `${prefix}-${String(max + 1).padStart(6, '0')}`;
  };

  // Place Order Logic (Stock deduction, configurable advance rule, customer record, Order ID generation)
  // V12.7: Google Sheet is a downstream mirror. Website orders return immediately,
  // while FB/TikTok imports are collected and sent in large batches instead of
  // one Apps Script request per order.
  const sheetTaskChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSheetOrdersRef = useRef<Order[]>([]);
  const sheetBatchTimerRef = useRef<number | null>(null);
  const SHEET_BATCH_SIZE = 250;

  const enqueueSheetTask = (label: string, task: () => Promise<void>) => {
    sheetTaskChainRef.current = sheetTaskChainRef.current
      .then(task)
      .catch((err:any) => console.warn(`[Google Sheet background] ${label}:`, err?.message || err));
  };

  const flushPendingOrderSheetSyncs = () => {
    if (sheetBatchTimerRef.current !== null) {
      window.clearTimeout(sheetBatchTimerRef.current);
      sheetBatchTimerRef.current = null;
    }
    if (!pendingSheetOrdersRef.current.length || !settings.google_sheet_webhook_url) return;

    // Dedupe by Order ID while preserving queue order.
    const seen = new Set<string>();
    const pending = pendingSheetOrdersRef.current.filter((order) => {
      const key=String(order.order_number||'').trim().toUpperCase();
      if(!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    pendingSheetOrdersRef.current = [];

    for (let i=0;i<pending.length;i+=SHEET_BATCH_SIZE) {
      const batch=pending.slice(i,i+SHEET_BATCH_SIZE);
      enqueueSheetTask(`batch sync ${batch[0]?.order_number || ''} +${Math.max(0,batch.length-1)}`, async () => {
        let lastError='Google Sheet batch sync failed.';
        for(let attempt=1;attempt<=3;attempt++){
          const res=await syncOrdersBatchToGoogleSheets(batch,settings.google_sheet_webhook_url,settings);
          if(res.success){
            const syncedAt=new Date().toISOString();
            const ids=new Set(batch.map(o=>o.id));
            setOrders(prev=>prev.map(o=>ids.has(o.id)?{...o,is_synced_google_sheets:true,synced_at:syncedAt}:o));
            return;
          }
          lastError=res.message;
          if(attempt<3) await new Promise(resolve=>window.setTimeout(resolve,700*attempt));
        }
        throw new Error(lastError);
      });
    }
  };

  const queueOrderSheetSync = (order: Order) => {
    // Server (server.ts) already syncs orders to Google Sheets on creation.
    // Client posting is disabled to prevent duplicate rows.
    return;
    const holdWebsiteBankPayment = order.order_source === 'Website' && order.payment_method === 'Bank Payment' && order.payment_verification_status !== 'Approved';
    if (holdWebsiteBankPayment) return;

    pendingSheetOrdersRef.current = [
      ...pendingSheetOrdersRef.current.filter(o=>o.order_number!==order.order_number),
      order,
    ];
    if(sheetBatchTimerRef.current!==null) window.clearTimeout(sheetBatchTimerRef.current);
    const sheetDelay = 3;
    sheetBatchTimerRef.current=window.setTimeout(()=>{
      sheetBatchTimerRef.current=null;
      flushPendingOrderSheetSyncs();
    },sheetDelay);
  };

  const placeOrder = async (formData: {
    customer_name: string;
    phone: string;
    whatsapp: string;
    address: string;
    city: string;
    district?: string;
    payment_method: PaymentMethod;
    notes?: string;
    order_source?: OrderSource;
    bank_receipt_url?: string;
    payment_verification_status?: PaymentVerificationStatus;
    payment_detected_bank?: string;
    payment_detected_amount?: number;
    payment_reference?: string;
    payment_account_match?: boolean;
    payment_amount_match?: boolean;
    payment_receipt_like?: boolean;
    payment_ocr_confidence?: number;
    payment_check_notes?: string;
    gift_wrap_selected?: boolean;
    customer_access_token?: string;
  }): Promise<Order> => {
    if (cart.length === 0) {
      throw new Error('Cart is empty.');
    }
    if (isCustomerBlocked(formData.phone, formData.whatsapp)) {
      throw new Error('This phone number is blocked from placing orders. Please contact O-RA support.');
    }
    const normalizedPhone = normalizePhone(formData.phone);
    const cartFingerprint = cart.map((i) => `${i.product.id}:${i.variant?.id || 'base'}:${i.quantity}`).sort().join('|');
    const duplicateCutoff = Date.now() - 10 * 60 * 1000;
    const duplicate = orders.some((o) => normalizePhone(o.phone) === normalizedPhone && new Date(o.created_at).getTime() >= duplicateCutoff && o.order_status !== 'Cancelled' && o.items.map((i) => `${i.product_id}:${i.variant_id || 'base'}:${i.quantity}`).sort().join('|') === cartFingerprint);
    if (duplicate) throw new Error('A similar order was already placed recently from this phone number. Please wait before trying again.');
    const priorFingerprint = makeOrderFingerprint(formData.phone, cart.map((i) => ({ product_id: i.product.id, variant_id:i.variant?.id, quantity: i.quantity })));
    const duplicateDayCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const priorDuplicate = orders.find((o) => o.order_status !== 'Cancelled' && new Date(o.created_at).getTime() >= duplicateDayCutoff && (o.duplicate_fingerprint || makeOrderFingerprint(o.phone, o.items)) === priorFingerprint);

    const orderSource = formData.order_source || 'Website';
    const nextOrderNum = nextSourceOrderNumber(orderSource);
    const totalQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cartSubtotal;
    const special_offer_discount = cartSpecialOfferDiscount;
    const internal_delivery_fee = Math.max(0, Number(settings.delivery_fee || 0));
    const delivery_fee = settings.free_delivery_enabled ? 0 : internal_delivery_fee;
    const gift_wrap_selected = Boolean(settings.gift_wrap_enabled && formData.gift_wrap_selected);
    const gift_wrap_fee = gift_wrap_selected ? Math.max(0, Number(settings.gift_wrap_fee || 0)) : 0;
    const total_amount = Math.max(0, subtotal - special_offer_discount + delivery_fee + gift_wrap_fee);

    // Configurable Advance Payment Rule (Main Admin controls threshold and percentage)
    const advanceQtyThreshold = Math.max(0, Number(settings.advance_qty_threshold ?? 4));
    const advancePercentage = Math.min(100, Math.max(1, Number(settings.advance_percentage ?? 50)));
    const is_advance_required = totalQuantity > advanceQtyThreshold;
    const advance_amount = is_advance_required ? Math.round(total_amount * (advancePercentage / 100)) : 0;

    const newOrder: Order = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `ord-${crypto.randomUUID()}`
        : `ord-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,
      order_number: nextOrderNum,
      customer_name: formData.customer_name,
      phone: formData.phone,
      whatsapp: formData.whatsapp,
      address: formData.address,
      city: formData.city,
      district: String(formData.district || '').trim(),
      payment_method: formData.payment_method,
      payment_status: 'Pending',
      order_status: formData.payment_method === 'Bank Payment' ? 'Pending Payment' : 'New Orders',
      items: cart.map((item) => buildOrderItemSnapshot(item.product,item.quantity,settings,item.variant,products)),
      subtotal,
      delivery_fee,
      internal_delivery_fee,
      delivery_included_in_item_price: Boolean(settings.free_delivery_enabled),
      special_offer_discount,
      gift_wrap_selected,
      gift_wrap_fee,
      total_amount,
      is_advance_required,
      advance_amount,
      advance_confirmed: false,
      order_source: orderSource,
      call_center_status: 'Pending',
      is_synced_google_sheets: false,
      bank_receipt_url: formData.bank_receipt_url,
      payment_verification_status: formData.payment_method === 'Bank Payment'
        ? (formData.payment_verification_status || 'Awaiting Receipt')
        : 'Not Required',
      payment_detected_bank: formData.payment_detected_bank,
      payment_detected_amount: formData.payment_detected_amount,
      payment_reference: formData.payment_reference,
      payment_account_match: formData.payment_account_match,
      payment_amount_match: formData.payment_amount_match,
      payment_receipt_like: formData.payment_receipt_like,
      payment_ocr_confidence: formData.payment_ocr_confidence,
      payment_check_notes: formData.payment_check_notes,
      courier_name: settings.courier_provider || 'Fardar',
      tracking_status: 'Not Shipped',
      delivery_status: 'Pending',
      stock_status: 'Waiting for Stock',
      stock_allocated: false,
      is_duplicate_order: Boolean(priorDuplicate),
      duplicate_of_order_id: priorDuplicate?.id,
      duplicate_fingerprint: priorFingerprint,
      dispatch_status: 'Not Scanned',
      notes: formData.notes,
      created_at: new Date().toISOString(),
    };

    // Stock is NOT deducted when the order is created.
    // A FIFO allocator below deducts it only when every item in the order is physically available.

    // 2. Update Customer Database
    setCustomers((prevCustomers) => {
      const existing = prevCustomers.find((c) => c.phone === formData.phone);
      if (existing) {
        return prevCustomers.map((c) =>
          c.phone === formData.phone
            ? {
                ...c,
                name: formData.customer_name,
                whatsapp: formData.whatsapp,
                address: formData.address,
                city: formData.city,
                total_orders: c.total_orders + 1,
                total_spent: c.total_spent + total_amount,
              }
            : c
        );
      }
      return [
        ...prevCustomers,
        {
          id: `cust-${Date.now()}`,
          name: formData.customer_name,
          phone: formData.phone,
          whatsapp: formData.whatsapp,
          address: formData.address,
          city: formData.city,
          total_orders: 1,
          total_spent: total_amount,
          created_at: new Date().toISOString(),
        },
      ];
    });

    // 3. Save to the server FIRST. This is the durable checkpoint.
    // If this fails, do NOT send the order to Google Sheets and do NOT tell the customer it succeeded.
    const savedOrder = await publicOrderSave(newOrder, formData.customer_access_token);

    setOrders((prev) => {
      const next = [savedOrder, ...prev.filter(o => o.id !== savedOrder.id && o.order_number !== savedOrder.order_number)]
        .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
      return next;
    });
    setLastPlacedOrder(savedOrder);

    logActivity({
      action: 'Order Created',
      module: 'Orders',
      target_id: savedOrder.id,
      target_label: savedOrder.order_number,
      details: `${savedOrder.order_source} • ${savedOrder.customer_name} • Rs. ${savedOrder.total_amount.toFixed(2)}`,
      actor: savedOrder.order_source === 'Manual Admin' ? adminUser : null,
      actor_name: savedOrder.order_source === 'Manual Admin' ? undefined : `${savedOrder.customer_name} (Customer)`,
      actor_role: savedOrder.order_source === 'Manual Admin' ? undefined : 'customer',
    });

    // 4. Google Sheet mirroring now happens on the SERVER inside /api/orders.
    // This keeps fresh browsers/devices independent from private webhook settings
    // and means the Admin PC does not need to be open after the site is deployed.
    clearCart();
    return savedOrder;
  };

  const importBulkOrders = async (
    itemsList: BulkOrderItemInput[]
  ): Promise<{ importedCount: number; failedCount: number; errors: string[]; importedOrderNumbers: string[]; ignoredCount:number }> => {
    let importedCount = 0;
    let failedCount = 0;
    let ignoredCount = 0;
    const errors: string[] = [];
    const newOrdersList: Order[] = [];
    let customerUpdates: Customer[] = [...customers];
    let persistedOrders:Order[]=[];
    try{ persistedOrders=JSON.parse(localStorage.getItem('ora_orders')||'[]'); }catch{}
    const dedupeOrders=[...orders,...persistedOrders.filter(saved=>!orders.some(cur=>cur.id===saved.id))];

    const leadKeyFor = (row:BulkOrderItemInput,source:OrderSource) => {
      const lead=String(row.platform_lead_id || '').trim();
      if(lead) return `${source}::LEAD::${lead}`.toLowerCase();
      const phone=normalizePhone(row.phone || '');
      const when=String(row.lead_created_at || '').trim();
      const code=String(row.item_code || '').trim().toUpperCase();
      return `${source}::FALLBACK::${phone}::${when}::${code}`.toLowerCase();
    };

    // Platform Lead ID is the primary grouping/dedupe key. If a prepared O-RA Order ID is present,
    // rows with the same ID are one multi-item order.
    const grouped = new Map<string, BulkOrderItemInput[]>();
    itemsList.forEach((row, index) => {
      const source: OrderSource = row.order_source || 'Facebook Ads';
      const rawId = String(row.order_id || '').trim().toUpperCase();
      const leadId=String(row.platform_lead_id || '').trim();
      const key = rawId ? `${source}::ORDER::${rawId}` : leadId ? `${source}::LEAD::${leadId}` : `${source}::__ROW_${index}`;
      grouped.set(key,[...(grouped.get(key)||[]),row]);
    });

    for (const [groupKey, rows] of grouped.entries()) {
      const source: OrderSource = rows.find(r => r.order_source)?.order_source || 'Facebook Ads';
      const sourcePrefix = source === 'Facebook Ads' ? 'FB' : source === 'TikTok Ads' ? 'TK' : source === 'Website' ? 'WEB' : 'MAN';
      const requestedOrderId = String(rows.find(r => r.order_id)?.order_id || '').trim().toUpperCase();
      const platformLeadId=String(rows.find(r=>r.platform_lead_id)?.platform_lead_id || '').trim();
      const leadCreatedAt=String(rows.find(r=>r.lead_created_at)?.lead_created_at || '').trim();
      const leadImportKey=leadKeyFor(rows[0],source);

      const alreadyImported=[...dedupeOrders,...newOrdersList].some(o =>
        (platformLeadId && o.order_source===source && String(o.platform_lead_id||'')===platformLeadId) ||
        Boolean(o.lead_import_key && o.lead_import_key.toLowerCase()===leadImportKey)
      );
      if(alreadyImported){ ignoredCount++; continue; }

      if (requestedOrderId) {
        const validRequestedId = new RegExp(`^${sourcePrefix}-\\d{6}$`).test(requestedOrderId);
        const duplicateRequestedId = [...dedupeOrders, ...newOrdersList].some(o => o.order_number.toUpperCase() === requestedOrderId);
        if (!validRequestedId || duplicateRequestedId) {
          failedCount++; errors.push(`Order ID "${requestedOrderId}" is invalid or already used for ${sourcePrefix}.`); continue;
        }
      }

      const customer_name = String(rows.map(r=>r.customer_name).find(Boolean) || '').trim();
      const phone = String(rows.map(r=>r.phone).find(Boolean) || '').trim();
      const whatsapp = String(rows.map(r=>r.whatsapp).find(Boolean) || '').trim();
      const address = String(rows.map(r=>r.address).find(Boolean) || '').trim();
      const city = String(rows.map(r=>r.city).find(Boolean) || '').trim();
      const payment_method = rows.map(r=>r.payment_method).find(Boolean) || 'COD';
      const notes = String(rows.map(r=>r.notes).find(Boolean) || `${source} Lead CSV Import`).trim();
      const isConfirmed = rows.some(r => r.is_confirmed);
      if (!customer_name) { failedCount++; errors.push(`${requestedOrderId || groupKey}: Customer name is missing.`); continue; }
      if (!phone) { failedCount++; errors.push(`${requestedOrderId || groupKey}: Phone number is missing.`); continue; }
      if (!address) { failedCount++; errors.push(`${requestedOrderId || groupKey}: Address is missing.`); continue; }
      if (!city) { failedCount++; errors.push(`${requestedOrderId || groupKey}: City is missing.`); continue; }

      const orderItems: Order['items'] = [];
      let invalidGroup = false;
      for (let rowIndex=0; rowIndex<rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const code=String(row.item_code||'').trim();
        if(!code){ errors.push(`${requestedOrderId || groupKey}: Main Product Code missing on row ${rowIndex+1}.`); invalidGroup=true; break; }
        const selection=findProductSelection(products,code,row.variant_value);
        if(!selection){ errors.push(`${requestedOrderId || groupKey}: Product "${code}" not found.`); invalidGroup=true; break; }
        if(isConfirmed && normalizedProductType(selection.product)==='variant' && !selection.variant){
          errors.push(`${requestedOrderId || groupKey}: Select a Color / Variant for ${selection.product.name_en} before confirmation.`); invalidGroup=true; break;
        }
        const qty=Number(row.quantity);
        if (!Number.isFinite(qty) || qty < 1) {
          errors.push(`${requestedOrderId || groupKey}: Quantity is missing or invalid on row ${rowIndex+1}.`);
          invalidGroup=true;
          break;
        }
        if(!isConfirmed && normalizedProductType(selection.product)==='variant' && !selection.variant){
          // Pending FB/TikTok lead: main code is enough. Exact variant is chosen by Call Center later.
          const unitPrice=displayUnitPrice(selection.product,settings);
          orderItems.push({
            product_id:selection.product.id, product_name:selection.product.name_en,
            sku:selection.product.sku, main_sku:selection.product.sku,
            variant_name:String(row.variant_value||'').trim() || undefined,
            product_type:'variant', buying_price:Number(selection.product.buying_price||0),
            unit_price:unitPrice, quantity:qty, subtotal:unitPrice*qty, image:selection.product.images?.[0]
          });
        } else {
          orderItems.push(buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products));
        }
      }
      if(invalidGroup || !orderItems.length){ failedCount++; continue; }

      const totalQty=orderItems.reduce((n,it)=>n+it.quantity,0);
      const subtotal=orderItems.reduce((n,it)=>n+it.subtotal,0);
      const internal_delivery_fee=Math.max(0,Number(settings.delivery_fee||0));
      const delivery_fee=settings.free_delivery_enabled?0:internal_delivery_fee;
      const rate=getMultiBuyDiscountRate(totalQty);
      const special_offer_discount=Math.round(subtotal*(rate/100)*100)/100;
      const total_amount=Math.round(Math.max(0,subtotal-special_offer_discount+delivery_fee));
      const nextOrderNum=requestedOrderId || nextSourceOrderNumber(source,newOrdersList);
      const fingerprint=makeOrderFingerprint(phone,orderItems);
      const duplicateDayCutoff=Date.now()-24*60*60*1000;
      const existingDuplicate=[...dedupeOrders,...newOrdersList].find(o => o.order_status!=='Cancelled' && new Date(o.created_at).getTime()>=duplicateDayCutoff && (o.duplicate_fingerprint||makeOrderFingerprint(o.phone,o.items))===fingerprint);
      const threshold=Math.max(0,Number(settings.advance_qty_threshold??4));
      const pct=Math.min(100,Math.max(1,Number(settings.advance_percentage??50)));
      const now=new Date().toISOString();

      let newOrder:Order={
        id:`ord-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        order_number:nextOrderNum, customer_name, phone, whatsapp, address, city,
        payment_method, payment_status:'Pending', order_status:isConfirmed?'Processing':'New Orders',
        items:orderItems, subtotal, delivery_fee, internal_delivery_fee,
        delivery_included_in_item_price:Boolean(settings.free_delivery_enabled), special_offer_discount,
        gift_wrap_selected:false,gift_wrap_fee:0,total_amount,
        is_advance_required:totalQty>threshold, advance_amount:totalQty>threshold?Math.round(total_amount*pct/100):0,
        advance_confirmed:false, order_source:source,
        is_test_order: /^TEST-(FB|TK)-/i.test(platformLeadId) || /SYSTEM TEST LEAD/i.test(notes),
        call_center_status:isConfirmed?'Confirmed':'Pending', is_synced_google_sheets:false,
        stock_status:'Waiting for Stock',stock_allocated:false,
        is_duplicate_order:Boolean(existingDuplicate),duplicate_of_order_id:existingDuplicate?.id,duplicate_fingerprint:fingerprint,
        dispatch_status:'Not Scanned',notes,created_at:now,
        platform_lead_id:platformLeadId || undefined, platform_lead_created_at:leadCreatedAt || undefined,
        lead_import_key:leadImportKey, lead_imported_at:now,
      };

      // Build the whole import first. Saving one order at a time makes 100-500 row
      // uploads unnecessarily slow. The server persists + Sheet-syncs the batch once.
      newOrdersList.push(newOrder);

      const existingCustIdx=customerUpdates.findIndex(c=>normalizePhone(c.phone)===normalizePhone(phone));
      if(existingCustIdx>=0){
        const c=customerUpdates[existingCustIdx];
        customerUpdates[existingCustIdx]={...c,name:customer_name,whatsapp,address,city,total_orders:c.total_orders+1,total_spent:c.total_spent+total_amount};
      } else customerUpdates.push({id:`cust-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:customer_name,phone,whatsapp,address,city,total_orders:1,total_spent:total_amount,created_at:now});
      importedCount++;
    }

    let savedOrders:Order[] = [];
    if(newOrdersList.length){
      try{
        const saved=await staffBulkOrderSaveAndSheetSync(newOrdersList);
        savedOrders=saved.orders;
        setCustomers(customerUpdates);
        setOrders(prev=>[...savedOrders,...prev.filter(old=>!savedOrders.some(n=>n.id===old.id||n.order_number===old.order_number))]);
        if(saved.sheetSync && saved.sheetSync.ok===false){
          errors.push(`Orders saved, but Google Sheet sync is pending: ${saved.sheetSync.error || 'unknown Sheet error'}`);
        }
      }catch(e:any){
        failedCount += newOrdersList.length;
        importedCount = Math.max(0, importedCount - newOrdersList.length);
        errors.push(`Bulk save / Sheet sync failed: ${e?.message||'unknown error'}`);
        savedOrders=[];
      }
    }

    logActivity({action:'Lead / Orders Imported',module:'Orders',details:`Imported ${savedOrders.length}; Already imported ${ignoredCount}; Failed ${failedCount}`});
    return {importedCount:savedOrders.length,failedCount,ignoredCount,errors,importedOrderNumbers:savedOrders.map(o=>o.order_number)};
  };

  const fifoAllocatorSignatureRef = useRef<string>('');
  const autoInvoiceReadyRef = useRef<Set<string>>(new Set());

  type InventoryRequirement={product_id:string;variant_id?:string;quantity:number;label:string};
  const inventoryRequirementsForOrderItem=(item:Order['items'][number]):InventoryRequirement[]=>{
    if(item.product_type==='bundle' && item.bundle_components?.length){
      return item.bundle_components.map(c=>({
        product_id:c.product_id,variant_id:c.variant_id,
        quantity:Math.max(1,Number(c.quantity_per_bundle||1))*Math.max(1,Number(item.quantity||1)),
        label:`${c.product_name}${c.variant_name?` - ${c.variant_name}`:''}`
      }));
    }
    return [{product_id:item.product_id,variant_id:item.variant_id,quantity:Math.max(1,Number(item.quantity||1)),label:`${item.product_name}${item.variant_name?` - ${item.variant_name}`:''}`}];
  };

  const cloneInventoryProducts=(rows:Product[])=>rows.map(p=>({...p,variants:(p.variants||[]).map(v=>({...v})),bundle_components:(p.bundle_components||[]).map(c=>({...c}))}));
  const inventoryStock=(product:Product,variantId?:string)=>{
    if(variantId) return Math.max(0,Number(variantById(product,variantId)?.stock_quantity||0));
    if(normalizedProductType(product)==='variant') return -1; // variant must be explicit
    return Math.max(0,Number(product.stock_quantity||0));
  };

  // FIFO stock + waybill allocator. Variants use their own stock. Bundles deduct real component stock.
  useEffect(() => {
    const allocatorSignature=JSON.stringify({
      orders:orders.map(o=>[o.id,o.order_status,o.call_center_status,o.stock_allocated,o.waybill_number,o.invoice_locked,(o.items||[]).map(i=>[i.product_id,i.variant_id,i.product_type,i.quantity])]),
      products:products.map(p=>[p.id,p.stock_quantity,(p.variants||[]).map(v=>[v.id,v.stock_quantity,v.status])]),
      waybills:waybillRecords.map(w=>[w.waybill_number,w.status]),
    });
    if(fifoAllocatorSignatureRef.current===allocatorSignature) return;
    fifoAllocatorSignatureRef.current=allocatorSignature;

    const confirmedActive=orders.filter(o=>o.order_status!=='Cancelled' && o.call_center_status==='Confirmed' && !o.is_duplicate_order && !o.is_test_order)
      .sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());
    const waiting=confirmedActive.filter(o=>!o.stock_allocated);
    const inventory=cloneInventoryProducts(products);
    const productMap=new Map(inventory.map(p=>[p.id,p] as [string,Product]));
    const allocatedIds=new Set<string>();
    const allocationLogs:StockHistory[]=[];
    const now=new Date().toISOString();

    for(const order of waiting){
      const groupedReq=new Map<string,InventoryRequirement>();
      for(const item of order.items){
        for(const req of inventoryRequirementsForOrderItem(item)){
          const key=`${req.product_id}::${req.variant_id||'base'}`;
          const prev=groupedReq.get(key);
          groupedReq.set(key,prev?{...prev,quantity:prev.quantity+req.quantity}:req);
        }
      }
      const requirements=[...groupedReq.values()];
      const canAllocate=requirements.every(req=>{
        const product=productMap.get(req.product_id);
        return Boolean(product) && inventoryStock(product!,req.variant_id)>=req.quantity;
      });
      if(!canAllocate) continue;

      for(const req of requirements){
        const product=productMap.get(req.product_id)!;
        if(req.variant_id){
          const variants=(product.variants||[]).map(v=>{
            if(v.id!==req.variant_id) return v;
            const before=Number(v.stock_quantity||0);
            const after=Math.max(0,before-req.quantity);
            allocationLogs.push({id:`stk-alloc-${Date.now()}-${order.id}-${product.id}-${v.id}`,product_id:product.id,product_name:`${product.name_en} - ${v.option_value}`,change_type:'Order Deduction',quantity:req.quantity,previous_stock:before,new_stock:after,reason:`FIFO stock allocated to ${order.order_number}`,performed_by:'System FIFO Allocator',created_at:now});
            return {...v,stock_quantity:after,status:(after<=0?'Out of Stock':'Active') as Product['status']};
          });
          product.variants=variants;
          product.stock_quantity=variants.reduce((n,v)=>n+Math.max(0,Number(v.stock_quantity||0)),0);
          product.status=product.stock_quantity<=0?'Out of Stock':'Active';
        } else {
          const before=Number(product.stock_quantity||0);
          const after=Math.max(0,before-req.quantity);
          product.stock_quantity=after;
          product.status=after<=0?'Out of Stock':'Active';
          allocationLogs.push({id:`stk-alloc-${Date.now()}-${order.id}-${product.id}`,product_id:product.id,product_name:req.label,change_type:'Order Deduction',quantity:req.quantity,previous_stock:before,new_stock:after,reason:`FIFO stock allocated to ${order.order_number}`,performed_by:'System FIFO Allocator',created_at:now});
        }
      }
      allocatedIds.add(order.id);
    }

    if(allocatedIds.size){ setProducts(Array.from(productMap.values())); setStockHistory(prev=>[...allocationLogs,...prev]); }

    const postStockOrders=confirmedActive.map(order=>allocatedIds.has(order.id)?{...order,stock_allocated:true,stock_status:'Allocated' as const,stock_allocated_at:now,stock_allocated_by:'System FIFO Allocator'}:order);
    const readyWithoutWaybill=postStockOrders.filter(o=>o.stock_allocated && o.stock_status==='Allocated' && !o.waybill_number && !o.invoice_locked && o.order_status!=='Cancelled')
      .sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());
    const availableWaybills=waybillRecords.filter(w=>w.status==='Available').sort((a,b)=>new Date(a.imported_at).getTime()-new Date(b.imported_at).getTime());
    const autoAssignments=new Map<string,WaybillRecord>();
    for(let i=0;i<Math.min(readyWithoutWaybill.length,availableWaybills.length);i++) autoAssignments.set(readyWithoutWaybill[i].id,availableWaybills[i]);
    if(!allocatedIds.size && !autoAssignments.size) return;

    setOrders(prev=>prev.map(o=>{
      const newlyAllocated=allocatedIds.has(o.id); const wb=autoAssignments.get(o.id);
      if(!newlyAllocated && !wb) return o;
      const updated={...o,
        ...(newlyAllocated?{stock_allocated:true,stock_status:'Allocated' as const,stock_allocated_at:now,stock_allocated_by:'System FIFO Allocator'}:{}),
        ...(wb?{waybill_number:wb.waybill_number,courier_name:wb.courier_name,shipment_mode:'manual' as const,delivery_status:'Waybill Assigned',tracking_status:'Ready for Packing'}:{})
      } as Order;
      void mirrorOrderUpdate(updated);
      return updated;
    }));

    if(autoAssignments.size){
      const byWaybill=new Map(Array.from(autoAssignments.entries()).map(([orderId,wb])=>[wb.waybill_number,orderId]));
      setWaybillRecords(prev=>prev.map(w=>{
        const orderId=byWaybill.get(w.waybill_number); if(!orderId) return w;
        const order=postStockOrders.find(o=>o.id===orderId);
        return {...w,status:'Assigned',assigned_order_id:orderId,assigned_order_number:order?.order_number,assigned_at:now};
      }));
    }
  }, [orders, products, waybillRecords]);


  // AUTO INVOICE QUEUE:
  // Once a Confirmed order has full stock + a waybill, create/lock its invoice record
  // automatically so it appears in Packing Invoice Downloads. PDF download remains manual.
  useEffect(() => {
    const ready = orders
      .filter(o =>
        o.order_status !== 'Cancelled' &&
        o.call_center_status === 'Confirmed' &&
        !o.is_duplicate_order &&
        !o.is_test_order &&
        o.stock_allocated &&
        o.stock_status === 'Allocated' &&
        Boolean(o.waybill_number) &&
        !o.invoice_locked
      )
      .sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());

    if (!ready.length) return;

    const unseen = ready.filter(o => !autoInvoiceReadyRef.current.has(o.id));
    if (!unseen.length) return;

    // Group max 50 newly-ready orders into one automatic packing batch.
    const batch = unseen.slice(0,50);
    const now = new Date();
    const nowIso = now.toISOString();
    const batchId = `PACK-AUTO-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const ids = new Set(batch.map(o=>o.id));
    batch.forEach(o=>autoInvoiceReadyRef.current.add(o.id));

    const autoUpdated=batch.map(o=>({
      ...o,
      invoice_number:o.invoice_number || `INV-${o.order_number}`,
      invoice_generated_at:o.invoice_generated_at || nowIso,
      invoice_generated_by:o.invoice_generated_by || 'System Auto Invoice Queue',
      invoice_locked:true,
      invoice_pack_batch_id:o.invoice_pack_batch_id || batchId,
      invoice_pack_downloaded_at:undefined,
      invoice_pack_downloaded_by:undefined,
      invoice_payment_label_snapshot:o.invoice_payment_label_snapshot || deriveInvoicePaymentLabel(o, settings),
      invoice_advance_percentage_snapshot:o.invoice_advance_percentage_snapshot ?? Number(settings.advance_percentage ?? 50),
    } as Order));
    const autoMap=new Map(autoUpdated.map(o=>[o.id,o]));
    setOrders(prev => prev.map(o => autoMap.get(o.id) || o));
    autoUpdated.forEach(mirrorOrderUpdate);

    logActivity({
      action:'Auto Invoice Batch Ready',
      module:'Invoices',
      details:`${batch.length} invoice(s) moved to Packing Downloads • ${batchId}`
    });
  }, [orders]);


  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    const order = orders.find((o) => o.id === orderId);
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, order_status: status } : o)));
    logActivity({ action: 'Order Status Changed', module: 'Orders', target_id: orderId, target_label: order?.order_number || orderId, details: `Status: ${status}` });
  };

  const updateOrderDeliveryDetails = async (
    orderId: string,
    details: { address: string; city: string; district?: string },
  ): Promise<{ success: boolean; sheetSynced: boolean; message: string }> => {
    const order=orders.find((o)=>o.id===orderId);
    if(!order)throw new Error('Order not found.');
    if(order.order_status==='Shipped' || order.order_status==='Delivered' || order.dispatch_status==='Handed Over'){
      throw new Error('Shipped / delivered orders cannot have their delivery address changed from Orders.');
    }

    const address=String(details.address || '').trim();
    const city=String(details.city || '').trim();
    const district=String(details.district || '').trim();
    if(!address)throw new Error('Address is required.');
    if(!city)throw new Error('City is required.');

    const normalizeDeliveryPlace=(value:string)=>String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
    const cityChanged=normalizeDeliveryPlace(city)!==normalizeDeliveryPlace(order.city || '');
    const updated:Order={
      ...order,
      address,
      city,
      district:district || undefined,
      ...(cityChanged ? { fardar_city:undefined, city_verified:false, city_mapping_source:undefined } : {}),
    };

    // After an order's FIRST Sheet sync, the Google Sheet delivery location is
    // authoritative. Editing the System order must never overwrite a Call Center
    // correction in Sheet. This save is intentionally O-RA-only.
    await sharedStaffRequest(`/api/orders/${encodeURIComponent(order.id)}`,{
      method:'PUT',
      body:JSON.stringify({order:updated}),
    });

    setOrders((prev)=>prev.map((o)=>o.id===orderId?updated:o));
    logActivity({
      action:'Delivery Address Updated',
      module:'Orders',
      target_id:order.id,
      target_label:order.order_number,
      details:`${order.address}, ${order.city}${order.district?`, ${order.district}`:''} → ${address}, ${city}${district?`, ${district}`:''} • Google Sheet unchanged`,
    });
    return{success:true,sheetSynced:false,message:'Address saved in O-RA. Google Sheet address was not changed.'};
  };

  const updatePaymentStatus = (orderId: string, status: 'Pending' | 'Paid' | 'Refunded') => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const updated: Order = {
      ...order,
      payment_status: status,
      payment_paid_type: status === 'Paid' ? (order.payment_method === 'COD' ? 'COD' : 'Full') : undefined,
    };
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    mirrorOrderUpdate(updated);
    logActivity({ action: 'Payment Status Changed', module: 'Payments', target_id: orderId, target_label: order.order_number || orderId, details: `Status: ${status}` });
  };

  const confirmAdvancePayment = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const updated: Order = { ...order, advance_confirmed: true, payment_status: 'Paid', payment_paid_type: 'Advance' };
    setOrders((prev) => prev.map((o) => o.id === orderId ? updated : o));
    mirrorOrderUpdate(updated);
    logActivity({ action: 'Advance Payment Confirmed', module: 'Payments', target_id: orderId, target_label: order.order_number || orderId });
  };

  const reviewPayment = (orderId: string, decision: 'approve' | 'reject', reviewer = adminUser?.name || 'Admin', receivedAmount?: number) => {
    const reviewedAt = new Date().toISOString();
    const reviewedOrder = orders.find((o) => o.id === orderId);
    if (!reviewedOrder) return;
    let updated: Order;
    if (decision === 'approve') {
      const detected = Number(reviewedOrder.payment_detected_amount || 0);
      const confirmedReceived = Number(receivedAmount || 0);
      const paidAmount = confirmedReceived > 0 ? confirmedReceived : detected;
      const total = Number(reviewedOrder.total_amount || 0);
      const isFull = !reviewedOrder.is_advance_required || (paidAmount > 0 && total > 0 && paidAmount >= total * 0.98);
      updated = {
        ...reviewedOrder,
        payment_status: 'Paid',
        payment_received_amount: paidAmount > 0 ? paidAmount : undefined,
        payment_paid_type: isFull ? 'Full' : 'Advance',
        payment_verification_status: 'Approved',
        payment_reviewed_by: reviewer,
        payment_reviewed_at: reviewedAt,
        advance_confirmed: isFull ? reviewedOrder.advance_confirmed : true,
        order_status: reviewedOrder.order_status === 'Pending Payment' || reviewedOrder.order_status === 'New Orders' ? 'Processing' : reviewedOrder.order_status,
      };
    } else {
      updated = {
        ...reviewedOrder,
        payment_status: 'Pending',
        payment_paid_type: undefined,
        payment_verification_status: 'Rejected',
        payment_reviewed_by: reviewer,
        payment_reviewed_at: reviewedAt,
        order_status: 'Pending Payment',
      };
    }
    setOrders((prev) => prev.map((o) => o.id === orderId ? updated : o));
    mirrorOrderUpdate(updated);

    // Bank-transfer website orders are intentionally kept OUT of the call-center Google Sheet
    // until an admin confirms the money actually arrived. This prevents fake/slip-only orders
    // from entering the normal fulfilment flow.
    if (decision === 'approve' && updated.order_source === 'Website' && !updated.is_synced_google_sheets && settings.google_sheet_webhook_url) {
      syncOrderToGoogleSheets(updated, settings.google_sheet_webhook_url, settings, products).then((result) => {
        if (!result.success) {
          console.warn(`Google Sheet sync failed after payment approval for ${updated.order_number}: ${result.message}`);
          return;
        }
        const syncedAt = new Date().toISOString();
        const syncedOrder = { ...updated, is_synced_google_sheets: true, synced_at: syncedAt };
        setOrders((prev) => prev.map((o) => o.id === orderId ? syncedOrder : o));
        mirrorOrderUpdate(syncedOrder);
      }).catch((err) => console.warn('Google Sheet sync after payment approval failed:', err));
    }

    logActivity({ action: decision === 'approve' ? 'Payment Approved' : 'Payment Rejected', module: 'Payments', target_id: orderId, target_label: reviewedOrder.order_number || orderId, details: `Reviewer: ${reviewer}${decision === 'approve' && Number(receivedAmount || 0) > 0 ? ` • Confirmed received: Rs. ${Number(receivedAmount).toLocaleString()}` : ''}` });
  };

  const normalizeCity = (value: string) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9\u0D80-\u0DFF]+/g, ' ').replace(/\s+/g, ' ').trim();

  const refreshFardarCities = async () => {
    if (!adminUser) return;
    try {
      const data = await sharedStaffRequest('/api/courier/fardar/cities');
      setFardarCities(Array.isArray(data?.cities) ? data.cities : []);
      setFardarCityMappings(Array.isArray(data?.mappings) ? data.mappings : []);
    } catch (e) {
      console.warn('Could not load Fardar city list:', e);
    }
  };

  useEffect(() => {
    if (adminUser) refreshFardarCities();
    else { setFardarCities([]); setFardarCityMappings([]); }
  }, [adminUser?.id]);

  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource) => {
    const errors:string[]=[]; const orderNumbers:string[]=[]; let notFoundCount=0,ignoredCount=0;
    const parse=(line:string)=>{const out:string[]=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===','&&!q){out.push(cur.trim());cur='';}else cur+=ch;}out.push(cur.trim());return out;};
    const lines=String(csvText||'').split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<2)return{confirmedCount:0,notFoundCount:0,ignoredCount:0,orderNumbers:[],errors:['CSV has no data rows.']};
    const h=parse(lines[0]).map(v=>v.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''));
    const idx=(names:string[])=>h.findIndex(x=>names.includes(x));
    const idI=idx(['order_id','order_number','order']);
    const mainI=idx(['main_code','main_sku','product_code']);
    const variantI=idx(['variant_color','variant','color','colour','option']);
    const codeI=idx(['item_code','variant_code','actual_sku','sku']);
    const qtyI=idx(['qty','quantity']);
    const itemStatusI=idx(['item_status','item_action']);
    const decisionI=idx(['decision','call_decision','final_decision','order_action']);
    const callResultI=idx(['call_result','call_status','result']);
    const reasonI=idx(['cancel_reason','reason','notes']);
    const cancelledByI=idx(['cancelled_by','updated_by','call_center_by']);
    const giftWrapI=idx(['gift_wrap','gift_wrapping','wrap']);
    const wrappingCostI=idx(['wrapping_cost_rs','wrapping_cost','gift_wrap_fee','wrapping_fee_rs','wrapping_fee']);
    const addressI=idx(['address','customer_address','delivery_address']);
    const cityI=idx(['city','town','delivery_city']);
    const districtI=idx(['district','delivery_district']);
    if(idI<0||codeI<0||(decisionI<0&&callResultI<0))return{confirmedCount:0,notFoundCount:0,ignoredCount:0,orderNumbers:[],errors:['Required columns: Order ID, Item Code, and Order Action (CONFIRM ORDER / CANCEL ENTIRE ORDER). Older Decision/Call Result CSV files are still supported.']};

    const wantedPrefix=source==='Facebook Ads'?'FB':source==='TikTok Ads'?'TK':source==='Website'?'WEB':'';
    const groups=new Map<string,string[][]>();
    lines.slice(1).forEach((line,rowNo)=>{const c=parse(line),id=String(c[idI]||'').trim().toUpperCase();if(!id||id.startsWith('DATE:')){ignoredCount++;return;}if(wantedPrefix&&!id.startsWith(`${wantedPrefix}-`)){ignoredCount++;errors.push(`Row ${rowNo+2}: ${id} is not a ${wantedPrefix} order.`);return;}if(!/^(WEB|FB|TK)-\d{6}$/.test(id)&&!/^WEB-TEST-\d{3}$/.test(id)){ignoredCount++;return;}groups.set(id,[...(groups.get(id)||[]),c]);});

    let persisted:Order[]=[];try{persisted=JSON.parse(localStorage.getItem('ora_orders')||'[]');}catch{}
    const merged=[...orders,...persisted.filter(saved=>!orders.some(cur=>cur.id===saved.id))];
    const existing=new Map(merged.map(o=>[o.order_number.toUpperCase(),o] as [string,Order]));
    const now=new Date().toISOString(); const updates=new Map<string,Partial<Order>>();

    groups.forEach((rows,id)=>{
      const order=existing.get(id); if(!order){notFoundCount++;return;}
      if(source && order.order_source!==source){ignoredCount++;return;}
      const decisionValues=decisionI>=0?rows.map(c=>String(c[decisionI]||'').trim()).filter(Boolean):[];
      const decisionValue=decisionValues.find(v=>!['pending','blank'].includes(v.toLowerCase().replace(/[_-]+/g,' ').trim())) || decisionValues[0];
      const rawCall=String(decisionValue || (callResultI>=0?rows.map(c=>c[callResultI]).find(v=>String(v||'').trim()):'') || '').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
      // Upload is intentionally Confirm + Cancel only. PENDING / NO ANSWER stay in Google Sheet for the next call.
      if(!rawCall || ['pending','blank','no answer','noanswer','reschedule','rescheduled'].includes(rawCall)){ignoredCount++;return;}
      let callResult:Order['call_center_status'];
      if(['confirmed','confirm','confirm order'].includes(rawCall))callResult='Confirmed';else if(['cancelled','canceled','cancel','cancel entire order'].includes(rawCall))callResult='Cancelled';else{errors.push(`${id}: Order Action must be CONFIRM ORDER or CANCEL ENTIRE ORDER. PENDING / NO ANSWER are ignored by upload.`);return;}
      const reason=reasonI>=0?String(rows.map(c=>c[reasonI]).find(Boolean)||'').trim():'';
      if(callResult==='Cancelled'){
        if(order.stock_allocated || order.invoice_locked || ['Shipped','Delivered'].includes(order.order_status)){errors.push(`${id}: This order is already stock/invoice/dispatch locked. Use an Admin correction/return flow instead of Call Center cancellation.`);return;}
        const cancelledBy=cancelledByI>=0?String(rows.map(c=>c[cancelledByI]).find(Boolean)||'Call Center').trim():'Call Center';
        updates.set(id,{call_center_status:'Cancelled',order_status:'Cancelled',call_center_updated_at:now,cancelled_at:now,cancelled_by:cancelledBy,cancel_reason:reason||'Customer/Call Center cancellation',notes:[order.notes,'Cancelled by Call Center',reason?`Reason: ${reason}`:''].filter(Boolean).join(' | ')});orderNumbers.push(id);return;
      }

      if(order.stock_allocated || order.invoice_locked || ['Shipped','Delivered'].includes(order.order_status)){errors.push(`${id}: This order is already stock/invoice/dispatch locked. Qty/Product changes are blocked in Call Center upload.`);return;}
      const itemAction=(c:string[])=>String(c[itemStatusI]||'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
      const isCancelledItem=(c:string[])=>['cancelled','canceled','cancel','cancel item'].includes(itemAction(c));
      const isKeptItem=(c:string[])=>['','confirmed','confirm','pending','keep','keep item'].includes(itemAction(c));
      const confirmed=itemStatusI>=0?rows.filter(c=>!isCancelledItem(c)):rows;
      const cancelled=itemStatusI>=0?rows.filter(c=>isCancelledItem(c)):[];
      const invalid=itemStatusI>=0?rows.filter(c=>!isCancelledItem(c)&&!isKeptItem(c)):[];
      if(invalid.length){errors.push(`${id}: Item Action must be KEEP ITEM or CANCEL ITEM.`);return;}
      if(!confirmed.length){updates.set(id,{call_center_status:'Cancelled',order_status:'Cancelled',call_center_updated_at:now,cancelled_at:now,cancelled_by:'Call Center',cancel_reason:reason||'All items cancelled by Call Center',notes:[order.notes,'All items cancelled by Call Center'].filter(Boolean).join(' | ')});orderNumbers.push(id);return;}

      const nextItems:Order['items']=[]; let bad=false;
      confirmed.forEach((c,rowIndex)=>{
        if(bad)return;
        const actualCode=String(c[codeI]||'').trim().toUpperCase();
        const mainCode=mainI>=0?String(c[mainI]||'').trim().toUpperCase():'';
        const variantValue=variantI>=0?String(c[variantI]||'').trim():'';
        const qty=Math.max(1,Number(qtyI>=0?c[qtyI]:1)||1);
        if(qty>99){errors.push(`${id}: Qty ${qty} is too high.`);bad=true;return;}
        const selection=findProductSelection(products,actualCode||mainCode,variantValue);
        if(!selection){errors.push(`${id}: Item ${actualCode||mainCode} was not found in current Products.`);bad=true;return;}
        if(normalizedProductType(selection.product)==='variant'&&!selection.variant){errors.push(`${id}: Select a Color / Variant for ${selection.product.name_en} on row ${rowIndex+1}.`);bad=true;return;}
        try{nextItems.push(buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products));}catch(e:any){errors.push(`${id}: ${e?.message||'Invalid item selection.'}`);bad=true;}
      });
      if(bad)return;
      const giftWrapRaw=giftWrapI>=0?String(rows.map(c=>c[giftWrapI]).find(v=>String(v||'').trim())||'').trim():'';
      const gift_wrap_selected=giftWrapRaw
        ? ['yes','true','1','on','add wrap','gift wrap'].includes(giftWrapRaw.toLowerCase())
        : Boolean(order.gift_wrap_selected);
      const sheetWrappingCost=wrappingCostI>=0?Number(String(rows.map(c=>c[wrappingCostI]).find(v=>String(v||'').trim())||0).replace(/[^0-9.-]/g,'')):0;
      const gift_wrap_fee=gift_wrap_selected
        ? Math.max(0,Number(sheetWrappingCost || order.gift_wrap_fee || settings.gift_wrap_fee || 0))
        : 0;
      const totalQty=nextItems.reduce((n,it)=>n+it.quantity,0),subtotal=nextItems.reduce((n,it)=>n+it.subtotal,0),rate=getMultiBuyDiscountRate(totalQty),special_offer_discount=Math.round(subtotal*(rate/100)*100)/100,total_amount=Math.round(Math.max(0,subtotal-special_offer_discount+order.delivery_fee+gift_wrap_fee)),threshold=Math.max(0,Number(settings.advance_qty_threshold??4)),adv=totalQty>threshold,pct=Math.min(100,Math.max(1,Number(settings.advance_percentage??50)));
      const confirmedAddress=addressI>=0?String(rows.map(c=>c[addressI]).find(v=>String(v||'').trim())||'').trim():'';
      const confirmedCity=cityI>=0?String(rows.map(c=>c[cityI]).find(v=>String(v||'').trim())||'').trim():'';
      const confirmedDistrict=districtI>=0?String(rows.map(c=>c[districtI]).find(v=>String(v||'').trim())||'').trim():'';
      const cityChanged=Boolean(confirmedCity && confirmedCity.trim().toLowerCase()!==String(order.city||'').trim().toLowerCase());
      const oldShape=(order.items||[]).map(it=>({sku:it.sku,product_name:it.product_name,variant_name:it.variant_name,quantity:it.quantity,unit_price:it.unit_price}));
      const newShape=nextItems.map(it=>({sku:it.sku,product_name:it.product_name,variant_name:it.variant_name,quantity:it.quantity,unit_price:it.unit_price}));
      const changed=JSON.stringify(oldShape)!==JSON.stringify(newShape);
      updates.set(id,{items:nextItems,subtotal,special_offer_discount,gift_wrap_selected,gift_wrap_fee,total_amount,is_advance_required:adv,advance_amount:adv?Math.round(total_amount*pct/100):0,call_center_status:'Confirmed',order_status:'Processing',call_center_updated_at:now,stock_allocated:false,stock_status:'Waiting for Stock',...(confirmedAddress?{address:confirmedAddress}:{}),...(confirmedCity?{city:confirmedCity}:{}),...(confirmedDistrict?{district:confirmedDistrict}:{}),...(cityChanged?{fardar_city:undefined,city_verified:false,city_mapping_source:undefined}:{}),product_change_history:changed?[...(order.product_change_history||[]),{changed_at:now,changed_by:'Call Center Confirm Upload',old_items:oldShape,new_items:newShape,reason:reason||undefined}]:(order.product_change_history||[]),notes:[order.notes,cancelled.length?`Call Center cancelled ${cancelled.length} item row(s).`:'',reason?`Call Center: ${reason}`:''].filter(Boolean).join(' | ')});
      orderNumbers.push(id);
    });

    // Confirm upload is one-way from Google Sheet -> O-RA. The Sheet may contain
    // corrected Address / City / District, so never echo the System order back and
    // risk overwriting those Call Center edits.
    const apply=(rows:Order[])=>rows.map(o=>{const patch=updates.get(o.order_number.toUpperCase());const next=patch?{...o,...patch}:o;if(patch){void mirrorOrderUpdate(next as Order);}return next as Order;});
    setOrders(prev=>{const recovered=[...prev,...persisted.filter(saved=>!prev.some(cur=>cur.id===saved.id))];const next=apply(recovered);try{localStorage.setItem('ora_orders',JSON.stringify(next));}catch{}return next;});
    return{confirmedCount:orderNumbers.length,notFoundCount,ignoredCount,orderNumbers,errors};
  };

  const importWebsiteConfirmedCsv = (csvText:string) => importConfirmedOrdersCsv(csvText,'Website');

  const importCallCenterResultsCsv = (csvText: string) => {
    const errors: string[] = [];
    let updatedCount = 0;
    let notFoundCount = 0;
    const lines = String(csvText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { updatedCount: 0, notFoundCount: 0, errors: ['CSV has no data rows.'] };
    const parse = (line: string) => line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const headers = parse(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
    const idIdx = headers.findIndex(h => ['order_id','order_number','order'].includes(h));
    const resultIdx = headers.findIndex(h => ['result','status','call_result','call_status'].includes(h));
    if (idIdx < 0 || resultIdx < 0) return { updatedCount: 0, notFoundCount: 0, errors: ['Required columns: Order ID, Result'] };

    const updates = new Map<string, { status: Order['call_center_status']; orderStatus: OrderStatus }>();
    lines.slice(1).forEach((line, i) => {
      const c = parse(line);
      const orderNo = String(c[idIdx] || '').trim();
      const raw = String(c[resultIdx] || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
      if (!orderNo) { errors.push(`Row ${i+2}: Order ID missing.`); return; }
      let status: Order['call_center_status']; let orderStatus: OrderStatus;
      if (['no answer','noanswer','pending','not answered'].includes(raw)) return;
      if (['confirmed','confirm','yes','ok'].includes(raw)) { status='Confirmed'; orderStatus='Processing'; }
      else if (['cancel','cancelled','canceled'].includes(raw)) { status='Cancelled'; orderStatus='Cancelled'; }
      else { errors.push(`Row ${i+2}: Unknown result "${c[resultIdx]}". Upload processes Confirmed or Cancelled only.`); return; }
      updates.set(orderNo.toUpperCase(), {status, orderStatus});
    });

    const existing = new Set(orders.map(o => o.order_number.toUpperCase()));
    updates.forEach((_, id) => { if (!existing.has(id)) notFoundCount++; });
    setOrders(prev => prev.map(o => {
      const u = updates.get(o.order_number.toUpperCase());
      if (!u) return o;
      updatedCount++;
      return {...o, call_center_status:u.status, order_status:u.orderStatus, call_center_updated_at:new Date().toISOString()};
    }));
    logActivity({ action:'Call Center CSV Imported', module:'Orders', details:`Updated ${updates.size - notFoundCount}; not found ${notFoundCount}` });
    return { updatedCount: Math.max(0, updates.size - notFoundCount), notFoundCount, errors };
  };

  const importFardarCityList = async (csvText: string) => {
    const lines = String(csvText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { importedCount: 0 };
    const parse = (line: string) => line.split(',').map(v => v.trim().replace(/^\"|\"$/g, ''));
    const first = parse(lines[0]);
    const lower = first.map(v => v.toLowerCase());
    const nameAliases = ['city','city name','city_name','name','town','destination'];
    const codeAliases = ['district', 'dist', 'district name', 'city code','city_code','code','id'];
    let nameIdx = lower.findIndex(v => nameAliases.includes(v));
    let codeIdx = lower.findIndex(v => codeAliases.includes(v));
    const hasHeader = nameIdx >= 0 || codeIdx >= 0;
    if (nameIdx < 0) nameIdx = 0;
    const rows = (hasHeader ? lines.slice(1) : lines).map(parse).map(cols => ({
      name: String(cols[nameIdx] || '').trim(),
      district: codeIdx >= 0 ? String(cols[codeIdx] || '').trim() : (cols[1] || '').trim(),
    })).filter(r => r.name);
    const data = await sharedStaffRequest('/api/courier/fardar/cities/import', { method: 'POST', body: JSON.stringify({ cities: rows }) });
    setFardarCities(Array.isArray(data?.cities) ? data.cities : rows);
    logActivity({ action: 'Fardar City List Imported', module: 'Delivery', details: `${data?.count ?? rows.length} cities` });
    return { importedCount: Number(data?.count ?? rows.length) };
  };

  const saveFardarCityMapping = async (inputCity: string, fardarCity: string) => {
    const data = await sharedStaffRequest('/api/courier/fardar/city-mappings', { method: 'POST', body: JSON.stringify({ input_city: inputCity, fardar_city: fardarCity }) });
    const mapping = data?.mapping || { input_city: inputCity, fardar_city: fardarCity };
    setFardarCityMappings(prev => {
      const key = normalizeCity(inputCity);
      const next = prev.filter(m => normalizeCity(m.input_city) !== key);
      return [...next, mapping];
    });
  };

  const resolveFardarCity = (inputCity: string): { city?: string; source?: 'exact' | 'saved_mapping' } => {
    const key = normalizeCity(inputCity);
    if (!key) return {};
    const exact = fardarCities.find(c => normalizeCity(c.name) === key);
    if (exact) return { city: exact.name, source: 'exact' };
    const mapping = fardarCityMappings.find(m => normalizeCity(m.input_city) === key);
    if (mapping) {
      const stillValid = !fardarCities.length || fardarCities.some(c => normalizeCity(c.name) === normalizeCity(mapping.fardar_city));
      if (stillValid) return { city: mapping.fardar_city, source: 'saved_mapping' };
    }
    return {};
  };

  const setOrderFardarCity = async (orderId: string, fardarCity: string, saveMapping = true) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const official = fardarCities.find(c => normalizeCity(c.name) === normalizeCity(fardarCity));
    if (fardarCities.length && !official) throw new Error('Select a city from the uploaded Fardar city list.');
    const officialName = official?.name || fardarCity;
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, fardar_city: officialName, city_verified: true, city_mapping_source: 'manual' } : o));
    if (saveMapping && order.city) await saveFardarCityMapping(order.city, officialName);
    logActivity({ action: 'Fardar City Verified', module: 'Delivery', target_id: order.id, target_label: order.order_number, details: `${order.city} → ${officialName}` });
  };

  const importWaybillCsv = (csvText: string, courierName = settings.courier_provider || 'Fardar') => {
    const tokens = csvText
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map((v) => v.trim().replace(/^\"|\"$/g, ''))
      .filter(Boolean);

    const headerWords = new Set(['waybill', 'waybill_number', 'waybill no', 'tracking', 'tracking_number', 'awb', 'awb_number']);
    const uniqueIncoming = Array.from(new Set(tokens.filter((t) => !headerWords.has(t.toLowerCase()))));
    const existing = new Set(waybillRecords.map((w) => w.waybill_number.toLowerCase()));
    const fresh = uniqueIncoming.filter((n) => !existing.has(n.toLowerCase()));
    const now = new Date().toISOString();
    const additions: WaybillRecord[] = fresh.map((waybill, idx) => ({
      id: `wb-${Date.now()}-${idx}`,
      waybill_number: waybill,
      courier_name: courierName,
      status: 'Available',
      imported_at: now,
    }));
    if (additions.length) setWaybillRecords((prev) => [...prev, ...additions]);
    logActivity({ action: 'Waybill CSV Imported', module: 'Delivery', target_label: courierName, details: `Imported ${additions.length}, skipped ${uniqueIncoming.length - additions.length} duplicates` });
    return { importedCount: additions.length, duplicateCount: uniqueIncoming.length - additions.length };
  };

  const assignNextWaybill = (orderId: string, courierName = settings.courier_provider || 'Fardar'): string | null => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;
    if (order.waybill_number) return order.waybill_number;
    const resolvedCity = order.fardar_city || resolveFardarCity(order.city).city;
    if (fardarCities.length > 0 && !resolvedCity) return null;
    const next = waybillRecords.find((w) => w.status === 'Available' && w.courier_name === courierName);
    if (!next) return null;
    const now = new Date().toISOString();
    setWaybillRecords((prev) => prev.map((w) => w.id === next.id ? { ...w, status: 'Assigned', assigned_order_id: order.id, assigned_order_number: order.order_number, assigned_at: now } : w));
    setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, courier_name: courierName, waybill_number: next.waybill_number, fardar_city: resolvedCity || o.fardar_city, city_verified: fardarCities.length ? true : o.city_verified, shipment_mode: 'manual', tracking_status: 'Waybill Assigned', delivery_status: 'Ready to Ship' } : o));
    logActivity({ action: 'Waybill Assigned', module: 'Delivery', target_id: orderId, target_label: order.order_number, details: `${next.waybill_number} (${courierName})` });
    return next.waybill_number;
  };

  const unassignWaybill = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order?.waybill_number) return;
    if (order.invoice_locked || order.dispatch_status === 'Handed Over') {
      logActivity({ action: 'Waybill Unassign Blocked', module: 'Delivery', target_id: orderId, target_label: order.order_number, details: 'Invoice/dispatch lock protects the original barcode.' });
      return;
    }
    setWaybillRecords((prev) => prev.map((w) => w.waybill_number === order.waybill_number ? { ...w, status: 'Available', assigned_order_id: undefined, assigned_order_number: undefined, assigned_at: undefined } : w));
    setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, waybill_number: undefined, shipment_mode: undefined, tracking_status: 'Not Shipped', delivery_status: 'Pending' } : o));
    logActivity({ action: 'Waybill Unassigned', module: 'Delivery', target_id: orderId, target_label: order.order_number, details: order.waybill_number });
  };

  const markInvoicesGenerated = (orderIds: string[], generatedBy = adminUser?.name || 'Admin'): Order[] => {
    const uniqueIds = Array.from(new Set(orderIds)).slice(0, 50);
    const nowForBatch = new Date();
    const batchId = `PACK-${nowForBatch.getFullYear()}${String(nowForBatch.getMonth()+1).padStart(2,'0')}${String(nowForBatch.getDate()).padStart(2,'0')}-${String(nowForBatch.getHours()).padStart(2,'0')}${String(nowForBatch.getMinutes()).padStart(2,'0')}${String(nowForBatch.getSeconds()).padStart(2,'0')}`;
    const eligible = orders.filter((o) =>
      uniqueIds.includes(o.id) &&
      o.stock_allocated &&
      o.stock_status === 'Allocated' &&
      !o.is_duplicate_order &&
      !o.invoice_locked &&
      Boolean(o.waybill_number) &&
      o.order_status !== 'Cancelled'
    );
    if (!eligible.length) return [];
    const now = new Date().toISOString();
    const updates = new Map<string, Partial<Order>>(eligible.map((o) => [o.id, {
      invoice_number: o.invoice_number || `INV-${o.order_number.replace(/^ORA-/, '')}`,
      invoice_generated_at: o.invoice_generated_at || now,
      invoice_generated_by: o.invoice_generated_by || generatedBy,
      invoice_locked: true,
      invoice_pack_batch_id: o.invoice_pack_batch_id || batchId,
      invoice_pack_downloaded_at: undefined,
      invoice_pack_downloaded_by: undefined,
      invoice_payment_label_snapshot: o.invoice_payment_label_snapshot || deriveInvoicePaymentLabel(o, settings),
      invoice_advance_percentage_snapshot: o.invoice_advance_percentage_snapshot ?? Number(settings.advance_percentage ?? 50),
    }] as [string, Partial<Order>]));
    const generatedOrders = eligible.map((o) => ({ ...o, ...(updates.get(o.id) || {}) } as Order));
    setOrders((prev) => prev.map((o) => updates.has(o.id) ? { ...o, ...(updates.get(o.id) || {}) } : o));
    generatedOrders.forEach(mirrorOrderUpdate);
    eligible.forEach((o) => logActivity({ action: 'Invoice Generated & Locked', module: 'Invoices', target_id: o.id, target_label: o.order_number, details: o.waybill_number }));
    return generatedOrders;
  };

  const markInvoiceBatchDownloaded = async (
    orderIds: string[],
    downloadedBy = adminUser?.name || 'Packing Staff',
    downloadSet?: { date: string; number: number }
  ): Promise<void> => {
    const uniqueIds=Array.from(new Set(orderIds.map(String).filter(Boolean))).slice(0,50);
    if(!uniqueIds.length) return;

    const idSet=new Set(uniqueIds);
    const now=new Date().toISOString();

    // Use the EXISTING durable order PUT endpoint that already works elsewhere
    // in the system. This avoids depending on a new route that may return 404
    // on an older/local server process.
    const updatedOrders=orders
      .filter(o=>idSet.has(String(o.id)))
      .map(o=>({
        ...o,
        invoice_pack_downloaded_at:now,
        invoice_pack_downloaded_by:downloadedBy,
        invoice_pack_download_set_date: downloadSet?.date || o.invoice_pack_download_set_date,
        invoice_pack_download_set_number: downloadSet?.number || o.invoice_pack_download_set_number,
      }));

    if(updatedOrders.length!==uniqueIds.length){
      const foundIds=new Set(updatedOrders.map(o=>String(o.id)));
      const missing=uniqueIds.filter(id=>!foundIds.has(id));
      throw new Error(`Could not find ${missing.length} invoice order(s) in the current order list.`);
    }

    // Persist every order snapshot before changing the local UI state.
    // /api/orders/:id already writes to .ora-data/order-snapshots.json locally
    // and to order_snapshots when Supabase is configured.
    for(const order of updatedOrders){
      await sharedStaffRequest(`/api/orders/${encodeURIComponent(order.id)}`,{
        method:'PUT',
        body:JSON.stringify({order}),
      });
    }

    const updatedMap=new Map(updatedOrders.map(o=>[String(o.id),o] as [string,Order]));
    setOrders(prev=>prev.map(o=>updatedMap.get(String(o.id)) || o));

    const batchIds=Array.from(new Set(
      updatedOrders.map(o=>o.invoice_pack_batch_id).filter(Boolean)
    ));

    logActivity({
      action:'Packing Invoice Batch Downloaded',
      module:'Invoices',
      details:`${updatedOrders.length} invoice(s) • ${batchIds.join(', ') || 'Legacy Batch'} • ${downloadedBy}`
    });
  };



  const recordCodPayments = async (
    entries: { waybill: string; amount?: number; received_at?: string; reference?: string; source?: 'Fardar CSV' | 'Manual' | 'System' }[],
    recordedBy = adminUser?.name || 'Admin'
  ): Promise<{ updatedCount: number; notFound: string[] }> => {
    const normalize = (value: string) => String(value || '').replace(/\s+/g, '').toLowerCase();
    const unique = new Map<string, typeof entries[number]>();
    entries.forEach((entry) => {
      const key = normalize(entry.waybill);
      if (key) unique.set(key, entry);
    });

    const updates: Order[] = [];
    const notFound: string[] = [];
    for (const [key, entry] of unique.entries()) {
      const order = orders.find((candidate) => normalize(candidate.waybill_number || '') === key);
      if (!order) {
        notFound.push(entry.waybill);
        continue;
      }
      const parsedDate = entry.received_at && !Number.isNaN(new Date(entry.received_at).getTime())
        ? new Date(entry.received_at).toISOString()
        : new Date().toISOString();
      const updated: Order = {
        ...order,
        payment_status: 'Paid',
        payment_paid_type: 'COD',
        cod_payment_received: true,
        cod_payment_amount: Number.isFinite(Number(entry.amount)) && Number(entry.amount) > 0 ? Number(entry.amount) : Number(order.total_amount || 0),
        cod_payment_received_at: parsedDate,
        cod_payment_source: entry.source || 'Manual',
        cod_payment_reference: String(entry.reference || '').trim() || undefined,
      };
      await sharedStaffRequest(`/api/orders/${encodeURIComponent(updated.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ order: updated }),
      });
      updates.push(updated);
    }

    if (updates.length) {
      const map = new Map(updates.map((order) => [order.id, order]));
      setOrders((prev) => prev.map((order) => map.get(order.id) || order));
      logActivity({
        action: 'COD Payments Recorded',
        module: 'Payments',
        details: `${updates.length} COD payment(s) recorded • ${recordedBy}`,
      });
    }
    return { updatedCount: updates.length, notFound };
  };

  const scanDispatchBarcode = async (barcode: string, scannedBy = adminUser?.name || 'Admin'): Promise<{ success: boolean; message: string; order?: Order }> => {
    const clean = String(barcode || '').trim();
    if (!clean) return { success: false, message: 'Scan a waybill barcode first.' };
    const order = orders.find((o) => o.waybill_number === clean || o.order_number === clean);
    if (!order) return { success: false, message: `No order found for barcode ${clean}.` };
    if (!order.invoice_locked) return { success: false, message: `${order.order_number}: invoice is not generated yet.` };
    if (!order.stock_allocated) return { success: false, message: `${order.order_number}: stock is not allocated.` };
    if (order.dispatch_status === 'Handed Over') return { success: false, message: `${order.order_number} was already scanned for courier handover.` , order};
    try {
      const result = await sharedStaffRequest(`/api/orders/${encodeURIComponent(order.id)}/dispatch-scan`, {
        method: 'POST',
        body: JSON.stringify({ barcode: clean }),
      });
      const savedOrder = result?.order as Order | undefined;
      if (!savedOrder) return { success: false, message: 'The scan was not saved. Please retry.' };

      setOrders((prev) => prev.map((candidate) => candidate.id === savedOrder.id ? savedOrder : candidate));
      setWaybillRecords((prev) => prev.map((record) => record.waybill_number === savedOrder.waybill_number ? { ...record, status: 'Used' } : record));

      if (result?.duplicate) {
        return {
          success: false,
          message: String(result?.message || `${savedOrder.order_number} was already scanned for courier handover.`),
          order: savedOrder,
        };
      }

      logActivity({ action: 'Courier Handover Scanned', module: 'Dispatch', target_id: savedOrder.id, target_label: savedOrder.order_number, details: `${savedOrder.waybill_number} • ${savedOrder.dispatch_scanned_by || scannedBy}` });
      return {
        success: true,
        message: String(result?.message || `${savedOrder.order_number} marked Handed Over to Courier.`),
        order: savedOrder,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Scan was not saved. ${String(error?.message || 'Check the connection and retry.')}`,
      };
    }
  };

  const findReturnOrderByWaybill = (waybill: string): Order | null => {
    const clean=String(waybill||'').trim();
    if(!clean) return null;
    return orders.find(o=>String(o.waybill_number||'').trim()===clean) || null;
  };

  const confirmReturn = (input: {
    orderId:string; checkedBy?:string; items:{product_id:string;variant_id?:string;good_qty:number;damaged_qty:number}[]; wrong_item_note?:string; notes?:string;
  }) => {
    const order=orders.find(o=>o.id===input.orderId);
    if(!order)return{success:false,message:'Return order not found.'};
    if(!order.waybill_number)return{success:false,message:'This order has no waybill.'};
    if(returnRecords.some(r=>r.order_id===order.id))return{success:false,message:'This return was already verified.'};
    const checkedAt=new Date().toISOString(),checkedBy=input.checkedBy||adminUser?.name||'Return Staff';
    let issueFound=Boolean(String(input.wrong_item_note||'').trim()); const rows:ReturnRecord['items']=[]; const history:StockHistory[]=[];
    const productMap=new Map(cloneInventoryProducts(products).map(p=>[p.id,p] as [string,Product]));
    const restoreInventory=(productId:string,variantId:string|undefined,qty:number,label:string)=>{
      if(qty<=0)return; const p=productMap.get(productId); if(!p)return;
      if(variantId){const target=variantById(p,variantId);if(!target)return;const before=Number(target.stock_quantity||0),after=before+qty;p.variants=(p.variants||[]).map(v=>v.id===variantId?{...v,stock_quantity:after,status:'Active'}:v);p.stock_quantity=(p.variants||[]).reduce((n,v)=>n+Number(v.stock_quantity||0),0);p.status='Active';history.push({id:`stk-return-${Date.now()}-${productId}-${variantId}`,product_id:productId,product_name:label,change_type:'Increase',quantity:qty,previous_stock:before,new_stock:after,reason:`Verified good return from ${order.order_number} / ${order.waybill_number}`,performed_by:checkedBy,created_at:checkedAt});}
      else{const before=Number(p.stock_quantity||0),after=before+qty;p.stock_quantity=after;p.status='Active';history.push({id:`stk-return-${Date.now()}-${productId}`,product_id:productId,product_name:label,change_type:'Increase',quantity:qty,previous_stock:before,new_stock:after,reason:`Verified good return from ${order.order_number} / ${order.waybill_number}`,performed_by:checkedBy,created_at:checkedAt});}
    };

    order.items.forEach(expected=>{
      const entered=input.items.find(x=>x.product_id===expected.product_id && String(x.variant_id||'')===String(expected.variant_id||'')) || input.items.find(x=>x.product_id===expected.product_id && !expected.variant_id);
      const good=Math.max(0,Math.min(expected.quantity,Number(entered?.good_qty||0))),damaged=Math.max(0,Math.min(expected.quantity-good,Number(entered?.damaged_qty||0))),missing=Math.max(0,expected.quantity-good-damaged);
      if(missing>0||damaged>0)issueFound=true;
      rows.push({product_id:expected.product_id,variant_id:expected.variant_id,variant_name:expected.variant_name,sku:expected.sku,product_name:expected.product_name,expected_qty:expected.quantity,good_qty:good,missing_qty:missing,damaged_qty:damaged});
      if(good>0){
        if(expected.product_type==='bundle'&&expected.bundle_components?.length){
          expected.bundle_components.forEach(c=>restoreInventory(c.product_id,c.variant_id,good*Math.max(1,Number(c.quantity_per_bundle||1)),`${c.product_name}${c.variant_name?` - ${c.variant_name}`:''}`));
        }else restoreInventory(expected.product_id,expected.variant_id,good,`${expected.product_name}${expected.variant_name?` - ${expected.variant_name}`:''}`);
      }
    });
    const record:ReturnRecord={id:`ret-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,order_id:order.id,order_number:order.order_number,waybill_number:order.waybill_number,checked_by:checkedBy,checked_at:checkedAt,status:issueFound?'Issue Found':'Verified',items:rows,wrong_item_note:String(input.wrong_item_note||'').trim()||undefined,notes:String(input.notes||'').trim()||undefined};
    setProducts(Array.from(productMap.values())); if(history.length)setStockHistory(prev=>[...history,...prev]); setReturnRecords(prev=>[record,...prev]);
    const updatedOrder:Order={...order,return_status:issueFound?'Issue Found':'Verified',return_received_at:checkedAt,return_checked_by:checkedBy,delivery_status:issueFound?'Return Received - Issue':'Return Received - Verified'};
    setOrders(prev=>prev.map(o=>o.id===order.id?updatedOrder:o)); mirrorOrderUpdate(updatedOrder);
    logActivity({action:issueFound?'Return Verified - Issue Found':'Return Verified',module:'Returns',target_id:order.id,target_label:order.order_number,details:`${order.waybill_number} • Good: ${rows.reduce((n,r)=>n+r.good_qty,0)} • Missing: ${rows.reduce((n,r)=>n+r.missing_qty,0)} • Damaged: ${rows.reduce((n,r)=>n+r.damaged_qty,0)}`});
    return{success:true,message:issueFound?'Return saved with issue(s). Only good received items were added to the exact variant/component stock.':'Return verified. Good items were added back to the exact variant/component stock.'};
  };

  const syncOrderToSheet = async (orderId: string): Promise<boolean> => {
    const targetOrder = orders.find((o) => o.id === orderId);
    if (!targetOrder || targetOrder.order_source === 'Manual Admin' || !settings.google_sheet_webhook_url) return false;
    if (targetOrder.order_source === 'Website' && targetOrder.payment_method === 'Bank Payment' && targetOrder.payment_verification_status !== 'Approved') return false;

    const res = await syncOrderToGoogleSheets(targetOrder, settings.google_sheet_webhook_url, settings, products);
    if (res.success) {
      const syncedOrder={ ...targetOrder, is_synced_google_sheets:true, synced_at:new Date().toISOString() };
      setOrders((prev) => prev.map((o) => o.id === orderId ? syncedOrder : o));
      mirrorOrderUpdate(syncedOrder);
      logActivity({ action: 'Order Synced to Google Sheets', module: 'Google Sheets', target_id: orderId, target_label: targetOrder.order_number });
      return true;
    }
    return false;
  };

  const syncAllUnsyncedOrders = async (): Promise<number> => {
    const unsynced = orders.filter((o) => o.order_source !== 'Manual Admin' && !o.is_synced_google_sheets && !(o.order_source === 'Website' && o.payment_method === 'Bank Payment' && o.payment_verification_status !== 'Approved'));
    if(!unsynced.length || !settings.google_sheet_webhook_url) return 0;
    let count=0;
    for(let i=0;i<unsynced.length;i+=SHEET_BATCH_SIZE){
      const batch=unsynced.slice(i,i+SHEET_BATCH_SIZE);
      const res=await syncOrdersBatchToGoogleSheets(batch,settings.google_sheet_webhook_url,settings);
      if(!res.success) continue;
      count+=batch.length;
      const syncedAt=new Date().toISOString(),ids=new Set(batch.map(o=>o.id));
      setOrders(prev=>prev.map(o=>ids.has(o.id)?{...o,is_synced_google_sheets:true,synced_at:syncedAt}:o));
    }
    if(count) logActivity({ action: 'Orders Batch Synced to Google Sheets', module: 'Google Sheets', details:`${count} order(s) synced in batches of up to ${SHEET_BATCH_SIZE}.` });
    return count;
  };

  const createWebsiteTestOrder = async (itemCount: 1 | 5 = 1): Promise<Order | null> => {
    const available = products.filter(p => p.status !== 'Draft');
    if (!available.length) return null;
    const existingNums = orders
      .filter(o => o.is_test_order)
      .map(o => Number(String(o.order_number).match(/^WEB-TEST-(\d+)$/)?.[1] || 0));
    const testNo = Math.max(0, ...existingNums) + 1;
    const count = itemCount === 5 ? 5 : 1;
    const qtyPattern = [1, 2, 1, 3, 1];

    // Prefer a mix of normal/combo/variant products for the 5-item test so one click
    // exercises grouping, Qty edits and the Variant/Color dropdown. If the catalog
    // has fewer than 5 products we safely cycle them; these orders never consume stock.
    const variantProduct = available.find(p => normalizedProductType(p) === 'variant' && (p.variants || []).length);
    const orderedProducts = [...available];
    if (count === 5 && variantProduct) {
      const idx = orderedProducts.findIndex(p => p.id === variantProduct.id);
      if (idx > 0) orderedProducts.unshift(...orderedProducts.splice(idx, 1));
    }
    const testItems = Array.from({ length: count }, (_, i) => {
      const product = orderedProducts[i % orderedProducts.length];
      const testVariant = normalizedProductType(product) === 'variant' ? (product.variants || [])[0] : undefined;
      return buildOrderItemSnapshot(product, qtyPattern[i] || 1, settings, testVariant, products);
    });
    const subtotal = testItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const totalQty = testItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0);
    const discountRate = getMultiBuyDiscountRate(totalQty);
    const discount = Math.round(subtotal * (discountRate / 100) * 100) / 100;
    const deliveryFee = settings.free_delivery_enabled ? 0 : Math.max(0, Number(settings.delivery_fee || 0));
    const totalAmount = Math.round(Math.max(0, subtotal - discount + deliveryFee) * 100) / 100;
    const now = new Date().toISOString();

    const testOrder: Order = {
      id: `test-web-${Date.now()}-${count}`,
      order_number: `WEB-TEST-${String(testNo).padStart(3,'0')}`,
      customer_name: count === 5 ? 'TEST MULTI ITEM CUSTOMER' : 'TEST CUSTOMER',
      phone: '0770000000',
      whatsapp: '0770000000',
      address: 'TEST ADDRESS - DO NOT DISPATCH',
      city: 'Colombo',
      payment_method: 'COD',
      payment_status: 'Pending',
      order_status: 'New Orders',
      items: testItems,
      subtotal,
      delivery_fee: deliveryFee,
      internal_delivery_fee: Math.max(0, Number(settings.delivery_fee || 0)),
      delivery_included_in_item_price: Boolean(settings.free_delivery_enabled),
      special_offer_discount: discount,
      gift_wrap_selected: false,
      gift_wrap_fee: 0,
      total_amount: totalAmount,
      is_advance_required: false,
      advance_amount: 0,
      advance_confirmed: false,
      order_source: 'Website',
      is_synced_google_sheets: false,
      courier_name: settings.courier_provider || 'Fardar',
      tracking_status: 'Not Shipped',
      delivery_status: 'Pending',
      stock_status: 'Waiting for Stock',
      stock_allocated: false,
      call_center_status: 'Pending',
      is_duplicate_order: false,
      dispatch_status: 'Not Scanned',
      notes: count === 5 ? 'SYSTEM 5-ITEM TEST ORDER - DO NOT DISPATCH' : 'SYSTEM TEST ORDER - DO NOT DISPATCH',
      is_test_order: true,
      created_at: now,
    };

    // Test buttons are an end-to-end Sheet check, so do not report completion
    // until the Worker has received the Apps Script confirmation (or timeout).
    const savedTestOrder=await publicOrderSave(testOrder, undefined, false, true);
    setOrders(prev => [savedTestOrder, ...prev.filter(o=>o.id!==savedTestOrder.id&&o.order_number!==savedTestOrder.order_number)]);
    logActivity({ action: count === 5 ? 'Website 5-Item Test Order Created' : 'Website Test Order Created', module:'Google Sheets', target_id:savedTestOrder.id, target_label:savedTestOrder.order_number });
    return savedTestOrder;
  };

  const createSourceTestOrder = async (source:'Facebook Ads'|'TikTok Ads'):Promise<Order|null> => {
    const product=products.find(p=>p.status!=='Draft'); if(!product)return null;
    const result=await importBulkOrders([{
      platform_lead_id:`TEST-${source==='Facebook Ads'?'FB':'TK'}-${Date.now()}`,
      lead_created_at:new Date().toISOString(),
      item_code:product.sku,quantity:1,customer_name:'TEST LEAD CUSTOMER',phone:'0770000000',whatsapp:'0770000000',
      address:'TEST ADDRESS - DO NOT DISPATCH',city:'Colombo',order_source:source,payment_method:'COD',notes:'SYSTEM TEST LEAD - select variant in Google Sheet then Confirm Upload',is_confirmed:false,
    }]);
    const sheetError=result.errors.find((msg)=>/sheet sync|google sheet/i.test(String(msg||'')));
    if(sheetError) throw new Error(sheetError);
    const number=result.importedOrderNumbers[0];
    return number ? ({ id:`pending-${number}`, order_number:number, is_synced_google_sheets:true } as Order) : null;
  };

  const isTestOrderForSource = (order: Order, source: 'Website' | 'Facebook Ads' | 'TikTok Ads') => {
    if (order.order_source !== source) return false;
    if (source === 'Website') return Boolean(order.is_test_order || /^WEB-TEST-/i.test(order.order_number));
    const lead = String(order.platform_lead_id || '');
    const notes = String(order.notes || '');
    const expectedPrefix = source === 'Facebook Ads' ? 'TEST-FB-' : 'TEST-TK-';
    return Boolean(order.is_test_order || lead.toUpperCase().startsWith(expectedPrefix) || /SYSTEM TEST LEAD/i.test(notes));
  };

  const deleteTestOrdersForSource = async (source: 'Website' | 'Facebook Ads' | 'TikTok Ads'): Promise<number> => {
    const testOrders = orders.filter(o => isTestOrderForSource(o, source));
    let count = testOrders.length;
    if (source === 'Website' && !count) return 0;

    // Website keeps its established individual-delete path. FB/TikTok use one
    // isolated server cleanup that physically verifies Sheet removal before the
    // durable test snapshots are deleted.
    let deletedIds = new Set(testOrders.map(o=>o.id));
    try{
      if(source==='Website'){
        await Promise.all(testOrders.map(order=>sharedStaffRequest(`/api/orders/${encodeURIComponent(order.id)}`,{
          method:'DELETE',body:JSON.stringify({reason:'Delete test order'}),
        })));
      }else{
        const sourceKey=source==='Facebook Ads'?'facebook':'tiktok';
        const result=await sharedStaffRequest(`/api/test-orders/${sourceKey}`,{method:'DELETE'});
        if(!result?.ok || result?.sheet_sync?.ok===false) throw new Error('Google Sheet test cleanup was not verified.');
        const serverIds=Array.isArray(result?.deleted_ids)?result.deleted_ids.map(String):[];
        deletedIds=new Set(serverIds);
        count=Math.max(testOrders.length,Math.max(0,Number(result?.deleted_count||0)));
      }
    }catch(e:any){
      throw new Error(e?.message || 'Test order cleanup failed on the server.');
    }

    const inventoryMap=new Map(cloneInventoryProducts(products).map(p=>[p.id,p] as [string,Product]));
    testOrders.filter(o=>o.stock_allocated).forEach(o=>o.items.forEach(item=>inventoryRequirementsForOrderItem(item).forEach(req=>{
      const product=inventoryMap.get(req.product_id); if(!product)return;
      if(req.variant_id){
        const v=variantById(product,req.variant_id); if(!v)return; const after=Number(v.stock_quantity||0)+req.quantity;
        product.variants=(product.variants||[]).map(x=>x.id===v.id?{...x,stock_quantity:after,status:'Active'}:x);
        product.stock_quantity=(product.variants||[]).reduce((n,x)=>n+Number(x.stock_quantity||0),0); product.status='Active';
      }else{ product.stock_quantity=Number(product.stock_quantity||0)+req.quantity; product.status='Active'; }
    })));
    setProducts(Array.from(inventoryMap.values()));

    const testWaybills = new Set(testOrders.map(o => o.waybill_number).filter(Boolean) as string[]);
    if (testWaybills.size) {
      setWaybillRecords(prev => prev.map(w => testWaybills.has(w.waybill_number)
        ? {...w, status:'Available', assigned_order_id:undefined, assigned_order_number:undefined, assigned_at:undefined}
        : w
      ));
    }

    setStockHistory(prev => prev.filter(h => !testOrders.some(o => h.reason.includes(o.order_number))));
    setOrders(prev => prev.filter(o => source==='Website'
      ? !deletedIds.has(o.id)
      : !isTestOrderForSource(o,source)
    ));
    const sourceLabel = source === 'Website' ? 'Website' : source === 'Facebook Ads' ? 'Facebook' : 'TikTok';
    logActivity({ action:`${sourceLabel} Test Orders Deleted & Rolled Back`, module:'Google Sheets', details:`Deleted ${count} ${sourceLabel} test order(s); server + Sheet cleanup completed; any test stock/waybills restored.` });
    return count;
  };

  const deleteWebsiteTestOrders = async (): Promise<number> => deleteTestOrdersForSource('Website');
  const deleteSourceTestOrders = async (source:'Facebook Ads'|'TikTok Ads'):Promise<number> => deleteTestOrdersForSource(source);

  const deleteOrder = async (orderId: string, reason: string, deletedBy = adminUser?.name || 'Admin') => {
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 3) return { success:false, message:'Please enter a delete reason.' };
    const order = orders.find((o) => o.id === orderId);
    if (!order) return { success:false, message:'Order not found.' };
    if (order.order_status === 'Shipped' || order.order_status === 'Delivered' || order.dispatch_status === 'Handed Over') {
      return { success:false, message:'Shipped / delivered orders cannot be deleted. Use the delivery/return flow so stock and payment history stay correct.' };
    }
    if (!adminUser || adminUser.role !== 'admin') {
      return { success:false, message:'Only the Super Admin can delete an order.' };
    }

    // Delete the durable snapshot first. If this fails, do not change local stock/order state.
    try {
      await sharedStaffRequest(`/api/orders/${encodeURIComponent(orderId)}`, {
        method:'DELETE',
        body:JSON.stringify({ reason:cleanReason }),
      });
    } catch (error:any) {
      return { success:false, message:error?.message || 'Order delete failed.' };
    }

    // Restore the exact variant/component stock only when this order consumed physical stock.
    if (order.stock_allocated) {
      const deletedAt=new Date().toISOString(); const map=new Map(cloneInventoryProducts(products).map(p=>[p.id,p] as [string,Product])); const logs:StockHistory[]=[];
      for(const item of order.items){
        for(const req of inventoryRequirementsForOrderItem(item)){
          const product=map.get(req.product_id); if(!product)continue;
          if(req.variant_id){
            const v=variantById(product,req.variant_id); if(!v)continue; const before=Number(v.stock_quantity||0),after=before+req.quantity;
            product.variants=(product.variants||[]).map(x=>x.id===v.id?{...x,stock_quantity:after,status:'Active'}:x); product.stock_quantity=(product.variants||[]).reduce((n,x)=>n+Number(x.stock_quantity||0),0); product.status='Active';
            logs.push({id:`stock-del-${Date.now()}-${product.id}-${v.id}`,product_id:product.id,product_name:`${product.name_en} - ${v.option_value}`,change_type:'Adjustment',quantity:req.quantity,previous_stock:before,new_stock:after,reason:`Deleted Order Rollback • ${order.order_number} • ${cleanReason}`,performed_by:deletedBy,created_at:deletedAt});
          }else{
            const before=Number(product.stock_quantity||0),after=before+req.quantity; product.stock_quantity=after; product.status='Active';
            logs.push({id:`stock-del-${Date.now()}-${product.id}`,product_id:product.id,product_name:req.label,change_type:'Adjustment',quantity:req.quantity,previous_stock:before,new_stock:after,reason:`Deleted Order Rollback • ${order.order_number} • ${cleanReason}`,performed_by:deletedBy,created_at:deletedAt});
          }
        }
      }
      setProducts(Array.from(map.values())); if(logs.length)setStockHistory(prev=>[...logs,...prev].slice(0,5000));
    }

    // Release a waybill that had only been reserved for this not-yet-dispatched order.
    if (order.waybill_number) {
      setWaybillRecords((prev) => prev.map((record) => record.waybill_number === order.waybill_number
        ? { ...record, status:'Available', assigned_order_id:undefined, assigned_order_number:undefined, assigned_at:undefined }
        : record));
    }

    // Keep customer totals sensible after an accidental/unwanted order is removed.
    setCustomers((prev) => prev.map((customer) => customer.phone === order.phone
      ? { ...customer, total_orders:Math.max(0, Number(customer.total_orders || 0) - 1), total_spent:Math.max(0, Number(customer.total_spent || 0) - Number(order.total_amount || 0)) }
      : customer));
    setOrders((prev) => prev.filter((o) => o.id !== orderId));

    const sheetDeleted = true; // server DELETE endpoint mirrors Sheet cleanup too.

    logActivity({
      action:'Order Deleted',
      module:'Orders',
      target_id:order.id,
      target_label:order.order_number,
      details:`Reason: ${cleanReason} • Deleted by: ${deletedBy} • Server/Sheet cleanup handled together`,
    });

    return {
      success:true,
      sheetDeleted,
      message:`${order.order_number} deleted. Reason recorded: ${cleanReason}. Google Sheet cleanup handled by the server.`,
    };
  };

  // Product CRUD
  // Auto-priced Combo Packs are virtual products. Recalculate only their saved
  // price/cost snapshot from the exact component codes; physical stock stays on
  // the component products and continues through the existing FIFO allocator.
  const repriceAutoBundles=(rows:Product[], pricingSettings:StoreSettings=settings)=>{
    const productMap=new Map(rows.map(p=>[p.id,p] as [string,Product]));
    const includedDelivery=pricingSettings.free_delivery_enabled?Math.max(0,Number(pricingSettings.delivery_fee||0)):0;
    return rows.map(bundle=>{
      if(normalizedProductType(bundle)!=='bundle' || bundle.bundle_auto_price!==true || !(bundle.bundle_components||[]).length) return bundle;
      const componentDisplayTotal=(bundle.bundle_components||[]).reduce((sum,component)=>{
        const child=productMap.get(component.product_id); if(!child)return sum;
        const variant=variantById(child,component.variant_id);
        return sum + displayUnitPrice(child,pricingSettings,variant)*Math.max(1,Number(component.quantity||1));
      },0);
      const discount=Math.max(0,Number(bundle.bundle_discount_amount ?? 50));
      const customerDisplay=Math.max(0,componentDisplayTotal-discount);
      const baseSelling=Math.max(0,customerDisplay-includedDelivery);
      const buying=(bundle.bundle_components||[]).reduce((sum,component)=>{
        const child=productMap.get(component.product_id); if(!child)return sum;
        const variant=variantById(child,component.variant_id);
        return sum + effectiveBuyingPrice(child,variant)*Math.max(1,Number(component.quantity||1));
      },0);
      if(Math.abs(Number(bundle.selling_price||0)-baseSelling)<0.001 && Math.abs(Number(bundle.buying_price||0)-buying)<0.001) return bundle;
      return {...bundle,buying_price:buying,selling_price:baseSelling,discount_price:baseSelling,discount_enabled:false};
    });
  };
  const allCurrentSkus=(excludeProductId?:string)=>new Set(products.filter(p=>p.id!==excludeProductId).flatMap(p=>[String(p.sku||'').toUpperCase(),...(p.variants||[]).map(v=>String(v.sku||'').toUpperCase())]).filter(Boolean));
  const validateProductSkus=(product:Product,excludeProductId?:string)=>{ const used=allCurrentSkus(excludeProductId); const own=new Set<string>(); for(const code of [product.sku,...(product.variants||[]).map(v=>v.sku)]){ const sku=String(code||'').trim().toUpperCase(); if(!sku)throw new Error('Main / Variant code cannot be empty.'); if(used.has(sku)||own.has(sku))throw new Error(`Duplicate Item Code: ${sku}`); own.add(sku); } };

  const addProduct=(productData:Omit<Product,'id'|'created_at'>):Product=>{ const raw:Product={...productData,id:`prod-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,created_at:new Date().toISOString(),sku:String(productData.sku||`S${String(products.length+1).padStart(4,'0')}`).trim().toUpperCase()}; const next=normalizeProductForStorage(raw); validateProductSkus(next); setProducts(prev=>repriceAutoBundles([next,...prev])); logActivity({action:'Product Added',module:'Products',target_id:next.id,target_label:next.name_en,details:`Main Code: ${next.sku} • ${normalizedProductType(next)}`}); return next; };
  const updateProduct=(updatedProduct:Product)=>{ const clean=normalizeProductForStorage(updatedProduct); validateProductSkus(clean,clean.id); setProducts(prev=>repriceAutoBundles(prev.map(p=>p.id===clean.id?clean:p))); logActivity({action:'Product Updated',module:'Products',target_id:clean.id,target_label:clean.name_en}); };
  const deleteProduct=(productId:string)=>{ const target=products.find(p=>p.id===productId); if(!target)return; const used=products.find(p=>p.id!==productId&&(p.bundle_components||[]).some(c=>c.product_id===productId)); if(used)throw new Error(`Cannot delete ${target.name_en}; it is used inside bundle ${used.name_en}. Remove it from that bundle first.`); setProducts(prev=>prev.filter(p=>p.id!==productId)); logActivity({action:'Product Deleted',module:'Products',target_id:productId,target_label:target.name_en,details:'Current catalog removed; historical order/invoice snapshots are preserved.'}); };

  const restoreProductBackup = async (backup: unknown) => {
    if (adminUser?.role !== 'admin') throw new Error('Super Admin access is required to import a product backup.');
    if (products.length || categories.length) {
      throw new Error('For safety, Product Import works only after Products and Categories are both empty.');
    }
    const data = await sharedStaffRequest('/api/admin/storefront/product-backup/restore', {
      method:'POST',
      body:JSON.stringify({ backup }),
    });
    if (!data?.ok || !data?.state) throw new Error('Server did not confirm the product backup restore.');
    applySharedStorefrontState(data.state, true);
    const restoredProducts = Number(data.restored_products || 0);
    const restoredCategories = Number(data.restored_categories || 0);
    logActivity({
      action:'Product Backup Restored',
      module:'Products',
      details:`${restoredProducts} product(s) and ${restoredCategories} category(s) restored after full validation.`,
    });
    return { restoredProducts, restoredCategories };
  };

  const adjustStock=(productId:string,quantityChange:number,reason:string,performedBy='Admin',variantId?:string)=>{ const now=new Date().toISOString(); setProducts(prev=>prev.map(p=>{ if(p.id!==productId)return p; if(normalizedProductType(p)==='bundle')throw new Error('Bundle stock is calculated from component products. Adjust component stock instead.'); if(normalizedProductType(p)==='variant'){ if(!variantId)throw new Error('Select the exact color / variant before changing stock.'); const target=variantById(p,variantId); if(!target)throw new Error('Variant not found.'); const before=Number(target.stock_quantity||0),after=Math.max(0,before+quantityChange); const variants=(p.variants||[]).map(v=>v.id===variantId?{...v,stock_quantity:after,status:(after<=0?'Out of Stock':'Active') as Product['status']}:v); const total=variants.reduce((n,v)=>n+Number(v.stock_quantity||0),0); setStockHistory(logs=>[{id:`stk-${Date.now()}-${variantId}`,product_id:p.id,product_name:`${p.name_en} - ${target.option_value}`,change_type:quantityChange>=0?'Increase':'Decrease',quantity:Math.abs(quantityChange),previous_stock:before,new_stock:after,reason,performed_by:performedBy,created_at:now},...logs]); logActivity({action:'Variant Stock Adjusted',module:'Stock',target_id:p.id,target_label:`${p.name_en} - ${target.option_value}`,details:`${quantityChange>=0?'+':''}${quantityChange}; ${reason}`}); return {...p,variants,stock_quantity:total,status:total<=0?'Out of Stock':'Active'}; } const before=Number(p.stock_quantity||0),after=Math.max(0,before+quantityChange); setStockHistory(logs=>[{id:`stk-${Date.now()}`,product_id:p.id,product_name:p.name_en,change_type:quantityChange>=0?'Increase':'Decrease',quantity:Math.abs(quantityChange),previous_stock:before,new_stock:after,reason,performed_by:performedBy,created_at:now},...logs]); return {...p,stock_quantity:after,status:after<=0?'Out of Stock':'Active'}; })); };

  const addPurchaseOrder=(poData:{supplier_name:string;product_id:string;variant_id?:string;quantity_added:number;unit_buying_price:number;invoice_ref?:string;bill_image_url?:string;notes?:string;performed_by?:string;po_number?:string;})=>{
    const product=products.find(p=>p.id===poData.product_id);
    if(!product)throw new Error('Selected product was not found.');
    if(poData.quantity_added<=0)throw new Error('Purchase quantity must be greater than zero.');
    if(normalizedProductType(product)==='bundle')throw new Error('Add purchases to component products, not the bundle.');
    const variant=poData.variant_id?variantById(product,poData.variant_id):undefined;
    if(normalizedProductType(product)==='variant'&&!variant)throw new Error('Select the exact variant/color for this purchase.');
    const now=new Date().toISOString(),before=variant?Number(variant.stock_quantity||0):Number(product.stock_quantity||0),after=before+poData.quantity_added,poNumber=poData.po_number?.trim()||`PO-${new Date().getFullYear()}-${String(purchaseOrders.length+1).padStart(4,'0')}`;
    const purchase:PurchaseOrder={id:`po-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,po_number:poNumber,supplier_name:poData.supplier_name.trim(),product_id:product.id,product_name:product.name_en,sku:variant?.sku||product.sku,variant_id:variant?.id,variant_name:variant?.option_value,variant_sku:variant?.sku,quantity_added:poData.quantity_added,unit_buying_price:poData.unit_buying_price,total_cost:poData.quantity_added*poData.unit_buying_price,invoice_ref:poData.invoice_ref?.trim(),bill_image_url:poData.bill_image_url?.trim(),notes:poData.notes?.trim(),performed_by:poData.performed_by||adminUser?.name||'Admin',created_at:now};
    setPurchaseOrders(prev=>[purchase,...prev]);
    // A Purchase / Stock In records the bill cost and increases physical stock only.
    // It must never change the saved product/variant buying price, selling price,
    // discount/offer state, or auto-priced bundle prices. Price changes stay an
    // explicit manual action in Supplier Price / Special Offer or Product Edit.
    setProducts(prev=>prev.map(p=>{
      if(p.id!==product.id)return p;
      if(variant){
        const variants=(p.variants||[]).map(v=>
          v.id===variant.id ? {...v,stock_quantity:after,status:'Active' as const} : v
        );
        return{...p,variants,stock_quantity:variants.reduce((n,v)=>n+Number(v.stock_quantity||0),0),status:'Active'};
      }
      return{...p,stock_quantity:after,status:'Active'};
    }));
    setStockHistory(prev=>[{id:`stk-purchase-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,product_id:product.id,product_name:`${product.name_en}${variant?` - ${variant.option_value}`:''}`,change_type:'Purchase Inflow',quantity:poData.quantity_added,previous_stock:before,new_stock:after,reason:`${poNumber} • ${poData.supplier_name}`,performed_by:poData.performed_by||adminUser?.name||'Admin',created_at:now},...prev]);
  };

  // Category CRUD
  const addCategory = (categoryData: Omit<Category, 'id'>): Category => {
    const newCat: Category = {
      ...categoryData,
      id: `cat-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    };
    setCategories((prev) => [...prev, newCat]);
    logActivity({ action: 'Category Added', module: 'Categories', target_id: newCat.id, target_label: newCat.name_en });
    return newCat;
  };

  const updateCategory = (updatedCategory: Category) => {
    setCategories((prev) => prev.map((c) => (c.id === updatedCategory.id ? updatedCategory : c)));
    logActivity({ action: 'Category Updated', module: 'Categories', target_id: updatedCategory.id, target_label: updatedCategory.name_en });
  };

  const deleteCategory = (categoryId: string) => {
    const target = categories.find((c) => c.id === categoryId);
    setCategories((prev) => prev.filter((c) => c.id !== categoryId));
    logActivity({ action: 'Category Deleted', module: 'Categories', target_id: categoryId, target_label: target?.name_en || categoryId });
  };

  // Settings
  const updateSettings = (newSettings: Partial<StoreSettings>) => {
    const nextSettings={...settings,...newSettings};
    const changedEntries = Object.entries(newSettings).filter(([key,value]) => {
      try { return JSON.stringify((settings as any)[key]) !== JSON.stringify(value); }
      catch { return (settings as any)[key] !== value; }
    });
    setSettings(nextSettings);
    if ('delivery_fee' in newSettings || 'free_delivery_enabled' in newSettings) {
      setProducts((prev)=>repriceAutoBundles(prev,nextSettings));
    }
    if (changedEntries.length) {
      const label = (key:string) => key.replace(/^invoice_/,'Invoice ').replace(/_/g,' ').replace(/\b\w/g,(c)=>c.toUpperCase());
      const brief = (value:any) => {
        if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
        if (value === null || value === undefined || value === '') return 'Blank';
        const text = String(value).replace(/\s+/g,' ').trim();
        return text.length > 34 ? `${text.slice(0,31)}...` : text;
      };
      const details = changedEntries.length <= 3
        ? changedEntries.map(([key,value]) => `${label(key)}: ${brief((settings as any)[key])} → ${brief(value)}`).join(' • ')
        : `${changedEntries.length} settings changed: ${changedEntries.slice(0,6).map(([key])=>label(key)).join(', ')}${changedEntries.length>6?'…':''}`;
      logActivity({ action: 'Settings Updated', module: 'Settings', details });
    }
  };

  return (
    <StoreContext.Provider
      value={{
        language,
        setLanguage,
        products,
        categories,
        cart,
        orders,
        customers,
        stockHistory,
        purchaseOrders,
        waybillRecords,
        returnRecords,
        findReturnOrderByWaybill,
        confirmReturn,
        fardarCities,
        fardarCityMappings,
        refreshFardarCities,
        importFardarCityList,
        saveFardarCityMapping,
        resolveFardarCity,
        setOrderFardarCity,
        blockedCustomers,
        activityLogs,
        logActivity,
        blockCustomer,
        unblockCustomer,
        isCustomerBlocked,
        addPurchaseOrder,
        settings,
        sharedStoreReady,
        searchQuery,
        setSearchQuery,
        selectedCategorySlug,
        setSelectedCategorySlug,
        isCartOpen,
        setIsCartOpen,
        isCheckoutOpen,
        setIsCheckoutOpen,
        startBuyNow,
        closeCheckoutAndRestoreCart,
        isTrackingOpen,
        setIsTrackingOpen,
        isBrandModalOpen,
        setIsBrandModalOpen,
        selectedProduct,
        setSelectedProduct,
        lastPlacedOrder,
        setLastPlacedOrder,
        isAdminView,
        setIsAdminView,
        adminUser,
        staffUsers,
        loginAdmin,
        logoutAdmin,
        updateAdminPassword,
        addStaffAccount,
        deleteStaffAccount,
        updateStaffAccount,
        resetSystemData,
        clearOperationalTestData,
        fullLiveStartReset,
        refreshOrdersFromServer,
        addToCart,
        removeFromCart,
        updateCartQuantity,
        clearCart,
        cartSubtotal,
        cartItemCount,
        cartSpecialOfferDiscount,
        cartMultiBuyDiscountRate,
        cartFinalProductsTotal,
        placeOrder,
        importBulkOrders,
        updateOrderStatus,
        updateOrderDeliveryDetails,
        updatePaymentStatus,
        confirmAdvancePayment,
        reviewPayment,
        importWaybillCsv,
        importCallCenterResultsCsv,
        importWebsiteConfirmedCsv,
        importConfirmedOrdersCsv,
        assignNextWaybill,
        unassignWaybill,
        markInvoicesGenerated,
        markInvoiceBatchDownloaded,
        recordCodPayments,
        scanDispatchBarcode,
        syncOrderToSheet,
        syncAllUnsyncedOrders,
        createWebsiteTestOrder,
        createSourceTestOrder,
        deleteWebsiteTestOrders,
        deleteSourceTestOrders,
        addProduct,
        updateProduct,
        deleteProduct,
        adjustStock,
        restoreProductBackup,
        addCategory,
        updateCategory,
        deleteCategory,
        updateSettings,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
};
