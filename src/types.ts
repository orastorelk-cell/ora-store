export type Language = 'en' | 'si';

export interface Category {
  id: string;
  name_en: string;
  name_si: string;
  slug: string;
  icon: string;
  /** Optional SKU prefix. First product can set this manually; later products auto-increment it. */
  code_prefix?: string;
}

export type ProductStatus = 'Active' | 'Draft' | 'Out of Stock';
export type ProductType = 'normal' | 'variant' | 'bundle';

export interface ProductSpecification {
  id: string;
  label: string;
  value: string;
  unit?: string;
}

/** Optional bilingual eBay-style item facts. These are separate from size/measurement details. */
export interface ProductItemDetail {
  id: string;
  label_en: string;
  label_si?: string;
  value_en: string;
  value_si?: string;
}

export interface ProductVariantOption {
  name: string;
  value: string;
}

export interface ProductVariant {
  id: string;
  sku: string;
  option_name?: string;
  option_value: string;
  /** Multiple option dimensions for one exact SKU, e.g. Color=Blue + Size=XL. Legacy fields above stay populated for compatibility. */
  options?: ProductVariantOption[];
  image?: string;
  buying_price: number;
  selling_price: number;
  discount_price?: number;
  discount_enabled?: boolean;
  /** Optional cheaper supplier cost used only while the saved special offer is active. */
  offer_buying_price?: number;
  /** True only when the saved supplier-saving offer is active. */
  supplier_offer_enabled?: boolean;
  supplier_offer_saved_at?: string;
  /** Recalculate price from buying cost when new purchases change cost. */
  auto_price_enabled?: boolean;
  /** When auto price falls, keep old regular price and show the new lower price as an offer. */
  auto_discount_on_cost_drop?: boolean;
  price_history?: {
    changed_at: string;
    reason: string;
    buying_price: number;
    selling_price: number;
    discount_price?: number;
    discount_enabled?: boolean;
  }[];
  stock_quantity: number;
  status: ProductStatus;
}

export interface BundleComponent {
  product_id: string;
  variant_id?: string;
  quantity: number;
}

export interface Product {
  id: string;
  sku: string;
  name_en: string;
  name_si: string;
  description_en: string;
  description_si: string;
  brand?: string;
  search_keywords?: string;
  /** Internal sourcing reference only. Never used for purchasing/profit calculations. */
  source_shop_name?: string;
  /** Price seen at the reference shop. Internal note only; does not affect buying price. */
  source_shop_price?: number;
  category_id: string;
  category_slug: string;
  images: string[];
  buying_price: number;
  selling_price: number;
  discount_price?: number;
  discount_enabled?: boolean;
  /** Optional cheaper supplier cost used only while the saved special offer is active. */
  offer_buying_price?: number;
  /** True only when the saved supplier-saving offer is active. */
  supplier_offer_enabled?: boolean;
  supplier_offer_saved_at?: string;
  /** Recalculate price from buying cost when new purchases change cost. */
  auto_price_enabled?: boolean;
  /** When auto price falls, keep old regular price and show the new lower price as an offer. */
  auto_discount_on_cost_drop?: boolean;
  price_history?: {
    changed_at: string;
    reason: string;
    buying_price: number;
    selling_price: number;
    discount_price?: number;
    discount_enabled?: boolean;
  }[];
  stock_quantity: number;
  status: ProductStatus;
  product_type?: ProductType;
  variants?: ProductVariant[];
  bundle_components?: BundleComponent[];
  /** Combo price was generated from current customer-visible component prices minus the saved combo discount. */
  bundle_auto_price?: boolean;
  /** Discount taken once from the summed customer-visible component prices (default Rs.50). */
  bundle_discount_amount?: number;
  /** Flexible customer-facing size/measurement details such as Size, Length, Width or Capacity. */
  specifications?: ProductSpecification[];
  /** Optional bilingual item facts such as Model, Type, Condition, Warranty or Country of Origin. */
  item_details?: ProductItemDetail[];
  is_test_product?: boolean;
  is_featured?: boolean;
  is_latest?: boolean;
  created_at?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  variant?: ProductVariant;
  line_id?: string;
}

export type PaymentMethod = 'COD' | 'Bank Payment';

export type OrderStatus =
  | 'New Orders'
  | 'Pending Payment'
  | 'Processing'
  | 'Packed'
  | 'Shipped'
  | 'Delivered'
  | 'Cancelled';

export type OrderSource = 'Website' | 'Facebook Ads' | 'TikTok Ads' | 'Manual Admin';

export interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  district?: string;
  fardar_city?: string;
  city_verified?: boolean;
  city_mapping_source?: 'exact' | 'saved_mapping' | 'manual';
  payment_method: PaymentMethod;
  payment_status: 'Pending' | 'Paid' | 'Refunded';
  order_status: OrderStatus;
  items: {
    product_id: string;
    product_name: string;
    sku: string;
    main_sku?: string;
    variant_id?: string;
    variant_name?: string;
    product_type?: ProductType;
    bundle_components?: {
      product_id: string;
      variant_id?: string;
      sku: string;
      product_name: string;
      variant_name?: string;
      quantity_per_bundle: number;
    }[];
    buying_price: number;
    /** Normal customer unit price snapshot before any saved supplier offer. */
    regular_unit_price?: number;
    /** Supplier-saving discount per unit snapshot, before the existing quantity offer. */
    supplier_offer_discount_per_unit?: number;
    /** Buying-cost snapshot actually expected for this order (offer cost when an offer is active). */
    effective_buying_price?: number;
    unit_price: number;
    quantity: number;
    subtotal: number;
    image?: string;
    /** Short snapshot of static product specifications for history/invoice-safe records. */
    specification_summary?: string;
  }[];
  subtotal: number;
  delivery_fee: number;
  internal_delivery_fee?: number;
  delivery_included_in_item_price?: boolean;
  special_offer_discount?: number;
  call_center_status?: 'Pending' | 'Confirmed' | 'No Answer' | 'Cancelled' | 'Reschedule';
  call_center_updated_at?: string;
  cancelled_at?: string;
  cancelled_by?: string;
  cancel_reason?: string;
  product_change_history?: {
    changed_at: string;
    changed_by: string;
    old_items: { sku: string; product_name: string; variant_name?: string; quantity: number; unit_price: number }[];
    new_items: { sku: string; product_name: string; variant_name?: string; quantity: number; unit_price: number }[];
    reason?: string;
  }[];
  gift_wrap_selected?: boolean;
  gift_wrap_fee?: number;
  total_amount: number;
  is_advance_required: boolean;
  advance_amount: number;
  advance_confirmed: boolean;
  order_source: OrderSource;
  is_synced_google_sheets: boolean;
  synced_at?: string;
  bank_receipt_url?: string;
  payment_verification_status?: PaymentVerificationStatus;
  payment_detected_bank?: string;
  payment_detected_amount?: number;
  payment_received_amount?: number;
  payment_reference?: string;
  payment_account_match?: boolean;
  payment_amount_match?: boolean;
  payment_receipt_like?: boolean;
  payment_ocr_confidence?: number;
  payment_check_notes?: string;
  payment_reviewed_by?: string;
  payment_reviewed_at?: string;
  assistant_payment_submitted_at?: string;
  payment_paid_type?: 'Advance' | 'Full' | 'COD';
  customer_auth_id?: string;
  customer_email?: string;
  cod_payment_received?: boolean;
  cod_payment_amount?: number;
  cod_payment_received_at?: string;
  cod_payment_source?: 'Fardar CSV' | 'Manual' | 'System';
  cod_payment_reference?: string;
  courier_name?: string;
  waybill_number?: string;
  tracking_status?: string;
  delivery_status?: string;
  shipment_mode?: CourierShipmentMode;
  stock_status?: 'Waiting for Stock' | 'Allocated';
  stock_allocated?: boolean;
  stock_allocated_at?: string;
  stock_allocated_by?: string;
  is_duplicate_order?: boolean;
  duplicate_of_order_id?: string;
  duplicate_fingerprint?: string;
  invoice_number?: string;
  invoice_generated_at?: string;
  invoice_generated_by?: string;
  invoice_locked?: boolean;
  invoice_pack_batch_id?: string;
  invoice_pack_downloaded_at?: string;
  invoice_pack_downloaded_by?: string;
  invoice_pack_download_set_date?: string;
  invoice_pack_download_set_number?: number;
  invoice_payment_label_snapshot?: string;
  invoice_advance_percentage_snapshot?: number;
  return_status?: 'None' | 'Pending Verification' | 'Verified' | 'Issue Found';
  return_received_at?: string;
  return_checked_by?: string;
  dispatch_status?: 'Not Scanned' | 'Handed Over';
  dispatch_scanned_at?: string;
  dispatch_scanned_by?: string;
  fardar_tracking_updated_at?: string;
  fardar_tracking_history?: { status: string; at: string; note?: string }[];
  notes?: string;
  created_at: string;
  risk_status?: 'Normal' | 'Suspicious' | 'Blocked';
  abuse_note?: string;
  is_test_order?: boolean;
  platform_lead_id?: string;
  platform_lead_created_at?: string;
  lead_import_key?: string;
  lead_imported_at?: string;
}


export interface Customer {
  id: string;
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  total_orders: number;
  total_spent: number;
  created_at: string;
}

export interface StockHistory {
  id: string;
  product_id: string;
  product_name: string;
  change_type: 'Increase' | 'Decrease' | 'Order Deduction' | 'Adjustment' | 'Purchase Inflow';
  quantity: number;
  previous_stock: number;
  new_stock: number;
  reason: string;
  performed_by: string;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_name: string;
  product_id: string;
  product_name: string;
  sku: string;
  variant_id?: string;
  variant_name?: string;
  variant_sku?: string;
  quantity_added: number;
  unit_buying_price: number;
  total_cost: number;
  invoice_ref?: string;
  notes?: string;
  performed_by: string;
  created_at: string;
}

export interface HeroBannerSlide {
  id: string;
  type: 'custom' | 'product';
  enabled: boolean;
  order: number;
  image?: string;
  product_id?: string;
  tag_en?: string;
  tag_si?: string;
  title_en?: string;
  title_si?: string;
  sub_en?: string;
  sub_si?: string;
  button_en?: string;
  button_si?: string;
  link_type?: 'products' | 'category' | 'product' | 'url';
  link_value?: string;
}

export interface StoreSettings {
  delivery_fee: number;
  free_delivery_enabled?: boolean;
  multi_buy_discount_enabled?: boolean;
  multi_buy_tier1_min?: number;
  multi_buy_tier1_max?: number;
  multi_buy_tier1_rate?: number;
  multi_buy_tier2_min?: number;
  multi_buy_tier2_max?: number;
  multi_buy_tier2_rate?: number;
  multi_buy_tier3_min?: number;
  multi_buy_tier3_max?: number;
  multi_buy_tier3_rate?: number;
  gift_wrap_enabled?: boolean;
  gift_wrap_fee?: number;
  advance_qty_threshold: number;
  advance_percentage: number;
  bank_name: string;
  bank_account_holder: string;
  bank_account_number: string;
  bank_branch: string;
  bank_details_saved?: boolean;
  whatsapp_number: string;
  hotline_number?: string;
  company_email?: string;
  company_address?: string;

  // Public Website Information / Legal Pages
  about_page_enabled?: boolean;
  return_policy_page_enabled?: boolean;
  contact_page_enabled?: boolean;
  privacy_page_enabled?: boolean;
  terms_page_enabled?: boolean;
  website_info_last_updated?: string;
  about_page_en?: string;
  about_page_si?: string;
  return_policy_en?: string;
  return_policy_si?: string;
  contact_intro_en?: string;
  contact_intro_si?: string;
  privacy_policy_en?: string;
  privacy_policy_si?: string;
  terms_conditions_en?: string;
  terms_conditions_si?: string;
  business_registration_enabled?: boolean;
  business_registration_name?: string;
  business_registration_number?: string;
  business_registration_copy_url?: string;
  google_sheet_webhook_url: string;
  admin_secret_path?: string;
  maintenance_mode?: boolean;
  maintenance_message?: string;
  fardar_parcel_type?: string;
  courier_provider?: string;
  fardar_api_url?: string;
  fardar_account_id?: string;
  courier_api_enabled?: boolean;
  courier_mode?: 'manual' | 'api' | 'auto';
  
  // Announcement Top Bar Settings
  top_announcement_en?: string;
  top_announcement_si?: string;
  top_banner_phone?: string;
  top_banner_active?: boolean;

  // Hero Promotional Banner Settings
  hero_banner_tag_en?: string;
  hero_banner_tag_si?: string;
  hero_banner_title_en?: string;
  hero_banner_title_si?: string;
  hero_banner_sub_en?: string;
  hero_banner_sub_si?: string;
  hero_banner_image?: string;
  hero_banner_button_en?: string;
  hero_banner_button_si?: string;
  hero_banners?: HeroBannerSlide[];

  // Branding & Logo Studio
  brand_store_name?: string;
  brand_tagline?: string;
  brand_primary_color?: string;
  brand_secondary_color?: string;
  website_logo?: string;
  mobile_logo?: string;
  favicon_logo?: string;
  invoice_logo?: string;
  black_logo?: string;
  white_logo?: string;
  desktop_logo_width?: number;
  mobile_logo_width?: number;
  mobile_logo_max_height?: number;

  // A6 Invoice Design Studio
  invoice_custom_fonts_json?: string;
  invoice_text_styles_json?: string;
  invoice_text_content_json?: string;
  invoice_icon_call_size?: number;
  invoice_icon_call_x?: number;
  invoice_icon_call_y?: number;
  invoice_icon_call_image?: string;
  invoice_icon_location_size?: number;
  invoice_icon_location_x?: number;
  invoice_icon_location_y?: number;
  invoice_icon_location_image?: string;
  invoice_icon_whatsapp_size?: number;
  invoice_icon_whatsapp_x?: number;
  invoice_icon_whatsapp_y?: number;
  invoice_icon_whatsapp_image?: string;
  invoice_icon_facebook_size?: number;
  invoice_icon_facebook_x?: number;
  invoice_icon_facebook_y?: number;
  invoice_icon_facebook_image?: string;
  invoice_icon_web_size?: number;
  invoice_icon_web_x?: number;
  invoice_icon_web_y?: number;
  invoice_icon_web_image?: string;
  invoice_font_company_family?: string;
  invoice_font_company_size?: number;
  invoice_font_company_weight?: number;
  invoice_font_company_spacing?: number;
  invoice_font_heading_family?: string;
  invoice_font_heading_size?: number;
  invoice_font_heading_weight?: number;
  invoice_font_heading_spacing?: number;
  invoice_font_labels_family?: string;
  invoice_font_labels_size?: number;
  invoice_font_labels_weight?: number;
  invoice_font_labels_spacing?: number;
  invoice_font_values_family?: string;
  invoice_font_values_size?: number;
  invoice_font_values_weight?: number;
  invoice_font_values_spacing?: number;
  invoice_font_table_family?: string;
  invoice_font_table_size?: number;
  invoice_font_table_weight?: number;
  invoice_font_table_spacing?: number;
  invoice_font_totals_family?: string;
  invoice_font_totals_size?: number;
  invoice_font_totals_weight?: number;
  invoice_font_totals_spacing?: number;
  invoice_font_notice_family?: string;
  invoice_font_notice_size?: number;
  invoice_font_notice_weight?: number;
  invoice_font_notice_spacing?: number;
  invoice_font_footer_family?: string;
  invoice_font_footer_size?: number;
  invoice_font_footer_weight?: number;
  invoice_font_footer_spacing?: number;
  invoice_logo_width?: number;
  invoice_logo_height?: number;
  invoice_logo_scale?: number;
  invoice_logo_x?: number;
  invoice_logo_y?: number;
  invoice_logo_align?: 'left' | 'center' | 'right';
  invoice_header_height?: number;
  invoice_header_font_size?: number;
  invoice_customer_font_size?: number;
  invoice_item_font_size?: number;
  invoice_row_height?: number;
  invoice_barcode_width?: number;
  invoice_barcode_height?: number;
  invoice_waybill_font_size?: number;
  invoice_total_font_size?: number;
  invoice_margin?: number;
  invoice_border_enabled?: boolean;
  invoice_compact_mode?: boolean;
  invoice_footer_text?: string;
  invoice_company_address?: string;
  invoice_website_url?: string;
}

export type AdminRole = 'admin' | 'staff';

export type AdminPermission =
  | 'overview'
  | 'add_product'
  | 'combo_packs'
  | 'supplier_offer'
  | 'banners'
  | 'notifications'
  | 'products'
  | 'stock'
  | 'orders'
  | 'out_of_stock'
  | 'returns'
  | 'lead_import'
  | 'confirm_upload'
  | 'invoices'
  | 'packing'
  | 'invoice_design'
  | 'delivery'
  | 'dispatch'
  | 'cod_payments'
  | 'bank_transfer_check'
  | 'assistant_chats'
  | 'complaints'
  | 'reports'
  | 'reviews'
  | 'product_requests'
  | 'sheets'
  | 'customers'
  | 'categories'
  | 'activity'
  | 'branding'
  | 'website_info'
  | 'settings'
  | 'deploy'
  | 'user_access';

export type PaymentVerificationStatus = 'Not Required' | 'Awaiting Receipt' | 'Auto Check Passed' | 'Needs Review' | 'Rejected' | 'Approved';

export type CourierShipmentMode = 'manual' | 'api';
export type WaybillStatus = 'Available' | 'Assigned' | 'Used' | 'Cancelled';

export interface AdminUser {
  id: string;
  username: string;
  password?: string;
  name: string;
  email: string;
  role: AdminRole;
  permissions?: string[];
  is_active?: boolean;
  created_at?: string;
}

export interface BlockedCustomer {
  id: string;
  phone: string;
  whatsapp?: string;
  reason: string;
  created_at: string;
  created_by?: string;
}


export interface ReturnRecord {
  id: string;
  order_id: string;
  order_number: string;
  waybill_number: string;
  checked_by: string;
  checked_at: string;
  status: 'Verified' | 'Issue Found';
  items: {
    product_id: string;
    sku: string;
    product_name: string;
    variant_id?: string;
    variant_name?: string;
    expected_qty: number;
    good_qty: number;
    missing_qty: number;
    damaged_qty: number;
  }[];
  wrong_item_note?: string;
  notes?: string;
}

export interface ActivityLog {
  id: string;
  actor_id?: string;
  actor_name: string;
  actor_username?: string;
  actor_role?: AdminRole | 'customer' | 'system';
  action: string;
  module: string;
  target_id?: string;
  target_label?: string;
  details?: string;
  created_at: string;
}


export interface FardarCity {
  name: string;
  code?: string;
}

export interface FardarCityMapping {
  input_city: string;
  fardar_city: string;
}

export interface WaybillRecord {
  id: string;
  waybill_number: string;
  courier_name: string;
  status: WaybillStatus;
  assigned_order_id?: string;
  assigned_order_number?: string;
  imported_at: string;
  assigned_at?: string;
}



export type ReviewStatus = 'Pending' | 'Approved' | 'Rejected';

export interface CustomerReview {
  id: string;
  product_id: string;
  product_name: string;
  customer_name: string;
  rating: number;
  review_text: string;
  image_url?: string;
  customer_auth_id?: string;
  status: ReviewStatus;
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
}

export type ProductRequestStatus = 'New' | 'Reviewed' | 'Planned' | 'Added' | 'Rejected';

export interface ProductRequest {
  id: string;
  customer_auth_id?: string;
  customer_name?: string;
  contact?: string;
  product_name: string;
  description?: string;
  product_link?: string;
  expected_price?: number;
  reference_image_url?: string;
  status: ProductRequestStatus;
  created_at: string;
  updated_at?: string;
}

export interface CustomerProfile {
  user_id: string;
  email: string;
  real_name: string;
  phone: string;
  whatsapp?: string;
  address?: string;
  city?: string;
  created_at?: string;
  updated_at?: string;
}
