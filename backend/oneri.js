// Kişiselleştirilmiş "Sana Özel" öneri çekirdeği.
// İLKELER (şeffaflık + bağımlılık yapmama):
//  - Skor, AÇIK ve AYARLANABİLİR doğrusal ağırlıklardan oluşur; her öneri "neden"ini gösterir.
//  - Tek bir tıklama skoru ŞİŞİRMEZ (sinyaller tekil; görüntüleme pozitif sinyal DEĞİL).
//  - Değişken ödül/streak/kaçırma korkusu (FOMO) YOK; sonsuz kaydırma için optimize edilmez.
//  - KAYDEDİLEN/begenilen içeriğin KENDİSİ önerilmez; onunla İLGİLİ olanlar önerilir.
//  - Misafir/demo kişiselleştirilmez (kisisel=false); sinyal saklanmaz.
//  - İmleç: sunucu tarafında sabit sıralama + anlık görüntü → sayfalar arası kayma/tekrar olmaz.
//  - GÜVENLİK: İmleç YALNIZ onu üreten kullanıcı+kapsam+filtre için geçerlidir; başka biri
//    (ya da misafir) o imleçle önceki kullanıcının listesini/ilgi alanlarını GÖREMEZ.
//  - GÜNCELİK: Önbellekteki içerik nesnesi YETKİ KANITI DEĞİLDİR; her sayfada yayın durumu ve
//    erişim YENİDEN doğrulanır (gizlenen/silinen içerik eski imleçle geri gelmez).
//  - İLGİLENMİYORUM dışlaması POZİTİF kişiselleştirmeden BAĞIMSIZDIR (yeni kullanıcıda da geçerli).
const crypto = require("crypto");
const db = require("./db");
const K = require("./kutuphane");

// Ayarlanabilir ağırlıklar (tek yerden değişir; test edilebilir)
const AGIRLIK = { konu: 0.40, desen: 0.25, kalite: 0.15, tazelik: 0.10, yeni: 0.10 };
const CESITLILIK = { ders: 0.15, konu: 0.10 }; // aynı ders/konu tekrarında düşüş (MMR benzeri)
const SINYAL_AGIRLIK = { begen: 1.0, kaydet: 1.4, "daha-fazla": 0.8, "konu-sec": 1.2, ilgilenmiyorum: -1.5 };
const POZITIF = ["begen", "kaydet", "daha-fazla", "konu-sec"];
const GECERLI_SINYAL = ["begen", "kaydet", "daha-fazla", "ilgilenmiyorum", "konu-sec", "kapat", "ac"];
const ONBELLEK = new Map(); // imleç token'ı → { kullanici, kapsam, filtre, idler, kisisel, y, zaman }
const ONBELLEK_AZAMI = 200, ONBELLEK_OMUR = 10 * 60 * 1000;
const IMLEC_AZAMI = 100000; // offset üst sınırı (kaynak tüketimini/kaçışı engeller)

function sinyalleriAl(kullanici) { return db.prepare("SELECT * FROM ilgi_sinyalleri WHERE kullanici = ?").all(kullanici); }
function kapaliMi(sinyaller) { return sinyaller.some(s => s.sinyal === "kapat"); }
function dizi(e) { try { const a = typeof e === "string" ? JSON.parse(e || "[]") : (e || []); return Array.isArray(a) ? a : []; } catch { return []; } }

function yakinlik(sinyaller) { // konu/ders/desen yakınlığı + hariç tutulan/kayıtlı kümeler
  const konu = {}, ders = {}, desen = {}, haric = new Set(), kayitli = new Set();
  for (const s of sinyaller) {
    const a = SINYAL_AGIRLIK[s.sinyal] != null ? SINYAL_AGIRLIK[s.sinyal] : 0;
    const k = s.sinyal === "konu-sec" ? s.icerik_id : s.konu_id; // konu seçiminde hedef konu
    if (k) konu[k] = (konu[k] || 0) + a;
    if (s.ders) ders[s.ders] = (ders[s.ders] || 0) + a;
    if (s.desen) desen[s.desen] = (desen[s.desen] || 0) + a;
    if (s.sinyal === "ilgilenmiyorum" && s.icerik_id) haric.add(s.icerik_id);
    if ((s.sinyal === "kaydet" || s.sinyal === "begen") && s.icerik_id) kayitli.add(s.icerik_id);
  }
  const norm = m => { const degerler = Object.values(m).map(v => Math.abs(v)); const en = Math.max(1, ...degerler); return x => (x ? (m[x] || 0) / en : 0); };
  return { konu, ders, desen, haric, kayitli, konuN: norm(konu), dersN: norm(ders), desenN: norm(desen) };
}
// Kişiselleştirme KAPALIYSA konu/ders/desen katkısı sıfırlanır; AMA sert dışlamalar
// (ilgilenmiyorum + kaydedilen) KORUNUR. Böylece "ilgilenmiyorum" pozitif sinyal olmasa da uygulanır.
function skorYakinligi(y, kisisel) {
  if (kisisel) return y;
  return { ...y, konuN: () => 0, dersN: () => 0, desenN: () => 0 };
}
function gunFark(ts) { // tazelik için gün farkı
  if (!ts) return 999;
  const t = Date.parse(String(ts).replace(" ", "T") + (String(ts).includes("T") ? "" : "Z"));
  if (isNaN(t)) return 999;
  return Math.max(0, (Date.now() - t) / 86400000);
}
function gorulenler(kullanici) { const m = new Set(); for (const r of db.prepare("SELECT icerik_id FROM oneri_gecmis WHERE kullanici = ?").all(kullanici)) m.add(r.icerik_id); return m; }

function puanla(k, y, gor) { // tek içerik için şeffaf skor + gerekçe
  const neden = []; let s = 0;
  const konuP = y.konuN(k.konu_id), desenP = y.desenN(k.desen), dersP = y.dersN(k.ders);
  if (konuP > 0) { s += AGIRLIK.konu * konuP; neden.push("İlgi alanın: " + (k.konu || k.konu_id)); }
  else if (dersP > 0) { s += AGIRLIK.konu * 0.5 * dersP; neden.push("İlgilendiğin ders: " + k.ders); }
  if (desenP > 0) { s += AGIRLIK.desen * desenP; neden.push("Benzer soru deseni: " + k.desen); }
  s += AGIRLIK.kalite * (Number(k.kalite) || 0); if ((Number(k.kalite) || 0) >= 0.6) neden.push("Yüksek kalite puanı");
  const tz = 1 / (1 + gunFark(k.guncelleme) / 30); s += AGIRLIK.tazelik * tz; if (tz > 0.7) neden.push("Yeni/güncel içerik");
  if (!gor.has(k.icerik_id)) { s += AGIRLIK.yeni; neden.push("Daha önce göstermedik"); }
  if (!neden.length) neden.push("Kütüphaneden çeşitlendirilmiş seçim");
  return { skor: s, neden };
}
// MMR benzeri çeşitlilik: her adımda "etkin skor" en yüksek adayı seç (deterministik)
function cesitliSirala(adaylar, y, gor) {
  const kalan = adaylar.map(k => { const p = puanla(k, y, gor); return { k, temel: p.skor, neden: p.neden }; });
  const secili = [], dersSay = {}, konuSay = {};
  while (kalan.length) {
    let en = 0;
    for (let i = 1; i < kalan.length; i++) {
      const ei = kalan[i].temel - CESITLILIK.ders * (dersSay[kalan[i].k.ders] || 0) - CESITLILIK.konu * (konuSay[kalan[i].k.konu_id] || 0);
      const bi = kalan[en].temel - CESITLILIK.ders * (dersSay[kalan[en].k.ders] || 0) - CESITLILIK.konu * (konuSay[kalan[en].k.konu_id] || 0);
      if (ei > bi + 1e-9) en = i;
    }
    const sec = kalan.splice(en, 1)[0];
    dersSay[sec.k.ders] = (dersSay[sec.k.ders] || 0) + 1;
    konuSay[sec.k.konu_id] = (konuSay[sec.k.konu_id] || 0) + 1;
    secili.push({ ...sec.k, skor: Math.round(sec.temel * 1000) / 1000, neden: sec.neden });
  }
  return secili;
}
function adayHavuzu(kapsam, y) { // erişilebilir; ilgilenmiyorum + zaten kayıtlı olanlar çıkarılır
  const d = K.durumKosulu({ kapsam }); // TEK imza: nesne (eskiden konumsal hata vardı)
  return db.prepare(`SELECT * FROM kutuphane WHERE (${d.sql})`).all(...d.params)
    .filter(k => !y.haric.has(k.icerik_id) && !y.kayitli.has(k.icerik_id));
}
function onerileriHesapla(kullanici, kapsam, filtre) {
  const misafir = !kullanici;
  const sinyaller = misafir ? [] : sinyalleriAl(kullanici);
  const kisisel = !misafir && !kapaliMi(sinyaller) && sinyaller.some(s => POZITIF.includes(s.sinyal));
  const y = yakinlik(sinyaller); // sert dışlamalar HER ZAMAN hesaplanır (pozitif sinyal şart DEĞİL)
  const sirali = cesitliSirala(adayHavuzu(kapsam, y), skorYakinligi(y, kisisel), misafir ? new Set() : gorulenler(kullanici));
  return { idler: sirali.map(k => k.icerik_id), kisisel, misafir, y };
}
function onbellekToken() { const t = crypto.randomBytes(9).toString("base64url"); if (ONBELLEK.size >= ONBELLEK_AZAMI) { const ilk = ONBELLEK.keys().next().value; ONBELLEK.delete(ilk); } return t; }
// Kullanıcının ilgi sinyalleri değişince o kullanıcının TÜM önbellek anlık görüntüleri geçersiz olur.
function onbellekGecersiz(kullanici) {
  if (!kullanici) return; // misafir anlık görüntüleri kişiye bağlı değildir
  for (const [t, k] of ONBELLEK) if (k.kullanici === kullanici) ONBELLEK.delete(t);
}
// İmleç çözümü: token + ZORUNLU negatif olmayan tamsayı offset. Bozuk/negatif → 400.
function imlecCoz(imlec) {
  const s = String(imlec == null ? "" : imlec);
  const nokta = s.indexOf(".");
  const token = nokta >= 0 ? s.slice(0, nokta) : s;
  const ofsHam = nokta >= 0 ? s.slice(nokta + 1) : "0";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(token)) return { hata: "Geçersiz imleç." };
  if (!/^\d+$/.test(ofsHam)) return { hata: "Geçersiz imleç konumu." }; // negatif/ondalık/harf REDDEDİLİR
  const offset = Number(ofsHam);
  if (!Number.isSafeInteger(offset) || offset > IMLEC_AZAMI) return { hata: "İmleç konumu sınır dışında." };
  return { token, offset };
}
// Güncel erişilebilir satırları topla (parçalı IN; önbellekteki içerik KANIT DEĞİL).
function guncelGorunur(idler, kapsam) {
  const m = new Map();
  for (let i = 0; i < idler.length; i += 400) {
    const parca = idler.slice(i, i + 400);
    if (!parca.length) continue;
    const yer = parca.map(() => "?").join(",");
    const satirlar = db.prepare(`SELECT * FROM kutuphane WHERE icerik_id IN (${yer})`).all(...parca);
    for (const k of satirlar) if (K.gorunurMu(k, kapsam)) m.set(k.icerik_id, k);
  }
  return m;
}
function aciklama(kisisel, misafir) {
  if (misafir) return "Misafir görünümü: kişiselleştirme kapalı; içerikler kalite ve çeşitliliğe göre sıralanır.";
  if (!kisisel) return "Öneriler kalite ve çeşitliliğe göre sıralanır; ilgi alanı ekleyince kişiselleşir. İlgilenmediğin içerikler yine de listeden çıkarılır.";
  return "Skor = konu yakınlığı (0.40) + desen benzerliği (0.25) + kalite (0.15) + tazelik (0.10) + yeni görülme (0.10); aynı ders/konu tekrarında çeşitlilik düşüşü uygulanır.";
}
function oneriAl(kullanici, { limit = 10, imlec = "", kapsam = "uye", filtre = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const ka = K.kapsamDuzelt(kapsam); // kapsam normalize (bilinmeyen → misafir)
  const kullaniciKim = kullanici || null;
  const filtreKim = filtre ? JSON.stringify(filtre) : "";
  let c = null;
  if (imlec) { c = imlecCoz(imlec); if (c.hata) return { hata: c.hata, kod: 400 }; } // bozuk/negatif imleç → 400
  let kayit = null;
  if (c) { // imleç var: SAHİPLİK + KAPSAM + FİLTRE + SÜRE doğrulanır
    kayit = ONBELLEK.get(c.token) || null;
    if (!kayit || Date.now() - kayit.zaman >= ONBELLEK_OMUR) { if (kayit) ONBELLEK.delete(c.token); return { hata: "İmlecin süresi doldu; lütfen listeyi yeniden yükleyin.", kod: 410 }; }
    if (kayit.kullanici !== kullaniciKim || kayit.kapsam !== ka || kayit.filtre !== filtreKim) {
      return { hata: "İmleç bu oturuma ait değil.", kod: 403 }; // başka kullanıcı/misafir önbelleği OKUNAMAZ
    }
    kayit.zaman = Date.now();
  }
  if (!kayit) { // taze anlık görüntü
    const h = onerileriHesapla(kullaniciKim, ka, filtreKim);
    const token = onbellekToken();
    kayit = { kullanici: kullaniciKim, kapsam: ka, filtre: filtreKim, idler: h.idler, kisisel: h.kisisel, y: h.y, zaman: Date.now() };
    ONBELLEK.set(token, kayit);
    c = { token, offset: 0 };
  }
  // Her sayfada: GÜNCEL erişim + GÜNCEL içerik + sert dışlamalar (ilgilenmiyorum/kayıtlı) uygulanır.
  const guncel = guncelGorunur(kayit.idler, ka);
  const ySkor = skorYakinligi(kayit.y, kayit.kisisel);
  const gor = kullaniciKim ? gorulenler(kullaniciKim) : new Set();
  const gorunur = [];
  for (const id of kayit.idler) {
    if (kayit.y.haric.has(id) || kayit.y.kayitli.has(id)) continue; // önbellekte olsa da dışlanan geri gelmez
    const k = guncel.get(id);
    if (!k) continue; // silinmiş/gizlenmiş/erişilemez → ATLA (eski başlık/özet/cevap sızmaz)
    const p = puanla(k, ySkor, gor); // gerekçe GÜNCEL içerikten yeniden hesaplanır
    gorunur.push({ ...k, adimlar: dizi(k.adimlar), etiketler: dizi(k.etiketler), skor: Math.round(p.skor * 1000) / 1000, neden: p.neden });
  }
  const offset = c ? c.offset : 0;
  const dilim = gorunur.slice(offset, offset + lim); // offset GÖRÜNÜR listeye uygulanır (kayma/tekrar yok)
  if (kullaniciKim && dilim.length) {
    const st = db.prepare("INSERT INTO oneri_gecmis(kullanici, icerik_id, gorulme) VALUES(?, ?, 1) ON CONFLICT(kullanici, icerik_id) DO UPDATE SET gorulme = gorulme + 1, tarih = datetime('now')");
    for (const k of dilim) st.run(kullaniciKim, k.icerik_id);
  }
  const sonraki = offset + lim < gorunur.length ? c.token + "." + (offset + lim) : null;
  return { kisisel: kayit.kisisel, misafir: !kullaniciKim, toplam: gorunur.length, sonuclar: dilim, sonraki_imlec: sonraki, aciklama: aciklama(kayit.kisisel, !kullaniciKim) };
}

// --- Sinyal yazma (şişme yok: tekil satır; beğen/kaydet geri alınınca satır SİLİNİR) ---
function sinyalYaz(kullanici, { icerik_id = "", sinyal, konu_id = "" } = {}) {
  if (!kullanici) return { hata: "Giriş yapmalısın." };
  if (!GECERLI_SINYAL.includes(sinyal)) return { hata: "Geçersiz sinyal." };
  let ders = "", kn = konu_id, desen = "", tur = "kutuphane";
  if (sinyal === "konu-sec") { tur = "konu"; kn = konu_id || icerik_id; }
  else if (icerik_id) {
    const k = db.prepare("SELECT ders, konu_id, desen FROM kutuphane WHERE icerik_id = ?").get(icerik_id);
    if (!k) return { hata: "İçerik bulunamadı." };
    ders = k.ders; kn = k.konu_id; desen = k.desen;
  }
  if (sinyal === "begen" || sinyal === "kaydet") { // geri alma: aynı sinyal varsa sil (katkı sıfırlanır, şişmez)
    const varOlan = db.prepare("SELECT id FROM ilgi_sinyalleri WHERE kullanici=? AND icerik_tur=? AND icerik_id=? AND sinyal=?").get(kullanici, tur, icerik_id, sinyal);
    if (varOlan) { db.prepare("DELETE FROM ilgi_sinyalleri WHERE id=?").run(varOlan.id); onbellekGecersiz(kullanici); return { tamam: true, geri_alindi: true, sinyal }; }
  }
  db.prepare(`INSERT INTO ilgi_sinyalleri(kullanici, icerik_tur, icerik_id, sinyal, ders, konu_id, desen, agirlik)
    VALUES(?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(kullanici, icerik_tur, icerik_id, sinyal) DO UPDATE SET ders=excluded.ders, konu_id=excluded.konu_id, desen=excluded.desen, tarih=datetime('now')`)
    .run(kullanici, tur, icerik_id, sinyal, ders, kn, desen); // TEKRAR tıklama satır eklemez → ağırlık şişmez
  onbellekGecersiz(kullanici); // ilgi değişti → eski anlık görüntüler geçersiz
  return { tamam: true, sinyal };
}
function kapat(kullanici, kapali) { // kişiselleştirmeyi kapat/aç
  if (!kullanici) return { hata: "Giriş yapmalısın." };
  if (kapali) { db.prepare("INSERT OR IGNORE INTO ilgi_sinyalleri(kullanici, icerik_tur, icerik_id, sinyal, agirlik) VALUES(?, 'genel', '', 'kapat', 1)").run(kullanici); onbellekGecersiz(kullanici); return { tamam: true, kapatildi: true }; }
  db.prepare("DELETE FROM ilgi_sinyalleri WHERE kullanici=? AND sinyal='kapat'").run(kullanici);
  onbellekGecersiz(kullanici);
  return { tamam: true, kapatildi: false };
}
function gecmisiSifirla(kullanici) { // öneri geçmişi + ilgi sinyalleri (kapat ayarı KORUNUR) silinir
  if (!kullanici) return { hata: "Giriş yapmalısın." };
  const a = db.prepare("DELETE FROM ilgi_sinyalleri WHERE kullanici=? AND sinyal<>'kapat'").run(kullanici);
  const b = db.prepare("DELETE FROM oneri_gecmis WHERE kullanici=?").run(kullanici);
  onbellekGecersiz(kullanici); // sıfırlama sonrası eski imleçler geçersiz
  return { tamam: true, silinen_sinyal: a.changes, silinen_gecmis: b.changes,
    kaydedilen_kapat_ayari: kapaliMi(sinyalleriAl(kullanici)),
    aciklama: "Beğeni, kaydetme, ilgilenmiyorum ve öneri geçmişi SİLİNİR. Kişiselleştirmeyi kapattıysan bu ayar KORUNUR (açmaz)." };
}
function durum(kullanici) {
  if (!kullanici) return { misafir: true, kisisel: false, kapali: true, konular: [], ilgiler: [], sinyal_sayisi: 0 };
  const s = sinyalleriAl(kullanici);
  return {
    misafir: false, kisisel: !kapaliMi(s) && s.some(x => POZITIF.includes(x.sinyal)), kapali: kapaliMi(s), sinyal_sayisi: s.length,
    konular: s.filter(x => x.sinyal === "konu-sec").map(x => x.icerik_id),
    ilgiler: [...new Set(s.filter(x => POZITIF.includes(x.sinyal) && x.konu_id).map(x => x.konu_id))]
  };
}
function benzerGetir(icerik_id, { limit = 8, kapsam = "uye" } = {}) { // "Bunun gibi daha fazla": aynı konu/desen, KENDİSİ hariç
  const ka = K.kapsamDuzelt(kapsam);
  const k = db.prepare("SELECT * FROM kutuphane WHERE icerik_id=?").get(icerik_id);
  if (!k || !K.gorunurMu(k, ka)) return { toplam: 0, sonuclar: [] }; // gizli/silinmiş kaynaktan benzer ÜRETİLMEZ
  const r = K.ara({ metin: "", konu_id: k.konu_id || "", desen: !k.konu_id ? k.desen : "", ders: !k.konu_id && !k.desen ? k.ders : "", limit: limit + 5, kapsam: ka });
  const sonuclar = r.sonuclar.filter(x => x.icerik_id !== icerik_id).slice(0, limit);
  return { toplam: sonuclar.length, sonuclar };
}
module.exports = { AGIRLIK, CESITLILIK, SINYAL_AGIRLIK, oneriAl, sinyalYaz, kapat, gecmisiSifirla, durum, benzerGetir, onbellekGecersiz };
