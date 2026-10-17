// Örnek veriler: 1 admin, 2 müdür yardımcısı, 3 öğretmen, 10 öğrenci
// Çalıştırma: npm run seed (üstüne eklemez, varsa atlar)
// Üretimde ÇALIŞTIRMA (bilinen şifreler!): URETIM=1 ise durur
if (process.env.URETIM === "1") { console.error("Üretimde seed çalışmaz! Demo hesaplar üretime girmez."); process.exit(1); }
const bcrypt = require("bcryptjs"); // şifre gizleme
const db = require("./db"); // veritabanı

const kisiler = [
  { ad: "admin", sifre: "admin123", rol: "admin" },
  { ad: "mudur1", sifre: "mudur123", rol: "mudur" },
  { ad: "mudur2", sifre: "mudur123", rol: "mudur" },
  { ad: "AyseHoca", sifre: "hoca123", rol: "ogretmen", brans: "Matematik", onay: 1 },
  { ad: "MehmetHoca", sifre: "hoca123", rol: "ogretmen", brans: "Fen", onay: 1 },
  { ad: "ZeynepHoca", sifre: "hoca123", rol: "ogretmen", brans: "Türkçe", onay: 0 }, // onay bekliyor
  { ad: "Ali", sifre: "1234", rol: "ogrenci", sinif: "9" },
  { ad: "Elif", sifre: "1234", rol: "ogrenci", sinif: "10" },
  { ad: "Can", sifre: "1234", rol: "ogrenci", sinif: "9" },
  { ad: "Deniz", sifre: "1234", rol: "ogrenci", sinif: "11" },
  { ad: "Ece", sifre: "1234", rol: "ogrenci", sinif: "8" },
  { ad: "Fikret", sifre: "1234", rol: "ogrenci", sinif: "12" },
  { ad: "Gül", sifre: "1234", rol: "ogrenci", sinif: "7" },
  { ad: "Hakan", sifre: "1234", rol: "ogrenci", sinif: "10" },
  { ad: "Irmak", sifre: "1234", rol: "ogrenci", sinif: "6" },
  { ad: "Kerem", sifre: "1234", rol: "ogrenci", sinif: "9" }
];

const ekle = db.prepare("INSERT OR IGNORE INTO kullanicilar (ad, sifre_hash, rol, brans, sinif, onay, kok) VALUES (?, ?, ?, ?, ?, ?, 'seed')"); // tohum işareti
let sayac = 0; // eklenen sayısı
for (const k of kisiler) {
  const hash = bcrypt.hashSync(k.sifre, 10); // şifreyi gizle (10 tur)
  const r = ekle.run(k.ad, hash, k.rol, k.brans || "", k.sinif || "", k.onay === undefined ? 1 : k.onay);
  if (r.changes) sayac++; // varsa atlar (IGNORE), yoksa ekler
}
console.log(sayac + " kişi eklendi (var olanlar atlandı).");

// Kütüphane: konu taksonomisi + ETİKETLİ başlangıç içerik seti (kurgusal, doğrulanmamış — 'ornek=1')
// Not: Bu set arama/öneri/RAG için KULLANILABİLİR; ancak etiketi kaldırılmadan "doğrulanmış" sayılmaz.
try {
  const k = require("./kutuphane").baslangicYukle();
  console.log(`Kütüphane: ${k.konu} konu, ${k.icerik} başlangıç içeriği (${k.eklenen} yeni eklendi).`);
} catch (e) { console.error("Kütüphane tohumlanamadı:", e.message); }

// Örnek gönderiler (tablo boşsa bir kez, kurgusal temiz içerik)
const gonderiSay = db.prepare("SELECT COUNT(*) AS s FROM gonderiler").get().s;
if (!gonderiSay) {
  const gEkle = db.prepare("INSERT INTO gonderiler (yazar, tur, ders, sinif, baslik, aciklama, cozuldu) VALUES (?,?,?,?,?,?,?)");
  const yEkle = db.prepare("INSERT INTO yorumlar (gonderi_id, yazar, metin, enIyi) VALUES (?,?,?,?)");
  const g1 = gEkle.run("Ali", "Soru", "Matematik", "9. Sınıf", "Denklemde takıldım", "2x+3=11 nasıl çözülür? Adım adım anlatır mısınız?", 1).lastInsertRowid;
  yEkle.run(g1, "Elif", "Önce 3'ü karşıya at: 2x=8, sonra 2'ye böl: x=4. Kontrol: 2*4+3=11 doğru!", 1);
  const g2 = gEkle.run("Elif", "Soru", "Fen", "10. Sınıf", "Fotosentez denklemi", "Fotosentezde girenler ve çıkanlar neler? Kısa özet lazım.", 0).lastInsertRowid;
  yEkle.run(g2, "Can", "Girenler: su + karbondioksit + ışık. Çıkanlar: besin + oksijen.", 0);
  gEkle.run("MehmetHoca", "Konu Özeti", "Fen", "10. Sınıf", "Kuvvet ve hareket özeti", "Net kuvvet sıfırsa cisim durur ya da sabit hızla gider (eylemsizlik).", 0);
  db.prepare("UPDATE kullanicilar SET puan=10 WHERE ad='Elif'").run(); // örnek puan
  console.log("3 örnek gönderi eklendi.");
}

// Örnek odalar (tablo boşsa bir kez, kurgusal)
if (db.prepare("SELECT COUNT(*) AS s FROM odalar").get().s === 0) {
  const oEkle = db.prepare("INSERT INTO odalar (ad, ders, kurucu) VALUES (?,?,?)");
  const mEkle = db.prepare("INSERT INTO oda_mesajlari (oda_id, yazar, metin) VALUES (?,?,?)");
  const o1 = oEkle.run("9. Sınıf Matematik", "Matematik", "Ali").lastInsertRowid;
  mEkle.run(o1, "Elif", "Yarın denklem çalışıyoruz, katılan yazsın!");
  mEkle.run(o1, "Ali", "Ben varım, 2x+3=11 ile başlarız.");
  oEkle.run("Fen Soru Çözümü", "Fen", "MehmetHoca");
  console.log("2 örnek oda eklendi.");
}
