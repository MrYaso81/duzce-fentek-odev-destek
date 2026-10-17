// Kütüphane çekirdeği: Türkçe duyarlı normalizasyon, taksonomi, artımlı indeksleme,
// karma arama (yapısal filtre + sözcük + soru deseni), içe aktarma (JSON/CSV + önizleme),
// yinelenen tespiti, incele/yayınla akışı ve silme.
//
// GÜVENLİK SINIRI: Bu modül YALNIZ kütüphane tablolarıyla çalışır. Kişisel notlar, sohbetler,
// öğretmene sorular ve GİZLİ SINAV HAVUZU buradan ASLA okunmaz/yazılmaz (bkz. ai/havuz.js ayrı).
const { z } = require("zod"); // girdi doğrulama
const db = require("./db"); // veritabanı
const { KONULAR, ICERIKLER, DESEN_KALIPLARI, BASLANGIC_ETIKET, BASLANGIC_LISANS } = require("./kutuphane-veri");

const DURUMLAR = ["taslak", "incelemede", "yayinda", "gizli", "silindi"];
const ZORLUKLAR = ["kolay", "orta", "zor"];
const TURLER = ["konu_ozeti", "cozum", "soru_deseni"];
const GORUNUMLER = ["herkes", "kurum"];
const IZINLI_DURUMLAR = { taslak: ["incelemede", "silindi"], incelemede: ["yayinda", "taslak", "silindi"], yayinda: ["gizli", "silindi"], gizli: ["yayinda", "silindi"], silindi: [] };

// --- Türkçe metin normalizasyonu (arama için; rakamlar/işaretler KORUNUR) ---
function trKucuk(s) { return String(s == null ? "" : s).toLocaleLowerCase("tr-TR"); } // Türkçe küçük harf
function trKatla(s) { // Türkçe harfleri düzleştir (ç→c, ı→i, ...), işaretleri koru
  return trKucuk(s).replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o")
    .replace(/ş/g, "s").replace(/ü/g, "u").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
}
// Aramada çok genel geçen kelimeler (gürültüyü azaltır; soru/desen tespiti ham metinden yapılır)
const GENEL = new Set(["gibi", "soru", "sorular", "sorulari", "problem", "problemler", "problemleri", "ornek", "ornekleri",
  "nasil", "nedir", "cozulur", "bulunur", "ile", "icin", "bir", "bu", "su", "da", "de", "ki", "mi", "mu", "ve"]);
function terimlerCikar(metin) { // FTS terimleri: harf/rakam dizileri, genel kelimeler atılır
  return trKatla(metin).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !GENEL.has(t));
}
function anahtarMetin(k) { // LIKE yedeği için düzleştirilmiş birleşik metin
  return trKatla([k.baslik, k.ozet, k.soru, k.ipucu, k.cevap, k.konu, k.desen, k.ders, etiketMetni(k.etiketler)].join(" "));
}
function etiketMetni(e) { try { const a = typeof e === "string" ? JSON.parse(e || "[]") : (e || []); return Array.isArray(a) ? a.join(" ") : ""; } catch { return ""; } }
function diziJSON(e) { try { const a = typeof e === "string" ? JSON.parse(e || "[]") : (e || []); return Array.isArray(a) ? a : []; } catch { return []; } }

// --- Konu taksonomisi ---
function konulariYukle() { // KONULAR'ı tabloya işle (varsa güncelle)
  const st = db.prepare(`INSERT INTO konular (konu_id, ad, ders, ust_id, esanlam) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(konu_id) DO UPDATE SET ad=excluded.ad, ders=excluded.ders, esanlam=excluded.esanlam`);
  for (const k of KONULAR) st.run(k.konu_id, k.ad, k.ders || "", k.ust_id || "", JSON.stringify(k.esanlam || []));
}
function konuListesi() { return db.prepare("SELECT konu_id, ad, ders, ust_id, esanlam FROM konular ORDER BY ders, ad").all(); }

// Konu tanıma: konu adı/eşanlamı düzleştirilmiş metinde geçiyor mu (en uzun eşleşme kazanır)
function konuBul(kat, konular) {
  let enIyi = null, uzunluk = 0;
  for (const k of konular || []) {
    const varyantlar = [k.ad, ...diziJSON(k.esanlam)].map(trKatla).filter(Boolean);
    for (const v of varyantlar) {
      if (v.length > 2 && kat.includes(v) && v.length > uzunluk) { enIyi = k; uzunluk = v.length; }
    }
  }
  return enIyi;
}
function desenBul(kat) { // soru deseni tanıma (normalize metin + basit denklem kalıbı)
  if (/\d+\s*x\s*[+\-]\s*\d+\s*=\s*\d+/.test(kat) || /[a-z]\s*[+\-]\s*\d+\s*=\s*\d+/.test(kat)) return { desen: "birinci-derece-denklem", sebep: "denklem kalıbı" };
  if (/x\s*(kare|\^?2)/.test(kat)) return { desen: "ikinci-derece-denklem", sebep: "ikinci derece kalıbı" };
  for (const d of DESEN_KALIPLARI) for (const kalip of d.kaliplar) if (kat.includes(kalip)) return { desen: d.desen, sebep: "'" + kalip + "'" };
  return null;
}
const DERS_ADLARI = ["matematik", "fen", "turkce", "tarih", "ingilizce", "cografya", "sosyal bilgiler", "fizik", "kimya", "biyoloji"];
function dersBul(kat) { return DERS_ADLARI.find(d => kat.includes(d)) || ""; }
function zorlukBul(kat) {
  if (/(kolay|basit|temel)/.test(kat)) return "kolay";
  if (/(zor|ileri|karmasik|çok zor)/.test(kat)) return "zor";
  if (/(orta|karisik)/.test(kat) && !/zor/.test(kat)) return "orta";
  return "";
}
function sinifBul(kat) { const m = kat.match(/(\d{1,2})\s*(sinif|\.?\s*sinif)/) || kat.match(/sinif\s*(\d{1,2})/); return m ? m[1] : ""; }

// Sorgu çözümleme: kullanıcının doğal cümlesini yapısal niyete çevirir
function sorguCoz(metin, konular) {
  const ham = String(metin == null ? "" : metin).trim();
  const kat = trKatla(ham);
  const konu = konuBul(kat, konular || konuListesi());
  const desen = desenBul(kat);
  return {
    metin: ham,
    terimler: terimlerCikar(metin),
    ders: dersBul(kat),
    sinif: sinifBul(kat),
    konu_id: konu ? konu.konu_id : "",
    konu: konu ? konu.ad : "",
    desen: desen ? desen.desen : "",
    zorluk: zorlukBul(kat)
  };
}

// --- Erişim kapsamı (kapsam YALNIZ sunucu tarafından belirlenir; istemci ARTIRAMAZ) ---
const KAPSAMLAR = ["misafir", "uye", "yonetim"];
function kapsamDuzelt(kapsam) { return KAPSAMLAR.includes(kapsam) ? kapsam : "misafir"; } // bilinmeyen/eksik → EN KISITLI
// Erişilebilir durum/görünüm SQL koşulu.
// DÜZELTME: Bu işlev daha önce konumsal (kapsam, durum) imzayla tanımlıydı ama çağıranlar
// seçenek nesnesi ({ kapsam, durum }) geçiyordu → kapsam hep nesne olup misafir kontrolü
// ATLANIYOR ve misafirler "kurum" görünümlü içeriği görebiliyordu. Tek imza: nesne.
function durumKosulu({ kapsam = "misafir", durum } = {}) {
  const ka = kapsamDuzelt(kapsam);
  if (ka === "yonetim") { // yönetim: gizli/taslak dahil; varsayılan olarak SİLİNEN hariç (açık filtre ile görülebilir)
    if (durum && DURUMLAR.includes(durum)) return { sql: "durum = ?", params: [durum] };
    return { sql: "durum <> 'silindi'", params: [] };
  }
  if (ka === "uye") return { sql: "durum = 'yayinda' AND gorunum IN ('herkes','kurum')", params: [] };
  return { sql: "durum = 'yayinda' AND gorunum = 'herkes'", params: [] }; // misafir: YALNIZ herkes
}
// Tek içerik erişim denetimi. Önbelleğe alınmış nesne KANIT DEĞİLDİR; her sayfada bu işlevle
// GÜNCEL satır yeniden doğrulanır (gizli/silinmiş/taslak/kurum-misafir ayrımı korunur).
function gorunurMu(k, kapsam) {
  if (!k) return false;
  const ka = kapsamDuzelt(kapsam);
  if (ka === "yonetim") return true; // yönetim yetkisi sunucu-kontrollü; tüm durumlar (silinen dahil)
  if (k.durum !== "yayinda") return false; // taslak/incelemede/gizli/silindi ASLA görünmez
  return ka === "misafir" ? k.gorunum === "herkes" : true; // misafir yalnız "herkes"; üye "herkes"+"kurum"
}

// --- İndeksleme (artımlı) + yeniden başlatmaya dayanıklı işler ---
function indeksKaydi(k) { return { baslik: k.baslik, govde: [k.ozet, k.soru, k.ipucu, k.cevap, diziJSON(k.adimlar).join(" "), k.konu, k.desen, k.ders].filter(Boolean).join(" "), etiket: etiketMetni(k.etiketler) }; }
function indeksGuncelleUygula(icerikId) { // tek içerik için FTS satırını tazele
  const k = db.prepare("SELECT * FROM kutuphane WHERE icerik_id = ?").get(icerikId);
  if (!k) return false;
  db.prepare("DELETE FROM kutuphane_fts WHERE rowid = ?").run(k.id); // eski satırı kaldır
  if (k.durum === "yayinda") { // yalnız yayındaki içerik indekslenir
    const i = indeksKaydi(k);
    db.prepare("INSERT INTO kutuphane_fts(rowid, baslik, govde, etiket) VALUES (?, ?, ?, ?)").run(k.id, i.baslik, i.govde, i.etiket);
  }
  db.prepare("UPDATE kutuphane SET anahtar = ?, guncelleme = datetime('now') WHERE id = ?").run(anahtarMetin(k), k.id);
  return true;
}
function isEkle(tur, icerikId) { // yinelenen iş açmadan kuyruğa ekle (partial unique index)
  try { db.prepare("INSERT INTO kutuphane_isler (tur, icerik_id) VALUES (?, ?)").run(tur, icerikId); } catch { /* aynı bekleyen iş varsa geç */ }
}
function isleriIsle({ azami = 50, azamiDeneme = 3 } = {}) { // bekleyen işleri işle (sınırlı deneme, içerik sızdırmaz)
  const isler = db.prepare("SELECT * FROM kutuphane_isler WHERE durum = 'bekliyor' ORDER BY id LIMIT ?").all(azami);
  let basarili = 0, basarisiz = 0;
  for (const is of isler) {
    try {
      if (is.tur === "sil") indeksSilUygula(is.icerik_id); else indeksGuncelleUygula(is.icerik_id);
      db.prepare("UPDATE kutuphane_isler SET durum='basarili', guncelleme=datetime('now') WHERE id=?").run(is.id);
      basarili++;
    } catch (e) {
      const deneme = (is.deneme || 0) + 1;
      const durum = deneme >= azamiDeneme ? "basarisiz" : "bekliyor"; // sınırlı deneme
      db.prepare("UPDATE kutuphane_isler SET durum=?, deneme=?, hata=?, guncelleme=datetime('now') WHERE id=?").run(durum, deneme, sinifHata(e), is.id);
    }
  }
  return { basarili, basarisiz };
}
function sinifHata(e) { // hata SINIFI yazılır; içerik/hassas veri ASLA loglanmaz
  return (e && e.code) ? String(e.code).slice(0, 40) : (e && e.name) ? String(e.name).slice(0, 40) : "HATA";
}
function ekleIsYok(tur, icerikId) { // yinelenen bekleyen iş açılmaz (kısmi benzersiz indeks)
  try { db.prepare("INSERT OR IGNORE INTO kutuphane_isler(tur, icerik_id, durum) VALUES(?, ?, 'bekliyor')").run(tur, icerikId); } catch { /* zaten bekliyor */ }
}
function indeksGuncelle(icerikId) { // hemen dene; başarısızsa iş kuyruğuna bırak (yeniden başlatmada sürer)
  try { const ok = indeksGuncelleUygula(icerikId); if (!ok) ekleIsYok("indeksle", icerikId); return ok; }
  catch (e) { ekleIsYok("indeksle", icerikId); return false; }
}
function indeksSil(icerikId) { // hemen sil; başarısızsa iş kuyruğuna bırak
  try { const ok = indeksSilUygula(icerikId); if (!ok) ekleIsYok("sil", icerikId); return ok; }
  catch (e) { ekleIsYok("sil", icerikId); return false; }
}
function indeksSilUygula(icerikId) { const k = db.prepare("SELECT id FROM kutuphane WHERE icerik_id = ?").get(icerikId); if (!k) return false; db.prepare("DELETE FROM kutuphane_fts WHERE rowid = ?").run(k.id); return true; }
function indeksiYenile() { // tüm yayındaki içeriği yeniden indeksle (bakım/geri yükleme sonrası)
  const liste = db.prepare("SELECT icerik_id FROM kutuphane WHERE durum = 'yayinda'").all();
  for (const k of liste) indeksGuncelleUygula(k.icerik_id);
  return liste.length;
}

// --- Arama (karma: filtre + sözcük + desen) ---
function boyutKosullari(filtre) {
  const parcalar = [], p = [];
  if (filtre.ders) { parcalar.push("ders = ?"); p.push(filtre.ders); }
  if (filtre.sinif) { parcalar.push("sinif = ?"); p.push(String(filtre.sinif)); }
  if (filtre.konu_id) { parcalar.push("konu_id = ?"); p.push(filtre.konu_id); }
  if (filtre.desen) { parcalar.push("desen = ?"); p.push(filtre.desen); }
  if (filtre.zorluk) { parcalar.push("zorluk = ?"); p.push(filtre.zorluk); }
  if (filtre.tur) { parcalar.push("tur = ?"); p.push(filtre.tur); }
  return { sql: parcalar.join(" AND "), params: p };
}
function ftsAdaylari(c, filtre, tavan) { // FTS5 eşleşmeleri → Map(icerik_id → bm25)
  if (!c.terimler.length) return new Map();
  const match = c.terimler.map(t => '"' + t.replace(/"/g, "") + '"' + (t.length >= 4 ? "*" : "")).join(" OR ");
  const ek = boyutKosullari(filtre);
  const sql = `SELECT k.icerik_id AS icerik_id, bm25(kutuphane_fts) AS siralama
    FROM kutuphane_fts f JOIN kutuphane k ON k.id = f.rowid
    WHERE kutuphane_fts MATCH ? AND (${c.durum.sql})${ek.sql ? " AND " + ek.sql : ""}
    ORDER BY siralama LIMIT ?`;
  try {
    const satirlar = db.prepare(sql).all(match, ...c.durum.params, ...ek.params, tavan);
    return new Map(satirlar.map(s => [s.icerik_id, s.siralama]));
  } catch (e) { return new Map(); } // bozuk sorgu → sözcük yolu atlanır (çökme yok)
}
function likeAdaylari(c, filtre, tavan) { // LIKE yedeği (türev→kök yönünde de yakalar)
  if (!c.terimler.length) return new Set();
  const ek = boyutKosullari(filtre);
  const like = c.terimler.map(() => "anahtar LIKE ?").join(" OR ");
  const sql = `SELECT icerik_id FROM kutuphane WHERE (${c.durum.sql})${ek.sql ? " AND " + ek.sql : ""} AND (${like}) LIMIT ?`;
  const p = c.terimler.map(t => "%" + t.replace(/[%_]/g, m => "\\" + m) + "%");
  try { return new Set(db.prepare(sql).all(...c.durum.params, ...ek.params, ...p, tavan).map(s => s.icerik_id)); }
  catch (e) { return new Set(); }
}
function puanla(k, c, siralama) { // tek içerik için skor + "neden" gerekçeleri
  const neden = []; let s = 0;
  const katBaslik = trKatla(k.baslik), katAnahtar = k.anahtar || anahtarMetin(k);
  let eslesen = 0;
  for (const t of c.terimler) if (katAnahtar.includes(t)) eslesen++;
  if (c.terimler.length) { const o = eslesen / c.terimler.length; if (o > 0) { s += 0.5 * o; neden.push(`Aranan ${c.terimler.length} terimden ${eslesen} tanesi içerikte geçiyor`); } }
  if (siralama !== undefined && siralama < 0) { s += Math.min(0.4, 0.4 * (1 / (1 + (-siralama)))); neden.push("Sözcük indeksinde güçlü eşleşme"); }
  if (katBaslik && c.terimler.some(t => katBaslik.includes(t))) neden.push("Başlıkta aranan terim var");
  if (c.konu_id && k.konu_id === c.konu_id) { s += 0.3; neden.push("Konu eşleşiyor: " + k.konu); }
  if (c.desen && k.desen && k.desen === c.desen) { s += 0.25; neden.push("Soru deseni uyuşuyor: " + k.desen); }
  if (c.ders && k.ders === c.ders) { s += 0.1; neden.push("Ders: " + k.ders); }
  if (c.zorluk && k.zorluk === c.zorluk) { s += 0.05; neden.push("Zorluk: " + k.zorluk); }
  s += 0.1 * (Number(k.kalite) || 0); // kalite katkısı (düşük ağırlık)
  if (k.tur === c.turTercih) s += 0.05;
  if (!neden.length) neden.push("Yapısal filtreye uyuyor");
  return { skor: Math.round(s * 1000) / 1000, neden };
}
function ara(sec = {}) { // dışa açık arama
  const kapsam = kapsamDuzelt(sec.kapsam || "uye");
  const konular = sec.konular || konuListesi();
  const cozum = sorguCoz(sec.metin || "", konular);
  const filtre = {
    ders: sec.ders || cozum.ders || "", sinif: sec.sinif || "",
    konu_id: sec.konu_id || cozum.konu_id || "", desen: sec.desen || cozum.desen || "",
    zorluk: sec.zorluk || cozum.zorluk || "", tur: sec.tur || ""
  };
  const limit = Math.min(Math.max(Number(sec.limit) || 10, 1), 50);
  const offset = Math.max(Number(sec.offset) || 0, 0);
  const durum = durumKosulu({ kapsam, durum: sec.durum });
  const c = { ...cozum, ...filtre, durum, turTercih: sec.turTercih || "cozum" };
  const tavan = 400;
  const fts = ftsAdaylari({ ...c, terimler: cozum.terimler }, filtre, tavan);
  const like = likeAdaylari({ ...c, terimler: cozum.terimler }, filtre, tavan);
  const idler = new Set([...fts.keys(), ...like.keys()]);
  let satirlar = [];
  if (idler.size) {
    const yer = [...idler].slice(0, 400).map(() => "?").join(",");
    satirlar = db.prepare(`SELECT * FROM kutuphane WHERE icerik_id IN (${yer})`).all(...[...idler].slice(0, 400));
  } else { // aday yok (sorgu yok ya da terim eşleşmedi): yalnız filtreyle listele
    const ek = boyutKosullari(filtre);
    satirlar = db.prepare(`SELECT * FROM kutuphane WHERE (${durum.sql})${ek.sql ? " AND " + ek.sql : ""} ORDER BY kalite DESC, id DESC LIMIT 400`).all(...durum.params, ...ek.params);
  }
  const puanli = satirlar
    .filter(k => gorunurMu(k, kapsam)) // GÜNCEL erişim yeniden doğrulanır (önbellek/aday sızıntısı yok)
    .map(k => {
      const { skor, neden } = puanla(k, c, fts.get(k.icerik_id));
      return { ...k, adimlar: diziJSON(k.adimlar), etiketler: diziJSON(k.etiketler), skor, neden };
    })
    .filter(k => (cozum.terimler.length === 0) || k.skor > 0) // terim verildiyse alakasızları at
    .sort((a, b) => b.skor - a.skor || b.id - a.id);
  const toplam = puanli.length;
  const sonuclar = puanli.slice(offset, offset + limit);
  return { toplam, sonuclar, cozum: { terimler: cozum.terimler, ders: filtre.ders, konu_id: filtre.konu_id, konu: cozum.konu, desen: filtre.desen, zorluk: filtre.zorluk, sinif: filtre.sinif }, sayfa: { limit, offset, sonraki: offset + limit < toplam ? offset + limit : null } };
}
function tekGetir(icerikId, kapsam = "uye") { // tek içerik (erişim kapsamına uyar)
  const k = db.prepare("SELECT * FROM kutuphane WHERE icerik_id = ?").get(icerikId);
  if (!gorunurMu(k, kapsam)) return null; // gizli/silinmiş/taslak/uygun olmayan görünüm → YOK
  return { ...k, adimlar: diziJSON(k.adimlar), etiketler: diziJSON(k.etiketler) };
}

// --- İçe aktarma: doğrulama + yinelenen tespiti + önizleme ---
const kayitSemasi = z.object({
  icerik_id: z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9\-_]+$/, "icerik_id kucuk harf, rakam, tire olmali"),
  baslik: z.string().min(3).max(200),
  ozet: z.string().max(600).optional().default(""),
  ders: z.string().min(2).max(40),
  sinif: z.union([z.string().max(10), z.number()]).optional().default(""),
  konu_id: z.preprocess(v => v == null || v === "" ? undefined : String(v), z.string().max(64).optional().transform(v => v == null || v === "" ? undefined : (v === "" ? undefined : v))),
  konu: z.preprocess(v => v == null || v === "" ? undefined : String(v), z.string().max(120).optional()),
  desen: z.preprocess(v => v == null || v === "" ? undefined : String(v), z.string().max(64).optional()),
  konu: z.string().max(120).transform(v => v == null || v === "" ? undefined : v).optional(),
  desen: z.string().max(64).transform(v => v == null || v === "" ? undefined : v).optional(),
  zorluk: z.enum(ZORLUKLAR).optional().default("orta"),
  tur: z.enum(TURLER).optional().default("konu_ozeti"),
  soru: z.string().max(2000).optional().default(""),
  ipucu: z.string().max(2000).optional().default(""),
  adimlar: z.array(z.string().max(500)).max(20).optional().default([]),
  cevap: z.string().max(3000).optional().default(""),
  etiketler: z.array(z.string().max(40)).max(20).optional().default([]),
  kaynak_ad: z.string().min(2).max(200), // ZORUNLU: kaynak uydurulamaz
  kaynak_url: z.string().max(300).optional().default(""),
  lisans: z.string().min(2).max(80), // ZORUNLU: lisans izlenebilir
  kalite: z.number().min(0).max(1).optional().default(0.5),
  gorunum: z.enum(GORUNUMLER).optional().default("herkes")
});
function iceAktarOnizle(kayitlar) { // doğrula + yinelenen tespit (DB'ye YAZMAZ)
  const konular = konuListesi();
  const konuIdler = new Set(konular.map(k => k.konu_id));
  const mevcutIdler = new Set(db.prepare("SELECT icerik_id FROM kutuphane").all().map(r => r.icerik_id));
  const mevcutAnahtar = new Set(db.prepare("SELECT baslik, ders, konu_id FROM kutuphane").all().map(k => trKatla(k.baslik) + "|" + trKatla(k.ders) + "|" + (k.konu_id || "")));
  const tohumIdler = new Set(ICERIKLER.map(k => k.icerik_id));
  const tohumAnahtar = new Set(ICERIKLER.map(k => trKatla(k.baslik) + "|" + trKatla(k.ders) + "|" + (k.konu_id || "")));
  const gecerli = [], hatali = [], mukerrer = [];
  const gorulenId = new Set(), gorulenAnahtar = new Set();
  kayitlar.forEach((ham, i) => {
    const satir = i + 1;
    const sonuc = kayitSemasi.safeParse(ham);
    if (!sonuc.success) { hatali.push({ satir, hatalar: sonuc.error.issues.map(x => (x.path.join(".") || "kayit") + ": " + x.message) }); return; }
    const veri = { ...sonuc.data, sinif: String(sonuc.data.sinif == "" ? "" : (sonuc.data.sinif == null ? "" : sonuc.data.sinif)) };
    if (veri.konu_id && !konular.some(k => k.konu_id === veri.konu_id)) { hatali.push({ satir, hatalar: ["konu_id tanınmıyor: " + veri.konu_id] }); return; }
    if (gorulenId.has(veri.icerik_id)) { mukerrer.push({ satir, icerik_id: veri.icerik_id, sebep: "aynı dosyada yinelenen" }); return; }
    const anahtar = trKatla(veri.baslik) + "|" + trKatla(veri.ders) + "|" + (veri.konu_id || "");
    if (mevcutIdler.has(veri.icerik_id) || tohumIdler.has(veri.icerik_id)) { mukerrer.push({ satir, icerik_id: veri.icerik_id, sebep: "icerik_id zaten var" }); return; }
    if (mevcutAnahtar.has(anahtar) || tohumAnahtar.has(anahtar) || gorulenAnahtar.has(anahtar)) { mukerrer.push({ satir, icerik_id: veri.icerik_id, sebep: "aynı başlık/ders/konu" }); return; }
    gorulenId.add(veri.icerik_id); gorulenAnahtar.add(anahtar); gecerli.push(veri);
  });
  return { toplam: kayitlar.length, gecerli: gecerli.length, hatali, mukerrer, _gecerli: gecerli, ornek: gecerli.slice(0, 5).map(k => ({ icerik_id: k.icerik_id, baslik: k.baslik, ders: k.ders })) };
}
function csvKayitlari(metin) { // basit CSV: ilk satır başlık; dizi alanları "|" ile ayrılır
  const satirlar = String(metin || "").replace(/\r/g, "").split("\n").filter(s => s.trim() !== "");
  if (satirlar.length < 2) return [];
  const ayir = s => { const c = []; let t = "", q = false; for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '"') q = !q; else if (ch === "," && !q) { c.push(t); t = ""; } else t += ch; } c.push(t); return c.map(x => x.trim()); };
  const basliklar = ayir(satirlar[0]);
  return satirlar.slice(1).map(s => {
    const h = ayir(s), o = {};
    basliklar.forEach((b, i) => {
      let v = h[i] == null ? "" : h[i];
      if (b === "adimlar" || b === "etiketler") v = v ? v.split("|").map(x => x.trim()).filter(Boolean) : [];
      if (b === "kalite") v = v ? Number(v) : 0.5;
      o[b] = v;
    });
    return o;
  });
}
function iceAktar(kayitlar, { sahip = "", bicim = "json" } = {}) { // önizlemeden sonra uygula: hepsi TASLAK girer
  const onizleme = iceAktarOnizle(kayitlar);
  const st = db.prepare(`INSERT INTO kutuphane (icerik_id, baslik, ozet, ders, sinif, konu_id, konu, desen, zorluk, tur, soru, ipucu, adimlar, cevap, etiketler, anahtar, kaynak_ad, kaynak_url, lisans, kalite, durum, sahip, ornek, gorunum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'taslak', ?, 0, ?)`);
  let eklenen = 0;
  for (const k of onizleme._gecerli) { // yalnız doğrulanmış + yinelenmeyen kayıtlar girer
    st.run(k.icerik_id, k.baslik, k.ozet, k.ders, String(k.sinif == null ? "" : k.sinif), k.konu_id || null, k.konu || null, k.desen || null, k.zorluk, k.tur, k.soru, k.ipucu, JSON.stringify(k.adimlar || []), k.cevap, JSON.stringify(k.etiketler || []), anahtarMetin(k), k.kaynak_ad, k.kaynak_url || "", k.lisans, k.kalite, sahip, k.gorunum);
    eklenen++;
  }
  db.prepare("INSERT INTO kutuphane_ice (yukleyen, bicim, toplam, eklenen, yinelenen, hatali, durum) VALUES (?, ?, ?, ?, ?, ?, 'uygulandi')").run(sahip, bicim, onizleme.toplam, eklenen, onizleme.mukerrer.length, onizleme.hatali.length);
  return { eklenen, yinelenen: onizleme.mukerrer.length, hatali: onizleme.hatali.length };
}

// --- İncele/yayınla akışı + silme ---
function durumDegistir(icerikId, hedef, { aktor = "", rol = "" } = {}) {
  if (!DURUMLAR.includes(hedef)) return { hata: "Geçersiz durum." };
  const k = db.prepare("SELECT * FROM kutuphane WHERE icerik_id = ?").get(icerikId);
  if (!k) return { hata: "İçerik bulunamadı." };
  const yetkiliYayin = ["ogretmen", "mudur", "admin"].includes(rol);
  if (hedef === "silindi" && !(rol === "admin" || k.sahip === aktor)) return { hata: "Yetkin yok." };
  if (["yayinda", "gizli"].includes(hedef) && !yetkiliYayin && k.sahip !== aktor) return { hata: "Yetkin yok." };
  if (hedef === "incelemede" && !(yetkiliYayin || k.sahip === aktor)) return { hata: "Yetkin yok." };
  if (!IZINLI_DURUMLAR[k.durum].includes(hedef)) return { hata: `Geçiş yok: ${k.durum} → ${hedef}` };
  const dogrulayan = hedef === "yayinda" && yetkiliYayin ? aktor : k.dogrulayan;
  const tarih = hedef === "yayinda" && yetkiliYayin ? db.prepare("SELECT datetime('now') t").get().t : k.dogrulama_tarihi;
  db.prepare("UPDATE kutuphane SET durum=?, dogrulayan=?, dogrulama_tarihi=?, surum=surum+1, guncelleme=datetime('now') WHERE icerik_id=?").run(hedef, dogrulayan, tarih, icerikId);
  if (hedef === "silindi") indeksSil(icerikId); else indeksGuncelle(icerikId);
  return { tamam: true, durum: hedef };
}

// --- Başlangıç seti (etiketli, kurgusal) ---
function baslangicYukle() {
  konulariYukle();
  let eklenen = 0;
  const st = db.prepare(`INSERT OR IGNORE INTO kutuphane
    (icerik_id, baslik, ozet, ders, sinif, konu_id, konu, desen, zorluk, tur, soru, ipucu, adimlar, cevap, etiketler, anahtar, kaynak_ad, kaynak_url, lisans, kalite, durum, sahip, dogrulayan, ornek, gorunum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'yayinda', 'baslangic-seti', '', 1, 'herkes')`);
  for (const k of ICERIKLER) {
    const r = st.run(k.icerik_id, k.baslik, k.ozet, k.ders, k.sinif || "", k.konu_id || "", k.konu || "", k.desen || "", k.zorluk || "orta", k.tur || "konu_ozeti", k.soru || "", k.ipucu || "", JSON.stringify(k.adimlar || []), k.cevap || "", JSON.stringify(k.etiketler || []), anahtarMetin(k), k.kaynak_ad, k.kaynak_url || "", k.lisans, Number(k.kalite) || 0.5);
    if (r.changes) eklenen++;
  }
  indeksiYenile();
  return { konu: KONULAR.length, icerik: ICERIKLER.length, eklenen };
}
function sayim() { // gerçek sayılar (uydurma yok)
  const g = d => db.prepare(`SELECT COUNT(*) c FROM kutuphane WHERE durum = ?`).get(d).c;
  return { toplam: db.prepare("SELECT COUNT(*) c FROM kutuphane").get().c, yayinda: g("yayinda"), incelemede: g("incelemede"), taslak: g("taslak"), gizli: g("gizli"), silindi: g("silindi"), konu: db.prepare("SELECT COUNT(*) c FROM konular").get().c };
}

module.exports = {
  DURUMLAR, ZORLUKLAR, TURLER, GORUNUMLER, KAPSAMLAR,
  trKatla, terimlerCikar, anahtarMetin,
  konulariYukle, konuListesi, konuBul, desenBul,
  sorguCoz, ara, tekGetir, kapsamDuzelt, gorunurMu,
  indeksGuncelle, indeksSil, indeksiYenile, isleriIsle, durumKosulu,
  kayitSemasi, iceAktarOnizle, iceAktar, csvKayitlari,
  durumDegistir, baslangicYukle, sayim
};
