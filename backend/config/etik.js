// Katman 1: kural tabanlı ön filtre (Türkçe normalizasyon + kategori kalıpları)
// Her bulgu {kategori, agirlik, parca} verir; karar birleştirmede kullanılır
const yasakliKelime = ["küfür", "aptal", "salak", "gerizekalı", "hakaret", "reklam", "iddia"]; // eski liste (uyumluluk)
const KURALLAR = [ // [kategori, agirlik, kalıplar...] (sadeleşmiş metinde bitişik aranır)
  ["SINAV_SIZINTISI", 0.95, ["yarinki sinav", "yarınki sınav", "=sinav sorulari", "=sınav soruları", "sinav fotografi", "sınav fotoğrafı", "sinav kagidi", "sınav kağıdı", "henuz yapilmadi", "henüz yapılmadı", "sizdi", "sızdı", "sizinti", "sızıntı", "gizli sinav", "gizli sınav"]],
  ["SINAV_SIZINTISI", 0.85, ["disari cikmis", "dışarı çıkmış", "disari cikti", "dışarı çıktı"]],
  ["CEVAP_ANAHTARI", 0.9, ["cevap anahtari", "cevap anahtarı", "a b c d", "abcd cevap", "tum cevaplar", "tüm cevaplar", "cevap satisi", "cevap satışı"]],
  ["KOPYA_YARDIMI", 0.85, ["kopya cek", "kopya çek", "kopye", "yerime gir", "telefondan bak", "gizli iletisim", "gizli iletişim", "kopya yontemi", "kopya yöntemi", "sinavda kopya", "sınavda kopya"]],
  ["ZORBALIK_TACIZ", 0.8, ["aptal", "salak", "gerizekali", "gerizekalı", "hakaret", "ezik", "tehdit", "dov", "döv", "öldür", "oldur", "geber", "disla", "dışla", "küfür", "kufur", "serefsiz", "şerefsiz", "pislik", "beyinsiz", "dangalak", "haysiyetsiz"]],
  ["UYGUNSUZ_ICERIK", 0.9, ["uyusturucu", "uyuşturucu", "kumar", "intihar", "kendine zarar", "nefret", "cinsel"]],
  ["SPAM_REKLAM", 0.7, ["reklam", "ucretli odev", "ücretli ödev", "odev yapilir", "ödev yapılır", "para kazan", "takipci kazan", "takipçi kazan"]],
  ["KISISEL_BILGI", 0.85, ["telefonum", "adresim", "ev adresi", "tc kimlik", "tc no", "eposta"]]
];
// Birlikte geçme kuralları: grupların HEPSİ tutarsa yakala (ek-farklı yazımlar için)
// [kategori, agirlik, [grup1 kelimeleri...], [grup2...], ...]
const BIRLIKTE = [
  ["SINAV_SIZINTISI", 0.9, ["sinav", "sınav"], ["soru"], ["elimde", "dagit", "dağıt", "paylas", "paylaş", "bende", "satis", "satış", "satilik", "satılık", "foto", "cek", "çek", "buldum", "disari", "dışarı", "aldim", "aldım", "verilir", "isteyen", "alsin", "alsın", "acele", "yay", "yapilmadi", "yapılmadı", "yapilmamis", "yapılmamış", "henuz", "henüz", "sizdi", "sızdı", "sizinti", "sızıntı", "gizli"]],
  ["SINAV_SIZINTISI", 0.9, ["sinav", "sınav"], ["foto", "resim"]],
  ["KOPYA_YARDIMI", 0.88, ["yerime"], ["gir", "sinav", "sınav"]],
  ["KOPYA_YARDIMI", 0.8, ["telefon"], ["kopya"]],
  ["ZORBALIK_TACIZ", 0.9, ["kemik"], ["kir", "kır", "bekle", "bekliyorum", "dov", "döv"]],
  ["ZORBALIK_TACIZ", 0.9, ["okul cikisi", "okul çıkışı", "okul cikis"], ["bekle", "bekliyorum", "gorur", "görür"]],
  ["ZORBALIK_TACIZ", 0.85, ["konusmasin", "konuşmasın", "konusma"], ["kimse", "seninle", "seni"]],
  ["ZORBALIK_TACIZ", 0.85, ["istemiyoruz", "istemiyorum"], ["grup", "sen", "kimse"]],
  ["ZORBALIK_TACIZ", 0.9, ["yuzunu", "yüzünü", "suratini", "süratini", "agzini", "ağzını"], ["dagit", "dağıt", "kir", "kır", "patlat", "kirarim", "kırarım"]],
  ["ZORBALIK_TACIZ", 0.85, ["atin", "atın"], ["grup", "grupta", "grupdan"]],
  ["ZORBALIK_TACIZ", 0.85, ["konusmayin", "konuşmayın"], ["hicbiriniz", "hiçbiriniz", "kimse"]],
  ["SINAV_SIZINTISI", 0.85, ["soru"], ["onden", "önden"], ["yay", "dagit", "dağıt", "paylas", "paylaş"]],
  ["CEVAP_ANAHTARI", 0.85, ["cevap", "cevab"], ["anahtar", "satis", "satış", "satilik", "satılık", "satiyorum", "satıyorum", "satilir", "satılır", "satiyor", "satıyor", "satti", "sattı", "elimde", "bende", "dagit", "dağıt", "hepsi"]],
  ["SPAM_REKLAM", 0.7, ["link"], ["tikla", "tıkla", "kazan", "para", "hemen"]],
  ["KISISEL_BILGI", 0.8, ["telefon"], ["numara", "paylas", "paylaş"]],
  // Genişletilmiş örüntüler (tek cümle ezberi DEĞİL; eylem/niyet grupları):
  // Tehdit: (mahvet/pişman/canını/sonun/hesabını) + (gelecek zaman/eylem) — "seni mahvedeceğim", "sonun iyi değil"
  ["ZORBALIK_TACIZ", 0.88, ["mahved", "pisman", "canini", "sonun", "hesabini"], ["edecegim", "olacaksin", "yak", "sor", "iyi degil", "gorursun"]],
  // Dışlama/kapı gösterme: (yer yok/istemiyor) + (grup/sen/senin/gibi) — "sana yer yok", "bu grup seni istemiyor"
  ["ZORBALIK_TACIZ", 0.8, ["yer yok", "istemiyor", "istemiyoruz"], ["grup", "burada", "seni", "senin", "gibi"]],
  // Örtük tehdit/uyarı: (sessiz ol/konuşma/sus) + (yoksa/bir daha/kötü olur)
  ["ZORBALIK_TACIZ", 0.8, ["sessiz ol", "konusma", "sus"], ["yoksa", "bir daha", "kotu olur"]],
  // Bitişik yazılmayan aşağılama: "geri" + "zekalı" (geri zekalı) — kelime oyunu değil, ayrı yazım
  ["ZORBALIK_TACIZ", 0.8, ["geri"], ["zekali"]]
];
// Kelime sınırlı kalıplar (baş-son boşlukla aranır, örn. "eposta")
const SINIRLI = [["KISISEL_BILGI", 0.8, ["e posta"]]];
// Boşluksuz iskelet kalıplar (s1nav, c*vap gibi oyunlar için; ünsüz iskeleti)
const ISKELET = [["CEVAP_ANAHTARI", 0.85, ["cevapanahtari"]], ["SINAV_SIZINTISI", 0.8, ["snavkagidi", "snavfotografi"]], ["KOPYA_YARDIMI", 0.8, ["kopyacek"]], ["UYGUNSUZ_ICERIK", 0.75, ["uyusturucu", "intihar", "cinsel", "kumar", "nefret"]]];
function iskelet(s) { // ünlüleri at (sivri oyunları düzleştirir)
  return s.replace(/[aeıioöuü]/g, "");
}
// Kalıpları da katla (listede ş/ç harfi kalsa bile tutar)
[KURALLAR, SINIRLI].forEach(t => t.forEach(r => r[2] = r[2].map(katla)));
BIRLIKTE.forEach(r => r.slice(2).forEach((g, i) => r[i + 2] = g.map(katla)));
ISKELET.forEach(r => r[2] = r[2].map(p => katla(p)));
const TESPIT = { // hazır regex'ler (ham metinde aranır)
  telefon: /0\s?5\d[\d\s\-()]{8,}/, // 05xx ile başlayan
  tc: /\b[1-9]\d{10}\b/, // 11 haneli sayı
  link: /https?:\/\/|www\./, // bağlantı
  eposta: /[\w.+-]+@[\w-]+\.[\w.]+/ // e-posta
};
const TESPIT_KAT = { telefon: ["KISISEL_BILGI", 0.85], tc: ["KISISEL_BILGI", 0.9], link: ["SPAM_REKLAM", 0.7], eposta: ["KISISEL_BILGI", 0.85] };

function sadelestir(m) { // leetspeak ve oyunları çöz: "s1nav" -> "sinav"
  let s = (m || "").toLocaleLowerCase("tr-TR"); // Türkçe küçük harf
  const harf = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s" };
  s = s.replace(/[0134578@$]/g, c => harf[c]); // rakamları harfe çevir
  s = s.replace(/[^a-zçğıöşü\s]/g, " "); // noktalama -> boşluk ("c*vap" -> "c vap")
  s = s.replace(/(.)\1+/g, "$1"); // tekrarı bire indir ("sınaaav" -> "sınav", "sorulaarı" -> "sorulari")
  s = s.replace(/(?<![a-zçğıöşü])([a-zçğıöşü])(?: [a-zçğıöşü])+(?![a-zçğıöşü])/g, m => m.replace(/ /g, "")); // tek harf oyununu birleştir ("s.a.l.a.k" -> "salak")
  s = katla(s); // ç->c, ı->i gibi katla (çkmek = cekmek sayılır)
  return s.replace(/\s+/g, " ").trim(); // fazla boşluğu temizle
}
function katla(s) { // Türkçe harfleri düzleştir (eşleştirme için)
  return s.replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/ı/g, "i");
}

function kuralTara(metin) { // bulguları listele: [{kategori, agirlik, parca}]
  const s = " " + sadelestir(metin) + " "; // baş-son boşluk (kelime sınırı)
  const bulgu = [];
  const gordu = new Set(); // aynı kategoriyi 1 kez ekle
  const ekle = (kat, agirlik, parca, saglam) => {
    if (!gordu.has(kat)) { gordu.add(kat); bulgu.push({ kategori: kat, agirlik, parca }); return; } // ilk bulgu
    if (saglam) bulgu.find(b => b.kategori === kat).saglam = true; // gerçek veri işareti sonradan da yükselir
  };
  for (const [kat, agirlik, kaliplar] of KURALLAR) {
    for (let k of kaliplar) {
      if (k[0] === "=") { // tam kelime: sonuna ek gelmesin ("soruları" ≠ "sorularını")
        const t = katla(k.slice(1)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // düz metne çevir
        if (new RegExp(t + "(?![a-z])").test(s)) { ekle(kat, agirlik, k.slice(1)); break; }
        continue;
      }
      if (s.includes(katla(k))) { ekle(kat, agirlik, k); break; } // kategoride 1 eşleşme yeter
    }
  }
  for (const [kat, agirlik, ...gruplar] of BIRLIKTE) { // tüm gruplar tutarsa yakala
    if (gruplar.every(g => g.some(w => s.includes(w)))) ekle(kat, agirlik, "birlikte: " + gruplar.map(g => g[0]).join("+"));
  }
  for (const [kat, agirlik, kelimeler] of SINIRLI) { // kelime sınırlı
    for (const w of kelimeler) if (s.includes(" " + w + " ")) { ekle(kat, agirlik, w); break; }
  }
  const duz = s.replace(/ /g, ""); // boşluksuz + iskelet (s1nav, c*vap oyunları)
  const sk = iskelet(duz);
  for (const [kat, agirlik, desenler] of ISKELET) {
    for (const p of desenler) {
      if (duz.includes(p) || (iskelet(p).length >= 4 && sk.includes(iskelet(p)))) { ekle(kat, agirlik, "gizli yazım"); break; }
    }
  }
  for (const [ad, re] of Object.entries(TESPIT)) { // regex taraması (gerçek telefon/e-posta/TC: SAĞLAM bulgu)
    const m = (metin || "").match(re);
    if (m) { const [kat, agirlik] = TESPIT_KAT[ad]; ekle(kat, agirlik, m[0].slice(0, 20), true); } // bekçi sözcükler bunu düşüremez
  }
  // Talimat enjeksiyonu / moderasyon atlatma FİLTREDEN ÖNCE eklenir (yoksa sonuç listesine girmez!)
  // Genel kalıp grupları: tek cümle ezberi DEĞİL (yok say / sistem istemi / filtre-kapatma / rol bırakma / denetim atlatma)
  const ENJEKSIYON = [
    "temiz say", "gormezden gel", "filtreyi atlat", "filtreyi atlatmak",
    "yok say", "yok sayma",
    "sistem istemi", "sistem prompt", "system prompt", "sistem talimat", "sistem mesaji", "gizli talimat",
    "filtreyi devre disi", "filtre devre disi", "filtreyi kapat", "filtreyi kaldir",
    "denetimi kapat", "denetimi devre disi", "moderasyonu kapat", "denetlemeyi birak",
    "guvenlik kontrolunu atla", "guvenligi atla",
    "kuralsiz", "rolunu unut", "rolunu degistir", "rolunu birak"
  ];
  const DENETIM_Hedef = ["mesaji", "yaziyi", "icerigi", "soruyu", "sorulari", "beni"]; // "bu mesajı denetleme" bağlamı
  if (ENJEKSIYON.some(e => s.includes(e)) || (s.includes("denetleme") && DENETIM_Hedef.some(w => s.includes(w))))
    ekle("KOPYA_YARDIMI", 0.7, "talimat enjeksiyonu");
  // Bağlam koruması: alıntı/kınama/ders bağlamı ceza yemez (hedef gösterme yoksa)
  // Neden: "aptal deme" bir uyarıdır; "sınava nasıl çalışmalıyım" ders sorusudur
  // Kural: SAĞLAM bulgular (gerçek telefon/e-posta) bekçi sözcükle düşmez
  const varMi = arr => arr.some(w => s.includes(w)); // grupta biri geçiyor mu
  const satis = ["sat", "para", "ucret", "ücret", "elimde", "bende", "dagit", "dağıt", "link", "http"]; // satış niyeti
  const SEN = s.includes(" seni ") || s.includes(" sana ") || /(^| )sen( |$)/.test(s); // sana/seni/sen hedefi
  const masumAciklama = ["acikla", "açıkla", "nedir", "ne demek", "kompozisyon", "gecen yil", "geçen yıl", "yayimlanan", "yayımlanan", "calismak", "çalışmak", "konuyla", "nasil", "nasıl"]; // açıklama isteği sözleri
  let sonuc = bulgu.filter(b => {
    if (b.saglam) return true; // gerçek kişisel veri: bekçi sözcük işlemez
    if (b.kategori === "ZORBALIK_TACIZ" && varMi(["demek dogru degil", "demek doğru değil", "demek yanlis", "demek yanlış"])) return false; // üst-dil kınaması (hedef olsa bile)
    if (b.kategori === "ZORBALIK_TACIZ" && !SEN && varMi(["deme", "demeyin", "demek", "soyleme", "söyleme", "yasak", "bildir", "mayalim", "meyelim", "almadim", "almadım"])) return false; // alıntı/uyarı/kınama
    if (b.kategori === "ZORBALIK_TACIZ" && !SEN && varMi(["uygun degil", "uygun olmaz", "kaba", "saygisizca"])) return false; // ders/ahlak değerlendirmesi ("küfür etmek uygun değildir")
    if (b.kategori === "ZORBALIK_TACIZ" && !SEN && varMi(["kompozisyon", "anlat", "karsi", "karşı", "ders", "derste", "suc", "suç", "farkini", "farkını"])) return false; // ders bağlamı
    if (b.kategori === "UYGUNSUZ_ICERIK" && varMi(["karsi", "karşı", "kompozisyon", "ders", "odev", "ödev", "incele"])) return false; // karşı yazı
    if (b.kategori === "UYGUNSUZ_ICERIK" && varMi(["karsi", "karşı", "kompozisyon", "ders", "odev", "ödev", "incele"])) return false; // karşı yazı
    if (b.kategori === "SPAM_REKLAM" && !varMi(satis) && varMi(["incele", "kompozisyon", "dil bilgisi", "ozellik", "özellik"])) return false; // ders incelemesi ("ödev yapılır" ilanı düşmez!)
    if (b.kategori === "SINAV_SIZINTISI" && !varMi(["elimde", "dagit", "dağıt", "paylas", "paylaş", "bende", "satis", "satış", "foto", "cek", "çek", "buldum", "disari", "dışarı", "yapilmadi", "yapılmadı", "sizdi", "sızdı", "gizli"]) && (varMi(["nasil calis", "nasıl çalış", "calismaliyim", "çalışmalıyım", "calisirim", "çalışırım", "program oner", "taktik ver", "onerin", "önerin", "nasil", "nasıl", "basari", "başarı"]) || varMi(["bildir", "ogretmen", "öğretmen"]))) return false; // ders çalışma sorusu / sızıntı bildirimi
    if (b.kategori === "CEVAP_ANAHTARI" && !varMi(satis) && varMi(masumAciklama)) return false; // açıklama isteği
    if (b.kategori === "KOPYA_YARDIMI" && varMi(["yasak", "yapmayin", "yapmayın", "cezasi", "cezası", "yakalanir", "yakalanır"]) && !varMi(["yontem", "yöntem", "taktik", "yol", "nasil", "nasıl", "anlat", "goster", "göster"])) return false; // kopya uyarısı
    if (b.kategori === "KISISEL_BILGI" && varMi(["neden", "nedir", "serbest", "yasak"])) return false; // yasak sorgusu (bilgi yoksa)
    return true;
  });
  return sonuc;
}

function etikKontrol(metin) { // eski uyumlu sürüm: {temiz, neden}
  const b = kuralTara(metin);
  if (!b.length) return { temiz: true };
  const ilk = b[0];
  const nedenler = { SINAV_SIZINTISI: "Sınav sızıntısı şüphesi.", CEVAP_ANAHTARI: "Cevap anahtarı şüphesi.", KOPYA_YARDIMI: "Kopya şüphesi.", ZORBALIK_TACIZ: "Hakaret/zorbalık içeriyor.", UYGUNSUZ_ICERIK: "Uygunsuz içerik.", SPAM_REKLAM: "Reklam/bağlantı yasak.", KISISEL_BILGI: "Kişisel bilgi paylaşmak yasak." };
  return { temiz: false, neden: nedenler[ilk.kategori] || "Kural ihlali." };
}

module.exports = { etikKontrol, sadelestir, kuralTara, iskelet }; // pipeline da kullanır
