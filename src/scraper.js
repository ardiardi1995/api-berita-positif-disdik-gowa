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
    // Try to resolve HTTP redirects (Location header)
    const res = await fetchWithTimeout(url, { redirect: 'manual', timeout, headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' } });
    const loc = res.headers && res.headers.get ? res.headers.get('location') : null;
    if (loc && /^https?:\/\//i.test(loc)) return loc;

    // Follow redirects to see final response URL (may still be google)
    const res2 = await fetchWithTimeout(url, { redirect: 'follow', timeout, headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' } });
    if (res2 && res2.url && !/news\.google\.com\/rss\/articles\//.test(res2.url)) return res2.url;

    // Some Google News article pages use a meta refresh to the original URL
    const html = await res2.text();
    const m = html && html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"'>]+)["']/i);
    if (m && /^https?:\/\//i.test(m[1])) return m[1];

    // Try canonical link
    const canon = html && html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"'>]+)["']/i);
    if (canon && /^https?:\/\//i.test(canon[1])) return canon[1];
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

async function fetchGoogleNewsHtml(query, timeout = 4000) {
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

function normalizeTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a, b) {
  const as = new Set(normalizeTitle(a).split(' ').filter(x => x.length > 2));
  const bs = new Set(normalizeTitle(b).split(' ').filter(x => x.length > 2));
  if (as.size === 0 || bs.size === 0) return 0;
  let inter = 0;
  for (const w of as) if (bs.has(w)) inter++;
  const union = as.size + bs.size - inter;
  return union ? inter / union : 0;
}

function extractPublisherLinksFromHtml(html) {
  // Extract result cards: title + publisher url
  const items = [];
  // Title anchor elements with /url? or google redirect
  const reA = /<a[^>]+href=\"\/url\?q=([^\"&]+)[^\"]*\"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = reA.exec(html)) && items.length < 50) {
    try {
      const url = decodeURIComponent(m[1]);
      if (!/^https?:\/\//i.test(url) || /news\.google\.com\//.test(url)) continue;
      const titleHtml = m[2] || '';
      const title = normalizeTitle(titleHtml);
      if (!title) continue;
      items.push({ title, url });
    } catch (_) {}
  }
  // Fallback: older format with url=
  if (items.length === 0) {
    const re2 = /<a[^>]+href=\"\/url\?url=([^\"&]+)[^\"]*\"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = re2.exec(html)) && items.length < 50) {
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

/* removed: tryExtractArticle (cheerio-based) */
function tryExtractArticle() { return {}; }

const DEFAULT_RSS_SOURCES = (
  process.env.SOURCES_RSS || [
    'https://gosulsel.com/feed/',
    'https://www.pijarnews.com/feed/',
    'https://www.ujungjari.com/feed/',
    'https://koranmakassar.com/feed/',
    'https://beritakotamakassar.com/feed/'
  ].join(',')
).split(',').map(s => s.trim()).filter(Boolean);

async function fetchRss(url) {
  try {
    const res = await fetchWithTimeout(url, { timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' } });
    const xml = await res.text();
    return parseRss(xml);
  } catch { return []; }
}

async function scrapeFromCuratedSources(targetItems = 10) {
  const KEYWORDS = [
    'dinas pendidikan kabupaten gowa',
    'disdik gowa',
    'pendidikan gowa'
  ];
  const items = [];
  for (const feed of DEFAULT_RSS_SOURCES) {
    const parsed = await fetchRss(feed);
    for (const it of parsed) {
      const link = it.link?.href || it.link || null;
      const title = (it.title?.["#text"] || it.title || '').toString();
      const description = (it.description || it.summary || '').toString();
      const text = (title + ' ' + description).toLowerCase();
      if (!KEYWORDS.some(k => text.includes(k))) continue;
      const pub = it.pubDate || it.published || it.updated;
      const published_at = (pub && !isNaN(Date.parse(pub))) ? new Date(pub) : null;
      const image_url = extractImageUrlFromItem(it) || null;
      items.push({ url: link, title, description, published_at, source: link ? getHostname(link) : undefined, image_url });
    }
  }
  // Enrich via publisher pages for up to 10 items missing image_url or published_at
  const needEnrich = items.filter(it => !it.image_url || !it.published_at).slice(0, 10);
  for (const it of needEnrich) {
    if (!it.url) continue;
    const info = await fetchOgImage(it.url, 2000);
    const res = await fetchWithTimeout(it.url, { timeout: 2000, headers: { 'User-Agent': 'Mozilla/5.0 RovoDevBot' } }).catch(() => null);
    const html = res ? await res.text() : '';
    const img = extractOgImageFromHtml(html) || null;
    if (img) it.image_url = img;
    if (!it.published_at) {
      const t = html.match(/<time[^>]+datetime=["']([^"'>]+)["']/i);
      if (t && !isNaN(Date.parse(t[1]))) it.published_at = new Date(t[1]);
    }
  }
  // Dedup, sort, slice
  const dedup = Array.from(new Map(items.filter(x => x.url).map(x => [x.url, x])).values())
    .sort((a, b) => (b.published_at ? new Date(b.published_at).getTime() : 0) - (a.published_at ? new Date(a.published_at).getTime() : 0))
    .slice(0, Math.max(targetItems, 10));
  return dedup;
}

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

  // If curated sources produce enough, use them directly (publisher URLs + images)
  if (!qRaw) {
    try {
      const curated = await scrapeFromCuratedSources(TARGET_ITEMS);
      if (curated && curated.length >= TARGET_ITEMS) {
        return curated.map(x => ({
          url: x.url,
          title: x.title,
          summary: x.description,
          source: x.source,
          published_at: x.published_at,
          image_url: x.image_url || null
        }));
      }
    } catch (_) {}
  }
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

  // 0) If many are still Google URLs, fallback: fetch Google News HTML to derive publisher URLs
  const needHtmlFallback = unique.some(it => it.url && /news\.google\.com\/rss\/articles\//.test(it.url));
  if (needHtmlFallback) {
    const html = await fetchGoogleNewsHtml(qRaw || 'Dinas Pendidikan Kabupaten Gowa', 4000);
    const pubs = extractPublisherLinksFromHtml(html); // [{title, url}]
    for (const it of unique) {
      if (it.url && /news\.google\.com\/rss\/articles\//.test(it.url)) {
        const t = it.title || '';
        let best = null, bestScore = 0;
        for (const p of pubs) {
          const s = jaccardSimilarity(t, p.title);
          if (s > bestScore) { best = p; bestScore = s; }
        }
        if (best && bestScore >= 0.2) {
          it.url = best.url;
          it.source = getHostname(best.url) || it.source;
        }
      }
    }
  }

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
