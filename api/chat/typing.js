// Typing indicator — graceful no-op on Vercel (in-memory state
// doesn't survive across serverless invocations).
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'POST') return res.status(200).json({ ok: true });
  if (req.method === 'GET') return res.status(200).json({ ok: true, is_typing: false });
  return res.status(405).json({ ok: false, error: 'method not allowed' });
};
