// Sunucu bağlantısı: ön yüz buradan backend ile konuşur
// Bilet (token) tarayıcıda saklanır, her istekte başlıkta gider
// Adres ayarlardan değişebilir (başka bilgisayardaki sunucu için)
const API = localStorage.getItem("apiAdres") || "http://127.0.0.1:3001"; // backend adresi (varsayılan: yalnız yerel)

function biletAl() { return localStorage.getItem("bilet") || ""; } // kayıtlı bilet
function biletYaz(b) { b ? localStorage.setItem("bilet", b) : localStorage.removeItem("bilet"); } // sakla/sil

// Yazma işlemleri için istek kimliği: aynı mantıksal işlemin ağ tekrarı/çift tıklaması AYNI kimliği taşır
const ucanIstekler = new Map(); // "YÖNTEM yol gövde" -> { id, zaman } (kısa ömürlü)
function istekKimligi(yol, sec) {
  if (sec.istekId) return sec.istekId; // çağıran sabit kimlik verdiyse onu kullan (kuyruk tekrarları!)
  const y = sec.yontem || "GET";
  if (y === "GET" || y === "HEAD") return ""; // okumada kimlik gerekmez
  const anahtar = y + " " + yol + " " + JSON.stringify(sec.veri || null); // aynı işlem = aynı anahtar
  const simdi = Date.now(), eski = ucanIstekler.get(anahtar);
  if (eski && simdi - eski.zaman < 4000) return eski.id; // 4 sn içinde aynı istek: kimliği KORU
  const id = "i" + simdi.toString(36) + Math.random().toString(36).slice(2, 8);
  ucanIstekler.set(anahtar, { id, zaman: simdi });
  if (ucanIstekler.size > 500) for (const [k, v] of ucanIstekler) if (simdi - v.zaman > 10000) ucanIstekler.delete(k); // eski kayıtları temizle
  return id;
}

async function istek(yol, sec = {}) { // her istek buradan geçer (zaman aşımı + iptal + şema korumalı)
  const ctrl = new AbortController(); // bu istek için iptal kolu
  const dis = sec.signal; // dışarıdan iptal (arama yarışında)
  if (dis) { if (dis.aborted) ctrl.abort(); else dis.addEventListener("abort", () => ctrl.abort(), { once: true }); } // dış iptali bağla
  const sure = setTimeout(() => ctrl.abort(), sec.zaman ?? 15000); // varsayılan 15 sn (asılı kalma yok!)
  const istekId = istekKimligi(yol, sec); // yazma tekilliği (varsa)
  try {
    const r = await fetch(API + yol, { // sunucuya sor
      method: sec.yontem || "GET", // varsayılan okuma
      signal: ctrl.signal, // iptal sinyali
      headers: { "Content-Type": "application/json", ...(biletAl() ? { Authorization: "Bearer " + biletAl() } : {}), ...(istekId ? { "X-Istek-Id": istekId } : {}) }, // bilet + istek kimliği (tekillik)
      body: sec.veri ? JSON.stringify(sec.veri) : undefined // veri varsa ekle
    });
    const j = await r.json().catch(() => { throw Object.assign(new Error("Sunucu yanıtı bozuk (JSON değil)!"), { kod: r.status }); }); // bozuk yanıtı yutma!
    const girisYolu = yol.includes("/api/giris") || yol.includes("/api/kayit"); // giriş denemesi (oturum yok ki temizlensin!)
    if (r.status === 401 && !girisYolu) { oturumTemizle(); throw Object.assign(new Error(j.hata || "Oturumun sona erdi!"), { kod: 401, islendi: true }); } // geçersiz oturum: TEMİZLE (tek bildirim!)
    if (r.status === 429) { // SPAM sınırı: bekleme süresini anlat (Retry-After başlığından da oku!)
      const bekleme = j.bekleme || +(r.headers.get("retry-after") || 0) || 30; // gövde öncelikli
      throw Object.assign(new Error((j.hata || "Çok hızlısın!") + ` (${bekleme} saniye bekle)`), { kod: 429, bekleme, islendi: true });
    }
    if (!r.ok) throw Object.assign(new Error(j.hata || "Sunucu hatası!"), { kod: r.status }); // kodlu hata (401/403 ayrımı)
    return j; // tamam
  } catch (e) {
    if (e && e.name === "AbortError") throw Object.assign(new Error(sec.sessiz ? "iptal" : "İstek zaman aşımına uğradı!"), { kod: 0, iptal: true }); // iptal/zaman aşımı
    throw e; // diğer hatalar
  } finally { clearTimeout(sure); } // sayaç temizliği
}
// Merkezi 401/403/429: istek() 401'i temizler ve429'u işler; burada yalnız söylenmemişse söyle (çift toast yok!)
async function apiCagir(fn) {
  try { return await fn(); }
  catch (e) {
    if (e && e.islendi) throw e; // istek katmanı söyledi, tekrar söyleme!
    if (e && e.kod === 401) { oturumTemizle(); toast("Oturumun sona erdi, tekrar giriş yap!"); } // geçersiz oturum
    else if (e && e.kod === 403) toast(e.message || "Bu işlem için yetkin yok!"); // yetkisiz işlem (oturum sağlam)
    else if (e && e.kod === 429) toast(e.message || "Çok hızlısın, biraz bekle!"); // spam sınırı (bekleme süresi mesajda)
    throw e; // çağıran da bilsin
  }
}
let oturumKilit = false; // temizleme tekrarına kilit (özyineleme yok!)
function oturumTemizle() { // süresi dolmuş/bozuk oturumu EKRANLA birlikte temizle
  if (oturumKilit) return; oturumKilit = true; // tek sefer
  try {
    aktif = null; biletYaz(null); MOD = "yerel"; // kimlik + bilet gider
    takipOnbellek = []; takipGiden = []; // takip önbelleği gider
    bildirimler = []; odevler = []; // ekrandaki kullanıcı verisi gider (önbellek dosyası durur!)
    if (aramaKontrol) { try { aramaKontrol.abort(); } catch { /* geç */ } } // bekleyen istek durur
    clearTimeout(araSure); clearTimeout(programPushSure); // bekleyen sayaçlar durur
    if (sohbetDurdur) { try { sohbetDurdur(); } catch { /* geç */ } sohbetDurdur = null; } // açık sohbet kapanır
    aktifSohbet = null; sohbetYaziyor = false; // sohbet durumu sıfırlanır
    localStorage.removeItem("aktifKullanici"); // kayıtlı oturum gider
    aktifGoster(); // üst yazı sıfırlanır
    if (document.getElementById("sayfaHesap").style.display === "none") sayfaGoster("hesap"); // giriş ekranına al
    else { listeleOdev(); profilGoster(); } // zaten hesaptaysan tazele
    if (typeof notlariSifirla === "function") { try { notlariSifirla(); } catch { /* geç */ } } // notlar/panel yeni (yerel) kimliğe geçsin
  } finally { oturumKilit = false; } // kilidi aç
}

// Kısa yollar: her biri bir backend ucu
const api = {
  saglik: () => istek("/api/saglik"), // yaşıyor mu
  kayit: v => istek("/api/kayit", { yontem: "POST", veri: v }), // hesap aç
  giris: v => istek("/api/giris", { yontem: "POST", veri: v }), // oturum aç
  ben: () => istek("/api/ben"), // kendi bilgim
  hocalar: () => istek("/api/hocalar"), // onaylı hocalar
  gonderiler: (q, sinyal) => istek("/api/gonderiler?" + new URLSearchParams(q || {}), { signal: sinyal }), // akış (iptal edilebilir)
  gonderiEkle: v => istek("/api/gonderiler", { yontem: "POST", veri: v }), // paylaş
  gonderiDuzenle: (id, v) => istek("/api/gonderiler/" + id, { yontem: "PUT", veri: v }), // düzenle
  gonderiSil: id => istek("/api/gonderiler/" + id, { yontem: "DELETE" }), // sil
  begen: id => istek("/api/gonderiler/" + id + "/begen", { yontem: "POST", veri: {} }), // beğen aç/kapa
  yorumEkle: (id, metin) => istek("/api/gonderiler/" + id + "/yorumlar", { yontem: "POST", veri: { metin } }), // yorum
  yanitEkle: (yorumId, metin) => istek("/api/yorumlar/" + yorumId + "/yanitlar", { yontem: "POST", veri: { metin } }), // yanıt
  enIyi: yorumId => istek("/api/yorumlar/" + yorumId + "/en-iyi", { yontem: "POST", veri: {} }), // en iyi cevap
  kaydet: id => istek("/api/gonderiler/" + id + "/kaydet", { yontem: "POST", veri: {} }), // kaydet aç/kapa
  kaydettiklerim: () => istek("/api/kaydettiklerim"), // kayıtlı liste
  sikayet: (hedefId, neden) => istek("/api/sikayet", { yontem: "POST", veri: { hedefId, neden } }), // şikayet
  adminListe: () => istek("/api/admin/kullanicilar"), // tüm kullanıcılar (admin)
  adminSikayet: () => istek("/api/admin/sikayetler"), // şikayet kuyruğu (admin)
  hocaOnay: (ad, onay) => istek("/api/admin/hoca-onay", { yontem: "POST", veri: { ad, onay } }), // hoca onayı
  aski: (ad, askida) => istek("/api/admin/aski", { yontem: "POST", veri: { ad, askida } }), // askı aç/kapa
  sikayetCozum: (id, aksiyon) => istek("/api/admin/sikayet/" + id + "/cozum", { yontem: "POST", veri: { aksiyon } }), // reddet|kaldir
  odalar: () => istek("/api/odalar"), // oda listesi
  odaAc: (ad, ders) => istek("/api/odalar", { yontem: "POST", veri: { ad, ders } }), // oda aç
  sohbetListe: () => istek("/api/sohbet"), // sohbetlerim
  sohbetAc: (baslik, ders) => istek("/api/sohbet", { yontem: "POST", veri: { baslik, ders } }), // yeni sohbet
  sohbetAdlandir: (id, baslik) => istek("/api/sohbet/" + id, { yontem: "PUT", veri: { baslik } }), // yeniden adlandır
  sohbetSil: id => istek("/api/sohbet/" + id, { yontem: "DELETE" }), // sohbet sil
  sohbetMesajlar: id => istek("/api/sohbet/" + id + "/mesajlar"), // geçmiş
  odaMesajlar: id => istek("/api/odalar/" + id + "/mesajlar"), // mesajlar
  odaMesajGonder: (id, metin) => istek("/api/odalar/" + id + "/mesajlar", { yontem: "POST", veri: { metin } }), // yaz
  odaSil: id => istek("/api/odalar/" + id, { yontem: "DELETE" }), // kapat (kurucu/admin)
  bildirimler: () => istek("/api/bildirimler"), // bana gelenler
  bildirimOkundu: () => istek("/api/bildirimler/okundu", { yontem: "POST", veri: {} }), // tümünü okundu say
  liderlik: () => istek("/api/liderlik"), // ilk 10
  profil: ad => istek("/api/kullanicilar/" + encodeURIComponent(ad)), // herkese açık profil
  takip: ad => istek("/api/takip", { yontem: "POST", veri: { ad } }), // istek gönder / geri al
  takipListe: () => istek("/api/takip"), // kabul edilen takip ettiklerim
  takipIstekler: () => istek("/api/takip/istekler"), // {gelen, giden} bekleyen istekler
  takipKarar: (ad, kabul) => istek("/api/takip/karar", { yontem: "POST", veri: { ad, kabul } }), // kabul/ret
  hocaSorular: () => istek("/api/hoca-sorulari"), // yetkime göre sorular
  hocaSor: v => istek("/api/hoca-sorulari", { yontem: "POST", veri: v }), // soru sor
  hocaCevap: (id, cevap) => istek("/api/hoca-sorulari/" + id + "/cevap", { yontem: "POST", veri: { metin: cevap } }), // hoca cevaplar
  hocaPuan: (id, puan) => istek("/api/hoca-sorulari/" + id + "/puan", { yontem: "POST", veri: { puan } }), // yıldız ver
  hocaPaylas: id => istek("/api/hoca-sorulari/" + id + "/paylas", { yontem: "POST", veri: {} }), // akışa taşı
  hocaKapat: id => istek("/api/hoca-sorulari/" + id + "/kapat", { yontem: "POST", veri: {} }), // kapat
  ogretmenVakalar: () => istek("/api/ogretmen/vakalar"), // bana atanan vakalar (hoca)
  sifreDegistir: (eski, yeni) => istek("/api/sifre-degistir", { yontem: "POST", veri: { eski, yeni } }), // şifre değiştir
  sifreUnuttum: ad => istek("/api/sifre-unuttum", { yontem: "POST", veri: { ad } }), // kurtarma isteği (e-postasız)
  denetimVakalar: () => istek("/api/denetim/vakalar"), // vaka kuyruğu (müdür/admin)
  aiDurum: () => istek("/api/ai-durum"), // denetim modu: kural mı model mi (dürüst rozet)
  denetimKarar: (id, karar, hoca) => istek("/api/denetim/vakalar/" + id + "/karar", { yontem: "POST", veri: { karar, hoca } }), // karar ver
  vakalarim: () => istek("/api/vakalarim"), // kendi vakalarım
  itiraz: (id, metin) => istek("/api/vakalar/" + id + "/itiraz", { yontem: "POST", veri: { metin } }), // itiraz et
  havuzEkle: (ders, metin) => istek("/api/havuz", { yontem: "POST", veri: { ders, metin } }), // havuza ekle
  havuzListe: () => istek("/api/havuz"), // havuz üstbilgisi
  havuzSil: id => istek("/api/havuz/" + id, { yontem: "DELETE" }), // havuzdan sil
  programGet: () => istek("/api/program"), // kendi programım
  programPut: (v, istekId) => istek("/api/program", { yontem: "PUT", veri: v, istekId }), // programı kaydet (kuyruk revizyonu sabit kimlik verir)
  denemeListe: () => istek("/api/denemeler"), // kendi denemelerim
  denemeEkle: v => istek("/api/denemeler", { yontem: "POST", veri: v }), // deneme kaydet
  denemeDuzenle: (id, v) => istek("/api/denemeler/" + id, { yontem: "PUT", veri: v }), // deneme düzenle
  denemeSil: id => istek("/api/denemeler/" + id, { yontem: "DELETE" }), // deneme sil
  denemeIceAktar: d => istek("/api/denemeler/ice-aktar", { yontem: "POST", veri: { denemeler: d } }), // toplu yükle (tekilsiz)
  notlar: () => istek("/api/notlar"), // kendi notlarım (yalnız oturumdaki kullanıcı!)
  notEkle: v => istek("/api/notlar", { yontem: "POST", veri: v }), // not oluştur (çift kayıt koruması: istek kimliği)
  notDuzenle: (id, v) => istek("/api/notlar/" + id, { yontem: "PUT", veri: v }), // not güncelle (yalnız sahibi)
  notSil: id => istek("/api/notlar/" + id, { yontem: "DELETE" }), // not sil (yalnız sahibi)
  // ---- Video çözüm uçları (yükleme ayrı: XHR ile ilerleme/iptal) ----
  videoLimit: () => istek("/api/video/limits"), // yükleme sınırları (gösterim; karar sunucuda)
  videoListe: gonderi_id => istek("/api/video?gonderi_id=" + encodeURIComponent(gonderi_id)), // onaylılar + kendi videolarım
  videoDetay: id => istek("/api/video/" + id), // durum/sahiplik
  videoSil: id => istek("/api/video/" + id, { yontem: "DELETE" }), // yazar ya da yetkili
  videoSikayet: (id, neden) => istek("/api/video/" + id + "/sikayet", { yontem: "POST", veri: { neden } }), // şikâyet (tekilleşir)
  videoKuyruk: (durum, acil) => istek("/api/video/kuyruk?durum=" + encodeURIComponent(durum || "needs_review") + (acil ? "&acil=1" : "")), // moderatör kuyruğu
  videoBulgular: id => istek("/api/video/" + id + "/bulgular"), // zaman damgalı bulgular (tahmin vs onaylı)
  videoKarar: (id, veri) => istek("/api/video/" + id + "/karar", { yontem: "POST", veri }), // onayla/reddet/değiştirme iste (gerekçe zorunlu)
  videoKisitla: (id, veri) => istek("/api/video/" + id + "/kisitla", { yontem: "POST", veri }), // süreli yükleme kısıtı (müdür/admin)
  videoItirazlar: () => istek("/api/video/itirazlar"), // açık itirazlar (moderatör)
  hesapDurum: () => istek("/api/hesap/durum"), // kendi kısıt/vaka durumum
  hesapItiraz: kisit_id => istek("/api/hesap/itiraz", { yontem: "POST", veri: { kisit_id } }), // itiraz aç
  hesapKarar: veri => istek("/api/hesap/karar", { yontem: "POST", veri }), // hesap kararı (yetkili insan)
  hesapItirazKarar: veri => istek("/api/hesap/itiraz-karar", { yontem: "POST", veri }) // itiraz kararı (yetkili)
};
// Video YÜKLEME: XHR kullanır (fetch ilerleme vermez). İlerleme + iptal + açık hata.
// DİKKAT: Dosya adı GÜVENİLMEZ; yalnız uzantı ipucu olarak gider, asıl doğrulama SUNUCUDA (bayt+süre).
function videoYukle(bilgi) {
  return new Promise((cozum, ret) => {
    const xhr = new XMLHttpRequest(); // ilerleme + iptal için
    const dosya = bilgi.dosya;
    const q = new URLSearchParams({
      gonderi_id: String(bilgi.gonderi_id || 0),
      baslik: String(bilgi.baslik || "").slice(0, 120),
      aciklama: String(bilgi.aciklama || "").slice(0, 1000),
      uzanti: (dosya && dosya.name ? (dosya.name.split(".").pop() || "").toLowerCase() : "").slice(0, 12)
    });
    xhr.open("POST", API + "/api/video/yukle?" + q.toString(), true);
    const b = biletAl(); if (b) xhr.setRequestHeader("Authorization", "Bearer " + b); // oturum
    xhr.setRequestHeader("Content-Type", (dosya && dosya.type) || "application/octet-stream"); // beyan; sunucu yine de doğrular
    xhr.setRequestHeader("X-Istek-Id", "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); // yükleme tekilliği
    xhr.upload.onprogress = e => { if (e.lengthComputable && bilgi.onIlerleme) bilgi.onIlerleme(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let j = {}; try { j = JSON.parse(xhr.responseText); } catch { j = {}; }
      if (xhr.status >= 200 && xhr.status < 300) return cozum(j);
      ret(Object.assign(new Error(j.hata || ("Yükleme başarısız (kod " + xhr.status + ")")), { kod: xhr.status, veri: j }));
    };
    xhr.onerror = () => ret(Object.assign(new Error("Bağlantı hatası: yükleme tamamlanamadı."), { kod: 0 }));
    xhr.onabort = () => ret(Object.assign(new Error("iptal"), { kod: 0, iptal: true }));
    if (bilgi.iptalKaydet) bilgi.iptalKaydet(() => { try { xhr.abort(); } catch { /* geç */ } }); // iptal kolunu dışarı ver
    xhr.send(dosya); // ham bayt (base64 YOK)
  });
}
// SSE sohbet akışı (api nesnesinden BAĞIMSIZ fonksiyon!): cb({parca}|{bitti}|{hata}), döndürücü durdurur
function sohbetAkis(id, metin, devam, uretim, cb) { // SSE akış + üretim kimliği (retry tekilliği)
  const ctrl = new AbortController(); // iptal kolu
  let terminal = false; // geçerli BİTTİ/HATA olayı yayınlandı mı? (tek terminal olay — çifte bildirim yok)
  let sureKolu = null; // duran bağlantı zaman aşımı sayacı (sınırlı bekleme)
  const yayla = o => { // YALNIZCA BİR KEZ terminal olay ver (durum makinesi burada kapanır)
    if (terminal) return;
    terminal = true; clearTimeout(sureKolu);
    try { cb(o); } catch { /* çizim hatası akışı bozmasın */ }
  };
  const sureBas = () => { // her parça sayacı sıfırlar: yalnızca GERÇEKTEN duran bağlantı biter
    clearTimeout(sureKolu);
    sureKolu = setTimeout(() => { yayla({ hata: "Yanıt uzun süredir durdu. Bağlantını kontrol et, sonra Tekrar Dene'ye bas.", zamanAsimi: true }); try { ctrl.abort(); } catch { /* geç */ } }, 45000); // sınır: 45 sn
  };
  (async () => {
    try {
      const r = await fetch(API + "/api/sohbet/" + id + "/mesaj", {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", ...(biletAl() ? { Authorization: "Bearer " + biletAl() } : {}) },
        body: JSON.stringify({ metin, devam: !!devam, uretim: uretim || "" }) // üretim kimliği gider
      });
      if (!r.ok) { // 401/403/429 SADELEŞTİRİLMİŞ AYRI MESAJLAR (sessiz/karışık değil)
        const j = await r.json().catch(() => ({})); const kod = r.status;
        if (kod === 401) { oturumTemizle(); return yayla({ hata: j.hata || "Oturumun sona erdi! Tekrar giriş yap.", kod }); }
        if (kod === 403) return yayla({ hata: j.hata || "Bu işlem için yetkin yok!", kod });
        if (kod === 429) { const b = j.bekleme || +(r.headers.get("retry-after") || 0) || 30; return yayla({ hata: (j.hata || "Çok hızlısın!") + ` (${b} saniye bekle)`, kod, bekleme: b }); }
        return yayla({ hata: j.hata || ("Sunucu hatası (" + kod + ")"), kod });
      }
      const okuyucu = r.body.getReader(), coz = new TextDecoder(); // akış okuyucu
      let tampon = ""; // terminal olaydan SONRA gelen parçalar işlenmez (geç/bozuk veri arayüzü bozmasın)
      sureBas(); // akış başladı: durursa sayaç başlar
      for (;;) {
        const { done, value } = await okuyucu.read(); // parça bekle
        if (done) break; // EOF: aşağıda bitiş KONTROL edilir (sessiz son yok!)
        sureBas(); // parça geldi: sayaç sıfırlanır
        tampon += coz.decode(value, { stream: true }); // biriktir
        let i; // tam olayları ayıkla
        while ((i = tampon.indexOf("\n\n")) >= 0) {
          const ham = tampon.slice(0, i); tampon = tampon.slice(i + 2);
          const satir = ham.split("\n").filter(x => x.startsWith("data: ")).map(x => x.slice(6)).join("");
          if (!satir) continue;
          let o = null; try { o = JSON.parse(satir); } catch { continue; } // bozuk parça geç
          if (o && (o.bitti || o.hata || o.kod)) yayla(o); // TEK terminal yol
          else if (!terminal) try { cb(o); } catch { /* geç */ }
        }
      }
      // EOF: artakalan tamponu da dene (son paket ikiye bölünmüş olabilir)
      const kalan = (tampon + coz.decode()).trim();
      if (kalan && !terminal) {
        const satir = kalan.split("\n").filter(x => x.startsWith("data: ")).map(x => x.slice(6)).join("");
        try { const o = JSON.parse(satir); if (o && (o.bitti || o.hata || o.kod)) yayla(o); } catch { /* geç */ }
      }
      // GEÇERLİ BİTİŞ OLMADAN EOF: yanıt YARIM sayılır — arayüz üretime takılı KALMAZ
      yayla({ hata: "Sunucu yanıtını tamamlamadı (yanıt yarım kaldı). Tekrar Dene'ye bas.", eksik: true, kod: 0 });
    } catch (e) {
      if (e && e.name === "AbortError") { clearTimeout(sureKolu); return; } // kullanıcının İPTALİ sessizdir (durumu durdurma düğmesi yazar)
      yayla({ hata: "Bağlantı kesildi! İnternetini kontrol et, Tekrar Dene'ye bas.", kopma: true, kod: 0 });
    } finally { clearTimeout(sureKolu); }
  })();
  return () => { ctrl.abort(); clearTimeout(sureKolu); }; // durdur
}
