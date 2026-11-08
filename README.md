# GezyKomen — sistem komentar simpel untuk blog Pak Gun

Menggantikan Waline. Dibuat sendiri, simpel saja: pengunjung berkomentar
tanpa login, Pak Gun sebagai admin bisa menyembunyikan dan menghapus
komentar.

- **Blog:** https://site.pakgun.web.id (dan https://pakgun.gezytech.web.id)
- **Layanan komentar:** https://komentar.pakgun.web.id
- **VPS:** `129.226.95.14`
- **Stack:** Bun + Bun.serve + bun:sqlite (WAL), **tanpa dependensi luar**,
  satu proses, satu berkas `server.ts` — pola yang sama seperti GezyView.
- **Database:** SQLite satu berkas `data/gezykomen.db` (cukup disalin
  untuk backup). Tidak pakai MariaDB, tidak pakai Docker.
- **Port:** 3102 (3100 GezyBoard, 3101 GezyView/PapanTulis — jangan dipakai)

## Fitur MVP

- Publik tanpa login: lihat daftar komentar per artikel, kirim komentar
  (nama 2–50 karakter, isi 1–1000 karakter). Rate limit: maks 5 komentar
  per IP per 10 menit, jeda minimal 10 detik antar kirim. IP tidak
  disimpan mentah, hanya hash.
- Balasan (reply): tiap komentar utama punya tombol Balas; balasan
  tampil menjorok di bawah induknya, satu tingkat saja (balasan untuk
  balasan ditolak). Balasan ikut tersembunyi bila induk disembunyikan;
  hapus induk ikut menghapus balasannya.
- Admin: login satu akun (tanpa registrasi publik, akun dibuat lewat
  `bun scripts/create-user.ts`), halaman `/admin` untuk melihat semua
  komentar termasuk yang disembunyikan, tombol Sembunyikan / Tampilkan /
  Hapus (hapus permanen).
- Widget blog: `public/widget.js` + `public/widget.css`. Blog cukup
  pasang:
  ```html
  <div id="gezykomen" data-path="/slug-artikel/"></div>
  <link rel="stylesheet" href="https://komentar.pakgun.web.id/widget.css">
  <script src="https://komentar.pakgun.web.id/widget.js"></script>
  ```
  Isi komentar dirender dengan `textContent`, bukan `innerHTML`, supaya
  HTML/` <script>` dari pengunjung tidak pernah jalan.

## Isi repo

| Berkas | Guna |
|---|---|
| `server.ts` | Seluruh layanan (API + widget + halaman admin) |
| `public/widget.js`, `public/widget.css` | Widget yang dipasang di blog |
| `scripts/create-user.ts` | Buat akun admin: `bun scripts/create-user.ts <username> <password>` |
| `tests/gezykomen.test.ts` | Uji otomatis (`bun test` — 15 uji) |
| `gezykomen.service` | Unit systemd untuk VPS (salt dari `/etc/gezykomen.env`) |
| `nginx-gezykomen.conf.contoh` | Potongan Nginx untuk `komentar.pakgun.web.id` |
| `.env.example` | Contoh isi `/etc/gezykomen.env` |
| `DEPLOY.md` | Panduan deploy VPS langkah demi langkah |
| `PANDUAN.md` | Panduan lengkap + integrasi blog |

## Uji

```bash
bun test   # 15 pass, 0 fail
```

## Deploy

Baca `DEPLOY.md` dari atas sampai bawah. Urutannya: DNS
`komentar.pakgun.web.id` → `129.226.95.14`, clone ke `/opt/waline`,
buat akun admin, systemd enable, Nginx reload, curl uji, lalu pasang
widget di blog (override `layouts/_partials/comment.html` di repo
blog, menggantikan Waline/Utterances).
