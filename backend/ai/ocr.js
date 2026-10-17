// Katman 3: görsel yazı okuma (Tesseract, Türkçe)
// Sonuç hep {metin, sonuc} biçimindedir: ok|bos|bozuk|zamanasimi|hata
// Boş ile hata AYRI tutulur (dış katman eksik denetimi doğru işler)
let isci = null; // tek işçi (ağır iş, bir kez kurulur)
async function ocrOku(buffer) {
  if (!buffer || !buffer.length) return { metin: "", sonuc: "bos" }; // boş girdi
  try {
    if (!isci) { // ilk kullanımda kur (dil verisi ilk seferde iner)
      const T = require("tesseract.js"); // yoksa catch'e düşer
      isci = await T.createWorker("tur");
    }
    const { data } = await isci.recognize(buffer); // yazıyı çıkar
    const metin = (data.text || "").slice(0, 2000); // ilk 2000 harf yeter
    return metin.trim() ? { metin, sonuc: "ok" } : { metin: "", sonuc: "bos" }; // yazı yoksa bos
  } catch (e) { console.error("[OCR]", e.message); return { metin: "", sonuc: "hata" }; } // servis hatası
}
const OCR_KUYRUK_MAX = +(process.env.OCR_KUYRUK_MAX || 4); // bekleyen iş üst sınırı
const OCR_KULLANICI_MAX = +(process.env.OCR_KULLANICI_MAX || 2); // kullanıcı başına bekleyen üst sınırı
const bekleyenSay = {}; // kullanıcı -> bekleyen iş sayısı (kuyruk adaleti)
let sira = Promise.resolve(); // OCR kuyruğu: işler tek tek girer (karışma yok)
async function ocrSureli(buffer, ms = 8000, kim = "?") { // bitmezse zaman aşımı say (uç takılmasın)
  try {
    gorselDogrula(buffer); // önce imza (bozuksa hemen söyle)
  } catch { return { metin: "", sonuc: "bozuk", eksik: true }; } // bozuk dosya
  const kuyrukUzun = bekleyenSay.__toplam || 0; // toplam bekleyen
  if (kuyrukUzun >= OCR_KUYRUK_MAX) return { metin: "", sonuc: "kuyruk-dolu", eksik: true }; // kuyruk dolu: eksik say
  if ((bekleyenSay[kim] || 0) >= OCR_KULLANICI_MAX) return { metin: "", sonuc: "kuyruk-dolu", eksik: true }; // kullanıcı kotası
  bekleyenSay.__toplam = kuyrukUzun + 1; bekleyenSay[kim] = (bekleyenSay[kim] || 0) + 1; // sayaç
  let birak; // sıra bileti
  const onceki = sira; sira = new Promise(r => birak = r); // kuyruğa gir
  const basla = Date.now(); // toplam süre başlangıcı (kuyruk+kurulum+tanıma)
  try {
    await onceki; // önceki iş bitsin (aynı anda iki iş işçiyi karıştırmaz)
    if (Date.now() - basla > ms) return { metin: "", sonuc: "zamanasimi", eksik: true }; // kuyrukta süre doldu
    if (!isci) { // işçi yoksa kur (dil verisi ilk seferde iner)
      const T = require("tesseract.js"); // yoksa catch'e düşer
      isci = await T.createWorker("tur");
    }
    const kalan = ms - (Date.now() - basla); // kalan süre (toplam sınır!)
    if (kalan <= 0) return { metin: "", sonuc: "zamanasimi", eksik: true }; // süre bitti
    let zamanlayici; // yarış zamanlayıcısı (kazanan kim olursa olsun TEMİZLENİR!)
    const sonuc = await Promise.race([
      isci.recognize(buffer).then(({ data }) => {
        const metin = ((data && data.text) || "").slice(0, 2000); // ilk 2000 harf
        return metin.trim() ? { metin, sonuc: "ok" } : { metin: "", sonuc: "bos" }; // yazı yoksa bos
      }),
      new Promise(r => { zamanlayici = setTimeout(() => r({ metin: "", sonuc: "zamanasimi" }), kalan); }) // kalan sürede bitmezse
    ]);
    clearTimeout(zamanlayici); // açık tutamak bırakma (süreç asılı kalmasın!)
    if (sonuc.sonuc === "zamanasimi" || sonuc.sonuc === "hata") { // zaman aşımı/hata: işçiyi öldürüp yeniden kur (sonraki iş temiz başlar)
      try { await isci.terminate(); } catch { /* geç */ } isci = null;
      return { metin: "", eksik: true, sonuc: sonuc.sonuc }; // eksik denetim
    }
    return { metin: sonuc.metin, eksik: false, sonuc: sonuc.sonuc }; // ok/bos: eksik değil
  } catch (e) { console.error("[OCR]", e.message); return { metin: "", eksik: true, sonuc: "hata" }; } // servis hatası: eksik
  finally { bekleyenSay.__toplam--; bekleyenSay[kim]--; birak(); } // sayaç + sonrakine yol ver (işçi SAHİBİ kuyrukta kalır!)
}
// Dosya imzası doğrulama: uzantıya değil gerçek bayta bak (sahte resim engeli)
function gorselDogrula(buf) { // {tamam} ya da hata fırlatır
  if (!buf || buf.length < 20) throw { kod: 400, mesaj: "Resim bozuk!" };
  if (buf.length > 6 * 1024 * 1024) throw { kod: 400, mesaj: "Resim 6MB üstü!" }; // tek dosya sınırı
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47; // PNG
  const jpg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF; // JPEG
  const gif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46; // GIF
  const webp = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP"; // WEBP
  if (!png && !jpg && !gif && !webp) throw { kod: 400, mesaj: "Yalnız PNG/JPEG/GIF/WEBP yüklenir!" };
  if (png) { // PNG boyutu başlıkta yazar (en/boy > 8000 ise at)
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w > 8000 || h > 8000 || w < 1 || h < 1) throw { kod: 400, mesaj: "Resim boyutu uygun değil!" };
    if (w * h > 25000000) throw { kod: 400, mesaj: "Resim çok büyük (25MP üstü)!" }; // toplam piksel sınırı
  }
  if (gif) { // GIF boyutu 6-10. baytta
    const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8);
    if (w > 8000 || h > 8000 || w < 1 || h < 1) throw { kod: 400, mesaj: "Resim boyutu uygun değil!" };
    if (w * h > 25000000) throw { kod: 400, mesaj: "Resim çok büyük (25MP üstü)!" }; // toplam piksel sınırı
  }
  // Not: JPEG/WEBP boyutu başlıkta karmaşık yerde; bayt sınırı (6MB) + OCR koruması uygulanır.
  return true; // geçti
}
module.exports = { ocrOku, ocrSureli, gorselDogrula, ocrKapat }; // testler bitince işçiyi kapatır!
async function ocrKapat() { // test/sonrası temizlik (açık tutamaç kalmasın!)
  if (isci) { try { await isci.terminate(); } catch { /* geç */ } isci = null; }
}
