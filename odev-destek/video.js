// =====================================================================================
// video.js — "Video ile çözüm ekle" ön yüzü + moderatör video paneli + hesap/itiraz akışı
// -------------------------------------------------------------------------------------
// DÜRÜSTLÜK SINIRI (rapora da yazılır):
//  • Tarayıcıdaki kontrol (boyut/biçim/süre) yalnız KOLAYLIK içindir; kesin karar SUNUCUDA
//    (gerçek bayt imzası + çözümlenen süre) verilir.
//  • Otomatik denetim bu ortamda SAĞLAYICI tanımlı değilse çalışmaz → video OTOMATİK YAYINA
//    GİRMEZ, insan incelemesinde bekler. "Kusursuz tespit" İDDİA EDİLMEZ.
//  • Oynatma: onaylı video herkese açık uçtan (Range/mobil); ONAYSIZ video yalnız yetkiliye
//    Authorization'lı blob isteğiyle yüklenir (tahmin edilebilir URL yok).
// =====================================================================================

// Yetkili roller (Türkçe; backend ogretmen/mudur/admin ile eşleşir)
const VIDEO_ROLLER = ["Öğretmen", "Müdür Yardımcısı", "Admin"];
// Yükleme sınırı önbelleği (sunucudan çekilir; çekilemezse muhafazakâr varsayılan gösterilir)
let VIDEO_LIMIT = { mb: 100, sn: 300, bicimler: ["mp4", "mov", "webm", "m4v"], yuklendi: false };

const VIDEO_DURUM_METIN = {
  uploading: "Yükleniyor",
  quarantined: "Karantinada (otomatik inceleme sırası)",
  processing: "Otomatik inceleme sürüyor",
  approved: "Yayında",
  needs_review: "İnsan incelemesinde",
  rejected: "Reddedildi",
  failed: "Otomatik inceleme tamamlanamadı"
};
function videoDurumEtiket(d) { return VIDEO_DURUM_METIN[d] || d || "?"; }
function videoSureYaz(sn) {
  if (!sn || sn <= 0) return "süre bilinmiyor";
  const dk = Math.floor(sn / 60), sn2 = Math.round(sn % 60);
  return dk + ":" + String(sn2).padStart(2, "0");
}
function videoBoyutYaz(b) {
  if (!b) return "?";
  return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
}
function videoKaynakEtiket(k) {
  return ({ konusma: "🗣️ Konuşma", ekran_yazisi: "🔤 Ekran yazısı (OCR)", goruntu: "🖼️ Görüntü", baslik_aciklama: "📝 Başlık/açıklama" })[k] || k;
}

// Sunucudaki gerçek sınırları bir kez çek (gösterim için)
async function videoLimitYukle() {
  if (VIDEO_LIMIT.yuklendi) return VIDEO_LIMIT;
  try {
    const l = await api.videoLimit();
    VIDEO_LIMIT = { mb: l.enFazlaBoyutMB || 100, sn: l.enFazlaSureSn || 300,
                    bicimler: l.desteklenenBicimler || VIDEO_LIMIT.bicimler, yuklendi: true };
  } catch { /* varsayılanı göster */ }
  return VIDEO_LIMIT;
}

// İstemci ön kontrolü (kolaylık): sorun varsa Türkçe mesaj, yoksa ""
function videoDosyaOnKontrol(dosya) {
  if (!dosya) return "Dosya seçilmedi.";
  const uz = (dosya.name.split(".").pop() || "").toLowerCase();
  if (!VIDEO_LIMIT.bicimler.includes(uz)) return "Desteklenen biçimler: " + VIDEO_LIMIT.bicimler.join(", ") + ".";
  if (dosya.size > VIDEO_LIMIT.mb * 1024 * 1024) return "Dosya çok büyük (en fazla " + VIDEO_LIMIT.mb + " MB).";
  if (dosya.size < 1024) return "Dosya çok küçük ya da boş görünüyor.";
  return "";
}

// Onaysız/özel videoyu YETKİLİ başlıkla getir (blob) — tahmin edilebilir URL yok
async function videoBlobAl(id) {
  const r = await fetch(API + "/api/video/" + id + "/izle", { headers: biletAl() ? { Authorization: "Bearer " + biletAl() } : {} });
  if (!r.ok) { let j = {}; try { j = await r.json(); } catch { /* geç */ } throw new Error(j.hata || ("Medya alınamadı (kod " + r.status + ")")); }
  return r.blob();
}

// Oynatıcı kur: <video controls> (otomatik oynatma YOK). Onaylıysa doğrudan akış;
// onaysızsa "Önizle" düğmesiyle yetkili blob. Altyazı yalnız onaylıysa ve varsa eklenir.
function videoOynatici(v, secenek) {
  secenek = secenek || {};
  const sar = document.createElement("div"); sar.className = "videoSar";
  const vid = document.createElement("video");
  vid.controls = true; vid.preload = "metadata"; vid.playsInline = true; vid.className = "videoOge";
  vid.setAttribute("controlsList", "nodownload"); // gereksiz indirmeyi azalt (kolaylık; zorlamaz)
  vid.setAttribute("aria-label", "Video çözüm: " + (v.baslik || "başlıksız"));
  if (secenek.blur) { vid.style.filter = "blur(14px)"; vid.addEventListener("play", () => { vid.style.filter = "none"; }); } // gizlilik: oynatınca netleşir
  if (v.altyazi_var) { // yalnız onaylı videoda ve varsa
    const tr = document.createElement("track");
    tr.kind = "captions"; tr.label = "Türkçe"; tr.srclang = "tr"; tr.default = true;
    tr.src = API + "/api/video/" + v.id + "/altyazi";
    vid.appendChild(tr);
  }
  sar.appendChild(vid);
  if (v.durum === "approved") { vid.src = API + "/api/video/" + v.id + "/izle"; } // herkese açık, Range destekli
  else { // onaysız: yalnız yetkili (kendi/moderatör) önizleyebilir
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "ikincil"; btn.textContent = "🔎 Önizle (yetkili)";
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Yükleniyor…";
      try { vid.src = URL.createObjectURL(await videoBlobAl(v.id)); btn.remove(); }
      catch (e) { btn.disabled = false; btn.textContent = "🔎 Önizle (yetkili)"; if (typeof toast === "function") toast(e.message || "Önizleme yüklenemedi."); }
    };
    sar.appendChild(btn);
  }
  return sar;
}

// ---- Gönderi altındaki video bölümü ----
async function videoAlanCiz(div, gonderi) {
  if (MOD !== "sunucu" || !SUNUCU || !gonderi || typeof gonderi.id !== "number") return; // yalnız sunucu modu
  const alan = document.createElement("div"); alan.className = "videoAlan";
  div.appendChild(alan);
  await videoAlanTazele(alan, gonderi);
}

async function videoAlanTazele(alan, gonderi) {
  alan.innerHTML = "<p class='ipucu'>🎥 Video çözümler yükleniyor…</p>";
  await videoLimitYukle();
  let liste = [];
  try { liste = (await api.videoListe(gonderi.id)).sonuclar || []; } catch { liste = []; }
  alan.innerHTML = "";
  if (aktif) { // yükleme düğmesi + yükleyici kabı
    const ekle = document.createElement("button"); ekle.type = "button"; ekle.className = "ikincil";
    ekle.innerHTML = '<i data-lucide="video"></i> Video ile çözüm ekle';
    const kap = document.createElement("div");
    ekle.onclick = () => {
      if (kap.firstChild) { kap.innerHTML = ""; return; } // aç/kapa
      videoYukleyiciAc(kap, gonderi, () => videoAlanTazele(alan, gonderi));
    };
    alan.append(ekle, kap);
  }
  liste.forEach(v => alan.appendChild(videoKart(v, gonderi, () => videoAlanTazele(alan, gonderi))));
  if (typeof ikonTazele === "function") ikonTazele();
}

function videoKart(v, gonderi, tazele) {
  const kart = document.createElement("div"); kart.className = "videoKart";
  const bas = document.createElement("div");
  bas.innerHTML = `<b>${htmlKacis(v.baslik || "Video çözüm")}</b> <span class="durumRozet durum-${htmlKacis(v.durum)}">${htmlKacis(videoDurumEtiket(v.durum))}</span><br><small><a href="#" data-kisi="${htmlKacis(v.yazar)}">${htmlKacis(v.yazar)}</a> • ${videoSureYaz(v.sure_sn)} • ${videoBoyutYaz(v.boyut)} • ${htmlKacis(v.bicim)}</small>`;
  kart.appendChild(bas);
  if (v.aciklama) { const p = document.createElement("p"); p.textContent = v.aciklama; kart.appendChild(p); } // düz metin (güvenli)
  if (v.oynatma) kart.appendChild(videoOynatici(v, {}));
  if ((v.sahip || v.yetkili) && v.durum !== "approved") { // kullanıcıya DÜRÜST durum + neden
    const bilgi = document.createElement("p"); bilgi.className = "ipucu";
    bilgi.textContent = v.durum === "needs_review" ? "Herkese açılmadı; insan incelemesi bekliyor."
      : v.durum === "quarantined" ? "Karantinada; otomatik inceleme sırada."
      : v.durum === "processing" ? "Otomatik inceleme sürüyor."
      : v.durum === "rejected" ? "Reddedildi." : v.durum === "failed" ? "Otomatik inceleme tamamlanamadı; insan incelemesi gerekiyor." : "";
    kart.appendChild(bilgi);
    const neden = v.red_nedeni || v.karar_gerekce;
    if (neden) { const n = document.createElement("p"); n.className = "ipucu"; n.textContent = "Neden: " + neden; kart.appendChild(n); }
  }
  if (aktif && !v.sahip && v.durum === "approved") { // şikâyet (başkasının onaylı videosu)
    const sb = document.createElement("button"); sb.type = "button"; sb.className = "ikincil"; sb.textContent = "🚩 Bildir";
    sb.onclick = () => videoSikayet(v.id, tazele);
    kart.appendChild(sb);
  }
  if (aktif && (v.sahip || VIDEO_ROLLER.includes(aktif.rol))) { // silme: yazar ya da yetkili
    const db = document.createElement("button"); db.type = "button"; db.className = "tehlike"; db.textContent = "🗑️ Sil";
    db.onclick = async () => {
      if (!window.confirm("Bu video ve tüm türev dosyaları (kapak/altyazı) silinsin mi?")) return;
      try { await api.videoSil(v.id); if (typeof toast === "function") toast("Video silindi."); tazele(); }
      catch (e) { if (typeof toast === "function") toast(e.message); }
    };
    kart.appendChild(db);
  }
  kart.querySelectorAll("[data-kisi]").forEach(a => a.onclick = e => { e.preventDefault(); goruntulenen = a.dataset.kisi; sayfaGoster("profil"); });
  return kart;
}

async function videoSikayet(id, tazele) {
  const neden = window.prompt("Bildirme nedenin (en az 5 karakter):", "");
  if (neden === null) return;
  if (neden.trim().length < 5) { if (typeof toast === "function") toast("Neden en az 5 karakter olmalı."); return; }
  try {
    const r = await api.videoSikayet(id, neden.trim());
    if (typeof toast === "function") toast(r.yeni ? "Bildirimin alındı; moderatör bakacak." : "Bu videoyu daha önce bildirmiştin.");
    tazele && tazele();
  } catch (e) { if (typeof toast === "function") toast(e.message); }
}

// ---- Yükleme arayüzü: seç → yerel önizleme → ilerleme/iptal/tekrar ----
function videoYukleyiciAc(kap, gonderi, tazele) {
  kap.innerHTML = "";
  const kutu = document.createElement("div"); kutu.className = "kutu videoYukleyici";
  const bas = document.createElement("b"); bas.textContent = "🎥 Video ile çözüm ekle";
  const sinir = document.createElement("p"); sinir.className = "ipucu";
  sinir.textContent = `Süre en fazla ${Math.round(VIDEO_LIMIT.sn / 60)} dk • Boyut en fazla ${VIDEO_LIMIT.mb} MB • Biçim: ${VIDEO_LIMIT.bicimler.join(", ")}`;
  const gizlilik = document.createElement("p"); gizlilik.className = "ipucu";
  gizlilik.textContent = "🔒 Yüklediğin video OTOMATİK yayına girmez; önce incelemeye alınır. Çözümü yazıyla anlatmanı öneririz; yüzünü ya da başkalarını çekmekten, sınıf arkadaşlarının bilgilerini göstermekten kaçın.";
  const girdi = document.createElement("input"); girdi.type = "file"; girdi.accept = "video/mp4,video/quicktime,video/webm,video/x-m4v,video/*"; girdi.setAttribute("aria-label", "Video dosyası seç");
  const oniz = document.createElement("div"); oniz.className = "videoOniz";
  const baslik = document.createElement("input"); baslik.placeholder = "Kısa başlık (isteğe bağlı)"; baslik.maxLength = 120; baslik.setAttribute("aria-label", "Video başlığı");
  const aciklama = document.createElement("textarea"); aciklama.placeholder = "Kısa açıklama (isteğe bağlı)"; aciklama.maxLength = 1000; aciklama.rows = 3; aciklama.setAttribute("aria-label", "Video açıklaması");
  const ilerleme = document.createElement("progress"); ilerleme.max = 100; ilerleme.value = 0; ilerleme.style.display = "none"; ilerleme.setAttribute("aria-label", "Yükleme ilerlemesi");
  const durum = document.createElement("p"); durum.className = "ipucu"; durum.setAttribute("role", "status"); durum.setAttribute("aria-live", "polite");
  const gonder = document.createElement("button"); gonder.type = "button"; gonder.textContent = "Yükle";
  const iptal = document.createElement("button"); iptal.type = "button"; iptal.className = "ikincil"; iptal.textContent = "İptal"; iptal.style.display = "none";
  const kapat = document.createElement("button"); kapat.type = "button"; kapat.className = "ikincil"; kapat.textContent = "Kapat";

  let secilen = null, iptalEtFn = null, onizUrl = null;

  girdi.onchange = () => {
    oniz.innerHTML = "";
    if (onizUrl) { URL.revokeObjectURL(onizUrl); onizUrl = null; }
    secilen = girdi.files && girdi.files[0] ? girdi.files[0] : null;
    if (!secilen) { durum.textContent = ""; return; }
    const hata = videoDosyaOnKontrol(secilen);
    if (hata) { durum.textContent = "⚠️ " + hata; secilen = null; return; }
    onizUrl = URL.createObjectURL(secilen);
    const vid = document.createElement("video"); vid.controls = true; vid.preload = "metadata"; vid.src = onizUrl; vid.playsInline = true; vid.className = "videoOge";
    vid.setAttribute("aria-label", "Seçilen videonun önizlemesi");
    oniz.appendChild(vid);
    durum.textContent = "Yüklemeye hazır. Süre denetleniyor…";
    vid.onloadedmetadata = () => {
      if (vid.duration && vid.duration > VIDEO_LIMIT.sn) { durum.textContent = "⚠️ Video çok uzun (en fazla " + Math.round(VIDEO_LIMIT.sn / 60) + " dk)."; secilen = null; return; }
      durum.textContent = "Hazır. 'Yükle' ile incelemeye gönder.";
    };
    vid.onerror = () => { durum.textContent = "⚠️ Bu dosya tarayıcıda açılamadı (bozuk ya da desteklenmeyen biçim)."; secilen = null; };
  };

  gonder.onclick = async () => {
    if (!secilen) { if (typeof toast === "function") toast("Önce bir video seç."); return; }
    gonder.disabled = true; iptal.style.display = ""; ilerleme.style.display = ""; ilerleme.value = 0;
    durum.textContent = "Yükleniyor…";
    try {
      const r = await videoYukle({
        gonderi_id: gonderi.id, dosya: secilen, baslik: baslik.value.trim(), aciklama: aciklama.value.trim(),
        onIlerleme: p => { ilerleme.value = p; durum.textContent = "Yükleniyor… %" + p; },
        iptalKaydet: fn => { iptalEtFn = fn; iptal.onclick = () => fn(); }
      });
      durum.textContent = "✅ " + (r.mesaj || "Video karantinaya alındı.");
      if (typeof toast === "function") toast("Video yüklendi; incelemede.");
      setTimeout(() => { tazele && tazele(); }, 1400); // durum kısa süre sonra netleşir
    } catch (e) {
      if (e && e.iptal) { durum.textContent = "Yükleme iptal edildi. Yeniden deneyebilirsin."; }
      else { durum.textContent = "⚠️ " + (e.message || "Yükleme başarısız."); gonder.textContent = "🔁 Tekrar dene"; if (typeof toast === "function") toast(e.message); }
    } finally {
      gonder.disabled = false; iptal.style.display = "none"; iptalEtFn = null;
    }
  };
  kapat.onclick = () => { if (iptalEtFn) { try { iptalEtFn(); } catch { /* geç */ } } if (onizUrl) URL.revokeObjectURL(onizUrl); kap.innerHTML = ""; };

  kutu.append(bas, sinir, gizlilik, girdi, oniz, baslik, aciklama, ilerleme, durum, gonder, iptal, kapat);
  kap.appendChild(kutu);
}

// =====================================================================================
// MODERATÖR VİDEO PANELİ (denetim sayfasına eklenir)
// =====================================================================================
function videoBulguSatir(b) {
  const d = document.createElement("div"); d.className = "bulgu" + (b.onayli ? " onayli" : "");
  const guven = Math.round((b.guven || 0) * 100);
  const zaman = (b.zaman_bas || b.zaman_bit) ? "⏱️ " + videoSureYaz(b.zaman_bas) + "–" + videoSureYaz(b.zaman_bit) + " • " : "";
  d.innerHTML = `<b>${b.onayli ? "✅ Onaylı ihlal" : "🤖 Model tahmini"}</b> — ${htmlKacis(videoKaynakEtiket(b.kaynak))} • ${htmlKacis(b.kategori)} • şiddet: ${htmlKacis(b.siddet)} • güven: %${guven}<br><small>${htmlKacis(zaman + (b.aciklama || ""))}</small>`;
  if (!b.onayli) { const s = document.createElement("small"); s.className = "ipucu"; s.textContent = " (düşük güven tek başına ceza değildir)"; d.appendChild(s); }
  return d;
}

async function videoModeratorCiz() {
  const alan = document.getElementById("videoDenetim");
  if (!alan) return;
  if (MOD !== "sunucu" || !SUNUCU || !aktif || !VIDEO_ROLLER.includes(aktif.rol)) { alan.innerHTML = ""; return; }
  alan.innerHTML = "";
  const h = document.createElement("h3"); h.textContent = "🎥 Video çözüm incelemesi"; alan.appendChild(h);
  const ip = document.createElement("p"); ip.className = "ipucu";
  ip.textContent = "Otomatik bulgular TAHMİNDİR ve tek başına ceza DEĞİLDİR. Onaya kadar video herkese kapalıdır. Kalıcı hesap yaptırımı yalnız yetkili insan kararıyla verilir; şikâyet SAYISI cezayı çoğaltmaz.";
  alan.appendChild(ip);
  const filtre = document.createElement("div"); filtre.className = "videoFiltre";
  const liste = document.createElement("div");
  const ciz = sec => videoDenetimListele(liste, sec);
  [["needs_review", "🕓 Bekleyen"], ["acil", "🔴 Acil"], ["approved", "✅ Onaylanan"], ["rejected", "⛔ Reddedilen"], ["quarantined", "📦 Karantina"]]
    .forEach(([anahtar, etiket]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "ikincil"; b.textContent = etiket;
      b.onclick = () => ciz(anahtar);
      filtre.appendChild(b);
    });
  alan.append(filtre, liste);
  await videoItirazCiz(alan);
  ciz("needs_review");
}

async function videoDenetimListele(liste, sec) {
  liste.innerHTML = "<div class='iskelet'></div>";
  let veri;
  try { veri = await api.videoKuyruk(sec === "acil" ? "needs_review" : sec, sec === "acil"); }
  catch (e) { liste.innerHTML = ""; const p = document.createElement("p"); p.textContent = "Video kuyruğu alınamadı: " + (e.message || ""); liste.appendChild(p); return; }
  liste.innerHTML = "";
  if (veri.denetimErisilebilir === false) { // sağlayıcı yok → dürüst uyarı
    const u = document.createElement("p"); u.className = "ipucu";
    u.textContent = "⚠️ Otomatik denetim SAĞLAYICISI tanımlı değil: videolar otomatik karar alamaz; hepsi insan incelemesinde bekler. (Bu ortamda gerçek konuşma/görsel modeli çalışmaz.)";
    liste.appendChild(u);
  }
  const sonuc = veri.sonuclar || [];
  if (!sonuc.length) { const b = document.createElement("div"); b.className = "bosDurum"; b.innerHTML = "<div class='buyuk'>🎥</div><p>Bu filtrede video yok.</p>"; liste.appendChild(b); return; }
  const gruplar = {};
  sonuc.forEach(v => { (gruplar[v.durum] = gruplar[v.durum] || []).push(v); });
  Object.keys(gruplar).forEach(d => {
    const gh = document.createElement("h4"); gh.textContent = videoDurumEtiket(d) + " (" + gruplar[d].length + ")"; liste.appendChild(gh);
    gruplar[d].forEach(v => liste.appendChild(videoModKart(v, () => videoDenetimListele(liste, sec))));
  });
  if (typeof ikonTazele === "function") ikonTazele();
}

function videoOrtakGerekce(kart) { // gerekçe + ret nedeni alanları (zorunlu)
  const g = document.createElement("textarea"); g.placeholder = "Karar gerekçesi (en az 10 karakter, ZORUNLU)"; g.rows = 2; g.maxLength = 400;
  g.setAttribute("aria-label", "Karar gerekçesi");
  const rn = document.createElement("input"); rn.placeholder = "Kullanıcıya gösterilecek RET nedeni (ret için zorunlu)"; rn.maxLength = 400;
  rn.setAttribute("aria-label", "Ret nedeni");
  kart.append(g, rn);
  return { gerekce: () => g.value.trim(), redNedeni: () => rn.value.trim() };
}

function videoModKart(v, tazele) {
  const kart = document.createElement("div"); kart.className = "kutu videoMod";
  kart.innerHTML = `<b>#${v.id} ${htmlKacis(v.baslik || "(başlıksız)")}</b> <span class="durumRozet durum-${htmlKacis(v.durum)}">${htmlKacis(videoDurumEtiket(v.durum))}</span><br><small>Yazar: ${htmlKacis(v.yazar)} • ${videoSureYaz(v.sure_sn)} • ${videoBoyutYaz(v.boyut)} • ${htmlKacis(v.bicim)} • ${htmlKacis(v.olusturma || "")}</small>`;
  if (v.aciklama) { const p = document.createElement("p"); p.textContent = v.aciklama; kart.appendChild(p); }

  // Güvenli önizleme: başta BULANIK; moderatör isterse açar (indirmeye zorlamaz)
  const onizSar = document.createElement("div"); onizSar.className = "videoSar";
  const gosterB = document.createElement("button"); gosterB.type = "button"; gosterB.className = "ikincil"; gosterB.textContent = "🔎 Güvenli önizle (bulanık)";
  gosterB.onclick = () => { onizSar.appendChild(videoOynatici(v, { blur: true })); gosterB.remove(); };
  onizSar.appendChild(gosterB); kart.appendChild(onizSar);

  // Bulgular + denetim kaydı
  const bulAlan = document.createElement("div"); bulAlan.className = "bulgular";
  const bulB = document.createElement("button"); bulB.type = "button"; bulB.className = "ikincil"; bulB.textContent = "🔬 Bulguları ve denetim kaydını göster";
  bulB.onclick = async () => {
    bulB.disabled = true; bulAlan.innerHTML = "<div class='iskelet'></div>";
    try {
      const r = await api.videoBulgular(v.id);
      bulAlan.innerHTML = "";
      const n = document.createElement("p"); n.className = "ipucu"; n.textContent = r.not || ""; bulAlan.appendChild(n);
      const bulgular = r.bulgular || [];
      if (!bulgular.length) { const p = document.createElement("p"); p.className = "ipucu"; p.textContent = "Otomatik bulgu yok (bu, içeriğin kesin temiz olduğu anlamına GELMEZ)."; bulAlan.appendChild(p); }
      bulgular.forEach(b => bulAlan.appendChild(videoBulguSatir(b)));
      const kayitlar = r.kayitlar || [];
      if (kayitlar.length) { // denetim kaydı: kim / ne / ne zaman / gerekçe
        const h = document.createElement("h5"); h.textContent = "🧾 Denetim kaydı"; bulAlan.appendChild(h);
        kayitlar.forEach(kg => { const s = document.createElement("div"); s.className = "bulgu"; s.textContent = `${kg.tarih} • ${kg.kim} • ${kg.aksiyon}${kg.gerekce ? " • " + kg.gerekce : ""}`; bulAlan.appendChild(s); });
      }
    } catch (e) { bulAlan.textContent = e.message; }
    bulB.remove();
  };
  kart.append(bulB, bulAlan);

  // Karar alanları + düğmeler (gerekçe zorunlu; çakışma koruması beklenen_durum ile)
  const ortak = videoOrtakGerekce(kart);
  const satir = document.createElement("div"); satir.className = "videoKarar";
  const mk = (etiket, sinif, fn) => { const b = document.createElement("button"); b.type = "button"; if (sinif) b.className = sinif; b.textContent = etiket; b.onclick = fn; return b; };
  satir.appendChild(mk("✅ Onayla", "", () => videoKararYolla(v, "onayla", ortak, {}, tazele)));
  satir.appendChild(mk("⛔ Reddet", "tehlike", () => videoKararYolla(v, "reddet", ortak, { red_nedeni: ortak.redNedeni() }, tazele)));
  satir.appendChild(mk("✏️ Değiştirme iste", "ikincil", () => videoKararYolla(v, "", ortak, { istegi_degistir: true }, tazele)));
  if (["Müdür Yardımcısı", "Admin"].includes(aktif.rol)) { // hesap katmanı yalnız yetkili
    satir.appendChild(mk("⏳ Geçici yükleme kısıtı", "ikincil", () => videoKisit(v, ortak, tazele)));
    satir.appendChild(mk("🧾 Hesap kararı", "ikincil", () => videoHesapKarar(v, tazele)));
  }
  kart.appendChild(satir);
  return kart;
}

async function videoKararYolla(v, karar, ortak, ek, tazele) {
  const gerekce = ortak.gerekce();
  if (gerekce.length < 10) { if (typeof toast === "function") toast("Gerekçe en az 10 karakter olmalı (zorunlu)."); return; }
  if (karar === "reddet" && !ek.red_nedeni) { if (typeof toast === "function") toast("Ret için kullanıcıya gösterilecek net neden gerekli."); return; }
  const veri = Object.assign({ beklenen_durum: v.durum, karar, gerekce }, ek);
  try { await api.videoKarar(v.id, veri); if (typeof toast === "function") toast("Karar kaydedildi."); tazele && tazele(); }
  catch (e) {
    if (e && e.kod === 409) { if (typeof toast === "function") toast("Bu video başkası tarafından değiştirilmiş. Liste yenileniyor."); tazele && tazele(); }
    else if (typeof toast === "function") toast(e.message);
  }
}

async function videoKisit(v, ortak, tazele) {
  const sebep = ortak.gerekce();
  if (sebep.length < 10) { if (typeof toast === "function") toast("Kısıtlama için gerekçe (en az 10 karakter) zorunlu."); return; }
  const gunStr = window.prompt("Kaç gün yükleme kısıtı? (1-30; orantılı ve SÜRELİ olmalı)", "3");
  if (gunStr === null) return;
  const gun = Math.max(1, Math.min(30, Number(gunStr) || 3));
  try { await api.videoKisitla(v.id, { gun, sebep }); if (typeof toast === "function") toast("Süreli yükleme kısıtı uygulandı (" + gun + " gün)."); tazele && tazele(); }
  catch (e) { if (typeof toast === "function") toast(e.message); }
}

async function videoHesapKarar(v, tazele) {
  const s = window.prompt("Hesap kararı yaz: uyari / kisitla / temizlendi. (Kalıcı 'suspend' YALNIZ yetkili insan içindir; AI skoruyla ASLA)", "uyari");
  if (s === null) return;
  const karar = s.trim();
  if (!["uyari", "kisitla", "temizlendi", "suspend"].includes(karar)) { if (typeof toast === "function") toast("Geçersiz karar."); return; }
  const gerekce = window.prompt("Gerekçe (en az 10 karakter):", v.karar_gerekce || "");
  if (gerekce === null) return;
  if (gerekce.trim().length < 10) { if (typeof toast === "function") toast("Gerekçe en az 10 karakter olmalı."); return; }
  try { await api.hesapKarar({ kullanici: v.yazar, karar, gerekce: gerekce.trim(), video_id: v.id }); if (typeof toast === "function") toast("Hesap kararı kaydedildi."); tazele && tazele(); }
  catch (e) { if (typeof toast === "function") toast(e.message); }
}

async function videoItirazCiz(alan) {
  let veri;
  try { veri = await api.videoItirazlar(); } catch { return; }
  const liste = veri.sonuclar || [];
  if (!liste.length) return;
  const h = document.createElement("h4"); h.textContent = "📢 Açık itirazlar (" + liste.length + ")"; alan.appendChild(h);
  const ip = document.createElement("p"); ip.className = "ipucu";
  ip.textContent = "Geçici yükleme kısıtlarına yapılan itirazlar. Kabul edilirse kısıt kalkar; karar yalnız yetkili insan verir.";
  alan.appendChild(ip);
  liste.forEach(ks => {
    const kart = document.createElement("div"); kart.className = "kutu";
    kart.innerHTML = `<b>${htmlKacis(ks.kullanici)}</b> <small>yükleme kısıtına itiraz • bitiş: ${htmlKacis(ks.bitis || "")} • kısıtı veren: ${htmlKacis(ks.karar_veren || "")}</small><p>Kısıt sebebi: ${htmlKacis(ks.sebep || "")}</p>`;
    const gi = document.createElement("input"); gi.placeholder = "İtiraz kararı gerekçesi (en az 10 karakter)"; gi.maxLength = 400;
    gi.setAttribute("aria-label", "İtiraz kararı gerekçesi");
    const karar = async kabul => {
      const g = gi.value.trim();
      if (g.length < 10) { if (typeof toast === "function") toast("Gerekçe en az 10 karakter olmalı."); return; }
      try { await api.hesapItirazKarar({ kisit_id: ks.id, kabul, gerekce: g }); if (typeof toast === "function") toast("İtiraz kararı kaydedildi."); videoModeratorCiz(); }
      catch (e) { if (typeof toast === "function") toast(e.message); }
    };
    const kb = document.createElement("button"); kb.type = "button"; kb.textContent = "✅ Kabul (kısıtı kaldır)"; kb.onclick = () => karar(true);
    const rb = document.createElement("button"); rb.type = "button"; rb.className = "tehlike"; rb.textContent = "⛔ Reddet"; rb.onclick = () => karar(false);
    kart.append(gi, kb, rb); alan.appendChild(kart);
  });
}

// =====================================================================================
// KULLANICI: kendi hesap/kısıt durumu + itiraz (profile eklenir)
// =====================================================================================
async function hesapDurumCiz() {
  const alan = document.getElementById("videoHesapDurum");
  if (!alan) return;
  if (MOD !== "sunucu" || !SUNUCU || !aktif) { alan.innerHTML = ""; return; }
  alan.innerHTML = "";
  let d;
  try { d = await api.hesapDurum(); } catch { alan.innerHTML = ""; return; }
  const h = document.createElement("h3"); h.textContent = "🎥 Video yükleme durumun"; alan.appendChild(h);
  if (d.kisitli && d.kisit) {
    const ks = d.kisit;
    const kutu = document.createElement("div"); kutu.className = "kutu";
    kutu.innerHTML = `<b>⚠️ Geçici yükleme kısıtın var</b><p>Bitiş: ${htmlKacis(ks.bitis || "")}</p><p>Sebep: ${htmlKacis(ks.sebep || "")}</p>`;
    if (ks.itiraz_durumu === "acik") { const p = document.createElement("p"); p.className = "ipucu"; p.textContent = "İtirazın yetkili incelemesinde."; kutu.appendChild(p); }
    else if (!ks.itiraz_durumu) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = "📢 İtiraz et";
      b.onclick = async () => { try { await api.hesapItiraz(ks.id); if (typeof toast === "function") toast("İtirazın alındı; yetkili inceleyecek."); hesapDurumCiz(); } catch (e) { if (typeof toast === "function") toast(e.message); } };
      kutu.appendChild(b);
    } else { const p = document.createElement("p"); p.className = "ipucu"; p.textContent = "İtiraz sonucu: " + ks.itiraz_durumu; kutu.appendChild(p); }
    alan.appendChild(kutu);
  } else {
    const p = document.createElement("p"); p.className = "ipucu"; p.textContent = "Yükleme kısıtın yok. ✅";
    alan.appendChild(p);
  }
  (d.vakalar || []).forEach(vk => {
    const kv = document.createElement("div"); kv.className = "cevap";
    kv.textContent = `İnceleme #${vk.id} • ${vk.durum === "acik" ? "açık" : "kapandı"}` + (vk.karar ? " • karar: " + vk.karar : "") + (vk.gerekce ? " • " + vk.gerekce : "");
    alan.appendChild(kv);
  });
}
