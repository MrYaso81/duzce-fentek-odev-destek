// Düzce FENTEK çevrimdışı yardımcısı: uygulama kabuğunu önbelleğe alır
// Not: file:// ile açınca çalışmaz, http://localhost ile dene
const ONBELLEK = "odevagi-v8"; // Sunucuyu Al sırasında yeni program düzenlemelerini koruyan sürüm.
const ONBELLEK_ON = "odevagi-"; // yalnız bu ön ekli önbelleklere dokun!
const DOSYALAR = ["index.html", "style.css", "app.js", "api.js", "program-kuyruk.js", "manifest.json"]; // saklanacaklar
self.addEventListener("install", e => { // ilk kurulumda dosyaları sakla
  e.waitUntil(caches.open(ONBELLEK).then(c => c.addAll(DOSYALAR)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => { // yalnız KENDİ eski sürümlerini temizle
  e.waitUntil(caches.keys().then(adlar => Promise.all(adlar.filter(a => a.startsWith(ONBELLEK_ON) && a !== ONBELLEK).map(a => caches.delete(a)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => { // istek gelince
  const url = new URL(e.request.url); // adresi çöz
  if (e.request.method !== "GET" || url.pathname.startsWith("/api")) return; // API ve yazma işleri önbelleksiz (güncel + kişisel veri korunur)
  if (e.request.mode === "navigate") // SAYFA gezinmesi: önbellek, yoksa ağ, o da yoksa ana sayfa
    e.respondWith(caches.match(e.request).then(v => v || fetch(e.request).catch(() => caches.match("index.html"))));
  else // JS/CSS/görsel: önbellek ya da ağ (HTML fallback YOK! bozuk betik çalışmaz!)
    e.respondWith(caches.match(e.request).then(v => v || fetch(e.request)));
});
