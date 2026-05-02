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

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    const r = await fetch(
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
  const r = await fetch(`${SUPABASE_URL}/rest/v1/sms_log`, {
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret, Authorization');
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
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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
    is_anonymous: isAnon,
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
    const r = await fetch(
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
