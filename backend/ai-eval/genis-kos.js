// Geniş denetim ölçümü: `node ai-eval/genis-kos.js [dosya]`
// Amaç: kural tabanlı moderasyonu dengeli bir kümeyle ölçmek.
// - Beklenti ÖNCEDEN atanmıştır (allow|hold)
// - "belirsiz" grubu AYRI raporlanır (yanlış negatif/pozitif sayımına katılmaz)
// - Yanlış negatif (kaçan kirli) ve yanlış pozitif (yersiz bayrak) AYRI listelenir
// - Mod: LLM kapalıysa sonuç SAF KURAL tabanlıdır (ai/llm durum'undan doğrulanır)
const fs = require("fs");
const { denetle } = require("../ai/denetle"); // gerçek hat
const { durum } = require("../ai/llm"); // mod bilgisi (kural|llm)

const dosya = process.argv[2] || (__dirname + "/denetim-genis.json");
const ornekler = JSON.parse(fs.readFileSync(dosya, "utf-8"));

(async () => {
  const mod = durum().mod; // "kural" beklenir (anahtar yok)
  const gruplar = {}; // grup -> {toplam, dogru, fn, fp, belirsiz}
  const kacanlar = [], yersizler = [], belirsizSatir = [];

  for (const o of ornekler) {
    const d = await denetle(o.metin, {}); // havuzsuz + tekrarsız: saf sınıflandırıcı
    const karar = d.onerilen_aksiyon === "yayinla" ? "allow" : "hold";
    const g = gruplar[o.grup] = gruplar[o.grup] || { toplam: 0, dogru: 0, fn: 0, fp: 0, belirsiz: 0 };
    g.toplam++;
    const dogru = karar === o.beklenti;
    if (o.grup === "belirsiz") { // ayrı kova
      g.belirsiz += dogru ? 0 : 1;
      belirsizSatir.push(`${dogru ? "✓" : "…"} [beklenti=${o.beklenti} karar=${karar}] ${o.metin}`);
      continue;
    }
    if (dogru) g.dogru++;
    else if (o.beklenti === "hold") { g.fn++; kacanlar.push(`KAÇTI [${d.kategori} ${d.risk_skoru}] ${o.metin}`); }
    else { g.fp++; yersizler.push(`YERSİZ [${d.kategori} ${d.risk_skoru}] ${o.metin}`); }
  }

  console.log(`\n=== DENETİM ÖLÇÜMÜ (${dosya.split(/[\\/]/).pop()}) ===`);
  console.log(`Mod: ${mod} (llmAcik=${require("../ai/config").llmAcik}) — ${mod === "kural" ? "SAF KURAL TABANLI" : "MODEL KATMANLI"}`);
  console.log(`Toplam: ${ornekler.length} örnek (belirsiz ${ornekler.filter(o => o.grup === "belirsiz").length} hariç)`);
  let t = 0, dog = 0;
  for (const [ad, g] of Object.entries(gruplar)) {
    if (ad !== "belirsiz") { t += g.toplam; dog += g.dogru; }
    const ek = ad === "belirsiz" ? ` aykırı=${g.belirsiz}` : ` FN=${g.fn} FP=${g.fp}`;
    console.log(`  ${ad.padEnd(12)} ${String(g.dogru).padStart(2)}/${g.toplam}${ek}`);
  }
  console.log(`\nDoğruluk (belirsiz hariç): ${dog}/${t} = %${(100 * dog / t).toFixed(1)}`);
  console.log(`\nYANLIŞ NEGATİFLER (kaçan kirli): ${kacanlar.length}`);
  kacanlar.forEach(x => console.log("  " + x));
  console.log(`\nYANLIŞ POZİTİFLER (yersiz bayrak): ${yersizler.length}`);
  yersizler.forEach(x => console.log("  " + x));
  console.log(`\nBELİRSİZ GRUP (ayrı değerlendirilir):`);
  belirsizSatir.forEach(x => console.log("  " + x));
})();
