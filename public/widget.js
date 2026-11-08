/* GezyKomen — widget komentar untuk blog Pak Gun.
 * Pemakaian di blog:
 *   <div id="gezykomen" data-path="/slug-artikel/"></div>
 *   <link rel="stylesheet" href="https://komentar.pakgun.web.id/widget.css">
 *   <script src="https://komentar.pakgun.web.id/widget.js"></script>
 * Isi komentar dirender dengan textContent, bukan innerHTML,
 * supaya HTML/<script> dari pengunjung tidak pernah jalan.
 */
(function () {
  var wadah = document.getElementById("gezykomen");
  if (!wadah) return;
  var path = wadah.getAttribute("data-path") || window.location.pathname;
  var base = document.currentScript
    ? new URL(document.currentScript.src).origin
    : "https://komentar.pakgun.web.id";

  function el(tag, txt, cls) {
    var e = document.createElement(tag);
    if (txt !== undefined && txt !== null) e.textContent = txt;
    if (cls) e.className = cls;
    return e;
  }

  var judul = el("h3", "Komentar", "gk-judul");
  var daftar = el("div", null, "gk-daftar");
  var form = el("form", null, "gk-form");
  var inputNama = el("input");
  inputNama.name = "nick";
  inputNama.placeholder = "Nama (2-50 karakter)";
  inputNama.required = true;
  inputNama.maxLength = 50;
  var inputIsi = el("textarea");
  inputIsi.name = "isi";
  inputIsi.placeholder = "Tulis komentar (maks 1000 karakter)…";
  inputIsi.required = true;
  inputIsi.maxLength = 1000;
  inputIsi.rows = 3;
  var tombol = el("button", "Kirim komentar");
  tombol.type = "submit";
  var pesan = el("p", null, "gk-pesan");
  form.append(inputNama, inputIsi, tombol, pesan);
  wadah.append(judul, daftar, form);

  function muat() {
    fetch(base + "/api/comments?path=" + encodeURIComponent(path))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        daftar.textContent = "";
        var list = j.comments || [];
        if (!list.length) {
          daftar.append(el("p", "Belum ada komentar. Jadilah yang pertama!", "gk-kosong"));
          return;
        }
        list.forEach(function (k) {
          var a = el("article", null, "gk-komentar");
          var kepala = el("div", null, "gk-kepala");
          kepala.append(el("strong", k.nick));
          kepala.append(el("small", " · " + (k.created_at || "").replace(" ", " ")));
          a.append(kepala);
          a.append(el("p", k.isi));
          daftar.append(a);
        });
      })
      .catch(function () {
        daftar.append(el("p", "Komentar belum bisa dimuat.", "gk-kosong"));
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    pesan.textContent = "";
    fetch(base + "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: path, nick: inputNama.value, isi: inputIsi.value }),
    })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (hasil) {
        if (hasil.s === 201) {
          inputIsi.value = "";
          pesan.textContent = "Komentar terkirim. Terima kasih!";
          muat();
        } else {
          pesan.textContent = hasil.j.error || "Gagal mengirim komentar.";
        }
      })
      .catch(function () {
        pesan.textContent = "Gagal mengirim komentar. Coba lagi.";
      });
  });

  muat();
})();
