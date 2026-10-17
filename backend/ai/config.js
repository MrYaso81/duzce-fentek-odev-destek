// AI denetçi ayarları: eşikler ve ağırlıklar buradan değişir (kod değiştirmeden)
module.exports = {
  esik: { yayinla: 0.30, engelle: 0.80 }, // skor<0.30 yayınla, 0.30-0.80 inceleme, >0.80 engelle
  agirlik: { kural: 0.45, havuz: 0.35, llm: 0.20 }, // katman ağırlıkları (llm kapalıysa kalanlar oranlanır)
  hassas: { SINAV_SIZINTISI: 0.15, CEVAP_ANAHTARI: 0.20 }, // bu kategorilerde eşiği düşür (daha hassas)
  tekrarCeza: 0.05, // aynı kullanıcının her eski vakası +0.05 (en fazla +0.20)
  llmAcik: false, // LLM kapalı (API anahtarı yok); açılınca ağırlığı devreye girer
  slaSaat: 24, // müdür yardımcısı karar süresi (saat)
  // --- Eğitim asistanı (RAG) ayarları: MODERASYONDAN AYRIDIR (ayrı anahtar bloğu) ---
  asistan: {
    ragAcik: true,      // onaylı kütüphaneden getirim açık mı
    ragLimit: 5,        // en fazla kaç içerik getirilir
    ragEsik: 0.20,      // bu skorun altındaki getirim "kanıt" sayılmaz (uydurma atıf olmaz)
    ipucuOnce: true,    // tam cevap yerine ipucu/adım öncelikli
    etiket: "deneme"    // üretilen yanıtın görünür modu (deneme|gercek)
  }
};
