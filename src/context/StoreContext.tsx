Warning: truncated output (original token count: 54071)
Total output lines: 3861

import { stockConsumedItems, stockItemQuantities } from '../lib/orderStockQuantities';
import { normalizeOrderMissingStockVariants, hasConflictingVariantOrderItems } from '../lib/exactVariantStockResolution';
import { creditReturnStock } from '../lib/returnSheets';
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { savePublicOrder } from '../lib/publicOrderSave';
import { staffJsonRequest } from '../lib/staffRequest';
import { createStaffMutationQueue } from '../lib/staffMutationQueue';
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
  ExchangeInvoiceRecord,
} from '../types';
import {
  initialCategories,
  initialProducts,
  initialOrders,
  initialSettings,
  initialStaffAccounts,
} from '../data/initialData';
import { syncOrderToGoogleSheets, syncOrdersBatchToGoogleSheets, syncProductCatalogToGoogleSheets, clearGoogleSheetTestData, clearGoogleSheetLiveStartData, deleteOrderFromGoogleSheets } from '../lib/googleSheetRequests';
import { buildOrderItemSnapshot, deliverySplitForSettings, displayUnitPrice, effectiveBuyingPrice, findProductSelection, normalizeProductForStorage, normalizedProductType, productDisplayStock, variantById, variantBySku, repriceAfterBuyingCostChange } from '../lib/productVariants';
import { canonicalJson, confirmCsvRequestWithRetry, saveConfirmCsvDecisions } from '../lib/confirmCsvSave';
import { createInvoiceDownloadQueue } from '../lib/invoiceDownloadQueue';
import { mergeInvoiceDownloadReceipt } from '../lib/invoiceDownloadStatus';
import { saveFardarExportStatus } from '../lib/fardarExportStatus';
import { storefrontSaveBody, rebaseStorefrontEdit, sameStorefrontValue } from '../lib/storefrontProductSave';

// Browser caches are only a convenience; a full localStorage quota must not crash Admin.
const writeLocalCache = (key: string, value: string) => {
  try { localStorage.setItem(key, value); }
  catch (error) { console.warn(`Local cache ${key} could not be written.`, error); }
};
import { readStorefrontDraft, rememberStorefrontDraft, acknowledgeStorefrontDraft, archiveStorefrontDraft } from '../lib/storefrontDraft';
import { publicStorefrontRequest } from '../lib/publicStorefrontRequest';
import { validCodPaymentEntries, type CodPaymentEntry } from '../lib/codPaymentImport';

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
  exchangeInvoices:ExchangeInvoiceRecord[];
  refreshExchangeInvoices:()=>Promise<void>;
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
  }) => Promise<void>;
  settings: StoreSettings;
  /** True after the authoritative shared storefront state has finished its first load attempt. */
  sharedStoreReady: boolean;
  sharedOrdersReady: boolean;
  orderLoadError: string;
  storefrontSyncMessage: string;
  invoiceDownloadSyncMessage: string;
  invoiceDownloadCanRetry: boolean;
  retryInvoiceDownloadSave: () => void;
  getPendingInvoiceDownloadSets: () => {date:string;number:number;orderIds:string[]}[];
  retryStorefrontSave: () => void;
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
  refreshOrdersFromServer: (afterMutation?: boolean) => Promise<void>;
  refreshReturnInventory: () => Promise<void>;
  returnPackingPending: boolean;
  returnPackingBatches: {operation_id:string;batch_id:string;created_at:string;count:number}[];

  // Cart operations
  addToCart: (product: Product, quantity?: number, variantId?: string) => void;
  removeFromCart: (lineIdOrProductId: string) => void;
  updateCartQuantity: (lineIdOrProductId: string, quantity: number) => void;
  clearCart: () => void;
  cartSubtotal: number;
  cartItemCount: number;
  /** Manual percentage multi-buy discount only. */
  cartSpecialOfferDiscount: number;
  /** Automatic fixed Qty Offer created by the delivery split only. */
  cartDeliveryQtyOfferDiscount: number;
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
  createMissingItemReplacement: (input: {
    originalOrderId: string;
    itemIndex: number;
    quantity: number;
    reason?: string;
  }) => Promise<Order>;
  createExchangeInvoice: (orderId:string,waybillNumber:string,exchangeType?:'Cash Refund'|'Item Exchange',items?:{item_index:number;quantity:number}[]) => Promise<{exchange:ExchangeInvoiceRecord}>;
  createItemExchangeReplacement: (input:{originalOrderId:string;items:{itemIndex:number;quantity:number}[];waybillNumber:string;exchangeId:string}) => Promise<Order>;
  linkExchangeReplacementOrder: (exchangeId:string,replacement:Order) => Promise<ExchangeInvoiceRecord>;
  completeExchangeRefund: (exchangeId:string, proof: { slipDataUrl:string; slipFileName:string; slipContentType:string }) => Promise<{exchange:ExchangeInvoiceRecord;original_order?:Order|null}>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  cancelOrderDirect: (orderId: string, reason: string, cancelledBy?: string) => Promise<{ success: boolean; message: string }>;
  updateOrderDeliveryDetails: (orderId: string, details: { address: string; city: string; district?: string }) => Promise<{ success: boolean; sheetSynced: boolean; message: string }>;
  updatePaymentStatus: (orderId: string, status: 'Pending' | 'Paid' | 'Refunded') => void;
  confirmAdvancePayment: (orderId: string) => void;
  reviewPayment: (orderId: string, decision: 'approve' | 'reject', reviewer?: string, receivedAmount?: number) => void;
  importWaybillCsv: (csvText: string, courierName?: string) => { importedCount: number; duplicateCount: number };
  importCallCenterResultsCsv: (csvText: string) => { updatedCount: number; notFoundCount: number; errors: string[] };
  importWebsiteConfirmedCsv: (csvText: string) => Promise<{ confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] }>;
  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource) => Promise<{ confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] }>;
  assignNextWaybill: (orderId: string, courierName?: string) => string | null;
  redispatchReturnedParcel: (oldWaybill: string) => Promise<{ success: boolean; message: string; order?: Order; oldWaybill?: string; newWaybill?: string }>;
  unassignWaybill: (orderId: string) => void;
  markInvoicesGenerated: (orderIds: string[], generatedBy?: string) => Order[];
  markInvoiceBatchDownloaded: (orderIds: string[], downloadedBy?: string, downloadSet?: { date: string; number: number }, downloadedInvoices?: Order[]) => Promise<void>;
  markFardarCsvExported: (orderIds: string[], exportedBy?: string) => Promise<void>;
  scanDispatchBarcode: (barcode: string, scannedBy?: string) => Promise<{ success: boolean; message: string; order?: Order }>;
  recordCodPayments: (entries: CodPaymentEntry[], recordedBy?: string) => Promise<{ updatedCount: number; unchangedCount: number; payments: number; returns: number; notFound: string[] }>;
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


const ALL_STAFF_PERMISSIONS = ['overview','add_product','combo_packs','supplier_offer','price_increase','products','stock','orders','exchange_parcels','out_of_stock','returns','lead_import','confirm_upload','invoices','packing','invoice_design','delivery','dispatch','cod_payments','bank_transfer_check','assistant_chats','complaints','notifications','reports','success_rate','reviews','product_requests','sheets','customers','categories','banners','activity','branding','website_info','settings','deploy','user_access'] as const;

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
const staffMutationQueue = createStaffMutationQueue();
const sharedStaffRequest = async (url: string, options: RequestInit = {}) => {
  const token = getStaffSessionToken();
  const send = () => {
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return staffJsonRequest(url,{...options,headers});
  };
  return ['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())
    ? send() : staffMutationQueue.run(send);
};

const refreshStaffSessionToken = async () => {
  const token = getStaffSessionToken();
  if (!token) return '';
  const exp = decodeStaffSessionExpiry(token);
  // Existing staff sessions are 12 hours. Renew only in the final 6 hours so
  // active dashboards stay signed in without creating unnecessary requests.
  if (exp - Date.now() > 6 * 60 * 60 * 1000) return token;
  const data = await staffJsonRequest('/api/staff/session/refresh', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
  });
  const nextToken = String(data?.token || '');
  if (!nextToken || !decodeStaffSessionExpiry(nextToken)) throw new Error('Server returned an invalid refreshed session.');
  if(getStaffSessionToken()!==token)return getStaffSessionToken();
  localStorage.setItem('ora_staff_session_token', nextToken);
  return nextToken;
};

const publicOrderSave = async (order: Order, customerAccessToken?: string, deferSheetSync = false, waitForSheetSync = false): Promise<Order> => {
  return savePublicOrder(order,customerAccessToken,deferSheetSync,waitForSheetSync);
};

const staffBulkOrderSaveAndSheetSync = async (orders: Order[]): Promise<{orders:Order[];sheetSync:any}> => {
  const data=await confirmCsvRequestWithRetry(async(url,options)=>{
    const result=await sharedStaffRequest(url,options);
    if(result?.ok!==true||!Array.isArray(result.orders)){const error:any=new Error('Server did not verify the saved import.');error.status=503;throw error;}
    return result;
  },'/api/admin/orders/bulk-import',{
    method:'POST',
    body:JSON.stringify({orders}),
  });
  return {orders:data.orders,sheetSync:data?.sheet_sync||null};
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
  const [exchangeInvoices,setExchangeInvoices]=useState<ExchangeInvoiceRecord[]>([]);
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
  const [isAdminView, setIsAdminView] = useState(() => ['/system', '/ora-manager'].includes(String(window.location.pathname || '').replace(/\/+$/, '')));
  const [sharedStoreReady, setSharedStoreReady] = useState(false);
  const [inventoryHistoryReady,setInventoryHistoryReady]=useState(false);
  const [returnPackingPending,setReturnPackingPending] = useState(false);
  const [returnStockTransactionPending,setReturnStockTransactionPending] = useState(false);
  const [returnPackingBatches,setReturnPackingBatches] = useState<{operation_id:string;batch_id:string;created_at:string;count:number}[]>([]);
  const [sharedOrdersReady,setSharedOrdersReady]=useState(false);
  const [orderLoadError,setOrderLoadError]=useState('');
  const [storefrontSyncMessage,setStorefrontSyncMessage]=useState('');
  const [storefrontRetry,setStorefrontRetry]=useState(0);
  const storefrontRetryableRef=useRef(false);
  const retryStorefrontSave=()=>setStorefrontRetry(value=>value+1);
  const sharedStoreVersionRef = useRef(0);
  const sharedStoreSnapshotRef = useRef<{products:Product[];categories:Category[];settings:StoreSettings}|null>(null);
  const orderServerVersionRef = useRef('');
  const orderRefreshRef=useRef<{user:string;promise:Promise<void>}|null>(null);
  const adminIdentityRef=useRef('');adminIdentityRef.current=adminUser?.id||'';
  const [invoiceDownloadSyncMessage,setInvoiceDownloadSyncMessage]=useState('');
  const [invoiceDownloadCanRetry,setInvoiceDownloadCanRetry]=useState(false);
  const invoiceDownloadQueueRef=useRef<ReturnType<typeof createInvoiceDownloadQueue>|null>(null);
  const invoiceDownloadReceiptsRef=useRef(new Map<string,Order>());
  const retryInvoiceDownloadSave=()=>{void invoiceDownloadQueueRef.current?.flush(true);};
  const getPendingInvoiceDownloadSets=()=>invoiceDownloadQueueRef.current?.pendingSets()||[];
  useEffect(()=>{
    setInvoiceDownloadSyncMessage('');setInvoiceDownloadCanRetry(false);
    invoiceDownloadReceiptsRef.current.clear();
    const user=adminUser?.id;if(!user)return;
    const queue=createInvoiceDownloadQueue({storage:localStorage,user,request:sharedStaffRequest,
      onSaved:updated=>{
        if(adminIdentityRef.current!==user)return;
        const saved=new Map(updated.map(order=>[String(order.id),order as Order]));
        for(const [id,receipt] of saved)invoiceDownloadReceiptsRef.current.set(id,receipt);
        setOrders(previous=>previous.map(order=>{const receipt=saved.get(String(order.id));return receipt?mergeInvoiceDownloadReceipt(order,receipt):order;}));
      },onState:state=>{
        if(adminIdentityRef.current!==user)return;
        setInvoiceDownloadSyncMessage(state.message);setInvoiceDownloadCanRetry(state.canRetry);
      }});
    invoiceDownloadQueueRef.current=queue;
    const retry=()=>{if(adminIdentityRef.current===user&&getStaffSessionToken())void queue.flush();};
    retry();
    const timer=window.setInterval(retry,30_000);
    window.addEventListener('online',retry);window.addEventListener('focus',retry);
    return ()=>{queue.dispose();if(invoiceDownloadQueueRef.current===queue)invoiceDownloadQueueRef.current=null;
      window.clearInterval(timer);window.removeEventListener('online',retry);window.removeEventListener('focus',retry);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[adminUser?.id]);
  // Serialize full storefront publishes. Rapid Admin edits used to start overlapping
  // PUT requests for the ~shared catalog payload, so an older transient failure could
  // raise "Website sync failed" even when a newer save was already succeeding.
  const storefrontPublishQueueRef = useRef<Promise<void>>(Promise.resolve());
  const storefrontPublishSeqRef = useRef(0);

  // Sync to localStorage
  useEffect(() => {
    writeLocalCache('ora_lang', language);
  }, [language]);

  useEffect(() => {
    writeLocalCache('ora_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    writeLocalCache('ora_categories', JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    writeLocalCache('ora_cart', JSON.stringify(cart));
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
    writeLocalCache('ora_customers', JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    writeLocalCache('ora_stock_history', JSON.stringify(stockHistory));
  }, [stockHistory]);

  useEffect(() => {
    writeLocalCache('ora_purchase_orders', JSON.stringify(purchaseOrders));
  }, [purchaseOrders]);

  // Inventory history is no longer browser-specific. The server is authoritative,
  // while legacy local receipts are recoverable audit facts. Importing a legacy
  // receipt NEVER increases the current physical stock a second time.
  useEffect(()=>{
    if(!adminUser||!getStaffSessionToken()||!sharedStoreReady)return;
    setInventoryHistoryReady(false);
    let active=true;
    const sync=async()=>{
      try{
        const localPurchases=purchaseOrders.slice(),localLogs=stockHistory.slice();
        const remote=await sharedStaffRequest('/api/admin/inventory-history');
        if(!remote?.ok||!Array.isArray(remote.purchases)||!Array.isArray(remote.stock_history))return;
        const remotePurchaseIds=new Set<string>(remote.purchases.map((p:PurchaseOrder)=>String(p.id)));
        const remoteHistoryIds=new Set<string>(remote.stock_history.map((h:StockHistory)=>String(h.id)));
        const missingP=localPurchases.filter(p=>!remotePurchaseIds.has(String(p.id)));
        const missingH=localLogs.filter(h=>!remoteHistoryIds.has(String(h.id))&&String(h.change_type)!=='Order Deduction');
        for(let i=0;i<Math.max(missingP.length,missingH.length);i+=100){
          await sharedStaffRequest('/api/admin/inventory-history',{
            method:'POST',body:JSON.stringify({action:'merge-history',purchases:missingP.slice(i,i+100),stock_history:missingH.slice(i,i+100)})
          });
        }
        if(!active)return;
        setInventoryHistoryReady(true);
        setPurchaseOrders(previous=>{
          const result=new Map<string,PurchaseOrder>(remote.purchases.map((p:PurchaseOrder)=>[String(p.id),p]));
          for(const p of previous)if(!result.has(String(p.id)))result.set(String(p.id),p);
          return [...result.values()].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
        });
        setStockHistory(previous=>{
          const result=new Map<string,StockHistory>(remote.stock_history.map((h:StockHistory)=>[String(h.id),h]));
          for(const h of previous)if(!result.has(String(h.id)))result.set(String(h.id),h);
          return [...result.values()].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
        });
      }catch(error:any){console.warn('Durable Purchasing History sync failed; local audit cache preserved:',error?.message||error);}
    };
    void sync();
    return()=>{active=false};
    // One server history read per authenticated session, not per purchase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[adminUser?.id,sharedStoreReady]);

  useEffect(() => {
    writeLocalCache('ora_settings', JSON.stringify(settings));
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
    writeLocalCache('ora_waybill_records', JSON.stringify(waybillRecords));
  }, [waybillRecords]);

  useEffect(() => {
    writeLocalCache('ora_return_records', JSON.stringify(returnRecords));
  }, [returnRecords]);

  useEffect(() => {
    writeLocalCache('ora_blocked_customers', JSON.stringify(blockedCustomers));
  }, [blockedCustomers]);

  useEffect(() => {
    writeLocalCache('ora_activity_logs', JSON.stringify(activityLogs.slice(0, 5000)));
  }, [activityLogs]);

  useEffect(() => {
    if (adminUser) {
      const { password: _legacyPassword, ...safeAdminUser } = adminUser as any;
      writeLocalCache('ora_admin_user', JSON.stringify(safeAdminUser));
    } else {
      localStorage.removeItem('ora_admin_user');
    }
  }, [adminUser]);

  useEffect(() => {
    const safeUsers = staffUsers.map((user:any) => { const { password: _legacyPassword, ...safeUser } = user || {}; return safeUser; });
    writeLocalCache('ora_staff_accounts', JSON.stringify(safeUsers));
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
    if (includePrivateSettings && state.return_inventory) {
      setReturnPackingPending(state.return_inventory.packing_pending === true);
      setReturnStockTransactionPending((…34071 tokens truncated…nst saved = new Map<string, Order>(result.orders.map((order: Order) => [String(order.id), order]));
      setOrders(prev => prev.map(order => saved.get(String(order.id)) || order));
      summary.updatedCount += result.updatedCount; summary.unchangedCount += result.unchangedCount;
      summary.payments += result.payments; summary.returns += result.returns; summary.notFound.push(...result.notFound);
    }

    if (summary.updatedCount) {
      logActivity({
        action: 'Courier Payments / Fees Recorded',
        module: 'Payments',
        details: `${summary.updatedCount} records saved (${summary.payments} delivered, ${summary.returns} returns) • ${recordedBy}`,
      });
    }
    return summary;
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

  const confirmReturn: StoreContextType['confirmReturn'] = () => ({
    success:false,message:'Use Return Sheets: upload the Fardar CSV, scan the parcel and save its checked item quantities.',
  });

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
    if(!settings.google_sheet_webhook_url) return 0;

    // Never trust a stale browser/localStorage sync flag for a bulk re-sync.
    // Refresh from the durable server first so rows that are already confirmed
    // as synced are not rewritten and Call Center Sheet display text is preserved.
    let syncSourceOrders = orders;
    try {
      if(getStaffSessionToken()){
        const serverData = await sharedStaffRequest('/api/orders');
        const serverOrders: Order[] = Array.isArray(serverData?.orders) ? serverData.orders : [];
        if(serverOrders.length) syncSourceOrders = serverOrders;
      }
    } catch (error:any) {
      console.warn('Google Sheet bulk sync durable refresh failed; using current order cache:', error?.message || error);
    }

    const unsynced = syncSourceOrders.filter((o) => o.order_source !== 'Manual Admin' && !o.is_synced_google_sheets && !(o.order_source === 'Website' && o.payment_method === 'Bank Payment' && o.payment_verification_status !== 'Approved'));
    if(!unsynced.length) return 0;
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
    const testDeliverySplit = deliverySplitForSettings(settings);
    const testRebalanceAmount = testDeliverySplit.embeddedAmount;
    const testLegacySubtotal = Math.max(0, subtotal - testRebalanceAmount * totalQty);
    const discount = Math.round(testLegacySubtotal * (discountRate / 100) * 100) / 100;
    const deliveryRebalanceQtyOffer = testRebalanceAmount > 0 ? Math.round(testRebalanceAmount * Math.max(0, totalQty - 1) * 100) / 100 : 0;
    const deliveryFee = settings.free_delivery_enabled ? 0 : testDeliverySplit.visibleDelivery;
    const totalAmount = Math.round(Math.max(0, subtotal - discount - deliveryRebalanceQtyOffer + deliveryFee) * 100) / 100;
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
      delivery_rebalance_qty_offer: testRebalanceAmount > 0,
      delivery_rebalance_qty_offer_amount: deliveryRebalanceQtyOffer,
      delivery_rebalance_amount_snapshot: testRebalanceAmount,
      delivery_visible_fee_snapshot: testDeliverySplit.visibleDelivery,
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
    testOrders.filter(o=>o.stock_allocated).forEach(o=>stockConsumedItems(o).forEach(item=>inventoryRequirementsForOrderItem(item).forEach(req=>{
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
      for(const item of stockConsumedItems(order)){
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
    const bundleDeliverySplit=deliverySplitForSettings(pricingSettings);
    const bundlePerOrderDisplayDelivery=bundleDeliverySplit.embeddedAmount + (pricingSettings.free_delivery_enabled?bundleDeliverySplit.visibleDelivery:0);
    return rows.map(bundle=>{
      if(normalizedProductType(bundle)!=='bundle' || bundle.bundle_auto_price!==true || !(bundle.bundle_components||[]).length) return bundle;
      const componentUnits=(bundle.bundle_components||[]).reduce((sum,component)=>sum+Math.max(1,Number(component.quantity||1)),0);
      const extraComponentShift=bundlePerOrderDisplayDelivery*Math.max(0,componentUnits-1);
      const componentDisplayTotal=(bundle.bundle_components||[]).reduce((sum,component)=>{
        const child=productMap.get(component.product_id); if(!child)return sum;
        const variant=variantById(child,component.variant_id);
        return sum + displayUnitPrice(child,pricingSettings,variant)*Math.max(1,Number(component.quantity||1));
      },0);
      const discount=Math.max(0,Number(bundle.bundle_discount_amount ?? 50));
      const customerDisplay=Math.max(0,componentDisplayTotal-discount-extraComponentShift);
      const baseSelling=Math.max(0,customerDisplay-bundlePerOrderDisplayDelivery);
      const rawBuying=(bundle.bundle_components||[]).reduce((sum,component)=>{
        const child=productMap.get(component.product_id); if(!child)return sum;
        const variant=variantById(child,component.variant_id);
        return sum + effectiveBuyingPrice(child,variant)*Math.max(1,Number(component.quantity||1));
      },0);
      // Delivery-price rebalance is customer-facing only; actual bundle buying cost must stay unchanged.
      const buying=Math.max(0,rawBuying);
      if(Math.abs(Number(bundle.selling_price||0)-baseSelling)<0.001 && Math.abs(Number(bundle.buying_price||0)-buying)<0.001) return bundle;
      return {...bundle,buying_price:buying,selling_price:baseSelling,delivery_price_shift_applied:0,discount_price:baseSelling,discount_enabled:false};
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

  type InventoryPurchaseInput={supplier_name:string;product_id:string;variant_id?:string;quantity_added:number;unit_buying_price:number;invoice_ref?:string;bill_image_url?:string;notes?:string;performed_by?:string;po_number?:string};
  // All Purchase/Stock In entries commit on the shared server first. A single
  // operation ID is kept until the server acknowledges the stock + receipt.
  // Retrying an uncertain response can NEVER add stock twice.
  const commitInventoryPurchaseBatch=async(rows:InventoryPurchaseInput[]):Promise<void>=>{
    if(!rows.length)return;
    if(!inventoryHistoryReady)throw new Error('Purchasing History is still loading or could not be verified from the server. Do not add stock again; refresh the Inventory page.');
    if(!adminUser||!getStaffSessionToken()||!sharedStoreReady)
      throw new Error('Sign in and load shared stock before purchasing.');
    if(!sharedStoreSnapshotRef.current || sharedStoreSnapshotRef.current.products!==products)
      throw new Error('Unsaved product changes or stale stock are present. Wait for Website changes saved, then Refresh Stock before purchasing.');
    await storefrontPublishQueueRef.current;
    const key='ora_inventory_purchase_pending_v1:'+adminUser.id;
    const intent=rows.map(row=>({
      supplier_name:String(row.supplier_name||'').trim(),product_id:String(row.product_id||''),
      ...(row.variant_id?{variant_id:row.variant_id}:{}),
      quantity_added:Number(row.quantity_added),unit_buying_price:Number(row.unit_buying_price),
      invoice_ref:String(row.invoice_ref||'').trim(),bill_image_url:String(row.bill_image_url||'').trim(),
      notes:String(row.notes||'').trim()
    }));
    const fingerprint=JSON.stringify(intent);
    let pending:{id:string;fingerprint:string;items:typeof intent}|null=null;
    try{pending=JSON.parse(localStorage.getItem(key)||'null')}catch{}
    if(pending?.fingerprint!==undefined&&pending.fingerprint!==fingerprint)
      throw new Error('An earlier Purchase is awaiting confirmation. Retry its exact original items before starting another purchase; no stock was added in this attempt.');
    if(!pending){
      pending={id:crypto.randomUUID(),fingerprint,items:intent};
      localStorage.setItem(key,JSON.stringify(pending));
      if(localStorage.getItem(key)!==JSON.stringify(pending))
        throw new Error('Purchase retry safety could not be stored. Nothing was submitted.');
    }
    const result=await sharedStaffRequest('/api/admin/inventory-history',{
      method:'POST',body:JSON.stringify({action:'purchase-stock',operation_id:pending.id,items:pending.items})
    });
    if(result?.ok!==true||!result?.state||!Array.isArray(result?.purchases)||!Array.isArray(result?.stock_history))
      throw new Error('Server stock/Purchase acknowledgement was invalid. Retry the same saved purchase, not a new one.');
    // A stale in-browser Stock Ledger must not recalculate these verified server
    // values; the shared product snapshot now owns the sellable stock count.
    applySharedStorefrontState(result.state,true);
    const ids=new Set<string>(result.purchases.map((p:PurchaseOrder)=>String(p.id)));
    setPurchaseOrders(previous=>[...result.purchases,...previous.filter(po=>!ids.has(String(po.id)))]);
    const logIds=new Set<string>(result.stock_history.map((log:StockHistory)=>String(log.id)));
    setStockHistory(previous=>[...result.stock_history,...previous.filter(log=>!logIds.has(String(log.id)))]);
    localStorage.removeItem(key);
  };
  const addPurchaseOrder=async(poData:InventoryPurchaseInput)=>commitInventoryPurchaseBatch([poData]);


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

    // One delivery control owns the whole flow:
    // base fee (e.g. 500) + split % (e.g. 50) =>
    // Rs.250 embedded in item display + Rs.250 shown as Delivery.
    // The embedded part is NOT profit and is never stored as new-product profit.
    if (
      'delivery_base_fee' in newSettings ||
      'delivery_rebalance_percent' in newSettings ||
      'delivery_price_rebalance_original_fee' in newSettings ||
      'delivery_price_rebalance_amount' in newSettings ||
      'delivery_price_rebalance_enabled' in newSettings
    ) {
      const currentSplit=deliverySplitForSettings(settings);
      const base=Math.max(0,Number(
        newSettings.delivery_base_fee ??
        newSettings.delivery_price_rebalance_original_fee ??
        currentSplit.baseFee
      ));
      let percent=Math.max(0,Math.min(100,Number(newSettings.delivery_rebalance_percent ?? currentSplit.percent) || 0));
      if ('delivery_price_rebalance_enabled' in newSettings && newSettings.delivery_price_rebalance_enabled === false) percent=0;
      if ('delivery_price_rebalance_amount' in newSettings && !('delivery_rebalance_percent' in newSettings) && base>0) {
        percent=Math.max(0,Math.min(100,(Math.max(0,Number(newSettings.delivery_price_rebalance_amount||0))/base)*100));
      }
      const embedded=Math.round(base*(percent/100)*100)/100;
      const visible=Math.round(Math.max(0,base-embedded)*100)/100;
      nextSettings.delivery_base_fee=base;
      nextSettings.delivery_rebalance_percent=Math.round(percent*100)/100;
      nextSettings.delivery_price_rebalance_original_fee=base;
      nextSettings.delivery_price_rebalance_amount=embedded;
      nextSettings.delivery_price_rebalance_enabled=embedded>0;
      nextSettings.delivery_fee=visible;
    }

    const changedEntries = Object.entries(newSettings).filter(([key,value]) => {
      try { return JSON.stringify((settings as any)[key]) !== JSON.stringify(value); }
      catch { return (settings as any)[key] !== value; }
    });
    setSettings(nextSettings);
    if (
      'delivery_fee' in newSettings ||
      'delivery_base_fee' in newSettings ||
      'delivery_rebalance_percent' in newSettings ||
      'free_delivery_enabled' in newSettings ||
      'delivery_price_rebalance_enabled' in newSettings ||
      'delivery_price_rebalance_amount' in newSettings
    ) {
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
        exchangeInvoices,
        refreshExchangeInvoices,
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
        sharedOrdersReady,
        orderLoadError,
        storefrontSyncMessage,
        invoiceDownloadSyncMessage,
        invoiceDownloadCanRetry,
        retryInvoiceDownloadSave,
        getPendingInvoiceDownloadSets,
        retryStorefrontSave,
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
        refreshReturnInventory,
        returnPackingPending,
        returnPackingBatches,
        addToCart,
        removeFromCart,
        updateCartQuantity,
        clearCart,
        cartSubtotal,
        cartItemCount,
        cartSpecialOfferDiscount,
        cartDeliveryQtyOfferDiscount,
        cartMultiBuyDiscountRate,
        cartFinalProductsTotal,
        placeOrder,
        importBulkOrders,
        createMissingItemReplacement,
        createExchangeInvoice,
        createItemExchangeReplacement,
        linkExchangeReplacementOrder,
        completeExchangeRefund,
        updateOrderStatus,
        cancelOrderDirect,
        updateOrderDeliveryDetails,
        updatePaymentStatus,
        confirmAdvancePayment,
        reviewPayment,
        importWaybillCsv,
        importCallCenterResultsCsv,
        importWebsiteConfirmedCsv,
        importConfirmedOrdersCsv,
        assignNextWaybill,
        redispatchReturnedParcel,
        unassignWaybill,
        markInvoicesGenerated,
        markInvoiceBatchDownloaded,
        markFardarCsvExported,
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
