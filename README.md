# API Berita Positif Disdik Kabupaten Gowa

API serverless untuk mengumpulkan (scrape) dan menyajikan berita online bernuansa positif terkait Dinas Pendidikan Kabupaten Gowa. Siap dideploy di Vercel dan menggunakan PostgreSQL sebagai database.

## Fitur
- Endpoint `GET /api/news` untuk mengambil berita dengan pencarian dan pagination
- Endpoint `GET|POST /api/scrape` untuk menjalankan scraping Google News RSS dan simpan ke database
- Endpoint `GET /api/health` untuk healthcheck
- Otomatis membuat tabel `news` jika belum ada

## Teknologi
- Node.js runtime Vercel (nodejs20.x)
- PostgreSQL (`pg`)
- Scraping dari Google News RSS (`fast-xml-parser`) dan ekstraksi meta halaman (`cheerio`)

## Struktur
```
api berita positif disdik/
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
1. Buat database PostgreSQL (contoh: Vercel Postgres/Neon/Supabase).
2. Dapatkan `DATABASE_URL` dari penyedia.
3. Di project Vercel Anda, buka Settings -> Environment Variables dan tambahkan:
   - `DATABASE_URL` = connection string database Anda.
   - Opsional: `PGSSLMODE=disable` hanya jika koneksi lokal tanpa SSL.
4. Push repo ini ke GitHub/GitLab dan import ke Vercel, atau gunakan `vercel` CLI.
5. Deploy. Endpoint yang tersedia misalnya:
   - `GET https://<your-deployment>/api/news`
   - `POST https://<your-deployment>/api/scrape`

## Penggunaan
- Memicu scraping dan simpan ke DB:
  - `POST /api/scrape`
  - atau `GET /api/scrape` (idempotent)
- Mengambil berita:
  - `GET /api/news?q=prestasi&limit=20&offset=0`

## Catatan Filter "Positif"
- Filter berbasis kata kunci positif/negatif sederhana di `src/scraper.js`.
- Hanya berita yang memuat kata kunci terkait Gowa/Disdik Gowa yang akan dipertimbangkan.
- Silakan sesuaikan daftar kata kunci sesuai kebutuhan.

## Pengembangan Lokal
- Pastikan Node.js 20+.
- Install dependencies: `npm install`
- Jalankan dev via Vercel CLI (opsional): `npm run dev`

