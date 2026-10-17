# Eksikler ve doğrulama sınırları — 18 Ekim 2026

Son izole denetimde ana uygulama 59, kütüphane/öneri 19, video akışı 42 test geçti. Bu sonuç gerçek model, gerçek video analizi veya tüm arayüzün çalıştığını kanıtlamaz.

| Öncelik | Durum | Yapılacak iş |
|---|---|---|
| P1 | AI moderasyonunda llmAcik=false. Eğitim asistanında RAG açık, görünür mod deneme. | Gerçek sağlayıcı entegrasyonunu ayrı ayrı doğrula; kapalı/hatalı durumları dürüstçe göster. |
| P1 | Denetim ortamında FFmpeg bulunamadı; video testleri kontrollü sağlayıcılarla çalıştı. | Gerçek ses çözümleme, kare analizi ve Türkçe moderasyonu uçtan uca doğrula. Tamamlanmayan analiz videoyu yayınlamasın. |
| P1 | Windows güvenlik duvarı açık; Node.js Public ağ izinleri duruyor. Sunucu kodu varsayılan loopback. | Gerçek dinleme adresini ve gerekli ağ kapsamını doğrula; gereksiz izinleri kullanıcıyla değerlendir. |
| P1 | Canlı tarayıcıda bütün butonlar ve responsive akışlar henüz doğrulanmadı. | Masaüstü/mobil işlev envanteri çıkar, hataları kanıtla ve düzelt. |
| P2 | Başlangıç kütüphanesi 25 konu/24 içerik. | Kaynağı ve kullanım hakkı belli, öğretmen onaylı içerikle kapsamı artır. |
| P2 | Aramanın ve önerilerin gerçek kullanıcı kalitesi ölçülmedi. | Türkçe sorgu seti, sıralama ölçümleri, çeşitlilik ve olumsuz tercih testleri ekle. |
| P1 | Kaynak backend .gitignore veritabanı yan dosyalarını ve video deposunu kapsamıyordu. | Bu teslim kopyasında genişletilmiş kök .gitignore var; asıl projeye de uygula. |

Önceden bulunan kullanıcılar arası öneri imleci, gizli/silinmiş içeriğin önbellekten dönmesi, misafir kapsamı ve ilgilenmiyorum sorunları son 19 testte giderilmiş göründü; regresyon testleri korunmalı.

Bu liste doğrulanmış eksikleri ve henüz yapılmamış doğrulamaları ayırır. Kapsamlı sızma testi veya güvenlik garantisi değildir.
