// VIDEO HİZMETİ — yükleme → karantina → kuyruk → denetim → adil karar → yayınlama/silme.
// Durum makinesi: uploading → quarantined → processing → approved|needs_review|rejected|failed
// GÜVENLİK: Orijinal asla DB'ye base64 olarak yazılmaz; özel anahtarla karantinada tutulur.
// Herkese açılmadan ÖNCE tüm zorunlu inceleme tamamlanmak ZORUNDADIR.
const fs = require("fs");
const db = require("../db");
const { AYAR } = require("./limits");
const MEDYA = require("./medya");
const DEPO = require("./depolama");
const KUYRUK = require("./kuyruk");
const DENETIM = require("./denetim");
const HESAP = require("./hesap");
const BOT = require("../anti-bot");

let saglayicilar = {}; // test/sentetik: { konusma, ekranYazisi, goruntu } — varsayılan YOK (gerçek yok)
function saglayicilariAyarla(s) { saglayicilar = s || {}; }
function saglayicilariOku() { return saglayicilar; }

function simdi() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

// --- YÜKLEME (karantinaya al; yayına GİRMEZ) ---
function yukle({ kullanici, gonderi_id, baslik = "", aciklama = "", mime = "", uzanti = "", tampon, ip = "" }) {
  if (!tampon || !tampon.length) return { hata: "Dosya boş!", kod: 400 };
  if (tampon.length > AYAR.enFazlaBoyutMB * 1024 * 1024)
    return { hata: `Dosya çok büyük (en fazla ${AYAR.enFazlaBoyutMB} MB).`, kod: 413 };

  // Anti-bot: kısıt + kotalar + yoğunluk (Katman; içerik denetimi BUNUNLA SINIRLI DEĞİL)
  const k = BOT.yuklemeKontrol(kullanici, ip, tampon.length);
  if (!k.izin) return { hata: k.mesaj, kod: k.kod === "kisitli" ? 403 : 429 };

  // GERÇEK medya doğrulama (bayt başlığı + süre; uzantı/MIME'a güvenilmez)
  const d = MEDYA.dogrula({ bas: tampon, uzanti, mime });
  if (!d.gecerli) return { hata: d.hatalar.join(" "), kod: 415, detay: d.hatalar };
  // Süre sınırı: süre GERÇEK çözümlenmişse uygulanır; bilinmiyorsa karantinaya alır
  // ama otomatik YAYINA GİRMEZ (insan incelemesi zorunlu) — bkz. denetim.js "eksik" dalı.
  if (d.sure_sn > 0 && d.sure_sn > AYAR.enFazlaSureSn)
    return { hata: `Video çok uzun (en fazla ${Math.round(AYAR.enFazlaSureSn / 60)} dakika).`, kod: 413 };

  // Yinelenen/yeniden yükleme koruması (içerik hash)
  const hash = MEDYA.icerikHash(tampon);
  if (BOT.yinelenenMi(kullanici, hash))
    return { hata: "Aynı videoyu daha önce yüklediniz (yinelenen içerik).", kod: 409 };

  const anahtar = DEPO.anahtarUret(); // öngörülemez
  const tmp = require("path").join(require("os").tmpdir(), "vid-" + anahtar + ".part");
  fs.writeFileSync(tmp, tampon, { mode: 0o600 });
  try { DEPO.orijinalYaz("orijinal", anahtar, d.bicim, tmp); }
  catch (e) { try { fs.unlinkSync(tmp); } catch {} return { hata: "Dosya kaydedilemedi: " + e.message, kod: 500 }; }

  const g = db.prepare(`INSERT INTO video_cevaplar(gonderi_id, yazar, baslik, aciklama, durum,
      saklama_anahtari, orijinal_boyut, sure_sn, bicim, mime_beyan, icerik_hash)
      VALUES(?,?,?,?, 'quarantined', ?,?,?,?,?,?)`)
    .run(gonderi_id | 0, kullanici, String(baslik).slice(0, 120), String(aciklama).slice(0, 1000),
      anahtar, tampon.length, d.sure_sn || 0, d.bicim, d.mime_beyan, hash);
  const id = Number(g.lastInsertRowid);

  KUYRUK.ekle("denetle", id); // dayanıklı kuyruk (yeniden başlatmaya dayanıklı)
  return { ok: true, id, durum: "quarantined", bicim: d.bicim, sure_sn: d.sure_sn || 0,
           sure_bilinmiyor: d.sure_bilinmiyor, asama: k.asama, kalanKota: k.kalanKota,
           mesaj: "Video karantinaya alındı. Otomatik inceleme TAMAMLANMADAN herkese açılmaz." };
}

// --- KUYRUK İŞ GÖVDESİ (denetle) ---
async function isGovedesi(is) {
  const v = db.prepare(`SELECT * FROM video_cevaplar WHERE id=?`).get(is.video_id);
  if (!v || v.silindi) return { hata: "video_yok" }; // silinmişse işi tamamla (idempotent)
  if (v.durum === "approved" || v.durum === "rejected") return true; // zaten karar verilmiş → tekrar işleme
  db.prepare(`UPDATE video_cevaplar SET durum='processing', guncelleme=? WHERE id=?`).run(simdi(), v.id);

  const sonuc = await DENETIM.denetle(v, { sure: v.sure_sn, bicim: v.bicim }, saglayicilar);

  // Bulgulari kalıcı yaz (zaman damgalı)
  const mevcut = db.prepare(`SELECT COUNT(*) n FROM video_bulgular WHERE video_id=?`).get(v.id).n;
  if (mevcut === 0) {
    const ekle = db.prepare(`INSERT INTO video_bulgular(video_id, kaynak, kategori, siddet, guven,
        zaman_bas, zaman_bit, aciklama, kaynak_guven) VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const b of sonuc.bulgular) ekle.run(v.id, b.kaynak, b.kategori, b.siddet, b.guven,
      b.zaman_bas, b.zaman_bit, b.aciklama, b.kaynak_guven);
  }

  const durum = sonuc.durum === "approved" ? "approved"
              : sonuc.durum === "needs_review" ? "needs_review" : "failed";
  db.prepare(`UPDATE video_cevaplar SET durum=?, denetim_durumu='tamam', son_karar=?,
              karar_gerekce=?, karar_tarih=? WHERE id=?`)
    .run(durum, sonuc.karar || "", sonuc.gerekce || "", simdi(), v.id);

  // Acil/öncelikli sinyal → hesap inceleme VAKASI (içerik kararından ayrı; kalıcı ceza YOK)
  if (sonuc.onem) HESAP.vakaAc({ kullanici: v.yazar, video_id: v.id, sebep: sonuc.gerekce, olusturan: "sistem", onem: 1 });
  if (durum === "approved") bildirim(v.yazar, "Video çözümünüz incelemeyi geçti ve yayımlandı.");
  if (durum === "needs_review") bildirim(v.yazar, "Video çözümünüz insan incelemesinde. Herkese açılmadı.");
  return true;
}
function bildirim(kime, metin) { try { db.prepare(`INSERT INTO bildirimler(kime, metin) VALUES(?,?)`).run(kime, metin); } catch { } }

// --- GÖRÜNÜM (dışa dönük; gizli kanıt/altyazı/transkript açılmaz) ---
function gorunum(v, istemci) {
  const sahip = istemci && istemci.ad === v.yazar;
  const yetkili = istemci && YONETICI_ROLLER.includes(istemci.rol);
  if (!v || v.silindi) return null;
  if (v.durum !== "approved" && !sahip && !yetkili) return null; // onaysız video başkasına GÖRÜNMEZ
  return {
    id: v.id, gonderi_id: v.gonderi_id, yazar: v.yazar, baslik: v.baslik, aciklama: v.aciklama,
    durum: v.durum, sure_sn: v.sure_sn, bicim: v.bicim, boyut: v.orijinal_boyut,
    olusturma: v.olusturma, sahip, yetkili,
    oynatma: v.durum === "approved" || sahip || yetkili, // oynatma bağlantısı yalnız erişim varsa
    karar_gerekce: (sahip || yetkili) ? v.karar_gerekce : "", // kullanıcıya net gerekçe
    red_nedeni: (sahip || yetkili) ? v.red_nedeni : "",
    itiraz_durumu: sahip ? (v.itiraz_durumu || "") : "",
    altyazi_var: v.durum === "approved" && !!v.altyazi_anahtari, // altyazı yalnız onaylıysa yayımlanır
    sahte: undefined,
  };
}

// --- ERİŞİM (orijinal/türev medya servisi; tahmini URL YOK, sahiplik DB'den) ---
function medyaErisim(video_id, istemci) {
  const v = db.prepare(`SELECT * FROM video_cevaplar WHERE id=?`).get(video_id);
  if (!v || v.silindi) return { hata: "Video bulunamadı.", kod: 404 };
  const sahip = istemci && istemci.ad === v.yazar;
  const yetkili = istemci && YONETICI_ROLLER.includes(istemci.rol);
  if (!sahip && !yetkili && v.durum !== "approved") return { hata: "Bu videoya erişim yok.", kod: 403 };
  return { v, sahip, yetkili };
}

// --- SİLMEE: yazar veya YETKİLİ; orijinal + tüm türevler birlikte gider ---
function sil(video_id, istemci) {
  const v = db.prepare(`SELECT * FROM video_cevaplar WHERE id=?`).get(video_id);
  if (!v || v.silindi) return { hata: "Video bulunamadı.", kod: 404 };
  const sahip = istemci && istemci.ad === v.yazar;
  const yetkili = istemci && YONETICI_ROLLER.includes(istemci.rol);
  if (!sahip && !yetkili) return { hata: "Bu videoyu silme yetkin yok.", kod: 403 };
  DEPO.sil(v.saklama_anahtari, v.bicim); // orijinal + kapak + altyazı + geçici
  db.prepare(`UPDATE video_cevaplar SET silindi=1, durum='rejected', guncelleme=? WHERE id=?`).run(simdi(), v.id);
  db.prepare(`DELETE FROM video_bulgular WHERE video_id=?`).run(v.id); // kanıtlar da gider (veri minimizasyonu)
  db.prepare(`DELETE FROM video_isleri WHERE video_id=?`).run(v.id);   // bekleyen işler iptal
  HESAP.kaydiYaz(istemci && istemci.ad, "video_sil", v.id, v.yazar, yetkili && !sahip ? "yetkili silme" : "yazar silme");
  return { ok: true, mesaj: "Video ve tüm türev dosyaları silindi." };
}

// --- İNSAN (moderatör) KARARI: onayla / reddet / değiştirme iste --- 
// Çakışma koruması: istemci BEKLENEN durumu gönderir; uyuşmazsa 409 (iki moderatör çakışmasın)
function insanKarari({ video_id, beklenen_durum, yeni_durum, gerekce, kim, rol, red_nedeni = "", istegi_degistir = false }) {
  if (!YONETICI_ROLLER.includes(rol)) return { hata: "Yetkin yok.", kod: 403 };
  if (!gerekce || String(gerekce).trim().length < 10) return { hata: "Karar için GEREKÇE zorunlu (en az 10 karakter).", kod: 400 };
  const v = db.prepare(`SELECT * FROM video_cevaplar WHERE id=?`).get(video_id);
  if (!v || v.silindi) return { hata: "Video bulunamadı.", kod: 404 };
  if (beklenen_durum && v.durum !== beklenen_durum)
    return { hata: "Video başkası tarafından değiştirilmiş; listeyi yenileyin.", kod: 409, mevcut: v.durum };
  const izin = { onayla: "approved", reddet: "rejected", iste: "needs_review" };
  const hedef = istegi_degistir ? izin.iste : izin[yeni_durum];
  if (!hedef) return { hata: "Geçersiz karar.", kod: 400 };
  if (hedef === "rejected" && !red_nedeni) return { hata: "Ret için kullanıcıya gösterilecek NET neden gerekli.", kod: 400 };

  db.prepare(`UPDATE video_cevaplar SET durum=?, son_karar=?, karar_gerekce=?, karar_veren=?,
              karar_tarih=?, red_nedeni=?, guncelleme=? WHERE id=?`)
    .run(hedef, hedef === "approved" ? "onaylandi" : hedef === "rejected" ? "red" : "inceleme",
      String(gerekce).slice(0, 400), kim, simdi(), String(red_nedeni || "").slice(0, 400), simdi(), v.id);
  HESAP.kaydiYaz(kim, hedef === "approved" ? "onayla" : hedef === "rejected" ? "reddet" : "istegi_degistir",
    v.id, v.yazar, gerekce);
  bildirim(v.yazar, hedef === "approved" ? "Video çözümünüz onaylandı ve yayımlandı."
        : hedef === "rejected" ? "Video çözümünüz reddedildi: " + (red_nedeni || gerekce)
        : "Video çözümünüz için değişiklik istendi.");
  return { ok: true, durum: hedef };
}

// --- HESAP KISITLAMA / İTİRAZ uçları (adil içerik-dışı katman) ---
function kisitlaVideo({ video_id, gun, sebep, kim, rol }) {
  if (!["mudur", "admin"].includes(rol)) return { hata: "Yalnız müdür/admin kısıtlayabilir.", kod: 403 };
  const v = db.prepare(`SELECT * FROM video_cevaplar WHERE id=?`).get(video_id);
  if (!v) return { hata: "Video bulunamadı.", kod: 404 };
  const r = HESAP.kisitla({ kullanici: v.yazar, gun, sebep, karar_veren: kim });
  HESAP.kaydiYaz(kim, "kisitla", v.id, v.yazar, sebep);
  return { ok: true, ...r };
}

// --- SAKLAMA SÜRESİ (retention): onaylanmamış karantina + reddedilen + geçici iş dosyaları ---
function retentionTemizle({ simdiGun = Date.now() } = {}) {
  let silinen = 0;
  const eski = db.prepare(`SELECT * FROM video_cevaplar WHERE durum IN ('quarantined','failed')
                           AND olusturma < datetime('now', ?)`).all(`-${AYAR.karantinaGun} days`);
  for (const v of eski) { DEPO.sil(v.saklama_anahtari, v.bicim); db.prepare(`UPDATE video_cevaplar SET silindi=1 WHERE id=?`).run(v.id); silinen++; }
  const red = db.prepare(`SELECT * FROM video_cevaplar WHERE durum='rejected' AND silindi=0
                          AND karar_tarih < datetime('now', ?)`).all(`-${AYAR.redEdilenGun} days`);
  for (const v of red) { DEPO.sil(v.saklama_anahtari, v.bicim); db.prepare(`UPDATE video_cevaplar SET silindi=1 WHERE id=?`).run(v.id); silinen++; }
  return { silinen };
}

// --- MODERATÖR KUYRUĞU (durum filtresi + sayfalama) ---
function kuyruk({ durum = "needs_review", onem, limit = 20, offset = 0 } = {}) {
  const d = ["quarantined", "processing", "approved", "needs_review", "rejected", "failed"].includes(durum) ? durum : "needs_review";
  let sql = `SELECT * FROM video_cevaplar WHERE durum=? AND silindi=0`;
  const p = [d];
  if (onem === 1) { sql += ` AND id IN (SELECT video_id FROM video_bulgular WHERE siddet='yuksek')`; }
  sql += ` ORDER BY CASE WHEN id IN (SELECT video_id FROM video_bulgular WHERE siddet='yuksek') THEN 0 ELSE 1 END, id DESC LIMIT ? OFFSET ?`;
  p.push(Math.min(50, Number(limit) || 20), Number(offset) || 0);
  const satirlar = db.prepare(sql).all(...p);
  const toplam = db.prepare(`SELECT COUNT(*) n FROM video_cevaplar WHERE durum=? AND silindi=0`).get(d).n;
  return { durum, toplam, sonuclar: satirlar.map(v => ({ ...gorunum(v, { ad: "", rol: "admin" }), olusturma: v.olusturma })) };
}
function bulgular(video_id) {
  return db.prepare(`SELECT * FROM video_bulgular WHERE video_id=? ORDER BY zaman_bas, id`).all(video_id)
    .map(b => ({ id: b.id, kaynak: b.kaynak, kategori: b.kategori, siddet: b.siddet, guven: b.guven,
                 zaman_bas: b.zaman_bas, zaman_bit: b.zaman_bit, aciklama: b.aciklama,
                 kaynak_guven: b.kaynak_guven, onayli: !!b.onayli }));
}

const YONETICI_ROLLER = ["ogretmen", "mudur", "admin"];

module.exports = { yukle, isGovedesi, gorunum, medyaErisim, sil, insanKarari, kisitlaVideo,
                   retentionTemizle, kuyruk, bulgular, saglayicilariAyarla, saglayicilariOku, YONETICI_ROLLER };
