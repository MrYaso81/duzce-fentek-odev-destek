// AI denetçi hattı: kural + havuz + (kapalı LLM) -> tek karar
// Çıktı: {kategori, risk_skoru, guven, gerekce, kanit_parcalari, onerilen_aksiyon}
// Fail-safe: hata olursa "incelemeye_al" (otomatik yayınlama!)
const { kuralTara } = require("../config/etik"); // Katman 1
const { benzerlik } = require("./benzerlik"); // Katman 2
const { llmSinifla } = require("./llm"); // Katman 4 (kapalı)
const AYAR = require("./config");

async function denetle(metin, sec = {}) { // sec: {db, yazar, havuzlar, gorselMetin}
  try {
    const tam = (metin || "") + "\n" + (sec.gorselMetin || ""); // yazı + resimden çıkan yazı birlikte
    const bulgular = kuralTara(tam); // Katman 1: kurallar
    let kSkor = 0, kKat = "TEMIZ", kanit = []; // en ağır bulgu
    for (const b of bulgular) { kanit.push(b.parca); if (b.agirlik > kSkor) { kSkor = b.agirlik; kKat = b.kategori; } }
    let hSkor = 0, hKat = "TEMIZ"; // Katman 2: havuz benzerliği
    const havuz = sec.havuzlar && sec.havuzlar.liste ? sec.havuzlar : { liste: sec.havuzlar || [], eksik: false }; // yeni + eski çağrı biçimi
    for (const h of havuz.liste) {
      const s = Math.max(benzerlik(metin, h.metin), sec.gorselMetin ? benzerlik(sec.gorselMetin, h.metin) : 0); // yazı + görsel ayrı bak
      if (s > hSkor) { hSkor = s; hKat = "SINAV_SIZINTISI"; kanit.push("havuz benzerliği %" + Math.round(s * 100)); }
    }
    if (hSkor > 0.55) { kSkor = Math.max(kSkor, 0.9); kKat = "SINAV_SIZINTISI"; } // eşik üstü = yüksek risk
    else if (hSkor > 0.35) { kSkor = Math.max(kSkor, 0.5); if (kKat === "TEMIZ") kKat = "SINAV_SIZINTISI"; }
    let lSkor = 0, lKat = "TEMIZ", modelEksik = false; // Katman 4: LLM (kapalıysa atlanır)
    if (AYAR.llmAcik) {
      const l = await llmSinifla(metin); // null=kapalı, {hata}=başarısız, nesne=sonuç
      if (l && !l.hata) { lSkor = l.risk_skoru; lKat = l.kategori; kanit.push(...(l.kanit_parcalari || [])); }
      else if (l && l.hata) modelEksik = true; // model çöktü: sıfır sayma, eksik işaretle!
    }
    const topA = AYAR.agirlik.kural + AYAR.agirlik.havuz + (AYAR.llmAcik ? AYAR.agirlik.llm : 0); // açık ağırlık toplamı
    let skor = (kSkor * AYAR.agirlik.kural + hSkor * AYAR.agirlik.havuz + (AYAR.llmAcik ? lSkor * AYAR.agirlik.llm : 0)) / topA; // ağırlıklı birleşim
    let kat = kKat !== "TEMIZ" ? kKat : (hSkor > 0.3 ? hKat : (AYAR.llmAcik && lKat !== "TEMIZ" ? lKat : "TEMIZ"));
    if (sec.db && sec.yazar) { // tekrar ihlali: yalnız İNSAN onaylı kaldırmalar sayılır (bekleyen/yanlış alarm sayılmaz!)
      const sayi = sec.db.prepare("SELECT COUNT(*) AS s FROM vakalar WHERE yazar=? AND durum='kaldirildi'").get(sec.yazar).s;
      skor = Math.min(1, skor + Math.min(0.20, sayi * AYAR.tekrarCeza)); // en fazla +0.20
    }
    const esikDus = AYAR.hassas[kat] ?? 0; // hassas kategoride eşiği düşür
    const yayinla = AYAR.esik.yayinla - esikDus, engelle = AYAR.esik.engelle - esikDus;
    let aksiyon = skor < yayinla ? "yayinla" : skor > engelle ? "engelle" : "incelemeye_al"; // karar
    if (havuz.eksik && aksiyon === "yayinla") { aksiyon = "incelemeye_al"; kanit.push("havuz okunamadı (eksik denetim)"); } // eksik denetimde otomatik yayınlama!
    if (modelEksik && aksiyon === "yayinla") { aksiyon = "incelemeye_al"; kanit.push("model hatası (eksik denetim)"); } // model çöktü: sıfır sayılmadı, incelemeye alındı
    const guven = Math.min(1, 0.5 + Math.abs(skor - 0.5)); // DİKKAT: kalibre edilmemiş yakınlık ölçüsü, doğruluk olasılığı DEĞİLDİR (bkz. README)
    const gerekce = kat === "TEMIZ" ? "Kural ve havuz eşleşmesi yok." : kat + " şüphesi (" + kanit.slice(0, 2).join("; ") + ").";
    return { kategori: kat, risk_skoru: +skor.toFixed(2), guven: +guven.toFixed(2), kalibre: false, gerekce, kanit_parcalari: kanit.slice(0, 3), onerilen_aksiyon: aksiyon };
  } catch (e) { // AI çökerse güvenli mod: yayınlama, incelemeye al
    console.error("[AI]", e.message);
    return { kategori: "TEMIZ", risk_skoru: 0.5, guven: 0.3, kalibre: false, gerekce: "Denetim hatası, güvenli mod.", kanit_parcalari: [], onerilen_aksiyon: "incelemeye_al" };
  }
}
module.exports = { denetle }; // uçlar kullanır
