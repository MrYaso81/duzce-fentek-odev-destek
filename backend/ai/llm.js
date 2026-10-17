// Katman 4: LLM sağlayıcı adaptörü (varsayılan KAPALI - anahtar yok)
// Açılınca: denetle() burayı çağırır. Çıktı Zod ile doğrulanır, bozuksa 1 kez yeniden denenir.
// Ücretli olabilir! Canlı test otomatik başlatılmaz. Anahtar yalnız backend'de (.env AI_API_KEY).
const { z } = require("zod"); // çıktı doğrulama
const AYAR = require("./config");

// Model çıktısı: SADECE bu biçim kabul edilir
const LlmSema = z.object({
  kategori: z.enum(["SINAV_SIZINTISI", "CEVAP_ANAHTARI", "KOPYA_YARDIMI", "ZORBALIK_TACIZ", "UYGUNSUZ_ICERIK", "SPAM_REKLAM", "KISISEL_BILGI", "TEMIZ"]),
  risk_skoru: z.number().min(0).max(1), // 0-1 arası
  guven: z.number().min(0).max(1), // 0-1 arası
  gerekce: z.string().max(300), // kısa Türkçe
  kanit_parcalari: z.array(z.string().max(200)).max(5), // en fazla 5 kanıt
  onerilen_aksiyon: z.enum(["yayinla", "incelemeye_al", "engelle"]) // 3 karar
});

function durum() { // dürüst durum: kural mı model mi?
  if (!AYAR.llmAcik) return { mod: "kural", neden: "LLM kapalı (ai/config.js). Kural+benzerlik+OCR çalışıyor." };
  if (!process.env.AI_API_KEY) return { mod: "kural", neden: "AI_API_KEY yok (.env). Kural modunda devam." };
  return { mod: "model", saglayici: process.env.AI_SAGLAYICI || "anthropic", model: process.env.AI_MODEL || "claude-sonnet-4-5" };
}

async function llmSinifla(metin) {
  const d = durum(); // önce durum bak
  if (d.mod !== "model") return null; // kapalıysa null (ağırlık oranlanır)
  const { SISTEM, ORNEKLER } = require("./prompts"); // few-shot'lu talimat
  const ornekMetin = ORNEKLER.map(([m, k]) => `VERİ: ${m}\n${JSON.stringify({ kategori: k })}`).join("\n");
  const govde = { // Anthropic Messages biçimi
    model: d.model, max_tokens: 400,
    system: SISTEM + "\nÖrnekler:\n" + ornekMetin,
    messages: [{ role: "user", content: "<veri>\n" + metin.slice(0, 2000) + "\n</veri>" }] // kullanıcı metni VERİ olarak sarılır (talimat sayılmaz!)
  };
  for (let deneme = 0; deneme < 2; deneme++) { // bozuk yanıtta 1 kez yeniden dene
    const ctrl = new AbortController(); // zaman aşımı (12 sn)
    const sure = setTimeout(() => ctrl.abort(), +(process.env.AI_ZAMANASIMI || 12000));
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-api-key": process.env.AI_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(govde)
      });
      if (!r.ok) { console.error("[LLM] HTTP", r.status); return { hata: true }; } // limit/hata: eksik say (sıfır sanma!)
      const j = await r.json();
      const ham = (j.content || []).map(c => c.text || "").join(""); // metni birleştir
      const bas = ham.indexOf("{"), son = ham.lastIndexOf("}"); // JSON'u ayıkla
      if (bas < 0 || son < 0) continue; // bulunamadı, yeniden dene
      return LlmSema.parse(JSON.parse(ham.slice(bas, son + 1))); // doğrula (bozuksa fırlatır -> yeniden dene)
    } catch (e) { console.error("[LLM]", e.message); } // zaman aşımı/bozuk: yeniden dene ya da bırak
    finally { clearTimeout(sure); } // zamanlayıcı HER yolda temizlenir (açık tutamak kalmaz!)
  }
  return { hata: true }; // 2 denemede olmadı: eksik say (sıfır sanma!)
}
module.exports = { llmSinifla, durum, LlmSema };
