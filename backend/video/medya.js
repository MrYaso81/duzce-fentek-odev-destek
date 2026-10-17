// Video medya DOĞRULAMASI — uzantı/MIME'a GÜVENİLMEZ, baytlar okunur.
// NOT (dürüstlük): Bu ortamda ffmpeg/ffprobe YOK. Süre, saf JS ile MP4/MOV/WebM
// kabuk yapılarından GERÇEK olarak çözümlenir. Kare çıkarma/ölçekleme/gerçek
// konuşma tanıma YOK → bunlar medyaAraci() üzerinden çalıştırılır ve araç yoksa
// "bilinmiyor" döner (asla uydurulmaz). Bilinmeyen süre otomatik YAYINA girmez.
const crypto = require("crypto");
const { AYAR } = require("./limits");

const IZINLI_EXT = new Set(AYAR.desteklenenBicimler);

// --- bayt başlığından GERÇEK biçim tespiti ---
function bicimTespit(buf) {
  if (!buf || buf.length < 12) return "";
  // ISO-BMFF (MP4/M4V/MOV): 4 bayt boyut + "ftyp"
  if (buf.slice(4, 8).toString("latin1") === "ftyp") {
    const marka = buf.slice(8, 12).toString("latin1");
    if (marka === "qt  ") return "mov";
    return "mp4"; // isom, mp42, avc1, M4V, iso2 vb. → mp4 ailesi
  }
  // WebM/Matroska: EBML başlığı
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
  // AVI (allowlist dışı, reddetmek için tespit edilir)
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "AVI ") return "avi";
  // MPEG-TS (genelde .ts/.m2t) — allowlist dışı
  if (buf[0] === 0x47) return "ts";
  return "";
}

// --- MP4/MOV: moov içindeki mvhd'dan süre (sn) ---
function mp4Sure(buf) {
  const mvhd = buf.indexOf("mvhd");
  if (mvhd < 0) return 0;
  let p = mvhd + 4; // "mvhd" sonrası
  const versiyon = buf[p];
  try {
    if (versiyon === 1) {
      const timescale = buf.readUInt32BE(p + 20);
      const sureUst = buf.readUInt32BE(p + 24) * 4294967296 + buf.readUInt32BE(p + 28); // 64-bit süre
      if (!timescale) return 0;
      return sureUst / timescale;
    }
    const timescale = buf.readUInt32BE(p + 12);
    const sure = buf.readUInt32BE(p + 16);
    if (!timescale) return 0;
    return sure / timescale;
  } catch { return 0; }
}

// --- WebM/MKV (EBML): Segment>Info>Duration (TimecodeScale ile) ---
// EBML VINT uzunluğu: ilk baytın baştaki sıfır sayısı + 1 (işaret biti ID'nin parçasıdır)
function vintUzunluk(ilk, azami) {
  for (let i = 0; i < azami; i++) if (ilk & (0x80 >> i)) return i + 1;
  return 0; // geçersiz
}
function ebmlId(buf, p) { // değişken uzunluklu ID (1..4 bayt; 0x1A45DFA3 gibi 4 baytlıklar dahil)
  const n = vintUzunluk(buf[p], 4);
  if (!n || p + n > buf.length) return { id: 0, n: 0 };
  let id = 0;
  for (let i = 0; i < n; i++) id = (id * 256) + buf[p + i];
  return { id, n };
}
function ebmlBoyut(buf, p) { // değişken uzunluklu boyut (U-INT)
  const ilk = buf[p]; let uzun = 1;
  for (let i = 0; i < 8; i++) { if (ilk & (0x80 >> i)) { uzun = i + 1; break; } }
  let boyut = 0;
  for (let i = 0; i < uzun; i++) boyut = (boyut << 8) | (buf[p + i] & (i === 0 ? (0xff >> uzun) : 0xff));
  return { boyut, uzun };
}
function webmSure(buf) {
  // Segment (0x18538067) → Info (0x1549A966) içinde TimecodeScale + Duration tara
  const son = Math.min(buf.length, 2 * 1024 * 1024); // tarama tavanı
  let p = 0, zamanBolunen = 1000000, sureBirim = 0;
  while (p < son) {
    const { id, n: nid } = ebmlId(buf, p); if (!nid) break;
    const { boyut, uzun: nb } = ebmlBoyut(buf, p + nid); if (!nb) break;
    const govde = p + nid + nb;
    if (id === 0x1549A966) { // Info
      let q = govde;
      while (q < govde + boyut && q < son) {
        const i2 = ebmlId(buf, q); if (!i2.n) break;
        const b2 = ebmlBoyut(buf, q + i2.n); if (!b2.n) break;
        const g2 = q + i2.n + b2.boyut;
        if (i2.id === 0x2AD7B1 && b2.boyut <= 8) { // TimecodeScale
          let v = 0; for (let k = 0; k < b2.boyut; k++) v = (v << 8) | buf[g2 + k];
          zamanBolunen = v || zamanBolunen;
        }
        if (i2.id === 0x4489) { // Duration (float)
          if (b2.boyut === 4) sureBirim = buf.readFloatBE(g2);
          else if (b2.boyut === 8) sureBirim = buf.readDoubleBE(g2);
        }
        q = g2 + b2.boyut;
      }
      break;
    }
    p = govde + boyut;
  }
  if (!sureBirim || !zamanBolunen) return 0;
  return (sureBirim * zamanBolunen) / 1e9; // TimecodeScale nanosaniye → sn
}

// Başlıkta (ilk N bayt) süre dener; moov/Segment başta DEĞİLSE süre bilinmez (0)
function sureCoz(buf, bicim) {
  if (bicim === "mp4" || bicim === "mov") return mp4Sure(buf);
  if (bicim === "webm") return webmSure(buf);
  return 0;
}

// ffmpeg var mı? (varsa kapak/kare çıkarma/gerçek tanıma mümkün; yoksa dürüstçe "yok")
function medyaAraci() {
  try {
    const { spawnSync } = require("child_process");
    const r = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { windowsHide: true, timeout: 3000 });
    return r.status === 0; // gerçek araç yoksa asla iddia etme
  } catch { return false; }
}

// Kapsamlı doğrulama: { gecerli, bicim, sure_sn, sure_bilinmiyor, hatalar[] }
function dogrula({ bas, uzanti, mime }) {
  const hatalar = [];
  if (!bas || bas.length < AYAR.enAzBoyutBayt) hatalar.push("Dosya çok küçük ya da boş.");
  const uz = String(uzanti || "").toLowerCase().replace(/^\./, "");
  if (!IZINLI_EXT.has(uz)) hatalar.push("Desteklenmeyen uzantı. İzinli: " + [...IZINLI_EXT].join(", ") + ".");
  const bicim = bicimTespit(bas); // GERÇEK bayt tespiti
  if (!bicim) hatalar.push("Dosya içeriği tanınmadı (gerçek video formatı değil).");
  else if (!IZINLI_EXT.has(bicim)) hatalar.push("Dosyanın gerçek içeriği " + bicim + " — bu biçim desteklenmiyor.");
  // MIME yalnızca kayıt: asla tek başına güvenilmez
  let sure = 0, bilinmiyor = false;
  if (bicim) { sure = sureCoz(bas, bicim); if (!sure || sure <= 0) bilinmiyor = true; }
  return { gecerli: hatalar.length === 0, bicim, sure_sn: sure, sure_bilinmiyor: bilinmiyor, mime_beyan: String(mime || ""), hatalar };
}

// Gerçek içerik hash'i (yinelenen/yeniden yükleme koruması)
function icerikHash(bas) { return crypto.createHash("sha256").update(bas).digest("hex"); }

module.exports = { bicimTespit, sureCoz, dogrula, icerikHash, medyaAraci };
