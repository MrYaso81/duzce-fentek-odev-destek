// Video çözüm alt sistemi — TABLOLAR (ekleyici/bozucu olmayan: `IF NOT EXISTS`)
// GÜVENLİK SINIRI: Yalnız kendi tablolarına dokunur. Kişisel notlar, sohbetler, gizli sınav
// havuzu ve kütüphane tablolarına buradan ASLA dokunulmaz.
const db = require("../db");

db.exec(`
-- Video cevap kayıtları (orijinal dosya ASLA DB'de değil; yalnız özel anahtar)
CREATE TABLE IF NOT EXISTS video_cevaplar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gonderi_id INTEGER NOT NULL,            -- hangi soru gönderisi
  yazar TEXT NOT NULL,                    -- kim yükledi (sahiplik)
  baslik TEXT DEFAULT '',                 -- kısa başlık
  aciklama TEXT DEFAULT '',               -- kısa açıklama (çözüm özeti)
  durum TEXT DEFAULT 'quarantined',       -- uploading|quarantined|processing|approved|needs_review|rejected|failed
  saklama_anahtari TEXT NOT NULL,         -- öngörülemez özel depolama anahtarı (orijinal)
  kapak_anahtari TEXT DEFAULT '',         -- kapak (thumbnail) anahtarı (özel)
  altyazi_anahtari TEXT DEFAULT '',       -- altyazı anahtarı (özel; onaylanınca yayımlanabilir)
  orijinal_boyut INTEGER DEFAULT 0,       -- bayt
  sure_sn REAL DEFAULT 0,                 -- çözümlenen süre (sn; ffprobe yoksa 0)
  bicim TEXT DEFAULT '',                  -- GERÇEK tespit edilen biçim (magic-bytes; uzantıya güvenilmez)
  mime_beyan TEXT DEFAULT '',             -- istemcinin iddia ettiği MIME (yalnız kayıt)
  icerik_hash TEXT DEFAULT '',            -- SHA-256 (yinelenen/yeniden oynatma koruması)
  denetim_durumu TEXT DEFAULT 'bekliyor', -- bekliyor|tamam|kaldi|basarisiz
  son_karar TEXT DEFAULT '',              -- onaylandi|red|inceleme|blok (son otomatik karar)
  karar_gerekce TEXT DEFAULT '',          -- kararın kısa Türkçe gerekçesi
  karar_veren TEXT DEFAULT '',            -- insan onayladıysa kim (otomatikse boş)
  karar_tarih TEXT DEFAULT '',            -- karar zamanı
  red_nedeni TEXT DEFAULT '',             -- reddedildiyse/sebep (kullanıcıya gösterilir)
  itiraz_durumu TEXT DEFAULT '',          -- ''|acik|kabul|reddedildi
  silindi INTEGER DEFAULT 0,             -- 1=her yerden erişim kapalı (orijinal+türevler)
  olusturma TEXT DEFAULT (datetime('now')),
  guncelleme TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_video_cevap_gonderi ON video_cevaplar(gonderi_id, durum);
CREATE INDEX IF NOT EXISTS idx_video_cevap_yazar ON video_cevaplar(yazar);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_cevap_hash ON video_cevaplar(yazar, icerik_hash) WHERE icerik_hash <> '';

-- Zaman damgalı moderasyon bulguları (konuşma|ekran_yazisi|goruntu|baslik_aciklama)
CREATE TABLE IF NOT EXISTS video_bulgular (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  kaynak TEXT NOT NULL,                   -- konusma|ekran_yazisi|goruntu|baslik_aciklama
  kategori TEXT NOT NULL,                 -- hakaret|tehdit|nefret|cinsel|siddet|kisisel_bilgi|diger
  siddet TEXT DEFAULT 'dusuk',            -- dusuk|orta|yuksek
  guven REAL DEFAULT 0,                   -- 0..1 (düşük güven tek başına CEZA üretmez)
  zaman_bas REAL DEFAULT 0,               -- video içindeki başlangıç (sn)
  zaman_bit REAL DEFAULT 0,               -- bitiş (sn)
  aciklama TEXT DEFAULT '',               -- kısa açıklama
  kaynak_guven REAL DEFAULT 1,            -- altyazı/transkript güveni (düşükse bulgu ZAYIF sayılır)
  onayli INTEGER DEFAULT 0,               -- 1=insan incelemesinde doğrulandı (tahmin değil)
  tarih TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_video_bulgu_video ON video_bulgular(video_id);

-- Dayanıklı arka plan kuyruğu (yeniden başlatmaya dayanıklı + idempotent + sınırlı deneme)
CREATE TABLE IF NOT EXISTS video_isleri (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tip TEXT NOT NULL,                      -- denetle|isle (kapak/transkript/çıktı)
  video_id INTEGER NOT NULL,
  durum TEXT DEFAULT 'bekliyor',          -- bekliyor|calisiyor|basarili|basarisiz
  deneme INTEGER DEFAULT 0,
  azami_deneme INTEGER DEFAULT 3,         -- sınırlı yeniden deneme (bounded retry)
  sonraki_deneme TEXT DEFAULT (datetime('now')),
  zaman_asimi_sn INTEGER DEFAULT 120,
  kilit TEXT DEFAULT '',                  -- idempotency kilidi (aynı iş iki kez WORKER'a düşmesin)
  hata TEXT DEFAULT '',
  olusturma TEXT DEFAULT (datetime('now')),
  guncelleme TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_video_is_durum ON video_isleri(durum, sonraki_deneme);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_is_tekil ON video_isleri(tip, video_id) WHERE durum IN ('bekliyor','calisiyor');

-- Hesap inceleme vakaları (içerik kararından AYRI)
CREATE TABLE IF NOT EXISTS hesap_incelemeleri (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kullanici TEXT NOT NULL,                -- hakkında inceleme
  video_id INTEGER DEFAULT 0,             -- dayanak video (varsa)
  sebep TEXT DEFAULT '',                  -- kısa Türkçe sebep
  durum TEXT DEFAULT 'acik',              -- acik|kapandi
  olusturan TEXT DEFAULT '',              -- sistem|insan adı
  onem INTEGER DEFAULT 0,                 -- 0=düşük, 1=öncelikli (acil tehdit)
  karar TEXT DEFAULT '',                  -- insandan karar: uyari|kisitla|suspend|temizlendi
  karar_gerekce TEXT DEFAULT '',
  karar_veren TEXT DEFAULT '',
  tarih TEXT DEFAULT (datetime('now')),
  karar_tarih TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_hesap_inceleme_kullanici ON hesap_incelemeleri(kullanici, durum);

-- Geçici, süreli, denetime bağlı kısıtlamalar (kalıcı ban YAPAY ZEKA SKORUYLA ASLA)
CREATE TABLE IF NOT EXISTS hesap_kisitlamalari (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kullanici TEXT NOT NULL,
  tur TEXT DEFAULT 'yukleme',             -- şu an: yukleme
  baslangic TEXT DEFAULT (datetime('now')),
  bitis TEXT DEFAULT '',                  -- süreli; boş bırakılmaz
  sebep TEXT DEFAULT '',
  karar_veren TEXT DEFAULT '',            -- insan (yetkili)
  itiraz_durumu TEXT DEFAULT '',          -- ''|acik|kabul|reddedildi
  kaldiran TEXT DEFAULT '',
  tarih TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hesap_kisit_kullanici ON hesap_kisitlamalari(kullanici, bitis);

-- Video şikâyetleri (aynı kişi aynı videoyu TEK kez bildirir → ceza şişirmez)
CREATE TABLE IF NOT EXISTS video_sikayetleri (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  bildiren TEXT NOT NULL,
  neden TEXT NOT NULL,
  tarih TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_sikayet_tekil ON video_sikayetleri(video_id, bildiren);

-- Moderatör denetim kaydı (kim, ne, ne zaman, hangi içerik)
CREATE TABLE IF NOT EXISTS video_denetim_kaydi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kim TEXT NOT NULL,                      -- karar veren
  aksiyon TEXT NOT NULL,                  -- onayla|reddet|istegi_degistir|kisitla|hesap_karari|itiraz_karari
  video_id INTEGER DEFAULT 0,
  kullanici TEXT DEFAULT '',
  gerekce TEXT DEFAULT '',
  tarih TEXT DEFAULT (datetime('now'))
);

-- Anti-bot: IP başına kayıt/giriş/güvenlik sorusu izleri (cihaz parmak izi YOK)
CREATE TABLE IF NOT EXISTS bot_izleri (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kim TEXT NOT NULL,                      -- "ad" veya "ip:<addr>" ya da "soru:<jeton>"
  islem TEXT NOT NULL,                    -- kayit|giris|guvenlik_sorusu
  basari INTEGER DEFAULT 0,
  hedef TEXT DEFAULT '',                  -- güvenlik sorusu: beklenen cevabın özeti
  zaman TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bot_iz_kim ON bot_izleri(kim, islem, zaman);
`);

module.exports = db;
