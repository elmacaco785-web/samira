const SUPABASE_URL = 'https://fbojmxiwvubepoywdhhc.supabase.co';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) return res.status(503).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not set on Vercel' });

  const p = req.body && typeof req.body === 'object' ? req.body : {};
  const session_id = String(p.session_id || '').trim();
  const sender = String(p.sender || 'user').trim();
  const body = String(p.body || '').trim();
  if (!session_id || !body) return res.status(400).json({ ok: false, error: 'session_id and body required' });
  if (sender !== 'user' && sender !== 'admin') return res.status(400).json({ ok: false, error: 'invalid sender' });

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
    const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    const txt = await r.text();
    if (!r.ok) return res.status(502).json({ ok: false, error: 'persist failed', detail: txt });
    const arr = JSON.parse(txt || '[]');
    return res.status(200).json({ ok: true, message: arr[0] || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
