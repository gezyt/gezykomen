# Deploy GezyKomen di VPS

GezyKomen = sistem komentar simpel untuk blog Pak Gun, menggantikan
Waline. Satu proses Bun + SQLite, tanpa dependensi, tanpa Docker,
tanpa MariaDB.

- Layanan: https://komentar.pakgun.web.id
- VPS: `129.226.95.14`
- Port: `3102`
- Database: `/opt/waline/data/gezykomen.db` (SQLite satu berkas)
- Proxy depan: **Nginx** (bukan Caddy). Salt tinggal di
  `/etc/gezykomen.env`, dibaca service lewat `EnvironmentFile`.

---

## 1. DNS

Buat record A di zona `pakgun.web.id`:

- Nama: `komentar`
- Nilai: `129.226.95.14`

Cek dari laptop:

```bash
dig +short komentar.pakgun.web.id
```

Harus menjawab `129.226.95.14`.

---

## 2. Clone ke VPS

```bash
sudo mkdir -p /opt/waline
sudo chown ubuntu:ubuntu /opt/waline
git clone https://github.com/gezyt/gezykomen.git /opt/waline
cd /opt/waline
```

Catatan: folder di VPS namanya `/opt/waline` (dari nama repo lama
sebelum di-rename jadi `gezykomen`) — biarkan begitu, jangan
pindah-pindah, karena service systemd dan database sudah mengacu ke
sana.

Repo ini `gezyt/gezykomen` (sebelumnya `gezyt/waline`, di-rename 9 Nov 2026).
Jangan tertukar dengan kode Waline resmi (`walinejs/waline`) — repo ini
tidak berisi kode Waline sama sekali.

Pastikan Bun sudah terpasang di VPS (cek `which bun` — samakan path-nya
dengan `ExecStart` di `gezykomen.service`, biasanya `/usr/local/bin/bun`).

---

## 3. Buat akun admin

```bash
cd /opt/waline
bun scripts/create-user.ts pakgun <kata-sandi-admin>
```

Kata sandi minimal 6 karakter. Simpan baik-baik, jangan dibagikan.
Tidak ada registrasi publik — akun admin hanya bisa dibuat lewat
perintah ini di server.

---

## 4. systemd

Buat dulu berkas env (sekali saja; kalau sudah ada dari install
sebelumnya, JANGAN timpa — salt yang sudah jalan harus tetap sama):

```bash
echo "GEZYKOMEN_SALT=$(openssl rand -hex 16)" | sudo tee /etc/gezykomen.env
sudo chmod 600 /etc/gezykomen.env
```

Lalu pasang service:

```bash
sudo cp gezykomen.service /etc/systemd/system/gezykomen.service
# sesuaikan path bun di ExecStart dengan hasil `which bun`
sudo systemctl daemon-reload
sudo systemctl enable --now gezykomen
sudo systemctl status gezykomen
```

Salt TIDAK ditulis di `gezykomen.service` — service membacanya dari
`/etc/gezykomen.env` lewat `EnvironmentFile`.

---

## 5. Nginx (HTTPS)

Tambahkan blok di `nginx-gezykomen.conf.contoh` ke konfigurasi Nginx di
VPS (misal `/etc/nginx/sites-available/komentar.pakgun.web.id`, lalu
symlink ke `sites-enabled`), sesuaikan dengan pola domain lain di VPS
yang sama:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Nginx meneruskan header `CF-Connecting-IP` dari Cloudflare apa adanya
— jangan dihapus/ditimpa, karena server memakai header itu untuk
menentukan IP pengunjung (rate limit login & kirim komentar).

Blog memakai HTTPS, jadi layanan ini **wajib HTTPS juga** — kalau masih
HTTP, browser memblokir panggilan dari halaman HTTPS dan komentar tidak
tampil.

---

## 6. Uji dari VPS

```bash
curl http://127.0.0.1:3102/health
# -> {"ok":true}

curl -X POST https://komentar.pakgun.web.id/api/comments \
  -H 'Content-Type: application/json' \
  -d '{"path":"/tes/","nick":"Pak Gun","isi":"Komentar uji"}'
# -> {"ok":true,"comment":{...}}

curl 'https://komentar.pakgun.web.id/api/comments?path=/tes/'
# -> {"path":"/tes/","count":1,"comments":[...]}

curl -s https://komentar.pakgun.web.id/widget.js | head -3
curl -s -o /dev/null -w "%{http_code}\n" https://komentar.pakgun.web.id/admin
# -> 200
```

Lalu buka https://komentar.pakgun.web.id/admin di browser, masuk
dengan akun dari Langkah 3. Komentar uji tadi harus tampil di daftar
admin — sembunyikan, tampilkan lagi, lalu hapus untuk membersihkan.

---

## 7. Integrasi blog (SETELAH layanan jalan)

1. Di repo blog, di `config/_default/params.toml`: matikan Waline
   (`[page.comment.waline] enable = false`) dan Utterances
   (`[page.comment.utterances] enable = false`) supaya kotak
   komentarnya cuma satu.
2. Pasang widget GezyKomen di template artikel (di bawah isi artikel,
   di tempat komentar biasa tampil):
   ```html
   <div id="gezykomen" data-path="{{ .RelPermalink }}"></div>
   <link rel="stylesheet" href="https://komentar.pakgun.web.id/widget.css">
   <script src="https://komentar.pakgun.web.id/widget.js"></script>
   ```
   `data-path` diisi path artikel, misal `/nama-artikel/`.
3. Uji build di salinan (`hugo --gc --minify`), commit + push.
4. Buka satu artikel di https://site.pakgun.web.id: kotak komentar
   harus tampil, kirim satu komentar uji, lalu hapus dari `/admin`.

---

## Backup

Komentar tersimpan di satu berkas SQLite:

```bash
cp /opt/waline/data/gezykomen.db /tempat-backup/gezykomen-$(date +%F).db
```

Simpan di lokasi permanen, bukan di `/tmp` (isi `/tmp` bisa hilang
kalau VPS di-reboot).

---

## Rollback

- Matikan tampilan tanpa mematikan layanan: hapus widget dari template
  blog, rebuild.
- Matikan layanan: `sudo systemctl stop gezykomen`
- Data tetap ada di `data/gezykomen.db` selama berkasnya tidak dihapus.
