// ÖdevAğı backend: kayıt/giriş + roller (Express + SQLite)
// Çalıştırma: npm install  =>  npm run seed  =>  npm start
require("dotenv").config(); // .env ayarları
const express = require("express"); // sunucu çatısı
const helmet = require("helmet"); // güvenlik başlıkları (XSS koruması)
const cors = require("cors"); // ön yüzün bağlanmasına izin
const rateLimit = require("express-rate-limit"); // (kullanılmıyor — spam.js kullanıcı bazlı sınırlara geçti)
const bcrypt = require("bcryptjs"); // şifre gizleme
const jwt = require("jsonwebtoken"); // giriş bileti (token)
const crypto = require("crypto"); // üretim kimliği içerik hash'i
const { z } = require("zod"); // girdi doğrulama
const db = require("./db"); // veritabanı
const { etikKontrol } = require("./config/etik"); // kural filtresi (Katman 1 çekirdeği)

const app = express(); // uygulamayı kur
const PORT = process.env.PORT || 3001; // kapı no
if (!process.env.JWT_SECRET) { // gizli anahtar yoksa güvenli şekilde dur
  console.error("HATA: .env içinde JWT_SECRET yok! .env.example dosyasına bakıp ekle, öyle başlat.");
  process.exit(1); // güvensiz varsayılanla ÇALIŞMA
}
const GIZLI = process.env.JWT_SECRET; // bilet imzası

app.use(helmet()); // güvenli başlıklar
// Aynı adres hem arayüzü hem API'yi sunar; yedekler ve gizli dosyalar sunulmaz.
const arayuzKok = require("path").join(__dirname, "..", "odev-destek");
const arayuzDosyalari = ["index.html", "style.css", "app.js", "api.js", "program-kuyruk.js", "video.js", "manifest.json", "sw.js"];
const arayuzCsp = helmet.contentSecurityPolicy({ directives: {
  "script-src": ["'self'", "https://unpkg.com/lucide@1.57.0/dist/umd/lucide.min.js"],
  "upgrade-insecure-requests": process.env.URETIM === "1" ? [] : null
} });
app.get(["/", ...arayuzDosyalari.map(ad => "/" + ad)], arayuzCsp, (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(require("path").join(arayuzKok, req.path === "/" ? "index.html" : req.path.slice(1)));
});
const KOKENLER = (process.env.KOKENLER || "").split(",").map(s => s.trim()).filter(Boolean); // üretim kökenleri (.env)
if (process.env.URETIM === "1" && !KOKENLER.length) { // üretimde liste yoksa AÇIK kalma, başlamadan dur
  console.error("HATA: URETIM=1 iken KOKENLER boş olamaz! .env'e izinli adresleri yaz (örn. KOKENLER=https://okul.edu.tr).");
  process.exit(1); // eksik ayar güvenli biçimde reddedilir
}
app.use(cors(KOKENLER.length ? { origin: KOKENLER } : {})); // liste varsa sınırla, yoksa geliştirme modu (açık)
app.use(express.json({ limit: "30mb" })); // JSON oku (resimler base64 gelir, o yüzden geniş)

// Spam koruması: kullanıcı+işlem türü hız sınırı, benzer içerik, istek tekilliği (IP yalnız yedek)
const { hizSiniri, benzerEngel, istekKimlik, girisSiniri } = require("./spam");

// Kayıt formu kuralları (Zod): bozuk veri gelirse Türkçe hata
const KayitSema = z.object({
  ad: z.string().min(3, "Ad en az 3 harf olsun").max(20, "Ad en fazla 20 harf"),
  sifre: z.string().min(4, "Şifre en az 4 karakter olsun"),
  rol: z.enum(["ogrenci", "ogretmen"]), // sadece bu ikisi kayıt olabilir
  brans: z.string().max(30).optional().default(""), // hoca branşı
  sinif: z.string().max(10).optional().default(""), // öğrenci sınıfı
  kurallar: z.literal(true, { errorMap: () => ({ message: "Kuralları kabul etmelisin!" }) }) // onay kutusu şart
});

// Bilet kontrolü + güncel kullanıcı: her istekte veritabanından taze bilgi
// Neden: rol değiştiyse veya hesap askıya alındıysa eski bilet geçersiz sayılır
function girisSart(req, res, next) {
  const baslik = req.headers.authorization || ""; // "Bearer BİLET"
  const bilet = baslik.startsWith("Bearer ") ? baslik.slice(7) : "";
  let kim;
  try {
    kim = jwt.verify(bilet, GIZLI); // bileti çöz (sahteyse hata verir)
  } catch {
    return res.status(401).json({ hata: "Önce giriş yap!" }); // bilet yok/bozuk
  }
  const taze = db.prepare("SELECT ad, rol, askida, sifre_surum FROM kullanicilar WHERE ad=?").get(kim.ad); // güncel hali
  if (!taze) return res.status(401).json({ hata: "Hesap bulunamadı, tekrar giriş yap!" });
  if (taze.askida) return res.status(403).json({ hata: "Hesabın askıda! Admin ile görüş." }); // askıdaki işlem yapamaz
  if ((taze.sifre_surum || 0) !== (kim.sv || 0)) return res.status(401).json({ hata: "Şifren değişti, tekrar giriş yap!" }); // eski bilet geçersiz
  req.kullanici = { ad: taze.ad, rol: taze.rol }; // taze rol
  next();
}

// Kimlik biçimi: :id ve :yorumId sayılardan oluşmalı (örn. /abc -> 400)
app.param("id", (req, res, next, deger) => {
  if (!/^\d+$/.test(deger)) return res.status(400).json({ hata: "Geçersiz kimlik!" });
  next();
});
app.param("yorumId", (req, res, next, deger) => {
  if (!/^\d+$/.test(deger)) return res.status(400).json({ hata: "Geçersiz kimlik!" });
  next();
});

// Rol kontrolü: örn. rolSart("admin") sadece admine izin verir
function rolSart(...roller) {
  return (req, res, next) => {
    if (!roller.includes(req.kullanici.rol)) return res.status(403).json({ hata: "Yetkin yok!" });
    next();
  };
}

// Bildirim yaz (doğru alıcıya, sunucuda saklanır)
function bildirimEkle(kime, metin) {
  db.prepare("INSERT INTO bildirimler (kime, metin) VALUES (?,?)").run(kime, metin);
}

// --- AI denetim hattı (Katman 1+2, LLM kapalı) ---
const { denetle } = require("./ai/denetle"); // hat
const { havuzMetinleri } = require("./ai/havuz"); // şifreli havuzu karşılaştırma için aç
const { ocrSureli, gorselDogrula } = require("./ai/ocr"); // resim yazısı (yoksa boş döner) + imza doğrulama
const AYAR = require("./ai/config"); // AI eşikleri (sohbet modu da buradan okunur)
// Kütüphane + öneri + RAG çekirdekleri (gizli sınav havuzundan TAMAMEN ayrı katman)
const KUTUPHANE = require("./kutuphane"); // kaynak destekli içerik kütüphanesi (arama/indeks)
const ONERI = require("./oneri"); // kişiselleştirilmiş "Sana Özel" (şeffaf skorlama)
const RAG = require("./ai/rag"); // onaylı kütüphaneden getirim (asistan bağlamı)
// ===== Video çözüm cevapları (karantina + arka plan kuyruğu + multimodal denetim) =====
require("./video/schema.js"); // ekleyici tablolar (IF NOT EXISTS; mevcut şemaya BOZMADAN ekler)
const VIDEO = require("./video/hizmet"); // yükleme/karantina/karar/silme hizmeti
const VKUYRUK = require("./video/kuyruk"); // dayanıklı arka plan kuyruğu
const HESAPV = require("./video/hesap"); // hesap inceleme + kısıt + itiraz (içerik kararından ayrı)
const BOT = require("./anti-bot"); // katmanlı anti-bot (uygulama-içi; duvar DEĞİL)
function vakaAc(tur, hedefId, yazar, d) { // müdür kuyruğuna düşür (24 saat SLA)
  const r = db.prepare("INSERT INTO vakalar (tur, hedef_id, yazar, kategori, skor, guven, gerekce, kanit, sla_son) VALUES (?,?,?,?,?,?,?,?,datetime('now','+24 hours'))")
    .run(tur, hedefId || 0, yazar, d.kategori, d.risk_skoru, d.guven, d.gerekce, JSON.stringify(d.kanit_parcalari));
  if (d.risk_skoru > 0.80 || d.kategori === "SINAV_SIZINTISI") { // acil: kırmızı, en üst + yöneticilere haber
    console.error(`[ACİL VAKA #${r.lastInsertRowid}] ${d.kategori} skor=${d.risk_skoru} yazar=${yazar}`);
    db.prepare("SELECT ad FROM kullanicilar WHERE rol IN ('mudur','admin')").all()
      .forEach(m => bildirimEkle(m.ad, `ACİL vaka #${r.lastInsertRowid} (${d.kategori}, skor ${d.risk_skoru}). Denetim paneline bak!`));
  }
  return r.lastInsertRowid;
}
function ogrenciMesaji() { // öğrenciye nazik, detaysız (AI gerekçesi gösterilmez)
  return "Bu paylaşım inceleme altında. Kurallara uyduğunu düşünüyorsan itiraz edebilirsin.";
}
async function aiGecit(tur, metin, yazar, resimYazisi = "", gorselEksik = false) {
  // İçerik kapısı: {d, oneri} döner. Engelleme bile KAYDEDİLİR (durum=engellendi),
  // böylece itiraz/yayınla kararı içeriği geri getirebilir (hedef_id=0 yok).
  const d = await denetle(metin, { db, yazar, havuzlar: havuzMetinleri(db), gorselMetin: resimYazisi });
  let oneri = d.onerilen_aksiyon === "engelle" ? "engellendi" : d.onerilen_aksiyon === "incelemeye_al" ? "incelemede" : "yayinda";
  if (gorselEksik && oneri === "yayinda") { // görsel okunamadı: eksik denetim, otomatik yayınlama!
    oneri = "incelemede"; d.kanit_parcalari.push("görsel okunamadı (eksik denetim)");
  }
  return { d, oneri };
}

// Rozetleri etkinliğe göre tazele (puan + sayı rozetleri, seviyeli)
function rozetGuncelle(ad) {
  const k = db.prepare("SELECT puan FROM kullanicilar WHERE ad=?").get(ad); // güncel puan
  if (!k) return;
  const r = []; // hak edilenler
  const ver = (kosul, isim) => { if (kosul) r.push(isim); }; // koşullu ekle
  ver((k.puan || 0) >= 10, "Yardımsever"); // 10+ puan
  ver((k.puan || 0) >= 30, "Çözüm Ustası"); // 30+ puan
  ver((k.puan || 0) >= 100, "Efsane Yardımcı"); // 100+ puan
  const say = (sql, p) => db.prepare(sql).get(...p).s; // sayaç yardımcısı
  const gonderi = say("SELECT COUNT(*) AS s FROM gonderiler WHERE yazar=?", [ad]); // paylaşım sayısı
  ver(gonderi >= 1, "İlk Adım"); // ilk paylaşım
  ver(gonderi >= 10, "Üretken"); // 10 paylaşım
  const yorum = say("SELECT COUNT(*) AS s FROM yorumlar WHERE yazar=?", [ad]) + say("SELECT COUNT(*) AS s FROM yanitlar WHERE yazar=?", [ad]); // yorum+yanıt
  ver(yorum >= 5, "Yorumcu"); // 5 yorum
  ver(yorum >= 25, "Sohbetçi"); // 25 yorum
  const enIyi = say("SELECT COUNT(*) AS s FROM yorumlar WHERE yazar=? AND enIyi=1", [ad]); // doğru çözüm
  ver(enIyi >= 1, "Çözüm Çırağı"); // ilk doğru çözüm
  ver(enIyi >= 5, "Çözüm Avcısı"); // 5 doğru çözüm
  const begeni = db.prepare("SELECT COUNT(*) AS s FROM begeniler b JOIN gonderiler g ON g.id=b.gonderi_id WHERE g.yazar=?").get(ad).s; // alınan beğeni
  ver(begeni >= 10, "Popüler"); // 10 beğeni alma
  const mat = db.prepare("SELECT 1 FROM yorumlar y JOIN gonderiler g ON g.id=y.gonderi_id WHERE y.yazar=? AND y.enIyi=1 AND g.ders='Matematik'").get(ad);
  ver(!!mat, "Matematik Ustası"); // matemetikte en iyi
  const oda = say("SELECT COUNT(*) AS s FROM odalar WHERE kurucu=?", [ad]); // oda kurma
  ver(oda >= 1, "Oda Kurucusu"); // ilk oda
  const hCevap = db.prepare("SELECT COUNT(*) AS s FROM hoca_sorulari WHERE hoca=? AND durum='Cevaplandı'").get(ad).s; // hoca cevapları
  const hRol = db.prepare("SELECT rol FROM kullanicilar WHERE ad=?").get(ad);
  ver(hRol && hRol.rol === "ogretmen" && hCevap >= 3, "Öğretmen Yıldızı"); // 3+ cevap
  db.prepare("UPDATE kullanicilar SET rozetler=? WHERE ad=?").run(JSON.stringify(r), ad);
}

// Dersler: platform listesi (yalnız yayındaki gönderilerden, sayı ile)
app.get("/api/dersler", (req, res) => {
  res.json(db.prepare("SELECT ders, COUNT(*) AS sayi FROM gonderiler WHERE durum='yayinda' GROUP BY ders ORDER BY sayi DESC").all());
});

// Sağlık kontrolü: sunucu yaşıyor mu
app.get("/api/saglik", (req, res) => res.json({ durum: "tamam" }));

// AI durumu: kural mı model mi (dürüst rozet; sahte AI yok)
app.get("/api/ai-durum", (req, res) => {
  const { durum } = require("./ai/llm"); // sağlayıcı durumu
  res.json(durum());
});

// Hazırlık durumu: NE gerçek NE deneme (mock) — dürüstçe ayırır (yanlış "her şey hazır" demez)
app.get("/api/hazirlik", (req, res) => {
  let ai; try { ai = require("./ai/llm").durum(); } catch { ai = { mod: "kural", neden: "LLM durumu okunamadı" }; }
  let videoSaglayici = 0; try { videoSaglayici = Object.keys(VIDEO.saglayicilariOku() || {}).length; } catch { videoSaglayici = 0; }
  let ffmpeg = false; try { ffmpeg = require("./video/medya").medyaAraci(); } catch { ffmpeg = false; }
  let sayim = { konu: 0, icerik: 0, yayinda: 0 }; try { sayim = KUTUPHANE.sayim(); } catch { /* boş kalsın */ }
  res.json({
    ai, // kural vs model (sahte model yok)
    rag: { acik: AYAR.asistan.ragAcik !== false, limit: AYAR.asistan.ragLimit, esik: AYAR.asistan.ragEsik },
    ocr: { arac: "tesseract.js", not: "Dil verisi/ağ bağlantısı gerektirir; çalışma anında denenir. Hata olursa 'eksik denetim' sayılır (yayınlanmaz)." },
    video: {
      ffmpeg, // YOK ise otomatik kare/altyazı üretimi KAPALI (uydurulmaz)
      saglayici_sayisi: videoSaglayici, // 0 ise gerçek çok-kipli anlama YOK (test/sentetik enjekte edilmedikçe)
      not: "Otomatik yayın YOK: düşük güven/kuşkulu bulgu insan incelemesine gider; karar gerekçesi kayda geçer."
    },
    kutuphane: sayim, // gerçek sayımlar (başlangıç seti kurgusal/doğrulanmamış olarak etiketlidir)
    not: "Bu uç yalnız DURUM bildirir; hiçbir içeriği yayınlamaz/açmaz."
  });
});

// Kayıt: şifreyi gizle, hocayı onaysız kaydet
app.post("/api/kayit", girisSiniri, (req, res) => {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  const ksin = BOT.kayitSinirIzin(ip); // IP başına saatlik kayıt oranı (oranlı; okul IP'si kalıcı bloklanmaz)
  if (!ksin.izin) { BOT.kayitDenemesiKaydet(ip, 0); return res.status(429).json({ hata: `Çok fazla kayıt denemesi. ${ksin.kalan} dakika sonra tekrar deneyin.` }); }
  const sonuc = KayitSema.safeParse(req.body); // formu denetle
  if (!sonuc.success) { BOT.kayitDenemesiKaydet(ip, 0); return res.status(400).json({ hata: sonuc.error.issues[0].message }); } // ilk hatayı söyle
  const { ad, sifre, rol, brans, sinif } = sonuc.data;
  if (db.prepare("SELECT id FROM kullanicilar WHERE ad=?").get(ad)) { BOT.kayitDenemesiKaydet(ip, 0); return res.status(400).json({ hata: "Bu ad alınmış!" }); }
  const hash = bcrypt.hashSync(sifre, 10); // şifreyi gizle (aslı saklanmaz)
  db.prepare("INSERT INTO kullanicilar (ad, sifre_hash, rol, brans, sinif, onay) VALUES (?,?,?,?,?,?)")
    .run(ad, hash, rol, brans, sinif, rol === "ogretmen" ? 0 : 1); // hoca onaysız başlar
  BOT.kayitDenemesiKaydet(ip, 1);
  const burst = BOT.kayitBurst(); // gözlem: kayıt yoğunluğu (otomatik kalıcı ceza YOK)
  if (burst.uyari && burst.son10Dk > 25) console.warn(`[anti-bot] Son 10 dk'da ${burst.son10Dk} kayıt — yoğunluk izleniyor.`);
  res.json({ tamam: rol === "ogretmen" ? "Kaydoldun! Admin onayı bekliyorsun." : "Hesap açıldı, giriş yap!" });
});

// Giriş: şifreyi karşılaştır, bilet ver
app.post("/api/giris", girisSiniri, (req, res) => {
  const { ad, sifre } = req.body || {}; // gelen ad+şifre
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  const gsn = BOT.girisSiniri(String(ad || ""), ip); // kullanıcı + IP başına deneme sınırı (kilitli deneme)
  if (!gsn.izin) return res.status(429).json({ hata: "Çok fazla giriş denemesi. Biraz sonra tekrar deneyin." });
  const k = db.prepare("SELECT * FROM kullanicilar WHERE ad=?").get(ad); // kişiyi bul
  if (!k || !bcrypt.compareSync(sifre || "", k.sifre_hash)) { BOT.girisDenemesiKaydet(String(ad || ""), ip, 0); return res.status(401).json({ hata: "Ad veya şifre yanlış!" }); }
  if (k.askida) return res.status(403).json({ hata: "Hesabın askıda! Admin ile görüş." });
  if (process.env.URETIM === "1" && k.kok === "seed") return res.status(403).json({ hata: "Üretimde demo hesap kapalı! Gerçek hesabınla gir." }); // demo üretime giremez
  BOT.girisDenemesiKaydet(String(ad || ""), ip, 1); // başarısız denemeleri de izler (sayaç)
  const bilet = jwt.sign({ ad: k.ad, rol: k.rol, sv: k.sifre_surum || 0 }, GIZLI, { expiresIn: "7d" }); // 7 günlük bilet (şifre sürümlü)
  res.json({ bilet, ad: k.ad, rol: k.rol, puan: k.puan }); // bileti ver
});

// Güvenlik sorusu: riskli durumda kısa doğrulama (sağlayıcı yoksa SINIRLI yerel yedek; sahte başarı YOK)
app.post("/api/guvenlik-sorusu", girisSart, hizSiniri("genel"), (req, res) => {
  const r = BOT.riskSeviyesi(req.kullanici.ad, req.socket.remoteAddress || "?");
  if (!r.soruGerek) return res.json({ gerek: false, aciklama: "Doğrulama gerekmedi." });
  res.json({ gerek: true, aciklama: r.aciklama, ...BOT.soruUret(req.kullanici.ad) });
});
app.post("/api/guvenlik-sorusu/dogrula", girisSart, hizSiniri("genel"), (req, res) => {
  const b = req.body || {};
  const r = BOT.soruDogrula(req.kullanici.ad, String(b.jeton || ""), b.cevap);
  if (!r.ok) return res.status(400).json({ hata: r.mesaj });
  res.json({ tamam: r.mesaj });
});

// Ben kimim: biletle kendi bilgini gör (şifre hariç)
app.get("/api/ben", girisSart, (req, res) => {
  const k = db.prepare("SELECT id, ad, rol, brans, sinif, onay, puan, uyari, askida, olusturma FROM kullanicilar WHERE ad=?").get(req.kullanici.ad);
  res.json(k);
});

// Onaylı hocalar: herkes görebilir (cevap sayısıyla)
app.get("/api/hocalar", (req, res) => {
  const liste = db.prepare("SELECT ad, brans, puan FROM kullanicilar WHERE rol='ogretmen' AND onay=1").all()
    .map(h => ({ ...h, cevapSayi: db.prepare("SELECT COUNT(*) AS s FROM hoca_sorulari WHERE hoca=? AND durum='Cevaplandı'").get(h.ad).s })); // cevapladığı soru
  res.json(liste);
});

// Admin: tüm kullanıcılar (şifre hariç)
app.get("/api/admin/kullanicilar", girisSart, rolSart("admin"), (req, res) => {
  const liste = db.prepare("SELECT id, ad, rol, brans, sinif, onay, puan, uyari, askida, olusturma FROM kullanicilar ORDER BY id").all();
  res.json(liste);
});

// Admin: hoca onayla/reddet + denetim kaydı düş
app.post("/api/admin/hoca-onay", girisSart, rolSart("admin"), (req, res) => {
  const { ad, onay } = req.body || {};
  db.prepare("UPDATE kullanicilar SET onay=? WHERE ad=? AND rol='ogretmen'").run(onay ? 1 : 0, ad);
  db.prepare("INSERT INTO denetim_kaydi (kim, aksiyon, hedef) VALUES (?,?,?)").run(req.kullanici.ad, onay ? "hoca-onay" : "hoca-red", ad);
  if (onay) bildirimEkle(ad, "Öğretmen hesabın onaylandı! ✅"); // öğretmene haber
  res.json({ tamam: "İşlendi." });
});

// Admin: askıya al/çıkar + denetim kaydı düş
app.post("/api/admin/aski", girisSart, rolSart("admin"), (req, res) => {
  const { ad, askida } = req.body || {};
  db.prepare("UPDATE kullanicilar SET askida=? WHERE ad=?").run(askida ? 1 : 0, ad);
  db.prepare("INSERT INTO denetim_kaydi (kim, aksiyon, hedef) VALUES (?,?,?)").run(req.kullanici.ad, askida ? "askiya-al" : "askidan-cikar", ad);
  res.json({ tamam: "İşlendi." });
});

// Yazma işleri: ARTIK kullanıcı başına (IP değil!): aynı okul ağındaki öğrenciler birbirini engellemez
const yazmaSiniri = hizSiniri("genel"); // genel yazma tavanı: kullanıcı başına 60/dk

// Gönderi formu kuralları
const GonderiSema = z.object({
  tur: z.enum(["Soru", "Çözüm Paylaşımı", "Konu Özeti"]).default("Soru"), // 3 tür
  ders: z.string().min(1, "Ders seçmek zorunlu!").max(20), // ders şart
  sinif: z.string().max(15).optional().default(""), // sınıf
  baslik: z.string().min(3, "Başlık en az 3 harf").max(120), // başlık
  aciklama: z.string().max(2000).optional().default(""), // açıklama
  resimler: z.array(z.string().max(7000000).refine(v => v.startsWith("data:image/"), "Resim biçimi bozuk!")).max(4).optional().default([]) // en fazla 4 resim, yalnız resim verisi
});
const MetinSema = z.object({ metin: z.string().min(1, "Boş yazma!").max(1000) }); // yorum/yanıt
const SikayetSema = z.object({ hedefId: z.number(), neden: z.string().min(1).max(50) }); // şikayet

// Gönderiyi iç içe kur: yorumlar + yanıtlar + beğenenler (ön yüze hazır paket)
function gonderiDetay(id) {
  const g = db.prepare("SELECT * FROM gonderiler WHERE id=?").get(id); // gönderi
  if (!g) return null;
  g.resimler = JSON.parse(g.resimler || "[]"); // yazıdan listeye çevir
  g.cozuldu = !!g.cozuldu; // 0/1 -> yanlış/doğru
  g.begen = db.prepare("SELECT kisi FROM begeniler WHERE gonderi_id=?").all(id).map(r => r.kisi); // beğenenler
  g.cevaplar = db.prepare("SELECT * FROM yorumlar WHERE gonderi_id=? AND durum='yayinda' ORDER BY id").all(id).map(y => ({ // yayındakiler (incelemede/engelli gizli)
    id: y.id, yazar: y.yazar, metin: y.metin, enIyi: !!y.enIyi,
    yanitlar: db.prepare("SELECT yazar, metin FROM yanitlar WHERE yorum_id=? AND durum='yayinda' ORDER BY id").all(y.id) // yayındaki yanıtlar
  }));
  return g;
}

// Akış: filtreli + sayfalı liste (herkese açık) + bugünün soruları (gun=1: son 24 saat, çözülmemiş sorular)
app.get("/api/gonderiler", (req, res) => {
  const { arama = "", ders = "", tur = "", durum = "", siralama = "yeni", limit = 20, offset = 0 } = req.query;
  let sql = "SELECT * FROM gonderiler WHERE durum='yayinda' AND (SELECT COUNT(DISTINCT bildiren) FROM sikayetler s WHERE s.hedefId=gonderiler.id) < 3"; // yayındakiler + 3 FARKLI kişi şikayet etmedikçe
  const p = []; // soru işaretlerinin değerleri
  if (ders) { sql += " AND ders=?"; p.push(ders); } // ders filtresi
  if (tur) { sql += " AND tur=?"; p.push(tur); } // tür filtresi
  if (durum === "cozuldu") sql += " AND cozuldu=1"; // çözülmüş
  if (durum === "bekleyen") sql += " AND cozuldu=0"; // bekleyen
  if (arama) { const kac = String(arama).slice(0, 100).replace(/[\\%_]/g, m => "\\" + m); sql += " AND (baslik LIKE ? ESCAPE '\\' OR aciklama LIKE ? ESCAPE '\\')"; p.push("%" + kac + "%", "%" + kac + "%"); } // arama (joker kaçışlı: %/_ enjeksiyonu engellenir)
  if (String(req.query.gun) === "1") sql += " AND tur='Soru' AND cozuldu=0 AND tarih > datetime('now','-1 day')"; // bugünün soruları (son 24 saat, UTC)
  sql += siralama === "populer" ? " ORDER BY (SELECT COUNT(*) FROM begeniler b WHERE b.gonderi_id=gonderiler.id) DESC, id DESC" : " ORDER BY id DESC"; // sıralama
  sql += " LIMIT ? OFFSET ?"; p.push(Math.min(Math.max(+limit || 20, 1), 50), Math.max(+offset || 0, 0)); // sayfalama (1-50, negatif yok)
  const liste = db.prepare(sql).all(...p).map(g => gonderiDetay(g.id)); // her birini paketle
  res.json(liste);
});

// Gönderi paylaş (giriş şart + AI denetiminden geçer + spam koruması)
app.post("/api/gonderiler", girisSart, hizSiniri("soru"), istekKimlik(), benzerEngel("soru", b => (b.baslik || "") + " " + (b.aciklama || "")), async (req, res) => {
  const sonuc = GonderiSema.safeParse(req.body); // formu denetle
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const v = sonuc.data;
  let resimYazisi = "", resimEksik = false; // OCR yazıları + eksik bayrağı
  for (const r of v.resimler) { // TÜM resimler denetlenir (en fazla 4, Zod sınırı)
    let buf;
    try {
      const b64 = (r.split(",")[1] || ""); // data:...;base64, kısmını al
      buf = Buffer.from(b64, "base64"); // dosyaya çevir
      gorselDogrula(buf); // imza + boyut (bozuksa 400)
    } catch (e) { return res.status(e.kod || 400).json({ hata: e.mesaj || "Resim geçersiz!" }); }
    const o = await ocrSureli(buf, 8000); // sırayla oku (sınırlı eşzamanlılık: tek tek)
    resimYazisi += " " + o.metin; // çıkan yazı hatta girer
    if (o.eksik) resimEksik = true; // okunamadı: eksik denetim sayılır
  }
  let kapi; // AI kararı
  try { kapi = await aiGecit("gonderi", v.baslik + " " + v.aciklama, req.kullanici.ad, resimYazisi, resimEksik); }
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  const r = db.prepare("INSERT INTO gonderiler (yazar, tur, ders, sinif, baslik, aciklama, resimler, durum) VALUES (?,?,?,?,?,?,?,?)")
    .run(req.kullanici.ad, v.tur, v.ders, v.sinif, v.baslik, v.aciklama, JSON.stringify(v.resimler), kapi.oneri);
  rozetGuncelle(req.kullanici.ad); // İlk Adım/Üretken rozetleri
  const vakaId = (kapi.oneri === "yayinda") ? null : vakaAc("gonderi", r.lastInsertRowid, req.kullanici.ad, kapi.d); // gerçek id ile vaka
  const cevap = gonderiDetay(r.lastInsertRowid); // ekleneni geri ver
  if (kapi.oneri !== "yayinda") { cevap.bilgi = ogrenciMesaji(); cevap.vakaId = vakaId; } // nazik not + itiraz yolu
  if (kapi.oneri === "engellendi") return res.status(400).json({ hata: "🚫 " + ogrenciMesaji(), vakaId }); // yayınlanmadı ama itiraz açık
  res.status(201).json(cevap);
});

// Gönderi düzenle (sahibi veya admin, AI denetiminden geçer)
app.put("/api/gonderiler/:id", girisSart, hizSiniri("duzenle"), istekKimlik(), async (req, res) => {
  const g = db.prepare("SELECT * FROM gonderiler WHERE id=?").get(req.params.id); // bul
  if (!g) return res.status(404).json({ hata: "Gönderi yok!" });
  if (g.yazar !== req.kullanici.ad && req.kullanici.rol !== "admin") return res.status(403).json({ hata: "Yetkin yok!" });
  const sonuc = GonderiSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const v = sonuc.data;
  let resimEksik = false; // düzenlerken eklenen resimler de denetlenir
  for (const r of v.resimler) {
    let buf;
    try {
      buf = Buffer.from((r.split(",")[1] || ""), "base64");
      gorselDogrula(buf); // imza + boyut
    } catch (e) { return res.status(e.kod || 400).json({ hata: e.mesaj || "Resim geçersiz!" }); }
    const o = await ocrSureli(buf, 8000);
    if (o.eksik) resimEksik = true;
    v._ocr = (v._ocr || "") + " " + o.metin; // hatta girer
  }
  let kapi;
  try { kapi = await aiGecit("gonderi", v.baslik + " " + v.aciklama + (v._ocr || ""), req.kullanici.ad, "", resimEksik); }
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  db.prepare("UPDATE gonderiler SET tur=?, ders=?, sinif=?, baslik=?, aciklama=?, resimler=?, durum=? WHERE id=?").run(v.tur, v.ders, v.sinif, v.baslik, v.aciklama, JSON.stringify(v.resimler), kapi.oneri, g.id); // resimler boş dizi de olabilir (tümünü kaldırma)
  if (kapi.oneri !== "yayinda") { const vid = vakaAc("gonderi", g.id, req.kullanici.ad, kapi.d); const c = gonderiDetay(g.id); c.bilgi = ogrenciMesaji(); c.vakaId = vid; return res.json(c); } // incelemede/engellendi: notla dön
  res.json(gonderiDetay(g.id));
});

// Gönderi sil (sahibi veya admin)
app.delete("/api/gonderiler/:id", girisSart, (req, res) => {
  const g = db.prepare("SELECT * FROM gonderiler WHERE id=?").get(req.params.id);
  if (!g) return res.status(404).json({ hata: "Gönderi yok!" });
  if (g.yazar !== req.kullanici.ad && req.kullanici.rol !== "admin") return res.status(403).json({ hata: "Yetkin yok!" });
  db.prepare("DELETE FROM yanitlar WHERE yorum_id IN (SELECT id FROM yorumlar WHERE gonderi_id=?)").run(g.id); // önce yanıtlar
  db.prepare("DELETE FROM yorumlar WHERE gonderi_id=?").run(g.id); // sonra yorumlar
  db.prepare("DELETE FROM begeniler WHERE gonderi_id=?").run(g.id); // beğeniler
  db.prepare("DELETE FROM kaydetmeler WHERE gonderi_id=?").run(g.id); // kayıtlar
  db.prepare("DELETE FROM gonderiler WHERE id=?").run(g.id); // kendisi
  res.json({ tamam: "Silindi." });
});

// Beğeni aç/kapa (bir kişi bir kez)
app.post("/api/gonderiler/:id/begen", girisSart, yazmaSiniri, (req, res) => {
  const id = +req.params.id, kim = req.kullanici.ad; // kim, neyi
  const var1 = db.prepare("SELECT 1 FROM begeniler WHERE gonderi_id=? AND kisi=?").get(id, kim);
  if (var1) db.prepare("DELETE FROM begeniler WHERE gonderi_id=? AND kisi=?").run(id, kim); // varsa geri al
  else db.prepare("INSERT INTO begeniler (gonderi_id, kisi) VALUES (?,?)").run(id, kim); // yoksa ekle
  const gBegeni = db.prepare("SELECT yazar FROM gonderiler WHERE id=?").get(id); // yazara Popüler rozeti
  if (gBegeni) rozetGuncelle(gBegeni.yazar);
  const sayi = db.prepare("SELECT COUNT(*) AS s FROM begeniler WHERE gonderi_id=?").get(id).s;
  res.json({ begendim: !var1, sayi }); // durumu söyle
});

// Yorumlar + yanıtlar (tek pakette)
app.get("/api/gonderiler/:id/yorumlar", (req, res) => {
  const g = gonderiDetay(req.params.id);
  if (!g) return res.status(404).json({ hata: "Gönderi yok!" });
  res.json(g.cevaplar);
});

// Yorum yaz (giriş şart + AI denetiminden geçer + spam koruması)
app.post("/api/gonderiler/:id/yorumlar", girisSart, hizSiniri("yorum"), istekKimlik(), benzerEngel("yorum", b => b.metin), async (req, res) => {
  const sonuc = MetinSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  let kapi;
  try { kapi = await aiGecit("yorum", sonuc.data.metin, req.kullanici.ad); }
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  const r = db.prepare("INSERT INTO yorumlar (gonderi_id, yazar, metin, durum) VALUES (?,?,?,?)").run(req.params.id, req.kullanici.ad, sonuc.data.metin, kapi.oneri);
  rozetGuncelle(req.kullanici.ad); // Yorumcu/Sohbetçi rozetleri
  const cevap = { id: r.lastInsertRowid };
  if (kapi.oneri !== "yayinda") { const vid = vakaAc("yorum", r.lastInsertRowid, req.kullanici.ad, kapi.d); cevap.bilgi = ogrenciMesaji(); cevap.vakaId = vid; } // gerçek id ile vaka
  else {
    const sahip = db.prepare("SELECT yazar, baslik FROM gonderiler WHERE id=?").get(req.params.id); // sahibine haber
    if (sahip && sahip.yazar !== req.kullanici.ad) bildirimEkle(sahip.yazar, `${req.kullanici.ad} gönderine yorum yaptı: ${sahip.baslik}`);
  }
  if (kapi.oneri === "engellendi") return res.status(400).json({ hata: "🚫 " + ogrenciMesaji(), vakaId: cevap.vakaId });
  res.status(201).json(cevap);
});

// Yanıt yaz (giriş şart + AI denetiminden geçer + spam koruması)
app.post("/api/yorumlar/:yorumId/yanitlar", girisSart, hizSiniri("yanit"), istekKimlik(), benzerEngel("yanit", b => b.metin), async (req, res) => {
  const sonuc = MetinSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  let kapiY;
  try { kapiY = await aiGecit("yorum", sonuc.data.metin, req.kullanici.ad); } // engel de kaydedilir
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  const r = db.prepare("INSERT INTO yanitlar (yorum_id, yazar, metin, durum) VALUES (?,?,?,?)").run(req.params.yorumId, req.kullanici.ad, sonuc.data.metin, kapiY.oneri);
  const cevapY = { id: r.lastInsertRowid };
  if (kapiY.oneri !== "yayinda") { const vid = vakaAc("yanit", r.lastInsertRowid, req.kullanici.ad, kapiY.d); cevapY.bilgi = ogrenciMesaji(); cevapY.vakaId = vid; } // YANIT türüyle vaka (yorumla karışmaz)
  if (kapiY.oneri === "engellendi") return res.status(400).json({ hata: "🚫 " + ogrenciMesaji(), vakaId: cevapY.vakaId });
  res.status(201).json(cevapY);
});

// En iyi cevap: soruda 1 tane olur, değişirse puanlar taşınır (hepsi tek işlemde)
const enIyiSec = db.islem((yorumId, secenAd) => {
  const y = db.prepare("SELECT * FROM yorumlar WHERE id=?").get(yorumId); // yorum
  if (!y) throw { kod: 404, mesaj: "Yorum yok!" };
  const g = db.prepare("SELECT * FROM gonderiler WHERE id=?").get(y.gonderi_id); // gönderi
  if (!g) throw { kod: 404, mesaj: "Gönderi yok!" };
  if (g.yazar !== secenAd) throw { kod: 403, mesaj: "Sadece soruyu soran seçebilir!" };
  const eski = db.prepare("SELECT * FROM yorumlar WHERE gonderi_id=? AND enIyi=1").get(g.id); // var olan en iyi
  if (eski && eski.id === y.id) throw { kod: 400, mesaj: "Bu cevap zaten en iyi!" }; // tekrar puan yok
  if (eski) { // seçim değişiyor: eski puanı geri al
    db.prepare("UPDATE yorumlar SET enIyi=0 WHERE id=?").run(eski.id);
    db.prepare("UPDATE kullanicilar SET puan=CASE WHEN puan>=10 THEN puan-10 ELSE 0 END WHERE ad=?").run(eski.yazar);
    rozetGuncelle(eski.yazar); // rozetleri tazele
  }
  db.prepare("UPDATE yorumlar SET enIyi=1 WHERE id=?").run(y.id); // yeni en iyi
  db.prepare("UPDATE gonderiler SET cozuldu=1 WHERE id=?").run(g.id); // çözüldü
  db.prepare("UPDATE kullanicilar SET puan=puan+10 WHERE ad=?").run(y.yazar); // +10 puan
  rozetGuncelle(y.yazar); // rozetleri tazele
  bildirimEkle(y.yazar, `Cevabın en iyi seçildi! (+10 puan): ${g.baslik}`); // yazara haber
});
app.post("/api/yorumlar/:yorumId/en-iyi", girisSart, (req, res) => {
  try {
    enIyiSec(+req.params.yorumId, req.kullanici.ad);
    res.json({ tamam: "Çözüldü olarak işaretlendi! ✅" });
  } catch (e) { res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
});

// Kaydet aç/kapa
app.post("/api/gonderiler/:id/kaydet", girisSart, (req, res) => {
  const id = +req.params.id, kim = req.kullanici.ad;
  const var1 = db.prepare("SELECT 1 FROM kaydetmeler WHERE kisi=? AND gonderi_id=?").get(kim, id);
  if (var1) db.prepare("DELETE FROM kaydetmeler WHERE kisi=? AND gonderi_id=?").run(kim, id);
  else db.prepare("INSERT INTO kaydetmeler (kisi, gonderi_id) VALUES (?,?)").run(kim, id);
  res.json({ kaydettim: !var1 });
});

// Kaydettiklerim (giriş şart): yayındakiler + kendi bekleyenlerim (başkasının incelemesi görünmez)
app.get("/api/kaydettiklerim", girisSart, (req, res) => {
  const ids = db.prepare("SELECT gonderi_id FROM kaydetmeler WHERE kisi=?").all(req.kullanici.ad).map(r => r.gonderi_id);
  res.json(ids.map(id => gonderiDetay(id)).filter(g => g && (g.durum === "yayinda" || g.yazar === req.kullanici.ad))); // silinen + başkasının incelemesi yok
});

// Şikayet et: biri bir gönderiyi 1 kez şikayet eder, otomatik ceza YOK (inceleme gerekir)
const sikayetIsle = db.islem((hedefId, neden, bildiren) => {
  const g = db.prepare("SELECT id FROM gonderiler WHERE id=?").get(hedefId); // gönderi var mı
  if (!g) throw { kod: 404, mesaj: "Gönderi yok!" };
  if (db.prepare("SELECT id FROM sikayetler WHERE hedefId=? AND bildiren=?").get(hedefId, bildiren))
    throw { kod: 400, mesaj: "Bunu zaten şikayet ettin!" }; // tekrar engeli
  db.prepare("INSERT INTO sikayetler (hedefId, neden, bildiren) VALUES (?,?,?)").run(hedefId, neden, bildiren);
  db.prepare("UPDATE gonderiler SET sikayet=sikayet+1 WHERE id=?").run(hedefId); // sayaç (bilgi amaçlı)
});
app.post("/api/sikayet", girisSart, hizSiniri("sikayet"), istekKimlik(), (req, res) => { // spam: şikâyet 5/dk + tekillik
  const sonuc = SikayetSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: "Neden seç!" });
  try {
    sikayetIsle(sonuc.data.hedefId, sonuc.data.neden, req.kullanici.ad);
    res.json({ tamam: "Şikayetin alındı, yönetici inceleyecek." });
  } catch (e) { res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
});

// Admin: şikayeti sonuçlandır (reddet: kaydı sil / kaldır: gönderiyi sil + sahibine uyarı)
app.post("/api/admin/sikayet/:id/cozum", girisSart, rolSart("admin"), (req, res) => {
  const s = db.prepare("SELECT * FROM sikayetler WHERE id=?").get(req.params.id); // şikayet
  if (!s) return res.status(404).json({ hata: "Şikayet yok!" });
  const { aksiyon } = req.body || {}; // "reddet" ya da "kaldir"
  const coz = db.islem(() => {
    if (aksiyon === "kaldir") { // içeriği kaldır + uyarı ver
      const g = db.prepare("SELECT yazar FROM gonderiler WHERE id=?").get(s.hedefId);
      if (g) {
        db.prepare("DELETE FROM yanitlar WHERE yorum_id IN (SELECT id FROM yorumlar WHERE gonderi_id=?)").run(s.hedefId);
        db.prepare("DELETE FROM yorumlar WHERE gonderi_id=?").run(s.hedefId);
        db.prepare("DELETE FROM begeniler WHERE gonderi_id=?").run(s.hedefId);
        db.prepare("DELETE FROM kaydetmeler WHERE gonderi_id=?").run(s.hedefId);
        db.prepare("DELETE FROM gonderiler WHERE id=?").run(s.hedefId);
        db.prepare("UPDATE kullanicilar SET uyari=uyari+1 WHERE ad=?").run(g.yazar); // insan kararıyla uyarı
        bildirimEkle(g.yazar, "Bir gönderin yönetici kararıyla kaldırıldı. Kuralları oku!");
      }
      db.prepare("DELETE FROM sikayetler WHERE hedefId=?").run(s.hedefId); // ilgili kuyruğu temizle
      db.prepare("INSERT INTO denetim_kaydi (kim, aksiyon, hedef) VALUES (?,?,?)").run(req.kullanici.ad, "sikayet-kaldir", String(s.hedefId));
    } else { // reddet: kuyruktan düşür
      db.prepare("DELETE FROM sikayetler WHERE id=?").run(s.id);
      db.prepare("INSERT INTO denetim_kaydi (kim, aksiyon, hedef) VALUES (?,?,?)").run(req.kullanici.ad, "sikayet-reddet", String(s.hedefId));
    }
  });
  coz(); // işlemi çalıştır
  res.json({ tamam: "İşlendi." });
});

// İçerik türü -> tablo eşlemesi (vaka hedefi şaşmaz; SQL adı sabit listeden gelir)
const TUR_TABLO = {
  gonderi: "gonderiler", yorum: "yorumlar", yanit: "yanitlar",
  oda: "odalar", mesaj: "oda_mesajlari", soru: "hoca_sorulari", sohbetmesaji: "mesajlar"
};
function vakaIcerik(v) { // vakayı gerçek içeriğe bağla + yazarı doğrula
  const tablo = TUR_TABLO[v.tur]; // bilinmeyen tür yok
  if (!tablo) throw { kod: 400, mesaj: "Bilinmeyen içerik türü!" };
  const satir = db.prepare(`SELECT * FROM ${tablo} WHERE id=?`).get(v.hedef_id); // doğru tablo
  if (!satir) throw { kod: 404, mesaj: "İçerik bulunamadı (silinmiş olabilir)!" };
  let yazar; // içeriğin GERÇEK sahibi türe göre belirlenir
  if (v.tur === "sohbetmesaji") { // mesajlar tablosunda yazar yok → sahip sohbetler.sahip'ten doğrulanır
    const sh = db.prepare("SELECT sahip FROM sohbetler WHERE id=?").get(satir.sohbet_id);
    if (!sh) throw { kod: 404, mesaj: "Sohbet bulunamadı (silinmiş olabilir)!" };
    yazar = sh.sahip;
  } else yazar = satir.yazar || satir.ogrenci; // soruda alan adı farklı
  if (yazar !== v.yazar) throw { kod: 400, mesaj: "Vaka-içerik yazarı uyuşmuyor! Elle incele." }; // yanlış içeriğe işlem yok
  return { tablo, satir };
}
function durumYaz(tur, id, durum) { // yayın durumu yaz (soruda ayrı sütun: iş akışı 'durum'dan ayrı)
  if (tur === "soru") db.prepare("UPDATE hoca_sorulari SET denetim=? WHERE id=?").run(durum, id);
  else db.prepare(`UPDATE ${TUR_TABLO[tur]} SET durum=? WHERE id=?`).run(durum, id);
}

// Admin: şikayet kuyruğu
app.get("/api/admin/sikayetler", girisSart, rolSart("admin"), (req, res) => {
  res.json(db.prepare("SELECT * FROM sikayetler ORDER BY id DESC LIMIT 50").all());
});

// Çalışma odaları: liste (mesaj sayısıyla, yayındakiler)
app.get("/api/odalar", (req, res) => {
  const liste = db.prepare("SELECT * FROM odalar WHERE durum='yayinda' ORDER BY id DESC").all().map(o => ({ // yayındaki odalar
    ...o, mesajSayi: db.prepare("SELECT COUNT(*) AS s FROM oda_mesajlari WHERE oda_id=? AND durum='yayinda'").get(o.id).s
  }));
  res.json(liste);
});

// Oda aç (giriş şart + AI denetiminden geçer + spam koruması)
app.post("/api/odalar", girisSart, hizSiniri("oda"), istekKimlik(), benzerEngel("oda", b => b.ad), async (req, res) => {
  const Sema = z.object({ ad: z.string().min(3, "Oda adı en az 3 harf").max(60), ders: z.string().min(1, "Ders seç!").max(20) });
  const sonuc = Sema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  let kapiO;
  try { kapiO = await aiGecit("oda", sonuc.data.ad, req.kullanici.ad); } // oda adı denetimi
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  const r = db.prepare("INSERT INTO odalar (ad, ders, kurucu, durum) VALUES (?,?,?,?)").run(sonuc.data.ad, sonuc.data.ders, req.kullanici.ad, kapiO.oneri);
  rozetGuncelle(req.kullanici.ad); // Oda Kurucusu rozeti
  const odaCevap = db.prepare("SELECT * FROM odalar WHERE id=?").get(r.lastInsertRowid);
  if (kapiO.oneri !== "yayinda") { const vid = vakaAc("oda", r.lastInsertRowid, req.kullanici.ad, kapiO.d); odaCevap.bilgi = ogrenciMesaji(); odaCevap.vakaId = vid; }
  if (kapiO.oneri === "engellendi") return res.status(400).json({ hata: "🚫 " + ogrenciMesaji(), vakaId: odaCevap.vakaId });
  res.status(201).json(odaCevap);
});

// Oda mesajları (son 50, yayındakiler)
app.get("/api/odalar/:id/mesajlar", (req, res) => {
  res.json(db.prepare("SELECT yazar, metin, tarih FROM oda_mesajlari WHERE oda_id=? AND durum='yayinda' ORDER BY id DESC LIMIT 50").all(req.params.id).reverse()); // eskten yeniye
});

// Odaya yaz (giriş şart + AI denetiminden geçer + spam koruması)
app.post("/api/odalar/:id/mesajlar", girisSart, hizSiniri("mesaj"), istekKimlik(), benzerEngel("mesaj", b => b.metin), async (req, res) => {
  const sonuc = MetinSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  let kapiM;
  try { kapiM = await aiGecit("mesaj", sonuc.data.metin, req.kullanici.ad); }
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  const r = db.prepare("INSERT INTO oda_mesajlari (oda_id, yazar, metin, durum) VALUES (?,?,?,?)").run(req.params.id, req.kullanici.ad, sonuc.data.metin, kapiM.oneri);
  const cevapM = { id: r.lastInsertRowid };
  if (kapiM.oneri !== "yayinda") { const vid = vakaAc("mesaj", r.lastInsertRowid, req.kullanici.ad, kapiM.d); cevapM.bilgi = ogrenciMesaji(); cevapM.vakaId = vid; }
  if (kapiM.oneri === "engellendi") return res.status(400).json({ hata: "🚫 " + ogrenciMesaji(), vakaId: cevapM.vakaId });
  res.status(201).json(cevapM);
});

// Oda kapat (kurucu veya admin)
app.delete("/api/odalar/:id", girisSart, (req, res) => {
  const o = db.prepare("SELECT * FROM odalar WHERE id=?").get(req.params.id);
  if (!o) return res.status(404).json({ hata: "Oda yok!" });
  if (o.kurucu !== req.kullanici.ad && req.kullanici.rol !== "admin") return res.status(403).json({ hata: "Yetkin yok!" });
  db.prepare("DELETE FROM oda_mesajlari WHERE oda_id=?").run(o.id); // önce mesajlar
  db.prepare("DELETE FROM odalar WHERE id=?").run(o.id); // sonra oda
  res.json({ tamam: "Oda kapatıldı." });
});

// --- Bildirimler: sunucuda saklanır, okundu bilgisi cihazlar arası korunur ---
app.get("/api/bildirimler", girisSart, (req, res) => {
  res.json(db.prepare("SELECT id, metin, okundu, tarih FROM bildirimler WHERE kime=? ORDER BY id DESC LIMIT 20").all(req.kullanici.ad));
});
app.post("/api/bildirimler/okundu", girisSart, (req, res) => {
  const { id } = req.body || {}; // id yoksa tümünü okundu say
  if (id) db.prepare("UPDATE bildirimler SET okundu=1 WHERE id=? AND kime=?").run(id, req.kullanici.ad);
  else db.prepare("UPDATE bildirimler SET okundu=1 WHERE kime=?").run(req.kullanici.ad);
  res.json({ tamam: "Okundu." });
});

// --- Liderlik: ilk 10, gerçek puanlarla ---
app.get("/api/liderlik", (req, res) => {
  res.json(db.prepare("SELECT ad, puan, rozetler FROM kullanicilar ORDER BY puan DESC LIMIT 10").all()
    .map(k => ({ ad: k.ad, puan: k.puan, rozetSayi: JSON.parse(k.rozetler || "[]").length })));
});

// --- Herkese açık profil: şifre ve e-posta YOK (gizlilik) ---
app.get("/api/kullanicilar/:ad", (req, res) => {
  const k = db.prepare("SELECT ad, rol, brans, puan, rozetler FROM kullanicilar WHERE ad=?").get(req.params.ad);
  if (!k) return res.status(404).json({ hata: "Kullanıcı yok!" });
  res.json({
    ...k, rozetler: JSON.parse(k.rozetler || "[]"), // listeye çevir
    gonderiSayi: db.prepare("SELECT COUNT(*) AS s FROM gonderiler WHERE yazar=?").get(k.ad).s, // gönderileri
    cozumSayi: db.prepare("SELECT COUNT(*) AS s FROM yorumlar WHERE yazar=? AND enIyi=1").get(k.ad).s, // doğru çözümleri
    takipSayi: db.prepare("SELECT COUNT(*) AS s FROM takipler WHERE takipci=? AND durum='kabul'").get(k.ad).s // kabul edilen takipler
  });
});

// --- Takip isteği: önce istek gider, karşı taraf kabul/ret eder ---
app.post("/api/takip", girisSart, hizSiniri("takip"), istekKimlik(), (req, res) => { // spam: 12/dk + tekillik (toggle: benzerlik YOK)
  const { ad } = req.body || {}; // kimi
  if (!ad || ad === req.kullanici.ad) return res.status(400).json({ hata: "Kendini takip edemezsin!" });
  if (!db.prepare("SELECT ad FROM kullanicilar WHERE ad=?").get(ad)) return res.status(404).json({ hata: "Böyle biri yok!" });
  const var1 = db.prepare("SELECT durum FROM takipler WHERE takipci=? AND edilen=?").get(req.kullanici.ad, ad);
  if (var1) { // varsa geri al (istek ya da takip fark etmez)
    db.prepare("DELETE FROM takipler WHERE takipci=? AND edilen=?").run(req.kullanici.ad, ad);
    return res.json({ takip: false, istek: false });
  }
  db.prepare("INSERT INTO takipler (takipci, edilen, durum) VALUES (?,?, 'bekliyor')").run(req.kullanici.ad, ad); // istek düşer
  bildirimEkle(ad, `${req.kullanici.ad} seni takip etmek istiyor.`); // karşıya haber
  res.json({ takip: false, istek: true }); // istek gönderildi
});
app.get("/api/takip", girisSart, (req, res) => {
  res.json(db.prepare("SELECT edilen FROM takipler WHERE takipci=? AND durum='kabul'").all(req.kullanici.ad).map(r => r.edilen)); // yalnız kabul edilenler
});
app.get("/api/takip/istekler", girisSart, (req, res) => {
  const gelen = db.prepare("SELECT takipci FROM takipler WHERE edilen=? AND durum='bekliyor'").all(req.kullanici.ad).map(r => r.takipci); // bana gelenler
  const giden = db.prepare("SELECT edilen FROM takipler WHERE takipci=? AND durum='bekliyor'").all(req.kullanici.ad).map(r => r.edilen); // benim gönderdiklerim
  res.json({ gelen, giden });
});
app.post("/api/takip/karar", girisSart, hizSiniri("takip"), istekKimlik(), (req, res) => {
  const { ad, kabul } = req.body || {}; // kim + karar
  const istek = db.prepare("SELECT * FROM takipler WHERE takipci=? AND edilen=? AND durum='bekliyor'").get(ad, req.kullanici.ad);
  if (!istek) return res.status(404).json({ hata: "Bekleyen istek yok!" }); // yalnız bana gelen
  if (kabul) {
    db.prepare("UPDATE takipler SET durum='kabul' WHERE takipci=? AND edilen=?").run(ad, req.kullanici.ad); // kabul et
    bildirimEkle(ad, `${req.kullanici.ad} takip isteğini kabul etti! 👀`); // isteyene haber
  } else db.prepare("DELETE FROM takipler WHERE takipci=? AND edilen=?").run(ad, req.kullanici.ad); // reddet (kayıt silinir)
  res.json({ tamam: kabul ? "Kabul edildi!" : "Reddedildi." });
});

// --- Hocaya Sor (sunucu): öğrenci yalnız kendininkini, hoca yalnız kendine geleni görür ---
const HocaSoruSema = z.object({
  hoca: z.string().min(1, "Öğretmen seç!"), ders: z.string().min(1).max(20),
  baslik: z.string().min(3, "Başlık en az 3 harf").max(120),
  soru: z.string().min(1, "Sorunu yaz!").max(2000),
  gizli: z.enum(["ozel", "acik"]).default("ozel")
});
app.post("/api/hoca-sorulari", girisSart, hizSiniri("hocaSoru"), istekKimlik(), benzerEngel("hocaSoru", b => (b.baslik || "") + " " + (b.soru || "")), async (req, res) => {
  if (req.kullanici.rol !== "ogrenci") return res.status(403).json({ hata: "Sadece öğrenciler sorabilir!" });
  const sonuc = HocaSoruSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const h = db.prepare("SELECT ad FROM kullanicilar WHERE ad=? AND rol='ogretmen' AND onay=1").get(sonuc.data.hoca); // onaylı mı
  if (!h) return res.status(400).json({ hata: "Onaylı öğretmen bulunamadı!" });
  const v = sonuc.data;
  let kapi;
  try { kapi = await aiGecit("soru", v.baslik + " " + v.soru, req.kullanici.ad); }
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  const r = db.prepare("INSERT INTO hoca_sorulari (ogrenci, hoca, ders, baslik, soru, gizli, denetim) VALUES (?,?,?,?,?,?,?)")
    .run(req.kullanici.ad, v.hoca, v.ders, v.baslik, v.soru, v.gizli, kapi.oneri);
  const cevap = db.prepare("SELECT * FROM hoca_sorulari WHERE id=?").get(r.lastInsertRowid);
  if (kapi.oneri !== "yayinda") { const vid = vakaAc("soru", r.lastInsertRowid, req.kullanici.ad, kapi.d); cevap.bilgi = ogrenciMesaji(); cevap.vakaId = vid; } // gerçek id ile vaka
  if (kapi.oneri === "engellendi") return res.status(400).json({ hata: "🚫 " + ogrenciMesaji(), vakaId: cevap.vakaId });
  bildirimEkle(v.hoca, `${req.kullanici.ad} sana soru sordu: ${v.baslik}`); // hocaya haber (yayındaysa; incelemedeyse hoca yine görür)
  res.status(201).json(cevap);
});
app.get("/api/hoca-sorulari", girisSart, (req, res) => {
  const k = req.kullanici; // role göre görünürlük
  let liste;
  if (k.rol === "ogretmen") liste = db.prepare("SELECT * FROM hoca_sorulari WHERE hoca=? ORDER BY id DESC").all(k.ad); // yalnız bana gelenler
  else if (k.rol === "ogrenci") liste = db.prepare("SELECT * FROM hoca_sorulari WHERE ogrenci=? ORDER BY id DESC").all(k.ad); // yalnız sorduklarım
  else liste = db.prepare("SELECT * FROM hoca_sorulari ORDER BY id DESC LIMIT 50").all(); // admin/müdür hepsi (denetim)
  res.json(liste);
});
app.post("/api/hoca-sorulari/:id/cevap", girisSart, hizSiniri("hocaCevap"), istekKimlik(), benzerEngel("hocaCevap", b => b.metin), async (req, res) => {
  const s = db.prepare("SELECT * FROM hoca_sorulari WHERE id=?").get(req.params.id); // soru
  if (!s) return res.status(404).json({ hata: "Soru yok!" });
  if (req.kullanici.rol !== "ogretmen" || s.hoca !== req.kullanici.ad) return res.status(403).json({ hata: "Sadece sorunun öğretmeni cevaplar!" });
  const sonuc = MetinSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  let kapiC;
  try { kapiC = await aiGecit("soru", sonuc.data.metin, req.kullanici.ad); }
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  db.prepare("UPDATE hoca_sorulari SET cevap=?, durum='Cevaplandı', denetim=? WHERE id=?").run(sonuc.data.metin, kapiC.oneri, s.id); // cevap denetimden geçer
  rozetGuncelle(req.kullanici.ad); // Öğretmen Yıldızı rozeti
  if (kapiC.oneri !== "yayinda") vakaAc("soru", s.id, req.kullanici.ad, kapiC.d); // gerçek id ile vaka
  bildirimEkle(s.ogrenci, `${s.hoca} sorunu cevapladı: ${s.baslik}`); // öğrenciye haber
  const cCevap = { tamam: "Cevaplandı." };
  if (kapiC.oneri !== "yayinda") { cCevap.bilgi = ogrenciMesaji(); }
  res.json(cCevap);
});
app.post("/api/hoca-sorulari/:id/puan", girisSart, (req, res) => {
  const s = db.prepare("SELECT * FROM hoca_sorulari WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ hata: "Soru yok!" });
  if (s.ogrenci !== req.kullanici.ad) return res.status(403).json({ hata: "Sadece soruyu soran puanlar!" });
  if (s.durum !== "Cevaplandı") return res.status(400).json({ hata: "Önce cevap gelsin!" });
  const puan = +req.body?.puan; // 1-5 yıldız
  if (![1, 2, 3, 4, 5].includes(puan)) return res.status(400).json({ hata: "1-5 arası puan ver!" });
  const isle = db.islem(() => { // eski puanı düş, yeniyi ekle
    db.prepare("UPDATE kullanicilar SET puan=puan-? WHERE ad=?").run(s.puan || 0, s.hoca); // eskiyi geri al
    db.prepare("UPDATE hoca_sorulari SET puan=? WHERE id=?").run(puan, s.id);
    db.prepare("UPDATE kullanicilar SET puan=puan+? WHERE ad=?").run(puan, s.hoca); // yeniyi ekle
  });
  isle();
  bildirimEkle(s.hoca, `${s.ogrenci} sana ⭐${puan} verdi!`); // hocaya haber
  res.json({ tamam: "Puan iletildi! 🙏" });
});
app.post("/api/hoca-sorulari/:id/paylas", girisSart, (req, res) => {
  const s = db.prepare("SELECT * FROM hoca_sorulari WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ hata: "Soru yok!" });
  if (s.ogrenci !== req.kullanici.ad) return res.status(403).json({ hata: "Sadece soruyu soran paylaşır!" });
  if (s.durum !== "Cevaplandı" || s.gizli !== "acik") return res.status(400).json({ hata: "Yalnız cevaplanmış açık sorular paylaşılır!" });
  if (s.paylasildi) return res.status(400).json({ hata: "Zaten paylaşıldı!" });
  const isle = db.islem(() => { // akışa taşı + işaretle
    db.prepare("INSERT INTO gonderiler (yazar, tur, ders, baslik, aciklama, cozuldu) VALUES (?,?,?,?,?,1)")
      .run(s.ogrenci, "Çözüm Paylaşımı", s.ders, s.baslik, "Soru: " + s.soru + "\nÖğretmen (" + s.hoca + ") cevabı: " + s.cevap);
    db.prepare("UPDATE hoca_sorulari SET paylasildi=1 WHERE id=?").run(s.id);
  });
  isle();
  res.json({ tamam: "Akışta paylaşıldı! 🎉" });
});
app.post("/api/hoca-sorulari/:id/kapat", girisSart, (req, res) => {
  const s = db.prepare("SELECT * FROM hoca_sorulari WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ hata: "Soru yok!" });
  if (s.ogrenci !== req.kullanici.ad) return res.status(403).json({ hata: "Sadece soruyu soran kapatır!" });
  db.prepare("UPDATE hoca_sorulari SET durum='Kapatıldı' WHERE id=?").run(s.id);
  res.json({ tamam: "Kapatıldı." });
});

// --- Şifre: değiştir (girişli) + unutma altyapısı (e-postasız, dürüst) ---
app.post("/api/sifre-degistir", girisSart, girisSiniri, (req, res) => {
  const { eski, yeni } = req.body || {}; // eski + yeni şifre
  if (!yeni || yeni.length < 4) return res.status(400).json({ hata: "Yeni şifre en az 4 karakter!" });
  const k = db.prepare("SELECT sifre_hash FROM kullanicilar WHERE ad=?").get(req.kullanici.ad);
  if (!bcrypt.compareSync(eski || "", k.sifre_hash)) return res.status(401).json({ hata: "Eski şifre yanlış!" });
  db.prepare("UPDATE kullanicilar SET sifre_hash=?, sifre_surum=sifre_surum+1 WHERE ad=?").run(bcrypt.hashSync(yeni, 10), req.kullanici.ad); // şifre + eski biletleri iptal
  res.json({ tamam: "Şifren değişti. Başka cihazlardaki oturumların kapatıldı, tekrar giriş yap!" });
});
app.post("/api/sifre-unuttum", girisSiniri, (req, res) => {
  // DÜRÜSTLÜK: e-posta servisi bağlı değil, o yüzden jeton ÜRETİLMEZ ve kayıt YAZILMAZ.
  // Gerçek gönderim için SMTP (örn. nodemailer) gerekir; o ayrı iştir, aşağısı yönetici akışıdır.
  res.json({ tamam: "E-posta servisi bağlı değil, bu yüzden sıfırlama bağlantısı GÖNDERİLMEDİ. Yöneticinden (Hesap sayfasındaki yönetici paneliyle) sıfırlama iste." });
});
app.post("/api/admin/sifre-sifirla", girisSart, rolSart("admin"), (req, res) => {
  const { ad, yeni } = req.body || {}; // admin sıfırlar
  if (!db.prepare("SELECT ad FROM kullanicilar WHERE ad=?").get(ad)) return res.status(404).json({ hata: "Kullanıcı yok!" });
  if (!yeni || yeni.length < 4) return res.status(400).json({ hata: "Yeni şifre en az 4 karakter!" });
  db.prepare("UPDATE kullanicilar SET sifre_hash=?, sifre_surum=sifre_surum+1 WHERE ad=?").run(bcrypt.hashSync(yeni, 10), ad); // şifre + eski biletleri iptal
  db.prepare("DELETE FROM sifre_sifirlama WHERE ad=?").run(ad); // eski jetonları iptal et
  db.prepare("INSERT INTO denetim_kaydi (kim, aksiyon, hedef) VALUES (?,?,?)").run(req.kullanici.ad, "sifre-sifirla", ad);
  bildirimEkle(ad, "Şifren yönetici tarafından sıfırlandı."); // haber ver
  res.json({ tamam: "Şifre sıfırlandı." });
});

// --- Gizli Sınav Havuzu: öğretmen yükler, içerik şifreli, öğrenciler göremez ---
const { sifrele, metinHash } = require("./ai/havuz");
app.post("/api/havuz", girisSart, rolSart("ogretmen", "admin"), (req, res) => {
  if (req.kullanici.rol === "ogretmen") { // onaysız hoca havuza yazamaz (uç seviyesinde onay şartı)
    const o = db.prepare("SELECT onay FROM kullanicilar WHERE ad=?").get(req.kullanici.ad);
    if (!o || !o.onay) return res.status(403).json({ hata: "Önce admin onayı gerekli!" });
  }
  const Sema = z.object({ ders: z.string().min(1).max(20), metin: z.string().min(10, "Soru metni en az 10 harf").max(5000) });
  const sonuc = Sema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const s = (() => { try { return sifrele(sonuc.data.metin); } catch (e) { return { hata: e }; } })(); // kilitle (anahtar yoksa 503)
  if (s.hata) return res.status(s.hata.kod || 503).json({ hata: s.hata.mesaj || "Havuz kapalı!" });
  const r = db.prepare("INSERT INTO sinav_havuzu (ders, ekleyen, veri_sifreli, iv, etiket, metin_hash) VALUES (?,?,?,?,?,?)")
    .run(sonuc.data.ders, req.kullanici.ad, s.veri, s.iv, s.etiket, metinHash(sonuc.data.metin));
  res.status(201).json({ id: r.lastInsertRowid, tamam: "Havuzda saklandı (şifreli)." });
});
app.get("/api/havuz", girisSart, rolSart("ogretmen", "admin"), (req, res) => {
  const k = req.kullanici; // yalnız üstbilgi (metin ASLA verilmez)
  const liste = k.rol === "admin"
    ? db.prepare("SELECT id, ders, ekleyen, tarih FROM sinav_havuzu ORDER BY id DESC").all()
    : db.prepare("SELECT id, ders, ekleyen, tarih FROM sinav_havuzu WHERE ekleyen=? ORDER BY id DESC").all(k.ad);
  res.json(liste);
});
app.delete("/api/havuz/:id", girisSart, (req, res) => {
  const h = db.prepare("SELECT * FROM sinav_havuzu WHERE id=?").get(req.params.id);
  if (!h) return res.status(404).json({ hata: "Kayıt yok!" });
  if (h.ekleyen !== req.kullanici.ad && req.kullanici.rol !== "admin") return res.status(403).json({ hata: "Yetkin yok!" });
  db.prepare("DELETE FROM sinav_havuzu WHERE id=?").run(h.id);
  res.json({ tamam: "Silindi." });
});

// --- Denetim paneli (müdür yardımcısı + admin): vaka kuyruğu, SLA'lı ---
app.get("/api/denetim/vakalar", girisSart, rolSart("mudur", "admin"), (req, res) => {
  const liste = db.prepare(`SELECT *, datetime('now') > sla_son AS gecikti,
    CASE WHEN skor > 0.80 OR kategori='SINAV_SIZINTISI' THEN 1 ELSE 0 END AS acil
    FROM vakalar ORDER BY acil DESC, gecikti DESC, id DESC LIMIT 100`).all(); // acil ve geciken üstte
  res.json(liste.map(v => ({ ...v, kanit: JSON.parse(v.kanit || "[]") }))); // kanıtı listeye çevir
});
app.post("/api/denetim/vakalar/:id/karar", girisSart, rolSart("mudur", "admin"), (req, res) => {
  const v = db.prepare("SELECT * FROM vakalar WHERE id=?").get(req.params.id); // vaka
  if (!v) return res.status(404).json({ hata: "Vaka yok!" });
  if (!["bekliyor", "ogretmende"].includes(v.durum)) return res.status(400).json({ hata: `Bu vaka zaten sonuçlanmış (durum: ${v.durum}). Tekrar ceza yok!` }); // idempotent: tekrar uygulama engeli
  const { karar, hoca } = req.body || {}; // karar + (iletimde hedef hoca)
  const OK = ["yayinla", "kaldir", "uyar", "askiya", "ogretmene", "yanlis-alarm"]; // geçerli kararlar
  if (!OK.includes(karar)) return res.status(400).json({ hata: "Geçersiz karar!" });
  const isle = db.islem(() => { // hepsi tek işlemde (yarım kalmaz)
    const { tablo } = vakaIcerik(v); // ÖNCE doğrula: doğru tablo + doğru yazar (yanlış içeriğe işlem yok)
    void tablo; // tablo adı sabit listeden gelir (SQL'e gömülü değişken yok)
    const icerikSil = () => { // türe göre silme (kaskadlı)
      if (v.tur === "gonderi") {
        db.prepare("DELETE FROM yanitlar WHERE yorum_id IN (SELECT id FROM yorumlar WHERE gonderi_id=?)").run(v.hedef_id);
        db.prepare("DELETE FROM yorumlar WHERE gonderi_id=?").run(v.hedef_id);
        db.prepare("DELETE FROM begeniler WHERE gonderi_id=?").run(v.hedef_id);
        db.prepare("DELETE FROM kaydetmeler WHERE gonderi_id=?").run(v.hedef_id);
        db.prepare("DELETE FROM gonderiler WHERE id=?").run(v.hedef_id);
      }
      else if (v.tur === "yorum") { db.prepare("DELETE FROM yanitlar WHERE yorum_id=?").run(v.hedef_id); db.prepare("DELETE FROM yorumlar WHERE id=?").run(v.hedef_id); }
      else if (v.tur === "yanit") db.prepare("DELETE FROM yanitlar WHERE id=?").run(v.hedef_id); // yalnız o yanıt
      else if (v.tur === "oda") { db.prepare("DELETE FROM oda_mesajlari WHERE oda_id=?").run(v.hedef_id); db.prepare("DELETE FROM odalar WHERE id=?").run(v.hedef_id); }
      else if (v.tur === "mesaj") db.prepare("DELETE FROM oda_mesajlari WHERE id=?").run(v.hedef_id);
      else if (v.tur === "sohbetmesaji") db.prepare("DELETE FROM mesajlar WHERE id=?").run(v.hedef_id); // yalnız o sohbet mesajı
      else if (v.tur === "soru") db.prepare("DELETE FROM hoca_sorulari WHERE id=?").run(v.hedef_id);
    };
    if (karar === "yayinla") { // onayla ve yayınla (doğrulanan içerik)
      durumYaz(v.tur, v.hedef_id, "yayinda");
      db.prepare("UPDATE vakalar SET durum='yayinda', karar_veren=?, karar_tarih=datetime('now') WHERE id=?").run(req.kullanici.ad, v.id);
      bildirimEkle(v.yazar, "Paylaşımın incelendi ve yayınlandı. Teşekkürler!"); // doğrulamadan sonra haber
    } else if (karar === "kaldir") { // içeriği kaldır (doğrulanan içerik)
      icerikSil();
      db.prepare("UPDATE vakalar SET durum='kaldirildi', karar_veren=?, karar_tarih=datetime('now') WHERE id=?").run(req.kullanici.ad, v.id);
      bildirimEkle(v.yazar, "Bir paylaşımın kurallara aykırı bulundu ve kaldırıldı. Kuralları oku, itiraz edebilirsin."); // doğrulamadan sonra haber
    } else if (karar === "uyar") { // kullanıcıyı uyar (kalıcı ceza yok)
      db.prepare("UPDATE kullanicilar SET uyari=uyari+1 WHERE ad=?").run(v.yazar);
      db.prepare("UPDATE vakalar SET durum='kaldirildi', karar_veren=?, karar_tarih=datetime('now') WHERE id=?").run(req.kullanici.ad, v.id);
      bildirimEkle(v.yazar, "Denetimden uyarı aldın. Tekrarında hesabın askıya alınabilir.");
    } else if (karar === "askiya") { // geçici askıya al (insan kararı)
      db.prepare("UPDATE kullanicilar SET askida=1 WHERE ad=?").run(v.yazar);
      db.prepare("UPDATE vakalar SET durum='kaldirildi', karar_veren=?, karar_tarih=datetime('now') WHERE id=?").run(req.kullanici.ad, v.id);
      db.prepare("INSERT INTO denetim_kaydi (kim, aksiyon, hedef) VALUES (?,?,?)").run(req.kullanici.ad, "denetim-aski", v.yazar);
    } else if (karar === "ogretmene") { // öğretmene ilet (vaka öğretmene atanır)
      if (!hoca) throw { kod: 400, mesaj: "Öğretmen seç!" };
      if (!db.prepare("SELECT ad FROM kullanicilar WHERE ad=? AND rol='ogretmen' AND onay=1").get(hoca)) throw { kod: 400, mesaj: "Onaylı öğretmen bulunamadı!" };
      db.prepare("UPDATE vakalar SET durum='ogretmende', ogretmen=?, karar_veren=?, karar_tarih=datetime('now') WHERE id=?").run(hoca, req.kullanici.ad, v.id);
      bildirimEkle(hoca, `Denetimden sana vaka iletildi (#${v.id}, ${v.kategori}).`);
    } else { // yanlis-alarm: kayıt iyileştirme verisi olur, DOĞRULANAN içerik yayınlanır
      durumYaz(v.tur, v.hedef_id, "yayinda");
      db.prepare("UPDATE vakalar SET durum='yanlis-alarm', karar_veren=?, karar_tarih=datetime('now') WHERE id=?").run(req.kullanici.ad, v.id);
      bildirimEkle(v.yazar, "Paylaşımın incelendi, sorun yokmuş. Yayınlandı!");
    }
  });
  try { isle(); } catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  db.prepare("INSERT INTO denetim_kaydi (kim, aksiyon, hedef) VALUES (?,?,?)").run(req.kullanici.ad, "denetim-" + karar, "#" + v.id); // HER karar kayda geçer
  res.json({ tamam: "Karar işlendi." });
});
// Atanmış öğretmenin vakaları: yalnız metadata + itiraz (içerik ve gerekçe YOK)
app.get("/api/ogretmen/vakalar", girisSart, rolSart("ogretmen", "admin"), (req, res) => {
  const k = req.kullanici;
  const liste = k.rol === "admin"
    ? db.prepare("SELECT id, tur, kategori, skor, durum, itiraz, olusturma, ogretmen FROM vakalar WHERE durum='ogretmende' ORDER BY id DESC").all()
    : db.prepare("SELECT id, tur, kategori, skor, durum, itiraz, olusturma FROM vakalar WHERE durum='ogretmende' AND ogretmen=? ORDER BY id DESC").all(k.ad);
  res.json(liste);
});
// Öğrenci itirazı: yalnız kendi içeriği, yalnız açık vakaya (bekliyor)
app.post("/api/vakalar/:id/itiraz", girisSart, (req, res) => {
  const v = db.prepare("SELECT * FROM vakalar WHERE id=?").get(req.params.id);
  if (!v) return res.status(404).json({ hata: "Vaka yok!" });
  if (v.yazar !== req.kullanici.ad) return res.status(403).json({ hata: "Yalnız kendi içeriğine itiraz edersin!" });
  if (v.durum !== "bekliyor") return res.status(400).json({ hata: `Bu vakaya itiraz edilemez (durum: ${v.durum}).` }); // sonuçlanmışa itiraz yok
  const { metin } = req.body || {};
  if (!metin || metin.length < 3) return res.status(400).json({ hata: "İtirazını kısaca yaz!" });
  db.prepare("UPDATE vakalar SET itiraz=?, durum='bekliyor' WHERE id=?").run(metin.slice(0, 500), v.id); // kuyruğa geri al
  res.json({ tamam: "İtirazın alındı, yeniden incelenecek." });
});
app.get("/api/vakalarim", girisSart, (req, res) => { // kendi vakalarım (itiraz için)
  res.json(db.prepare("SELECT id, tur, kategori, skor, durum, itiraz, olusturma FROM vakalar WHERE yazar=? ORDER BY id DESC").all(req.kullanici.ad));
});

// --- E-Karne + Ders Programı: yalnız sahibine (hesap başına veri) ---
function netHesaplaSrv(dogru, yanlis, kural) { // sunucu net hesabı (kural kayıtlı kalır)
  if (kural === "3y1d") return dogru - yanlis / 3; // 3 yanlış 1 doğruyu götürür
  if (kural === "yok") return dogru; // yanlış götürmez
  return dogru - yanlis / 4; // varsayılan: 4 yanlış 1 doğruyu götürür
}
const KURAL = z.enum(["4y1d", "3y1d", "yok"]); // net kuralları
const DenemeSema = z.object({ // deneme doğrulama: sonlu, negatif değil, toplamı aşmaz
  tarih: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı!"),
  tur: z.enum(["Ders Denemesi", "Genel Deneme"]).default("Ders Denemesi"),
  yayin: z.string().max(30).optional().default(""),
  ders: z.string().max(30).optional().default("Genel"),
  soru: z.number().int("Tam sayı olmalı!").min(1, "En az 1 soru!").max(500),
  dogru: z.number().int("Tam sayı olmalı!").min(0, "Negatif olmaz!"),
  yanlis: z.number().int("Tam sayı olmalı!").min(0, "Negatif olmaz!"),
  kural: KURAL.default("4y1d") // kayıt anındaki kural (sonradan sessizce değişmez!)
}).refine(v => v.dogru + v.yanlis <= v.soru, "Doğru+yanlış soru sayısını geçemez!");
const ProgramSema = z.object({ // program doğrulama (boyut sınırlı)
  sinif: z.string().max(15).optional().default(""),
  hucre: z.record(z.string().max(40), z.object({ ders: z.string().max(30), yapildi: z.boolean() })).default({}),
  ozelDersler: z.array(z.string().max(30)).max(50).default([])
}).refine(v => JSON.stringify(v).length <= 200000, "Program çok büyük!");
function sahipKontrol(sahip, kim) { // sahiplik: uymazsa 404 (varlık bilgisi sızmaz)
  if (sahip !== kim) { const h = new Error("Kayıt yok!"); h.kod = 404; throw h; }
}
app.get("/api/program", girisSart, (req, res) => {
  const r = db.prepare("SELECT veri, surum FROM calisma_programi WHERE sahip=?").get(req.kullanici.ad); // yalnız kendiminki
  if (!r) return res.json(null); // yoksa boş
  res.json({ ...JSON.parse(r.veri), surum: r.surum ?? 1 }); // sürümüyle birlikte
});
app.put("/api/program", girisSart, hizSiniri("program"), istekKimlik(), (req, res) => {
  const govde = req.body || {}; // iki biçim kabul: ham veri YA DA {data, surum} (çakışma kontrollü!)
  const sonuc = ProgramSema.safeParse(govde.data ?? govde); // doğrula
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const beklenen = govde.surum; // istemcinin gördüğü sürüm (çakışma kontrolü!)
  const mevcut = db.prepare("SELECT surum FROM calisma_programi WHERE sahip=?").get(req.kullanici.ad);
  if (mevcut && beklenen !== undefined && +beklenen !== (mevcut.surum ?? 1))
    return res.status(409).json({ hata: "Başka cihazda değişmiş! Önce tazele, sonra yaz.", sunucu: true }); // ESKİ istek YENİYİ EZEMEZ!
  const yazi = JSON.stringify(sonuc.data);
  if (mevcut) db.prepare("UPDATE calisma_programi SET veri=?, surum=surum+1, guncelleme=datetime('now') WHERE sahip=?").run(yazi, req.kullanici.ad); // sürümü artır
  else db.prepare("INSERT INTO calisma_programi (sahip, veri, surum) VALUES (?,?,1)").run(req.kullanici.ad, yazi);
  const s = db.prepare("SELECT surum FROM calisma_programi WHERE sahip=?").get(req.kullanici.ad).surum; // yeni sürüm
  res.json({ tamam: "Kaydedildi.", surum: s }); // SUNUCU ONAYI (bunu görmeden kaydedildi denmez!)
});
app.get("/api/denemeler", girisSart, (req, res) => {
  res.json(db.prepare("SELECT * FROM denemeler WHERE sahip=? ORDER BY tarih DESC, id DESC").all(req.kullanici.ad)); // yalnız kendiminkiler
});
app.post("/api/denemeler", girisSart, hizSiniri("deneme"), istekKimlik(), (req, res) => {
  const sonuc = DenemeSema.safeParse(req.body); // doğrula
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const v = sonuc.data;
  const bos = v.soru - v.dogru - v.yanlis, net = netHesaplaSrv(v.dogru, v.yanlis, v.kural); // hesapla
  const r = db.prepare("INSERT INTO denemeler (sahip, tarih, tur, yayin, ders, soru, dogru, yanlis, bos, net, kural) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(req.kullanici.ad, v.tarih, v.tur, v.yayin, v.ders, v.soru, v.dogru, v.yanlis, bos, net, v.kural);
  res.status(201).json(db.prepare("SELECT * FROM denemeler WHERE id=?").get(r.lastInsertRowid));
});
app.put("/api/denemeler/:id", girisSart, yazmaSiniri, (req, res) => {
  const eski = db.prepare("SELECT * FROM denemeler WHERE id=?").get(req.params.id); // bul
  if (!eski) return res.status(404).json({ hata: "Kayıt yok!" });
  try { sahipKontrol(eski.sahip, req.kullanici.ad); } catch (e) { return res.status(e.kod).json({ hata: e.message }); } // başkasınınki yok hükmünde
  const sonuc = DenemeSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const v = sonuc.data;
  db.prepare("UPDATE denemeler SET tarih=?, tur=?, yayin=?, ders=?, soru=?, dogru=?, yanlis=?, bos=?, net=?, kural=? WHERE id=?")
    .run(v.tarih, v.tur, v.yayin, v.ders, v.soru, v.dogru, v.yanlis, v.soru - v.dogru - v.yanlis, netHesaplaSrv(v.dogru, v.yanlis, v.kural), v.kural, eski.id);
  res.json(db.prepare("SELECT * FROM denemeler WHERE id=?").get(eski.id));
});
app.delete("/api/denemeler/:id", girisSart, (req, res) => {
  const eski = db.prepare("SELECT * FROM denemeler WHERE id=?").get(req.params.id);
  if (!eski) return res.status(404).json({ hata: "Kayıt yok!" });
  try { sahipKontrol(eski.sahip, req.kullanici.ad); } catch (e) { return res.status(e.kod).json({ hata: e.message }); }
  db.prepare("DELETE FROM denemeler WHERE id=?").run(eski.id);
  res.json({ tamam: "Silindi." });
});
app.post("/api/denemeler/ice-aktar", girisSart, hizSiniri("deneme"), istekKimlik(), (req, res) => { // dışa aktarılanı geri yükler (çift kayıt yok)
  const Sema = z.object({ denemeler: z.array(DenemeSema).max(500) }); // en fazla 500 kayıt
  const sonuc = Sema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  let eklenen = 0, atlanan = 0; // sayaçlar
  const isle = db.islem(() => {
    for (const v of sonuc.data.denemeler) { // tek tek doğrulanmış
      const var1 = db.prepare("SELECT id FROM denemeler WHERE sahip=? AND tarih=? AND tur=? AND yayin=? AND ders=? AND soru=? AND dogru=? AND yanlis=? AND kural=?")
        .get(req.kullanici.ad, v.tarih, v.tur, v.yayin, v.ders, v.soru, v.dogru, v.yanlis, v.kural); // tıpatıp aynı (tür+kural dahil!) var mı
      if (var1) { atlanan++; continue; } // tekrar aktarımda çift kayıt YOK
      db.prepare("INSERT INTO denemeler (sahip, tarih, tur, yayin, ders, soru, dogru, yanlis, bos, net, kural) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(req.kullanici.ad, v.tarih, v.tur, v.yayin, v.ders, v.soru, v.dogru, v.yanlis, v.soru - v.dogru - v.yanlis, netHesaplaSrv(v.dogru, v.yanlis, v.kural), v.kural);
      eklenen++;
    }
  });
  isle(); // tek işlemde
  res.json({ tamam: `${eklenen} eklendi, ${atlanan} atlandı.`, eklenen, atlanan });
});

// --- Notlarım: kişisel notlar (YALNIZ sahibine; herkesin gönderilerinden AYRI!) ---
const NOT_RENKLER = ["sari", "yesil", "mavi", "kirmizi", "mor", "gri"]; // erişilebilir etiket renkleri (arayüzde metinle de yazılır)
const NotSema = z.object({ // not doğrulama: başlık zorunlu, içerik/tarih sınırlı
  baslik: z.string().trim().min(1, "Başlık boş olamaz!").max(80, "Başlık en fazla 80 harf!"),
  icerik: z.string().max(5000, "Not en fazla 5000 harf!").optional().default(""),
  ders: z.string().trim().max(30, "Ders adı en fazla 30 harf!").optional().default(""),
  tarih: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı!")]).optional().default(""),
  renk: z.enum(NOT_RENKLER).optional().default("sari"), // geçersiz renk sessizce kabul EDİLMEZ
  sabit: z.boolean().optional().default(false) // üstte sabitlensin mi
});
const NOT_ALANLAR = "id, baslik, icerik, ders, tarih, renk, sabit, olusturma, guncelleme"; // dönen alanlar (sahip DIŞA VERİLMEZ)
app.get("/api/notlar", girisSart, (req, res) => { // yalnız KENDİ notlarım (sahiplik oturumdan!)
  res.json(db.prepare(`SELECT ${NOT_ALANLAR} FROM notlar WHERE sahip=? ORDER BY sabit DESC, guncelleme DESC, id DESC`).all(req.kullanici.ad));
});
app.post("/api/notlar", girisSart, hizSiniri("not"), istekKimlik(), (req, res) => { // oluştur (çift tıklama tek kayıt!)
  const sonuc = NotSema.safeParse(req.body); // doğrula
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const v = sonuc.data;
  const r = db.prepare("INSERT INTO notlar (sahip, baslik, icerik, ders, tarih, renk, sabit) VALUES (?,?,?,?,?,?,?)")
    .run(req.kullanici.ad, v.baslik, v.icerik, v.ders, v.tarih, v.renk, v.sabit ? 1 : 0); // sahip OTURUMDAN (istemciden ASLA!)
  res.status(201).json(db.prepare(`SELECT ${NOT_ALANLAR} FROM notlar WHERE id=?`).get(r.lastInsertRowid));
});
app.put("/api/notlar/:id", girisSart, hizSiniri("not"), istekKimlik(), (req, res) => {
  const eski = db.prepare("SELECT * FROM notlar WHERE id=?").get(req.params.id); // bul
  if (!eski) return res.status(404).json({ hata: "Not yok!" });
  try { sahipKontrol(eski.sahip, req.kullanici.ad); } catch (e) { return res.status(e.kod).json({ hata: e.message }); } // başkasınınki yok hükmünde
  const sonuc = NotSema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const v = sonuc.data;
  db.prepare("UPDATE notlar SET baslik=?, icerik=?, ders=?, tarih=?, renk=?, sabit=?, guncelleme=datetime('now') WHERE id=?")
    .run(v.baslik, v.icerik, v.ders, v.tarih, v.renk, v.sabit ? 1 : 0, eski.id);
  res.json(db.prepare(`SELECT ${NOT_ALANLAR} FROM notlar WHERE id=?`).get(eski.id));
});
app.delete("/api/notlar/:id", girisSart, (req, res) => {
  const eski = db.prepare("SELECT * FROM notlar WHERE id=?").get(req.params.id);
  if (!eski) return res.status(404).json({ hata: "Not yok!" });
  try { sahipKontrol(eski.sahip, req.kullanici.ad); } catch (e) { return res.status(e.kod).json({ hata: e.message }); }
  db.prepare("DELETE FROM notlar WHERE id=?").run(eski.id);
  res.json({ tamam: "Not silindi." });
});

// --- Eğitim asistanı sohbeti (moderasyon modelinden AYRI servis!) ---
const { mockCevap, gercekCevapAkis, GUNLUK_LIMIT, BAGLAM_MESAJ } = require("./ai/sohbet"); // sağlayıcı (gerçek akışlı!)
function sohbetSahip(id, kim) { // sahiplik: başkasının sohbeti yok hükmünde
  const s = db.prepare("SELECT * FROM sohbetler WHERE id=?").get(id);
  if (!s) { const h = new Error("Sohbet yok!"); h.kod = 404; throw h; }
  if (s.sahip !== kim) { const h = new Error("Sohbet yok!"); h.kod = 404; throw h; } // varlık sızmaz
  return s;
}
app.get("/api/sohbet", girisSart, (req, res) => {
  res.json(db.prepare("SELECT id, baslik, ders, guncelleme FROM sohbetler WHERE sahip=? ORDER BY guncelleme DESC").all(req.kullanici.ad)); // yalnız kendiminkiler
});
app.post("/api/sohbet", girisSart, hizSiniri("sohbetAc"), istekKimlik(), (req, res) => {
  const Sema = z.object({ baslik: z.string().max(60).optional().default("Sohbet"), ders: z.string().max(20).optional().default("") });
  const sonuc = Sema.safeParse(req.body);
  if (!sonuc.success) return res.status(400).json({ hata: sonuc.error.issues[0].message });
  const r = db.prepare("INSERT INTO sohbetler (sahip, baslik, ders) VALUES (?,?,?)").run(req.kullanici.ad, sonuc.data.baslik, sonuc.data.ders);
  res.status(201).json(db.prepare("SELECT id, baslik, ders, guncelleme FROM sohbetler WHERE id=?").get(r.lastInsertRowid));
});
app.put("/api/sohbet/:id", girisSart, (req, res) => {
  try { sohbetSahip(req.params.id, req.kullanici.ad); } catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj }); } // sahiplik
  const { baslik } = req.body || {};
  if (!baslik || baslik.length > 60) return res.status(400).json({ hata: "Başlık 1-60 harf olmalı!" });
  db.prepare("UPDATE sohbetler SET baslik=? WHERE id=?").run(baslik, req.params.id); // yeniden adlandır
  res.json({ tamam: "Adlandırıldı." });
});
app.delete("/api/sohbet/:id", girisSart, (req, res) => {
  try { sohbetSahip(req.params.id, req.kullanici.ad); } catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj }); }
  db.prepare("DELETE FROM mesajlar WHERE sohbet_id=?").run(req.params.id); // önce mesajlar
  db.prepare("DELETE FROM sohbetler WHERE id=?").run(req.params.id); // sonra sohbet
  res.json({ tamam: "Silindi." });
});
app.get("/api/sohbet/:id/mesajlar", girisSart, (req, res) => {
  try { sohbetSahip(req.params.id, req.kullanici.ad); } catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj }); }
  res.json(db.prepare("SELECT rol, metin, tarih FROM mesajlar WHERE sohbet_id=? ORDER BY id").all(req.params.id)); // geçmiş
});
app.post("/api/sohbet/:id/mesaj", girisSart, hizSiniri("sohbet"), istekKimlik(), async (req, res) => { // spam: AI 8/dk + istek tekilliği
  let s; // sohbet (sahiplikli)
  try { s = sohbetSahip(req.params.id, req.kullanici.ad); } catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj }); }
  const { metin, devam, uretim } = req.body || {}; // soru + devam bayrağı + ÜRETİM kimliği (retry tekilliği!)
  if (!metin || !metin.trim() || metin.length > 2000) return res.status(400).json({ hata: "Soru 1-2000 harf olmalı!" });
  const uretimId = (uretim && String(uretim).slice(0, 32)) || ("u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); // istemci kimliği varsa ONU kullan
  const icerikHash = crypto.createHash("sha1").update(metin.slice(0, 2000)).digest("hex"); // üretim kimliği İÇERİĞE bağlı
  const mockMod = !(AYAR.llmAcik && process.env.AI_API_KEY); // anahtar yoksa DENEME modu (sahte cevap YOK!)
  const kotaDurum = d => { try { db.prepare("UPDATE ai_kullanim SET durum=? WHERE kullanici=? AND uretim_id=?").run(d, req.kullanici.ad, uretimId); } catch { /* geç */ } }; // üretim durumu
  const zatenYanit = () => { try { res.write(`data: ${JSON.stringify({ bitti: true, mock: mockMod, tekrar: true })}\n\n`); res.end(); } catch { /* geç */ } }; // tamamlanmış üretim tekrarı
  const onceki = db.prepare("SELECT * FROM ai_kullanim WHERE kullanici=? AND uretim_id=?").get(req.kullanici.ad, uretimId); // AYNI üretim daha önce?
  if (onceki) { // üretim kimliği tekilliği (kullanıcı + sohbet + içerik) — üretimden ÖNCE ele alınır
    if (onceki.sohbet_id && (onceki.sohbet_id !== s.id || (onceki.icerik_hash || "") !== icerikHash)) return res.status(409).json({ hata: "Bu üretim kimliği başka bir sohbet/içerikte kullanılamaz!" }); // kimlik başka içerikte yasak (taşınmış eski kayıtta sohbet_id=0 → atlanır)
    if (onceki.durum === "basarili") return zatenYanit(); // zaten yanıtlanmış: TEKRAR ÜRETME (maliyet yok)
    if (onceki.durum === "islemde") return res.status(409).json({ hata: "Bu cevap şu an üretiliyor, bekle!", islemde: true }); // eşzamanlı tekrar → tek model çağrısı
  }
  let kapi; // soru denetimden geçer (havuz+sınav sorusu modele GİTMEZ!)
  try { kapi = await aiGecit("sohbetmesaji", metin, req.kullanici.ad); }
  catch (e) { return res.status(e.kod || 500).json({ hata: e.mesaj || "Olmadı!" }); }
  const son = db.prepare("SELECT id, metin FROM mesajlar WHERE sohbet_id=? AND rol='user' ORDER BY id DESC LIMIT 1").get(s.id); // son KULLANICI mesajı
  let soruId = null; // kaydedilen sorunun kimliği
  if (devam && son && son.metin === metin.slice(0, 2000)) soruId = son.id; // tekrar: YENİDEN YAZMA, var olanı kullan!
  else {
    const r = db.prepare("INSERT INTO mesajlar (sohbet_id, rol, metin, durum) VALUES (?, 'user', ?, ?)").run(s.id, metin.slice(0, 2000), kapi.oneri); // DURUMUYLA kaydet
    soruId = r.lastInsertRowid;
  }
  if (kapi.oneri !== "yayinda") { const vid = vakaAc("sohbetmesaji", soruId, req.kullanici.ad, kapi.d); return res.status(400).json({ hata: "🚫 " + ogrenciMesaji(), vakaId: vid, soruId }); } // GERÇEK id ile vaka, modele GİTMEDİ (kota harcanmaz!)
  // Katman 5: yalnız ONAYLI kütüphaneden getirim (moderasyondan AYRI). Getirilen içerik ve öğrenci metni GÜVENSİZ VERİDİR; içindeki emirler uygulanmaz.
  let getirilen = [];
  try { if (!(AYAR.asistan && AYAR.asistan.ragAcik === false)) getirilen = RAG.getir(metin, { kapsam: "uye" }); } catch { getirilen = []; }
  const kaynaklar = RAG.kaynakListesi(getirilen); // istemciye gösterilecek GERÇEK kaynak kimlikleri (uydurma yok)
  // ÜRETİM REZERVASYONU (denetimden GEÇTİKTEN sonra; yalnız gerçek model çağrısı kotayı harcar)
  if (onceki) { // basarisiz önceki deneme → güvenli yeniden dene (kota PK aynı, tekrar sayılmaz)
    db.prepare("UPDATE ai_kullanim SET durum='islemde' WHERE kullanici=? AND uretim_id=?").run(req.kullanici.ad, uretimId);
  } else { // YENİ üretim: günlük kota KONTROL edilir
    const bugun = db.prepare("SELECT COUNT(*) AS s FROM ai_kullanim WHERE kullanici=? AND tarih > datetime('now','-1 day')").get(req.kullanici.ad).s; // AI KOTASI: sohbet geçmişinden BAĞIMSIZ
    if (bugun >= GUNLUK_LIMIT) return res.status(429).json({ hata: `Günlük soru hakkın doldu (${GUNLUK_LIMIT})! Yarın yine bekleriz.`, bekleme: 3600, gunluk: true }); // günlük kullanım sınırı
    const ins = db.prepare("INSERT OR IGNORE INTO ai_kullanim (kullanici, uretim_id, sohbet_id, icerik_hash, durum) VALUES (?,?,?,?, 'islemde')").run(req.kullanici.ad, uretimId, s.id, icerikHash); // ATOMİK rezervasyon
    if (ins.changes === 0) { // yarış: başka istek sahiplendi
      const y = db.prepare("SELECT durum FROM ai_kullanim WHERE kullanici=? AND uretim_id=?").get(req.kullanici.ad, uretimId);
      if (y && y.durum === "basarili") return zatenYanit();
      return res.status(409).json({ hata: "Bu cevap şu an üretiliyor, bekle!", islemde: true });
    }
  }
  db.prepare("UPDATE sohbetler SET guncelleme=datetime('now') WHERE id=?").run(s.id); // tazele
  const gecmis = db.prepare("SELECT rol, metin FROM mesajlar WHERE sohbet_id=? AND durum='yayinda' AND id<>? ORDER BY id DESC LIMIT ?").all(s.id, soruId, BAGLAM_MESAJ).reverse() // ŞU ANKİ soru HARİÇ (çift gönderim yok!)
    .map(m => ({ role: m.rol === "user" ? "user" : "assistant", content: m.metin.slice(0, 1000) }));
  const istekKontrol = new AbortController(); // BU isteğin iptal kolu (upstream'e taşınır!)
  let istemciGitti = false; // bağlantı gerçekten koptu mu (normal bitiş DEĞİL!)
  req.on("close", () => { if (!res.writableEnded) { istemciGitti = true; istekKontrol.abort(); } }); // erken kapanış = iptal
  const parcaGonder = parca => { try { res.write(`data: ${JSON.stringify({ parca })}\n\n`); } catch { /* geç */ } }; // parça akıt
  const bitir = tam => { // YALNIZ tam cevap kaydedilir (yarım asla!)
    if (istemciGitti) { kotaDurum("basarisiz"); try { res.end(); } catch { /* geç */ } return; } // iptal: KAYDETME!
    if (tam) db.prepare("INSERT INTO mesajlar (sohbet_id, rol, metin, durum, uretim) VALUES (?, 'asistan', ?, 'yayinda', ?)").run(s.id, tam.slice(0, 1500), uretimId); // TAMAMSA kaydet
    kotaDurum("basarili"); // başarılı üretim
    try { res.write(`data: ${JSON.stringify({ bitti: true, mock: mockMod, kaynaklar })}\n\n`); res.end(); } catch { /* geç */ }
  };
  try {
    if (mockMod) { // DENEME: model yok — onaylı kütüphaneden yönlendirici ipucu/adımlar (SAHTE cevap YOK!)
      const ham = (AYAR.asistan && AYAR.asistan.ragAcik === false) ? mockCevap(metin, s.ders) : RAG.demoYanit(metin, getirilen);
      const tam = ham.slice(0, 1500);
      for (let i = 0; i < tam.length; i += 60) { // 60'ar harf akıt
        if (istemciGitti) { kotaDurum("basarisiz"); try { res.end(); } catch { /* geç */ } return; } // iptalde kaydetme
        parcaGonder(tam.slice(i, i + 60));
        await new Promise(r => setTimeout(r, 40)); // akış hissi
      }
      return bitir(tam);
    }
    const talimat = getirilen.length ? RAG.talimatEki(getirilen) : ""; // gerçek model: YALNIZ onaylı bağlam; uydurma atıf yasak
    const tam = await gercekCevapAkis(metin + talimat, gecmis, s.ders, istekKontrol.signal, p => parcaGonder(p)); // iptal sinyali bağlı; sınır sağlayıcıda
    bitir(tam);
  } catch (e) { // model hatası/iptal/yarım kapanış: SAHTE cevap YOK, başarı da YOK
    kotaDurum("basarisiz");
    if (!istemciGitti) { try { res.write(`data: ${JSON.stringify({ hata: e.iptal ? "iptal" : "Cevap tamamlanmadan bitti, tekrar dene." })}\n\n`); res.end(); } catch { /* geç */ } }
  }
});

// ================= Kütüphane + arama + öneri (kaynak destekli; gizli sınav havuzundan AYRI) =================
// Not: Bu katman YALNIZ kütüphane tablolarına dokunur. Notlar/sohbetler/öğretmen soruları ve gizli havuz buradan okunmaz.
const YONETICI_ROLLER = ["ogretmen", "mudur", "admin"];
function kullaniciOku(req) { // herkese açık uçlarda OPSİYONEL oturum (rol farkı için); bloklamaz
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return null;
    const kim = jwt.verify(h.slice(7), GIZLI);
    const t = db.prepare("SELECT ad, rol, askida, sifre_surum FROM kullanicilar WHERE ad=?").get(kim.ad);
    if (!t || t.askida || (t.sifre_surum || 0) !== (kim.sv || 0)) return null;
    return { ad: t.ad, rol: t.rol };
  } catch { return null; }
}
function icerikOzet(k) { // dışa dönük GÜVENLİ alanlar (gizli alan/gizli havuz yok)
  return { icerik_id: k.icerik_id, baslik: k.baslik, ozet: k.ozet, ders: k.ders, sinif: k.sinif, konu_id: k.konu_id, konu: k.konu, desen: k.desen, zorluk: k.zorluk, tur: k.tur, soru: k.soru, ipucu: k.ipucu, adimlar: k.adimlar || [], cevap: k.cevap, etiketler: k.etiketler || [], kaynak_ad: k.kaynak_ad, kaynak_url: k.kaynak_url, lisans: k.lisans, kalite: k.kalite, durum: k.durum, ornek: k.ornek, dogrulayan: k.dogrulayan, dogrulama_tarihi: k.dogrulama_tarihi, guncelleme: k.guncelleme, skor: k.skor, neden: k.neden };
}
function kayitlariCoz(body) { // içe aktarma gövdesi: kayitlar (dizi) | json (metin) | csv (metin)
  if (!body) return { hata: "Veri yok!" };
  if (Array.isArray(body.kayitlar)) return { kayitlar: body.kayitlar.slice(0, 500), bicim: "json" };
  if (typeof body.json === "string") { try { const a = JSON.parse(body.json); if (!Array.isArray(a)) return { hata: "JSON bir DİZİ olmalı!" }; return { kayitlar: a.slice(0, 500), bicim: "json" }; } catch { return { hata: "JSON çözümlenemedi!" }; } }
  if (typeof body.csv === "string") return { kayitlar: KUTUPHANE.csvKayitlari(body.csv).slice(0, 500), bicim: "csv" };
  return { hata: "kayitlar (dizi) | json (metin) | csv (metin) alanlarından biri gerekli." };
}

// Liste: filtreli + sayfalı (misafir yalnız 'herkes' görünümünü görür)
app.get("/api/kutuphane", (req, res) => {
  const k = kullaniciOku(req);
  const q = req.query;
  const r = KUTUPHANE.ara({ metin: String(q.q || q.metin || ""), ders: q.ders, sinif: q.sinif, konu_id: q.konu_id, desen: q.desen, zorluk: q.zorluk, tur: q.tur, kapsam: k ? "uye" : "misafir", limit: q.limit, offset: q.offset });
  res.json({ toplam: r.toplam, cozum: r.cozum, sonuclar: r.sonuclar.map(icerikOzet) });
});
// Konu taksonomisi (herkese açık)
app.get("/api/kutuphane/konular", (req, res) => {
  res.json(KUTUPHANE.konuListesi().map(k => { let es = []; try { es = JSON.parse(k.esanlam || "[]"); } catch { es = []; } return { konu_id: k.konu_id, ad: k.ad, ders: k.ders, ust_id: k.ust_id, esanlam: es }; }));
});
// Gerçek sayılar (personel)
app.get("/api/kutuphane/sayim", girisSart, rolSart(...YONETICI_ROLLER), (req, res) => res.json(KUTUPHANE.sayim()));
// İnceleme kuyruğu (personel): durum filtresiyle
app.get("/api/kutuphane/yonetim", girisSart, rolSart(...YONETICI_ROLLER), (req, res) => {
  const durum = ["taslak", "incelemede", "yayinda", "gizli", "silindi"].includes(String(req.query.durum)) ? String(req.query.durum) : "incelemede";
  const r = KUTUPHANE.ara({ metin: String(req.query.metin || ""), durum, kapsam: "yonetim", limit: req.query.limit, offset: req.query.offset });
  res.json({ durum, toplam: r.toplam, sonuclar: r.sonuclar.map(icerikOzet) });
});
// İçe aktarma önizlemesi (personel): doğrula + yinelenen tespit (DB'ye YAZMAZ)
app.post("/api/kutuphane/onizle", girisSart, rolSart(...YONETICI_ROLLER), (req, res) => {
  const g = kayitlariCoz(req.body);
  if (g.hata) return res.status(400).json({ hata: g.hata });
  const o = KUTUPHANE.iceAktarOnizle(g.kayitlar);
  res.json({ bicim: g.bicim, toplam: o.toplam, gecerli: o.gecerli, hatali: o.hatali, mukerrer: o.mukerrer, ornek: o.ornek });
});
// İçe aktarma (personel): hepsi TASLAK girer; incele→yayınla
app.post("/api/kutuphane/ice", girisSart, rolSart(...YONETICI_ROLLER), hizSiniri("genel"), (req, res) => {
  const g = kayitlariCoz(req.body);
  if (g.hata) return res.status(400).json({ hata: g.hata });
  const r = KUTUPHANE.iceAktar(g.kayitlar, { sahip: req.kullanici.ad, bicim: g.bicim });
  res.status(201).json({ ...r, mesaj: "İçe alınan kayıtlar TASLAK durumundadır; inceleyip yayınlamadan aramada/öneride görünmez." });
});
// İncele/yayınla/sil (durum değişimi; kurallar kutuphane.js'te)
app.post("/api/kutuphane/kaynak/:icerik_id/durum", girisSart, hizSiniri("genel"), (req, res) => {
  const hedef = String((req.body && req.body.durum) || "");
  const r = KUTUPHANE.durumDegistir(req.params.icerik_id, hedef, { aktor: req.kullanici.ad, rol: req.kullanici.rol });
  if (r.hata) return res.status(r.hata === "İçerik bulunamadı." ? 404 : 403).json({ hata: r.hata });
  res.json(r);
});
// Bakım (yalnız admin): bekleyen indeks işlerini işle + isteğe bağlı tüm indeksi yenile
app.post("/api/kutuphane/bakim", girisSart, rolSart("admin"), (req, res) => {
  const isler = KUTUPHANE.isleriIsle({ azami: 200 });
  const yenilenen = req.body && req.body.indeksiYenile ? KUTUPHANE.indeksiYenile() : 0;
  res.json({ ...isler, yenilenen });
});
// Tek içerik detayı (erişim kapsamına uyar)
app.get("/api/kutuphane/kaynak/:icerik_id", (req, res) => {
  const k = kullaniciOku(req);
  const kapsam = k && YONETICI_ROLLER.includes(k.rol) ? "yonetim" : (k ? "uye" : "misafir");
  const kayit = KUTUPHANE.tekGetir(req.params.icerik_id, kapsam);
  if (!kayit) return res.status(404).json({ hata: "İçerik bulunamadı!" });
  res.json(icerikOzet(kayit));
});

// Karma arama (yapısal filtre + Türkçe sözcük + soru deseni). "neden" alanı sonucun NEDEN gösterildiğini açıklar.
app.get("/api/arama", (req, res) => {
  const k = kullaniciOku(req);
  const q = req.query;
  const r = KUTUPHANE.ara({ metin: String(q.q || q.metin || ""), ders: q.ders, sinif: q.sinif, konu_id: q.konu_id, desen: q.desen, zorluk: q.zorluk, tur: q.tur, kapsam: k ? "uye" : "misafir", limit: q.limit, offset: q.offset });
  res.json({ toplam: r.toplam, cozum: r.cozum, sonuclar: r.sonuclar.map(icerikOzet) });
});

// Kişiselleştirilmiş öneri akışı ("Sana Özel"): misafirde kişiselleştirme KAPALI
// İmleç; YALNIZ onu üreten kullanıcı+kapsam için geçerlidir (başka kullanıcıya 403, süresi dolana 410).
app.get("/api/oneriler", (req, res) => {
  const k = kullaniciOku(req);
  const r = ONERI.oneriAl(k ? k.ad : null, { limit: req.query.limit, imlec: String(req.query.imlec || ""), kapsam: k ? "uye" : "misafir" });
  if (r.hata) return res.status(r.kod || 400).json({ hata: r.hata }); // bozuk/sahipsiz/süresi dolmuş imleç → açık hata
  res.json({ kisisel: r.kisisel, misafir: r.misafir, aciklama: r.aciklama, toplam: r.toplam, imlec: r.sonraki_imlec, sonuclar: r.sonuclar.map(icerikOzet) });
});
// "Bunun gibi daha fazla": KAYDEDİLENİN kendisi değil, ilgili içerikler
app.get("/api/oneriler/benzer/:icerik_id", (req, res) => {
  const k = kullaniciOku(req);
  const r = ONERI.benzerGetir(req.params.icerik_id, { kapsam: k ? "uye" : "misafir", limit: req.query.limit });
  res.json({ toplam: r.toplam, sonuclar: r.sonuclar.map(icerikOzet) });
});
// İlgi ayarları (giriş gerekir)
app.get("/api/ilgi", girisSart, (req, res) => res.json(ONERI.durum(req.kullanici.ad)));
app.post("/api/ilgi", girisSart, hizSiniri("genel"), (req, res) => {
  const b = req.body || {};
  const r = ONERI.sinyalYaz(req.kullanici.ad, { sinyal: String(b.sinyal || ""), icerik_id: String(b.icerik_id || ""), konu_id: String(b.konu_id || "") });
  if (r.hata) return res.status(400).json({ hata: r.hata });
  res.json(r);
});
app.post("/api/ilgi/kapat", girisSart, (req, res) => res.json(ONERI.kapat(req.kullanici.ad, !!(req.body && req.body.kapali))));
app.post("/api/ilgi/sifirla", girisSart, (req, res) => res.json(ONERI.gecmisiSifirla(req.kullanici.ad)));

// ================= VIDEO ÇÖZÜM CEVAPLARI (karantina + arka plan denetimi) =================
// Önemli: Yeni yüklemeler İNCELEME TAMAMLANMADAN herkese AÇIK OLMAZ. Orijinal dosyalar
// base64 olarak DB'ye YAZILMAZ; öngörülemez anahtarlarla karantinada tutulur.
const rawYukle = express.raw({ // ham bayt akışı (base64 şişmesi yok; boyut sınırı burada da)
  type: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "application/octet-stream"],
  limit: (require("./video/limits").AYAR.enFazlaBoyutMB + 1) * 1024 * 1024,
});

// "Video ile çözüm ekle" — yükle (isim/dosya adı istemciden GÜVENİLMEZ; baytlar doğrulanır)
app.post("/api/video/yukle", girisSart, hizSiniri("genel"), rawYukle, (req, res) => {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  const gonderi_id = Number(req.query.gonderi_id || req.body?.gonderi_id || 0);
  if (!gonderi_id) return res.status(400).json({ hata: "Soru kimliği (gonderi_id) gerekli." });
  const g = db.prepare("SELECT id FROM gonderiler WHERE id=?").get(gonderi_id);
  if (!g) return res.status(404).json({ hata: "Soru bulunamadı." });
  const uzanti = String(req.query.uzanti || "").slice(0, 12);
  const r = VIDEO.yukle({
    kullanici: req.kullanici.ad, gonderi_id,
    baslik: String(req.query.baslik || "").slice(0, 120),
    aciklama: String(req.query.aciklama || "").slice(0, 1000),
    mime: String(req.headers["content-type"] || ""), uzanti,
    tampon: Buffer.isBuffer(req.body) ? req.body : null, ip,
  });
  if (r.hata) return res.status(r.kod || 400).json({ hata: r.hata, detay: r.detay });
  res.status(201).json(r);
});

// Soruya bağlı video listesi: yalnız ONAYLI + kendi videoları (başkasının bekleyeni GÖRÜNMEZ)
app.get("/api/video", (req, res) => {
  const k = kullaniciOku(req);
  const gid = Number(req.query.gonderi_id || 0);
  if (!gid) return res.status(400).json({ hata: "gonderi_id gerekli." });
  const yetkili = k && VIDEO.YONETICI_ROLLER.includes(k.rol);
  let satirlar = db.prepare(`SELECT * FROM video_cevaplar WHERE gonderi_id=? AND silindi=0
    ${yetkili ? "" : k ? "AND (durum='approved' OR yazar=?)" : "AND durum='approved'"}
    ORDER BY id DESC LIMIT 50`).all(...(yetkili ? [gid] : k ? [gid, k.ad] : [gid]));
  res.json({ sonuclar: satirlar.map(v => VIDEO.gorunum(v, k)) });
});

// ---- Moderatör kuyruğu (bekleyen/acil/itiraz/tamamlanan filtreleri) ----
// NOT: `/api/video/kuyruk`, `/api/video/:id` rolosundan ÖNCE tanımlanmalı; aksi halde "kuyruk" bir ":id" sanılır.
app.get("/api/video/kuyruk", girisSart, rolSart(...VIDEO.YONETICI_ROLLER), (req, res) => {
  const r = VIDEO.kuyruk({ durum: String(req.query.durum || "needs_review"), onem: req.query.acil === "1" ? 1 : 0,
                           limit: req.query.limit, offset: req.query.offset });
  // Acil sinyal: güvenilir tehdit bulgusu (hesap/vaka bağları korunur)
  res.json({ ...r, kuyruk: VKUYRUK.kuyrukDurumu(), denetimErisilebilir: Object.keys(VIDEO.saglayicilariOku()).length > 0 });
});

// Yükleme sınırları (herkese açık): ön yüz AYNI sayıları gösterir; ASIL karar sunucuda.
// (Tarayıcı doğrulaması yalnız kolaylık içindir; sunucu her yüklemede yeniden doğrular.)
app.get("/api/video/limits", (req, res) => {
  const L = require("./video/limits").AYAR;
  res.json({ enFazlaBoyutMB: L.enFazlaBoyutMB, enFazlaSureSn: L.enFazlaSureSn,
             desteklenenBicimler: L.desteklenenBicimler, izinliMime: L.izinliMime,
             not: "Sınırlar yapılandırılabilir; burada gösterilen değerler sunucunun geçerli ayarıdır." });
});

// Moderatör: AÇIK yükleme-kısıtı itirazları (içerik kararından AYRI; gizli kanıt/altyazı gösterilmez)
app.get("/api/video/itirazlar", girisSart, rolSart(...VIDEO.YONETICI_ROLLER), (req, res) => {
  res.json({ sonuclar: HESAPV.acikItirazlar() });
});

// Tek video: durum/sahiplik (yazar bekleyenini görür; moderatör hepsini)
app.get("/api/video/:id", (req, res) => {
  const k = kullaniciOku(req);
  const v = db.prepare("SELECT * FROM video_cevaplar WHERE id=?").get(req.params.id);
  const g = VIDEO.gorunum(v, k);
  if (!g) return res.status(404).json({ hata: "Video bulunamadı ya da erişim yok." });
  res.json({ ...g, karar: v.son_karar, islemde: v.durum === "processing" || v.durum === "quarantined" });
});

// Oynatma akışı: erişim denetimi → gerçek MIME → Range destekli sunum (otomatik ses YOK: ön yüzde)
app.get("/api/video/:id/izle", (req, res) => {
  const k = kullaniciOku(req);
  const e = VIDEO.medyaErisim(Number(req.params.id), k);
  if (e.hata) return res.status(e.kod).json({ hata: e.hata });
  const yol = require("./video/depolama").yolBul("orijinal", e.v.saklama_anahtari, e.v.bicim);
  if (!require("fs").existsSync(yol)) return res.status(404).json({ hata: "Dosya bulunamadı." });
  res.setHeader("Content-Type", require("./video/depolama").gercekMime(e.v.bicim)); // uzantıya değil, tespit edilen biçime göre
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  res.sendFile(yol); // Range/seek destekli (mobil oynatma)
});

// Altyazı (WebVTT): YALNIZ onaylı videoda ve varsa. Gizli transkript/iş dosyaları servis EDİLMEZ.
// NOT: Bu ortamda altyazı ÜRETEN araç/sağlayıcı yoktur → altyazı_anahtari boştur ve bu uç 404 verir.
app.get("/api/video/:id/altyazi", (req, res) => {
  const k = kullaniciOku(req);
  const e = VIDEO.medyaErisim(Number(req.params.id), k);
  if (e.hata) return res.status(e.kod).json({ hata: e.hata });
  if (e.v.durum !== "approved" || !e.v.altyazi_anahtari) return res.status(404).json({ hata: "Altyazı yok." });
  const yol = require("./video/depolama").yolBul("altyazi", e.v.altyazi_anahtari, "vtt");
  if (!require("fs").existsSync(yol)) return res.status(404).json({ hata: "Altyazı yok." });
  res.setHeader("Content-Type", "text/vtt; charset=utf-8"); // tarayıcı <track> için doğru tip
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(yol);
});

// Silme: yazar ya da YETKILI (orijinal + kapak + altyazı + geçici hepsi gider)
app.delete("/api/video/:id", girisSart, hizSiniri("genel"), (req, res) => {
  const r = VIDEO.sil(Number(req.params.id), req.kullanici);
  if (r.hata) return res.status(r.kod).json({ hata: r.hata });
  res.json(r);
});

// Video şikâyeti: aynı kişi TEK kez (ceza şişirmez; duplike engelli)
app.post("/api/video/:id/sikayet", girisSart, hizSiniri("sikayet"), istekKimlik(), (req, res) => {
  const v = db.prepare("SELECT id, yazar FROM video_cevaplar WHERE id=? AND silindi=0").get(req.params.id);
  if (!v) return res.status(404).json({ hata: "Video bulunamadı." });
  if (v.yazar === req.kullanici.ad) return res.status(400).json({ hata: "Kendi videonuzu bildiremezsiniz." });
  const neden = String((req.body && req.body.neden) || "").slice(0, 400);
  if (neden.trim().length < 5) return res.status(400).json({ hata: "Şikâyet nedeni en az 5 karakter olmalı." });
  const r = HESAPV.sikayetEt({ video_id: Number(req.params.id), bildiren: req.kullanici.ad, neden });
  // Şikâyet SAYISI ceza üretmez; yalnız moderatör kuyruğunda ÖNCELİK işareti olur
  res.status(r.yeni ? 201 : 200).json(r);
});

// ---- Moderatör bulguları (kuyruk, yukarıda /api/video/:id'den önce) ----
app.get("/api/video/:id/bulgular", girisSart, rolSart(...VIDEO.YONETICI_ROLLER), (req, res) => {
  const v = db.prepare("SELECT id, yazar, durum, son_karar, karar_gerekce, sure_sn, bicim FROM video_cevaplar WHERE id=?").get(req.params.id);
  if (!v) return res.status(404).json({ hata: "Video bulunamadı." });
  // Denetim kaydı (kim, ne, ne zaman, gerekçe) — yalnız yetkili moderatör görür (gizli kanıt/altyazı YOK)
  const kayitlar = db.prepare(`SELECT kim, aksiyon, gerekce, tarih FROM video_denetim_kaydi
                               WHERE video_id=? ORDER BY id DESC LIMIT 50`).all(Number(req.params.id));
  res.json({ video: v, bulgular: VIDEO.bulgular(Number(req.params.id)), kayitlar,
    not: "Bulgular otomatik TAHMİNDİR; 'onaylı' alanı insan incelemesinde doğrulanmış olanları gösterir. Düşük güven tek başına ceza sayılmaz." });
});

// Moderatör kararı: onayla / reddet / değiştirme iste (zorunlu gerekçe + ÇAKIŞMA koruması 409)
app.post("/api/video/:id/karar", girisSart, hizSiniri("genel"), (req, res) => {
  const b = req.body || {};
  const r = VIDEO.insanKarari({
    video_id: Number(req.params.id), beklenen_durum: String(b.beklenen_durum || ""),
    yeni_durum: String(b.karar || ""), gerekce: String(b.gerekce || ""), red_nedeni: String(b.red_nedeni || ""),
    istegi_degistir: !!b.istegi_degistir, kim: req.kullanici.ad, rol: req.kullanici.rol,
  });
  if (r.hata) return res.status(r.kod).json({ hata: r.hata, mevcut: r.mevcut });
  res.json(r);
});

// Geçici, süreli YÜKLEME kısıtı (yetkili insan kararı zorunlu; kalıcı ban YAPAY ZEKA İLE YOK)
app.post("/api/video/:id/kisitla", girisSart, (req, res) => {
  const b = req.body || {};
  const r = VIDEO.kisitlaVideo({ video_id: Number(req.params.id), gun: Number(b.gun) || 3,
    sebep: String(b.sebep || ""), kim: req.kullanici.ad, rol: req.kullanici.rol });
  if (r.hata) return res.status(r.kod).json({ hata: r.hata });
  res.json(r);
});

// ---- Kullanıcının KENDİ hesabı: kısıt durumu + itiraz (diğer kullanıcıların gizli bilgisi YOK) ----
app.get("/api/hesap/durum", girisSart, (req, res) => res.json(HESAPV.kullaniciDurumu(req.kullanici.ad)));
app.post("/api/hesap/itiraz", girisSart, hizSiniri("genel"), (req, res) => {
  const r = HESAPV.itirazAc({ kisit_id: Number((req.body && req.body.kisit_id) || 0), kullanici: req.kullanici.ad });
  if (r.hata) return res.status(400).json({ hata: r.hata });
  res.json(r);
});
// Hesap hakkında YETKİLİ insan kararı (gerekçe ZORUNLU; AI skoru tek başına yetmez; yalnız müdür/admin)
app.post("/api/hesap/karar", girisSart, rolSart("mudur", "admin"), (req, res) => {
  const b = req.body || {};
  try {
    const r = HESAPV.hesapKarari({ kullanici: String(b.kullanici || ""), karar: String(b.karar || ""),
      gerekce: String(b.gerekce || ""), karar_veren: req.kullanici.ad, video_id: Number(b.video_id) || 0 });
    if (r.hata) return res.status(400).json({ hata: r.hata });
    res.json(r);
  } catch (e) { res.status(403).json({ hata: e.message }); }
});
// İtiraz kararını yetkili verir (kabul → kısıt kalkar); yalnız müdür/admin
app.post("/api/hesap/itiraz-karar", girisSart, rolSart("mudur", "admin"), (req, res) => {
  const b = req.body || {};
  try {
    const r = HESAPV.itirazKarari({ kisit_id: Number(b.kisit_id) || 0, kabul: !!b.kabul,
      gerekce: String(b.gerekce || ""), karar_veren: req.kullanici.ad });
    if (r.hata) return res.status(400).json({ hata: r.hata });
    res.json(r);
  } catch (e) { res.status(403).json({ hata: e.message }); }
});

// ---- Bakım (admin): kuyruğu işle + saklama süresi temizliği (geçici dosyalar) ----
app.post("/api/video/bakim", girisSart, rolSart("admin"), async (req, res) => {
  let islenen = 0;
  for (let i = 0; i < 50; i++) { const is = VKUYRUK.siradakiIsiAl(); if (!is) break;
    await VKUYRUK.calistir(is, VIDEO.isGovedesi); islenen++; }
  const ret = VIDEO.retentionTemizle();
  res.json({ islenen, kuyruk: VKUYRUK.kuyrukDurumu(), saklama: ret });
});

// Adres yoksa Türkçe JSON hata (HTML değil, ön yüz şaşırmasın)
app.use((req, res) => res.status(404).json({ hata: "Böyle bir adres yok!" }));
// Beklenmedik hata yakalayıcı (ayrıntıyı konsola, kullanıcıya sade mesaj)
app.use((hata, req, res, sonraki) => {
  const tur = hata && hata.type;
  if (tur === "entity.parse.failed" || (hata instanceof SyntaxError && hata.status === 400)) return res.status(400).json({ hata: "Gönderilen veri geçersiz JSON!" }); // bozuk gövde → 400 (500 değil)
  if (tur === "entity.too.large" || hata.status === 413) return res.status(413).json({ hata: "Gönderi çok büyük (boyut sınırı aşıldı)!" }); // boyut sınırı → 413
  console.error(hata);
  res.status(500).json({ hata: "Bir şeyler ters gitti!" });
});

// Açılışta: taksonomi hazır olsun + bekleyen indeks işleri işlensin (yeniden başlatmaya dayanıklı).
// NOT: Başlangıç İÇERİK seti burada YÜKLENMEZ (yalnız seed.js yükler); üretim verisi kendiliğinden eklenmez.
try { if (KUTUPHANE.sayim().konu === 0) KUTUPHANE.konulariYukle(); } catch (e) { console.error("Konu taksonomisi yüklenemedi:", e.message); }
try { const i = KUTUPHANE.isleriIsle(); if (i && (i.basarili || i.basarisiz)) console.error(`Kütüphane indeks işleri: ${i.basarili} başarılı, ${i.basarisiz} başarısız`); } catch (e) { console.error("Kütüphane indeks işleri:", e.message); }

// Video kuyruğu: karantina deposunu hazırla + yeniden başlatmaya dayanıklı arka plan döngüsünü başlat.
// NOT: Sağlayıcı (konuşma tanıma/OCR/görsel model) TANIMLI DEĞİLSE otomatik inceleme
// tamamlanamaz → videolar sessizce yayına girmez, insan incelemesinde BEKLER.
const KUYRUK_DUR = { aktif: true }; // döngüyü kapatabilmek için (test/kapanış)
try {
  require("./video/depolama").klasorHazirla();
  // Testte döngü KAPATILABİLİR (VIDEO_KUYRUK_KAPALI=1): işler elle sürülür → determinist test.
  if (process.env.VIDEO_KUYRUK_KAPALI !== "1") VKUYRUK.calistirDongu(VIDEO.isGovedesi, KUYRUK_DUR);
  if (process.env.NODE_ENV !== "test") {
    const medyaAraci = require("./video/medya").medyaAraci();
    console.log(`Video kuyruğu: eşzamanlılık ${require("./video/limits").AYAR.kuyrukBounded}, medya aracı (ffmpeg): ${medyaAraci ? "var" : "YOK — otomatik kare/altyazı üretimi kapalı"}`);
  }
  // Durdurma: süreç kapanırken askıda işleri güvenle geri bırak
  process.on("SIGINT", () => { KUYRUK_DUR.aktif = false; setTimeout(() => process.exit(0), 200); });
  process.on("SIGTERM", () => { KUYRUK_DUR.aktif = false; });
} catch (e) { console.error("Video kuyruğu başlatılamadı:", e.message); }

// Yerel geliştirme VARSAYILAN olarak yalnız döngü (loopback) dinler.
// LAN erişimi AÇIK bir tercihtir: HOST=0.0.0.0 (bilinçli) — güvenlik duvarını kimse DEĞİŞTİRMEZ.
const HOST = String(process.env.HOST || process.env.BIND || "127.0.0.1").trim();
const DONGU = ["127.0.0.1", "localhost", "::1"].includes(HOST); // yalnız yerel mi?
const sunucu = app.listen(PORT, HOST, () => { // başlat
  console.log("Backend çalışıyor: http://" + (DONGU ? "127.0.0.1" : HOST) + ":" + PORT);
  if (!DONGU) console.log("[uyarı] Sunucu YEREL AĞA AÇIK (HOST=" + HOST + "). Varsayılan güvenli ayar HOST=127.0.0.1'dir; LAN erişimi bilinçli tercih olmalıdır.");
});
// Sunucu kapanınca kuyruk döngüsünü DURDUR: kapalı DB'ye sorgu atıp unhandledRejection üretmesin
// (testler `sunucu.close()` ile kapanır; döngü askıda işleri bir sonraki açılışta kurtarır).
sunucu.on("close", () => { KUYRUK_DUR.aktif = false; });
module.exports = sunucu; // testler kapatabilsin diye
module.exports.kuyrukDurdur = () => { KUYRUK_DUR.aktif = false; }; // test/CLI için açık durdurma
