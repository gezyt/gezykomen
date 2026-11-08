# Waline untuk Blog Pak Gun — deploy di VPS

Repo ini **bukan** kode sumber Waline. Ini repo deploy milik Pak Gun untuk
menjalankan server komentar Waline di VPS sendiri.

- **Kode Waline resmi:** https://github.com/walinejs/waline
- **Gambar Docker resmi:** `lizheming/waline:latest`
- **Dokumentasi resmi:** https://waline.js.org

## Yang dipakai di sini

- Blog: https://site.pakgun.web.id (Hugo, di VPS yang sama)
- Server komentar: https://komentar.pakgun.web.id
- VPS: `129.226.95.14`
- Database: MariaDB 11.8.6 yang sudah ada di VPS itu (dipakai juga oleh
  GezyCBT) — Waline memakai database + user sendiri, `waline` / `waline`.
- Syarat yang ditetapkan Pak Gun: pengunjung berkomentar **tanpa login**,
  cukup isi nama; Pak Gun sebagai admin bisa menghapus komentar.

## Isi repo

| Berkas | Guna |
|---|---|
| `PANDUAN.md` | Panduan lengkap, langkah demi langkah, bahasa pemula |
| `docker-compose.yml` | Menjalankan Waline (Docker) |
| `.env.example` | Contoh isi `.env` — salin jadi `.env`, lalu isi kata sandi asli |
| `Caddyfile.contoh` | Potongan Caddy untuk `komentar.pakgun.web.id` |
| `waline.sql` | Struktur tabel Waline untuk MySQL/MariaDB (disalin dari repo resmi Waline, 8 Nov 2026) |

## Cara singkat

Baca `PANDUAN.md` dari atas sampai bawah. Urutannya:

1. Buat DNS `komentar.pakgun.web.id` → `129.226.95.14`.
2. Buat database + user `waline` di MariaDB, lalu impor `waline.sql`.
3. Salin `.env.example` jadi `.env`, isi kata sandi dan `JWT_TOKEN`.
4. `docker compose up -d`, cek `curl http://127.0.0.1:8360`.
5. Tambahkan blok di `Caddyfile.contoh` ke Caddy VPS, lalu reload Caddy.
6. Daftar admin pertama di `https://komentar.pakgun.web.id/ui/register`
   — pendaftar pertama otomatis jadi administrator, jadi harus Pak Gun
   sendiri yang daftar pertama.
7. Isi `serverURL` Waline di config blog, matikan Utterances, rebuild blog.

Jangan pakai alamat IP langsung (`http://129.226.95.14:8360`) sebagai
`serverURL` — blog HTTPS akan memblokirnya (mixed content).
