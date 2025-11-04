import { ensureSchema, queryNews } from '../src/db.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
    await ensureSchema();
    const { q, limit, offset } = req.query || {};
    const lim = Math.min(parseInt(limit || '20', 10), 100);
    const off = parseInt(offset || '0', 10);
    const rows = await queryNews({ q, limit: lim, offset: off });
    res.status(200).json({ ok: true, count: rows.length, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
