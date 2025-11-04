import { XMLParser } from 'fast-xml-parser';

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

function toStr(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'object') return x.title || x.name || x.text || x.url || JSON.stringify(x);
  return String(x);
}

function getHostname(u) {
  try {
    const h = new URL(u).hostname || '';
    return h.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

async function resolveOriginalUrl(url, timeout = 1500) {
  try {
    // Try to resolve redirect without downloading the body
    const res = await fetchWithTimeout(url, { redirect: 'manual', timeout, headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' } });
    const loc = res.headers && res.headers.get ? res.headers.get('location') : null;
    if (loc && /^https?:\/\//i.test(loc)) return loc;
    // Fallback: follow redirects and read final response URL
    const res2 = await fetchWithTimeout(url, { redirect: 'follow', timeout, headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' } });
    if (res2 && res2.url) return res2.url;
  } catch (_) {}
  return url;
}

function extractOgImageFromHtml(html) {
  try {
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+>/i) || html.match(/<meta[^>]+name=["']og:image["'][^>]+>/i);
    if (m) {
      const tag = m[0];
      const urlMatch = tag.match(/content=["']([^"'>]+)["']/i);
      if (urlMatch && /^https?:\/\//i.test(urlMatch[1])) return urlMatch[1];
    }
    const ld = html.match(/<meta[^>]+property=["']twitter:image["'][^>]+>/i);
    if (ld) {
      const urlMatch = ld[0].match(/content=["']([^"'>]+)["']/i);
      if (urlMatch && /^https?:\/\//i.test(urlMatch[1])) return urlMatch[1];
    }
    // crude fallback: first img src
    const img = html.match(/<img[^>]+src=["']([^"'>]+)["']/i);
    if (img && /^https?:\/\//i.test(img[1])) return img[1];
  } catch (_) {}
  return null;
}

async function fetchOgImage(url, timeout = 1500) {
  try {
    const res = await fetchWithTimeout(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' } });
    const html = await res.text();
    return extractOgImageFromHtml(html);
  } catch (_) {
    return null;
  }
}

function first(val) {
  if (val == null) return null;
  return Array.isArray(val) ? (val[0] || null) : val;
}

function extractImageUrlFromItem(it) {
  // media:content or media:thumbnail or enclosure variants
  const medias = [];
  if (it['media:content']) medias.push(...(Array.isArray(it['media:content']) ? it['media:content'] : [it['media:content']]));
  if (it['media:thumbnail']) medias.push(...(Array.isArray(it['media:thumbnail']) ? it['media:thumbnail'] : [it['media:thumbnail']]));
  if (it.enclosure) medias.push(...(Array.isArray(it.enclosure) ? it.enclosure : [it.enclosure]));
  if (it['media:group'] && it['media:group']['media:content']) {
    const mg = it['media:group']['media:content'];
    medias.push(...(Array.isArray(mg) ? mg : [mg]));
  }
  for (const m of medias) {
    const url = m && (m.url || m.href || m.link);
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      return url;
    }
  }
  // try to find image URL inside description HTML
  const desc = toStr(it.description || it.summary || '');
  const imgMatch = desc.match(/https?:[^\"'\s>]+\.(?:png|jpe?g|webp)/i);
  if (imgMatch) return imgMatch[0];
  return null;
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

/* removed: tryExtractArticle (cheerio-based) */
function tryExtractArticle() { return {}; }

export async function scrapeGowaPositiveNews(opts = {}) {
  const qRaw = typeof opts === 'string' ? opts : opts.q;
  const q = qRaw ? encodeURIComponent(qRaw) : encodeURIComponent('\"Dinas Pendidikan Kabupaten Gowa\" OR \"Disdik Gowa\"');
  const q2 = encodeURIComponent('Pendidikan Gowa');
  const sources = qRaw ? [
    `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`
  ] : [
    `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`,
    `https://news.google.com/rss/search?q=${q2}&hl=id&gl=ID&ceid=ID:id`
  ];
  const TARGET_ITEMS = 10; // aim to return at least 10 latest items
  const MAX_ITEMS = 30; // collect up to 30 before slicing to latest 10
  const collected = [];
  for (const url of sources) {
    try {
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' }, timeout: 5000 });
      const xml = await res.text();
      const parsed = parseRss(xml);
      for (const it of parsed || []) {
        const link = it.link?.href || it.link || (it.source && it.source.url) || null;
        const pub = it.pubDate || it.published || it.updated;
        const title = it.title?.["#text"] || it.title || '';
        const description = it.description || it.summary || '';
        const image_url = extractImageUrlFromItem(it);
        const source = toStr(it.source) || it['dc:creator'] || (link ? getHostname(link) : undefined);
        const published_at = (pub && !isNaN(Date.parse(pub))) ? new Date(pub) : null;
        const candidate = { url: link, title, description, published_at, source, image_url };
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

  // De-dup
  const unique = Array.from(new Map(collected.map(it => [it.url, it])).values());

  // 1) Resolve original source URLs for ALL Google News links first
  for (let i = 0; i < unique.length; i++) {
    const it = unique[i];
    if (it.url && /news\.google\.com\/rss\/articles\//.test(it.url)) {
      it.url = await resolveOriginalUrl(it.url, 1500);
    }
  }

  // 2) Enrich up to 10 items missing image_url using og:image from source page
  for (let i = 0, enriched = 0; i < unique.length && enriched < 10; i++) {
    const it = unique[i];
    if (!it.image_url && it.url) {
      const img = await fetchOgImage(it.url, 1200);
      if (img) { it.image_url = img; enriched++; }
    }
  }

  const items = unique
    .sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, TARGET_ITEMS)
    .map(candidate => ({
      url: candidate.url,
      title: candidate.title,
      summary: candidate.description,
      source: candidate.source || (candidate.url ? getHostname(candidate.url) : undefined),
      published_at: candidate.published_at,
      image_url: candidate.image_url || null
    }));

  return items;
}
