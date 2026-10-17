// Katman 2 çekirdeği: TF-IDF kosinüs benzerliği (saf JS, kurulum yok)
// Ne yapar: iki yazının kelime ağırlıklı benzerliğini 0-1 arası verir
const { sadelestir } = require("../config/etik"); // aynı sadeleştirme

function kelimeler(m) { // 2 harften uzun kelimeler (kısa ekleri at)
  return sadelestir(m).split(" ").filter(w => w.length > 2);
}
function tf(metin) { // kelime sıklığı tablosu
  const t = {}, k = kelimeler(metin);
  k.forEach(w => t[w] = (t[w] || 0) + 1);
  return { t, n: k.length };
}
function kosinus(a, b) { // iki sıklık tablosunun benzerliği
  let pay = 0, kareA = 0, kareB = 0; // pay + boylar
  const tum = new Set([...Object.keys(a.t), ...Object.keys(b.t)]);
  for (const w of tum) {
    const x = (a.t[w] || 0) / a.n, y = (b.t[w] || 0) / b.n; // orantıla
    pay += x * y; kareA += x * x; kareB += y * y;
  }
  if (!kareA || !kareB) return 0; // boşsa 0
  return pay / (Math.sqrt(kareA) * Math.sqrt(kareB)); // 0-1 arası
}
function benzerlik(a, b) { // dışa açık tek fonksiyon
  if (!a || !b) return 0;
  return kosinus(tf(a), tf(b));
}
module.exports = { benzerlik, kelimeler }; // havuz eşleştirme kullanır
