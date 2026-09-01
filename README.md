# CF Zero Trust Manager

Cloudflare Zero Trust tünelinizdeki subdomain'leri masaüstünden yönetin. Electron tabanlı bir arayüz, arkasında çalışan bir REST API sunucusu ve üç dil desteği (Türkçe / English / Русский) ile gelir.

Bu proje, Cloudflare'da tünel açıp kapatmak, public hostname eklemek ve DNS kayıtlarını yönetmek için sürekli dashboard'a girip uğraşmaktan kurtulmak için yazıldı. Arayüzü açarsın, subdomain'i yazarsın, gerisini uygulama halleder.

İlk açılışta kurulum sihirbazı (API Token, Account ID, Tunnel ID) sizi yönlendirir. Sağ üstteki bayraklarla dil değiştirirsiniz.

---

## Özellikler

- **Subdomain yönetimi** — tünele public hostname ekle, aç/kapat, tamamen sil
- **DNS otomatik** — zone seç, DNS kaydı uygulama oluştursun
- **REST API sunucusu** — uygulamadan bağımsız çalıştır, dışarıdan yönet
- **API anahtarları** — API'ye erişim için üretilen, iptal edilebilen anahtarlar
- **IP Whitelist** — API'ye yalnızca istediğin IP'lerden erişim (isteğe bağlı)
- **Bağlantı testi** — token, hesap, tünel, zone ve subdomain adımlarını tek tek doğrula
- **3 dil** — 🇹🇷 Türkçe (varsayılan), 🇬🇧 English, 🇷🇺 Русский
- **Canlı log** — API sunucusunun istek loglarını anlık izle
- **Kurulum sihirbazı** — ilk açılışta gerekli Cloudflare bilgilerini adım adım sorar

---

## Kurulum

### Hazır kurulum (Windows)

[Releases](https://github.com/acarfx/cf-zerotrust-manager/releases) sayfasından `CF Zero Trust Manager Setup 1.0.0.exe` dosyasını indirip kurun.

### Kaynaktan çalıştırma

```bash
git clone https://github.com/acarfx/cf-zerotrust-manager.git
cd cf-zerotrust-manager
npm install
npm start
```

### Build alma

```bash
npm run build
```

Kurulum dosyası `dist/` klasörüne düşer.

---

## İlk kullanım

Uygulamayı açtıktan sonra **Ayarlar** sekmesinden şunları girin:

1. **API Token** — Cloudflare'da oluşturduğunuz token (Account → Cloudflare Tunnel: Edit, Zone → DNS: Edit izinleriyle)
2. **Account ID** — Cloudflare dashboard'daki 32 haneli hesap kimliği
3. **Tunnel ID** — Zero Trust → Networks → Tunnels'taki tünel UUID'si

Sonra **Bağlantıyı Test Et**'e basın. Her şey yolundaysa **Subdomainler** sekmesinden subdomain açmaya başlayabilirsiniz.

> Adım adım anlatım için [KURULUM.md](SETUP.md) dosyasına bakın.

---

## REST API

API sunucusunu **API Sunucusu** sekmesinden ya da konsoldan başlatın:

```bash
node server_cli.js
```

Tüm uç noktalar `Authorization: Bearer <anahtar>` veya `X-API-Key: <anahtar>` başlığıyla korunur (yalnızca `/health` hariç).

| Metot | Uç nokta | Açıklama |
|-------|----------|----------|
| GET | `/health` | Sağlık kontrolü (anahtarsız) |
| GET | `/api/status` | Token + tünel durumu |
| GET | `/api/tunnels` | Tünel listesi |
| GET | `/api/zones` | Zone listesi |
| GET | `/api/hostnames` | Subdomain listesi |
| POST | `/api/hostnames` | Subdomain aç (`{ hostname, service, path? }`) |
| POST | `/api/hostnames/:host/enable` | Subdomain'i aç |
| POST | `/api/hostnames/:host/disable` | Subdomain'i kapat |
| POST | `/api/hostnames/:host/toggle` | Durumu değiştir |
| DELETE | `/api/hostnames/:host` | Subdomain'i tamamen sil |
| GET | `/api/config` | Ayarlar (maskeli) |
| PUT | `/api/config` | Ayarları güncelle |
| GET | `/api/keys` | Anahtar listesi |
| POST | `/api/keys` | Yeni anahtar |
| DELETE | `/api/keys/:id` | Anahtarı sil |

Örnek:

```bash
curl -H "Authorization: Bearer czt_..." \
  -X POST http://localhost:7000/api/hostnames \
  -d '{"hostname":"panel.alanadi.com","service":"http://localhost:8080"}'
```

---

## Teknoloji

- [Electron](https://www.electronjs.org/) — masaüstü arayüz
- [Cloudflare API](https://developers.cloudflare.com/api/) — tünel ve DNS yönetimi
- Node.js — REST API sunucusu (harici bağımlılık yok)

---

## Geliştirici

**Acarfx** — [github.com/acarfx](https://github.com/acarfx)

Bu projeyi faydalı bulduysanız bir yıldız bırakmanız yeter. Hata bulursanız issue açmaktan çekinmeyin.

---

## Lisans

MIT — detaylar için [LICENSE](LICENSE) dosyasına bakın.
