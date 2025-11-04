#!/usr/bin/env node
// Scrape Google News HTML (tbm=nws) to get publisher URLs, fetch og:image and publish date,
// then upsert into DB using existing db helpers.
// Usage: node tools/scrape_google_html.js --query "<your query>" --limit 20

import { ensureSchema, upsertNews } from '../src/db.js';

const DEFAULT_QUERY = '"Dinas Pendidikan Kabupaten Gowa" OR "Disdik Gowa"';
const LIMIT = Number(process.env.LIMIT || 20);

function arg(name, def = undefined) {
  const i = process.argv.findIndex(a => a === `--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(resource, { ...rest, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

function normalizeTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNewsCards(html) {
  // Extract anchor with /url?q=<publisher_url> and capture visible title text
  const items = [];
  const reA = /<a[^>]+href=\"\/url\?q=([^\"&]+)[^\"]*\"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = reA.exec(html)) && items.length < 100) {
    try {
      const url = decodeURIComponent(m[1]);
      if (!/^https?:\/\//i.test(url) || /news\.google\.com\//.test(url)) continue;
      const titleHtml = m[2] || '';
      const title = normalizeTitle(titleHtml);
      if (!title) continue;
      items.push({ title, url });
    } catch (_) {}
  }
  // Fallback: older format
  if (items.length === 0) {
    const re2 = /<a[^>]+href=\"\/url\?url=([^\"&]+)[^\"]*\"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = re2.exec(html)) && items.length < 100) {
      try {
        const url = decodeURIComponent(m[1]);
        if (!/^https?:\/\//i.test(url) || /news\.google\.com\//.test(url)) continue;
        const titleHtml = m[2] || '';
        const title = normalizeTitle(titleHtml);
        if (!title) continue;
        items.push({ title, url });
      } catch (_) {}
    }
  }
  return items;
}

async function fetchGoogleNewsHtml(query, timeout = 8000) {
  const url = `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, {
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  return await res.text();
}

function extractMeta(html, nameOrProp) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${nameOrProp}["'][^>]+>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  const c = m[0].match(/content=["']([^"'>]+)["']/i);
  return c ? c[1] : null;
}

function extractFirstImg(html) {
  const m = html.match(/<img[^>]+src=["']([^"'>]+)["']/i);
  return m ? m[1] : null;
}

function parsePublishDate(html) {
  // Try common meta tags
  const keys = [
    'article:published_time',
    'og:updated_time',
    'og:published_time',
    'date',
    'pubdate',
    'publish-date'
  ];
  for (const k of keys) {
    const v = extractMeta(html, k);
    if (v && !isNaN(Date.parse(v))) return new Date(v);
  }
  // Try time tag
  const t = html.match(/<time[^>]+datetime=["']([^"'>]+)["'][^>]*>/i);
  if (t && t[1] && !isNaN(Date.parse(t[1]))) return new Date(t[1]);
  return null;
}

async function fetchPublisherInfo(url) {
  try {
    const res = await fetchWithTimeout(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    const html = await res.text();
    const image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image') || extractFirstImg(html);
    const pubDate = parsePublishDate(html);
    const title = extractMeta(html, 'og:title') || null;
    return { image_url: image || null, published_at: pubDate || null, titleFromOg: title };
  } catch (_) {
    return { image_url: null, published_at: null, titleFromOg: null };
  }
}

function getHostname(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function toStr(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'object') return x.title || x.name || x.text || x.url || JSON.stringify(x);
  return String(x);
}

async function main() {
  const query = process.env.QUERY || arg('query', DEFAULT_QUERY);
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL env. Set it in GitHub Actions secrets.');
    process.exit(1);
  }
  console.log('Scraping Google News HTML for:', query);
  const html = await fetchGoogleNewsHtml(query);
  const cards = extractNewsCards(html);
  console.log(`Found ${cards.length} cards`);
  const tasks = cards.slice(0, LIMIT);
  const out = [];
  for (let i = 0; i < tasks.length; i++) {
    const c = tasks[i];
    try {
      const info = await fetchPublisherInfo(c.url);
      const published_at = info.published_at || null;
      const source = getHostname(c.url);
      const title = c.title || info.titleFromOg || '';
      const item = {
        url: c.url,
        title,
        description: '',
        source,
        published_at,
        image_url: info.image_url
      };
      out.push(item);
      // tiny delay to be polite
      await sleep(200);
    } catch (e) {
      console.warn('skip card due to error', e?.message || e);
    }
  }

  // ensure minimal 10 newest by published_at (when available)
  const cleaned = Array.from(new Map(out.map(x => [x.url, x])).values())
    .sort((a, b) => (b.published_at ? new Date(b.published_at).getTime() : 0) - (a.published_at ? new Date(a.published_at).getTime() : 0))
    .slice(0, 50);

  console.log(`Upserting ${cleaned.length} items to DB...`);
  await ensureSchema();
  const result = await upsertNews(cleaned);
  console.log('Done:', result);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
