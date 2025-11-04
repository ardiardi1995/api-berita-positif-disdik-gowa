import { ensureSchema, upsertNews } from '../src/db.js';
import { scrapeGowaPositiveNews } from '../src/scraper.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
    await ensureSchema();
    const q = req.query?.q || undefined;
    const mode = req.query?.mode || undefined;
    const items = await scrapeGowaPositiveNews({ ...(q ? { q } : {}), ...(mode ? { mode } : {}) });
    if (req.query && (req.query.dryrun === '1' || req.query.preview === '1')) {
      res.status(200).json({ ok: true, scraped: items.length, preview: items.slice(0, 10) });
      return;
    }
    const result = await upsertNews(items);
    res.status(200).json({ ok: true, scraped: items.length, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
