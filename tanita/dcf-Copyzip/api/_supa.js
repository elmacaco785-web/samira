/**
 * Shared Supabase helper for Vercel serverless functions.
 * Files starting with _ are not exposed as API routes by Vercel.
 */
const SUPABASE_URL = 'https://fbojmxiwvubepoywdhhc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function supaFetch(path, opts = {}) {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
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

function requireServiceKey(res) {
  if (SUPABASE_SERVICE_KEY) return false;
  res.status(503).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured. Set it in Vercel Project Settings → Environment Variables.' });
  return true;
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

function getBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 100000) { req.destroy(); resolve({}); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = { SUPABASE_URL, SUPABASE_SERVICE_KEY, supaFetch, requireServiceKey, setCORS, getBody };
