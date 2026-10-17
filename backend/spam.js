// Spam koruması: kullanıcı+işlem türü hız sınırı, benzer içerik tekrarı, istek kimliği tekilliği
// IP yalnız YEDEK tavan (okul ağındaki öğrenciler toplu engellenmez). Kalıcı hesap engeli YOK.
const db = require("./db"); // istek_kimlik tablosu (atomik tekillik)
const crypto = require("crypto"); // istek gövdesi parmak izi (SHA-256, deterministik JSON)

// İşlem türü başına sınır: [azami istek, pencere (ms)]
const SINIRLAR = {
  genel: [60, 60000],        // genel yazma (eski yazmaSiniri karşılığı, ARTIK kullanıcı bazlı!)
  soru: [6, 60000],        // soru paylaşımı
  duzenle: [20, 60000],    // gönderi düzenleme
  yorum: [12, 60000],      // yorum
  yanit: [12, 60000],      // yanıt
  sikayet: [5, 60000],     // şikâyet
  oda: [5, 60000],         // oda kurma
  mesaj: [20, 60000],      // oda mesajı
  takip: [12, 60000],      // takip isteği/kararı
  deneme: [30, 60000],     // E-Karne deneme kaydı
  program: [30, 60000],    // program yazma
  not: [40, 60000],        // kişisel not kaydetme (başlık/içerik) — normal kullanımı engellemez
  hocaSoru: [6, 60000],    // öğretmene soru
  hocaCevap: [12, 60000],  // öğretmen cevabı
  sohbetAc: [10, 60000],   // sohbet açma
  sohbet: [8, 60000],      // AI sohbet mesajı (pahalı)
  ipTavan: [500, 60000]    // IP yedeği: tek ağda normal sınıf kullanımı serbest
};
const BENZER_PENCERE = 60 * 1000;  // aynı içerik tekrarı penceresi
const BENZER_SAYI = 5;             // pencere içinde hatırlanan son içerik sayısı (A-B-A da yakalanır!)
const CEZA_TAVAN = 300;            // kademeli bekleme tavanı (5 dk) — kalıcı engel yok
const CEZA_UNUTMA = 10 * 60 * 1000; // ihlal sayacı bu süre sakinlikte sıfırlanır
const CEVAP_TAVAN = 20000;         // istek_kimlik.cevap için AZAMİ boyut: base64 görsel vb. disk şişirmez

const hizler = new Map();      // "kim|islem" -> [zaman damgaları]
const benzerler = new Map();   // "kim|islem|hedef" -> [ {metin, zaman}, ... ] (son BENZER_SAYI içerik)
const ihlaller = new Map();    // "kim|islem" -> { say, son }
const ipSayac = new Map();     // ip -> [zaman damgaları] (yedek tavan)

const simdi = () => Date.now();
function anahtarla(...parca) { return parca.join("|"); }
function temizleHarita(harita, pencere) { // eski damgaları at (bellek taşmaz)
  const esik = simdi() - pencere;
  for (const [k, v] of harita) {
    if (Array.isArray(v)) { const y = v.filter(d => d > esik); y.length ? harita.set(k, y) : harita.delete(k); }
  }
}
function temizleBenzer() { // benzer içerik kayıtlarını pencereye göre buda
  const esik = simdi() - BENZER_PENCERE;
  for (const [k, v] of benzerler) {
    const y = (v || []).filter(r => r.zaman > esik);
    y.length ? benzerler.set(k, y) : benzerler.delete(k);
  }
}
setInterval(() => { temizleHarita(hizler, 60000); temizleHarita(ipSayac, 60000); temizleBenzer(); }, 120000).unref?.(); // periyodik temizlik (test sürecini asılı bırakmaz!)
// Süresi dolan DB tekillik kayıtlarını temizle (disk şişmez; cezalar etkilenmez)
setInterval(() => {
  try { db.prepare("DELETE FROM istek_kimlik WHERE COALESCE(NULLIF(guncelleme,''),tarih) < datetime('now','-1 day')").run(); } catch { /* tablo yoksa geç */ }
}, 3600000).unref?.();

// Metin normalizasyonu: Türkçe harf katlama + büyük/küçük harf + boşluk + noktalama oyununu kapatır.
// ANLAMLI matematik işaretleri (+ - * / ^ = < > ( ) [ ] { } %) KORUNUR; farklı sorular aynı sayılmaz.
const TR_KATLA = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c" };
const MAT_ISARET = /[+\-*/^=<>()[\]{}%]/g; // korunacak anlamlı işaretler
const ANLAMSIZ = /[^\p{L}\p{N} +*\/\^=<>()[\]{}%\-]/gu; // harf/rakam/boşluk/anlamlı işaret DIŞINDAKİLER silinir
function normalMetin(m) {
  return String(m == null ? "" : m)
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, h => TR_KATLA[h]) // Türkçe harf katla (HARIKA = Harika)
    .toLowerCase()                                 // küçük harf
    .replace(ANLAMSIZ, "")                         // anlamsız noktalama sil ("!"), anlamlı işaret kalır ("2+2")
    .replace(MAT_ISARET, " $& ")                   // işaret çevresini aç: "2+2" == "2 + 2"
    .replace(/\s+/g, " ").trim();                  // boşluk sadeleştir
}

// Kademeli bekleme: ilk ihlal 10 sn, sonraki ×2, tavan 300 sn. Sakinlikte sıfırlanır.
function cezaBul(kim, islem) {
  const k = anahtarla(kim, islem), i = ihlaller.get(k);
  if (!i) return 0;
  if (simdi() - i.son > CEZA_UNUTMA) { ihlaller.delete(k); return 0; }
  return Math.min(10 * Math.pow(2, i.say - 1), CEZA_TAVAN);
}
function ihlalArtir(kim, islem) {
  const k = anahtarla(kim, islem), i = ihlaller.get(k);
  if (!i || simdi() - i.son > CEZA_UNUTMA) ihlaller.set(k, { say: 1, son: simdi() });
  else { i.say++; i.son = simdi(); }
}
// 429 + Retry-After yaz (istemci bekleme süresini görsün)
function redEt(res, bekleme, mesaj) {
  res.set("Retry-After", String(bekleme));
  return res.status(429).json({ hata: mesaj, bekleme });
}

// Hız sınırı: kullanıcı + işlem türü başına. Kimlik yoksa IP yedeği devrede.
function hizSiniri(islem, ekstra) {
  const [sinir, pencere] = ekstra || SINIRLAR[islem] || SINIRLAR.yorum;
  return (req, res, next) => {
    const kim = req.kullanici ? req.kullanici.ad : "anonim:" + (req.ip || "?");
    const k = anahtarla(kim, islem);
    const damgalar = hizler.get(k) || [];
    const taze = damgalar.filter(d => d > simdi() - pencere);
    const beklemeCeza = cezaBul(kim, islem); // kademeli bekleme (ihlal varsa)
    if (beklemeCeza > 0 && taze.length >= Math.min(2, sinir)) { // ceza süresince kısa aralarda da durdur
      ihlalArtir(kim, islem);
      return redEt(res, beklemeCeza, `Çok hızlısın! ${beklemeCeza} saniye bekle, sonra tekrar dene.`);
    }
    if (taze.length >= sinir) {
      const ilkDamga = taze[0], bekleme = Math.max(1, Math.ceil((ilkDamga + pencere - simdi()) / 1000));
      ihlalArtir(kim, islem); // kademeli ceza büyür
      return redEt(res, bekleme, `Bu işlemi çok sık yapıyorsun! ${bekleme} saniye bekle.`);
    }
    taze.push(simdi()); hizler.set(k, taze); // say
    // IP yedek tavanı (okul ağı toplu engellenmez: 500/dk)
    const ip = req.ip || "?", ipDamga = (ipSayac.get(ip) || []).filter(d => d > simdi() - SINIRLAR.ipTavan[1]);
    if (ipDamga.length >= SINIRLAR.ipTavan[0]) return redEt(res, 60, "Ağdan çok istek gidiyor! 60 saniye bekle.");
    ipDamga.push(simdi()); ipSayac.set(ip, ipDamga);
    next();
  };
}

// Benzer içerik tekrarı: aynı kullanıcı + işlem + hedefe 60 sn içinde aynı normalize metin gitmesin
// (A → B → A sıralaması da yakalanır: son BENZER_SAYI içerik saklanır, yalnız sonuncusu değil!)
function benzerEngel(islem, metinAl) {
  return (req, res, next) => {
    const metin = normalMetin(metinAl(req.body || {})); // metinAl: body'den ilgili alanı seçer
    if (!metin || metin.length < 3) return next(); // çok kısa sayılmaz
    const kim = req.kullanici ? req.kullanici.ad : "?";
    const hedef = req.params.id || req.params.yorumId || req.body?.hedefId || "-";
    const k = anahtarla(kim, islem, hedef);
    const sim = simdi();
    const gecmis = (benzerler.get(k) || []).filter(r => sim - r.zaman < BENZER_PENCERE); // pencere içindekiler
    const eski = gecmis.find(r => r.metin === metin); // A-B-A dâhil herhangi bir tekrar
    if (eski) {
      const bekleme = Math.max(1, Math.ceil((eski.zaman + BENZER_PENCERE - sim) / 1000));
      ihlalArtir(kim, islem);
      return redEt(res, bekleme, `Aynı ifadeyi tekrar gönderme! ${bekleme} saniye bekle.`);
    }
    gecmis.push({ metin, zaman: sim }); // yeni içeriği kaydet
    while (gecmis.length > BENZER_SAYI) gecmis.shift(); // sınırlı koleksiyon (bellek taşmaz)
    benzerler.set(k, gecmis);
    next();
  };
}

// İstek gövdesinin KARARLI parmak izi: anahtar sıralı JSON + SHA-256 (spam metin normalizasyonu DEĞİL!)
// Neden: eski "normalMetin + ilk 300 harf" yöntemi uzun gövdelerde ve sayılarda ÇAKIŞIYORDU
//        (1.2 ≡ 12; aynı ilk 300 harf ≡ farklı son; "12" ≡ 12; anahtar sırası gövdeyi değiştiriyordu).
// Değer türleri (sayı/dize/boolean/null), dizi sırası ve anlamlı karakterler KORUNUR; anahtar sırası önemsizdir.
const GOVDE_SURUM = "v2:"; // yeni biçim işareti: eski (kırpılmış) kayıtlarla KARIŞMASIN
function kararliJson(v) { // deterministik JSON (anahtarlar sıralı, türler korunur)
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number") return Number.isFinite(v) ? String(v) : "null"; // JSON'da NaN/Infinity yok → null
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return JSON.stringify(v); // tırnak korunur → "12" ≠ 12
  if (t === "bigint") return JSON.stringify(v.toString());
  if (Array.isArray(v)) return "[" + v.map(x => x === undefined ? "null" : kararliJson(x)).join(",") + "]"; // SIRA korunur
  if (t === "object") {
    const anahtarlar = Object.keys(v).filter(k => v[k] !== undefined).sort(); // deterministik anahtar sırası
    return "{" + anahtarlar.map(k => JSON.stringify(k) + ":" + kararliJson(v[k])).join(",") + "}";
  }
  return "null";
}
function govdeOzet(g) { // tam gövdenin SHA-256'sı (kırpma YOK; farklı gövde = farklı özet)
  try { return GOVDE_SURUM + crypto.createHash("sha256").update(kararliJson(g == null ? {} : g), "utf8").digest("hex"); }
  catch { return ""; }
}
function eskiGovdeMu(deger) { return !String(deger || "").startsWith(GOVDE_SURUM); } // ESKİ biçim parmak izi mi?

// İstek kimliği tekilliği (atomik durum makinesi):
//   işlemde  → eşzamanlı ikinci istek İŞLENMEZ (iki ayrı yazma olmaz)
//   başarılı → tamamlanan tekrar için ÖNCEKİ GERÇEK kod+gövde döner (tekrar:true)
//   başarısız→ yanlış başarı verilmez; aynı gövdeyle güvenli yeniden deneme serbest
//   farklı gövde + aynı kimlik → 409 (kimlik başka içerikte kullanılamaz)
// Kimlik; kullanıcı + YÖNTEM + YOL + gövde parmak izine bağlıdır: başka uca/hedefe/yönteme TAŞINAMAZ!
function istekKimlik() {
  return (req, res, next) => {
    const id = req.get("X-Istek-Id");
    if (!id || typeof id !== "string" || id.length > 64) return next(); // kimlik yoksa normal akış
    const kim = req.kullanici ? req.kullanici.ad : "anonim:" + (req.ip || "?");
    const ozet = govdeOzet(req.body);
    const yol = req.method + " " + ((req.baseUrl || "") + req.path); // yöntem + hedef yol (sorgu hariç)
    let kayit;
    try {
      const ins = db.prepare("INSERT OR IGNORE INTO istek_kimlik (kullanici, istek_id, yol, durum, govde, guncelleme) VALUES (?,?,?, 'islemde', ?, datetime('now'))")
        .run(kim, id, yol, ozet);
      kayit = db.prepare("SELECT * FROM istek_kimlik WHERE kullanici=? AND istek_id=?").get(kim, id);
      if (ins.changes === 0 && kayit) { // bu kimlik daha önce görülmüş
        if ((kayit.yol || "") !== yol) return res.status(409).json({ hata: "Bu istek kimliği farklı bir adres/yöntem için kullanılmış!" }); // YÖNTEM/YOL BAĞI
        const onceki = kayit.govde || "";
        if (eskiGovdeMu(onceki)) { // ESKİ (kırpılmış) parmak izi: yeni biçimle KARŞILAŞTIRILAMAZ!
          if (kayit.durum === "islemde") return res.status(409).json({ hata: "Bu istek şu an işleniyor, bekle!", islemde: true });
          if (kayit.durum === "basarili") return res.status(409).json({ hata: "Bu istek kimliği eski biçimde tamamlanmış; yanıt tekrarı yapılmaz, yeni işlem başlat.", eskiSurum: true }); // yanlış eşleşme/tekrar çalıştırma YOK
          db.prepare("UPDATE istek_kimlik SET durum='islemde', kod=0, cevap='', govde=?, guncelleme=datetime('now') WHERE kullanici=? AND istek_id=?").run(ozet, kim, id); // başarısız eski kayıt: yan etkisi yok → yeni biçime yükselt
        } else {
          if (onceki !== ozet) return res.status(409).json({ hata: "Bu istek kimliği farklı içerikle kullanılmış!" }); // kimlik başka gövdede yasak
          if (kayit.durum === "basarili") { // tamamlanmış işlem: GERÇEK sonucu tekrar sun (yanlış başarı yok!)
            let govde = {}; try { govde = JSON.parse(kayit.cevap || "{}"); } catch { govde = {}; }
            govde.tekrar = true;
            return res.status(kayit.kod || 200).json(govde);
          }
          if (kayit.durum === "islemde") return res.status(409).json({ hata: "Bu istek şu an işleniyor, bekle!", islemde: true }); // eşzamanlı tekrar
          // basarisiz → güvenli yeniden dene: yeniden sahiplen
          db.prepare("UPDATE istek_kimlik SET durum='islemde', kod=0, cevap='', guncelleme=datetime('now') WHERE kullanici=? AND istek_id=?").run(kim, id);
        }
      }
    } catch (e) { // DB hatasında tekilliği SESSİZCE atlama: açık hata ver
      console.error("istek kimliği hatası:", e.message);
      return res.status(500).json({ hata: "İstek tekilliği doğrulanamadı, tekrar dene." });
    }
    // Yanıt bitince durumu yaz (başarı/başarısızlık + gerçek kod/gövde)
    let yazildi = false;
    const kaydet = (kod, govde) => {
      if (yazildi) return; yazildi = true;
      const d = kod >= 200 && kod < 400 ? "basarili" : "basarisiz";
      let metin = "";
      if (d === "basarili") {
        try { metin = JSON.stringify(govde == null ? {} : govde); } catch { metin = ""; }
        if (metin.length > CEVAP_TAVAN) metin = ""; // ÇOK BÜYÜK gövde (örn. base64 görsel) saklanmaz; tekrar yalnız {tekrar:true} döner
      }
      try {
        db.prepare("UPDATE istek_kimlik SET durum=?, kod=?, cevap=?, guncelleme=datetime('now') WHERE kullanici=? AND istek_id=?")
          .run(d, kod, metin, kim, id);
      } catch (e) { console.error("istek kimliği kaydı:", e.message); }
    };
    const ozelJson = res.json.bind(res);
    res.json = govde => { kaydet(res.statusCode, govde); return ozelJson(govde); };
    res.on("finish", () => kaydet(res.statusCode, {})); // akış (SSE) yolları için yedek
    next();
  };
}

// Testler için sayaç temizliği (bağımsızlık)
function spamSifirla() {
  hizler.clear(); benzerler.clear(); ihlaller.clear(); ipSayac.clear();
  try { db.prepare("DELETE FROM istek_kimlik").run(); } catch { /* tablo yoksa geç */ }
}
// Test yardımcısı: ihlal kaydını istenen geçmişe kur, o andaki bekleme cezasını döndür (süre dolması sınaması)
function _testIhlal(kim, islem, gecmisMs) { ihlaller.set(anahtarla(kim, islem), { say: 1, son: simdi() - gecmisMs }); return cezaBul(kim, islem); }

// Giriş/kayıt sınırı: kullanıcı adı + IP birlikte, YALNIZ hatalı denemeler sayılır
// (başarılı girişler kilit üretmez — okul ağındaki normal kullanım engellenmez, brute force durur)
const girisSayac = new Map(); // "ad|ip" -> [damga]
function girisSiniri(req, res, next) {
  const ad = String((req.body && req.body.ad) || "?").toLowerCase().trim(); // hedef hesap
  const ip = req.ip || "?";
  const k = anahtarla("giris", ad, ip);
  const damgalar = (girisSayac.get(k) || []).filter(d => d > simdi() - 15 * 60 * 1000);
  if (damgalar.length >= 15) { // hesap+IP başına 15 HATALI deneme / 15 dk
    const bekleme = Math.ceil((damgalar[0] + 15 * 60 * 1000 - simdi()) / 1000);
    return redEt(res, bekleme, `Çok denedin! ${Math.ceil(bekleme / 60)} dakika sonra tekrar dene.`);
  }
  res.on("finish", () => { // yanıt belli olduktan sonra SAY (yalnız hata sayılır!)
    if (res.statusCode >= 400) { // hatalı deneme
      const d = (girisSayac.get(k) || []).filter(x => x > simdi() - 15 * 60 * 1000);
      d.push(simdi()); girisSayac.set(k, d);
    } else girisSayac.delete(k); // başarılı giriş: sayacı sıfırla (kilit kalkar)
  });
  next();
}
setInterval(() => { for (const [k, v] of girisSayac) { const y = v.filter(d => d > simdi() - 15 * 60 * 1000); y.length ? girisSayac.set(k, y) : girisSayac.delete(k); } }, 300000).unref?.(); // 5 dk'da bir temizlik

module.exports = { hizSiniri, benzerEngel, istekKimlik, girisSiniri, spamSifirla, normalMetin, govdeOzet, kararliJson, GOVDE_SURUM, SINIRLAR, _testIhlal, BENZER_PENCERE, CEZA_UNUTMA };
