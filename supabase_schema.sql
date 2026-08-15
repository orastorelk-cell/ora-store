-- ============================================================
-- O-RA ONLINE STORE - SUPABASE DATABASE SCHEMA
-- Free Tier PostgreSQL Database Setup
-- Run this script in the Supabase SQL Editor
-- ============================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_en VARCHAR(100) NOT NULL,
    name_si VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    icon VARCHAR(50) DEFAULT 'Tag',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Products Table
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(50) UNIQUE NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_si VARCHAR(255) NOT NULL,
    description_en TEXT,
    description_si TEXT,
    brand VARCHAR(150),
    search_keywords TEXT,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    category_slug VARCHAR(100),
    images TEXT[] DEFAULT '{}',
    buying_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price NUMERIC(12,2) NOT NULL,
    discount_price NUMERIC(12,2) DEFAULT NULL,
    discount_enabled BOOLEAN DEFAULT false,
    stock_quantity INT NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Draft', 'Out of Stock')),
    is_featured BOOLEAN DEFAULT false,
    is_latest BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(50) UNIQUE NOT NULL, -- e.g., ORA-00001
    customer_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    whatsapp VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('COD', 'Bank Payment')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Pending', 'Paid', 'Refunded')),
    order_status VARCHAR(30) NOT NULL DEFAULT 'New Orders' CHECK (order_status IN ('New Orders', 'Pending Payment', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Cancelled')),
    subtotal NUMERIC(12,2) NOT NULL,
    delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 500,
    total_amount NUMERIC(12,2) NOT NULL,
    is_advance_required BOOLEAN DEFAULT false,
    advance_amount NUMERIC(12,2) DEFAULT 0,
    advance_confirmed BOOLEAN DEFAULT false,
    order_source VARCHAR(30) DEFAULT 'Website' CHECK (order_source IN ('Website', 'Facebook Ads', 'TikTok Ads', 'Manual Admin')),
    is_synced_google_sheets BOOLEAN DEFAULT false,
    synced_at TIMESTAMP WITH TIME ZONE,
    bank_receipt_url TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Order Items Table
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,
    sku VARCHAR(50),
    buying_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_price NUMERIC(12,2) NOT NULL,
    quantity INT NOT NULL,
    subtotal NUMERIC(12,2) NOT NULL
);

-- 6. Customers Table
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    whatsapp VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    total_orders INT DEFAULT 0,
    total_spent NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Stock History Log
CREATE TABLE IF NOT EXISTS public.stock_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('Increase', 'Decrease', 'Order Deduction', 'Adjustment', 'Purchase Inflow')),
    quantity INT NOT NULL,
    previous_stock INT NOT NULL,
    new_stock INT NOT NULL,
    reason VARCHAR(255),
    performed_by VARCHAR(100) DEFAULT 'System',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);


-- 7B. Purchase Orders / Stock In
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_name VARCHAR(180) NOT NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,
    sku VARCHAR(50),
    quantity_added INT NOT NULL CHECK (quantity_added > 0),
    unit_buying_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    invoice_ref VARCHAR(120),
    notes TEXT,
    performed_by VARCHAR(100) DEFAULT 'Admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Store Settings
CREATE TABLE IF NOT EXISTS public.store_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    delivery_fee NUMERIC(12,2) DEFAULT 500,
    advance_qty_threshold INTEGER DEFAULT 4,
    advance_percentage NUMERIC(5,2) DEFAULT 50,
    bank_name VARCHAR(100) DEFAULT 'Commercial Bank of Ceylon',
    bank_account_holder VARCHAR(150) DEFAULT 'O-RA ONLINE STORE (PVT) LTD',
    bank_account_number VARCHAR(50) DEFAULT '1000 4829 3921',
    bank_branch VARCHAR(100) DEFAULT 'Colombo Main Branch',
    whatsapp_number VARCHAR(20) DEFAULT '+94771234567',
    google_sheet_webhook_url TEXT DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Initial Store Settings
INSERT INTO public.store_settings (id, delivery_fee, advance_qty_threshold, advance_percentage, bank_name, bank_account_holder, bank_account_number, bank_branch, whatsapp_number)
VALUES ('default', 500, 4, 50, 'Commercial Bank of Ceylon', 'O-RA ONLINE STORE (PVT) LTD', '1000 4829 3921', 'Colombo Main Branch', '+94771234567')
ON CONFLICT (id) DO NOTHING;

-- Security Policies (Row Level Security)
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Allow Public Read Access for Shopping
CREATE POLICY "Public Read Categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Public Read Active Products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Public Create Orders" ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Create Order Items" ON public.order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Read Orders By Number" ON public.orders FOR SELECT USING (true);

-- ============================================================
-- UPDATE 02: USER ACCESS + PAYMENT REVIEW + FARDAR WAYBILLS
-- Safe to run after the base schema. Uses IF NOT EXISTS.
-- ============================================================

-- Role-based admin/staff accounts (future Supabase Auth ready)
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID UNIQUE,
    username VARCHAR(80) UNIQUE NOT NULL,
    display_name VARCHAR(150) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(30) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','order_manager','stock_manager','call_center','viewer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Payment verification / manual approval audit fields
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_verification_status VARCHAR(30) DEFAULT 'Not Required';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_detected_bank VARCHAR(120);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_detected_amount NUMERIC(12,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(150);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_check_notes TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_reviewed_by VARCHAR(150);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_reviewed_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_orders_payment_reference ON public.orders(payment_reference);

-- Courier / Fardar fields on orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS courier_name VARCHAR(100) DEFAULT 'Fardar';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS waybill_number VARCHAR(150);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_status VARCHAR(120) DEFAULT 'Not Shipped';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(120) DEFAULT 'Pending';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipment_mode VARCHAR(20) CHECK (shipment_mode IS NULL OR shipment_mode IN ('manual','api'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_waybill_unique ON public.orders(waybill_number) WHERE waybill_number IS NOT NULL;

-- CSV/API hybrid waybill pool
CREATE TABLE IF NOT EXISTS public.courier_waybills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    waybill_number VARCHAR(150) UNIQUE NOT NULL,
    courier_name VARCHAR(100) NOT NULL DEFAULT 'Fardar',
    status VARCHAR(20) NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Assigned','Used','Cancelled')),
    assigned_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    assigned_order_number VARCHAR(50),
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_waybills_status_courier ON public.courier_waybills(status, courier_name);

-- Courier settings (API can be filled in later)
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS courier_provider VARCHAR(100) DEFAULT 'Fardar';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS fardar_api_url TEXT DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS fardar_account_id VARCHAR(150) DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS courier_api_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS courier_mode VARCHAR(20) DEFAULT 'manual';

-- RLS for new future-ready tables. Keep write access restricted in production.
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_waybills ENABLE ROW LEVEL SECURITY;

-- Configurable advance-payment rule (safe for existing databases)
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS advance_qty_threshold INTEGER DEFAULT 4;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS advance_percentage NUMERIC(5,2) DEFAULT 50;

-- O-RA Fake Order Protection (future/live Supabase persistence)
create table if not exists blocked_customers (
  id text primary key,
  phone text not null unique,
  whatsapp text,
  reason text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_blocked_customers_phone on blocked_customers(phone);

create table if not exists order_abuse_events (
  id bigint generated by default as identity primary key,
  ip_hash text,
  phone_hash text,
  event_type text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_abuse_ip_created on order_abuse_events(ip_hash, created_at desc);

-- ============================================================
-- UPDATE 02.5: SYSTEM ACTIVITY / AUDIT TRAIL
-- ============================================================
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_name VARCHAR(150) NOT NULL,
    actor_username VARCHAR(100),
    actor_role VARCHAR(40),
    action VARCHAR(150) NOT NULL,
    module VARCHAR(100) NOT NULL,
    target_id TEXT,
    target_label TEXT,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON public.activity_logs(actor_username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_module ON public.activity_logs(module, created_at DESC);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;


-- O-RA Smart Search migration (safe for existing databases)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand VARCHAR(150);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_keywords TEXT;
CREATE INDEX IF NOT EXISTS idx_products_category_slug ON public.products(category_slug);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);


-- O-RA Update 02.6.10: separate company contact details
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS hotline_number VARCHAR(30) DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS company_email VARCHAR(255) DEFAULT '';


-- Discount toggle migration for existing databases
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS discount_enabled BOOLEAN DEFAULT false;

-- ============================================================
-- UPDATE 02.7: STOCK ALLOCATION + A5 INVOICE LOCK + DISPATCH SCAN + CUSTOM ACCESS
-- ============================================================

-- Orders wait for physical stock. Stock is deducted only when the whole order can be allocated.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_status VARCHAR(30) DEFAULT 'Waiting for Stock';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_allocated BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_allocated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_allocated_by VARCHAR(150);

-- Duplicate protection / invoice lock
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_duplicate_order BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS duplicate_of_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS duplicate_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_duplicate_fingerprint ON public.orders(duplicate_fingerprint, created_at DESC);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(80);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_generated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_generated_by VARCHAR(150);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_locked BOOLEAN DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number_unique ON public.orders(invoice_number) WHERE invoice_number IS NOT NULL;

-- Dispatch / handover evidence
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatch_status VARCHAR(30) DEFAULT 'Not Scanned';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatch_scanned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatch_scanned_by VARCHAR(150);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS fardar_tracking_updated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS fardar_tracking_history JSONB DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_orders_dispatch_status ON public.orders(dispatch_status, dispatch_scanned_at DESC);

-- Flexible per-user module permissions. Super Admin remains full access.
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admin_users_role_check'
      AND conrelid = 'public.admin_users'::regclass
  ) THEN
    ALTER TABLE public.admin_users DROP CONSTRAINT admin_users_role_check;
  END IF;
END $$;
UPDATE public.admin_users SET role = 'staff' WHERE role NOT IN ('admin','staff');
ALTER TABLE public.admin_users ALTER COLUMN role SET DEFAULT 'staff';
ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN ('admin','staff'));

-- Optional normalized dispatch evidence table for future Supabase live use.
CREATE TABLE IF NOT EXISTS public.dispatch_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    order_number VARCHAR(50) NOT NULL,
    waybill_number VARCHAR(150) NOT NULL,
    event_type VARCHAR(40) NOT NULL DEFAULT 'Courier Handover',
    scanned_by VARCHAR(150),
    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_dispatch_waybill_time ON public.dispatch_events(waybill_number, scanned_at DESC);
ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- UPDATE 02.7.2: SHARED STAFF LOGIN
-- ============================================================
-- Passwords are stored as salted scrypt hashes by the server API.
-- The service-role key is used only in server.ts and must never be exposed to browser code.
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username_lower ON public.admin_users (lower(username));

-- ============================================================
-- UPDATE 02.7.4: FARDAR OFFICIAL CITY LIST + SAVED CITY MAPPINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fardar_cities (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fardar_cities_name_lower ON public.fardar_cities (lower(name));

CREATE TABLE IF NOT EXISTS public.fardar_city_mappings (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    input_key TEXT NOT NULL UNIQUE,
    input_city TEXT NOT NULL,
    fardar_city TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS fardar_city TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS city_verified BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS city_mapping_source TEXT;


-- O-RA durable full-order snapshot store (used by Website -> Admin reliability flow)
CREATE TABLE IF NOT EXISTS public.order_snapshots (
    order_id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_order_snapshots_created_at ON public.order_snapshots(created_at DESC);

-- ============================================================
-- UPDATE 03: CUSTOMER ACCOUNTS, REVIEWS, PRODUCT DEMAND + REPORT STORE
-- Run this block once in Supabase SQL Editor for the new storefront features.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.customer_reviews (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text TEXT NOT NULL,
    image_url TEXT,
    customer_auth_id UUID,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_reviews_product_status ON public.customer_reviews(product_id, status, created_at DESC);
ALTER TABLE public.customer_reviews ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.product_requests (
    id TEXT PRIMARY KEY,
    customer_auth_id UUID,
    customer_name TEXT,
    contact TEXT,
    product_name TEXT NOT NULL,
    description TEXT,
    product_link TEXT,
    expected_price NUMERIC(12,2),
    reference_image_url TEXT,
    status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New','Reviewed','Planned','Added','Rejected')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_product_requests_status_created ON public.product_requests(status, created_at DESC);
ALTER TABLE public.product_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.customer_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    real_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    whatsapp TEXT,
    address TEXT,
    city TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_phone ON public.customer_profiles(phone);
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_data_store (
    key TEXT PRIMARY KEY,
    payload JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.admin_data_store ENABLE ROW LEVEL SECURITY;

-- Browser users never write these tables directly in this build; the O-RA server
-- uses the Supabase service-role key after validating the request. RLS therefore
-- stays enabled without public write policies.

-- ============================================================
-- FRESH LIVE STOREFRONT SEED (safe: only inserts when the key is absent)
-- ============================================================
INSERT INTO public.admin_data_store (key, payload, updated_at)
VALUES (
  'storefront-state-v1',
  $ora_storefront${"version":30,"updated_at":"2026-08-14T19:37:58.000Z","products":[{"sku":"CB-S0001-S0007","name_en":"O-RA Pro Sound Active + O-RA Pods Pro True Combo Pack","name_si":"O-RA Pro Sound Active + O-RA Pods Pro කොම්බො පැක්","description_en":"O-RA Pro Sound Active + O-RA Pods Pro True Combo Pack\n\nUpgrade your audio experience with the ultimate wireless sound bundle. The O-RA Combo Pack combines high-fidelity, immersive audio for home and travel with crystal-clear call performance on the go.\n\nKey Features:\n\n• O-RA Pro Sound Active Wireless Headphones: Experience studio-grade sound driven by Hybrid Active Noise Cancellation (ANC). Designed for long-listening comfort with ultra-soft memory foam earcups, seamless Bluetooth 5.3 connectivity, and a massive 40-hour battery stamina.\n\n• O-RA Pods Pro True Wireless Earbuds: Engineered for daily hustle and active lifestyles. Features Environmental Noise Cancellation (ENC) for ultra-clear phone calls, IPX5 waterproof protection against sweat and rain, and up to 30 hours of total playback with a convenient LED battery display.\n\nWhether you need deep focus, studio-quality music, or seamless daily calls, this combo pack delivers unmatched performance, durability, and convenience in one package.","description_si":"O-RA Pro Sound Active + O-RA Pods Pro කොම්බො පැක්\n\nඔබගේ ශ්‍රව්‍ය (Audio) අත්දැකීම ඉහළම මට්ටමකට ගෙන යාම සඳහා විශේෂයෙන් නිර්මාණය කරන ලද සුපිරි Wireless Combo Pack එක. ගමනක් බිමනක් යන විට මෙන්ම නිවසේදී භාවිතයටත්, පැහැදිලි දුරකථන ඇමතුම් ලබා ගැනීමටත් මෙය හොඳම විසඳුමයි.\n\nවිශේෂාංග:\n\n• O-RA Pro Sound Active Wireless Headphones: Hybrid ANC (Active Noise Cancellation) තාක්ෂණය සමඟින් Studio මට්ටමේ උසස් ශබ්ද අත්දැකීමක් ලබා දෙයි. පැය 40 ක දීර්ඝ බැටරි ආයු කාලය, සපපහසු Memory Foam Earcups සහ Bluetooth 5.3 තාක්ෂණය නිසා දවස පුරාම පහසුවෙන් භාවිතා කළ හැක.\n\n• O-RA Pods Pro True Wireless Earbuds: පැහැදිලි දුරකථන ඇමතුම් සඳහා ENC (Environmental Noise Cancellation) තාක්ෂණය සහ ජලයෙන් ආරක්ෂා වන IPX5 Waterproof පහසුකම සහිතයි. LED Battery Display එක සමඟින් පැය 30 ක භාවිත කාලයක් (Playback Time) ලබා දෙයි.\n\nස්ටූඩියෝ මට්ටමේ සංගීතයට, පැහැදිලි ඇමතුම්වලට සහ දෛනික භාවිතයට අවශ්‍ය සියලුම පහසුකම් එකම පැකේජයකින් ලබාගන්න.","brand":"","search_keywords":"O-RA Pro Sound Active + O-RA Pods Pro True Combo Pack, combo pack, S0001, S0007","source_shop_name":"","source_shop_price":0,"category_id":"cat-1786538293968-ilit","category_slug":"kids-items","images":["/product-media/product-1786586474028-6ec02737fe.jpg"],"buying_price":1400,"selling_price":5440,"discount_price":5440,"discount_enabled":false,"auto_price_enabled":false,"auto_discount_on_cost_drop":false,"stock_quantity":0,"status":"Active","product_type":"bundle","variants":[],"bundle_components":[{"product_id":"prod-1","quantity":1},{"product_id":"prod-7","quantity":1}],"bundle_auto_price":true,"bundle_discount_amount":50,"specifications":[],"is_test_product":false,"id":"prod-1786586812116-xk11","created_at":"2026-08-13T02:06:52.116Z","item_details":[]},{"sku":"S0010","name_en":"BOTTEL","name_si":"","description_en":"","description_si":"","brand":"","search_keywords":"BOTTEL, Bottel Items","source_shop_name":"MKM","source_shop_price":900,"category_slug":"bottel-items","product_type":"variant","variants":[{"id":"var-1786553641481-rsl","sku":"S0010-PURPLE","option_name":"Color","option_value":"PURPLE","image":"/product-media/product-1786553886993-114b58e77e.jpg","buying_price":900,"selling_price":1600,"stock_quantity":0,"status":"Out of Stock","discount_price":1600,"discount_enabled":false,"supplier_offer_enabled":false,"price_history":[{"changed_at":"2026-08-12T17:08:03.180Z","reason":"Saved supplier offer: Rs. 900 -> Rs. 800; customer saving Rs. 100/item","buying_price":900,"selling_price":1600,"discount_price":1500,"discount_enabled":true}]},{"id":"var-1786553889202-tyo","sku":"S0010-BLUE","option_name":"Color","option_value":"BLUE","image":"/product-media/product-1786553895511-faf623c3ea.jpg","buying_price":1000,"selling_price":1900,"stock_quantity":0,"status":"Out of Stock","discount_price":1900,"discount_enabled":false,"supplier_offer_enabled":false,"price_history":[{"changed_at":"2026-08-12T17:08:12.732Z","reason":"Saved supplier offer: Rs. 1000 -> Rs. 750; customer saving Rs. 250/item","buying_price":1000,"selling_price":1900,"discount_price":1650,"discount_enabled":true}]}],"bundle_components":[],"specifications":[],"is_test_product":false,"buying_price":900,"selling_price":1600,"discount_price":1600,"discount_enabled":false,"auto_price_enabled":true,"auto_discount_on_cost_drop":true,"supplier_offer_enabled":false,"stock_quantity":0,"status":"Out of Stock","images":["/product-media/product-1786553902873-5bed37fc17.jpg"],"category_id":"cat-1786554215885-1xll","id":"prod-1786554254524-xre7","created_at":"2026-08-12T17:04:14.524Z","item_details":[]},{"sku":"S0009","name_en":"Shook! Stitch 2-in-1 Dual-Chamber Kids Water Bottle – 700ml","name_si":"Stitch 2-in-1 ද්විත්ව ළමා වතුර බෝතලය (700ml)","description_en":"","description_si":"","brand":"","search_keywords":"Shook! Stitch 2-in-1 Dual-Chamber Kids Water Bottle – 700ml, shook, stitch, 2-in-1, dual-chamber, kids, water, bottle, 700ml, Kids Items, children items, ළමා භාණ්ඩ","source_shop_name":"aym","source_shop_price":599,"category_slug":"kids-items","product_type":"variant","variants":[{"id":"var-1786538044382-s8o","sku":"S0009-COLOR-1","option_name":"Color","option_value":"Pink","image":"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSFpwpGPhDZCkfqI85oQ8lz2gv8yMihR8WG9Q0FJi0J9ynfgEp3THowMPs&s=10","buying_price":500,"selling_price":1000,"stock_quantity":0,"status":"Out of Stock"},{"id":"var-1786538334782-ujc","sku":"S0009-COLOR-2","option_name":"Color","option_value":"blue","image":"https://rukmini1.flixcart.com/image/300/300/xif0q/bottle/f/a/k/700-stitch-pritfecthubdual-compartment-kids-water-bottle-purple-original-imahhxdntazaardg.jpeg","buying_price":500,"selling_price":1200,"stock_quantity":0,"status":"Out of Stock"}],"bundle_components":[],"is_test_product":false,"buying_price":500,"selling_price":1000,"discount_price":1000,"discount_enabled":false,"auto_price_enabled":true,"auto_discount_on_cost_drop":true,"stock_quantity":0,"status":"Out of Stock","images":["/product-media/product-1786538168326-49cfee5045.jpg"],"category_id":"cat-1786538293968-ilit","id":"prod-1786538293968-fhi8","created_at":"2026-08-12T12:38:13.968Z","specifications":[],"item_details":[]},{"id":"prod-1","sku":"S0001","name_en":"O-RA Pro Sound Active Noise Cancelling Headphones","name_si":"O-RA ප්‍රෝ ශබ්ද අවහිර කරණ හෙඩ්ෆෝන්","description_en":"Experience studio-grade wireless sound with hybrid ANC, 40-hour battery stamina, ultra-soft memory foam earcups, and bluetooth 5.3 connectivity.","description_si":"පැය 40 ක පවතින බැටරිය, ශබ්ද පාලන තාක්ෂණය සහ බ්ලූටූත් 5.3 සම්බන්ධතාවය සහිත උසස්ම තත්වයේ හෙඩ්ෆෝන් එකක්.","category_id":"cat-6","category_slug":"audio","images":["https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80","https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&q=80","https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&q=80"],"buying_price":1000,"selling_price":2990,"discount_price":2490,"stock_quantity":105,"status":"Active","is_featured":true,"is_latest":true,"created_at":"2026-08-06T20:38:03.171Z","brand":"","search_keywords":"","discount_enabled":true,"product_type":"normal","variants":[],"bundle_components":[],"offer_buying_price":500,"supplier_offer_enabled":true,"supplier_offer_saved_at":"2026-08-12T11:02:36.355Z","price_history":[{"changed_at":"2026-08-12T11:02:36.355Z","reason":"Saved supplier offer: Rs. 1000 -> Rs. 500; customer saving Rs. 500/item","buying_price":1000,"selling_price":2990,"discount_price":2490,"discount_enabled":true}],"specifications":[],"item_details":[]},{"id":"prod-2","sku":"S0002","name_en":"O-RA Luxury Chronograph Gold Edition Men Watch","name_si":"O-RA රන් ආලේපිත සුඛෝපභෝගී පිරිමි ඔරලෝසුව","description_en":"Precision quartz movement encased in 316L stainless steel with 18k gold electroplating, scratch-resistant sapphire crystal glass, and 50m water resistance.","description_si":"18k රන් ආලේපිත අලංකාර ජලයට හානි නොවන උසස්ම පැවැත්මක් සහිත පිරිමි අත් ඔරලෝසුව.","category_id":"cat-3","category_slug":"watches","images":["https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&q=80","https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=800&q=80"],"buying_price":18000,"selling_price":28500,"discount_price":28500,"stock_quantity":0,"status":"Out of Stock","is_featured":true,"is_latest":false,"created_at":"2026-08-06T20:38:03.171Z","brand":"","search_keywords":"O-RA Luxury Chronograph Gold Edition Men Watch, luxury, chronograph, gold, edition, men, watch, Watches & Jewelry, wrist watch, smart watch, jewelry, අත් ඔරලෝසුව, ආභරණ","discount_enabled":false,"product_type":"normal","variants":[],"bundle_components":[],"source_shop_name":"","source_shop_price":0,"is_test_product":false,"auto_price_enabled":true,"auto_discount_on_cost_drop":true,"supplier_offer_enabled":false,"specifications":[],"item_details":[]},{"id":"prod-3","sku":"S0003","name_en":"O-RA Smart Vision Ultra AMOLED Smartwatch","name_si":"O-RA ස්මාර්ට් විෂන් ඇමෝලෙඩ් ස්මාර්ට් ඔරලෝසුව","description_en":"1.96-inch HD AMOLED display, Bluetooth calling, heart rate & SpO2 blood oxygen tracking, 100+ workout modes, and titanium alloy bezel.","description_si":"හදවත් ස්පන්දනය, ඔක්සිජන් මට්ටම, බ්ලූටූත් කෝල් සහ ක්‍රීඩා මාදිලි 100+ සහිත උසස්ම ස්මාර්ට් ඔරලෝසුව.","category_id":"cat-1","category_slug":"electronics","images":["https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=800&q=80","https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=800&q=80"],"buying_price":8500,"selling_price":14200,"discount_price":11500,"stock_quantity":33,"status":"Active","is_featured":true,"is_latest":true,"created_at":"2026-08-06T20:38:03.171Z","brand":"","search_keywords":"","discount_enabled":false,"product_type":"normal","variants":[],"bundle_components":[],"specifications":[],"item_details":[]},{"id":"prod-4","sku":"S0004","name_en":"O-RA Amber & Oud Eau De Parfum Luxury Spray 100ml","name_si":"O-RA ඇම්බර් සහ ඌද් සුඛෝපභෝගී සුවඳ විලවුන් 100ml","description_en":"Rich oriental scent blending royal amber, smoked oud wood, spicy cinnamon, and sweet vanilla notes. Long-lasting 24-hour aroma profile.","description_si":"පැය 24 පුරා පවතින රාජකීය ඇම්බර් සහ ඌද් සුවඳින් අනූන සුවඳ විලවුන්.","category_id":"cat-4","category_slug":"beauty","images":["https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=800&q=80","https://images.unsplash.com/photo-1541643600914-78b084683601?w=800&q=80"],"buying_price":9000,"selling_price":16500,"discount_price":13800,"stock_quantity":15,"status":"Active","is_featured":false,"is_latest":true,"created_at":"2026-08-06T20:38:03.171Z","brand":"","search_keywords":"","discount_enabled":false,"product_type":"normal","variants":[],"bundle_components":[],"specifications":[],"item_details":[]},{"id":"prod-5","sku":"S0005","name_en":"O-RA Smart Touchless Espresso & Coffee Machine","name_si":"O-RA ස්මාර්ට් කොෆී යන්ත්‍රය","description_en":"15-bar Italian pump pressure, touch screen controls, automatic milk frothing wand, and thermo-block quick heating system for espresso, cappuccino and latte.","description_si":"තත්පර කිහිපයකින් නිවසේදීම කොෆී සහ කැපුචිනෝ සාදාගත හැකි ස්මාර්ට් කෝපි යන්ත්‍රය.","category_id":"cat-5","category_slug":"home-living","images":["https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=800&q=80","https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80"],"buying_price":38000,"selling_price":58000,"discount_price":58000,"stock_quantity":8,"status":"Active","is_featured":true,"is_latest":false,"created_at":"2026-08-06T20:38:03.171Z","brand":"","search_keywords":"","discount_enabled":false,"product_type":"normal","variants":[],"bundle_components":[],"specifications":[],"item_details":[]},{"id":"prod-6","sku":"S0006","name_en":"O-RA Executive Italian Leather Travel Duffle Bag","name_si":"O-RA ඉතාලි ලෙදර් ට්‍රැවල් බෑගය","description_en":"Handcrafted full-grain genuine leather with shoe compartment, reinforced brass zips, padded laptop sleeve, and detachable shoulder strap.","description_si":"අතින් නිමවන ලද සැබෑ ලෙදර් උසස්ම ට්‍රැවල් බෑගය.","category_id":"cat-2","category_slug":"fashion","images":["https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=80","https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&q=80"],"buying_price":14000,"selling_price":24500,"discount_price":19800,"stock_quantity":13,"status":"Active","is_featured":false,"is_latest":true,"created_at":"2026-08-06T20:38:03.171Z","brand":"","search_keywords":"","discount_enabled":false,"product_type":"normal","variants":[],"bundle_components":[],"specifications":[],"item_details":[]},{"id":"prod-7","sku":"S0007","name_en":"O-RA Pods Pro True Wireless Earbuds with LED Power Case","name_si":"O-RA පොඩ්ස් ප්‍රෝ වයර්ලස් ඉයර්බඩ්ස්","description_en":"Hi-Fi bass audio, environmental noise cancellation (ENC) for crystal clear phone calls, IPX5 waterproof rating, and 30-hour total playback with LED battery display.","description_si":"නැවුම් පැහැදිලි ශබ්ද, LED බැටරි දර්ශකය සහ දූවිලි/ජලයට හසු නොවන ඉයර්බඩ්ස්.","category_id":"cat-6","category_slug":"audio","images":["https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&q=80","https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=800&q=80"],"buying_price":900,"selling_price":2500,"discount_price":6800,"stock_quantity":49,"status":"Active","is_featured":true,"is_latest":true,"created_at":"2026-08-06T20:38:03.171Z","brand":"","search_keywords":"","discount_enabled":false,"product_type":"normal","variants":[],"bundle_components":[],"specifications":[],"item_details":[]},{"id":"prod-8","sku":"S0008","name_en":"O-RA PureAir HEPA Smart Room Air Purifier","name_si":"O-RA පියෝ එයාර් කාමර වාතය පිරිසිදු කිරීමේ යන්ත්‍රය","description_en":"True HEPA H13 filtration removing 99.97% of airborne allergens, smoke, and dust particles with real-time air quality indicator light and quiet sleep mode.","description_si":"කාමරයේ ඇති දූවිලි සහ විසබීජ 99.97% ක් ඉවත් කර පිරිසිදු වාතය ලබාදෙන ස්මාර්ට් යන්ත්‍රය.","category_id":"cat-5","category_slug":"home-living","images":["https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=800&q=80"],"buying_price":5000,"selling_price":34500,"discount_price":34500,"stock_quantity":22,"status":"Active","is_featured":false,"is_latest":false,"created_at":"2026-08-06T20:38:03.171Z","brand":"","search_keywords":"","discount_enabled":false,"product_type":"normal","variants":[],"bundle_components":[],"specifications":[],"item_details":[]}],"categories":[{"name_en":"Kids Items","name_si":"ළමා භාණ්ඩ","slug":"kids-items","icon":"🧒","id":"cat-1786538293968-ilit"},{"name_en":"Kitchen Items","name_si":"මුළුතැන්ගෙයි භාණ්ඩ","slug":"kitchen-items","icon":"🍳","id":"cat-1786539888696-mzfl"},{"name_en":"Bottel Items","name_si":"Bottel භාණ්ඩ","slug":"bottel-items","icon":"📦","id":"cat-1786554215885-1xll"}],"settings":{"delivery_fee":500,"free_delivery_enabled":true,"multi_buy_discount_enabled":true,"multi_buy_tier1_min":2,"multi_buy_tier1_max":3,"multi_buy_tier1_rate":5,"multi_buy_tier2_min":4,"multi_buy_tier2_max":5,"multi_buy_tier2_rate":7.5,"multi_buy_tier3_min":6,"multi_buy_tier3_max":10,"multi_buy_tier3_rate":10,"gift_wrap_enabled":true,"gift_wrap_fee":250,"advance_qty_threshold":4,"advance_percentage":50,"bank_name":"Peoples Bank","bank_account_holder":"P.A.S.U.Pathiraja","bank_account_number":"079200250004053","bank_branch":"Colombo Main Branch","bank_details_saved":true,"whatsapp_number":"0763052074","company_email":"orastore.lk@gmail.com","company_address":"28/87/A/Gurugama,Naiwala,Essella","about_page_enabled":true,"return_policy_page_enabled":true,"contact_page_enabled":true,"privacy_page_enabled":true,"terms_page_enabled":true,"website_info_last_updated":"2026-08-12","about_page_en":"O-RA is an online store focused on making everyday shopping simple and convenient. Product details, prices and availability shown on the website are kept as clear as possible. If you need help before or after placing an order, use the O-RA Assistant or the contact details shown on this website.","about_page_si":"O-RA යනු දෛනික අවශ්‍යතා සඳහා භාණ්ඩ පහසුවෙන් සහ පැහැදිලිව මිලදී ගැනීමට උපකාර කරන ඔන්ලයින් වෙළඳසැලකි. වෙබ් අඩවියේ පෙන්වන භාණ්ඩ විස්තර, මිල සහ තොග තොරතුරු හැකි තරම් පැහැදිලිව තබා ඇත. ඇණවුමකට පෙර හෝ පසු සහාය අවශ්‍ය නම් O-RA Assistant හෝ වෙබ් අඩවියේ ඇති සම්බන්ධතා භාවිතා කරන්න.","return_policy_en":"If an item arrives damaged, incorrect, incomplete, or materially different from the confirmed order, contact O-RA as soon as reasonably possible with the Order ID and relevant evidence. Do not return a parcel without receiving return instructions from O-RA. Eligibility for return or refund is reviewed according to the condition of the item, the order record and applicable law. Items that have been used, altered, damaged after delivery, or returned without required order information may not qualify unless required by applicable law. Approved refunds are processed after the returned parcel is received and checked where a return is required.","return_policy_si":"ලැබුණු භාණ්ඩය හානි වී ඇත්නම්, වැරදි භාණ්ඩයක් නම්, කොටස් අඩු නම් හෝ තහවුරු කළ ඇණවුමට සැලකිය යුතු ලෙස වෙනස් නම් Order ID එක සහ අදාල සාක්ෂි සමඟ හැකි ඉක්මනින් O-RA වෙත දැනුම් දෙන්න. O-RA වෙතින් return උපදෙස් ලැබීමට පෙර parcel එක ආපසු යවන්න එපා. Return හෝ refund සුදුසුකම භාණ්ඩයේ තත්ත්වය, ඇණවුම් වාර්තාව සහ අදාල නීති අනුව පරීක්ෂා කර තීරණය කෙරේ. භාවිතා කළ, වෙනස් කළ, delivery පසු හානි වූ හෝ අවශ්‍ය order තොරතුරු නොමැති භාණ්ඩ applicable law මගින් අවශ්‍ය නොවේ නම් return/refund සඳහා සුදුසු නොවිය හැක. Return එක අවශ්‍ය අවස්ථාවක refund එකක් අනුමත වුවහොත් parcel එක ලැබී පරීක්ෂා කිරීමෙන් පසු refund process කරනු ලැබේ.","contact_intro_en":"Need help with a product, order, payment, delivery or return? Use the 24/7 O-RA Assistant first for the fastest self-service support. You can also use the verified contact details shown below.","contact_intro_si":"භාණ්ඩයක්, ඇණවුමක්, ගෙවීමක්, delivery එකක් හෝ return එකක් ගැන සහාය අවශ්‍යද? ඉක්මන් self-service සහාය සඳහා මුලින්ම 24/7 O-RA Assistant භාවිතා කරන්න. පහතින් පෙන්වන තහවුරු කළ සම්බන්ධතා තොරතුරුද භාවිතා කළ හැක.","privacy_policy_en":"O-RA collects only information reasonably needed to process orders, provide customer support, manage payments and delivery, prevent misuse and improve store operations. Order information may be shared with service providers such as delivery partners only when needed to fulfil the order or provide the requested service. O-RA does not intentionally publish customer order details. Please avoid sending passwords or unnecessary sensitive information through support channels.","privacy_policy_si":"O-RA විසින් orders process කිරීම, customer support ලබාදීම, payments සහ delivery කළමනාකරණය කිරීම, misuse වැළැක්වීම සහ store operations වැඩිදියුණු කිරීම සඳහා සාධාරණ ලෙස අවශ්‍ය තොරතුරු පමණක් භාවිතා කරයි. Order එක සම්පූර්ණ කිරීමට අවශ්‍ය විට delivery partner වැනි service providers සමඟ අවශ්‍ය order තොරතුරු පමණක් share කළ හැක. Customer order details මහජනතාවට ප්‍රකාශ කිරීම O-RA විසින් අරමුණු කරන්නේ නැත. Support channels හරහා passwords හෝ අවශ්‍ය නොවන සංවේදී තොරතුරු එවීමෙන් වළකින්න.","terms_conditions_en":"By placing an order, you confirm that the customer and delivery information you provide is reasonably accurate and that you intend to receive the selected items at the confirmed price. Product availability, colour or variant, delivery timing and payment requirements are subject to confirmation where applicable. O-RA may contact you to verify an order before fulfilment. Orders may be cancelled where the customer requests cancellation, required information cannot be verified, stock becomes unavailable, payment requirements are not met, or fulfilment is not reasonably possible. Nothing in these terms limits rights that cannot legally be excluded under applicable law.","terms_conditions_si":"Order එකක් දීමෙන් ඔබ ලබාදෙන customer සහ delivery තොරතුරු සාධාරණ ලෙස නිවැරදි බවත්, තහවුරු කළ මිලට තෝරාගත් භාණ්ඩ ලබාගැනීමට අදහස් කරන බවත් තහවුරු කරයි. අවශ්‍ය අවස්ථාවල product availability, color/variant, delivery time සහ payment requirements තහවුරු කිරීමට යටත් වේ. Order එක fulfil කිරීමට පෙර O-RA ඔබව සම්බන්ධ කර order එක verify කළ හැක. Customer cancellation එකක්, අවශ්‍ය තොරතුරු verify කළ නොහැකි වීම, stock unavailable වීම, payment requirements සම්පූර්ණ නොවීම හෝ fulfil කිරීම සාධාරණ ලෙස කළ නොහැකි වීම වැනි අවස්ථාවල order එක cancel කළ හැක. Applicable law යටතේ ඉවත් කළ නොහැකි customer rights මෙම terms මගින් සීමා නොකෙරේ.","business_registration_enabled":false,"business_registration_name":"","business_registration_number":"","business_registration_copy_url":"","google_sheet_webhook_url":"https://script.google.com/macros/s/AKfycbwNJTSpAfHn31r-QuxsDjcoc2qzA8ScttbcGOGlfRc7gR93rEZySedPsnMU7iBzp_jnug/exec","admin_secret_path":"system","maintenance_mode":false,"maintenance_message":"Website is currently under maintenance. Please check back soon.","fardar_parcel_type":"","courier_provider":"Fardar","fardar_api_url":"","fardar_account_id":"","courier_api_enabled":false,"top_announcement_en":"Islandwide Fast Delivery (Rs. 500 Flat Rate) | COD & Bank Transfer Available","top_announcement_si":"දිවයිනටම වේගවත් බෙදාහැරීම (රු. 500) | COD සහ බැංකු හුවමාරු ගෙවීම් ලබාගත හැක","top_banner_phone":"0763052074","top_banner_active":true,"hero_banner_tag_en":"Great Deals","hero_banner_tag_si":"සුපිරි දීමනා","hero_banner_title_en":"Everything You Need, All in One Place.","hero_banner_title_si":"ඔබට අවශ්‍ය දේවල් එකම තැනකින්.","hero_banner_sub_en":"Shop useful, fun and everyday items at great prices, delivered right to your doorstep.","hero_banner_sub_si":"ඔබට අවශ්‍ය විවිධ භාණ්ඩ හොඳ මිලකට තෝරාගෙන, නිවසටම ගෙන්වා ගන්න.","hero_banner_image":"/brand-media/ora-hero-banner.png","hero_banner_button_en":"Shop Now","hero_banner_button_si":"දැන්ම මිලදී ගන්න","brand_store_name":"O-RA","brand_tagline":"Online Store","brand_primary_color":"#000000","brand_secondary_color":"#00fffb","website_logo":"/brand-media/ora-website-logo.png","mobile_logo":"/brand-media/ora-mobile-logo.png","favicon_logo":"","invoice_logo":"/brand-media/ora-invoice-logo.png","black_logo":"","white_logo":"","invoice_font_company_family":"Arial","invoice_font_company_size":28,"invoice_font_company_weight":700,"invoice_font_company_spacing":0,"invoice_font_heading_family":"Arial","invoice_font_heading_size":34,"invoice_font_heading_weight":700,"invoice_font_heading_spacing":0,"invoice_font_labels_family":"Arial","invoice_font_labels_size":24,"invoice_font_labels_weight":600,"invoice_font_labels_spacing":0,"invoice_font_values_family":"Arial","invoice_font_values_size":24,"invoice_font_values_weight":400,"invoice_font_values_spacing":0,"invoice_font_table_family":"Arial","invoice_font_table_size":23,"invoice_font_table_weight":500,"invoice_font_table_spacing":0,"invoice_font_totals_family":"Arial","invoice_font_totals_size":25,"invoice_font_totals_weight":600,"invoice_font_totals_spacing":0,"invoice_font_notice_family":"Arial","invoice_font_notice_size":22,"invoice_font_notice_weight":500,"invoice_font_notice_spacing":0,"invoice_font_footer_family":"Arial","invoice_font_footer_size":20,"invoice_font_footer_weight":500,"invoice_font_footer_spacing":0,"invoice_logo_width":42,"invoice_logo_height":24,"invoice_logo_scale":1.1,"invoice_logo_x":-12,"invoice_logo_y":-30,"invoice_logo_align":"left","invoice_header_height":34,"invoice_header_font_size":17,"invoice_customer_font_size":8.5,"invoice_item_font_size":8,"invoice_row_height":6.5,"invoice_barcode_width":52,"invoice_barcode_height":15,"invoice_waybill_font_size":8,"invoice_total_font_size":12,"invoice_margin":8,"invoice_border_enabled":true,"invoice_compact_mode":false,"invoice_footer_text":"Thank you for shopping with O-RA Online Store.","invoice_company_address":"","invoice_website_url":"orastore.com.lk","desktop_logo_width":135,"mobile_logo_width":145,"mobile_logo_max_height":64,"invoice_text_styles_json":"{\"invoice-text-79\":{\"family\":\"Verdana\",\"size\":32,\"weight\":600},\"invoice-text-69\":{\"family\":\"Arial Black\",\"size\":21.5},\"invoice-text-54\":{\"size\":23},\"invoice-text-71\":{\"size\":23,\"weight\":500,\"spacing\":0.5},\"invoice-text-66\":{\"size\":24.5},\"invoice-text-67\":{\"size\":23,\"family\":\"Arial\"},\"invoice-text-58\":{\"size\":22.5},\"invoice-text-68\":{\"size\":23.5},\"invoice-text-73\":{\"size\":19.5,\"family\":\"Arial Black\",\"weight\":400,\"spacing\":-0.1},\"invoice-text-7\":{\"family\":\"Arial\"},\"invoice-text-0\":{\"size\":26},\"invoice-text-26\":{\"size\":37.5,\"family\":\"Trebuchet MS\",\"spacing\":2.1,\"weight\":800},\"invoice-text-60\":{\"size\":21},\"invoice-text-59\":{\"size\":21.5},\"invoice-text-76\":{\"spacing\":-0.5,\"size\":24.5,\"weight\":500,\"family\":\"Arial\"},\"invoice-text-61\":{\"size\":21},\"invoice-text-62\":{\"size\":21},\"invoice-text-72\":{\"size\":28},\"invoice-text-75\":{\"size\":19.5,\"weight\":400,\"spacing\":0.1},\"invoice-text-74\":{\"size\":23.5},\"invoice-text-4\":{\"size\":25}}","invoice_custom_fonts_json":"[]","hotline_number":"0710319640","invoice_text_content_json":"{\"invoice-text-3\":\"- 0710319640\",\"invoice-text-58\":\"මුදල් ගෙවීමට පෙර පාර්සලය විවෘත නොකරන්න.\",\"invoice-text-59\":\"විවෘත කළ පාර්සල් නැවත භාරගනු නොලැබේ.   බිල්පත සුරැකිව තබා ගන්න.\"}","invoice_icon_whatsapp_image":"/brand-media/ora-whatsapp-icon.png","invoice_icon_whatsapp_size":48,"invoice_icon_whatsapp_x":-23,"invoice_icon_whatsapp_y":-3,"invoice_icon_facebook_image":"/brand-media/ora-facebook-icon.png","invoice_icon_facebook_size":36,"invoice_icon_facebook_x":-16,"invoice_icon_facebook_y":-1}}$ora_storefront$::jsonb,
  timezone('utc'::text, now())
)
ON CONFLICT (key) DO NOTHING;

-- Explicit server-role grants for the backend secret key.
GRANT ALL ON TABLE public.admin_users TO service_role;
GRANT ALL ON TABLE public.admin_data_store TO service_role;
GRANT ALL ON TABLE public.order_snapshots TO service_role;
GRANT ALL ON TABLE public.customer_reviews TO service_role;
GRANT ALL ON TABLE public.product_requests TO service_role;
GRANT ALL ON TABLE public.customer_profiles TO service_role;
