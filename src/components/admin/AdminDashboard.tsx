import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Package,
  FolderTree,
  ShoppingBag,
  Users,
  Settings,
  Database,
  Plus,
  Edit,
  Trash2,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  PlusCircle,
  Download,
  CheckCircle2,
  Share2,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Truck,
  Phone,
  Store,
  X,
  Code,
  Copy,
  Check,
  LogOut,
  KeyRound,
  ShieldCheck,
  UserPlus,
  Upload,
  Image as ImageIcon,
  RotateCcw,
  Shield,
  Sparkles,
  Search,
  Tag,
  Megaphone,
  Layout,
  Boxes,
  ReceiptText,
  Trophy,
  Gauge,
  History,
  Palette,
  Menu,
  ScanLine,
  Printer,
  Camera,
  LockKeyhole,
  WalletCards,
  BarChart3,
  MessageSquareText,
  Lightbulb,
  Award,
  Bell,
  ChevronDown,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import {
  Product,
  Category,
  Order,
  OrderStatus,
  OrderSource,
  PaymentMethod,
  AdminRole,
  AdminUser,
  AdminPermission,
  ProductVariant,
  BundleComponent,
  ProductType,
  ProductSpecification,
  ProductItemDetail,
} from '../../types';
import { generateOrderInvoicePDF, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';
import { GOOGLE_APPS_SCRIPT_CODE, syncProductCatalogToGoogleSheets } from '../../lib/googleSheets';
import { InvoiceDesignPanel } from './InvoiceDesignPanel';
import { CameraBarcodeScanner } from './CameraBarcodeScanner';
import { CodPaymentsPanel } from './CodPaymentsPanel';
import { BankTransferCheckPanel } from './BankTransferCheckPanel';
import { ReportsPanel } from './ReportsPanel';
import { ReviewModerationPanel } from './ReviewModerationPanel';
import { ProductRequestsPanel } from './ProductRequestsPanel';
import { AssistantChatsPanel } from './AssistantChatsPanel';
import { ComplaintsPanel } from './ComplaintsPanel';
import { WebsiteInfoPanel } from './WebsiteInfoPanel';
import { ComboPacksPanel } from './ComboPacksPanel';
import { BannersPanel } from './BannersPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { getCustomerMembership } from '../../lib/membership';
import { suggestCategoryFields, suggestProductMetadata } from '../../lib/categoryAuto';
import { buildVariantSku, normalizedProductType, productDisplayStock, variantById, displayUnitPrice, oraProfitForBuyingPrice, repriceAfterBuyingCostChange, supplierPricePreview, variantOptions } from '../../lib/productVariants';
import { compressImageFile, uploadPublicImage, uploadRawImageFile } from '../../lib/imageUpload';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

const ITEM_DETAIL_PRESETS: Array<{ label_en: string; label_si: string }> = [
  { label_en: 'Model', label_si: 'මාදිලිය' },
  { label_en: 'Type', label_si: 'වර්ගය' },
  { label_en: 'Condition', label_si: 'තත්ත්වය' },
  { label_en: 'Material', label_si: 'ද්‍රව්‍ය' },
  { label_en: 'Warranty', label_si: 'වගකීම' },
  { label_en: 'Country of Origin', label_si: 'නිෂ්පාදිත රට' },
  { label_en: 'Suitable For', label_si: 'සුදුසු භාවිතය' },
];

interface ParsedCsvRow {
  order_id?: string;
  item_code: string;
  quantity: number;
  customer_name: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  order_source: OrderSource;
  payment_method: PaymentMethod;
  notes?: string;
  product?: Product;
  isValid: boolean;
  errorReason?: string;
}

export const AdminDashboard: React.FC = () => {
  const {
    products,
    categories,
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
    importFardarCityList,
    resolveFardarCity,
    setOrderFardarCity,
    blockedCustomers,
    activityLogs,
    blockCustomer,
    unblockCustomer,
    addPurchaseOrder,
    settings,
    addProduct,
    updateProduct,
    deleteProduct,
    adjustStock,
    addCategory,
    updateCategory,
    deleteCategory,
    updateOrderStatus,
    updatePaymentStatus,
    confirmAdvancePayment,
    syncOrderToSheet,
    syncAllUnsyncedOrders,
    createWebsiteTestOrder,
    createSourceTestOrder,
    deleteWebsiteTestOrders,
    deleteSourceTestOrders,
    deleteOrder,
    updateSettings,
    placeOrder,
    importBulkOrders,
    addToCart,
    clearCart,
    adminUser,
    staffUsers,
    logoutAdmin,
    addStaffAccount,
    deleteStaffAccount,
    updateStaffAccount,
    reviewPayment,
    importWaybillCsv,
    importCallCenterResultsCsv,
    importWebsiteConfirmedCsv,
    importConfirmedOrdersCsv,
    assignNextWaybill,
    unassignWaybill,
    markInvoicesGenerated,
    markInvoiceBatchDownloaded,
    scanDispatchBarcode,
    resetSystemData,
    clearOperationalTestData,
    fullLiveStartReset,
    setIsAdminView,
  } = useStore();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'add_product' | 'combo_packs' | 'supplier_offer' | 'products' | 'categories' | 'banners' | 'notifications' | 'stock' | 'orders' | 'out_of_stock' | 'returns' | 'lead_import' | 'confirm_upload' | 'invoices' | 'packing' | 'invoice_design' | 'delivery' | 'dispatch' | 'cod_payments' | 'bank_transfer_check' | 'assistant_chats' | 'complaints' | 'reports' | 'reviews' | 'product_requests' | 'customers' | 'sheets' | 'activity' | 'branding' | 'website_info' | 'settings' | 'user_access' | 'deploy'
  >('overview');
  const [comboEditProductId, setComboEditProductId] = useState<string | undefined>(undefined);
  const [packingSearch, setPackingSearch] = useState('');
  const [packingFilter, setPackingFilter] = useState<'pending'|'today'|'downloaded'|'all'>('pending');
  const [newOrderToast, setNewOrderToast] = useState<string>('');
  const [assistantNeedsCount, setAssistantNeedsCount] = useState(0);
  const [complaintOpenCount, setComplaintOpenCount] = useState(0);
  const previousAssistantNeedsRef = useRef<number | null>(null);
  const previousComplaintOpenRef = useRef<number | null>(null);
  const [returnScanValue, setReturnScanValue] = useState('');
  const [returnOrderId, setReturnOrderId] = useState<string | null>(null);
  const [returnGoodQty, setReturnGoodQty] = useState<Record<string,number>>({});
  const [returnDamagedQty, setReturnDamagedQty] = useState<Record<string,number>>({});
  const [returnWrongNote, setReturnWrongNote] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnMessage, setReturnMessage] = useState('');

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [openSidebarGroup, setOpenSidebarGroup] = useState<string>('PRODUCTS');
  const [notifyCustomersOnProductSave, setNotifyCustomersOnProductSave] = useState(false);

  const [orderFilter, setOrderFilter] = useState<OrderStatus | 'All'>('All');
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedDeleteOrderId, setSelectedDeleteOrderId] = useState('');
  const [isDeleteOrderOpen, setIsDeleteOrderOpen] = useState(false);
  const [deleteOrderReason, setDeleteOrderReason] = useState('');
  const [deleteOrderBusy, setDeleteOrderBusy] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [uploadBatches, setUploadBatches] = useState<Record<'Website'|'Facebook'|'TikTok', {
    orderNumbers: string[];
    uploaded: number;
    failed: number;
    ignored: number;
    errors: string[];
    at?: string;
  }>>({
    Website: { orderNumbers: [], uploaded: 0, failed: 0, ignored: 0, errors: [] },
    Facebook: { orderNumbers: [], uploaded: 0, failed: 0, ignored: 0, errors: [] },
    TikTok: { orderNumbers: [], uploaded: 0, failed: 0, ignored: 0, errors: [] },
  });

  // Branding changes stay as a draft until the admin explicitly saves them.
  // This prevents color-picker/input events from flooding the audit log.
  const [brandingDraft, setBrandingDraft] = useState<any>({});
  const [brandingSaved, setBrandingSaved] = useState(false);

  // Bank account details are kept as a draft until Main Admin explicitly saves/publishes them.
  // Customers never see unsaved or partially typed bank information.
  const [bankDraft, setBankDraft] = useState({
    bank_name: '',
    bank_account_holder: '',
    bank_account_number: '',
    bank_branch: '',
  });
  const [bankDetailsSavedFlash, setBankDetailsSavedFlash] = useState(false);

  const [visitorAnalytics, setVisitorAnalytics] = useState({
    todayVisitors: 0,
    last7Visitors: 0,
    last30Visitors: 0,
    totalVisitors: 0,
    totalPageViews: 0,
    todayPageViews: 0,
  });

  useEffect(() => {
    if (activeTab !== 'overview' || !adminUser) return;
    let cancelled = false;
    const load = async () => {
      const token = localStorage.getItem('ora_staff_session_token') || '';
      if (!token) return;
      try {
        const response = await fetch('/api/admin/analytics', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Analytics unavailable.');
        if (!cancelled) setVisitorAnalytics({
          todayVisitors: Number(data.todayVisitors || 0),
          last7Visitors: Number(data.last7Visitors || 0),
          last30Visitors: Number(data.last30Visitors || 0),
          totalVisitors: Number(data.totalVisitors || 0),
          totalPageViews: Number(data.totalPageViews || 0),
          todayPageViews: Number(data.todayPageViews || 0),
        });
      } catch {
        // Analytics is helpful but never blocks the Admin dashboard.
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeTab, adminUser?.id]);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    setBankDraft({
      bank_name: settings.bank_name || '',
      bank_account_holder: settings.bank_account_holder || '',
      bank_account_number: settings.bank_account_number || '',
      bank_branch: settings.bank_branch || '',
    });
  }, [activeTab]);

  const saveBankAccountDetails = () => {
    const cleaned = {
      bank_name: bankDraft.bank_name.trim(),
      bank_account_holder: bankDraft.bank_account_holder.trim(),
      bank_account_number: bankDraft.bank_account_number.trim(),
      bank_branch: bankDraft.bank_branch.trim(),
    };

    if (!cleaned.bank_name || !cleaned.bank_account_holder || !cleaned.bank_account_number || !cleaned.bank_branch) {
      alert('Please complete Bank Name, Account Holder Name, Account Number and Branch before saving.');
      return;
    }

    updateSettings({
      ...cleaned,
      bank_details_saved: true,
    });
    setBankDraft(cleaned);
    setBankDetailsSavedFlash(true);
    window.setTimeout(() => setBankDetailsSavedFlash(false), 1800);
  };

  const hideBankAccountDetails = () => {
    if (!confirm('Hide Bank Transfer from the customer checkout? Saved account details will be kept in Admin Settings.')) return;
    updateSettings({ bank_details_saved: false });
  };

  useEffect(() => {
    if (activeTab === 'branding') {
      setBrandingDraft({
        brand_store_name: settings.brand_store_name || 'O-RA',
        brand_tagline: settings.brand_tagline || 'Online Store',
        brand_primary_color: settings.brand_primary_color || '#000000',
        brand_secondary_color: settings.brand_secondary_color || '#ea580c',
        website_logo: settings.website_logo || '',
        mobile_logo: settings.mobile_logo || '',
        favicon_logo: settings.favicon_logo || '',
        invoice_logo: settings.invoice_logo || '',
        black_logo: settings.black_logo || '',
        white_logo: settings.white_logo || '',
        desktop_logo_width: Number(settings.desktop_logo_width || 190),
        mobile_logo_width: Number(settings.mobile_logo_width || 130),
        mobile_logo_max_height: Number(settings.mobile_logo_max_height || 52),
      });
      setBrandingSaved(false);
    }
  }, [activeTab]);

  const saveBrandingChanges = () => {
    updateSettings(brandingDraft);
    setBrandingSaved(true);
    window.setTimeout(() => setBrandingSaved(false), 1800);
  };

  const handleBrandingLogoUpload = async (file: File, key: string) => {
    try {
      const url = await uploadRawImageFile(file, 'branding');
      setBrandingDraft((prev:any) => ({ ...prev, [key]: url }));
    } catch (error:any) {
      alert(error?.message || 'Logo upload failed.');
    }
  };

  const handleHeroBannerUpload = async (file: File) => {
    try {
      const compressed = await compressImageFile(file, 1600, 480_000);
      const url = await uploadPublicImage(compressed, 'branding');
      updateSettings({ hero_banner_image: url });
    } catch (error:any) {
      alert(error?.message || 'Banner upload failed.');
    }
  };

  // Modals inside Admin
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name_en: '', name_si: '', slug: '', icon: '📦', code_prefix: '' });
  const [isManualOrderOpen, setIsManualOrderOpen] = useState(false);
  const [stockAdjustModalProduct, setStockAdjustModalProduct] = useState<Product | null>(null);
  const [stockAdjustVariantId, setStockAdjustVariantId] = useState('');
  const [stockChangeQty, setStockChangeQty] = useState(10);
  const [stockReason, setStockReason] = useState('Stock Refill');
  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
  const [purchaseItemCode, setPurchaseItemCode] = useState('');
  const [purchaseForm, setPurchaseForm] = useState({
    supplier_name: '',
    product_id: products[0]?.id || '',
    variant_id: '',
    quantity_added: 1,
    unit_buying_price: products[0]?.buying_price || 0,
    invoice_ref: '',
    notes: '',
  });

  // Change Password & Staff Accounts Modals
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [superAdminCredentials, setSuperAdminCredentials] = useState({ username: '', email: '' });

  useEffect(() => {
    if (adminUser?.role === 'admin') {
      setSuperAdminCredentials({ username: adminUser.username || 'admin', email: adminUser.email || '' });
    }
  }, [adminUser?.id, adminUser?.username, adminUser?.email, adminUser?.role]);

  const [isAddStaffModalOpen, setIsAddStaffModalOpen] = useState(false);
  const [staffForm, setStaffForm] = useState({
    username: '',
    password: '',
    name: '',
    email: '',
    role: 'staff' as AdminRole,
    permissions: ['orders','lead_import','confirm_upload','delivery','dispatch','customers','sheets'] as string[],
    is_active: true,
  });

  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [resetTypedConfirm, setResetTypedConfirm] = useState('');

  // Item Code (SKU) & Product Search Filters
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [manualItemSearch, setManualItemSearch] = useState('');


  // New Product Form State
  const [productImageUploading, setProductImageUploading] = useState(false);
  const [productForm, setProductForm] = useState({
    sku: `S${String(products.length + 1).padStart(4, '0')}`,
    name_en: '',
    name_si: '',
    description_en: '',
    description_si: '',
    brand: '',
    search_keywords: '',
    source_shop_name: '',
    source_shop_price: 0,
    category_slug: categories[0]?.slug || '',
    product_type: 'normal' as ProductType,
    variants: [] as ProductVariant[],
    bundle_components: [] as BundleComponent[],
    specifications: [] as ProductSpecification[],
    item_details: [] as ProductItemDetail[],
    is_test_product: false,
    buying_price: 500,
    selling_price: 1000,
    discount_price: 1000,
    discount_enabled: false,
    auto_price_enabled: true,
    auto_discount_on_cost_drop: true,
    offer_buying_price: undefined as number | undefined,
    supplier_offer_enabled: false,
    supplier_offer_saved_at: undefined as string | undefined,
    stock_quantity: 0,
    status: 'Active' as const,
    images: [] as string[],
  });

  const [productAutoPricing, setProductAutoPricing] = useState(true);
  const [productAutoCode, setProductAutoCode] = useState(true);
  const [sinhalaTranslationBusy, setSinhalaTranslationBusy] = useState<string>('');
  const [variantImageUploadingId, setVariantImageUploadingId] = useState<string | null>(null);
  const [supplierProductId, setSupplierProductId] = useState('');
  const [supplierVariantId, setSupplierVariantId] = useState('');
  const [supplierNewCost, setSupplierNewCost] = useState<number>(0);
  const [supplierMessage, setSupplierMessage] = useState('');

  const profitForBuyingPrice = oraProfitForBuyingPrice;

  // Global running Item Code. The first product after FULL RESET is typed manually
  // (example S0001). After that Auto Code follows the same prefix/number pattern.
  const nextAutoSku = () => {
    type Group = { prefix:string; separator:string; width:number; count:number; max:number };
    const groups = new Map<string, Group>();
    products.forEach((p) => {
      const sku = String(p.sku || '').trim().toUpperCase();
      const m = sku.match(/^([A-Z]+)(-?)(\d+)$/);
      if (!m) return;
      const prefix=m[1], separator=m[2] || '', digits=m[3], width=digits.length;
      const key=`${prefix}|${separator}|${width}`;
      const cur=groups.get(key) || {prefix,separator,width,count:0,max:0};
      cur.count += 1;
      cur.max = Math.max(cur.max, Number(digits || 0));
      groups.set(key,cur);
    });
    const best=[...groups.values()].sort((a,b)=>b.count-a.count || b.max-a.max)[0];
    if (!best) return '';
    return `${best.prefix}${best.separator}${String(best.max+1).padStart(best.width,'0')}`;
  };

  const resetProductFormForNew = () => {
    const initialCategory = categories[0]?.slug || '';
    const buying = 500;
    const profit = profitForBuyingPrice(buying);
    setEditingProduct(null);
    setProductAutoPricing(true);
    setProductAutoCode(true);
    setProductForm({
      sku: nextAutoSku(),
      name_en: '', name_si: '', description_en: '', description_si: '', brand: '', search_keywords: '',
      source_shop_name: '', source_shop_price: 0, category_slug: initialCategory,
      product_type: 'normal' as ProductType, variants: [] as ProductVariant[], bundle_components: [] as BundleComponent[], specifications: [] as ProductSpecification[], item_details: [] as ProductItemDetail[], is_test_product: false,
      buying_price: buying, selling_price: buying + profit, discount_price: buying + profit, discount_enabled: false,
      auto_price_enabled: true, auto_discount_on_cost_drop: true, offer_buying_price: undefined as number | undefined, supplier_offer_enabled: false, supplier_offer_saved_at: undefined as string | undefined,
      stock_quantity: 0, status: 'Active' as const,
      images: [] as string[],
    });
  };

  const openNewProductWorkspace = () => {
    setNotifyCustomersOnProductSave(false);
    resetProductFormForNew();
    setIsAddProductOpen(true);
    setActiveTab('add_product');
  };

  // Manual Phone / FB Order Form State
  const [manualOrderForm, setManualOrderForm] = useState({
    customer_name: '',
    phone: '',
    whatsapp: '',
    address: '',
    city: '',
    selected_product_id: products[0]?.id || '',
    selected_variant_id: '',
    quantity: 1,
    order_source: 'Facebook Ads' as OrderSource,
    payment_method: 'COD' as PaymentMethod,
  });

  // Bulk CSV Order Import State
  const [isBulkOrderOpen, setIsBulkOrderOpen] = useState(false);
  const [bulkCsvFileName, setBulkCsvFileName] = useState('');
  const [parsedCsvRows, setParsedCsvRows] = useState<ParsedCsvRow[]>([]);
  const [isImportingBulk, setIsImportingBulk] = useState(false);
  const [waybillCsvFileName, setWaybillCsvFileName] = useState('');
  const [waybillImportMessage, setWaybillImportMessage] = useState('');
  const [waybillAssigningId, setWaybillAssigningId] = useState<string | null>(null);
  const [fardarCityCsvFileName, setFardarCityCsvFileName] = useState('');
  const [fardarCityMessage, setFardarCityMessage] = useState('');
  const [citySelections, setCitySelections] = useState<Record<string, string>>({});
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [dispatchScanValue, setDispatchScanValue] = useState('');
  const [dispatchScanMessage, setDispatchScanMessage] = useState('');
  const [dispatchScanOk, setDispatchScanOk] = useState<boolean | null>(null);
  const [cameraScannerMode,setCameraScannerMode]=useState<'dispatch'|'return'|null>(null);
  const scanAudioContextRef = useRef<AudioContext | null>(null);

  const ensureScanAudio = () => {
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return null;
      if (!scanAudioContextRef.current) scanAudioContextRef.current = new AudioContextCtor();
      if (scanAudioContextRef.current.state === 'suspended') void scanAudioContextRef.current.resume();
      return scanAudioContextRef.current;
    } catch {
      return null;
    }
  };

  const playDispatchScanFeedback = (kind: 'success' | 'duplicate' | 'error') => {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(kind === 'success' ? 80 : kind === 'duplicate' ? [55, 45, 55] : 110);
      }
    } catch {}

    const ctx = ensureScanAudio();
    if (!ctx) return;
    try {
      const start = ctx.currentTime;
      const makeTone = (frequency:number, at:number, duration:number, gainValue:number) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(at);
        oscillator.stop(at + duration + 0.01);
      };
      if (kind === 'success') makeTone(1450, start, 0.075, 0.12);
      else if (kind === 'duplicate') {
        makeTone(720, start, 0.065, 0.1);
        makeTone(720, start + 0.11, 0.065, 0.1);
      } else makeTone(430, start, 0.11, 0.08);
    } catch {}
  };

  const returnItemKey = (item:{product_id:string;variant_id?:string}) => `${item.product_id}::${item.variant_id || 'base'}`;

  const loadReturnByWaybill = (rawValue:string) => {
    const value=String(rawValue || '').trim();
    setReturnScanValue(value);

    const o=findReturnOrderByWaybill(value);
    if(!o){
      setReturnMessage('Waybill not found.');
      setReturnOrderId(null);
      return false;
    }

    setReturnOrderId(o.id);
    setReturnGoodQty(Object.fromEntries(o.items.map(it=>[returnItemKey(it),it.quantity])));
    setReturnDamagedQty({});
    setReturnWrongNote('');
    setReturnNotes('');
    setReturnMessage('');
    return true;
  };

  const processDispatchWaybill = (rawValue:string) => {
    const value=String(rawValue || '').trim();
    setDispatchScanValue(value);
    const result=scanDispatchBarcode(value,adminUser?.name || 'Admin');
    const isDuplicate = !result.success && /already scanned|already.*handover/i.test(String(result.message || ''));
    setDispatchScanMessage(isDuplicate ? `Already Scanned — ${result.message} Not recorded again.` : result.message);
    setDispatchScanOk(result.success);
    playDispatchScanFeedback(result.success ? 'success' : isDuplicate ? 'duplicate' : 'error');
    return result.success;
  };

  const handleWaybillCsvUpload = (file: File) => {
    setWaybillCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result || '');
      const result = importWaybillCsv(text, settings.courier_provider || 'Fardar');
      setWaybillImportMessage(`${result.importedCount} new waybills imported. ${result.duplicateCount} duplicates skipped.`);
    };
    reader.readAsText(file);
  };


  const downloadWaybillCsvTemplate = () => {
    const csvContent =
      'Waybill\n' +
      'FDR000001\n' +
      'FDR000002\n' +
      'FDR000003\n' +
      'FDR000004\n' +
      'FDR000005\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ora_fardar_waybill_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  const downloadFardarCityCsvTemplate = () => {
    const csvContent = 'City Name,City Code\nColombo,\nKandy,\nGalle,\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ora_fardar_city_list_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFardarCityCsvUpload = async (file: File) => {
    setFardarCityCsvFileName(file.name);
    setFardarCityMessage('Importing city list...');
    try {
      const text = await file.text();
      const result = await importFardarCityList(text);
      setFardarCityMessage(`${result.importedCount} official Fardar cities loaded. Existing city list was replaced.`);
    } catch (error: any) {
      setFardarCityMessage(error?.message || 'Could not import Fardar city list.');
    }
  };

  const saveOrderCity = async (order: Order) => {
    const selected = String(citySelections[order.id] || '').trim();
    if (!selected) { alert('Select the official Fardar city first.'); return; }
    try {
      await setOrderFardarCity(order.id, selected, true);
      setFardarCityMessage(`${order.city} mapped to ${selected}. This mapping will be reused next time.`);
      setCitySelections(prev => ({ ...prev, [order.id]: '' }));
    } catch (error: any) {
      alert(error?.message || 'Could not save city mapping.');
    }
  };

  const assignWaybillByMode = async (order: Order) => {
    if (waybillAssigningId) return;
    const provider = settings.courier_provider || 'Fardar';
    const mode = settings.courier_mode || (settings.courier_api_enabled ? 'api' : 'manual');
    const resolvedCity = order.fardar_city || resolveFardarCity(order.city).city;
    if (fardarCities.length > 0 && !resolvedCity) {
      alert('City Verification Required. Map this customer city to an official Fardar city before assigning a waybill.');
      return;
    }
    setWaybillAssigningId(order.id);
    try {
      if (mode === 'manual') {
        const wb = assignNextWaybill(order.id, provider);
        if (!wb) alert('No available waybill. Import a new Fardar CSV range first.');
        return;
      }

      try {
        const response = await fetch('/api/courier/fardar/waybill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: { ...order, city: resolvedCity || order.city, fardar_city: resolvedCity } }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.waybill) throw new Error(data?.error || 'Fardar API waybill request failed.');

        const apiCourierName = `${provider} API`;
        importWaybillCsv(`Waybill\n${String(data.waybill).trim()}\n`, apiCourierName);
        const assigned = assignNextWaybill(order.id, apiCourierName);
        if (!assigned) throw new Error('API returned a waybill but it could not be assigned.');
        setWaybillImportMessage(`API waybill assigned: ${assigned}`);
      } catch (apiError: any) {
        if (mode !== 'auto') throw apiError;
        const fallback = assignNextWaybill(order.id, provider);
        if (!fallback) throw new Error(`${apiError?.message || 'API unavailable'} Manual fallback also has no available CSV waybill.`);
        setWaybillImportMessage(`API unavailable. Manual fallback assigned: ${fallback}`);
      }
    } catch (error: any) {
      alert(error?.message || 'Could not assign waybill.');
    } finally {
      setWaybillAssigningId(null);
    }
  };

  // CSV Template & Parsing
  const downloadOrderCsvTemplate = () => {
    const p1 = products[0]?.sku || 'S0001';
    const p2 = products[1]?.sku || 'S0002';
    const p3 = products[2]?.sku || 'S0003';

    const csvContent =
      'Item_Code,Quantity,Customer_Name,Phone,WhatsApp,Address,City,Channel_Source,Payment_Method,Notes\n' +
      `${p1},1,Kasun Perera,0771234567,0771234567,No 45 Galle Road,Colombo 03,Facebook Ads,COD,Delivered after 5pm\n` +
      `${p2},2,Nimali Fernando,0719876543,0719876543,Main Street,Kandy,TikTok Ads,COD,Call before delivery\n` +
      `${p3},1,Saman Kumara,0751112223,0751112223,12 Station Road,Galle,Phone Call,Bank Payment,Receipt verified\n`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'ora_bulk_orders_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadCallCenterCsvTemplate = () => {
    const csv = 'Order ID,Result\nWEB-000001,Confirmed\nWEB-000002,No Answer\nWEB-000003,Cancelled\n';
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='ora_call_center_results_template.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handleCallCenterCsvUpload = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      const result = importCallCenterResultsCsv(String(r.result || ''));
      alert(`Call Center Results Updated: ${result.updatedCount}\nOrder IDs Not Found: ${result.notFoundCount}${result.errors.length ? `\n\n${result.errors.join('\n')}` : ''}`);
    };
    r.readAsText(file);
  };

  const getNextSourceIds = (prefix: 'FB' | 'TK', count = 20) => {
    const used = new Set(orders.map(o => o.order_number.toUpperCase()));
    let max = orders.reduce((m,o) => {
      const match = o.order_number.toUpperCase().match(new RegExp(`^${prefix}-(\\d{6})$`));
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    const ids:string[] = [];
    while (ids.length < count) {
      max++;
      const id = `${prefix}-${String(max).padStart(6,'0')}`;
      if (!used.has(id)) ids.push(id);
    }
    return ids;
  };

  const downloadSourceOrderTemplate = (source: 'Facebook Ads' | 'TikTok Ads') => {
    const prefix = source === 'Facebook Ads' ? 'FB' : 'TK';
    const ids = getNextSourceIds(prefix, 20);
    const p1 = products[0]?.sku || 'S0001';
    const rows = ids.map((id,i) =>
      `${id},${i===0?p1:''},${i===0?(products[0]?.name_en || ''):''},1,,,,,,${source},COD,`
    );
    const csv =
      'Order_ID,Item_Code,Item_Name,Quantity,Customer_Name,Phone,WhatsApp,Address,City,Channel_Source,Payment_Method,Notes\n' +
      rows.join('\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url;
    a.download=source==='Facebook Ads'?'ora_facebook_order_template.csv':'ora_tiktok_order_template.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const downloadDecisionTemplate = (source: 'Website'|'Facebook Ads'|'TikTok Ads' = 'Website') => {
    const prefix = source === 'Facebook Ads' ? 'FB' : source === 'TikTok Ads' ? 'TK' : 'WEB';
    const csv = [
      'Order ID,Customer Name,Phone Number,Address,Item Name,Variant / Color,Qty,Unit Price (Rs),Item Action,Order Action,Cancel Reason,Main Code,Item Code,Cancelled By',
      `${prefix}-000001,Sample Customer,0770000000,Sample Address,Sample Product,,1,1500,KEEP ITEM,CONFIRM ORDER,,S0001,S0001,`,
      `${prefix}-000002,Sample Customer,0770000000,Sample Address,Sample Product 2,,1,1000,CANCEL ITEM,CANCEL ENTIRE ORDER,Customer changed mind,S0002,S0002,Call Center`,
    ].join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
    a.download = `ora_${source==='Website'?'website':source==='Facebook Ads'?'facebook':'tiktok'}_confirm_cancel_template.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  const downloadWebsiteConfirmedTemplate = () => downloadDecisionTemplate('Website');

  const parseSourceCsvForDirectImport = (text:string,source:'Facebook Ads'|'TikTok Ads') => {
    const parseLine=(line:string)=>{const out:string[]=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===','&&!q){out.push(cur.trim());cur='';}else cur+=ch;}out.push(cur.trim());return out;};
    const lines=String(text||'').split(/\r?\n/).filter(l=>l.trim());if(lines.length<2)return[];
    const headers=parseLine(lines[0]).map(h=>h.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''));
    const findExact=(names:string[])=>{for(const n of names){const i=headers.indexOf(n);if(i>=0)return i;}return -1;};
    const findLoose=(names:string[])=>{const exact=findExact(names);if(exact>=0)return exact;return headers.findIndex(h=>names.some(n=>h.includes(n)));};
    const iLead=findExact(['lead_id','leadid','id','instant_form_lead_id','lead_gen_id','leadgen_id']);
    const iCreated=findLoose(['created_time','created_at','lead_created_time','creation_time','submitted_at','date']);
    const iCode=findLoose(['main_product_code','main_code','product_code','item_code','sku','product_sku','code']);
    const iQty=findLoose(['quantity','qty']);
    const iName=findLoose(['full_name','customer_name','name']);
    const iPhone=findLoose(['phone_number','phone','mobile_number','mobile']);
    const iWa=findLoose(['whatsapp_number','whatsapp','wa_number']);
    const iAddr=findLoose(['full_address','customer_address','address']);
    const iCity=findLoose(['city','town','district']);
    const iVariant=findLoose(['color','colour','variant','option','selected_color']);
    const iNotes=findLoose(['notes','note','message','comment']);
    return lines.slice(1).map(line=>{const c=parseLine(line);return{
      platform_lead_id:iLead>=0?String(c[iLead]||'').trim():undefined,
      lead_created_at:iCreated>=0?String(c[iCreated]||'').trim():undefined,
      item_code:iCode>=0?String(c[iCode]||'').trim():'',
      variant_value:iVariant>=0?String(c[iVariant]||'').trim():undefined,
      quantity:Math.max(1,Number(iQty>=0?c[iQty]:1)||1),
      customer_name:iName>=0?String(c[iName]||'').trim():'',
      phone:iPhone>=0?String(c[iPhone]||'').trim():'',
      whatsapp:iWa>=0?String(c[iWa]||'').trim():(iPhone>=0?String(c[iPhone]||'').trim():''),
      address:iAddr>=0?String(c[iAddr]||'').trim():'N/A',
      city:iCity>=0?String(c[iCity]||'').trim():'N/A',
      order_source:source,payment_method:'COD' as const,notes:iNotes>=0?String(c[iNotes]||'').trim():`${source} raw lead`,is_confirmed:false,
    };}).filter(r=>r.platform_lead_id||r.item_code||r.phone||r.customer_name);
  };

  const handleDirectSourceUpload = (file: File, source: 'Facebook Ads' | 'TikTok Ads') => {
    const r = new FileReader();
    r.onload = async () => {
      const rows = parseSourceCsvForDirectImport(String(r.result || ''), source);
      if (!rows.length) {
        alert('No order rows found in the CSV.');
        return;
      }
      const result = await importBulkOrders(rows);
      const key = source === 'Facebook Ads' ? 'Facebook' : 'TikTok';
      setUploadBatches(prev => ({
        ...prev,
        [key]: {
          orderNumbers: result.importedOrderNumbers,
          uploaded: result.importedCount,
          failed: result.failedCount,
          ignored: result.ignoredCount,
          errors: result.errors,
          at: new Date().toISOString(),
        },
      }));
      alert(`${key} Orders Imported: ${result.importedCount}\\nFailed: ${result.failedCount}${result.errors.length ? `\\n\\n${result.errors.join('\\n')}` : ''}`);
    };
    r.readAsText(file);
  };

  const csvEscape = (value: unknown) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
  };

  const downloadFardarUploadCsv = (selectedOrders: Order[]) => {
    const ready = selectedOrders.filter(o =>
      o.call_center_status === 'Confirmed' &&
      o.stock_allocated &&
      Boolean(o.waybill_number) &&
      o.order_status !== 'Cancelled'
    );
    if (!ready.length) {
      alert('No Fardar-ready orders. Confirm order + allocate stock + assign waybill first.');
      return;
    }

    const header = [
      'Waybill ID','Order ID','Parcel Type','Parcel Description',
      'Recipient Name','Recipient Mobile','Recipient Mobile',
      'Recipient Address','Recipient City','COD Amount','Exchange (0 or 1)'
    ];

    const rows = ready.map(o => {
      // Multiple item types are merged into one parcel description / one Fardar row.
      const desc = o.items.map(it => `${it.sku} ${it.product_name}${it.variant_name ? ` - ${it.variant_name}` : ''} x${it.quantity}`).join(' | ');
      const cod = o.payment_method === 'COD' ? Math.round(o.total_amount) : 0;
      return [
        o.waybill_number || '',
        o.order_number,
        settings.fardar_parcel_type || '',
        desc,
        o.customer_name,
        o.phone,
        o.whatsapp || o.phone,
        o.address,
        o.fardar_city || o.city,
        cod,
        0
      ].map(csvEscape).join(',');
    });

    const blob = new Blob([[header.join(','),...rows].join('\n')],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=`ora_fardar_ready_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  };

  const handleWebsiteConfirmedCsvUpload = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      const result = importWebsiteConfirmedCsv(String(r.result || ''));
      setUploadBatches(prev => ({
        ...prev,
        Website: {
          orderNumbers: result.orderNumbers,
          uploaded: result.confirmedCount,
          failed: result.notFoundCount,
          ignored: result.ignoredCount,
          errors: result.errors,
          at: new Date().toISOString(),
        },
      }));
      alert(`Website Decisions Processed: ${result.confirmedCount}\nNot Found: ${result.notFoundCount}\nIgnored: ${result.ignoredCount}${result.errors.length ? `\n\n${result.errors.join('\n')}` : ''}`);
    };
    r.readAsText(file);
  };

  const handleSourceConfirmedCsvUpload = (file:File,source:'Facebook Ads'|'TikTok Ads') => {
    const r=new FileReader();
    r.onload=()=>{
      const result=importConfirmedOrdersCsv(String(r.result||''),source);
      const key=source==='Facebook Ads'?'Facebook':'TikTok';
      setUploadBatches(prev=>({...prev,[key]:{orderNumbers:result.orderNumbers,uploaded:result.confirmedCount,failed:result.notFoundCount,ignored:result.ignoredCount,errors:result.errors,at:new Date().toISOString()}}));
      alert(`${key} Confirm + Cancel Upload\nProcessed: ${result.confirmedCount}\nNot Found: ${result.notFoundCount}\nIgnored: ${result.ignoredCount}${result.errors.length?`\n\n${result.errors.join('\n')}`:''}`);
    };
    r.readAsText(file);
  };

  const handleSourceTestLead = async (source:'Facebook Ads'|'TikTok Ads') => {
    try {
      const result=await createSourceTestOrder(source);
      if(!result){alert('Add at least one product first.');return;}
      alert(`${source==='Facebook Ads'?'Facebook':'TikTok'} test lead created and Google Sheet confirmed: ${result.order_number}\nSelect a variant/color in Google Sheet and upload confirmed CSV.`);
    } catch (error:any) {
      alert(`${source==='Facebook Ads'?'Facebook':'TikTok'} test lead was saved in O-RA, but Sheet sync failed.\n\n${error?.message || 'Unknown Google Sheet error'}`);
    }
  };

  const handleCsvFileUpload = (file: File) => {
    setBulkCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) {
        alert('CSV file is empty or missing data rows.');
        setParsedCsvRows([]);
        return;
      }

      const parseLine = (lineStr: string) => {
        const result: string[] = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < lineStr.length; i++) {
          const char = lineStr[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(cur.trim().replace(/^"|"$/g, ''));
            cur = '';
          } else {
            cur += char;
          }
        }
        result.push(cur.trim().replace(/^"|"$/g, ''));
        return result;
      };

      const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

      const findIdx = (keywords: string[]) =>
        headers.findIndex((h) => keywords.some((k) => h.includes(k)));

      const idxOrderId = findIdx(['order_id', 'orderid', 'order']);
      const idxCode = findIdx(['code', 'sku', 'item']);
      const idxQty = findIdx(['qty', 'quantity', 'count']);
      const idxName = findIdx(['name', 'customer']);
      const idxPhone = findIdx(['phone', 'mobile', 'tel']);
      const idxWA = findIdx(['whatsapp', 'wa']);
      const idxAddr = findIdx(['address', 'street']);
      const idxCity = findIdx(['city', 'town']);
      const idxSource = findIdx(['source', 'channel']);
      const idxPayment = findIdx(['payment', 'method']);
      const idxNotes = findIdx(['note', 'remark']);

      const parsed: ParsedCsvRow[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseLine(lines[i]);
        if (cols.every((c) => !c.trim())) continue;

        const rawOrderId = idxOrderId >= 0 ? cols[idxOrderId] : '';
        const rawCode = idxCode >= 0 ? cols[idxCode] : cols[0] || '';
        const rawQty = idxQty >= 0 ? cols[idxQty] : cols[1] || '1';
        const rawName = idxName >= 0 ? cols[idxName] : cols[2] || '';
        const rawPhone = idxPhone >= 0 ? cols[idxPhone] : cols[3] || '';
        const rawWA = idxWA >= 0 ? cols[idxWA] : cols[4] || rawPhone;
        const rawAddr = idxAddr >= 0 ? cols[idxAddr] : cols[5] || '';
        const rawCity = idxCity >= 0 ? cols[idxCity] : cols[6] || '';
        const rawSource = idxSource >= 0 ? cols[idxSource] : cols[7] || 'Facebook Ads';
        const rawPayment = idxPayment >= 0 ? cols[idxPayment] : cols[8] || 'COD';
        const rawNotes = idxNotes >= 0 ? cols[idxNotes] : '';

        const cleanSku = rawCode.trim().toUpperCase();
        const qtyNum = Math.max(1, parseInt(rawQty, 10) || 1);

        const matchedProd = products.find((p) => p.sku.toUpperCase() === cleanSku);

        let isValid = true;
        let errorReason = '';

        if (!cleanSku) {
          isValid = false;
          errorReason = 'Item Code (SKU) missing';
        } else if (!matchedProd) {
          isValid = false;
          errorReason = `Item Code "${cleanSku}" not found in store`;
        } else if (!rawName.trim()) {
          isValid = false;
          errorReason = 'Customer name missing';
        } else if (!rawPhone.trim()) {
          isValid = false;
          errorReason = 'Phone number missing';
        }

        let orderSource: OrderSource = 'Facebook Ads';
        const srcLower = rawSource.toLowerCase();
        if (srcLower.includes('tiktok')) orderSource = 'TikTok Ads';
        else if (srcLower.includes('site') || srcLower.includes('web')) orderSource = 'Website';
        else if (srcLower.includes('manual') || srcLower.includes('phone') || srcLower.includes('call') || srcLower.includes('wa')) orderSource = 'Manual Admin';

        let paymentMethod: PaymentMethod = 'COD';
        const payLower = rawPayment.toLowerCase();
        if (payLower.includes('bank') || payLower.includes('transfer')) paymentMethod = 'Bank Payment';

        parsed.push({
          order_id: rawOrderId.trim().toUpperCase() || undefined,
          item_code: cleanSku || rawCode,
          quantity: qtyNum,
          customer_name: rawName,
          phone: rawPhone,
          whatsapp: rawWA || rawPhone,
          address: rawAddr,
          city: rawCity,
          order_source: orderSource,
          payment_method: paymentMethod,
          notes: rawNotes,
          product: matchedProd,
          isValid,
          errorReason,
        });
      }

      setParsedCsvRows(parsed);
    };
    reader.readAsText(file);
  };

  const handleBulkImportSubmit = async () => {
    const validRows = parsedCsvRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      alert('No valid rows found to import.');
      return;
    }

    setIsImportingBulk(true);
    try {
      const result = await importBulkOrders(
        validRows.map((r) => ({
          order_id: r.order_id,
          item_code: r.item_code,
          quantity: r.quantity,
          customer_name: r.customer_name,
          phone: r.phone,
          whatsapp: r.whatsapp,
          address: r.address,
          city: r.city,
          order_source: r.order_source,
          payment_method: r.payment_method,
          notes: r.notes,
        }))
      );

      alert(
        `Bulk Order Import Complete!\n\n` +
          `• Successfully Imported: ${result.importedCount} orders\n` +
          `• Inventory Stock Deducted Automatically\n` +
          (result.failedCount > 0 ? `• Skipped / Failed: ${result.failedCount} rows` : '')
      );

      setIsBulkOrderOpen(false);
      setParsedCsvRows([]);
      setBulkCsvFileName('');
    } catch (err: any) {
      alert(err.message || 'Error occurred during bulk order import.');
    } finally {
      setIsImportingBulk(false);
    }
  };

  const filteredManualProducts = useMemo(() => {
    if (!manualItemSearch.trim()) return products;
    const q = manualItemSearch.toLowerCase().trim();
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.name_si.toLowerCase().includes(q)
    );
  }, [products, manualItemSearch]);

  const selectedManualProduct = useMemo(() => {
    if (filteredManualProducts.length === 0) return null;
    const found = filteredManualProducts.find((p) => p.id === manualOrderForm.selected_product_id);
    return found || filteredManualProducts[0];
  }, [filteredManualProducts, manualOrderForm.selected_product_id]);

  const handleManualSearchInput = (query: string) => {
    setManualItemSearch(query);
    const q = query.toLowerCase().trim();
    const matched = products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.name_si.toLowerCase().includes(q)
    );
    if (matched.length > 0) {
      setManualOrderForm((prev) => ({
        ...prev,
        selected_product_id: matched[0].id,
      }));
    }
  };

  // Calculations for Reports Dashboard
  const totalSalesRevenue = orders
    .filter((o) => o.payment_status === 'Paid' || o.order_status !== 'Cancelled')
    .reduce((sum, o) => sum + o.total_amount, 0);

  const totalProfit = orders
    .filter((o) => o.payment_status === 'Paid' || o.order_status !== 'Cancelled')
    .reduce((sum, o) => {
      const orderProfit = o.items.reduce(
        (iSum, item) => iSum + (item.unit_price - item.buying_price) * item.quantity,
        0
      );
      return sum + orderProfit;
    }, 0);

  const totalOrdersCount = orders.length;

  const completedOrders = orders.filter((o) => o.order_status === 'Delivered' && o.order_status !== 'Cancelled');
  const productPerformance = products.map((product) => {
    const soldItems = completedOrders.flatMap((order) => order.items).filter((item) => item.product_id === product.id);
    const unitsSold = soldItems.reduce((sum, item) => sum + item.quantity, 0);
    const revenue = soldItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const cost = soldItems.reduce((sum, item) => sum + item.buying_price * item.quantity, 0);
    return {
      productId: product.id,
      name: product.name_en,
      shortName: product.name_en.length > 18 ? `${product.name_en.slice(0, 18)}…` : product.name_en,
      sku: product.sku,
      unitsSold,
      revenue,
      cost,
      profit: revenue - cost,
      stock: product.stock_quantity,
    };
  }).sort((a, b) => b.unitsSold - a.unitsSold || b.profit - a.profit);

  const bestItem = productPerformance[0];
  const weakItem = [...productPerformance].sort((a, b) => a.unitsSold - b.unitsSold || a.profit - b.profit)[0];
  const deliveredRevenue = productPerformance.reduce((sum, item) => sum + item.revenue, 0);
  const deliveredCost = productPerformance.reduce((sum, item) => sum + item.cost, 0);
  const deliveredProfit = deliveredRevenue - deliveredCost;
  const inventoryValue = products.filter((product) => normalizedProductType(product) !== 'bundle').reduce((sum, product) => sum + product.buying_price * product.stock_quantity, 0);
  const totalPurchasedCost = purchaseOrders.reduce((sum, purchase) => sum + purchase.total_cost, 0);
  const chartData = productPerformance.slice(0, 8);

  const lowStockProducts = products.filter((p) => normalizedProductType(p) !== 'bundle' && p.stock_quantity <= 5);
  const unsyncedOrders = orders.filter((o) => o.order_source !== 'Manual Admin' && !o.is_synced_google_sheets);
  const localOnlyCatalogImages = products.filter((p) => String(p.images?.[0] || '').startsWith('/uploads/')).length;

  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []) as File[];
    e.target.value = '';
    if (!selected.length) return;
    const currentRealImages = productForm.images.filter((img) => img.trim() && !img.includes('images.unsplash.com/photo-1523275335684-37898b6baf30'));
    const remainingSlots = Math.max(0, 6 - currentRealImages.length);
    if (remainingSlots <= 0) { alert('Maximum 6 product images per item.'); return; }
    const files = selected.slice(0, remainingSlots);
    setProductImageUploading(true);
    try {
      const newImages: string[] = [];
      for (const file of files) {
        const compressed = await compressImageFile(file, 1280, 280_000);
        newImages.push(await uploadPublicImage(compressed, 'product'));
      }
      setProductForm((prev) => ({
        ...prev,
        images: [...prev.images.filter((img) => img.trim() && !img.includes('images.unsplash.com/photo-1523275335684-37898b6baf30')), ...newImages],
      }));
    } catch (error:any) {
      alert(error?.message || 'Product image upload failed.');
    } finally {
      setProductImageUploading(false);
    }
  };

  const handleVariantImageUpload = async (index: number, file?: File) => {
    if (!file) return;
    const variant = productForm.variants[index];
    if (!variant) return;
    setVariantImageUploadingId(variant.id);
    try {
      const compressed = await compressImageFile(file, 1000, 220_000);
      const url = await uploadPublicImage(compressed, 'product');
      setProductForm((prev) => {
        const next = [...prev.variants];
        if (!next[index]) return prev;
        next[index] = { ...next[index], image: url };
        return { ...prev, variants: next };
      });
    } catch (error:any) {
      alert(error?.message || 'Variant image upload failed.');
    } finally {
      setVariantImageUploadingId(null);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUser) return;
    if (passwordForm.newPassword.length < 8) {
      alert('New password must be at least 8 characters long.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert('New passwords do not match.');
      return;
    }
    try {
      const token = localStorage.getItem('ora_staff_session_token') || '';
      const response = await fetch('/api/staff/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: passwordForm.currentPassword, new_password: passwordForm.newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Password could not be changed.');
      alert('Password updated successfully!');
      setIsChangePasswordOpen(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error:any) {
      alert(error?.message || 'Password could not be changed.');
    }
  };

  const handleSaveSuperAdminCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUser || adminUser.role !== 'admin') return;
    const username = superAdminCredentials.username.trim().toLowerCase();
    const email = superAdminCredentials.email.trim().toLowerCase();
    if (!username) { alert('Super Admin username is required.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { alert('Enter a valid recovery email / Gmail address.'); return; }
    const duplicate = staffUsers.some((user) => user.id !== adminUser.id && user.username.toLowerCase() === username);
    if (duplicate) { alert('That username is already used by another account.'); return; }
    updateStaffAccount(adminUser.id, { username, email });
    alert('Super Admin username and recovery email saved.');
  };

  const handleAddStaffAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffForm.username || !staffForm.password || !staffForm.name) {
      alert('Username, password, and name are required.');
      return;
    }
    const existing = staffUsers.find(
      (u) => u.username.toLowerCase() === staffForm.username.toLowerCase()
    );
    if (existing) {
      alert('An account with this username already exists.');
      return;
    }

    addStaffAccount(staffForm);
    alert(`Account created for ${staffForm.name}. Selected access permissions saved.`);
    setIsAddStaffModalOpen(false);
    setStaffForm({
      username: '',
      password: '',
      name: '',
      email: '',
      role: 'staff',
      permissions: ['orders','lead_import','confirm_upload','delivery','dispatch','customers','sheets'],
      is_active: true,
    });
  };

  const handleResetSystemData = async () => {
    if (resetTypedConfirm.trim().toUpperCase() !== 'RESET ORA') {
      alert('Please type RESET ORA exactly to confirm.');
      return;
    }
    try {
      await fullLiveStartReset();
      setIsResetConfirmOpen(false);
      setResetTypedConfirm('');
      alert('FULL LIVE START RESET complete. Operational/demo data and public business contact/payment details were cleared. Website Info & Policy text, login/staff access, Google Sheet link, technical/API connections, branding and invoice design were preserved.');
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Full live-start reset failed.');
    }
  };

  const applyProductNameAuto = (name: string) => {
    const auto = suggestProductMetadata(name, categories);
    setProductForm((prev) => {
      const nextCategory = name.trim() ? (auto.category_slug || prev.category_slug) : prev.category_slug;
      return {
        ...prev,
        name_en: name,
        category_slug: nextCategory,
        sku: productAutoCode && !editingProduct && products.length > 0 ? nextAutoSku() : prev.sku,
        search_keywords: name.trim() ? auto.search_keywords : '',
      };
    });
  };

  const requestSinhalaTranslations = async (texts: string[]) => {
    const token = localStorage.getItem('ora_staff_session_token') || '';
    const response = await fetch('/api/admin/translate-sinhala', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ texts }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Sinhala translation failed.');
    return Array.isArray(data?.translations) ? data.translations.map((value:any)=>String(value || '').trim()) : [];
  };

  const autoFillProductSinhala = async (field: 'name' | 'description', english: string, force = false) => {
    const source = String(english || '').trim();
    if (!source) return;
    const targetKey = field === 'name' ? 'name_si' : 'description_si';
    const current = String((productForm as any)[targetKey] || '').trim();
    if (current && !force) return;
    const busyKey = `product-${field}`;
    setSinhalaTranslationBusy(busyKey);
    try {
      const [translation] = await requestSinhalaTranslations([source]);
      if (!translation) return;
      setProductForm((prev:any) => {
        if (!force && String(prev[targetKey] || '').trim()) return prev;
        return { ...prev, [targetKey]: translation };
      });
    } catch (error:any) {
      if (force) alert(error?.message || 'Sinhala translation failed.');
    } finally {
      setSinhalaTranslationBusy((value) => value === busyKey ? '' : value);
    }
  };

  const addItemDetail = (label_en = '', label_si = '') => {
    setProductForm((prev) => ({
      ...prev,
      item_details: [...prev.item_details, { id:`item-detail-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, label_en, label_si, value_en:'', value_si:'' }],
    }));
  };

  const autoTranslateItemDetail = async (detailId: string, force = false) => {
    const detail = productForm.item_details.find((row) => row.id === detailId);
    if (!detail) return;
    const labelEn = String(detail.label_en || '').trim();
    const valueEn = String(detail.value_en || '').trim();
    if (!labelEn && !valueEn) return;
    const needLabel = force || !String(detail.label_si || '').trim();
    const needValue = force || !String(detail.value_si || '').trim();
    if (!needLabel && !needValue) return;
    const inputs: string[] = [];
    const slots: Array<'label'|'value'> = [];
    if (needLabel && labelEn) { inputs.push(labelEn); slots.push('label'); }
    if (needValue && valueEn) { inputs.push(valueEn); slots.push('value'); }
    if (!inputs.length) return;
    const busyKey = `detail-${detailId}`;
    setSinhalaTranslationBusy(busyKey);
    try {
      const translations = await requestSinhalaTranslations(inputs);
      setProductForm((prev) => ({
        ...prev,
        item_details: prev.item_details.map((row) => {
          if (row.id !== detailId) return row;
          const next = { ...row };
          slots.forEach((slot, index) => {
            const translated = String(translations[index] || '').trim();
            if (!translated) return;
            if (slot === 'label' && (force || !String(next.label_si || '').trim())) next.label_si = translated;
            if (slot === 'value' && (force || !String(next.value_si || '').trim())) next.value_si = translated;
          });
          return next;
        }),
      }));
    } catch (error:any) {
      if (force) alert(error?.message || 'Sinhala translation failed.');
    } finally {
      setSinhalaTranslationBusy((value) => value === busyKey ? '' : value);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {

    e.preventDefault();
    if (!productForm.name_en || !productForm.sku) {
      alert('Product Name and SKU are required.');
      return;
    }

    const autoMeta = suggestProductMetadata(productForm.name_en, categories);
    let matchedCat = categories.find((c) => c.slug === productForm.category_slug);
    if (!matchedCat && autoMeta.suggested_category && autoMeta.suggested_category.slug === productForm.category_slug) {
      matchedCat = addCategory(autoMeta.suggested_category);
    }
    if (!matchedCat) {
      alert('Please select a valid product category.');
      return;
    }

    let variants=(productForm.variants || []).map((v,index)=>{
      const rawOptions=(v.options?.length ? v.options : [{name:v.option_name||'Option',value:v.option_value||''}])
        .map((option)=>({name:String(option?.name||'').trim(),value:String(option?.value||'').trim()}));
      const cleanOptions=rawOptions.filter((option)=>option.name || option.value);
      const optionValue=cleanOptions.map((option)=>option.value).filter(Boolean).join(' / ');
      return {
        ...v,
        id:v.id || `var-${Date.now()}-${index}`,
        options:cleanOptions,
        option_name:cleanOptions[0]?.name || 'Option',
        option_value:optionValue,
        sku:String(v.sku || buildVariantSku(productForm.sku,optionValue||`OPT-${index+1}`,(productForm.variants||[]).map(x=>x.sku))).trim().toUpperCase(),
        buying_price:Math.max(0,Number(v.buying_price||0)),
        selling_price:Math.max(0,Number(v.selling_price||0)),
        stock_quantity:Math.max(0,Number(v.stock_quantity||0)),
        status:(Number(v.stock_quantity||0)>0?'Active':'Out of Stock') as ProductVariant['status'],
      };
    });
    if(productForm.product_type==='variant' && !variants.length){ alert('Add at least one exact variant combination.'); return; }
    if(productForm.product_type==='variant' && variants.some(v=>!(v.options||[]).length || (v.options||[]).some(option=>!option.name || !option.value))){ alert('Every variant option needs both Type and Value. Example: Color = Blue + Size = XL.'); return; }
    if(productForm.product_type==='normal') variants=[];

    const finalProductForm = {
      ...productForm,
      search_keywords: productForm.search_keywords.trim() || autoMeta.search_keywords,
      category_slug: matchedCat.slug,
      variants,
      bundle_components: [],
      specifications: (productForm.specifications || []).filter(spec=>String(spec.label||'').trim() && String(spec.value||'').trim()).map(spec=>({...spec,label:String(spec.label).trim(),value:String(spec.value).trim(),unit:String(spec.unit||'').trim()||undefined})),
      item_details: (productForm.item_details || []).filter(detail=>String(detail.label_en||'').trim() && String(detail.value_en||'').trim()).map(detail=>({ ...detail, label_en:String(detail.label_en).trim(), label_si:String(detail.label_si||'').trim()||undefined, value_en:String(detail.value_en).trim(), value_si:String(detail.value_si||'').trim()||undefined })),
      stock_quantity: productForm.product_type==='variant' ? variants.reduce((n,v)=>n+Number(v.stock_quantity||0),0) : productForm.stock_quantity,
    };

    const wasEditing = Boolean(editingProduct);
    if (editingProduct) {
      updateProduct({
        ...editingProduct,
        ...finalProductForm,
        category_id: matchedCat.id,
      });
      setEditingProduct(null);
    } else {
      addProduct({
        ...finalProductForm,
        category_id: matchedCat.id,
      });
    }

    if (notifyCustomersOnProductSave && (adminUser?.role === 'admin' || adminUser?.permissions?.includes('notifications'))) {
      try {
        const token = localStorage.getItem('ora_staff_session_token') || '';
        const displayPrice = Number(finalProductForm.discount_enabled && Number(finalProductForm.discount_price || 0) > 0 && Number(finalProductForm.discount_price || 0) < Number(finalProductForm.selling_price || 0) ? finalProductForm.discount_price : finalProductForm.selling_price) + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0);
        const response = await fetch('/api/admin/customer-notifications', { method:'POST', headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})}, body:JSON.stringify({ title:`${wasEditing ? 'Product Update' : 'New Product'}: ${finalProductForm.name_en}`, body:`Now available at O-RA for Rs. ${displayPrice.toLocaleString()}.`, url:'/' }) });
        if (!response.ok) { const data=await response.json().catch(()=>({})); throw new Error(data?.error || 'Notification failed.'); }
      } catch (notifyError:any) {
        alert(`Product saved, but notification failed: ${notifyError?.message || 'Unknown error'}`);
      }
    }
    setNotifyCustomersOnProductSave(false);

    setIsAddProductOpen(false);
    setActiveTab('products');
    const resetBuying = 500;
    const resetProfit = profitForBuyingPrice(resetBuying);
    setProductForm({
      sku: nextAutoSku(),
      name_en: '',
      name_si: '',
      description_en: '',
      description_si: '',
      brand: '',
      search_keywords: '',
      source_shop_name: '',
      source_shop_price: 0,
      category_slug: categories[0]?.slug || '',
      product_type: 'normal' as ProductType,
      variants: [] as ProductVariant[],
      bundle_components: [] as BundleComponent[],
      specifications: [] as ProductSpecification[],
      item_details: [] as ProductItemDetail[],
      is_test_product: false,
      buying_price: resetBuying,
      selling_price: resetBuying + resetProfit,
      discount_price: resetBuying + resetProfit,
      discount_enabled: false,
      auto_price_enabled: true,
      auto_discount_on_cost_drop: true,
      offer_buying_price: undefined,
      supplier_offer_enabled: false,
      supplier_offer_saved_at: undefined,
      stock_quantity: 0,
      status: 'Active',
      images: [],
    });
  };

  const handleVariantTestProduct = () => {
    const existing=products.find(p=>String(p.sku).toUpperCase()==='TEST-WB01');
    if(existing){
      if(confirm('Delete TEST-WB01 Water Bottle and all 5 test variants?')) {
        try{ deleteProduct(existing.id); }catch(e:any){ alert(e?.message||'Could not delete test product.'); }
      }
      return;
    }
    const auto=suggestProductMetadata('Water Bottle',categories);
    let cat=categories.find(c=>c.slug===auto.category_slug);
    if(!cat && auto.suggested_category) cat=addCategory(auto.suggested_category);
    if(!cat){ cat=addCategory({name_en:'Home & Kitchen',name_si:'ගෘහ හා මුළුතැන්ගෙයි',slug:'home-kitchen',icon:'🏠'}); }
    const mainImage='https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=800&q=80';
    const names=['Black','Blue','Pink','Green','Purple'];
    const variants:ProductVariant[]=names.map((name,i)=>({id:`test-wb-var-${i+1}`,sku:`TEST-WB01-${name.toUpperCase()}`,option_name:'Color',option_value:name,image:mainImage,buying_price:900,selling_price:1500+(i*100),stock_quantity:10,status:'Active'}));
    try{
      addProduct({sku:'TEST-WB01',name_en:'Test Water Bottle',name_si:'ටෙස්ට් වතුර බෝතලය',description_en:'Variant test product. Delete before live use.',description_si:'Testing සඳහා පමණි.',brand:'TEST',search_keywords:'water bottle, bottle, flask, drink bottle',source_shop_name:'TEST DATA',source_shop_price:0,category_id:cat.id,category_slug:cat.slug,images:[mainImage],buying_price:900,selling_price:1500,discount_price:1500,discount_enabled:false,stock_quantity:50,status:'Active',product_type:'variant',variants,bundle_components:[],is_test_product:true});
      alert('TEST-WB01 added: Black 1500, Blue 1600, Pink 1700, Green 1800, Purple 1900. Delivery is not included in these base prices.');
    }catch(e:any){ alert(e?.message||'Could not add test product.'); }
  };

  const handleStockAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockAdjustModalProduct) return;
    adjustStock(stockAdjustModalProduct.id, stockChangeQty, stockReason, 'Admin', stockAdjustVariantId || undefined);
    setStockAdjustModalProduct(null);
    setStockAdjustVariantId('');
  };

  const handleManualOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProduct =
      selectedManualProduct || products.find((p) => p.id === manualOrderForm.selected_product_id);
    if (!targetProduct) {
      alert('Please select a valid product.');
      return;
    }

    try {
      clearCart();
      addToCart(targetProduct, manualOrderForm.quantity || 1, manualOrderForm.selected_variant_id || undefined);
      await placeOrder({
        customer_name: manualOrderForm.customer_name,
        phone: manualOrderForm.phone,
        whatsapp: manualOrderForm.whatsapp || manualOrderForm.phone,
        address: manualOrderForm.address,
        city: manualOrderForm.city,
        payment_method: manualOrderForm.payment_method,
        order_source: manualOrderForm.order_source,
      });

      alert(`Manual order placed successfully for ${manualOrderForm.order_source}! Stock will allocate automatically when available.`);
      setIsManualOrderOpen(false);
      clearCart();
    } catch (err: any) {
      alert(err.message || 'Failed to place manual order');
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (orderFilter !== 'All' && o.order_status !== orderFilter) return false;
    const q = orderSearch.trim().toLowerCase();
    if (!q) return true;

    // Universal order search: any common order/customer/delivery/payment/item field.
    const itemText = (o.items || []).map((it) => [
      it.sku, it.product_name, it.quantity, it.unit_price, it.subtotal
    ].join(' ')).join(' ');

    const haystack = [
      o.order_number, o.customer_name, o.phone, o.whatsapp, o.address, o.city,
      o.order_source, o.order_status, o.call_center_status, o.payment_method,
      o.payment_status, o.waybill_number, o.courier_name, o.delivery_status,
      o.tracking_status, o.invoice_number, o.notes, itemText
    ].map(v => String(v ?? '')).join(' ').toLowerCase();

    return haystack.includes(q);
  }).sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());

  // ONLY zero-stock products that are currently blocking at least one Confirmed waiting order.
  const outOfStockNeeds = (() => {
    const activeUnallocatedOrders = orders.filter((o) =>
      o.order_status !== 'Cancelled' &&
      !o.is_duplicate_order &&
      !o.stock_allocated
    );

    return products
      .filter((product) => Number(product.stock_quantity || 0) <= 0)
      .map((product) => {
        const affected = activeUnallocatedOrders.filter((order) =>
          (order.items || []).some((item) =>
            item.product_id === product.id || String(item.sku || '').toUpperCase() === String(product.sku || '').toUpperCase()
          )
        );

        const neededQty = affected.reduce((sum, order) =>
          sum + (order.items || [])
            .filter((item) =>
              item.product_id === product.id || String(item.sku || '').toUpperCase() === String(product.sku || '').toUpperCase()
            )
            .reduce((s, item) => s + Number(item.quantity || 0), 0)
        , 0);

        return { product, pendingOrders: affected.length, neededQty };
      })
      .filter((row) => row.pendingOrders > 0)
      .sort((x,y) => y.pendingOrders - x.pendingOrders || y.neededQty - x.neededQty);
  })();

  const lastSeenOrderAt = Number(localStorage.getItem('ora_admin_last_seen_order_at') || 0);
  const newOrdersCount = orders.filter(o => new Date(o.created_at).getTime() > lastSeenOrderAt).length;
  const supplierProduct = products.find((p) => p.id === supplierProductId);
  const supplierVariant = supplierProduct && supplierVariantId ? variantById(supplierProduct, supplierVariantId) : undefined;
  const supplierTarget = supplierVariant || supplierProduct;
  const supplierPreview = supplierTarget ? supplierPricePreview(supplierTarget, supplierNewCost) : null;
  const supplierDeliveryReserve = settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0;
  const supplierRegularDisplay = supplierTarget ? Math.max(0, Number(supplierTarget.selling_price || 0)) + supplierDeliveryReserve : 0;
  const supplierPreviewDisplay = supplierPreview
    ? (supplierPreview.kind === 'offer' ? supplierPreview.offerSelling : supplierPreview.nextSelling) + supplierDeliveryReserve
    : 0;
  const supplierPreviewPercent = supplierPreview && supplierPreview.kind === 'offer' && supplierRegularDisplay > 0
    ? Math.max(1, Math.round((supplierPreview.savingPerUnit / supplierRegularDisplay) * 100))
    : 0;

  const saveSupplierPriceChange = () => {
    if (!supplierProduct || !supplierTarget || !supplierPreview) { setSupplierMessage('Select a product first.'); return; }
    if (!(supplierNewCost > 0)) { setSupplierMessage('Enter the new supplier buying price.'); return; }
    const now = new Date().toISOString();
    const applyTarget = (target: Product | ProductVariant): Product | ProductVariant => {
      const historyBase = [...(target.price_history || [])];
      if (supplierPreview.kind === 'offer') {
        return {
          ...target,
          discount_enabled: true,
          discount_price: supplierPreview.offerSelling,
          offer_buying_price: supplierPreview.newCost,
          supplier_offer_enabled: true,
          supplier_offer_saved_at: now,
          price_history: [...historyBase, {
            changed_at: now,
            reason: `Saved supplier offer: Rs. ${supplierPreview.normalCost} -> Rs. ${supplierPreview.newCost}; customer saving Rs. ${supplierPreview.savingPerUnit}/item`,
            buying_price: supplierPreview.normalCost,
            selling_price: supplierPreview.normalSelling,
            discount_price: supplierPreview.offerSelling,
            discount_enabled: true,
          }].slice(-50),
        };
      }
      if (supplierPreview.kind === 'increase') {
        return {
          ...target,
          buying_price: supplierPreview.newCost,
          selling_price: supplierPreview.nextSelling,
          discount_enabled: false,
          discount_price: supplierPreview.nextSelling,
          offer_buying_price: undefined,
          supplier_offer_enabled: false,
          supplier_offer_saved_at: undefined,
          price_history: [...historyBase, {
            changed_at: now,
            reason: `Supplier cost increased: Rs. ${supplierPreview.normalCost} -> Rs. ${supplierPreview.newCost}; normal price raised by Rs. ${supplierPreview.increasePerUnit}/item`,
            buying_price: supplierPreview.newCost,
            selling_price: supplierPreview.nextSelling,
            discount_price: supplierPreview.nextSelling,
            discount_enabled: false,
          }].slice(-50),
        };
      }
      return {
        ...target,
        discount_enabled: false,
        discount_price: Math.max(0, Number(target.selling_price || 0)),
        offer_buying_price: undefined,
        supplier_offer_enabled: false,
        supplier_offer_saved_at: undefined,
      };
    };

    if (supplierVariant) {
      updateProduct({
        ...supplierProduct,
        variants: (supplierProduct.variants || []).map((v) => v.id === supplierVariant.id ? applyTarget(v) as ProductVariant : v),
      });
    } else {
      updateProduct(applyTarget(supplierProduct) as Product);
    }
    setSupplierMessage(supplierPreview.kind === 'offer'
      ? `Saved. Special Offer is now active: Rs. ${supplierRegularDisplay.toLocaleString()} -> Rs. ${supplierPreviewDisplay.toLocaleString()} (${supplierPreviewPercent}% OFF). Existing Qty Offer rules still apply after this item price.`
      : supplierPreview.kind === 'increase'
        ? `Saved. Supplier cost increased by Rs. ${supplierPreview.increasePerUnit.toLocaleString()} per item, so the future normal customer price increased by the same amount to protect the original profit.`
        : 'Saved. Supplier cost matches the normal buying cost; no offer is active.');
  };

  const disableSupplierOffer = () => {
    if (!supplierProduct || !supplierTarget) return;
    const clearTarget = (target: Product | ProductVariant): Product | ProductVariant => ({
      ...target,
      discount_enabled: false,
      discount_price: Math.max(0, Number(target.selling_price || 0)),
      offer_buying_price: undefined,
      supplier_offer_enabled: false,
      supplier_offer_saved_at: undefined,
    });
    if (supplierVariant) {
      updateProduct({
        ...supplierProduct,
        variants: (supplierProduct.variants || []).map((v) => v.id === supplierVariant.id ? clearTarget(v) as ProductVariant : v),
      });
    } else {
      updateProduct(clearTarget(supplierProduct) as Product);
    }
    setSupplierNewCost(Number(supplierTarget.buying_price || 0));
    setSupplierMessage('Special Offer turned OFF. New customers now see the saved normal price again. Old orders are unchanged.');
  };

  const liveProductAuto = suggestProductMetadata(productForm.name_en, categories);

  // Robust Add Product auto-fill: recalculate after every item-name change instead
  // of relying only on the input event handler. This also works after hot reloads.
  useEffect(() => {
    if (!isAddProductOpen || editingProduct) return;
    const name = productForm.name_en.trim();
    if (!name) return;
    const auto = suggestProductMetadata(name, categories);
    setProductForm((prev) => {
      if (prev.name_en.trim() !== name) return prev;
      const nextCategory = auto.category_slug || prev.category_slug;
      const nextTags = auto.search_keywords || prev.search_keywords;
      if (nextCategory === prev.category_slug && nextTags === prev.search_keywords) return prev;
      return { ...prev, category_slug: nextCategory, search_keywords: nextTags };
    });
  }, [productForm.name_en, isAddProductOpen, editingProduct, categories.length]);
  const newestOrder = [...orders].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
  const previousNewestRef = useRef<string | null>(null);
  const pendingBankProofs = orders.filter((o) => o.payment_method === 'Bank Payment' && o.bank_receipt_url && o.payment_verification_status !== 'Approved' && o.payment_verification_status !== 'Rejected').length;
  const previousPendingBankProofsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!adminUser || !newestOrder) return;
    if (previousNewestRef.current && previousNewestRef.current !== newestOrder.id) {
      setNewOrderToast(`New Order: ${newestOrder.order_number}`);
      window.setTimeout(()=>setNewOrderToast(''),3500);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('O-RA New Order', {body:`${newestOrder.order_number} • ${newestOrder.customer_name}`});
      }
    }
    previousNewestRef.current=newestOrder.id;
  }, [newestOrder?.id, adminUser?.id]);


  useEffect(() => {
    if (!adminUser) return;
    if (previousPendingBankProofsRef.current !== null && pendingBankProofs > previousPendingBankProofsRef.current) {
      setNewOrderToast(`Payment Check Required: ${pendingBankProofs} waiting`);
      window.setTimeout(() => setNewOrderToast(''), 5000);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('O-RA Payment Check Required', { body: `${pendingBankProofs} bank transfer proof${pendingBankProofs === 1 ? '' : 's'} waiting for bank confirmation.` });
      }
    }
    previousPendingBankProofsRef.current = pendingBankProofs;
  }, [pendingBankProofs, adminUser?.id]);

  useEffect(() => {
    if (!adminUser) return;
    const token = localStorage.getItem('ora_staff_session_token') || '';
    const canAssistant = adminUser.role === 'admin' || Boolean(adminUser.permissions?.includes('assistant_chats'));
    const canComplaints = adminUser.role === 'admin' || Boolean(adminUser.permissions?.includes('complaints'));
    if (!canAssistant && !canComplaints) return;

    let cancelled = false;
    const loadSupportCounts = async (notify: boolean) => {
      const headers: Record<string,string> = token ? { Authorization: `Bearer ${token}` } : {};
      try {
        if (canAssistant) {
          const r = await fetch('/api/admin/assistant-chats', { headers });
          if (r.ok) {
            const d = await r.json();
            const count = (Array.isArray(d?.chats) ? d.chats : []).filter((c:any)=>c.status === 'Needs Agent').length;
            if (!cancelled) setAssistantNeedsCount(count);
            if (notify && previousAssistantNeedsRef.current !== null && count > previousAssistantNeedsRef.current) {
              setNewOrderToast(`Assistant Reply Needed: ${count} waiting`);
              window.setTimeout(()=>setNewOrderToast(''),5000);
              if ('Notification' in window && Notification.permission === 'granted') new Notification('O-RA Assistant — Reply Needed', { body:`${count} customer chat${count === 1 ? '' : 's'} waiting for an agent.` });
            }
            previousAssistantNeedsRef.current = count;
          }
        }
        if (canComplaints) {
          const r = await fetch('/api/admin/complaints', { headers });
          if (r.ok) {
            const d = await r.json();
            const count = (Array.isArray(d?.complaints) ? d.complaints : []).filter((c:any)=>!['Resolved','Rejected','Refund Completed'].includes(String(c.status))).length;
            if (!cancelled) setComplaintOpenCount(count);
            if (notify && previousComplaintOpenRef.current !== null && count > previousComplaintOpenRef.current) {
              setNewOrderToast(`New Complaint: ${count} open`);
              window.setTimeout(()=>setNewOrderToast(''),5000);
              if ('Notification' in window && Notification.permission === 'granted') new Notification('O-RA Complaint', { body:`${count} complaint case${count === 1 ? '' : 's'} currently open.` });
            }
            previousComplaintOpenRef.current = count;
          }
        }
      } catch {}
    };
    void loadSupportCounts(false);
    const timer = window.setInterval(()=>void loadSupportCounts(true),30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [adminUser?.id, adminUser?.role, JSON.stringify(adminUser?.permissions || [])]);

  useEffect(() => {
    if (activeTab !== 'orders') return;
    localStorage.setItem('ora_admin_last_seen_order_at', String(Date.now()));
  }, [activeTab, orders.length]);

  const roleLabel: Record<AdminRole, string> = {
    admin: 'Super Admin',
    staff: 'Custom Access Staff',
  };

  const allPermissionIds: AdminPermission[] = ['overview','add_product','combo_packs','supplier_offer','products','orders','lead_import','confirm_upload','packing','delivery','dispatch','returns','cod_payments','bank_transfer_check','stock','out_of_stock','categories','banners','reviews','product_requests','assistant_chats','complaints','notifications','customers','invoices','invoice_design','reports','sheets','activity','branding','website_info','settings','user_access','deploy'];
  const permissionLabels: Record<AdminPermission, string> = {
    overview: 'Dashboard', add_product:'Add Product', combo_packs:'Combo Packs', supplier_offer:'Supplier Price / Offer', products: 'Products', stock: 'Inventory & Stock', orders: 'Orders', out_of_stock: 'Out of Stock Needs', returns: 'Returns Verification', lead_import: 'FB / TikTok Lead Import', confirm_upload: 'Confirm / Cancel Upload', invoices: 'Invoices', packing: 'Packing Invoice Downloads', invoice_design: 'Invoice Design', delivery: 'Delivery & Waybills', dispatch: 'Dispatch Scan', cod_payments: 'COD Payments', bank_transfer_check: 'Bank Transfer Check', assistant_chats: 'Assistant Chats', complaints: 'Complaints', notifications:'Customer Notifications', reports: 'Reports', reviews: 'Product Reviews', product_requests: 'Product Requests', sheets: 'Google Sheets Sync', customers: 'Customers', categories: 'Categories', banners:'Banners', activity: 'Activity Log', branding: 'Branding & Logo Studio', website_info: 'Website Info & Policies', settings: 'Store Settings', deploy: 'Deployment Guide', user_access: 'System Access'
  };
  type StaffAccessLevel = 'none' | 'view' | 'edit';
  const currentRole = adminUser?.role || 'staff';
  const accessLevelFromList = (list: string[] | undefined, tabId: string): StaffAccessLevel => {
    const rows = list || [];
    if (!rows.includes(tabId)) return 'none';
    if (rows.includes(`level:${tabId}:view`)) return 'view';
    if (rows.includes(`level:${tabId}:edit`)) return 'edit';
    // Legacy permission arrays only stored the module id. Keep them as full/edit access.
    return 'edit';
  };
  const setAccessLevelInList = (list: string[] | undefined, tabId: string, level: StaffAccessLevel) => {
    const next = (list || []).filter((value) => value !== tabId && value !== `level:${tabId}:view` && value !== `level:${tabId}:edit`);
    if (level !== 'none') next.push(tabId, `level:${tabId}:${level}`);
    return Array.from(new Set(next));
  };
  const specialActionRows = [
    { id:'packing_download', module:'packing', label:'Download Packing / Invoice PDFs' },
    { id:'dispatch_scan', module:'dispatch', label:'Scan / Record Waybill Dispatch' },
    { id:'return_process', module:'returns', label:'Scan / Process Returns' },
  ] as const;
  const canAccessTab = (tabId: string) => {
    if (adminUser?.role === 'admin') return true;
    if (tabId === 'user_access') return false;
    return accessLevelFromList(adminUser?.permissions, tabId) !== 'none';
  };
  const canEditTab = (tabId: string) => adminUser?.role === 'admin' || accessLevelFromList(adminUser?.permissions, tabId) === 'edit';
  const canUseSpecialAction = (actionId: string) => adminUser?.role === 'admin' || Boolean(adminUser?.permissions?.includes(`action:${actionId}`));
  const firstAllowedTab = () => allPermissionIds.find((id) => canAccessTab(id)) || 'orders';
  const activeAccessLevel: StaffAccessLevel = adminUser?.role === 'admin' ? 'edit' : accessLevelFromList(adminUser?.permissions, activeTab);
  const guardViewOnlyEvent = (event: React.SyntheticEvent) => {
    if (activeAccessLevel !== 'view') return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const viewAllowed = target.closest('[data-ora-view-allowed="true"]');
    if (viewAllowed) return;
    const special = target.closest('[data-ora-action]') as HTMLElement | null;
    if (special && canUseSpecialAction(String(special.dataset.oraAction || ''))) return;
    const control = target.closest('button,input,select,textarea,label');
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const sidebarGroups = [
    { id:'PRODUCTS', label:'PRODUCTS', items:[
      { id:'add_product', label:'ADD PRODUCT', icon:PlusCircle },
      { id:'combo_packs', label:`COMBO PACKS (${products.filter((p)=>normalizedProductType(p)==='bundle').length})`, icon:Boxes },
      { id:'supplier_offer', label:'SUPPLIER PRICE / OFFER', icon:Tag },
      { id:'products', label:`Products (${products.length})`, icon:Package },
    ]},
    { id:'ORDERS', label:'ORDERS', items:[
      { id:'orders', label:newOrdersCount > 0 ? `Orders (${newOrdersCount} New)` : `Orders (${orders.length})`, icon:ShoppingBag },
      { id:'lead_import', label:'FB / TikTok Lead Import', icon:FileSpreadsheet },
      { id:'confirm_upload', label:'FINALIZE • Confirm / Cancel Upload', icon:Upload },
      { id:'packing', label:`Packing Downloads (${new Set(orders.filter(o=>o.invoice_pack_batch_id && !o.invoice_pack_downloaded_at).map(o=>o.invoice_pack_batch_id)).size})`, icon:Package },
      { id:'delivery', label:`Delivery & Waybills (${waybillRecords.filter((w)=>w.status==='Available').length})`, icon:Truck },
      { id:'dispatch', label:`Dispatch Scan (${orders.filter((o)=>o.dispatch_status==='Handed Over').length})`, icon:ScanLine },
      { id:'returns', label:`Returns (${returnRecords.length})`, icon:RotateCcw },
      { id:'cod_payments', label:`COD Payments (${orders.filter((o)=>o.cod_payment_received).length})`, icon:WalletCards },
      { id:'bank_transfer_check', label:`Bank Transfer Check (${orders.filter((o)=>o.payment_method==='Bank Payment' && o.payment_verification_status!=='Approved' && o.payment_verification_status!=='Rejected').length})`, icon:ShieldCheck },
    ]},
    { id:'STOCK', label:'STOCK', items:[
      { id:'stock', label:`Inventory & Stock (${lowStockProducts.length} Alert)`, icon:Database },
      { id:'out_of_stock', label:`Out of Stock (${outOfStockNeeds.length})`, icon:ShieldAlert },
    ]},
    { id:'STORE', label:'STORE', items:[
      { id:'categories', label:`Categories (${categories.length})`, icon:FolderTree },
      { id:'banners', label:'Banners', icon:Megaphone },
      { id:'reviews', label:'Product Reviews', icon:MessageSquareText },
      { id:'product_requests', label:'Product Requests', icon:Lightbulb },
    ]},
    { id:'SUPPORT', label:'SUPPORT', badge:assistantNeedsCount + complaintOpenCount, items:[
      { id:'assistant_chats', label:`Assistant Chats (${assistantNeedsCount})`, icon:MessageSquareText },
      { id:'complaints', label:`Complaints (${complaintOpenCount})`, icon:AlertTriangle },
      { id:'notifications', label:'Customer Notifications', icon:Bell },
      { id:'customers', label:`Customer DB (${customers.length})`, icon:Users },
    ]},
    { id:'DOCUMENTS', label:'DOCUMENTS', items:[
      { id:'invoices', label:`Invoices (${orders.filter((o)=>o.invoice_locked).length})`, icon:ReceiptText },
      { id:'invoice_design', label:'Invoice Design', icon:Printer },
      { id:'reports', label:'Reports', icon:BarChart3 },
      { id:'sheets', label:`Google Sheets Sync (${unsyncedOrders.length} New)`, icon:FileSpreadsheet },
    ]},
    { id:'SYSTEM', label:'SYSTEM', items:[
      { id:'activity', label:`Activity Log (${activityLogs.length})`, icon:History },
      { id:'branding', label:'Branding & Logo Studio', icon:Palette },
      { id:'website_info', label:'Website Info & Policies', icon:FileText },
      { id:'settings', label:'Store Settings', icon:Settings },
      { id:'user_access', label:'System Access', icon:ShieldCheck },
      { id:'deploy', label:'Supabase & Cloudflare Guide', icon:Code },
    ]},
  ];

  useEffect(() => {
    const group = sidebarGroups.find((row)=>row.items.some((item)=>item.id===activeTab));
    if (group) setOpenSidebarGroup(group.id);
  }, [activeTab]);

  const openSidebarTab = (tabId:string) => {
    if (tabId === 'add_product') openNewProductWorkspace();
    else if (tabId === 'supplier_offer') {
      const first = products.find((p)=>p.status!=='Draft' && normalizedProductType(p)!=='bundle');
      setSupplierProductId((prev)=>prev || first?.id || '');
      setSupplierVariantId('');
      setSupplierNewCost(Number(first?.offer_buying_price || first?.buying_price || 0));
      setSupplierMessage('');
      setActiveTab('supplier_offer');
    } else setActiveTab(tabId as any);
    setIsSidebarOpen(false);
  };

  useEffect(() => {
    if (!canAccessTab(activeTab)) setActiveTab(firstAllowedTab() as any);
  }, [activeTab, currentRole, JSON.stringify(adminUser?.permissions || [])]);

  useEffect(() => {
    if (activeTab === 'add_product' && canAccessTab('add_product') && !isAddProductOpen) openNewProductWorkspace();
  }, [activeTab, adminUser?.id]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 sm:p-6 space-y-6 font-sans">
      {newOrderToast && (
        <div className="fixed right-4 top-4 z-[100] rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-black shadow-xl">
          {newOrderToast}
        </div>
      )}
      <CameraBarcodeScanner
        open={cameraScannerMode!==null}
        title={cameraScannerMode==='return' ? 'Scan Return Waybill' : 'Scan Dispatch Waybill'}
        onClose={()=>setCameraScannerMode(null)}
        onDetected={(value)=>{
          if(cameraScannerMode==='return') loadReturnByWaybill(value);
          if(cameraScannerMode==='dispatch') processDispatchWaybill(value);
          setCameraScannerMode(null);
        }}
      />
      {/* Top Admin Banner */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 sm:p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Store className="w-5 h-5 text-orange-600" />
            <h1 className="text-xl font-extrabold text-gray-900">O-RA Admin Control Center</h1>

            {adminUser && (
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold flex items-center space-x-1 ${
                  adminUser.role === 'admin'
                    ? 'bg-orange-100 text-orange-800 border border-orange-200'
                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>
                  {adminUser.role === 'admin' ? 'Super Admin (Full Access)' : 'Staff (Custom Access)'}
                </span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mt-1 font-medium">
            <span>
              Logged in as <strong className="text-gray-900">{adminUser?.name || 'Admin User'}</strong> (@{adminUser?.username})
            </span>
            <span>&bull;</span>
            <span>{adminUser?.email}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {canEditTab('add_product') && (
            <button
              onClick={() => {
                openNewProductWorkspace();
              }}
              className="px-3.5 py-2 rounded-full bg-black text-white font-bold text-xs flex items-center space-x-1.5 shadow-sm hover:bg-orange-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          )}

          {canEditTab('orders') && <button
            onClick={() => {
              setManualItemSearch('');
              setManualOrderForm({
                customer_name: '',
                phone: '',
                whatsapp: '',
                address: '',
                city: '',
                selected_product_id: products[0]?.id || '',
                quantity: 1,
                order_source: 'Facebook Ads',
                payment_method: 'COD',
              });
              setIsManualOrderOpen(true);
            }}
            className="px-3.5 py-2 rounded-full bg-orange-50 border border-orange-200 text-orange-900 hover:bg-orange-100 font-bold text-xs flex items-center space-x-1.5 transition-colors"
          >
            <Phone className="w-4 h-4 text-orange-600" />
            <span>FB / Call Order Entry</span>
          </button>}

          {canEditTab('lead_import') && <button
            onClick={() => {
              setBulkCsvFileName('');
              setParsedCsvRows([]);
              setIsBulkOrderOpen(true);
            }}
            className="px-3.5 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 hover:bg-emerald-100 font-bold text-xs flex items-center space-x-1.5 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Bulk CSV Order Import</span>
          </button>}

          <button
            onClick={() => setIsChangePasswordOpen(true)}
            className="px-3.5 py-2 rounded-full bg-gray-100 border border-gray-200 text-gray-800 hover:bg-gray-200 font-bold text-xs flex items-center space-x-1.5 transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5 text-gray-600" />
            <span>Change Password</span>
          </button>

          <button
            onClick={logoutAdmin}
            className="px-3.5 py-2 rounded-full bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 font-bold text-xs flex items-center space-x-1.5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>

          <button
            onClick={() => window.open('/', '_blank', 'noopener,noreferrer')}
            className="px-3.5 py-2 rounded-full bg-gray-900 text-white hover:bg-black font-bold text-xs flex items-center space-x-1.5 transition-colors"
          >
            <Store className="w-3.5 h-3.5 text-orange-400" />
            <span>View O-RA Store</span>
          </button>
        </div>
      </div>


      {/* Responsive Admin Sidebar Navigation */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setIsSidebarOpen((value) => !value)}
          className="w-full flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 font-bold text-sm shadow-xs"
        >
          <span className="flex items-center gap-2"><Menu className="w-5 h-5 text-orange-600" /> Admin Menu</span>
          <span className="text-xs text-gray-500">{isSidebarOpen ? 'Close' : 'Open'}</span>
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <aside className={`${isSidebarOpen ? 'block' : 'hidden'} lg:block w-full lg:w-72 lg:shrink-0`}>
          <div className="lg:sticky lg:top-4 rounded-3xl border border-gray-200 bg-white p-3 shadow-sm lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="px-3 py-3 border-b border-gray-100 mb-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-orange-600">O-RA Control Menu</p>
              <p className="mt-1 text-sm font-bold text-gray-900">{adminUser?.name || 'Admin User'}</p>
              <p className="text-[11px] text-gray-500">{roleLabel[currentRole]}</p>
            </div>
            <nav className="space-y-2">
              {canAccessTab('overview') && <button
                type="button"
                onClick={()=>openSidebarTab('overview')}
                className={`w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold transition-all flex items-center gap-3 ${activeTab==='overview'?'bg-black text-white shadow-sm':'text-gray-600 hover:bg-orange-50 hover:text-orange-800'}`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTab==='overview'?'bg-orange-500/15':'bg-gray-100'}`}><LayoutDashboard className={`w-4 h-4 ${activeTab==='overview'?'text-orange-400':'text-gray-500'}`}/></span>
                <span>Dashboard</span>
              </button>}

              {sidebarGroups.map((group)=>{
                const visibleItems=group.items.filter((item)=>canAccessTab(item.id));
                if(!visibleItems.length)return null;
                const expanded=openSidebarGroup===group.id;
                const groupActive=visibleItems.some((item)=>item.id===activeTab);
                return <div key={group.id} className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                  <button type="button" onClick={()=>setOpenSidebarGroup((current)=>current===group.id?'':group.id)} className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left ${groupActive?'bg-orange-50':'hover:bg-white'}`}>
                    <span className={`text-[10px] font-black tracking-[0.12em] ${groupActive?'text-orange-700':'text-gray-500'}`}>{group.label}</span>
                    <span className="flex items-center gap-2">{Number((group as any).badge||0)>0&&<span className="min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[9px] font-black text-white">{Number((group as any).badge)}</span>}<ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${expanded?'rotate-180':''}`}/></span>
                  </button>
                  {expanded&&<div className="space-y-1 border-t border-gray-100 bg-white p-1.5">{visibleItems.map((tab)=>{
                    const Icon=tab.icon;
                    const isActive=activeTab===tab.id;
                    return <button key={tab.id} type="button" onClick={()=>openSidebarTab(tab.id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold transition-all flex items-center gap-3 ${isActive?'bg-black text-white shadow-sm':'text-gray-600 hover:bg-orange-50 hover:text-orange-800'}`}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isActive?'bg-orange-500/15':'bg-gray-100'}`}><Icon className={`w-4 h-4 ${isActive?'text-orange-400':'text-gray-500'}`}/></span>
                      <span className="leading-4">{tab.label}</span>
                    </button>;
                  })}</div>}
                </div>;
              })}
            </nav>
          </div>
        </aside>

        <main className="w-full min-w-0 flex-1 space-y-6" onClickCapture={guardViewOnlyEvent} onChangeCapture={guardViewOnlyEvent} onSubmitCapture={guardViewOnlyEvent} onKeyDownCapture={guardViewOnlyEvent}>
      {activeAccessLevel === 'view' && (
        <div data-ora-view-allowed="true" className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-800">
          View Only access • You can read this module, but normal edit/manage controls are locked. Special actions work only when Super Admin enabled them.
        </div>
      )}
      {/* TAB 1: OVERVIEW & REPORTS */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-neutral-400 text-xs">
                <span>Total Revenue Sales</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-2xl font-bold text-emerald-400">
                Rs. {totalSalesRevenue.toLocaleString()}
              </p>
              <p className="text-[10px] text-neutral-500">Gross revenue across all order channels</p>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-neutral-400 text-xs">
                <span>Net Calculated Profit</span>
                <TrendingUp className="w-4 h-4 text-amber-400" />
              </div>
              <p className="text-2xl font-bold text-amber-400">
                Rs. {totalProfit.toLocaleString()}
              </p>
              <p className="text-[10px] text-neutral-500">Selling Price minus Buying Price margin</p>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-neutral-400 text-xs">
                <span>Total Orders Placed</span>
                <ShoppingBag className="w-4 h-4 text-blue-400" />
              </div>
              <p className="text-2xl font-bold text-white">{totalOrdersCount}</p>
              <p className="text-[10px] text-neutral-500">Website + Social Media Ads</p>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-neutral-400 text-xs">
                <span>Low Stock Warnings</span>
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <p className="text-2xl font-bold text-red-400">{lowStockProducts.length}</p>
              <p className="text-[10px] text-neutral-500">Products with stock &le; 5 units</p>
            </div>
          </div>

          {/* Private Website Visitor Analytics - Admin/Staff storefront views are excluded */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-white">Website Visitors</p>
                <p className="text-[10px] text-neutral-500">Customer traffic only • Admin/Staff store previews are not counted</p>
              </div>
              <BarChart3 className="h-5 w-5 text-orange-400" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {[
                ['Today', visitorAnalytics.todayVisitors],
                ['Last 7 Days', visitorAnalytics.last7Visitors],
                ['Last 30 Days', visitorAnalytics.last30Visitors],
                ['Total Visitors', visitorAnalytics.totalVisitors],
                ['Page Views', visitorAnalytics.totalPageViews],
              ].map(([label,value]) => (
                <div key={String(label)} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</p>
                  <p className="mt-1 text-xl font-black text-white">{Number(value).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Low Stock Alert Box */}
          {lowStockProducts.length > 0 && (
            <div className="bg-red-950/40 border border-red-500/40 rounded-2xl p-4 space-y-3">
              <div className="flex items-center space-x-2 text-red-400 font-bold text-sm">
                <AlertTriangle className="w-5 h-5" />
                <span>Low Stock Inventory Warning (&le; 5 units)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {lowStockProducts.map((p) => (
                  <div
                    key={p.id}
                    className="bg-neutral-900 p-3 rounded-xl border border-neutral-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-semibold text-white">{p.name_en}</p>
                      <p className="text-[10px] text-neutral-400">SKU: {p.sku}</p>
                    </div>
                    <button
                      onClick={() => {
                        setStockAdjustModalProduct(p);
                        setStockAdjustVariantId('');
                        setStockChangeQty(20);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-bold text-[10px]"
                    >
                      Refill ({p.stock_quantity})
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'combo_packs' && canAccessTab('combo_packs') && (
        <ComboPacksPanel initialEditId={comboEditProductId} onInitialEditHandled={() => setComboEditProductId(undefined)} />
      )}

      {/* TAB 2: PRODUCTS MANAGER */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white">All Store Products ({products.length})</h2>
              <p className="text-xs text-neutral-400">Search and manage product inventory by Item Code (SKU) or Name.</p>
            </div>

            <div className="flex items-center space-x-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter Item Code (SKU) or Name..."
                  value={productSearchQuery}
                  onChange={(e) => setProductSearchQuery(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:border-amber-500 font-mono"
                />
              </div>

              {canAccessTab('add_product') && <button type="button" onClick={handleVariantTestProduct} className="px-3 py-2 rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-300 font-black text-[10px] shrink-0">
                {products.some(p=>String(p.sku).toUpperCase()==='TEST-WB01') ? 'Delete Variant Test Product' : 'Add Variant Test Product'}
              </button>}

              {canAccessTab('add_product') && <button
                onClick={openNewProductWorkspace}
                className="px-3.5 py-2 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs flex items-center space-x-1 shrink-0 hover:bg-amber-400"
              >
                <Plus className="w-4 h-4" />
                <span>Add Product</span>
              </button>}
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left text-xs text-neutral-300">
              <thead className="bg-neutral-950 text-neutral-400 uppercase text-[10px] border-b border-neutral-800">
                <tr>
                  <th className="p-3">Product</th>
                  <th className="p-3">Item Code (SKU)</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Buying Price</th>
                  <th className="p-3">Selling Price</th>
                  <th className="p-3">Stock</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {products
                  .filter((p) => {
                    if (!productSearchQuery) return true;
                    const q = productSearchQuery.toLowerCase();
                    return (
                      p.sku.toLowerCase().includes(q) ||
                      p.name_en.toLowerCase().includes(q) ||
                      p.name_si.toLowerCase().includes(q)
                    );
                  })
                  .map((p) => (
                    <tr key={p.id} className="hover:bg-neutral-800/50">
                      <td className="p-3 flex items-center space-x-2">
                        <img
                          src={p.images[0]}
                          alt=""
                          className="w-10 h-10 object-cover rounded-lg border border-neutral-800 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <p className="font-semibold text-white">{p.name_en}</p>
                          <p className="text-[10px] text-neutral-500">{p.name_si}</p>
                          {(p.source_shop_name || p.source_shop_price) && (
                            <p className="text-[9px] text-sky-400/80 mt-0.5">
                              Ref: {p.source_shop_name || 'Shop not named'}{p.source_shop_price ? ` • Rs. ${Number(p.source_shop_price).toLocaleString()}` : ''}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="p-3 font-mono">
                        <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                          {p.sku}
                        </span>
                      </td>
                    <td className="p-3 capitalize">{normalizedProductType(p)==='bundle' ? 'Combo Pack' : p.category_slug}</td>
                    <td className="p-3 text-neutral-400">Rs. {p.buying_price.toLocaleString()}</td>
                    <td className="p-3 font-bold text-white">
                      Rs. {((p.discount_enabled !== false && p.discount_price && p.discount_price < p.selling_price ? p.discount_price : p.selling_price)).toLocaleString()}
                    </td>
                    <td className="p-3">
                      {normalizedProductType(p)==='bundle' ? <span className="font-bold text-cyan-300">Component-linked</span> : <span className={`font-bold ${p.stock_quantity <= 5 ? 'text-red-400' : 'text-emerald-400'}`}>{p.stock_quantity}</span>}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-800 text-neutral-300 border border-neutral-700">
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-1">
                      <button
                        onClick={() => {
                          if (normalizedProductType(p) === 'bundle') {
                            setComboEditProductId(p.id);
                            setActiveTab('combo_packs');
                            return;
                          }
                          setEditingProduct(p);
                          setProductForm({
                            sku: p.sku,
                            name_en: p.name_en,
                            name_si: p.name_si,
                            description_en: p.description_en,
                            description_si: p.description_si,
                            brand: p.brand || '',
                            search_keywords: p.search_keywords || '',
                            source_shop_name: p.source_shop_name || '',
                            source_shop_price: Number(p.source_shop_price || 0),
                            category_slug: p.category_slug,
                            product_type: normalizedProductType(p),
                            variants: (p.variants || []).map(v=>({...v})),
                            bundle_components: (p.bundle_components || []).map(c=>({...c})),
                            specifications: (p.specifications || []).map(spec=>({...spec})),
                            item_details: (p.item_details || []).map(detail=>({...detail})),
                            is_test_product: Boolean(p.is_test_product),
                            buying_price: p.buying_price,
                            selling_price: p.selling_price,
                            discount_price: (p.discount_enabled !== false && p.discount_price && p.discount_price < p.selling_price ? p.discount_price : p.selling_price),
                            discount_enabled: Boolean(p.discount_enabled),
                            auto_price_enabled: p.auto_price_enabled !== false,
                            auto_discount_on_cost_drop: p.auto_discount_on_cost_drop !== false,
                            offer_buying_price: p.offer_buying_price,
                            supplier_offer_enabled: Boolean(p.supplier_offer_enabled),
                            supplier_offer_saved_at: p.supplier_offer_saved_at,
                            stock_quantity: p.stock_quantity,
                            status: p.status,
                            images: p.images,
                          });
                          setProductAutoPricing(p.auto_price_enabled !== false);
                          setProductAutoCode(false);
                          setIsAddProductOpen(true);
                          setActiveTab('add_product');
                        }}
                        className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-amber-400"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete product ${p.name_en}?`)) deleteProduct(p.id);
                        }}
                        className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CATEGORIES MANAGER */}
      {activeTab === 'banners' && canAccessTab('banners') && <BannersPanel />}

      {activeTab === 'notifications' && canAccessTab('notifications') && <NotificationsPanel />}

      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white">Product Categories ({categories.length})</h2>
              <p className="text-xs text-neutral-400">Add, edit and remove the categories shown on the storefront and product forms.</p>
            </div>
            <button
              onClick={() => {
                setEditingCategory(null);
                setCategoryForm({ name_en: '', name_si: '', slug: '', icon: '📦', code_prefix: '' });
                setIsAddCategoryOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs flex items-center gap-1.5 hover:bg-amber-400"
            >
              <Plus className="w-4 h-4" /> Add Category
            </button>
          </div>

          {isAddCategoryOpen && (
            <div className="bg-neutral-900 border border-amber-500/30 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-white">{editingCategory ? 'Edit Category' : 'Add New Category'}</h3>
                  <p className="text-[11px] text-neutral-500">Type English or Sinhala first. Common categories auto-fill the other name, slug and up to 3 searchable emojis.</p>
                </div>
                <button onClick={() => setIsAddCategoryOpen(false)} className="p-2 rounded-lg bg-neutral-800 text-neutral-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">Icon / Emoji</label>
                  <input value={categoryForm.icon} onChange={(e) => setCategoryForm({ ...categoryForm, icon: e.target.value })} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white" maxLength={24} placeholder="🧸 🪀 🚗" />
                  <p className="mt-1 text-[9px] text-neutral-600">Any one of these emojis can be used in customer search.</p>
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">English Name *</label>
                  <input value={categoryForm.name_en} onChange={(e) => {
                    const name = e.target.value;
                    const suggestion = suggestCategoryFields(name, 'en');
                    setCategoryForm((prev) => ({
                      ...prev,
                      name_en: name,
                      name_si: suggestion.name_si ?? prev.name_si,
                      slug: editingCategory ? prev.slug : (suggestion.slug ?? prev.slug),
                      icon: suggestion.icon ?? prev.icon,
                    }));
                  }} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white" placeholder="Kids Toys" />
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">Sinhala Name</label>
                  <input value={categoryForm.name_si} onChange={(e) => {
                    const name = e.target.value;
                    const suggestion = suggestCategoryFields(name, 'si');
                    setCategoryForm((prev) => ({
                      ...prev,
                      name_si: name,
                      name_en: suggestion.name_en ?? prev.name_en,
                      slug: editingCategory ? prev.slug : (suggestion.slug ?? prev.slug),
                      icon: suggestion.icon ?? prev.icon,
                    }));
                  }} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white" placeholder="ළමා සෙල්ලම් බඩු" />
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">Item Code Prefix</label>
                  <input value={categoryForm.code_prefix} onChange={(e) => setCategoryForm({ ...categoryForm, code_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,6) })} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono" placeholder="KID" />
                  <p className="mt-1 text-[9px] text-neutral-600">Set once, then new products auto become KID-0001, KID-0002…</p>
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">Slug *</label>
                  <input value={categoryForm.slug} onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono" placeholder="kids-toys" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setIsAddCategoryOpen(false)} className="px-4 py-2 rounded-xl bg-neutral-800 text-neutral-300 text-xs font-bold">Cancel</button>
                <button
                  onClick={() => {
                    const name_en = categoryForm.name_en.trim();
                    const slug = categoryForm.slug.trim();
                    if (!name_en || !slug) return alert('Could not auto-identify this category. Please enter the English name once so the slug can be created.');
                    const duplicate = categories.some((c) => c.slug === slug && c.id !== editingCategory?.id);
                    if (duplicate) return alert('This category slug already exists. Please use another slug.');
                    const payload = { name_en, name_si: categoryForm.name_si.trim(), slug, icon: categoryForm.icon.trim() || '📦 🛍️ ✨', code_prefix: categoryForm.code_prefix.trim().toUpperCase() || undefined };
                    if (editingCategory) updateCategory({ ...editingCategory, ...payload });
                    else addCategory(payload);
                    setIsAddCategoryOpen(false);
                    setEditingCategory(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-neutral-950 text-xs font-bold hover:bg-amber-400"
                >
                  {editingCategory ? 'Save Changes' : 'Add Category'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {categories.map((cat) => {
              const productCount = products.filter((p) => normalizedProductType(p) !== 'bundle' && p.category_slug === cat.slug).length;
              return (
                <div key={cat.id} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-center text-2xl shrink-0">{cat.icon || '📦'}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-white truncate">{cat.name_en}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{cat.name_si || '—'}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      <span className="font-mono text-amber-400">{cat.code_prefix ? `${cat.code_prefix} • ` : ''}{cat.slug}</span>
                      <span className="text-neutral-500">• {productCount} product{productCount === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setEditingCategory(cat); setCategoryForm({ name_en: cat.name_en, name_si: cat.name_si, slug: cat.slug, icon: cat.icon, code_prefix: cat.code_prefix || '' }); setIsAddCategoryOpen(true); }} className="p-2 rounded-lg bg-neutral-800 text-amber-400 hover:bg-neutral-700"><Edit className="w-3.5 h-3.5" /></button>
                    <button onClick={() => {
                      if (productCount > 0) return alert(`Cannot delete ${cat.name_en}. ${productCount} product(s) are using this category. Move those products to another category first.`);
                      if (confirm(`Delete category ${cat.name_en}?`)) deleteCategory(cat.id);
                    }} className="p-2 rounded-lg bg-neutral-800 text-red-400 hover:bg-neutral-700"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
          {categories.length === 0 && <div className="p-8 text-center bg-neutral-900 border border-neutral-800 rounded-2xl text-neutral-500 text-sm">No categories yet. Click Add Category to create the first one.</div>}
        </div>
      )}

      {/* TAB 4: STOCK & INVENTORY CONTROL */}
      {activeTab === 'stock' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white">Inventory, Purchases & Stock Analysis</h2>
              <p className="text-xs text-neutral-400">Purchase entry, sales performance, profit/loss and complete stock movement.</p>
            </div>
            <button
              onClick={() => {
                const first = products.find((p)=>normalizedProductType(p)!=='bundle');
                setPurchaseForm({ supplier_name: '', product_id: first?.id || '', variant_id: '', quantity_added: 1, unit_buying_price: first?.buying_price || 0, invoice_ref: '', notes: '' });
                setPurchaseItemCode(products.find(p=>p.id===purchaseForm.product_id)?.sku || ''); setIsPurchaseOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs flex items-center gap-2 hover:bg-amber-400"
            >
              <PlusCircle className="w-4 h-4" /> Add Purchase
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="flex justify-between text-xs text-neutral-400"><span>Inventory Value</span><Boxes className="w-4 h-4 text-sky-400" /></div>
              <p className="text-xl font-bold text-sky-400 mt-2">Rs. {inventoryValue.toLocaleString()}</p>
              <p className="text-[10px] text-neutral-500">Current stock × buying price</p>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="flex justify-between text-xs text-neutral-400"><span>Purchase Cost</span><ReceiptText className="w-4 h-4 text-orange-400" /></div>
              <p className="text-xl font-bold text-orange-400 mt-2">Rs. {totalPurchasedCost.toLocaleString()}</p>
              <p className="text-[10px] text-neutral-500">Total recorded purchase orders</p>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="flex justify-between text-xs text-neutral-400"><span>Delivered Profit / Loss</span><TrendingUp className="w-4 h-4 text-emerald-400" /></div>
              <p className={`text-xl font-bold mt-2 ${deliveredProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>Rs. {deliveredProfit.toLocaleString()}</p>
              <p className="text-[10px] text-neutral-500">Delivered sales revenue minus item cost</p>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="flex justify-between text-xs text-neutral-400"><span>Low Stock Alerts</span><AlertTriangle className="w-4 h-4 text-red-400" /></div>
              <p className="text-xl font-bold text-red-400 mt-2">{lowStockProducts.length}</p>
              <p className="text-[10px] text-neutral-500">Products with 5 units or less</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3"><Trophy className="w-4 h-4 text-amber-400" /><h3 className="font-bold text-white text-sm">Best Performing Item</h3></div>
              {bestItem ? <div className="space-y-2"><p className="font-semibold text-white">{bestItem.name}</p><p className="text-xs text-neutral-400">{bestItem.sku} • {bestItem.unitsSold} units sold</p><p className="text-sm font-bold text-emerald-400">Profit: Rs. {bestItem.profit.toLocaleString()}</p></div> : <p className="text-xs text-neutral-500">No delivered sales yet.</p>}
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3"><Gauge className="w-4 h-4 text-red-400" /><h3 className="font-bold text-white text-sm">Weak / Slow Moving Item</h3></div>
              {weakItem ? <div className="space-y-2"><p className="font-semibold text-white">{weakItem.name}</p><p className="text-xs text-neutral-400">{weakItem.sku} • {weakItem.unitsSold} units sold • Stock {weakItem.stock}</p><p className={`text-sm font-bold ${weakItem.profit >= 0 ? 'text-amber-400' : 'text-red-400'}`}>Profit/Loss: Rs. {weakItem.profit.toLocaleString()}</p></div> : <p className="text-xs text-neutral-500">No product data.</p>}
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <h3 className="font-bold text-white text-sm mb-4">Stock & Sales Analysis Chart</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 45 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="shortName" angle={-28} textAnchor="end" interval={0} tick={{ fill: '#a3a3a3', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#a3a3a3', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#171717', border: '1px solid #404040', borderRadius: 12 }} />
                  <Legend />
                  <Bar dataKey="unitsSold" name="Units Sold" fill="#f59e0b" radius={[6,6,0,0]} />
                  <Bar dataKey="stock" name="Current Stock" fill="#38bdf8" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden overflow-x-auto">
            <div className="p-4 border-b border-neutral-800"><h3 className="font-bold text-white text-sm">Purchase History</h3></div>
            <table className="w-full text-left text-xs text-neutral-300">
              <thead className="bg-neutral-950 text-neutral-400 uppercase text-[10px]"><tr><th className="p-3">PO / Date</th><th className="p-3">Supplier</th><th className="p-3">Product</th><th className="p-3">Qty</th><th className="p-3">Unit Cost</th><th className="p-3">Total</th><th className="p-3">Invoice</th></tr></thead>
              <tbody className="divide-y divide-neutral-800">{purchaseOrders.map((po) => <tr key={po.id}><td className="p-3"><p className="font-bold text-amber-400">{po.po_number}</p><p className="text-[10px] text-neutral-500">{new Date(po.created_at).toLocaleString()}</p></td><td className="p-3">{po.supplier_name}</td><td className="p-3"><p className="text-white font-semibold">{po.product_name}</p><p className="text-[10px] text-neutral-500">{po.sku}</p></td><td className="p-3 font-bold">+{po.quantity_added}</td><td className="p-3">Rs. {po.unit_buying_price.toLocaleString()}</td><td className="p-3 font-bold text-white">Rs. {po.total_cost.toLocaleString()}</td><td className="p-3">{po.invoice_ref || '-'}</td></tr>)}</tbody>
            </table>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden overflow-x-auto">
            <div className="p-4 border-b border-neutral-800"><h3 className="font-bold text-white text-sm">Stock Audit History Logs</h3></div>
            <table className="w-full text-left text-xs text-neutral-300">
              <thead className="bg-neutral-950 text-neutral-400 uppercase text-[10px] border-b border-neutral-800"><tr><th className="p-3">Date</th><th className="p-3">Product</th><th className="p-3">Type</th><th className="p-3">Qty</th><th className="p-3">Prev → New</th><th className="p-3">Reason / Channel</th><th className="p-3">Actor</th></tr></thead>
              <tbody className="divide-y divide-neutral-800">{stockHistory.map((stk) => <tr key={stk.id} className="hover:bg-neutral-800/50"><td className="p-3 text-[10px] text-neutral-400">{new Date(stk.created_at).toLocaleString()}</td><td className="p-3 font-semibold text-white">{stk.product_name}</td><td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${stk.change_type === 'Order Deduction' || stk.change_type === 'Decrease' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{stk.change_type}</span></td><td className="p-3 font-bold">{stk.quantity}</td><td className="p-3 font-mono text-neutral-400">{stk.previous_stock} → <span className="text-amber-400 font-bold">{stk.new_stock}</span></td><td className="p-3 text-neutral-300">{stk.reason}</td><td className="p-3 text-neutral-400">{stk.performed_by}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: ORDERS MANAGER */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <h2 className="text-base font-bold text-white">Order Management</h2>
              <button
                onClick={() => {
                  setBulkCsvFileName('');
                  setParsedCsvRows([]);
                  setIsBulkOrderOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 font-bold text-xs flex items-center space-x-1.5 transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Upload Bulk CSV Orders</span>
              </button>
            </div>

            {/* Status Filter */}
            <div className="flex space-x-1.5 overflow-x-auto pb-1 max-w-full">
              {['All', 'New Orders', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Cancelled'].map((st) => (
                <button
                  key={st}
                  onClick={() => setOrderFilter(st as any)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap border ${
                    orderFilter === st
                      ? 'bg-amber-500 text-neutral-950 border-amber-400'
                      : 'bg-neutral-900 text-neutral-400 border-neutral-800'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="Search any order detail: Order ID, name, phone, item code, item name, waybill, address..."
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 py-2.5 pl-10 pr-20 text-sm text-white outline-none focus:border-orange-500"
            />
            {orderSearch && (
              <button type="button" onClick={() => setOrderSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400 hover:text-white">
                Clear
              </button>
            )}
          </div>

          <div className="text-[11px] text-neutral-500">
            Showing {filteredOrders.length} of {orders.length} orders
          </div>
          {selectedDeleteOrderId && (() => {
            const selected = orders.find((o) => o.id === selectedDeleteOrderId);
            if (!selected) return null;
            return (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <div className="text-xs text-red-100">
                  Selected: <b className="font-mono">{selected.order_number}</b> • {selected.customer_name}
                </div>
                <button
                  type="button"
                  onClick={() => { setDeleteOrderReason(''); setIsDeleteOrderOpen(true); }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-500"
                >
                  <Trash2 className="w-4 h-4" /> Delete Selected Order
                </button>
              </div>
            );
          })()}

          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800 pb-3 text-xs">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedDeleteOrderId === order.id}
                      onChange={(e) => setSelectedDeleteOrderId(e.target.checked ? order.id : '')}
                      className="mt-0.5 h-4 w-4 accent-red-500"
                      title="Select this order for deletion"
                    />
                    <div>
                    <span className="font-mono font-bold text-amber-400 text-sm">
                      {order.order_number}
                    </span>
                    <span className="text-neutral-400 text-[10px] ml-2">
                      Source: {order.order_source || 'Website'} | Date: {new Date(order.created_at).toLocaleString()}
                    </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span
                      className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
                        order.order_status === 'Delivered'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : order.order_status === 'Cancelled'
                          ? 'border-red-500/30 bg-red-500/10 text-red-300'
                          : order.order_status === 'Shipped'
                          ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                          : order.order_status === 'Packed'
                          ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                          : order.order_status === 'Processing'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          : 'border-neutral-700 bg-neutral-950 text-neutral-300'
                      }`}
                      title="Order status is managed automatically by the system flow"
                    >
                      {order.order_status}
                    </span>
                  </div>
                </div>

                {/* Customer Details & Items */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1 text-neutral-300">
                    <p className="font-bold text-white">{order.customer_name}</p>
                    <p>Phone: {order.phone} | WhatsApp: {order.whatsapp}</p>
                    <p>Address: {order.address}, {order.city}</p>
                    <p className="text-neutral-400">Payment: {order.payment_method} ({order.payment_status})</p>
                    <p className={`font-bold ${order.stock_allocated ? 'text-emerald-400' : 'text-orange-400'}`}>Stock: {order.stock_allocated ? 'Allocated' : 'Waiting for Stock'}</p>
                    {order.is_duplicate_order && <p className="font-bold text-red-400">Duplicate Order • Invoice Blocked</p>}
                  </div>

                  <div className="bg-neutral-950 p-2.5 rounded-xl border border-neutral-800 space-y-1">
                    <p className="font-bold text-white text-[11px]">Items Ordered:</p>
                    {order.items.map((it, i) => (
                      <div key={i} className="flex justify-between text-neutral-400 text-[11px]">
                        <span>• {it.product_name}{it.variant_name ? ` - ${it.variant_name}` : ''} (x{it.quantity})</span>
                        <span className="font-mono">Rs. {it.subtotal.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-amber-400 pt-1 border-t border-neutral-800">
                      <span>Total Payable:</span>
                      <span>Rs. {order.total_amount.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {order.payment_method === 'Bank Payment' && order.bank_receipt_url && (
                  <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button type="button" onClick={() => window.open(order.bank_receipt_url, '_blank')} className="w-24 h-24 rounded-xl overflow-hidden border border-neutral-700 bg-black shrink-0">
                        <img src={order.bank_receipt_url} alt="Payment receipt" className="w-full h-full object-cover" />
                      </button>
                      <div className="flex-1 space-y-1 text-neutral-300">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="font-bold text-white">Payment Verification</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${order.payment_verification_status === 'Approved' ? 'bg-emerald-500/20 text-emerald-400' : order.payment_verification_status === 'Rejected' ? 'bg-red-500/20 text-red-400' : order.payment_verification_status === 'Auto Check Passed' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'}`}>{order.payment_verification_status || 'Needs Review'}</span>
                        </div>
                        <p>Detected Bank: <b>{order.payment_detected_bank || 'Not detected'}</b></p>
                        <p>Detected Amount: <b>{order.payment_detected_amount ? `Rs. ${order.payment_detected_amount.toLocaleString()}` : 'Not detected'}</b></p>
                        <p>Reference: <b className="font-mono">{order.payment_reference || 'Not detected'}</b></p>
                        <p className="text-[10px] text-neutral-500">{order.payment_check_notes || 'Receipt requires final admin review.'}</p>
                        {order.payment_reviewed_by && <p className="text-[10px] text-neutral-500">Reviewed by {order.payment_reviewed_by}</p>}
                      </div>
                    </div>
                    {canAccessTab('bank_transfer_check') && order.payment_verification_status !== 'Approved' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setActiveTab('bank_transfer_check')} className="px-3 py-2 rounded-lg bg-orange-500 text-neutral-950 font-bold text-[10px]">Open Bank Transfer Check</button>
                        <span className="text-[9px] text-neutral-500">Approve / Reject only from Bank Transfer Check.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Advance Rule Confirmation status */}
                {order.is_advance_required && (
                  <div className="bg-amber-950/60 border border-amber-500/40 rounded-xl p-2.5 text-xs flex items-center justify-between">
                    <span className="text-amber-300 text-[11px]">
                      {settings.advance_percentage ?? 50}% Advance Required: <b>Rs. {order.advance_amount.toLocaleString()}</b>
                    </span>
                    {!order.advance_confirmed ? (
                      order.payment_method === 'Bank Payment' ? (
                        <button type="button" onClick={() => setActiveTab('bank_transfer_check')} className="px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold text-[10px]">Check Bank Transfer</button>
                      ) : (
                        <button
                          onClick={() => confirmAdvancePayment(order.id)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 text-neutral-950 font-bold text-[10px]"
                        >
                          Confirm Advance Received
                        </button>
                      )
                    ) : (
                      <span className="text-emerald-400 font-bold text-[10px] flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Advance Confirmed</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'invoices' && (
        <div className="space-y-5">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2"><Printer className="w-5 h-5 text-orange-400" />A6 Batch Invoice Center</h2>
                <p className="text-xs text-neutral-400">Select up to 50 ready orders. One A6 invoice per order, one combined PDF. Each generation creates one Packing Batch. Invoice locks after first generation.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setSelectedInvoiceIds(orders.filter((o) => !o.invoice_locked && !o.is_duplicate_order && o.stock_allocated && Boolean(o.waybill_number) && o.order_status !== 'Cancelled').slice(0,50).map((o) => o.id))} className="px-3 py-2 rounded-xl bg-neutral-800 text-white text-xs font-bold">Select Ready (Max 50)</button>
                <button
                  disabled={selectedInvoiceIds.length < 1 || selectedInvoiceIds.length > 50}
                  onClick={async () => {
                    const generated = markInvoicesGenerated(selectedInvoiceIds, adminUser?.name || 'Admin');
                    if (!generated.length) { alert('No eligible invoices. Stock must be allocated, waybill assigned, order must not be duplicate, and invoice must not already exist.'); return; }
                    try {
                      await generateBatchInvoicesPDF(generated, settings);
                      setSelectedInvoiceIds([]);
                    } catch (e: any) {
                      alert(e.message || 'PDF generation failed.');
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-orange-500 disabled:opacity-40 text-black text-xs font-bold flex items-center gap-2"
                ><Download className="w-4 h-4" />Generate Selected ({selectedInvoiceIds.length})</button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800"><p className="text-[10px] text-neutral-500">WAITING STOCK</p><p className="text-xl font-bold text-orange-400">{orders.filter((o) => !o.stock_allocated && !o.is_duplicate_order && o.order_status !== 'Cancelled').length}</p></div>
              <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800"><p className="text-[10px] text-neutral-500">READY + WAYBILL</p><p className="text-xl font-bold text-emerald-400">{orders.filter((o) => o.stock_allocated && o.waybill_number && !o.invoice_locked && !o.is_duplicate_order && o.order_status !== 'Cancelled').length}</p></div>
              <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800"><p className="text-[10px] text-neutral-500">DUPLICATE BLOCKED</p><p className="text-xl font-bold text-red-400">{orders.filter((o) => o.is_duplicate_order).length}</p></div>
              <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800"><p className="text-[10px] text-neutral-500">INVOICE HISTORY</p><p className="text-xl font-bold text-blue-400">{orders.filter((o) => o.invoice_locked).length}</p></div>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-neutral-800"><h3 className="font-bold text-white">Orders / Invoice Eligibility</h3></div>
            <div className="overflow-x-auto max-h-[460px]">
              <table className="w-full text-left text-xs text-neutral-300">
                <thead className="bg-neutral-950 sticky top-0 text-[10px] uppercase text-neutral-500"><tr><th className="p-3">Select</th><th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Stock</th><th className="p-3">Waybill</th><th className="p-3">Invoice</th><th className="p-3">Reason</th></tr></thead>
                <tbody className="divide-y divide-neutral-800">
                  {orders.filter((o) => o.order_status !== 'Cancelled').map((o) => {
                    const reasons = validateInvoiceOrder(o);
                    const canGenerate = reasons.length === 0 && !o.invoice_locked;
                    return <tr key={o.id} className="hover:bg-neutral-950/50">
                      <td className="p-3"><input type="checkbox" disabled={!canGenerate} checked={selectedInvoiceIds.includes(o.id)} onChange={(e) => setSelectedInvoiceIds((prev) => e.target.checked ? Array.from(new Set([...prev,o.id])).slice(0,50) : prev.filter((id) => id !== o.id))} /></td>
                      <td className="p-3 font-mono text-orange-400">{o.order_number}<div className="text-[9px] text-neutral-500">{o.order_source}</div></td>
                      <td className="p-3"><b className="text-white">{o.customer_name}</b><div className="text-[10px]">{o.phone}</div></td>
                      <td className={`p-3 font-bold ${o.stock_allocated ? 'text-emerald-400':'text-orange-400'}`}>{o.stock_allocated ? 'Allocated':'Waiting'}</td>
                      <td className="p-3 font-mono">{o.waybill_number || 'Not Assigned'}</td>
                      <td className="p-3">{o.invoice_locked ? <button onClick={() => generateOrderInvoicePDF(o,settings)} className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 font-bold">Re-download</button> : <span className="text-neutral-500">Not Generated</span>}</td>
                      <td className="p-3">{o.is_duplicate_order ? <span className="text-red-400 font-bold">Duplicate • Blocked</span> : o.invoice_locked ? <span className="text-blue-400">Locked</span> : reasons.length ? <span className="text-orange-400">{reasons.join(', ')}</span> : <span className="text-emerald-400 font-bold">Ready</span>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'packing' && (() => {
        const q = packingSearch.trim().toLowerCase();
        const todayKey = new Date().toDateString();

        const generated = orders
          .filter(o => o.invoice_locked && o.invoice_pack_batch_id)
          .sort((x,y)=>new Date(y.invoice_generated_at || y.created_at).getTime()-new Date(x.invoice_generated_at || x.created_at).getTime());

        const allGroups = Array.from(generated.reduce((map,o)=>{
          const id=o.invoice_pack_batch_id || 'LEGACY';
          const list=map.get(id)||[];
          list.push(o);
          map.set(id,list);
          return map;
        }, new Map<string,Order[]>()).entries());

        const grouped = allGroups.filter(([batchId,batchOrders])=>{
          const downloaded = batchOrders.every(o=>Boolean(o.invoice_pack_downloaded_at));
          const generatedDate = new Date(batchOrders[0]?.invoice_generated_at || batchOrders[0]?.created_at || 0);

          if (packingFilter==='pending' && downloaded) return false;
          if (packingFilter==='downloaded' && !downloaded) return false;
          if (packingFilter==='today' && generatedDate.toDateString()!==todayKey) return false;

          if (!q) return true;
          return batchId.toLowerCase().includes(q) || batchOrders.some(o =>
            String(o.order_number||'').toLowerCase().includes(q) ||
            String(o.customer_name||'').toLowerCase().includes(q) ||
            String(o.phone||'').toLowerCase().includes(q) ||
            String(o.waybill_number||'').toLowerCase().includes(q)
          );
        });

        const pendingCount = allGroups.filter(([,os])=>!os.every(o=>Boolean(o.invoice_pack_downloaded_at))).length;

        return (
          <div className="space-y-4">
            <div data-ora-view-allowed="true" className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Package className="w-5 h-5 text-orange-400"/> Packing Invoice Downloads
                  </h2>
                  <p className="mt-1 text-xs text-neutral-400">
                    Shows batches, not thousands of individual orders. Default view shows only batches that still need downloading.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['pending',`Need Download (${pendingCount})`],
                    ['today','Today'],
                    ['downloaded','Downloaded'],
                    ['all','All']
                  ] as const).map(([id,label])=>(
                    <button key={id} type="button" onClick={()=>setPackingFilter(id)}
                      className={`rounded-lg px-3 py-2 text-[11px] font-bold ${packingFilter===id?'bg-orange-500 text-black':'bg-neutral-800 text-neutral-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <input
                  value={packingSearch}
                  onChange={e=>setPackingSearch(e.target.value)}
                  placeholder="Search Batch / Order ID / Customer / Phone / Waybill..."
                  className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-white outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {grouped.length===0 ? (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">
                No batches in this view.
              </div>
            ) : grouped.map(([batchId,batchOrders])=>{
              const downloaded = batchOrders.every(o=>Boolean(o.invoice_pack_downloaded_at));
              const downloadedAt = batchOrders.map(o=>o.invoice_pack_downloaded_at).filter(Boolean).sort().at(-1);
              const downloadedBy = batchOrders.map(o=>o.invoice_pack_downloaded_by).find(Boolean);
              const generatedAt = batchOrders[0]?.invoice_generated_at || batchOrders[0]?.created_at;
              const singlePageOrders = batchOrders.filter(o=>getInvoicePageCount(o)===1);
              const multiPageOrders = batchOrders.filter(o=>getInvoicePageCount(o)>1);
              const singleDownloaded = singlePageOrders.length>0 && singlePageOrders.every(o=>Boolean(o.invoice_pack_downloaded_at));
              const multiDownloaded = multiPageOrders.length>0 && multiPageOrders.every(o=>Boolean(o.invoice_pack_downloaded_at));

              const resolveDownloadSet = () => {
                const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                const existingDate = batchOrders.map(o=>o.invoice_pack_download_set_date).find(Boolean);
                const existingNumber = batchOrders.map(o=>o.invoice_pack_download_set_number).find((n)=>Number(n)>0);
                const setDate = existingDate || localDate(new Date());
                const usedNumbers = orders
                  .filter(o=>o.invoice_pack_download_set_date===setDate && Number(o.invoice_pack_download_set_number)>0)
                  .map(o=>Number(o.invoice_pack_download_set_number));
                const setNumber = Number(existingNumber || ((usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1));
                return { setDate, setNumber, stem:`${setDate}_Set-${String(setNumber).padStart(2,'0')}` };
              };

              const savePackingDownloaded = async (targets: Order[], setDate: string, setNumber: number) => {
                try {
                  await markInvoiceBatchDownloaded(
                    targets.map(o=>o.id),
                    adminUser?.name || 'Packing Staff',
                    { date: setDate, number: setNumber }
                  );
                } catch(e:any) {
                  alert(`PDF was downloaded, but the Downloaded status could not be saved.\n\n${e?.message || 'Please try again before reloading.'}`);
                }
              };

              const downloadSingleA6 = async () => {
                if(!singlePageOrders.length) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                try { await generateBatchInvoicesPDF(singlePageOrders,settings,`${stem}_A6-Singles.pdf`); }
                catch(e:any){ alert(e.message || 'A6 invoice download failed.'); return; }
                await savePackingDownloaded(singlePageOrders,setDate,setNumber);
              };

              const downloadSingleA4 = async () => {
                if(!singlePageOrders.length) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                try { await generateA4FourUpInvoicesPDF(singlePageOrders,settings,`${stem}_A4-4-Up.pdf`); }
                catch(e:any){ alert(e.message || 'A4 4-up invoice download failed.'); return; }
                await savePackingDownloaded(singlePageOrders,setDate,setNumber);
              };

              const downloadMultiPage = async () => {
                if(!multiPageOrders.length) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                try { await generateBatchInvoicesPDF(multiPageOrders,settings,`${stem}_Multi-Page-A6.pdf`); }
                catch(e:any){ alert(e.message || 'Multi-page invoice download failed.'); return; }
                await savePackingDownloaded(multiPageOrders,setDate,setNumber);
              };

              return (
                <div key={batchId} className="rounded-2xl border border-neutral-800 bg-neutral-900 overflow-hidden">
                  <div className="p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="font-mono text-white">{batchId}</b>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${downloaded?'bg-emerald-500/10 text-emerald-300':'bg-orange-500/10 text-orange-300'}`}>
                          {downloaded?'DOWNLOADED':'NEED DOWNLOAD'}
                        </span>
                        <span className="rounded-full bg-neutral-800 px-2.5 py-1 text-[10px] font-bold text-neutral-300">
                          {batchOrders.length} order{batchOrders.length===1?'':'s'}
                        </span>
                        {singlePageOrders.length>0 && <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold text-blue-300">Single A6: {singlePageOrders.length}</span>}
                        {multiPageOrders.length>0 && <span className="rounded-full bg-fuchsia-500/10 px-2.5 py-1 text-[10px] font-bold text-fuchsia-300">Multi-page: {multiPageOrders.length}</span>}
                      </div>
                      <p className="mt-1 text-[10px] text-neutral-500">
                        Generated {generatedAt ? new Date(generatedAt).toLocaleString() : '-'}
                        {downloadedAt ? ` • Last download ${new Date(downloadedAt).toLocaleString()} by ${downloadedBy || 'Staff'}` : ''}
                      </p>
                      <p className="mt-1 text-[10px] text-neutral-400">
                        Single-page orders can be printed as individual A6 pages or 4 invoices on one A4 sheet. Orders that need 2+ A6 pages stay separate for packing clarity.
                      </p>
                      {batchOrders.find(o=>o.invoice_pack_download_set_date && o.invoice_pack_download_set_number) && (
                        <p className="mt-1 text-[10px] font-mono text-orange-300">
                          Set: {batchOrders.find(o=>o.invoice_pack_download_set_date && o.invoice_pack_download_set_number)?.invoice_pack_download_set_date}_Set-{String(batchOrders.find(o=>o.invoice_pack_download_set_number)?.invoice_pack_download_set_number || 1).padStart(2,'0')}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap xl:justify-end gap-2">
                      {singlePageOrders.length>0 && <>
                        <button data-ora-action="packing_download" type="button" onClick={downloadSingleA6}
                          className={`rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2 ${singleDownloaded?'bg-neutral-800 text-neutral-300':'bg-orange-500 text-black'}`}>
                          <Download className="w-4 h-4"/>
                          {singleDownloaded?'A6 Singles Again':`A6 Singles (${singlePageOrders.length})`}
                        </button>
                        <button data-ora-action="packing_download" type="button" onClick={downloadSingleA4}
                          className={`rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2 ${singleDownloaded?'bg-neutral-800 text-neutral-300':'bg-blue-500 text-white'}`}>
                          <Printer className="w-4 h-4"/>
                          {singleDownloaded?'A4 4-Up Again':`A4 • 4 per Page (${singlePageOrders.length})`}
                        </button>
                      </>}
                      {multiPageOrders.length>0 && (
                        <button data-ora-action="packing_download" type="button" onClick={downloadMultiPage}
                          className={`rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2 ${multiDownloaded?'bg-neutral-800 text-neutral-300':'bg-fuchsia-500 text-white'}`}>
                          <Download className="w-4 h-4"/>
                          {multiDownloaded?'Multi-Page Again':`Multi-Page Orders (${multiPageOrders.length})`}
                        </button>
                      )}
                    </div>
                  </div>
                  <details className="border-t border-neutral-800">
                    <summary className="cursor-pointer select-none px-4 py-3 text-[11px] font-bold text-neutral-400 hover:text-white">
                      View orders in this batch
                    </summary>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-xs text-neutral-300">
                        <thead className="bg-neutral-950 text-[10px] uppercase text-neutral-500">
                          <tr><th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Waybill</th><th className="p-3">Items</th><th className="p-3">Invoice Type</th><th className="p-3">Status</th></tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-800">
                          {batchOrders.map(o=><tr key={o.id}>
                            <td className="p-3 font-mono text-orange-300">{o.order_number}</td>
                            <td className="p-3">{o.customer_name}<div className="text-[10px] text-neutral-500">{o.phone}</div></td>
                            <td className="p-3 font-mono">{o.waybill_number}</td>
                            <td className="p-3">{o.items.map((it,i)=><div key={i}>{it.sku} × {it.quantity}</div>)}</td>
                            <td className="p-3">{getInvoicePageCount(o)>1 ? <span className="text-fuchsia-300 font-bold">{getInvoicePageCount(o)} × A6 pages</span> : <span className="text-blue-300 font-bold">Single A6</span>}</td>
                            <td className="p-3">{o.invoice_pack_downloaded_at ? <span className="text-emerald-300">Downloaded</span> : <span className="text-orange-300">Pending</span>}</td>
                          </tr>)}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        );
      })()}

      {activeTab === 'invoice_design' && (
        <InvoiceDesignPanel settings={settings} updateSettings={updateSettings} />
      )}

      {activeTab === 'delivery' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-base font-bold text-white flex items-center gap-2"><Truck className="w-5 h-5 text-orange-400" />Fardar Delivery / Waybill Pool</h2><p className="text-xs text-neutral-400">Import waybill numbers once. Confirmed orders auto-clear stock FIFO; when full stock is allocated, the oldest ready orders receive available manual waybills automatically.</p></div>
              </div>
              <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Next Waybill</p>
                  <p className="mt-1 text-2xl sm:text-3xl font-black font-mono text-white">{waybillRecords.find((w) => w.status === 'Available' && w.courier_name === (settings.courier_provider || 'Fardar'))?.waybill_number || waybillRecords.find((w) => w.status === 'Available')?.waybill_number || 'NO AVAILABLE WAYBILL'}</p>
                </div>
                <div className="text-left sm:text-right"><p className="text-[10px] text-neutral-400">AVAILABLE IN POOL</p><p className="text-xl font-black text-emerald-400">{waybillRecords.filter((w) => w.status === 'Available').length}</p></div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800"><p className="text-[10px] text-neutral-500">TOTAL IMPORTED</p><p className="text-xl font-bold text-white">{waybillRecords.length}</p></div>
                <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800"><p className="text-[10px] text-neutral-500">AVAILABLE</p><p className="text-xl font-bold text-emerald-400">{waybillRecords.filter((w) => w.status === 'Available').length}</p></div>
                <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800"><p className="text-[10px] text-neutral-500">ASSIGNED</p><p className="text-xl font-bold text-amber-400">{waybillRecords.filter((w) => w.status === 'Assigned').length}</p></div>
                <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800"><p className="text-[10px] text-neutral-500">MODE</p><p className="text-sm font-bold text-blue-400 mt-1">{(settings.courier_mode || (settings.courier_api_enabled ? 'api' : 'manual')) === 'manual' ? 'CSV Manual' : (settings.courier_mode === 'auto' ? 'Auto Fallback' : 'Fardar API')}</p></div>
              </div>

              {canAccessTab('delivery') && (settings.courier_mode || (settings.courier_api_enabled ? 'api' : 'manual')) !== 'api' && (
                <div className="border border-dashed border-neutral-700 rounded-xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                    <div>
                      <label className="block text-xs font-bold text-neutral-200">Import Fardar Waybill CSV</label>
                      <p className="text-[10px] text-neutral-500 mt-1">Not sure about the format? Download the sample template first.</p>
                    </div>
                    <button type="button" onClick={downloadWaybillCsvTemplate} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 text-[10px] font-bold">
                      <Download className="w-3.5 h-3.5" />
                      Download Waybill CSV Template
                    </button>
                  </div>
                  <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleWaybillCsvUpload(e.target.files[0])} className="text-xs text-neutral-300" />
                  <p className="text-[10px] text-neutral-500 mt-2">{waybillCsvFileName || 'CSV format: one Waybill number per row under a Waybill header.'}</p>
                  {waybillImportMessage && <p className="text-[11px] text-emerald-400 font-bold mt-2">{waybillImportMessage}</p>}
                </div>
              )}
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
              <h3 className="font-bold text-white text-sm">Future Fardar API</h3>
              <p className="text-xs text-neutral-400">Provider: <b>{settings.courier_provider || 'Fardar'}</b></p><p className="text-xs text-neutral-400">Mode: <b className="uppercase">{settings.courier_mode || (settings.courier_api_enabled ? 'api' : 'manual')}</b></p>
              <p className="text-xs text-neutral-400">API URL: <b>{settings.fardar_api_url ? 'Saved' : 'Not added yet'}</b></p>
              <p className="text-xs text-neutral-400">Account ID: <b>{settings.fardar_account_id || 'Not added yet'}</b></p>
              <div className="rounded-xl bg-blue-950/30 border border-blue-500/20 p-3 text-[10px] text-blue-300">Until API access is issued, CSV assignment works independently. Existing waybills/orders remain valid when API mode is enabled later.</div>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="font-bold text-white text-sm">Fardar Official City List</h3>
                <p className="text-[10px] text-neutral-500 mt-1">Upload the official list after your Fardar account is ready. Until a list is uploaded, current waybill flow stays unchanged.</p>
              </div>
              <div className="text-right"><p className="text-2xl font-bold text-orange-400">{fardarCities.length}</p><p className="text-[10px] text-neutral-500">CITIES LOADED</p></div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <button type="button" onClick={downloadFardarCityCsvTemplate} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[10px] font-bold"><Download className="w-3.5 h-3.5" />Download City List CSV Template</button>
              <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleFardarCityCsvUpload(e.target.files[0])} className="text-xs text-neutral-300" />
            </div>
            <p className="text-[10px] text-neutral-500">{fardarCityCsvFileName || 'Importer accepts City Name / City / Town / Destination headers. City Code is optional.'}</p>
            {fardarCityMessage && <p className="text-[11px] text-emerald-400 font-bold">{fardarCityMessage}</p>}
            {fardarCities.length > 0 && <div className="rounded-xl bg-amber-950/20 border border-amber-500/20 p-3 text-[10px] text-amber-300">After the official list is loaded, unmatched customer cities are blocked from waybill assignment until mapped once. Saved mappings auto-match future orders.</div>}
          </div>

          <datalist id="fardar-city-list">
            {fardarCities.map((city) => <option key={`${city.name}-${city.code || ''}`} value={city.name}>{city.code || ''}</option>)}
          </datalist>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] text-emerald-300">
            <b>AUTO FLOW:</b> Purchase / stock refill → oldest Confirmed waiting order first → full stock allocation → next Available manual waybill auto assigned. No per-order Assign Waybill click is required when the pool has available numbers.
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-neutral-800"><h3 className="font-bold text-white text-sm">Orders Waiting for / Using Waybills</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-left text-xs text-neutral-300"><thead className="bg-neutral-950 text-[10px] text-neutral-500 uppercase"><tr><th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Fardar City</th><th className="p-3">Status</th><th className="p-3">Waybill</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-neutral-800">
              {orders.filter((o) => o.order_status !== 'Cancelled').map((order) => {
                const resolved = order.fardar_city || resolveFardarCity(order.city).city;
                const needsCity = fardarCities.length > 0 && !resolved;
                return <tr key={order.id}>
                  <td className="p-3 font-mono text-amber-400">{order.order_number}</td>
                  <td className="p-3"><b className="text-white">{order.customer_name}</b><div className="text-[10px] text-neutral-500">Customer city: {order.city}</div></td>
                  <td className="p-3 min-w-[220px]">{needsCity ? <div className="space-y-2"><input list="fardar-city-list" value={citySelections[order.id] || ''} onChange={(e) => setCitySelections(prev => ({ ...prev, [order.id]: e.target.value }))} placeholder="Search official city..." className="w-full bg-neutral-950 border border-amber-500/40 rounded-lg px-2 py-1.5 text-white text-[10px]"/><button onClick={() => saveOrderCity(order)} className="px-2 py-1 rounded-lg bg-amber-500 text-neutral-950 font-bold text-[10px]">Save City Mapping</button></div> : <div><span className="text-emerald-400 font-bold">{resolved || order.city}</span><div className="text-[9px] text-neutral-500">{fardarCities.length ? 'Verified / Auto matched' : 'City list not uploaded yet'}</div></div>}</td>
                  <td className="p-3">{needsCity ? <span className="text-amber-400 font-bold">City Verification Required</span> : (order.delivery_status || 'Pending')}</td>
                  <td className="p-3 font-mono">{order.waybill_number || '—'}</td>
                  <td className="p-3">{canAccessTab('delivery') && (!order.waybill_number ? <button disabled={waybillAssigningId === order.id || needsCity} onClick={() => assignWaybillByMode(order)} className="px-2.5 py-1.5 rounded-lg bg-orange-500 disabled:opacity-40 text-neutral-950 font-bold text-[10px]">{needsCity ? 'Verify City First' : (waybillAssigningId === order.id ? 'Assigning...' : 'Assign Waybill')}</button> : (order.invoice_locked || order.dispatch_status === 'Handed Over') ? <span className="px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-300 text-[10px] font-bold">Waybill Locked</span> : <button onClick={() => unassignWaybill(order.id)} className="px-2.5 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 text-[10px]">Unassign</button>)}</td>
                </tr>;
              })}
            </tbody></table></div>
          </div>
        </div>
      )}

      {/* CONFIRM ORDER UPLOAD */}
      {activeTab === 'out_of_stock' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-red-500/10 p-2.5"><ShieldAlert className="h-5 w-5 text-red-400"/></div>
              <div>
                <h2 className="text-base font-bold text-white">Out of Stock — Orders Waiting</h2>
                <p className="mt-1 text-xs text-neutral-400">
                  Only stock-0 item codes that are actually blocking active pending / waiting orders are shown here.
                </p>
              </div>
            </div>
          </div>

          {outOfStockNeeds.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400"/>
              <div className="mt-2 text-sm font-bold text-emerald-300">No stock-0 items are blocking orders now.</div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="bg-neutral-950 text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="p-3">Item Code</th>
                      <th className="p-3">Item</th>
                      <th className="p-3 text-center">Current Stock</th>
                      <th className="p-3 text-center">Pending Orders</th>
                      <th className="p-3 text-center">Needed Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {outOfStockNeeds.map(({product,pendingOrders,neededQty}) => (
                      <tr key={product.id}>
                        <td className="p-3 font-mono font-bold text-orange-300">{product.sku}</td>
                        <td className="p-3 text-neutral-300">{product.name_en}</td>
                        <td className="p-3 text-center font-black text-red-400">0</td>
                        <td className="p-3 text-center font-bold text-white">{pendingOrders}</td>
                        <td className="p-3 text-center font-bold text-amber-300">{neededQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[11px] text-neutral-500">
            Purchase/stock refill clears eligible waiting orders using the existing FIFO rule. When an item is no longer stock 0 or no longer blocks a waiting order, it disappears from this page automatically.
          </p>
        </div>
      )}

      {activeTab === 'returns' && (() => {
        const returnOrder=returnOrderId ? orders.find(o=>o.id===returnOrderId) : null;
        return (
          <div data-ora-action="return_process" className="space-y-5">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-orange-400"/> Return Verification
              </h2>
              <p className="mt-1 text-xs text-neutral-400">
                Scan the returning waybill first. Stock is added only for verified good O-RA items.
              </p>
              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <input value={returnScanValue} onChange={e=>setReturnScanValue(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter') loadReturnByWaybill(returnScanValue)}}
                  placeholder="Scan / type return waybill..."
                  className="flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 font-mono text-white"/>
                <button type="button" onClick={()=>loadReturnByWaybill(returnScanValue)}
                  className="rounded-xl bg-orange-500 px-4 py-3 text-xs font-black text-black">
                  Find Return
                </button>
                <button type="button" onClick={()=>setCameraScannerMode('return')}
                  className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-xs font-black text-blue-300">
                  <Camera className="inline h-4 w-4 mr-1"/>Phone Camera
                </button>
              </div>
              {returnMessage && <p className="mt-2 text-xs font-bold text-amber-300">{returnMessage}</p>}
            </div>

            {returnOrder && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 space-y-4">
                <div>
                  <div className="font-mono font-black text-orange-300">{returnOrder.order_number}</div>
                  <div className="text-xs text-neutral-400">{returnOrder.customer_name} • {returnOrder.waybill_number}</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-xs">
                    <thead className="bg-neutral-950 text-neutral-500 uppercase">
                      <tr><th className="p-3 text-left">Code / Item</th><th className="p-3">Expected</th><th className="p-3">Good Received</th><th className="p-3">Damaged</th><th className="p-3">Missing</th></tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800">
                      {returnOrder.items.map(it=>{
                        const good=Math.max(0,Math.min(it.quantity,Number(returnGoodQty[returnItemKey(it)] ?? it.quantity)));
                        const damaged=Math.max(0,Math.min(it.quantity-good,Number(returnDamagedQty[returnItemKey(it)] ?? 0)));
                        const missing=Math.max(0,it.quantity-good-damaged);
                        return <tr key={returnItemKey(it)}>
                          <td className="p-3"><b className="font-mono text-orange-300">{it.sku}</b><div className="text-neutral-300">{it.product_name}{it.variant_name ? ` - ${it.variant_name}` : ''}</div></td>
                          <td className="p-3 text-center font-bold">{it.quantity}</td>
                          <td className="p-3"><input type="number" min="0" max={it.quantity} value={good}
                            onChange={e=>setReturnGoodQty(prev=>({...prev,[returnItemKey(it)]:Number(e.target.value)}))}
                            className="mx-auto block w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-center text-white"/></td>
                          <td className="p-3"><input type="number" min="0" max={it.quantity-good} value={damaged}
                            onChange={e=>setReturnDamagedQty(prev=>({...prev,[returnItemKey(it)]:Number(e.target.value)}))}
                            className="mx-auto block w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-center text-white"/></td>
                          <td className={`p-3 text-center font-black ${missing?'text-red-400':'text-emerald-400'}`}>{missing}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                <label className="block text-xs text-neutral-400">Wrong / Unknown Item Found
                  <input value={returnWrongNote} onChange={e=>setReturnWrongNote(e.target.value)}
                    placeholder="Example: parcel contained a different/non O-RA item"
                    className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-white"/>
                </label>
                <label className="block text-xs text-neutral-400">Notes
                  <textarea value={returnNotes} onChange={e=>setReturnNotes(e.target.value)}
                    className="mt-1 min-h-20 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-white"/>
                </label>
                <button type="button" onClick={()=>{
                  const result=confirmReturn({
                    orderId:returnOrder.id,
                    checkedBy:adminUser?.name,
                    items:returnOrder.items.map(it=>({
                      product_id:it.product_id,
                      variant_id:it.variant_id,
                      good_qty:Number(returnGoodQty[returnItemKey(it)] ?? it.quantity),
                      damaged_qty:Number(returnDamagedQty[returnItemKey(it)] ?? 0),
                    })),
                    wrong_item_note:returnWrongNote,
                    notes:returnNotes,
                  });
                  setReturnMessage(result.message);
                  if(result.success){setReturnOrderId(null);setReturnScanValue('');}
                }} className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-black text-black">
                  Confirm Return & Update Good Stock
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 overflow-hidden">
              <div className="p-4 border-b border-neutral-800 font-bold text-white">Return History</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="bg-neutral-950 text-neutral-500 uppercase"><tr><th className="p-3 text-left">Date</th><th className="p-3 text-left">Order</th><th className="p-3 text-left">Waybill</th><th className="p-3">Good</th><th className="p-3">Missing</th><th className="p-3">Damaged</th><th className="p-3 text-left">Status</th></tr></thead>
                  <tbody className="divide-y divide-neutral-800">
                    {returnRecords.map(r=><tr key={r.id}>
                      <td className="p-3">{new Date(r.checked_at).toLocaleString()}</td>
                      <td className="p-3 font-mono text-orange-300">{r.order_number}</td>
                      <td className="p-3 font-mono">{r.waybill_number}</td>
                      <td className="p-3 text-center text-emerald-300">{r.items.reduce((n,it)=>n+it.good_qty,0)}</td>
                      <td className="p-3 text-center text-red-300">{r.items.reduce((n,it)=>n+it.missing_qty,0)}</td>
                      <td className="p-3 text-center text-amber-300">{r.items.reduce((n,it)=>n+it.damaged_qty,0)}</td>
                      <td className="p-3">{r.status}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {activeTab === 'lead_import' && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-sky-200 bg-white p-5 sm:p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-sky-100 p-3"><FileSpreadsheet className="h-6 w-6 text-sky-700" /></div>
              <div>
                <h2 className="text-lg font-black text-gray-900">FB / TikTok Lead CSV Import</h2>
                <p className="mt-1 text-xs leading-5 text-gray-600">This page is only for NEW lead files. Upload the original Facebook/TikTok lead CSV for today + previous day. O-RA skips Lead IDs already imported. Do not upload Confirm/Cancel files here.</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">NEW LEADS ONLY → System creates FB-/TK- Order IDs → Google Sheet PENDING. Stock is not deducted here.</div>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border border-blue-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-blue-600">Facebook</p><h3 className="mt-1 text-base font-black text-gray-900">Facebook Lead Import</h3></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">FB-...</span></div>
              <p className="text-xs leading-5 text-gray-600">Download Facebook leads for <b>Today + Previous Day</b>. Extra ad columns are ignored; only O-RA order fields are kept. Previously imported Lead IDs are skipped.</p>
              <button type="button" onClick={()=>downloadSourceOrderTemplate('Facebook Ads')} className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-black text-blue-700"><Download className="mr-1 inline h-4 w-4"/> Download Optional Manual FB Lead Template</button>
              <label className="block cursor-pointer rounded-xl bg-blue-600 px-3 py-3 text-center text-xs font-black text-white"><Upload className="mr-1 inline h-4 w-4"/> Upload Facebook LEAD CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>e.target.files?.[0]&&handleDirectSourceUpload(e.target.files[0],'Facebook Ads')}/></label>
              <button type="button" onClick={()=>handleSourceTestLead('Facebook Ads')} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-black text-gray-600">Create FB Test Lead</button>
            </div>

            <div className="rounded-3xl border border-fuchsia-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-fuchsia-600">TikTok</p><h3 className="mt-1 text-base font-black text-gray-900">TikTok Lead Import</h3></div><span className="rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-black text-fuchsia-700">TK-...</span></div>
              <p className="text-xs leading-5 text-gray-600">Use the original TikTok Lead CSV for <b>Today + Previous Day</b>. Unneeded columns are ignored and duplicate Lead IDs are skipped automatically.</p>
              <button type="button" onClick={()=>downloadSourceOrderTemplate('TikTok Ads')} className="w-full rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-2.5 text-xs font-black text-fuchsia-700"><Download className="mr-1 inline h-4 w-4"/> Download Optional Manual TikTok Lead Template</button>
              <label className="block cursor-pointer rounded-xl bg-fuchsia-600 px-3 py-3 text-center text-xs font-black text-white"><Upload className="mr-1 inline h-4 w-4"/> Upload TikTok LEAD CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>e.target.files?.[0]&&handleDirectSourceUpload(e.target.files[0],'TikTok Ads')}/></label>
              <button type="button" onClick={()=>handleSourceTestLead('TikTok Ads')} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-black text-gray-600">Create TikTok Test Lead</button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-5 text-gray-600"><b>Next step:</b> Call Center works in Google Sheets. After calls are finished, use the separate <b>Confirm / Cancel Upload</b> page. Keeping these two pages separate prevents the wrong CSV being uploaded by mistake.</div>
        </div>
      )}

      {activeTab === 'confirm_upload' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-5">
            <div className="flex items-center gap-3">
              <Upload className="h-6 w-6 text-orange-400" />
              <div>
                <h2 className="text-base font-black text-white">Confirm Order Upload</h2>
                <p className="mt-1 text-xs text-neutral-400">
                  DECISION FILES ONLY. Website, Facebook and TikTok call-center CSV files are processed here. New Facebook/TikTok lead files belong in the separate Lead CSV Import page.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* WEBSITE */}
            <div className="rounded-2xl border border-emerald-500/30 bg-neutral-900 p-5 space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-emerald-300">Website Orders</h3>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] font-black text-emerald-300">WEB-...</span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-neutral-400">
                  Easy Sheet flow: change Qty/Color if needed. For one item use ITEM ACTION = KEEP ITEM / CANCEL ITEM. For the whole order use ORDER ACTION = CONFIRM ORDER / CANCEL ENTIRE ORDER. Product changes use the dropdown + preview + Apply Item Change. Sheet edits alone never update O-RA — upload the CSV here to apply decisions.
                </p>
              </div>
              <button type="button" onClick={downloadWebsiteConfirmedTemplate}
                className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-300">
                <Download className="mr-1 inline h-4 w-4"/> Download Website Confirm + Cancel CSV Template
              </button>
              <label className="block cursor-pointer rounded-xl bg-emerald-500 px-3 py-2.5 text-center text-xs font-black text-neutral-950">
                <Upload className="mr-1 inline h-4 w-4"/> Upload Website Confirm + Cancel CSV
                <input type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e=>e.target.files?.[0] && handleWebsiteConfirmedCsvUpload(e.target.files[0])}/>
              </label>
            </div>

            {/* FACEBOOK */}
            <div className="rounded-2xl border border-blue-500/30 bg-neutral-900 p-5 space-y-3">
              <div><div className="flex items-center justify-between"><h3 className="text-sm font-black text-blue-300">Facebook Confirm / Cancel</h3><span className="rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-black text-blue-300">FB-...</span></div>
                <p className="mt-2 text-[11px] leading-5 text-neutral-400">Download the completed FACEBOOK ORDERS sheet as CSV after Call Center selects CONFIRM ORDER / CANCEL ENTIRE ORDER. Upload that decision CSV here. Do not upload the original Facebook Lead CSV on this page.</p></div>
              
              <button type="button" onClick={()=>downloadDecisionTemplate('Facebook Ads')} className="w-full rounded-xl border border-blue-500/30 bg-neutral-950 px-3 py-2 text-[10px] font-black text-blue-300"><Download className="mr-1 inline h-4 w-4"/> Download FB Confirm + Cancel Template</button>
              <label className="block cursor-pointer rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-2.5 text-center text-xs font-black text-blue-300"><CheckCircle2 className="mr-1 inline h-4 w-4"/> Upload Facebook Confirm + Cancel CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>e.target.files?.[0]&&handleSourceConfirmedCsvUpload(e.target.files[0],'Facebook Ads')}/></label>
              
            </div>

            {/* TIKTOK */}
            <div className="rounded-2xl border border-fuchsia-500/30 bg-neutral-900 p-5 space-y-3">
              <div><div className="flex items-center justify-between"><h3 className="text-sm font-black text-fuchsia-300">TikTok Confirm / Cancel</h3><span className="rounded-full bg-fuchsia-500/10 px-2 py-1 text-[9px] font-black text-fuchsia-300">TK-...</span></div>
                <p className="mt-2 text-[11px] leading-5 text-neutral-400">Download the completed TIKTOK ORDERS sheet as CSV after Call Center selects CONFIRM ORDER / CANCEL ENTIRE ORDER. Upload that decision CSV here. Do not upload the original TikTok Lead CSV on this page.</p></div>
              
              <button type="button" onClick={()=>downloadDecisionTemplate('TikTok Ads')} className="w-full rounded-xl border border-fuchsia-500/30 bg-neutral-950 px-3 py-2 text-[10px] font-black text-fuchsia-300"><Download className="mr-1 inline h-4 w-4"/> Download TikTok Confirm + Cancel Template</button>
              <label className="block cursor-pointer rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2.5 text-center text-xs font-black text-fuchsia-300"><CheckCircle2 className="mr-1 inline h-4 w-4"/> Upload TikTok Confirm + Cancel CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>e.target.files?.[0]&&handleSourceConfirmedCsvUpload(e.target.files[0],'TikTok Ads')}/></label>
              
            </div>
          </div>

          <div className="space-y-4">
            {(['Website','Facebook','TikTok'] as const).map((source) => {
              const batch = uploadBatches[source];
              if (!batch.at && batch.orderNumbers.length === 0 && batch.uploaded === 0 && batch.failed === 0) return null;
              const batchOrders = orders.filter(o => batch.orderNumbers.includes(o.order_number));
              const allocated = batchOrders.filter(o => o.stock_allocated && o.stock_status === 'Allocated');
              const waiting = batchOrders.filter(o => !o.stock_allocated && o.order_status !== 'Cancelled');
              const withWaybill = batchOrders.filter(o => Boolean(o.waybill_number));
              const invoiceReady = batchOrders.filter(o => validateInvoiceOrder(o).length === 0 && !o.invoice_locked);
              const invoiced = batchOrders.filter(o => o.invoice_locked);
              const sourceClass = source === 'Website' ? 'emerald' : source === 'Facebook' ? 'blue' : 'fuchsia';

              return (
                <div key={source} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-sm font-black text-white">{source} • Last Upload Result</h3>
                      <p className="mt-1 text-[10px] text-neutral-500">{batch.at ? new Date(batch.at).toLocaleString() : ''}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[10px] font-black">
                      <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-emerald-300">Uploaded {batch.uploaded}</span>
                      <span className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-red-300">Failed {batch.failed}</span>
                      <span className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-amber-300">Waiting Stock {waiting.length}</span>
                      <span className="rounded-lg bg-cyan-500/10 px-2.5 py-1.5 text-cyan-300">Stock Allocated {allocated.length}</span>
                      <span className="rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-violet-300">Waybill {withWaybill.length}</span>
                      <span className="rounded-lg bg-orange-500/10 px-2.5 py-1.5 text-orange-300">Invoice Ready {invoiceReady.length}</span>
                      <span className="rounded-lg bg-green-500/10 px-2.5 py-1.5 text-green-300">Invoiced {invoiced.length}</span>
                    </div>
                  </div>

                  {batch.errors.length > 0 && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[10px] text-red-300">
                      {batch.errors.slice(0,8).map((e,i)=><div key={i}>• {e}</div>)}
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-xl border border-neutral-800">
                    <table className="w-full min-w-[920px] text-left text-[10px] text-neutral-300">
                      <thead className="bg-neutral-950 uppercase text-neutral-500">
                        <tr>
                          <th className="p-2.5">Order ID</th>
                          <th className="p-2.5">Customer</th>
                          <th className="p-2.5">Item / Qty</th>
                          <th className="p-2.5">Total</th>
                          <th className="p-2.5">Stock</th>
                          <th className="p-2.5">Waybill</th>
                          <th className="p-2.5">Invoice</th>
                          <th className="p-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchOrders.length === 0 ? (
                          <tr><td colSpan={8} className="p-4 text-center text-neutral-500">No matching orders in this batch.</td></tr>
                        ) : batchOrders.map(o=>(
                          <tr key={o.id} className="border-t border-neutral-800">
                            <td className="p-2.5 font-mono font-bold text-white">{o.order_number}</td>
                            <td className="p-2.5">{o.customer_name}<div className="text-neutral-500">{o.phone}</div></td>
                            <td className="p-2.5">{o.items.map((it,idx)=><div key={idx}><b>{it.sku}</b> • Qty {it.quantity}</div>)}</td>
                            <td className="p-2.5 font-bold">Rs. {o.total_amount.toLocaleString()}</td>
                            <td className="p-2.5">{o.stock_allocated ? 'Allocated' : 'Waiting'}</td>
                            <td className="p-2.5 font-mono">{o.waybill_number || 'Pending'}</td>
                            <td className="p-2.5">{o.invoice_locked ? 'Generated' : validateInvoiceOrder(o).length===0 ? 'Ready' : 'Not Ready'}</td>
                            <td className="p-2.5">{o.order_status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={withWaybill.length === 0}
                      onClick={()=>downloadFardarUploadCsv(batchOrders)}
                      className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-xs font-black text-violet-300 disabled:opacity-40"
                    >
                      <Download className="mr-1 inline h-4 w-4"/> Fardar Upload CSV ({withWaybill.length})
                    </button>
                    <button
                      type="button"
                      disabled={invoiceReady.length === 0}
                      onClick={async()=>{
                        const generated = markInvoicesGenerated(invoiceReady.map(o=>o.id));
                        if (!generated.length) { alert('No eligible invoices in this batch.'); return; }
                        await generateBatchInvoicesPDF(generated, settings);
                      }}
                      className="rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-black text-neutral-950 disabled:opacity-40"
                    >
                      <Printer className="mr-1 inline h-4 w-4"/> Generate Ready Invoices ({invoiceReady.length})
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: GOOGLE SHEETS SYNC */}
      {activeTab === 'sheets' && (
        <div className="space-y-6">
          <div className="bg-neutral-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-amber-400">
                <FileSpreadsheet className="w-5 h-5" />
                <h2 className="text-base font-bold text-white">Website + Facebook + TikTok → Call Center Google Sheets</h2>
              </div>

              <button
                onClick={async () => {
                  try {
                    const before=orders.filter(o=>o.order_source!=='Manual Admin'&&!o.is_synced_google_sheets).length;
                    const count = await syncAllUnsyncedOrders();
                    const failed=Math.max(0,before-count);
                    alert(failed>0
                      ? `Synced ${count} order(s). ${failed} order(s) are still pending. Run a Website/FB/TikTok test button to see the exact Sheet error.`
                      : `Successfully synced ${count} new orders to Google Sheets!`);
                  } catch (error:any) {
                    alert(`Google Sheet sync failed.\n\n${error?.message || 'Unknown sync error'}`);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs flex items-center space-x-1.5 shadow-md shadow-amber-500/20"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Sync All Unsynced Orders ({unsyncedOrders.length})</span>
              </button>
            </div>

            <p className="text-xs text-neutral-400">
              Website orders sync to CALL CENTER ORDERS. New Facebook Lead CSV rows sync to FACEBOOK ORDERS and TikTok Lead CSV rows sync to TIKTOK ORDERS. Call Center may edit only Variant/Color, Qty, Item Status, the controlled Change Product dropdown, Decision and Cancel Reason. Qty uses the same O-RA Qty Offer tiers. Product/variant add-edit-delete changes auto-sync to PRODUCT CATALOG. Sheet Decision never changes O-RA by itself — Confirm + Cancel CSV Upload is the manual checkpoint.
            </p>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[10px] leading-5 text-emerald-200"><b>Existing Google Sheet tabs: DO NOT DELETE.</b> Replace/deploy the Apps Script, then run <code>setupOraCallCenterSheet()</code> once. It upgrades the existing CALL CENTER ORDERS / PRODUCT CATALOG tabs and creates FACEBOOK ORDERS / TIKTOK ORDERS only if missing. Use the O-RA Call Center menu in Google Sheets → <b>Show Pending Only</b> / <b>Show All Orders</b>.</div>
            {localOnlyCatalogImages > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[10px] leading-5 text-amber-200">
                <b>{localOnlyCatalogImages} product image(s) are local-only.</b> Google Sheets cannot load images from <code>/uploads/...</code> on this PC. The product rows still sync normally. After the site is live and product images are stored on the public Supabase Storage URL, the Sheet image preview can load automatically.
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                <p className="text-xs font-black text-blue-300">Website Test Orders</p>
                <p className="mt-1 text-[10px] text-neutral-400">Safe test numbering only. Test orders never deduct stock.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={async()=>{try{const order=await createWebsiteTestOrder(1);if(!order){alert('No product available.');return;} alert(order.is_synced_google_sheets?`1-item test synced: ${order.order_number}`:`1-item test saved, but Sheet sync is still pending: ${order.order_number}`);}catch(e:any){alert(e?.message||'Website test failed.');}}} className="rounded-lg bg-blue-500 px-3 py-2 text-[11px] font-black text-white">1 Item Test</button>
                  <button type="button" onClick={async()=>{try{const order=await createWebsiteTestOrder(5);if(!order){alert('No product available.');return;} alert(order.is_synced_google_sheets?`5-item test synced: ${order.order_number}`:`5-item test saved, but Sheet sync is still pending: ${order.order_number}`);}catch(e:any){alert(e?.message||'Website 5-item test failed.');}}} className="rounded-lg bg-indigo-500 px-3 py-2 text-[11px] font-black text-white">5 Item Test</button>
                </div>
                <button type="button" onClick={async()=>{const count=await deleteWebsiteTestOrders();alert(`Deleted ${count} Website test order(s).`);}} className="mt-2 w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-black text-red-300">Delete Website Tests</button>
              </div>

              <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                <p className="text-xs font-black text-sky-300">Facebook Test</p>
                <p className="mt-1 text-[10px] text-neutral-400">Creates one FB test lead through the same bulk-import + Sheet path.</p>
                <button type="button" onClick={()=>handleSourceTestLead('Facebook Ads')} className="mt-3 w-full rounded-lg bg-sky-500 px-3 py-2 text-[11px] font-black text-white">Create Facebook Test Order</button>
                <button type="button" onClick={async()=>{const count=await deleteSourceTestOrders('Facebook Ads');alert(`Deleted ${count} Facebook test order(s).`);}} className="mt-2 w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-black text-red-300">Delete Facebook Tests</button>
              </div>

              <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-4">
                <p className="text-xs font-black text-fuchsia-300">TikTok Test</p>
                <p className="mt-1 text-[10px] text-neutral-400">Creates one TikTok test lead through the same bulk-import + Sheet path.</p>
                <button type="button" onClick={()=>handleSourceTestLead('TikTok Ads')} className="mt-3 w-full rounded-lg bg-fuchsia-500 px-3 py-2 text-[11px] font-black text-white">Create TikTok Test Order</button>
                <button type="button" onClick={async()=>{const count=await deleteSourceTestOrders('TikTok Ads');alert(`Deleted ${count} TikTok test order(s).`);}} className="mt-2 w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-black text-red-300">Delete TikTok Tests</button>
              </div>
            </div>

            {/* Google Apps Script Snippet Box */}
            <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white">Google Apps Script Webhook Code (Free Tier):</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
                    setCopiedScript(true);
                    setTimeout(() => setCopiedScript(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-neutral-800 text-amber-400 text-[10px] font-semibold flex items-center space-x-1"
                >
                  {copiedScript ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedScript ? 'Copied' : 'Copy Script Code'}</span>
                </button>
              </div>

              <pre className="bg-neutral-900 p-3 rounded-lg text-[10px] font-mono text-neutral-300 max-h-36 overflow-y-auto">
                {GOOGLE_APPS_SCRIPT_CODE}
              </pre>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'cod_payments' && <CodPaymentsPanel />}

      {activeTab === 'bank_transfer_check' && <BankTransferCheckPanel />}

      {activeTab === 'assistant_chats' && <AssistantChatsPanel />}

      {activeTab === 'complaints' && <ComplaintsPanel />}

      {activeTab === 'reports' && <ReportsPanel />}

      {activeTab === 'reviews' && <ReviewModerationPanel />}

      {activeTab === 'product_requests' && <ProductRequestsPanel />}

      {/* CUSTOMER DATABASE */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-white">Saved Customer Database ({customers.length})</h2>
          {adminUser?.role === 'admin' && (
            <div className="bg-neutral-900 border border-red-900/40 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3"><div><h3 className="text-sm font-bold text-white">Blocked Customers</h3><p className="text-[10px] text-neutral-500">Blocked phone numbers cannot place website orders.</p></div><span className="text-xs font-bold text-red-400">{blockedCustomers.length} blocked</span></div>
              {blockedCustomers.length === 0 ? <p className="text-xs text-neutral-500">No blocked customers.</p> : <div className="space-y-2">{blockedCustomers.map((b) => <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-neutral-950 rounded-xl p-3 border border-neutral-800"><div><div className="font-mono text-xs text-white">{b.phone}</div><div className="text-[10px] text-neutral-500">{b.reason}</div></div><button onClick={() => unblockCustomer(b.id)} className="px-2.5 py-1.5 rounded-lg bg-neutral-800 text-neutral-200 text-[10px] font-bold">Unblock</button></div>)}</div>}
            </div>
          )}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-xs text-neutral-300">
              <thead className="bg-neutral-950 text-neutral-400 uppercase text-[10px] border-b border-neutral-800">
                <tr>
                  <th className="p-3">Customer Name</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3">WhatsApp</th>
                  <th className="p-3">Address & City</th>
                  <th className="p-3">Total Orders</th>
                  <th className="p-3">Membership</th>
                  <th className="p-3">Total Spent</th>
                  <th className="p-3">Protection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="p-3 font-semibold text-white">{c.name}</td>
                    <td className="p-3 font-mono">{c.phone}</td>
                    <td className="p-3 font-mono">{c.whatsapp}</td>
                    <td className="p-3">{c.address}, {c.city}</td>
                    <td className="p-3 font-bold text-amber-400">{c.total_orders}</td>
                    <td className="p-3">{(() => { const m = getCustomerMembership(orders, c.phone); return <div><span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 border border-orange-500/20 px-2 py-1 text-[10px] font-black text-orange-300"><Award className="w-3 h-3" />{m.level}</span><div className="mt-1 text-[9px] text-neutral-500">{m.successfulOrders} successful</div></div>; })()}</td>
                    <td className="p-3 font-bold text-emerald-400">Rs. {c.total_spent.toLocaleString()}</td>
                    <td className="p-3">{adminUser?.role === 'admin' && <button onClick={() => { const reason = prompt('Reason for blocking this customer?', 'Repeated / fake orders'); if (reason) blockCustomer(c.phone, reason, adminUser?.username); }} className="px-2 py-1 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-[10px] font-bold">Block</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: SETTINGS & SYSTEM CONTROL */}
      {activeTab === 'dispatch' && (
        <div data-ora-action="dispatch_scan" className="space-y-5">
          <div className="bg-neutral-900 border border-orange-500/30 rounded-2xl p-5 sm:p-6 space-y-4">
            <div><h2 className="text-lg font-bold text-white flex items-center gap-2"><ScanLine className="w-5 h-5 text-orange-400" />Dispatch Scan / Courier Handover</h2><p className="text-xs text-neutral-400">After packing, scan the printed waybill barcode once before handing the parcel to the courier/lorry. Scanner devices that send Enter work directly here.</p></div>
            <form onSubmit={(e) => { e.preventDefault(); processDispatchWaybill(dispatchScanValue); setDispatchScanValue(''); }} className="flex flex-col sm:flex-row gap-2">
              <input autoFocus value={dispatchScanValue} onChange={(e) => setDispatchScanValue(e.target.value)} placeholder="Scan / type waybill barcode here..." className="flex-1 bg-neutral-950 border-2 border-orange-500/40 focus:border-orange-500 rounded-xl px-4 py-3 text-white font-mono text-lg outline-none" />
              <button type="submit" className="px-5 py-3 rounded-xl bg-orange-500 text-black font-bold">Confirm Scan</button>
              <button type="button" onClick={()=>{ ensureScanAudio(); setCameraScannerMode('dispatch'); }} className="px-5 py-3 rounded-xl border border-blue-500/40 bg-blue-500/10 text-blue-300 font-bold">
                <Camera className="inline h-4 w-4 mr-1"/>Phone Camera
              </button>
            </form>
            {dispatchScanMessage && <div className={`rounded-xl p-3 text-xs font-bold ${dispatchScanOk ? 'bg-emerald-950/40 border border-emerald-700 text-emerald-300':'bg-red-950/40 border border-red-800 text-red-300'}`}>{dispatchScanMessage}</div>}
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[10px] text-blue-200">Successful Waybill scan = short beep + phone vibration. The same Waybill can be recorded only once; a second scan shows <b>Already Scanned</b> and is not recorded again.</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3"><p className="text-[10px] text-neutral-500">READY TO SCAN</p><p className="text-xl font-bold text-orange-400">{orders.filter((o) => o.invoice_locked && o.stock_allocated && o.waybill_number && o.dispatch_status !== 'Handed Over').length}</p></div>
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3"><p className="text-[10px] text-neutral-500">HANDOVER RECORDED</p><p className="text-xl font-bold text-emerald-400">{orders.filter((o) => o.dispatch_status === 'Handed Over').length}</p></div>
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3"><p className="text-[10px] text-neutral-500">TODAY</p><p className="text-xl font-bold text-blue-400">{orders.filter((o) => o.dispatch_scanned_at && new Date(o.dispatch_scanned_at).toDateString() === new Date().toDateString()).length}</p></div>
            </div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-neutral-800"><h3 className="font-bold text-white">Dispatch Evidence Log</h3><p className="text-[10px] text-neutral-500">Internal handover evidence. Fardar tracking can later continue from the same saved waybill.</p></div>
            <div className="overflow-x-auto"><table className="w-full text-xs text-left text-neutral-300"><thead className="bg-neutral-950 text-[10px] uppercase text-neutral-500"><tr><th className="p-3">Order</th><th className="p-3">Waybill</th><th className="p-3">Customer</th><th className="p-3">Status</th><th className="p-3">Scanned At</th><th className="p-3">By</th></tr></thead><tbody className="divide-y divide-neutral-800">{orders.filter((o) => o.invoice_locked).map((o) => <tr key={o.id}><td className="p-3 font-mono text-orange-400">{o.order_number}</td><td className="p-3 font-mono">{o.waybill_number || '—'}</td><td className="p-3">{o.customer_name}</td><td className={`p-3 font-bold ${o.dispatch_status === 'Handed Over' ? 'text-emerald-400':'text-orange-400'}`}>{o.dispatch_status || 'Not Scanned'}</td><td className="p-3">{o.dispatch_scanned_at ? new Date(o.dispatch_scanned_at).toLocaleString() : '—'}</td><td className="p-3">{o.dispatch_scanned_by || '—'}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-3xl p-5 sm:p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2"><History className="w-5 h-5 text-orange-600" />System Activity / Audit Trail</h2>
                <p className="text-xs text-gray-500 mt-1">Shows who performed important actions in O-RA, what they changed, and when.</p>
              </div>
              <div className="px-3 py-2 rounded-2xl bg-gray-50 border border-gray-200 text-xs text-gray-700">
                Logged in: <strong>{adminUser?.name}</strong> (@{adminUser?.username})
              </div>
            </div>

            <div className="overflow-x-auto border border-gray-100 rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Date & Time</th>
                    <th className="p-3">User</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Module</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Target / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activityLogs.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-400">No activity recorded yet.</td></tr>
                  ) : activityLogs.slice(0, 1000).map((log) => (
                    <tr key={log.id} className="hover:bg-orange-50/30">
                      <td className="p-3 whitespace-nowrap text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="p-3"><div className="font-bold text-gray-900">{log.actor_name}</div>{log.actor_username && <div className="text-[10px] text-orange-600">@{log.actor_username}</div>}</td>
                      <td className="p-3 text-gray-600">{log.actor_role || 'system'}</td>
                      <td className="p-3 font-semibold text-gray-700">{log.module}</td>
                      <td className="p-3"><span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200 font-bold text-gray-700">{log.action}</span></td>
                      <td className="p-3 text-gray-600 min-w-[220px] max-w-[420px]">{log.target_label && <div className="font-semibold text-gray-900">{log.target_label}</div>}{log.details && <div title={log.details} className="text-[11px] mt-0.5 break-words">{log.details.length>180?`${log.details.slice(0,177)}…`:log.details}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'website_info' && <WebsiteInfoPanel settings={settings} updateSettings={updateSettings} />}

      {activeTab === 'branding' && (
        <div className="space-y-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-5"><Palette className="w-5 h-5 text-orange-400" /><h2 className="text-lg font-bold text-white">Branding & Logo Studio</h2></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-xs text-neutral-300">Store Name<input value={brandingDraft.brand_store_name ?? 'O-RA'} onChange={(e)=>setBrandingDraft((p:any)=>({...p,brand_store_name:e.target.value}))} className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white" /></label>
              <label className="text-xs text-neutral-300">Tagline<input value={brandingDraft.brand_tagline ?? 'Online Store'} onChange={(e)=>setBrandingDraft((p:any)=>({...p,brand_tagline:e.target.value}))} className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white" /></label>
              <label className="text-xs text-neutral-300">Primary Color<input type="color" value={brandingDraft.brand_primary_color ?? '#000000'} onChange={(e)=>setBrandingDraft((p:any)=>({...p,brand_primary_color:e.target.value}))} className="mt-1 w-full h-10 bg-neutral-950 border border-neutral-800 rounded-xl px-2" /></label>
              <label className="text-xs text-neutral-300">Secondary Color<input type="color" value={brandingDraft.brand_secondary_color ?? '#ea580c'} onChange={(e)=>setBrandingDraft((p:any)=>({...p,brand_secondary_color:e.target.value}))} className="mt-1 w-full h-10 bg-neutral-950 border border-neutral-800 rounded-xl px-2" /></label>
            </div>

            <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 sm:p-5 space-y-4">
              <div>
                <p className="text-sm font-bold text-white">Logo Size Adjustment</p>
                <p className="text-[11px] text-neutral-400 mt-1">Adjust desktop and mobile logo sizes separately. Changes apply only after Save Branding Changes.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <label className="text-xs text-neutral-300">
                  <div className="flex items-center justify-between gap-3 mb-2"><span>Desktop Logo Width</span><b className="text-orange-400">{Number(brandingDraft.desktop_logo_width || 190)} px</b></div>
                  <input type="range" min="120" max="280" step="5" value={Number(brandingDraft.desktop_logo_width || 190)} onChange={(e)=>setBrandingDraft((p:any)=>({...p,desktop_logo_width:Number(e.target.value)}))} className="w-full accent-orange-500" />
                  <div className="flex justify-between text-[10px] text-neutral-500 mt-1"><span>120</span><span>280</span></div>
                </label>

                <label className="text-xs text-neutral-300">
                  <div className="flex items-center justify-between gap-3 mb-2"><span>Mobile Logo Width</span><b className="text-orange-400">{Number(brandingDraft.mobile_logo_width || 130)} px</b></div>
                  <input type="range" min="80" max="180" step="5" value={Number(brandingDraft.mobile_logo_width || 130)} onChange={(e)=>setBrandingDraft((p:any)=>({...p,mobile_logo_width:Number(e.target.value)}))} className="w-full accent-orange-500" />
                  <div className="flex justify-between text-[10px] text-neutral-500 mt-1"><span>80</span><span>180</span></div>
                </label>

                <label className="text-xs text-neutral-300">
                  <div className="flex items-center justify-between gap-3 mb-2"><span>Mobile Logo Max Height</span><b className="text-orange-400">{Number(brandingDraft.mobile_logo_max_height || 52)} px</b></div>
                  <input type="range" min="32" max="64" step="2" value={Number(brandingDraft.mobile_logo_max_height || 52)} onChange={(e)=>setBrandingDraft((p:any)=>({...p,mobile_logo_max_height:Number(e.target.value)}))} className="w-full accent-orange-500" />
                  <div className="flex justify-between text-[10px] text-neutral-500 mt-1"><span>32</span><span>64</span></div>
                </label>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 pt-1">
                <div className="rounded-2xl border border-neutral-800 bg-white overflow-hidden">
                  <div className="px-4 py-2 bg-neutral-900 text-[10px] font-extrabold tracking-wider text-orange-400">LIVE MOBILE HEADER PREVIEW • NOT SAVED YET</div>
                  <div className="bg-black text-white text-[9px] px-3 py-1.5 text-center">Islandwide Delivery | COD & Bank Transfer Available</div>
                  <div className="px-3 py-3 flex items-center justify-between gap-2 min-h-[74px]">
                    <div className="shrink-0 overflow-visible flex items-center">
                      {(brandingDraft.mobile_logo || brandingDraft.website_logo) ? (
                        <img
                          src={brandingDraft.mobile_logo || brandingDraft.website_logo}
                          alt="Mobile logo preview"
                          style={{
                            width: `${Number(brandingDraft.mobile_logo_width || 130)}px`,
                            maxHeight: `${Number(brandingDraft.mobile_logo_max_height || 52)}px`,
                            objectFit: 'contain',
                            objectPosition: 'left center',
                            display: 'block',
                          }}
                        />
                      ) : (
                        <b className="text-black text-lg">{brandingDraft.brand_store_name || 'O-RA'}</b>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-[9px] font-bold">EN / සිං</span>
                      <span className="px-2 py-1 rounded-full bg-black text-white text-[9px] font-bold">Admin</span>
                    </div>
                  </div>
                  <div className="px-3 pb-3">
                    <div className="h-8 rounded-full bg-gray-100 text-[9px] text-gray-400 flex items-center px-3">Search products, brands, categories...</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-white overflow-hidden">
                  <div className="px-4 py-2 bg-neutral-900 text-[10px] font-extrabold tracking-wider text-orange-400">LIVE DESKTOP HEADER PREVIEW • NOT SAVED YET</div>
                  <div className="px-4 py-4 flex items-center gap-5 min-h-[86px]">
                    <div className="shrink-0 flex items-center">
                      {brandingDraft.website_logo ? (
                        <img
                          src={brandingDraft.website_logo}
                          alt="Desktop logo preview"
                          style={{
                            width: `${Number(brandingDraft.desktop_logo_width || 190)}px`,
                            maxHeight: '64px',
                            objectFit: 'contain',
                            objectPosition: 'left center',
                            display: 'block',
                          }}
                        />
                      ) : (
                        <b className="text-black text-xl">{brandingDraft.brand_store_name || 'O-RA'}</b>
                      )}
                    </div>
                    <div className="h-9 rounded-full bg-gray-100 text-[10px] text-gray-400 flex items-center px-4 flex-1">Search products, brands, categories...</div>
                    <span className="px-3 py-1.5 rounded-full bg-black text-white text-[10px] font-bold shrink-0">Admin</span>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-neutral-500">Move the sliders and watch these previews instantly. The real storefront changes only after you click Save Branding Changes.</p>
            </div>

            <div className="mt-5 flex items-center gap-3 flex-wrap">
              <button onClick={saveBrandingChanges} className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-extrabold">Save Branding Changes</button>
              <span className="text-xs text-neutral-400">Changes apply to the website only after Save.</span>
              {brandingSaved && <span className="text-xs font-bold text-emerald-400">Saved ✓</span>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[
              ['website_logo','Website Main Logo','Recommended 1200 × 300 PNG/WebP'],
              ['mobile_logo','Mobile / Social Logo','Recommended 1080 × 1080 PNG/WebP'],
              ['favicon_logo','Favicon / App Icon','Recommended 512 × 512 PNG'],
              ['black_logo','Black Logo Version','Transparent PNG'],
              ['white_logo','White Logo Version','Transparent PNG'],
            ].map(([key,title,hint]) => {
              const value=(brandingDraft as any)[key] as string | undefined;
              return <div key={key} className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
                <div><p className="font-bold text-gray-900 text-sm">{title}</p><p className="text-[10px] text-gray-500">{hint}</p></div>
                <div className="h-24 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden">{value ? <img src={value} className="max-h-20 max-w-[90%] object-contain" /> : <span className="text-xs text-gray-400">No logo uploaded</span>}</div>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="text-xs w-full" onChange={(e)=>{const file=e.target.files?.[0]; if(file) void handleBrandingLogoUpload(file,key);}} />
                {value && <button onClick={()=>setBrandingDraft((p:any)=>({...p,[key]:''}))} className="text-xs font-bold text-red-600">Remove</button>}
              </div>;
            })}
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <h3 className="font-bold text-white">Photoshop Logo Template Pack</h3>
            <p className="text-xs text-neutral-400">Each template contains a sample O-RA logo and size guide. Open the PSD in Photoshop and replace the sample with your final logo.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                ['Website','1200 × 300','/brand-templates/ORA_Website_Logo_Template.psd','/brand-templates/ORA_Website_Logo_Preview.png'],
                ['Mobile / Social','1080 × 1080','/brand-templates/ORA_Mobile_Social_Template.psd','/brand-templates/ORA_Mobile_Social_Preview.png'],
                ['Favicon / Icon','512 × 512','/brand-templates/ORA_Favicon_Template.psd','/brand-templates/ORA_Favicon_Preview.png'],
                ['Print','3000 × 3000 • 300 DPI','/brand-templates/ORA_Print_Logo_Template.psd','/brand-templates/ORA_Print_Logo_Preview.png'],
              ].map(([name,size,psd,preview])=><div key={name} className="bg-neutral-950 border border-neutral-800 rounded-xl p-3">
                <img src={preview} className="w-full aspect-video object-contain bg-white rounded-lg mb-3" />
                <p className="text-sm font-bold text-white">{name}</p><p className="text-[10px] text-neutral-500 mb-3">{size}</p>
                <a href={psd} download className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-orange-600 text-white text-xs font-bold"><Download className="w-3.5 h-3.5"/>Download PSD</a>
              </div>)}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h3 className="font-bold text-gray-900 mb-4">Live Preview</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border rounded-xl p-4"><p className="text-[10px] text-gray-400 mb-3">DESKTOP HEADER</p>{brandingDraft.website_logo?<img src={brandingDraft.website_logo} style={{width:`${Number(brandingDraft.desktop_logo_width || 190)}px`,maxWidth:'100%',maxHeight:'60px'}} className="object-contain object-left"/>:<b>{brandingDraft.brand_store_name||'O-RA'}</b>}<p className="text-xs text-gray-500 mt-1">{brandingDraft.brand_tagline||'Online Store'}</p></div>
              <div className="border rounded-xl p-4"><p className="text-[10px] text-gray-400 mb-3">MOBILE</p>{(brandingDraft.mobile_logo||brandingDraft.website_logo)?<img src={brandingDraft.mobile_logo||brandingDraft.website_logo} style={{width:`${Number(brandingDraft.mobile_logo_width || 130)}px`,maxWidth:'100%',maxHeight:`${Number(brandingDraft.mobile_logo_max_height || 52)}px`}} className="object-contain object-left"/>:<b>{brandingDraft.brand_store_name||'O-RA'}</b>}</div>
              <div className="border rounded-xl p-4"><p className="text-[10px] text-gray-400 mb-3">INVOICE</p>{brandingDraft.invoice_logo?<img src={brandingDraft.invoice_logo} className="h-12 max-w-full object-contain"/>:<b>{brandingDraft.brand_store_name||'O-RA'} ONLINE STORE</b>}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-6 max-w-4xl">
          <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-black text-white">Website Maintenance Mode</h2>
                <p className="mt-1 text-xs text-neutral-400">Turn this ON while resetting the system or adding products. Admin Manager remains accessible.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={Boolean(settings.maintenance_mode)}
                  onChange={e=>updateSettings({maintenance_mode:e.target.checked})} className="sr-only peer"/>
                <div className="w-11 h-6 bg-neutral-800 rounded-full peer peer-checked:bg-orange-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all"></div>
              </label>
            </div>
            <input value={settings.maintenance_message || ''} onChange={e=>updateSettings({maintenance_message:e.target.value})}
              placeholder="Website is currently under maintenance. Please check back soon."
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white"/>
            <div className={`rounded-xl p-3 text-xs font-bold ${settings.maintenance_mode?'bg-orange-500/10 text-orange-300':'bg-emerald-500/10 text-emerald-300'}`}>
              Public Website: {settings.maintenance_mode ? 'MAINTENANCE PAGE ONLY' : 'LIVE / ORDERS ENABLED'}
            </div>
          </div>

          <div className="rounded-2xl border border-red-500/30 bg-neutral-900 p-5 space-y-3">
            <div>
              <h2 className="text-base font-black text-white">Clean Start — Clear Test / Order Data</h2>
              <p className="mt-1 text-xs text-neutral-400">
                Clears orders, customers created by tests, purchases, waybills, returns, invoice/packing records and activity logs.
                Products, Variants, Combos, Categories, Store Settings, Google Sheet URL and Staff accounts are kept. Google Sheet Product Catalog is also kept; operational order rows are cleared.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const ok = window.confirm(
                  'Delete ALL current order/test operational data and start clean? Products and Store Settings will be kept.'
                );
                if (!ok) return;
                try {
                  await clearOperationalTestData();
                  alert('All operational order/test data cleared successfully. Orders should now be 0.'); window.location.reload();
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Unable to clear test data.');
                }
              }}
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs font-black text-red-300 hover:bg-red-500/20"
            >
              Clear All Test / Order Data
            </button>
          </div>

          {/* Top Announcement Bar Manager (උඩින් යන බැනරය) */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center space-x-2">
                <Megaphone className="w-5 h-5 text-amber-400" />
                <div>
                  <h2 className="text-base font-bold text-white">Top Announcement Banner Bar (උඩින් යන බැනරය)</h2>
                  <p className="text-xs text-neutral-400">Edit the top notification banner ticker visible at the top of the store header.</p>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.top_banner_active !== false}
                  onChange={(e) => updateSettings({ top_banner_active: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                <span className="ml-2 text-xs font-bold text-neutral-300">
                  {settings.top_banner_active !== false ? 'Active' : 'Disabled'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-neutral-300 font-semibold mb-1">
                  Announcement Text (English) *
                </label>
                <input
                  type="text"
                  value={settings.top_announcement_en || ''}
                  onChange={(e) => updateSettings({ top_announcement_en: e.target.value })}
                  placeholder="Islandwide Fast Delivery (Rs. 500 Flat Rate) | COD Available"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-semibold mb-1">
                  Announcement Text (Sinhala - සිංහල) *
                </label>
                <input
                  type="text"
                  value={settings.top_announcement_si || ''}
                  onChange={(e) => updateSettings({ top_announcement_si: e.target.value })}
                  placeholder="දිවයිනටම වේගවත් බෙදාහැරීම (රු. 500) | COD සහ බැංකු හුවමාරු ගෙවීම්"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-neutral-300 font-semibold mb-1">
                  Header Hotline Phone Number
                </label>
                <input
                  type="text"
                  value={settings.top_banner_phone || ''}
                  onChange={(e) => updateSettings({ top_banner_phone: e.target.value })}
                  placeholder="+94 77 123 4567"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
            </div>

            {/* Live Preview for Top Banner Bar */}
            <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 space-y-1.5">
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 block">
                ✦ Live Storefront Header Top Bar Preview
              </span>
              <div className="bg-black text-white text-[11px] font-semibold py-2 px-3 rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-neutral-300">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                  <span className="hidden sm:inline">100% Genuine Guarantee</span>
                </div>
                <div className="flex items-center space-x-1.5 text-white mx-auto sm:mx-0">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  <span>
                    {settings.free_delivery_enabled
                      ? 'Islandwide FREE Delivery'
                      : `Islandwide Delivery Rs. ${Math.max(0, Number(settings.delivery_fee || 0)).toLocaleString()}`}
                    {(settings.top_announcement_en || '')
                      .split('|')
                      .map((part) => part.trim())
                      .filter(Boolean)
                      .filter((part) => !/delivery/i.test(part))
                      .map((part) => ` | ${part}`)
                      .join('')}
                  </span>
                </div>
                <div className="hidden sm:flex items-center space-x-1 text-amber-400 font-mono">
                  <Phone className="w-3 h-3" />
                  <span>{settings.top_banner_phone || '+94 77 123 4567'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 text-xs text-fuchsia-100">
            Main promotional banners are now managed from <b>Banners</b> in the sidebar. The old single-banner timer/editor was removed from Store Settings.
          </div>

          {/* Store & Payment Settings Card */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-white flex items-center space-x-2">
              <Settings className="w-5 h-5 text-orange-400" />
              <span>Store &amp; Payment Settings</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-neutral-300 font-semibold mb-1">
                  Default Islandwide Delivery Charge (Rs.)
                </label>
                <input
                  type="number"
                  value={settings.delivery_fee}
                  onChange={(e) => updateSettings({ delivery_fee: Number(e.target.value) })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 space-y-2">
                <label className="flex items-center justify-between gap-3 text-neutral-300 font-semibold">
                  <span>Free Delivery Display Mode</span>
                  <input type="checkbox" checked={Boolean(settings.free_delivery_enabled)} onChange={(e) => updateSettings({ free_delivery_enabled: e.target.checked })} className="h-4 w-4 accent-orange-500" />
                </label>
                <p className="text-[10px] text-neutral-500">ON: the delivery adjustment above is included in each customer-facing unit price and delivery shows as FREE. OFF: the delivery fee is shown separately at checkout.</p>
              </div>

              <div className="md:col-span-2 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-orange-300">🎉 Special Multi-Buy Offer</p>
                    <p className="mt-1 text-[10px] text-neutral-400">
                      Percentage discount shown to customers when Free Delivery Display Mode is ON. Qty 1 always gets no multi-buy discount.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] font-bold text-neutral-300">
                    <span>{settings.multi_buy_discount_enabled !== false ? 'ON' : 'OFF'}</span>
                    <input
                      type="checkbox"
                      checked={settings.multi_buy_discount_enabled !== false}
                      onChange={(e) => updateSettings({ multi_buy_discount_enabled: e.target.checked })}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {[
                    {
                      title: 'Tier 1',
                      minKey: 'multi_buy_tier1_min',
                      maxKey: 'multi_buy_tier1_max',
                      rateKey: 'multi_buy_tier1_rate',
                      min: settings.multi_buy_tier1_min ?? 2,
                      max: settings.multi_buy_tier1_max ?? 3,
                      rate: settings.multi_buy_tier1_rate ?? 5,
                    },
                    {
                      title: 'Tier 2',
                      minKey: 'multi_buy_tier2_min',
                      maxKey: 'multi_buy_tier2_max',
                      rateKey: 'multi_buy_tier2_rate',
                      min: settings.multi_buy_tier2_min ?? 4,
                      max: settings.multi_buy_tier2_max ?? 5,
                      rate: settings.multi_buy_tier2_rate ?? 7.5,
                    },
                    {
                      title: 'Tier 3',
                      minKey: 'multi_buy_tier3_min',
                      maxKey: 'multi_buy_tier3_max',
                      rateKey: 'multi_buy_tier3_rate',
                      min: settings.multi_buy_tier3_min ?? 6,
                      max: settings.multi_buy_tier3_max ?? 10,
                      rate: settings.multi_buy_tier3_rate ?? 10,
                    },
                  ].map((tier) => (
                    <div key={tier.title} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-black text-white">{tier.title}</span>
                        <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-black text-orange-300">
                          Qty {tier.min}–{tier.max}: {tier.rate}%
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-[9px] font-bold text-neutral-500">
                          MIN QTY
                          <input
                            type="number"
                            min="2"
                            step="1"
                            value={tier.min}
                            onChange={(e) => updateSettings({ [tier.minKey]: Math.max(2, Math.floor(Number(e.target.value) || 2)) } as any)}
                            className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs text-white"
                          />
                        </label>
                        <label className="text-[9px] font-bold text-neutral-500">
                          MAX QTY
                          <input
                            type="number"
                            min="2"
                            step="1"
                            value={tier.max}
                            onChange={(e) => updateSettings({ [tier.maxKey]: Math.max(2, Math.floor(Number(e.target.value) || 2)) } as any)}
                            className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs text-white"
                          />
                        </label>
                        <label className="text-[9px] font-bold text-neutral-500">
                          DISCOUNT %
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={tier.rate}
                            onChange={(e) => updateSettings({ [tier.rateKey]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } as any)}
                            className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs text-white"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-2 text-[10px] text-neutral-400">
                  Default: Qty 1 = 0% • Qty 2–3 = 5% • Qty 4–5 = 7.5% • Qty 6–10 = 10%.
                  Above the highest tier continues using the Tier 3 percentage.
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 space-y-3">
                <label className="flex items-center justify-between gap-3 text-neutral-300 font-semibold">
                  <span>Gift Wrapping Option</span>
                  <input type="checkbox" checked={Boolean(settings.gift_wrap_enabled)} onChange={(e) => updateSettings({ gift_wrap_enabled: e.target.checked })} className="h-4 w-4 accent-orange-500" />
                </label>
                <div>
                  <label className="block text-[10px] text-neutral-500 mb-1">Wrapping Fee (Rs.)</label>
                  <input type="number" min="0" value={settings.gift_wrap_fee ?? 250} onChange={(e) => updateSettings({ gift_wrap_fee: Math.max(0, Number(e.target.value) || 0) })} className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-white" />
                </div>
              </div>

              <div>
                <label className="block text-neutral-300 font-semibold mb-1">
                  Advance Rule Qty Threshold
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settings.advance_qty_threshold ?? 4}
                  onChange={(e) => updateSettings({ advance_qty_threshold: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
                <p className="text-[10px] text-neutral-500 mt-1">Advance applies when total order Qty is greater than this number.</p>
              </div>

              <div>
                <label className="block text-neutral-300 font-semibold mb-1">
                  Required Advance (%)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={settings.advance_percentage ?? 50}
                  onChange={(e) => updateSettings({ advance_percentage: Math.min(100, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
                <p className="text-[10px] text-neutral-500 mt-1">Only Main Admin can access Store Settings and change this rule.</p>
              </div>

              <div className="md:col-span-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <p className="text-xs font-black text-emerald-300">Bank Transfer Account Details</p>
                    <p className="mt-1 text-[10px] text-neutral-400">
                      These details are private while typing. Customers see Bank Transfer only after you press Save &amp; Publish Bank Details.
                    </p>
                  </div>
                  <span className={`self-start rounded-full px-2.5 py-1 text-[10px] font-black ${
                    settings.bank_details_saved
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                  }`}>
                    {settings.bank_details_saved ? 'PUBLISHED' : 'HIDDEN'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-neutral-300 font-semibold mb-1">Bank Name *</label>
                    <input
                      type="text"
                      value={bankDraft.bank_name}
                      onChange={(e) => setBankDraft((prev) => ({ ...prev, bank_name: e.target.value }))}
                      placeholder="Sampath Bank"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-neutral-300 font-semibold mb-1">Branch *</label>
                    <input
                      type="text"
                      value={bankDraft.bank_branch}
                      onChange={(e) => setBankDraft((prev) => ({ ...prev, bank_branch: e.target.value }))}
                      placeholder="e.g. Matara / Head Office"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-neutral-300 font-semibold mb-1">Account Holder Name *</label>
                    <input
                      type="text"
                      value={bankDraft.bank_account_holder}
                      onChange={(e) => setBankDraft((prev) => ({ ...prev, bank_account_holder: e.target.value }))}
                      placeholder="Account holder name"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-neutral-300 font-semibold mb-1">Account Number *</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={bankDraft.bank_account_number}
                      onChange={(e) => setBankDraft((prev) => ({ ...prev, bank_account_number: e.target.value }))}
                      placeholder="Enter account number"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={saveBankAccountDetails}
                    className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-black text-xs"
                  >
                    {bankDetailsSavedFlash ? 'Saved & Published ✓' : 'Save & Publish Bank Details'}
                  </button>

                  {settings.bank_details_saved && (
                    <button
                      type="button"
                      onClick={hideBankAccountDetails}
                      className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold text-xs"
                    >
                      Hide Bank Transfer
                    </button>
                  )}
                </div>

                <p className="text-[10px] text-neutral-500">
                  Editing these boxes does not change the live checkout. The live Bank Transfer details change only when Save &amp; Publish is pressed.
                </p>
              </div>

              <div className="md:col-span-2 rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
                <p className="mb-3 text-xs font-black text-orange-300">Company & Invoice Contact Details</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-neutral-500 mb-1">COMPANY ADDRESS</label>
                    <textarea rows={2} value={settings.company_address || ''} onChange={(e)=>updateSettings({company_address:e.target.value})}
                      placeholder="No. 123, Main Street, Colombo 10, Sri Lanka."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white text-xs"/>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 mb-1">HOTLINE NUMBER</label>
                    <input type="text" value={settings.hotline_number || ''} onChange={(e)=>updateSettings({hotline_number:e.target.value})}
                      placeholder="077 123 4567" className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white text-xs"/>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 mb-1">WHATSAPP NUMBER</label>
                    <input type="text" value={settings.whatsapp_number || ''} onChange={(e)=>updateSettings({whatsapp_number:e.target.value})}
                      placeholder="077 123 4567" className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white text-xs"/>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 mb-1">COMPANY EMAIL</label>
                    <input type="email" value={settings.company_email || ''} onChange={(e)=>updateSettings({company_email:e.target.value})}
                      placeholder="info@orastore.lk" className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white text-xs"/>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 mb-1">INVOICE WEBSITE</label>
                    <input type="text" value={settings.invoice_website_url || 'orastore.com.lk'} onChange={(e)=>updateSettings({invoice_website_url:e.target.value})}
                      placeholder="orastore.com.lk" className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white text-xs"/>
                  </div>
                </div>
                <p className="mt-3 text-[10px] text-neutral-500">These values are used automatically on every invoice. Invoice Design does not store separate contact details.</p>
              </div>

              <div>
                <label className="block text-neutral-300 font-semibold mb-1">System Login URL</label>
                <div className="flex items-center rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden">
                  <span className="px-3 text-[10px] text-neutral-500">/</span>
                  <input
                    type="text"
                    value="system"
                    readOnly
                    className="w-full bg-transparent px-2 py-2 text-white"
                  />
                </div>
                <p className="mt-1 text-[10px] text-neutral-500">Use /system as the Manager bookmark. The old /ora-manager link automatically redirects here.</p>
              </div>

              <div>
                <label className="block text-neutral-300 font-semibold mb-1">Fardar Parcel Type</label>
                <input
                  type="text"
                  value={settings.fardar_parcel_type || ''}
                  onChange={(e)=>updateSettings({fardar_parcel_type:e.target.value})}
                  placeholder="Leave blank unless Fardar requires a specific value"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-neutral-300 font-semibold mb-1">Google Sheets Webhook URL</label>
                <input
                  type="text"
                  value={settings.google_sheet_webhook_url}
                  onChange={(e) => updateSettings({ google_sheet_webhook_url: e.target.value })}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono text-[11px]"
                />
              </div>
            </div>
          </div>

          {/* User Account & Security Section */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <KeyRound className="w-5 h-5 text-orange-400" />
                <h2 className="text-base font-bold text-white">Your Account &amp; Security</h2>
              </div>
              <button
                onClick={() => setIsChangePasswordOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-orange-500 text-neutral-950 hover:bg-orange-400 font-bold text-xs flex items-center space-x-1"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Change Password</span>
              </button>
            </div>

            <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-neutral-500 block text-[10px]">Name:</span>
                <span className="font-bold text-white">{adminUser?.name}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Username:</span>
                <span className="font-bold text-white">@{adminUser?.username}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Access Role:</span>
                <span className="font-bold text-amber-400">
                  {adminUser ? roleLabel[adminUser.role] : 'Viewer'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div><h2 className="text-base font-bold text-white flex items-center gap-2"><Truck className="w-5 h-5 text-orange-400" />Courier / Fardar Integration</h2><p className="text-xs text-neutral-400">Leave API fields empty while using CSV waybill ranges. Fill them later when Fardar enables API access.</p></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-neutral-400">Courier Provider<input value={settings.courier_provider || 'Fardar'} onChange={(e) => updateSettings({ courier_provider: e.target.value })} className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white" /></label>
              <label className="text-xs text-neutral-400">Fardar Account ID<input value={settings.fardar_account_id || ''} onChange={(e) => updateSettings({ fardar_account_id: e.target.value })} placeholder="Add when issued" className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white" /></label>
              <label className="text-xs text-neutral-400 sm:col-span-2">API URL<input value={settings.fardar_api_url || ''} onChange={(e) => updateSettings({ fardar_api_url: e.target.value })} placeholder="https://..." className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white" /></label>
              <label className="sm:col-span-2 text-xs text-neutral-400">Delivery Waybill Mode
                <select value={settings.courier_mode || (settings.courier_api_enabled ? 'api' : 'manual')} onChange={(e) => { const mode = e.target.value as 'manual' | 'api' | 'auto'; updateSettings({ courier_mode: mode, courier_api_enabled: mode !== 'manual' }); }} className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white">
                  <option value="manual">Manual CSV Mode</option>
                  <option value="api">Fardar API Mode</option>
                  <option value="auto">Auto / API + Manual Fallback</option>
                </select>
              </label>
              <div className="sm:col-span-2 rounded-xl bg-neutral-950 border border-neutral-800 p-3 text-[10px] text-neutral-400">API key/secret stays on the server only. Manual mode uses imported CSV waybills. API mode requests a waybill from the server adapter. Auto mode tries API first and uses the CSV pool only if API is unavailable.</div>
            </div>
          </div>

          {/* DANGER ZONE: Full System Reset Button */}
          {adminUser?.role === 'admin' && (
            <div className="bg-red-950/30 border border-red-500/40 rounded-2xl p-5 sm:p-6 space-y-3">
              <div className="flex items-center space-x-2 text-red-400">
                <ShieldAlert className="w-5 h-5" />
                <h2 className="text-base font-bold text-red-400">System Danger Zone</h2>
              </div>
              <p className="text-xs text-neutral-300">
                FULL LIVE START RESET clears operational/demo products, orders and synced order rows, but Website Info & Policy text is preserved. Login/staff access, Google Sheet URL, technical/API connections, branding and invoice design are also preserved. Bank/contact/BR details are cleared so you can enter the real details before going live.
              </p>

              <button
                onClick={() => {
                  setResetTypedConfirm('');
                  setIsResetConfirmOpen(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center space-x-2 shadow-lg shadow-red-950 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>FULL RESET &amp; START LIVE STORE</span>
              </button>
            </div>
          )}
        </div>
      )}


      {activeTab === 'user_access' && adminUser?.role === 'admin' && (
        <div className="space-y-5">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div><h2 className="text-lg font-bold text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-orange-400" />System Access</h2><p className="text-xs text-neutral-400">Each sidebar module can be No Access, View Only or Edit / Manage. Packing download, Waybill Scan and Return Process can be granted separately.</p></div>
              <button onClick={() => setIsAddStaffModalOpen(true)} className="px-4 py-2 rounded-xl bg-orange-500 text-black font-bold text-xs flex items-center gap-2"><UserPlus className="w-4 h-4" />Add Staff Account</button>
            </div>
            <form onSubmit={handleSaveSuperAdminCredentials} className="rounded-2xl border border-amber-500/25 bg-neutral-950 p-4 space-y-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-black text-white">Super Admin Credentials & Recovery</p>
                <p className="text-[10px] leading-4 text-neutral-500">Change the default <span className="font-mono text-amber-300">admin</span> username here and save the Gmail/email used for Super Admin password recovery. Password changes are verified separately.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1"><span className="text-[10px] font-bold text-neutral-400">Super Admin Username</span><input value={superAdminCredentials.username} onChange={(e)=>setSuperAdminCredentials((prev)=>({...prev,username:e.target.value}))} className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white" /></label>
                <label className="space-y-1"><span className="text-[10px] font-bold text-neutral-400">Recovery Gmail / Email</span><input type="email" value={superAdminCredentials.email} onChange={(e)=>setSuperAdminCredentials((prev)=>({...prev,email:e.target.value}))} placeholder="yourstore@gmail.com" className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white" /></label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="rounded-xl bg-amber-500 px-4 py-2 text-[11px] font-black text-black hover:bg-amber-400">Save Super Admin Login</button>
                <button type="button" onClick={()=>setIsChangePasswordOpen(true)} className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-[11px] font-bold text-white hover:bg-neutral-800">Change Password</button>
              </div>
            </form>
            <div className="space-y-4">
              {staffUsers.map((u) => <div key={u.id} className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><p className="font-bold text-white">{u.name} <span className="font-mono text-orange-400 text-xs">@{u.username}</span></p><p className="text-[10px] text-neutral-500">{u.role === 'admin' ? 'Super Admin • Full Access' : `${allPermissionIds.filter((id)=>id!=='user_access' && accessLevelFromList(u.permissions,id)!=='none').length} modules accessible`} • {u.email || 'No email'}</p></div><div className="flex gap-2">{u.role !== 'admin' && <button onClick={() => updateStaffAccount(u.id,{is_active:u.is_active===false})} className="px-2 py-1 rounded bg-neutral-800 text-[10px] font-bold">{u.is_active===false?'Enable':'Disable'}</button>}{u.role !== 'admin' && <button onClick={() => { if(confirm(`Delete @${u.username}?`)) deleteStaffAccount(u.id); }} className="px-2 py-1 rounded bg-red-950 text-red-300 text-[10px] font-bold">Delete</button>}</div></div>
                {u.role !== 'admin' && <div className="space-y-3">
                  <div className="overflow-x-auto rounded-xl border border-neutral-800">
                    <table className="w-full min-w-[620px] text-[10px]">
                      <thead className="bg-neutral-900 text-neutral-500 uppercase"><tr><th className="p-2.5 text-left">Module</th><th className="p-2.5 text-left">Access Level</th></tr></thead>
                      <tbody className="divide-y divide-neutral-800">
                        {allPermissionIds.filter((id)=>id!=='user_access').map((perm)=><tr key={perm}><td className="p-2.5 font-bold text-neutral-300">{permissionLabels[perm]}</td><td className="p-2.5"><select value={accessLevelFromList(u.permissions,perm)} onChange={(e)=>updateStaffAccount(u.id,{permissions:setAccessLevelInList(u.permissions,perm,e.target.value as StaffAccessLevel)})} className="w-44 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[10px] font-bold text-white"><option value="none">No Access</option><option value="view">View Only</option><option value="edit">Edit / Manage</option></select></td></tr>)}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3"><p className="mb-2 text-[10px] font-black uppercase tracking-wider text-blue-300">Special Actions</p><div className="grid gap-2 sm:grid-cols-3">{specialActionRows.map((action)=><label key={action.id} className="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-[10px] font-bold text-neutral-300"><input type="checkbox" className="mt-0.5 accent-blue-500" checked={Boolean(u.permissions?.includes(`action:${action.id}`))} onChange={(e)=>{const token=`action:${action.id}`;const next=e.target.checked?Array.from(new Set([...(u.permissions||[]),token])):(u.permissions||[]).filter((p)=>p!==token);updateStaffAccount(u.id,{permissions:next});}}/><span>{action.label}<small className="mt-0.5 block font-normal text-neutral-500">Requires {permissionLabels[action.module as AdminPermission]} View or Edit access.</small></span></label>)}</div></div>
                </div>}
              </div>)}
            </div>
          </div>
        </div>
      )}

      {/* TAB 8: DEPLOYMENT GUIDE */}
      {activeTab === 'deploy' && (
        <div className="bg-neutral-900 border border-amber-500/30 rounded-2xl p-6 space-y-4 max-w-3xl">
          <div className="flex items-center space-x-2 text-amber-400">
            <Code className="w-5 h-5" />
            <h2 className="text-lg font-bold text-white">
              Free Tier Deployment Guide (GitHub + Cloudflare + Supabase)
            </h2>
          </div>

          <div className="space-y-3 text-xs text-neutral-300 leading-relaxed">
            <p>Follow these 3 simple steps to deploy O-RA Online Store for 100% free:</p>

            <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-2">
              <p className="font-bold text-amber-400">Step 1: Create Supabase Free Database</p>
              <ol className="list-decimal list-inside space-y-1 text-neutral-400">
                <li>Sign up at <b>supabase.com</b> and create a free project.</li>
                <li>Go to SQL Editor in Supabase Dashboard.</li>
                <li>Copy the content of <code>/supabase_schema.sql</code> from this repository and run it.</li>
                <li>Copy Project URL and Anon API key from Project Settings -&gt; API.</li>
              </ol>
            </div>

            <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-2">
              <p className="font-bold text-amber-400">Step 2: Push to GitHub Free Repository</p>
              <pre className="bg-neutral-900 p-2.5 rounded text-[10px] font-mono text-emerald-400">
                git init{"\n"}
                git add .{"\n"}
                git commit -m "Initial commit for O-RA Store"{"\n"}
                git remote add origin https://github.com/yourusername/ora-online-store.git{"\n"}
                git push -u origin main
              </pre>
            </div>

            <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-2">
              <p className="font-bold text-amber-400">Step 3: Deploy on Cloudflare Workers Free</p>
              <ol className="list-decimal list-inside space-y-1 text-neutral-400">
                <li>Log in to <b>Cloudflare</b> and open Workers & Pages.</li>
                <li>Create a Worker from GitHub and select <code>ora-online-store</code>.</li>
                <li>Set build variables <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then add server secrets such as <code>SUPABASE_SECRET_KEY</code> in Worker settings.</li>
                <li>Use <code>npm run build</code> as the build command and <code>npx wrangler@latest deploy</code> as the deploy command.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Price / Special Offer Workspace */}
      {activeTab === 'supplier_offer' && canAccessTab('supplier_offer') && (
        <div className="space-y-4">
          <div className="rounded-3xl border border-amber-300 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-600">Saved Price Control</p>
                <h2 className="mt-1 text-xl font-black text-gray-900">Supplier Price / Special Offer</h2>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">The initial Add Product price stays saved. Enter a new supplier cost here only when you actually find another source. Nothing changes on the website until you press Save.</p>
              </div>
              <div className="rounded-xl bg-gray-900 px-3 py-2 text-[10px] font-bold text-white">Old orders & invoices stay locked</div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-bold text-gray-700">Product / Main Code
                    <select
                      value={supplierProductId}
                      onChange={(e)=>{
                        const id=e.target.value;
                        const p=products.find(x=>x.id===id);
                        setSupplierProductId(id);
                        setSupplierVariantId('');
                        setSupplierNewCost(Number(p?.offer_buying_price || p?.buying_price || 0));
                        setSupplierMessage('');
                      }}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900"
                    >
                      <option value="">Select product...</option>
                      {products.filter(p=>p.status!=='Draft' && normalizedProductType(p)!=='bundle').map(p=><option key={p.id} value={p.id}>{p.sku} • {p.name_en}</option>)}
                    </select>
                  </label>

                  <label className="text-xs font-bold text-gray-700">Exact Color / Variant
                    <select
                      disabled={!supplierProduct || normalizedProductType(supplierProduct)!=='variant'}
                      value={supplierVariantId}
                      onChange={(e)=>{
                        const id=e.target.value;
                        const v=supplierProduct ? variantById(supplierProduct,id) : undefined;
                        setSupplierVariantId(id);
                        setSupplierNewCost(Number(v?.offer_buying_price || v?.buying_price || supplierProduct?.buying_price || 0));
                        setSupplierMessage('');
                      }}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      <option value="">{supplierProduct && normalizedProductType(supplierProduct)==='variant' ? 'Select exact color...' : 'Not required'}</option>
                      {(supplierProduct?.variants || []).map(v=><option key={v.id} value={v.id}>{v.sku} • {v.option_value}</option>)}
                    </select>
                  </label>
                </div>

                {supplierProduct && normalizedProductType(supplierProduct)==='variant' && !supplierVariant && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs font-bold text-violet-800">This product has variants. Select the exact color/variant before saving a supplier price.</div>
                )}

                {supplierTarget && (
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><p className="text-[9px] font-black uppercase text-gray-400">Saved normal cost</p><p className="mt-1 text-lg font-black text-gray-900">Rs. {Number(supplierTarget.buying_price||0).toLocaleString()}</p></div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><p className="text-[9px] font-black uppercase text-gray-400">Normal customer price</p><p className="mt-1 text-lg font-black text-gray-900">Rs. {supplierRegularDisplay.toLocaleString()}</p></div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><p className="text-[9px] font-black uppercase text-gray-400">Current offer source</p><p className="mt-1 text-lg font-black text-amber-700">{supplierTarget.supplier_offer_enabled && supplierTarget.offer_buying_price ? `Rs. ${Number(supplierTarget.offer_buying_price).toLocaleString()}` : 'OFF'}</p></div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><p className="text-[9px] font-black uppercase text-gray-400">Qty Offer</p><p className="mt-1 text-sm font-black text-emerald-700">Still applies</p><p className="text-[9px] text-gray-500">after this unit price</p></div>
                  </div>
                )}

                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <label className="text-xs font-black text-gray-800">New Supplier Buying Price (Rs.)
                    <input type="number" min="0" value={supplierNewCost || ''} onChange={(e)=>{setSupplierNewCost(Math.max(0,Number(e.target.value||0)));setSupplierMessage('');}} placeholder="Example: 300" className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-3 text-base font-black text-gray-900 outline-none focus:border-amber-500" />
                  </label>
                  <p className="mt-2 text-[10px] leading-4 text-gray-600"><b>Cheaper than saved cost:</b> exact saving per item becomes Special Offer. <b>Higher than saved cost:</b> no fake discount; normal selling price rises by the exact extra cost to preserve the original target profit.</p>
                </div>

                {supplierPreview && supplierTarget && (
                  <div className={`rounded-2xl border p-4 ${supplierPreview.kind==='offer'?'border-emerald-200 bg-emerald-50':supplierPreview.kind==='increase'?'border-red-200 bg-red-50':'border-gray-200 bg-gray-50'}`}>
                    {supplierPreview.kind==='offer' ? <>
                      <p className="text-xs font-black text-emerald-800">SPECIAL OFFER PREVIEW</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <div><p className="text-gray-500">Supplier saving / item</p><p className="font-black text-emerald-800">Rs. {supplierPreview.savingPerUnit.toLocaleString()}</p></div>
                        <div><p className="text-gray-500">Normal price</p><p className="font-black text-gray-600 line-through">Rs. {supplierRegularDisplay.toLocaleString()}</p></div>
                        <div><p className="text-gray-500">Offer price</p><p className="font-black text-orange-600">Rs. {supplierPreviewDisplay.toLocaleString()}</p></div>
                        <div><p className="text-gray-500">Website badge</p><p className="font-black text-orange-600">{supplierPreviewPercent}% OFF</p></div>
                      </div>
                      <p className="mt-2 text-[10px] text-emerald-800">Qty 2 saves Rs. {(supplierPreview.savingPerUnit*2).toLocaleString()} from this supplier offer before the existing Qty Offer is calculated.</p>
                    </> : supplierPreview.kind==='increase' ? <>
                      <p className="text-xs font-black text-red-800">SUPPLIER COST INCREASE PREVIEW</p>
                      <p className="mt-2 text-sm text-red-800">New cost is Rs. {supplierPreview.increasePerUnit.toLocaleString()} higher per item. Future normal customer price becomes <b>Rs. {supplierPreviewDisplay.toLocaleString()}</b>. No discount badge is shown.</p>
                    </> : <p className="text-xs font-bold text-gray-600">Same as the saved normal buying cost. No price change is needed.</p>}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!supplierTarget || (supplierProduct && normalizedProductType(supplierProduct)==='variant' && !supplierVariant) || !(supplierNewCost>0)} onClick={saveSupplierPriceChange} className="rounded-xl bg-black px-5 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-30">Save Price / Offer</button>
                  <button type="button" disabled={!supplierTarget?.supplier_offer_enabled} onClick={disableSupplierOffer} className="rounded-xl border border-gray-300 bg-white px-5 py-3 text-xs font-black text-gray-700 disabled:cursor-not-allowed disabled:opacity-30">Turn Special Offer OFF</button>
                </div>
                {supplierMessage && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-800">{supplierMessage}</div>}
              </div>

              <aside className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Storefront Preview</p>
                {supplierProduct && supplierTarget ? <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="relative aspect-[4/3] bg-gray-100">
                    <img src={supplierVariant?.image || supplierProduct.images?.[0] || 'https://placehold.co/600x450?text=O-RA'} alt="preview" className="h-full w-full object-cover" />
                    {supplierPreview?.kind==='offer' && <span className="absolute left-3 top-3 rounded-xl bg-orange-600 px-3 py-2 text-base font-black text-white shadow-lg">{supplierPreviewPercent}% OFF</span>}
                  </div>
                  <div className="p-4">
                    <p className="text-[10px] font-black uppercase text-orange-600">{supplierVariant?.sku || supplierProduct.sku}</p>
                    <p className="mt-1 text-sm font-black text-gray-900">{supplierProduct.name_en}{supplierVariant?` - ${supplierVariant.option_value}`:''}</p>
                    {supplierPreview?.kind==='offer' && <p className="mt-3 text-sm font-bold text-gray-400 line-through">Rs. {supplierRegularDisplay.toLocaleString()}</p>}
                    <p className="mt-1 text-2xl font-black text-orange-600">Rs. {(supplierPreview ? supplierPreviewDisplay : displayUnitPrice(supplierProduct,settings,supplierVariant)).toLocaleString()}</p>
                    {settings.free_delivery_enabled && <p className="mt-1 text-[10px] font-black text-emerald-600">🚚 FREE Islandwide Delivery</p>}
                  </div>
                </div> : <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-xs text-gray-400">Select a product to preview the saved price change.</div>}
              </aside>
            </div>
          </div>
        </div>
      )}

      {/* Full-page Add / Edit Product Workspace */}
      {activeTab === 'add_product' && canAccessTab('add_product') && isAddProductOpen && (
        <div className="space-y-4">
          <div className="relative w-full bg-neutral-900 border border-amber-500/30 rounded-3xl p-5 sm:p-7 space-y-5">
            <button
              onClick={() => { setIsAddProductOpen(false); setEditingProduct(null); setActiveTab('products'); }}
              className="absolute top-4 right-4 p-2 rounded-full bg-neutral-950 text-neutral-400"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="pr-12">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-400">Product Workspace</p>
              <h3 className="mt-1 text-xl font-black text-white">{editingProduct ? 'Edit Store Product' : 'Add New Product'}</h3>
              <p className="mt-1 text-xs text-neutral-400">Full-page entry with auto code, auto category/tags, O-RA profit calculator, variants/combos and a live storefront preview.</p>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="order-2 xl:order-1">
            <form onSubmit={handleCreateProduct} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2"><label className="block text-neutral-300">Item Code / SKU *</label><label className="flex items-center gap-1.5 text-[9px] font-black text-amber-300"><input type="checkbox" checked={productAutoCode} disabled={Boolean(editingProduct)} onChange={(e)=>{const on=e.target.checked;setProductAutoCode(on);if(on && products.length > 0)setProductForm(prev=>({...prev,sku:nextAutoSku()}));}} className="accent-amber-500"/> AUTO CODE</label></div>
                  <div className="flex gap-2"><input type="text" required readOnly={productAutoCode && !editingProduct && products.length > 0} value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value.toUpperCase() })} className={`w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono ${productAutoCode && !editingProduct && products.length > 0 ? 'text-amber-300' : ''}`} /><button type="button" disabled={Boolean(editingProduct)} onClick={()=>setProductForm(prev=>({...prev,sku:nextAutoSku()}))} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-amber-300 disabled:opacity-30" title="Generate next running code"><Sparkles className="h-4 w-4"/></button></div>
                  <p className="mt-1 text-[10px] text-neutral-500">Auto Code follows the first main-code pattern. After FULL RESET, type the first code manually (example S0001). From the next product onward it auto-increments. Turn Auto Code OFF anytime for a manual code.</p>
                </div>

                <div>
                  <label className="block text-neutral-300 mb-1">Name (English) * <span className="text-emerald-400">→ Auto Category + Tags</span></label>
                  <input
                    type="text"
                    required
                    value={productForm.name_en}
                    onChange={(e) => applyProductNameAuto(e.target.value)}
                    onBlur={(e) => { applyProductNameAuto(e.target.value); void autoFillProductSinhala('name', e.target.value); }}
                    placeholder="Example: Bluetooth Speaker"
                    className="w-full bg-neutral-950 border border-emerald-500/30 focus:border-emerald-400 rounded-xl px-3 py-2 text-white"
                  />
                  <p className="mt-1 text-[10px] text-emerald-400">{productForm.name_en.trim() ? `✓ ${liveProductAuto.suggested_category?.name_en || categories.find((c) => c.slug === productForm.category_slug)?.name_en || 'Auto Category'} • Tags auto-filled below` : 'Type the product name first. Category and tags update immediately.'}</p>
                </div>

                <div className="sm:col-span-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block font-bold text-neutral-200">Auto Category</label>
                    <button
                      type="button"
                      onClick={() => applyProductNameAuto(productForm.name_en)}
                      disabled={!productForm.name_en.trim()}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-black text-emerald-300 disabled:opacity-30"
                    >
                      Auto Fill Again
                    </button>
                  </div>
                  <select
                    value={productForm.category_slug}
                    onChange={(e) => { const slug=e.target.value; setProductForm(prev=>({ ...prev, category_slug: slug })); }}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  >
                    {liveProductAuto.suggested_category && !categories.some((c) => c.slug === liveProductAuto.suggested_category?.slug) && (
                      <option value={liveProductAuto.suggested_category.slug}>
                        Auto: {liveProductAuto.suggested_category.name_en} ({liveProductAuto.suggested_category.name_si})
                      </option>
                    )}
                    {categories.map((c) => (
                      <option key={c.id} value={c.slug}>
                        {c.name_en} ({c.name_si})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-neutral-500 mt-1">Auto-selected from the English item name. You can still change it manually.</p>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2"><label className="block text-neutral-300">Name (Sinhala සිංහල)</label><button type="button" disabled={!productForm.name_en.trim() || sinhalaTranslationBusy==='product-name'} onClick={()=>void autoFillProductSinhala('name',productForm.name_en,true)} className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[9px] font-black text-cyan-300 disabled:opacity-40"><Sparkles className="mr-1 inline h-3 w-3"/>{sinhalaTranslationBusy==='product-name'?'Translating...':'Auto Sinhala'}</button></div>
                  <input
                    type="text"
                    value={productForm.name_si}
                    onChange={(e) => setProductForm({ ...productForm, name_si: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div className="sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-neutral-300">Description (English)
                    <textarea
                      rows={4}
                      value={productForm.description_en}
                      onChange={(e) => setProductForm({ ...productForm, description_en: e.target.value })}
                      onBlur={(e)=>void autoFillProductSinhala('description',e.target.value)}
                      placeholder="Key features, what the customer gets, useful product details..."
                      className="mt-1 w-full resize-y bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white leading-5"
                    />
                  </label>
                  <label className="block text-neutral-300">
                    <span className="flex items-center justify-between gap-2"><span>Description (Sinhala)</span><button type="button" disabled={!productForm.description_en.trim() || sinhalaTranslationBusy==='product-description'} onClick={()=>void autoFillProductSinhala('description',productForm.description_en,true)} className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[9px] font-black text-cyan-300 disabled:opacity-40"><Sparkles className="mr-1 inline h-3 w-3"/>{sinhalaTranslationBusy==='product-description'?'Translating...':'Auto Sinhala'}</button></span>
                    <textarea
                      rows={4}
                      value={productForm.description_si}
                      onChange={(e) => setProductForm({ ...productForm, description_si: e.target.value })}
                      placeholder="භාණ්ඩයේ විස්තරය..."
                      className="mt-1 w-full resize-y bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white leading-5"
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-neutral-300 mb-1">Brand (Optional)</label>
                  <input
                    type="text"
                    value={productForm.brand}
                    onChange={(e) => setProductForm({ ...productForm, brand: e.target.value })}
                    placeholder="Example: O-RA, Generic, Bosch"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 mb-1">Search Keywords / Tags</label>
                  <input
                    type="text"
                    value={productForm.search_keywords}
                    onChange={(e) => setProductForm({ ...productForm, search_keywords: e.target.value })}
                    placeholder="toy car, kids toy, remote car, සෙල්ලම් කාර්"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">Auto-generated while you type the item name. Add/edit words anytime.</p>
                  {productForm.name_en.trim() && productForm.search_keywords.trim() && (
                    <p className="text-[10px] text-emerald-400 mt-1">✓ Auto tags ready</p>
                  )}
                </div>

                <div className="md:col-span-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                  <div className="mb-2">
                    <p className="text-neutral-200 font-semibold text-sm">Reference Shop / Seen Price</p>
                    <p className="text-[10px] text-sky-300/70 mt-0.5">Internal reference only — never used for purchases, Buying Price, stock value or profit calculations.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-neutral-300">
                      Shop / Supplier Seen At
                      <input
                        type="text"
                        value={productForm.source_shop_name}
                        onChange={(e) => setProductForm({ ...productForm, source_shop_name: e.target.value })}
                        placeholder="Example: Pettah Shop A / Online Store"
                        className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                      />
                    </label>
                    <label className="block text-neutral-300">
                      Seen Price (Rs.)
                      <input
                        type="number"
                        min="0"
                        value={productForm.source_shop_price || ''}
                        onChange={(e) => setProductForm({ ...productForm, source_shop_price: Number(e.target.value || 0) })}
                        placeholder="Optional"
                        className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                      />
                    </label>
                  </div>
                </div>

                <div className="sm:col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-3">
                  <div>
                    <p className="font-black text-neutral-100">Product Type</p>
                    <p className="text-[10px] text-neutral-500">Single Products stay here. Combo Packs now have their own separate workspace.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {([
                      ['normal','Normal Product','One item / one price'],
                      ['variant','Options / Variants','Color + Size, dimensions, style, capacity or other exact combinations'],
                    ] as const).map(([type,label,help])=><button key={type} type="button" onClick={()=>setProductForm(prev=>({...prev,product_type:type}))} className={`rounded-xl border p-3 text-left transition ${productForm.product_type===type?'border-amber-400 bg-amber-500/15':'border-neutral-800 bg-neutral-950 hover:border-neutral-700'}`}><p className={`text-xs font-black ${productForm.product_type===type?'text-amber-300':'text-white'}`}>{label}</p><p className="mt-1 text-[9px] text-neutral-500">{help}</p></button>)}
                  </div>
                  {canAccessTab('combo_packs') && <button type="button" onClick={()=>{setIsAddProductOpen(false);setEditingProduct(null);setActiveTab('combo_packs');}} className="w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-black text-cyan-300">Need a Combo Pack? Open COMBO PACKS →</button>}
                </div>

                {productForm.product_type==='variant' && (
                  <div className="sm:col-span-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><p className="font-black text-violet-300">Exact Variant Combinations</p><p className="text-[10px] text-neutral-500">Each row is one exact SKU. Example: Color = Blue + Size = XL. Add as many option dimensions as that SKU needs.</p></div>
                      <button type="button" onClick={()=>{
                        const used=(productForm.variants||[]).map(v=>v.sku);
                        const variant:ProductVariant={id:`var-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,sku:buildVariantSku(productForm.sku,`OPT-${productForm.variants.length+1}`,used),option_name:'Color',option_value:'',options:[{name:'Color',value:''}],image:'',buying_price:productForm.buying_price,selling_price:productForm.selling_price,stock_quantity:0,status:'Out of Stock'};
                        setProductForm(prev=>({...prev,variants:[...prev.variants,variant]}));
                      }} className="rounded-lg bg-violet-500 px-3 py-2 text-[10px] font-black text-white"><Plus className="inline w-3 h-3 mr-1"/>Add Variant Combination</button>
                    </div>
                    {(productForm.variants||[]).map((v,index)=>{const optionRows=v.options?.length?v.options:[{name:v.option_name||'Color',value:v.option_value||''}];return <div key={v.id} className="rounded-xl bg-neutral-950 border border-neutral-800 p-3 space-y-3">
                      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,1.7fr)_110px_110px_90px_150px] items-start">
                        <div className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-2 space-y-2">
                          <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black text-violet-300">Options for this exact SKU</p><button type="button" onClick={()=>{const rows=[...optionRows,{name:optionRows.some(o=>o.name==='Size')?'Other':'Size',value:''}];const next=[...productForm.variants];next[index]={...v,options:rows,option_name:rows[0]?.name||'Option',option_value:rows.map(o=>o.value).filter(Boolean).join(' / ')};setProductForm(prev=>({...prev,variants:next}));}} className="rounded-lg border border-violet-500/30 px-2 py-1 text-[9px] font-black text-violet-300"><Plus className="inline h-3 w-3"/> Add Option</button></div>
                          {optionRows.map((option,optionIndex)=><div key={`${v.id}-opt-${optionIndex}`} className="grid grid-cols-[110px_minmax(0,1fr)_30px] gap-2 items-end">
                            <label className="text-[9px] text-neutral-400">Type<select value={option.name||'Color'} onChange={(e)=>{const rows=optionRows.map((row,i)=>i===optionIndex?{...row,name:e.target.value}:row);const label=rows.map(row=>row.value).filter(Boolean).join(' / ');const next=[...productForm.variants];next[index]={...v,options:rows,option_name:rows[0]?.name||'Option',option_value:label,sku:buildVariantSku(productForm.sku,label||`OPT-${index+1}`,next.filter((_,i)=>i!==index).map(x=>x.sku))};setProductForm(prev=>({...prev,variants:next}));}} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-2 text-white"><option>Color</option><option>Size</option><option>Dimensions</option><option>Style</option><option>Capacity</option><option>Length</option><option>Width</option><option>Material</option><option>Other</option></select></label>
                            <label className="text-[9px] text-neutral-400">Value<input value={option.value} onChange={(e)=>{const rows=optionRows.map((row,i)=>i===optionIndex?{...row,value:e.target.value}:row);const label=rows.map(row=>row.value).filter(Boolean).join(' / ');const next=[...productForm.variants];next[index]={...v,options:rows,option_name:rows[0]?.name||'Option',option_value:label,sku:buildVariantSku(productForm.sku,label||`OPT-${index+1}`,next.filter((_,i)=>i!==index).map(x=>x.sku))};setProductForm(prev=>({...prev,variants:next}));}} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-2 text-white" placeholder={option.name==='Size'?'XL':option.name==='Color'?'Blue':'Value'} /></label>
                            <button type="button" disabled={optionRows.length<=1} onClick={()=>{const rows=optionRows.filter((_,i)=>i!==optionIndex);const label=rows.map(row=>row.value).filter(Boolean).join(' / ');const next=[...productForm.variants];next[index]={...v,options:rows,option_name:rows[0]?.name||'Option',option_value:label,sku:buildVariantSku(productForm.sku,label||`OPT-${index+1}`,next.filter((_,i)=>i!==index).map(x=>x.sku))};setProductForm(prev=>({...prev,variants:next}));}} className="h-9 rounded-lg bg-red-950 text-red-300 disabled:opacity-30"><X className="mx-auto h-3 w-3"/></button>
                          </div>)}
                        </div>
                        <label className="text-[10px] text-neutral-400">Buying Rs.<input type="number" min="0" value={v.buying_price} onChange={(e)=>{const cost=Math.max(0,Number(e.target.value||0));const next=[...productForm.variants];next[index]={...v,buying_price:cost,selling_price:productAutoPricing?cost+profitForBuyingPrice(cost):v.selling_price,discount_price:productAutoPricing?cost+profitForBuyingPrice(cost):v.discount_price,discount_enabled:productAutoPricing?false:v.discount_enabled,offer_buying_price:productAutoPricing?undefined:v.offer_buying_price,supplier_offer_enabled:productAutoPricing?false:v.supplier_offer_enabled};setProductForm(prev=>({...prev,variants:next}));}} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-2 text-white"/></label>
                        <label className="text-[10px] text-neutral-400">Selling Rs.<input type="number" min="0" value={v.selling_price} onChange={(e)=>{const next=[...productForm.variants];next[index]={...v,selling_price:Number(e.target.value||0)};setProductForm(prev=>({...prev,variants:next}));}} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-2 text-white"/></label>
                        <label className="text-[10px] text-neutral-400">Stock<input type="number" min="0" value={v.stock_quantity} onChange={(e)=>{const stock=Math.max(0,Number(e.target.value||0));const next=[...productForm.variants];next[index]={...v,stock_quantity:stock,status:stock>0?'Active':'Out of Stock'};setProductForm(prev=>({...prev,variants:next}));}} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-2 text-white"/></label>
                        <div className="text-[10px] text-neutral-400">Variant Image<div className="mt-1 flex h-[34px] items-center gap-2">{v.image ? <img src={v.image} alt="" className="h-8 w-8 rounded-lg object-cover border border-neutral-700"/> : <div className="h-8 w-8 rounded-lg border border-dashed border-neutral-700 bg-neutral-900"/>}<input id={`variant-image-${v.id}`} type="file" accept="image/*" className="hidden" onChange={(e)=>{const file=e.target.files?.[0];e.target.value='';void handleVariantImageUpload(index,file);}}/><label htmlFor={`variant-image-${v.id}`} className="cursor-pointer rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-2 font-black text-violet-300">{variantImageUploadingId===v.id?'Uploading…':v.image?'Change':'Upload'}</label>{v.image && <button type="button" onClick={()=>{const next=[...productForm.variants];next[index]={...v,image:''};setProductForm(prev=>({...prev,variants:next}));}} className="text-red-400"><X className="h-3.5 w-3.5"/></button>}</div></div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-900 pt-2">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] text-neutral-500">Exact variant:</span><span className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[10px] font-black text-violet-200">{optionRows.map(o=>`${o.name}: ${o.value||'?'}`).join(' • ')}</span><input value={v.sku} onChange={(e)=>{const next=[...productForm.variants];next[index]={...v,sku:e.target.value.toUpperCase()};setProductForm(prev=>({...prev,variants:next}));}} className="w-48 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-[10px] text-violet-300"/><button type="button" title="Regenerate code" onClick={()=>{const next=[...productForm.variants];const label=optionRows.map(o=>o.value).filter(Boolean).join(' / ');next[index]={...v,sku:buildVariantSku(productForm.sku,label||`OPT-${index+1}`,next.filter((_,i)=>i!==index).map(x=>x.sku))};setProductForm(prev=>({...prev,variants:next}));}} className="rounded-lg bg-neutral-800 p-1.5 text-violet-300"><Sparkles className="w-3 h-3"/></button></div>
                        <button type="button" onClick={()=>{if(confirm(`Delete ${v.option_value || 'this variant combination'}? Historical orders stay unchanged.`))setProductForm(prev=>({...prev,variants:prev.variants.filter((_,i)=>i!==index)}));}} className="rounded-lg bg-red-950 px-2 py-1 text-[10px] font-black text-red-300"><Trash2 className="inline w-3 h-3 mr-1"/>Delete</button>
                      </div>
                    </div>})}
                    {!productForm.variants.length && <div className="rounded-xl border border-dashed border-violet-500/30 p-4 text-center text-[10px] text-violet-300">Example clothing: add Blue + M, Blue + XL, Red + M as separate exact SKU rows. Customer sees separate Color and Size selectors.</div>}
                  </div>
                )}

                <div className="sm:col-span-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-black text-blue-300">Size / Measurements / Pack Details</p><p className="text-[10px] text-neutral-500">Optional size/measurement details kept separate from the eBay-style Item Details section below. These do not change price/stock.</p></div><button type="button" onClick={()=>setProductForm(prev=>({...prev,specifications:[...prev.specifications,{id:`spec-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,label:'Other',value:'',unit:''}]}))} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[10px] font-black text-blue-300"><Plus className="inline h-3 w-3 mr-1"/>Custom Detail</button></div>
                  <div className="flex flex-wrap gap-1.5">{['Size','Length','Width','Height','Capacity','Weight','Material','Pack Size'].map((label)=><button key={label} type="button" onClick={()=>setProductForm(prev=>({...prev,specifications:[...prev.specifications,{id:`spec-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,label,value:'',unit:''}]}))} className="rounded-full border border-blue-500/20 bg-neutral-950 px-2.5 py-1 text-[9px] font-black text-blue-300">+ {label}</button>)}</div>
                  <datalist id="ora-spec-labels"><option value="Size"/><option value="Length"/><option value="Width"/><option value="Height"/><option value="Capacity"/><option value="Weight"/><option value="Material"/><option value="Pack Size"/><option value="Other"/></datalist>
                  {productForm.specifications.map((spec,index)=><div key={spec.id} className="grid grid-cols-[1fr_1.4fr_90px_34px] gap-2 items-end"><label className="text-[10px] text-neutral-400">Detail<input list="ora-spec-labels" value={spec.label} onChange={(e)=>{const next=[...productForm.specifications];next[index]={...spec,label:e.target.value};setProductForm(prev=>({...prev,specifications:next}));}} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" placeholder="Size"/></label><label className="text-[10px] text-neutral-400">Value<input value={spec.value} onChange={(e)=>{const next=[...productForm.specifications];next[index]={...spec,value:e.target.value};setProductForm(prev=>({...prev,specifications:next}));}} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" placeholder="XL / 10 / Stainless Steel"/></label><label className="text-[10px] text-neutral-400">Unit<input value={spec.unit||''} onChange={(e)=>{const next=[...productForm.specifications];next[index]={...spec,unit:e.target.value};setProductForm(prev=>({...prev,specifications:next}));}} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" placeholder="cm / m"/></label><button type="button" onClick={()=>setProductForm(prev=>({...prev,specifications:prev.specifications.filter((_,i)=>i!==index)}))} className="h-9 rounded-lg bg-red-950 text-red-300"><X className="h-3.5 w-3.5 mx-auto"/></button></div>)}
                  {!productForm.specifications.length && <p className="text-[10px] text-neutral-600">No extra details added. That is okay for products that do not need size/measurements.</p>}
                </div>

                <div className="sm:col-span-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-cyan-300">Item Details / Specifications <span className="text-[9px] font-bold text-neutral-500">(Optional)</span></p>
                      <p className="text-[10px] text-neutral-500">Use only when the product has useful facts such as Model, Type, Condition or Warranty. Empty rows are never shown to customers. Brand is taken automatically from the Brand field above when filled.</p>
                    </div>
                    <button type="button" onClick={()=>addItemDetail()} className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-black text-cyan-300"><Plus className="mr-1 inline h-3 w-3"/>Custom Detail</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ITEM_DETAIL_PRESETS.map((preset)=><button key={preset.label_en} type="button" onClick={()=>addItemDetail(preset.label_en,preset.label_si)} className="rounded-full border border-cyan-500/20 bg-neutral-950 px-2.5 py-1 text-[9px] font-black text-cyan-300">+ {preset.label_en}</button>)}
                  </div>
                  {productForm.item_details.map((detail)=>{
                    const busy=sinhalaTranslationBusy===`detail-${detail.id}`;
                    return <div key={detail.id} className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-2.5">
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_1.25fr_1fr_1.25fr_auto] lg:items-end">
                        <label className="text-[10px] text-neutral-400">Detail (English)<input value={detail.label_en} onChange={(e)=>setProductForm(prev=>({...prev,item_details:prev.item_details.map(row=>row.id===detail.id?{...row,label_en:e.target.value}:row)}))} onBlur={()=>void autoTranslateItemDetail(detail.id)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" placeholder="Model / Type / Warranty"/></label>
                        <label className="text-[10px] text-neutral-400">Value (English)<input value={detail.value_en} onChange={(e)=>setProductForm(prev=>({...prev,item_details:prev.item_details.map(row=>row.id===detail.id?{...row,value_en:e.target.value}:row)}))} onBlur={()=>void autoTranslateItemDetail(detail.id)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" placeholder="MPIO 1500 / New / 6 Months"/></label>
                        <label className="text-[10px] text-neutral-400">Detail (Sinhala)<input value={detail.label_si||''} onChange={(e)=>setProductForm(prev=>({...prev,item_details:prev.item_details.map(row=>row.id===detail.id?{...row,label_si:e.target.value}:row)}))} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" placeholder="ස්වයංක්‍රීයව පිරේ"/></label>
                        <label className="text-[10px] text-neutral-400">Value (Sinhala)<input value={detail.value_si||''} onChange={(e)=>setProductForm(prev=>({...prev,item_details:prev.item_details.map(row=>row.id===detail.id?{...row,value_si:e.target.value}:row)}))} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" placeholder="ස්වයංක්‍රීයව පිරේ"/></label>
                        <div className="flex gap-1 lg:pb-0.5"><button type="button" disabled={busy || (!detail.label_en.trim() && !detail.value_en.trim())} onClick={()=>void autoTranslateItemDetail(detail.id,true)} className="h-9 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 text-cyan-300 disabled:opacity-30" title="Regenerate Sinhala"><Sparkles className="h-3.5 w-3.5"/></button><button type="button" onClick={()=>setProductForm(prev=>({...prev,item_details:prev.item_details.filter(row=>row.id!==detail.id)}))} className="h-9 rounded-lg bg-red-950 px-2 text-red-300"><X className="h-3.5 w-3.5"/></button></div>
                      </div>
                      {busy && <p className="mt-1 text-[9px] font-bold text-cyan-300">Generating Sinhala…</p>}
                    </div>;
                  })}
                  {!productForm.item_details.length && <p className="text-[10px] text-neutral-600">No item specifications added. This is completely optional.</p>}
                </div>

                <div className="sm:col-span-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black text-emerald-300">O-RA Auto Price Calculator</p><p className="text-[10px] text-neutral-500">Selling Price below is the product price before the hidden delivery reserve. With FREE Delivery mode, Rs. {Math.max(0,Number(settings.delivery_fee||0)).toLocaleString()} is added automatically to the customer display price.</p></div><div className="flex rounded-xl border border-neutral-700 bg-neutral-950 p-1"><button type="button" onClick={()=>{setProductAutoPricing(true);const profit=profitForBuyingPrice(productForm.buying_price);setProductForm(prev=>({...prev,auto_price_enabled:true,selling_price:Number(prev.buying_price||0)+profit,discount_price:Number(prev.buying_price||0)+profit,discount_enabled:false,offer_buying_price:undefined,supplier_offer_enabled:false}));}} className={`rounded-lg px-3 py-1.5 text-[10px] font-black ${productAutoPricing?'bg-emerald-500 text-black':'text-neutral-400'}`}>AUTO PROFIT</button><button type="button" onClick={()=>{setProductAutoPricing(false);setProductForm(prev=>({...prev,auto_price_enabled:false}));}} className={`rounded-lg px-3 py-1.5 text-[10px] font-black ${!productAutoPricing?'bg-amber-500 text-black':'text-neutral-400'}`}>CUSTOM PROFIT</button></div></div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <label className="text-[10px] font-bold text-neutral-400">Buying Price<input type="number" min="0" required value={productForm.buying_price} onChange={(e)=>{const cost=Math.max(0,Number(e.target.value||0));setProductForm(prev=>productAutoPricing?{...prev,buying_price:cost,selling_price:cost+profitForBuyingPrice(cost),discount_price:cost+profitForBuyingPrice(cost),discount_enabled:false,offer_buying_price:undefined,supplier_offer_enabled:false}:{...prev,buying_price:cost});}} className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white"/></label>
                    <label className="text-[10px] font-bold text-neutral-400">Profit<input type="number" min="0" readOnly={productAutoPricing} value={Math.max(0,Number(productForm.selling_price||0)-Number(productForm.buying_price||0))} onChange={(e)=>{const profit=Math.max(0,Number(e.target.value||0));setProductAutoPricing(false);setProductForm(prev=>({...prev,auto_price_enabled:false,selling_price:Number(prev.buying_price||0)+profit,discount_price:Number(prev.buying_price||0)+profit,discount_enabled:false,offer_buying_price:undefined,supplier_offer_enabled:false}));}} className={`mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 ${productAutoPricing?'text-emerald-300':'text-white'}`}/></label>
                    <label className="text-[10px] font-bold text-neutral-400">Base Selling<input type="number" min="0" required value={productForm.selling_price} onChange={(e)=>{setProductAutoPricing(false);setProductForm(prev=>({...prev,auto_price_enabled:false,selling_price:Math.max(0,Number(e.target.value||0))}));}} className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white"/></label>
                    <div className="rounded-xl border border-emerald-500/20 bg-neutral-950 p-3"><p className="text-[9px] font-bold text-neutral-500">CUSTOMER DISPLAY</p><p className="mt-1 text-lg font-black text-emerald-300">Rs. {(Number(productForm.selling_price||0)+(settings.free_delivery_enabled?Math.max(0,Number(settings.delivery_fee||0)):0)).toLocaleString()}</p><p className="text-[9px] text-neutral-500">{settings.free_delivery_enabled?'FREE delivery shown':'delivery separate'}</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[9px] text-neutral-500 sm:grid-cols-5"><span>1–249 → +200</span><span>250–499 → +350</span><span>500 → +500</span><span>501–999 → +700</span><span>1,000–1,999 → +900</span><span>2,000–2,999 → +1,100</span><span>3,000–4,999 → +1,500</span><span>5,000–7,499 → +1,800</span><span>7,500–9,999 → +2,200</span><span>10,000–14,999 → +3,000</span><span>15,000–19,999 → +4,000</span><span>20,000+ → 25%</span></div>
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[10px] leading-4 text-blue-200">
                    This profit table is used only for the first product/variant price. Later supplier price changes must be saved from <b>SUPPLIER PRICE / OFFER</b> in the sidebar, so a new purchase cost cannot accidentally change the website price.
                  </div>
                </div>

                <div className="md:col-span-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <p className="text-neutral-200 font-semibold text-sm">Enable Product Discount / Offer</p>
                      <p className="text-[10px] text-neutral-500 mt-0.5">OFF = customer sees the normal selling price only.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(productForm.discount_enabled)}
                      onChange={(e) => setProductForm({ ...productForm, discount_enabled: e.target.checked })}
                      className="w-5 h-5 accent-amber-500"
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-neutral-300 mb-1">Discount Price (Rs.)</label>
                  <input
                    type="number"
                    value={productForm.discount_price}
                    disabled={!productForm.discount_enabled}
                    onChange={(e) => setProductForm({ ...productForm, discount_price: Number(e.target.value) })}
                    className={`w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white ${!productForm.discount_enabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  />
                  {!productForm.discount_enabled && (
                    <p className="text-[10px] text-neutral-500 mt-1">Discount is OFF. Selling Price will be used.</p>
                  )}
                </div>

                <div>
                  <label className="block text-neutral-300 mb-1">Initial Stock Quantity *</label>
                  <input
                    type="number"
                    required
                    value={productForm.stock_quantity}
                    onChange={(e) => setProductForm({ ...productForm, stock_quantity: Number(e.target.value) })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              {/* Product Image File Uploader & URL Input */}
              <div className="space-y-2">
                <label className="block text-neutral-300 font-semibold mb-1">Product Images</label>

                {/* File Upload Box */}
                <div className="border-2 border-dashed border-neutral-800 hover:border-amber-500 rounded-xl p-4 text-center bg-neutral-950 transition-colors">
                  <Upload className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                  <p className="text-xs font-bold text-white">Upload Images from PC or Phone</p>
                  <p className="text-[10px] text-neutral-500 mb-2">Select JPG, PNG or WEBP • max 6 • auto-compressed & stored as URLs</p>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageFileUpload}
                    className="hidden"
                    id="product-file-upload-input"
                  />
                  <label
                    htmlFor="product-file-upload-input"
                    className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-amber-500 text-neutral-950 text-xs font-bold cursor-pointer hover:bg-amber-400 transition-colors"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{productImageUploading ? 'Uploading…' : 'Choose Image Files'}</span>
                  </label>
                </div>

                {/* Image Previews */}
                {productForm.images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {productForm.images.map((img, idx) => (
                      <div
                        key={idx}
                        className="relative group rounded-xl overflow-hidden border border-neutral-800 aspect-square bg-neutral-950"
                      >
                        <img src={img} alt={`Product ${idx}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => {
                            setProductForm({
                              ...productForm,
                              images: productForm.images.filter((_, i) => i !== idx),
                            });
                          }}
                          className="absolute top-1 right-1 p-1 rounded-full bg-red-600 text-white"
                          title="Remove image"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        {idx === 0 && (
                          <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-amber-400 text-[9px] font-bold">
                            Primary
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-[10px] text-neutral-500">Images are upload-only so accidental/broken external URLs do not appear on the storefront.</p>
              </div>

              {(adminUser?.role === 'admin' || adminUser?.permissions?.includes('notifications')) && <label className="flex items-center gap-2 rounded-xl border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-[10px] font-black text-orange-200"><input type="checkbox" checked={notifyCustomersOnProductSave} onChange={(e)=>setNotifyCustomersOnProductSave(e.target.checked)} className="accent-orange-500"/><Bell className="h-3.5 w-3.5"/>Send customer notification when this product is saved</label>}

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs hover:bg-amber-400 transition-colors"
              >
                Save Product
              </button>
            </form>
              </div>

              <aside className="order-1 xl:order-2 xl:sticky xl:top-4 self-start rounded-3xl border border-neutral-800 bg-neutral-950 p-4 space-y-4">
                <div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-amber-400">Live Preview</p><p className="text-xs text-neutral-500">Customer-facing product card preview</p></div><Store className="h-5 w-5 text-amber-400"/></div>
                <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-white text-gray-900">
                  <div className="relative aspect-square bg-gray-100"><img src={productForm.images[0] || 'https://placehold.co/600x600?text=O-RA'} alt="Product preview" className="h-full w-full object-cover" />{productForm.discount_enabled && productForm.discount_price > 0 && productForm.discount_price < productForm.selling_price && <div className="absolute left-3 top-3 rounded-xl bg-orange-600 px-3 py-1.5 text-sm font-black text-white shadow-lg">{Math.max(1,Math.round(((productForm.selling_price-productForm.discount_price)/Math.max(1,productForm.selling_price))*100))}% OFF</div>}</div>
                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-wide text-orange-600">{categories.find(c=>c.slug===productForm.category_slug)?.name_en || liveProductAuto.suggested_category?.name_en || 'Auto Category'}</p><h4 className="mt-1 text-sm font-black leading-5">{productForm.name_en || 'Product Name Preview'}</h4></div><span className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-[10px] font-bold">{productForm.sku || 'AUTO'}</span></div>
                    {productForm.product_type === 'variant' && productForm.variants.length > 0 && <div className="flex flex-wrap gap-1.5">{productForm.variants.slice(0,5).map(v=><span key={v.id} className="rounded-full border border-gray-200 px-2 py-1 text-[10px] font-bold">{v.option_value || 'Color'}</span>)}</div>}
                    <div className="pt-1">{productForm.discount_enabled && productForm.discount_price > 0 && productForm.discount_price < productForm.selling_price && <p className="text-sm font-bold text-gray-400 line-through">Rs. {(productForm.selling_price + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0)).toLocaleString()}</p>}<p className="text-xl font-black text-orange-600">Rs. {((productForm.discount_enabled && productForm.discount_price > 0 && productForm.discount_price < productForm.selling_price ? productForm.discount_price : productForm.selling_price) + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0)).toLocaleString()}</p>{settings.free_delivery_enabled ? <p className="text-[10px] font-bold text-emerald-600">🚚 FREE Islandwide Delivery</p> : <p className="text-[10px] text-gray-500">Delivery added at checkout</p>}</div>
                    <button type="button" className="w-full rounded-xl bg-black py-2.5 text-xs font-black text-white">Add to Cart – Preview Only</button>
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] leading-5 text-neutral-300">
                  <p className="font-black text-emerald-300">Price breakdown (Admin only)</p>
                  <p>Buying: Rs. {Number(productForm.buying_price||0).toLocaleString()}</p>
                  <p>Profit: Rs. {Math.max(0, Number(productForm.selling_price||0)-Number(productForm.buying_price||0)).toLocaleString()} {productAutoPricing ? '(Auto)' : '(Custom)'}</p>
                  <p>Delivery reserve: Rs. {Math.max(0, Number(settings.delivery_fee||0)).toLocaleString()}</p>
                  <p className="font-black">Customer display: Rs. {((productForm.discount_enabled && productForm.discount_price > 0 && productForm.discount_price < productForm.selling_price ? productForm.discount_price : productForm.selling_price) + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0)).toLocaleString()}</p>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}


        </main>
      </div>

      {/* Delete selected order modal */}
      {isDeleteOrderOpen && selectedDeleteOrderId && (() => {
        const target = orders.find((o) => o.id === selectedDeleteOrderId);
        if (!target) return null;
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-neutral-950/85 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-neutral-900 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-black text-white">Delete Order {target.order_number}</h3>
                  <p className="mt-1 text-xs text-neutral-400">A reason is required and will be recorded in Activity Log.</p>
                </div>
                <button type="button" onClick={() => !deleteOrderBusy && setIsDeleteOrderOpen(false)} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white"><X className="w-4 h-4" /></button>
              </div>

              {(target.order_status === 'Shipped' || target.order_status === 'Delivered' || target.dispatch_status === 'Handed Over') && (
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-bold text-amber-200">
                  This order is already shipped/delivered and is protected from deletion. Use the return/delivery flow instead.
                </div>
              )}

              <label className="mt-4 block text-xs font-bold text-neutral-300">Delete Reason *</label>
              <select
                value={deleteOrderReason}
                onChange={(e) => setDeleteOrderReason(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-white"
              >
                <option value="">Select a reason...</option>
                <option value="Customer requested cancellation">Customer requested cancellation</option>
                <option value="Duplicate / fake order">Duplicate / fake order</option>
                <option value="Wrong / test order entry">Wrong / test order entry</option>
                <option value="Invalid customer details">Invalid customer details</option>
                <option value="Admin cleanup - not required">Admin cleanup - not required</option>
              </select>
              <textarea
                value={deleteOrderReason.startsWith('Other: ') ? deleteOrderReason.slice(7) : ''}
                onChange={(e) => setDeleteOrderReason(e.target.value.trimStart() ? `Other: ${e.target.value}` : '')}
                placeholder="Or type another reason..."
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-white placeholder:text-neutral-600"
              />

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" disabled={deleteOrderBusy} onClick={() => setIsDeleteOrderOpen(false)} className="rounded-xl border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-800">Cancel</button>
                <button
                  type="button"
                  disabled={deleteOrderBusy || deleteOrderReason.trim().length < 3 || target.order_status === 'Shipped' || target.order_status === 'Delivered' || target.dispatch_status === 'Handed Over'}
                  onClick={async () => {
                    setDeleteOrderBusy(true);
                    const result = await deleteOrder(target.id, deleteOrderReason, adminUser?.name || 'Admin');
                    setDeleteOrderBusy(false);
                    if (!result.success) { alert(result.message); return; }
                    setIsDeleteOrderOpen(false);
                    setSelectedDeleteOrderId('');
                    setDeleteOrderReason('');
                    alert(result.message);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" /> {deleteOrderBusy ? 'Deleting...' : 'Delete Order'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Change Password Modal */}
      {isChangePasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-md">
          <div className="relative w-full max-w-sm bg-neutral-900 border border-amber-500/30 rounded-2xl p-6 space-y-4">
            <button
              onClick={() => setIsChangePasswordOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-neutral-950 text-neutral-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <KeyRound className="w-5 h-5 text-amber-400" />
              <span>Change Your Password</span>
            </h3>

            <form onSubmit={handleChangePassword} className="space-y-3 text-xs">
              <div>
                <label className="block text-neutral-300 mb-1">Current Password *</label>
                <input
                  type="password"
                  required
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-neutral-300 mb-1">New Password *</label>
                <input
                  type="password"
                  required
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-neutral-300 mb-1">Confirm New Password *</label>
                <input
                  type="password"
                  required
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs hover:bg-amber-400"
              >
                Update Password
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add Staff Account Modal */}
      {isAddStaffModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-md">
          <div className="relative w-full max-w-2xl bg-neutral-900 border border-amber-500/30 rounded-2xl p-6 space-y-4">
            <button
              onClick={() => setIsAddStaffModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-neutral-950 text-neutral-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <UserPlus className="w-5 h-5 text-amber-400" />
              <span>Create Staff Account</span>
            </h3>

            <form onSubmit={handleAddStaffAccount} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-300 mb-1">Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. kamal"
                    value={staffForm.username}
                    onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 mb-1">Password *</label>
                  <input
                    type="password"
                    required
                    value={staffForm.password}
                    onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-neutral-300 mb-1">Staff Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Kamal Perera"
                  value={staffForm.name}
                  onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-neutral-300 mb-1">Email Address (Optional)</label>
                <input
                  type="email"
                  placeholder="staff@gmail.com"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-neutral-300 mb-2">Staff Module Access *</label>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950">
                  {allPermissionIds.filter((id)=>id!=='user_access').map((perm)=><div key={perm} className="flex items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2 last:border-b-0"><span className="text-[10px] font-bold text-neutral-300">{permissionLabels[perm]}</span><select value={accessLevelFromList(staffForm.permissions,perm)} onChange={(e)=>setStaffForm({...staffForm,permissions:setAccessLevelInList(staffForm.permissions,perm,e.target.value as StaffAccessLevel)})} className="w-36 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[10px] font-bold text-white"><option value="none">No Access</option><option value="view">View Only</option><option value="edit">Edit / Manage</option></select></div>)}
                </div>
                <div className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3"><p className="mb-2 text-[10px] font-black text-blue-300">SPECIAL ACTIONS</p><div className="space-y-2">{specialActionRows.map((action)=><label key={action.id} className="flex items-center gap-2 text-[10px] font-bold text-neutral-300"><input type="checkbox" className="accent-blue-500" checked={staffForm.permissions.includes(`action:${action.id}`)} onChange={(e)=>{const token=`action:${action.id}`;setStaffForm({...staffForm,permissions:e.target.checked?Array.from(new Set([...staffForm.permissions,token])):staffForm.permissions.filter((p)=>p!==token)})}}/>{action.label}</label>)}</div></div>
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs hover:bg-amber-400"
              >
                Create Staff Account
              </button>
            </form>
          </div>
        </div>
      )}

      {/* System Reset Double-Confirmation Modal */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/90 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-neutral-900 border border-red-500/50 rounded-2xl p-6 space-y-4 text-center">
            <button
              onClick={() => setIsResetConfirmOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-neutral-950 text-neutral-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-full bg-red-950 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-white">Confirm FULL LIVE START RESET</h3>
              <p className="text-xs text-neutral-400 mt-1">
                This permanently clears Products/Variants/Combos/Categories, stock/purchases, Web/FB/TikTok orders & leads, customers, returns, payments and other operational/demo data. Linked Google Sheet order rows are cleared too. Website Info & Policy text, login/staff accounts, Google Sheet URL, technical/API connections, branding and invoice design are kept. Bank/contact/BR fields are cleared for real details.
              </p>
            </div>

            <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 text-left space-y-2">
              <label className="block text-xs font-bold text-red-400">
                To confirm, type <span className="text-white bg-red-950 px-1 py-0.5 rounded font-mono">RESET ORA</span> below:
              </label>
              <input
                type="text"
                value={resetTypedConfirm}
                onChange={(e) => setResetTypedConfirm(e.target.value)}
                placeholder="Type RESET ORA"
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono text-center font-bold text-sm tracking-widest focus:border-red-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setIsResetConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-neutral-800 text-neutral-300 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleResetSystemData}
                disabled={resetTypedConfirm.trim().toUpperCase() !== 'RESET ORA'}
                className="flex-1 py-2.5 rounded-xl bg-red-600 disabled:opacity-40 text-white font-bold text-xs hover:bg-red-700 transition-colors"
              >
                Yes, Clear Demo Data & Start Live
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk CSV Order Import Modal */}
      {isBulkOrderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-3xl bg-neutral-900 border border-emerald-500/40 rounded-2xl p-5 sm:p-6 space-y-5 my-auto max-h-[90vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center space-x-3 text-emerald-400">
                <FileSpreadsheet className="w-6 h-6" />
                <div>
                  <h3 className="text-base font-bold text-white">
                    Bulk CSV Order Import (ඇණවුම් එකවර ඇතුළත් කිරීම)
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Upload FB/TikTok/Call orders via CSV file. Orders are accepted even without stock. Stock is allocated automatically only when physical stock is available.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBulkOrderOpen(false)}
                className="p-1.5 rounded-full bg-neutral-800 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                <p className="text-xs font-black text-blue-300">Facebook Orders</p>
                <p className="mt-1 text-[10px] text-neutral-400">Download a fresh template with the next available FB-xxxxxx IDs. Keep only the rows you need, fill confirmed orders, then upload below.</p>
                <button type="button" onClick={()=>downloadSourceOrderTemplate('Facebook Ads')} className="mt-3 w-full rounded-lg bg-blue-500 px-3 py-2 text-[11px] font-black text-white">
                  Download Facebook Template
                </button>
              </div>
              <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-4">
                <p className="text-xs font-black text-fuchsia-300">TikTok Orders</p>
                <p className="mt-1 text-[10px] text-neutral-400">Download a fresh template with the next available TK-xxxxxx IDs. Used IDs are rejected if an old template is uploaded again.</p>
                <button type="button" onClick={()=>downloadSourceOrderTemplate('TikTok Ads')} className="mt-3 w-full rounded-lg bg-fuchsia-500 px-3 py-2 text-[11px] font-black text-white">
                  Download TikTok Template
                </button>
              </div>
            </div>

            {/* Template Download & File Upload Zone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Step 1: Download Template */}
              <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-2.5 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">
                    Step 1: Download CSV Format
                  </span>
                  <p className="text-xs text-neutral-300 font-semibold mt-1">Get Sample CSV Template File</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Includes columns: <b>Item_Code, Quantity, Customer_Name, Phone, WhatsApp, Address, City, Channel_Source, Payment_Method</b>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={downloadOrderCsvTemplate}
                  className="w-full py-2.5 px-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 font-bold text-xs flex items-center justify-center space-x-2 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Sample Template (.CSV)</span>
                </button>
              </div>

              {/* Step 2: Upload CSV File */}
              <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-2.5 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">
                    Step 2: Upload Completed CSV
                  </span>
                  <p className="text-xs text-neutral-300 font-semibold mt-1">Select CSV File from Computer</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5 truncate">
                    {bulkCsvFileName ? `Selected: ${bulkCsvFileName}` : 'Choose .csv file containing orders.'}
                  </p>
                </div>
                <label className="cursor-pointer w-full py-2.5 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs flex items-center justify-center space-x-2 transition-colors border border-neutral-700">
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>{bulkCsvFileName ? 'Change CSV File' : 'Choose CSV File'}</span>
                  <input
                    type="file"
                    accept=".csv, text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCsvFileUpload(file);
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Call Center Result CSV */}
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black text-orange-300">Call Center Result CSV</p>
                  <p className="mt-1 text-[11px] text-neutral-400">Confirmed → Processing • No Answer → Pending • Cancelled → Cancelled. Stock is allocated only after confirmation.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={downloadCallCenterCsvTemplate} className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-[11px] font-bold text-orange-300">
                    <Download className="mr-1 inline h-4 w-4"/>Template
                  </button>
                  <label className="cursor-pointer rounded-lg bg-orange-500 px-3 py-2 text-[11px] font-black text-black">
                    <Upload className="mr-1 inline h-4 w-4"/>Upload Results
                    <input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>e.target.files?.[0] && handleCallCenterCsvUpload(e.target.files[0])}/>
                  </label>
                </div>
              </div>
            </div>

            {/* Parsed Preview Table */}
            {parsedCsvRows.length > 0 && (
              <div className="space-y-3 flex-1 overflow-hidden flex flex-col min-h-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">
                    Parsed CSV Data Preview ({parsedCsvRows.length} Rows Found)
                  </span>
                  <div className="flex items-center space-x-3 text-[11px]">
                    <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                      ✓ Valid: {parsedCsvRows.filter((r) => r.isValid).length}
                    </span>
                    {parsedCsvRows.some((r) => !r.isValid) && (
                      <span className="text-red-400 font-bold bg-red-500/10 px-2 py-0.5 rounded border border-red-500/30">
                        ⚠ Errors: {parsedCsvRows.filter((r) => !r.isValid).length}
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-auto border border-neutral-800 rounded-xl max-h-60 bg-neutral-950">
                  <table className="w-full text-left text-xs text-neutral-300">
                    <thead className="bg-neutral-900 text-neutral-400 uppercase text-[10px] sticky top-0 border-b border-neutral-800">
                      <tr>
                        <th className="p-2.5">#</th>
                        <th className="p-2.5">Item Code</th>
                        <th className="p-2.5">Product Name</th>
                        <th className="p-2.5 text-center">Qty</th>
                        <th className="p-2.5">Customer &amp; Phone</th>
                        <th className="p-2.5">Address &amp; City</th>
                        <th className="p-2.5">Channel</th>
                        <th className="p-2.5 text-right">Total Price</th>
                        <th className="p-2.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800 font-sans">
                      {parsedCsvRows.map((row, idx) => (
                        <tr
                          key={idx}
                          className={row.isValid ? 'hover:bg-neutral-900/50' : 'bg-red-950/20 text-red-200'}
                        >
                          <td className="p-2.5 text-neutral-500 font-mono text-[10px]">{idx + 1}</td>
                          <td className="p-2.5 font-mono font-bold text-amber-400">{row.item_code}</td>
                          <td className="p-2.5">
                            {row.product ? (
                              <div className="flex items-center space-x-2">
                                <img
                                  src={row.product.images[0]}
                                  alt=""
                                  className="w-6 h-6 object-cover rounded border border-neutral-800"
                                />
                                <span className="font-semibold text-white truncate max-w-[140px]">
                                  {row.product.name_en}
                                </span>
                              </div>
                            ) : (
                              <span className="text-red-400 font-bold">Product Not Found</span>
                            )}
                          </td>
                          <td className="p-2.5 text-center font-bold text-white">{row.quantity}</td>
                          <td className="p-2.5">
                            <p className="font-bold text-white text-[11px]">{row.customer_name || 'N/A'}</p>
                            <p className="text-[10px] text-neutral-400 font-mono">{row.phone || 'N/A'}</p>
                          </td>
                          <td className="p-2.5 text-[11px] text-neutral-300 truncate max-w-[150px]">
                            {row.address}, {row.city}
                          </td>
                          <td className="p-2.5">
                            <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-[10px] font-semibold text-neutral-300">
                              {row.order_source}
                            </span>
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-emerald-400">
                            {row.product
                              ? `Rs. ${((row.product.discount_enabled !== false && row.product.discount_price && row.product.discount_price < row.product.selling_price ? row.product.discount_price : row.product.selling_price) * row.quantity + settings.delivery_fee).toLocaleString()}`
                              : '—'}
                          </td>
                          <td className="p-2.5 text-center">
                            {row.isValid ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Ready</span>
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-bold"
                                title={row.errorReason}
                              >
                                <AlertTriangle className="w-3 h-3" />
                                <span>{row.errorReason}</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Footer Action Buttons */}
            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-neutral-800">
              <button
                type="button"
                onClick={() => setIsBulkOrderOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-neutral-800 text-neutral-300 font-bold text-xs hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isImportingBulk || parsedCsvRows.filter((r) => r.isValid).length === 0}
                onClick={handleBulkImportSubmit}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 disabled:opacity-40 text-neutral-950 font-bold text-xs hover:bg-emerald-400 flex items-center space-x-2 transition-colors shadow-lg shadow-emerald-500/20"
              >
                {isImportingBulk ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Importing Orders &amp; Deducting Stock...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>
                      Import {parsedCsvRows.filter((r) => r.isValid).length} Valid Orders Now
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Manual FB / Phone Order Entry Modal */}
      {isManualOrderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-md bg-neutral-900 border border-amber-500/30 rounded-2xl p-6 space-y-4 my-auto">
            <button
              onClick={() => setIsManualOrderOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-neutral-950 text-neutral-400"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white">Manual Order Entry (FB / TikTok / Phone)</h3>
            <p className="text-xs text-neutral-400">
              Direct order entry that automatically deducts centralized stock.
            </p>

            <form onSubmit={handleManualOrderSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-neutral-300 mb-1">Order Channel Source</label>
                <select
                  value={manualOrderForm.order_source}
                  onChange={(e) => setManualOrderForm({ ...manualOrderForm, order_source: e.target.value as any })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                >
                  <option value="Facebook Ads">Facebook Ads</option>
                  <option value="TikTok Ads">TikTok Ads</option>
                  <option value="Manual Admin">Call Center / Phone</option>
                </select>
              </div>

              {/* Quick Item Code (SKU) Search for Call Center Staff */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-neutral-300">
                  <label className="font-semibold flex items-center space-x-1">
                    <Tag className="w-3.5 h-3.5 text-amber-400" />
                    <span>Quick Search by Item Code (SKU) or Name:</span>
                  </label>
                  {manualItemSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualItemSearch('');
                        if (products.length > 0) {
                          setManualOrderForm((prev) => ({
                            ...prev,
                            selected_product_id: products[0].id,
                          }));
                        }
                      }}
                      className="text-[10px] text-amber-400 underline"
                    >
                      Clear Search
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Type Item Code e.g. S0001 or name..."
                    value={manualItemSearch}
                    onChange={(e) => handleManualSearchInput(e.target.value)}
                    className="w-full bg-neutral-950 border border-amber-500/40 rounded-xl pl-8 pr-3 py-2 text-white font-mono text-xs focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Product Selector with Item Code */}
              <div>
                <label className="block text-neutral-300 mb-1 font-semibold">Select Product *</label>
                <select
                  value={selectedManualProduct?.id || manualOrderForm.selected_product_id}
                  onChange={(e) => setManualOrderForm({ ...manualOrderForm, selected_product_id: e.target.value, selected_variant_id: '' })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-mono"
                >
                  {filteredManualProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.sku}] {p.name_en} — Rs. {((p.discount_enabled !== false && p.discount_price && p.discount_price < p.selling_price ? p.discount_price : p.selling_price)).toLocaleString()} (In Stock: {p.stock_quantity})
                    </option>
                  ))}
                </select>
              </div>

              {selectedManualProduct && normalizedProductType(selectedManualProduct) === 'variant' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                  <label className="block text-xs font-black text-amber-300">Customer Color / Variant *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(selectedManualProduct.variants || []).filter(v=>v.status !== 'Draft').map(v => (
                      <button key={v.id} type="button" onClick={()=>setManualOrderForm(prev=>({...prev,selected_variant_id:v.id}))}
                        className={`rounded-xl border p-2 text-left ${manualOrderForm.selected_variant_id===v.id?'border-amber-400 bg-amber-500/15':'border-neutral-800 bg-neutral-950'}`}>
                        {v.image && <img src={v.image} alt="" className="mb-1 h-10 w-full rounded-lg object-cover" />}
                        <div className="font-bold text-white">{v.option_value}</div>
                        <div className="text-[10px] font-mono text-neutral-400">{v.sku}</div>
                        <div className="text-[10px] text-emerald-400">Rs. {displayUnitPrice(selectedManualProduct, settings, v).toLocaleString()} • Stock {v.stock_quantity}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected Item Preview Box */}
              {selectedManualProduct && (
                <div className="bg-neutral-950 p-2.5 rounded-xl border border-neutral-800 flex items-center space-x-3">
                  <img src={variantById(selectedManualProduct,manualOrderForm.selected_variant_id)?.image || selectedManualProduct.images[0]} alt="" className="w-12 h-12 object-cover rounded-lg border border-neutral-800 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[10px] font-bold border border-amber-500/30">
                        CODE: {variantById(selectedManualProduct,manualOrderForm.selected_variant_id)?.sku || selectedManualProduct.sku}
                      </span>
                      <span className="text-[10px] text-neutral-400 truncate capitalize">{selectedManualProduct.category_slug}</span>
                    </div>
                    <p className="font-bold text-white text-xs truncate mt-0.5">{selectedManualProduct.name_en}</p>
                    <p className="text-[10px] text-emerald-400 font-semibold">
                      Rs. {displayUnitPrice(selectedManualProduct, settings, variantById(selectedManualProduct,manualOrderForm.selected_variant_id)).toLocaleString()}{' '}
                      <span className="text-neutral-500 font-normal">| Stock: {(variantById(selectedManualProduct,manualOrderForm.selected_variant_id)?.stock_quantity ?? productDisplayStock(selectedManualProduct, products))} units</span>
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-300 mb-1">Customer Name *</label>
                  <input
                    type="text"
                    required
                    value={manualOrderForm.customer_name}
                    onChange={(e) => setManualOrderForm({ ...manualOrderForm, customer_name: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={manualOrderForm.phone}
                    onChange={(e) => setManualOrderForm({ ...manualOrderForm, phone: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-300 mb-1">Address *</label>
                  <input
                    type="text"
                    required
                    value={manualOrderForm.address}
                    onChange={(e) => setManualOrderForm({ ...manualOrderForm, address: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={manualOrderForm.city}
                    onChange={(e) => setManualOrderForm({ ...manualOrderForm, city: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs"
              >
                Submit & Deduct Stock
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Quick Stock Refill Modal */}
      {isPurchaseOpen && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                addPurchaseOrder({ ...purchaseForm, performed_by: adminUser?.name || 'Admin' });
                setIsPurchaseOpen(false);
              } catch (error) {
                alert(error instanceof Error ? error.message : 'Unable to save purchase.');
              }
            }}
            className="w-full max-w-xl bg-neutral-950 border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between"><div><h3 className="font-bold text-white">Add Purchase / Stock In</h3><p className="text-xs text-neutral-500">Saving this purchase automatically increases stock.</p></div><button type="button" onClick={() => setIsPurchaseOpen(false)} className="p-2 rounded-lg bg-neutral-900 text-neutral-400"><X className="w-4 h-4" /></button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-neutral-400 sm:col-span-2">Supplier Name<input required value={purchaseForm.supplier_name} onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier_name: e.target.value })} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white" /></label>
              <label className="text-xs text-neutral-400 sm:col-span-2">Product<div className="space-y-2">
              <label className="block text-xs font-bold text-neutral-300">Item Code</label>
              <input
                type="text"
                value={purchaseItemCode}
                onChange={(e)=>{
                  const code=e.target.value.toUpperCase().trim();
                  setPurchaseItemCode(code);
                  const product=products.find(p=>normalizedProductType(p)!=='bundle' && String(p.sku||'').toUpperCase()===code);
                  if(product){
                    setPurchaseForm(prev=>({
                      ...prev,
                      product_id:product.id,
                      variant_id:'',
                      unit_buying_price:Number(product.buying_price || prev.unit_buying_price || 0)
                    }));
                  }
                }}
                placeholder="S0001"
                className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-white"
              />
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-xs">
                {(()=>{
                  const p=products.find(x=>x.id===purchaseForm.product_id);
                  return p
                    ? <><span className="font-bold text-white">{p.name_en}</span><span className="ml-2 text-neutral-500">({p.sku})</span></>
                    : <span className="text-red-400">Enter a valid Item Code</span>;
                })()}
              </div>
            </div></label>
              {(()=>{ const p=products.find(x=>x.id===purchaseForm.product_id); return p && normalizedProductType(p)==='variant' ? (
                <label className="text-xs text-neutral-400 sm:col-span-2">Color / Variant *
                  <select required value={purchaseForm.variant_id} onChange={(e)=>{const v=variantById(p,e.target.value);setPurchaseForm(prev=>({...prev,variant_id:e.target.value,unit_buying_price:Number(v?.buying_price ?? prev.unit_buying_price)}));}} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white">
                    <option value="">Select exact variant...</option>{(p.variants||[]).map(v=><option key={v.id} value={v.id}>{v.option_value} — {v.sku} — Stock {v.stock_quantity}</option>)}
                  </select>
                </label>
              ) : null; })()}
              <label className="text-xs text-neutral-400">Quantity<input required min="1" type="number" value={purchaseForm.quantity_added} onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity_added: Number(e.target.value) })} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white" /></label>
              <label className="text-xs text-neutral-400">Unit Buying Price<input required min="0" type="number" value={purchaseForm.unit_buying_price} onChange={(e) => setPurchaseForm({ ...purchaseForm, unit_buying_price: Number(e.target.value) })} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white" /></label>
              <label className="text-xs text-neutral-400">Supplier Invoice Ref<input value={purchaseForm.invoice_ref} onChange={(e) => setPurchaseForm({ ...purchaseForm, invoice_ref: e.target.value })} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white" /></label>
              <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3"><p className="text-[10px] text-neutral-500">TOTAL PURCHASE COST</p><p className="font-bold text-amber-400">Rs. {(purchaseForm.quantity_added * purchaseForm.unit_buying_price).toLocaleString()}</p></div>
              <label className="text-xs text-neutral-400 sm:col-span-2">Notes<textarea value={purchaseForm.notes} onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white min-h-20" /></label>
            </div>
            <button type="submit" className="w-full py-3 rounded-xl bg-amber-500 text-neutral-950 font-bold">Save Purchase & Increase Stock</button>
          </form>
        </div>
      )}

      {stockAdjustModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-md">
          <div className="relative w-full max-w-sm bg-neutral-900 border border-amber-500/30 rounded-2xl p-6 space-y-4">
            <button
              onClick={() => { setStockAdjustModalProduct(null); setStockAdjustVariantId(''); }}
              className="absolute top-4 right-4 p-2 rounded-full bg-neutral-950 text-neutral-400"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white">Refill Inventory Stock</h3>
            <p className="text-xs text-neutral-400">{stockAdjustModalProduct.name_en}</p>

            <form onSubmit={handleStockAdjustSubmit} className="space-y-3 text-xs">
              {normalizedProductType(stockAdjustModalProduct)==='variant' && (
                <div>
                  <label className="block text-neutral-300 mb-1">Color / Variant *</label>
                  <select required value={stockAdjustVariantId} onChange={(e)=>setStockAdjustVariantId(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white">
                    <option value="">Select exact variant...</option>{(stockAdjustModalProduct.variants||[]).map(v=><option key={v.id} value={v.id}>{v.option_value} — {v.sku} — Stock {v.stock_quantity}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-neutral-300 mb-1">Quantity Change (+ / -)</label>
                <input
                  type="number"
                  required
                  value={stockChangeQty}
                  onChange={(e) => setStockChangeQty(Number(e.target.value))}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-neutral-300 mb-1">Reason / Note</label>
                <input
                  type="text"
                  required
                  value={stockReason}
                  onChange={(e) => setStockReason(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs"
              >
                Update Stock Quantity
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
