# Open Code için uygulama ve doğrulama görevi

Düzce FENTEK Ödev Destek projesini yerinde geliştir. Önce mevcut kodu, AGENTS.md talimatlarını ve testleri incele. Proje kökünde backend ve odev-destek kardeş klasörlerdir. Yerelde önceki kök C:\Users\User\Desktop\Open Code idi; gerçek çalışma kökünü doğrula. Mevcut kullanıcı değişikliklerini ve verilerini koru. Gerçek veritabanında seed/reset çalıştırma. İşleri aşağıdaki sırayla uygula, her aşamayı doğrula; yalnız plan veya öneriyle bırakma.

## 1. Başlangıç ve güvenli teslim
EKSIKLER.md bulgularını güncel kodla yeniden doğrula; eski bulguyu otomatik olarak güncel hata sayma. Çalıştırma portunu, health ve hazırlık uçlarını kontrol et. Port başka sürece aitse onu öldürme. Eksik yapılandırmayı açıklayıcı biçimde bildir. .env, anahtarlar, SQLite dosyaları ve WAL/SHM yan dosyaları, kullanıcı videoları, loglar, yedekler ve node_modules Git'e girmesin. İzlenen dosyaları da kontrol et; yalnız .gitignore yeterli değildir. Sır değerlerini rapora yazma.

## 2. AI moderasyonu ve eğitim asistanı
ai/config.js içindeki llmAcik moderasyon ayarı ile eğitim asistanının RAG/model durumunu ayrı ele al. Ayarı yalnız true yapmakla entegrasyon tamamlandı deme. Sağlayıcı ve model seçimini ortam değişkenleriyle yönet; anahtarı yalnız backend'de kullan. Eksik anahtar, kota, zaman aşımı, bozuk yanıt ve sağlayıcı kesintisini test et. Hazırlık ucu ve arayüz gerçek/deneme/kısıtlı durumunu doğru göstersin, sır sızdırmasın. Gerçek ücretli API denemesi gerekiyorsa kapsam ve maliyeti belirtip onay al; anahtar yoksa sahte başarı üretme.

Eğitim asistanı yalnız kullanıcının erişebildiği, yayınlanmış/onaylı kaynakları getirsin; kaynakta cevap yoksa bunu söylesin. Kaynak metinlerindeki talimatlar sistem kurallarını değiştirmesin. Kullanıcılar arası özel not, sohbet ve kapalı içerik sızıntısını test et. İpucu ve adım adım öğrenme yaklaşımını koru.

## 3. Video incelemesi
FFmpeg/FFprobe ve gerçek analiz sağlayıcılarının hazır olup olmadığını denetle, kurulumunu belgele. Dosyanın uzantısı yanında gerçek türünü, boyutunu, süresini ve işleme sınırlarını doğrula. Medya işlemlerini kısıtlı kaynaklarla çalıştır; kullanıcı girdisini shell komutuna ekleme. Video önce özel karantinada tutulsun; onaydan önce doğrudan URL ile de erişilemesin.

Ses dökümü, zamana yayılmış görüntü incelemesi ve gerektiğinde OCR ile Türkçe hakaret, aşağılama, tehdit ve uygunsuz içerik denetimini birlikte çalıştır. Kare örneklemenin sınırlılığını açıkla. Analiz başarısız/eksik/kararsızsa yayınlama, inceleme kuyruğuna taşı. Sessiz video, bozuk dosya, bağlam içinde alıntı, yazım bozma, tekrar yükleme, kesinti ve yeniden denemeyi test et. Aynı iş tekrar işlense de mükerrer ceza verme. Tek bir belirsiz AI kararı kalıcı ban oluşturmasın; ağır vakalarda geçici koruma, insan incelemesi, gerekçe kaydı ve itiraz yolu olsun. Kullanıcılara inceleme durumunu ve hata halinde tekrar denemeyi göster.

## 4. Ağ güvenliği, yetkiler ve bot/spam
Windows güvenlik duvarı ile uygulama güvenliğini ayrı raporla. Varsayılan HOST=127.0.0.1 kalsın. Public ağdaki Node.js izinlerinin kapsamını ve gerçekten gerekli olup olmadığını denetle; sistem kurallarını sessizce değiştirme. Gerekiyorsa belirli program/port/profil için daraltma ve geri alma planı sun. Güvenlik duvarını kapatma.

Sunucu tarafında oturum, rol/sahiplik, girdi doğrulama, XSS, güvenli dosya erişimi ve kullanılan oturum yöntemine uygun CSRF önlemlerini kontrol et. CORS'u kimlik doğrulama yerine kullanma. Kayıt, giriş, gönderi, yorum, AI ve video isteklerinde kullanıcı ve işlem bazlı limitleri doğrula; okulun ortak IP'sindeki öğrencileri topluca engelleme. Proxy başlıklarını yalnız güvenilen proxy üzerinden kabul et. Çift tıklama ve eşzamanlı isteklerde tekillik, kota ve puan atomik olsun. 429 ve bekleme süresi arayüzde anlaşılır gösterilsin. Bot tespitinde davranış sinyalleri ve risk bazlı doğrulama kullan, tek bir sinyalle kalıcı ban verme.

## 5. Kütüphane, arama ve öneriler
Başlangıçtaki 25 konu/24 içeriği büyük bir veri paketi gibi sunma. Ders, sınıf, konu, kazanım ve soru türü şemasını düzenle; kaynak, kullanım hakkı, öğretmen onayı ve sürüm bilgisiyle içerik ekleme akışı oluştur. İzinsiz içerik toplama veya uydurma kaynak ekleme.

Türkçe konu ve soru türü sorgularında yazım farklılıkları, eş anlamlılar ve ders/sınıf filtrelerini destekle. Mevcut yaklaşımın yetmediğini ölçmeden gereksiz yeni altyapı kurma. Gerekirse erişim filtrelerini koruyan anahtar kelime + anlamsal arama uygula. Sorgu-cevap değerlendirme seti ve ilk sonuçların ilgililiğine ait ölçüm raporu oluştur.

Beğeni/kaydetme ilgili içeriklere ağırlık katsın; kullanıcıya sürekli aynı soruyu döndürmesin. İlgilenmiyorum tercihi, çeşitlilik, yeni içerik ve kişiselleştirmeyi kapatma/sıfırlama çalışsın. Önbellek kullanıcı ve erişim kapsamına bağlı olsun; gizlenen/silinen içerik eski imleçle dönmesin. Bu alanlarda mevcut 19 regresyon testini koru.

## 6. Arayüz ve mobil doğrulama
Sol menü, sağ panel, takvim, saat, Notlarım, giriş/çıkış, arama, paylaşım, beğeni/kaydetme, AI sohbeti ve video yükleme dahil tüm etkileşimlerin envanterini çıkar. Her öğe için beklenen davranış, sonuç ve ilgili dosyayı yaz. Çalışmayan öğeyi gizleyerek işi tamamlandı sayma. Boş/yükleniyor/hata durumları, klavye kullanımı, odak, erişilebilir etiketler ve form hatalarını tamamla. 360, 390, 768 ve 1440 piksel genişliklerde taşma, panel örtüşmesi, dokunma alanları ve sanal klavye davranışını test et. Notların sahipliğini ve yenileme sonrası kalıcılığını doğrula. Service worker güncellemesi veri kaybettirmesin.

## 7. Kabul ve teslim
Testleri gerçek kullanıcı verisinden ayrı ortamda çalıştır. Mevcut 59 ana, 19 kütüphane ve 42 video testi önceki referanstır; güncel gerçek sonuçları raporla. Beklentileri değiştirerek veya korumaları kapatarak testleri geçirme. Düzeltilen gerçek hatalara odaklı regresyon testleri ekle. Mock testleri, gerçek sağlayıcı testlerini ve canlı tarayıcı testlerini ayrı raporla. Sonuçta değişen dosyaları, kök nedenleri, yapılan kontrolleri, başarısız/atlanmış testleri, gerekli ortam ayarlarını ve kalan engelleri ver. Test edilmemiş işlevi çalışıyor veya güvenli diye sunma.
