const SUPABASE_URL = 'https://fbojmxiwvubepoywdhhc.supabase.co';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method not allowed' });

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) return res.status(503).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not set on Vercel' });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/system_settings?key=in.(ads_script_adsview,ads_script_home)&select=key,value`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    const txt = await r.text();
    if (!r.ok) return res.status(502).json({ ok: false, error: txt });
    const rows = JSON.parse(txt || '[]');
    const out = { ads_script_adsview: '', ads_script_home: '' };
    rows.forEach(row => { if (row && row.key in out) out[row.key] = row.value || ''; });
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
