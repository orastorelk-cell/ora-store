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

Check these in order:

1. `/api/health`
2. `/system`
3. Storefront products/categories/logo/images
4. Super Admin login
5. One test order from customer website to system
6. Google Sheet sync

Only after these pass should the custom `.com.lk` domain be attached.
