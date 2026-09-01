<img width="1170" height="754" alt="image" src="https://github.com/user-attachments/assets/37e9cfa2-4913-4ffc-9171-e78367eaa1e1" /># CF Zero Trust Manager

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

<img width="1170" height="754" alt="image" src="https://github.com/user-attachments/assets/e320e0c5-ef56-4d20-92af-246510e18aae" />
<img width="1176" height="757" alt="image" src="https://github.com/user-attachments/assets/3ed556b7-d48d-495f-b199-9704ad1e3836" />
<img width="1173" height="752" alt="image" src="https://github.com/user-attachments/assets/07b8cb5b-7b42-4ddc-9587-0a9291d14819" />
<img width="1176" height="753" alt="image" src="https://github.com/user-attachments/assets/90dc868f-7372-4c4d-bb1c-e3d958c9855d" />
<img width="1175" height="754" alt="image" src="https://github.com/user-attachments/assets/29a93dc8-eb84-480b-a945-059af27a5ccb" />
<img width="1175" height="759" alt="image" src="https://github.com/user-attachments/assets/6e084c07-0510-4caf-ac64-915f925f9414" />

  
<img width="1165" height="746" alt="image" src="https://github.com/user-attachments/assets/0dea5a88-fea3-4dfd-8b81-a833ede6c1f0" />
<img width="1162" height="750" alt="image" src="https://github.com/user-attachments/assets/db866fec-c3fb-49d0-bf96-2305ccc870a6" />
<img width="1169" height="750" alt="image" src="https://github.com/user-attachments/assets/b5fb3deb-200e-40ab-a842-d0b76b7b80c0" />
<img width="1173" height="754" alt="image" src="https://github.com/user-attachments/assets/5e2405da-b28e-4cf0-b742-13e2d3999374" />
<img width="1167" height="748" alt="image" src="https://github.com/user-attachments/assets/4b81b9c4-a384-4fa1-a6f9-a921c0895c81" />

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
