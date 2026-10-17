// Video moderasyon BORU HATTI — konuşma + ekran yazısı (OCR) + görsel + başlık/açıklama.
//
// DÜRÜSTLÜK SINIRLARI (rapora da yazılır):
//  - Bu ortamda GERÇEK Türkçe konuşma tanıma, OCR ve görsel DENETİM MODELİ ÇALIŞMAZ
//    (ffmpeg/ffprobe yok, internet yok, tesseract dil verisi yok). Bu modül SAĞLAYICI
//    tabanlıdır: sağlayıcı tanımlı DEĞİLSE ilgili inceleme "yapılamadı" döner ve video
//    OTOMATİK YAYINA GİRMEZ — insana gider. Uydurma bulgu ÜRETİLMEZ.
//  - Kare örneklemesi ve otomatik transkriptin KISA OLAYLARI KAÇIRABİLECEĞİ kabul edilir;
//    "kusursuz tespit" İDDİA EDİLMEZ.
//  - Anahtar kelime / düşük güvenli transkript CİDDİ İHLALİN KANITI DEĞİLDİR → her zaman
//    insana gider; tek başına ceza üretmez.
//  - Yüz/etniklik/duygu TESPİTİ ve yüz tanıma YOKTUR ve eklenmez.
const { AYAR } = require("./limits");

const KATEGORILER = ["hakaret", "tehdit", "nefret", "cinsel", "siddet", "kisisel_bilgi", "diger"];
const ACIL_KATEGORI = "tehdit"; // güvenilir, yakın tehdit → acil insan bildirimi

// Naif, AÇIKÇA yer tutucu metin denetçisi (yalnız TEST/sentetik fixture için deterministik).
// Anahtar kelime EŞLEŞMESİ asla otomatik ceza üretmez; güveni bilinçli olarak düşüktür
// ve hep "insana inceleme" bandına düşer (bkz. kararVer).
const NAIF_KELIMELER = {
  hakaret: ["aptal", "salak", "gerizekalı"],
  tehdit: ["öldüreceğim", "tehdit", "sana değer"],
  nefret: ["ırkçı-söz", "aşağılık ırk"],
  cinsel: ["cinsel-saic"],
  siddet: ["dövücem", "vuracam"],
  kisisel_bilgi: ["0555", "telefonum", "ev adresim"],
};
function naifMetinDenetci(metin, kaynak, zaman = 0) {
  const m = String(metin || "").toLocaleLowerCase("tr-TR");
  const bulgular = [];
  for (const [kat, kelimeler] of Object.entries(NAIF_KELIMELER)) {
    if (kelimeler.some(k => m.includes(k))) {
      bulgular.push({ kaynak, kategori: kat, siddet: "orta", guven: 0.55, zaman_bas: zaman, zaman_bit: zaman, aciklama: "Metinde şüpheli ifade eşleşmesi (naif denetçi).", kaynak_guven: 1 });
    }
  }
  return bulgular;
}

// Zaman damgalı bulgu üretici
function bulguYap(b) {
  return { kaynak: b.kaynak || "diger", kategori: b.kategori || "diger", siddet: b.siddet || "dusuk",
    guven: Math.max(0, Math.min(1, Number(b.guven) || 0)), zaman_bas: Number(b.zaman_bas) || 0,
    zaman_bit: Number(b.zaman_bit) || 0, aciklama: String(b.aciklama || "").slice(0, 400),
    kaynak_guven: b.kaynak_guven == null ? 1 : Math.max(0, Math.min(1, Number(b.kaynak_guven))) };
}

// Gerekli incelemeler: gerçek video izleme/dinleme → bunlar olmadan YAYIN YOK
const GEREKLI = ["konusma", "goruntu"];

// Tek boru hattı: video kaydı + bağlam + (isteğe bağlı) SAĞLAYICILAR
// saglayicilar: { konusma, ekranYazisi, goruntu } — her biri async fn ya da yok.
// Varsayılan (sağlayıcı yok) → ilgili inceleme "yapılamadı"; video yayına girmez.
async function denetle(video, baglam = {}, saglayicilar = {}) {
  const bulgular = [];
  const saglayiciRapor = {}; // her sağlayıcının dürüst durumu
  let transkript = "", transkriptGuven = 1;

  // 1) BAŞLIK + AÇIKLAMA (her zaman çalışır; saf metin)
  const baslikMetin = `${video.baslik || ""} ${video.aciklama || ""}`;
  for (const b of naifMetinDenetci(baslikMetin, "baslik_aciklama", 0)) bulgular.push(bulguYap(b));

  // 2) KONUŞMA (transkript) — sağlayıcı gereklidir
  const kons = saglayicilar.konusma;
  if (typeof kons === "function") {
    try {
      const r = await kons(video, baglam);
      if (r && r.uygun) { transkript = String(r.transkript || ""); transkriptGuven = r.guven == null ? 1 : Number(r.guven);
        for (const b of naifMetinDenetci(transkript, "konusma", 0)) bulgular.push(bulguYap({ ...b, kaynak_guven: transkriptGuven })); }
      else saglayiciRapor.konusma = (r && r.sebep) || "yapılamadı";
    } catch (e) { saglayiciRapor.konusma = "hata"; }
  } else saglayiciRapor.konusma = "sağlayıcı tanımlı değil";

  // 3) EKRAN YAZISI (OCR) — sağlayıcı gereklidir (isteğe bağlı ama varsa kullanılır)
  const ocr = saglayicilar.ekranYazisi;
  if (typeof ocr === "function") {
    try {
      const r = await ocr(video, baglam);
      if (r && r.uygun) for (const m of (r.metinler || [])) for (const b of naifMetinDenetci(m.metin, "ekran_yazisi", m.zaman)) bulgular.push(bulguYap({ ...b, zaman_bas: m.zaman, zaman_bit: m.zaman, kaynak_guven: m.guven == null ? 1 : m.guven }));
      else saglayiciRapor.ekranYazisi = (r && r.sebep) || "yapılamadı";
    } catch { saglayiciRapor.ekranYazisi = "hata"; }
  } else saglayiciRapor.ekranYazisi = "sağlayıcı tanımlı değil";

  // 4) GÖRSEL denetim — sağlayıcı gereklidir (güçlü sinyal; yüksek güvenli ciddi bulgu üretebilir)
  const gor = saglayicilar.goruntu;
  if (typeof gor === "function") {
    try {
      const r = await gor(video, baglam);
      if (r && r.uygun) for (const b of (r.bulgular || [])) bulgular.push(bulguYap({ ...b, kaynak: "goruntu" }));
      else saglayiciRapor.goruntu = (r && r.sebep) || "yapılamadı";
    } catch { saglayiciRapor.goruntu = "hata"; }
  } else saglayiciRapor.goruntu = "sağlayıcı tanımlı değil";

  // Gerekli incelemelerden herhangi biri yapılamadıysa YAYIN YOK
  const eksik = GEREKLI.filter(k => saglayiciRapor[k]);
  const karar = kararVer(bulgular, { eksik });
  return { bulgular, transkript, transkriptGuven, saglayiciRapor, eksik, ...karar };
}

// Bağlam-duyarlı karar verme (içerik kararı; hesap cezası AYRI modülde)
function kararVer(bulgular, { eksik = [] } = {}) {
  // "Kaydadeğer" bulgu: güven eşiği üstü VE (konuşma ise) transkript güveni yeterli
  const kaydadeger = bulgular.filter(b =>
    b.guven >= AYAR.insanIncelemesiEsik && b.kaynak_guven >= 0.5 &&
    KATEGORILER.includes(b.kategori));
  const siddetli = kaydadeger.filter(b => b.siddet === "yuksek" && b.guven >= AYAR.siddetliEsik);
  const acilTehdit = kaydadeger.some(b => b.kategori === ACIL_KATEGORI && b.siddet === "yuksek" && b.guven >= AYAR.siddetliEsik);

  if (eksik.length) { // otomatik inceleme TAMAMLANAMADI → asla sessizce yayına alma
    return { durum: "needs_review", karar: "", onem: acilTehdit ? 1 : 0,
      gerekce: "Otomatik inceleme tamamlanamadı (" + eksik.join(", ") + "). Video herkese açılmadı; insan incelemesine gönderildi." };
  }
  if (acilTehdit) {
    return { durum: "needs_review", karar: "blok", onem: 1,
      gerekce: "Güvenilir ve yakın tehdit sinyali: yayın bloklandı, yetkiliye ÖNCELİKLİ iletildi (insan kararı gerekir)." };
  }
  if (siddetli.length) {
    const k = siddetli[0];
    return { durum: "needs_review", karar: "blok", onem: 1,
      gerekce: `Yüksek güvenli ciddi bulgu (${k.kategori}, ${k.kaynak}): yayın bloklandı, öncelikli insan incelemesi.` };
  }
  if (kaydadeger.length) {
    const k = kaydadeger[0];
    return { durum: "needs_review", karar: "inceleme", onem: 0,
      gerekce: `Bağlamsal/belirsiz bulgu (${k.kategori}, güven ${(k.guven).toFixed(2)}): video gizli kaldı, insan incelemesine gönderildi.` };
  }
  // Düşük GÜVENLİ sinyal: otomatik ceza DEĞİL, otomatik YAYIN DA DEĞİL → insan incelemesi
  // (düşük güven tek başına ciddi ihmal KANITI değildir; yine de göz ardı edilmez)
  const DUSUK_ESIK = 0.15; // bundan altı gürültü sayılır
  // NOT: buraya yalnızca "kaydadeger" OLMAYAN sinyaller ulaştı (yukarıda kısaca ele alındı).
  // Bu yüzden hem düşük "guven" hem de düşük "kaynak_guven" (gürültülü/güvensiz transkript)
  // vakaları buraya DÜŞER — yani gürültülü transkript asla doğrudan yayına SIZMAZ.
  const zayif = bulgular.filter(b => b.guven >= DUSUK_ESIK && KATEGORILER.includes(b.kategori));
  if (zayif.length) {
    const k = zayif[0];
    return { durum: "needs_review", karar: "inceleme", onem: 0,
      gerekce: `Düşük güvenli sinyal (${k.kategori}, güven ${(k.guven).toFixed(2)}): kanıt yetersiz, otomatik yayın YAPILMADI; insan incelemesi.` };
  }
  // Kaydadeğer bulgu yok → YALNIZCA tüm zorunlu incelemeler tamamsa yayınla
  return { durum: "approved", karar: "onaylandi", onem: 0,
    gerekce: "Zorunlu otomatik incelemeler tamamlandı; kaydadeğer ihlal sinyali bulunmadı." };
}

module.exports = { denetle, kararVer, bulguYap, naifMetinDenetci, KATEGORILER, GEREKLI };
