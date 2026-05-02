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
  const session_id = String(p.session_id || '');
  const who = p.who === 'admin' ? 'admin' : 'user';
  if (!session_id) return res.status(400).json({ ok: false, error: 'session_id required' });

  const senderToMark = who === 'user' ? 'admin' : 'user';
  const col = who === 'user' ? 'read_by_user' : 'read_by_admin';
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${encodeURIComponent(session_id)}&sender=eq.${senderToMark}&${col}=eq.false`,
      { method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ [col]: true }) }
    );
    return res.status(200).json({ ok: r.ok });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
