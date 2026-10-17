// ÖdevAğı: sunucu varsa oradan, yoksa yerelden çalışır (çift mod)
// Aşama 2: akış/yorum/beğeni/kaydetme sunucuda, hoca soruları + bildirimler yerelde

// Hata tuzağı: betik hatası ekranda görünsün (sessiz ölüm yok!)
window.addEventListener("error", e => { const t = document.getElementById("toast"); if (t) { t.textContent = "Hata: " + (e.message || "bilinmiyor"); t.style.display = "block"; } });

// --- Küçük yardımcılar ---
function ondek() { return localStorage.getItem("demoModu") === "acik" ? "demo:" : ""; } // demo ayrı depo (veriler karışmaz)
function oku(k, v) { return JSON.parse(localStorage.getItem(ondek() + k) || JSON.stringify(v)); } // veriyi oku (demoysa demoden)
function yaz(k, v) { localStorage.setItem(ondek() + k, JSON.stringify(v)); } // kaydet (demoysa demoya)
function cihazOku(k, v) { return JSON.parse(localStorage.getItem("ayar:" + k) || JSON.stringify(v)); } // cihaz ayarı (moddan bağımsız)
function cihazYaz(k, v) { localStorage.setItem("ayar:" + k, JSON.stringify(v)); } // cihaz ayarını sakla
function idUret() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); } // benzersiz id

// --- Mod: sunucu bağlı mı ---
let MOD = "yerel"; // "sunucu" olursa veriler backend'den gelir
let SUNUCU = false; // sunucuya ulaşılıyor mu
function modGoster() { // üstte modu yaz + bağlantı kopunca tekrar dene göster
  const m = document.getElementById("modBilgi");
  if (MOD === "sunucu") m.textContent = "🌐 Sunucu bağlı" + (aktif ? " (" + aktif.ad + ")" : "");
  else if (!SUNUCU && localStorage.getItem("demoModu") === "acik") m.textContent = "🧪 DENEME modu (yalnız bu cihazdaki veriler)";
  else if (!SUNUCU) m.textContent = "⚠️ Bağlantı yok (aşağıdan tekrar dene)";
  else m.textContent = "💾 Yerel mod (giriş yapılmadı)";
  const td = document.getElementById("btnTekrarDene"); // yeniden dene düğmesi
  if (td) td.style.display = SUNUCU ? "none" : "inline-block"; // sunucu yoksa göster
}
// Bağlantı hatası ekranı: sessiz demo yok, kullanıcı seçer
function baglantiHatasiGoster() { document.getElementById("baglantiHatasi").style.display = "flex"; modGoster(); }
function baglantiHatasiGizle() { document.getElementById("baglantiHatasi").style.display = "none"; }
document.getElementById("btnBaglanTekrar").onclick = () => location.reload(); // sunucuyu yeniden yokla
document.getElementById("btnDemoAc").onclick = () => { // açık seçimle demo
  localStorage.setItem("demoModu", "acik"); // tercih
  baglantiHatasiGizle();
  aktif = oku("aktifKullanici", null); MOD = "yerel"; // yerel oturumu sürdür (silme yok)
  aktifGoster(); listeleOdev(); listeleHocalar(); listeleHoca();
  toast("Deneme modundasın. Veriler yalnız bu cihazda.");
};
document.getElementById("btnTekrarDene").onclick = () => location.reload(); // sunucuyu yeniden yokla
const rolTR = { ogrenci: "Öğrenci", ogretmen: "Öğretmen", mudur: "Müdür Yardımcısı", admin: "Admin" }; // sunucu kodu -> Türkçe

// --- Kayıtlı veriler (yerel önbellek + çevrimdışı yedek) ---
let kullanicilar = oku("kullanicilar", []); // hesaplar
let aktif = oku("aktifKullanici", null); // giriş yapan
let odevler = oku("odevler", []); // gönderiler
let hocaSorular = oku("hocaSorular", []); // hocaya sorular (Aşama 4'e kadar yerel)
let bildirimler = oku("bildirimler", []); // bildirimler (Aşama 3'e kadar yerel)
let sikayetler = oku("sikayetler", []); // şikayet kuyruğu

// --- Eski kayıtları yeni biçime çevir ---
odevler = odevler.map(o => ({
  id: o.id ?? idUret(), isim: o.isim || o.yazar || "Anonim", tur: o.tur || "Soru", ders: o.ders || "Genel",
  sinif: o.sinif || "", baslik: o.baslik || "", aciklama: o.aciklama || "", resimler: o.resimler || [],
  cevaplar: (o.cevaplar || []).map(c => typeof c === "string" ? { id: idUret(), yazar: "Akran", metin: c, yanitlar: [] } : { ...c, yanitlar: c.yanitlar || [] }),
  begen: Array.isArray(o.begen) ? o.begen : [],
  cozuldu: !!o.cozuldu, sikayet: o.sikayet || 0, tarih: o.tarih || ""
}));
hocaSorular = hocaSorular.map(s => ({ id: s.id || idUret(), ogrenci: s.ogrenci || "Anonim", hoca: s.hoca || "", ders: s.ders || "Genel", baslik: s.baslik || "Soru", soru: s.soru || "", gizli: s.gizli || "ozel", durum: s.durum || "Beklemede", cevap: s.cevap || "", puan: s.puan || 0, paylasildi: !!s.paylasildi, tarih: s.tarih || "" }));
yaz("odevler", odevler); yaz("hocaSorular", hocaSorular); // çevrilmiş hali kaydet
kullanicilar.forEach(k => { if (k.rol === "Hoca") k.rol = "Öğretmen"; (k.rozetler || []).forEach((r, i) => { if (r === "Hoca Yıldızı") k.rozetler[i] = "Öğretmen Yıldızı"; }); }); // eski kayıtlar
if (aktif && aktif.rol === "Hoca") aktif.rol = "Öğretmen"; // eski oturum
yaz("kullanicilar", kullanicilar); if (aktif) yaz("aktifKullanici", aktif); // güncel hali kaydet

// --- Örnek veriler (yerel boşsa bir kez) ---
if (!kullanicilar.length && !localStorage.getItem("v2seed")) {
  kullanicilar = [
    { ad: "admin", sifre: "admin123", rol: "Admin", puan: 0, rozetler: [], uyari: 0, takip: [], kaydet: [] },
    { ad: "AyseHoca", sifre: "hoca123", rol: "Öğretmen", brans: "Matematik", onay: true, puan: 0, rozetler: [], uyari: 0, takip: [], kaydet: [] },
    { ad: "MehmetHoca", sifre: "hoca123", rol: "Öğretmen", brans: "Fen", onay: true, puan: 0, rozetler: [], uyari: 0, takip: [], kaydet: [] },
    { ad: "ZeynepHoca", sifre: "hoca123", rol: "Öğretmen", brans: "Türkçe", onay: false, puan: 0, rozetler: [], uyari: 0, takip: [], kaydet: [] },
    { ad: "Ali", sifre: "1234", rol: "Öğrenci", sinif: "9", puan: 0, rozetler: [], uyari: 0, takip: [], kaydet: [] },
    { ad: "Elif", sifre: "1234", rol: "Öğrenci", sinif: "10", puan: 0, rozetler: [], uyari: 0, takip: [], kaydet: [] }
  ];
  odevler = [
    { id: idUret(), isim: "Ali", tur: "Soru", ders: "Matematik", sinif: "9. Sınıf", baslik: "Denklemde takıldım", aciklama: "2x+3=11 nasıl çözülür?", resimler: [], cevaplar: [{ id: idUret(), yazar: "Elif", metin: "Önce 3'ü karşıya at: 2x=8, x=4", yanitlar: [] }], begen: ["Elif"], cozuldu: false, sikayet: 0, tarih: new Date().toLocaleString("tr-TR") }
  ];
  yaz("kullanicilar", kullanicilar); yaz("odevler", odevler); // kaydet
  yaz("v2seed", true); // bir daha ekleme
}

// --- Sayfa geçişleri ---
const sayfalar = { akis: "sayfaAkis", kesfet: "sayfaKesfet", hoca: "sayfaHoca", odalar: "sayfaOdalar", sohbet: "sayfaSohbet", profil: "sayfaProfil", kaydedilenler: "sayfaKaydedilenler", notlar: "sayfaNotlar", liderlik: "sayfaLiderlik", rozetler: "sayfaRozetler", bildirim: "sayfaBildirim", denetim: "sayfaDenetim", program: "sayfaProgram", ekarne: "sayfaEkarne", kurallar: "sayfaKurallar", hesap: "sayfaHesap", ayarlar: "sayfaAyarlar" };
let aktifSayfa = "akis"; // şu an açık sayfa (kaydedilmemiş not koruması için)
function sayfaGoster(h) { // hangi sayfa açılsın
  if (aktifSayfa === "notlar" && h !== "notlar" && typeof notKirliVar === "function" && notKirliVar()) { // nottan çıkarken kaydedilmemiş değişiklik
    if (!confirm("Kaydedilmemiş not değişikliği var. Çıkmak istediğine emin misin? (Değişiklikler kaybolur.)")) return; // vazgeçerse kal
    notKirliTemizle(); // onayladıysa işareti temizle
  }
  aktifSayfa = h; // yeni aktif sayfa
  Object.entries(sayfalar).forEach(([k, id]) => document.getElementById(id).style.display = k === h ? "block" : "none");
  const eslesme = { akis: "btnAkis", kesfet: "btnKesfet", hoca: "btnHoca", profil: "btnProfil", kurallar: "btnKurallar", hesap: "btnHesap" }; // alt bar eşleşmesi
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("aktif", b.id === eslesme[h])); // aktif alt sekme
  document.querySelectorAll("#yanMenu .yanOge").forEach(b => b.classList.toggle("aktif", b.dataset.sayfa === h && !b.dataset.kaydir)); // tek seçim: alt bölümler değil, sade sayfa yanar
  if (h === "profil") { profilGoster(); if (typeof hesapDurumCiz === "function") hesapDurumCiz(); } // profile girince yenile + video/hesap durumu
  if (h === "hoca") { listeleHocalar(); listeleHoca(); } // hocaya girince yenile
  if (h === "hesap") adminGoster(); // hesaba girince admini yenile
  if (h === "kesfet") kesfetGoster(); // keşfete girince yenile
  if (h === "akis") tazeCiz(); // akışa dönünce tazele
  if (h === "odalar") odaListele(); // odalara girince yenile
  if (h === "ayarlar") ayarYukle(); // ayarlara girince formu doldur
  if (h === "kaydedilenler") kaydetCiz(); // kayıtlıları çiz
  if (h === "liderlik") liderlikCiz(); // tabloyu çiz
  if (h === "rozetler") rozetCiz(); // vitrini çiz
  if (h === "bildirim") bildirimCiz(); // paneli çiz
  if (h === "denetim") { denetimGoster(); if (typeof videoModeratorCiz === "function") videoModeratorCiz(); } // metin kuyruğu + video paneli
  if (h === "program") { yukleProgram().then(programCiz); programCiz(); } // önce önbellek, sonra tazele
  if (h === "ekarne") { yukleEkarne().then(ekarneCiz); ekarneCiz(); } // önce önbellek, sonra tazele
  if (h === "sohbet") { sohbetListele(); sohbetModYaz(); } // listeyi + modu yaz
  if (h === "notlar") notlariYukle(); // notları tazele (sunucu/yerel)
  sagPanelGoster(); // sağ paneli her sayfada tazele
}
btnAkis.onclick = () => sayfaGoster("akis"); btnHoca.onclick = () => sayfaGoster("hoca");
btnProfil.onclick = () => profilimAc(); btnKurallar.onclick = () => sayfaGoster("kurallar");
btnHesap.onclick = () => sayfaGoster("hesap"); btnKesfet.onclick = () => sayfaGoster("kesfet");

// --- Küçük görsel yardımcılar ---
function ikonTazele() { if (window.lucide) lucide.createIcons(); } // yeni ikonları çiz
function kalpGoster(x, y) { // çift tıkta büyüyen kalp
  const k = document.createElement("div"); k.className = "kalpPatlama"; k.textContent = "♥"; k.style.color = "#dc2626";
  k.style.left = (x - 32) + "px"; k.style.top = (y - 32) + "px"; document.body.appendChild(k);
  setTimeout(() => k.remove(), 850); // animasyon bitince kaldır
}
function konfeti() { // rozet kazanınca renkli yağmur
  const renkler = ["#16a34a", "#facc15", "#2563eb", "#dc2626", "#9333ea"];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement("div"); p.className = "konfeti";
    p.style.left = Math.random() * 100 + "vw"; p.style.background = renkler[i % renkler.length];
    document.body.appendChild(p); setTimeout(() => p.remove(), 1700);
  }
}
// --- Sol çekmece menü: hover + hamburger + swipe + sabitleme (erişilebilir) ---
let menuAcik = false; // menü şu an açık mı
let hoverSure = null, cikisSure = null; // yanlışlıkla açılmayı önleyen sayaçlar
let odakDonus = null; // menü kapanınca odak buraya döner
const genisEkran = () => window.innerWidth > 768; // masaüstü mü
const inceIsaretci = () => window.matchMedia("(pointer: fine)").matches; // fare var mı
function menuAcKapa(ac, neden) { // tek kapıdan aç/kapa
  if (ac && document.body.classList.contains("menu-sabit") && genisEkran()) return; // sabitken zaten açık
  if (ac && !menuAcik) odakDonus = document.activeElement; // dönüş odağını sakla
  menuAcik = ac;
  document.getElementById("yanMenu").classList.toggle("acik", ac); // genişlet
  document.getElementById("btnHamburger").setAttribute("aria-expanded", ac); // ekran okuyucuya söyle
  if (!genisEkran()) { // mobil: karart + arka planı kilitle
    document.getElementById("karartma").classList.toggle("acik", ac); // karartma
    document.querySelector(".kabuk").toggleAttribute("inert", ac); // arka içerik dokunulmaz/okunmaz
    document.body.style.overflow = ac ? "hidden" : ""; // kaydırma kilidi
    if (!ac && odakDonus && odakDonus.focus) odakDonus.focus(); // odağı geri ver
  }
  if (ac && neden !== "hover") document.querySelector("#yanMenu .yanOge")?.focus(); // klavye odağı menüye
}
function kenarAc() { // hover ile açma denemesi (menü üstünde de çalışır!)
  if (!genisEkran() || !inceIsaretci() || document.body.classList.contains("menu-sabit")) return; // mobil/sabitte çalışmaz
  clearTimeout(cikisSure); hoverSure = setTimeout(() => menuAcKapa(true, "hover"), 150); // 150ms beklerse aç (değip geçince açılmaz)
}
document.getElementById("kenarBolge").addEventListener("mouseenter", kenarAc); // sol kenara yaklaşınca
document.getElementById("yanMenu").addEventListener("mouseenter", kenarAc); // dar menünün üstünde durunca da açılır (tetikleyici arkada kalmaz!)
document.getElementById("kenarBolge").addEventListener("mouseleave", () => clearTimeout(hoverSure)); // erken ayrıldı, açma
document.getElementById("yanMenu").addEventListener("mouseleave", () => { // menüden ayrılınca
  if (!genisEkran() || document.body.classList.contains("menu-sabit")) return;
  clearTimeout(hoverSure); cikisSure = setTimeout(() => { if (!document.getElementById("yanMenu").contains(document.activeElement)) menuAcKapa(false); }, 300); // odaktaysa kapatma
});
document.getElementById("karartma").onclick = () => menuAcKapa(false); // dışarı dokun kapat
document.getElementById("btnHamburger").onclick = () => { // hamburger: mobilde çekmece, masaüstünde sabitle
  if (!genisEkran()) return menuAcKapa(!menuAcik); // mobil drawer
  const sabit = !document.body.classList.contains("menu-sabit"); // tersine çevir
  document.body.classList.toggle("menu-sabit", sabit); // sabitle/bırak
  cihazYaz("menuSabit", sabit); // cihaz tercihi (demo dahil aynı)
  document.getElementById("btnHamburger").setAttribute("aria-expanded", sabit);
};
if (cihazOku("menuSabit", false) && genisEkran()) { document.body.classList.add("menu-sabit"); document.getElementById("btnHamburger").setAttribute("aria-expanded", "true"); } // kayıtlı tercih + erişilebilir durum
// Mobil odak tuzağı: çekmece açıkken Sekme menüde döner
document.getElementById("yanMenu").addEventListener("keydown", e => {
  if (e.key !== "Tab" || genisEkran() || !menuAcik) return; // yalnız mobil açık menüde
  const odaklar = [...document.getElementById("yanMenu").querySelectorAll("button, input, select, [tabindex]")].filter(el => el.offsetParent !== null && !el.disabled); // yalnız GERÇEKTEN görünür+etkin (gizli/disabled girmez!)
  if (!odaklar.length) return;
  const ilk = odaklar[0], son = odaklar[odaklar.length - 1]; // sınırlar
  if (e.shiftKey && document.activeElement === ilk) { e.preventDefault(); son.focus(); } // başa sar
  else if (!e.shiftKey && document.activeElement === son) { e.preventDefault(); ilk.focus(); } // sona sar
});
// Dar ekran paneli: yüzen düğmeyle açılır kutu (içeriğin altına düşmez)
function panelKip() { // genişliğe göre panel kipini eşitle
  const dar = window.innerWidth < 1100; // dar ekran mı
  document.getElementById("sagPanel").classList.toggle("mobil", dar); // kip sınıfı
  if (!dar) document.getElementById("sagPanel").classList.remove("acik"); // genişte kutuyu kapat
}
panelKip(); // açılışta eşitle
document.getElementById("btnPanel").onclick = () => { // aç/kapa
  const p = document.getElementById("sagPanel");
  p.classList.toggle("acik");
  if (p.classList.contains("acik")) sagPanelGoster(); // açılınca tazele
};
let genislikSon = window.innerWidth > 768; // son bilinen kip (menü eşiği)
// 768 (menü) ve 1100 (panel) eşikleri BAĞIMSIZ izlenir (1200→1000→1200 ve 800→700→800 güvenli)
if (window.matchMedia) {
  window.matchMedia("(min-width: 1100px)").addEventListener("change", () => panelKip()); // panel eşiği tek başına
}
window.addEventListener("resize", () => {
  const simdi = window.innerWidth > 768; // yeni kip
  if (simdi === genislikSon) return; // kip değişmedi
  genislikSon = simdi;
  panelKip(); // panel kipini de eşitle
  document.getElementById("karartma").classList.remove("acik"); // karartmayı kaldır
  document.querySelector(".kabuk")?.removeAttribute("inert"); // kilidi aç
  document.body.style.overflow = ""; // kaydırmayı aç
  if (simdi) menuAcKapa(false); // masaüstüne geçince çekmeceyi kapat (sabit hariç kendini korur)
  else { document.getElementById("yanMenu").classList.remove("acik"); menuAcik = false; } // mobile geçince kapat
});
let dokunBasX = null; // swipe takibi
document.addEventListener("touchstart", e => { if (e.touches[0].clientX < 32) dokunBasX = e.touches[0].clientX; }, { passive: true }); // sol kenardan başladı mı
document.addEventListener("touchend", e => { // sağa kaydırdıysa aç
  if (dokunBasX !== null && e.changedTouches[0].clientX - dokunBasX > 60 && !genisEkran()) menuAcKapa(true);
  dokunBasX = null;
}, { passive: true });
// Yan menü tıklamaları: sayfa + kaydırma + çıkış
document.querySelectorAll("#yanMenu .yanOge").forEach(b => b.onclick = () => {
  document.querySelectorAll("#yanMenu .yanOge").forEach(x => x.classList.remove("aktif")); // önce hepsini söndür
  b.classList.add("aktif"); // yalnız tıklanan yansın (tek seçim)
  if (b.dataset.aksiyon === "paylas") { // hızlı paylaş: forma odaklan
    paylasimBaslat(null); // yazı türü değişmez; ders yoksa 1. adımda DERS seçicisine odak (başlık 2. adımda kalıyordu!)
  } else if (b.dataset.aksiyon === "cikis") { // çıkış yap (misafirse girişe götür)
    if (!aktif) { sayfaGoster("hesap"); toast("Önce giriş yap!"); }
    else { btnCikis.onclick(); return; } // sayfa yenilenir
  } else { // normal sayfa (+ varsa alt bölüme kaydır)
    if (b.dataset.sayfa === "profil") goruntulenen = null; // "Profil" = KENDİ profilim: bayat "başkası" durumu SIFIRLANIR
    sayfaGoster(b.dataset.sayfa);
    if (b.dataset.kaydir) document.getElementById(b.dataset.kaydir)?.scrollIntoView({ block: "start" });
  }
  if (!genisEkran()) menuAcKapa(false); // mobilde seçince kapat
  else if (!document.body.classList.contains("menu-sabit")) menuAcKapa(false); // hover ile açıldıysa kapat
});
// --- Bildirim baloncuğu ---
function htmlKacis(m) { // metni güvenli yaz (XSS engeli: < > & " ' kaçar)
  return String(m ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function gorselGuvenli(src) { // yalnız gerçek resim verisi kabul et (data:image/...)
  return typeof src === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(src);
}
let toastSure = null; // eski zamanlayıcı
function toast(m) { // altta 2 sn görünen mesaj
  const t = document.getElementById("toast"); t.textContent = m; t.style.display = "block";
  clearTimeout(toastSure); toastSure = setTimeout(() => t.style.display = "none", 2200);
}

// --- Karanlık mod (sürgülü anahtar) ---
if (cihazOku("karanlik", false)) document.body.classList.add("karanlik"); // tercihi hatırla
btnKaranlik.checked = document.body.classList.contains("karanlik"); // anahtarı eşitle
btnKaranlik.onclick = () => { document.body.classList.toggle("karanlik"); cihazYaz("karanlik", document.body.classList.contains("karanlik")); };

// --- Etik filtre (yerel yedek; sunucu da kendi filtresini uygular) ---
const yasakli = ["küfür", "aptal", "salak", "gerizekalı", "hakaret", "reklam", "iddia"];
function etikMi(m) { return !yasakli.some(k => (m || "").toLowerCase().includes(k)); } // yasaklı var mı

// --- Bildirim ekle (yerelde cebe at, sunucudaysa sunucu yazar) ---
function bildir(kime, metin) {
  if (MOD === "sunucu") return; // sunucu modunda bildirimler backend'den gelir (çift yazma!)
  bildirimler.unshift({ id: idUret(), kime, metin, tarih: new Date().toLocaleString("tr-TR"), okundu: false }); yaz("bildirimler", bildirimler);
}
async function tazeBildirim() { // sunucudan bildirimleri çek (cihazlar arası aynı)
  if (MOD !== "sunucu" || !aktif) return;
  try {
    const liste = await api.bildirimler(); // bana gelenler
    bildirimler = liste.map(b => ({ id: b.id, kime: aktif.ad, metin: b.metin, tarih: b.tarih, okundu: !!b.okundu }));
    aktifGoster(); // sayacı tazele
  } catch { /* sessiz geç */ }
}

// --- Hesap işlemleri (önce sunucu, olmazsa yerel) ---
function aktifGoster() { // üstte kim yazar
  document.getElementById("aktifKullanici").textContent = aktif ? `👤 ${aktif.ad} (${aktif.rol}) ⭐${aktif.puan || 0}` : "👤 Giriş yapılmadı";
  const okunmadi = bildirimler.filter(b => aktif && b.kime === aktif.ad && !b.okundu).length; // okunmamış sayısı
  document.getElementById("bildirimSayi").textContent = okunmadi ? `(${okunmadi})` : "";
  document.getElementById("ustBildirim").textContent = okunmadi ? okunmadi : ""; // üst bar sayacı
  document.getElementById("yanAvatar").textContent = aktif ? aktif.ad[0].toUpperCase() : "?"; // yan menü kimliği
  document.getElementById("yanAd").textContent = aktif ? aktif.ad : "Misafir";
  document.getElementById("yanRol").textContent = aktif ? aktif.rol + " ⭐" + (aktif.puan || 0) : "Giriş yap";
  document.getElementById("yanDenetim").style.display = (aktif && (aktif.rol === "Admin" || aktif.rol === "Müdür Yardımcısı")) ? "" : "none"; // denetim yalnız yetkiliye
  const cikisOge = document.querySelector('#yanMenu [data-aksiyon="cikis"]'); // çıkış/giriş etiketi
  if (cikisOge) { cikisOge.querySelector(".yazi").textContent = aktif ? "Çıkış" : "Giriş Yap"; }
  modGoster(); // modu da tazele
}
// Sol üst avatar: giriş yaptıysan profilin, yapmadıysan hesap (giriş) ekranı
document.getElementById("yanUst").onclick = () => {
  if (aktif) { goruntulenen = null; sayfaGoster("profil"); }
  else sayfaGoster("hesap");
  if (!genisEkran()) menuAcKapa(false); // mobilde kapat
};
function yerelAyna(ad, rol, brans, sinif) { // sunucu hesabını yerele de işle (takip/kayıt yerelde durur)
  let k = kullanicilar.find(x => x.ad === ad);
  if (!k) { k = { ad, sifre: "", rol, brans: brans || "", sinif: sinif || "", onay: true, puan: 0, rozetler: [], uyari: 0, takip: [], kaydet: [] }; kullanicilar.push(k); }
  else { k.rol = rol; if (brans) k.brans = brans; if (sinif) k.sinif = sinif; }
  yaz("kullanicilar", kullanicilar); return k;
}
btnKayit.onclick = async () => {
  const ad = kayitAd.value.trim(), sifre = kayitSifre.value, rolTR = kayitRol.value; // form
  if (!ad || !sifre) return toast("Ad ve şifre yaz!");
  if (!kayitKural.checked) return toast("Kuralları kabul etmelisin!"); // onay kutusu şart
  if (SUNUCU) { // sunucu varsa oraya kaydol
    try {
      const r = await api.kayit({ ad, sifre, rol: rolTR === "Öğretmen" ? "ogretmen" : "ogrenci", brans: kayitBrans.value, sinif: kayitSinif.value, kurallar: true });
      yerelAyna(ad, rolTR, kayitBrans.value, kayitSinif.value); // yerele de işle
      return toast(r.tamam || "Hesap açıldı!");
    } catch (e) { return toast(e.message); } // sunucu hatasını göster
  }
  if (kullanicilar.some(k => k.ad === ad)) return toast("Bu ad alınmış!"); // yerel kayıt
  kullanicilar.push({ ad, sifre, rol: rolTR, brans: kayitBrans.value, sinif: kayitSinif.value, onay: rolTR !== "Öğretmen", puan: 0, rozetler: [], uyari: 0, takip: [], kaydet: [] });
  yaz("kullanicilar", kullanicilar); // kaydet
  toast(rolTR === "Öğretmen" ? "Kaydoldun! Admin onayı bekliyorsun." : "Hesap açıldı, giriş yap!");
};
btnGiris.onclick = async () => {
  const ad = girisAd.value.trim(), sifre = girisSifre.value; // form
  if (SUNUCU) { // sunucu varsa oradan gir
    try {
      const r = await apiCagir(() => api.giris({ ad, sifre })); // bilet al (401/403 merkezi)
      biletYaz(r.bilet); // bileti sakla
      const ben = await apiCagir(() => api.ben()); // bilgiyi çek (bozuksa oturum temizlenir!)
      const k = yerelAyna(ben.ad, rolTR[ben.rol] || ben.rol, ben.brans, ben.sinif); // yerele işle
      k.puan = ben.puan || 0; yaz("kullanicilar", kullanicilar);
      aktif = { ad: ben.ad, rol: rolTR[ben.rol] || ben.rol, puan: ben.puan || 0 }; // oturumu aç
      MOD = "sunucu"; yaz("aktifKullanici", aktif); aktifGoster(); await notlariSifirla(); await takipYukle(); await tazeCiz(); await yukleProgram(); await yukleEkarne(); sayfaGoster("akis"); turBelki(); // ilk girişse tur
      return;
    } catch (e) { if (!e.islendi) return toast(e.message); return; } // yanlış şifre vb. (merkezi zaten söylediysa sus!)
  }
  const b = kullanicilar.find(k => k.ad === ad && k.sifre === sifre); // yerel eşleşme
  if (!b) return toast("Ad veya şifre yanlış!");
  if (b.askida) return toast("Hesabın askıda! Admin ile görüş.");
  aktif = { ad: b.ad, rol: b.rol, puan: b.puan }; // oturumu aç
  yaz("aktifKullanici", aktif); aktifGoster(); await notlariSifirla(); await takipYukle(); listeleOdev(); sayfaGoster("akis"); turBelki(); // ilk girişse tur
};
btnCikis.onclick = () => { aktif = null; takipOnbellek = []; takipGiden = []; biletYaz(null); MOD = "yerel"; localStorage.removeItem("aktifKullanici"); localStorage.removeItem("demoModu"); location.reload(); };
btnSifirla.onclick = () => { ["kullanicilar", "odevler", "hocaSorular", "bildirimler", "sikayetler", "aktifKullanici", "bilet", "v2seed"].forEach(k => localStorage.removeItem(k)); notDepoTemizle(); location.reload(); }; // demo/misafir notları + panel düzeni de temizlenir

// --- Paylaşım sihirbazı (4 adım) ---
function adimGit(n) { // adımı göster, çubuğu doldur
  [1, 2, 3, 4].forEach(i => document.getElementById("adim" + i).classList.toggle("acik", i === n));
  document.getElementById("adimBar").style.width = (n * 25) + "%"; // %25, %50...
  if (n === 4) { // son adımda önizlemeyi doldur
    document.getElementById("onizleme").innerHTML = `<b>${htmlKacis(baslik.value) || "(başlıksız)"}</b><p>${htmlKacis(aciklama.value) || ""}</p><small>#${htmlKacis(ders.value) || "?"} • ${htmlKacis(tur.value)}</small>`;
  }
  ikonTazele();
}
// Hızlı paylaşım ortak yolu: geçerli adıma ODAKLI ilerleme (adım + alana odak; toast yeterli değil)
const ADIM_ALANLARI = { 1: () => ders, 2: () => baslik, 3: () => resimler, 4: () => document.getElementById("onizleme") }; // her adımın odaklanacak alanı (açıklama da 2. adımda!)
function adimOdakla(n, mesaj, alan) { // adımı aç + ilgili alana git ve odaklan (alan verilirse ONU odaklar)
  adimGit(n);
  const hedef = alan || (ADIM_ALANLARI[n] || (() => null))(); // görünür adımın alanı
  if (hedef) {
    if (typeof hedef.focus === "function") hedef.focus(); // zorunlu alan odaklanır (görünmeyen alana odak YOK)
    if (typeof hedef.scrollIntoView === "function") hedef.scrollIntoView({ block: "center" });
  }
  if (mesaj) toast(mesaj); // neden durulduğu söylenir
}
function paylasimBaslat(turAdi) { // hızlı paylaşım: yazı türü KORUNUR, geçerli adımdan devam edilir
  if (turAdi) tur.value = turAdi; // "Soru" / "Konu Özeti" niyeti
  sayfaGoster("akis");
  window.scrollTo(0, 0);
  if (!ders.value) return adimOdakla(1, "Önce ders seç!"); // ders 1. adımda: oraya dön + seçiciye odak
  adimOdakla(2); // ders geçerliyse ilgili adıma devam
}
btnIleri1.onclick = () => { if (!ders.value) return adimOdakla(1, "Önce ders seç!"); adimGit(2); }; // ders şart
btnGeri2.onclick = () => adimGit(1);
btnIleri2.onclick = () => { if (!baslik.value) return adimOdakla(2, "Başlık yaz!"); adimGit(3); }; // başlık şart
btnGeri3.onclick = () => adimGit(2);
btnIleri3.onclick = () => adimGit(4);
btnGeri4.onclick = () => adimGit(3);
// Sürükle-bırak: dosyayı alana bırakınca seçilmiş say
birakAlan.onclick = () => resimler.click(); // tıkla = dosya seç
birakAlan.ondragover = e => { e.preventDefault(); birakAlan.classList.add("ustunde"); }; // üstündeyken boya
birakAlan.ondragleave = () => birakAlan.classList.remove("ustunde");
birakAlan.ondrop = e => { e.preventDefault(); birakAlan.classList.remove("ustunde"); resimler.files = e.dataTransfer.files; resimler.onchange(); }; // bırak, önizle

// --- Gönderi paylaşma ---
let seciliResimler = []; // seçilen resimler (önizleme)
let mevcutResimler = []; // düzenlemede gelen eski resimler (başlık değişince SİLİNMEZ)
let resimBekleyen = 0; // okunması süren dosya (erken paylaşıma engel)
function onizThumbCiz() { // eski + yeni küçük resimler (tıkla-kaldır)
  const alan = document.getElementById("onizThumb"); alan.innerHTML = "";
  mevcutResimler.forEach((r, i) => { const t = document.createElement("img"); t.src = r; t.alt = "mevcut resim"; t.title = "Kaldırmak için tıkla"; t.onclick = () => { mevcutResimler.splice(i, 1); onizThumbCiz(); }; alan.appendChild(t); }); // eskiden kaldır
  seciliResimler.forEach((r, i) => { const t = document.createElement("img"); t.src = r; t.alt = "yeni resim"; t.title = "Kaldırmak için tıkla"; t.onclick = () => { seciliResimler.splice(i, 1); onizThumbCiz(); }; alan.appendChild(t); }); // yeniden kaldır
}
resimler.onchange = () => {
  seciliResimler = []; // sıfırla (eskiler durur)
  const dosyalar = [...resimler.files].slice(0, 4); // ilk 4 dosya
  resimBekleyen = dosyalar.length; // hepsi okunana kadar paylaşma kapalı
  btnEkle.disabled = !!resimBekleyen; // erken gönderme engeli
  if (!dosyalar.length) { onizThumbCiz(); return; }
  dosyalar.forEach(f => {
    const bitir = () => { resimBekleyen--; if (!resimBekleyen) btnEkle.disabled = false; }; // sayaç
    if (f.size > 5 * 1024 * 1024) { toast(f.name + " 5MB üstü!"); return bitir(); } // boyut kontrolü
    const r = new FileReader(); // resmi yazıya çevirir
    r.onload = e => { if (!gorselGuvenli(e.target.result)) toast("Bu dosya resim değil!"); else { seciliResimler.push(e.target.result); onizThumbCiz(); } bitir(); };
    r.onerror = bitir; // okunamazsa sayaç takılmaz
    r.readAsDataURL(f);
  });
};
let duzenlenenId = null; // doluysa Paylaş butonu güncelleme yapar
btnEkle.onclick = async () => {
  if (!aktif) return toast("Önce giriş yap!");
  if (resimBekleyen) return toast("Resimler okunuyor, biraz bekle!"); // eksik gönderme yok
  if (!ders.value) return adimOdakla(1, "Ders seçmek zorunlu!"); // eğitim dışı engeli: 1. adıma dön + seçiciye odak
  if (!baslik.value) return adimOdakla(2, "Başlık yaz!"); // başlık 2. adımda
  if (!etikMi(baslik.value + " " + aciklama.value)) { const bHatali = !etikMi(baslik.value); return adimOdakla(2, "🚫 Etik kurallara aykırı!", bHatali ? baslik : aciklama); } // ikisi de 2. adımda; HATALI alana git
  const veri = { tur: tur.value, ders: ders.value, sinif: sinif.value, baslik: baslik.value, aciklama: aciklama.value, resimler: [...mevcutResimler, ...seciliResimler] }; // eski + yeni resimler
  const temizleForm = () => { baslik.value = ""; aciklama.value = ""; seciliResimler = []; mevcutResimler = []; resimler.value = ""; onizThumbCiz(); adimGit(1); }; // formu başa al
  if (MOD === "sunucu") { // sunucuya yaz (çift tıklama kilitli)
    btnEkle.disabled = true;
    try {
      let sonuc;
      if (duzenlenenId) sonuc = await api.gonderiDuzenle(duzenlenenId, veri); // güncelle
      else sonuc = await api.gonderiEkle(veri); // yeni
      duzenlenenId = null; btnEkle.textContent = "Paylaş";
      temizleForm();
      await tazeCiz(); toast(sonuc && sonuc.bilgi ? sonuc.bilgi : "Paylaşıldı! 🎉"); return; // incelemedeyse dürüst mesaj
    } catch (e) { toast(e.message); } finally { btnEkle.disabled = false; }
    return;
  }
  if (duzenlenenId) { // yerel düzenleme (resimler korunur, × ile silinir)
    const o = odevler.find(x => x.id === duzenlenenId);
    Object.assign(o, { tur: tur.value, ders: ders.value, sinif: sinif.value, baslik: baslik.value, aciklama: aciklama.value, resimler: [...mevcutResimler, ...seciliResimler] });
    duzenlenenId = null; btnEkle.textContent = "Paylaş"; // normale dön
  } else { // yerel yeni gönderi
    odevler.unshift({ id: idUret(), isim: aktif.ad, tur: tur.value, ders: ders.value, sinif: sinif.value, baslik: baslik.value, aciklama: aciklama.value, resimler: [...seciliResimler], cevaplar: [], begen: [], cozuldu: false, sikayet: 0, tarih: new Date().toLocaleString("tr-TR") });
  }
  yaz("odevler", odevler); // temizle
  temizleForm();
  listeleOdev(ara.value); toast("Paylaşıldı! 🎉");
};

// --- Sunucudan tazele + çiz (tek kapı; yeniden=true filtre değişiminde) ---
let gorunen = 10; // sayfada kaç gösterilsin
let devamVar = true; // sunucuda daha var mı
let aramaKontrol = null; // eski aramayı iptal eder (geç cevap yeniyi ezmez)
let ilkYukleme = true; // ilk açılışta iskelet ~1 sn görünsün (boş ekran yerine "yükleniyor" hissi)
function iskeletGoster(n = 3) { odevListesi.innerHTML = Array.from({ length: n }, () => "<div class='iskelet'></div>").join(""); } // yükleme iskeleti
async function tazeCiz(yeniden = true) {
  if (MOD === "sunucu") {
    if (yeniden) { odevler = []; gorunen = 10; } // filtre değişti: başa sar
    if (yeniden) iskeletGoster(); // ilk yüklemede iskelet (içerik gelene kadar)
    const t0 = Date.now(); // iskelet süresi ölçümü
    await tazeGonderiler();
    if (ilkYukleme) { // YALNIZ ilk açılış: iskelet en az 1 sn kalsın (ekran boş/atlama hissi olmasın)
      const kalan = 1000 - (Date.now() - t0);
      if (kalan > 0) await new Promise(r => setTimeout(r, kalan));
      ilkYukleme = false;
    }
  } else if (yeniden) gorunen = 10; // yerelde başa sar
  listeleOdev(ara.value); // yerel arama DAHİL hep filtreyle çiz
}
async function tazeGonderiler() { // filtreleri sunucuya sor (iptal edilebilir)
  try {
    if (aramaKontrol) aramaKontrol.abort(); // eski isteği öldür (yarış yok)
    aramaKontrol = new AbortController(); // yeni istek
    const res = await api.gonderiler({ arama: ara.value, ders: filtreDers.value, tur: filtreTur.value, durum: filtreDurum.value, siralama: siralama.value, limit: 10, offset: odevler.length }, aramaKontrol.signal);
    if (!Array.isArray(res)) throw new Error("Sunucu yanıtı bozuk!");
    odevler = [...odevler, ...res]; // SONA EKLE (offset sayfalama, tekrar yok)
    gorunen = odevler.length; // hepsi görünür
    devamVar = res.length === 10; // 10'dan az geldiyse son sayfa
    btnDaha.style.display = devamVar ? "" : "none"; // bittiyse gizle
  } catch (e) {
    if (e && (e.iptal || e.name === "AbortError")) return; // iptal/zaman aşımı normaldir, sessiz geç
    if (localStorage.getItem("demoModu") === "acik") { MOD = "yerel"; aktifGoster(); odevler = oku("odevler", []); } // demoda yerel yedek serbest
    else baglantiHatasiGoster(); // gerçek modda sessizce geçme, hatayı göster
  }
}

// --- Filtreler (değişince başa sar) ---
["filtreDers", "filtreTur", "filtreDurum", "siralama"].forEach(id => document.getElementById(id).onchange = () => tazeCiz(true));
let araSure = null; // arama bekletme (her harfte istek atmasın)
ara.oninput = () => { clearTimeout(araSure); araSure = setTimeout(() => tazeCiz(true), 300); };
{ const d = ["Matematik", "Fizik", "Kimya", "Biyoloji", "Türkçe", "Tarih", "İngilizce", "Coğrafya", "Diğer"]; d.forEach(x => { const o = document.createElement("option"); o.textContent = x; filtreDers.appendChild(o); }); } // ders filtresi doldur
btnDaha.onclick = () => { // devamını yükle (offset sayfalama)
  if (MOD === "sunucu") { if (devamVar) tazeCiz(false); } // sunucudan sonrakiler
  else { gorunen += 10; listeleOdev(ara.value); } // yerelde kesimi büyüt
};

// --- Akışı çiz ---
function listeleOdev(filtre = "") {
  const alan = odevListesi; alan.innerHTML = ""; // temizle
  // Hikaye şeridi: son 8 çözülen, tıkla derse süz
  const serit = document.getElementById("cozulenSerit"); serit.innerHTML = "";
  odevler.filter(o => o.cozuldu && (o.sikayet || 0) < 3).slice(0, 8).forEach(o => {
    const b = document.createElement("button"); b.textContent = "✅ " + o.ders + ": " + (o.baslik || "").slice(0, 14);
    b.onclick = () => { filtreDers.value = o.ders; tazeCiz(); }; serit.appendChild(b);
  });
  if (!serit.innerHTML) serit.innerHTML = "<small>Henüz çözülen yok, ilk sen çöz! 💪</small>";
  let liste = odevler.filter(o => (o.sikayet || 0) < 3); // 3 şikayetli gizlenir
  if (MOD === "yerel") { // yerelde süzme burada (sunucuda sunucu süzer)
    if (filtre) liste = liste.filter(o => (o.baslik + o.aciklama).toLowerCase().includes(filtre.toLowerCase())); // arama
    if (filtreDers.value) liste = liste.filter(o => o.ders === filtreDers.value); // ders filtresi
    if (filtreTur.value) liste = liste.filter(o => o.tur === filtreTur.value); // tür filtresi
    if (filtreDurum.value === "cozuldu") liste = liste.filter(o => o.cozuldu); // çözülmüş
    if (filtreDurum.value === "bekleyen") liste = liste.filter(o => !o.cozuldu); // bekleyen
    if (siralama.value === "populer") liste = [...liste].sort((a, b) => ((b.begen || []).length + (b.cevaplar || []).length) - ((a.begen || []).length + (a.cevaplar || []).length)); // popüler önce
  }
  if (!liste.length) { alan.innerHTML = "<div class='kutu'>Henüz gönderi yok. İlk paylaşan sen ol! 🎉</div>"; btnDaha.style.display = "none"; return; } // boş durum
  const goster = liste.slice(0, gorunen); // sayfalı göster
  if (MOD === "yerel") btnDaha.style.display = liste.length > goster.length ? "" : "none"; // yerelde devam kontrolü
  goster.forEach(o => { // sayfalı göster
    const div = document.createElement("div"); div.className = "kutu";
    const harf = (o.isim || o.yazar || "A")[0].toUpperCase(); // avatar harfi
    const isim = o.isim || o.yazar || "Anonim"; // sunucu "yazar" der
    // İsim tıklanabilir: profilini açar + ders renk rozeti + durum rozeti (hepsi güvenli metin)
    div.innerHTML = `<div class="postBas"><div class="avatar">${htmlKacis(harf)}</div><div><b><a href="#" data-kisi="${htmlKacis(isim)}">${htmlKacis(isim)}</a></b><br><span class="ders-etiket ders-${htmlKacis(o.ders)}">${htmlKacis(o.ders)}</span> <span class="durum ${o.cozuldu ? "cozuldu" : "bekliyor"}">${o.cozuldu ? "Çözüldü" : "Çözülmedi"}</span><br><small>${htmlKacis(o.tur) || "Soru"} • ${htmlKacis(o.sinif) || ""} • ${htmlKacis(o.tarih) || ""}</small></div></div><b>${htmlKacis(o.baslik)}</b><p>${htmlKacis(o.aciklama)}</p><div class="etkilesim"><span>❤ ${(o.begen || []).length}</span><span>💬 ${(o.cevaplar || []).length}</span></div>`;
    if (aktif && isim !== aktif.ad) { // İnsta usulü: ismin yanında takip butonu
      const tb = document.createElement("button"); tb.className = "takipMini";
      tb.textContent = takipEtiket(isim);
      tb.onclick = () => takipDegistir(isim);
      div.querySelector(".postBas").appendChild(tb);
    }
    if ((o.resimler || []).length) { // kaydırmalı galeri (çok resim yan yana)
      const gal = document.createElement("div"); gal.className = "galeri";
      o.resimler.forEach(r => { if (!gorselGuvenli(r)) return; const img = document.createElement("img"); img.src = r; img.alt = "gönderi resmi"; img.loading = "lazy"; img.ondblclick = e => { kalpGoster(e.clientX, e.clientY); bb.click(); }; gal.appendChild(img); }); // çift tık = beğen
      div.appendChild(gal);
    }
    // Yorum yaz
    const yi = document.createElement("input"); yi.placeholder = "Çözümü anlat";
    const yb = document.createElement("button"); yb.innerHTML = '<i data-lucide="message-circle"></i>Yorum';
    yb.onclick = async () => {
      if (!aktif) return toast("Giriş yap!"); if (!yi.value || !etikMi(yi.value)) return toast("Yorum yaz / etik olsun!");
      if (MOD === "sunucu") { try { await api.yorumEkle(o.id, yi.value); if (isim !== aktif.ad) bildir(isim, `${aktif.ad} gönderine yorum yaptı: ${o.baslik}`); await tazeCiz(); } catch (e) { toast(e.message); } return; }
      o.cevaplar.push({ id: idUret(), yazar: aktif.ad, metin: yi.value, yanitlar: [] }); yaz("odevler", odevler); // yerel ekle
      if (isim !== aktif.ad) bildir(isim, `${aktif.ad} gönderine yorum yaptı: ${o.baslik}`); // bildirim
      listeleOdev(ara.value); profilGoster();
    };
    // Beğeni (bir kişi bir kez)
    const bb = document.createElement("button"); bb.innerHTML = (o.begen || []).includes(aktif?.ad) ? '<i data-lucide="heart-off"></i>Beğenme' : '<i data-lucide="heart"></i>Beğen';
    bb.onclick = async () => {
      if (!aktif) return toast("Giriş yap!");
      if (MOD === "sunucu") { try { await api.begen(o.id); await tazeCiz(); } catch (e) { toast(e.message); } return; }
      o.begen = o.begen || [];
      const i = o.begen.indexOf(aktif.ad); i >= 0 ? o.begen.splice(i, 1) : o.begen.push(aktif.ad); // aç/kapa
      yaz("odevler", odevler); listeleOdev(ara.value);
    };
    // Kaydet
    const kb = document.createElement("button"); kb.innerHTML = '<i data-lucide="bookmark"></i>Kaydet';
    kb.onclick = async () => {
      if (!aktif) return toast("Giriş yap!");
      if (MOD === "sunucu") { try { const r = await api.kaydet(o.id); toast(r.kaydettim ? "Kaydedildi! Profilde görürsün." : "Kayıtlardan çıkarıldı."); } catch (e) { toast(e.message); } return; }
      const me = kullanicilar.find(k => k.ad === aktif.ad);
      me.kaydet = me.kaydet || []; me.kaydet.includes(o.id) ? me.kaydet.splice(me.kaydet.indexOf(o.id), 1) : me.kaydet.push(o.id); // aç/kapa
      yaz("kullanicilar", kullanicilar); toast("Kaydedilenler güncellendi!");
    };
    // Şikayet (nedenli)
    const ss = document.createElement("select"); ["Küfür/hakaret", "Ders dışı", "Reklam/spam", "Diğer"].forEach(n => { const op = document.createElement("option"); op.textContent = n; ss.appendChild(op); });
    const sb = document.createElement("button"); sb.className = "ikincil"; sb.innerHTML = '<i data-lucide="flag"></i>Şikayet';
    sb.onclick = async () => {
      if (!aktif) return toast("Giriş yap!");
      if (MOD === "sunucu") { try { await api.sikayet(o.id, ss.value); toast("Şikayetin alındı."); await tazeCiz(); } catch (e) { toast(e.message); } return; }
      o.sikayet = (o.sikayet || 0) + 1;
      sikayetler.push({ id: idUret(), hedefId: o.id, neden: ss.value, bildiren: aktif.ad, tarih: new Date().toLocaleString("tr-TR") });
      const sahip = kullanicilar.find(k => k.ad === isim); // sahibine uyarı
      if (sahip) { sahip.uyari = (sahip.uyari || 0) + 1; if (sahip.uyari >= 3) sahip.askida = true; } // 3 uyarı = askı
      yaz("odevler", odevler); yaz("sikayetler", sikayetler); yaz("kullanicilar", kullanicilar);
      toast("Şikayetin alındı."); listeleOdev(ara.value);
    };
    div.append(yi, yb, bb, kb, ss, sb);
    // Sahibi veya admin: düzenle + sil
    if (aktif && (aktif.ad === isim || aktif.rol === "Admin")) {
      const db2 = document.createElement("button"); db2.className = "ikincil"; db2.innerHTML = '<i data-lucide="pencil"></i>Düzenle';
      db2.onclick = () => { // formu doldur, butonu güncelleme moduna al
        tur.value = o.tur || "Soru"; ders.value = o.ders; sinif.value = o.sinif || "5. Sınıf";
        baslik.value = o.baslik; aciklama.value = o.aciklama;
        mevcutResimler = [...(o.resimler || [])]; seciliResimler = []; resimler.value = ""; onizThumbCiz(); // eskiler taslağa alınır (korunur)
        duzenlenenId = o.id; btnEkle.textContent = "Güncelle"; window.scrollTo(0, 0); toast("Düzenliyorsun, bitince Güncelle!");
      };
      const silb = document.createElement("button"); silb.className = "tehlike"; silb.innerHTML = '<i data-lucide="trash-2"></i>Sil';
      silb.onclick = async () => {
        if (MOD === "sunucu") { try { await api.gonderiSil(o.id); await tazeCiz(); toast("Silindi."); } catch (e) { toast(e.message); } return; }
        odevler = odevler.filter(x => x.id !== o.id); yaz("odevler", odevler); listeleOdev(ara.value); toast("Silindi.");
      };
      div.append(db2, silb);
    }
    // Yorumlar + yanıtlar + en iyi cevap
    (o.cevaplar || []).forEach(c => {
      const p = document.createElement("div"); p.className = "cevap" + (c.enIyi ? " eniyi" : "");
      p.innerHTML = `<b><a href="#" data-kisi="${htmlKacis(c.yazar)}">${htmlKacis(c.yazar)}</a></b>: ${htmlKacis(c.metin)}`; div.appendChild(p);
      (c.yanitlar || []).forEach(y => { const r = document.createElement("div"); r.className = "yanit"; r.textContent = y.yazar + ": " + y.metin; div.appendChild(r); }); // textContent zaten güvenli
      const yb2 = document.createElement("button"); yb2.className = "ikincil"; yb2.innerHTML = '<i data-lucide="reply"></i>Yanıtla'; // yanıta cevap
      yb2.onclick = () => {
        if (!aktif) return toast("Giriş yap!");
        const ri = document.createElement("input"); ri.placeholder = "Yanıtın";
        const rb = document.createElement("button"); rb.textContent = "Gönder";
        rb.onclick = async () => {
          if (!ri.value || !etikMi(ri.value)) return toast("Yanıt yaz / etik olsun!");
          if (MOD === "sunucu") { try { await api.yanitEkle(c.id, ri.value); await tazeCiz(); } catch (e) { toast(e.message); } return; }
          c.yanitlar = c.yanitlar || []; c.yanitlar.push({ yazar: aktif.ad, metin: ri.value }); yaz("odevler", odevler); listeleOdev(ara.value);
        };
        div.append(ri, rb); ri.focus();
      };
      div.appendChild(yb2);
      if (aktif && aktif.ad === isim && !o.cozuldu) { // sahibi en iyiyi seçer
        const eb = document.createElement("button"); eb.innerHTML = '<i data-lucide="award"></i>En İyi Cevap';
        eb.onclick = async () => {
          if (MOD === "sunucu") { try { await api.enIyi(c.id); await tazeCiz(); konfeti(); toast("Çözüldü olarak işaretlendi! ✅"); } catch (e) { toast(e.message); } return; }
          c.enIyi = true; o.cozuldu = true; // gönderi çözüldü olur
          const k = kullanicilar.find(x => x.ad === c.yazar); // puan + rozet
          if (k) { k.puan = (k.puan || 0) + 10; if ((k.puan || 0) >= 10 && !k.rozetler.includes("Yardımsever")) k.rozetler.push("Yardımsever"); if ((k.puan || 0) >= 30 && !k.rozetler.includes("Çözüm Ustası")) k.rozetler.push("Çözüm Ustası"); if (o.ders === "Matematik" && !k.rozetler.includes("Matematik Ustası")) k.rozetler.push("Matematik Ustası"); }
          yaz("odevler", odevler); yaz("kullanicilar", kullanicilar);
          bildir(c.yazar, `Cevabın en iyi seçildi! (+10 puan): ${o.baslik}`); // bildirim
          listeleOdev(ara.value); aktifGoster(); konfeti(); toast("Çözüldü olarak işaretlendi! ✅");
        };
        div.appendChild(eb);
      }
    });
    alan.appendChild(div);
    if (typeof videoAlanCiz === "function") videoAlanCiz(div, o); // video çözümler (yalnız sunucu modunda çizilir)
  });
  // İsimlere tıklayınca profil aç (akış içi)
  alan.querySelectorAll("[data-kisi]").forEach(a => a.onclick = e => { e.preventDefault(); goruntulenen = a.dataset.kisi; sayfaGoster("profil"); });
  ikonTazele(); // yeni ikonları çiz
}

// Öğrenciye nazik not (sunucu mesajıyla aynı sözler, AI detayı yok)
function ogrenciMesajiSunucu() { return "Bu paylaşım inceleme altında. Kurallara uyduğunu düşünüyorsan Profil → İncelemedekiler'den itiraz edebilirsin."; }

// --- Hocaya Sor (sunucu bağlıysa API, yoksa yerel) ---
function listeleHocalar() { // onaylı hocalar kart + seçim kutusu
  const ciz = onayli => {
    hocaKartlari.innerHTML = onayli.map(h => {
      const cevapSayi = h.cevapSayi ?? hocaSorular.filter(s => s.hoca === h.ad && s.durum === "Cevaplandı").length; // sunucu sayar, yoksa yerel
      return `<div class="kutu">✅ <b><a href="#" data-kisi="${htmlKacis(h.ad)}">${htmlKacis(h.ad)}</a></b> <span class="ders-etiket ders-${htmlKacis(h.brans || "Diger")}">${htmlKacis(h.brans) || "Genel"}</span><br><small>💬 ${cevapSayi} cevap • Son sorulara genelde aynı gün dönülür</small></div>`;
    }).join("") || "<div class='bosDurum'><div class='buyuk'>👨‍🏫</div><p>Henüz onaylı öğretmen yok.</p></div>";
    hocaKartlari.querySelectorAll("[data-kisi]").forEach(a => a.onclick = e => { e.preventDefault(); goruntulenen = a.dataset.kisi; sayfaGoster("profil"); });
    hocaSec.innerHTML = ""; onayli.forEach(h => { const o = document.createElement("option"); o.textContent = h.ad; hocaSec.appendChild(o); });
  };
  if (SUNUCU) { // sunucudaki gerçek onaylılar
    api.hocalar().then(ciz).catch(() => ciz(kullanicilar.filter(k => k.rol === "Öğretmen" && k.onay)));
    return;
  }
  ciz(kullanicilar.filter(k => k.rol === "Öğretmen" && k.onay)); // yerel liste
}
btnHocaSor.onclick = async () => {
  if (!aktif) return toast("Giriş yap!");
  if (!hocaSoru.value || !etikMi(hocaSoru.value)) return toast("Sorunu yaz / etik olsun!");
  if (MOD === "sunucu") { // sunucudaki hocaya gider (başka cihazdan görünür)
    try { await api.hocaSor({ hoca: hocaSec.value, ders: hDers.value, baslik: hBaslik.value || "Soru", soru: hocaSoru.value, gizli: hGizli.value }); hocaSoru.value = ""; listeleHoca(); return toast("Öğretmene gönderildi! 🎉"); }
    catch (e) { return toast(e.message); }
  }
  hocaSorular.unshift({ id: idUret(), ogrenci: aktif.ad, hoca: hocaSec.value, ders: hDers.value, baslik: hBaslik.value || "Soru", soru: hocaSoru.value, gizli: hGizli.value, durum: "Beklemede", cevap: "", tarih: new Date().toLocaleString("tr-TR") });
  yaz("hocaSorular", hocaSorular); hocaSoru.value = ""; listeleHoca();
};
async function listeleHoca() {
  if (MOD === "sunucu") return listeleHocaSunucu(); // sunucudan (yetkili görünürlük)
  // --- Yerel sürüm (çevrimdışı yedek) ---
  const alan = hocaListesi; alan.innerHTML = "";
  const benim = aktif ? hocaSorular.filter(s => s.ogrenci === aktif.ad) : [];
  if (!benim.length) alan.innerHTML = "Henüz sorun yok.";
  benim.forEach(s => { hocaSoruKart(alan, s, false); }); // kartları diz
  // Hoca kendi gelen kutusunu görür + cevaplar
  const gelen = document.getElementById("gelenSorular"); gelen.innerHTML = "";
  if (aktif && aktif.rol === "Öğretmen") {
    hocaSorular.filter(s => s.hoca === aktif.ad && s.durum === "Beklemede").forEach(s => {
      const div = document.createElement("div"); div.className = "kutu";
      div.innerHTML = `<b>${htmlKacis(s.ogrenci)}</b> (${htmlKacis(s.ders)})<p>${htmlKacis(s.soru)}</p>`;
      const ci = document.createElement("input"); ci.placeholder = "Cevabını yaz";
      const cb = document.createElement("button"); cb.textContent = "Cevapla";
      cb.onclick = () => { s.cevap = ci.value; s.durum = "Cevaplandı"; yaz("hocaSorular", hocaSorular); bildir(s.ogrenci, `${aktif.ad} sorunu cevapladı: ${s.baslik}`); const me = kullanicilar.find(k => k.ad === aktif.ad); if (me) me.puan = (me.puan || 0) + 5; yaz("kullanicilar", kullanicilar); listeleHoca(); };
      div.append(ci, cb); gelen.appendChild(div);
    });
    if (!gelen.innerHTML) gelen.innerHTML = "Bekleyen soru yok. 🎉";
  } else gelen.innerHTML = "Öğretmen girişi yapınca sorular burada görünür.";
  havuzCiz(); // hoca havuzu (şartlı çizilir)
  ogretmenVakaCiz(); // atanan vakalar (şartlı çizilir)
}
function hocaSoruKart(alan, s, sunucu) { // öğrenci soru kartı (puanla + paylaş + kapat)
  const div = document.createElement("div"); div.className = "kutu";
  const cevaplandi = s.durum === "Cevaplandı"; // zaman çizelgesi için
  const denetimli = sunucu && s.denetim && s.denetim !== "yayinda"; // incelemede/engelli içerik
  div.innerHTML = `${denetimli ? `<div class="cevap">🔍 ${htmlKacis(ogrenciMesajiSunucu())}</div>` : ""}<b>${htmlKacis(s.hoca)}</b> [${htmlKacis(s.durum)}]<div class="zaman"><span class="nokta dolu"></span><span class="cizgi ${cevaplandi ? "dolu" : ""}"></span><span class="nokta ${cevaplandi ? "dolu" : ""}"></span></div><small>Soruldu → ${cevaplandi ? "Cevaplandı" : s.durum === "Kapatıldı" ? "Kapatıldı" : "yanıt bekleniyor"}</small><p><b>${htmlKacis(s.baslik)}</b> (${htmlKacis(s.ders)}) - ${denetimli ? "<i>(içerik incelemede)</i>" : htmlKacis(s.soru)}</p><p>Cevap: ${denetimli && !cevaplandi ? "<i>(inceleniyor)</i>" : (htmlKacis(s.cevap) || "bekleniyor")}</p>${s.puan ? `<p>Verdiğin puan: ⭐${s.puan}</p>` : ""}`;
  if (denetimli) { alan.appendChild(div); return; } // incelemede: puanla/paylaş kapalı, itiraz Profildeki İncelemedekiler'den
  if (cevaplandi) { // cevap geldiyse puanla
    const ps = document.createElement("select"); [5, 4, 3, 2, 1].forEach(n => { const op = document.createElement("option"); op.value = n; op.textContent = "⭐".repeat(n); ps.appendChild(op); });
    const pb = document.createElement("button"); pb.textContent = "Puanla";
    pb.onclick = async () => {
      if (sunucu) { try { await api.hocaPuan(s.id, +ps.value); listeleHoca(); tazeBildirim(); return toast("Teşekkürler, puanın iletildi! 🙏"); } catch (e) { return toast(e.message); } }
      s.puan = +ps.value; yaz("hocaSorular", hocaSorular); const h = kullanicilar.find(k => k.ad === s.hoca); if (h) h.puan = (h.puan || 0) + s.puan; yaz("kullanicilar", kullanicilar); bildir(s.hoca, `${s.ogrenci} sana ⭐${s.puan} verdi!`); listeleHoca(); toast("Teşekkürler, puanın iletildi! 🙏");
    };
    div.append(ps, pb);
    if (s.gizli === "acik" && !s.paylasildi) { // herkese açıksa akışa taşı
      const payb = document.createElement("button"); payb.textContent = "📢 Akışta Paylaş";
      payb.onclick = async () => {
        if (sunucu) { try { await api.hocaPaylas(s.id); listeleHoca(); tazeCiz(); return toast("Akışta paylaşıldı! 🎉"); } catch (e) { return toast(e.message); } }
        odevler.unshift({ id: idUret(), isim: s.ogrenci, tur: "Çözüm Paylaşımı", ders: s.ders, sinif: "", baslik: s.baslik, aciklama: "Soru: " + s.soru + "\nÖğretmen (" + s.hoca + ") cevabı: " + s.cevap, resimler: [], cevaplar: [], begen: [], cozuldu: true, sikayet: 0, tarih: new Date().toLocaleString("tr-TR") });
        s.paylasildi = true; yaz("odevler", odevler); yaz("hocaSorular", hocaSorular); listeleHoca(); toast("Akışta paylaşıldı! 🎉");
      };
      div.appendChild(payb);
    }
  }
  if (s.durum !== "Kapatıldı") { // kapatma düğmesi
    const kb = document.createElement("button"); kb.className = "ikincil"; kb.textContent = "Kapat";
    kb.onclick = async () => {
      if (sunucu) { try { await api.hocaKapat(s.id); listeleHoca(); return toast("Kapatıldı."); } catch (e) { return toast(e.message); } }
      s.durum = "Kapatıldı"; yaz("hocaSorular", hocaSorular); listeleHoca(); toast("Kapatıldı.");
    };
    div.appendChild(kb);
  }
  alan.appendChild(div);
}
async function listeleHocaSunucu() { // sunucu sürümü: yetkiye göre liste
  const alan = hocaListesi; alan.innerHTML = "<div class='iskelet'></div>";
  const gelen = document.getElementById("gelenSorular"); gelen.innerHTML = "";
  try {
    const liste = await api.hocaSorular(); // yalnız yetkili olduklarım
    alan.innerHTML = "";
    const benim = liste.filter(s => s.ogrenci === aktif.ad); // sorduklarım
    if (!benim.length) alan.innerHTML = "Henüz sorun yok.";
    benim.forEach(s => hocaSoruKart(alan, s, true)); // kartları diz
    if (aktif.rol === "Öğretmen") { // bana gelen bekleyenler + cevap kutusu
      const bekleyen = liste.filter(s => s.hoca === aktif.ad && s.durum === "Beklemede");
      if (!bekleyen.length) gelen.innerHTML = "Bekleyen soru yok. 🎉";
      bekleyen.forEach(s => {
        const div = document.createElement("div"); div.className = "kutu";
        div.innerHTML = `<b>${htmlKacis(s.ogrenci)}</b> (${htmlKacis(s.ders)})<p><b>${htmlKacis(s.baslik)}</b></p><p>${htmlKacis(s.soru)}</p>`;
        const ci = document.createElement("input"); ci.placeholder = "Cevabını yaz";
        const cb = document.createElement("button"); cb.textContent = "Cevapla";
        cb.onclick = async () => {
          if (!ci.value.trim()) return toast("Önce cevabı yaz!");
          try { await api.hocaCevap(s.id, ci.value); listeleHoca(); tazeBildirim(); toast("Cevap gönderildi! 🎉"); }
          catch (e) { toast(e.message); }
        };
        div.append(ci, cb); gelen.appendChild(div);
      });
    } else gelen.innerHTML = "Öğretmen girişi yapınca sorular burada görünür.";
  } catch (e) { alan.innerHTML = "Bağlantı kesildi. Tekrar dene."; }
  havuzCiz(); // hoca havuzu (şartlı çizilir)
  ogretmenVakaCiz(); // atanan vakalar (şartlı çizilir)
  ikonTazele();
}

// --- Öğretmene atanan vakalar (üstbilgi + itiraz, içerik YOK) ---
async function ogretmenVakaCiz() {
  const alan = document.getElementById("ogretmenVakalar"); alan.innerHTML = "";
  if (!aktif || aktif.rol !== "Öğretmen" || MOD !== "sunucu") return; // yalnız hoca + sunucu
  try {
    const liste = await api.ogretmenVakalar();
    if (!liste.length) { alan.innerHTML = "<small>Atanmış vaka yok. 🎉</small>"; return; }
    liste.forEach(v => {
      const div = document.createElement("div"); div.className = "cevap";
      div.innerHTML = `#${v.id} ${htmlKacis(v.kategori)} (skor ${v.skor})<br><small>Tür: ${htmlKacis(v.tur)} • ${htmlKacis(v.olusturma)}</small>${v.itiraz ? `<br>📢 İtiraz: ${htmlKacis(v.itiraz)}` : ""}`;
      alan.appendChild(div);
    });
  } catch { /* sessiz */ }
}

// --- Takip önbelleği: butonlar güncel görünsün ---
let takipOnbellek = []; // kabul edilenler
let takipGiden = []; // gönderdiğim bekleyen istekler
async function takipYukle() { // girişten sonra çağır
  takipOnbellek = []; takipGiden = [];
  if (!aktif) return;
  if (MOD === "sunucu") {
    try { takipOnbellek = await api.takipListe(); } catch { /* sessiz */ }
    try { takipGiden = (await api.takipIstekler()).giden || []; } catch { /* sessiz */ }
    return;
  }
  const me = kullanicilar.find(k => k.ad === aktif.ad); // yerelden
  if (me) takipOnbellek = [...(me.takip || [])];
}
function takipEtiket(ad) { // buton yazısı: takip / istek / yeni
  if (takipOnbellek.includes(ad)) return "✓ Takip";
  if (takipGiden.includes(ad)) return "⏳ İstek gönderildi";
  return "+ Takip Et";
}
async function takipDegistir(ad) { // gönder / geri al
  if (!aktif) return toast("Önce giriş yap!");
  if (ad === aktif.ad) return toast("Kendini takip edemezsin!");
  if (MOD === "sunucu") {
    try { const r = await api.takip(ad); toast(r.istek ? "İstek gönderildi, kabul bekliyor! 👀" : r.takip ? "Takip ediyorsun!" : "Geri alındı."); }
    catch (e) { return toast(e.message); }
  }
  else {
    const me = kullanicilar.find(k => k.ad === aktif.ad);
    if (!kullanicilar.some(k => k.ad === ad)) return toast("Böyle biri yok!");
    me.takip = me.takip || []; const i = me.takip.indexOf(ad);
    i >= 0 ? me.takip.splice(i, 1) : me.takip.push(ad); yaz("kullanicilar", kullanicilar);
    toast("Takip güncellendi!");
  }
  await takipYukle(); listeleOdev(); // butonları güncelle
  if (document.getElementById("sayfaBildirim").style.display !== "none") bildirimCiz(); // bildirimdeysem tazele
  if (document.getElementById("sayfaProfil").style.display !== "none") profilGoster();
}

// --- Profil: bilgi + bildirim + liderlik + kaydedilen + takip (Aşama 3'e kadar yerel) ---
let goruntulenen = null; // boşsa kendi profilin, doluysa başkasının
btnTakip.onclick = async () => {
  if (!aktif) return toast("Giriş yap!");
  const hedef = takipAd.value.trim(); // kimin
  if (MOD === "sunucu") { // sunucuda tutarlı takip
    try { const r = await api.takip(hedef); toast(r.takip ? "Takip ediyorsun! 👀" : "Takibi bıraktın."); profilGoster(); return; }
    catch (e) { return toast(e.message); }
  }
  const me = kullanicilar.find(k => k.ad === aktif.ad);
  if (!kullanicilar.some(k => k.ad === hedef)) return toast("Böyle biri yok!");
  me.takip = me.takip || []; const i = me.takip.indexOf(hedef);
  i >= 0 ? me.takip.splice(i, 1) : me.takip.push(hedef); // aç/kapa
  yaz("kullanicilar", kullanicilar); profilGoster(); toast("Takip güncellendi!");
};
btnProfGoster.onclick = () => { // yazılan adı ara, profilini aç
  if (!kullanicilar.some(k => k.ad === takipAd.value.trim())) return toast("Böyle biri yok!");
  goruntulenen = takipAd.value.trim(); profilGoster();
};
function profilimAc() { goruntulenen = null; sayfaGoster("profil"); } // KENDİ profilim: bayat "başkasının profili" durumu sıfırlanır
async function profilGoster() {
  if (!aktif) { // misafir: NET giriş yolu (boş ekran değil)
    profilJog.innerHTML = "";
    profilBilgi.innerHTML = "<div class='bosDurum'><div class='buyuk'>👤</div><p>Giriş yapmadın. Profilini görmek için giriş yap.</p></div>";
    const g = document.createElement("button"); g.textContent = "Giriş yap / Kayıt ol"; g.onclick = () => sayfaGoster("hesap");
    profilBilgi.appendChild(g); return;
  } // giriş şart
  if (MOD === "sunucu") return profilSunucu(); // gerçek sunucu verisi
  const hedefAd = goruntulenen || aktif.ad; // kimin profili
  const kisi = kullanicilar.find(k => k.ad === hedefAd); // kişiyi bul
  if (!kisi) { goruntulenen = null; return profilGoster(); } // silinmişse normale dön
  const benimGonderi = odevler.filter(o => (o.isim || o.yazar) === kisi.ad); // onun gönderileri
  const cozdugu = odevler.filter(o => (o.cevaplar || []).some(c => c.yazar === kisi.ad && c.enIyi)).length; // doğru çözüm sayısı
  const seviye = Math.floor((kisi.puan || 0) / 100) + 1; // her 100 puan 1 seviye
  const yuzde = (kisi.puan || 0) % 100; // sonraki seviyeye ilerleme
  const hedefler = [["Yardımsever", "10 puan"], ["Çözüm Ustası", "30 puan"], ["Efsane Yardımcı", "100 puan"], ["İlk Adım", "1 gönderi"], ["Üretken", "10 gönderi"], ["Yorumcu", "5 yorum"], ["Sohbetçi", "25 yorum"], ["Çözüm Çırağı", "1 doğru çözüm"], ["Çözüm Avcısı", "5 doğru çözüm"], ["Popüler", "10 beğeni al"], ["Matematik Ustası", "matematikte en iyi"], ["Oda Kurucusu", "1 oda aç"], ["Öğretmen Yıldızı", "3 öğretmen cevabı"]]; // rozet hedefleri
  profilJog.innerHTML = goruntulenen ? `<button id="btnGeri">← Kendi profilime dön</button>` : ""; // geri butonu
  const geri = document.getElementById("btnGeri"); if (geri) geri.onclick = () => { goruntulenen = null; profilGoster(); };
  profilBilgi.innerHTML = `<div class="kapak"></div><div class="kutu"><div class="profilBas"><div class="avatar">${htmlKacis(kisi.ad[0].toUpperCase())}</div><div><b>${htmlKacis(kisi.ad)}</b> (${htmlKacis(kisi.rol)}) Sv.${seviye} ${kisi.onay === false ? "⏳ Onay bekliyor" : ""}<br>⭐ Puan: ${kisi.puan || 0} • 📝 ${benimGonderi.length} gönderi • ✅ ${cozdugu} çözüm</div></div><div class="seviyeCubuk" title="Sonraki seviyeye ${100 - yuzde} puan"><div style="width:${yuzde}%"></div></div>${(kisi.rozetler || []).map(r => `<span class="rozet"><i data-lucide="award"></i>${htmlKacis(r)}</span>`).join("")}${hedefler.filter(h => !(kisi.rozetler || []).includes(h[0])).map(h => `<span class="rozet" style="opacity:.45">🔒 ${htmlKacis(h[0])} <small>(${htmlKacis(h[1])})</small></span>`).join("")}${benimGonderi.slice(0, 3).map(o => `<p>📌 ${htmlKacis(o.baslik)}</p>`).join("")}</div>`;
  ikonTazele(); // rozet ikonlarını çiz
  if (goruntulenen && goruntulenen !== aktif.ad) { // başkasının profilinde takip butonu
    const tb = document.createElement("button"); tb.textContent = takipEtiket(goruntulenen);
    tb.onclick = async () => { await takipDegistir(goruntulenen); profilGoster(); };
    profilBilgi.appendChild(tb);
  }
  if (goruntulenen) return; // başkasına bakarken bildirim/kayıt gösterme (gizlilik)
  const me = kisi; aktif.puan = me.puan || 0; aktifGoster();
  // Bildirimler (okundu işaretle)
  const benimB = bildirimler.filter(b => b.kime === me.ad).slice(0, 10);
  bildirimListesi.innerHTML = benimB.map(b => `<div class="cevap">${htmlKacis(b.metin)}<br><small>${htmlKacis(b.tarih)}</small></div>`).join("") || "Bildirim yok.";
  bildirimler.forEach(b => { if (b.kime === me.ad) b.okundu = true; }); yaz("bildirimler", bildirimler); aktifGoster();
  // Liderlik tablosu (puan sırası)
  const sirali = [...kullanicilar].sort((a, b) => (b.puan || 0) - (a.puan || 0)).slice(0, 5);
  liderlik.innerHTML = sirali.map((k, i) => `<div class="cevap">${i + 1}. <a href="#" data-kisi="${htmlKacis(k.ad)}">${htmlKacis(k.ad)}</a> - ⭐${k.puan || 0}</div>`).join("");
  liderlik.querySelectorAll("[data-kisi]").forEach(a => a.onclick = e => { e.preventDefault(); goruntulenen = a.dataset.kisi; profilGoster(); }); // isme tıkla aç
  // Kaydedilenler (sunucudaysa sunucudan)
  const cizKayit = kayitlilar => kaydedilenler.innerHTML = kayitlilar.map(o => `<div class="kutu"><b>${htmlKacis(o.baslik)}</b><p>${htmlKacis(o.aciklama)}</p></div>`).join("") || "Kaydedilen yok.";
  if (MOD === "sunucu") api.kaydettiklerim().then(cizKayit).catch(() => cizKayit(odevler.filter(o => (me.kaydet || []).includes(o.id))));
  else cizKayit(odevler.filter(o => (me.kaydet || []).includes(o.id)));
  incelemelerimCiz(); // kendi vakaları + itiraz
}

// --- Özel bölümler: Kaydedilenler, Liderlik, Rozetler, Bildirimler ---
async function kaydetCiz() { // kayıtlı gönderiler
  if (!aktif) { kayitListesi.innerHTML = "<div class='bosDurum'><div class='buyuk'>🔖</div><p>Önce giriş yap.</p></div>"; return; }
  const ciz = l => kayitListesi.innerHTML = l.length ? l.map(o => `<div class="kutu"><span class="ders-etiket ders-${htmlKacis(o.ders)}">${htmlKacis(o.ders)}</span> <b>${htmlKacis(o.baslik)}</b><p>${htmlKacis((o.aciklama || "").slice(0, 120))}</p></div>`).join("") : "<div class='bosDurum'><div class='buyuk'>🔖</div><p>Henüz bir şey kaydetmedin. Akışta 🔖 Kaydet'e bas.</p></div>";
  if (MOD === "sunucu") { try { ciz(await api.kaydettiklerim()); } catch (e) { toast(e.message); } return; } // sunucudan
  const me = kullanicilar.find(k => k.ad === aktif.ad); // yerelden
  ciz(odevler.filter(o => (me.kaydet || []).includes(o.id)));
  ikonTazele();
}
function liderlikCiz() { // ilk 10, madalyalı
  const ciz = sirali => {
    const madalya = ["🥇", "🥈", "🥉"]; // ilk 3'e madalya
    liderTablo.innerHTML = sirali.map((x, i) => `<div class="cevap">${madalya[i] || (i + 1) + "."} <a href="#" data-kisi="${htmlKacis(x.ad)}">${htmlKacis(x.ad)}</a> - ⭐${x.puan || 0}${x.rozetSayi ? " 🏅x" + x.rozetSayi : (x.rozetler || []).length ? " 🏅x" + x.rozetler.length : ""}</div>`).join("") || "Kimse yok.";
    liderTablo.querySelectorAll("[data-kisi]").forEach(a => a.onclick = e => { e.preventDefault(); goruntulenen = a.dataset.kisi; sayfaGoster("profil"); }); // isme tıkla aç
  };
  if (MOD === "sunucu") { liderTablo.innerHTML = "<div class='iskelet'></div>"; api.liderlik().then(ciz).catch(() => liderTablo.innerHTML = "Bağlantı kesildi."); return; } // gerçek sıralama
  ciz([...kullanicilar].sort((a, b) => (b.puan || 0) - (a.puan || 0)).slice(0, 10)); // yerel sıralama
}
async function rozetCiz() { // kazanılan + kilitli hedefler
  if (!aktif) { rozetVitrin.innerHTML = "<div class='bosDurum'><div class='buyuk'>🏅</div><p>Önce giriş yap.</p></div>"; return; }
  const ciz = (ad, puan, rozetler) => {
    const hedefler = [["Yardımsever", "10 puan"], ["Çözüm Ustası", "30 puan"], ["Efsane Yardımcı", "100 puan"], ["İlk Adım", "1 gönderi"], ["Üretken", "10 gönderi"], ["Yorumcu", "5 yorum"], ["Sohbetçi", "25 yorum"], ["Çözüm Çırağı", "1 doğru çözüm"], ["Çözüm Avcısı", "5 doğru çözüm"], ["Popüler", "10 beğeni al"], ["Matematik Ustası", "matematikte en iyi"], ["Oda Kurucusu", "1 oda aç"], ["Öğretmen Yıldızı", "3 öğretmen cevabı"]]; // hedef listesi
    rozetVitrin.innerHTML = `<p><b>${htmlKacis(ad)}</b> • Sv.${Math.floor((puan || 0) / 100) + 1} • ⭐${puan || 0}</p>` +
      (rozetler || []).map(r => `<span class="rozet"><i data-lucide="award"></i>${htmlKacis(r)}</span>`).join("") +
      hedefler.filter(h => !(rozetler || []).includes(h[0])).map(h => `<span class="rozet" style="opacity:.45">🔒 ${htmlKacis(h[0])} <small>(${htmlKacis(h[1])})</small></span>`).join("") ||
      "<small>Henüz rozet yok, ilk yardıma koş! 💪</small>";
    ikonTazele();
  };
  if (MOD === "sunucu") { try { const kisi = await api.profil(aktif.ad); return ciz(kisi.ad, kisi.puan, kisi.rozetler); } catch { return rozetVitrin.innerHTML = "Bağlantı kesildi."; } } // gerçek rozetler
  const me = kullanicilar.find(k => k.ad === aktif.ad) || { rozetler: [], puan: 0 }; // yerelden
  ciz(me.ad, me.puan, me.rozetler);
}
async function bildirimCiz() { // tüm bildirimler + okundu işaretle
  if (!aktif) { bildirimPaneli.innerHTML = "Giriş yapmadın."; return; }
  if (MOD === "sunucu") { // sunucudan (cihazlar arası aynı) + takip istekleri
    try {
      let html = "";
      try { // bekleyen takip istekleri en üstte (kabul/ret kutulu)
        const { gelen } = await api.takipIstekler();
        html += gelen.map(ad => `<div class="cevap"><b>${htmlKacis(ad)}</b> seni takip etmek istiyor.<br><button data-kabul="${htmlKacis(ad)}">Kabul Et</button> <button data-ret="${htmlKacis(ad)}" class="ikincil">Reddet</button></div>`).join("");
      } catch { /* sessiz */ }
      const liste = await api.bildirimler();
      html += liste.map(b => `<div class="cevap">${htmlKacis(b.metin)}<br><small>${htmlKacis(b.tarih)}</small></div>`).join("") || (html ? "" : "<div class='bosDurum'><div class='buyuk'>🔔</div><p>Bildirim yok.</p></div>");
      bildirimPaneli.innerHTML = html;
      bildirimPaneli.querySelectorAll("[data-kabul]").forEach(b => b.onclick = async () => { await api.takipKarar(b.dataset.kabul, true); await takipYukle(); bildirimCiz(); toast("Kabul edildi!"); });
      bildirimPaneli.querySelectorAll("[data-ret]").forEach(b => b.onclick = async () => { await api.takipKarar(b.dataset.ret, false); await takipYukle(); bildirimCiz(); toast("Reddedildi."); });
      await api.bildirimOkundu(); tazeBildirim(); // okundu say
    } catch { bildirimPaneli.innerHTML = "Bağlantı kesildi. Tekrar dene."; }
    return;
  }
  const liste = bildirimler.filter(b => b.kime === aktif.ad); // yerelden
  bildirimPaneli.innerHTML = liste.map(b => `<div class="cevap">${htmlKacis(b.metin)}<br><small>${htmlKacis(b.tarih)}</small></div>`).join("") || "<div class='bosDurum'><div class='buyuk'>🔔</div><p>Bildirim yok. Yorum yazan olunca burada görünür.</p></div>";
  bildirimler.forEach(b => { if (b.kime === aktif.ad) b.okundu = true; }); yaz("bildirimler", bildirimler); aktifGoster(); // okundu say
}

async function profilSunucu() { // sunucu profili (puan, rozet, sayı gerçek)
  const hedefAd = goruntulenen || aktif.ad; // kimin
  try {
    const kisi = await api.profil(hedefAd); // herkese açık gerçek bilgi
    const seviye = Math.floor((kisi.puan || 0) / 100) + 1; // seviye
    const yuzde = (kisi.puan || 0) % 100; // ilerleme
    const rolAd = { ogrenci: "Öğrenci", ogretmen: "Öğretmen", mudur: "Müdür Yardımcısı", admin: "Admin" }[kisi.rol] || kisi.rol;
    profilJog.innerHTML = goruntulenen ? `<button id="btnGeri">← Kendi profilime dön</button>` : "";
    const geri = document.getElementById("btnGeri"); if (geri) geri.onclick = () => { goruntulenen = null; profilGoster(); };
    profilBilgi.innerHTML = `<div class="kapak"></div><div class="kutu"><div class="profilBas"><div class="avatar">${htmlKacis(kisi.ad[0].toUpperCase())}</div><div><b>${htmlKacis(kisi.ad)}</b> (${htmlKacis(rolAd)}) Sv.${seviye}<br>⭐ Puan: ${kisi.puan || 0} • 📝 ${kisi.gonderiSayi} gönderi • ✅ ${kisi.cozumSayi} çözüm • 👀 ${kisi.takipSayi} takip</div></div><div class="seviyeCubuk"><div style="width:${yuzde}%"></div></div>${(kisi.rozetler || []).map(r => `<span class="rozet"><i data-lucide="award"></i>${htmlKacis(r)}</span>`).join("")}</div>`;
    ikonTazele();
    if (goruntulenen && goruntulenen !== aktif.ad) { // başkasının profilinde takip butonu
      const tb = document.createElement("button"); tb.textContent = takipOnbellek.includes(goruntulenen) ? "✓ Takip Ediyorsun" : "+ Takip Et";
      tb.onclick = async () => { await takipDegistir(goruntulenen); profilGoster(); };
      profilBilgi.appendChild(tb);
    }
    if (goruntulenen) return; // başkasında özel bölümler yok
    aktif.puan = kisi.puan || 0; aktifGoster();
    const [benimB, sira, kayit] = await Promise.all([api.bildirimler(), api.liderlik(), api.kaydettiklerim()]); // üçünü birlikte çek
    bildirimListesi.innerHTML = benimB.slice(0, 10).map(b => `<div class="cevap">${htmlKacis(b.metin)}<br><small>${htmlKacis(b.tarih)}</small></div>`).join("") || "Bildirim yok.";
    api.bildirimOkundu().then(() => aktifGoster()).catch(() => {}); // okundu say, sayaç sönsün
    liderlik.innerHTML = sira.slice(0, 5).map((x, i) => `<div class="cevap">${i + 1}. <a href="#" data-kisi="${htmlKacis(x.ad)}">${htmlKacis(x.ad)}</a> - ⭐${x.puan || 0}</div>`).join("");
    liderlik.querySelectorAll("[data-kisi]").forEach(a => a.onclick = e => { e.preventDefault(); goruntulenen = a.dataset.kisi; profilGoster(); });
    kaydedilenler.innerHTML = kayit.map(o => `<div class="kutu"><b>${htmlKacis(o.baslik)}</b><p>${htmlKacis(o.aciklama)}</p></div>`).join("") || "Kaydedilen yok.";
    tazeBildirim(); // sayaçları tazele
    incelemelerimCiz(); // kendi vakaları + itiraz
  } catch (e) { profilBilgi.innerHTML = "Bağlantı kesildi. Tekrar dene."; }
}

// --- Denetim paneli: vaka kuyruğu (acil + geciken üstte) ---
async function denetimGoster() {
  const alan = denetimKuyruk; alan.innerHTML = "<div class='iskelet'></div>";
  try { // denetim modunu dürüstçe yaz (kural mı model mi)
    const m = await api.aiDurum();
    document.getElementById("aiModRozet").textContent = m.mod === "model" ? `🤖 Model destekli (${m.model})` : `📏 Kural tabanlı mod (${m.neden || "LLM kapalı"}) — sohbet asistanı ayrı iştir, henüz yok.`;
  } catch { document.getElementById("aiModRozet").textContent = "Denetim moduna ulaşılamadı."; }
  if (!aktif || !["Admin", "Müdür Yardımcısı"].includes(aktif.rol)) { alan.innerHTML = "Yetkin yok."; return; } // yetki
  if (MOD !== "sunucu") { alan.innerHTML = "Denetim yalnız sunucu bağlıyken olur."; return; }
  try {
    const liste = await api.denetimVakalar(); // kuyruk
    if (!liste.length) { alan.innerHTML = "<div class='bosDurum'><div class='buyuk'>🛡️</div><p>Kuyruk temiz!</p></div>"; return; }
    alan.innerHTML = "";
    liste.forEach(v => {
      const div = document.createElement("div"); div.className = "kutu";
      div.style.border = (v.acil || v.gecikti) ? "2px solid #dc2626" : ""; // acil/geciken kırmızı
      const kalan = v.sla_son ? " • SLA: " + v.sla_son + (v.gecikti ? " (GECİKTİ)" : "") : ""; // sayaç
      div.innerHTML = `<b>${v.acil ? "🔴 ACİL " : ""}#${v.id} ${htmlKacis(v.kategori)}</b> skor:${v.skor} güven:${v.guven}<br><small>Yazar: ${htmlKacis(v.yazar)} • Tür: ${htmlKacis(v.tur)} • Durum: ${htmlKacis(v.durum)}${kalan}</small><p>Gerekçe: ${htmlKacis(v.gerekce)}</p><p>Kanıt: ${htmlKacis((v.kanit || []).join(" | "))}</p>${v.itiraz ? `<p>📢 İtiraz: ${htmlKacis(v.itiraz)}</p>` : ""}<p class="ipucu">İçerik önizlemesi bulanık gösterilir (gizlilik).</p>`;
      const kararlar = [["yayinla", "Onayla+yayınla"], ["kaldir", "İçeriği kaldır"], ["uyar", "Kullanıcıyı uyar"], ["askiya", "Askıya al"], ["yanlis-alarm", "Yanlış alarm"]]; // hızlı kararlar
      kararlar.forEach(([k2, etiket]) => {
        const b = document.createElement("button"); if (k2 === "kaldir" || k2 === "askiya") b.className = "tehlike"; b.textContent = etiket;
        b.onclick = async () => { try { await api.denetimKarar(v.id, k2); } catch (e) { return toast(e.message); } denetimGoster(); toast("Karar işlendi."); };
        div.appendChild(b);
      });
      const hi = document.createElement("input"); hi.placeholder = "İletilecek öğretmen"; // öğretmene ilet
      const hb = document.createElement("button"); hb.className = "ikincil"; hb.textContent = "Öğretmene ilet";
      hb.onclick = async () => { try { await api.denetimKarar(v.id, "ogretmene", hi.value); denetimGoster(); toast("İletildi."); } catch (e) { toast(e.message); } };
      div.appendChild(hi); div.appendChild(hb);
      alan.appendChild(div);
    });
  } catch { alan.innerHTML = "Bağlantı kesildi. Tekrar dene."; }
  ikonTazele();
}
// --- İncelemedekiler: kendi vakalarım + itiraz ---
async function incelemelerimCiz() {
  const alan = document.getElementById("incelemelerim"); if (!alan) return;
  if (!aktif || MOD !== "sunucu") { alan.innerHTML = ""; return; } // yalnız sunucu modunda
  try {
    const liste = (await api.vakalarim()).filter(v => ["bekliyor", "engellendi"].includes(v.durum)); // açık vakalar
    alan.innerHTML = "";
    liste.forEach(v => {
      const div = document.createElement("div"); div.className = "cevap";
      div.innerHTML = `Bu paylaşım inceleme altında (${htmlKacis(v.kategori)}).`;
      const ii = document.createElement("input"); ii.placeholder = "İtirazını yaz";
      const ib = document.createElement("button"); ib.textContent = "İtiraz et";
      ib.onclick = async () => { try { await api.itiraz(v.id, ii.value); incelemelerimCiz(); toast("İtirazın alındı."); } catch (e) { toast(e.message); } };
      div.appendChild(ii); div.appendChild(ib); alan.appendChild(div);
    });
  } catch { /* sessiz */ }
}
// --- Sınav havuzu (hoca): yükle + listele + sil ---
async function havuzCiz() {
  const alan = document.getElementById("havuzAlani"); alan.innerHTML = "";
  if (!aktif || aktif.rol !== "Öğretmen" || MOD !== "sunucu") return; // yalnız hoca + sunucu
  const dd = document.createElement("select"); ["Matematik", "Fizik", "Kimya", "Biyoloji", "Türkçe", "Tarih"].forEach(d => { const o = document.createElement("option"); o.textContent = d; dd.appendChild(o); });
  const ta = document.createElement("textarea"); ta.placeholder = "Henüz yapılmamış sınav sorusu (şifreli saklanır)";
  const eb = document.createElement("button"); eb.textContent = "Havuza Ekle";
  eb.onclick = async () => { try { await api.havuzEkle(dd.value, ta.value); ta.value = ""; havuzCiz(); toast("Havuzda!"); } catch (e) { toast(e.message); } };
  alan.append(dd, ta, eb);
  try {
    const liste = await api.havuzListe(); // yalnız üstbilgi (metin YOK)
    liste.forEach(h => {
      const div = document.createElement("div"); div.className = "cevap"; div.textContent = `#${h.id} ${h.ders} (${h.tarih})`;
      const sb = document.createElement("button"); sb.className = "tehlike"; sb.textContent = "Sil";
      sb.onclick = async () => { try { await api.havuzSil(h.id); havuzCiz(); } catch (e) { toast(e.message); } };
      div.appendChild(sb); alan.appendChild(div);
    });
  } catch { /* sessiz */ }
}
async function kesfetGoster() {
  let populer = [...odevler.filter(o => (o.sikayet || 0) < 3)];
  if (MOD === "sunucu") { try { populer = await api.gonderiler({ siralama: "populer", limit: 9 }); } catch { /* yerelde devam */ } }
  populer = populer.sort((a, b) => ((b.begen || []).length + (b.cevaplar || []).length) - ((a.begen || []).length + (a.cevaplar || []).length)).slice(0, 9); // ilk 9
  kesfetGrid.innerHTML = "";
  if (!populer.length) { kesfetGrid.innerHTML = "Henüz gönderi yok."; return; }
  populer.forEach(o => {
    const div = document.createElement("div"); div.className = "kutu";
    const ilk = (o.resimler || [])[0]; // ilk resim (güvenliyse)
    if (ilk && gorselGuvenli(ilk)) { const img = document.createElement("img"); img.src = ilk; img.alt = "önizleme"; img.loading = "lazy"; div.appendChild(img); } // DOM ile ekle, şablona gömme
    else { const av = document.createElement("div"); av.className = "avatar"; av.style.margin = "0 auto"; av.textContent = "#"; div.appendChild(av); }
    const b1 = document.createElement("b"); b1.textContent = "#" + (o.ders || ""); div.appendChild(b1); // textContent güvenli
    div.appendChild(document.createElement("br"));
    const s1 = document.createElement("small"); s1.textContent = (o.baslik || "").slice(0, 20); div.appendChild(s1);
    div.appendChild(document.createElement("br"));
    const s2 = document.createElement("small"); s2.textContent = "❤️" + (o.begen || []).length; div.appendChild(s2);
    div.onclick = () => { ara.value = o.baslik; filtreDers.value = ""; sayfaGoster("akis"); }; // akışta aç
    kesfetGrid.appendChild(div);
  });
}

// --- Admin paneli (sunucudaysa sunucudan, yoksa yerelden) ---
async function adminGoster() {
  const alan = adminAlani; alan.innerHTML = ""; // temizle
  if (!aktif || aktif.rol !== "Admin") { alan.innerHTML = "Sadece admin görür. (admin / admin123)"; return; } // yetki kontrolü
  if (MOD === "sunucu") { // gerçek veriler
    try {
      const [kull, sik] = await Promise.all([api.adminListe(), api.adminSikayet()]); // ikisini birlikte çek
      alan.innerHTML = "<b>Onay bekleyen öğretmenler:</b>" + (kull.filter(k => k.rol === "ogretmen" && !k.onay).map(h => `<div class="kutu">${htmlKacis(h.ad)} (${htmlKacis(h.brans)}) <button data-onay="${htmlKacis(h.ad)}">Onayla</button></div>`).join("") || " Yok");
      alan.innerHTML += "<b>Şikayetler:</b>" + (sik.slice(0, 10).map(s => `<div class="cevap">${htmlKacis(s.neden)} - gönderi:${s.hedefId} (bildiren:${htmlKacis(s.bildiren)})<br><button data-reddet="${s.id}">Reddet</button> <button data-kaldir="${s.id}">Kaldır + uyar</button></div>`).join("") || " Yok");
      alan.innerHTML += "<b>Kullanıcılar:</b>" + kull.map(k => `<div class="cevap">${htmlKacis(k.ad)} (${htmlKacis(rolTR[k.rol] || k.rol)}) ⚠️${k.uyari || 0} ${k.askida ? "⛔ askıda" : ""} <button data-aski="${htmlKacis(k.ad)}">Askıya al/çıkar</button></div>`).join("");
      alan.querySelectorAll("[data-onay]").forEach(b => b.onclick = async () => { await api.hocaOnay(b.dataset.onay, true); adminGoster(); }); // onayla
      alan.querySelectorAll("[data-reddet]").forEach(b => b.onclick = async () => { await api.sikayetCozum(b.dataset.reddet, "reddet"); adminGoster(); }); // şikayeti düşür
      alan.querySelectorAll("[data-kaldir]").forEach(b => b.onclick = async () => { await api.sikayetCozum(b.dataset.kaldir, "kaldir"); adminGoster(); tazeCiz(); }); // kaldır + uyar
      alan.querySelectorAll("[data-aski]").forEach(b => b.onclick = async () => {
        const k = kull.find(x => x.ad === b.dataset.aski); await api.aski(k.ad, !k.askida); adminGoster(); // askı aç/kapa
      });
      return;
    } catch (e) { toast("Sunucu hatası: " + e.message); }
  }
  const bekleyen = kullanicilar.filter(k => k.rol === "Öğretmen" && !k.onay); // yerel onay kuyruğu
  alan.innerHTML = "<b>Onay bekleyen öğretmenler:</b>" + (bekleyen.map(h => `<div class="kutu">${htmlKacis(h.ad)} (${htmlKacis(h.brans)}) <button data-onay="${htmlKacis(h.ad)}">Onayla</button></div>`).join("") || " Yok");
  alan.innerHTML += "<b>Şikayetler:</b>" + (sikayetler.slice(0, 10).map(s => `<div class="cevap">${htmlKacis(s.neden)} - gönderi:${s.hedefId} (bildiren:${htmlKacis(s.bildiren)}) <button data-sil="${s.hedefId}">Gönderiyi kaldır</button></div>`).join("") || " Yok");
  alan.innerHTML += "<b>Kullanıcılar:</b>" + kullanicilar.map(k => `<div class="cevap">${htmlKacis(k.ad)} (${htmlKacis(k.rol)}) ⚠️${k.uyari || 0} ${k.askida ? "⛔ askıda" : ""} <button data-aski="${htmlKacis(k.ad)}">Askıya al/çıkar</button></div>`).join("");
  alan.querySelectorAll("[data-onay]").forEach(b => b.onclick = () => { kullanicilar.find(k => k.ad === b.dataset.onay).onay = true; yaz("kullanicilar", kullanicilar); bildir(b.dataset.onay, "Öğretmen hesabın onaylandı! ✅"); adminGoster(); }); // onayla
  alan.querySelectorAll("[data-sil]").forEach(b => b.onclick = () => { odevler = odevler.filter(o => o.id !== b.dataset.sil); yaz("odevler", odevler); adminGoster(); listeleOdev(); }); // kaldır
  alan.querySelectorAll("[data-aski]").forEach(b => b.onclick = () => { const k = kullanicilar.find(x => x.ad === b.dataset.aski); k.askida = !k.askida; yaz("kullanicilar", kullanicilar); adminGoster(); }); // askı aç/kapa
}

// --- Kahraman hızlı işlemler ---
hizliSoru.onclick = () => paylasimBaslat("Soru"); // yazı türü koru, geçerli adımdan devam (ders yoksa 1. adıma dön)
hizliAnlat.onclick = () => paylasimBaslat("Konu Özeti"); // yazı türü koru, geçerli adımdan devam (ders yoksa 1. adıma dön)
hizliGrup.onclick = () => sayfaGoster("odalar"); // oda açmaya git
hizliAI.onclick = () => sayfaGoster("sohbet"); // AI asistan sayfasına git

// --- Üst bar: genel arama + bildirim + profil ---
ustArama.oninput = () => { clearTimeout(araSure); araSure = setTimeout(() => { ara.value = ustArama.value; if (document.getElementById("sayfaAkis").style.display === "none") sayfaGoster("akis"); else tazeCiz(true); }, 300); }; // bekletmeli genel arama (yarış yok)
ustZil.onclick = () => sayfaGoster("bildirim"); // bildirim merkezine git
ustProfil.onclick = () => { if (aktif) { goruntulenen = null; sayfaGoster("profil"); } else sayfaGoster("hesap"); }; // misafir girişe gider
btnPanelHoca.onclick = () => sayfaGoster("hoca"); // panelden hocaya

// --- Sağ panel: günün özeti (her sayfada tazelenir) ---
async function sagPanelGoster() { // sağ panel: sunucudaysa gerçek veri (tarihli + sınırlı)
  const soruCiz = bekleyen => panelSorular.innerHTML = bekleyen.map(o => `<div class="kutu"><b>#${htmlKacis(o.ders)}</b> ${htmlKacis((o.baslik || "").slice(0, 40))}</div>`).join("") || "<small>Bekleyen soru yok. 🎉</small>";
  if (MOD === "sunucu") { // gerçek API: bugünün soruları (son 24 saat, TR saati) + liderlik + hocalar
    try {
      const [gunluk, sira, hocalar] = await Promise.all([api.gonderiler({ gun: "1", limit: 5 }), api.liderlik(), api.hocalar()]);
      soruCiz(gunluk);
      panelLider.innerHTML = sira.slice(0, 5).map((k, i) => `<div>${i + 1}. <b>${htmlKacis(k.ad)}</b> ⭐${k.puan || 0}</div>`).join("");
      panelHocalar.innerHTML = hocalar.slice(0, 4).map(h => `<div>✅ <b>${htmlKacis(h.ad)}</b> <small>(${htmlKacis(h.brans) || "Genel"})</small></div>`).join("") || "<small>Öğretmen yok.</small>";
    } catch { panelSorular.innerHTML = "<small>Bağlantı kesildi.</small>"; panelLider.innerHTML = ""; panelHocalar.innerHTML = ""; }
  } else { // yerel yedek (tarihsiz, bu cihazın verisi)
    const bekleyen = odevler.filter(o => !o.cozuldu && (o.sikayet || 0) < 3).slice(0, 5); // cevap bekleyen 5
    soruCiz(bekleyen);
    const sirali = [...kullanicilar].sort((a, b) => (b.puan || 0) - (a.puan || 0)).slice(0, 5); // ilk 5
    panelLider.innerHTML = sirali.map((k, i) => `<div>${i + 1}. <b>${htmlKacis(k.ad)}</b> ⭐${k.puan || 0}</div>`).join("");
    const hocalar = kullanicilar.filter(k => k.rol === "Öğretmen" && k.onay).slice(0, 4); // çevrimiçi hocalar
    panelHocalar.innerHTML = hocalar.map(h => `<div>✅ <b>${htmlKacis(h.ad)}</b> <small>(${htmlKacis(h.brans) || "Genel"})</small></div>`).join("") || "<small>Öğretmen yok.</small>";
  }
  const dersler = [...new Set(odevler.map(o => o.ders).filter(Boolean))]; // geçen dersler
  panelEtiket.innerHTML = dersler.map(d => `<button class="ikincil" data-ders="${htmlKacis(d)}" style="min-height:36px">#${htmlKacis(d)}</button>`).join("") || "<small>Etiket yok.</small>";
  panelEtiket.querySelectorAll("[data-ders]").forEach(b => b.onclick = () => { filtreDers.value = b.dataset.ders; sayfaGoster("akis"); }); // tıkla süz
  const benimCozum = aktif ? odevler.filter(o => (o.cevaplar || []).some(c => c.yazar === aktif.ad && c.enIyi)).length : 0; // çözümlerim
  panelMotiv.innerHTML = aktif ? `Bugüne kadar <b>${benimCozum}</b> çözüme imzanı attın. Devam! 💪` : "Giriş yap, yardımların burada sayılsın!";
  takvimCiz(); notKartCiz(); // takvim + hızlı notlar bölümü (kendi durumundan çizer)
  ikonTazele();
}

// --- Çalışma odaları (sunucu varsa gerçek, yoksa yerel) ---
let acikOda = null; // girilen oda
let odalarYerel = oku("odalarYerel", []); // çevrimdışı odalar
let mesajYerel = oku("mesajYerel", {}); // oda id -> mesajlar
async function odaListele() { // odaları çiz
  let liste = odalarYerel; // önce yerel
  if (SUNUCU) { try { liste = await api.odalar(); } catch { /* yerelde devam */ } }
  odaListesi.innerHTML = "";
  if (!liste.length) { odaListesi.innerHTML = "<div class='bosDurum'><div class='buyuk'>👥</div><p>Henüz oda yok. İlk odayı sen aç!</p></div>"; return; }
  liste.forEach(o => {
    const div = document.createElement("div"); div.className = "kutu";
    div.innerHTML = `<b>${htmlKacis(o.ad)}</b> <span class="ders-etiket ders-${htmlKacis(o.ders)}">${htmlKacis(o.ders)}</span><br><small>Kurucu: ${htmlKacis(o.kurucu || o.yazar || "?")} • 💬 ${o.mesajSayi ?? (mesajYerel[o.id] || []).length} mesaj</small>`;
    const gir = document.createElement("button"); gir.textContent = "Odaya Gir →";
    gir.onclick = () => odaGir(o); div.appendChild(gir);
    if (aktif && (aktif.ad === (o.kurucu || o.yazar) || aktif.rol === "Admin")) { // kurucu/admin silebilir
      const sil = document.createElement("button"); sil.className = "tehlike"; sil.textContent = "Kapat";
      sil.onclick = async () => {
        if (SUNUCU && typeof o.id === "number") { try { await api.odaSil(o.id); } catch (e) { return toast(e.message); } }
        else { odalarYerel = odalarYerel.filter(x => x.id !== o.id); yaz("odalarYerel", odalarYerel); }
        odaListele(); toast("Oda kapatıldı.");
      };
      div.appendChild(sil);
    }
    odaListesi.appendChild(div);
  });
  ikonTazele();
}
async function odaGir(o) { // odaya gir, mesajları aç
  acikOda = o; odaIci.style.display = "block"; odaBaslik.textContent = o.ad + " (ders: " + o.ders + ")";
  await odaMesajCiz();
}
async function odaMesajCiz() { // mesajları çiz
  let msj = mesajYerel[acikOda.id] || [];
  if (SUNUCU && typeof acikOda.id === "number") { try { msj = await api.odaMesajlar(acikOda.id); } catch { /* yerel */ } }
  odaMesajlar.innerHTML = msj.map(m => `<div class="cevap"><b>${htmlKacis(m.yazar)}</b>: ${htmlKacis(m.metin)}<br><small>${htmlKacis(m.tarih || "")}</small></div>`).join("") || "<small>Henüz mesaj yok, ilk yazan sen ol!</small>";
  odaMesajlar.scrollTop = odaMesajlar.scrollHeight; // en alta kaydır
}
btnOdaGeri.onclick = () => { acikOda = null; odaIci.style.display = "none"; odaListele(); };
btnOdaAc.onclick = async () => {
  if (!aktif) return toast("Önce giriş yap!");
  if (!odaAd.value.trim()) return toast("Oda adı yaz!");
  if (SUNUCU) { try { await api.odaAc(odaAd.value.trim(), odaDers.value); odaAd.value = ""; odaListele(); return toast("Oda açıldı! 🎉"); } catch (e) { return toast(e.message); } }
  const yeni = { id: idUret(), ad: odaAd.value.trim(), ders: odaDers.value, kurucu: aktif.ad }; // yerel oda
  odalarYerel.unshift(yeni); yaz("odalarYerel", odalarYerel); odaAd.value = ""; odaListele(); toast("Oda açıldı! 🎉");
};
async function mesajGonder() { // etik denetimli gönder
  if (!aktif) return toast("Önce giriş yap!");
  if (!odaMesaj.value.trim() || !etikMi(odaMesaj.value)) return toast("Mesaj yaz / etik olsun!");
  if (SUNUCU && typeof acikOda.id === "number") { try { await api.odaMesajGonder(acikOda.id, odaMesaj.value.trim()); } catch (e) { return toast(e.message); } }
  else { (mesajYerel[acikOda.id] = mesajYerel[acikOda.id] || []).push({ yazar: aktif.ad, metin: odaMesaj.value.trim(), tarih: new Date().toLocaleString("tr-TR") }); yaz("mesajYerel", mesajYerel); }
  odaMesaj.value = ""; odaMesajCiz();
}
btnMesajGonder.onclick = mesajGonder;
odaMesaj.onkeydown = e => { if (e.key === "Enter") mesajGonder(); }; // Enter = gönder
setInterval(() => { // oda açıksa 5 sn'de bir tazele (canlı his)
  if (acikOda && document.getElementById("sayfaOdalar").style.display !== "none" && document.getElementById("odaIci").style.display !== "none") odaMesajCiz();
}, 5000);

// --- Ayarlar: tema + hareket ---
function ayarYukle() { // kayıtlı ayarları forma yaz
  ayarTema.value = document.body.classList.contains("karanlik") ? "koyu" : "acik";
  ayarHareket.checked = document.body.classList.contains("hareketsiz");
  ayarApi.value = localStorage.getItem("apiAdres") || "http://localhost:3001"; // sunucu adresi
  ayarVurgu.value = document.body.dataset.vurgu || "yesil"; // vurgu rengi
}
function vurguUygula(renk) { // vurgu rengini gövdeye işle
  if (renk && renk !== "yesil") document.body.dataset.vurgu = renk; // yeşil varsayılan (değişkenler)
  else delete document.body.dataset.vurgu;
}
btnAyarKaydet.onclick = () => {
  const koyu = ayarTema.value === "koyu"; // tema uygula
  document.body.classList.toggle("karanlik", koyu); cihazYaz("karanlik", koyu); btnKaranlik.checked = koyu;
  document.body.classList.toggle("hareketsiz", ayarHareket.checked); cihazYaz("hareketsiz", ayarHareket.checked); // hareket
  vurguUygula(ayarVurgu.value); cihazYaz("vurgu", ayarVurgu.value); // vurgu rengi
  const adres = (ayarApi.value || "").trim().replace(/\/$/, ""); // sondaki / temizle
  if (adres && adres !== (localStorage.getItem("apiAdres") || "http://localhost:3001")) {
    localStorage.setItem("apiAdres", adres); // yeni adresi sakla
    biletYaz(null); localStorage.removeItem("aktifKullanici"); // eski sunucunun bileti YENİ sunucuya gitmez!
    toast("Adres değişti, eski oturum silindi. Yeniden giriş yap!"); setTimeout(() => location.reload(), 1200); return;
  }
  toast("Ayarlar kaydedildi!");
};
// Şifre işlemleri (sunucu bağlıyken gerçek, yerelde kapalı)
btnSifreDegistir.onclick = async () => {
  if (MOD !== "sunucu") return toast("Şifre değiştirme yalnız sunucu bağlıyken olur!");
  try { const r = await api.sifreDegistir(sifreEski.value, sifreYeni.value); sifreEski.value = ""; sifreYeni.value = ""; toast(r.tamam); }
  catch (e) { toast(e.message); }
};
btnSifreUnuttum.onclick = async () => {
  if (MOD !== "sunucu" || !SUNUCU) return toast("Sunucu kapalı! Yöneticinden sıfırlama iste.");
  try { const r = await api.sifreUnuttum(sifreUnutAd.value.trim()); toast(r.tamam); }
  catch (e) { toast(e.message); }
};
if (cihazOku("hareketsiz", false)) document.body.classList.add("hareketsiz"); // kayıtlı tercih
vurguUygula(cihazOku("vurgu", "yesil")); // kayıtlı vurgu rengi

// --- Tanıtım turu: ilk girişte 3 adım ---
const turAdimlari = [
  { sayfa: "akis", baslik: "1/3 Akış", metin: "Arkadaşlarının soruları burada. Yorum yaz, beğen, en iyi çözümü işaretle!" },
  { sayfa: "akis", baslik: "2/3 Paylaş", metin: "Takıldığın soruyu 4 adımda paylaş: tür, yazı, fotoğraf, önizleme." },
  { sayfa: "hoca", baslik: "3/3 Öğretmene Sor", metin: "Olmadıysa doğrulanmış öğretmene sor. Cevap gelince puanla!" }
];
let turNo = 0; // kaçıncı adım
function turGoster() { // turu başlat/devam
  const a = turAdimlari[turNo]; sayfaGoster(a.sayfa);
  turBaslik.textContent = a.baslik; turMetin.textContent = a.metin;
  btnTurSonraki.textContent = turNo === turAdimlari.length - 1 ? "Bitir 🎉" : "Sonraki →";
  turKatman.style.display = "flex";
}
function turBitir() { turKatman.style.display = "none"; cihazYaz("turGordu", true); } // bir daha gösterme
btnTurSonraki.onclick = () => { turNo++; turNo >= turAdimlari.length ? turBitir() : turGoster(); };
btnTurAtla.onclick = turBitir;
function turBelki() { if (!cihazOku("turGordu", false)) { turNo = 0; turGoster(); } } // ilk girişte aç

// --- Ders Programı: sınıf → ders havuzu → sürükle-bırak → takip + çıktı ---
const SINIF_DERSLER = { // sınıfa göre dersler (ortaokul + lise)
  "5. Sınıf": ["Türkçe", "Matematik", "Fen Bilimleri", "Sosyal Bilgiler", "İngilizce", "Din Kültürü", "Bilişim", "Beden Eğitimi", "Müzik", "Görsel Sanatlar"],
  "6. Sınıf": ["Türkçe", "Matematik", "Fen Bilimleri", "Sosyal Bilgiler", "İngilizce", "Din Kültürü", "Bilişim", "Beden Eğitimi", "Müzik", "Görsel Sanatlar"],
  "7. Sınıf": ["Türkçe", "Matematik", "Fen Bilimleri", "Sosyal Bilgiler", "İngilizce", "Din Kültürü", "Bilişim", "Beden Eğitimi", "Müzik", "Görsel Sanatlar"],
  "8. Sınıf": ["Türkçe", "Matematik", "Fen Bilimleri", "İnkılap Tarihi", "İngilizce", "Din Kültürü", "Bilişim", "Beden Eğitimi", "Rehberlik"],
  "9. Sınıf": ["Türk Dili ve Edebiyatı", "Matematik", "Fizik", "Kimya", "Biyoloji", "Tarih", "Coğrafya", "İngilizce", "Din Kültürü", "Beden Eğitimi"],
  "10. Sınıf": ["Türk Dili ve Edebiyatı", "Matematik", "Fizik", "Kimya", "Biyoloji", "Tarih", "Coğrafya", "İngilizce", "Felsefe", "Beden Eğitimi"],
  "11. Sınıf": ["Türk Dili ve Edebiyatı", "Matematik", "Fizik", "Kimya", "Biyoloji", "Tarih", "İngilizce", "Felsefe", "Rehberlik"],
  "12. Sınıf": ["Türk Dili ve Edebiyatı", "Matematik", "Fizik", "Kimya", "Biyoloji", "Tarih", "İngilizce", "Rehberlik"]
};
const PROGRAM_SAAT = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00"]; // 07.00-gece 12 arası
const PROGRAM_GUN = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]; // 7 gün
let seciliDers = null; // dokunarak seçilen ders (telefon için)
const ONBELLEK_SURUM = "v1"; // şema değişince artır (eski anahtarlar okunmaz!)
function apiOrtami() { // normalize edilmiş sunucu adı (boşluk/büyük harf/kuyruk eğik çizgi yok!)
  return (localStorage.getItem("apiAdres") || "http://localhost:3001").trim().toLowerCase().replace(/\/$/, "").replace(/^https?:\/\//, "");
}
function hesapEtiket() { // önbellek anahtarı: sürüm + ortam + hesap (ortamlar/hesaplar karışmaz!)
  const kim = (MOD === "sunucu" && aktif) ? "srv:" + aktif.ad
    : (localStorage.getItem("demoModu") === "acik" ? "demo" : "yerel");
  return ONBELLEK_SURUM + "|" + apiOrtami() + "|" + kim;
}
function gocEskiOnbellek(kok) { // eski anahtarlardan güvenli, tekrar çalıştırılabilir geçiş (SİLMEZ!)
  const yeni = kok + ":" + hesapEtiket(); // hedef anahtar
  if (localStorage.getItem("goc:" + yeni)) return; // daha önce taşındı
  const ad = aktif ? aktif.ad : ""; // hesap adı
  const adaylar = [kok + ":srv:" + ad, kok + ":demo", kok + ":yerel"]; // eski biçimler (sürümsüz!)
  if (kok === "prog") adaylar.push("program"); // çok eski ortak anahtar
  if (kok === "ekarne") adaylar.push("ekarne"); // çok eski ortak anahtar
  const doluMu = v => v && (Array.isArray(v.denemeler) ? v.denemeler.length : ((v.hucre && Object.keys(v.hucre).length) || (v.ozelDersler && v.ozelDersler.length) || (v.sinif ? 1 : 0)));
  for (const a of adaylar) { // ilk dolu bulunanı kopyala (kaynak durur!)
    if (a === yeni) continue; // kendisiyle eşleşme
    let v = null;
    try { v = JSON.parse(localStorage.getItem(a) || "null"); } catch { /* bozuksa geç */ }
    if (doluMu(v)) { localStorage.setItem(yeni, JSON.stringify(v)); break; }
  }
  localStorage.setItem("goc:" + yeni, "1"); // bir kez denendi (boşsa da tekrar sorma!)
}
function programVeri() { const v = oku("prog:" + hesapEtiket(), null); return v || { sinif: "", hucre: {}, ozelDersler: [] }; } // kendi önbelleğim
function programSurumOku() { return +(localStorage.getItem("surum:" + hesapEtiket()) || 0); } // bilinen sunucu sürümü
function programSurumYaz(s) { localStorage.setItem("surum:" + hesapEtiket(), String(s)); } // sürümü sakla
function programDurumYaz(metin) { const el = document.getElementById("programDurum"); if (el) el.textContent = metin; } // durum satırı
function sadeleProgram(v) { return { sinif: (v && v.sinif) || "", hucre: (v && v.hucre) || {}, ozelDersler: (v && v.ozelDersler) || [] }; } // sunucuya gidecek alanlar
let programPushSure = null; // üst üste yazmayı birleştir
// Revizyon tabanlı kalıcı kuyruk (A giderken B kaybolmaz; hesap/ortam ayrı; bağlantı gelince sürer)
const programKuyruk = ProgramKuyruk.olustur({
  depo: localStorage,
  etiketAl: () => hesapEtiket(), // istek başında kimlik yakalanır
  gonder: (veri, taban, istekId) => api.programPut({ data: veri, surum: taban }, istekId), // sabit kimlik: ağ tekrarı tek kayıt
  surumOku: () => programSurumOku(),
  surumYaz: s => programSurumYaz(s),
  olay: (tur, e, etiket) => {
    if (etiket && etiket !== hesapEtiket()) return; // ESKİ hesabın olayı yeni hesabın EKRANINI değiştirmez
    if (tur === "bekliyor") programDurumYaz("⏳ Kaydediliyor...");
    else if (tur === "kaydedildi") { const el = document.getElementById("programCakisma"); if (el) el.style.display = "none"; programDurumYaz("✅ Kaydedildi (sunucu onaylı)"); }
    else if (tur === "hata") {
      if (e && e.kod === 409) { const el = document.getElementById("programCakisma"); if (el) el.style.display = "block"; programDurumYaz("⚠️ Başka cihazda değişmiş! Seçim yap."); }
      else programDurumYaz("⚠️ Kaydedilemedi! Bağlantıyı kontrol et (verin duruyor)."); // BAŞARISIZSA BAŞARI DEME!
    }
  }
});
function programKaydet(v) { yaz("prog:" + hesapEtiket(), v); programKuyrukEkle(v); } // önce cebe, sonra kuyruğa
function programKuyrukEkle(v) { // kalıcı, kullanıcıya özel bekleyen yazma (hesap/ortam değişince BAŞKASINA GİTMEZ!)
  programKuyruk.ekle(sadeleProgram(v)); // benzersiz revizyonla kuyruğa
  programPushPlanla();
}
function programPushPlanla() { // gecikmeli gönder (kapanışta hemen yazılır!)
  if (MOD !== "sunucu" || !aktif) { programDurumYaz("💾 Yalnızca bu cihazda"); return; }
  clearTimeout(programPushSure);
  programPushSure = setTimeout(programHemenYaz, 800); // 0.8 sn bekle, toplu yaz
}
async function programHemenYaz() { // kuyruğu ŞİMDİ gönder (kapanışta/kaydetmede)
  clearTimeout(programPushSure); // sayaç iptal (çift gönderme yok!)
  if (MOD !== "sunucu" || !aktif) return; // yalnız sunucu modunda
  await programKuyruk.yaz(); // kuyruk: revizyona göre temizler, yeniyi korur, hatada bekler
}
async function yukleProgram() { // giriş/sayfa açılışında sunucudan çek (bekleyeni EZMEZ!)
  if (MOD !== "sunucu" || !aktif) return;
  const beklenti = programKuyruk.bekleyen(hesapEtiket()); // bekleyen yazma var mı
  try {
    const srv = await api.programGet(); // kendi programım (yoksa null)
    if (srv) {
      if (!beklenti) { // bekleyen YOKSA sunucuyu al
        yaz("prog:" + hesapEtiket(), { sinif: srv.sinif || "", hucre: srv.hucre || {}, ozelDersler: srv.ozelDersler || [] });
        programSurumYaz(srv.surum || 0);
      } else programDurumYaz("⏳ Bekleyen değişikliğin var (sunucunun üstüne yazılmadı)."); // bekleyen EZİLMEZ!
    }
  } catch { /* sessiz: önbellekle devam */ }
  if (programKuyruk.bekleyen(hesapEtiket())) programHemenYaz(); // bağlantı/tekrar giriş: bekleyeni GÜVENLE gönder
}
document.addEventListener("visibilitychange", () => { // sekme kapanırken/gizlenince HEMEN yaz (sayaç beklenmez!)
  if (document.visibilityState === "hidden") programHemenYaz();
});
window.addEventListener("online", () => { if (MOD === "sunucu" && aktif) programHemenYaz(); }); // bağlantı döndü: bekleyen kuyruğu sür
programSinif.onchange = () => { const v = programVeri(); v.sinif = programSinif.value; programKaydet(v); seciliDers = null; programCiz(); }; // sınıf değişti
function programCiz() { // havuz + tabloyu çiz
  const v = programVeri();
  if (!v.ozelDersler) v.ozelDersler = []; // sonradan eklenen alan
  programSinif.value = v.sinif || ""; // seçimi koru
  const havuz = document.getElementById("dersHavuzu"); havuz.innerHTML = ""; // ders çipleri
  const tumDersler = [...(SINIF_DERSLER[v.sinif] || []), ...v.ozelDersler]; // hazır + özel
  tumDersler.forEach(d => {
    const ozel = v.ozelDersler.includes(d); // özel mi
    const c = document.createElement("button"); c.className = "dersCip" + (seciliDers === d ? " secili" : "") + (ozel ? " ozel" : ""); c.draggable = true;
    c.textContent = d;
    if (ozel) { const x = document.createElement("span"); x.className = "kapat"; x.textContent = "×"; x.title = "Dersi sil"; x.onmousedown = e => e.preventDefault(); x.onclick = e => { e.preventDefault(); e.stopPropagation(); v.ozelDersler = v.ozelDersler.filter(y => y !== d); Object.keys(v.hucre).forEach(k2 => { if (v.hucre[k2] && v.hucre[k2].ders === d) delete v.hucre[k2]; }); programKaydet(v); seciliDers = null; programCiz(); toast("Ders silindi."); }; c.appendChild(x); } // özel dersi ve yerleşimlerini sil (sürükleme tıklamayı yutmasın!)
    c.ondragstart = e => e.dataTransfer.setData("text/plain", d); // sürüklenen ders
    c.onclick = () => { seciliDers = seciliDers === d ? null : d; programCiz(); }; // dokun-seç
    havuz.appendChild(c);
  });
  if (!v.sinif) havuz.innerHTML = "<small>Önce sınıfını seç, dersler buraya gelsin.</small>";
  const tablo = document.getElementById("programTablo"); tablo.innerHTML = ""; // tablo
  const bugun = (new Date().getDay() + 6) % 7; // bugünün sütunu (Pazartesi=0)
  const bas = document.createElement("tr"); // başlık satırı
  bas.innerHTML = "<th>Saat</th>" + PROGRAM_GUN.map(g => `<th>${g}</th>`).join("");
  tablo.appendChild(bas);
  PROGRAM_SAAT.forEach(saat => {
    const tr = document.createElement("tr");
    const th = document.createElement("th"); th.className = "saat"; th.textContent = saat; tr.appendChild(th); // saat hücresi
    PROGRAM_GUN.forEach((gun, gi) => {
      const td = document.createElement("td");
      const anahtar = gun + "|" + saat; // hücre kimliği
      const icerik = v.hucre[anahtar];
      if (gi === bugun) td.classList.add("bugun"); // bugünü boya
      if (icerik) { // ders varsa göster + dokununca ✓
        td.classList.add("dolu"); if (icerik.yapildi) td.classList.add("yapildi");
        td.textContent = (icerik.yapildi ? "✓ " : "") + icerik.ders;
        const x = document.createElement("span"); x.className = "kapat"; x.textContent = "×"; x.title = "Temizle";
        x.onclick = e => { e.stopPropagation(); delete v.hucre[anahtar]; programKaydet(v); programCiz(); }; // dersi kaldır
        td.appendChild(x);
        td.onclick = () => { icerik.yapildi = !icerik.yapildi; programKaydet(v); programCiz(); }; // yapıldı işareti
      } else { // boş hücre: seçili dersi koy ya da sürükle-bırak
        td.onclick = () => { if (!seciliDers) return; v.hucre[anahtar] = { ders: seciliDers, yapildi: false }; seciliDers = null; programKaydet(v); programCiz(); };
        td.ondragover = e => { e.preventDefault(); td.classList.add("hedef"); };
        td.ondragleave = () => td.classList.remove("hedef");
        td.ondrop = e => { e.preventDefault(); const d = e.dataTransfer.getData("text/plain"); if (!d) return; v.hucre[anahtar] = { ders: d, yapildi: false }; programKaydet(v); programCiz(); };
      }
      tr.appendChild(td);
    });
    tablo.appendChild(tr);
  });
  const dolular = Object.values(v.hucre); // ilerleme: yapılan / toplam
  const yuzde = dolular.length ? Math.round(dolular.filter(h => h.yapildi).length / dolular.length * 100) : 0;
  document.getElementById("programYuzde").textContent = "%" + yuzde;
  document.getElementById("programBar").style.width = yuzde + "%";
  ikonTazele();
}
btnProgramTemizle.onclick = () => { const v = programVeri(); v.hucre = {}; programKaydet(v); programCiz(); toast("Program temizlendi."); };
let cakismaIsliyor = false; // çakışma işlemi sürerken ikinci tıklama/iki düğme birden YASAK
function cakismaDugme(cap) { // işlem sürerken her iki çakışma düğmesini de kitle, sonra geri al (çift tık yok)
  ["btnCakismaSunucu", "btnCakismaBenim"].forEach(id => {
    const b = document.getElementById(id); if (!b) return;
    if (cap) { if (!b.dataset.eskiMetin) b.dataset.eskiMetin = b.textContent; b.disabled = true; b.textContent = id === "btnCakismaSunucu" ? "Alınıyor..." : "Yazılıyor..."; }
    else { b.disabled = false; if (b.dataset.eskiMetin) b.textContent = b.dataset.eskiMetin; }
  });
}
function cakismaHata(e) { return (e && (e.message || e.hata)) || "bağlantı yok"; } // kullanıcıya eyleme dönük metin
document.getElementById("btnCakismaSunucu").onclick = async () => { // sunucudaki sürümü al
  if (cakismaIsliyor) return; // çift tık: tek işlem
  const etiket = hesapEtiket(); // hesap İSTEMİN BAŞINDA yakalanır (bu arada değişirse yanıt uygulanmaz)
  const baslangicRev = programKuyruk.sonRev(etiket);
  const baslangicVeri = JSON.stringify(programVeri());
  const pano = document.getElementById("programCakisma");
  cakismaIsliyor = true; cakismaDugme(true);
  try {
    const srv = await api.programGet(); // ÖNCE sunucudan çek VE doğrula, SONRA temizle (veri kaybı yok!)
    if (etiket !== hesapEtiket()) return toast("Hesap değişti; işlem iptal edildi (bekleyen değişikliklerin duruyor)."); // yanıt eski hesaba ait
    // İstek sırasında yapılan düzenlemeler, kuyruk bu arada gönderilmiş olsa da korunur.
    if (programKuyruk.sonRev(etiket) !== baslangicRev || JSON.stringify(programVeri()) !== baslangicVeri) {
      programDurumYaz("⚠️ Bu sırada programı değiştirdin; yeni düzenlemelerin korundu.");
      return toast("Sunucudaki uygulanmadı. Yeni düzenlemelerin korundu; tercihini tekrar seç.");
    }
    if (srv == null) { // boş sunucu açıkça ele alınır: değişecek bir şey YOK
      programDurumYaz("ℹ️ Sunucuda kayıtlı program yok; bekleyenlerin duruyor.");
      return toast("Sunucuda program yok. Bekleyen değişikliklerin duruyor; 'Benimkini Yaz.' ile yükleyebilirsin.");
    }
    yaz("prog:" + etiket, srv); programSurumYaz(srv.surum || 0); // sunucu sürümü benimsenir
    programKuyruk.temizle(); // ancak BAŞARILI çekme + hesap eşleşmesinden sonra bekleyen atılır
    pano.style.display = "none";
    programDurumYaz("✅ Sunucudaki alındı.");
    programCiz(); toast("Sunucudaki alındı.");
  } catch (e) { // HATA: bekleyen KORUNUR, çakışma seçimi AÇIK kalır
    programDurumYaz("⚠️ Sunucudakine ulaşılamadı; bekleyenlerin duruyor.");
    toast("Sunucudakine ulaşılamadı (" + cakismaHata(e) + "). Bekleyen değişikliklerin duruyor; tekrar deneyebilirsin.");
  } finally { cakismaIsliyor = false; cakismaDugme(false); }
};
document.getElementById("btnCakismaBenim").onclick = async () => { // benimkini zorla yaz
  if (cakismaIsliyor) return; // çift tık: tek işlem
  const etiket = hesapEtiket(); // hesap İSTEMİN BAŞINDA yakalanır
  const esik = programKuyruk.sonRev(etiket); // BAŞLANGIÇTAKİ bekleyenlerin sınırı: sırada TEKRAR iş varsa ezilmez
  const v = programVeri(); // o anki içerik; sonradan yapılan değişiklikler kuyrukta YENİ revizyonla durur
  cakismaIsliyor = true; cakismaDugme(true);
  try {
    const cur = await api.programGet(); // güncel sürümü al
    if (etiket !== hesapEtiket()) return toast("Hesap değişti; işlem iptal edildi."); // yanıt eski hesaba ait
    const r = await api.programPut({ data: sadeleProgram(v), surum: (cur && cur.surum) || 0 });
    if (etiket !== hesapEtiket()) return toast("Hesap değişti; sonuç uygulanmadı."); // yanıtta hesap değişmişse ezme
    programSurumYaz(r.surum);
    programKuyruk.temizle(esik); // REVİZYON BİLİNÇLİ: yalnız başlangıçtakiler atılır, işlem sürerkenki düzenlemeler KALIR
    if (programKuyruk.bekleyen(etiket)) { // istem sırasında yeni değişiklik geldi: hemen sür
      programDurumYaz("✅ Seninki yazıldı; bu aradaki değişiklikler de gönderiliyor...");
      await programHemenYaz();
    } else { document.getElementById("programCakisma").style.display = "none"; programDurumYaz("✅ Kaydedildi (sunucu onaylı)"); }
    toast("Seninki yazıldı.");
  } catch (e) { // HATA: bekleyen KORUNUR, çakışma seçimi AÇIK kalır
    programDurumYaz("⚠️ Yazılamadı; bekleyenlerin duruyor.");
    toast("Olmadı (" + cakismaHata(e) + "). Bekleyen değişikliklerin duruyor; sonra tekrar deneyebilirsin.");
  } finally { cakismaIsliyor = false; cakismaDugme(false); }
};
btnProgramYazdir.onclick = () => { document.body.dataset.yazdir = "program"; window.print(); setTimeout(() => delete document.body.dataset.yazdir, 500); }; // yalnız program çıkar
btnOzelDersEkle.onclick = () => { // havuza özel ders kat
  const ad = (ozelDersAd.value || "").trim().slice(0, 30); // en fazla 30 harf
  if (!ad) return toast("Ders adı yaz!");
  const v = programVeri(); if (!v.ozelDersler) v.ozelDersler = [];
  if ([...(SINIF_DERSLER[v.sinif] || []), ...v.ozelDersler].some(d => d.toLocaleLowerCase("tr") === ad.toLocaleLowerCase("tr"))) return toast("Bu ders zaten var!");
  v.ozelDersler.push(ad); programKaydet(v); ozelDersAd.value = ""; programCiz(); toast("Eklendi!");
};

// --- E-Karne: deneme kayıtları + dönem tabloları (günlük/haftalık/aylık/yıllık) ---
// --- E-Karne: deneme kayıtları + dönem tabloları (hesap başına, sunucuda) ---
function bugunTR() { // Türkiye takvim günü (UTC gecikmesi yok, 00.30'da bile doğru gün)
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }); // YYYY-AA-GG
}
function isoHafta(tarih) { // ISO-8601 haftası: pazartesi başlar, yıl geçişi doğru (örn. 2025-01-01 -> 2025-W01)
  const d = new Date(tarih + "T12:00:00");
  const gun = (d.getDay() + 6) % 7; // pazartesi=0
  d.setDate(d.getDate() - gun + 3); // haftanın perşembesi (ISO kuralı)
  const ilkPersembe = new Date(d.getFullYear(), 0, 4); // yılın ilk perşembesi
  const ilkGun = (ilkPersembe.getDay() + 6) % 7; // kaydırma
  ilkPersembe.setDate(ilkPersembe.getDate() - ilkGun + 3);
  const no = 1 + Math.round((d - ilkPersembe) / 6048e5); // hafta numarası
  return d.getFullYear() + "-W" + String(no).padStart(2, "0");
}
function netKural(dogru, yanlis, kural) { // kurala göre net (kayıtla saklanır, sessizce değişmez!)
  if (kural === "3y1d") return dogru - yanlis / 3; // 3 yanlış 1 doğruyu götürür
  if (kural === "yok") return dogru; // yanlış götürmez
  return dogru - yanlis / 4; // varsayılan: 4 yanlış 1 doğru
}
const KURAL_AD = { "4y1d": "4Y-1D", "3y1d": "3Y-1D", "yok": "Götürmez" }; // kısa ad
function ekarneVeri() { return oku("ekarne:" + hesapEtiket(), { denemeler: [] }); } // kendi önbelleğim
function ekarneKaydet(v) { yaz("ekarne:" + hesapEtiket(), v); } // önbelleğe yaz
async function yukleEkarne() { // giriş/sayfa açılışında sunucudan çek
  if (MOD !== "sunucu" || !aktif) return;
  try {
    const liste = await api.denemeListe(); // kendi denemelerim
    yaz("ekarne:" + hesapEtiket(), { denemeler: Array.isArray(liste) ? liste : [] });
  } catch { /* sessiz: önbellekle devam */ }
}
const TAM_SAYI = v => /^\d+$/.test(String(v).trim()); // sonlu negatif-olmayan tam sayı mı
let duzenlenenDeneme = null; // doluysa Kaydet günceller
let denemeTumuGoster = false; // false=son 10, true=hepsi (sayfalama!)
btnDenemeEkle.onclick = async () => { // denemeyi doğrula + kaydet (yalan mesaj yok!)
  const tarih = denemeTarih.value || bugunTR(); // boşsa bugün (TR)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) return toast("Tarih seç!");
  for (const [kut, ad] of [[denemeSoru, "Soru"], [denemeDogru, "Doğru"], [denemeYanlis, "Yanlış"]])
    if (!TAM_SAYI(kut.value)) return toast(ad + " sayısı tam sayı olmalı!"); // ondalık/negatif red
  const soru = +denemeSoru.value, dogru = +denemeDogru.value, yanlis = +denemeYanlis.value;
  if (soru < 1 || soru > 500) return toast("Soru 1-500 arası olmalı!");
  if (dogru + yanlis > soru) return toast("Doğru+yanlış soru sayısını geçemez!");
  if (!denemeYayin.value.trim()) return toast("Yayın yaz!");
  const veri = { tarih, tur: denemeTur.value, yayin: denemeYayin.value.trim(), ders: denemeDers.value.trim() || "Genel", soru, dogru, yanlis, kural: denemeKural.value };
  if (MOD === "sunucu" && aktif) { // sunucuya yaz (hesabına)
    try {
      if (duzenlenenDeneme) await api.denemeDuzenle(duzenlenenDeneme, veri); // güncelle
      else await api.denemeEkle(veri); // yeni
      duzenlenenDeneme = null; btnDenemeEkle.textContent = "Kaydet";
      denemeYayin.value = ""; denemeDers.value = ""; denemeSoru.value = ""; denemeDogru.value = ""; denemeYanlis.value = "";
      await yukleEkarne(); ekarneCiz(); return toast("Kaydedildi. Net: " + netKural(dogru, yanlis, veri.kural).toFixed(2));
    } catch (e) { return toast("Kaydedilemedi: " + e.message); } // BAŞARISIZSA BAŞARI DEME!
  }
  const v = ekarneVeri(); // yerel yedek
  if (duzenlenenDeneme) { const h = v.denemeler.find(x => x.id === duzenlenenDeneme); Object.assign(h, veri, { bos: soru - dogru - yanlis, net: netKural(dogru, yanlis, veri.kural) }); duzenlenenDeneme = null; btnDenemeEkle.textContent = "Kaydet"; }
  else v.denemeler.unshift({ id: idUret(), ...veri, bos: soru - dogru - yanlis, net: netKural(dogru, yanlis, veri.kural) });
  ekarneKaydet(v);
  denemeYayin.value = ""; denemeDers.value = ""; denemeSoru.value = ""; denemeDogru.value = ""; denemeYanlis.value = "";
  ekarneCiz(); toast("Kaydedildi. Net: " + netKural(dogru, yanlis, veri.kural).toFixed(2));
};
function ekarneFiltreli() { // grafik + tablolar AYNI filtreyi kullanır (ders + tür)
  const v = ekarneVeri(), ders = grafikDers.value || "Tümü", tur = (document.getElementById("ekarneTur") || {}).value || "Tümü";
  return v.denemeler.filter(d => (ders === "Tümü" || d.ders === ders) && (tur === "Tümü" || (d.tur || "Ders Denemesi") === tur));
}
function ekarneCiz() { // liste + 4 dönem tablosu + grafik (aynı filtre!)
  const v = ekarneVeri();
  denemeTarih.value = denemeTarih.value || bugunTR(); // bugünü öner (TR)
  gocKontrol(); // eski ortak kayıt varsa taşıma öner
  const liste = document.getElementById("denemeListesi"); liste.innerHTML = ""; // kayıtlı denemeler
  const tumu = denemeTumuGoster; // 10 mu hepsi mi
  [...v.denemeler].sort((a, b) => b.tarih.localeCompare(a.tarih)).slice(0, tumu ? v.denemeler.length : 10).forEach(d => {
    const div = document.createElement("div"); div.className = "cevap";
    div.textContent = `${d.tarih} • ${d.tur || "Ders Denemesi"} • ${d.yayin} • ${d.ders} • D:${d.dogru} Y:${d.yanlis} B:${d.bos} • Net: ${(+d.net).toFixed(2)} [${KURAL_AD[d.kural] || "4Y-1D"}]`;
    const dz = document.createElement("button"); dz.className = "ikincil"; dz.textContent = "Düzenle"; dz.style.minHeight = "32px";
    dz.onclick = () => { // formu doldur, Kaydet günceller
      denemeTarih.value = d.tarih; denemeTur.value = d.tur || "Ders Denemesi"; denemeYayin.value = d.yayin; denemeDers.value = d.ders === "Genel" ? "" : d.ders;
      denemeSoru.value = d.soru; denemeDogru.value = d.dogru; denemeYanlis.value = d.yanlis; denemeKural.value = d.kural || "4y1d";
      duzenlenenDeneme = d.id; btnDenemeEkle.textContent = "Güncelle"; window.scrollTo(0, 0);
    };
    const x = document.createElement("button"); x.className = "ikincil"; x.textContent = "Sil"; x.style.minHeight = "32px";
    x.onclick = async () => {
      if (MOD === "sunucu" && aktif && typeof d.id === "number") { try { await api.denemeSil(d.id); await yukleEkarne(); ekarneCiz(); return toast("Silindi."); } catch (e) { return toast("Silinemedi: " + e.message); } }
      v.denemeler = v.denemeler.filter(y => y.id !== d.id); ekarneKaydet(v); ekarneCiz();
    };
    div.appendChild(dz); div.appendChild(x); liste.appendChild(div);
  });
  if (!v.denemeler.length) liste.innerHTML = "<small>Henüz deneme yok. Yukarıdan ekle!</small>";
  else if (!tumu && v.denemeler.length > 10) { const df = document.createElement("button"); df.className = "ikincil"; df.textContent = `Tümü (${v.denemeler.length})`; df.onclick = () => { denemeTumuGoster = true; ekarneCiz(); }; liste.appendChild(df); } // eski kayıtlara erişim
  const satir = hucreler => `<tr>${hucreler.map(h => `<td>${h}</td>`).join("")}</tr>`; // satır kurucu
  const ort = a => a.length ? (a.reduce((t, x) => t + x, 0) / a.length) : 0; // ortalama
  const F = ekarneFiltreli(); // filtreli liste (grafikle aynı!)
  const gunler = {}; // tarih -> denemeler
  F.forEach(d => { (gunler[d.tarih] = gunler[d.tarih] || []).push(d); });
  let gunHtml = "<tr><th>Tarih</th><th>Deneme</th><th>Doğru</th><th>Yanlış</th><th>Net</th></tr>";
  Object.keys(gunler).sort().reverse().slice(0, 14).forEach(t => {
    const g = gunler[t], net = g.reduce((a, d) => a + (+d.net), 0);
    gunHtml += satir([t, g.length, g.reduce((a, d) => a + d.dogru, 0), g.reduce((a, d) => a + d.yanlis, 0), net.toFixed(2)]);
  });
  document.getElementById("tabloGunluk").innerHTML = gunHtml;
  const haftalar = {}; // hafta -> denemeler (ISO haftası)
  F.forEach(d => { const k = isoHafta(d.tarih); (haftalar[k] = haftalar[k] || []).push(d); });
  let haftaHtml = "<tr><th>Hafta</th><th>Deneme</th><th>Ort. Net</th><th>Toplam Doğru</th></tr>";
  Object.keys(haftalar).sort().reverse().slice(0, 12).forEach(k => {
    const g = haftalar[k];
    haftaHtml += satir([k, g.length, ort(g.map(d => +d.net)).toFixed(2), g.reduce((a, d) => a + d.dogru, 0)]);
  });
  document.getElementById("tabloHaftalik").innerHTML = haftaHtml;
  const aylar = {}; // ay -> denemeler
  F.forEach(d => { const k = d.tarih.slice(0, 7); (aylar[k] = aylar[k] || []).push(d); });
  let ayHtml = "<tr><th>Ay</th><th>Deneme</th><th>Ort. Net</th><th>Toplam Net</th></tr>";
  Object.keys(aylar).sort().reverse().slice(0, 12).forEach(k => {
    const g = aylar[k];
    ayHtml += satir([k, g.length, ort(g.map(d => +d.net)).toFixed(2), g.reduce((a, d) => a + (+d.net), 0).toFixed(2)]);
  });
  document.getElementById("tabloAylik").innerHTML = ayHtml;
  const yillar = {}; // yıl -> denemeler
  F.forEach(d => { const k = d.tarih.slice(0, 4); (yillar[k] = yillar[k] || []).push(d); });
  let yilHtml = "<tr><th>Yıl</th><th>Deneme</th><th>Ort. Net</th><th>En İyi Net</th></tr>";
  Object.keys(yillar).sort().reverse().forEach(k => {
    const g = yillar[k];
    yilHtml += satir([k, g.length, ort(g.map(d => +d.net)).toFixed(2), Math.max(...g.map(d => +d.net)).toFixed(2)]);
  });
  document.getElementById("tabloYillik").innerHTML = yilHtml || "<tr><td>Henüz veri yok.</td></tr>";
  grafikCiz(F); // AYNI filtreli veri (tutarlı!)
  ikonTazele();
}
let grafikNokta = []; // fareyle bulunacak noktalar {x, y, d}
function grafikDeger(d) { // normalize açıksa 0-100 ölçeği (farklı sınavlar karşılaştırılabilir)
  const norm = document.getElementById("grafikNorm")?.checked; // 0-100'e çevir
  return norm && d.soru ? (+d.net) / d.soru * 100 : +d.net;
}
function grafikCiz(denemeler) { // tuval üzerine net çizgisi + noktalar (gerçek min-maks, sıfıra kırpma YOK)
  const tuval = document.getElementById("grafikTuval");
  const filtre = document.getElementById("grafikDers");
  const dersler = [...new Set(ekarneVeri().denemeler.map(d => d.ders).filter(Boolean))]; // ders filtresi doldur (tümü)
  const secili = filtre.value || "Tümü";
  filtre.innerHTML = ""; // güvenli kur (textContent ile)
  ["Tümü", ...dersler].forEach(d => { const o = document.createElement("option"); o.textContent = d; if (d === secili) o.selected = true; filtre.appendChild(o); });
  const veri = denemeler.slice().sort((a, b) => a.tarih.localeCompare(b.tarih)); // eskiden yeniye (filtreli gelir)
  const genislik = tuval.parentElement.clientWidth || 600; // kutuya sığdır
  const yukseklik = 220, oran = window.devicePixelRatio || 1; // net çizgi
  tuval.width = genislik * oran; tuval.height = yukseklik * oran;
  tuval.style.height = yukseklik + "px";
  const c = tuval.getContext("2d"); c.scale(oran, oran);
  const koyu = document.body.classList.contains("karanlik"); // temaya göre renk
  c.clearRect(0, 0, genislik, yukseklik);
  grafikNokta = []; // noktaları sıfırla
  grafikTabloCiz(veri); // erişilebilir liste (klavye/dokunmatik/ekran okuyucu)
  if (!veri.length) { c.fillStyle = koyu ? "#9db3a5" : "#777"; c.font = "14px Arial"; c.fillText("Henüz veri yok, deneme ekle!", 20, 40); return; }
  const sol = 44, alt = 24, ust = 10; // kenar payları
  const degerler = veri.map(grafikDeger); // normalize dahil
  let enb = Math.max(...degerler), enk = Math.min(...degerler); // GERÇEK min-maks
  if (enb === enk) { enb += 1; enk -= 1; } // tek değerde çizgi görünsün
  const X = i => sol + (genislik - sol - 10) * (veri.length === 1 ? 0.5 : i / (veri.length - 1)); // yatay
  const Y = n => yukseklik - alt - (yukseklik - alt - ust) * ((n - enk) / (enb - enk)); // dikey (kırpma yok!)
  c.strokeStyle = koyu ? "#3a4a40" : "#ddd"; c.fillStyle = koyu ? "#9db3a5" : "#777"; c.font = "11px Arial";
  [enk, (enk + enb) / 2, enb].forEach(v => { const y = Y(v); c.beginPath(); c.moveTo(sol, y); c.lineTo(genislik - 10, y); c.stroke(); c.fillText((Math.round(v * 100) / 100), 2, y + 4); }); // ızgara (gerçek değer)
  c.strokeStyle = "#16a34a"; c.lineWidth = 2; c.beginPath(); // çizgi
  veri.forEach((d, i) => { i ? c.lineTo(X(i), Y(grafikDeger(d))) : c.moveTo(X(i), Y(grafikDeger(d))); });
  c.stroke();
  veri.forEach((d, i) => { // noktalar
    const x = X(i), y = Y(grafikDeger(d)); grafikNokta.push({ x, y, d });
    c.fillStyle = d.tur === "Genel Deneme" ? "#2563eb" : "#16a34a"; // genel mavi, ders yeşil
    c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill();
    c.fillStyle = koyu ? "#9db3a5" : "#555"; c.fillText(d.tarih.slice(5), x - 14, yukseklik - 8); // tarih
  });
}
function grafikTabloCiz(veri) { // noktaların erişilebilir listesi (klavye + dokunmatik)
  const alan = document.getElementById("grafikTablo"); if (!alan) return;
  alan.innerHTML = "";
  veri.forEach(d => {
    const b = document.createElement("button"); b.className = "ikincil"; b.style.minHeight = "36px";
    b.textContent = `${d.tarih} • ${d.ders} • Net: ${(+d.net).toFixed(2)}`; // odakta okunur
    b.onclick = () => toast(`${d.tarih} ${d.yayin} ${d.ders}: D${d.dogru} Y${d.yanlis} B${d.bos} Net ${(+d.net).toFixed(2)} [${KURAL_AD[d.kural] || "4Y-1D"}]`);
    alan.appendChild(b);
  });
  if (!veri.length) alan.innerHTML = "<small>Henüz nokta yok.</small>";
}
function grafikBalon(fx, fy, kutu) { // fare/dokunma noktasına en yakın detay
  let yakin = null, uzak = 1e9;
  grafikNokta.forEach(n => { const u = (n.x - fx) ** 2 + (n.y - fy) ** 2; if (u < uzak) { uzak = u; yakin = n; } }); // en yakın nokta
  const balon = document.getElementById("grafikIpucu");
  if (yakin && uzak < 900) { // 30px yakınsa göster (güvenli metin)
    const d = yakin.d;
    balon.innerHTML = `<b>${htmlKacis(d.tarih)}</b> • ${htmlKacis(d.tur || "Ders Denemesi")}<br>${htmlKacis(d.yayin)} • ${htmlKacis(d.ders)}<br>D:${d.dogru} Y:${d.yanlis} B:${d.bos}<br><b>Net: ${(+d.net).toFixed(2)}</b> [${htmlKacis(KURAL_AD[d.kural] || "4Y-1D")}]`;
    balon.style.display = "block";
    balon.style.left = Math.min(yakin.x + 12, kutu.width - 180) + "px";
    balon.style.top = Math.max(yakin.y - 10, 0) + "px";
  } else balon.style.display = "none";
}
document.getElementById("grafikDers").onchange = () => ekarneCiz(); // filtre değişti (grafik+tablolar birlikte)
document.getElementById("grafikTuval").onmousemove = e => { // noktaya gelince detay balonu
  const kutu = e.target.getBoundingClientRect();
  grafikBalon(e.clientX - kutu.left, e.clientY - kutu.top, kutu);
};
document.getElementById("grafikTuval").onclick = e => { // dokunmatik: dokununca da detay
  const kutu = e.target.getBoundingClientRect();
  grafikBalon(e.clientX - kutu.left, e.clientY - kutu.top, kutu);
};
document.getElementById("grafikTuval").onmouseleave = () => document.getElementById("grafikIpucu").style.display = "none";
document.getElementById("grafikDers").onchange = () => ekarneCiz(); // filtre değişti (grafik+tablolar birlikte)
document.getElementById("ekarneTur").onchange = () => ekarneCiz(); // tür filtresi (ortak)
document.getElementById("grafikNorm").onchange = () => grafikCiz(ekarneFiltreli()); // normalize aç/kapa
// --- Eski ortak kayıtları taşıma (otomatik atama YOK, kullanıcı onaylar!) ---
function gocEskiVeri() { // ham ortak anahtarlardaki veri (demo önekli değil!)
  let e = null, p = null;
  try { e = JSON.parse(localStorage.getItem("ekarne") || "null"); } catch { /* bozuksa geç */ }
  try { p = JSON.parse(localStorage.getItem("program") || "null"); } catch { /* bozuksa geç */ }
  return { ekarne: e, program: p };
}
function gocKontrol() { // taşınacak eski kayıt varsa bandı göster
  const alan = document.getElementById("gocBanner"); if (!alan) return;
  if (MOD !== "sunucu" || !aktif) { alan.style.display = "none"; return; } // yalnız girişli sunucu
  if (localStorage.getItem("goc:tamam:" + aktif.ad)) { alan.style.display = "none"; return; } // daha önce karar verildi
  const { ekarne, program } = gocEskiVeri(); // eski ortak kayıt
  const dSayi = (ekarne && ekarne.denemeler) ? ekarne.denemeler.length : 0;
  const hSayi = (program && program.hucre) ? Object.keys(program.hucre).length : 0;
  if (!dSayi && !hSayi) { alan.style.display = "none"; return; } // taşınacak yok
  alan.style.display = "block";
  alan.innerHTML = ""; // güvenli kur
  const t = document.createElement("b"); t.textContent = `Eski ortak kayıt bulundu: ${dSayi} deneme, ${hSayi} hücre. Hesabına aktarmak ister misin? (Kaynak silinmez!)`; alan.appendChild(t);
  const a = document.createElement("button"); a.textContent = "Hesabıma Aktar";
  a.onclick = async () => { // toplu yükle (tekrarda çift kayıt yok)
    try {
      let eklenen = 0, atlanan = 0;
      if (dSayi) { const r = await api.denemeIceAktar(ekarne.denemeler.map(d => ({ tarih: d.tarih, tur: d.tur || "Ders Denemesi", yayin: d.yayin || "", ders: d.ders || "Genel", soru: d.soru, dogru: d.dogru, yanlis: d.yanlis, kural: d.kural || "4y1d" }))); eklenen = r.eklenen; atlanan = r.atlanan; }
      if (hSayi) { const cur = await api.programGet(); if (!cur) await api.programPut({ sinif: program.sinif || "", hucre: program.hucre || {}, ozelDersler: program.ozelDersler || [] }); } // sunucu boşsa programı yaz
      localStorage.setItem("goc:tamam:" + aktif.ad, "1"); // bir daha sorma
      await yukleEkarne(); await yukleProgram(); ekarneCiz(); programCiz();
      toast(`${eklenen} deneme aktarıldı, ${atlanan} atlandı. Kaynak duruyor!`);
    } catch (e) { toast("Aktarılamadı: " + e.message); } // BAŞARISIZSA BAŞARI DEME!
  };
  const s = document.createElement("button"); s.className = "ikincil"; s.textContent = "Eski Kayıtları Sil";
  s.onclick = () => { localStorage.removeItem("ekarne"); localStorage.removeItem("program"); localStorage.setItem("goc:tamam:" + aktif.ad, "1"); gocKontrol(); toast("Eski kayıtlar silindi."); }; // açık seçimle sil
  const k = document.createElement("button"); k.className = "ikincil"; k.textContent = "Kapat";
  k.onclick = () => { alan.style.display = "none"; }; // sonra hatırlatma yok (bayrak konmadı, sayfa değişince yine çıkar)
  alan.appendChild(a); alan.appendChild(s); alan.appendChild(k);
}
// --- Dışa aktar / içe aktar (JSON dosya) ---
document.getElementById("btnEkarneDis").onclick = async () => { // indir
  if (MOD === "sunucu" && aktif) await yukleEkarne(); // tazesini al
  if (MOD === "sunucu" && aktif) { try { const p = await api.programGet(); if (p) yaz("prog:" + hesapEtiket(), p); } catch { /* önbellek */ } }
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, program: programVeri(), denemeler: ekarneVeri().denemeler }, null, 2)], { type: "application/json" }); // sürümlü yedek
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ekarne-yedek.json"; a.click(); // indir
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); // temizle
  toast("Yedek indirildi.");
};
document.getElementById("btnEkarneIc").onclick = async () => { // dosyadan yükle (doğrulamalı)
  const f = document.getElementById("dosyaEkarne").files[0]; // seçili dosya
  if (!f) return toast("Önce dosya seç!");
  if (f.size > 2 * 1024 * 1024) return toast("Dosya çok büyük (2MB üstü)!"); // boyut sınırı (önce oku!)
  let j; // ayrıştır
  try { j = JSON.parse(await f.text()); } catch { return toast("Dosya bozuk (JSON değil)!"); }
  if (!j || typeof j !== "object" || !Array.isArray(j.denemeler)) return toast("Dosya E-Karne yedeği değil!"); // biçim kontrolü
  if ((j.schemaVersion ?? 1) !== 1) return toast("Bilinmeyen yedek sürümü! (beklenen: 1)"); // sürümsüz/yabancı red
  if (j.denemeler.length > 500) return toast("Çok fazla kayıt (500 üstü)!"); // kayıt sınırı
  for (const [i, d] of j.denemeler.entries()) { // her kaydı denetle
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.tarih || "") || !Number.isInteger(d.soru) || d.soru < 1 || !Number.isInteger(d.dogru) || d.dogru < 0 || !Number.isInteger(d.yanlis) || d.yanlis < 0 || d.dogru + d.yanlis > d.soru || !["4y1d", "3y1d", "yok"].includes(d.kural || "4y1d")) return toast(`Kayıt ${i + 1} bozuk, içe aktarılmadı!`); // bozuksa dur
  }
  if (MOD === "sunucu" && aktif) { // sunucuya yaz (doğrulamalı uçlar)
    try {
      const mevcut = await api.denemeListe(); // önizleme için şimdikiler
      const anahtar = d => [d.tarih, d.yayin, d.ders, d.soru, d.dogru, d.yanlis, d.kural || "4y1d"].join("|"); // tekrar tanımı (kural dahil!)
      const varSet = new Set(mevcut.map(anahtar)); // sunucudakiler
      const yeni = j.denemeler.filter(d => !varSet.has(anahtar(d))); // eklenecekler
      if (!confirm(`${yeni.length} eklenecek, ${j.denemeler.length - yeni.length} atlanacak (zaten var). Devam?`)) return; // ÖNİZLEME + onay (kısmi sonuç gizlenmez!)
      const r = await api.denemeIceAktar(j.denemeler.map(d => ({ tarih: d.tarih, tur: d.tur || "Ders Denemesi", yayin: d.yayin || "", ders: d.ders || "Genel", soru: d.soru, dogru: d.dogru, yanlis: d.yanlis, kural: d.kural || "4y1d" })));
      if (j.program && confirm("Program da üzerine yazılsın mı? (mevcut program değişir!)")) await api.programPut({ data: { sinif: j.program.sinif || "", hucre: j.program.hucre || {}, ozelDersler: j.program.ozelDersler || [] } }); // açık onayla
      await yukleEkarne(); await yukleProgram(); ekarneCiz(); programCiz();
      return toast(`${r.eklenen} eklendi, ${r.atlanan} atlandı.`);
    } catch (e) { return toast("Aktarılamadı: " + e.message); }
  }
  const v = ekarneVeri(); // yerel yedek
  let ek = 0, at = 0;
  for (const d of j.denemeler) {
    const a1 = [d.tarih, d.tur || "Ders Denemesi", d.yayin, d.ders, d.soru, d.dogru, d.yanlis, d.kural || "4y1d"].join("|"); // tekrar tanımı (tür+kural dahil, sunucuyla AYNI!)
    const var1 = v.denemeler.some(x => [x.tarih, x.tur || "Ders Denemesi", x.yayin, x.ders, x.soru, x.dogru, x.yanlis, x.kural || "4y1d"].join("|") === a1); // tıpatıp var mı
    if (!var1) { v.denemeler.unshift({ id: idUret(), ...d, kural: d.kural || "4y1d", bos: d.soru - d.dogru - d.yanlis, net: netKural(d.dogru, d.yanlis, d.kural || "4y1d") }); ek++; } else at++;
  }
  if (j.program && confirm("Program da üzerine yazılsın mı? (mevcut program değişir!)")) programKaydet({ sinif: j.program.sinif || "", hucre: j.program.hucre || {}, ozelDersler: j.program.ozelDersler || [] });
  ekarneKaydet(v); ekarneCiz(); programCiz(); toast(`${ek} eklendi, ${at} atlandı.`);
};
document.querySelectorAll("[data-yazdir]").forEach(b => b.onclick = () => { // alan yazdırma
  document.body.dataset.yazdir = b.dataset.yazdir; window.print();
  setTimeout(() => delete document.body.dataset.yazdir, 500); // temizle
});

// --- AI Asistan sohbeti (moderasyondan ayrı! deneme/mod dürüst rozetli) ---
let aktifSohbet = null; // açık sohbet id
// --- Sohbet akış durumu: AÇIK durumlar (tek kaynak; düğmeler yalnız buradan güncellenir) ---
const AKIS = { BOS: "bos", URETIM: "uretiliyor", TAMAM: "tamam", IPTAL: "iptal", HATALI: "hatali" }; // boş/üretiyor/bitti/iptal/hatalı
let sohbetDurum = AKIS.BOS; // ETKİN sohbetin durumu
let akisJeton = 0; // akış kuşağı: ARTINCA eski geri çağrılar ÖLÜR (eski akış yeni sohbete dokunamaz)
let akisKolu = null; // etkin akışın durdurma kolu
let akisBalon = null; // akan cevap balonu (iptal/hata mesajı için)
const sohbetDeneme = {}; // sohbetId -> { soru, uretim } : TEKRAR yalnız KENDİ sohbetine/üretimine bağlı
function akisCiz(durum) { // durumu ekrana YAZ: her bitiş yolu aynı kapıdan geçer (tutarlı düğmeler)
  sohbetDurum = durum;
  const uretimde = durum === AKIS.URETIM;
  btnSohbetGonder.disabled = uretimde; // üretimde ikinci gönderim YOK (Enter + tıklama dahil)
  btnSohbetDurdur.style.display = uretimde ? "" : "none";
  btnSohbetTekrar.style.display = (durum === AKIS.HATALI || durum === AKIS.IPTAL) ? "" : "none"; // hata ve İPTALDE tekrar (tutarlı)
}
function akisiKapat() { // akışı güvenle bırak: sohbet değişince/oluşturunca/silince eski geri çağrılar ölü
  akisJeton++;
  if (akisKolu) { try { akisKolu(); } catch { /* geç */ } akisKolu = null; }
  akisBalon = null;
}
function asistanSar() { if (sohbetMesaj) sohbetMesaj.scrollTop = sohbetMesaj.scrollHeight; } // en alta kaydır
async function yanitiYenile(balon) { // "bitti ama metin YOK" (tamamlanmış üretim TEKRARI): yanıtı kayıttan GETİR
  const ok = await sohbetOku(); // sunucudaki KAYITLI cevabı çiz ("Yazıyor..." burada silinir)
  if (ok === "degisti") return; // bu arada sohbet değişti: yeni sohbete ESKİ yanıt çizilmez
  if (!ok) { if (balon && balon.isConnected) balon.textContent = "Yanıt getirilemedi (bağlantı). Tekrar Dene'ye bas."; return; } // net hata
  const simdi = sohbetMesaj.querySelectorAll(".balon.o");
  const son = simdi[simdi.length - 1];
  if (!son || !(son.textContent || "").trim()) { // kayıt yoksa da "Yazıyor..." asla kalmaz
    const b = document.createElement("div"); b.className = "balon o"; b.textContent = "Yanıt kaydı bulunamadı. Tekrar Dene'ye bas.";
    sohbetMesaj.appendChild(b);
  }
  asistanSar();
}
akisCiz(AKIS.BOS); // açılışta düğmeleri güvenli hale getir
function mdGuvenli(m) { // güvenli mini-markdown: ÖNCE kaçır, sonra biçimlendir (ham HTML çalışmaz!)
  let t = htmlKacis(m); // tüm etiketler etkisiz
  const kodlar = []; // kod bloklarını sakla
  t = t.replace(/```([\s\S]*?)```/g, (e, k) => { kodlar.push(k); return `\u0000${kodlar.length - 1}\u0000`; }); // önce bloklar
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>"); // satır içi kod
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"); // kalın
  t = t.replace(/(^|\n)\*([^*\n]+)/g, "$1•$2"); // yıldız madde (basit)
  t = t.replace(/\u0000(\d+)\u0000/g, (e, i) => `<pre>${kodlar[+i]}</pre>`); // blokları geri koy (kaçışlı!)
  return t.replace(/\n/g, "<br>"); // satırlar
}
async function sohbetListele() { // sohbetlerim
  const alan = sohbetListe; alan.innerHTML = "<div class='iskelet'></div>";
  if (MOD !== "sunucu" || !aktif) { alan.innerHTML = "<small>Sohbet için giriş yap (sunucu gerekli).</small>"; return; }
  try {
    const liste = await api.sohbetListe(); // kendiminkiler
    alan.innerHTML = "";
    if (!liste.length) alan.innerHTML = "<small>Henüz sohbet yok. + Yeni Sohbet de!</small>";
    liste.forEach(s => {
      const div = document.createElement("div"); div.className = "cevap";
      const b = document.createElement("b"); b.textContent = s.baslik; b.style.cursor = "pointer";
      b.onclick = () => { // aç: başka sohbete geçince ESKİ akış kesilir + düğmeler sıfırlanır (eski geri çağrı yeni sohbete dokunamaz)
        if (String(s.id) === String(aktifSohbet)) return; // zaten açık: akan akışı ve çizimi BOZMA
        akisiKapat(); akisCiz(AKIS.BOS);
        aktifSohbet = s.id; sohbetBaslik.textContent = s.baslik; sohbetOku();
      }; // aç
      const sil = document.createElement("button"); sil.className = "ikincil"; sil.textContent = "Sil"; sil.style.minHeight = "32px";
      sil.onclick = async () => {
        try {
          await api.sohbetSil(s.id);
          delete sohbetDeneme[String(s.id)]; // silinen sohbetin tekrar bilgisi de gider
          if (String(aktifSohbet) === String(s.id)) { akisiKapat(); akisCiz(AKIS.BOS); aktifSohbet = null; sohbetBaslik.textContent = "Sohbet seç"; sohbetMesaj.innerHTML = ""; }
          sohbetListele();
        } catch (e) { toast(e.message); }
      };
      const ad = document.createElement("button"); ad.className = "ikincil"; ad.textContent = "Adlandır"; ad.style.minHeight = "32px";
      ad.onclick = () => { // yerinde yeniden adlandır
        const inp = document.createElement("input"); inp.value = s.baslik; inp.maxLength = 60;
        const ok = document.createElement("button"); ok.textContent = "OK";
        ok.onclick = async () => { try { await api.sohbetAdlandir(s.id, inp.value); sohbetListele(); } catch (e) { toast(e.message); } };
        div.innerHTML = ""; div.append(inp, ok); inp.focus();
      };
      div.append(b, document.createElement("br"), ad, sil); alan.appendChild(div);
    });
  } catch { alan.innerHTML = "Bağlantı kesildi."; }
}
async function sohbetOku() { // geçmişi diz; true=çizildi, false=hata, "degisti"=sohbet değişti (çizme!)
  const id = aktifSohbet; // İSTEM BAŞINDA hangi sohbet
  if (!id) return false;
  try {
    const msj = await api.sohbetMesajlar(id); // geçmiş
    if (aktifSohbet !== id) return "degisti"; // bu arada sohbet DEĞİŞTİ: eski yanıt yeni sohbete çizilmez
    sohbetMesaj.innerHTML = "";
    msj.forEach(m => {
      const d = document.createElement("div"); d.className = "balon " + (m.rol === "user" ? "ben" : "o");
      if (m.rol === "user") d.textContent = m.metin; // düz metin
      else d.innerHTML = mdGuvenli(m.metin); // güvenli biçim
      sohbetMesaj.appendChild(d);
    });
    asistanSar(); // en alta
    return true;
  } catch (e) { if (aktifSohbet === id) toast(e.message); return false; }
}
function sohbetGonder(devam = false) { // gönder (devam: aynı soru + AYNI üretim kimliği — çift kayıt yok!)
  if (!aktifSohbet) return toast("Önce + Yeni Sohbet de!");
  if (sohbetDurum === AKIS.URETIM) return; // üretim sürüyor: Enter + tıklama dahil ÇİFT GÖNDERİM YOK
  const kim = String(aktifSohbet); // İŞLEM BAŞINDA hangi sohbette olduğumuz (sohbet kimliği bağlayıcı)
  const bilgi = sohbetDeneme[kim]; // bu sohbetin kendi soru/üretim bilgisi
  const metin = devam ? (bilgi && bilgi.soru) : sohbetGirdi.value.trim(); // metin
  if (!metin) return devam ? toast("Tekrar edilecek soru yok.") : undefined; // boş gönderim yok
  if (!devam) sohbetDeneme[kim] = { soru: metin, uretim: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }; // YENİ soruya YENİ kimlik
  const uretim = sohbetDeneme[kim].uretim; // tekrar AYNI kimlik kullanır (sunucu ikinci kez üretmez)
  akisiKapat(); // önceki akışı kapat: eski geri çağrı kalmasın
  const jeton = akisJeton; // bu akışın kuşağı: sohbet değişince İŞLENMEZ
  akisCiz(AKIS.URETIM); // durum: üretiyor
  if (!devam) { // yeni soru balonu (devamda tekrar ekleme!)
    const b = document.createElement("div"); b.className = "balon ben"; b.textContent = metin;
    sohbetMesaj.appendChild(b); sohbetGirdi.value = "";
  }
  const asistan = document.createElement("div"); asistan.className = "balon o"; asistan.textContent = "Yazıyor..."; // akan balon
  sohbetMesaj.appendChild(asistan); akisBalon = asistan; asistanSar();
  let tam = ""; // biriken cevap
  const bitir = () => { if (jeton !== akisJeton) return false; akisKolu = null; akisBalon = null; return true; }; // etkinse kolu bırak
  akisKolu = sohbetAkis(kim, metin, devam, uretim, o => {
    if (jeton !== akisJeton) return; // ESKİ akış: YENİ seçili sohbeti DEĞİŞTİRMEZ (stale geri çağrı)
    if (o.parca) { tam += o.parca; asistan.innerHTML = mdGuvenli(tam); asistanSar(); return; } // akıt
    if (o.bitti) { // bitti (mock rozetiyle)
      if (!tam.trim()) { // SUNUCU YALNIZCA "bitti" DEDİ (tamamlanmış üretim tekrarı): yanıt KAYITTAN gelir
        bitir(); akisCiz(AKIS.TAMAM); yanitiYenile(asistan); sohbetListele(); return; // "Yazıyor..." YOK
      }
      if (o.mock) { const r = document.createElement("small"); r.textContent = "(deneme modu: model yok)"; asistan.appendChild(document.createElement("br")); asistan.appendChild(r); }
      bitir(); akisCiz(AKIS.TAMAM); sohbetListele(); return; // liste tazele
    }
    if (o.hata || o.kod) { // hata/401/403/429/ağ: tekrar butonu (aynı soru + aynı üretim kimliği: çift kayıt yok!)
      bitir(); akisCiz(AKIS.HATALI);
      asistan.textContent = "Olmadı: " + (o.hata || "hata") + " Tekrar Dene'ye bas.";
      sohbetListele(); return;
    }
  });
}
btnSohbetYeni.onclick = async () => { // yeni sohbet aç
  if (MOD !== "sunucu" || !aktif) return toast("Önce giriş yap!");
  akisiKapat(); akisCiz(AKIS.BOS); // eski sohbetin akışı kesilir, düğmeler sıfırlanır
  try { const s = await api.sohbetAc("Sohbet", "Genel"); aktifSohbet = s.id; sohbetBaslik.textContent = s.baslik; sohbetMesaj.innerHTML = ""; sohbetListele(); }
  catch (e) { toast(e.message); }
};
btnSohbetGonder.onclick = () => sohbetGonder(false); // gönder (Enter ile aynı kapı → çift gönderim yok)
btnSohbetTekrar.onclick = () => sohbetGonder(true); // aynı soru + AYNI üretim kimliğiyle tekrar (durumu akisCiz yazar)
btnSohbetDurdur.onclick = () => { // durdur: akışı bırak + durumu İPTAL (tekrar butonu hata ile aynı şekilde açılır)
  if (sohbetDurum !== AKIS.URETIM) return; // üretmiyorsa durduracak bir şey yok
  if (akisKolu) { try { akisKolu(); } catch { /* geç */ } akisKolu = null; } // yanıt gelmeyeceğini GARANTİ ile kes
  if (akisBalon) { const m = (akisBalon.textContent || "").replace(/\s*\(durduruldu\)\s*$/, ""); akisBalon.textContent = m + " (durduruldu)"; }
  akisBalon = null;
  akisCiz(AKIS.IPTAL); // iptal: düğmeler tutarlı (üretim sürerkenki gibi değil)
};
sohbetGirdi.onkeydown = e => { // Enter gönderir, Shift+Enter göndermez (çift gönderim yok; girdi tek satırlık input)
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  e.preventDefault(); // olası çift tetiklemeyi de kes
  sohbetGonder(false);
};

// ==================== NOTLARIM (kişisel notlar) ====================
// Depo: girişli sunucu hesabı → backend (YALNIZ sahibi görür, gönderilerden AYRI); değilse bu cihaz (demo/misafir ayrı ve açıkça etiketli).
const NOT_RENKLER = [ // etiket renkleri: kimlik + Türkçe ad (renk YALNIZ renkle anlatılmaz, adı da yazılır)
  { id: "sari", ad: "Sarı" }, { id: "yesil", ad: "Yeşil" }, { id: "mavi", ad: "Mavi" },
  { id: "kirmizi", ad: "Kırmızı" }, { id: "mor", ad: "Mor" }, { id: "gri", ad: "Gri" }
];
const NOT_DERSLER = ["Matematik", "Fizik", "Kimya", "Biyoloji", "Türkçe", "Tarih", "İngilizce", "Coğrafya", "Diğer"]; // akış filtresiyle aynı dersler
const AY_ADLARI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const GUN_KISA = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"]; // takvim pazartesi başlar
let notlar = [];              // bellekteki not listesi (kendi notlarım)
let notYuklendi = false;      // ilk yükleme bitti mi (iskelet/hata ayrımı için)
let notHataVar = false;       // son yükleme hata verdi mi
let notDuzenId = null;        // düzenlenen not kimliği (null = yeni)
let notDegisti = false;       // kaydedilmemiş değişiklik var mı (veri kaybı koruması)
let notKaydediliyor = false;  // kayıt sürüyor mu (çift tık/çift gönderim koruması)
let takvimYil = 0, takvimAy = 0, takvimSecili = null; // takvim durumu (ay 0-11); seçili başta YOK (yalnız bugün işaretli)
let panelDuzenModu = false;   // panel düzenleme kipi
let saatSayac = null;         // TEK saat zamanlayıcısı (sayfa değişince yeniden kurulmaz, çoğalmaz)

// --- Depolama yardımcıları (notlar/panel: hesap + sunucu ortamı başına AYRI kapsam) ---
function notKapsam() { // yerel/demo deposu kimliği (hesap/ortam karışmaz; sunucu notları zaten sunucuda tutulur)
  const kim = aktif ? ("k:" + aktif.ad) : (localStorage.getItem("demoModu") === "acik" ? "demo" : "misafir");
  return ONBELLEK_SURUM + "|" + apiOrtami() + "|" + kim;
}
function notlarAnahtar() { return "notlar:" + notKapsam(); } // notların yerel anahtarı
function panelAnahtar() { return "panel:" + notKapsam(); } // panel düzeni anahtarı (hesap+ortam başına)
function depoOku(anahtar, varsayilan) { try { const s = localStorage.getItem(anahtar); return s == null ? varsayilan : JSON.parse(s); } catch { return varsayilan; } }
function depoYaz(anahtar, deger) { try { localStorage.setItem(anahtar, JSON.stringify(deger)); } catch { /* depo dolu olabilir */ } }
function sunucuNotuMu() { return MOD === "sunucu" && !!aktif; } // girişli sunucu hesabı mı (backend kullanılır)
function notNorm(n) { // alanları güvene al (eksik/bozuk veri arayüzü bozmasın)
  return {
    id: (n && n.id != null) ? n.id : idUret(),
    baslik: String((n && n.baslik) || ""),
    icerik: String((n && n.icerik) || ""),
    ders: String((n && n.ders) || ""),
    tarih: ((n && n.tarih) && /^\d{4}-\d{2}-\d{2}$/.test(String(n.tarih))) ? String(n.tarih) : "",
    renk: (n && NOT_RENKLER.some(r => r.id === n.renk)) ? n.renk : "sari",
    sabit: !!(n && n.sabit),
    olusturma: String((n && n.olusturma) || ""),
    guncelleme: String((n && n.guncelleme) || "")
  };
}
function notSirala(liste) { // sabitli önce; sonra en son güncellenen; eşitse id (yeni üstte)
  return [...liste].sort((a, b) => (Number(b.sabit) - Number(a.sabit)) || String(b.guncelleme || "").localeCompare(String(a.guncelleme || "")) || String(b.id).localeCompare(String(a.id)));
}
function notDepoTemizle() { // demo/misafir not + panel anahtarlarını sil (sıfırla düğmesi)
  try {
    const silinecek = [];
    for (let i = 0; i < localStorage.length; i++) {
      const anahtar = localStorage.key(i) || "";
      if ((anahtar.indexOf("notlar:") === 0 || anahtar.indexOf("panel:") === 0) && (anahtar.indexOf("|demo") >= 0 || anahtar.indexOf("|misafir") >= 0)) silinecek.push(anahtar);
    }
    silinecek.forEach(anahtar => localStorage.removeItem(anahtar));
  } catch { /* geç */ }
}
function notZamanYaz(deger) { // "YYYY-AA-GG SS:DD:SS" veya ISO → "17 Eki 2026 14:05"
  if (!deger) return "";
  const d = new Date(String(deger).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(deger);
  try { return d.toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }); } catch { return String(deger); }
}

// --- Notları yükle / çiz ---
async function notlariYukle() { // notları getir (sunucu: API; değilse cihaz) ve çiz
  notHataVar = false;
  if (sunucuNotuMu()) { // girişli sunucu hesabı: YALNIZ kendi notlarım
    notYuklendi = false; notListeCiz(); notKartCiz(); // iskelet göster
    try {
      const liste = await api.notlar();
      notlar = (Array.isArray(liste) ? liste : []).map(notNorm);
      notYuklendi = true;
    } catch (e) {
      notHataVar = true; notYuklendi = true; // HATA: demoya DÜŞMEZ; yazılan metin korunur
      if (!e.islendi) toast((e && e.message) || "Notlar yüklenemedi.");
    }
  } else { // yerel/demo/misafir: cihazdan oku
    notlar = (depoOku(notlarAnahtar(), []) || []).map(notNorm).filter(n => n.baslik);
    notYuklendi = true;
  }
  notListeCiz(); takvimCiz(); notKartCiz(); notDepoYaz();
}
function notDepoYaz() { // depo şeffaflığı: notların nerede tutulduğunu dürüstçe yaz
  const el = document.getElementById("notDepo"); if (!el) return;
  if (sunucuNotuMu()) el.textContent = "🔒 Notların hesabına bağlı (sunucuda) ve yalnızca sen görürsün. Paylaşımlarından ayrıdır.";
  else if (aktif) el.textContent = "💾 Bu cihazda, " + aktif.ad + " hesabına ayrı kaydedilir (sunucu bağlı değil).";
  else if (localStorage.getItem("demoModu") === "acik") el.textContent = "🧪 Demo modu: notlar bu cihazda, demo verisinden ayrı tutulur.";
  else el.textContent = "💾 Misafir: notlar bu cihazda tutulur. Sunucuya giriş yaparsan notlar hesabına geçer.";
}
function notFiltre() {
  return {
    ara: (document.getElementById("notAra").value || "").toLocaleLowerCase("tr").trim(),
    ders: document.getElementById("notFiltreDers").value || "",
    tarih: document.getElementById("notFiltreTarih").value || ""
  };
}
function notSurekli() { // filtreyi uygula + sırala
  const f = notFiltre();
  return notSirala(notlar.filter(n => {
    if (f.ders && n.ders !== f.ders) return false;
    if (f.tarih && n.tarih !== f.tarih) return false;
    if (f.ara && (n.baslik + "\n" + n.icerik + "\n" + n.ders).toLocaleLowerCase("tr").indexOf(f.ara) < 0) return false;
    return true;
  }));
}
function notKartiHtml(n) { // güvenli (htmlKacis) liste kartı
  const renk = NOT_RENKLER.find(r => r.id === n.renk) || NOT_RENKLER[0];
  const dersTxt = n.ders ? `<span class="ders-etiket ders-${htmlKacis(n.ders)}">#${htmlKacis(n.ders)}</span>` : "";
  const tarihTxt = n.tarih ? `<span>📅 ${htmlKacis(n.tarih)}</span>` : "";
  const zamanTxt = n.guncelleme ? `<span class="ipucu">• ${htmlKacis(notZamanYaz(n.guncelleme))}</span>` : "";
  const onizleme = n.icerik ? (htmlKacis(n.icerik.slice(0, 180)) + (n.icerik.length > 180 ? "…" : "")) : "";
  return `<div class="notKart renk-${renk.id}" data-not-id="${htmlKacis(String(n.id))}">
    <div class="notKartUst"><b class="notBaslik">${n.sabit ? "📌 " : ""}${htmlKacis(n.baslik || "(başlıksız)")}</b><span class="notRenkAd">Etiket: ${htmlKacis(renk.ad)}</span></div>
    ${onizleme ? `<div class="notOnizleme">${onizleme}</div>` : ""}
    <div class="notMeta">${dersTxt}${tarihTxt}${zamanTxt}</div>
    <div class="notDugmeler2">
      <button type="button" class="ikincil" data-not-ac>Düzenle</button>
      <button type="button" class="ikincil" data-not-sabitle>${n.sabit ? "Sabitlemeyi kaldır" : "📌 Sabitle"}</button>
      <button type="button" class="tehlike" data-not-sil>Sil</button>
    </div>
  </div>`;
}
function notListeCiz() { // notlarım sayfası listesi (boş/hata/filtre durumlarıyla)
  const kap = document.getElementById("notListe"); if (!kap) return;
  if (!notYuklendi) { kap.innerHTML = '<div class="iskelet" style="height:72px"></div><div class="iskelet" style="height:72px;margin-top:8px"></div>'; return; }
  if (notHataVar && sunucuNotuMu()) { // bağlantı hatası: dürüst hata + tekrar dene (demoya sessizce düşmez)
    kap.innerHTML = '<div class="notHata" role="alert">⚠️ Notlar yüklenemedi. Yazdığın metin kaybolmadı; bağlantını kontrol edip tekrar dene.<div style="margin-top:8px"><button type="button" id="btnNotTekrar" class="ikincil">Tekrar dene</button></div></div>';
    const bt = document.getElementById("btnNotTekrar"); if (bt) bt.onclick = () => notlariYukle();
    return;
  }
  const liste = notSurekli();
  const f = notFiltre();
  const ozet = document.getElementById("notFiltreOzeti");
  if (ozet) ozet.textContent = notlar.length ? (liste.length + " / " + notlar.length + " not" + ((f.ara || f.ders || f.tarih) ? " (filtreli)" : "")) : "";
  if (!notlar.length) { // boş durum: yönlendirici
    kap.innerHTML = '<div class="bosDurum"><div class="buyuk">📝</div><p>Henüz notun yok. Ders çalışırken aklında kalanları buraya yaz!</p><button type="button" id="btnNotIlk">+ Yeni Not</button></div>';
    const bt = document.getElementById("btnNotIlk"); if (bt) bt.onclick = () => notDuzenleAc(null);
    return;
  }
  if (!liste.length) { // filtre boş
    kap.innerHTML = '<div class="bosDurum"><p>Bu filtreye uyan not yok.</p><button type="button" id="btnNotFiltreBos" class="ikincil">Filtreleri temizle</button></div>';
    const bt = document.getElementById("btnNotFiltreBos"); if (bt) bt.onclick = notFiltreTemizle;
    return;
  }
  kap.innerHTML = liste.map(notKartiHtml).join("");
  kap.querySelectorAll(".notKart").forEach(oge => {
    const id = oge.dataset.notId;
    const acBtn = oge.querySelector("[data-not-ac]"); if (acBtn) acBtn.onclick = () => notDuzenleAc(id);
    const sabBtn = oge.querySelector("[data-not-sabitle]"); if (sabBtn) sabBtn.onclick = () => notSabitleDegistir(id);
    const silBtn = oge.querySelector("[data-not-sil]"); if (silBtn) silBtn.onclick = () => notSil(id);
  });
}
function notFiltreTemizle() {
  document.getElementById("notAra").value = "";
  document.getElementById("notFiltreDers").value = "";
  document.getElementById("notFiltreTarih").value = "";
  notListeCiz();
}

// --- Not düzenleyici (açık KAYDET; otomatik değil) ---
function notDuzenAcikMi() { const e = document.getElementById("notDuzenleyici"); return !!e && e.style.display !== "none"; }
function notKirliVar() { return notDegisti; }
function notKirliTemizle() { notDegisti = false; }
function notDurumYaz(metin, tur) { const el = document.getElementById("notDurum"); if (el) { el.textContent = metin; el.className = "notDurum " + (tur || ""); } }
function notRenkSec(id) { document.querySelectorAll("#sayfaNotlar .renkBtn").forEach(b => b.setAttribute("aria-pressed", b.dataset.renk === id ? "true" : "false")); }
function notSeciliRenk() { const b = document.querySelector('#sayfaNotlar .renkBtn[aria-pressed="true"]'); return b ? b.dataset.renk : "sari"; }
function notDuzenleAc(id) {
  if (notDuzenAcikMi() && notDegisti && String(notDuzenId) !== String(id) && !confirm("Kaydedilmemiş değişiklik var. Yine de başka nota geçmek istiyor musun?")) return; // veri kaybı koruması
  const n = (id != null) ? notlar.find(x => String(x.id) === String(id)) : null;
  notDuzenId = n ? n.id : null;
  document.getElementById("notDuzenBaslik").textContent = n ? "Notu düzenle" : "Yeni not";
  document.getElementById("notBaslik").value = n ? n.baslik : "";
  document.getElementById("notIcerik").value = n ? n.icerik : "";
  document.getElementById("notDersSec").value = n ? n.ders : "";
  document.getElementById("notTarihSec").value = n ? n.tarih : (takvimSecili || "");
  notRenkSec(n ? n.renk : "sari");
  document.getElementById("notSabit").checked = n ? n.sabit : false;
  document.getElementById("btnNotSil").style.display = n ? "" : "none";
  notDurumYaz("", "");
  document.getElementById("notDuzenleyici").style.display = "block";
  notDegisti = false; // yeni açılış temiz
  const bas = document.getElementById("notBaslik"); bas.focus(); document.getElementById("notDuzenleyici").scrollIntoView({ block: "nearest" });
}
function notDuzenleKapat(zorla) {
  if (!notDuzenAcikMi()) return;
  if (notDegisti && !zorla && !confirm("Kaydedilmemiş değişiklik var. Kapatırsan kaybolur. Emin misin?")) return;
  document.getElementById("notDuzenleyici").style.display = "none";
  notDuzenId = null; notDegisti = false; notDurumYaz("", "");
}
function notYerineKoy(n) { const i = notlar.findIndex(x => String(x.id) === String(n.id)); if (i >= 0) notlar[i] = n; else notlar.push(n); }
async function notKaydet() { // açık kaydet (çift tık korumalı; hata olursa metin korunur)
  if (notKaydediliyor) return;
  const baslik = document.getElementById("notBaslik").value.trim();
  if (!baslik) { notDurumYaz("Başlık yazmalısın!", "hata"); document.getElementById("notBaslik").focus(); return; }
  const veri = {
    baslik: baslik.slice(0, 80),
    icerik: document.getElementById("notIcerik").value.slice(0, 5000),
    ders: document.getElementById("notDersSec").value,
    tarih: document.getElementById("notTarihSec").value || "",
    renk: notSeciliRenk(),
    sabit: document.getElementById("notSabit").checked
  };
  notKaydediliyor = true;
  const btn = document.getElementById("btnNotKaydet"); btn.disabled = true; // çift tık kapalı
  notDurumYaz("Kaydediliyor…", "bekliyor");
  let kaydedilen = null;
  try {
    if (sunucuNotuMu()) { // sunucu: gerçek kalıcı kayıt
      if (notDuzenId != null) kaydedilen = notNorm(await apiCagir(() => api.notDuzenle(notDuzenId, veri)));
      else kaydedilen = notNorm(await apiCagir(() => api.notEkle(veri)));
      notYerineKoy(kaydedilen);
    } else { // yerel: cihaza yaz
      const simdi = new Date().toISOString();
      if (notDuzenId != null) {
        const eski = notlar.find(x => String(x.id) === String(notDuzenId)) || {};
        kaydedilen = notNorm({ ...eski, ...veri, id: notDuzenId, guncelleme: simdi });
        notYerineKoy(kaydedilen);
      } else {
        kaydedilen = notNorm({ ...veri, id: idUret(), olusturma: simdi, guncelleme: simdi });
        notlar.push(kaydedilen);
      }
      depoYaz(notlarAnahtar(), notlar);
    }
    notDegisti = false;
    notDurumYaz("Kaydedildi ✓", "tamam"); // YALNIZ kalıcı kayıt başarılıysa
    if (notDuzenId == null && kaydedilen) { notDuzenId = kaydedilen.id; document.getElementById("notDuzenBaslik").textContent = "Notu düzenle"; document.getElementById("btnNotSil").style.display = ""; }
    notListeCiz(); takvimCiz(); notKartCiz();
  } catch (e) {
    notDurumYaz("Kaydedilemedi: " + ((e && e.message) || "bağlantı hatası") + " — metnin duruyor, tekrar dene.", "hata"); // metin KORUNUR
  } finally { notKaydediliyor = false; btn.disabled = false; }
}
async function notSil(id) {
  const n = notlar.find(x => String(x.id) === String(id)); if (!n) return;
  if (!confirm('"' + n.baslik + '" notu silinsin mi? Bu işlem geri alınamaz.')) return;
  try {
    if (sunucuNotuMu()) await apiCagir(() => api.notSil(id)); // yalnız sahibi silebilir (sunucu doğrular)
    notlar = notlar.filter(x => String(x.id) !== String(id));
    if (!sunucuNotuMu()) depoYaz(notlarAnahtar(), notlar);
    if (String(notDuzenId) === String(id)) notDuzenleKapat(true); // silinen açıksa kapat
    toast("Not silindi.");
    notListeCiz(); takvimCiz(); notKartCiz();
  } catch (e) { if (!e.islendi) toast("Silinemedi: " + ((e && e.message) || "bağlantı hatası")); }
}
async function notSabitleDegistir(id) { // sabitle/çöz
  const n = notlar.find(x => String(x.id) === String(id)); if (!n) return;
  try {
    if (sunucuNotuMu()) {
      const veri = { baslik: n.baslik, icerik: n.icerik, ders: n.ders, tarih: n.tarih, renk: n.renk, sabit: !n.sabit };
      notYerineKoy(notNorm(await apiCagir(() => api.notDuzenle(id, veri))));
    } else {
      n.sabit = !n.sabit; n.guncelleme = new Date().toISOString();
      depoYaz(notlarAnahtar(), notlar);
    }
    notListeCiz(); takvimCiz(); notKartCiz();
  } catch (e) { if (!e.islendi) toast("Güncellenemedi: " + ((e && e.message) || "bağlantı hatası")); }
}

// --- Saat (canlı 24 saat + Türkçe tarih; yalnız bu kart güncellenir) ---
function saatCiz() {
  const s = document.getElementById("saatDijital"); if (!s) return;
  try {
    const simdi = new Date();
    const metin = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(simdi);
    if (s.textContent !== metin) s.textContent = metin; // değişmediyse DOM'a dokunma (gereksiz çizim yok)
    const tarih = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(simdi);
    const t = document.getElementById("saatTarih"); if (t && t.textContent !== tarih) t.textContent = tarih;
  } catch { /* Intl yoksa sessizce geç */ }
}
function saatBaslat() { if (saatSayac) return; saatCiz(); saatSayac = setInterval(saatCiz, 1000); } // TEK sayaç (tekrar başlatılmaz)

// --- Mini takvim (pazartesi başlar; bugün/seçili ayrı; notlu gün işaretli) ---
function takvimBaslangic() { const p = bugunTR().split("-"); takvimYil = +p[0]; takvimAy = +p[1] - 1; }
function tarihUzunYaz(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" });
}
function takvimCiz() {
  const izgara = document.getElementById("takvimIzgara"); if (!izgara) return;
  const bugun = bugunTR();
  document.getElementById("takvimBaslik").textContent = AY_ADLARI[takvimAy] + " " + takvimYil;
  const ilkGun = (new Date(takvimYil, takvimAy, 1).getDay() + 6) % 7; // pazartesi=0
  const gunSayisi = new Date(takvimYil, takvimAy + 1, 0).getDate(); // ayın gün sayısı (artık yıl doğru)
  const notlu = {}; notlar.forEach(n => { if (n.tarih) notlu[n.tarih] = (notlu[n.tarih] || 0) + 1; });
  let html = GUN_KISA.map(g => `<span class="takvimGunAd" role="columnheader">${g}</span>`).join("");
  for (let i = 0; i < ilkGun; i++) html += '<span class="takvimBos" aria-hidden="true"></span>'; // ay öncesi boşluk
  for (let g = 1; g <= gunSayisi; g++) {
    const iso = takvimYil + "-" + String(takvimAy + 1).padStart(2, "0") + "-" + String(g).padStart(2, "0");
    const sinif = ["takvimGun"]; if (iso === bugun) sinif.push("bugun"); if (iso === takvimSecili) sinif.push("secili"); if (notlu[iso]) sinif.push("notlu");
    const etiket = tarihUzunYaz(iso) + (iso === bugun ? " (bugün)" : "") + (notlu[iso] ? ", " + notlu[iso] + " not" : "");
    html += `<button type="button" class="${sinif.join(" ")}" role="gridcell" data-tarih="${iso}" aria-label="${htmlKacis(etiket)}" aria-pressed="${iso === takvimSecili}"${iso === bugun ? ' aria-current="date"' : ""}>${g}</button>`; // rengi yetmez: aria ile de bildirilir
  }
  izgara.innerHTML = html;
  izgara.querySelectorAll("button[data-tarih]").forEach(b => { b.onclick = () => takvimSec(b.dataset.tarih); });
  const alt = document.getElementById("takvimSecili");
  if (alt) alt.textContent = takvimSecili ? ("Seçili: " + tarihUzunYaz(takvimSecili) + " • " + (notlu[takvimSecili] || 0) + " not") : "";
  const ekle = document.getElementById("btnTakvimNotEkle"); if (ekle) ekle.style.display = takvimSecili ? "" : "none";
}
function takvimSec(iso) { takvimSecili = (takvimSecili === iso) ? null : iso; takvimCiz(); notKartCiz(); } // aynı güne tekrar tıkla = seçimi kaldır
function takvimAyGit(fark) { let y = takvimYil, m = takvimAy + fark; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; takvimYil = y; takvimAy = m; takvimCiz(); }
function takvimBugun() { const p = bugunTR().split("-"); takvimYil = +p[0]; takvimAy = +p[1] - 1; takvimSecili = bugunTR(); takvimCiz(); notKartCiz(); }
function takvimTus(e) { // klavye oklarıyla gezinme
  const yon = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (yon[e.key] == null) return;
  const dugmeler = [...document.querySelectorAll("#takvimIzgara button[data-tarih]")];
  if (!dugmeler.length) return;
  let i = dugmeler.indexOf(document.activeElement); i = (i < 0) ? 0 : Math.max(0, Math.min(dugmeler.length - 1, i + yon[e.key]));
  e.preventDefault(); dugmeler[i].focus();
}

// --- Hızlı notlar kartı + notlarım sayfası açılışları ---
function notKartCiz() {
  const kap = document.getElementById("notKart"); if (!kap) return;
  if (!notYuklendi) { kap.innerHTML = '<div class="iskelet" style="height:36px"></div>'; return; }
  if (notHataVar && sunucuNotuMu()) { kap.innerHTML = '<small>⚠️ Notlar yüklenemedi (bağlantı). "Tüm notlarım"dan tekrar dene.</small>'; return; }
  if (takvimSecili) { // takvimde gün seçili: o günün notları + geri dönüş
    const gunun = notSirala(notlar.filter(n => n.tarih === takvimSecili));
    const bas = '<div class="notKartBaslik"><span class="ipucu">📅 ' + htmlKacis(takvimSecili) + '</span><button type="button" class="kucukBaglanti" id="btnNotKartGeri">Tüm notlara dön</button></div>';
    kap.innerHTML = bas + (gunun.length ? gunun.map(n => '<button type="button" class="notKartMini" data-not-ac="' + htmlKacis(String(n.id)) + '">' + (n.sabit ? "📌 " : "") + htmlKacis(n.baslik) + '</button>').join("") : '<small>Bu güne not yok. Aşağıdan "Bu güne not ekle" ile başla.</small>');
    const geri = document.getElementById("btnNotKartGeri"); if (geri) geri.onclick = () => { takvimSecili = null; takvimCiz(); notKartCiz(); };
    kap.querySelectorAll("[data-not-ac]").forEach(b => b.onclick = () => notSayfasiAc(b.dataset.notAc));
    return;
  }
  const liste = notSirala(notlar).slice(0, 3); // en fazla 3 sabitli/son not
  if (!liste.length) { kap.innerHTML = '<small>Henüz not yok. İlk notunu ekle!</small>'; return; }
  kap.innerHTML = liste.map(n => '<button type="button" class="notKartMini" data-not-ac="' + htmlKacis(String(n.id)) + '">' + (n.sabit ? "📌 " : "") + htmlKacis(n.baslik) + (n.tarih ? ' <span class="ipucu">' + htmlKacis(n.tarih) + '</span>' : "") + '</button>').join("");
  kap.querySelectorAll("[data-not-ac]").forEach(b => b.onclick = () => notSayfasiAc(b.dataset.notAc));
}
function notSayfasiAc(id) { // notu notlarım sayfasında aç/düzenle
  sayfaGoster("notlar");
  if (!genisEkran()) menuAcKapa(false);
  setTimeout(() => notDuzenleAc(id), 0);
}
function notSayfasiAcTum() { // tüm notlar (seçili günü bırak)
  takvimSecili = null; takvimCiz(); notKartCiz();
  sayfaGoster("notlar");
  if (!genisEkran()) menuAcKapa(false);
}

// --- Panel kişiselleştirme (göster/gizle + sırala; hesap+ortam başına saklanır) ---
const PANEL_VARSAYILAN = ["saat", "takvim", "notlar", "sorular", "lider", "hocalar", "dersler", "bugun"];
const PANEL_ADLAR = { saat: "Saat", takvim: "Takvim", notlar: "Notlarım", sorular: "Bugünün Soruları", lider: "Liderlik", hocalar: "Öğretmenler", dersler: "Dersler", bugun: "Bugün" };
function panelTercih() { // kayıtlı sıra+gizli; bozuk/eksikse varsayılana tamamla
  const t = depoOku(panelAnahtar(), null);
  if (!t || !Array.isArray(t.sira)) return { sira: PANEL_VARSAYILAN.slice(), gizli: [] };
  const sira = t.sira.filter(x => PANEL_VARSAYILAN.indexOf(x) >= 0);
  PANEL_VARSAYILAN.forEach(x => { if (sira.indexOf(x) < 0) sira.push(x); });
  const gizli = Array.isArray(t.gizli) ? t.gizli.filter(x => PANEL_VARSAYILAN.indexOf(x) >= 0) : [];
  return { sira: sira, gizli: gizli };
}
function panelUygula() { // kartları sırala + gizle/göster
  const kap = document.getElementById("panelKartlar"); if (!kap) return;
  const t = panelTercih();
  const harita = {};
  [...kap.querySelectorAll(":scope > .panelKutu")].forEach(oge => { harita[oge.dataset.kart] = oge; });
  t.sira.forEach(id => { if (harita[id]) kap.appendChild(harita[id]); }); // sıraya diz
  Object.keys(harita).forEach(id => {
    const oge = harita[id]; const gizli = t.gizli.indexOf(id) >= 0;
    oge.classList.toggle("panelGizli", gizli);
    oge.style.display = (!panelDuzenModu && gizli) ? "none" : ""; // düzen kipinde gizliler görünür (geri açılabilsin)
  });
}
function panelAraclariKur() { // düzen kipinde her kartta ↑ ↓ Gizle/Göster
  const kap = document.getElementById("panelKartlar"); if (!kap) return;
  [...kap.querySelectorAll(":scope > .panelKutu")].forEach(oge => {
    let arac = oge.querySelector(":scope > .kartArac");
    if (!panelDuzenModu) { if (arac) arac.remove(); return; }
    if (!arac) { arac = document.createElement("div"); arac.className = "kartArac"; oge.insertBefore(arac, oge.firstChild); }
    arac.innerHTML = "";
    const id = oge.dataset.kart; const ad = PANEL_ADLAR[id] || id;
    const mk = (yazi, aria, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "kartAracBtn"; b.textContent = yazi; b.setAttribute("aria-label", aria); b.onclick = fn; return b; };
    arac.appendChild(mk("↑", ad + " kartını yukarı taşı", () => panelTasi(id, -1)));
    arac.appendChild(mk("↓", ad + " kartını aşağı taşı", () => panelTasi(id, 1)));
    const gizliMi = panelTercih().gizli.indexOf(id) >= 0;
    arac.appendChild(mk(gizliMi ? "Göster" : "Gizle", ad + (gizliMi ? " kartını göster" : " kartını gizle"), () => panelGizle(id)));
  });
}
function panelDuzenAyarla(ac) {
  panelDuzenModu = ac;
  const btn = document.getElementById("btnPanelDuzen");
  if (btn) { btn.setAttribute("aria-pressed", ac ? "true" : "false"); btn.textContent = ac ? "✅ Düzenlemeyi bitir" : "⚙️ Paneli düzenle"; }
  const v = document.getElementById("btnPanelVarsayilan"); if (v) v.style.display = ac ? "" : "none";
  panelUygula(); panelAraclariKur();
}
function panelTasi(id, yon) {
  const t = panelTercih(); const i = t.sira.indexOf(id); const j = i + yon;
  if (i < 0 || j < 0 || j >= t.sira.length) return; // kenarda dur
  const gecici = t.sira[i]; t.sira[i] = t.sira[j]; t.sira[j] = gecici;
  depoYaz(panelAnahtar(), t); panelUygula(); panelAraclariKur();
}
function panelGizle(id) {
  const t = panelTercih(); const i = t.gizli.indexOf(id);
  if (i >= 0) t.gizli.splice(i, 1); else t.gizli.push(id);
  depoYaz(panelAnahtar(), t); panelUygula(); panelAraclariKur();
}
function panelVarsayilan() {
  if (!confirm("Panel düzeni varsayılana dönsün mü?")) return;
  depoYaz(panelAnahtar(), { sira: PANEL_VARSAYILAN.slice(), gizli: [] });
  panelUygula(); panelAraclariKur();
}
async function notlariSifirla() { // hesap değişince: belleği boşalt, panel düzenini yeni kapsama uygula, notları yeniden yükle
  notlar = []; notYuklendi = false; notHataVar = false; notDuzenId = null; notDegisti = false; takvimSecili = null;
  if (notDuzenAcikMi()) document.getElementById("notDuzenleyici").style.display = "none";
  panelDuzenAyarla(false); panelUygula();
  await notlariYukle();
}

// --- Olayları bağla (bir kez, açılışta) ---
function notAraclariKur() {
  const fDers = document.getElementById("notFiltreDers"), eDers = document.getElementById("notDersSec");
  NOT_DERSLER.forEach(d => { // ders seçenekleri (filtre + düzenleyici)
    if (fDers) { const o = document.createElement("option"); o.value = d; o.textContent = d; fDers.appendChild(o); }
    if (eDers) { const o = document.createElement("option"); o.value = d; o.textContent = d; eDers.appendChild(o); }
  });
  const renkKap = document.querySelector("#sayfaNotlar .notRenkSec");
  if (renkKap) { // renk düğmeleri (ad yazıyla görünür, yalnız renge güvenilmez)
    NOT_RENKLER.forEach(r => {
      const b = document.createElement("button"); b.type = "button"; b.className = "renkBtn"; b.dataset.renk = r.id; b.textContent = r.ad;
      b.setAttribute("aria-pressed", r.id === "sari" ? "true" : "false"); b.setAttribute("aria-label", "Etiket rengi: " + r.ad);
      b.onclick = () => notRenkSec(r.id);
      renkKap.appendChild(b);
    });
  }
  const bagla = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bagla("btnNotYeni", () => notDuzenleAc(null));
  bagla("btnNotKaydet", notKaydet);
  bagla("btnNotVazgec", () => notDuzenleKapat(false));
  bagla("btnNotSil", () => { if (notDuzenId != null) notSil(notDuzenId); });
  bagla("btnNotFiltreTemizle", notFiltreTemizle);
  bagla("btnPanelDuzen", () => panelDuzenAyarla(!panelDuzenModu));
  bagla("btnPanelVarsayilan", panelVarsayilan);
  bagla("btnNotKartYeni", () => notSayfasiAc(null));
  bagla("btnNotKartTumu", notSayfasiAcTum);
  bagla("btnTakvimOnceki", () => takvimAyGit(-1));
  bagla("btnTakvimSonraki", () => takvimAyGit(1));
  bagla("btnTakvimBugun", takvimBugun);
  bagla("btnTakvimNotEkle", () => notSayfasiAc(null)); // seçili tarih düzenleyiciye taşınır
  const araKutu = document.getElementById("notAra");
  if (araKutu) { let zaman = null; araKutu.oninput = () => { clearTimeout(zaman); zaman = setTimeout(notListeCiz, 150); }; } // gecikmeli arama
  ["notFiltreDers", "notFiltreTarih"].forEach(id => { const el = document.getElementById(id); if (el) el.onchange = notListeCiz; });
  ["notBaslik", "notIcerik", "notDersSec", "notTarihSec", "notSabit"].forEach(id => { // değişiklik = kaydedilmemiş işareti
    const el = document.getElementById(id); if (!el) return;
    const isaretle = () => { if (notDuzenAcikMi()) notDegisti = true; };
    el.addEventListener("input", isaretle); el.addEventListener("change", isaretle);
  });
  ["notBaslik", "notIcerik"].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener("keydown", e => { if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); notKaydet(); } }); }); // Ctrl+Enter kaydet
  const izgara = document.getElementById("takvimIzgara"); if (izgara) izgara.addEventListener("keydown", takvimTus); // takvim klavye gezinmesi
  window.addEventListener("beforeunload", e => { if (notDegisti) { e.preventDefault(); e.returnValue = ""; return ""; } }); // sayfadan çıkarken kayıp uyarısı
}

// --- Tuş kombinasyonları ---
async function sohbetModYaz() { // dürüst rozet: kural mı model mi
  try {
    const m = await api.aiDurum();
    sohbetMod.textContent = m.mod === "model" ? `🤖 Model bağlı (${m.model}). Yanıtlar modelden gelir.` : "📏 Deneme modu: gerçek model bağlı değil, cevaplar hazır şablondur. Sohbet ayrı, moderasyon ayrıdır.";
  } catch { sohbetMod.textContent = "Mod bilinmiyor (bağlantı yok)."; }
}

// --- Tuş kombinasyonları ---
document.addEventListener("keydown", e => {
  const yaziyor = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName); // kutuda mıyız
  if (e.key === "Escape") { // Esc: önce panel, sonra menü, sonra akış
    if (document.getElementById("sagPanel").classList.contains("acik")) { document.getElementById("sagPanel").classList.remove("acik"); return; } // panel açıksa kapat
    if (menuAcik) { menuAcKapa(false); return; } // menü açıksa sadece kapat
    document.activeElement?.blur(); // kutudan çık
    goruntulenen = null; filtreDers.value = ""; ara.value = ""; sayfaGoster("akis"); // akışa dön
    return;
  }
  if (e.ctrlKey && e.key === "Enter" && yaziyor) { // Ctrl+Enter: hangi formdaysan onu gönder
    const id = document.activeElement.id; // odaklı kutu
    if (["tur", "ders", "sinif", "baslik", "aciklama"].includes(id)) btnEkle.click(); // paylaşım formu
    else if (["hocaSec", "hDers", "hBaslik", "hocaSoru"].includes(id)) btnHocaSor.click(); // hoca formu
    else if (["girisAd", "girisSifre"].includes(id)) btnGiris.click(); // giriş formu
    else if (["kayitAd", "kayitSifre", "kayitBrans", "kayitSinif"].includes(id)) btnKayit.click(); // kayıt formu
    return;
  }
  if (yaziyor || e.ctrlKey || e.altKey || e.metaKey) return; // yazarken tek tuşlar çalışmasın
  const sayfaTus = { 1: "akis", 2: "kesfet", 3: "hoca", 4: "profil", 5: "kurallar", 6: "hesap", 7: "odalar", 8: "ayarlar" }; // sayı-sayfa eşleşmesi
  if (sayfaTus[e.key]) { goruntulenen = null; sayfaGoster(sayfaTus[e.key]); } // 1-6 sayfa aç
  else if (e.key === "/") { e.preventDefault(); goruntulenen = null; sayfaGoster("akis"); ara.focus(); } // arama kutusuna git
  else if (e.key === "n" || e.key === "N") { goruntulenen = null; sayfaGoster("akis"); window.scrollTo(0, 0); baslik.focus(); } // yeni gönderi
  else if (e.key === "d" || e.key === "D") btnKaranlik.click(); // karanlık mod aç/kapa
});

// --- Açılış: sunucu var mı bak, biletle otomatik gir ---
(async function basla() {
  try { // 3 sn bekle, cevap yoksa yerel devam
    const ctrl = new AbortController(); const sure = setTimeout(() => ctrl.abort(), 3000);
    const cevap = await fetch(API + "/api/saglik", { signal: ctrl.signal }); clearTimeout(sure);
    const govde = await cevap.json().catch(() => null); // JSON sözleşmesi
    if (!cevap.ok || !govde || govde.durum !== "tamam") throw new Error("bozuk"); // 500 de bağlı sayılmaz!
    SUNUCU = true; // sunucu yaşıyor
  } catch { SUNUCU = false; } // yoksa yerel mod
  if (SUNUCU && biletAl()) { // kayıtlı bilet varsa sessizce gir
    try {
      const ben = await apiCagir(() => api.ben()); // bilet geçerli mi (bozuksa oturum temizlenir!)
      const k = yerelAyna(ben.ad, rolTR[ben.rol] || ben.rol, ben.brans, ben.sinif);
      k.puan = ben.puan || 0; yaz("kullanicilar", kullanicilar);
      aktif = { ad: ben.ad, rol: rolTR[ben.rol] || ben.rol, puan: ben.puan || 0 };
      MOD = "sunucu"; // sunucu modu aç
      turBelki(); // ilk girişse tur
    } catch { biletYaz(null); aktif = null; MOD = "yerel"; } // bilet bozuksa sessizce düş
  } else if (!SUNUCU) {
    if (localStorage.getItem("demoModu") === "acik") { aktif = oku("aktifKullanici", null); MOD = "yerel"; } // daha önce açıkça demo seçildiyse sürdür
    else { aktif = null; setTimeout(baglantiHatasiGoster, 300); } // yoksa sessizce girme, hata göster (veri silinmez)
  }
  yaz("aktifKullanici", aktif); aktifGoster();
  if (MOD === "sunucu") { await tazeCiz(true); await tazeBildirim(); await yukleProgram(); await yukleEkarne(); } // offset=0 baştan (yerel liste ilk sayfayı kaçırmaz!)
  await takipYukle(); // takip butonları güncel olsun
  listeleOdev(); listeleHocalar(); listeleHoca();
  document.getElementById("btnAkis").classList.add("aktif"); // açılışta Akış altın
  ikonTazele(); // statik ikonları çiz
  panelUygula(); takvimBaslangic(); takvimCiz(); saatBaslat(); notAraclariKur(); // saat + takvim + panel düzeni + not olayları (BİR KEZ)
  await notlariYukle(); // notları ilk kez yükle (sunucu/yerel; hata olursa dürüst hata gösterir)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) { // PWA: çevrimdışı destek (http gerekir)
    navigator.serviceWorker.register("sw.js").then(r => { // yeni sürümü haber ver (otomatik yenileme YOK, form kaybolmaz!)
      r.onupdatefound = () => {
        const w = r.installing; if (!w) return;
        w.onstatechange = () => { if (w.state === "installed" && navigator.serviceWorker.controller) toast("Yeni sürüm indi! Yenile (F5)."); };
      };
    }).catch(() => {}); // olmazsa sessiz geç
  }
  // Sonsuz kaydırma: akış dibine inince devamını yükle
  let kaydirKilit = false; // üst üste yüklemeyi engelle
  let kaydirSuresi = null; // kilit zamanlayıcı
  window.addEventListener("scroll", () => {
    const akisAcik = document.getElementById("sayfaAkis").style.display !== "none"; // akışta mıyız
    const dibeYakin = window.innerHeight + window.scrollY > document.body.scrollHeight - 300; // dibe 300px kaldı mı
    if (akisAcik && dibeYakin && !kaydirKilit && btnDaha.style.display !== "none") {
      kaydirKilit = true; btnDaha.click(); // devamını yükle
      clearTimeout(kaydirSuresi); kaydirSuresi = setTimeout(() => kaydirKilit = false, 1500); // 1.5 sn sonra tekrar
    }
  }, { passive: true });
})();
