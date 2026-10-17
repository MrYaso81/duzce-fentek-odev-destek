// Kütüphane başlangıç verisi: konu taksonomisi + küçük, ETİKETLİ başlangıç içerik seti
// ÖNEMLİ: Bu içerikler KURGUSAL örneklerdir; öğretmen doğrulaması YOKTUR (ornek=1, dogrulayan='').
// Her kayıt gerçek bir kaynak/lisans alanı taşır. Uydurma atıf yapılmaz; kaynak açıkça etiketlenir.
// Gizli sınav havuzu (bkz. ai/havuz.js) ile İLGİSİZDİR: burada sınav sorusu/cevap anahtarı TUTULMAZ.

const BASLANGIC_ETIKET = "Düzce FENTEK başlangıç seti (kurgusal, doğrulanmamış)";
const BASLANGIC_LISANS = "CC0-1.0 (kurgusal eğitim örneği)";

// Konu taksonomisi: kalıcı konu_id + okunur ad + ders + eşanlam/yazım varyantları
const KONULAR = [
  // Matematik
  { konu_id: "mat-bolunebilme", ad: "Bölme ve Bölünebilme Kuralları", ders: "Matematik", esanlam: ["bolunebilme", "bölünebilme kuralları", "bolme kurallari"] },
  { konu_id: "mat-ebob-ekok", ad: "EBOB ve EKOK", ders: "Matematik", esanlam: ["ebob ekok", "ortak bolen", "en kucuk ortak kat"] },
  { konu_id: "mat-birinci-derece-denklem", ad: "Birinci Dereceden Denklemler", ders: "Matematik", esanlam: ["basit denklem", "bir bilinmeyenli denklem", "ax+b=c"] },
  { konu_id: "mat-ikinci-derece-denklem", ad: "İkinci Dereceden Denklemler", ders: "Matematik", esanlam: ["ikinci dereceden denklemler", "kuadratik denklem", "diskriminant", "delta"] },
  { konu_id: "mat-yas-problemleri", ad: "Yaş Problemleri", ders: "Matematik", esanlam: ["yas problemleri", "yaş problemi", "kac yasinda"] },
  { konu_id: "mat-oran-oranti", ad: "Oran ve Orantı", ders: "Matematik", esanlam: ["oran oranti", "dogru oranti", "ters oranti"] },
  { konu_id: "mat-yuzde", ad: "Yüzde Problemleri", ders: "Matematik", esanlam: ["yuzde", "yüzde hesabı", "indirim problemi"] },
  { konu_id: "mat-ucgen", ad: "Üçgenler ve Alan", ders: "Matematik", esanlam: ["ucgen", "üçgen alanı", "pisagor"] },
  // Fen
  { konu_id: "fen-kuvvet-hareket", ad: "Kuvvet ve Hareket", ders: "Fen", esanlam: ["kuvvet hareket", "hiz", "sürat", "yol zaman"] },
  { konu_id: "fen-madde-halleri", ad: "Maddenin Halleri", ders: "Fen", esanlam: ["maddenin halleri", "hal degisimi", "erime donma"] },
  { konu_id: "fen-isik-yansima", ad: "Işık ve Yansıma", ders: "Fen", esanlam: ["isik", "yansima", "ayna", "gelme acisi"] },
  { konu_id: "fen-elektrik", ad: "Elektrik Devreleri", ders: "Fen", esanlam: ["elektrik", "devre", "ohm kanunu", "direnc"] },
  { konu_id: "fen-hucre", ad: "Hücre ve Organeller", ders: "Fen", esanlam: ["hucre", "organel", "mitokondri"] },
  // Türkçe
  { konu_id: "tur-paragraf-ana-dusunce", ad: "Paragrafta Ana Düşünce", ders: "Türkçe", esanlam: ["ana dusunce", "ana fikir", "konu ve ana dusunce"] },
  { konu_id: "tur-paragraf-yardimci", ad: "Paragrafta Yardımcı Düşünce", ders: "Türkçe", esanlam: ["yardimci dusunce", "yardimci fikir"] },
  { konu_id: "tur-sozcukte-anlam", ad: "Sözcükte Anlam", ders: "Türkçe", esanlam: ["sozcukte anlam", "gercek mecaz anlam", "deyim"] },
  { konu_id: "tur-anlatim-bozuklugu", ad: "Anlatım Bozuklukları", ders: "Türkçe", esanlam: ["anlatim bozuklugu", "gereksiz sozcuk", "ozne yuklem uyumsuzlugu"] },
  { konu_id: "tur-noktalama", ad: "Noktalama İşaretleri", ders: "Türkçe", esanlam: ["noktalama", "virgul", "noktali virgul"] },
  // Tarih
  { konu_id: "tar-kurtulus-savasi", ad: "Kurtuluş Savaşı", ders: "Tarih", esanlam: ["kurtulus savasi", "milli mucadele", "sakarya"] },
  { konu_id: "tar-osmanli-kurulus", ad: "Osmanlı Devleti'nin Kuruluşu", ders: "Tarih", esanlam: ["osmanli kurulus", "osman bey", "beylikten devlete"] },
  { konu_id: "tar-inkilaplar", ad: "Atatürk İnkılapları", ders: "Tarih", esanlam: ["inkilaplar", "harf devrimi", "egitim devrimi"] },
  // İngilizce
  { konu_id: "ing-simple-present", ad: "Simple Present Tense", ders: "İngilizce", esanlam: ["simple present", "genis zaman", "present tense"] },
  { konu_id: "ing-irregular-verbs", ad: "Irregular Verbs (Düzensiz Fiiller)", ders: "İngilizce", esanlam: ["duzensiz fiiller", "irregular verbs", "past tense"] },
  { konu_id: "ing-reading", ad: "Reading Comprehension", ders: "İngilizce", esanlam: ["okuma anlama", "reading", "paragraf ingilizce"] },
  // Coğrafya
  { konu_id: "cog-iklim", ad: "İklim ve Hava Olayları", ders: "Coğrafya", esanlam: ["iklim", "hava olaylari", "iklim tipleri"] }
];

// Soru desenleri: sorgu niyetini yakalamak için kalıplar (regex: sadeleştirilmiş metinde aranır)
const DESENLER = [
  { desen: "ikinci-derece-denklem", konu_id: "mat-ikinci-derece-denklem", kaliplar: [/x\s*\^\s*2/, /x2\b/, "ikinci derece", "kuadratik", "diskriminant", "delta"] },
  { konu_id: "mat-birinci-derece-denklem", desen: "birinci-derece-denklem", kaliplar: [/\d+\s*[a-z]?\s*[+\-]\s*\d+\s*=\s*\d+/, /\d+x\s*[+\-]/, "ax b c", "birinci derece denklem"] },
  { konu_id: "mat-yas-problemleri", desen: "yas-problemi", kalip: "soru" },
  { konu_id: "mat-oran-oranti", ad: "oran", desen: "oran-oranti" },
  { konu_id: "mat-yuzde", ad: "yuzde", desen: "yuzde-problemi" },
  { desen: "hiz-hesabi", ders: "Fen" },
  { konu_id: "fen-isik-yansima", desen: "yansima-acisi" },
  { konu_id: "fen-elektrik", desen: "ohm-kanunu" }
];

// Desen özel eşleme: sorgu metninden desen tanıma (normalize edilmiş metin üzerinde çalışır)
const DESEN_KALIPLARI = [
  { desen: "ikinci-derece-denklem", kaliplar: ["ikinci derece", "kuadratik", "diskriminant", "delta", "x2", "x kare"] },
  { desen: "birinci-derece-denklem", kaliplar: ["birinci derece", "basit denklem", "bilinmeyenli denklem"] },
  { desen: "yas-problemi", kaliplar: ["yas problem", "kac yas", "yasinda"] },
  { desen: "oran-oranti", kaliplar: ["oran oranti", "oranti"] },
  { desen: "yuzde-problemi", kaliplar: ["yuzde", "indirim"] },
  { desen: "hiz-hesabi", kaliplar: ["hiz", "surat", "yol zaman", "kuvvet hareket"] },
  { desen: "yansima-acisi", kaliplar: ["yansima", "ayna", "gelme acisi"] },
  { desen: "ohm-kanunu", kaliplar: ["ohm", "direnc", "elektrik devre"] },
  { desen: "ucgen-alan", kaliplar: ["ucgen", "pisagor", "alan"] },
  { desen: "bolunebilme", kaliplar: ["bolunebilme", "bolme kural", "tam bolunme"] },
  { desen: "ebob-ekok", kaliplar: ["ebob", "ekok", "ortak bolen"] }
];

// Başlangıç içerik seti (kurgusal). durum='yayinda' + ornek=1 + dogrulayan='' => açıkça "doğrulanmamış örnek".
const ICERIKLER = [
  {
    icerik_id: "bas-mat-ikinci-derece-001",
    baslik: "İkinci Dereceden Denklemler: Çarpanlara Ayırma ile Çözüm",
    ozet: "İkinci dereceden bir denklemi çarpanlara ayırarak çözmenin adımları ve diskriminantın anlamı.",
    ders: "Matematik", sinif: "10", konu_id: "mat-ikinci-derece-denklem", konu: "İkinci Dereceden Denklemler",
    desen: "ikinci-derece-denklem", zorluk: "orta", tur: "konu_ozeti",
    soru: "x^2 - 5x + 6 = 0 denkleminin köklerini bulunuz.",
    ipucu: "İki sayının çarpımı 6, toplamı -5 olacak şekilde düşün (işaretlere dikkat).",
    cozum_adimlari: ["Denklemi ax^2 + bx + c = 0 biçiminde yaz.", "(x - a)(x - b) çarpanlarını ara: çarpım = c, toplam = -b.", "Her çarpanı sıfıra eşitle ve kökleri bul."],
    cevap: "x = 2 veya x = 3",
    etiketler: ["denklem", "çarpanlara ayırma", "kök"],
    kaynak_ad: BASLANGIC_ETIKET,
    lisans: BASLANGIC_LISANS,
    kalite: 0.6, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-mat-yas-001",
    baslik: "Yaş Problemleri: Denklem Kurma Adımları",
    ozet: "Yaş problemlerinde bilinmeyeni seçip denklem kurma ve çözme yöntemi.",
    ders: "Matematik", sinif: "8", konu_id: "mat-yas-problemleri", konu: "Yaş Problemleri", desen: "yas-problemi",
    zorluk: "orta", tur: "konu_ozeti",
    soru: "Bir annenin yaşı, kızının yaşının 3 katıdır. 5 yıl sonra ikisinin yaşları toplamı 54 ise kız bugün kaç yaşındadır?",
    ipucu: "Kızın bugünkü yaşına x de; annenin bugünkü yaşı 3x olur. 5 yıl sonrasını yaz.",
    adimlar: ["Küçük yaştakine x de", "Büyük yaşı x cinsinden yaz", "'5 yıl sonra' ifadesini her yaşa ekle", "Toplam denklemini çöz"],
    cevap: "Kız bugün 11 yaşındadır.",
    etiketler: ["yaş problemi", "denklem kurma"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.55, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-mat-oran-001",
    baslik: "Oran-Orantı: Doğru Orantı Soru Deseni",
    ozet: "Doğru orantıda iki çokluğun aynı oranda arttığını kullanarak bilinmeyen bulma.",
    ders: "Matematik", sinif: "9", konu_id: "mat-oran-oranti", konu: "Oran ve Orantı", desen: "oran-oranti",
    zorluk: "kolay", tur: "soru_deseni",
    soru: "3 kalem 12 TL ise 7 kalem kaç TL'dir?",
    ipucu: "Önce birim fiyatı bul, sonra istenen adetle çarp.",
    adimlar: ["Oranı yaz (kalem/TL)", "İçler dışlar çarpımı yap", "Bilinmeyeni yalnız bırak"],
    cevap: "28 TL",
    etiketler: ["oran", "orantı", "doğru orantı"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-mat-bolunebilme-001",
    baslik: "Bölünebilme Kuralları: 2, 3, 4, 5, 9 ve 11",
    ozet: "Sayıların basamaklarına bakarak bölünebilirliği hızlı belirleme kuralları.",
    ders: "Matematik", sinif: "9", konu_id: "mat-bolunebilme", konu: "Bölme ve Bölünebilme Kuralları", desen: "bolunebilme",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "3'e bölünmede rakamlar toplamına, 4'te son iki basamağa bak.",
    etiketler: ["bölünebilme", "kural"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-fen-kuvvet-001",
    baslik: "Kuvvet ve Hareket: Sabit Hızlı Hareket",
    ozet: "Yol, hız ve zaman arasındaki ilişkiyi kurma.",
    ders: "Fen", sinif: "7", konu_id: "fen-kuvvet-hareket", konu: "Kuvvet ve Hareket", desen: "hiz-hesabi",
    zorluk: "kolay", tur: "soru_deseni",
    soru: "Sabit 60 km/sa hızla giden bir araç 3 saatte kaç km yol alır?",
    ipucu: "Yol = Hız × Zaman bağıntısını kullan.",
    adimlar: ["Verileri yaz", "Yol = Hız × Zaman", "Birimi kontrol et"],
    cevap: "180 km",
    etiketler: ["hız", "yol", "zaman"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-fen-isik-001",
    baslik: "Işık ve Yansıma: Gelme Açısı Kavramı",
    ozet: "Düzlem aynada gelme açısı ile yansıma açısının eşitliği.",
    ders: "Fen", sinif: "6", konu_id: "fen-isik-yansima", konu: "Işık ve Yansıma", desen: "yansima-acisi",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "Normal, yüzeye dik hayali bir çizgidir; açılar normalle ölçülür.",
    etiketler: ["ışık", "yansıma", "ayna"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-fen-elektrik-001",
    baslik: "Elektrik Devreleri: Ohm Kanunu Uygulaması",
    ozet: "Gerilim, akım ve direnç arasındaki V = I × R bağıntısı.",
    ders: "Fen", sinif: "8", konu_id: "fen-elektrik", konu: "Elektrik Devreleri", desen: "ohm-kanunu",
    zorluk: "orta", tur: "soru_deseni",
    soru: "Direnci 5 ohm olan bir devreden 2 A akım geçiyorsa gerilim kaç volttur?",
    ipucu: "V = I × R bağıntısını yaz.",
    adimlar: ["V = I × R", "Verileri yerine koy", "Birimi yaz (V)"],
    cevap: "10 V",
    etiketler: ["ohm kanunu", "direnç", "akım"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-fen-hucre-001",
    baslik: "Hücre ve Organeller: Temel Görevler",
    ozet: "Temel organellerin görevlerini kısa ve karıştırılmadan ayırt etme.",
    ders: "Fen", sinif: "6", konu_id: "fen-hucre", konu: "Hücre ve Organeller",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "Mitokondriyi 'enerji santrali', ribozomu 'protein fabrikası' olarak düşün.",
    etiketler: ["hücre", "organel", "mitokondri"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-tur-paragraf-001",
    baslik: "Paragrafta Ana Düşünce Nasıl Bulunur?",
    ozet: "Paragrafın bütününü kapsayan yargıyı (ana düşünce) ayırt etme yöntemi.",
    ders: "Türkçe", sinif: "8", konu_id: "tur-paragraf-ana-dusunce", konu: "Paragrafta Ana Düşünce",
    zorluk: "orta", tur: "konu_ozeti",
    ipucu: "'Yazar aslında ne demek istiyor?' sorusuna tek cümleyle cevap ver.",
    adimlar: ["Parçada en çok üzerinde durulanı bul", "Ayrıntıları ayıkla", "Tümünü kapsayan yargıyı seç"],
    etiketler: ["paragraf", "ana düşünce"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-tur-sozcuk-001",
    baslik: "Sözcükte Anlam: Gerçek ve Mecaz Anlam Ayrımı",
    ozet: "Bir sözcüğün cümlede hangi anlamda kullanıldığını belirleme.",
    ders: "Türkçe", sinif: "7", konu_id: "tur-sozcukte-anlam", konu: "Sözcükte Anlam", desen: "sozcuk-anlam",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "Sözcüğü sözlük anlamıyla düşün, cümledeki mecaz anlamla karşılaştır.",
    etiketler: ["sözcükte anlam", "mecaz"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-tur-paragraf-yardimci-001",
    baslik: "Yardımcı Düşünceyi Ayırt Etme",
    ozet: "Ana düşünceyi destekleyen yardımcı düşünceleri ayırma.",
    ders: "Türkçe", sinif: "8", konu_id: "tur-paragraf-yardimci", konu: "Paragrafta Yardımcı Düşünce",
    zorluk: "orta", tur: "konu_ozeti",
    ipucu: "Ana düşünceyi çıkardığında kalan cümleler çoğunlukla yardımcı düşüncelerdir.",
    etiketler: ["paragraf", "yardımcı düşünce"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-tar-kurtulus-001",
    baslik: "Kurtuluş Savaşı: Cephelerin Kronolojisi",
    ozet: "Doğu, Güney ve Batı cephelerinin sırası ve temel özellikleri.",
    ders: "Tarih", sinif: "11", konu_id: "tar-kurtulus-savasi", konu: "Kurtuluş Savaşı",
    zorluk: "orta", tur: "konu_ozeti",
    ipucu: "Olayları tarih sırasına diz; cepheleri 'kim, nerede, sonuç' başlıklarıyla not et.",
    etiketler: ["kurtuluş savaşı", "cephe", "kronoloji"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-tar-osmanli-001",
    baslik: "Osmanlı'nın Kuruluşu: Beylikten Devlete",
    ozet: "Kuruluş döneminde siyasi ve coğrafi koşullar.",
    ders: "Tarih", sinif: "10", konu_id: "tar-osmanli-kurulus", konu: "Osmanlı Devleti'nin Kuruluşu",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "Kuruluşu etkileyen iç ve dış etkenleri ayrı liste yap.",
    etiketler: ["osmanlı", "kuruluş"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-ing-present-001",
    baslik: "Simple Present Tense: Geniş Zaman Kullanımı",
    ozet: "Alışkanlık ve genel doğrular için geniş zaman kullanımı ve -s eki.",
    ders: "İngilizce", sinif: "5", konu_id: "ing-simple-present", konu: "Simple Present Tense", desen: "zaman-kullanimi",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "He/She/It öznelerinde fiile -s eklemeyi unutma.",
    etiketler: ["present tense", "geniş zaman"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-ing-irregular-001",
    baslik: "Irregular Verbs: En Sık Kullanılan Düzensiz Fiiller",
    ozet: "go/went/gone gibi fiillerin üç hâlini akılda tutma yolları.",
    ders: "İngilizce", sinif: "7", konu_id: "ing-irregular-verbs", konu: "Irregular Verbs (Düzensiz Fiiller)",
    zorluk: "orta", tur: "konu_ozeti",
    ipucu: "Fiilleri ses tekrarına göre gruplayarak ezberle (ör. sing-sang-sung).",
    etiketler: ["irregular verbs", "düzensiz fiiller"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-cog-iklim-001",
    baslik: "İklim ve Hava Olayları: Ayrım ve Etkenler",
    ozet: "Hava durumu ile iklim arasındaki fark ve iklimi etkileyen etkenler.",
    ders: "Coğrafya", sinif: "9", konu_id: "cog-iklim", konu: "İklim ve Hava Olayları",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "Kısa süreli olan hava durumu, uzun yılların ortalaması iklimdir.",
    etiketler: ["iklim", "hava olayları"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-mat-birinci-derece-001",
    baslik: "Birinci Dereceden Denklem Çözme Adımları",
    ozet: "2x + 3 = 11 gibi bir bilinmeyenli denklemlerde denge yöntemiyle çözüm.",
    ders: "Matematik", sinif: "7", konu_id: "mat-birinci-derece-denklem", konu: "Birinci Dereceden Denklemler",
    desen: "birinci-derece-denklem", zorluk: "kolay", tur: "cozum",
    soru: "2x + 3 = 11 ise x kaçtır?",
    ipucu: "Her iki taraftan aynı sayıyı çıkar/ekle; sonra katsayıya böl. Eşitlik bozulmaz.",
    adimlar: ["3'ü her iki taraftan çıkar: 2x = 8", "Her iki tarafı 2'ye böl", "x = 4"],
    cevap: "x = 4",
    etiketler: ["denklem", "bir bilinmeyenli", "denge yöntemi"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.6, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-mat-yuzde-001",
    baslik: "Yüzde Problemleri: İndirim Hesabı",
    ozet: "Bir fiyatın yüzde indirimli yeni değerini hesaplama.",
    ders: "Matematik", sinif: "7", konu_id: "mat-yuzde", konu: "Yüzde Problemleri", desen: "yuzde-problemi",
    zorluk: "kolay", tur: "soru_deseni",
    soru: "200 TL'lik bir ürüne %25 indirim yapılırsa yeni fiyat kaç TL olur?",
    ipucu: "İndirim tutarını bul, sonra fiyattan çıkar. Ya da %75'ini al.",
    adimlar: ["200 × 25 / 100 = 50 TL indirim", "200 − 50 = 150 TL"],
    cevap: "150 TL",
    etiketler: ["yüzde", "indirim"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-mat-ebob-ekok-001",
    baslik: "EBOB ve EKOK: Asal Çarpanlara Ayırma",
    ozet: "İki sayının en büyük ortak böleni ve en küçük ortak katını bulma.",
    ders: "Matematik", sinif: "8", konu_id: "mat-ebob-ekok", konu: "EBOB ve EKOK", desen: "ebob-ekok",
    zorluk: "orta", tur: "konu_ozeti",
    ipucu: "Ortak asal çarpanların en küçük üssü EBOB'u, tüm çarpanların en büyük üssü EKOK'u verir.",
    etiketler: ["ebob", "ekok", "asal çarpan"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-fen-madde-001",
    baslik: "Maddenin Halleri ve Hal Değişimi",
    ozet: "Erime, donma, buharlaşma ve yoğuşma kavramları.",
    ders: "Fen", sinif: "5", konu_id: "fen-madde-halleri", konu: "Maddenin Halleri",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "Isı alan madde erir/buharlaşır; ısı veren madde donar/yoğuşur.",
    etiketler: ["madde", "hal değişimi"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-tur-anlatim-001",
    baslik: "Anlatım Bozuklukları: Gereksiz Sözcük Kullanımı",
    ozet: "Cümlede anlamı tekrar eden gereksiz sözcükleri bulma.",
    ders: "Türkçe", sinif: "8", konu_id: "tur-anlatim-bozuklugu", konu: "Anlatım Bozuklukları",
    zorluk: "orta", tur: "konu_ozeti",
    ipucu: "Aynı anlamı iki kez veren sözcüklerden birini çıkar; cümle bozulmuyorsa gereksizdir.",
    etiketler: ["anlatım bozukluğu", "gereksiz sözcük"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-tur-noktalama-001",
    baslik: "Noktalama İşaretleri: Virgül ve Noktalı Virgül",
    ozet: "Virgül ile noktalı virgülün kullanım yerlerini ayırt etme.",
    ders: "Türkçe", sinif: "7", konu_id: "tur-noktalama", konu: "Noktalama İşaretleri",
    zorluk: "kolay", tur: "konu_ozeti",
    ipucu: "Sıralı ögeler arasında virgül; anlamca bağlı ama virgül yetersiz kalan yerlerde noktalı virgül.",
    etiketler: ["noktalama", "virgül"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-tar-inkilaplar-001",
    baslik: "Atatürk İnkılapları: Alanlara Göre Sınıflama",
    ozet: "Siyasi, hukuk, eğitim, ekonomi ve toplumsal alanlardaki inkılaplar.",
    ders: "Tarih", sinif: "11", konu_id: "tar-inkilaplar", konu: "Atatürk İnkılapları",
    zorluk: "orta", tur: "konu_ozeti",
    ipucu: "İnkılapları alanlara göre grupla; her alanı bir başlık altında listele.",
    etiketler: ["inkılap", "alan"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.5, durum: "yayinda", ornek: 1
  },
  {
    icerik_id: "bas-ing-reading-001",
    baslik: "Reading: Ana Fikri Bulma Stratejisi",
    ozet: "İngilizce okuma parçalarında ana fikri hızlı bulma.",
    ders: "İngilizce", sinif: "8", konu_id: "ing-reading", konu: "Okuma Anlama",
    zorluk: "orta", tur: "konu_ozeti",
    ipucu: "İlk ve son cümleye odaklan; tekrar eden kelimeler ana fikri işaret eder.",
    etiketler: ["reading", "main idea"],
    kaynak_ad: BASLANGIC_ETIKET, lisans: BASLANGIC_LISANS, kalite: 0.45, durum: "yayinda", ornek: 1
  }
];

module.exports = { KONULAR, ICERIKLER, DESEN_KALIPLARI, BASLANGIC_ETIKET, BASLANGIC_LISANS };
