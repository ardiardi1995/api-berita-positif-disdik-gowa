import { scrapeGowaPositiveNews } from '../src/scraper.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
    const items = await scrapeGowaPositiveNews();
    res.status(200).json({ ok: true, scraped: items.length, sample: items.slice(0, 3) });
  } catch (e) {
    console.error('dryrun error', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
