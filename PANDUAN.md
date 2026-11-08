# Panduan GezyKomen — sistem komentar simpel untuk blog Pak Gun

GezyKomen menggantikan Waline. Dibuat sendiri, simpel saja, mengikuti
pola GezyView: Bun + SQLite, satu proses, tanpa dependensi, tanpa
Docker, tanpa MariaDB.

- **Blog:** https://site.pakgun.web.id dan https://pakgun.gezytech.web.id
- **Layanan komentar:** https://komentar.pakgun.web.id
- **VPS:** `129.226.95.14`, port `3102`

## Syarat yang dipenuhi

- Pengunjung berkomentar **tanpa login**, cukup isi nama (2–50 karakter)
  dan komentar (1–1000 karakter).
- Pak Gun sebagai admin bisa **menyembunyikan dan menghapus** komentar
  lewat halaman `/admin`.
- Komentar tampil di bawah tiap artikel blog.

## Yang tidak ada (sengaja, supaya simpel)

Tidak ada emoji/reaction, tidak ada Markdown, tidak ada login sosial,
tidak ada notifikasi email. Kalau nanti butuh, ditambah belakangan.

## Cara kerja singkat

1. Blog memuat `widget.js` dari `komentar.pakgun.web.id`.
2. Widget mengambil daftar komentar (`GET /api/comments?path=...`)
   dan mengirim komentar baru (`POST /api/comments`).
3. Komentar tersimpan di SQLite satu berkas di VPS.
4. Admin masuk ke `/admin`, menyembunyikan/menampilkan/menghapus.

Keamanan dasar: isi komentar dirender dengan `textContent` (bukan
`innerHTML`), jadi HTML/` <script>` dari pengunjung tidak pernah jalan.
Rate limit: maks 5 komentar per IP per 10 menit, jeda minimal 10 detik.
IP tidak disimpan mentah, hanya hash. CORS hanya mengizinkan dua origin
blog di atas.

## Deploy

Ikuti `DEPLOY.md` langkah demi langkah (DNS → clone ke `/opt/waline`
→ buat akun admin → systemd → Nginx → curl uji → pasang widget di blog).

## Integrasi blog

Di repo blog, buat override `layouts/_partials/comment.html` yang
menggantikan partial komentar tema DoIt dengan widget GezyKomen
(sehingga Waline/Utterances tidak tampil lagi, tanpa mengubah tema):

```html
<div id="gezykomen" data-path="{{ .RelPermalink }}"></div>
<link rel="stylesheet" href="https://komentar.pakgun.web.id/widget.css">
<script src="https://komentar.pakgun.web.id/widget.js"></script>
```

## Kalau ada masalah

| Gejala | Periksa dulu |
|---|---|
| `curl http://127.0.0.1:3102/health` gagal | Apakah service jalan (`sudo systemctl status gezykomen`)? Apakah port 3102 dipakai aplikasi lain? |
| Subdomain tidak bisa dibuka | Apakah DNS sudah menjawab `129.226.95.14`? Apakah Nginx sudah di-reload (`sudo nginx -t && sudo systemctl reload nginx`)? |
| Kotak komentar tidak tampil di blog | Apakah `data-path` terisi path artikel? Apakah Waline/Utterances masih aktif? |
| Kirim komentar ditolak 429 | Itu rate limit: tunggu 10 detik, atau maks 5 komentar per 10 menit per IP. |
| Tidak bisa masuk `/admin` | Akun dibuat lewat `bun scripts/create-user.ts` di server? Kata sandi benar? |

Kalau ada langkah yang tampilannya berbeda dari panduan ini, kirim
tangkapan layarnya ke Gezymuse, nanti dipandu dari sana.
