// ANTI-BOT / İSTİSMAR ÖNLEME — KATMANLI ve ERİŞİLEBİLİR (uygulama-içi katman; duvar DEĞİL).
// BU YAPILANMAYANLAR (bilinçli):
//  - Tüm okul/IP BLOKLANMAZ (paylaşımlı IP'de öğrenci cezalandırılmaz).
//  - Yalnız IP veya tek otomatik sinyalle KALICI ban YOK.
//  - Cihaz parmak izi YOK, kimlik belgesi zorunlu DEĞİL.
//  - CAPTCHA "tam bot koruması" olarak SUNULMAZ ve sahte başarı İDDİA EDİLMEZ.
//  - İtibar, zorunlu içerik denetimini ATLAMAZ.
// Sağlayıcı (turnstile/recaptcha vb.) TANIMLI DEĞİLSE: açık, SINIRLI bir yerel yedek
// soru kullanılır — "doğrulandı" diye SAHTE başARI üretilmez; başarısızlık gerçekten başarısızlıktır.
const crypto = require("crypto");
const db = require("./db");
const { AYAR, gunlukKota } = require("./video/limits");

const GIZLI = process.env.JWT_SECRET || "yerel-gizli";

function simdi() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function pencereIci(kim, islem, dakika, sadeceBasarisiz = false) {
  const ek = sadeceBasarisiz ? " AND basari=0" : "";
  return db.prepare(`SELECT COUNT(*) n FROM bot_izleri WHERE kim=? AND islem=?${ek}
                     AND zaman > datetime('now', ?)`).get(kim, islem, `-${dakika} minutes`).n;
}
function kaydet(kim, islem, basari = 0) {
  db.prepare(`INSERT INTO bot_izleri(kim, islem, basari) VALUES(?,?,?)`).run(kim, islem, basari ? 1 : 0);
}

// 1) KAYIT sınırı (IP başına saatlik) — oranlı, süreli; kalıcı değil
function kayitSinirIzin(ip) {
  const kim = "ip:" + String(ip || "?");
  const n = pencereIci(kim, "kayit", 60);
  return { izin: n < AYAR.kayitSaatlik, kalan: Math.max(0, AYAR.kayitSaatlik - n) };
}
function kayitDenemesiKaydet(ip, basari) { kaydet("ip:" + String(ip || "?"), "kayit", basari); }

// 2) GİRİŞ denemesi sınırı (kullanıcı + IP, dakikalık) — YALNIZ başarısız denemeler sayılır
//    (başarılı giriş kilit bütçesi harcamaz; paylaşımlı IP'de normal kullanım akmaya devam eder)
function girisSiniri(ad, ip) {
  const a = pencereIci("ad:" + ad, "giris", 5, true);
  const i = pencereIci("ip:" + ip, "giris", 5, true);
  const ust = Math.max(a, i);
  return { izin: ust < AYAR.girisDeneme, kalan: Math.max(0, AYAR.girisDeneme - ust) };
}
function girisDenemesiKaydet(ad, ip, basari) {
  kaydet("ad:" + ad, "giris", basari);
  kaydet("ip:" + ip, "giris", basari);
}

// 3) GÜVEN AŞAMASI — hesap yaşı + doğrulanmış hareketlerle kademeli (yeni hesap kotalı)
function guvenAsamasi(kullanici) {
  const u = db.prepare(`SELECT ad, olusturma FROM kullanicilar WHERE ad=?`).get(kullanici);
  if (!u) return "yeni";
  const yasGun = u.olusturma ? Math.floor((Date.now() - new Date(u.olusturma.replace(" ", "T") + "Z").getTime()) / 86400000) : 0;
  const onayliVideo = db.prepare(`SELECT COUNT(*) n FROM video_cevaplar WHERE yazar=? AND durum='approved'`)
    .get(kullanici).n;
  if (yasGun >= AYAR.yeniHesapGun && (onayliVideo >= 3 || yasGun >= 30)) return "guvenilir";
  if (yasGun >= AYAR.yeniHesapGun) return "normal";
  return "yeni";
}

// 4) YÜKLEME kontrolü: kısıt + beklemede kota + günlük kota + günlük depolama + oran
function yuklemeKontrol(kullanici, ip, bayt = 0) {
  // 4a) Aktif kısıtlama (yetkili insan kararı) — en güçlü engel
  const kisit = db.prepare(`SELECT * FROM hesap_kisitlamalari WHERE kullanici=? AND tur='yukleme'
                            AND (bitis IS NULL OR bitis > ?) ORDER BY id DESC LIMIT 1`).get(kullanici, simdi());
  if (kisit) return { izin: false, kod: "kisitli", mesaj: "Yükleme geçici olarak kısıtlı. Ayrıntı ve itiraz: Hesabım sayfası." };

  const asama = guvenAsamasi(kullanici);
  // 4b) Kişi başı BEKLEMEDE (onaysız) video kotası — kuyruk taşmasını önler
  const beklemede = db.prepare(`SELECT COUNT(*) n FROM video_cevaplar WHERE yazar=? AND durum IN
                               ('uploading','quarantined','processing','needs_review')`).get(kullanici).n;
  if (beklemede >= AYAR.beklemedeAzami)
    return { izin: false, kod: "bekleme", mesaj: `Aynı anda en fazla ${AYAR.beklemedeAzami} videonuz incelemede olabilir.` };

  // 4c) Günlük yükleme ADEDI kotası (güven aşamasına göre)
  const bugun = db.prepare(`SELECT COUNT(*) n FROM video_cevaplar WHERE yazar=? AND olusturma >= date('now')`)
    .get(kullanici).n;
  const kota = gunlukKota(asama);
  if (bugun >= kota) return { izin: false, kod: "gunluk_adet", mesaj: `Günlük yükleme sınırına ulaştınız (${kota}). Yarın tekrar deneyin.` };

  // 4d) Günlük DEPOLAMA kotası (MB)
  const depo = db.prepare(`SELECT COALESCE(SUM(orijinal_boyut),0) b FROM video_cevaplar
                           WHERE yazar=? AND olusturma >= date('now')`).get(kullanici).b;
  if (depo + bayt > AYAR.gunlukDepolamaMB * 1024 * 1024)
    return { izin: false, kod: "gunluk_depo", mesaj: `Günlük depolama sınırına ulaştınız (${AYAR.gunlukDepolamaMB} MB).` };

  // 4e) Yalnız IP bazlı, ORANLI ve süreli burst koruması (tüm okul DEĞİL)
  const ipAdedi = db.prepare(`SELECT COUNT(DISTINCT yazar) n FROM video_cevaplar WHERE olusturma >= datetime('now','-10 minutes')`)
    .get().n;
  if (ipAdedi > 25) return { izin: false, kod: "yogunluk", mesaj: "Şu an yoğunluk var; birazdan tekrar deneyin." };

  return { izin: true, asama, kalanKota: Math.max(0, kota - bugun - 1) };
}

// 5) YİNELENEN/YENİDEN OYNATMA koruması (içerik hash'i — aynı dosya iki kez yüklenemez)
function yinelenenMi(kullanici, hash) {
  if (!hash) return false;
  return !!db.prepare(`SELECT id FROM video_cevaplar WHERE yazar=? AND icerik_hash=?`).get(kullanici, hash);
}

// 6) RİSK + SINIRLI GÜVENLİK SORUSU (sağlayıcı yoksa AÇIK yedek; sahte başarı YOK)
function riskSeviyesi(kullanici, ip) {
  const hizliGiris = pencereIci("ad:" + kullanici, "giris", 5) >= 5;
  const burst = db.prepare(`SELECT COUNT(*) n FROM kullanicilar WHERE olusturma > datetime('now','-10 minutes')`).get().n > 10;
  const yeni = guvenAsamasi(kullanici) === "yeni";
  const puan = (hizliGiris ? 2 : 0) + (burst ? 2 : 0) + (yeni ? 1 : 0);
  return { puan, soruGerek: puan >= 3, aciklama: puan >= 3 ? "Şüpheli hareket: kısa doğrulama sorusu" : "" };
}
// İmzalı, tek kullanımlık, süreli yerel soru (sağlayıcı yokken SINIRLI yedek)
// Beklenen cevabın ÖZETİ saklanır → cevap sunucuda GERÇEK doğrulanır (istemciye güvenilmez).
function soruUret(kullanici) {
  const a = 1 + Math.floor(Math.random() * 9), b = 1 + Math.floor(Math.random() * 9);
  const dogru = a + b;
  const jeton = crypto.randomBytes(16).toString("hex");
  const cevapOzet = crypto.createHash("sha256").update(String(dogru)).digest("hex");
  db.prepare(`INSERT INTO bot_izleri(kim, islem, basari) VALUES(?,?,0)`)
    .run("soru:" + jeton, "guvenlik_sorusu");
  db.prepare(`UPDATE bot_izleri SET hedef=? WHERE kim=? AND islem='guvenlik_sorusu'`)
    .run(cevapOzet, "soru:" + jeton);
  return { soru: `${a} + ${b} = ?`, jeton, gecerlilikSn: AYAR.guvenlikSoruPencereSn };
}
function soruDogrula(kullanici, jeton, cevap) {
  if (!jeton || !/^[a-f0-9]{16,64}$/.test(jeton)) return { ok: false, mesaj: "Doğrulama başarısız." };
  const satir = db.prepare(`SELECT kim, hedef FROM bot_izleri WHERE kim=? AND islem='guvenlik_sorusu'`)
    .get("soru:" + jeton);
  if (!satir || !satir.hedef) return { ok: false, mesaj: "Soru bulunamadı ya da kullanılmış (yeniden deneyin)." };
  // Tek kullanımlık: sil (yeniden oynatma koruması)
  db.prepare(`DELETE FROM bot_izleri WHERE kim=? AND islem='guvenlik_sorusu'`).run("soru:" + jeton);
  const giren = String(cevap == null ? "" : cevap).trim();
  if (!/^\d{1,3}$/.test(giren)) return { ok: false, mesaj: "Geçersiz cevap." };
  const ozet = crypto.createHash("sha256").update(giren).digest("hex");
  const dogru = crypto.timingSafeEqual(Buffer.from(ozet, "hex"), Buffer.from(satir.hedef, "hex"));
  if (!dogru) return { ok: false, mesaj: "Cevap doğru değil. Lütfen tekrar deneyin." };
  kaydet("ad:" + kullanici, "guvenlik_sorusu", 1);
  return { ok: true, mesaj: "Doğrulama tamam." };
}

// 7) Kayıt İZLEME (yoğunluk/burst) — gözlem, otomatik kalıcı ceza DEĞİL
function kayitBurst() {
  const n = db.prepare(`SELECT COUNT(*) n FROM kullanicilar WHERE olusturma > datetime('now','-10 minutes')`).get().n;
  return { son10Dk: n, uyari: n > 10 };
}
function sifirla() { db.prepare(`DELETE FROM bot_izleri`).run(); }

module.exports = { kayitSinirIzin, kayitDenemesiKaydet, girisSiniri, girisDenemesiKaydet,
                   guvenAsamasi, yuklemeKontrol, yinelenenMi, riskSeviyesi, soruUret, soruDogrula,
                   kayitBurst, sifirla };
