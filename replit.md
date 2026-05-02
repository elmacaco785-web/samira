# MozPay - Digital Earning Platform

## Overview
MozPay is a mobile-first digital earning platform targeting the Mozambican market. Users can earn money through activities like Ads View, Spin Wheel, and Chatbots, and manage funds using local payment methods (M-Pesa, e-Mola, mKesh).

## Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+) — no frameworks
- **Server**: Node.js HTTP server (native `http`) — serves static files + `/api/sms-webhook`, `/api/health`, `/api/chat/*` (chat proxy using Supabase service role to bypass RLS), and `/api/settings/ads` (public read of ad-script settings)
- **Backend data**: Supabase (auth, wallets, transactions, system_settings, sms_log, pending_payments) with realtime subscriptions used by the deposit/investment flow
- **Fonts**: Google Fonts (Inter, Hanken Grotesk, DM Sans, Space Grotesk)

## Project Layout
```
.
├── index.html           # Login & Registration page
├── home.html            # Main Dashboard SPA
├── admin.html           # Admin panel
├── app.js               # Authentication and UI transition logic
├── home.js              # Dashboard and transaction simulation logic (UTF-16 LE with BOM)
├── styles.css           # Global styles
├── server.js            # Node.js HTTP server (Port 5000, host 0.0.0.0) — static + SMS webhook
├── add_security.js      # Security helpers
├── hero_bg.jpg          # Hero background image
├── SMS_FORWARDER_SETUP.md # End-user guide to wire the SMS Forwarder Android app to the webhook
├── api/                 # Vercel serverless functions (chat, settings)
│   ├── _supa.js         # Shared Supabase helper (not exposed as endpoint)
│   ├── chat/            # Chat proxy endpoints
│   └── settings/        # Settings endpoints
├── assets/              # Logos, backgrounds, currency notes
├── fotos/               # Hero carousel images
├── attached_assets/     # Uploaded reference assets
├── tela de levantamento/ # Withdrawal screen reference assets
├── sql_*.txt            # Supabase SQL setup scripts
├── vercel.json          # Vercel deployment config
├── serve.json           # Serve config
└── netlify.toml         # Netlify config
```

## Running the App (Replit)
- **Workflow**: "Start application" — runs `node server.js`
- **Port**: 5000 on 0.0.0.0
- The static server resolves files relative to its own directory (`__dirname`).

## Key Features
- Multi-step user registration (Name → Phone/Email → Password/Invite Code)
- Dashboard with balance display and earning activities
- Local payment operator detection (M-Pesa: 84/85, e-Mola: 86/87, mKesh: 82/83)
- Currency in MT (Mozambican Metical)

## Deployment
- Target: autoscale
- Run command: `node server.js`

## Important Implementation Notes
- **`home.js` is encoded as UTF-16 LE with BOM.** Standard `read`/`edit` tools fail on it. Use the Node.js editor template at `/tmp/edit_home.js` (preserves BOM via `Buffer.concat([Buffer.from([0xFF,0xFE]), Buffer.from(s, "utf16le")])`) for any modification. For batch edits use the Python pattern in `/tmp/patch_home_js.py` which decodes → applies anchored substitutions (with trailing-whitespace normalisation) → re-encodes back to UTF-16 LE w/ BOM.
- **Supabase tables in use**: `wallets` (balance, total_deposited, total_withdrawn, level_plan, level_expires_at, bonus_claimed), `pending_payments` (status: pending/approved/rejected — `amount` rows where status='approved' = MozPay revenue), `transactions`, `withdrawal_requests`, `refund_requests`, `chat_messages` (admin↔user real chat — columns include `conversation_id`, `sender` ('user'|'admin'), `body`, `user_name`, `user_phone`, `read_by_admin`, `read_by_user`; anonymous visitors are persisted with `user_id=null` and `user_name='[Visitante]'`), `admin_messages` (legacy Reportes/Denúncias), `notifications`, `online_users`, `system_settings` (also stores `ads_script_home` (Mobile Banner 300x50) and `ads_script_adsview` (320x50) for Adsterra/Ezoic), `sms_log`, `user_preferences` (invited_by, **`active_investment` JSONB — set on admin approval so user-side missions/tasks become visible**, `bonus_claimed`).
- **Withdrawals**: minimum 50 MT, maximum 10 000 MT, fee computed by `calcFee(amount)` (3% with min 5 MT capped at 50 MT) — applied uniformly across home.html and home.js. Investments use 0 fee.
- **Investment plans** activate `wallets.level_plan` (label) + `wallets.level_expires_at` (180 days) **AND** `user_preferences.active_investment` (JSONB `{name, rank, amount, activatedAt}`) on admin approval. Both are required — without `active_investment` the user-side mission UI stays empty.
- **Real-time chat (Suporte MozPay)**: fully owned by `app.js` `initChatModal()` (the duplicate in `home.js` is a no-op). Uses `/api/chat/send`, `/api/chat/messages`, `/api/chat/mark-read`, `/api/chat/typing` (GET/POST). Sessions: authed user → `session_id = user.id`; anonymous visitor → UUID stored in `localStorage.mozpay_chat_session` with `user_name='[Visitante]'`. Polls msgs every 2.5 s and typing every 2 s while modal is open. The secret string `12345678T` is intercepted client-side and never sent to the server (toggles `window.__mzp` admin gate).
- **Realtime notifications popup** (`#rtNotifBackdrop` in home.html, wired by `showRealtimeNotifPopup()` in home.js): centred rounded card with X + OK buttons, auto-dismissed after 8 s. Triggered from the existing `notifications` realtime channel only when `n.user_id===userId` OR broadcast (`user_id===null`). Admin panel default target is `online` (queries `online_users`).
- **Welcome bonus (T008 fix)**: button state is now sourced from `wallets.bonus_claimed` after `loadUserData()` finishes (with localStorage as cache). The click handler re-reads `wallets.bonus_claimed` before crediting, so a stale localStorage flag can no longer cause double-claim. On success it writes both `wallets.bonus_claimed` and `user_preferences.bonus_claimed`.
- **AdsView (T009)**: reward changed from 0,10 → **0,05 MT**, credited at the end of the 30 s timer (not on Próximo click). The "Clicar no Anúncio" button (`#adsClickBtn`) is disabled until the timer ends. Ad slot `#adsViewSlot` is populated from `system_settings.ads_script_adsview` via `/api/settings/ads` (`renderAdScript` recreates `<script>` tags so they execute). Home banner slot `#adsterra-container` is populated from `ads_script_home` after the welcome bonus is claimed/already-claimed.
- **Admin Settings → Scripts de Anúncio**: two textareas in admin.html upsert `ads_script_home` and `ads_script_adsview` into `system_settings`.
- **Reportes admin section** (`page-reports` in admin.html) reads/writes `admin_messages` with status `pending`/`resolved`. Sidebar badge `#reportsBadge` is updated by `loadDashboard()` and `loadReports()`.
- **Profile painel "Mais" button** (`#profileMoreBtn`) switches the profile to the Definições tab (`data-tab="2"`).
- **Profile painel auto-refresh on plan upgrade**: `home.js` exposes `window.refreshProfilePainel()` and the `user_preferences` realtime handler calls it whenever `active_investment` changes, so "Plano Activo / Nível N" re-renders immediately without a page reload. Plan upgrades also fire `showRealtimeNotifPopup('Plano actualizado', ...)`.
- **Admin sidebar realtime badges**: `refreshSidebarBadges()` in admin.html updates all sidebar counters (`usersBadge`, `wdBadge`, `onlineBadge`, `refundsBadge`, `reportsBadge`, `depositsBadge`) on every realtime event AND on a 10 s polling timer (fallback for when the Supabase realtime publication is off).
- **Notifications polling fallback**: in addition to the realtime channel, home.js polls `notifications` every 12 s for new rows targeted at the current user (`user_id=userId OR user_id IS NULL`) and triggers `showRealtimeNotifPopup` for each unseen one. Guarantees admin notifications reach users even if realtime is disabled.

## Security
- **NEVER hard-code the Supabase service-role key.** It must be supplied through the `SUPABASE_SERVICE_ROLE_KEY` env var (Replit Secret in dev, Vercel Environment Variable in prod). If missing, `/api/chat/*` and `/api/settings/ads` return HTTP 503 but the rest of the app keeps working.
- The Supabase **anon** key is safe to ship to the client (it is gated by RLS) and remains inlined in `app.js`/`admin.html`/`server.js`.

## Vercel Deployment
- `vercel.json` excludes `/api/...` from the SPA catch-all (`/((?!api/).*)→/index.html`) so the file-system API routes are reachable.
- Serverless functions live under `api/` (CommonJS, Node 18+). Shared helper: `api/_supa.js`.
- Required Vercel Environment Variable: `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview).
