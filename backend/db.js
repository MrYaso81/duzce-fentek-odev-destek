// Veritabanı: SQLite (ücretsiz, tek dosya, kurulum yok)
// Not: better-sqlite3 Node 24'te hazır parça sunmadığı için
// Node'un gömülü SQLite'sini (node:sqlite) kullanıyoruz, işi aynı.
// Tablolar: kullanicilar (hesaplar) + denetim_kaydi (kim ne yaptı)
const { DatabaseSync } = require("node:sqlite"); // Node'un kendi SQLite'si
require("dotenv").config(); // .env dosyasını oku

const db = new DatabaseSync(process.env.DB_PATH || "./odevagi.db"); // dosyayı aç/yoksa oluştur
db.exec("PRAGMA journal_mode = WAL"); // güvenli yazma modu

// Hesaplar tablosu: rol = ogrenci|ogretmen|mudur|admin
db.exec(`
CREATE TABLE IF NOT EXISTS kullanicilar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  ad TEXT UNIQUE NOT NULL,               -- kullanıcı adı (tekil)
  sifre_hash TEXT NOT NULL,              -- şifrenin gizlenmiş hali (aslı saklanmaz!)
  rol TEXT NOT NULL DEFAULT 'ogrenci',   -- rol
  brans TEXT DEFAULT '',                 -- hoca branşı
  sinif TEXT DEFAULT '',                 -- öğrenci sınıfı
  onay INTEGER DEFAULT 1,                -- hoca onayı: 1=onaylı, 0=bekliyor
  puan INTEGER DEFAULT 0,                -- yardım puanı
  uyari INTEGER DEFAULT 0,               -- uyarı sayısı
  askida INTEGER DEFAULT 0,              -- 1=askıda (giremez)
  olusturma TEXT DEFAULT (datetime('now')) -- kayıt tarihi
);
CREATE TABLE IF NOT EXISTS denetim_kaydi (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  kim TEXT NOT NULL,      -- kararı veren (örn: admin)
  aksiyon TEXT NOT NULL,  -- ne yaptı (örn: hoca-onay)
  hedef TEXT DEFAULT '',  -- kime uyguladı
  tarih TEXT DEFAULT (datetime('now')) -- ne zaman
);
CREATE TABLE IF NOT EXISTS gonderiler (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  yazar TEXT NOT NULL,                   -- kim paylaştı
  tur TEXT DEFAULT 'Soru',               -- Soru|Çözüm Paylaşımı|Konu Özeti
  ders TEXT NOT NULL,                    -- ders etiketi (zorunlu)
  sinif TEXT DEFAULT '',                 -- sınıf seviyesi
  baslik TEXT NOT NULL,                  -- başlık
  aciklama TEXT DEFAULT '',              -- açıklama
  resimler TEXT DEFAULT '[]',            -- resimler (JSON liste, şimdilik prototip)
  cozuldu INTEGER DEFAULT 0,             -- 1=çözüldü
  sikayet INTEGER DEFAULT 0,             -- şikayet sayısı
  tarih TEXT DEFAULT (datetime('now'))   -- paylaşım tarihi
);
CREATE TABLE IF NOT EXISTS yorumlar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  gonderi_id INTEGER NOT NULL,           -- hangi gönderi
  yazar TEXT NOT NULL,                   -- kim yazdı
  metin TEXT NOT NULL,                   -- yorum
  enIyi INTEGER DEFAULT 0,               -- 1=en iyi çözüm
  tarih TEXT DEFAULT (datetime('now'))   -- yazılma tarihi
);
CREATE TABLE IF NOT EXISTS yanitlar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  yorum_id INTEGER NOT NULL,             -- hangi yorum
  yazar TEXT NOT NULL,                   -- kim yazdı
  metin TEXT NOT NULL,                   -- yanıt
  tarih TEXT DEFAULT (datetime('now'))   -- yazılma tarihi
);
CREATE TABLE IF NOT EXISTS begeniler (
  gonderi_id INTEGER NOT NULL, -- hangi gönderi
  kisi TEXT NOT NULL,          -- kim beğendi
  PRIMARY KEY (gonderi_id, kisi) -- biri bir gönderiyi 1 kez beğenir
);
CREATE TABLE IF NOT EXISTS kaydetmeler (
  kisi TEXT NOT NULL,        -- kim kaydetti
  gonderi_id INTEGER NOT NULL, -- hangi gönderi
  PRIMARY KEY (kisi, gonderi_id) -- biri bir gönderiyi 1 kez kaydeder
);
CREATE TABLE IF NOT EXISTS sikayetler (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  hedefId INTEGER NOT NULL,  -- hangi gönderi
  neden TEXT NOT NULL,       -- şikayet nedeni
  bildiren TEXT NOT NULL,    -- kim bildirdi
  tarih TEXT DEFAULT (datetime('now')) -- ne zaman
);
CREATE TABLE IF NOT EXISTS odalar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  ad TEXT NOT NULL,          -- oda adı
  ders TEXT NOT NULL,        -- ders
  kurucu TEXT NOT NULL,      -- kim açtı
  tarih TEXT DEFAULT (datetime('now')) -- açılış
);
CREATE TABLE IF NOT EXISTS oda_mesajlari (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  oda_id INTEGER NOT NULL,   -- hangi oda
  yazar TEXT NOT NULL,       -- kim yazdı
  metin TEXT NOT NULL,       -- mesaj
  tarih TEXT DEFAULT (datetime('now')) -- ne zaman
);
CREATE TABLE IF NOT EXISTS bildirimler (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  kime TEXT NOT NULL,        -- alıcı kullanıcı adı
  metin TEXT NOT NULL,       -- bildirim yazısı
  okundu INTEGER DEFAULT 0,  -- 1=okundu
  tarih TEXT DEFAULT (datetime('now')) -- ne zaman
);
CREATE TABLE IF NOT EXISTS takipler (
  takipci TEXT NOT NULL,     -- kim takip ediyor
  edilen TEXT NOT NULL,      -- kimi ediyor
  PRIMARY KEY (takipci, edilen) -- biri birini 1 kez takip eder
);
CREATE TABLE IF NOT EXISTS hoca_sorulari (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  ogrenci TEXT NOT NULL,     -- soran öğrenci
  hoca TEXT NOT NULL,        -- hedef öğretmen
  ders TEXT NOT NULL,        -- ders
  baslik TEXT NOT NULL,      -- başlık
  soru TEXT NOT NULL,        -- soru metni
  gizli TEXT DEFAULT 'ozel', -- ozel|acik
  durum TEXT DEFAULT 'Beklemede', -- Beklemede|Cevaplandı|Kapatıldı
  cevap TEXT DEFAULT '',     -- hoca cevabı
  puan INTEGER DEFAULT 0,    -- öğrencinin verdiği yıldız
  paylasildi INTEGER DEFAULT 0, -- akışa taşındı mı
  tarih TEXT DEFAULT (datetime('now')) -- ne zaman
);
CREATE TABLE IF NOT EXISTS sifre_sifirlama (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  ad TEXT NOT NULL,          -- kimin için
  jeton TEXT UNIQUE NOT NULL, -- tek kullanımlık anahtar
  tarih TEXT DEFAULT (datetime('now')) -- ne zaman üretildi
);
CREATE TABLE IF NOT EXISTS sohbetler (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  sahip TEXT NOT NULL,       -- kimin sohbeti (başkası göremez!)
  baslik TEXT DEFAULT 'Sohbet', -- yeniden adlandırılabilir
  ders TEXT DEFAULT '',      -- ders bağlamı (ipucu seviyesi)
  olusturma TEXT DEFAULT (datetime('now')), -- açılış
  guncelleme TEXT DEFAULT (datetime('now')) -- son mesaj
);
CREATE TABLE IF NOT EXISTS mesajlar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  sohbet_id INTEGER NOT NULL, -- hangi sohbet
  rol TEXT NOT NULL,         -- user|asistan
  metin TEXT NOT NULL,       -- mesaj
  tarih TEXT DEFAULT (datetime('now')) -- ne zaman
);
CREATE TABLE IF NOT EXISTS istek_kimlik (
  kullanici TEXT NOT NULL,   -- kim gönderdi
  istek_id TEXT NOT NULL,    -- istemcinin ürettiği tekil kimlik (çift tıklama/ağ tekrarı koruması)
  yol TEXT DEFAULT '',       -- hangi uç
  tarih TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (kullanici, istek_id) -- atomik tekillik (UNIQUE)
);
CREATE TABLE IF NOT EXISTS ai_kullanim (
  kullanici TEXT NOT NULL,   -- AI kotası sahibi (sohbet geçmişinden BAĞIMSIZ!)
  uretim_id TEXT NOT NULL,   -- üretim kimliği (retry sayaçtırmaz)
  tarih TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (kullanici, uretim_id) -- aynı üretim iki kez sayılmaz
);
CREATE TABLE IF NOT EXISTS calisma_programi (
  sahip TEXT PRIMARY KEY,    -- kullanıcı adı (hesap başına 1 program)
  veri TEXT NOT NULL,        -- program JSON (sinif, hucre, ozelDersler)
  surum INTEGER DEFAULT 1,   -- iyimser kilit sürümü (çakışma kontrolü!)
  guncelleme TEXT DEFAULT (datetime('now')) -- son yazma
);
CREATE TABLE IF NOT EXISTS denemeler (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  sahip TEXT NOT NULL,       -- kimin kaydı (başkası göremez/değiştiremez!)
  tarih TEXT NOT NULL,       -- YYYY-MM-DD
  tur TEXT DEFAULT 'Ders Denemesi', -- Ders Denemesi|Genel Deneme
  yayin TEXT DEFAULT '',     -- yayın adı
  ders TEXT DEFAULT 'Genel', -- ders
  soru INTEGER NOT NULL,     -- soru sayısı
  dogru INTEGER NOT NULL,    -- doğru
  yanlis INTEGER NOT NULL,   -- yanlış
  bos INTEGER NOT NULL,      -- boş
  net REAL NOT NULL,         -- hesaplanmış net (kuralıyla)
  kural TEXT DEFAULT '4y1d', -- 4y1d|3y1d|yok (kayıt anındaki kural, değişmez!)
  olusturma TEXT DEFAULT (datetime('now')) -- kayıt zamanı
);
CREATE TABLE IF NOT EXISTS sinav_havuzu (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  ders TEXT NOT NULL,        -- hangi ders
  ekleyen TEXT NOT NULL,     -- hangi öğretmen
  veri_sifreli TEXT NOT NULL, -- AES ile kilitli soru metni
  iv TEXT NOT NULL,          -- şifreleme sayısı
  etiket TEXT NOT NULL,      -- doğrulama etiketi
  metin_hash TEXT NOT NULL,  -- hızlı ön eleme hash'i
  tarih TEXT DEFAULT (datetime('now')) -- ne zaman
);
CREATE TABLE IF NOT EXISTS notlar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  sahip TEXT NOT NULL,       -- kimin notu (OTURUMDAN gelir, istemciden asla!)
  baslik TEXT NOT NULL,      -- başlık (zorunlu)
  icerik TEXT DEFAULT '',    -- düz metin içerik (HTML olarak YORUMLANMAZ)
  ders TEXT DEFAULT '',      -- isteğe bağlı ders/kategori
  tarih TEXT DEFAULT '',     -- isteğe bağlı ilişkili gün (YYYY-AA-GG) ya da ''
  renk TEXT DEFAULT 'sari',  -- etiket rengi anahtarı (sari|yesil|mavi|kirmizi|mor|gri)
  sabit INTEGER DEFAULT 0,   -- 1=üstte sabitlenmiş
  olusturma TEXT DEFAULT (datetime('now')), -- oluşturma zamanı
  guncelleme TEXT DEFAULT (datetime('now')) -- son güncelleme zamanı
);
CREATE INDEX IF NOT EXISTS idx_notlar_sahip ON notlar(sahip); -- sahibine göre hızlı liste
CREATE TABLE IF NOT EXISTS vakalar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  tur TEXT NOT NULL,         -- gonderi|yorum|mesaj|soru
  hedef_id INTEGER NOT NULL, -- hangi içerik
  yazar TEXT NOT NULL,       -- kim yazdı
  kategori TEXT NOT NULL,    -- AI kategorisi
  skor REAL NOT NULL,        -- risk skoru
  guven REAL NOT NULL,       -- AI eminliği
  gerekce TEXT DEFAULT '',   -- kısa Türkçe gerekçe (müdüre gösterilir, öğrenciye gösterilmez)
  kanit TEXT DEFAULT '[]',   -- kanıt parçaları (JSON)
  durum TEXT DEFAULT 'bekliyor', -- bekliyor|yayinda|engellendi|kaldirildi|yanlis-alarm
  itiraz TEXT DEFAULT '',    -- öğrenci itirazı
  karar_veren TEXT DEFAULT '', -- kim karar verdi
  karar_tarih TEXT DEFAULT '', -- ne zaman
  olusturma TEXT DEFAULT (datetime('now')), -- ne zaman düştü
  sla_son TEXT DEFAULT ''    -- karar son tarihi (24 saat)
);
`);

// --- Kütüphane (kaynak destekli ders içerikleri): özet/index/öneri/AI getirimi için ---
// GİZLİ SINAV HAVUZU ile KARIŞMAZ: sınav soruları/cevap anahtarı burada TUTULMAZ (bkz. ai/havuz.js).
db.exec(`
CREATE TABLE IF NOT EXISTS kutuphane (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- sıra no
  icerik_id TEXT UNIQUE NOT NULL,   -- KALICI içerik kimliği (ör. mat-ikinci-derece-001)
  baslik TEXT NOT NULL,             -- başlık
  ozet TEXT DEFAULT '',             -- kısa açıklama
  ders TEXT DEFAULT '',             -- ders (Matematik, Fen, ...)
  sinif TEXT DEFAULT '',            -- sınıf düzeyi ('', '9', '10', ...)
  konu_id TEXT DEFAULT '',          -- konu taksonomi kimliği (ör. mat-ikinci-derece-denklem)
  konu TEXT DEFAULT '',             -- konu okunur adı
  desen TEXT DEFAULT '',            -- soru deseni kimliği (ör. ikinci-derece-denklem)
  zorluk TEXT DEFAULT 'orta',       -- kolay|orta|zor
  tur TEXT DEFAULT 'konu_ozeti',    -- konu_ozeti|cozum|soru_deseni
  soru TEXT DEFAULT '',             -- örnek soru (varsa)
  ipucu TEXT DEFAULT '',            -- yol gösterici ipucu (tam cevap değil)
  adimlar TEXT DEFAULT '[]',        -- izlenecek adımlar (JSON dizi)
  cevap TEXT DEFAULT '',            -- çözüm sonucu (yayında gösterilir)
  etiketler TEXT DEFAULT '[]',      -- etiketler (JSON dizi)
  anahtar TEXT DEFAULT '',          -- arama için normalleştirilmiş anahtar metin
  kaynak_ad TEXT DEFAULT '',        -- kaynağın adı (uydurulmaz: gerçek/etiketli)
  kaynak_url TEXT DEFAULT '',       -- kaynak bağlantısı (varsa)
  lisans TEXT DEFAULT '',           -- lisans (ör. CC BY-SA 4.0, kurum içi)
  surum INTEGER DEFAULT 1,          -- sürüm numarası (artımlı)
  kalite REAL DEFAULT 0.5,          -- yayın kalitesi 0-1 (elle/incelemeyle)
  durum TEXT DEFAULT 'taslak',      -- taslak|incelemede|yayinda|gizli|silindi
  sahip TEXT DEFAULT '',            -- yükleyen kullanıcı
  dogrulayan TEXT DEFAULT '',       -- inceleyip yayınlayan (boşsa DOĞRULANMAMIŞ)
  dogrulama_tarihi TEXT DEFAULT '', -- doğrulama zamanı
  ornek INTEGER DEFAULT 0,          -- 1=başlangıç seti (kurgusal, DOĞRULANMAMIŞ)
  gorunum TEXT DEFAULT 'herkes',    -- herkes|kurum (erişim kapsamı)
  olusturma TEXT DEFAULT (datetime('now')),
  guncelleme TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kutuphane_durum ON kutuphane(durum);
CREATE INDEX IF NOT EXISTS idx_kutuphane_ders ON kutuphane(ders);
CREATE INDEX IF NOT EXISTS idx_kutuphane_konu ON kutuphane(konu_id);
CREATE INDEX IF NOT EXISTS idx_kutuphane_desen ON kutuphane(desen);

CREATE TABLE IF NOT EXISTS konular (
  konu_id TEXT PRIMARY KEY,         -- kalıcı konu kimliği
  ad TEXT NOT NULL,                 -- okunur konu adı
  ders TEXT DEFAULT '',             -- ait olduğu ders
  ust_id TEXT DEFAULT '',           -- üst konu (ağaç)
  esanlam TEXT DEFAULT '[]'         -- eşanlam/yazım varyantları (JSON dizi)
);
CREATE INDEX IF NOT EXISTS idx_konular_ders ON konular(ders);

-- Arama indeksi: Türkçe duyarlı FTS5 (aksi belirtilmedikçe yalnız YAYINDA içerik indekslenir)
CREATE VIRTUAL TABLE IF NOT EXISTS kutuphane_fts USING fts5(
  baslik, govde, etiket, tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS ilgi_sinyalleri (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kullanici TEXT NOT NULL,          -- kullanıcı adı (oturumdan)
  icerik_tur TEXT DEFAULT 'kutuphane', -- kutuphane|gonderi|konu|genel
  icerik_id TEXT DEFAULT '',        -- hedef içerik (genel/kapat için '')
  sinyal TEXT NOT NULL,             -- begen|kaydet|ilgilenmiyorum|daha-fazla|konu-sec|kapat|ac
  ders TEXT DEFAULT '',             -- kolay puanlama için kopya alanlar
  konu_id TEXT DEFAULT '',
  desen TEXT DEFAULT '',
  agirlik REAL DEFAULT 1,           -- sinyal ağırlığı
  tarih TEXT DEFAULT (datetime('now')),
  UNIQUE(kullanici, icerik_tur, icerik_id, sinyal) -- aynı sinyal tek satır (şişme yok)
);
CREATE INDEX IF NOT EXISTS idx_ilgi_kullanici ON ilgi_sinyalleri(kullanici, sinyal);

CREATE TABLE IF NOT EXISTS oneri_gecmis (
  kullanici TEXT NOT NULL,          -- kim gördü
  icerik_id TEXT NOT NULL,          -- neyi gördü
  gorulme INTEGER DEFAULT 1,        -- kaç kez gösterildi
  tarih TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (kullanici, icerik_id) -- tekil (gösterim sayısı şişmez)
);

-- Yeniden başlatmaya dayanıklı indeksleme işleri (yinelenensiz + sınırlı deneme)
CREATE TABLE IF NOT EXISTS kutuphane_isler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tur TEXT NOT NULL,                -- indeksle|sil
  icerik_id TEXT NOT NULL,          -- hedef içerik kimliği
  durum TEXT DEFAULT 'bekliyor',    -- bekliyor|basarili|basarisiz
  deneme INTEGER DEFAULT 0,         -- kaç kez denendi (azami 3)
  hata TEXT DEFAULT '',             -- hata sınıfı (İÇERİK yazılmaz!)
  olusturma TEXT DEFAULT (datetime('now')),
  guncelleme TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kutuphane_isler_durum ON kutuphane_isler(durum);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kutuphane_isler_tekil
  ON kutuphane_isler(icerik_id, tur) WHERE durum = 'bekliyor'; -- yinelenen iş açılmaz

CREATE TABLE IF NOT EXISTS kutuphane_ice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  yukleyen TEXT DEFAULT '',         -- içe aktaran
  bicim TEXT DEFAULT 'json',        -- json|csv
  toplam INTEGER DEFAULT 0,         -- gelen kayıt
  eklenen INTEGER DEFAULT 0,        -- yeni eklenen
  yinelenen INTEGER DEFAULT 0,      -- yinelenen (atlandı)
  hatali INTEGER DEFAULT 0,         -- doğrulama hatası
  durum TEXT DEFAULT 'onizleme',    -- onizleme|uygulandi
  tarih TEXT DEFAULT (datetime('now'))
);
`);

module.exports = db; // diğer dosyalar kullansın

// Tek işlem paketi: hepsi olur ya da hiçbiri (yarım kayıt kalmaz)
db.islem = fn => (...args) => {
  db.exec("BEGIN"); // başlat
  try { const sonuc = fn(...args); db.exec("COMMIT"); return sonuc; } // hepsi tamam
  catch (e) { db.exec("ROLLBACK"); throw e; } // birinde hata: geri al
};

// --- Sonradan eklenen alanlar (eski veritabanını bozmadan) ---
try { db.exec("ALTER TABLE kullanicilar ADD COLUMN rozetler TEXT DEFAULT '[]'"); } catch { /* sütun zaten varsa geç */ }
try { db.exec("ALTER TABLE kullanicilar ADD COLUMN sifre_surum INTEGER DEFAULT 0"); } catch { /* sütun zaten varsa geç */ }
try { db.exec("ALTER TABLE gonderiler ADD COLUMN durum TEXT DEFAULT 'yayinda'"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE yorumlar ADD COLUMN durum TEXT DEFAULT 'yayinda'"); } catch { /* varsa geç */ }
// Aşama-1 göçleri: her içerik türünde yayın durumu + vaka öğretmeni + hesap kökeni + havuz anahtar sürümü
try { db.exec("ALTER TABLE yanitlar ADD COLUMN durum TEXT DEFAULT 'yayinda'"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE odalar ADD COLUMN durum TEXT DEFAULT 'yayinda'"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE oda_mesajlari ADD COLUMN durum TEXT DEFAULT 'yayinda'"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE hoca_sorulari ADD COLUMN denetim TEXT DEFAULT 'yayinda'"); } catch { /* varsa geç (iş akışı 'durum'dan ayrı tutulur) */ }
try { db.exec("ALTER TABLE vakalar ADD COLUMN ogretmen TEXT DEFAULT ''"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE kullanicilar ADD COLUMN kok TEXT DEFAULT 'kayit'"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE sinav_havuzu ADD COLUMN key_no INTEGER DEFAULT 1"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE calisma_programi ADD COLUMN surum INTEGER DEFAULT 1"); } catch { /* varsa geç (çakışma kontrolü) */ }
try { db.exec("ALTER TABLE mesajlar ADD COLUMN durum TEXT DEFAULT 'yayinda'"); } catch { /* varsa geç (moderasyon-yanıt ayrımı) */ }
try { db.exec("ALTER TABLE mesajlar ADD COLUMN uretim TEXT DEFAULT ''"); } catch { /* varsa geç (retry tekilliği) */ }
try { db.exec("ALTER TABLE takipler ADD COLUMN durum TEXT DEFAULT 'kabul'"); } catch { /* varsa geç (eski takipçiler kabul sayılır) */ }
// İstek tekilliği durum makinesi: işlemde/başarılı/başarısız + önceki GERÇEK yanıt (yanlış başarı verme!)
try { db.exec("ALTER TABLE istek_kimlik ADD COLUMN durum TEXT DEFAULT 'basarili'"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE istek_kimlik ADD COLUMN kod INTEGER DEFAULT 0"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE istek_kimlik ADD COLUMN cevap TEXT DEFAULT ''"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE istek_kimlik ADD COLUMN govde TEXT DEFAULT ''"); } catch { /* varsa geç (aynı kimlik farklı gövdeyle reddedilsin) */ }
try { db.exec("ALTER TABLE istek_kimlik ADD COLUMN guncelleme TEXT DEFAULT ''"); } catch { /* varsa geç (süresi dolanları temizle) */ }
// AI üretim kaydı: kullanıcı + sohbet + içerik bağı (aynı kimlik farklı sohbet/içerikte kullanılamaz!)
try { db.exec("ALTER TABLE ai_kullanim ADD COLUMN sohbet_id INTEGER DEFAULT 0"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE ai_kullanim ADD COLUMN icerik_hash TEXT DEFAULT ''"); } catch { /* varsa geç */ }
try { db.exec("ALTER TABLE ai_kullanim ADD COLUMN durum TEXT DEFAULT 'basarili'"); } catch { /* varsa geç (islemde|basarili|basarisiz) */ }
// Tohum hesapları işaretle (üretimde demo girişi kapatılabilsin; kullanıcı verisi silinmez)
try {
  db.prepare(`UPDATE kullanicilar SET kok='seed' WHERE ad IN
    ('admin','mudur1','mudur2','AyseHoca','MehmetHoca','ZeynepHoca','Ali','Elif','Can','Deniz','Ece','Fikret','Gül','Hakan','Irmak','Kerem')
    AND (kok IS NULL OR kok='kayit')`).run();
} catch { /* tablo yoksa geç */ }
try { db.exec("CREATE UNIQUE INDEX uq_sikayet ON sikayetler(bildiren, hedefId)"); } catch { /* varsa ya da çakışan kayıt varsa geç (uygulama yine engeller) */ }
