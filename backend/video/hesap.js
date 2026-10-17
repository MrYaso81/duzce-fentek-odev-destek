// HESAP İNCELEME + ORANTILI KISITLAMA + İTİRAZ — içerik kararından AYRI katman.
// İLKELER (raporda da yazılır):
//  - YAPAY ZEKA SKORUYLA KALICI BAN ASLA. Kalıcı susuzlaştırma = YETKİLİ İNSAN kararı.
//  - Geçici kısıt: orantılı, SÜRELİ, denetime bağlı, loglanır, İTİRAZA açık.
//  - Ceza; doğrulanmış ihmal/ihlale göre yükseltilir, ham AI sinyaline veya şikâyet
//    SAYISINA göre DEĞİL. Tekrarlanan işlem/şikâyet ceza ÇARPMAZ.
//  - Başkası sürekli şikâyet etsin diye kullanıcı CEZALANMAZ.
//  - Kullanıcıya net Türkçe açıklama + itiraz yolu verilir; diğer kullanıcıların
//    gizli bilgisi görünmez.
const db = require("../db");

function simdi() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function gunEkle(gun) { const d = new Date(Date.now() + gun * 86400000); return d.toISOString().replace("T", " ").slice(0, 19); }

// --- Hesap inceleme VAKASI aç (dayanak video + kısıtlı zaman damgalı kanıt) ---
function vakaAc({ kullanici, video_id = 0, sebep = "", olusturan = "sistem", onem = 0 }) {
  // Aynı kullanıcı + aynı video için AÇIK vaka varsa ÇARPMA (duplike işleme koruması)
  const varsa = db.prepare(`SELECT id FROM hesap_incelemeleri WHERE kullanici=? AND video_id=? AND durum='acik'`)
    .get(kullanici, video_id);
  if (varsa) { if (onem) db.prepare(`UPDATE hesap_incelemeleri SET onem=1 WHERE id=?`).run(varsa.id); return varsa.id; }
  const g = db.prepare(`INSERT INTO hesap_incelemeleri(kullanici, video_id, sebep, olusturan, onem) VALUES(?,?,?,?,?)`)
    .run(kullanici, video_id, String(sebep).slice(0, 400), olusturan, onem ? 1 : 0);
  return Number(g.lastInsertRowid);
}

// --- Geçici, süreli YÜKLEME kısıtlaması (oranlı; bitişi ZORUNLU) ---
function kisitla({ kullanici, gun = 3, sebep = "", karar_veren = "" }) {
  if (!karar_veren) throw new Error("Kısıtlama için yetkili insan kararı gerekir (karar_veren boş olamaz).");
  const bitis = gunEkle(gun);
  const g = db.prepare(`INSERT INTO hesap_kisitlamalari(kullanici, tur, bitis, sebep, karar_veren)
                        VALUES(?,?,?,?,?)`).run(kullanici, "yukleme", bitis, String(sebep).slice(0, 400), karar_veren);
  return { id: Number(g.lastInsertRowid), bitis };
}

// Aktif kısıt var mı? (süresi dolan kendiliğinden düşer → süreli ve orantılı)
function aktifKisit(kullanici) {
  return db.prepare(`SELECT * FROM hesap_kisitlamalari WHERE kullanici=? AND tur='yukleme'
                     AND (bitis IS NULL OR bitis > ?) ORDER BY id DESC LIMIT 1`).get(kullanici, simdi()) || null;
}

// İTİRAZ aç (kullanıcı; kararını görünür kılmadan, gizli kanıtı açmadan)
function itirazAc({ kisit_id, kullanici }) {
  const k = db.prepare(`SELECT * FROM hesap_kisitlamalari WHERE id=?`).get(kisit_id);
  if (!k) return { hata: "Kısıtlama bulunamadı." };
  if (k.kullanici !== kullanici) return { hata: "Bu kısıtlama size ait değil." };
  if (k.itiraz_durumu === "acik") return { ok: true, mesaj: "İtirazınız zaten inceleniyor." };
  if (k.itiraz_durumu) return { hata: "Bu kısıtlama için itiraz sonucu verilmiş." };
  db.prepare(`UPDATE hesap_kisitlamalari SET itiraz_durumu='acik' WHERE id=?`).run(kisit_id);
  // İtiraz edilen kısıt, vakaya bağlanır (insan kararı bekler)
  vakaAc({ kullanici, sebep: "Kullanıcı yükleme kısıtına itiraz etti.", olusturan: kullanici, onem: 0 });
  return { ok: true, mesaj: "İtirazınız alındı; yetkili inceleyecek." };
}

// Kısıt ITIRAZI kararını insan verir (kabul → kaldır; reddedilir → süre işler)
function itirazKarari({ kisit_id, karar_veren, kabul, gerekce = "" }) {
  if (!karar_veren) throw new Error("İtiraz kararı için yetkili gerekir.");
  const k = db.prepare(`SELECT * FROM hesap_kisitlamalari WHERE id=?`).get(kisit_id);
  if (!k) return { hata: "Kısıtlama bulunamadı." };
  if (kabul) {
    db.prepare(`UPDATE hesap_kisitlamalari SET itiraz_durumu='kabul', kaldiran=?, bitis=? WHERE id=?`)
      .run(karar_veren, simdi(), kisit_id);
  } else {
    db.prepare(`UPDATE hesap_kisitlamalari SET itiraz_durumu='reddedildi' WHERE id=?`).run(kisit_id);
  }
  kaydiYaz(karar_veren, "itiraz_karari", 0, k.kullanici, (kabul ? "kabul: " : "ret: ") + gerekce);
  return { ok: true, kabul };
}

// Hesap hakkında İNSAN kararı (yetkili; içerik kararından ayrı). AI skoru tek başına yetmez.
function hesapKarari({ kullanici, karar, gerekce, karar_veren, video_id = 0 }) {
  if (!karar_veren) throw new Error("Hesap kararı için yetkili insan gerekir.");
  if (!["uyari", "kisitla", "suspend", "temizlendi"].includes(karar)) throw new Error("Geçersiz hesap kararı.");
  if (!gerekce || String(gerekce).trim().length < 10) throw new Error("Karar için GEREKÇE zorunlu (en az 10 karakter).");
  const vid = vakaAc({ kullanici, video_id, sebep: String(gerekce).slice(0, 400), olusturan: karar_veren, onem: karar === "suspend" ? 1 : 0 });
  db.prepare(`UPDATE hesap_incelemeleri SET durum='kapandi', karar=?, karar_gerekce=?, karar_veren=?, karar_tarih=? WHERE id=?`)
    .run(karar, String(gerekce).slice(0, 400), karar_veren, simdi(), vid);
  if (karar === "kisitla") kisitla({ kullanici, gun: 7, sebep: gerekce, karar_veren });
  kaydiYaz(karar_veren, "hesap_karari", video_id, kullanici, `${karar}: ${gerekce}`);
  return { ok: true, vaka_id: vid };
}

// Kısıtı yetkili kaldırabilir (erken sonlandırma; loglanır)
function kisitKaldir({ kisit_id, karar_veren, gerekce = "" }) {
  if (!karar_veren) throw new Error("Kaldırma için yetkili gerekir.");
  const k = db.prepare(`SELECT * FROM hesap_kisitlamalari WHERE id=?`).get(kisit_id);
  if (!k) return { hata: "Kısıtlama bulunamadı." };
  db.prepare(`UPDATE hesap_kisitlamalari SET bitis=?, kaldiran=? WHERE id=?`).run(simdi(), karar_veren, kisit_id);
  kaydiYaz(karar_veren, "kisit_kaldir", 0, k.kullanici, gerekce);
  return { ok: true };
}

// ŞİKÂYET: duplike engellenir (aynı kişi aynı videoyu tek kez) → ceza şişirmez
function sikayetEt({ video_id, bildiren, neden }) {
  try {
    db.prepare(`INSERT INTO video_sikayetleri(video_id, bildiren, neden) VALUES(?,?,?)`)
      .run(video_id, bildiren, String(neden).slice(0, 400));
    return { ok: true, yeni: true };
  } catch { return { ok: true, yeni: false, mesaj: "Bu videoyu daha önce bildirdiniz." }; }
}
function sikayetSayisi(video_id) {
  return db.prepare(`SELECT COUNT(*) n FROM video_sikayetleri WHERE video_id=?`).get(video_id).n;
}

// Kullanıcıya GÖSTERİLECEK dürüst durum (diğer kullanıcıların gizli bilgisi YOK)
function kullaniciDurumu(kullanici) {
  const kisit = aktifKisit(kullanici);
  const vakalar = db.prepare(`SELECT id, durum, karar, karar_gerekce, karar_tarih, tarih FROM hesap_incelemeleri
                              WHERE kullanici=? ORDER BY id DESC LIMIT 10`).all(kullanici);
  const itirazAcik = db.prepare(`SELECT COUNT(*) n FROM hesap_kisitlamalari WHERE kullanici=? AND itiraz_durumu='acik'`)
    .get(kullanici).n;
  return {
    kisitli: !!kisit,
    kisit: kisit ? { id: kisit.id, bitis: kisit.bitis, sebep: kisit.sebep,
                     itiraz_durumu: kisit.itiraz_durumu || "" } : null,
    itirazAcik,
    vakalar: vakalar.map(v => ({ id: v.id, durum: v.durum, karar: v.karar, gerekce: v.karar_gerekce,
                                 tarih: v.tarih, karar_tarih: v.karar_tarih })),
  };
}

// Yetkili (moderatör) için: AÇIK yükleme-kısıtı İTİRAZLARI (yalnız üstbilgi; gizli kanıt yok)
function acikItirazlar() {
  return db.prepare(`SELECT id, kullanici, sebep, bitis, itiraz_durumu, karar_veren, tarih
                     FROM hesap_kisitlamalari WHERE itiraz_durumu='acik'
                     ORDER BY id DESC LIMIT 50`).all();
}

// Denetim kaydı (kim, ne, ne zaman, hangi içerik)
function kaydiYaz(kim, aksiyon, video_id = 0, kullanici = "", gerekce = "") {
  db.prepare(`INSERT INTO video_denetim_kaydi(kim, aksiyon, video_id, kullanici, gerekce) VALUES(?,?,?,?,?)`)
    .run(kim, aksiyon, video_id, kullanici, String(gerekce).slice(0, 400));
}

module.exports = { vakaAc, kisitla, aktifKisit, itirazAc, itirazKarari, hesapKarari, kisitKaldir,
                   sikayetEt, sikayetSayisi, kullaniciDurumu, acikItirazlar, kaydiYaz };
