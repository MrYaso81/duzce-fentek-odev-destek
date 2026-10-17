// Bağımsız küme koşusu: `node ai-eval/bagimsiz-kos.js` (backend klasöründe)
// Geliştirme setinden AYRI örnekler (bagimsiz.json). hold=incelemede/engelli, allow=yayinla.
// Sadece ölçer, eşik değiştirmez. Kural tabanlı mod sonucu verir (LLM kapalı).
const fs = require("fs"); // dosya okuma
const { denetle } = require("../ai/denetle"); // gerçek hat

const ornekler = JSON.parse(fs.readFileSync(__dirname + "/bagimsiz.json", "utf-8")); // 40 örnek
(async () => {
  let dogru = 0; // doğru sayısı
  const kacanKirli = [], yersizBayrak = []; // iki hata yönü
  for (const o of ornekler) {
    const d = await denetle(o.metin, {}); // havuzsuz, tekrarsız
    const karar = d.onerilen_aksiyon === "yayinla" ? "allow" : "hold"; // karara indirge
    const tamam = karar === o.beklenti; // beklenti tuttu mu
    if (tamam) dogru++;
    else if (o.beklenti === "hold") kacanKirli.push(`KAÇTI [${d.kategori} ${d.risk_skoru}] ${o.metin}`);
    else yersizBayrak.push(`YERSİZ [${d.kategori} ${d.risk_skoru}] ${o.metin}`);
    console.log(`${tamam ? "✔" : "✘"} [${o.beklenti}->${karar}] ${o.metin}`); // satır satır
  }
  console.log(`\nSONUÇ: ${dogru}/${ornekler.length} doğru`);
  if (kacanKirli.length) console.log("Kaçan sakıncalı:\n - " + kacanKirli.join("\n - "));
  if (yersizBayrak.length) console.log("Yersiz bayrak:\n - " + yersizBayrak.join("\n - "));
})();
