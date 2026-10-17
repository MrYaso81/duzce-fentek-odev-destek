// Gizli Sınav Havuzu: öğretmenler yapılmamış sınav sorularını yükler
// Güvenlik: metin AES-256 ile şifreli saklanır, öğrenciler göremez.
// Yedek anahtar YOK: SINAV_KEY eksikse havuz özellikleri güvenli biçimde kapanır.
const crypto = require("crypto"); // Node'un kendi şifre kutusu
function anahtarlar() { // [güncel, ...eskiler] (anahtar değişiminde eski veriler okunabilsin)
  const liste = [];
  if (process.env.SINAV_KEY) liste.push(process.env.SINAV_KEY);
  if (process.env.SINAV_KEY_ESKI) liste.push(...process.env.SINAV_KEY_ESKI.split(",").map(s => s.trim()).filter(Boolean));
  return liste;
}
function havuzAcik() { return anahtarlar().length > 0; } // anahtar var mı
function anahtarTuret(ham) { // 32 bayta indir
  return crypto.createHash("sha256").update(ham).digest();
}
function sifrele(metin) { // AES-256-GCM ile kilitle (güncel anahtar, key_no=1)
  if (!havuzAcik()) throw { kod: 503, mesaj: "Sınav havuzu yapılandırılmamış (SINAV_KEY eksik). Yöneticine söyle." };
  const iv = crypto.randomBytes(12); // tek kullanımlık sayı
  const sif = crypto.createCipheriv("aes-256-gcm", anahtarTuret(anahtarlar()[0]), iv);
  const veri = Buffer.concat([sif.update(metin, "utf8"), sif.final()]); // şifrele
  return { veri: veri.toString("base64"), iv: iv.toString("base64"), etiket: sif.getAuthTag().toString("base64"), key_no: 1 }; // saklanacaklar
}
function metinHash(metin) { // hızlı ön eleme için SHA-256 (sadeleşmiş metinden)
  const { sadelestir } = require("../config/etik");
  return crypto.createHash("sha256").update(sadelestir(metin)).digest("hex");
}
function coz(veri, iv, etiket, key_no) { // şifreyi aç (önce güncel, sonra eski anahtarlar)
  const sonHata = [];
  for (const ham of anahtarlar()) {
    try {
      const c = crypto.createDecipheriv("aes-256-gcm", anahtarTuret(ham), Buffer.from(iv, "base64"));
      c.setAuthTag(Buffer.from(etiket, "base64"));
      return Buffer.concat([c.update(Buffer.from(veri, "base64")), c.final()]).toString("utf8");
    } catch (e) { sonHata.push(e.message); } // sonraki anahtarı dene
  }
  throw new Error("Havuz çözülemedi (anahtar uyuşmuyor): " + (sonHata[0] || "")); // hepsi başarısız
}
function havuzMetinleri(db) { // tüm havuzu aç: [{id, ders, metin}] (az sayıda, sorun değil)
  if (!havuzAcik()) return { liste: [], eksik: true }; // anahtar yok: eksik denetim (sessiz geçme!)
  try {
    const liste = db.prepare("SELECT id, ders, veri_sifreli, iv, etiket, key_no FROM sinav_havuzu").all()
      .map(r => ({ id: r.id, ders: r.ders, metin: coz(r.veri_sifreli, r.iv, r.etiket, r.key_no) }));
    return { liste, eksik: false };
  } catch (e) { console.error("[HAVUZ]", e.message); return { liste: [], eksik: true }; } // çözülmezse eksik say
}
module.exports = { sifrele, metinHash, havuzMetinleri, havuzAcik }; // havuz uçları + hat kullanır
