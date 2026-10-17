# Düzce FENTEK Ödev Destek

Eğitim paylaşımı, soru-cevap, kişisel notlar, program, AI destekli denetim, kütüphane/öneriler ve video çözüm akışları içeren yerel uygulama.

## Dizinler
- backend: Node.js API, SQLite, testler ve AI/video modülleri.
- odev-destek: web arayüzü.
- EKSIKLER.md: doğrulanmış eksikler ve doğrulama sınırları.
- OPEN-CODE-PROMPT.md: aşamalı geliştirme görevi.

## Yerel kurulum
1. node:sqlite destekleyen Node.js sürümünü kullanın (başlatıcı en az 22 kontrol ediyor; kullandığınız sürümde desteği doğrulayın).
2. backend klasöründe npm ci çalıştırın.
3. backend/.env.example dosyasını backend/.env olarak kopyalayın; örnek JWT_SECRET ve SINAV_KEY değerlerini güçlü, bağımsız rastgele anahtarlarla değiştirin.
4. Kök dizindeki baslat-backend.bat ile başlatın veya backend klasöründe npm start çalıştırın.
5. Varsayılan adres http://127.0.0.1:3001. Başlatıcı kapanırsa yerel sunucu da durur.

Gerçek kullanıcı verisi bu kopyaya dahil değildir. Seed yalnız ayrı geliştirme ortamında bilinçli olarak kullanılmalıdır; demo hesapları üretime taşımayın. AI anahtarları ve video analiz bağımlılıkları ayrıca yapılandırılır. OCR dil verisi bu teslimde yoktur; gerçek OCR kullanımı için tesseract.js dil verisi erişimini ve çevrimdışı kullanım gerekiyorsa yerel kurulumu doğrulayın.

## Testler
backend klasöründe npm run test:all. Testleri ayrı geliştirme kopyasında çalıştırın. Son denetimde 120 otomatik test geçti; gerçek model/video analizi ve bütün tarayıcı akışları bununla doğrulanmış sayılmaz.

## Teslim kapsamı
Bu kopya kaynak kodu, kilit dosyası, örnek ayarlar, testler ve başlangıç betiklerini içerir. Gerçek .env, kullanıcı veritabanları, yüklenen videolar, loglar, eski yedekler, node_modules ve önceki Git geçmişi dahil edilmez. GitHub'a yüklemek uygulamayı internette çalışır hale getirmez; barındırma ayrıca yapılır.
