import { XMLParser } from 'fast-xml-parser';
import cheerio from 'cheerio';

const positiveKeywords = [
  'sukses', 'penghargaan', 'prestasi', 'apresiasi', 'inovasi', 'juara', 'terbaik',
  'peresmian', 'peningkatan', 'launching', 'diluncurkan', 'kerja sama', 'kolaborasi',
  'kurikulum merdeka', 'beasiswa', 'lulus', 'wisuda', 'terverifikasi', 'akreditasi',
  'pembangunan', 'renovasi', 'bantuan', 'donasi', 'positif', 'berhasil', 'naik'
];

const negativeKeywords = [
  'korupsi', 'kecelakaan', 'bencana', 'demo', 'aksi', 'pungli', 'hoaks', 'hoax',
  'kekerasan', 'bully', 'perkelahian', 'baku hantam', 'baku pukul', 'kriminal',
  'narkoba', 'penipuan', 'negatif', 'turun', 'gagal', 'gugur', 'jatuh', 'mati'
];

const orgKeywords = [
  'dinas pendidikan kabupaten gowa', 'disdik gowa', 'disdik kabupaten gowa',
  'pemkab gowa', 'pendidikan gowa', 'kab gowa'
];

function containsAny(text, list) {
  const t = (text || '').toLowerCase();
  return list.some(k => t.includes(k));
}

function isPositiveForGowa(item) {
  const text = `${item.title || ''} ${item.description || ''}`;
  if (!containsAny(text, orgKeywords)) return false;
  if (containsAny(text, negativeKeywords)) return false;
  return containsAny(text, positiveKeywords) || true; // default to include if related and not negative
}

function parseRss(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const j = parser.parse(xml);
  if (j.rss && j.rss.channel && j.rss.channel.item) {
    return Array.isArray(j.rss.channel.item) ? j.rss.channel.item : [j.rss.channel.item];
  }
  if (j.feed && j.feed.entry) {
    return Array.isArray(j.feed.entry) ? j.feed.entry : [j.feed.entry];
  }
  return [];
}

function fetchWithTimeout(resource, options = {}) {
  const { timeout = 5000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(resource, { ...rest, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

async function tryExtractArticle(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' }, timeout: 5000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDesc = $('meta[property="og:description"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    const title = ogTitle || $('title').first().text();
    const summary = ogDesc || $('p').slice(0, 4).text().trim().replace(/\s+/g, ' ').slice(0, 400);
    return { title, summary, image: ogImage };
  } catch (e) {
    return {};
  }
}

export async function scrapeGowaPositiveNews() {
  const q = encodeURIComponent('\"Dinas Pendidikan Kabupaten Gowa\" OR \"Disdik Gowa\"');
  const sources = [
    `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`,
    `https://news.google.com/rss/search?q=${encodeURIComponent('Pendidikan Gowa')}&hl=id&gl=ID&ceid=ID:id`
  ];
  const MAX_ITEMS = 10; // limit to keep within serverless time budget
  const collected = [];
  for (const url of sources) {
    try {
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' }, timeout: 5000 });
      const xml = await res.text();
      const parsed = parseRss(xml);
      for (const it of parsed) {
        const link = it.link?.href || it.link || (it.source && it.source.url) || null;
        const pub = it.pubDate || it.published || it.updated;
        const title = it.title?.["#text"] || it.title || '';
        const description = it.description || it.summary || '';
        const source = (it.source && (it.source.title || it.source)) || it['dc:creator'] || undefined;
        const published_at = (pub && !isNaN(Date.parse(pub))) ? new Date(pub) : null;
        const candidate = { url: link, title, description, published_at, source };
        if (!candidate.url) continue;
        if (!isPositiveForGowa(candidate)) continue;
        collected.push(candidate);
        if (collected.length >= MAX_ITEMS) break;
      }
      if (collected.length >= MAX_ITEMS) break;
    } catch (_) {
      // ignore feed errors
    }
  }

  const items = [];
  for (const candidate of collected) {
    const extra = await tryExtractArticle(candidate.url);
    items.push({
      url: candidate.url,
      title: extra.title || candidate.title,
      summary: extra.summary || candidate.description,
      source: candidate.source,
      published_at: candidate.published_at,
      image_url: extra.image || null
    });
  }

  // de-duplicate by url
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.url)) map.set(it.url, it);
  }
  return Array.from(map.values());
}
