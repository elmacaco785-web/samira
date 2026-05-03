/* ============================================================
   MozPay — Static Server + SMS Forwarder Webhook
   ============================================================
   - Serves the SPA (HTML/JS/CSS) from this folder.
   - Exposes POST /api/sms-webhook for the SMS Forwarder app
     (https://github.com/bogkonstantin/android_income_sms_gateway_webhook
      or any compatible app) to deliver M-Pesa / E-Mola / mKesh
      confirmation messages.
   - The webhook validates a shared secret stored in Supabase
     (system_settings.sms_webhook_secret) and inserts the raw
     SMS into the `sms_log` table. The frontend (home.js) reacts
     in realtime, matches the SMS against the user's pending
     payment, and credits the wallet / activates the level.
   ============================================================ */

const http   = require('http');
const https  = require('https');
const tls    = require('tls');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

/* ────────────────────────────────────────────────────────────
   httpsRequest — fetch() replacement that forces HTTP/1.1.
   Node.js 18+ fetch (undici) negotiates HTTP/2, which fails
   behind Replit and Render reverse proxies. Using the native
   https module always uses HTTP/1.1 and works everywhere.
   ──────────────────────────────────────────────────────────── */
function httpsRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyBuf = opts.body
      ? (Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body))
      : null;
    const reqOpts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: Object.assign({}, opts.headers || {}),
    };
    if (bodyBuf) {
      reqOpts.headers['Content-Length'] = String(bodyBuf.length);
    }
    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const status = res.statusCode || 0;
        const hdrs = res.headers || {};
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: { get: (k) => hdrs[k.toLowerCase()] || null },
          text:        () => Promise.resolve(buf.toString('utf8')),
          json:        () => Promise.resolve(JSON.parse(buf.toString('utf8'))),
          arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(new Error('httpsRequest timeout')); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

const PORT = 5000;
const ROOT = __dirname;

// Public Supabase config — same anon key the frontend uses.
const SUPABASE_URL = 'https://fbojmxiwvubepoywdhhc.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZib2pteGl3dnViZXBveXdkaGhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTgzNTgsImV4cCI6MjA5MjI5NDM1OH0.2h2RL0HY885TnPoRZEQQbjVr1PVKoxpppzRs9wMqCp0';

// Service-role key (server-side only — NEVER hard-code, NEVER expose to client).
// Required for the chat proxy so anonymous (logged-out) visitors can still talk to
// admin while bypassing RLS. Set this as a Replit Secret (and as a Vercel env var
// for deployments). The chat-proxy endpoints will respond with HTTP 503 if it is
// missing, but the rest of the app continues to work.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SUPABASE_SERVICE_KEY) {
  console.warn('[security] SUPABASE_SERVICE_ROLE_KEY is NOT set — /api/chat/* and /api/settings/ads will return 503. Set it as a Replit Secret to enable.');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
  '.png':  'image/png',  '.webp': 'image/webp',
  '.svg':  'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

/* ────────────────────────────────────────────────────────────
   Webhook secret cache (read from Supabase, refreshed every 60s)
   ──────────────────────────────────────────────────────────── */
let secretCache = { value: null, ts: 0 };

async function fetchWebhookSecret() {
  const fresh = Date.now() - secretCache.ts < 60_000;
  if (fresh && secretCache.value) return secretCache.value;
  try {
    const r = await httpsRequest(
      `${SUPABASE_URL}/rest/v1/system_settings?key=eq.sms_webhook_secret&select=value`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const data = await r.json();
    if (Array.isArray(data) && data[0]?.value) {
      secretCache = { value: String(data[0].value), ts: Date.now() };
      return secretCache.value;
    }
  } catch (e) { console.warn('[sms-webhook] could not fetch secret:', e.message); }
  return null;
}

async function insertSmsLog(payload) {
  const r = await httpsRequest(`${SUPABASE_URL}/rest/v1/sms_log`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([payload]),
  });
  const txt = await r.text();
  return { ok: r.ok, status: r.status, body: txt };
}

/* ────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────── */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret, Authorization, apikey, X-Client-Info, Prefer, X-Supabase-Api-Version');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');
}

/* ────────────────────────────────────────────────────────────
   Generic Supabase reverse-proxy  /supabase/*
   Rewrites the URL from /supabase/<path> → Supabase REST/Auth.
   Uses service-role key so RLS is bypassed server-side.
   The user's own JWT is still forwarded so Supabase can identify
   the caller when needed (e.g. auth endpoints).
   ──────────────────────────────────────────────────────────── */
async function handleSupabaseProxy(req, res, subpath, urlObj) {
  const serviceKey = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const isAuthEndpoint = subpath.startsWith('auth/');

  // Auth endpoints: always pass anon key as apikey + forward user's Authorization
  // REST endpoints: use service key as both apikey and auth (bypasses RLS safely)
  const apikey = isAuthEndpoint ? SUPABASE_ANON_KEY : serviceKey;
  const userAuth = req.headers['authorization'] || '';
  const authHeader = isAuthEndpoint
    ? (userAuth || `Bearer ${SUPABASE_ANON_KEY}`)
    : `Bearer ${serviceKey}`;

  // Build upstream URL — preserve query string
  const qs = urlObj.search || '';
  const upstream = `${SUPABASE_URL}/${subpath}${qs}`;

  // Collect request body (for POST/PATCH/PUT/DELETE)
  let bodyBuf = null;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', c => chunks.push(c));
      req.on('end', resolve);
      req.on('error', reject);
    });
    if (chunks.length) bodyBuf = Buffer.concat(chunks);
  }

  // Forward headers — inject correct auth
  const fwdHeaders = {
    'apikey': apikey,
    'Authorization': authHeader,
    'Content-Type': req.headers['content-type'] || 'application/json',
  };
  // Preserve PostgREST/GoTrue-specific headers
  for (const h of ['prefer', 'x-supabase-api-version', 'range', 'x-client-info']) {
    if (req.headers[h]) fwdHeaders[h] = req.headers[h];
  }

  try {
    const upRes = await httpsRequest(upstream, {
      method: req.method,
      headers: fwdHeaders,
      body: bodyBuf || undefined,
    });

    // Forward response headers that matter to the client
    const resHeaders = { 'Content-Type': upRes.headers.get('content-type') || 'application/json' };
    for (const h of ['content-range', 'x-total-count', 'location']) {
      const v = upRes.headers.get(h);
      if (v) resHeaders[h] = v;
    }
    setCors(res);
    res.writeHead(upRes.status, resHeaders);
    const body = await upRes.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (e) {
    console.error('[supabase-proxy] upstream error:', e.message, '| path:', subpath);
    jsonResponse(res, 502, { message: 'proxy error: ' + e.message, code: 'PROXY_ERROR' });
  }
}

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function jsonResponse(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveFile(res, filePath, statusCode) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Internal Server Error'); return; }
    res.writeHead(statusCode, { 'Content-Type': contentType });
    res.end(data);
  });
}

/* ────────────────────────────────────────────────────────────
   API: POST /api/sms-webhook
   ────────────────────────────────────────────────────────────
   Accepted payload shapes (we are tolerant of different SMS
   Forwarder apps):
     1) { from, text, sentStamp }                  ← bogkonstantin
     2) { from, body, timestamp }                  ← generic
     3) { sender, message, receivedAt }            ← alt
   Required:
     - Either "X-Webhook-Secret" header OR ?secret=… query string
       must equal the value stored in system_settings.sms_webhook_secret.
   ──────────────────────────────────────────────────────────── */
async function handleSmsWebhook(req, res, urlObj) {
  let raw;
  try { raw = await readBody(req); } catch (e) { return jsonResponse(res, 413, { ok:false, error:'body too large' }); }

  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { /* allow form-encoded/empty */
    try {
      const params = new URLSearchParams(raw);
      payload = Object.fromEntries(params.entries());
    } catch {}
  }

  const sentSecret = req.headers['x-webhook-secret'] ||
                     urlObj.searchParams.get('secret') ||
                     payload.secret ||
                     '';
  const expected = await fetchWebhookSecret();
  if (!expected) {
    console.warn('[sms-webhook] no secret configured in system_settings — refusing request');
    return jsonResponse(res, 503, { ok:false, error:'webhook not configured' });
  }
  if (!sentSecret || String(sentSecret) !== expected) {
    return jsonResponse(res, 401, { ok:false, error:'invalid secret' });
  }

  const from = payload.from ?? payload.sender ?? payload.address ?? '';
  const body = payload.text ?? payload.body  ?? payload.message ?? '';
  const stamp = payload.sentStamp ?? payload.timestamp ?? payload.receivedAt ?? Date.now();

  if (!from && !body) {
    return jsonResponse(res, 400, { ok:false, error:'missing from/body' });
  }

  const row = {
    raw_from: String(from).slice(0, 64),
    raw_body: String(body).slice(0, 2000),
    received_at: new Date(typeof stamp === 'number' ? stamp : Date.parse(stamp) || Date.now()).toISOString(),
    raw_payload: payload,
  };

  const result = await insertSmsLog(row);
  if (!result.ok) {
    console.error('[sms-webhook] supabase insert failed:', result.status, result.body);
    return jsonResponse(res, 502, { ok:false, error:'persist failed', detail: result.body });
  }
  console.log(`[sms-webhook] stored SMS from "${row.raw_from}" (${row.raw_body.length} chars)`);
  return jsonResponse(res, 200, { ok:true });
}

/* ────────────────────────────────────────────────────────────
   API: Chat proxy (works for anonymous + authenticated users)
   Bypasses Supabase RLS using service-role key kept on server.
   ──────────────────────────────────────────────────────────── */
function requireServiceKey(res) {
  if (SUPABASE_SERVICE_KEY) return false;
  jsonResponse(res, 503, { ok:false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured on server. Add it as an environment secret.' });
  return true;
}

async function supaFetch(path, opts = {}) {
  return httpsRequest(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

// In-memory typing indicators with TTL (5s)
const typingMap = new Map(); // key = `${session_id}:${who}` => expiresAt ts
function setTyping(session_id, who, isTyping) {
  const key = `${session_id}:${who}`;
  if (isTyping) typingMap.set(key, Date.now() + 5000);
  else typingMap.delete(key);
}
function getTyping(session_id, who) {
  const key = `${session_id}:${who}`;
  const exp = typingMap.get(key);
  if (!exp) return false;
  if (exp < Date.now()) { typingMap.delete(key); return false; }
  return true;
}

async function handleChatSend(req, res) {
  let raw;
  try { raw = await readBody(req); } catch { return jsonResponse(res, 413, { ok:false, error:'body too large' }); }
  let p = {};
  try { p = JSON.parse(raw || '{}'); } catch { return jsonResponse(res, 400, { ok:false, error:'invalid json' }); }
  const session_id = String(p.session_id || '').trim();
  const sender = String(p.sender || 'user').trim();
  const body = String(p.body || '').trim();
  if (!session_id || !body) return jsonResponse(res, 400, { ok:false, error:'session_id and body required' });
  if (sender !== 'user' && sender !== 'admin') return jsonResponse(res, 400, { ok:false, error:'invalid sender' });

  const isAnon = !!p.is_anonymous;
  const row = {
    conversation_id: session_id,
    user_id: (isAnon || !p.user_id) ? null : String(p.user_id),
    sender,
    body: body.slice(0, 4000),
    user_name: isAnon ? '[Visitante]' : (p.name ? String(p.name).slice(0, 120) : null),
    user_phone: isAnon ? null : (p.phone ? String(p.phone).slice(0, 32) : null),
  };

  try {
    const r = await supaFetch('chat_messages', { method: 'POST', body: JSON.stringify(row) });
    const txt = await r.text();
    if (!r.ok) return jsonResponse(res, 502, { ok:false, error:'persist failed', detail: txt });
    setTyping(session_id, sender, false);
    const arr = JSON.parse(txt || '[]');
    return jsonResponse(res, 200, { ok:true, message: arr[0] || null });
  } catch (e) {
    return jsonResponse(res, 500, { ok:false, error: e.message });
  }
}

async function handleChatMessages(req, res, urlObj) {
  const session_id = urlObj.searchParams.get('session_id');
  if (!session_id) return jsonResponse(res, 400, { ok:false, error:'session_id required' });
  const since = urlObj.searchParams.get('since') || '';
  let q = `chat_messages?conversation_id=eq.${encodeURIComponent(session_id)}&order=created_at.asc&limit=300`;
  if (since) q += `&created_at=gt.${encodeURIComponent(since)}`;
  try {
    const r = await supaFetch(q, { method: 'GET' });
    const txt = await r.text();
    if (!r.ok) return jsonResponse(res, 502, { ok:false, error: txt });
    return jsonResponse(res, 200, { ok:true, messages: JSON.parse(txt) });
  } catch (e) {
    return jsonResponse(res, 500, { ok:false, error: e.message });
  }
}

async function handleChatMarkRead(req, res) {
  let raw;
  try { raw = await readBody(req); } catch { return jsonResponse(res, 413, { ok:false }); }
  let p = {};
  try { p = JSON.parse(raw || '{}'); } catch { return jsonResponse(res, 400, { ok:false }); }
  const session_id = String(p.session_id || '');
  const who = p.who === 'admin' ? 'admin' : 'user';
  if (!session_id) return jsonResponse(res, 400, { ok:false, error:'session_id required' });
  // who='user' marks admin replies as read; who='admin' marks user msgs as read
  const senderToMark = who === 'user' ? 'admin' : 'user';
  const col = who === 'user' ? 'read_by_user' : 'read_by_admin';
  try {
    const r = await supaFetch(
      `chat_messages?conversation_id=eq.${encodeURIComponent(session_id)}&sender=eq.${senderToMark}&${col}=eq.false`,
      { method: 'PATCH', body: JSON.stringify({ [col]: true }), prefer: 'return=minimal' }
    );
    return jsonResponse(res, 200, { ok: r.ok });
  } catch (e) {
    return jsonResponse(res, 500, { ok:false, error: e.message });
  }
}

async function handleChatTypingPost(req, res) {
  let raw; try { raw = await readBody(req); } catch { return jsonResponse(res, 413, { ok:false }); }
  let p = {};
  try { p = JSON.parse(raw || '{}'); } catch { return jsonResponse(res, 400, { ok:false }); }
  const session_id = String(p.session_id || '');
  const who = p.who === 'admin' ? 'admin' : 'user';
  if (!session_id) return jsonResponse(res, 400, { ok:false });
  setTyping(session_id, who, !!p.is_typing);
  return jsonResponse(res, 200, { ok: true });
}

function handleChatTypingGet(_req, res, urlObj) {
  const session_id = urlObj.searchParams.get('session_id') || '';
  const who = urlObj.searchParams.get('who') === 'admin' ? 'admin' : 'user';
  if (!session_id) return jsonResponse(res, 400, { ok:false });
  return jsonResponse(res, 200, { ok:true, is_typing: getTyping(session_id, who) });
}

/* ────────────────────────────────────────────────────────────
   API: GET /api/settings/ads — ad scripts (Adsterra/Ezoic)
   Public read of system_settings entries used by the front-end.
   ──────────────────────────────────────────────────────────── */
async function handleAdsSettings(_req, res) {
  try {
    const r = await httpsRequest(
      `${SUPABASE_URL}/rest/v1/system_settings?key=in.(ads_script_adsview,ads_script_home)&select=key,value`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const arr = await r.json();
    const out = { ads_script_adsview: '', ads_script_home: '' };
    if (Array.isArray(arr)) arr.forEach(row => { if (row && row.key in out) out[row.key] = String(row.value || ''); });
    return jsonResponse(res, 200, { ok:true, ...out });
  } catch (e) {
    return jsonResponse(res, 500, { ok:false, error: e.message });
  }
}

/* ────────────────────────────────────────────────────────────
   Wallet & Transactions proxy — relays browser requests to
   Supabase via the Replit server, which has a stable connection
   even when the user's browser cannot reach Supabase directly
   (ERR_HTTP2_PROTOCOL_ERROR / ERR_CONNECTION_RESET).
   ──────────────────────────────────────────────────────────── */

function getUserIdFromJwt(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    const b64 = token.split('.')[1];
    if (!b64) return null;
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    return payload.sub || null;
  } catch { return null; }
}

let _maintCache = { val: false, ts: 0 };
async function handleMaintenance(_req, res) {
  if (Date.now() - _maintCache.ts < 30_000) return jsonResponse(res, 200, { maintenance: _maintCache.val });
  try {
    const r = await supaFetch('system_settings?key=eq.maintenance_mode&select=value');
    const arr = await r.json();
    const val = Array.isArray(arr) && arr[0]?.value === 'true';
    _maintCache = { val, ts: Date.now() };
    return jsonResponse(res, 200, { maintenance: val });
  } catch { return jsonResponse(res, 200, { maintenance: false }); }
}

// Forward user JWT to Supabase (RLS applies — each user sees only their own data).
// This avoids needing the service-role key for wallet/transaction proxy endpoints.
async function supaFetchAsUser(path, userToken, opts = {}) {
  // Prefer service-role key when available (bypasses RLS for flexibility),
  // otherwise fall back to anon key + user JWT (RLS-enforced, secure).
  const apiKey = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const authHeader = SUPABASE_SERVICE_KEY
    ? `Bearer ${SUPABASE_SERVICE_KEY}`
    : `Bearer ${userToken}`;
  return httpsRequest(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: apiKey,
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function getUserTokenFromReq(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

async function handleWalletGet(req, res) {
  const userId = getUserIdFromJwt(req);
  const token = getUserTokenFromReq(req);
  if (!userId || !token) return jsonResponse(res, 401, { ok: false, error: 'unauthorized' });
  try {
    const r = await supaFetchAsUser(`wallets?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`, token);
    const arr = await r.json();
    const wallet = Array.isArray(arr) ? (arr[0] || null) : null;
    return jsonResponse(res, 200, { ok: true, wallet });
  } catch (e) { return jsonResponse(res, 500, { ok: false, error: e.message }); }
}

async function handleWalletPatch(req, res) {
  const userId = getUserIdFromJwt(req);
  const token = getUserTokenFromReq(req);
  if (!userId || !token) return jsonResponse(res, 401, { ok: false, error: 'unauthorized' });
  let raw; try { raw = await readBody(req); } catch { return jsonResponse(res, 413, { ok: false }); }
  let updates = {};
  try { updates = JSON.parse(raw || '{}'); } catch { return jsonResponse(res, 400, { ok: false, error: 'invalid json' }); }
  delete updates.user_id;
  try {
    const r = await supaFetchAsUser(`wallets?user_id=eq.${encodeURIComponent(userId)}`, token, { method: 'PATCH', body: JSON.stringify(updates) });
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length === 0) {
      await supaFetchAsUser('wallets', token, { method: 'POST', body: JSON.stringify({ user_id: userId, ...updates }), prefer: 'return=minimal' });
    }
    return jsonResponse(res, 200, { ok: true });
  } catch (e) { return jsonResponse(res, 500, { ok: false, error: e.message }); }
}

async function handleTransactionsGet(req, res, urlObj) {
  const userId = getUserIdFromJwt(req);
  const token = getUserTokenFromReq(req);
  if (!userId || !token) return jsonResponse(res, 401, { ok: false, error: 'unauthorized' });
  const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || '200', 10), 500);
  try {
    const r = await supaFetchAsUser(`transactions?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}&select=*`, token);
    const txs = await r.json();
    return jsonResponse(res, 200, { ok: true, transactions: Array.isArray(txs) ? txs : [] });
  } catch (e) { return jsonResponse(res, 500, { ok: false, error: e.message }); }
}

async function handleTransactionPost(req, res) {
  const userId = getUserIdFromJwt(req);
  const token = getUserTokenFromReq(req);
  if (!userId || !token) return jsonResponse(res, 401, { ok: false, error: 'unauthorized' });
  let raw; try { raw = await readBody(req); } catch { return jsonResponse(res, 413, { ok: false }); }
  let row = {};
  try { row = JSON.parse(raw || '{}'); } catch { return jsonResponse(res, 400, { ok: false, error: 'invalid json' }); }
  row.user_id = userId;
  try {
    const r = await supaFetchAsUser('transactions', token, { method: 'POST', body: JSON.stringify([row]) });
    const txt = await r.text();
    if (!r.ok) return jsonResponse(res, 502, { ok: false, error: txt });
    const arr = JSON.parse(txt || '[]');
    return jsonResponse(res, 200, { ok: true, transaction: arr[0] || null });
  } catch (e) { return jsonResponse(res, 500, { ok: false, error: e.message }); }
}

/* ────────────────────────────────────────────────────────────
   API: GET /api/health
   ──────────────────────────────────────────────────────────── */
async function handleHealth(_req, res) {
  const secret = await fetchWebhookSecret();
  jsonResponse(res, 200, {
    ok: true,
    service: 'mozpay-static-server',
    sms_webhook_configured: !!secret,
    time: new Date().toISOString(),
  });
}

/* ────────────────────────────────────────────────────────────
   Main request handler
   ──────────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // --- API routes ---
  // Generic Supabase proxy — intercepts ALL browser→Supabase calls
  if (pathname.startsWith('/supabase/')) {
    const subpath = pathname.slice('/supabase/'.length);
    try { await handleSupabaseProxy(req, res, subpath, urlObj); }
    catch (e) { console.error('[supabase-proxy] fatal:', e); jsonResponse(res, 502, { message: 'proxy error' }); }
    return;
  }

  if (pathname === '/api/sms-webhook' && req.method === 'POST') {
    try { await handleSmsWebhook(req, res, urlObj); }
    catch (e) { console.error('[sms-webhook] handler error:', e); jsonResponse(res, 500, { ok:false, error:'internal' }); }
    return;
  }
  if (pathname === '/api/health' && req.method === 'GET') {
    try { await handleHealth(req, res); }
    catch (e) { jsonResponse(res, 500, { ok:false, error:'internal' }); }
    return;
  }
  if (pathname === '/api/chat/send' && req.method === 'POST') {
    try { await handleChatSend(req, res); } catch (e) { console.error('[chat/send]', e); jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/chat/messages' && req.method === 'GET') {
    try { await handleChatMessages(req, res, urlObj); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/chat/mark-read' && req.method === 'POST') {
    try { await handleChatMarkRead(req, res); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/chat/typing' && req.method === 'POST') {
    try { await handleChatTypingPost(req, res); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/chat/typing' && req.method === 'GET') {
    try { handleChatTypingGet(req, res, urlObj); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/settings/ads' && req.method === 'GET') {
    try { await handleAdsSettings(req, res); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/maintenance' && req.method === 'GET') {
    try { await handleMaintenance(req, res); } catch (e) { jsonResponse(res, 200, { maintenance: false }); }
    return;
  }
  if (pathname === '/api/wallet' && req.method === 'GET') {
    try { await handleWalletGet(req, res); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/wallet' && req.method === 'PATCH') {
    try { await handleWalletPatch(req, res); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/transactions' && req.method === 'GET') {
    try { await handleTransactionsGet(req, res, urlObj); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }
  if (pathname === '/api/transactions' && req.method === 'POST') {
    try { await handleTransactionPost(req, res); } catch (e) { jsonResponse(res, 500, { ok:false }); }
    return;
  }

  // --- Static file serving (preserved behaviour) ---
  let staticPath = pathname;
  if (staticPath === '/' || staticPath === '') staticPath = '/index.html';
  const decoded = decodeURIComponent(staticPath);
  const filePath = path.join(ROOT, decoded);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const htmlPath = path.join(ROOT, decoded + '.html');
      fs.stat(htmlPath, (err2, stat2) => {
        if (!err2 && stat2.isFile()) serveFile(res, htmlPath, 200);
        else serveFile(res, path.join(ROOT, 'index.html'), 404);
      });
      return;
    }
    serveFile(res, filePath, 200);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MozPay static server running on port ${PORT}`);
  console.log(`SMS webhook endpoint: POST /api/sms-webhook  (header X-Webhook-Secret)`);
});

/* ────────────────────────────────────────────────────────────
   WebSocket proxy — tunnels wss://<replit>/supabase/realtime/*
   through to Supabase Realtime using TLS, so the browser's
   Supabase Realtime client works without direct WS access.
   ──────────────────────────────────────────────────────────── */
const SUPA_HOST = 'fbojmxiwvubepoywdhhc.supabase.co';

server.on('upgrade', (req, clientSocket, head) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (!pathname.startsWith('/supabase/')) {
    clientSocket.destroy();
    return;
  }

  const subpath = pathname.slice('/supabase/'.length); // e.g. realtime/v1/websocket
  const upQuery = new URL(`https://${SUPA_HOST}/${subpath}${urlObj.search || ''}`);
  // Inject service key as apikey so Realtime authenticates the connection
  upQuery.searchParams.set('apikey', SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
  const upstreamPath = upQuery.pathname + upQuery.search;

  clientSocket.on('error', () => {});

  // Open TLS connection to Supabase
  const upSocket = tls.connect({ host: SUPA_HOST, port: 443, servername: SUPA_HOST }, () => {
    // Reconstruct the WebSocket handshake headers
    const headers = [
      `GET ${upstreamPath} HTTP/1.1`,
      `Host: ${SUPA_HOST}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${req.headers['sec-websocket-key'] || ''}`,
      `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}`,
      `apikey: ${SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY}`,
      `Authorization: Bearer ${SUPABASE_ANON_KEY}`,
    ];
    if (req.headers['sec-websocket-protocol']) {
      headers.push(`Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
    }
    headers.push('', '');
    upSocket.write(headers.join('\r\n'));

    // Pipe head bytes that arrived with the upgrade request
    if (head && head.length) upSocket.write(head);
  });

  upSocket.on('error', (e) => {
    console.error('[ws-proxy] upstream error:', e.message);
    clientSocket.destroy();
  });

  // Wait for upstream 101 Switching Protocols, then pipe both directions
  let handshakeDone = false;
  let buf = Buffer.alloc(0);

  upSocket.on('data', (chunk) => {
    if (handshakeDone) return; // piped already
    buf = Buffer.concat([buf, chunk]);
    const sep = buf.indexOf('\r\n\r\n');
    if (sep === -1) return;
    handshakeDone = true;
    const responseHeaders = buf.slice(0, sep + 4);
    const remaining = buf.slice(sep + 4);
    // Forward 101 response to browser
    clientSocket.write(responseHeaders);
    if (remaining.length) clientSocket.write(remaining);
    // Now pipe raw frames in both directions
    upSocket.pipe(clientSocket);
    clientSocket.pipe(upSocket);
  });

  clientSocket.on('error', () => upSocket.destroy());
});
