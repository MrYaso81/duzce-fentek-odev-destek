# Düzce FENTEK Ödev Destek — Backend

Kayıt/giriş + roller. Veritabanı: SQLite (ücretsiz, `odevagi.db` tek dosya).

## Kurulum (bir kez)
1. Node.js kur (nodejs.org, LTS).
2. Bu klasörde: `npm install`
3. Örnek veriler: `npm run seed`
   - admin/admin123, mudur1/mudur123, mudur2/mudur123
   - AyseHoca, MehmetHoca (onaylı), ZeynepHoca (onay bekliyor) / hoca123
   - 10 öğrenci (Ali, Elif, Can...) / 1234

## Çalıştırma
`npm start` → http://localhost:3001
Sağlık: http://localhost:3001/api/saglik

### Windows'ta kolay başlatma (çift tık)
Proje kökündeki `baslat-backend.bat` dosyasına çift tıkla. Betik; Node sürümünü, gerekli
paketleri, zorunlu `.env` ayarlarını (değerleri ekrana yazmadan) ve portu DENETLER.
Uygulama zaten çalışıyorsa YENİDEN BAŞLATMAZ (yeniden kullanır); port başka bir program
tarafından tutuluyorsa NET hata verir (ilgisiz süreçleri DURDURMAZ); sunucu sağlık ucu
yanıt verince tarayıcıyı açar. Pencereyi kapatınca yerel site durur. `.env` dosyasına
DOKUNMAZ; otomatik seed/sıfırlama yapmaz.
Yalnız denetim için: `baslat-backend.bat -SadeceKontrol` (tarayıcı açılmaz)

## Uçlar (hepsi JSON, Türkçe hata)
- POST /api/kayit {ad, sifre, rol:"ogrenci"|"ogretmen", brans?, sinif?, kurallar:true}
- POST /api/giris {ad, sifre} → {bilet, ad, rol, puan}
- GET /api/ben (Başlık: Authorization: Bearer BİLET)
- GET /api/hocalar (herkese açık, cevap sayılı)
- Akış: GET /api/gonderiler?... • POST /api/gonderiler • PUT/DELETE /api/gonderiler/:id
- POST /api/gonderiler/:id/begen • .../kaydet • GET /api/kaydettiklerim
- Yorum: POST /api/gonderiler/:id/yorumlar • POST /api/yorumlar/:id/yanitlar • POST /api/yorumlar/:id/en-iyi
- POST /api/sikayet (tekrar engelli, otomatik ceza yok)
- Bildirim: GET /api/bildirimler • POST /api/bildirimler/okundu
- GET /api/liderlik • GET /api/kullanicilar/:ad • POST /api/takip • GET /api/takip
- Hocaya Sor: POST+GET /api/hoca-sorulari • POST .../:id/cevap • .../puan • .../paylas • .../kapat
- Şifre: POST /api/sifre-degistir • POST /api/sifre-unuttum (e-postasız, dürüst mesaj) • POST /api/admin/sifre-sifirla
- Odalar: GET/POST /api/odalar • GET/POST /api/odalar/:id/mesajlar • DELETE /api/odalar/:id
- E-Karne/Program (hesap başına, sahiplikli): GET/PUT /api/program (sürümlü, 409 çakışma) • GET/POST /api/denemeler • PUT/DELETE /api/denemeler/:id • POST /api/denemeler/ice-aktar
- Sohbet (hesap başına): GET/POST /api/sohbet • PUT/DELETE /api/sohbet/:id • GET /api/sohbet/:id/mesajlar • POST /api/sohbet/:id/mesaj (SSE akışlı)
- Denetim: GET /api/denetim/vakalar • POST /api/denetim/vakalar/:id/karar • GET /api/ogretmen/vakalar • GET /api/vakalarim • POST /api/vakalar/:id/itiraz
- Havuz: GET/POST /api/havuz • DELETE /api/havuz/:id (onaylı öğretmen; SINAV_KEY şart, yoksa 503)
- Bilgi: GET /api/dersler • GET /api/ai-durum (kural/model dürüst rozeti) • GET /api/liderlik
- Admin: GET /api/admin/kullanicilar • GET /api/admin/sikayetler • POST /api/admin/sikayet/:id/cozum {aksiyon:"reddet"|"kaldir"} • POST /api/admin/hoca-onay • POST /api/admin/aski

## Test (`npm test`, ayrı test veritabanı)
`npm test` → `test-odevagi.db` dosyasını kurar, 3131 kapısında e2e çalıştırır, bitince siler.
Gerçek `odevagi.db` dosyasına DOKUNMAZ. Kapsam: kayıt→giriş→soru→yorum→en iyi→puan→bildirim,
tekrar şikayet/puan engeli, puan taşıma, askıdaki oturum, yetkisiz soru, geçersiz kimlik, XSS kaçışı.
Beklenen: 9/9 geçti.

## AI denetçi (`npm run eval`, 304 örnek + `node ai-eval/bagimsiz-kos.js` 41 bağımsız örnek)
`ai/` klasörü: kural filtresi (config/etik.js) + TF-IDF benzerlik + şifreli sınav havuzu + OCR + karar birleştirme.
`ai-eval/ornekler.json`: 304 kurgusal Türkçe örnek = REGRESYON kümesi (gerçek öğrenci verisi YOK, genel doğruluk kanıtı değil!).
`ai-eval/bagimsiz.json`: 41 ayrı örnek (`node ai-eval/bagimsiz-kos.js` ile koşar; geliştirmede kullanıldı, bağımsız başarı kanıtı sayılmaz).
`npm run eval` → her kategori precision/recall/F1 + yanlış alarmlar. Hedefler: sızıntı/anahtar recall ≥%95, temiz FP ≤%3.
`guven` alanı KALİBRE EDİLMEMİŞ yakınlık ölçüsüdür (doğruluk olasılığı değil!).
LLM katmanı KAPALI (API anahtarı yok, ücretli olabilir — açmadan onay al). `GET /api/ai-durum` mod söyler.
pHash için sharp gerekir (derlenemedi, tam-hash + OCR benzerliği kullanılıyor).
Yerel BERTurk eğitimi yapılmadı (opsiyonel, ayrı iş).
Desteklenen Node: v22+ (node:sqlite gömülü; 24.20.0 ile doğrulandı).

## Notlar
- Şifreler bcrypt ile gizlenir, aslı saklanmaz.
- Hoca kaydı onaysız başlar, admin onaylar. Onaysız hoca havuza yazamaz.
- Giriş/kayıtta 15 dk'da 30 deneme sınırı, yazma işlerinde dakikada 60 sınır var.
- JWT_SECRET yoksa sunucu başlamaz (güvenli varsayılan yok).
- SINAV_KEY yoksa havuz kapalıdır (503) ve içerikler incelemede bekler (fail-safe).
- URETIM=1 ise seed çalışmaz, tohum (demo) hesaplar giremez.
- KOKENLER virgüllü listeyse CORS onunla sınırlanır (örn. KOKENLER=https://okul.edu.tr).
- SINAV_KEY_ESKI: anahtar değişiminde eski anahtarlar (virgüllü) — eski kayıtlar okunabilir kalır.
- OCR sınırları: OCR_KUYRUK_MAX=4 (bekleyen), OCR_KULLANICI_MAX=2 (kullanıcı başına); istek başına toplam 8sn.
- Sohbet: SOHBET_GUNLUK=30 (kullanıcı başına günlük soru); bağlam son 20 mesaj; yanıt ≤1500 harf.
- Şifre unutma e-postası GÖNDERİLMEZ (SMTP bağlı değil; nodemailer gerekir). Yönetici sıfırlar.
- `.env` dosyanı kimseyle paylaşma. `.gitignore` node_modules, .env, *.db dosyalarını Git'ten korur.
- Geri alma: `yedek-*/` klasöründeki .js dosyalarını geri kopyala, .db dosyasını geri koy, `npm start`.
  Sütun ekleyen göçler geriye dönük uyumludur (ALTER IF NOT EXISTS mantığı).
