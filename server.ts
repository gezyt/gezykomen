/**
 * GezyKomen — sistem komentar simpel untuk blog Pak Gun.
 *
 * Menggantikan Waline. Stack: Bun + Bun.serve + bun:sqlite (WAL),
 * TANPA dependensi luar, satu proses, satu berkas server.ts.
 *
 * Blog: https://site.pakgun.web.id dan https://pakgun.gezytech.web.id
 * Layanan: https://komentar.pakgun.web.id (CORS hanya dua origin itu)
 * IP pengunjung dibaca dari CF-Connecting-IP (Cloudflare menimpanya,
 * tidak bisa dipalsukan lewat Cloudflare); X-Forwarded-For sengaja
 * TIDAK dipercaya karena bisa dikirim siapa saja.
 *
 * Publik (tanpa login):
 *   GET  /health
 *   GET  /api/comments?path=/slug-artikel/
 *   POST /api/comments { path, nick, isi, parent_id? }
 * Balasan (reply): parent_id = id komentar utama yang dibalas.
 * Hanya satu tingkat — balasan untuk balasan ditolak (400), begitu
 * pula parent yang tidak ada atau beda path. Balasan ikut
 * tersembunyi bila induknya disembunyikan; hapus induk ikut
 * menghapus balasannya.
 *   GET  /widget.js, GET /widget.css
 * Admin (login, tanpa registrasi publik):
 *   POST /api/login, POST /api/logout, GET /api/me
 *   GET  /admin (halaman HTML)
 *   GET  /api/admin/comments
 *   POST /api/admin/comments/:id/hide | /show | /delete
 *
 * Env:
 *   PORT                (default 3102)
 *   DB_PATH             (default ./data/gezykomen.db)
 *   GEZYKOMEN_ORIGINS   (default https://site.pakgun.web.id,https://pakgun.gezytech.web.id)
 *   GEZYKOMEN_SALT      (default "gezykomen" — setel yang acak di VPS)
 *   GEZYKOMEN_SECURE_COOKIE ("false" hanya untuk uji lokal http; default true)
 */

import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_ORIGINS = [
  "https://site.pakgun.web.id",
  "https://pakgun.gezytech.web.id",
];

// ---------- validasi & escape (dipakai server dan diuji bun test) ----------

export function validatePath(p: unknown): string | null {
  if (typeof p !== "string") return null;
  const t = p.trim();
  if (!t.startsWith("/") || t.length > 512 || t.includes("..")) return null;
  return t;
}

export function validateNick(n: unknown): string | null {
  if (typeof n !== "string") return null;
  const t = n.trim();
  if (t.length < 2 || t.length > 50) return null;
  return t;
}

export function validateIsi(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t.length < 1 || t.length > 1000) return null;
  return t;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---------- skema ----------

export function ensureSchema(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      nick TEXT NOT NULL,
      isi TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'tampil',
      ip_hash TEXT NOT NULL DEFAULT '',
      parent_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comments_path ON comments(path, status, id);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Migrasi: database lama (sebelum ada balasan) belum punya parent_id.
  const kolom = db.query("PRAGMA table_info(comments)").all() as any[];
  if (!kolom.some((c) => c.name === "parent_id")) {
    db.exec("ALTER TABLE comments ADD COLUMN parent_id INTEGER;");
  }
}

export function openDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  ensureSchema(db);
  return db;
}

// ---------- handler ----------

export interface HandlerOptions {
  dbPath: string;
  origins?: string[];
  salt?: string;
  secureCookie?: boolean;
  publicDir?: string;
}

export function createHandler(opts: HandlerOptions) {
  const db = openDb(opts.dbPath);
  const origins = new Set(opts.origins ?? DEFAULT_ORIGINS);
  const salt = opts.salt ?? "gezykomen";
  const secureCookie = opts.secureCookie ?? true;
  const publicDir = opts.publicDir ?? join(import.meta.dir, "public");

  // Rate limit kirim komentar: maks 5/IP/10 menit, jeda min 10 detik.
  const kirim: Map<string, number[]> = new Map();
  // Rate limit login: maks 10 percobaan/IP+username/15 menit.
  const loginCoba: Map<string, number[]> = new Map();

  function bersihkan(map: Map<string, number[]>, key: string, jendelaMs: number, now: number) {
    const arr = (map.get(key) ?? []).filter((t) => now - t < jendelaMs);
    map.set(key, arr);
    return arr;
  }

  function ipDari(req: Request): string {
    // IP pengunjung dipakai untuk rate limit (login & kirim komentar).
    //
    // Perbaikan 9 Nov 2026 — JANGAN percaya X-Forwarded-For: header itu
    // bisa dikirim siapa saja, jadi penyerang bisa memalsukannya untuk
    // mendapat kuota percobaan login baru (terbukti di uji lokal).
    //
    // Yang dipercaya hanya CF-Connecting-IP: Cloudflare MENIMPA header
    // ini dengan IP asli pengunjung, jadi nilainya tidak bisa dipalsukan
    // selama lalu lintas lewat Cloudflare (domain ini memang di-proxy
    // Cloudflare). Tanpa header itu (akses langsung ke server, tanpa
    // Cloudflare), pakai IP koneksi TCP — di VPS itu IP proxy Nginx
    // (127.0.0.1), jadi semua lalu lintas langsung berbagi satu kuota:
    // sengaja ketat (fail-closed), bukan longgar.
    const cf = req.headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
    return (Bun as any).requestIP?.(req)?.address || "unknown";
  }

  function ipHash(ip: string): string {
    return createHash("sha256").update(salt + ":" + ip).digest("hex");
  }

  function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get("origin") || "";
    if (origins.has(origin)) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
      };
    }
    return {};
  }

  const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...extra },
    });

  function cookieSesi(token: string, expires: Date): string {
    let c = `gezykomen_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}; Expires=${expires.toUTCString()}`;
    if (secureCookie) c += "; Secure";
    return c;
  }

  function tokenDari(req: Request): string | null {
    const cookie = req.headers.get("cookie") || "";
    const m = cookie.match(/(?:^|;\s*)gezykomen_session=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function userDari(req: Request) {
    const token = tokenDari(req);
    if (!token) return null;
    const row = db
      .query("SELECT user_id, expires_at FROM sessions WHERE id = ?")
      .get(token) as any;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      db.query("DELETE FROM sessions WHERE id = ?").run(token);
      return null;
    }
    const user = db
      .query("SELECT id, username, is_admin FROM users WHERE id = ?")
      .get(row.user_id) as any;
    return user ?? null;
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/health") return json({ ok: true }, 200, cors);

    // ---- landing page (dibuat Pak Gun di VPS, 9 Nov 2026; disimpan di
    // repo supaya tidak hilang saat deploy ulang dari repo) ----
    if (url.pathname === "/" && req.method === "GET") {
      return new Response(
        `<!doctype html>\n<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Komentar Pak Gun</title></head>\n<body style="font-family:system-ui,sans-serif;max-width:680px;margin:4rem auto;padding:0 1rem;color:#392312">\n<h1>Komentar Pak Gun</h1><p>Layanan komentar aktif.</p>\n<p><a href="/admin">Masuk ke halaman admin</a></p>\n</body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", ...cors } }
      );
    }

    // ---- berkas widget ----
    if (url.pathname === "/widget.js" && req.method === "GET") {
      const file = Bun.file(join(publicDir, "widget.js"));
      if (!(await file.exists())) return json({ error: "tidak ditemukan" }, 404, cors);
      return new Response(await file.text(), {
        headers: { "Content-Type": "text/javascript; charset=utf-8", ...cors },
      });
    }
    if (url.pathname === "/widget.css" && req.method === "GET") {
      const file = Bun.file(join(publicDir, "widget.css"));
      if (!(await file.exists())) return json({ error: "tidak ditemukan" }, 404, cors);
      return new Response(await file.text(), {
        headers: { "Content-Type": "text/css; charset=utf-8", ...cors },
      });
    }

    // ---- komentar publik ----
    if (url.pathname === "/api/comments" && req.method === "GET") {
      const path = validatePath(url.searchParams.get("path"));
      if (!path) return json({ error: "path tidak valid" }, 400, cors);
      const semua = db
        .query(
          "SELECT id, parent_id, nick, isi, status, created_at FROM comments WHERE path = ? AND status = 'tampil' ORDER BY id ASC"
        )
        .all(path) as any[];
      // Balasan hanya tampil bila induknya tampil (induk disembunyikan
      // ikut menyembunyikan balasannya; yang dihapus sudah tidak ada).
      const idTampil = new Set(semua.map((r) => r.id));
      const rows = semua
        .filter((r) => r.parent_id === null || idTampil.has(r.parent_id))
        .map(({ status, ...k }) => k);
      return json({ path, count: rows.length, comments: rows }, 200, cors);
    }

    if (url.pathname === "/api/comments" && req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "body harus JSON" }, 400, cors);
      }
      const path = validatePath(body?.path);
      const nick = validateNick(body?.nick);
      const isi = validateIsi(body?.isi);
      if (!path) return json({ error: "path tidak valid" }, 400, cors);
      if (!nick) return json({ error: "nama 2-50 karakter" }, 400, cors);
      if (!isi) return json({ error: "komentar 1-1000 karakter" }, 400, cors);
      // Balasan: parent_id harus id komentar UTAMA (parent_id NULL) di
      // path yang sama. Balasan untuk balasan / induk tak ada / beda
      // path ditolak — supaya utas tetap satu tingkat dan rapi.
      let parentId: number | null = null;
      if (body?.parent_id !== undefined && body?.parent_id !== null) {
        parentId = Number(body.parent_id);
        if (!Number.isInteger(parentId) || parentId <= 0) {
          return json({ error: "parent_id tidak valid" }, 400, cors);
        }
        const induk = db
          .query("SELECT id, path, parent_id FROM comments WHERE id = ?")
          .get(parentId) as any;
        if (!induk) return json({ error: "komentar yang dibalas tidak ada" }, 400, cors);
        if (induk.path !== path) {
          return json({ error: "komentar yang dibalas beda artikel" }, 400, cors);
        }
        if (induk.parent_id !== null) {
          return json({ error: "balasan hanya untuk komentar utama" }, 400, cors);
        }
      }

      const now = Date.now();
      const hash = ipHash(ipDari(req));
      const arr = bersihkan(kirim, hash, 10 * 60 * 1000, now);
      if (arr.length > 0 && now - arr[arr.length - 1] < 10 * 1000) {
        return json({ error: "tunggu 10 detik sebelum mengirim lagi" }, 429, cors);
      }
      if (arr.length >= 5) {
        return json({ error: "terlalu banyak komentar, coba lagi nanti" }, 429, cors);
      }
      arr.push(now);
      kirim.set(hash, arr);

      const r = db
        .query("INSERT INTO comments (path, nick, isi, ip_hash, parent_id) VALUES (?, ?, ?, ?, ?)")
        .run(path, nick, isi, hash, parentId);
      const row = db
        .query("SELECT id, parent_id, nick, isi, created_at FROM comments WHERE id = ?")
        .get(r.lastInsertRowid) as any;
      return json({ ok: true, comment: row }, 201, cors);
    }

    // ---- auth ----
    if (url.pathname === "/api/login" && req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "body harus JSON" }, 400, cors);
      }
      const username = typeof body?.username === "string" ? body.username.trim() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const now = Date.now();
      const kunci = ipDari(req) + ":" + username;
      const arr = bersihkan(loginCoba, kunci, 15 * 60 * 1000, now);
      if (arr.length >= 10) return json({ error: "terlalu banyak percobaan login" }, 429, cors);
      arr.push(now);
      loginCoba.set(kunci, arr);

      const user = db.query("SELECT * FROM users WHERE username = ?").get(username) as any;
      if (!user || !(await Bun.password.verify(password, user.password_hash))) {
        return json({ error: "username atau kata sandi salah" }, 401, cors);
      }
      const token = randomBytes(32).toString("hex");
      const expires = new Date(now + 30 * 24 * 3600 * 1000);
      db.query("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(
        token,
        user.id,
        expires.toISOString()
      );
      return json(
        { ok: true, user: { id: user.id, username: user.username } },
        200,
        { "Set-Cookie": cookieSesi(token, expires), ...cors }
      );
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      const token = tokenDari(req);
      if (token) db.query("DELETE FROM sessions WHERE id = ?").run(token);
      return json(
        { ok: true },
        200,
        {
          "Set-Cookie": `gezykomen_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureCookie ? "; Secure" : ""}`,
          ...cors,
        }
      );
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      const user = userDari(req);
      if (!user) return json({ error: "belum login" }, 401, cors);
      return json({ user }, 200, cors);
    }

    // ---- halaman admin ----
    if (url.pathname === "/admin" && req.method === "GET") {
      return new Response(ADMIN_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ---- endpoint admin ----
    if (url.pathname === "/api/admin/comments" && req.method === "GET") {
      const user = userDari(req);
      if (!user) return json({ error: "belum login" }, 401, cors);
      const rows = db
        .query(
          "SELECT id, parent_id, path, nick, isi, status, created_at FROM comments ORDER BY id DESC"
        )
        .all() as any[];
      return json({ count: rows.length, comments: rows }, 200, cors);
    }

    const mAdmin = url.pathname.match(/^\/api\/admin\/comments\/(\d+)\/(hide|show|delete)$/);
    if (mAdmin && req.method === "POST") {
      const user = userDari(req);
      if (!user) return json({ error: "belum login" }, 401, cors);
      const id = Number(mAdmin[1]);
      const aksi = mAdmin[2];
      const ada = db.query("SELECT id FROM comments WHERE id = ?").get(id) as any;
      if (!ada) return json({ error: "komentar tidak ditemukan" }, 404, cors);
      if (aksi === "hide") {
        db.query("UPDATE comments SET status = 'sembunyi' WHERE id = ?").run(id);
      } else if (aksi === "show") {
        db.query("UPDATE comments SET status = 'tampil' WHERE id = ?").run(id);
      } else {
        // Hapus induk ikut menghapus balasannya.
        db.query("DELETE FROM comments WHERE id = ? OR parent_id = ?").run(id, id);
      }
      return json({ ok: true, id, aksi }, 200, cors);
    }

    return json({ error: "tidak ditemukan" }, 404, cors);
  }

  return {
    fetch,
    db,
    resetRateLimits() {
      kirim.clear();
      loginCoba.clear();
    },
  };
}

const ADMIN_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GezyKomen — Admin</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;background:#FAF4E3;color:#392312}input,button{padding:8px;font-size:15px}button{background:#F16B1C;color:#fff;border:0;border-radius:6px;cursor:pointer;margin-right:6px}article{border:1px solid #d8cbb0;border-radius:8px;padding:10px;margin:10px 0;background:#fff}article.balasan{margin-left:28px;border-left:3px solid #f16b1c}small{color:#7a6a55}</style>
</head><body>
<h1>GezyKomen — Admin</h1>
<div id="login"><h2>Masuk</h2><input id="u" placeholder="username" autocomplete="username"><br><br><input id="p" type="password" placeholder="kata sandi" autocomplete="current-password"><br><br><button id="btnLogin">Masuk</button><p id="loginErr" style="color:red"></p></div>
<div id="panel" hidden><p><span id="siapa"></span> <button id="btnLogout">Keluar</button></p><div id="daftar"></div></div>
<script>
async function api(path, opt){ const r = await fetch(path, opt); const t = await r.text(); let j={}; try{j=JSON.parse(t)}catch(e){} return {status:r.status, j}; }
function el(tag, txt){ const e=document.createElement(tag); if(txt!==undefined) e.textContent=txt; return e; }
async function muat(){
  const me = await api('/api/me');
  if(me.status!==200){ document.getElementById('login').hidden=false; document.getElementById('panel').hidden=true; return; }
  document.getElementById('login').hidden=true; document.getElementById('panel').hidden=false;
  document.getElementById('siapa').textContent='Masuk sebagai '+me.j.user.username;
  const d = await api('/api/admin/comments');
  const wadah=document.getElementById('daftar'); wadah.textContent='';
  const nama={}; (d.j.comments||[]).forEach(function(x){ nama[x.id]=x.nick; });
  (d.j.comments||[]).forEach(function(k){
    const a=el('article');
    if(k.parent_id){ a.className='balasan'; }
    a.append(el('strong', k.nick+' ')); a.append(el('small', k.path+' · '+k.created_at+' · '+k.status));
    if(k.parent_id){ a.append(el('p', '↩ Balasan untuk '+(nama[k.parent_id]||'komentar yang sudah dihapus'))); }
    a.append(el('p', k.isi));
    const b1=el('button', k.status==='tampil'?'Sembunyikan':'Tampilkan');
    b1.onclick=async()=>{ await api('/api/admin/comments/'+k.id+(k.status==='tampil'?'/hide':'/show'),{method:'POST'}); muat(); };
    const b2=el('button','Hapus');
    b2.onclick=async()=>{ if(confirm('Hapus komentar ini selamanya?')){ await api('/api/admin/comments/'+k.id+'/delete',{method:'POST'}); muat(); } };
    a.append(b1,b2); wadah.append(a);
  });
  if(!(d.j.comments||[]).length) wadah.append(el('p','Belum ada komentar.'));
}
document.getElementById('btnLogin').onclick=async()=>{
  const r=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('u').value,password:document.getElementById('p').value})});
  if(r.status!==200){ document.getElementById('loginErr').textContent=r.j.error||'Gagal masuk'; return; }
  muat();
};
document.getElementById('btnLogout').onclick=async()=>{ await api('/api/logout',{method:'POST'}); muat(); };
muat();
</script></body></html>`;

// ---------- jalankan sebagai proses (bukan saat diimpor bun test) ----------

if (import.meta.main) {
  const PORT = Number(process.env.PORT || 3102);
  const handler = createHandler({
    dbPath: process.env.DB_PATH || "./data/gezykomen.db",
    origins: (process.env.GEZYKOMEN_ORIGINS || DEFAULT_ORIGINS.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    salt: process.env.GEZYKOMEN_SALT,
    secureCookie: process.env.GEZYKOMEN_SECURE_COOKIE !== "false",
  });
  Bun.serve({ port: PORT, fetch: handler.fetch });
  console.log(`GezyKomen berjalan di http://localhost:${PORT}`);
}
