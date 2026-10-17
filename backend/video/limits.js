// Video çözüm yükleme — yapılandırılabilir MUHAFAZAKAR sınırlar (tek yerden değişir)
// Not: Değerler .env ile ezilebilir; varsayılanlar bilinçli olarak dar tutulmuştur.
const say = (v, vars) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : vars; };

const AYAR = {
  // --- Yükleme sınırları (tarayıcı DA doğrular; asıl karar sunucuda) ---
  enFazlaBoyutMB: say(process.env.VIDEO_MAX_MB, 100),          // dosya boyutu (MB)
  enFazlaSureSn: say(process.env.VIDEO_MAX_SN, 300),           // süre (sn) — 5 dakika
  enAzBoyutBayt: 1024,                                          // anlamsız boş dosyayı reddet
  desteklenenBicimler: ["mp4", "m4v", "mov", "webm"],          // uzantı + MAĞİC BYTES ile gerçeklenir
  izinliMime: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"], // beyan; tek başına GÜVENİLMEZ

  // --- Karantina / işleme kuyruğu ---
  kuyrukBounded: say(process.env.VIDEO_QUEUE_CONCURRENCY, 2),  // eşzamanlı iş (sunucuyu boğmaz)
  isAzamiDeneme: 3,                                             // sınırlı yeniden deneme
  isZamanAsimiSn: say(process.env.VIDEO_JOB_TIMEOUT_SN, 120),  // iş başına süre sınırı
  isBeklemeSn: 10,                                              // ilk yeniden deneme gecikmesi (üstüne ×2)

  // --- Güven aşamaları (yeni hesaplara kademeli güven) ---
  guvenAsamalari: ["yeni", "normal", "guvenilir"],
  yeniHesapGun: say(process.env.YENI_HESAP_GUN, 3),                // bu süreden kısa hesap = yeni
  yeniHesapGunlukYukleme: say(process.env.YENI_GUNLUK, 2),         // yeni hesap günlük yükleme kotası
  normalGunlukYukleme: say(process.env.NORMAL_GUNLUK, 6),          // normal günlük kota
  guvenilirGunlukYukleme: say(process.env.GUVENILIR_GUNLUK, 12),   // güvenilir günlük kota
  beklemedeAzami: say(process.env.BEKLEMEDE_AZAMI, 3),             // kişi başına beklemede (onaysız) video kotası
  gunlukDepolamaMB: say(process.env.VIDEO_GUNLUK_DEPO_MB, 500),    // kişi başına günlük depolama kotası (MB)

  // --- Denetim (moderasyon) ---
  // NOT: Bu ortamda GERÇEK konuşma tanıma/OCR/görsel model ÇALIŞMAZ (bkz. medya.js/denetim.js).
  // Yalnızca SAĞLAYICI tanımlıysa çağrılır; tanımlı değilse video BEKLEMEDE kalır (asla sessizce yayına girmez).
  otomatikYayinEsik: 0.85,                 // tüm kategorilerde güven bu değerin altındaysa + bulgu yoksa yayına girer
  insanIncelemesiEsik: 0.30,               // bu üstü bulgu → needs_review
  siddetliEsik: 0.70,                      // yüksek güvenli ciddi bulgu → block + öncelikli inceleme

  // --- Saklama / saklama süresi (retention) ---
  karantinaGun: 30,                        // onaylanmamış karantina dosyası süresi
  isliDosyaGun: 7,                         // geçici iş dosyaları (thumbnail/çıktı) süresi
  redEdilenGun: 14,                        // reddedilen dosya ne kadar tutulur (itiraz/silme için)

  // --- Anti-bot (Katman: uygulama içi; duvar/CIHAZ parmak izi YOK) ---
  // NOT: Paylaşımlı okul IP'si için BİLİNÇLİ olarak geniş (tüm okul bloklanmasın);
  // asıl koruma başarısız deneme kilidi + kota + güvenlik sorusudur.
  kayitSaatlik: say(process.env.KAYIT_SAATLIK, 100),        // IP başına saatlik kayıt (paylaşımlı IP)
  girisDeneme: say(process.env.GIRIS_DENEME, 10),            // BAŞARISIZ giriş denemesi (5 dk, kullanıcı+IP)
  guvenlikSoruPencereSn: 300,              // riskli işlem sonrası bekleme
};

// Güven aşamasına göre günlük yükleme kotası
function gunlukKota(asama) {
  if (asama === "guvenilir") return AYAR.guvenilirGunlukYukleme;
  if (asama === "yeni") return AYAR.yeniHesapGunlukYukleme;
  return AYAR.normalGunlukYukleme;
}

module.exports = { AYAR, gunlukKota };
