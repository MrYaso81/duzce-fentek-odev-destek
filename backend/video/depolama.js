// Özel (karantina) depolama — öngörülemez anahtarlar, sahiplik DB'den, URL tahmini YOK.
// GÜVENLİK: Dosya adları ASLA kullanıcıdan gelmez; her dosya bizim ürettiğimiz
// rastgele anahtarla saklanır. Yol birleştirmede ".."/ayraç enjeksiyonu imkânsızdır.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { AYAR } = require("./limits");

const KOK = path.resolve(process.env.VIDEO_STORE || path.join(__dirname, "..", "video-depo"));
const KLASOR = { orijinal: "orijinal", kapak: "kapak", altyazi: "altyazi", gecici: "gecici" };

function klasorHazirla() {
  for (const k of Object.values(KLASOR)) {
    const d = path.join(KOK, k);
    fs.mkdirSync(d, { recursive: true, mode: 0o700 }); // yalnız sahip erişimi (POSIX)
  }
}

// Öngörülemez anahtar üret (24 rastgele bayt → base64url, tahmin edilemez)
function anahtarUret() { return crypto.randomBytes(24).toString("base64url"); }

// Anahtar + tür → güvenli tam yol (anahtar biçimini de doğrular; traversal imkânsız)
function yolBul(tur, anahtar, ext) {
  if (!KLASOR[tur]) throw new Error("Geçersiz tür");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(anahtar || ""))) throw new Error("Geçersiz anahtar"); // tahmin/bozulma koruması
  const e = ext ? String(ext).toLowerCase().replace(/[^a-z0-9]/g, "") : ""; // yalnız güvenli uzantı
  const dosya = e ? `${anahtar}.${e}` : anahtar;
  return path.join(KOK, KLASOR[tur], dosya);
}

// Orijinali karantinaya yaz (geçici dosyadan güvenle taşır; boyut sınırı burada da korunur)
function orijinalYaz(tur, anahtar, ext, kaynakTmp) {
  const hedef = yolBul(tur, anahtar, ext);
  const boyut = fs.statSync(kaynakTmp).size;
  if (boyut > AYAR.enFazlaBoyutMB * 1024 * 1024) { try { fs.unlinkSync(kaynakTmp); } catch {} throw new Error("Boyut sınırı aşıldı"); }
  fs.renameSync(kaynakTmp, hedef); // atomik taşıma (aynı birimde)
  return hedef;
}

// Dosya var mı + gerçek boyut
function varMi(tur, anahtar, ext) { try { return fs.statSync(yolBul(tur, anahtar, ext)).size; } catch { return 0; } }

// Oku (yalnız erişim denetiminden GEÇEN rotalarda çağrılır)
function oku(tur, anahtar, ext) { return fs.readFileSync(yolBul(tur, anahtar, ext)); }

// Silme: orijinal + tüm türevler (kapak/altyazı/geçici) birlikte gider
function sil(anahtar, ext) {
  let silinen = 0;
  for (const t of ["orijinal", "kapak", "altyazi", "gecici"]) {
    const p = yolBul(t, anahtar, t === "orijinal" || t === "kapak" ? ext : null);
    try { fs.unlinkSync(p); silinen++; } catch { /* yoksa geç */ }
  }
  return silinen;
}

// Gerçek MIME (tespit edilen biçime göre; istemci beyanına GÜVENİLMEZ)
function gercekMime(bicim) {
  return ({ mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" })[bicim] || "application/octet-stream";
}

module.exports = { KOK, klasorHazirla, anahtarUret, yolBul, orijinalYaz, varMi, oku, sil, gercekMime };
