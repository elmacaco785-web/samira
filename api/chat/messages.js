const SUPABASE_URL = 'https://fbojmxiwvubepoywdhhc.supabase.co';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method not allowed' });

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) return res.status(503).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not set on Vercel' });

  const session_id = String((req.query && req.query.session_id) || '');
  const since = String((req.query && req.query.since) || '');
  if (!session_id) return res.status(400).json({ ok: false, error: 'session_id required' });

  let q = `chat_messages?conversation_id=eq.${encodeURIComponent(session_id)}&order=created_at.asc&limit=300`;
  if (since) q += `&created_at=gt.${encodeURIComponent(since)}`;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    const txt = await r.text();
    if (!r.ok) return res.status(502).json({ ok: false, error: txt });
    return res.status(200).json({ ok: true, messages: JSON.parse(txt) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
