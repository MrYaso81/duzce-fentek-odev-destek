// AI ölçüm: `npm run eval` — her kategori precision/recall/F1 + karışıklık + hedef kontrolü
// Hedefler: SINAV_SIZINTISI ve CEVAP_ANAHTARI recall ≥ %95, TEMIZ yanlış alarm (FP) ≤ %3
const fs = require("fs"); // dosya okuma
const { denetle } = require("../ai/denetle"); // gerçek hat (LLM kapalı haliyle)

const ornekler = JSON.parse(fs.readFileSync(__dirname + "/ornekler.json", "utf-8")); // 300 örnek
const KATS = ["SINAV_SIZINTISI", "CEVAP_ANAHTARI", "KOPYA_YARDIMI", "ZORBALIK_TACIZ", "UYGUNSUZ_ICERIK", "SPAM_REKLAM", "KISISEL_BILGI", "TEMIZ"];

(async () => {
  const matris = {}; // gerçek -> tahmin sayacı
  KATS.forEach(g => { matris[g] = {}; KATS.forEach(t => matris[g][t] = 0); });
  const fpOrnek = []; // yanlış alarmlar (TEMIZ olup kirli sanılanlar)
  for (const o of ornekler) {
    const d = await denetle(o.metin, {}); // havuzsuz, tekrarsız (saf sınıflandırıcı)
    const tahmin = d.onerilen_aksiyon === "yayinla" ? "TEMIZ" : d.kategori; // yayınlanan = temiz
    matris[o.etiket][tahmin]++;
    if (o.etiket === "TEMIZ" && tahmin !== "TEMIZ") fpOrnek.push({ metin: o.metin, tahmin }); // FP kaydı
  }
  console.log("kategori | sayı | precision | recall | F1"); // başlık
  let ok = true; // hedefler tuttu mu
  for (const kat of KATS) {
    const tp = matris[kat][kat]; // doğru yakalanan
    const gercekTop = KATS.reduce((a, t) => a + matris[kat][t], 0); // gerçek sayısı
    const tahminTop = KATS.reduce((a, g) => a + matris[g][kat], 0); // tahmin sayısı
    const precision = tahminTop ? tp / tahminTop : 1; // doğruluk
    const recall = gercekTop ? tp / gercekTop : 1; // yakalama
    const f1 = (precision + recall) ? 2 * precision * recall / (precision + recall) : 0; // dengeli
    console.log(`${kat} | ${gercekTop} | %${(precision * 100).toFixed(1)} | %${(recall * 100).toFixed(1)} | %${(f1 * 100).toFixed(1)}`);
    if ((kat === "SINAV_SIZINTISI" || kat === "CEVAP_ANAHTARI") && recall < 0.95) { ok = false; console.log(`HEDEF TUTMADI: ${kat} recall < %95`); } // kritik hedef
  }
  const temizTop = KATS.reduce((a, t) => a + matris["TEMIZ"][t], 0); // temiz sayısı
  const fpOran = 1 - matris["TEMIZ"]["TEMIZ"] / temizTop; // yanlış alarm oranı
  console.log(`TEMIZ yanlış alarm: %${(fpOran * 100).toFixed(1)} (${temizTop - matris["TEMIZ"]["TEMIZ"]}/${temizTop})`);
  if (fpOran > 0.03) { ok = false; console.log("HEDEF TUTMADI: FP > %3"); }
  if (fpOrnek.length) { console.log("Yanlış alarm örnekleri:"); fpOrnek.forEach(f => console.log(` - [${f.tahmin}] ${f.metin}`)); } // iyileştirme verisi
  console.log(ok ? "SONUÇ: HEDEFLER TUTTU ✅" : "SONUÇ: HEDEF TUTMADI ❌");
  process.exit(ok ? 0 : 1); // CI gibi: tutmazsa hata kodu
})();
