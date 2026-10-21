# O-RA Store — Cloudflare + Supabase Clean Build

This is the clean O-RA Store project for the new deployment stack:

- **GitHub** — source/version control
- **Cloudflare Workers + Static Assets** — customer website, `/system`, and `/api/*`
- **Supabase** — persistent database/auth-support data and public media storage

## Clean-up already done
 
- Removed the previous host-specific deployment files and temporary fixes.
- Removed temporary migration/fix files, old Git history, `dist`, `node_modules`, and backup folders from the deliverable.
- Added one Cloudflare Worker entry: `worker/index.ts`.
- Added one Cloudflare config: `wrangler.jsonc`.
- `/system` is handled as a SPA deep link through Cloudflare Static Assets `single-page-application` fallback.
- `/api/*` is routed to the Express backend Worker first.
- Serverless temporary fallback files use `/tmp`; persistent live data must use Supabase.
- Existing storefront seed remains in `supabase_schema.sql` (products, categories, branding and settings only; no old test orders/chats/complaints).

## Local development first

Install and run exactly as before:

```bash
npm install
npm run dev
```

Open:

- Store: `http://localhost:3000`
- System: `http://localhost:3000/system`

Do local testing before any live deployment.

## Supabase setup

1. Create a fresh Supabase project.
2. Run `supabase_schema.sql` once in SQL Editor.
3. Copy `.env.example` to `.env` locally and enter your own values.
4. Never commit `.env` or secrets.

Required values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `ORA_SUPER_ADMIN_PASSWORD`
- `ORA_DEFAULT_STAFF_PASSWORD`
- `STAFF_SESSION_SECRET`
- `ABUSE_HASH_SALT`

## Cloudflare local production-runtime test

After Supabase local `.env` testing is complete:

```bash
npm run cf:dev
```

This builds the Vite SPA and runs it through the Cloudflare Workers runtime locally.

## Cloudflare deployment

Do this only after localhost + Supabase tests pass.

```bash
npx wrangler login
npm run cf:deploy
```

Set live secrets in Cloudflare instead of putting them in source files. For example:

```bash
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put ORA_SUPER_ADMIN_PASSWORD
npx wrangler secret put ORA_DEFAULT_STAFF_PASSWORD
npx wrangler secret put STAFF_SESSION_SECRET
npx wrangler secret put ABUSE_HASH_SALT
```

Non-secret browser values (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) are needed at Vite build time. Configure them in the Cloudflare build environment when connecting GitHub, or locally before a manual build/deploy.

## Verification after deployment

Website saves use `ora-storefront-patch-v1` for changed products, categories and
setting fields. `ora-storefront-catalog-v1` adds/removes products and changes their
order using only changed records and ID lists; unrelated stock and concurrent
additions are retained, with item-code and bundle-dependency checks. Admin records are persisted as encrypted immutable change shards
under `admin-changes-v1/`, published by one ETag-guarded manifest. The restored
`admin_data_store.json` remains intact; hourly `ora-admin-checkpoint-v1` backups
reference that base and the committed manifest. Read through `readDataTable` or
the server adapter so newer records are included. Keep the base and immutable
shards together when restoring a checkpoint; do not overwrite the base alone.
`npm run test:storefront-reliability` covers atomic writes, failed/lost responses,
concurrent edits, cold reads and browser draft recovery. `/connection-check.html`
also checks full/compact/patch saves unchanged and staff session renewal.

Invoice PDF download receipts are retained per staff account in the browser
until the server confirms them. Status saves touch one order shard per request;
reload, online/focus and the retry control resume the original event without
generating another PDF. Pending receipt set numbers remain reserved. The packing
guard is published atomically in the admin manifest, so status saves do not load
all old packing history. A pending receipt also verifies its original invoice,
batch and waybill before updating status. `npm run test:invoice-downloads` covers durable receipt
recovery, large batches, interrupted acknowledgments and exact unrelated data.

Check these in order:

1. `/api/health`
2. `/system`
3. Storefront products/categories/logo/images
4. Super Admin login
5. One test order from customer website to system
6. Google Sheet sync

Only after these pass should the custom `.com.lk` domain be attached.

## Staff purchases

Under **STOCK → Staff Purchases**, Inventory editors select individual items or
exact variants, enter the staff member and a manual price per unit, then save.
The receipt, stock deductions and Decrease audit entries commit atomically in
private R2 storage. Browser recovery retains the original operation for retries;
normal selling prices remain independent. History supports staff/item search and
Sri Lanka date filters. Inventory viewers can read history without recording sales.
`npm run test:staff-purchases` checks stock, accounting, concurrency and UI recovery.

## Google Sheet Confirm / Cancel auto upload

In **Confirm / Cancel Upload**, **New Confirm Orders Auto Upload** reads the
connected order tabs, groups every item row by Order ID, ignores Pending orders,
and saves all decisions in one guarded R2 write before allocating stock. Ready
orders receive one `PACK-SHEET-…` invoice batch. The download contains one A6 PDF
and one UTF-8 Fardar CSV. Existing invoices and courier numbers are preserved.
Missing FB/TK COD lead snapshots can be recovered from complete Sheet rows with
their original Order ID, contact details and historical prices. Lead ID is used
when present; missing Lead IDs use a stable original-Order-ID identity. Repeat customers
with identical items remain separate orders when their Order IDs differ. Recovery
and all decisions commit atomically; Pending rows are never created. Existing
lead identities and courier/packing history prevent a second parcel. Incomplete
rows and missing bank-payment records require review before any invoice starts.

Super Admin connects the Sheet once using **Connect Google Sheet once**:

1. Enable Google Sheets API in a Google Cloud project.
2. Create a service account and obtain its JSON key file.
3. Share the order spreadsheet with that account's email as **Editor**.
4. Enter the Sheet link, choose the JSON file, and save the connection. Leaving
   tab names blank detects `CALL CENTER ORDERS`, `FACEBOOK ORDERS`, and
   `TIKTOK ORDERS` when they exist. Custom tabs require their exact names.

The Apps Script deployment stays unchanged. Credentials and job snapshots live
in encrypted private R2 objects, outside public storefront settings. The minute
cron resumes accepted jobs after a closed browser or lost response; it does not
start new imports without pressing the button. Sheet acknowledgments affect only
matching, successfully saved rows. Edited rows are rechecked before stock
allocation, and rows changed after invoicing remain unmarked for review.

The Sheet's existing `ORDER ACTION` labels (`CONFIRM ORDER`, `PENDING`,
`CANCEL ENTIRE ORDER`) stay unchanged. Successful Confirm rows use `#ffd966`;
Cancel rows use `#cccccc`. Pending and already invoiced rows are left untouched.

`src/lib/confirmSheetPlan.ts` is generated from the production Confirm CSV rules.
After changing those rules, run `node --import tsx tools/generate-confirm-sheet-plan.ts`.
The build checks this module for drift.
Run `npm run test:sheet-confirm` for the native R2 / mocked Google workflow tests.
