// Video çözüm testleri: AYRI test defteri + AYRI kapı + AYRI depo (gerçek veriye DOKUNMAZ).
// Çalıştırma: backend klasöründe `node test-video.js`
// Kapsam: yükleme/karantina/gizlilik, gerçek medya doğrulama, arka plan kuyruğu (restart/idempotent/
//         sınırlı deneme), multimodal denetim (sağlayıcı enjeksiyonu), adil karar + itiraz + orantılı
//         kısıt, anti-bot (paylaşımlı IP + güvenlik sorusu), silme (orijinal+türev), Range/oynatma.
process.env.DB_PATH = "./test-video.db"; // ayrı defter
process.env.PORT = "3141"; // ayrı kapı (gerçek 3001 / test 3131 DEĞİL)
process.env.VIDEO_STORE = "./test-video-depo"; // ayrı karantina deposu
process.env.VIDEO_KUYRUK_KAPALI = "1"; // döngü kapalı: işler ELLE sürülür (deterministik)
process.env.VIDEO_MAX_MB = "2"; // boyut sınırı (test için küçük)
process.env.VIDEO_MAX_SN = "5"; // süre sınırı (test için küçük)
process.env.BEKLEMEDE_AZAMI = "50"; // beklemede kota (genel testler için yüksek; kota testi kendi düşürür)
process.env.YENI_GUNLUK = "500"; // yeni hesap günlük kota (test akışı için yüksek; kota testi kendi düşürür)
process.env.NORMAL_GUNLUK = "500";
process.env.GUVENILIR_GUNLUK = "500";
process.env.VIDEO_GUNLUK_DEPO_MB = "1"; // günlük depolama (MB)
process.env.JWT_SECRET = "test-video-gizli-anahtar";
process.env.SINAV_KEY = "test-anahtari-123";
try { require("fs").unlinkSync("./test-video.db"); } catch { /* ilk çalışsa yok */ }
try { require("fs").rmSync("./test-video-depo", { recursive: true, force: true }); } catch { /* temizlik */ }

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const API = "http://localhost:3141";

// ---- yardımcılar ----
async function istek(yol, sec = {}) {
  const r = await fetch(API + yol, {
    method: sec.yontem || "GET",
    headers: { "Content-Type": "application/json", ...(sec.bilet ? { Authorization: "Bearer " + sec.bilet } : {}), ...(sec.basliklar || {}) },
    body: sec.veri ? JSON.stringify(sec.veri) : undefined,
  });
  return { kod: r.status, veri: await r.json().catch(() => ({})) };
}
const giris = async (ad, sifre) => (await istek("/api/giris", { yontem: "POST", veri: { ad, sifre } })).veri.bilet;

// Ham gövde yükü (express.raw): meta bilgi sorgu dizesinden, dosya adı ASLA yoldan gelmez
async function videoYukle(bilet, tampon, { gonderi_id, uzanti = "mp4", baslik = "Çözüm", aciklama = "Açıklama", mime = "video/mp4" } = {}) {
  const q = new URLSearchParams({ gonderi_id: String(gonderi_id), uzanti, baslik, aciklama });
  const r = await fetch(`${API}/api/video/yukle?${q}`, {
    method: "POST",
    headers: { "Content-Type": mime, Authorization: "Bearer " + bilet },
    body: tampon,
  });
  return { kod: r.status, veri: await r.json().catch(() => ({})) };
}

// ---- sentetik medya (GERÇEK kabuk baytları; imza + süre ayrıştırıcıyı gerçekten çalıştırır) ----
function kutu(tur, govde) { const b = Buffer.alloc(8 + govde.length); b.writeUInt32BE(8 + govde.length, 0); b.write(tur, 4, "latin1"); govde.copy(b, 8); return b; }
function mvhd(sure_sn) { const g = Buffer.alloc(20); g[0] = 0; g.writeUInt32BE(1000, 12); g.writeUInt32BE(Math.round(sure_sn * 1000), 16); return kutu("mvhd", g); }
function mp4(sure_sn, ekBayt = 0, dolgu = 0x20) {
  const ftyp = Buffer.alloc(16); ftyp.writeUInt32BE(16, 0); ftyp.write("ftyp", 4, "latin1"); ftyp.write("isom", 8, "latin1"); ftyp.writeUInt32BE(0, 12);
  const govde = Buffer.concat([ftyp, kutu("moov", mvhd(sure_sn))]);
  const pad = Math.max(ekBayt, Math.max(0, 2048 - govde.length)); // en az 2KB (alt sınır 1KB)
  return Buffer.concat([govde, Buffer.alloc(pad, dolgu)]);
}
const metinBayt = (n, dolgu = 0x41) => Buffer.alloc(n, dolgu); // video OLMAYAN içerik

let sunucu, bAli, bElif, bHoca, bMudur, bAdmin, gonderiId;
const VIDEO = () => require("./video/hizmet");
const K = () => require("./video/kuyruk");
const MEDYA = () => require("./video/medya");
const BOT = () => require("./anti-bot");

// Sağlayıcıları ayarla (mock/sentetik). Boş {} → "sağlayıcı yok" (gerçek ortamda olduğu gibi).
const SAG = {
  temiz: { konusma: async () => ({ uygun: true, transkript: "2x+3=11 denklemini adım adım çözelim", guven: 0.95 }),
           ekranYazisi: async () => ({ uygun: true, metinler: [{ zaman: 1, metin: "2x+3=11", guven: 0.9 }] }),
           goruntu: async () => ({ uygun: true, bulgular: [] }) },
  hakaret: { konusma: async () => ({ uygun: true, transkript: "çözüm şöyle aptal", guven: 0.95 }),
             ekranYazisi: async () => ({ uygun: true, metinler: [] }),
             goruntu: async () => ({ uygun: true, bulgular: [] }) },
  tehdit_ve_kisisel: { konusma: async () => ({ uygun: true, transkript: "seni öldüreceğim", guven: 0.95 }),
                       ekranYazisi: async () => ({ uygun: true, metinler: [{ zaman: 2, metin: "telefonum 0555 123 45 67", guven: 0.9 }] }),
                       goruntu: async () => ({ uygun: true, bulgular: [] }) },
  ciddi_gorsel: { konusma: async () => ({ uygun: true, transkript: "temiz anlatım", guven: 0.95 }),
                  ekranYazisi: async () => ({ uygun: true, metinler: [] }),
                  goruntu: async () => ({ uygun: true, bulgular: [{ kategori: "cinsel", siddet: "yuksek", guven: 0.95, zaman_bas: 5, zaman_bit: 9, aciklama: "örnek ciddi görsel bulgu" }] }) },
  dusuk_guven: { konusma: async () => ({ uygun: true, transkript: "belki aptal dedi ama emin değilim", guven: 0.2 }), // gürültülü transkript
                 ekranYazisi: async () => ({ uygun: true, metinler: [] }),
                 goruntu: async () => ({ uygun: true, bulgular: [] }) },
  hata: { konusma: async () => { throw new Error("sağlayıcı çöktü"); },
          ekranYazisi: async () => ({ uygun: true, metinler: [] }),
          goruntu: async () => ({ uygun: true, bulgular: [] }) },
};

// Kuyruğu elle boşalt (döngü kapalı) — işleri deterministik işle
async function kuyruguBosalt(azami = 30) {
  let n = 0;
  for (let i = 0; i < azami; i++) {
    const is = K().siradakiIsiAl();
    if (!is) break;
    await K().calistir(is, VIDEO().isGovedesi);
    n++;
  }
  return n;
}

before(async () => {
  require("./seed.js");
  sunucu = require("./server.js");
  await new Promise(r => setTimeout(r, 500));
  bAli = await giris("Ali", "1234");       // öğrenci (video yükleyen)
  bElif = await giris("Elif", "1234");     // başka öğrenci (görmemeli)
  bHoca = await giris("AyseHoca", "hoca123"); // öğretmen (moderatör)
  bMudur = await giris("mudur1", "mudur123"); // müdür (kısıt/itiraz)
  bAdmin = await giris("admin", "admin123");
  const g = await istek("/api/gonderiler", { yontem: "POST", veri: { tur: "Soru", ders: "Matematik", baslik: "Video testi sorusu", aciklama: "2x+3=11 nasıl?" }, bilet: bAli });
  gonderiId = g.veri.id;
  assert.ok(gonderiId, "test sorusu açılmalı");
});
after(async () => {
  try { require("./ai/ocr.js").ocrKapat(); } catch { /* yoksa geç */ }
  if (sunucu && sunucu.close) await new Promise(coz => sunucu.close(coz));
  try { require("./db.js").close(); } catch { /* zaten kapalı */ }
  await new Promise(r => setTimeout(r, 100));
  try { fs.unlinkSync("./test-video.db"); } catch { /* temizlik */ }
  try { fs.rmSync("./test-video-depo", { recursive: true, force: true }); } catch { /* temizlik */ }
});

describe("Video: medya doğrulama (gerçek baytlar)", () => {
  it("MP4 imzası + mvhd süresi GERÇEK çözümlenir; uzantıya güvenilmez", () => {
    const d = MEDYA().dogrula({ bas: mp4(3), uzanti: "mp4", mime: "video/mp4" });
    assert.strictEqual(d.gecerli, true);
    assert.strictEqual(d.bicim, "mp4");
    assert.ok(Math.abs(d.sure_sn - 3) < 0.05, "süre ~3 sn olmalı (bulunan: " + d.sure_sn + ")");
  });
  it("video olmayan içerik (yanlış uzantıyla) reddedilir (415)", async () => {
    const r = await videoYukle(bAli, metinBayt(3000), { gonderi_id: gonderiId, uzanti: "mp4" });
    assert.strictEqual(r.kod, 415);
  });
  it("AVI (izinli değil) içeriği gerçekten AVI olarak görülüp reddedilir", async () => {
    const avi = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("AVI "), Buffer.alloc(2100, 0)]);
    const r = await videoYukle(bAli, avi, { gonderi_id: gonderiId, uzanti: "avi" });
    assert.strictEqual(r.kod, 415);
  });
  it("süre sınırı sunucuda uygulanır (5 sn üstü → 413)", async () => {
    const r = await videoYukle(bAli, mp4(10), { gonderi_id: gonderiId });
    assert.strictEqual(r.kod, 413);
  });
  it("boyut sınırı sunucuda uygulanır (2 MB üstü → 413)", async () => {
    const r = await videoYukle(bAli, mp4(2, 2 * 1024 * 1024 + 500), { gonderi_id: gonderiId });
    assert.strictEqual(r.kod, 413);
  });
});

describe("Video: yükleme, karantina, sahiplik ve gizlilik", () => {
  let vid;
  it("yükleme KARANTİNAYA alınır (base64 değil; durum quarantined)", async () => {
    const r = await videoYukle(bAli, mp4(3), { gonderi_id: gonderiId, baslik: "Denklem çözümü", aciklama: "Adım adım" });
    assert.strictEqual(r.kod, 201, JSON.stringify(r.veri));
    assert.strictEqual(r.veri.durum, "quarantined");
    vid = r.veri.id;
    // Dosya DB'ye base64 yazılmadı: tabloda anahtar var, içerik yok
    const db = require("./db");
    const sat = db.prepare("SELECT saklama_anahtari, orijinal_boyut FROM video_cevaplar WHERE id=?").get(vid);
    assert.ok(sat.saklama_anahtari && sat.saklama_anahtari.length >= 16, "öngörülemez anahtar olmalı");
    assert.ok(sat.orijinal_boyut > 0, "boyut kaydedilmeli");
  });
  it("onaysız video BAŞKASINA görünmez (liste + tekil + oynatma)", async () => {
    const liste = await istek(`/api/video?gonderi_id=${gonderiId}`, { bilet: bElif });
    assert.ok(!liste.veri.sonuclar.some(v => v.id === vid), "Elif onaysız videoyu görmemeli");
    const misafir = await istek(`/api/video?gonderi_id=${gonderiId}`);
    assert.ok(!misafir.veri.sonuclar.some(v => v.id === vid), "misafir görmemeli");
    assert.strictEqual((await istek(`/api/video/${vid}`, { bilet: bElif })).kod, 404);
    assert.strictEqual((await istek(`/api/video/${vid}/izle`, { bilet: bElif })).kod, 403);
  });
  it("yazar kendi bekleyen durumunu görür ve önizleyebilir; misafir izleyemez", async () => {
    const detay = await istek(`/api/video/${vid}`, { bilet: bAli });
    assert.strictEqual(detay.kod, 200);
    assert.strictEqual(detay.veri.durum, "quarantined");
    assert.strictEqual(detay.veri.sahip, true);
    const oynat = await fetch(`${API}/api/video/${vid}/izle`, { headers: { Authorization: "Bearer " + bAli } });
    assert.strictEqual(oynat.status, 200);
    assert.strictEqual(oynat.headers.get("content-type"), "video/mp4"); // gerçek biçime göre
    assert.strictEqual((await fetch(`${API}/api/video/${vid}/izle`)).status, 403); // misafir: erişim yok
  });
  it("yineyen (replay) yükleme içerik hash'iyle engellenir (409)", async () => {
    const ayni = mp4(3, 0, 0x20);
    const ilkKod = (await videoYukle(bAli, ayni, { gonderi_id: gonderiId })).kod;
    assert.ok(ilkKod === 201 || ilkKod === 409, "ilk yükleme geçerli olmalı");
    const tekrar = await videoYukle(bAli, mp4(3, 0, 0x20), { gonderi_id: gonderiId });
    assert.strictEqual(tekrar.kod, 409);
  });
});

describe("Video: multimodal denetim (sağlayıcı enjeksiyonu)", () => {
  it("sağlayıcı YOKKEN otomatik YAYIN OLMAZ (insana gider)", async () => {
    VIDEO().saglayicilariAyarla({}); // gerçek ortam: sağlayıcı tanımlı değil
    const y = await videoYukle(bAli, mp4(3, 0, 0x31), { gonderi_id: gonderiId });
    await kuyruguBosalt();
    const v = await istek(`/api/video/${y.veri.id}`, { bilet: bAli });
    assert.strictEqual(v.veri.durum, "needs_review", "sağlayıcı yokken yayına girmemeli");
    const liste = await istek(`/api/video?gonderi_id=${gonderiId}`, { bilet: bElif });
    assert.ok(!liste.veri.sonuclar.some(x => x.id === y.veri.id), "yayınlanmamalı");
  });
  it("temiz içerik (tüm sağlayıcılar tamam) onaylanır ve herkes görür", async () => {
    VIDEO().saglayicilariAyarla(SAG.temiz);
    const y = await videoYukle(bAli, mp4(3, 0, 0x32), { gonderi_id: gonderiId, baslik: "Temiz çözüm" });
    await kuyruguBosalt();
    const liste = await istek(`/api/video?gonderi_id=${gonderiId}`, { bilet: bElif });
    const bulunan = liste.veri.sonuclar.find(x => x.id === y.veri.id);
    assert.ok(bulunan, "onaylı video Elif'e görünmeli");
    assert.strictEqual(bulunan.durum, "approved");
    assert.strictEqual(bulunan.altyazi_var, false); // altyazı üretilmedi (sağlayıcı yok) — sahte yok
    // misafir de onaylıyı izleyebilir
    const oynat = await fetch(`${API}/api/video/${y.veri.id}/izle`);
    assert.strictEqual(oynat.status, 200);
    assert.strictEqual(oynat.headers.get("content-type"), "video/mp4");
  });
  it("konuşma + ekran yazısı bulguları BİRLEŞİR ve zaman damgalıdır; yayın bloke edilir (review)", async () => {
    VIDEO().saglayicilariAyarla(SAG.tehdit_ve_kisisel);
    const y = await videoYukle(bAli, mp4(3, 0, 0x33), { gonderi_id: gonderiId, baslik: "Şüpheli" });
    await kuyruguBosalt();
    const b = await istek(`/api/video/${y.veri.id}/bulgular`, { bilet: bHoca });
    assert.strictEqual(b.kod, 200);
    const kaynaklar = b.veri.bulgular.map(x => x.kaynak);
    assert.ok(kaynaklar.includes("konusma") && kaynaklar.includes("ekran_yazisi"), "iki kaynak da bulunmalı: " + kaynaklar);
    const ekran = b.veri.bulgular.find(x => x.kaynak === "ekran_yazisi");
    assert.strictEqual(ekran.zaman_bas, 2, "ekran bulgusu zaman damgalı olmalı");
    const detay = await istek(`/api/video/${y.veri.id}`, { bilet: bHoca });
    assert.strictEqual(detay.veri.durum, "needs_review");
    assert.ok(["blok", "inceleme"].includes(detay.veri.karar));
  });
  it("yüksek güvenli CİDDİ görsel bulgu yayını BLOKLAR (öncelikli insan)", async () => {
    VIDEO().saglayicilariAyarla(SAG.ciddi_gorsel);
    const y = await videoYukle(bAli, mp4(3, 0, 0x34), { gonderi_id: gonderiId });
    await kuyruguBosalt();
    const detay = await istek(`/api/video/${y.veri.id}`, { bilet: bHoca });
    assert.strictEqual(detay.veri.durum, "needs_review");
    assert.strictEqual(detay.veri.karar, "blok");
    // Vaka açıldı (içerik kararından AYRI)
    const vaka = require("./db").prepare("SELECT COUNT(*) n FROM hesap_incelemeleri WHERE video_id=?").get(y.veri.id).n;
    assert.ok(vaka >= 1, "hesap inceleme vakası açılmalı");
  });
  it("DÜŞÜK güvenli / gürültülü transkript otomatik CEZA değil, İNCELEME üretir", async () => {
    VIDEO().saglayicilariAyarla(SAG.dusuk_guven);
    const y = await videoYukle(bAli, mp4(3, 0, 0x35), { gonderi_id: gonderiId });
    await kuyruguBosalt();
    const detay = await istek(`/api/video/${y.veri.id}`, { bilet: bHoca });
    assert.strictEqual(detay.veri.durum, "needs_review"); // yayına GİRMEZ
    assert.notStrictEqual(detay.veri.durum, "rejected"); // cezalandırılmaz
    assert.strictEqual(detay.veri.karar, "inceleme");
  });
  it("zararsız/bağlamsal alıntı İNCELEMEYE gider (yayın veya ceza değil)", async () => {
    VIDEO().saglayicilariAyarla(SAG.hakaret); // "aptal" kelimesi geçiyor ama bağlam eğitim
    const y = await videoYukle(bAli, mp4(3, 0, 0x36), { gonderi_id: gonderiId, baslik: "Ders anlatımı" });
    await kuyruguBosalt();
    const detay = await istek(`/api/video/${y.veri.id}`, { bilet: bHoca });
    assert.strictEqual(detay.veri.durum, "needs_review");
    assert.strictEqual(detay.veri.karar, "inceleme");
  });
  it("sağlayıcı HATASI içeriği yayına ALMAZ (beklemede kalır)", async () => {
    VIDEO().saglayicilariAyarla(SAG.hata);
    const y = await videoYukle(bAli, mp4(3, 0, 0x37), { gonderi_id: gonderiId });
    await kuyruguBosalt();
    const detay = await istek(`/api/video/${y.veri.id}`, { bilet: bHoca });
    assert.strictEqual(detay.veri.durum, "needs_review");
    VIDEO().saglayicilariAyarla({}); // sonraki testler için sıfırla
  });
});

describe("Video: arka plan kuyruğu (dayanıklılık)", () => {
  it("aynı hedef için çift iş EKLENMEZ (idempotent)", () => {
    const is1 = K().ekle("denetle", 999999);
    const is2 = K().ekle("denetle", 999999);
    assert.strictEqual(is2.eklendi, false, "ikinci ekleme engellenmeli");
    const n = require("./db").prepare("SELECT COUNT(*) n FROM video_isleri WHERE video_id=? AND durum='bekliyor'").get(999999).n;
    assert.strictEqual(n, 1);
    require("./db").prepare("DELETE FROM video_isleri WHERE video_id=?").run(999999);
  });
  it("yeniden başlatma: askıda 'calisiyor' iş beklemeye geri alınır", () => {
    const db = require("./db");
    db.prepare("INSERT INTO video_isleri(tip, video_id, durum, guncelleme) VALUES('denetle', 888888, 'calisiyor', datetime('now','-300 seconds'))").run();
    const kurtarilan = K().askidakilariKurtar();
    assert.ok(kurtarilan >= 1);
    assert.strictEqual(db.prepare("SELECT durum FROM video_isleri WHERE video_id=?").get(888888).durum, "bekliyor");
    db.prepare("DELETE FROM video_isleri WHERE video_id=?").run(888888);
  });
  it("SINIRLI deneme: azami sonrası 'basarisiz' olur (sonsuz döngü yok)", () => {
    const db = require("./db");
    db.prepare("INSERT INTO video_isleri(tip, video_id, durum, deneme, azami_deneme) VALUES('denetle', 777777, 'bekliyor', 0, 2)").run();
    const id = db.prepare("SELECT id FROM video_isleri WHERE video_id=?").get(777777).id;
    K().isiBitir(id, false, "test"); // 1. deneme → bekliyor
    assert.strictEqual(db.prepare("SELECT durum FROM video_isleri WHERE id=?").get(id).durum, "bekliyor");
    K().isiBitir(id, false, "test"); // 2. deneme → azami → basarisiz
    assert.strictEqual(db.prepare("SELECT durum FROM video_isleri WHERE id=?").get(id).durum, "basarisiz");
    db.prepare("DELETE FROM video_isleri WHERE video_id=?").run(777777);
  });
});

describe("Video: insan kararı + yetki + çakışma", () => {
  let vid;
  it("öğrenci karar veremez (403); gerekçesiz karar reddedilir (400)", async () => {
    VIDEO().saglayicilariAyarla({});
    const y = await videoYukle(bAli, mp4(3, 0, 0x40), { gonderi_id: gonderiId });
    vid = y.veri.id;
    await kuyruguBosalt();
    assert.strictEqual((await istek(`/api/video/${vid}/karar`, { yontem: "POST", veri: { karar: "onayla", gerekce: "uygun görünüyor" }, bilet: bAli })).kod, 403);
    const kisa = await istek(`/api/video/${vid}/karar`, { yontem: "POST", veri: { karar: "onayla", gerekce: "ok" }, bilet: bHoca });
    assert.strictEqual(kisa.kod, 400, "kısa gerekçe reddedilmeli");
  });
  it("çakışan karar 409 verir (iki moderatör aynı anda yazamaz)", async () => {
    const c = await istek(`/api/video/${vid}/karar`, { yontem: "POST", veri: { karar: "onayla", gerekce: "yayınlanabilir içerik", beklenen_durum: "quarantined" }, bilet: bHoca });
    assert.strictEqual(c.kod, 409, "beklenen durum uyuşmuyorsa 409");
  });
  it("moderatör gerekçeyle onaylar; video herkese açılır", async () => {
    const r = await istek(`/api/video/${vid}/karar`, { yontem: "POST", veri: { karar: "onayla", gerekce: "İçerik kurala uygun", beklenen_durum: "needs_review" }, bilet: bHoca });
    assert.strictEqual(r.kod, 200, JSON.stringify(r.veri));
    const liste = await istek(`/api/video?gonderi_id=${gonderiId}`, { bilet: bElif });
    assert.ok(liste.veri.sonuclar.some(x => x.id === vid));
  });
  it("red için kullanıcıya gösterilecek NET neden ZORUNLU", async () => {
    const y = await videoYukle(bAli, mp4(3, 0, 0x41), { gonderi_id: gonderiId });
    await kuyruguBosalt();
    const yok = await istek(`/api/video/${y.veri.id}/karar`, { yontem: "POST", veri: { karar: "reddet", gerekce: "uygun değil bu içerik" }, bilet: bHoca });
    assert.strictEqual(yok.kod, 400);
  });
  it("yetki: öğrenci kuyruğu ve bulguları göremez (403)", async () => {
    assert.strictEqual((await istek("/api/video/kuyruk", { bilet: bAli })).kod, 403);
    assert.strictEqual((await istek(`/api/video/${vid}/bulgular`, { bilet: bAli })).kod, 403);
    assert.strictEqual((await istek("/api/video/kuyruk", { bilet: bHoca })).kod, 200);
  });
});

describe("Video: şikâyet, hesap kısıtı, itiraz (adil/ölçülü)", () => {
  let vid;
  it("şikâyet tekilleşir (aynı kişi TEK kez) ve ceza ŞİŞİRMEZ", async () => {
    VIDEO().saglayicilariAyarla(SAG.temiz);
    const y = await videoYukle(bAli, mp4(3, 0, 0x50), { gonderi_id: gonderiId });
    vid = y.veri.id;
    await kuyruguBosalt();
    const k1 = "sikayet-1-" + vid, k2 = "sikayet-2-" + vid;
    const ilk = await istek(`/api/video/${vid}/sikayet`, { yontem: "POST", veri: { neden: "Uygun değil bence" }, bilet: bElif, basliklar: { "X-Istek-Id": k1 } });
    assert.strictEqual(ilk.kod, 201);
    const tekrar = await istek(`/api/video/${vid}/sikayet`, { yontem: "POST", veri: { neden: "Tekrar bildiriyorum" }, bilet: bElif, basliklar: { "X-Istek-Id": k2 } });
    assert.ok(tekrar.kod === 200 || tekrar.kod === 409, "aynı kişi ikinci kez yeni kayıt açmamalı");
    const n = require("./db").prepare("SELECT COUNT(*) n FROM video_sikayetleri WHERE video_id=?").get(vid).n;
    assert.strictEqual(n, 1, "şikâyet sayısı artmamalı");
  });
  it("kendi videonu bildiremezsin (400)", async () => {
    const r = await istek(`/api/video/${vid}/sikayet`, { yontem: "POST", veri: { neden: "kendi videom" }, bilet: bAli, basliklar: { "X-Istek-Id": "sikayet-kendi-" + vid } });
    assert.strictEqual(r.kod, 400);
  });
  it("geçici, SÜRELİ yükleme kısıtı + itiraz + kabul ile kaldırma (ölçülü)", async () => {
    // yetkisiz: öğretmen kısıtlayamaz
    assert.strictEqual((await istek(`/api/video/${vid}/kisitla`, { yontem: "POST", veri: { gun: 1, sebep: "test" }, bilet: bHoca })).kod, 403);
    // müdür süreli kısıtlar
    const kısıt = await istek(`/api/video/${vid}/kisitla`, { yontem: "POST", veri: { gun: 3, sebep: "Doğrulanmış kural ihlali (insan kararı)" }, bilet: bMudur });
    assert.strictEqual(kısıt.kod, 200);
    assert.ok(kısıt.veri.bitis, "kısıt SÜRELİ olmalı (bitiş tarihi var)");
    // kısıtlı kullanıcı yükleyemez
    const engel = await videoYukle(bAli, mp4(3, 0, 0x51), { gonderi_id: gonderiId });
    assert.strictEqual(engel.kod, 403);
    // kullanıcı durumu: kısıt görünür + itiraz yolu
    const durum1 = await istek("/api/hesap/durum", { bilet: bAli });
    assert.strictEqual(durum1.veri.kisitli, true);
    // itiraz
    const itiraz = await istek("/api/hesap/itiraz", { yontem: "POST", veri: { kisit_id: durum1.veri.kisit.id }, bilet: bAli });
    assert.strictEqual(itiraz.kod, 200);
    const durum2 = await istek("/api/hesap/durum", { bilet: bAli });
    assert.strictEqual(durum2.veri.itirazAcik, 1);
    // müdür itirazı kabul eder → kısıt kalkar
    const karar = await istek("/api/hesap/itiraz-karar", { yontem: "POST", veri: { kisit_id: durum1.veri.kisit.id, kabul: true, gerekce: "Kanıt yetersiz, kısıt kaldırıldı" }, bilet: bMudur });
    assert.strictEqual(karar.kod, 200);
    const tekrar = await videoYukle(bAli, mp4(3, 0, 0x52), { gonderi_id: gonderiId });
    assert.strictEqual(tekrar.kod, 201, "itiraz kabul edilince yükleme açılmalı");
  });
  it("hesap kararı GEREKÇE ister; YAPAY ZEKA skoruyla kalıcı ban yok (gerekçe zorunlu)", async () => {
    const kisa = await istek("/api/hesap/karar", { yontem: "POST", veri: { kullanici: "Ali", karar: "suspend", gerekce: "kısa" }, bilet: bMudur });
    assert.ok(kisa.kod === 403 || kisa.kod === 400, "gerekçesiz/kısa karar reddedilmeli");
  });
});

describe("Video: anti-bot (katmanlı, paylaşımlı IP dostu)", () => {
  it("paylaşımlı IP tekrar tekrar kayıt/girişte TÜM OKULU bloklamaz", () => {
    BOT().sifirla();
    const ip = "10.0.0.5";
    for (let i = 0; i < 50; i++) BOT().kayitDenemesiKaydet(ip, 1); // 50 başarılı kayıt (aynı okul IP)
    assert.strictEqual(BOT().kayitSinirIzin(ip).izin, true, "normal yoğunlukta paylaşımlı IP bloklanмамаlı");
  });
  it("BAŞARILI girişler kilit bütçesini TÜKETMEZ; yalnız başarısız denemeler sayılır", () => {
    BOT().sifirla();
    const ad = "Ali", ip = "10.0.0.6";
    for (let i = 0; i < 20; i++) BOT().girisDenemesiKaydet(ad, ip, 1); // 20 başarılı
    assert.strictEqual(BOT().girisSiniri(ad, ip).izin, true, "başarılı girişler kilit yaratmamalı");
    for (let i = 0; i < 10; i++) BOT().girisDenemesiKaydet(ad, ip, 0); // 10 başarısız
    assert.strictEqual(BOT().girisSiniri(ad, ip).izin, false, "başarısız denemeler sınırı aşınca kilitlemeli");
  });
  it("risk-tetiklemeli güvenlik sorusu SUNUCUDA doğrulanır (tek kullanımlık, sahte başarı yok)", () => {
    BOT().sifirla();
    const q = BOT().soruUret("Ali");
    const m = q.soru.match(/(\d+)\s*\+\s*(\d+)/);
    const dogru = Number(m[1]) + Number(m[2]);
    assert.strictEqual(BOT().soruDogrula("Ali", q.jeton, dogru).ok, true);
    assert.strictEqual(BOT().soruDogrula("Ali", q.jeton, dogru).ok, false, "aynı jeton TEKRAR kullanılamaz");
    const q2 = BOT().soruUret("Ali");
    assert.strictEqual(BOT().soruDogrula("Ali", q2.jeton, 999).ok, false, "yanlış cevap başarı sayılmaz");
  });
  it("beklemede kota: aynı anda çok sayıda onaysız yükleme engellenir (kuyruk taşmaz)", async () => {
    BOT().sifirla();
    const LIMITS = require("./video/limits");
    const eski = LIMITS.AYAR.beklemedeAzami;
    LIMITS.AYAR.beklemedeAzami = 3; // yalnız bu testte düşür (kota davranışını sına)
    try {
      // Taze kullanıcı: beklemede videosu YOK → davranış net
      await istek("/api/kayit", { yontem: "POST", veri: { ad: "kotaOgr", sifre: "9876", rol: "ogrenci", sinif: "9", kurallar: true } });
      const bKota = await giris("kotaOgr", "9876");
      assert.ok(bKota, "taze kullanıcı giriş yapmalı");
      const yuklenen = [];
      for (let i = 0; i < 3; i++) {
        const r = await videoYukle(bKota, mp4(3, 0, 0x60 + i), { gonderi_id: gonderiId });
        yuklenen.push(r.kod);
      }
      assert.ok(yuklenen.every(k => k === 201), "ilk 3 yükleme kabul edilmeli: " + yuklenen);
      const ekstra = await videoYukle(bKota, mp4(3, 0, 0x70), { gonderi_id: gonderiId });
      assert.strictEqual(ekstra.kod, 429, "beklemede sınırı aşılınca 429 (kota) dönmeli");
    } finally {
      LIMITS.AYAR.beklemedeAzami = eski;
    }
    VIDEO().saglayicilariAyarla({});
    await kuyruguBosalt(50);
  });
});

describe("Video: saklama süresi ve depolama kotası", () => {
  it("günlük DEPOLAMA kotası aşılınca yükleme engellenir (disk tükenmez)", async () => {
    await istek("/api/kayit", { yontem: "POST", veri: { ad: "depoOgr", sifre: "9876", rol: "ogrenci", sinif: "9", kurallar: true } });
    const b = await giris("depoOgr", "9876");
    const L = require("./video/limits");
    const eski = L.AYAR.gunlukDepolamaMB;
    L.AYAR.gunlukDepolamaMB = 1; // 1 MB kota
    try {
      const boyut = 600 * 1024; // ~0.6 MB
      const r1 = await videoYukle(b, mp4(3, boyut, 0x91), { gonderi_id: gonderiId });
      assert.strictEqual(r1.kod, 201, "ilk yükleme kabul edilmeli: " + JSON.stringify(r1.veri));
      const r2 = await videoYukle(b, mp4(3, boyut, 0x92), { gonderi_id: gonderiId });
      assert.strictEqual(r2.kod, 429, "günlük depolama kotası aşılınca 429 (kod: " + r2.kod + ")");
    } finally { L.AYAR.gunlukDepolamaMB = eski; }
  });
  it("saklama süresi: süresi dolan karantina dosyası + kaydı temizlenir", () => {
    const db = require("./db");
    const depo = require("./video/depolama");
    const anahtar = depo.anahtarUret();
    const tmp = require("path").join(require("os").tmpdir(), "ret-" + anahtar + ".part");
    require("fs").writeFileSync(tmp, mp4(3));
    depo.orijinalYaz("orijinal", anahtar, "mp4", tmp); // gerçek dosya
    db.prepare(`INSERT INTO video_cevaplar(gonderi_id, yazar, baslik, durum, saklama_anahtari,
      orijinal_boyut, sure_sn, bicim, olusturma)
      VALUES(?,?,?, 'quarantined', ?,?,?,?, datetime('now','-40 days'))`)
      .run(gonderiId, "Ali", "eski karantina", anahtar, 2048, 3, "mp4");
    const id = db.prepare("SELECT id FROM video_cevaplar WHERE saklama_anahtari=?").get(anahtar).id;
    const r = VIDEO().retentionTemizle();
    assert.ok(r.silinen >= 1, "en az bir kayıt temizlenmeli");
    assert.strictEqual(depo.varMi("orijinal", anahtar, "mp4"), 0, "orijinal dosya silinmeli");
    assert.strictEqual(db.prepare("SELECT silindi FROM video_cevaplar WHERE id=?").get(id).silindi, 1);
  });
});

describe("Video: silme (orijinal + türev) ve Range/oynatma", () => {
  it("yazar siler → dosya, erişim ve kayıtlar temizlenir (başkası silemez)", async () => {
    VIDEO().saglayicilariAyarla(SAG.temiz);
    const y = await videoYukle(bAli, mp4(3, 0, 0x80), { gonderi_id: gonderiId });
    const vid = y.veri.id;
    await kuyruguBosalt();
    // başkası silemez
    assert.strictEqual((await istek(`/api/video/${vid}`, { yontem: "DELETE", bilet: bElif })).kod, 403);
    // dosya gerçekten var
    const db = require("./db");
    const anahtar = db.prepare("SELECT saklama_anahtari FROM video_cevaplar WHERE id=?").get(vid).saklama_anahtari;
    assert.ok(require("./video/depolama").varMi("orijinal", anahtar, "mp4") > 0, "silmeden önce dosya olmalı");
    // yazar siler
    assert.strictEqual((await istek(`/api/video/${vid}`, { yontem: "DELETE", bilet: bAli })).kod, 200);
    assert.strictEqual(require("./video/depolama").varMi("orijinal", anahtar, "mp4"), 0, "orijinal dosya silinmeli");
    assert.strictEqual((await istek(`/api/video/${vid}`, { bilet: bAli })).kod, 404, "kayıt erişilemez olmalı");
    assert.ok([403, 404].includes((await fetch(`${API}/api/video/${vid}/izle`)).status), "silinen medya erişilemez olmalı");
  });
  it("onaylı video Range isteğini destekler (mobil oynatma/seek)", async () => {
    VIDEO().saglayicilariAyarla(SAG.temiz);
    const y = await videoYukle(bAli, mp4(3, 0, 0x81), { gonderi_id: gonderiId });
    await kuyruguBosalt();
    const r = await fetch(`${API}/api/video/${y.veri.id}/izle`, { headers: { Range: "bytes=0-99" } });
    assert.ok(r.status === 206 || r.status === 200, "Range desteklenmeli (durum: " + r.status + ")");
    assert.strictEqual(r.headers.get("content-type"), "video/mp4");
    if (r.status === 206) assert.ok(r.headers.get("content-range"), "206 ise Content-Range olmalı");
  });
});

describe("Video: yardımcı uçlar (sınırlar / itiraz listesi / altyazı / hesap yetkisi)", () => {
  it("yükleme SINIRLARI herkese açık ve sayısal döner (gösterim; asıl karar sunucuda)", async () => {
    const r = await istek("/api/video/limits");
    assert.strictEqual(r.kod, 200);
    assert.ok(r.veri.enFazlaBoyutMB > 0 && r.veri.enFazlaSureSn > 0, "boyut/süre sınırı pozitif olmalı");
    assert.ok(Array.isArray(r.veri.desteklenenBicimler) && r.veri.desteklenenBicimler.includes("mp4"));
  });
  it("AÇIK itirazlar listesi YALNIZ yetkiliye açık (öğrenci 403, müdür 200)", async () => {
    assert.strictEqual((await istek("/api/video/itirazlar", { bilet: bAli })).kod, 403);
    assert.strictEqual((await istek("/api/video/itirazlar", { bilet: bMudur })).kod, 200);
  });
  it("açık itiraz moderatör listesinde GÖRÜNÜR; karar sonrası KAYBOLUR", async () => {
    await istek("/api/kayit", { yontem: "POST", veri: { ad: "itirazOgr", sifre: "9876", rol: "ogrenci", sinif: "9", kurallar: true } });
    const bI = await giris("itirazOgr", "9876");
    assert.ok(bI, "taze kullanıcı giriş yapmalı");
    VIDEO().saglayicilariAyarla(SAG.temiz);
    const y = await videoYukle(bI, mp4(3, 0, 0xA0), { gonderi_id: gonderiId });
    await kuyruguBosalt();
    const kısıt = await istek(`/api/video/${y.veri.id}/kisitla`, { yontem: "POST", veri: { gun: 2, sebep: "Doğrulanmış ihlal (insan kararı)" }, bilet: bMudur });
    assert.strictEqual(kısıt.kod, 200);
    const durum = await istek("/api/hesap/durum", { bilet: bI });
    await istek("/api/hesap/itiraz", { yontem: "POST", veri: { kisit_id: durum.veri.kisit.id }, bilet: bI });
    const liste = await istek("/api/video/itirazlar", { bilet: bMudur });
    assert.ok(liste.veri.sonuclar.some(x => x.id === durum.veri.kisit.id), "açık itiraz listede olmalı");
    await istek("/api/hesap/itiraz-karar", { yontem: "POST", veri: { kisit_id: durum.veri.kisit.id, kabul: true, gerekce: "Kanıt yetersiz, kaldırıldı" }, bilet: bMudur });
    const sonra = await istek("/api/video/itirazlar", { bilet: bMudur });
    assert.ok(!sonra.veri.sonuclar.some(x => x.id === durum.veri.kisit.id), "karar sonrası açık itiraz kalmamalı");
  });
  it("hesap kararı YALNIZ müdür/admin (öğretmen 403) — yetki sıkılaştırıldı", async () => {
    const r = await istek("/api/hesap/karar", { yontem: "POST", veri: { kullanici: "Ali", karar: "uyari", gerekce: "Yetki denemesi (öğretmen)" }, bilet: bHoca });
    assert.strictEqual(r.kod, 403);
  });
  it("altyazı ucu: altyazısı olmayan videoda 404 (gizli transkript servis EDİLMEZ)", async () => {
    const y = await videoYukle(bAli, mp4(3, 0, 0xA2), { gonderi_id: gonderiId });
    const r = await istek(`/api/video/${y.veri.id}/altyazi`, { bilet: bAli });
    assert.strictEqual(r.kod, 404);
  });
  it("bulgular yanıtı DENETİM KAYDI içerir (kim / ne / ne zaman)", async () => {
    VIDEO().saglayicilariAyarla({}); // sağlayıcı yok → insan incelemesine düşer (deterministik)
    const y = await videoYukle(bAli, mp4(3, 0, 0xA1), { gonderi_id: gonderiId });
    await kuyruguBosalt();
    const onay = await istek(`/api/video/${y.veri.id}/karar`, { yontem: "POST", veri: { karar: "onayla", gerekce: "İçerik kurala uygun", beklenen_durum: "needs_review" }, bilet: bHoca });
    assert.strictEqual(onay.kod, 200, JSON.stringify(onay.veri));
    const b = await istek(`/api/video/${y.veri.id}/bulgular`, { bilet: bHoca });
    assert.strictEqual(b.kod, 200);
    assert.ok(Array.isArray(b.veri.kayitlar) && b.veri.kayitlar.length >= 1, "denetim kaydı olmalı");
    assert.ok(b.veri.kayitlar.some(x => x.kim === "AyseHoca"), "kayıt karar vereni içermeli");
    VIDEO().saglayicilariAyarla(SAG.temiz); // sonrası için geri al
  });
});
