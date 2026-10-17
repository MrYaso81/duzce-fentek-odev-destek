// Kütüphane görünürlüğü + öneri imleci + önbellek yeniden doğrulama + ilgi tercihleri testleri.
// AYRI test defteri + AYRI kapı + AYRI video deposu: gerçek veriye DOKUNMAZ.
// Çalıştırma: backend klasöründe `node --test test-kutuphane.js`
//
// Kapsam (bildirilen sorunlar):
//  #1 Misafir/üye/yönetim içerik görünürlüğü; istemci kapsamı YETKİ ARTIRAMAZ.
//  #2 İmlecin sahiplik/kapsam/süre bağı; bozuk/negatif/aralık dışı imleç davranışı.
//  #3 Önbellekteki içerik YETKİ KANITI DEĞİL: güncel durum/başlık/özet her sayfada yeniden doğrulanır.
//  #4 "İlgilenmiyorum" dışlaması pozitif kişiselleştirmeden BAĞIMSIZ; tercih değişince imleç geçersiz.
process.env.DB_PATH = "./test-kutuphane.db"; // ayrı defter (gerçek odevagi.db DEĞİL!)
process.env.PORT = "3142"; // ayrı kapı (3001/3131/3141 DEĞİL)
process.env.HOST = "127.0.0.1"; // testte döngü
process.env.JWT_SECRET = "test-kutuphane-gizli-anahtar-1234567890";
process.env.SINAV_KEY = "test-anahtari-123"; // havuz açık sayılsın
process.env.VIDEO_KUYRUK_KAPALI = "1"; // video kuyruğu döngüsü kapalı (deterministik)
process.env.VIDEO_STORE = "./test-kutuphane-depo"; // ayrı karantina deposu
process.env.NODE_ENV = "test";
try { require("fs").unlinkSync("./test-kutuphane.db"); } catch { /* ilk çalışsa yok */ }

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const db = require("./db"); // aynı tekil bağlantı sunucuyla paylaşılır
const K = require("./kutuphane");
const ONERI = require("./oneri");
const RAG = require("./ai/rag");

const API = "http://127.0.0.1:3142"; // test adresi
let sunucu;

async function istek(yol, sec = {}) { // kısa istek yardımcısı (JSON)
  const r = await fetch(API + yol, {
    method: sec.yontem || "GET",
    headers: { "Content-Type": "application/json", ...(sec.bilet ? { Authorization: "Bearer " + sec.bilet } : {}) },
    body: sec.veri ? JSON.stringify(sec.veri) : undefined
  });
  let veri = null; try { veri = await r.json(); } catch { veri = null; }
  return { kod: r.status, veri };
}
const giris = async (ad) => (await istek("/api/giris", { yontem: "POST", veri: { ad, sifre: "test1234" } })).veri.bilet; // bilet al
const idler = (r) => (r.veri && r.veri.sonuclar ? r.veri.sonuclar.map(x => x.icerik_id) : []);
const metin = (r) => JSON.stringify(r.veri || {}); // içerik sızıntısı aramak için ham metin

// Kullanıcıları DOĞRUDAN ekle (onay akışı beklemeyiz; roller sabit ve kontrollü)
function kullaniciEkle(ad, rol) {
  db.prepare("INSERT INTO kullanicilar (ad, sifre_hash, rol, onay) VALUES (?,?,?,1)").run(ad, bcrypt.hashSync("test1234", 10), rol);
}
// İçerik ekle (durum/görünüm kontrollü; yalnız test defterine)
function icerikEkle(id, sec = {}) {
  const o = Object.assign({ durum: "yayinda", gorunum: "herkes", ders: "Genel", konu_id: "", konu: "", desen: "", kalite: 0.5, baslik: id, ozet: "", cevap: "", ipucu: "" }, sec);
  db.prepare(`INSERT INTO kutuphane
    (icerik_id, baslik, ozet, ders, sinif, konu_id, konu, desen, zorluk, tur, soru, ipucu, adimlar, cevap, etiketler, kaynak_ad, kaynak_url, lisans, kalite, durum, sahip, ornek, gorunum)
    VALUES (?,?,?,?,'',?,?,?,'orta','cozum','',?,'[]',?,'[]','test-kaynak','','test-lisans',?,?, 'test', 0, ?)`)
    .run(id, o.baslik, o.ozet, o.ders, o.konu_id, o.konu, o.desen, o.ipucu, o.cevap, o.kalite, o.durum, o.gorunum);
}
async function hazirOl() { // sunucu ayağa kalkana kadar bekle
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(API + "/api/saglik"); if (r.ok) return; } catch { /* bekle */ }
    await new Promise(c => setTimeout(c, 100));
  }
  throw new Error("Sunucu ayağa kalkmadı");
}

let bA, bB, bC, bD, bE, bF, bG, bH, bMudur; // ortak biletler

before(async () => {
  // --- Kullanıcılar ---
  for (const [ad, rol] of [["kA", "ogrenci"], ["kB", "ogrenci"], ["kC", "ogrenci"], ["kD", "ogrenci"], ["kE", "ogrenci"], ["kF", "ogrenci"], ["kG", "ogrenci"], ["kH", "ogrenci"], ["kHoca", "ogretmen"], ["kMudur", "mudur"], ["kAdmin", "admin"]]) kullaniciEkle(ad, rol);

  // --- Görünürlük seti (VisDers): yalnız v-herkes-yayin engelsiz görünür ---
  icerikEkle("v-herkes-yayin", { ders: "VisDers", baslik: "Herkes yayında", ozet: "VIS-HERKES" });
  icerikEkle("v-kurum-yayin", { ders: "VisDers", gorunum: "kurum", baslik: "Kurum yayında", ozet: "VIS-KURUM" });
  icerikEkle("v-gizli", { ders: "VisDers", durum: "gizli", baslik: "Gizli", ozet: "VIS-GIZLI" });
  icerikEkle("v-taslak", { ders: "VisDers", durum: "taslak", baslik: "Taslak", ozet: "VIS-TASLAK" });
  icerikEkle("v-incelemede", { ders: "VisDers", durum: "incelemede", baslik: "İncelemede", ozet: "VIS-INCELEME" });
  icerikEkle("v-silindi", { ders: "VisDers", durum: "silindi", baslik: "Silindi", ozet: "VIS-SILINDI" });

  // --- Öneri seti (puan/çeşitlilik) ---
  for (let i = 1; i <= 6; i++) icerikEkle("o" + i, { ders: "OnrDers", konu_id: "onr-konu", konu: "Öneri Konu", kalite: 0.3 + i / 20, baslik: "Öneri " + i });
  icerikEkle("o-kurum", { ders: "OnrDers", konu_id: "onr-konu", konu: "Öneri Konu", gorunum: "kurum", baslik: "Kurum öneri" });

  // --- Önbellek yeniden doğrulama seti (özgün başlık/özet/cevap) ---
  for (let i = 1; i <= 6; i++) icerikEkle("c" + i, { ders: "CacDers", konu_id: "cac-konu", konu: "Önbellek", baslik: "Önbellek " + i, ozet: "CAC-OZET-" + i, cevap: "CAC-CEVAP-" + i });

  // --- İlgilenmiyorum seti ---
  for (let i = 1; i <= 6; i++) icerikEkle("d" + i, { ders: "IlgiDers", konu_id: "ilgi-konu", konu: "İlgi", baslik: "İlgi " + i, ozet: "ILGI-" + i });

  // --- Benzer içerik seti ---
  icerikEkle("b-src", { ders: "BnzDers", konu_id: "bnz-konu", konu: "Benzer", gorunum: "kurum", baslik: "Kaynak (kurum)" });
  icerikEkle("b-sim", { ders: "BnzDers", konu_id: "bnz-konu", konu: "Benzer", baslik: "Benzer kardeş" });
  icerikEkle("b-gizli", { ders: "BnzDers", konu_id: "bnz-konu", konu: "Benzer", durum: "gizli", baslik: "Gizli kaynak" });

  // --- RAG seti (FTS araması için özgün terim) ---
  icerikEkle("r-herkes", { ders: "RagDers", konu_id: "rag-konu", konu: "Rag", baslik: "RAG herkes", ozet: "benzersizkelime herkes" });
  icerikEkle("r-kurum", { ders: "RagDers", konu_id: "rag-konu", konu: "Rag", gorunum: "kurum", baslik: "RAG kurum", ozet: "benzersizkelime kurum" });

  K.indeksiYenile(); // yayındaki içerik için FTS + anahtar metnini kur

  sunucu = require("./server.js"); // test sunucusunu başlat
  await hazirOl();
  bA = await giris("kA"); bB = await giris("kB"); bC = await giris("kC");
  bD = await giris("kD"); bE = await giris("kE"); bF = await giris("kF"); bG = await giris("kG"); bH = await giris("kH");
  bMudur = await giris("kMudur");
});

after(async () => {
  const { ocrKapat } = require("./ai/ocr.js");
  try { await ocrKapat(); } catch { /* işçi açılmadıysa geç */ }
  if (sunucu) await new Promise(coz => sunucu.close(coz)); // kapanışı BEKLE (zorla sonlandırma YOK)
  try { require("./db.js").close(); } catch { /* zaten kapalıysa geç */ }
  await new Promise(r => setTimeout(r, 100));
  try { fs.unlinkSync("./test-kutuphane.db"); } catch { /* temizlik */ }
  try { fs.rmSync("./test-kutuphane-depo", { recursive: true, force: true }); } catch { /* temizlik */ }
});

// ======================= #1 GÖRÜNÜRLÜK =======================
describe("#1 İçerik görünürlüğü (misafir/üye/yönetim)", () => {
  it("durumKosulu TEK imza: nesne — misafir yalnız 'herkes', üye 'herkes'+'kurum', yönetim gizli dahil", () => {
    assert.match(K.durumKosulu({ kapsam: "misafir" }).sql, /gorunum = 'herkes'/);
    assert.match(K.durumKosulu({ kapsam: "uye" }).sql, /gorunum IN \('herkes','kurum'\)/);
    assert.strictEqual(K.durumKosulu({ kapsam: "yonetim", durum: "gizli" }).sql, "durum = ?"); // açık filtre
    assert.match(K.durumKosulu({ kapsam: "yonetim" }).sql, /durum <> 'silindi'/);
    assert.match(K.durumKosulu({ kapsam: "bilinmeyen" }).sql, /gorunum = 'herkes'/); // bilinmeyen → EN KISITLI
    assert.match(K.durumKosulu({}).sql, /gorunum = 'herkes'/); // argümansız da en kısıtlı
  });

  it("ara(): misafir gizli/taslak/inceleme/silinmiş/kurum GÖRMEZ; üye kurum görür ama gizliyi görmez", () => {
    const gm = K.ara({ ders: "VisDers", kapsam: "misafir", limit: 50 });
    const gid = gm.sonuclar.map(x => x.icerik_id);
    assert.deepStrictEqual(gid, ["v-herkes-yayin"]); // YALNIZ herkes+yayında
    const gu = K.ara({ ders: "VisDers", kapsam: "uye", limit: 50 }).sonuclar.map(x => x.icerik_id).sort();
    assert.deepStrictEqual(gu, ["v-herkes-yayin", "v-kurum-yayin"]); // üye: kurum dahil, gizli HARİÇ
    const gy = K.ara({ ders: "VisDers", kapsam: "yonetim", limit: 50 }).sonuclar.map(x => x.icerik_id);
    assert.ok(gy.includes("v-gizli") && gy.includes("v-taslak") && gy.includes("v-incelemede")); // yönetim hepsini görür
    assert.ok(!gy.includes("v-silindi"), "varsayılan yönetim görünümü silineni listelemez");
    const gys = K.ara({ ders: "VisDers", kapsam: "yonetim", durum: "silindi", limit: 50 }).sonuclar.map(x => x.icerik_id);
    assert.deepStrictEqual(gys, ["v-silindi"]); // açık silinen filtresi çalışır
  });

  it("tekGetir(): kapsama uymayan içerik null döner (gizli/silinmiş/kurum-misafir)", () => {
    assert.ok(K.tekGetir("v-herkes-yayin", "misafir"));
    assert.strictEqual(K.tekGetir("v-kurum-yayin", "misafir"), null);
    assert.ok(K.tekGetir("v-kurum-yayin", "uye"));
    assert.strictEqual(K.tekGetir("v-gizli", "uye"), null);
    assert.strictEqual(K.tekGetir("v-taslak", "uye"), null);
    assert.strictEqual(K.tekGetir("v-silindi", "uye"), null);
    assert.ok(K.tekGetir("v-gizli", "yonetim"));
  });

  it("uç nokta: /api/kutuphane misafire yalnız herkes-yayını verir; detay ucu kapsamı uygular", async () => {
    const mis = await istek("/api/kutuphane?ders=VisDers&limit=50");
    assert.deepStrictEqual(idler(mis), ["v-herkes-yayin"]);
    const uye = await istek("/api/kutuphane?ders=VisDers&limit=50", { bilet: bA });
    assert.ok(idler(uye).includes("v-kurum-yayin") && !idler(uye).includes("v-gizli"));
    assert.strictEqual((await istek("/api/kutuphane/kaynak/v-kurum-yayin")).kod, 404); // misafir
    assert.strictEqual((await istek("/api/kutuphane/kaynak/v-kurum-yayin", { bilet: bA })).kod, 200); // üye
    assert.strictEqual((await istek("/api/kutuphane/kaynak/v-gizli", { bilet: bA })).kod, 404); // üye göremez
    assert.strictEqual((await istek("/api/kutuphane/kaynak/v-gizli", { bilet: bMudur })).kod, 200); // personel görür
  });

  it("istemci kapsam/durum parametreleri YETKİ ARTIRAMAZ", async () => {
    const siz = await istek("/api/kutuphane?ders=VisDers&kapsam=yonetim&durum=gizli&limit=50"); // misafir hile denemesi
    assert.deepStrictEqual(idler(siz), ["v-herkes-yayin"]); // hâlâ yalnız herkes
    const aram = await istek("/api/arama?ders=VisDers&kapsam=yonetim&limit=50");
    assert.deepStrictEqual(idler(aram), ["v-herkes-yayin"]);
    const uyeHile = await istek("/api/kutuphane?ders=VisDers&kapsam=yonetim&durum=gizli&limit=50", { bilet: bA });
    assert.ok(!idler(uyeHile).includes("v-gizli"), "öğrenci kapsamı yükseltemez");
    assert.strictEqual((await istek("/api/kutuphane/yonetim")).kod, 401); // misafir: yetki yok
    assert.strictEqual((await istek("/api/kutuphane/yonetim", { bilet: bA })).kod, 403); // öğrenci: yetki yok
    const yon = await istek("/api/kutuphane/yonetim?durum=gizli&limit=50", { bilet: bMudur });
    assert.strictEqual(yon.kod, 200);
    assert.ok(idler(yon).includes("v-gizli")); // personel inceleme listesi çalışır
  });

  it("arama (FTS): misafir 'kurum' içeriğini bulamaz, üye bulur", async () => {
    const mis = await istek("/api/arama?q=" + encodeURIComponent("benzersizkelime"));
    assert.ok(idler(mis).includes("r-herkes"));
    assert.ok(!idler(mis).includes("r-kurum"), "misafir kurum içeriğini aramada göremez");
    const uye = await istek("/api/arama?q=" + encodeURIComponent("benzersizkelime"), { bilet: bA });
    assert.ok(idler(uye).includes("r-kurum"));
  });
});

// ======================= #2 İMLEÇ SAHİPLİK/KAPSAM =======================
describe("#2 Öneri imleci: sahiplik, kapsam ve sınırlar", () => {
  it("kişisel akış: sayfalar kaymaz/tekrarlamaz (imleç sabit sıralama)", async () => {
    const p1 = await istek("/api/oneriler?limit=2", { bilet: bA });
    assert.strictEqual(p1.veri.sonuclar.length, 2);
    assert.ok(p1.veri.imlec, "devam imleci üretilmeli");
    const p2 = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(p1.veri.imlec), { bilet: bA });
    const p3 = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(p2.veri.imlec), { bilet: bA });
    const hepsi = [...idler(p1), ...idler(p2), ...idler(p3)];
    assert.strictEqual(new Set(hepsi).size, hepsi.length, "sayfalar arası tekrar OLMAMALI");
    assert.strictEqual(hepsi.length, 6); // 3 sayfa x 2
  });

  it("imleç BAŞKA kullanıcıya/oturuma taşınamaz (403)", async () => {
    const a = await istek("/api/oneriler?limit=2", { bilet: bA });
    const baskasi = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(a.veri.imlec), { bilet: bB });
    assert.strictEqual(baskasi.kod, 403); // B, A'nın listesini göremez
    const misafir = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(a.veri.imlec));
    assert.strictEqual(misafir.kod, 403); // misafir, üye imlecini kullanamaz
  });

  it("misafir imleci ayrıdır: misafir kendi sayfalarını gezebilir, üye onu kullanamaz", async () => {
    const g1 = await istek("/api/oneriler?limit=2");
    assert.strictEqual(g1.veri.misafir, true);
    const g2 = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(g1.veri.imlec));
    assert.strictEqual(g2.kod, 200);
    const uyeKullan = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(g1.veri.imlec), { bilet: bA });
    assert.strictEqual(uyeKullan.kod, 403); // üye, misafir imlecini kullanamaz
  });

  it("bozuk/negatif/aşırı imleçler açık hata verir (400/410); aralık dışı boş sayfa döner", async () => {
    assert.strictEqual((await istek("/api/oneriler?imlec=" + encodeURIComponent("kotu!!imlec"), { bilet: bA })).kod, 400);
    const a = await istek("/api/oneriler?limit=2", { bilet: bA });
    const token = a.veri.imlec.split(".")[0];
    assert.strictEqual((await istek("/api/oneriler?imlec=" + encodeURIComponent(token + ".-1"), { bilet: bA })).kod, 400); // negatif
    assert.strictEqual((await istek("/api/oneriler?imlec=" + encodeURIComponent(token + ".1.5"), { bilet: bA })).kod, 400); // ondalık
    assert.strictEqual((await istek("/api/oneriler?imlec=" + encodeURIComponent("gecerliAmaYok12345"), { bilet: bA })).kod, 410); // bilinmeyen → süresi dolmuş
    const bos = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(token + ".90000"), { bilet: bA }); // sınır içinde ama liste sonu
    assert.strictEqual(bos.kod, 200);
    assert.deepStrictEqual(bos.veri.sonuclar, []); // öngörülebilir: boş sayfa
    assert.strictEqual(bos.veri.imlec, null);
  });

  it("öneri akışı erişim kapsamını uygular (misafir kurum içeriği almaz)", async () => {
    const mis = await istek("/api/oneriler?limit=30");
    assert.strictEqual(mis.veri.misafir, true);
    assert.ok(!idler(mis).includes("o-kurum"), "misafire kurum içeriği önerilmez");
    const uye = await istek("/api/oneriler?limit=30", { bilet: bA });
    assert.ok(idler(uye).includes("o-kurum"), "üye kurum içeriğini görebilir");
  });
});

// ======================= #3 ÖNBELLEK YENİDEN DOĞRULAMA =======================
describe("#3 Önbellek YETKİ KANITI DEĞİL: her sayfa güncel durumu doğrular", () => {
  it("gizlenen/silinen içerik eski imleçle GERİ GELMEZ; düzenlenen başlık/özet güncel döner", async () => {
    const r1 = await istek("/api/oneriler?limit=2", { bilet: bC }); // cC ile anlık görüntü
    const token = r1.veri.imlec.split(".")[0];
    const p1 = r1.veri.sonuclar;
    const r2 = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(r1.veri.imlec), { bilet: bC });
    const p2 = r2.veri.sonuclar;
    assert.strictEqual(p1.length, 2); assert.strictEqual(p2.length, 2);
    const ilkId = p1[0].icerik_id, hedefId = p2[0].icerik_id, digeriId = p2[1].icerik_id;
    const hedefBaslik = p2[0].baslik, hedefOzet = p2[0].ozet, hedefCevap = p2[0].cevap;

    // (a) Düzenleme: aynı imleçle ilk sayfa GÜNCEL başlık/özet gösterir (bayat veri sızmaz)
    db.prepare("UPDATE kutuphane SET baslik=?, ozet=?, cevap=? WHERE icerik_id=?").run("GUNCEL-BASLIK-XYZ", "GUNCEL-OZET-XYZ", "GUNCEL-CEVAP-XYZ", ilkId);
    const taze = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(token + ".0"), { bilet: bC });
    const ilk = taze.veri.sonuclar.find(x => x.icerik_id === ilkId);
    assert.ok(ilk, "düzenlenen içerik hâlâ görünür");
    assert.strictEqual(ilk.baslik, "GUNCEL-BASLIK-XYZ", "önceki başlık geri gelmemeli");
    assert.strictEqual(ilk.ozet, "GUNCEL-OZET-XYZ");
    assert.strictEqual(ilk.cevap, "GUNCEL-CEVAP-XYZ");

    // (b) Gizleme: ikinci sayfadaki hedef gizlenince eski imleç onu DÖNDÜRMEZ
    db.prepare("UPDATE kutuphane SET durum='gizli' WHERE icerik_id=?").run(hedefId);
    const t2 = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(r1.veri.imlec), { bilet: bC });
    assert.ok(!idler(t2).includes(hedefId), "gizlenen içerik eski imleçle sızmamalı");
    assert.ok(!metin(t2).includes(hedefBaslik) && !metin(t2).includes(hedefOzet) && !metin(t2).includes(hedefCevap), "gizli başlık/özet/cevap sızmamalı");
    assert.ok(idler(t2).includes(digeriId), "gizlenmeyen içerik yerine gelmeli");

    // (c) Silme: diğer içerik de silinince ikisi de dönmez
    db.prepare("UPDATE kutuphane SET durum='silindi' WHERE icerik_id=?").run(digeriId);
    const t3 = await istek("/api/oneriler?limit=2&imlec=" + encodeURIComponent(r1.veri.imlec), { bilet: bC });
    assert.ok(!idler(t3).includes(hedefId) && !idler(t3).includes(digeriId), "silinen/gizlenen içerik dönmemeli");

    // (d) Detay ucu da güncel duruma uyar
    assert.strictEqual((await istek("/api/kutuphane/kaynak/" + hedefId, { bilet: bC })).kod, 404);
    assert.strictEqual((await istek("/api/kutuphane/kaynak/" + digeriId, { bilet: bC })).kod, 404);

    // (e) TEMİZLİK: yalnız bu testte değiştirilen görünürlükleri geri al (diğer testler etkilenmesin)
    db.prepare("UPDATE kutuphane SET durum='yayinda' WHERE icerik_id IN (?,?)").run(hedefId, digeriId);
  });

  it("benzer içerik: görünmeyen kaynaktan ÜRETİLMEZ", async () => {
    const misafir = await istek("/api/oneriler/benzer/b-src"); // b-src kurum → misafire yok
    assert.strictEqual(misafir.veri.toplam, 0);
    const uye = await istek("/api/oneriler/benzer/b-src", { bilet: bA });
    assert.ok(uye.veri.toplam >= 1 && uye.veri.sonuclar.some(x => x.icerik_id === "b-sim"));
    const gizli = await istek("/api/oneriler/benzer/b-gizli", { bilet: bA });
    assert.strictEqual(gizli.veri.toplam, 0); // gizli kaynaktan benzer üretilmez
    assert.strictEqual(ONERI.benzerGetir("b-gizli", { kapsam: "uye" }).toplam, 0);
  });

  it("AI getirimi (RAG): misafir kurum içeriğini bağlam olarak ALMAZ", () => {
    const mis = RAG.getir("benzersizkelime", { kapsam: "misafir" });
    assert.ok(mis.some(x => x.icerik_id === "r-herkes"));
    assert.ok(!mis.some(x => x.icerik_id === "r-kurum"), "misafir RAG bağlamına kurum içeriği girmemeli");
    const uye = RAG.getir("benzersizkelime", { kapsam: "uye" });
    assert.ok(uye.some(x => x.icerik_id === "r-kurum"));
  });
});

// ======================= #4 İLGİLENMİYORUM + TERCİHLER =======================
describe("#4 'İlgilenmiyorum' pozitif kişiselleştirmeden bağımsız + tercih geçersizliği", () => {
  it("pozitif sinyal YOKKEN bile ilgilenmiyorum uygulanır; yeni listede geri gelmez", async () => {
    const once = await istek("/api/oneriler?limit=30", { bilet: bD });
    assert.ok(idler(once).includes("d1"), "başlangıçta d1 görünür olmalı");
    const imlec = once.veri.imlec;
    assert.strictEqual((await istek("/api/ilgi", { yontem: "POST", veri: { sinyal: "ilgilenmiyorum", icerik_id: "d1" }, bilet: bD })).kod, 200);
    const sonra = await istek("/api/oneriler?limit=30", { bilet: bD });
    assert.ok(!idler(sonra).includes("d1"), "ilgilenmiyorum içeriği öneride KALMAMALI (pozitif sinyal olmasa da)");
    // Eski imleç: tercih değişti → geçersiz (410) → eski içerik DİRİLTİLEMEZ
    const eski = await istek("/api/oneriler?limit=5&imlec=" + encodeURIComponent(imlec), { bilet: bD });
    assert.strictEqual(eski.kod, 410, "tercih değişince eski imleç süresi dolmuş sayılmalı");
  });

  it("kişiselleştirme KAPALIYKEN dışlama korunur; sıfırlama dışlamayı temizler, kapat ayarını KORUR", async () => {
    await istek("/api/ilgi/kapat", { yontem: "POST", veri: { kapali: true }, bilet: bE });
    const d0 = await istek("/api/ilgi", { bilet: bE });
    assert.strictEqual(d0.veri.kapali, true);
    const once = await istek("/api/oneriler?limit=30", { bilet: bE });
    assert.strictEqual(once.veri.kisisel, false); // kişiselleştirme kapalı
    assert.ok(idler(once).includes("d2"), "d2 başlangıçta görünür");
    await istek("/api/ilgi", { yontem: "POST", veri: { sinyal: "ilgilenmiyorum", icerik_id: "d2" }, bilet: bE });
    const sonra = await istek("/api/oneriler?limit=30", { bilet: bE });
    assert.ok(!idler(sonra).includes("d2"), "kapalı kişiselleştirmede bile dışlama uygulanmalı");
    // Sıfırla: dışlama temizlenir AMA kapat ayarı korunur
    const sif = await istek("/api/ilgi/sifirla", { yontem: "POST", veri: {}, bilet: bE });
    assert.strictEqual(sif.veri.tamam, true);
    assert.strictEqual(sif.veri.kaydedilen_kapat_ayari, true, "'kapat' ayarı korunmalı");
    assert.ok(typeof sif.veri.aciklama === "string" && sif.veri.aciklama.length > 10, "ne silindiği açıklanmalı");
    const d1 = await istek("/api/ilgi", { bilet: bE });
    assert.strictEqual(d1.veri.kapali, true, "sıfırlama kişiselleştirmeyi AÇMAMALI");
    const temiz = await istek("/api/oneriler?limit=30", { bilet: bE });
    assert.ok(idler(temiz).includes("d2"), "sıfırlamadan sonra dışlama temizlenmeli (d2 geri gelir)");
  });

  it("beğenilen içeriğin KENDİSİ önerilmez; beğeni sonrası ilgilenmiyorum çalışır", async () => {
    await istek("/api/ilgi", { yontem: "POST", veri: { sinyal: "begen", icerik_id: "d3" }, bilet: bF });
    const r1 = await istek("/api/oneriler?limit=30", { bilet: bF });
    assert.ok(!idler(r1).includes("d3"), "beğenilen içeriğin kendisi önerilmemeli");
    assert.ok(idler(r1).includes("d4"));
    await istek("/api/ilgi", { yontem: "POST", veri: { sinyal: "ilgilenmiyorum", icerik_id: "d4" }, bilet: bF });
    const r2 = await istek("/api/oneriler?limit=30", { bilet: bF });
    assert.ok(!idler(r2).includes("d4"), "beğeni varken de ilgilenmiyorum uygulanmalı");
  });

  it("tekrarlı tıklama ağırlığı ŞİŞİRMEZ (tek satır)", async () => {
    await istek("/api/ilgi", { yontem: "POST", veri: { sinyal: "ilgilenmiyorum", icerik_id: "d5" }, bilet: bG });
    await istek("/api/ilgi", { yontem: "POST", veri: { sinyal: "ilgilenmiyorum", icerik_id: "d5" }, bilet: bG });
    const c = db.prepare("SELECT COUNT(*) s FROM ilgi_sinyalleri WHERE kullanici='kG' AND sinyal='ilgilenmiyorum'").get().s;
    assert.strictEqual(c, 1, "aynı sinyal tek satır olmalı (şişme yok)");
    assert.strictEqual(ONERI.durum("kG").sinyal_sayisi, 1);
  });
});

// ======================= HAZIRLIK DURUMU =======================
describe("Hazırlık durumu: dürüst (gerçek vs deneme/mock)", () => {
  it("/api/hazirlik yapısal ve dürüst bilgi döner; sır sızdırmaz", async () => {
    const r = await istek("/api/hazirlik");
    assert.strictEqual(r.kod, 200);
    assert.ok(["kural", "model"].includes(r.veri.ai.mod), "AI modu açıkça belirtilmeli");
    assert.strictEqual(typeof r.veri.video.ffmpeg, "boolean");
    assert.strictEqual(typeof r.veri.video.saglayici_sayisi, "number");
    assert.strictEqual(r.veri.video.saglayici_sayisi, 0, "varsayılan: gerçek çok-kipli sağlayıcı YOK");
    assert.strictEqual(typeof r.veri.ocr.arac, "string");
    assert.ok(r.veri.kutuphane && r.veri.kutuphane.toplam >= 20);
    assert.ok(!/AI_API_KEY|JWT_SECRET|SINAV_KEY/.test(metin(r)), "hazırlık ucu sır sızdırmamalı");
  });
});
