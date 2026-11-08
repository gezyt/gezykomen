# Panduan Pasang Waline di VPS untuk Blog Pak Gun

Tujuan: server komentar Waline jalan di VPS Pak Gun sendiri, supaya
pengunjung bisa berkomentar cukup dengan mengisi nama (tanpa login), dan
Pak Gun sebagai admin bisa menghapus komentar lewat dasbor.

Yang dipakai di sini — bukan lagi jalur Vercel + Neon dari panduan lama
(28 Okt 2026):

- **Sistem komentar:** Waline (tetap sama)
- **Server:** VPS Pak Gun, `129.226.95.14`
- **Database:** MariaDB 11.8.6 yang sudah ada di VPS itu
- **Alamat server komentar:** `https://komentar.pakgun.web.id`
- **Blog:** https://site.pakgun.web.id

Panduan resmi Waline (kalau ada tombol atau tampilan yang berbeda, lihat
di sini):

- Deploy di server sendiri: https://waline.js.org/en/guide/deploy/vps.html
- Database yang didukung: https://waline.js.org/en/guide/database.html
- Kode sumber Waline: https://github.com/walinejs/waline

---

## Yang perlu disiapkan sebelum mulai

- Akses SSH ke VPS `129.226.95.14` (user `ubuntu`, seperti biasa).
- Akses DNS zona `pakgun.web.id` untuk membuat subdomain.
- Docker dan Docker Compose sudah terpasang di VPS. Kalau belum, cek
  dulu dengan `docker --version` dan `docker compose version` — kalau
  belum ada, instal dulu sebelum lanjut.
- MariaDB sudah jalan di VPS (`mariadb.service` aktif, `enabled`).
  Jangan instal MariaDB baru.

---

## Langkah 1 — Buat subdomain

1. Buka DNS zona `pakgun.web.id`.
2. Buat record A baru:
   - Nama: `komentar`
   - Nilai: `129.226.95.14`
3. Tunggu beberapa menit, lalu cek dari laptop:
   ```bash
   dig +short komentar.pakgun.web.id
   ```
   Harus menjawab `129.226.95.14`.

Jangan pakai alamat IP langsung sebagai alamat server komentar, misal
`http://129.226.95.14:8360` — blog Bapak HTTPS, browser akan memblokirnya
(mixed content), dan tanpa HTTPS pula.

---

## Langkah 2 — Buat database dan user Waline di MariaDB

Satu server MariaDB melayani banyak aplikasi lewat database dan user yang
berbeda. GezyCBT memakai database `gezycbt`. Waline memakai database dan
user sendiri: `waline` / `waline`. Jangan memakai database atau user
GezyCBT, dan jangan memakai user `root` untuk aplikasi.

Di VPS, masuk ke MariaDB:

```bash
sudo mariadb
```

Lalu jalankan perintah ini di dalam MariaDB (ganti kata sandi contoh
dengan kata sandi baru yang kuat, dan catat kata sandi itu — nanti
dipakai lagi di Langkah 4):

```sql
CREATE DATABASE waline CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'waline'@'localhost' IDENTIFIED BY 'ISI-KATA-SANDI-BARU-DI-SINI';
GRANT ALL PRIVILEGES ON waline.* TO 'waline'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

---

## Langkah 3 — Impor struktur tabel Waline

Untuk MySQL/MariaDB, tabel Waline tidak dibuat otomatis — harus diimpor
dulu dari berkas `waline.sql`.

Berkas itu sudah ada di repo ini (`waline.sql`, disalin dari repo resmi
Waline). Kalau mau mengambil yang terbaru dari sumber resmi:

```bash
curl -L -o /tmp/waline.sql https://raw.githubusercontent.com/walinejs/waline/main/assets/waline.sql
```

Lalu impor ke database `waline`:

```bash
mariadb waline < waline.sql
```

Periksa hasilnya — harus ada 3 tabel:

```bash
mariadb -e "SHOW TABLES FROM waline;"
```

Harus tampil: `wl_Comment`, `wl_Counter`, `wl_Users`.

Kalau impor gagal, yang kena hanya database `waline` yang masih kosong.
GezyCBT tidak ikut kena.

---

## Langkah 4 — Siapkan folder dan `.env` di VPS

1. Clone repo ini di VPS (atau salin berkas-berkasnya ke VPS):

   ```bash
   git clone https://github.com/gezyt/waline.git /opt/waline
   cd /opt/waline
   ```

2. Salin contoh `.env`, lalu isi nilai aslinya:

   ```bash
   cp .env.example .env
   nano .env
   ```

   Isi yang wajib diganti:

   - `MYSQL_PASSWORD` — kata sandi user `waline` dari Langkah 2.
   - `JWT_TOKEN` — string acak yang panjang. Buat dengan:
     ```bash
     openssl rand -hex 32
     ```
     Tempel hasilnya ke `JWT_TOKEN`. Ini bukan kata sandi admin, ini
     token rahasia untuk login Waline.
   - `AUTHOR_EMAIL` — email Pak Gun.

   Jangan commit berkas `.env` yang sudah terisi ke Git.

---

## Langkah 5 — Jalankan Waline

Di folder `/opt/waline`:

```bash
docker compose up -d
docker compose ps
docker compose logs -f waline
```

Cek dari VPS sendiri — harus menjawab (halaman Waline atau JSON):

```bash
curl http://127.0.0.1:8360
```

Catatan penting soal jaringan: MariaDB hanya mendengarkan di
`127.0.0.1:3306`. Kalau Waline jalan di dalam Docker dengan jaringan
biasa, `127.0.0.1` di dalam container itu bukan VPS-nya, melainkan
container itu sendiri — koneksi ke MariaDB akan gagal. Karena itu
`docker-compose.yml` di repo ini memakai `network_mode: host`, supaya
`127.0.0.1` di dalam container benar-benar menunjuk ke MariaDB VPS.
Jangan hapus baris itu tanpa menggantinya dengan cara lain
(misal `host.docker.internal`).

Kalau container langsung berhenti, baca log-nya dulu
(`docker compose logs waline`) — biasanya kata sandi database salah,
atau tabel belum diimpor (Langkah 3 belum dilakukan).

---

## Langkah 6 — Arahkan subdomain lewat Caddy

Tambahkan blok di `Caddyfile.contoh` ke Caddyfile di VPS:

```caddy
komentar.pakgun.web.id {
    reverse_proxy 127.0.0.1:8360
}
```

Lalu reload Caddy:

```bash
sudo systemctl reload caddy
```

Caddy otomatis mengurus sertifikat HTTPS untuk subdomain itu, seperti
domain lain di VPS ini. Buka `https://komentar.pakgun.web.id` di
browser — harus tampil halaman Waline, bukan error.

---

## Langkah 7 — Daftar akun admin (lakukan segera!)

1. Buka `https://komentar.pakgun.web.id/ui/register`
2. Daftarkan akun: nama, email, dan kata sandi.
3. **Pendaftar pertama otomatis menjadi administrator**, jadi pastikan
   Pak Gun yang mendaftar pertama, bukan orang lain.
4. Simpan baik-baik email dan kata sandi admin itu. Jangan dibagikan
   ke siapa pun.
5. Untuk mengelola komentar nanti, login di
   `https://komentar.pakgun.web.id/ui`. Di dasbor itu Pak Gun bisa
   menghapus, menyembunyikan, atau menandai komentar.

---

## Langkah 8 — Sambungkan ke blog

Setelah server komentar jalan dan admin terdaftar:

1. Di config blog (`config/_default/params.toml`), isi:
   ```toml
   serverURL = "https://komentar.pakgun.web.id"
   ```
   di bagian Waline, dan matikan Utterances supaya kotak komentarnya
   cuma satu.
2. Uji build Hugo, commit, push.
3. Verifikasi live: buka satu artikel di https://site.pakgun.web.id,
   kotak komentar Waline harus tampil di bawah artikel, dan uji kirim
   satu komentar.

Bagian ini dikerjakan Gezymuse setelah Pak Gun mengirim alamat server
dan konfirmasi admin sudah terdaftar.

---

## Backup

Komentar tersimpan di MariaDB, database `waline`. Backup dengan:

```bash
mysqldump waline > /tempat-backup/waline-$(date +%F).sql
```

Simpan berkas backup di lokasi permanen, bukan di `/tmp` (isi `/tmp`
bisa hilang kalau VPS di-reboot).

---

## Kalau ada masalah

| Gejala | Periksa dulu |
|---|---|
| Container Waline langsung berhenti | `docker compose logs waline` — kata sandi salah, atau tabel belum diimpor |
| `curl http://127.0.0.1:8360` gagal | Apakah container jalan (`docker compose ps`)? Apakah port 8360 dipakai aplikasi lain? |
| Subdomain tidak bisa dibuka | Apakah DNS sudah menjawab `129.226.95.14`? Apakah Caddy sudah di-reload? |
| Kotak komentar tidak tampil di blog | Apakah `serverURL` di `params.toml` sudah `https://komentar.pakgun.web.id` (HTTPS, bukan IP)? Apakah Utterances masih aktif? |
| Tidak bisa login admin | Apakah yang daftar pertama memang Pak Gun? Pendaftar pertama itulah adminnya. |

Kalau ada langkah yang tampilannya berbeda dari panduan ini, kirim
tangkapan layarnya ke Gezymuse, nanti dipandu dari sana.
