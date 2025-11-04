# API Berita Positif Disdik Kabupaten Gowa

API serverless untuk mengumpulkan (scrape) dan menyajikan berita online bernuansa positif terkait Dinas Pendidikan Kabupaten Gowa. Siap dideploy di Vercel dan menggunakan PostgreSQL sebagai database.

## Fitur
- Endpoint `GET /api/news` untuk mengambil berita dengan pencarian dan pagination
- Endpoint `GET|POST /api/scrape` untuk menjalankan scraping Google News RSS dan simpan ke database
- Endpoint `GET /api/health` untuk healthcheck
- Otomatis membuat tabel `news` jika belum ada

## Teknologi
- Node.js runtime Vercel (serverless functions)
- PostgreSQL (`pg`)
- Scraping dari Google News RSS (`fast-xml-parser`)

## Struktur
```
├─ api/
│  ├─ news.js
│  ├─ scrape.js
│  └─ health.js
├─ src/
│  ├─ db.js
│  └─ scraper.js
├─ vercel.json
├─ package.json
├─ .env.example
└─ README.md
```

## Deploy ke Vercel
1) Import project dari GitHub ke Vercel
- Root Directory: biarkan default (root repo)
- Framework Preset: Other
- Build Command: kosongkan
- Output Directory: kosongkan

2) Environment Variables
- DATABASE_URL = connection string PostgreSQL Anda (mis. Neon/Vercel Postgres/Supabase)
- Jangan set PGSSLMODE kecuali koneksi non-SSL lokal (Neon default sslmode=require sudah kompatibel)

3) Security (Deployment Protection)
- Jika API harus publik: Project → Settings → Security → Authentication/Deployment Protection → Disabled

4) Verifikasi endpoint
- GET /api/health → 200
- GET /api/news → 200 (awal mungkin kosong)
- POST /api/scrape → isi data dari RSS ke DB

Troubleshooting umum
- 404 di semua endpoint: cek Root Directory sudah root, bukan subfolder
- Error Cron limit: hapus blok `crons` di vercel.json (repo ini sudah tanpa cron). Gunakan GitHub Actions (lihat bawah)
- Error Cheerio export: repo ini tidak lagi memakai cheerio untuk menghindari masalah ESM di serverless


## Penggunaan
- Memicu scraping dan simpan ke DB:
  - `POST /api/scrape`
  - atau `GET /api/scrape` (idempotent)
- Mengambil berita:
  - `GET /api/news?q=prestasi&limit=20&offset=0`

## Penjadwalan tanpa Cron Vercel (GitHub Actions)
- Repo ini menyertakan workflow `.github/workflows/daily_scrape.yml`
- Tambahkan Repository secret `SCRAPE_URL` berisi URL penuh endpoint scrape, contoh:
  - `https://<deployment-domain>/api/scrape`
- Workflow akan memanggil endpoint setiap hari pukul 02:00 UTC dan bisa dijalankan manual (workflow_dispatch)


## Catatan Filter "Positif"
- Filter berbasis kata kunci positif/negatif sederhana di `src/scraper.js`.
- Hanya berita yang memuat kata kunci terkait Gowa/Disdik Gowa yang akan dipertimbangkan.
- Silakan sesuaikan daftar kata kunci sesuai kebutuhan.

## Pengembangan Lokal
- Pastikan Node.js 20+.
- Install dependencies: `npm install`
- Jalankan dev via Vercel CLI (opsional): `npm run dev`

