import { ensureSchema, upsertNews } from '../src/db.js';
import { scrapeGowaPositiveNews } from '../src/scraper.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
    await ensureSchema();
    const items = await scrapeGowaPositiveNews();
    const result = await upsertNews(items);
    res.status(200).json({ ok: true, scraped: items.length, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
