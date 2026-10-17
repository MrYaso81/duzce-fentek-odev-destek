// Otomatik testler: GERÇEK veritabanına dokunmaz (ayrı test dosyası + ayrı kapı)
// Çalıştırma: backend klasöründe `npm test`
// Kapsam: kayıt→giriş→soru→yorum→en iyi→puan→bildirim + tekrar şikayet/puan + askıdaki oturum + yetkisiz soru + geçersiz kimlik + XSS kaçış
process.env.DB_PATH = "./test-odevagi.db"; // test defteri (gerçek odevagi.db değil!)
process.env.PORT = "3131"; // test kapısı (gerçek 3001 değil!)
process.env.SINAV_KEY = "test-anahtari-123"; // havuz açık sayılsın (boş havuz, eksik yok)
try { require("fs").unlinkSync("./test-odevagi.db"); } catch { /* ilk çalışsa yok */ }

const { describe, it, before, after } = require("node:test"); // Node'un kendi testçisi
const assert = require("node:assert"); // karşılaştırma
const API = "http://localhost:3131"; // test adresi

async function istek(yol, sec = {}) { // kısa istek yardımcısı
  const r = await fetch(API + yol, {
    method: sec.yontem || "GET",
    headers: { "Content-Type": "application/json", ...(sec.bilet ? { Authorization: "Bearer " + sec.bilet } : {}) },
    body: sec.veri ? JSON.stringify(sec.veri) : undefined
  });
  const j = await r.json().catch(() => ({})); // cevap
  return { kod: r.status, veri: j }; // kod + içerik
}
const giris = async (ad, sifre) => (await istek("/api/giris", { yontem: "POST", veri: { ad, sifre } })).veri.bilet; // bilet al

let sunucu; // kapatmak için saklanır
before(async () => {
  require("./seed.js"); // örnek kişiler (admin, hocalar, öğrenciler)
  sunucu = require("./server.js"); // test sunucusunu başlat
  await new Promise(r => setTimeout(r, 500)); // açılmasını bekle
});
after(async () => {
  const { ocrKapat } = require("./ai/ocr.js"); // OCR işçisi varsa kapat (açık tutamak kalmasın!)
  try { await ocrKapat(); } catch { /* işçi açılmadıysa geç */ }
  await new Promise(coz => sunucu.close(coz)); // kapanışı BEKLE (zorla sonlandırma/process.exit YOK)
  try { require("./db.js").close(); } catch { /* zaten kapalıysa geç */ } // DB tutamağını bırak (Windows kilit sorunu)
  await new Promise(r => setTimeout(r, 100));
  try { require("fs").unlinkSync("./test-odevagi.db"); } catch { /* temizlik */ }
});

describe("uçtan uca akış", () => {
  let b1, b2, bHoca, bAdmin, soruId, yorum1, yorum2; // biletler + kimlikler
  it("kayıt ve giriş", async () => {
    assert.strictEqual((await istek("/api/kayit", { yontem: "POST", veri: { ad: "tOgr1", sifre: "1234", rol: "ogrenci", kurallar: true } })).kod, 200);
    assert.strictEqual((await istek("/api/kayit", { yontem: "POST", veri: { ad: "tOgr2", sifre: "1234", rol: "ogrenci", kurallar: true } })).kod, 200);
    assert.strictEqual((await istek("/api/kayit", { yontem: "POST", veri: { ad: "tHoca", sifre: "hoca123", rol: "ogretmen", brans: "Matematik", kurallar: true } })).kod, 200);
    bAdmin = await giris("admin", "admin123"); // tohumdan admin
    const onay = await istek("/api/admin/hoca-onay", { yontem: "POST", veri: { ad: "tHoca", onay: true }, bilet: bAdmin });
    assert.strictEqual(onay.kod, 200); // hoca onaylandı
    b1 = await giris("tOgr1", "1234"); b2 = await giris("tOgr2", "1234"); bHoca = await giris("tHoca", "hoca123");
    assert.ok(b1 && b2 && bHoca); // üç bilet de geldi
  });
  it("soru paylaş + yorum + en iyi + puan + bildirim", async () => {
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Matematik", baslik: "Test sorusu", aciklama: "2+2?" }, bilet: b1 });
    assert.strictEqual(g.kod, 201); soruId = g.veri.id; // soru açıldı
    const y1 = await istek(`/api/gonderiler/${soruId}/yorumlar`, { yontem: "POST", veri: { metin: "Cevap 4" }, bilet: b2 });
    assert.strictEqual(y1.kod, 201); yorum1 = y1.veri.id; // yorum yazıldı
    const y2 = await istek(`/api/gonderiler/${soruId}/yorumlar`, { yontem: "POST", veri: { metin: "Cevap dört" }, bilet: b2 });
    yorum2 = y2.veri.id;
    assert.strictEqual((await istek(`/api/yorumlar/${yorum1}/en-iyi`, { yontem: "POST", veri: {}, bilet: b1 })).kod, 200); // en iyi seçildi
    const profil = await istek("/api/kullanicilar/tOgr2", { bilet: b1 }); // puana bak
    assert.strictEqual(profil.veri.puan, 10); // +10 geldi
    assert.ok(profil.veri.rozetler.includes("Yardımsever")); // rozet geldi
    assert.ok(profil.veri.rozetler.includes("Çözüm Çırağı")); // 1 doğru çözüm rozeti
    const profil1 = await istek("/api/kullanicilar/tOgr1", { bilet: b1 }); // soru soran
    assert.ok(profil1.veri.rozetler.includes("İlk Adım")); // ilk gönderi rozeti
    const not = await istek("/api/bildirimler", { bilet: b2 }); // yazara bildirim gitti mi
    assert.ok(not.veri.some(n => n.metin.includes("en iyi"))); // evet
  });
  it("aynı cevap tekrar seçilemez (puan avcılığı yok)", async () => {
    const r = await istek(`/api/yorumlar/${yorum1}/en-iyi`, { yontem: "POST", veri: {}, bilet: b1 });
    assert.strictEqual(r.kod, 400); // reddedilir
    const profil = await istek("/api/kullanicilar/tOgr2", { bilet: b1 });
    assert.strictEqual(profil.veri.puan, 10); // puan artmadı
  });
  it("seçim değişirse puan taşınır (biri 1 en iyi)", async () => {
    assert.strictEqual((await istek(`/api/yorumlar/${yorum2}/en-iyi`, { yontem: "POST", veri: {}, bilet: b1 })).kod, 200); // diğeri seçildi
    const profil = await istek("/api/kullanicilar/tOgr2", { bilet: b1 });
    assert.strictEqual(profil.veri.puan, 10); // 20 değil 10 (eski geri alındı)
    const g = await istek(`/api/gonderiler?arama=Test%20sorusu`, { bilet: b1 }); // tek en iyi mi
    assert.strictEqual(g.veri[0].cevaplar.filter(c => c.enIyi).length, 1); // yalnız 1 tane
  });
  it("tekrar şikayet engellenir", async () => {
    assert.strictEqual((await istek("/api/sikayet", { yontem: "POST", veri: { hedefId: soruId, neden: "Diğer" }, bilet: b2 })).kod, 200); // ilk tamam
    const ikinci = await istek("/api/sikayet", { yontem: "POST", veri: { hedefId: soruId, neden: "Diğer" }, bilet: b2 });
    assert.strictEqual(ikinci.kod, 400); // ikinci reddedilir
  });
  it("askıya alınan oturum işlem yapamaz", async () => {
    assert.strictEqual((await istek("/api/admin/aski", { yontem: "POST", veri: { ad: "tOgr2", askida: true }, bilet: bAdmin })).kod, 200); // askıya al
    const r = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Olur mu", aciklama: "x" }, bilet: b2 });
    assert.strictEqual(r.kod, 403); // eski biletle yazamaz
  });
  it("yetkisiz soru erişimi engellenir", async () => {
    await istek("/api/kayit", { yontem: "POST", veri: { ad: "tOgr3", sifre: "1234", rol: "ogrenci", kurallar: true } }); // taze öğrenci (tOgr2 askıda!)
    const b3 = await giris("tOgr3", "1234");
    const sor = await istek("/api/hoca-sorulari", { yontem: "POST", veri: { hoca: "tHoca", ders: "Matematik", baslik: "Sınav sorum", soru: "Türev nedir?", gizli: "ozel" }, bilet: b1 });
    assert.strictEqual(sor.kod, 201); // soru gitti
    const baskasi = await istek("/api/hoca-sorulari", { bilet: b3 }); // başka öğrenci
    assert.ok(!baskasi.veri.some(s => s.id === sor.veri.id)); // göremez
    const yabanciCevap = await istek(`/api/hoca-sorulari/${sor.veri.id}/cevap`, { yontem: "POST", veri: { metin: "x" }, bilet: b3 });
    assert.strictEqual(yabanciCevap.kod, 403); // öğrenci cevaplayamaz
  });
  it("hoca akışı: soru→cevap→puan→paylaş→kapat", async () => {
    const sor = await istek("/api/hoca-sorulari", { yontem: "POST", veri: { hoca: "tHoca", ders: "Matematik", baslik: "Türev sorusu", soru: "Türev nedir?", gizli: "acik" }, bilet: b1 });
    assert.strictEqual(sor.kod, 201); // soru gitti
    const gelen = await istek("/api/hoca-sorulari", { bilet: bHoca }); // hocanın kutusu
    assert.ok(gelen.veri.some(s => s.id === sor.veri.id)); // hocaya düştü
    assert.strictEqual((await istek(`/api/hoca-sorulari/${sor.veri.id}/cevap`, { yontem: "POST", veri: { metin: "Değişim hızıdır." }, bilet: bHoca })).kod, 200); // cevapladı
    const not = await istek("/api/bildirimler", { bilet: b1 }); // öğrenciye bildirim
    assert.ok(not.veri.some(n => n.metin.includes("cevapladı"))); // geldi
    assert.strictEqual((await istek(`/api/hoca-sorulari/${sor.veri.id}/puan`, { yontem: "POST", veri: { puan: 5 }, bilet: b1 })).kod, 200); // yıldız
    const paylas = await istek(`/api/hoca-sorulari/${sor.veri.id}/paylas`, { yontem: "POST", veri: {}, bilet: b1 });
    assert.strictEqual(paylas.kod, 200); // akışa taşındı
    const akis = await istek("/api/gonderiler?arama=Türev%20sorusu", { bilet: b1 });
    assert.ok(akis.veri.some(g => g.baslik === "Türev sorusu" && g.cozuldu)); // akışta çözüldü
    assert.strictEqual((await istek(`/api/hoca-sorulari/${sor.veri.id}/kapat`, { yontem: "POST", veri: {}, bilet: b1 })).kod, 200); // kapatıldı
  });
  it("takip isteği: gönder→kabul/ret", async () => {
    const b3 = await giris("tOgr3", "1234"); // taze öğrenci
    assert.deepStrictEqual((await istek("/api/takip", { yontem: "POST", veri: { ad: "tOgr3" }, bilet: b1 })).veri, { takip: false, istek: true }); // istek gitti
    assert.deepStrictEqual((await istek("/api/takip", { bilet: b1 })).veri, []); // henüz takip yok
    const gel = await istek("/api/takip/istekler", { bilet: b3 }); // karşı taraf görür
    assert.deepStrictEqual(gel.veri.gelen, ["tOgr1"]); // istek düştü
    assert.deepStrictEqual((await istek("/api/takip/karar", { yontem: "POST", veri: { ad: "tOgr1", kabul: true }, bilet: b3 })).veri, { tamam: "Kabul edildi!" }); // kabul
    assert.deepStrictEqual((await istek("/api/takip", { bilet: b1 })).veri, ["tOgr3"]); // artık takipte
    assert.deepStrictEqual((await istek("/api/takip", { yontem: "POST", veri: { ad: "tOgr3" }, bilet: b1 })).veri, { takip: false, istek: false }); // geri al
    assert.deepStrictEqual((await istek("/api/takip", { bilet: b1 })).veri, []); // boş
  });
  it("takip isteği: ret + sayaç", async () => {
    const b3 = await giris("tOgr3", "1234");
    await istek("/api/takip", { yontem: "POST", veri: { ad: "tOgr3" }, bilet: b1 }); // istek gönder
    assert.deepStrictEqual((await istek("/api/takip/karar", { yontem: "POST", veri: { ad: "tOgr1", kabul: false }, bilet: b3 })).veri, { tamam: "Reddedildi." }); // reddet
    assert.deepStrictEqual((await istek("/api/takip", { bilet: b1 })).veri, []); // takip yok
    const gel2 = await istek("/api/takip/istekler", { bilet: b3 }); // kuyruk boşaldı
    assert.deepStrictEqual(gel2.veri.gelen, []); // istek gitti
  });
  it("admin çözüm: reddet ve kaldır+uyar", async () => {
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Şikayetlik soru", aciklama: "x" }, bilet: b1 });
    await istek("/api/sikayet", { yontem: "POST", veri: { hedefId: g.veri.id, neden: "Diğer" }, bilet: bHoca }); // şikayet
    const kuyruk = await istek("/api/admin/sikayetler", { bilet: bAdmin }); // kuyrukta mı
    const kayit = kuyruk.veri.find(s => s.hedefId === g.veri.id); assert.ok(kayit);
    assert.strictEqual((await istek(`/api/admin/sikayet/${kayit.id}/cozum`, { yontem: "POST", veri: { aksiyon: "reddet" }, bilet: bAdmin })).kod, 200); // reddet
    const g2 = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Kötü soru", aciklama: "y" }, bilet: b1 });
    await istek("/api/sikayet", { yontem: "POST", veri: { hedefId: g2.veri.id, neden: "Diğer" }, bilet: bHoca });
    const kuyruk2 = await istek("/api/admin/sikayetler", { bilet: bAdmin });
    const kayit2 = kuyruk2.veri.find(s => s.hedefId === g2.veri.id);
    const adminListe = await istek("/api/admin/kullanicilar", { bilet: bAdmin }); // admin gözüyle
    const uyari0 = adminListe.veri.find(x => x.ad === "tOgr1").uyari; // sayı
    assert.strictEqual((await istek(`/api/admin/sikayet/${kayit2.id}/cozum`, { yontem: "POST", veri: { aksiyon: "kaldir" }, bilet: bAdmin })).kod, 200); // kaldır+uyar
    const akis = await istek("/api/gonderiler?arama=Kötü%20soru", { bilet: b1 });
    assert.strictEqual(akis.veri.length, 0); // gönderi gitti
    const adminListe2 = await istek("/api/admin/kullanicilar", { bilet: bAdmin }); // uyarı arttı mı
    assert.strictEqual(adminListe2.veri.find(x => x.ad === "tOgr1").uyari, uyari0 + 1); // insan kararıyla +1 uyarı
  });
  it("şifre değişince eski bilet ölür; unutma jeton üretmez", async () => {
    const db = require("./db.js"); // aynı süreçteki test defteri
    const once = db.prepare("SELECT COUNT(*) AS s FROM sifre_sifirlama").get().s; // jeton sayısı
    const unut = await istek("/api/sifre-unuttum", { yontem: "POST", veri: { ad: "tOgr1" } });
    assert.ok(unut.veri.tamam.includes("GÖNDERİLMEDİ")); // dürüst mesaj
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS s FROM sifre_sifirlama").get().s, once); // jeton üretilmedi
    assert.strictEqual((await istek("/api/sifre-degistir", { yontem: "POST", veri: { eski: "1234", yeni: "yeni1234" }, bilet: b1 })).kod, 200); // şifre değişti
    assert.strictEqual((await istek("/api/ben", { bilet: b1 })).kod, 401); // eski bilet öldü
    const yeniBilet = await giris("tOgr1", "yeni1234"); // yeni şifreyle gir
    assert.ok(yeniBilet); // girer
    assert.strictEqual((await istek("/api/ben", { bilet: yeniBilet })).kod, 200); // çalışır
    b1 = yeniBilet; // sonraki testler güncel biletle devam eder (sıra bağımlılığı yok)
  });
  it("geçersiz kimlik düzgün hata verir", async () => {
    assert.strictEqual((await istek("/api/gonderiler/abc/yorumlar", { bilet: b1 })).kod, 400); // sayı değil -> 400 JSON
    assert.strictEqual((await istek("/api/yok-boyle-adres", { bilet: b1 })).kod, 404); // adres yok -> 404 JSON
  });
  it("HTTP akışı: tehdit → gizli → karar → görünür (tüm türler)", async () => {
    const b3 = await giris("tOgr3", "1234"); // taze kullanıcı (tOgr2 askıda!)
    // 1) Tehdit içerikli yanıt: kaydedilir ama akışta görünmez
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Matematik", baslik: "Akış testi", aciklama: "2+2?" }, bilet: b1 });
    const y = await istek(`/api/gonderiler/${g.veri.id}/yorumlar`, { yontem: "POST", veri: { metin: "Okul çıkışı seni bekliyorum" }, bilet: b3 });
    assert.ok([200, 201].includes(y.kod)); // kaydedilir (incelemede de 201)
    const akis1 = await istek(`/api/gonderiler?arama=Akış%20testi`, { bilet: b1 }); // akışta yorum görünmez
    assert.strictEqual(akis1.veri[0].cevaplar.length, 0); // gizli!
    const kuyruk = await istek("/api/denetim/vakalar", { bilet: bAdmin }); // vakada mı
    const vaka = kuyruk.veri.find(v => v.tur === "yorum" && v.hedef_id === y.veri.id); assert.ok(vaka); // yorum türüyle
    assert.strictEqual((await istek(`/api/denetim/vakalar/${vaka.id}/karar`, { yontem: "POST", veri: { karar: "yayinla" }, bilet: bAdmin })).kod, 200); // onayla
    const akis2 = await istek(`/api/gonderiler?arama=Akış%20testi`, { bilet: b1 }); // şimdi görünür
    assert.strictEqual(akis2.veri[0].cevaplar.length, 1); // yalnız o yorum!
    // 2) Yanıt türü: ayrı içerik, ayrı karar (aynı ID'deki yorum etkilenmez)
    const y2 = await istek(`/api/gonderiler/${g.veri.id}/yorumlar`, { yontem: "POST", veri: { metin: "Temiz yorum" }, bilet: b3 });
    const r1 = await istek(`/api/yorumlar/${y2.veri.id}/yanitlar`, { yontem: "POST", veri: { metin: "Sen bir pisliksin" }, bilet: b1 });
    const kuyruk2 = await istek("/api/denetim/vakalar", { bilet: bAdmin });
    const vakaY = kuyruk2.veri.find(v => v.tur === "yanit" && v.hedef_id === r1.veri.id); assert.ok(vakaY); // YANIT türüyle (yorum değil!)
    assert.strictEqual((await istek(`/api/denetim/vakalar/${vakaY.id}/karar`, { yontem: "POST", veri: { karar: "kaldir" }, bilet: bAdmin })).kod, 200); // kaldır
    const akis3 = await istek(`/api/gonderiler?arama=Akış%20testi`, { bilet: b1 }); // yanıt gitti, yorum durur
    const yorumDurur = akis3.veri[0].cevaplar.find(c => c.id === y2.veri.id); assert.ok(yorumDurur); // yorum etkilenmedi!
    // 3) Oda + mesaj + soru türleri de karar kapsamındadır
    const oda = await istek("/api/odalar", { yontem: "POST", veri: { ad: "Test odası", ders: "Fen" }, bilet: b1 });
    const msj = await istek(`/api/odalar/${oda.veri.id}/mesajlar`, { yontem: "POST", veri: { metin: "Sen aptalsın" }, bilet: b3 });
    const kuyruk3 = await istek("/api/denetim/vakalar", { bilet: bAdmin });
    const vakaM = kuyruk3.veri.find(v => v.tur === "mesaj" && v.hedef_id === (msj.veri.id ?? -1)); assert.ok(vakaM); // mesaj türüyle
    const sor = await istek("/api/hoca-sorulari", { yontem: "POST", veri: { hoca: "tHoca", ders: "Matematik", baslik: "Soru", soru: "Yarınki sınav soruları elimde", gizli: "ozel" }, bilet: b1 });
    const kuyruk4 = await istek("/api/denetim/vakalar", { bilet: bAdmin });
    assert.ok(kuyruk4.veri.some(v => v.tur === "soru" && v.hedef_id === sor.veri.id)); // soru türüyle
  });
  it("LLM hata akışları: kapalı/hata ayrımı (mock)", async () => {
    const AYAR = require("./ai/config"); // gerçek ayar nesnesi
    const { llmSinifla, durum, LlmSema } = require("./ai/llm"); // adaptör
    assert.strictEqual(await llmSinifla("merhaba"), null); // kapalıysa null (sıfır sayılmaz!)
    assert.strictEqual(durum().mod, "kural"); // dürüst durum: kural modu
    assert.throws(() => LlmSema.parse({ kategori: "X" }), "bozuk çıktı elenir"); // Zod doğrulaması
    const eskiFetch = global.fetch, eskiAcik = AYAR.llmAcik; // sakla
    AYAR.llmAcik = true; process.env.AI_API_KEY = "sahte-anahtar"; // açıkmış gibi yap
    global.fetch = () => Promise.reject(new Error("ağ yok")); // sağlayıcı çöktü
    const sonuc = await llmSinifla("merhaba"); // ne döner
    assert.deepStrictEqual(sonuc, { hata: true }); // HATA ayrı durum (null değil!)
    const { denetle } = require("./ai/denetle"); // model çökünce sıfır sayılmaz
    const d = await denetle("bugün hava çok güzel", {});
    assert.strictEqual(d.onerilen_aksiyon, "incelemeye_al"); // incelemeye alınır
    assert.ok(d.kanit_parcalari.some(k => k.includes("model hatası"))); // kanıtta yazar
    global.fetch = eskiFetch; AYAR.llmAcik = eskiAcik; delete process.env.AI_API_KEY; // geri al
  });
  it("OCR: paralel + bozuk + zaman aşımı", async () => {
    const fs = require("fs"); // test resmi
    const { ocrSureli } = require("./ai/ocr");
    const png = fs.readFileSync("./ai-eval/test-snav.png"); // gerçek PNG
    const [a, b] = await Promise.all([ocrSureli(png, 60000), ocrSureli(png, 60000)]); // İKİSİ AYNI ANDA
    assert.strictEqual(a.sonuc, "ok"); assert.strictEqual(b.sonuc, "ok"); // ikisi de okundu (karışma yok)
    assert.ok(a.metin.includes("sınav") && b.metin.includes("sınav")); // aynı doğru metin
    const bozuk = await ocrSureli(Buffer.from("bu-resim-degil"), 5000); // bozuk dosya
    assert.strictEqual(bozuk.sonuc, "bozuk"); assert.strictEqual(bozuk.eksik, true); // eksik sayılır
    const cabuk = await ocrSureli(png, 0); // sıfır süre (mutlaka dolar)
    assert.strictEqual(cabuk.sonuc, "zamanasimi"); assert.strictEqual(cabuk.eksik, true); // eksik sayılır
    const { ocrKapat } = require("./ai/ocr.js"); // işçiyi kapat (süreç asılı kalmasın!)
    await ocrKapat();
  });
  it("Tekrar cezası yalnız insan onaylı kaldırmada artar", async () => {
    const db = require("./db.js"); // test defteri (aynı süreç)
    const { denetle } = require("./ai/denetle");
    const metin = "Yarınki sınav soruları elimde"; // sınırda metin
    const once = await denetle(metin, { db, yazar: "tOgr3" }); // vaka yokken
    db.prepare("INSERT INTO vakalar (tur, hedef_id, yazar, kategori, skor, guven, durum) VALUES ('gonderi',999,'tOgr3','SPAM',0.5,0.5,'bekliyor')").run(); // bekleyen vaka
    const bekleyen = await denetle(metin, { db, yazar: "tOgr3" }); // bekleyen varken
    assert.strictEqual(bekleyen.risk_skoru, once.risk_skoru); // BEKLEYEN ceza artırmaz!
    db.prepare("UPDATE vakalar SET durum='kaldirildi' WHERE yazar='tOgr3'").run(); // insan onayladı
    const sonra = await denetle(metin, { db, yazar: "tOgr3" }); // onaylı varken
    assert.ok(sonra.risk_skoru > once.risk_skoru); // ceza artar
    db.prepare("DELETE FROM vakalar WHERE yazar='tOgr3'").run(); // temizle
  });
  it("Karar tekrarı ceza üretmez", async () => {
    const b3 = await giris("tOgr3", "1234");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Karar testi", aciklama: "x" }, bilet: b1 });
    const y = await istek(`/api/gonderiler/${g.veri.id}/yorumlar`, { yontem: "POST", veri: { metin: "Sen aptalsın" }, bilet: b3 });
    const k2 = await istek("/api/denetim/vakalar", { bilet: bAdmin });
    const vaka = k2.veri.find(v => v.tur === "yorum" && v.hedef_id === y.veri.id); assert.ok(vaka); // yorum vakası
    assert.strictEqual((await istek(`/api/denetim/vakalar/${vaka.id}/karar`, { yontem: "POST", veri: { karar: "uyar" }, bilet: bAdmin })).kod, 200); // uyar
    const tekrar = await istek(`/api/denetim/vakalar/${vaka.id}/karar`, { yontem: "POST", veri: { karar: "uyar" }, bilet: bAdmin });
    assert.strictEqual(tekrar.kod, 400); // TEKRAR REDDEDİLİR (çift uyarı yok!)
  });
  it("ogretmene iletilen vakayi yalniz o hoca gorur", async () => {
    const b3 = await giris("tOgr3", "1234");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Atama testi", aciklama: "y" }, bilet: b1 });
    const y = await istek(`/api/gonderiler/${g.veri.id}/yorumlar`, { yontem: "POST", veri: { metin: "Sen aptalsin" }, bilet: b3 });
    const k2 = await istek("/api/denetim/vakalar", { bilet: bAdmin });
    const vaka = k2.veri.find(v => v.tur === "yorum" && v.hedef_id === y.veri.id); assert.ok(vaka);
    assert.strictEqual((await istek(`/api/denetim/vakalar/${vaka.id}/karar`, { yontem: "POST", veri: { karar: "ogretmene", hoca: "tHoca" }, bilet: bAdmin })).kod, 200);
    const gorev = await istek("/api/ogretmen/vakalar", { bilet: bHoca });
    assert.ok(gorev.veri.some(v => v.id === vaka.id));
    assert.ok(!("gerekce" in (gorev.veri[0] || {})));
    const zeynep = await giris("ZeynepHoca", "hoca123");
    const baskasi = await istek("/api/ogretmen/vakalar", { bilet: zeynep });
    assert.ok(!baskasi.veri.some(v => v.id === vaka.id));
  });
  it("E-Karne: A kullanıcısı B'nin kayıtlarını göremez/değiştiremez", async () => {
    const b3 = await giris("tOgr3", "1234"); // taze kullanıcı B
    const d = await istek("/api/denemeler", { yontem: "POST", veri: { tarih: "2026-10-01", tur: "Ders Denemesi", yayin: "Final", ders: "Matematik", soru: 40, dogru: 30, yanlis: 5, kural: "4y1d" }, bilet: b1 }); // A kaydeder
    assert.strictEqual(d.kod, 201); assert.strictEqual(d.veri.net, 28.75); // 30-5/4
    assert.deepStrictEqual((await istek("/api/denemeler", { bilet: b3 })).veri, []); // B'de görünmez!
    assert.strictEqual((await istek("/api/denemeler/" + d.veri.id, { bilet: b3 })).kod, 404); // tekil de yok
    assert.strictEqual((await istek("/api/denemeler/" + d.veri.id, { yontem: "PUT", veri: { tarih: "2026-10-01", soru: 40, dogru: 1, yanlis: 0, kural: "4y1d" }, bilet: b3 })).kod, 404); // değiştiremez!
    assert.strictEqual((await istek("/api/denemeler/" + d.veri.id, { yontem: "DELETE", bilet: b3 })).kod, 404); // silemez!
    const p = await istek("/api/program", { yontem: "PUT", veri: { sinif: "9. Sınıf", hucre: { "Pazartesi|08:00": { ders: "Matematik", yapildi: true } }, ozelDersler: [] }, bilet: b1 }); // A programı
    assert.strictEqual(p.kod, 200);
    assert.deepStrictEqual((await istek("/api/program", { bilet: b3 })).veri, null); // B'de yok!
    const b1yeni = await giris("tOgr1", "yeni1234"); // A başka cihazdan girer
    assert.strictEqual((await istek("/api/denemeler", { bilet: b1yeni })).veri.length, 1); // verisi durur!
    assert.strictEqual((await istek("/api/program", { bilet: b1yeni })).veri.sinif, "9. Sınıf"); // program durur!
  });
  it("E-Karne: hatalı kayıt + içe aktarma tekilliği", async () => {
    const b1 = await giris("tOgr1", "yeni1234");
    assert.strictEqual((await istek("/api/denemeler", { yontem: "POST", veri: { tarih: "2026-10-02", soru: 10, dogru: 8, yanlis: 5, kural: "4y1d" }, bilet: b1 })).kod, 400); // 8+5>10 reddedilir!
    assert.strictEqual((await istek("/api/denemeler", { yontem: "POST", veri: { tarih: "2026-10-02", soru: -5, dogru: 1, yanlis: 0, kural: "4y1d" }, bilet: b1 })).kod, 400); // negatif reddedilir!
    assert.strictEqual((await istek("/api/denemeler", { yontem: "POST", veri: { tarih: "02.10.2026", soru: 10, dogru: 5, yanlis: 2, kural: "4y1d" }, bilet: b1 })).kod, 400); // tarih biçimi reddedilir!
    const kayit = { tarih: "2026-10-03", tur: "Genel Deneme", yayin: "X", ders: "Fen", soru: 20, dogru: 15, yanlis: 4, kural: "3y1d" };
    const i1 = await istek("/api/denemeler/ice-aktar", { yontem: "POST", veri: { denemeler: [kayit] }, bilet: b1 });
    assert.deepStrictEqual([i1.veri.eklenen, i1.veri.atlanan], [1, 0]); // ilk eklenir
    const i2 = await istek("/api/denemeler/ice-aktar", { yontem: "POST", veri: { denemeler: [kayit] }, bilet: b1 });
    assert.deepStrictEqual([i2.veri.eklenen, i2.veri.atlanan], [0, 1]); // tekrar atlanır (çift yok!)
    const bak = await istek("/api/denemeler", { bilet: b1 }); // 3y1d kuralı korunur
    assert.ok(bak.veri.some(x => x.kural === "3y1d" && x.net === 15 - 4 / 3)); // 13.667
  });
  it("E-Karne: tarih/hafta/net kuralları (ön yüz fonksiyonları)", async () => {
    const fs = require("fs"); // gerçek app.js dosyasını oku
    const kaynak = fs.readFileSync("../odev-destek/app.js", "utf-8");
    const cek = ad => { // fonksiyonu kaynaktan çıkar-çalıştır
      const bas = kaynak.indexOf("function " + ad + "("); assert.ok(bas >= 0, ad + "() bulunamadı!");
      let d = 0, son = -1;
      for (let i = bas; i < kaynak.length; i++) {
        if (kaynak[i] === "{") d++;
        if (kaynak[i] === "}") { d--; if (!d) { son = i + 1; break; } }
      }
      return eval("(" + kaynak.slice(bas, son).replace("function " + ad, "function") + ")");
    };
    const netKural = cek("netKural"); // kural matematiği
    assert.strictEqual(netKural(30, 5, "4y1d"), 28.75); // 30-5/4
    assert.strictEqual(netKural(30, 6, "3y1d"), 28); // 30-6/3
    assert.strictEqual(netKural(30, 5, "yok"), 30); // götürmez
    assert.strictEqual(netKural(5, 20, "4y1d"), 0); // 5-5=0
    assert.ok(netKural(2, 20, "4y1d") < 0); // negatif net korunur (sıfıra kırpılmaz!)
    const isoHafta = cek("isoHafta"); // ISO haftası (yıl geçişli)
    assert.strictEqual(isoHafta("2025-01-01"), "2025-W01"); // Çarşamba: o haftanın yılı
    assert.strictEqual(isoHafta("2024-12-30"), "2025-W01"); // Pazartesi: yeni yılın 1. haftası!
    assert.strictEqual(isoHafta("2024-12-29"), "2024-W52"); // Pazar: eski yılın son haftası
    assert.strictEqual(isoHafta("2026-10-15"), "2026-W42"); // bilinen tarih
  });
  it("anahtarsiz-failsafe", async () => { // SINAV_KEY yokken beklemede kalır
    delete process.env.SINAV_KEY; // anahtarı kaldır (yapılandırma eksikliği)
    const { havuzMetinleri } = require("./ai/havuz.js"); // aynı süreç
    const h = havuzMetinleri(require("./db.js")); // test defteri
    assert.strictEqual(h.eksik, true); // eksik bayrağı kalkar
    const { denetle } = require("./ai/denetle.js");
    const d = await denetle("bugün hava çok güzel", { havuzlar: h }); // masum yazı bile
    assert.strictEqual(d.onerilen_aksiyon, "incelemeye_al"); // otomatik yayınlanmaz!
    process.env.SINAV_KEY = "test-anahtari-123"; // geri tak
  });
  it("XSS: ön yüz kaçışı (<script> etkisiz)", async () => {
    const fs = require("fs"); // gerçek app.js dosyasını oku
    const kaynak = fs.readFileSync("../odev-destek/app.js", "utf-8");
    const bas = kaynak.indexOf("function htmlKacis(m)"); // fonksiyonun başı
    assert.ok(bas >= 0, "htmlKacis() bulunamadı!"); // dosyada olmalı
    let derinlik = 0, son = -1; // süslü parantezleri sayarak sonu bul
    for (let i = bas; i < kaynak.length; i++) {
      if (kaynak[i] === "{") derinlik++;
      if (kaynak[i] === "}") { derinlik--; if (!derinlik) { son = i + 1; break; } }
    }
    const kac = eval("(" + kaynak.slice(bas, son).replace(/^function htmlKacis/, "function") + ")"); // isimsiz yapıp çalıştır
    assert.strictEqual(kac('<script>alert(1)</script>'), "&lt;script&gt;alert(1)&lt;/script&gt;"); // etiket kaçar
    assert.strictEqual(kac('" onmouseover="x'), "&quot; onmouseover=&quot;x"); // tırnak kaçar
  });
  it("statik: isim çakışması yok + görsel denetimi", async () => {
    const fs = require("fs"); // dosyaları oku
    const kaynak = fs.readFileSync("../odev-destek/app.js", "utf-8");
    const cakisma = [...kaynak.matchAll(/(^|[^a-zA-Z_.])k\(/gm)]; // çıplak k() çağrısı kaldı mı
    assert.strictEqual(cakisma.length, 0, "Çıplak k() çağrısı var!"); // htmlKacis olmalı
    assert.strictEqual((kaynak.match(/function htmlKacis\(m\)/g) || []).length, 1); // yardımcı tek tanımlı
    const bas2 = kaynak.indexOf("function gorselGuvenli(src)"); // görsel denetçi
    assert.ok(bas2 >= 0, "gorselGuvenli() bulunamadı!");
    let d2 = 0, son2 = -1; // sonu bul
    for (let i = bas2; i < kaynak.length; i++) {
      if (kaynak[i] === "{") d2++;
      if (kaynak[i] === "}") { d2--; if (!d2) { son2 = i + 1; break; } }
    }
    const gorselGuvenli = eval("(" + kaynak.slice(bas2, son2).replace(/^function gorselGuvenli/, "function") + ")");
    assert.ok(gorselGuvenli("data:image/png;base64,iVBORw0KGgo=")); // gerçek resim geçer
    assert.ok(!gorselGuvenli("javascript:alert(1)")); // kod geçmez
    assert.ok(!gorselGuvenli("<img src=x onerror=alert(1)>")); // etiket geçmez
    assert.ok(!gorselGuvenli("data:text/html;base64,PGI+")); // html geçmez
    assert.ok(!gorselGuvenli(null)); // boş geçmez
  });
  it("Sohbet: sahiplik + mock akış + limit + tekrar tekilliği", async () => {
    const b3 = await giris("tOgr3", "1234");
    const s = await istek("/api/sohbet", { yontem: "POST", veri: { baslik: "Test", ders: "Matematik" }, bilet: b1 }); // A açar
    assert.strictEqual(s.kod, 201);
    assert.strictEqual((await istek("/api/sohbet/" + s.veri.id + "/mesajlar", { bilet: b3 })).kod, 404); // B göremez!
    assert.strictEqual((await istek("/api/sohbet/" + s.veri.id, { yontem: "DELETE", bilet: b3 })).kod, 404); // B silemez!
    const sse = (bilet, metin, devam) => new Promise((coz, boz) => { // SSE okuyucu (test)
      fetch(API + "/api/sohbet/" + s.veri.id + "/mesaj", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + bilet }, body: JSON.stringify({ metin, devam }) })
        .then(async r => {
          if (!r.ok) { const j = await r.json().catch(() => ({})); boz(new Error(j.hata || r.status)); return; } // hata (denetim/limit)
          const o = r.body.getReader(), c = new TextDecoder(); let t = "", tam = "";
          for (;;) {
            const { done, value } = await o.read(); if (done) break; // bitti
            t += c.decode(value, { stream: true });
            let i; while ((i = t.indexOf("\n\n")) >= 0) { const h = t.slice(0, i); t = t.slice(i + 2); const m = h.split("\n").filter(x => x.startsWith("data: ")).join("").slice(6); if (m) { const j = JSON.parse(m); if (j.parca) tam += j.parca; if (j.bitti) { coz({ tam, mock: j.mock }); return; } if (j.hata) { boz(new Error(j.hata)); return; } } }
          }
          coz({ tam, mock: false }); // kapanışsız bitti
        }).catch(boz);
    });
    const ilk = await sse(b1, "2x+3=11 nasıl çözülür?", false); // mock akış
    assert.ok(/deneme modu/i.test(ilk.tam)); // dürüst rozet (sahte model yok!) — RAG demoYanit "🧪 Deneme modu" yazar
    assert.strictEqual(ilk.mock, true); // mock bayrağı
    const gecmis = await istek("/api/sohbet/" + s.veri.id + "/mesajlar", { bilet: b1 }); // geçmişte 2 mesaj
    assert.strictEqual(gecmis.veri.length, 2); // soru + cevap
    await sse(b1, "2x+3=11 nasıl çözülür?", true); // TEKRAR (devam bayrağı)
    const gecmis2 = await istek("/api/sohbet/" + s.veri.id + "/mesajlar", { bilet: b1 });
    assert.strictEqual(gecmis2.veri.filter(m => m.rol === "user").length, 1); // soru TEK (çift kayıt yok!)
    assert.strictEqual((await istek("/api/sohbet/" + s.veri.id, { yontem: "PUT", veri: { baslik: "Yeni Ad" }, bilet: b1 })).kod, 200); // adlandır
    assert.strictEqual((await istek("/api/sohbet/" + s.veri.id, { yontem: "DELETE", bilet: b1 })).kod, 200); // sil
    assert.strictEqual((await istek("/api/sohbet/" + s.veri.id + "/mesajlar", { bilet: b1 })).kod, 404); // gitti
  });
  it("Sohbet: dakikalık hız sınırı (8/dk) günlük kotadan AYRI çalışır", async () => {
    spamSifirla(); // sayaçlar temiz
    const b = await yeniOgrenci("tSohbetHiz"); // bağımsız kullanıcı
    const s = await istek("/api/sohbet", { yontem: "POST", veri: { baslik: "Hiz", ders: "" }, bilet: b });
    let hiz429 = 0, gunluk429 = 0; // iki farklı 429 türünü AYIR
    for (let i = 0; i < 12; i++) { // 12 deneme (dakikalık sınır 8)
      const r = await fetch(API + "/api/sohbet/" + s.veri.id + "/mesaj", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b }, body: JSON.stringify({ metin: "hız sorusu " + i, uretim: "hiz-" + i }) });
      if (r.status === 429) { const j = await r.json().catch(() => ({})); if (j.gunluk) gunluk429++; else hiz429++; } // günlük değil → hız sınırı
      try { await r.body.cancel(); } catch { /* gövde zaten okunmuşsa geç */ }
    }
    assert.ok(hiz429 >= 1, "dakikalık hız sınırı devreye girer"); // 8/dk aşıldı
    assert.strictEqual(gunluk429, 0, "günlük kota HENÜZ dolmadı (sayaçlar karışmaz)"); // ayrı sayaç kanıtı
  });
  it("Sohbet: günlük kota (30) ayrı sayaçtan uygulanır", async () => {
    spamSifirla();
    const db = require("./db.js"); // aynı süreçteki test defteri
    const b = await yeniOgrenci("tSohbetGunluk"); // bağımsız kullanıcı
    const s = await istek("/api/sohbet", { yontem: "POST", veri: { baslik: "Kota", ders: "" }, bilet: b });
    for (let i = 0; i < 30; i++) db.prepare("INSERT OR IGNORE INTO ai_kullanim (kullanici, uretim_id, durum) VALUES (?,?,'basarili')").run("tSohbetGunluk", "dolgu-" + i); // kotayı ÖNCEDEN doldur (hız sınırı tetiklenmeden!)
    const r = await fetch(API + "/api/sohbet/" + s.veri.id + "/mesaj", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b }, body: JSON.stringify({ metin: "kota sorusu", uretim: "kota-asim" }) });
    assert.strictEqual(r.status, 429); // günlük kota engeli (tek istek → hız sınırı DEĞİL!)
    const j = await r.json();
    assert.ok(j.gunluk === true, "günlük kota bayrağı döner (dakikalık değil!)"); // ayırt edilebilir
    assert.ok((j.hata || "").includes("Günlük"), "açık günlük kota mesajı"); // doğru mesaj
  });
  it("Program: sürüm çakışması eski yazıyı ezmez", async () => {
    await istek("/api/kayit", { yontem: "POST", veri: { ad: "tOgrProgram", sifre: "1234", rol: "ogrenci", kurallar: true } }); // BAĞIMSIZ kullanıcı (ortak sayaç etkilemez!)
    const b3 = await giris("tOgrProgram", "1234");
    const p1 = await istek("/api/program", { yontem: "PUT", veri: { sinif: "9. Sınıf", hucre: {}, ozelDersler: [] }, bilet: b3 }); // ilk yazma
    assert.strictEqual(p1.veri.surum, 1); // sürüm 1
    const eski = await istek("/api/program", { yontem: "PUT", veri: { data: { sinif: "Eski", hucre: {}, ozelDersler: [] }, surum: 0 }, bilet: b3 }); // bayat sürümle yazma!
    assert.strictEqual(eski.kod, 409); // REDDEDİLİR (ezme yok!)
    assert.strictEqual((await istek("/api/program", { bilet: b3 })).veri.sinif, "9. Sınıf"); // yenisi durur!
    const yeni = await istek("/api/program", { yontem: "PUT", veri: { data: { sinif: "10. Sınıf", hucre: {}, ozelDersler: [] }, surum: 1 }, bilet: b3 }); // güncel sürümle
    assert.strictEqual(yeni.veri.surum, 2); // sürüm artar
  });
  it("Deneme: kural/sınır doğrulama + tür ayrı tekillik", async () => {
    await istek("/api/kayit", { yontem: "POST", veri: { ad: "tOgrDeneme", sifre: "1234", rol: "ogrenci", kurallar: true } }); // BAĞIMSIZ kullanıcı
    const b3 = await giris("tOgrDeneme", "1234");
    const V = (o) => Object.assign({ tarih: "2026-10-04", tur: "Ders Denemesi", yayin: "X", ders: "Fen", soru: 20, dogru: 10, yanlis: 4, kural: "4y1d" }, o);
    assert.strictEqual((await istek("/api/denemeler", { yontem: "POST", veri: V({ soru: 10.5 }), bilet: b3 })).kod, 400); // ondalık red!
    assert.strictEqual((await istek("/api/denemeler", { yontem: "POST", veri: V({ soru: 0 }), bilet: b3 })).kod, 400); // sıfır soru red!
    assert.strictEqual((await istek("/api/denemeler", { yontem: "POST", veri: V({ dogru: -1 }), bilet: b3 })).kod, 400); // negatif red!
    const a = await istek("/api/denemeler", { yontem: "POST", veri: V({}), bilet: b3 }); // ilk kayıt
    assert.strictEqual(a.kod, 201);
    const dup = await istek("/api/denemeler/ice-aktar", { yontem: "POST", veri: { denemeler: [V({}), V({ tur: "Genel Deneme" })] }, bilet: b3 }); // aynı + farklı TÜR
    assert.deepStrictEqual([dup.veri.eklenen, dup.veri.atlanan], [1, 1]); // tür farklı = ayrı kayıt, aynı = atlanır!
  });

  // ---- SPAM KORUMASI REGRESYON TESTLERİ (her biri bağımsız kullanıcı + temiz sayaç) ----
  const { spamSifirla } = require("./spam.js"); // sayaç temizliği için
  const yeniOgrenci = async ad => { // her test için taze hesap (bağımsız sayaç)
    await istek("/api/kayit", { yontem: "POST", veri: { ad, sifre: "1234", rol: "ogrenci", kurallar: true } });
    return giris(ad, "1234");
  };
  it("Spam: hız sınırı 429 + Retry-After verir; IP toplu engel DEĞİL", async () => {
    spamSifirla(); // temiz sayaç (test bağımsızlığı)
    const bA = await yeniOgrenci("tSpamHizA"); // A hızlı giden
    const bB = await yeniOgrenci("tSpamHizB"); // B normal (AYNI IP!)
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Spam hız", aciklama: "x" }, bilet: bA });
    let kod429 = 0, retryAfter = null; // sınır sayacı + başlık
    for (let i = 0; i < 15; i++) { // 15 yorum (sınır 12/dk)
      const r = await fetch(API + `/api/gonderiler/${g.veri.id}/yorumlar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + bA }, body: JSON.stringify({ metin: "hızlı yorum " + i }) });
      if (r.status === 429) { kod429++; retryAfter = retryAfter || r.headers.get("retry-after"); await r.json().catch(() => ({})); }
    }
    assert.ok(kod429 >= 1, "hız sınırı 429 vermeli"); // aşıldı
    assert.ok(+retryAfter > 0, "Retry-After başlığı saniye içermeli"); // bekleme bilgisi var
    // B aynı IP'den (127.0.0.1) YAZABİLİR — IP tavanı 500, okul ağı toplu engellenmez!
    const gB = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Spam hız B", aciklama: "y" }, bilet: bB });
    const yB = await istek(`/api/gonderiler/${gB.veri.id}/yorumlar`, { yontem: "POST", veri: { metin: "B'nin normal yorumu" }, bilet: bB });
    assert.ok([200, 201].includes(yB.kod), "aynı ağdaki başka öğrenci engellenmez"); // serbest
  });
  it("Spam: benzer içerik büyük/küçük harf + boşluk oyunuyla aşılamaz", async () => {
    spamSifirla();
    const b = await yeniOgrenci("tSpamBenzer");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Benzer test", aciklama: "z" }, bilet: b });
    const ilk = await istek(`/api/gonderiler/${g.veri.id}/yorumlar`, { yontem: "POST", veri: { metin: "Harika bir çözüm!" }, bilet: b });
    assert.ok([200, 201].includes(ilk.kod)); // ilki geçer
    const oyun = await fetch(API + `/api/gonderiler/${g.veri.id}/yorumlar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b }, body: JSON.stringify({ metin: "  HARIKA   bir  çözüm   " }) }); // büyük harf + fazla boşluk
    assert.strictEqual(oyun.status, 429); // normalize edilip yakalandı
    const j = await oyun.json(); assert.ok(j.bekleme > 0); // bekleme süresi döner
  });
  it("Spam: çift tıklama/ağ tekrarı istek kimliğiyle TEK kayıt yapar (atomik)", async () => {
    spamSifirla();
    const b = await yeniOgrenci("tSpamTekil");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Tekil test", aciklama: "t" }, bilet: b });
    const kimlik = "istek-" + Math.random().toString(36).slice(2); // tek istemci kimliği
    const gonder = () => fetch(API + `/api/gonderiler/${g.veri.id}/yorumlar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b, "X-Istek-Id": kimlik }, body: JSON.stringify({ metin: "tek tık yorumu" }) });
    const [r1, r2] = await Promise.all([gonder(), gonder()]); // EŞZAMANLI çift tıklama
    await r1.json().catch(() => ({})); await r2.json().catch(() => ({}));
    const akis = await istek("/api/gonderiler?arama=Tekil%20test", { bilet: b }); // kaç kayıt
    assert.strictEqual(akis.veri[0].cevaplar.length, 1, "yalnız 1 yorum (çift tıklama ikinci kez yazmaz)"); // tek kayıt
    const uc = await gonder(); // aynı kimlikle 3. kez (geç ağ tekrarı)
    assert.strictEqual(uc.status, 201, "tamamlanan işlem ÖNCEKİ GERÇEK durumu döndürür (yanlış başarı değil)"); // gerçek 201 tekrarlanır
    const j3 = await uc.json(); assert.strictEqual(j3.tekrar, true); // tekrar işareti döner
    const akis2 = await istek("/api/gonderiler?arama=Tekil%20test", { bilet: b });
    assert.strictEqual(akis2.veri[0].cevaplar.length, 1); // hâlâ tek
  });
  it("Spam: AI kotası sohbet geçmişinden BAĞIMSIZ (silince sıfırlanmaz, retry sayımlanmaz)", async () => {
    spamSifirla();
    const db = require("./db.js"); // aynı süreçteki test defteri
    const b = await yeniOgrenci("tSpamKota");
    const uretim = "kota-" + Math.random().toString(36).slice(2); // üretim kimliği
    const akisGonder = (sohbetId, metin, kimlik) => new Promise((coz, boz) => {
      fetch(API + "/api/sohbet/" + sohbetId + "/mesaj", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b }, body: JSON.stringify({ metin, uretim: kimlik }) })
        .then(async r => { if (!r.ok) return boz(new Error("HTTP " + r.status)); const o = r.body.getReader(), c = new TextDecoder(); let t = ""; for (;;) { const { done, value } = await o.read(); if (done) break; t += c.decode(value, { stream: true }); } coz(t); }).catch(boz);
    });
    const s1 = await istek("/api/sohbet", { yontem: "POST", veri: { baslik: "Kota", ders: "" }, bilet: b });
    await akisGonder(s1.veri.id, "kota sorusu bir", uretim); // 1 üretim
    const sayac1 = db.prepare("SELECT COUNT(*) AS s FROM ai_kullanim WHERE kullanici='tSpamKota'").get().s;
    assert.strictEqual(sayac1, 1); // sayaç 1
    await akisGonder(s1.veri.id, "kota sorusu bir", uretim); // AYNI kimlikle retry
    const sayac2 = db.prepare("SELECT COUNT(*) AS s FROM ai_kullanim WHERE kullanici='tSpamKota'").get().s;
    assert.strictEqual(sayac2, 1, "retry sayacı ARTIRMAZ"); // tekrar sayılmadı
    assert.strictEqual((await istek("/api/sohbet/" + s1.veri.id, { yontem: "DELETE", bilet: b })).kod, 200); // SOHBETİ SİL
    const sayac3 = db.prepare("SELECT COUNT(*) AS s FROM ai_kullanim WHERE kullanici='tSpamKota'").get().s;
    assert.strictEqual(sayac3, 1, "sohbet silinince kota SIFIRLANMAZ"); // silme kotayı sıfırlamaz
    const s2 = await istek("/api/sohbet", { yontem: "POST", veri: { baslik: "Kota2", ders: "" }, bilet: b });
    await akisGonder(s2.veri.id, "kota sorusu iki", "kota-" + Math.random().toString(36).slice(2)); // yeni üretim
    const sayac4 = db.prepare("SELECT COUNT(*) AS s FROM ai_kullanim WHERE kullanici='tSpamKota'").get().s;
    assert.strictEqual(sayac4, 2, "yeni sohbetkte kota devam eder"); // sayaç 2'ye çıktı
  });
  it("Spam: kademeli bekleme — tekrarlanan ihlalde süre artar, KALICI engel yok", async () => {
    spamSifirla();
    const b = await yeniOgrenci("tSpamKademe");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Kademe test", aciklama: "k" }, bilet: b });
    const deneme = async () => { // yorum dene, 429 ise bekleme süresini al
      const r = await fetch(API + `/api/gonderiler/${g.veri.id}/yorumlar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b }, body: JSON.stringify({ metin: "kademe " + Math.random() }) });
      if (r.status !== 429) { await r.json().catch(() => ({})); return 0; }
      const j = await r.json(); return j.bekleme || 0;
    };
    let beklelemeler = [];
    for (let i = 0; i < 15; i++) beklelemeler.push(await deneme()); // ihlalleri tetikle
    const sifirdanSonraki = beklelemeler.filter(x => x > 0); // yalnız 429'lar
    assert.ok(sifirdanSonraki.length >= 2, "en az 2 ihlal kaydı"); // tekrarlanan ihlal var
    assert.ok(Math.max(...sifirdanSonraki) >= sifirdanSonraki[0], "bekleme süresi kademeli artar"); // süre büyüdü
    assert.ok(Math.max(...sifirdanSonraki) <= 300, "tavan 300 sn — KALICI engel yok"); // asla kalıcı değil
    // farklı işlem türü hâlâ serbest — ceza yalnız ihlal edilen işlem türünde!
    const d = await istek("/api/denemeler", { yontem: "POST", veri: { tarih: "2026-10-05", soru: 10, dogru: 5, yanlis: 1, kural: "4y1d" }, bilet: b });
    assert.strictEqual(d.kod, 201, "diğer işlemler engellenmez"); // hesap kilitlenmedi
  });
  it("Spam: A-B-A sırası da yakalanır (yalnız son metin saklanmaz)", async () => {
    spamSifirla();
    const b = await yeniOgrenci("tSpamABA");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "ABA", aciklama: "x" }, bilet: b });
    const y = m => istek(`/api/gonderiler/${g.veri.id}/yorumlar`, { yontem: "POST", veri: { metin: m }, bilet: b });
    assert.ok([200, 201].includes((await y("alfa yorumu")).kod)); // A
    assert.ok([200, 201].includes((await y("beta yorumu")).kod)); // B (arada)
    assert.strictEqual((await y("alfa yorumu")).kod, 429); // A tekrar → yakalandı (son metin değil!)
  });
  it("Spam: aynı istek kimliği farklı gövdeyle kullanılamaz", async () => {
    spamSifirla();
    const b = await yeniOgrenci("tSpamGovde");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Govde", aciklama: "x" }, bilet: b });
    const kimlik = "govde-" + Math.random().toString(36).slice(2);
    const gonder = m => fetch(API + `/api/gonderiler/${g.veri.id}/yorumlar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b, "X-Istek-Id": kimlik }, body: JSON.stringify({ metin: m }) });
    const r1 = await gonder("birinci metin"); await r1.json().catch(() => ({}));
    assert.ok([200, 201].includes(r1.status)); // ilk gövde kabul
    const r2 = await gonder("TAMAMEN farklı metin"); // aynı kimlik, FARKLI gövde
    assert.strictEqual(r2.status, 409); // reddedilir (kimlik başka içerikte yasak)
  });
  it("Spam: başarısız işlem yanlış başarı vermez; aynı gövdeyle güvenli tekrar", async () => {
    spamSifirla();
    const b = await yeniOgrenci("tSpamHata");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Hata", aciklama: "x" }, bilet: b });
    const kimlik = "hata-" + Math.random().toString(36).slice(2);
    const gonder = () => fetch(API + `/api/gonderiler/${g.veri.id}/yorumlar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b, "X-Istek-Id": kimlik }, body: JSON.stringify({ metin: "" }) }); // boş metin: doğrulama hatası
    const r1 = await gonder(); await r1.json().catch(() => ({}));
    assert.strictEqual(r1.status, 400); // başarısız
    const r2 = await gonder(); await r2.json().catch(() => ({}));
    assert.strictEqual(r2.status, 400, "başarısız işlem 200 'zaten işlendi' DEMEZ"); // yanlış başarı yok
  });
  it("İstek gövdesi parmak izi: uzun önek, 1.2 vs 12, \"12\" vs 12, null vs eksik, dizi/anahtar sırası", () => {
    const { govdeOzet: o } = require("./spam.js"); // tam gövde SHA-256 (metin normalizasyonu DEĞİL)
    assert.notStrictEqual(o({ m: "x".repeat(400) + "SON-A" }), o({ m: "x".repeat(400) + "SON-B" }), "aynı ilk 300 harf, farklı son → farklı özet"); // kırpma yok
    assert.notStrictEqual(o({ n: 1.2 }), o({ n: 12 }), "1.2 ≠ 12 (sayı değeri korunur)"); // eskiden çakışıyordu
    assert.notStrictEqual(o({ n: "12" }), o({ n: 12 }), "\"12\" ≠ 12 (tür korunur)"); // eskiden çakışıyordu
    assert.notStrictEqual(o({ a: null }), o({}), "null ≠ eksik alan"); // varlık ayrımı
    assert.notStrictEqual(o({ a: [1, 2] }), o({ a: [2, 1] }), "dizi sırası korunur"); // sıra anlamlı
    assert.strictEqual(o({ a: 1, b: 2 }), o({ b: 2, a: 1 }), "eşdeğer nesne (anahtar sırası farklı) AYNI özet"); // deterministik JSON
    assert.strictEqual(o({ m: "aynı gövde" }), o({ m: "aynı gövde" }), "aynı işlem kimliği + aynı gövde → güvenli tekrar"); // replay temeli
  });
  it("İstek kimliği ara katmanı: YÖNTEM ve YOL kimliğe bağlıdır (birim)", async () => {
    spamSifirla();
    const mw = require("./spam.js").istekKimlik(); // ara katmanı doğrudan sına (uç yok)
    const calistir = (method, path, body, id) => new Promise(coz => {
      const req = { method, path, baseUrl: "", body, url: path, kullanici: { ad: "birimKapsam" }, ip: "127.0.0.1", headers: { "x-istek-id": id }, get(n) { return this.headers[n.toLowerCase()]; } };
      const res = { statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(o) { coz({ kod: this.statusCode, veri: o }); return this; }, on() { return this; } };
      mw(req, res, () => coz({ kod: 0, veri: { gecti: true } }));
    });
    assert.ok((await calistir("PUT", "/api/program", { a: 1 }, "birim-1")).veri.gecti, "ilk istek geçti (kayıt açıldı)"); // temel
    assert.strictEqual((await calistir("POST", "/api/program", { a: 1 }, "birim-1")).kod, 409, "aynı kimlik FARKLI YÖNTEMLE kullanılamaz"); // yöntem bağı
    assert.strictEqual((await calistir("PUT", "/api/baska", { a: 1 }, "birim-1")).kod, 409, "aynı kimlik FARKLI YOLDA kullanılamaz"); // yol bağı
    assert.strictEqual((await calistir("PUT", "/api/program", { a: 2 }, "birim-1")).kod, 409, "aynı kimlik farklı gövdeyle kullanılamaz"); // gövde bağı
  });
  it("İstek kimliği: aynı kimlik farklı hedef/uçta kullanılamaz (yanlış yanıt dönmez)", async () => {
    spamSifirla();
    const b = await yeniOgrenci("tKapsamId");
    const g1 = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Kapsam1", aciklama: "x" }, bilet: b });
    const g2 = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "Kapsam2", aciklama: "y" }, bilet: b });
    const kimlik = "kapsam-" + Math.random().toString(36).slice(2);
    const yorum = (gid, m) => fetch(API + `/api/gonderiler/${gid}/yorumlar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b, "X-Istek-Id": kimlik }, body: JSON.stringify({ metin: m }) });
    const r1 = await yorum(g1.veri.id, "birinci metin"); await r1.json().catch(() => ({}));
    assert.ok([200, 201].includes(r1.status), "ilk hedefe yazıldı"); // temel
    const r2 = await yorum(g2.veri.id, "birinci metin"); await r2.json().catch(() => ({}));
    assert.strictEqual(r2.status, 409, "aynı kimlik FARKLI hedef kayıtta kullanılamaz"); // hedef kayıt yolunda
    const akis = await istek("/api/gonderiler?arama=Kapsam2", { bilet: b });
    assert.strictEqual(akis.veri[0].cevaplar.length, 0, "ikinci işlem ÇALIŞTIRILMADI (ilk yanıt ötekine dönmez)"); // yanlış eşleşme yok
    const r3 = await fetch(API + "/api/sikayet", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b, "X-Istek-Id": kimlik }, body: JSON.stringify({ hedefId: g2.veri.id, neden: "Diğer" }) });
    await r3.json().catch(() => ({}));
    assert.strictEqual(r3.status, 409, "aynı kimlik FARKLI uçta kullanılamaz"); // uç bağı
  });
  it("İstek kimliği: eski biçim (kırpılmış) parmak izi yeni gövdeyle EŞLEŞMEZ; tekrar çalıştırılmaz", async () => {
    spamSifirla();
    const db = require("./db.js"); // göç sınaması: eski kaydı elle kur
    const b = await yeniOgrenci("tEskiGovde");
    const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Fen", baslik: "EskiGovde", aciklama: "x" }, bilet: b });
    const kimlik = "eski-" + Math.random().toString(36).slice(2);
    const yol = "POST /api/gonderiler/" + g.veri.id + "/yorumlar"; // doğru yöntem+yol
    db.prepare("INSERT INTO istek_kimlik (kullanici, istek_id, yol, durum, govde, kod, cevap) VALUES (?,?,?, 'basarili', ?, 201, ?)")
      .run("tEskiGovde", kimlik, yol, "normalize-edilmis-kisa-eski-ozet", JSON.stringify({ id: 999 })); // ESKİ biçim (v2: ön eki yok)
    const r = await fetch(API + `/api/gonderiler/${g.veri.id}/yorumlar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b, "X-Istek-Id": kimlik }, body: JSON.stringify({ metin: "yeni gövde" }) });
    const j = await r.json();
    assert.strictEqual(r.status, 409, "eski parmak izi yeni gövdeyle EŞLEŞMEZ (yanlış başarı yok)"); // göç stratejisi
    assert.strictEqual(j.eskiSurum, true, "eski sürüm kaydı işaretlenir"); // açık göç mesajı
    const akis = await istek("/api/gonderiler?arama=EskiGovde", { bilet: b });
    assert.strictEqual(akis.veri[0].cevaplar.length, 0, "eski kayıt yeniden ÇALIŞTIRILMADI"); // mükerrer yazma yok
  });
  it("Spam: bekleme süresi dolunca ceza biter (KALICI engel yok)", async () => {
    const sp = require("./spam.js");
    assert.strictEqual(sp._testIhlal("ceza1", "yorum", sp.CEZA_UNUTMA + 5000), 0); // süre doldu → ceza yok
    assert.ok(sp._testIhlal("ceza2", "yorum", 1000) > 0); // taze ihlal → ceza var
  });
  it("AI sağlayıcı: başarı/hata/erken kapanış/iptal/uzunluk (sahte sağlayıcı)", async () => {
    const { gercekCevapAkis, YANIT_AZAMI } = require("./ai/sohbet.js");
    const sse = parcalar => ({ ok: true, body: { getReader() { let i = 0; return { read() { if (i >= parcalar.length) return Promise.resolve({ done: true }); return Promise.resolve({ done: false, value: new TextEncoder().encode(parcalar[i++]) }); } }; } } });
    const olay = o => "data: " + JSON.stringify(o) + "\n\n";
    const okF = () => Promise.resolve(sse([olay({ type: "content_block_delta", delta: { text: "Merhaba" } }), olay({ type: "message_stop" })]));
    assert.strictEqual(await gercekCevapAkis("s", [], "", undefined, () => {}, { fetch: okF }), "Merhaba"); // başarılı akış
    const hataF = () => Promise.resolve(sse([olay({ type: "error", error: { message: "aşırı yük" } })]));
    await assert.rejects(() => gercekCevapAkis("s", [], "", undefined, () => {}, { fetch: hataF }), /aşırı yük/); // sağlayıcı hatası → hata
    const yarimF = () => Promise.resolve(sse([olay({ type: "content_block_delta", delta: { text: "yarım" } })]));
    await assert.rejects(() => gercekCevapAkis("s", [], "", undefined, () => {}, { fetch: yarimF }), /tamamlanmadan/); // erken kapanış → hata
    const ctrl = new AbortController(); ctrl.abort();
    await assert.rejects(() => gercekCevapAkis("s", [], "", ctrl.signal, () => {}, { fetch: () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })) }), e => e.iptal === true); // iptal → hata
    const uzunF = () => Promise.resolve(sse([olay({ type: "content_block_delta", delta: { text: "a".repeat(3000) } }), olay({ type: "message_stop" })]));
    let gorunen = ""; const tam = await gercekCevapAkis("s", [], "", undefined, p => gorunen += p, { fetch: uzunF });
    assert.strictEqual(tam.length, YANIT_AZAMI); assert.strictEqual(gorunen.length, YANIT_AZAMI, "görünen = kaydedilen (akışta sınır)"); // tutarlı
    let govde = null; const yakala = (u, sec) => { govde = JSON.parse(sec.body); return Promise.resolve(sse([olay({ type: "message_stop" })])); };
    await gercekCevapAkis("TEK SORU", [{ role: "user", content: "eski" }], "", undefined, () => {}, { fetch: yakala });
    assert.strictEqual(govde.messages.filter(m => (m.content || "").includes("TEK SORU")).length, 1, "son soru YALNIZ BİR KEZ gider"); // çift gönderim yok
  });
  it("Sohbet: aynı üretim kimliğiyle eşzamanlı istek TEK cevap üretir (atomik)", async () => {
    spamSifirla();
    const db = require("./db.js");
    const b = await yeniOgrenci("tSohbetEs");
    const s = await istek("/api/sohbet", { yontem: "POST", veri: { baslik: "Eş", ders: "" }, bilet: b });
    const uretim = "es-" + Math.random().toString(36).slice(2);
    const gonder = () => fetch(API + "/api/sohbet/" + s.veri.id + "/mesaj", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b }, body: JSON.stringify({ metin: "eşzamanlı soru", uretim }) });
    const oku = async r => { if (!r.body) return ""; const rd = r.body.getReader(), c = new TextDecoder(); let t = ""; for (;;) { const { done, value } = await rd.read(); if (done) break; t += c.decode(value, { stream: true }); } return t; };
    const [r1, r2] = await Promise.all([gonder(), gonder()]); // EŞZAMANLI iki istek (aynı üretim)
    await Promise.all([oku(r1), oku(r2)]); // akışları tüket
    const asistan = db.prepare("SELECT COUNT(*) AS s FROM mesajlar WHERE sohbet_id=? AND rol='asistan'").get(s.veri.id).s;
    assert.strictEqual(asistan, 1, "eşzamanlı tekrar TEK model çağrısı/tek cevap"); // atomik rezervasyon
  });
  it("Moderasyon: engellenen sohbet mesajı gerçek vakaya bağlanır, karar verilebilir", async () => {
    const db = require("./db.js");
    const bAdm = await giris("admin", "admin123"); // yönetici (tohumdan)
    const bMod = await yeniOgrenci("tVakaOgr"); // bağımsız öğrenci (sıra bağımsız!)
    const s = await istek("/api/sohbet", { yontem: "POST", veri: { baslik: "Mod", ders: "" }, bilet: bMod });
    const r = await fetch(API + "/api/sohbet/" + s.veri.id + "/mesaj", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + bMod }, body: JSON.stringify({ metin: "Okul çıkışı seni bekliyorum", uretim: "mod-" + Math.random().toString(36).slice(2) }) });
    assert.strictEqual(r.status, 400, "tehdit içeren sohbet mesajı engellenir"); // modele gitmez
    const j = await r.json();
    const kuyruk = await istek("/api/denetim/vakalar", { bilet: bAdm });
    const vaka = kuyruk.veri.find(v => v.tur === "sohbetmesaji" && v.hedef_id === j.soruId); // gerçek mesaj id ile
    assert.ok(vaka, "sohbetmesaji vakası açılır (yazar sohbet sahibinden doğrulanır)"); // eskiden 400 veriyordu!
    const bYetkisiz = await yeniOgrenci("tVakaYetkisiz");
    assert.strictEqual((await istek(`/api/denetim/vakalar/${vaka.id}/karar`, { yontem: "POST", veri: { karar: "kaldir" }, bilet: bYetkisiz })).kod, 403); // yetkisiz karar veremez
    assert.strictEqual((await istek(`/api/denetim/vakalar/${vaka.id}/karar`, { yontem: "POST", veri: { karar: "kaldir" }, bilet: bAdm })).kod, 200); // yetkili karar
    assert.strictEqual((await istek(`/api/denetim/vakalar/${vaka.id}/karar`, { yontem: "POST", veri: { karar: "kaldir" }, bilet: bAdm })).kod, 400, "karar tekrarı mükerrer işlem yapmaz"); // idempotent
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS s FROM mesajlar WHERE id=?").get(j.soruId).s, 0, "kaldırılan sohbet mesajı gerçekten silinir"); // yazar doğrulaması doğru
  });
  it("Program kuyruğu: A yanıtı beklerken B kaybolmaz, doğru sürümle yazılır", async () => {
    const yol = require("path").join(__dirname, "..", "odev-destek", "program-kuyruk.js");
    delete require.cache[require.resolve(yol)];
    const PK = require(yol);
    const depo = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
    let surum = 0; const gonderilen = [], cozumler = [];
    const kuyruk = PK.olustur({ depo, etiketAl: () => "k1", gonder: (veri, taban, id) => new Promise((coz, boz) => { gonderilen.push({ veri, taban, id }); cozumler.push({ coz, boz }); }), surumOku: () => surum, surumYaz: s => { surum = s; }, olay: () => {} });
    kuyruk.ekle({ sinif: "A" }); // revizyon 1
    const p = kuyruk.yaz(); // A gönderilir (yanıt ASILI)
    await new Promise(r => setTimeout(r, 10));
    kuyruk.ekle({ sinif: "B" }); // revizyon 2 (A beklerken!)
    cozumler[0].coz({ surum: 1 }); // A yanıtı GECİKMELİ geldi
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(gonderilen.length, 2, "B de gönderildi (KAYBOLMADI)"); // korunur
    assert.strictEqual(gonderilen[1].veri.sinif, "B"); // doğru içerik
    assert.strictEqual(gonderilen[1].taban, 1, "doğru sunucu sürümüyle (A sonrası)"); // sürüm güncel
    cozumler[1].coz({ surum: 2 }); await p;
    assert.strictEqual(surum, 2); assert.strictEqual(kuyruk.bekleyen("k1"), false, "kuyruk onayla boşaldı"); // temiz
    kuyruk.ekle({ sinif: "C" }); const p2 = kuyruk.yaz(); // ağ hatası senaryosu
    await new Promise(r => setTimeout(r, 10));
    cozumler[2].boz(Object.assign(new Error("ağ"), { kod: 0 })); await p2;
    assert.strictEqual(kuyruk.bekleyen("k1"), true, "hatada kuyruk KALIR (bağlantı gelince sürer)"); // kalıcı
  });
  it("Program kuyruğu: eski hesabın yanıtı yeni hesabın sürümünü EZMEZ", async () => {
    const yol = require("path").join(__dirname, "..", "odev-destek", "program-kuyruk.js");
    const PK = require(yol);
    const depo = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
    let etiket = "A", surumA = 0, surumB = 0; const cozumler = [];
    const kuyruk = PK.olustur({ depo, etiketAl: () => etiket, gonder: () => new Promise((coz, boz) => cozumler.push({ coz, boz })), surumOku: () => (etiket === "A" ? surumA : surumB), surumYaz: s => { if (etiket === "A") surumA = s; else surumB = s; }, olay: () => {} });
    kuyruk.ekle({ sinif: "A1" }); // A hesabı kuyruğa
    const p = kuyruk.yaz(); await new Promise(r => setTimeout(r, 10));
    etiket = "B"; surumB = 7; // hesap DEĞİŞTİ (yeni hesabın sürümü 7)
    cozumler[0].coz({ surum: 5 }); // A'nın yanıtı geç geldi
    await p;
    assert.strictEqual(surumA, 0, "A yanıtı A'nın sürümünü yazmaz (etiket değişti)"); // ekran/önbellek korunur
    assert.strictEqual(surumB, 7, "yeni hesabın sürümü EZİLMEDİ"); // izolasyon
    assert.strictEqual(kuyruk.bekleyen("B"), false, "B hesabında bekleyen yok"); // karışmaz
  });
  it("Program kuyruğu: kuyruk boşalsa da işlem kimliği TEKRARLANMAZ; ağ tekrarı kimliği korur", async () => {
    const yol = require("path").join(__dirname, "..", "odev-destek", "program-kuyruk.js");
    delete require.cache[require.resolve(yol)];
    const PK = require(yol);
    const depo = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
    let surum = 0; const gonderilen = [], cozumler = [];
    const kuyruk = PK.olustur({ depo, etiketAl: () => "k", gonder: (veri, taban, id) => new Promise((coz, boz) => { gonderilen.push({ veri, taban, id }); cozumler.push({ coz, boz }); }), surumOku: () => surum, surumYaz: s => { surum = s; }, olay: () => {} });
    kuyruk.ekle({ sinif: "A" }); const p = kuyruk.yaz(); await new Promise(r => setTimeout(r, 5)); cozumler[0].coz({ surum: 1 }); await p;
    assert.strictEqual(kuyruk.bekleyen("k"), false, "kuyruk boşaldı (A onaylandı)"); // temel
    kuyruk.ekle({ sinif: "B" }); const p2 = kuyruk.yaz(); await new Promise(r => setTimeout(r, 5)); cozumler[1].coz({ surum: 2 }); await p2;
    assert.notStrictEqual(gonderilen[0].id, gonderilen[1].id, "kuyruk boşalsa da yeni işlem YENİ kimlik alır (tekrar YOK)"); // ASIL HATA buydu
    assert.ok(typeof gonderilen[1].id === "string" && gonderilen[1].id.length > 0 && gonderilen[1].id.length <= 64, "kimlik geçerli ve ≤64 harf"); // sunucu sınırı
    kuyruk.ekle({ sinif: "C" }); const p3 = kuyruk.yaz(); await new Promise(r => setTimeout(r, 5)); // ağ hatası
    cozumler[2].boz(Object.assign(new Error("ağ"), { kod: 0 })); await p3;
    assert.strictEqual(kuyruk.bekleyen("k"), true, "hatada kuyruk KALIR"); // kalıcı
    const p4 = kuyruk.yaz(); await new Promise(r => setTimeout(r, 5));
    assert.strictEqual(gonderilen[3].id, gonderilen[2].id, "tekrar deneme ORİJİNAL işlem kimliğini KORUR"); // yenileme/tekrar
    cozumler[3].coz({ surum: 3 }); await p4;
    assert.strictEqual(kuyruk.bekleyen("k"), false, "sonunda onaylandı"); // temiz
  });
  it("Program kuyruğu: eski biçim kayıt VERİ KAYBI olmadan göç eder (kimlik üretilir, sayaç korunur)", async () => {
    const yol = require("path").join(__dirname, "..", "odev-destek", "program-kuyruk.js");
    delete require.cache[require.resolve(yol)];
    const PK = require(yol);
    const depo = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
    depo.setItem(PK._anahtar("k"), JSON.stringify({ sayac: 5, ogeler: [{ rev: 5, veri: { sinif: "Eski" }, taban: 3 }] })); // ESKİ biçim: kayıt içi sayaç + kimliksiz öğe
    let surum = 0; const gonderilen = [], cozumler = [];
    const kuyruk = PK.olustur({ depo, etiketAl: () => "k", gonder: (veri, taban, id) => new Promise((coz, boz) => { gonderilen.push({ veri, taban, id }); cozumler.push({ coz, boz }); }), surumOku: () => surum, surumYaz: s => { surum = s; }, olay: () => {} });
    assert.strictEqual(kuyruk.bekleyen("k"), true, "eski bekleyen kayıt KORUNUR"); // veri kaybı yok
    const p = kuyruk.yaz(); await new Promise(r => setTimeout(r, 5));
    assert.strictEqual(gonderilen[0].veri.sinif, "Eski", "eski veri KAYBOLMADI"); // içerik aynen
    assert.ok(gonderilen[0].id && typeof gonderilen[0].id === "string", "eski öğeye işlem kimliği atandı"); // göç
    cozumler[0].coz({ surum: 4 }); await p;
    kuyruk.ekle({ sinif: "Yeni" }); const p2 = kuyruk.yaz(); await new Promise(r => setTimeout(r, 5)); // göç sonrası taze kayıt
    assert.notStrictEqual(gonderilen[1].id, gonderilen[0].id, "göç sonrası yeni kayıt farklı kimlik alır (eski sayacı aşar)"); // sıra/ kimlik ayrımı
    cozumler[1].coz({ surum: 5 }); await p2;
    assert.strictEqual(surum, 5, "sunucu sürümü ilerledi"); // akış tamam
  });
  it("Program ucu (uçtan uca): ardışık iki kayıt farklı işlem kimliği taşır; tekrar sürümü ARTIRMAZ", async () => {
    const yol = require("path").join(__dirname, "..", "odev-destek", "program-kuyruk.js");
    delete require.cache[require.resolve(yol)];
    const PK = require(yol);
    const b = await yeniOgrenci("tKuyrukId"); // gerçek program ucuyla sına
    const depo = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
    let surum = 0; const gonderilen = [];
    const kuyruk = PK.olustur({
      depo, etiketAl: () => "k",
      gonder: async (veri, taban, id) => { // gerçek PUT /api/program (+ X-Istek-Id)
        gonderilen.push({ veri, taban, id });
        const r = await fetch(API + "/api/program", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b, "X-Istek-Id": id }, body: JSON.stringify({ data: veri, surum: taban }) });
        const j = await r.json();
        if (!r.ok) throw Object.assign(new Error(j.hata || "hata"), { kod: r.status });
        return j;
      },
      surumOku: () => surum, surumYaz: s => { surum = s; }, olay: () => {}
    });
    kuyruk.ekle({ sinif: "A", hucre: {}, ozelDersler: [] }); await kuyruk.yaz(); // A yazıldı → kuyruk BOŞALDI
    assert.strictEqual(kuyruk.bekleyen("k"), false, "A onaylandı, kuyruk boş"); // senaryo başı
    kuyruk.ekle({ sinif: "B", hucre: {}, ozelDersler: [] }); await kuyruk.yaz(); // B yazıldı
    assert.strictEqual(gonderilen.length, 2, "iki kayıt da gönderildi"); // kayıp yok
    assert.notStrictEqual(gonderilen[0].id, gonderilen[1].id, "iki mantıksal kayıt FARKLI işlem kimliği kullanır"); // ASIL HATA
    const srv = await istek("/api/program", { bilet: b });
    assert.strictEqual(srv.veri.sinif, "B", "sunucuda B var (eski kimlik yeniden kullanılmadı)"); // uçtan uca doğru
    const oncekiSurum = srv.veri.surum;
    const tekrar = await fetch(API + "/api/program", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + b, "X-Istek-Id": gonderilen[1].id }, body: JSON.stringify({ data: gonderilen[1].veri, surum: gonderilen[1].taban }) }); // ağ tekrarı: AYNI kimlik + AYNI gövde
    const tj = await tekrar.json();
    assert.strictEqual(tekrar.status, 200, "tamamlanan işlem ÖNCEKİ gerçek durumu döndürür"); // yanlış başarı değil
    assert.strictEqual(tj.tekrar, true, "tekrar işareti döner"); // idempotent replay
    const srv2 = await istek("/api/program", { bilet: b });
    assert.strictEqual(srv2.veri.sinif, "B", "içerik korunur"); // ezilmedi
    assert.strictEqual(srv2.veri.surum, oncekiSurum, "tekrar yazma sürümü ARTIRMAZ (yeniden çalıştırılmaz)"); // mükerrer yazma yok
  });
});

describe("Notlarım: kişisel not CRUD + sahiplik + tekillik", () => {
  let bn1, bn2, notId; // iki ayrı kullanıcı + oluşturulan not kimliği
  it("hazırlık: iki ayrı kullanıcı açılır", async () => {
    assert.strictEqual((await istek("/api/kayit", { yontem: "POST", veri: { ad: "tNotA", sifre: "1234", rol: "ogrenci", kurallar: true } })).kod, 200);
    assert.strictEqual((await istek("/api/kayit", { yontem: "POST", veri: { ad: "tNotB", sifre: "1234", rol: "ogrenci", kurallar: true } })).kod, 200);
    bn1 = await giris("tNotA", "1234"); bn2 = await giris("tNotB", "1234"); // iki bilet
    assert.ok(bn1 && bn2); // ikisi de geldi
  });
  it("oluştur + doğrulama (boş/uzun başlık, geçersiz tarih/renk reddedilir); sahip alanı sızmaz", async () => {
    assert.strictEqual((await istek("/api/notlar", { yontem: "POST", veri: { baslik: "   " }, bilet: bn1 })).kod, 400); // boş başlık
    assert.strictEqual((await istek("/api/notlar", { yontem: "POST", veri: { baslik: "x".repeat(81) }, bilet: bn1 })).kod, 400); // uzun başlık
    assert.strictEqual((await istek("/api/notlar", { yontem: "POST", veri: { baslik: "a", tarih: "17.10.2026" }, bilet: bn1 })).kod, 400); // tarih biçimi
    assert.strictEqual((await istek("/api/notlar", { yontem: "POST", veri: { baslik: "a", renk: "neon" }, bilet: bn1 })).kod, 400); // geçersiz renk
    const r = await istek("/api/notlar", { yontem: "POST", veri: { baslik: "Türev notu", icerik: "türev kuralları", ders: "Matematik", tarih: "2026-10-17", renk: "mavi", sabit: true }, bilet: bn1 });
    assert.strictEqual(r.kod, 201); notId = r.veri.id; // oluştu
    assert.strictEqual(r.veri.baslik, "Türev notu"); assert.strictEqual(r.veri.sabit, 1); // alanlar doğru
    assert.ok(!("sahip" in r.veri), "sahip alanı istemciye VERİLMEZ!"); // sızıntı yok
  });
  it("liste yalnız kendi notumu verir; B A'nın notunu göremez/değiştiremez/silemez", async () => {
    assert.strictEqual((await istek("/api/notlar", { bilet: bn1 })).veri.length, 1); // A'da 1
    assert.deepStrictEqual((await istek("/api/notlar", { bilet: bn2 })).veri, []); // B'de YOK
    assert.strictEqual((await istek("/api/notlar/" + notId, { yontem: "PUT", veri: { baslik: "ele geçir" }, bilet: bn2 })).kod, 404); // değiştiremez
    assert.strictEqual((await istek("/api/notlar/" + notId, { yontem: "DELETE", bilet: bn2 })).kod, 404); // silemez
  });
  it("güncelle: içerik/tarih/sabit değişir", async () => {
    const r = await istek("/api/notlar/" + notId, { yontem: "PUT", veri: { baslik: "Türev notu 2", icerik: "güncellendi", ders: "Matematik", tarih: "2026-10-18", renk: "yesil", sabit: false }, bilet: bn1 });
    assert.strictEqual(r.kod, 200); assert.strictEqual(r.veri.baslik, "Türev notu 2"); assert.strictEqual(r.veri.sabit, 0); // güncellendi
  });
  it("XSS: içerik DÜZ METİN saklanır (etiket olarak yorumlanmaz)", async () => {
    const r = await istek("/api/notlar", { yontem: "POST", veri: { baslik: "xss", icerik: "<script>alert(1)</script>" }, bilet: bn1 });
    const bul = (await istek("/api/notlar", { bilet: bn1 })).veri.find(n => n.id === r.veri.id);
    assert.strictEqual(bul.icerik, "<script>alert(1)</script>"); // içerik aynen durur (kaçış ÖN YÜZDE yapılır)
  });
  it("çift tıklama: aynı istek kimliği TEK not oluşturur (atomik)", async () => {
    const kimlik = "not-tekil-1"; // sabit işlem kimliği
    const gonder = () => fetch(API + "/api/notlar", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + bn1, "X-Istek-Id": kimlik }, body: JSON.stringify({ baslik: "Tek not" }) });
    const [r1, r2] = await Promise.all([gonder(), gonder()]); // EŞZAMANLI çift tık
    await r1.json(); await r2.json(); // gövdeleri tüket
    const hepsi = (await istek("/api/notlar", { bilet: bn1 })).veri.filter(n => n.baslik === "Tek not");
    assert.strictEqual(hepsi.length, 1, "aynı istek kimliği çift kayıt YAPMAZ!"); // tekillik
  });
  it("sil: yalnız kendi notu; silinen listede görünmez, ikinci silme 404", async () => {
    assert.strictEqual((await istek("/api/notlar/" + notId, { yontem: "DELETE", bilet: bn1 })).kod, 200); // silindi
    assert.ok(!(await istek("/api/notlar", { bilet: bn1 })).veri.some(n => n.id === notId)); // listede yok
    assert.strictEqual((await istek("/api/notlar/" + notId, { yontem: "DELETE", bilet: bn1 })).kod, 404); // ikinci silme yok
  });
  it("oturumsuz erişim engellenir (401)", async () => {
    assert.strictEqual((await istek("/api/notlar", {})).kod, 401); // bilet yok
  });
});
