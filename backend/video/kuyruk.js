// Dayanıklı ARKA PLAN KUYRUĞU — yeniden başlatmaya dayanıklı, idempotent, sınırlı deneme.
// - İşler DB'de (video_isleri) tutulur → süreç kopsa bile kaybolmaz.
// - Aynı (tip, video_id) için YALNIZCA bir bekleyen/çalışan iş olur (partial unique index)
//   → çift işçisiz, tekrar tekrar processing yok.
// - Sınırlı eşzamanlılık + iş başına zaman aşımı + üstel geri çekilme (bounded retry).
// - Ücretli/gerçek sağlayıcı ÇAĞRISI YOKTUR; iş gövdesi denetim kuyruğunu işletir.
const db = require("../db");
const { AYAR } = require("./limits");

let calisiyor = false;
let aktifIs = 0; // eşzamanlılık sayacı (sınırlı)

function simdi() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

// İş kuyruğa AL (idempotent: aynı hedef için bekleyen/çalışan iş varsa tekrar eklemez —
// partial unique index sayesinde çift işçisiz, tekrar tekrar processing yok)
function ekle(tip, video_id, opts = {}) {
  try {
    db.prepare(`INSERT INTO video_isleri(tip, video_id, azami_deneme, zaman_asimi_sn, kilit)
                VALUES(?,?,?,?,?)`)
      .run(tip, video_id, opts.azami || AYAR.isAzamiDeneme, opts.zamanAsimi || AYAR.isZamanAsimiSn, opts.kilit || "");
    return { eklendi: true };
  } catch {
    return { eklendi: false, mesaj: "Bu video için zaten bekleyen/çalışan bir iş var." };
  }
}

// Sıradaki işi GÜVENLE al (bekliyor → çalışıyor); atomik koşul ile yarışma korumalı
function siradakiIsiAl() {
  const is = db.prepare(`SELECT * FROM video_isleri WHERE durum='bekliyor'
                         AND (sonraki_deneme IS NULL OR sonraki_deneme <= ?)
                         ORDER BY id ASC LIMIT 1`).get(simdi());
  if (!is) return null;
  const g = db.prepare(`UPDATE video_isleri SET durum='calisiyor', guncelleme=? WHERE id=? AND durum='bekliyor'`)
    .run(simdi(), is.id);
  if (g.changes === 1) return db.prepare(`SELECT * FROM video_isleri WHERE id=?`).get(is.id);
  return null; // başka bir işçi aldı
}

// İşi BİTİR (başarı / sınırlı hata)
function isiBitir(id, basarili, hata = "") {
  const is = db.prepare(`SELECT * FROM video_isleri WHERE id=?`).get(id);
  if (!is) return;
  const azami = is.azami_deneme || AYAR.isAzamiDeneme;
  if (basarili) {
    db.prepare(`UPDATE video_isleri SET durum='basarili', hata='', guncelleme=? WHERE id=?`).run(simdi(), id);
    return;
  }
  const deneme = (is.deneme || 0) + 1;
  if (deneme >= azami) { // sınırlı deneme doldu → kalıcı başarısız (video insan/hiba durumuna düşer)
    db.prepare(`UPDATE video_isleri SET durum='basarisiz', deneme=?, hata=?, guncelleme=? WHERE id=?`)
      .run(deneme, String(hata || "").slice(0, 200), simdi(), id);
    return;
  }
  const gecikme = AYAR.isBeklemeSn * Math.pow(2, deneme - 1); // üstel geri çekilme
  db.prepare(`UPDATE video_isleri SET durum='bekliyor', deneme=?, hata=?, sonraki_deneme=datetime('now', ?), guncelleme=? WHERE id=?`)
    .run(deneme, String(hata || "").slice(0, 200), `+${gecikme} seconds`, simdi(), id);
}

// Süreç DURDUYSA askıda kalan işleri güvenle geri al (yeniden başlatma kurtarma)
function askidakilariKurtar() {
  const g = db.prepare(`UPDATE video_isleri SET durum='bekliyor', guncelleme=?
                        WHERE durum='calisiyor' AND guncelleme < datetime('now', '-60 seconds')`).run(simdi());
  return g.changes;
}

// Tek işi GÜVENLİ çalıştır (zaman aşımı korumalı; iş gövdesi başarısızsa güvenle geri bırak)
async function calistir(is, isGovedesi) {
  const zamanAsimi = (is.zaman_asimi_sn || AYAR.isZamanAsimiSn) * 1000;
  let zamanAsimiDustu = false;
  const zamanlayici = setTimeout(() => { zamanAsimiDustu = true; }, zamanAsimi);
  let yaris = null; // Promise.race'ın geride kalan zamanlayıcısı sürece takılmasın
  try {
    const sonuc = await Promise.race([
      isGovedesi(is),
      new Promise((_, rej) => { yaris = setTimeout(() => rej(new Error("zaman_asimi")), zamanAsimi + 50); }),
    ]);
    if (zamanAsimiDustu) { isiBitir(is.id, false, "zaman_asimi"); return; }
    isiBitir(is.id, sonuc !== false, sonuc && sonuc.hata ? sonuc.hata : "");
  } catch (e) {
    isiBitir(is.id, false, e.message || "hata");
  } finally {
    clearTimeout(zamanlayici);
    if (yaris) clearTimeout(yaris); // sızıntıyı kapat (aksi halde süreç 120 sn açık kalır)
  }
}

// Kuyruğu ÇALIŞTIR (döngü; dur() ile durdurulur). isGovedesi: async (is) => true|false|{hata}
async function calistirDongu(isGovedesi, dur = { aktif: true }) {
  if (calisiyor) return; // tek örnek
  calisiyor = true;
  try { askidakilariKurtar(); } catch { dur.aktif = false; calisiyor = false; return; } // yeniden başlatma kurtarma
  while (dur.aktif) {
    if (aktifIs >= AYAR.kuyrukBounded) { await ruyu(100); continue; } // EŞZAMANLILIK SINIRI
    let is;
    try { is = siradakiIsiAl(); } catch { dur.aktif = false; break; } // DB kapandıysa sessizce dur (unhandledRejection YOK)
    if (!is) { await ruyu(200); continue; } // kuyruk boş
    aktifIs++;
    calistir(is, isGovedesi).catch(() => { }).finally(() => { aktifIs--; }); // fire-and-forget ama sayaç güvenli
    await ruyu(20); // yeni iş alımını hafifçe serbest bırak
  }
  calisiyor = false;
}

function ruyu(ms) { return new Promise(r => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }); } // boşta süreci açık tutmasın (test çıkış kodu)

// Kuyruk DURUMU (arayüz için dürüst sayılar)
function kuyrukDurumu() {
  const sat = db.prepare(`SELECT durum, COUNT(*) adet FROM video_isleri GROUP BY durum`).all();
  const o = { bekliyor: 0, calisiyor: 0, basarili: 0, basarisiz: 0 };
  for (const s of sat) o[s.durum] = s.adet;
  o.aktifIs = aktifIs;
  o.eszamanlilik = AYAR.kuyrukBounded;
  return o;
}

module.exports = { ekle, siradakiIsiAl, isiBitir, askidakilariKurtar, calistir, calistirDongu, kuyrukDurumu, ruyu };
