# MozPay — Mozambican Digital Earning Platform

## Overview
MozPay is a mobile-first digital earning platform for the Mozambican market. Users earn money through Ads View, Spin Wheel, and daily missions; manage funds via local payment methods (M-Pesa, e-Mola, mKesh); and communicate with admins via real-time chat.

## Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+) — no frameworks
- **Backend (local/Replit)**: Node.js static server + inline API routes (`server.js`)
- **Backend (Vercel)**: Serverless functions under `api/` (self-contained, no shared imports)
- **Database**: Supabase (PostgreSQL) — anon key for user reads, service-role key for server-side writes
- **Static hosting fallback**: `.htaccess` for Apache hosts (googiehost, etc.)

## Project Layout
```
dcf-Copyzip/
├── index.html             # Login & Registration SPA
├── home.html              # Main Dashboard SPA (logged-in users)
├── admin.html             # Admin panel (no auth guard — keep URL secret)
├── app.js                 # Auth + initChatModal (real 2-way chat, no AI)
├── home.js                # Dashboard logic (UTF-16 LE with BOM)
├── styles.css             # Global styles
├── server.js              # Local dev server — static files + API routes
├── api/                   # Vercel serverless functions (self-contained)
│   ├── chat/
│   │   ├── send.js        # POST /api/chat/send
│   │   ├── messages.js    # GET  /api/chat/messages?session_id=
│   │   ├── mark-read.js   # POST /api/chat/mark-read
│   │   └── typing.js      # GET/POST /api/chat/typing
│   ├── settings/
│   │   └── ads.js         # GET  /api/settings/ads
│   └── _supa.js           # Shared helper (unused by Vercel fns, kept for reference)
├── vercel.json            # Vercel v2 config (rewrites only, no routes)
├── .vercelignore          # Excludes server.js from Vercel bundling
├── .htaccess              # Apache SPA routing (for googiehost etc.)
├── assets/                # Logos, backgrounds, currency notes
├── fotos/                 # Hero carousel images
├── sql_supabase.txt       # All Supabase SQL migrations (run manually)
└── sql_*.txt              # Other SQL migration files
```

## Running Locally
- **Workflow**: "Start application" → `node dcf-Copyzip/server.js`
- **Port**: 5000
- **Env required**: `SUPABASE_SERVICE_ROLE_KEY` (Replit Secret)

## API Endpoints
All endpoints exist in both `server.js` (local) and `api/` (Vercel):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat/send` | Send a chat message (user or admin) |
| GET | `/api/chat/messages` | Fetch messages for a session_id |
| POST | `/api/chat/mark-read` | Mark messages read (who=user or admin) |
| GET/POST | `/api/chat/typing` | Typing indicator (in-memory, no persistence) |
| GET | `/api/settings/ads` | Fetch Adsterra ad scripts from system_settings |
| POST | `/api/sms-webhook` | SMS forwarder webhook (local server only) |

## Key Supabase Tables
| Table | Purpose |
|-------|---------|
| `wallets` | Balance, level_plan, bonus_claimed, total_deposited |
| `user_preferences` | active_investment (JSONB), bonus_claimed, user_name, user_phone |
| `notifications` | User/broadcast notifications (user_id=null = broadcast) |
| `chat_messages` | Support chat — conversation_id, sender, body, is_anonymous |
| `online_users` | Tracks which users are online (for admin notifications) |
| `system_settings` | Key-value store: ads_script_adsview, ads_script_home, sms_webhook_secret |
| `pending_payments` | Investment/deposit approval queue |
| `transactions` | Transaction history |

## Pending SQL Migration (run in Supabase SQL Editor)
```sql
-- T001: Add is_anonymous column to chat_messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_anonymous boolean DEFAULT false;
```
See `sql_supabase.txt` for full migration history including online_users RLS policy.

## Vercel Deployment
1. Connect GitHub repo to Vercel
2. Set **Root Directory** to `dcf-Copyzip/`
3. Add env var `SUPABASE_SERVICE_ROLE_KEY` in Vercel Project Settings → Environment Variables
4. Deploy — Vercel auto-discovers `api/` functions; static files served from root

## Key Behaviours
- **Chat**: `app.js initChatModal()` handles all chat logic. `home.js` does NOT redefine it (avoids shadowing). Anonymous users get a UUID session stored in localStorage.
- **Notification popup**: Realtime Supabase subscription in `home.js` → `showRealtimeNotifPopup()` → `#rtNotifBackdrop` card (auto-dismiss 8s).
- **Bonus double-claim guard**: On claim click, re-reads `wallets.bonus_claimed` from DB before proceeding.
- **AdsView reward**: 0.05 MT credited when timer ends (not on "Próximo" click). "Clicar no Anúncio" button enabled after timer.
- **Bonus card ad**: After bonus claimed, `showHomeBannerAd()` injects `ads_script_home` script into `#adsterra-container`.
- **Admin approveInvestment**: Updates both `wallets.level_plan` AND `user_preferences.active_investment` so user-side missions/tasks appear.
- **home.js encoding**: UTF-16 LE with BOM. Patch with Python: `raw[2:].decode('utf-16-le')` → encode back → prepend `b'\xff\xfe'`.

## Deployment Notes
- Replit: Uses `SUPABASE_SERVICE_ROLE_KEY` secret (set via Replit Secrets UI)
- Vercel: Set `SUPABASE_SERVICE_ROLE_KEY` in Project Settings → Environment Variables
- Apache hosts (googiehost): Upload all files; `.htaccess` handles SPA routing. No `/api/` endpoints (chat won't work without a Node server).
