import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  createHandler,
  validatePath,
  validateNick,
  validateIsi,
  escapeHtml,
} from "../server.ts";

function buat() {
  const dir = mkdtempSync(join(tmpdir(), "gezykomen-test-"));
  const dbPath = join(dir, "test.db");
  const h = createHandler({
    dbPath,
    origins: ["https://site.pakgun.web.id"],
    salt: "uji",
    secureCookie: false,
  });
  // akun admin untuk uji
  const hash = Bun.password.hashSync("rahasia123", { algorithm: "bcrypt", cost: 10 });
  h.db.query("INSERT INTO users (username, password_hash) VALUES (?, ?)").run("pakgun", hash);
  return h;
}

async function kirim(h: any, body: any, origin = "https://site.pakgun.web.id") {
  return h.fetch(
    new Request("http://localhost/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    })
  );
}

async function login(h: any, password = "rahasia123") {
  const r = await h.fetch(
    new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pakgun", password }),
    })
  );
  const cookie = r.headers.get("set-cookie") || "";
  const token = cookie.match(/gezykomen_session=([^;]+)/)?.[1] || "";
  return { r, cookie: `gezykomen_session=${token}` };
}

describe("validasi", () => {
  test("path harus diawali / dan tanpa ..", () => {
    expect(validatePath("/artikel/")).toBe("/artikel/");
    expect(validatePath("artikel/")).toBeNull();
    expect(validatePath("/../etc")).toBeNull();
    expect(validatePath("/" + "a".repeat(600))).toBeNull();
  });
  test("nick 2-50 karakter, isi 1-1000 karakter", () => {
    expect(validateNick("A")).toBeNull();
    expect(validateNick("Pak Gun")).toBe("Pak Gun");
    expect(validateIsi("")).toBeNull();
    expect(validateIsi("   ")).toBeNull();
    expect(validateIsi("x".repeat(1001))).toBeNull();
    expect(validateIsi("Halo")).toBe("Halo");
  });
  test("POST dengan data tidak valid ditolak 400", async () => {
    const h = buat();
    expect((await kirim(h, { path: "tanpa-slash", nick: "Pak", isi: "x" })).status).toBe(400);
    expect((await kirim(h, { path: "/a/", nick: "P", isi: "x" })).status).toBe(400);
    expect((await kirim(h, { path: "/a/", nick: "Pak", isi: "" })).status).toBe(400);
  });
});

describe("komentar publik", () => {
  test("komentar tampil setelah dikirim, urut terlama dulu", async () => {
    const h = buat();
    const r1 = await kirim(h, { path: "/tes/", nick: "Ani", isi: "Pertama" });
    expect(r1.status).toBe(201);
    h.resetRateLimits();
    const r2 = await kirim(h, { path: "/tes/", nick: "Budi", isi: "Kedua" });
    expect(r2.status).toBe(201);
    const daftar = await h.fetch(
      new Request("http://localhost/api/comments?path=/tes/", {
        headers: { Origin: "https://site.pakgun.web.id" },
      })
    );
    const j: any = await daftar.json();
    expect(j.count).toBe(2);
    expect(j.comments[0].nick).toBe("Ani");
    expect(j.comments[1].nick).toBe("Budi");
  });
  test("CORS hanya origin blog yang diizinkan", async () => {
    const h = buat();
    const ok = await h.fetch(
      new Request("http://localhost/api/comments?path=/tes/", {
        headers: { Origin: "https://site.pakgun.web.id" },
      })
    );
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://site.pakgun.web.id");
    const jahat = await h.fetch(
      new Request("http://localhost/api/comments?path=/tes/", {
        headers: { Origin: "https://jahat.example" },
      })
    );
    expect(jahat.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("XSS", () => {
  test("escapeHtml mengubah <script> menjadi entitas", () => {
    const out = escapeHtml('<script>alert(1)</script>');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
  test("widget merender dengan textContent, bukan innerHTML berisi data pengguna", () => {
    const js = readFileSync(join(import.meta.dir, "..", "public", "widget.js"), "utf-8");
    expect(js).toContain("textContent");
    expect(js).not.toMatch(/innerHTML\s*=/);
  });
  test("isi berisi tag script tetap tersimpan tapi tidak tampil sebagai HTML di daftar publik (disajikan apa adanya, widget meng-escape)", async () => {
    const h = buat();
    const r = await kirim(h, { path: "/xss/", nick: "Uji", isi: "<script>alert(1)</script>" });
    expect(r.status).toBe(201);
    const j: any = await (await h.fetch(new Request("http://localhost/api/comments?path=/xss/"))).json();
    expect(j.comments[0].isi).toContain("<script>");
    // yang menjamin aman adalah escapeHtml + textContent di widget:
    expect(escapeHtml(j.comments[0].isi)).not.toContain("<script>");
  });
});

describe("admin", () => {
  test("login salah ditolak 401, login benar berhasil", async () => {
    const h = buat();
    const salah = await login(h, "salah");
    expect(salah.r.status).toBe(401);
    const benar = await login(h, "rahasia123");
    expect(benar.r.status).toBe(200);
    expect(benar.cookie).toContain("gezykomen_session=");
  });
  test("endpoint admin tanpa login 401", async () => {
    const h = buat();
    const r = await h.fetch(new Request("http://localhost/api/admin/comments"));
    expect(r.status).toBe(401);
    const r2 = await h.fetch(
      new Request("http://localhost/api/admin/comments/1/hide", { method: "POST" })
    );
    expect(r2.status).toBe(401);
  });
  test("admin bisa sembunyikan lalu komentar hilang dari daftar publik, lalu tampilkan lagi", async () => {
    const h = buat();
    await kirim(h, { path: "/a/", nick: "Ani", isi: "Halo" });
    const { cookie } = await login(h);
    const hide = await h.fetch(
      new Request("http://localhost/api/admin/comments/1/hide", {
        method: "POST",
        headers: { Cookie: cookie },
      })
    );
    expect(hide.status).toBe(200);
    const publik: any = await (
      await h.fetch(new Request("http://localhost/api/comments?path=/a/"))
    ).json();
    expect(publik.count).toBe(0);
    const show = await h.fetch(
      new Request("http://localhost/api/admin/comments/1/show", {
        method: "POST",
        headers: { Cookie: cookie },
      })
    );
    expect(show.status).toBe(200);
    const publik2: any = await (
      await h.fetch(new Request("http://localhost/api/comments?path=/a/"))
    ).json();
    expect(publik2.count).toBe(1);
  });
  test("admin bisa hapus permanen", async () => {
    const h = buat();
    await kirim(h, { path: "/a/", nick: "Ani", isi: "Hapus saya" });
    const { cookie } = await login(h);
    const del = await h.fetch(
      new Request("http://localhost/api/admin/comments/1/delete", {
        method: "POST",
        headers: { Cookie: cookie },
      })
    );
    expect(del.status).toBe(200);
    const admin: any = await (
      await h.fetch(
        new Request("http://localhost/api/admin/comments", { headers: { Cookie: cookie } })
      )
    ).json();
    expect(admin.count).toBe(0);
  });
});

describe("rate limit", () => {
  test("login salah 10x lalu 429, dan X-Forwarded-For palsu tidak bisa lewati batas itu", async () => {
    const h = buat();
    async function cobaLoginSalah(headers: Record<string, string>) {
      return h.fetch(
        new Request("http://localhost/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ username: "pakgun", password: "salah" }),
        })
      );
    }
    for (let i = 0; i < 10; i++) {
      expect((await cobaLoginSalah({ "X-Forwarded-For": "1.2.3.4" })).status).toBe(401);
    }
    expect((await cobaLoginSalah({ "X-Forwarded-For": "1.2.3.4" })).status).toBe(429);
    // ganti X-Forwarded-For seenaknya: tetap 429, karena header itu diabaikan
    expect((await cobaLoginSalah({ "X-Forwarded-For": "9.9.9.9" })).status).toBe(429);
    // CF-Connecting-IP dipakai sebagai identitas: IP Cloudflare lain dapat kuota baru
    expect((await cobaLoginSalah({ "CF-Connecting-IP": "2.2.2.2" })).status).toBe(401);
  });
  test("kirim kedua dalam 10 detik ditolak 429, setelah reset bisa lagi", async () => {
    const h = buat();
    expect((await kirim(h, { path: "/r/", nick: "Ani", isi: "satu" })).status).toBe(201);
    expect((await kirim(h, { path: "/r/", nick: "Ani", isi: "dua" })).status).toBe(429);
    h.resetRateLimits();
    expect((await kirim(h, { path: "/r/", nick: "Ani", isi: "tiga" })).status).toBe(201);
  });
});

describe("balasan (reply)", () => {
  test("balasan ke komentar utama berhasil dan tampil di bawah induk", async () => {
    const h = buat();
    const induk = await kirim(h, { path: "/b/", nick: "Ani", isi: "Utama" });
    expect(induk.status).toBe(201);
    h.resetRateLimits();
    const balas = await kirim(h, { path: "/b/", nick: "Budi", isi: "Setuju!", parent_id: 1 });
    expect(balas.status).toBe(201);
    const j: any = await (await balas.json()) as any;
    expect(j.comment.parent_id).toBe(1);
    const daftar: any = await (
      await h.fetch(new Request("http://localhost/api/comments?path=/b/"))
    ).json();
    expect(daftar.count).toBe(2);
    expect(daftar.comments[0].parent_id).toBeNull();
    expect(daftar.comments[1].parent_id).toBe(1);
    expect(daftar.comments[1].nick).toBe("Budi");
  });
  test("balasan untuk balasan, induk tak ada, dan beda path ditolak 400", async () => {
    const h = buat();
    await kirim(h, { path: "/b/", nick: "Ani", isi: "Utama" });
    h.resetRateLimits();
    await kirim(h, { path: "/b/", nick: "Budi", isi: "Balasan", parent_id: 1 });
    expect((await kirim(h, { path: "/b/", nick: "Cici", isi: "Balas balasan", parent_id: 2 })).status).toBe(400);
    expect((await kirim(h, { path: "/b/", nick: "Cici", isi: "Tak ada", parent_id: 99 })).status).toBe(400);
    expect((await kirim(h, { path: "/lain/", nick: "Cici", isi: "Beda path", parent_id: 1 })).status).toBe(400);
    expect((await kirim(h, { path: "/b/", nick: "Cici", isi: "Bukan angka", parent_id: "satu" })).status).toBe(400);
  });
  test("induk disembunyikan ikut sembunyikan balasan; ditampilkan lagi balasan kembali", async () => {
    const h = buat();
    await kirim(h, { path: "/b/", nick: "Ani", isi: "Utama" });
    h.resetRateLimits();
    await kirim(h, { path: "/b/", nick: "Budi", isi: "Balasan", parent_id: 1 });
    const { cookie } = await login(h);
    await h.fetch(new Request("http://localhost/api/admin/comments/1/hide", { method: "POST", headers: { Cookie: cookie } }));
    const sembunyi: any = await (
      await h.fetch(new Request("http://localhost/api/comments?path=/b/"))
    ).json();
    expect(sembunyi.count).toBe(0);
    await h.fetch(new Request("http://localhost/api/admin/comments/1/show", { method: "POST", headers: { Cookie: cookie } }));
    const tampil: any = await (
      await h.fetch(new Request("http://localhost/api/comments?path=/b/"))
    ).json();
    expect(tampil.count).toBe(2);
  });
  test("hapus induk ikut menghapus balasannya", async () => {
    const h = buat();
    await kirim(h, { path: "/b/", nick: "Ani", isi: "Utama" });
    h.resetRateLimits();
    await kirim(h, { path: "/b/", nick: "Budi", isi: "Balasan", parent_id: 1 });
    const { cookie } = await login(h);
    const del = await h.fetch(
      new Request("http://localhost/api/admin/comments/1/delete", { method: "POST", headers: { Cookie: cookie } })
    );
    expect(del.status).toBe(200);
    const admin: any = await (
      await h.fetch(new Request("http://localhost/api/admin/comments", { headers: { Cookie: cookie } }))
    ).json();
    expect(admin.count).toBe(0);
  });
  test("migrasi: database lama tanpa parent_id tetap bisa dipakai dan dibalas", async () => {
    const { Database } = await import("bun:sqlite");
    const dir = mkdtempSync(join(tmpdir(), "gezykomen-migrasi-"));
    const dbPath = join(dir, "lama.db");
    const lama = new Database(dbPath);
    lama.exec(`
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL,
        nick TEXT NOT NULL, isi TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'tampil',
        ip_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO comments (path, nick, isi) VALUES ('/lama/', 'Ani', 'Komentar lama');
    `);
    lama.close();
    const h = createHandler({ dbPath, origins: ["https://site.pakgun.web.id"], salt: "uji", secureCookie: false });
    const balas = await kirim(h, { path: "/lama/", nick: "Budi", isi: "Balasan untuk yang lama", parent_id: 1 });
    expect(balas.status).toBe(201);
    const daftar: any = await (
      await h.fetch(new Request("http://localhost/api/comments?path=/lama/"))
    ).json();
    expect(daftar.count).toBe(2);
  });
});

describe("balasan admin", () => {
  test("halaman /admin memuat tombol Balas dan tautan artikel", async () => {
    const h = buat();
    const r = await h.fetch(new Request("http://localhost/admin"));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Balas");
    expect(html).toContain("site.pakgun.web.id");
  });
  test("admin bisa membalas dari endpoint admin; nick = username yang login", async () => {
    const h = buat();
    await kirim(h, { path: "/b/", nick: "Ani", isi: "Tanya dong" });
    const tanpaLogin = await h.fetch(
      new Request("http://localhost/api/admin/comments/1/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isi: "Jawaban" }),
      })
    );
    expect(tanpaLogin.status).toBe(401);
    const { cookie } = await login(h);
    const balas = await h.fetch(
      new Request("http://localhost/api/admin/comments/1/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ isi: "Jawabannya begini" }),
      })
    );
    expect(balas.status).toBe(201);
    const j: any = await balas.json();
    expect(j.comment.parent_id).toBe(1);
    expect(j.comment.nick).toBe("pakgun");
    const publik: any = await (
      await h.fetch(new Request("http://localhost/api/comments?path=/b/"))
    ).json();
    expect(publik.count).toBe(2);
    expect(publik.comments[1].isi).toBe("Jawabannya begini");
  });
  test("balasan admin ke balasan menempel ke induk utama; isi kosong dan id tak ada ditolak", async () => {
    const h = buat();
    await kirim(h, { path: "/b/", nick: "Ani", isi: "Utama" });
    h.resetRateLimits();
    await kirim(h, { path: "/b/", nick: "Budi", isi: "Balasan", parent_id: 1 });
    const { cookie } = await login(h);
    async function balasAdmin(id: number, isi: string) {
      return h.fetch(
        new Request("http://localhost/api/admin/comments/" + id + "/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ isi }),
        })
      );
    }
    const keBalasan = await balasAdmin(2, "Balasan admin untuk balasan");
    expect(keBalasan.status).toBe(201);
    expect(((await keBalasan.json()) as any).comment.parent_id).toBe(1);
    expect((await balasAdmin(1, "")).status).toBe(400);
    expect((await balasAdmin(99, "Tak ada")).status).toBe(404);
  });
});

describe("health", () => {
  test("/health menjawab ok", async () => {
    const h = buat();
    const r = await h.fetch(new Request("http://localhost/health"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).ok).toBe(true);
  });
});
