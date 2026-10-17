<#
  baslat-backend.ps1 — Düzce FENTEK Ödev Destek · yerel sunucu başlatıcı (ön kontrollü)

  NE YAPAR
    1) Node.js var mı / sürümü yeterli mi (>= 22; node:sqlite için) diye bakar
    2) Gerekli paketler (node_modules) kurulu mu diye bakar
    3) Zorunlu ayarları (backend\.env -> JWT_SECRET) denetler
    4) Portu denetler:
         - doğru uygulama zaten çalışıyorsa YENİDEN BAŞLATMAZ (yeniden kullanır)
         - portu BAŞKA bir program tutuyorsa NET hata verir (kimseyi öldürmez)
    5) Sunucuyu BU pencerede çalıştırır; sağlık ucu (health) yanıt verince tarayıcıyı açar

  NE YAPMAZ
    - .env dosyasını DEĞİŞTİRMEZ / ÜZERİNE YAZMAZ
    - Sır değerlerini (JWT_SECRET vb.) EKRANA BASMAZ
    - Otomatik veri ekleme/sıfırlama (seed/reset) YAPMAZ
    - Üretim (production) dağıtımı YAPMAZ

  KULLANIM
    baslat-backend.bat                    -> normal başlat
    baslat-backend.bat -SadeceKontrol     -> yalnız denetle, başlatma
    baslat-backend.bat -TarayiciAcma      -> tarayıcıyı açma
    baslat-backend.bat -BeklemeSaniye 60  -> sağlık için en çok 60 sn bekle
    baslat-backend.bat -Port 3999         -> geçici port (ileri düzey; .env DEĞİŞMEZ)
#>
[CmdletBinding()]
param(
  [switch]$SadeceKontrol,
  [switch]$TarayiciAcma,
  [int]$BeklemeSaniye = 30,
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
try { $OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# --- Yollar ve sabitler ---
$Kok        = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend    = Join-Path $Kok "backend"
$SunucuJs   = Join-Path $Backend "server.js"
$EnvDosya   = Join-Path $Backend ".env"
$OrnekEnv   = Join-Path $Backend ".env.example"

$ASGARI_NODE     = 22
$VARSAYILAN_PORT = 3001
$ASGARI_PAKETLER = @("express", "dotenv", "helmet", "bcryptjs", "jsonwebtoken", "cors", "express-rate-limit", "zod")

# --- Ekran yardımcıları ---
function Baslik([string]$m) { Write-Host ""; Write-Host "== $m ==" -ForegroundColor Cyan }
function Bilgi([string]$m)  { Write-Host "   $m" }
function Iyi([string]$m)    { Write-Host "   [OK] $m" -ForegroundColor Green }
function Uyari([string]$m)  { Write-Host "   [!]  $m" -ForegroundColor Yellow }
function Hata([string]$m)   { Write-Host "   [X]  $m" -ForegroundColor Red }
function Bitir([int]$k)     { Write-Host ""; exit $k }

# --- Node.js bul ---
function NodeBul {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $adaylar = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  foreach ($a in $adaylar) { if ($a -and (Test-Path $a)) { return $a } }
  return $null
}

# --- .env oku (yalnız anahtar/değer; DEĞER YAZDIRILMAZ) ---
function EnvOku([string]$yol) {
  $tablo = @{}
  if (-not (Test-Path $yol)) { return $tablo }
  foreach ($satir in (Get-Content -LiteralPath $yol -Encoding UTF8)) {
    $s = $satir.Trim()
    if ($s -eq "" -or $s.StartsWith("#")) { continue }   # boş/yorum: atla
    $i = $s.IndexOf("=")
    if ($i -lt 1) { continue }                            # "ANAHTAR=DEĞER" değil: sessizce atla (değer sızdırma!)
    $k = $s.Substring(0, $i).Trim()
    $v = $s.Substring($i + 1).Trim().Trim('"').Trim("'")
    $tablo[$k] = $v
  }
  return $tablo
}

# --- TCP: port dinleniyor mu ---
function PortDinliyorMu([int]$p) {
  $c = $null
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect("127.0.0.1", $p, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(800)) { return $false }
    $c.EndConnect($iar)
    return $true
  } catch { return $false }
  finally { if ($c) { try { $c.Close() } catch { } } }
}

# --- BİZİM uygulama mı: /api/saglik = {"durum":"tamam"} VE kök sayfa uygulamamız ---
function BizimUygulamaMi([int]$p) {
  try {
    $sag = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/saglik" -TimeoutSec 5 -UseBasicParsing
    if ($sag.StatusCode -ne 200) { return $false }
    if ($sag.Content -notmatch '"durum"\s*:\s*"tamam"') { return $false }
    $kok = Invoke-WebRequest -Uri "http://127.0.0.1:$p/" -TimeoutSec 5 -UseBasicParsing
    return ($kok.StatusCode -eq 200 -and $kok.Content -match "FENTEK")   # ASCII işaret: kodlama sorunu çıkarmaz
  } catch { return $false }
}

# --- Sağlık gelince tarayıcıyı açan arka plan bekçisi ---
function TarayiciBekciBaslat([int]$p, [int]$saniye) {
  $url = "http://127.0.0.1:$p/"
  return Start-Job -ScriptBlock {
    param($port, $sn, $adres)
    $bitis = (Get-Date).AddSeconds($sn)
    while ((Get-Date) -lt $bitis) {
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/saglik" -TimeoutSec 3 -UseBasicParsing
        if ($r.StatusCode -eq 200 -and $r.Content -match '"durum"\s*:\s*"tamam"') {
          Start-Sleep -Milliseconds 300
          Start-Process $adres
          return
        }
      } catch { }
      Start-Sleep -Milliseconds 500
    }
  } -ArgumentList $p, $saniye, $url
}

# ============================ BAŞLA ============================
Write-Host ""
Write-Host "  Düzce FENTEK Ödev Destek · yerel sunucu" -ForegroundColor White
Write-Host "  Bu pencere AÇIK kaldıkça yerel site çalışır." -ForegroundColor DarkGray
Write-Host "  Pencereyi KAPATINCA (veya Ctrl+C) yerel site DURUR." -ForegroundColor DarkGray
Write-Host "  Veriler korunur; otomatik ekleme/sıfırlama YAPILMAZ." -ForegroundColor DarkGray

# 0) Proje yapısı
if (-not (Test-Path $SunucuJs)) {
  Baslik "Proje bulunamadı"
  Hata "server.js yok: $SunucuJs"
  Hata "Bu dosyayı proje kök klasöründen çalıştır (backend ve odev-destek klasörleri ile aynı yerde)."
  Bitir 6
}

# 1) Node.js
Baslik "1/5  Node.js"
$node = NodeBul
if (-not $node) {
  Hata "Node.js bulunamadı."
  Bilgi "Node.js sürüm $ASGARI_NODE veya üstünü kur: https://nodejs.org"
  Bitir 2
}
$surumMetin = ""
try { $surumMetin = (& $node --version) 2>$null } catch { }
if (-not $surumMetin) {
  Hata "Node.js sürümü okunamadı: $node"
  Bitir 2
}
$major = 0
try { $major = [int]($surumMetin.TrimStart("v").Split(".")[0]) } catch { }
if ($major -lt $ASGARI_NODE) {
  Hata "Node.js sürümü eski: $surumMetin (en az v$ASGARI_NODE gerekli)."
  Bilgi "Yeni sürümü kur: https://nodejs.org"
  Bitir 2
}
Iyi "Node.js $surumMetin"
Bilgi $node

# 2) Paketler
Baslik "2/5  Gerekli paketler"
$nm = Join-Path $Backend "node_modules"
if (-not (Test-Path $nm)) {
  Hata "node_modules yok. Paketler kurulmamış."
  Bilgi "Kur: cd `"$Backend`"  ve  npm install"
  Bitir 3
}
$eksik = @()
foreach ($p in $ASGARI_PAKETLER) {
  if (-not (Test-Path (Join-Path $nm "$p\package.json"))) { $eksik += $p }
}
if ($eksik.Count -gt 0) {
  Hata ("Eksik paketler: " + ($eksik -join ", "))
  Bilgi "Kur: cd `"$Backend`"  ve  npm install"
  Bitir 3
}
Iyi "Paketler kurulu ($($ASGARI_PAKETLER.Count) çekirdek paket doğrulandı)."

# 3) Zorunlu ayarlar (.env)  — değerler ASLA yazdırılmaz
Baslik "3/5  Zorunlu ayarlar (.env)"
if (-not (Test-Path $EnvDosya)) {
  Hata ".env bulunamadı."
  Bilgi "Şablonu kopyala: `"$OrnekEnv`"  ->  `"$EnvDosya`""
  Bilgi "Sonra .env içine uzun, rastgele bir JWT_SECRET yaz."
  Bitir 4
}
$ayar = EnvOku $EnvDosya
if (-not $ayar["JWT_SECRET"]) {
  Hata ".env içinde JWT_SECRET boş veya yok."
  Bilgi ".env dosyasını aç; JWT_SECRET=... satırına uzun, rastgele bir değer yaz."
  Bitir 4
}
$etkinPort = $VARSAYILAN_PORT
if ($ayar["PORT"] -and ($ayar["PORT"] -match "^\d+$")) { $etkinPort = [int]$ayar["PORT"] }
if ($Port -gt 0) { $etkinPort = $Port; $env:PORT = "$Port" }   # ileri düzey: portu geçici geçersiz kıl (.env'e dokunmaz)
Iyi ".env okundu (sırlar ekrana YAZILMAZ)."
Bilgi "Etkin port: $etkinPort"
if ($Port -gt 0) { Bilgi "(-Port ile geçici olarak değiştirildi; .env DEĞİŞMEDİ.)" }

# 4) Port
Baslik "4/5  Port denetimi (port $etkinPort)"
if (PortDinliyorMu $etkinPort) {
  if (BizimUygulamaMi $etkinPort) {
    Iyi "Doğru uygulama ZATEN çalışıyor: http://127.0.0.1:$etkinPort/"
    Bilgi "Yeni sunucu BAŞLATILMADI (çift sunucu yok)."
    if (-not $TarayiciAcma -and -not $SadeceKontrol) { Start-Process "http://127.0.0.1:$etkinPort/"; Bilgi "Tarayıcı açıldı." }
    Bitir 0
  } else {
    Hata "Port $etkinPort BAŞKA bir program tarafından kullanılıyor."
    Bilgi "O program KAPATILMADI (ilgisiz süreçler durdurulmaz)."
    Bilgi "Çözüm 1: o programı kendin kapat."
    Bilgi "Çözüm 2: backend\.env içinde PORT=$($etkinPort + 1) gibi boş bir port seç."
    Bitir 5
  }
} else {
  Iyi "Port $etkinPort boş."
}

# 5) Sunucu
Baslik "5/5  Sunucu"
if ($SadeceKontrol) {
  Iyi "Sadece kontrol istendi; sunucu BAŞLATILMADI."
  Bilgi "Her şey hazır görünüyor."
  Bitir 0
}
Bilgi "Sunucu bu pencerede çalışacak. Kapatınca yerel site durur."
$is = $null
if (-not $TarayiciAcma) {
  $is = TarayiciBekciBaslat $etkinPort $BeklemeSaniye
  Bilgi "Tarayıcı, sunucu SAĞLIKLI yanıt verince açılacak (en çok $BeklemeSaniye sn)."
} else {
  Bilgi "Tarayıcı açılmayacak (-TarayiciAcma). Adres: http://127.0.0.1:$etkinPort/"
}

Push-Location $Backend
try {
  & $node "server.js"
} finally {
  Pop-Location
  if ($is) {
    Stop-Job $is -ErrorAction SilentlyContinue
    Remove-Job $is -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Iyi "Sunucu durdu. Yerel site artık erişilemez."
Bilgi "Yeniden başlatmak için bu dosyaya tekrar çift tıkla."
Bitir 0
