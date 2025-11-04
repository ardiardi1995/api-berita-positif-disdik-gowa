import pg from 'pg';

const { Pool } = pg;

let cached = globalThis.__dbPool__;

if (!cached) {
  cached = globalThis.__dbPool__ = { pool: null };
}

export function getPool() {
  if (!cached.pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL env var is required');
    }
    cached.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    });
  }
  return cached.pool;
}

export async function ensureSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id BIGSERIAL PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      source TEXT,
      published_at TIMESTAMPTZ,
      image_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_title_gin ON news USING GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(summary,'')));
  `);
}

export async function upsertNews(items) {
  if (!items || items.length === 0) return { inserted: 0, updated: 0 };
  const pool = getPool();
  const values = [];
  const placeholders = [];
  let i = 1;
  for (const it of items) {
    placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    values.push(it.url, it.title, it.summary || null, it.source || null, it.published_at || null, it.image_url || null);
  }
  const sql = `
    INSERT INTO news (url, title, summary, source, published_at, image_url)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      summary = COALESCE(EXCLUDED.summary, news.summary),
      source = COALESCE(EXCLUDED.source, news.source),
      published_at = COALESCE(EXCLUDED.published_at, news.published_at),
      image_url = COALESCE(EXCLUDED.image_url, news.image_url)
  `;
  await pool.query(sql, values);
  return { inserted: items.length };
}

export async function queryNews({ q, limit = 20, offset = 0 }) {
  const pool = getPool();
  const params = [];
  let where = [];
  if (q) {
    params.push(q);
    where.push(`to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(summary,'')) @@ plainto_tsquery('simple', $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);
  params.push(offset);
  const { rows } = await pool.query(
    `SELECT id, url, title, summary, source, image_url, published_at, created_at
     FROM news ${whereSql}
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}
