// Program kayıt kuyruğu (revizyon tabanlı, kalıcı, hesap/ortam ayrımlı)
// Amaç: A kaydı sunucuya giderken B değişikliği yapılırsa B KAYBOLMAZ.
//  - Her değişikliğe BENZERSİZ İŞLEM KİMLİĞİ (crypto.randomUUID) + ayrı SIRA revizyonu verilir.
//  - İşlem kimliği öğeyle birlikte saklanır; ağ tekrarında ve sayfa yenilemede AYNI kalır.
//  - Revizyon sayacı kuyruktan AYRI anahtarda tutulur: kuyruk boşalsa (hatta silinse) bile
//    yeni kayıt ASLA eski işlem kimliğini/revizyonunu tekrar kullanmaz.
//  - Yanıt gelince YALNIZCA gönderilen revizyona kadarki kayıtlar temizlenir.
//  - Daha yeni bekleyen varsa önceki kayıt bittikten sonra DOĞRU sunucu sürümüyle gönderilir.
//  - Hesap/ortam isteğin başında yakalanır; eski hesabın yanıtı yenisini EZMEZ.
//  - Gönderim başarısızsa kuyruk KALIR (bağlantı gelince yeniden denenir).
//  - "Kaydedildi" yalnızca sunucu onayı + bekleyen kalmadığında söylenir.
(function (kok) {
  "use strict";
  function anahtar(etiket) { return "kuyruk:" + etiket; }            // bekleyen öğeler (gönderilince boşalır)
  function sayacAnahtar(etiket) { return "kuyrukSayac:" + etiket; }  // KALICI revizyon sayacı (silinmez!)
  function yeniId() { // benzersiz işlem kimliği (≤64 harf): ağ tekrarında/yenilemede korunur, ASLA tekrarlanmaz
    try { if (kok.crypto && typeof kok.crypto.randomUUID === "function") return kok.crypto.randomUUID(); } catch { /* yedek yola düş */ }
    return "op" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12); // yedek: zaman + rastgele
  }
  function oku(depo, etiket) { // ham kuyruk kaydı (göç uygulanmamış)
    try { const v = JSON.parse(depo.getItem(anahtar(etiket)) || "null"); return v && Array.isArray(v.ogeler) ? v : null; } catch { return null; }
  }
  function sayacOku(depo, etiket) { const n = parseInt(depo.getItem(sayacAnahtar(etiket)) || "0", 10); return Number.isFinite(n) && n > 0 ? n : 0; }
  function sayacYaz(depo, etiket, n) { depo.setItem(sayacAnahtar(etiket), String(n)); }
  function sakla(depo, etiket, kuyruk) { depo.setItem(anahtar(etiket), JSON.stringify(kuyruk)); }
  function gocEt(depo, etiket, k) { // ESKİ biçim göçü: kayıt içi sayaç → ayrı sayaç; kimliksiz öğelere kimlik ver (VERİ KAYBI YOK)
    let degisti = false, enBuyuk = sayacOku(depo, etiket);
    if (typeof k.sayac === "number" && k.sayac > enBuyuk) { enBuyuk = k.sayac; degisti = true; } // eski sayaç korunur
    if ("sayac" in k) { delete k.sayac; degisti = true; } // artık ayrı anahtarda tutulur
    k.ogeler = k.ogeler || [];
    for (const oge of k.ogeler) {
      if (typeof oge.rev !== "number") { oge.rev = ++enBuyuk; degisti = true; } // sırasız eski öğe: sıra ver
      if (oge.rev > enBuyuk) enBuyuk = oge.rev;
      if (!oge.id || typeof oge.id !== "string") { oge.id = yeniId(); degisti = true; } // kimliksiz eski öğe: kimlik ver
    }
    if (degisti) { sayacYaz(depo, etiket, enBuyuk); sakla(depo, etiket, k); } // göçü kalıcılaştır
    return k;
  }
  function olustur(ayar) { // ayar: { depo, etiketAl, gonder, surumOku, surumYaz, olay }
    const depo = ayar.depo;
    let gonderiyor = false; // aynı anda tek gönderim (aynı hesap kayıtları birbirini ezmez)
    function kuyrukAl(etiket) { const k = oku(depo, etiket); return k ? gocEt(depo, etiket, k) : null; } // oku + (gerekirse) göç
    function bekleyen(etiket) { const k = kuyrukAl(etiket || ayar.etiketAl()); return !!(k && k.ogeler.length); }
    function ekle(veri) { // yeni değişiklik: BENZERSİZ işlem kimliği + AYRI revizyon
      const etiket = ayar.etiketAl();
      const k = kuyrukAl(etiket) || { ogeler: [] };
      const rev = sayacOku(depo, etiket) + 1; // KALICI sayaç: kuyruk boşalmış olsa bile ARTAR (tekrar yok!)
      sayacYaz(depo, etiket, rev);
      k.ogeler = k.ogeler || [];
      k.ogeler.push({ rev, id: yeniId(), veri, taban: ayar.surumOku() }); // kimlik öğeyle saklanır (yenilemede korunur)
      sakla(depo, etiket, k);
      if (ayar.olay) ayar.olay("bekliyor", null, etiket);
      return rev;
    }
    async function yaz() { // kuyruğu boşaltana kadar sırayla gönder
      if (gonderiyor) return; // eşzamanlı gönderim yok
      gonderiyor = true;
      try {
        for (;;) {
          const etiket = ayar.etiketAl(); // istek başında hesap/ortam yakalanır
          const k = kuyrukAl(etiket);
          if (!k || !k.ogeler.length) { if (ayar.olay) ayar.olay("bos", null, etiket); return; }
          const oge = k.ogeler[k.ogeler.length - 1]; // en yeni hedef durum (tam veri)
          let r;
          try { r = await ayar.gonder(oge.veri, ayar.surumOku(), oge.id); } // İŞLEM KİMLİĞİ: ağ tekrarında/yenilemede AYNI kalır
          catch (e) { if (ayar.olay) ayar.olay("hata", e, etiket); return; } // BAŞARISIZ: kuyruk KALIR
          if (ayar.etiketAl() === etiket && r && r.surum != null) ayar.surumYaz(r.surum); // eski hesabın yanıtı yenisini EZMEZ
          const g = kuyrukAl(etiket) || { ogeler: [] };
          g.ogeler = (g.ogeler || []).filter(o => o.rev > oge.rev); // YALNIZ gönderilen revizyona kadar temizle
          if (g.ogeler.length) sakla(depo, etiket, g); else depo.removeItem(anahtar(etiket)); // sayaç anahtarı SİLİNMEZ!
          if (!g.ogeler.length) { if (ayar.olay) ayar.olay("kaydedildi", null, etiket); return; } // tamamen onaylandı
          // daha yeni bekleyen var → doğru sunucu sürümüyle devam et
        }
      } finally { gonderiyor = false; }
    }
    function sonRev(etiket) { // kuyruktaki EN YENİ revizyon (yoksa 0): "işlem başındaki bekleyenler" sınırı
      const k = kuyrukAl(etiket || ayar.etiketAl());
      if (!k || !k.ogeler || !k.ogeler.length) return 0; // bekleyen yok → 0 (sonradan eklenen hepsi "yeni" sayılır)
      return k.ogeler.reduce((m, o) => (typeof o.rev === "number" && o.rev > m ? o.rev : m), 0);
    }
    function temizle(esik) { // esik YOKSA: tümünü at (eski, açık çakışma davranışı) | esik VARSA: yalnız o ana kadar olanı at, yeniler KALIR
      const etiket = ayar.etiketAl();
      if (esik == null) { depo.removeItem(anahtar(etiket)); return; } // açık çakışma seçimi: bekleyeni at (sayaç kalır)
      const k = kuyrukAl(etiket);
      if (!k || !k.ogeler) return; // bekleyen yok: temizlenecek de yok
      const kalan = k.ogeler.filter(o => !(typeof o.rev === "number" && o.rev <= esik)); // REVİZYON BİLİNÇLİ silme
      if (!kalan.length) { depo.removeItem(anahtar(etiket)); return; } // hepsi bu andan öncediyse at
      k.ogeler = kalan; sakla(depo, etiket, k); // İŞLEM SÜRERKEN yapılan düzenlemeler KORUNUR
    }
    return { ekle, yaz, bekleyen, sonRev, temizle };
  }
  const disa = { olustur, _oku: oku, _anahtar: anahtar, _sayacAnahtar: sayacAnahtar, _yeniId: yeniId };
  if (typeof module !== "undefined" && module.exports) module.exports = disa; // Node (test) için
  kok.ProgramKuyruk = disa; // tarayıcı için
})(typeof window !== "undefined" ? window : globalThis);
