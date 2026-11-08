/**
 * Buat akun admin GezyKomen (tanpa registrasi publik).
 * Pemakaian di VPS:
 *   cd /opt/waline
 *   bun scripts/create-user.ts <username> <password>
 * DB_PATH diambil dari env (default ./data/gezykomen.db).
 * Jalankan sekali untuk akun pertama (misal: pakgun).
 */
import { openDb } from "../server.ts";

const [username, password] = Bun.argv.slice(2);
if (!username || !password) {
  console.error("Pemakaian: bun scripts/create-user.ts <username> <password>");
  process.exit(1);
}
if (password.length < 6) {
  console.error("Kata sandi minimal 6 karakter.");
  process.exit(1);
}
const dbPath = process.env.DB_PATH || "./data/gezykomen.db";
const db = openDb(dbPath);
const ada = db.query("SELECT id FROM users WHERE username = ?").get(username) as any;
if (ada) {
  console.error(`Username "${username}" sudah ada.`);
  process.exit(1);
}
const hash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
db.query("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
console.log(`Akun admin "${username}" dibuat di ${dbPath}.`);
