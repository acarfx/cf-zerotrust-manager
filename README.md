# CF Zero Trust Manager

Desktop app for managing **Cloudflare Zero Trust tunnels** without living in the Cloudflare dashboard. Open or close public hostnames, manage DNS, watch tunnel health, and expose a local REST API so your own apps (Express, scripts, CI) can do the same.

Built with [Electron](https://www.electronjs.org/). The UI is available in **Turkish**, **English**, and **Russian**. On first launch a setup wizard asks for your API token, Account ID, and Tunnel ID. You can switch language any time from the flags in the title bar.

This app **manages** a tunnel. It does not run `cloudflared` for you — the tunnel itself must already be healthy.

---

## Features

### Dashboard
- Token status, selected tunnel name, connection count, and active hostname count
- Account card: Cloudflare account name, Account ID, Tunnel ID, default origin, REST API address
- Live (healthy) tunnels list with a one-click **Use** action
- Reload after `Ctrl+R` restores config, API state, tunnel picker, and the last open page

### Selected tunnel
- **Title-bar tunnel switcher** — searchable Select2 list, healthy tunnels only, icon per row
- Switching tunnels shows table/card skeletons until the new data arrives
- **Manage Tunnel** — create a public hostname or root domain (`admin.example.com` or `example.com`)
  - Subdomain + zone + protocol (HTTP / HTTPS / TCP / SSH / RDP) + host + port + optional path
  - Optional skip TLS verify for HTTPS origins
  - Enable, disable, edit, or delete records; DNS is written to the zone automatically
- **Tunnel Info** — ingress rules for the selected tunnel (hostname, path, service, protocol) plus tunnel name/ID

### Cloudflare
- **Domains** — all zones on the account (status, plan, nameservers)
- **DNS Records** — list, filter, add, edit, delete on a chosen zone
- **Tunnels** — live vs closed tunnels, details, switch the active one

### Local REST API
- Start/stop from **API → Manage** (default `http://127.0.0.1:7000`)
- Sidebar heartbeat: **green** while running, **red** while stopped
- Listen address + port, apply without leaving the page, optional auto-start on app launch
- Swagger UI at `/api-docs` when the server is up
- Live request log
- Can also run outside the UI: `node server_cli.js`

### Keys, security, audit
- **Keys** — create labeled `czt_…` secrets (shown once). Last used time, IP, device / user-agent, use count
- **Security**
  - IP / CIDR whitelist (empty = any IP; key is still required)
  - Per-minute rate limit
  - Daily quota per key
  - Auth lockout after failed attempts
- **Audit** — app + API actions with IP, device, and user-agent; filter and clear

### App
- **Settings** — token (masked on disk), account, tunnel, default origin, connection test, account/tunnel pickers
- **Integration** — step-by-step guides: how the tunnel works, REST API (Node), Express (`admin.example.com`), direct Cloudflare API
- **About** — features, author, license, Electron / Node / Chromium versions
- Loading skeletons on tables and cards
- System tray with API health icon

---

## Screenshots

<img width="1170" height="754" alt="image" src="https://github.com/user-attachments/assets/e320e0c5-ef56-4d20-92af-246510e18aae" />
<img width="1176" height="757" alt="image" src="https://github.com/user-attachments/assets/3ed556b7-d48d-495f-b199-9704ad1e3836" />
<img width="1173" height="752" alt="image" src="https://github.com/user-attachments/assets/07b8cb5b-7b42-4ddc-9587-0a9291d14819" />
<img width="1176" height="753" alt="image" src="https://github.com/user-attachments/assets/90dc868f-7372-4c4d-bb1c-e3d958c9855d" />
<img width="1175" height="754" alt="image" src="https://github.com/user-attachments/assets/29a93dc8-eb84-480b-a945-059af27a5ccb" />
<img width="1175" height="759" alt="image" src="https://github.com/user-attachments/assets/6e084c07-0510-4caf-ac64-915f925f9414" />

<img width="1169" height="750" alt="image" src="https://github.com/user-attachments/assets/b5fb3deb-200e-40ab-a842-d0b76b7b80c0" />
<img width="1173" height="754" alt="image" src="https://github.com/user-attachments/assets/5e2405da-b28e-4cf0-b742-13e2d3999374" />
<img width="1167" height="748" alt="image" src="https://github.com/user-attachments/assets/4b81b9c4-a384-4fa1-a6f9-a921c0895c81" />

---

## Requirements

- Windows 10/11 x64 (installer) or Node.js + npm (from source)
- A Cloudflare account with a **healthy** tunnel (`cloudflared` already running)
- API token with:
  - **Account → Cloudflare Tunnel: Edit**
  - **Zone → DNS: Edit**
- Account ID and Tunnel ID (the wizard can list them after the token is set)

---

## Install

### Windows installer

Download `CF Zero Trust Manager Setup 1.0.0.exe` from [Releases](https://github.com/acarfx/cf-zerotrust-manager/releases).

The setup wizard is not one-click:

- Language: Turkish / English / Russian
- License (MIT)
- Per-user or all-users
- Custom install folder
- Desktop shortcut and Start Menu shortcut (on by default)
- Launch when finished
- Uninstall from Apps & features (app data is kept)

### From source

```bash
git clone https://github.com/acarfx/cf-zerotrust-manager.git
cd cf-zerotrust-manager
npm install
npm start
```

### Build the installer

```bash
npm run build
```

Output: `release/CF Zero Trust Manager Setup 1.0.0.exe`

---

## First run

The onboarding wizard (or **Settings** later) needs:

1. **API Token** — Cloudflare → My Profile → API Tokens → custom token with the permissions above. Shown once at create time; the app stores it masked.
2. **Account ID** — 32-character id on the Cloudflare dashboard, or **List accounts** in the app.
3. **Tunnel ID** — Zero Trust → Networks → Tunnels, or **List tunnels** in the app. Only healthy tunnels can be selected.

Then **Test connection**. If it passes, open **Manage Tunnel** and add a hostname.

Leave the subdomain field empty (or `@`) to publish the **root domain** (`example.com`). `admin` + `example.com` becomes `admin.example.com` and is routed to your local origin (for example `http://127.0.0.1:3001`).

Step-by-step (Turkish): [SETUP.md](SETUP.md). In-app: **Integration**.

---

## How a hostname works

Someone on the internet opens `admin.example.com`. Cloudflare sends the request to your tunnel. The tunnel forwards it to the origin you set (Express, nginx, RDP, …). If that process or the tunnel is down, the site does not load.

This app writes the public hostname into the tunnel ingress and the matching DNS record on the zone.

---

## REST API

Start the server from **API → Manage → Start**, or:

```bash
node server_cli.js
```

Every route except `GET /health` requires `Authorization: Bearer <key>` or `X-API-Key: <key>`. Create a key under **Keys** (the `czt_…` value is shown once).

Optional on **Security**: IP whitelist, rate limit, daily quota, lockout. `/health` stays open for monitors.

Swagger: `http://127.0.0.1:7000/api-docs` while the server is running.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no key) |
| GET | `/api/status` | Token, account name, tunnel status |
| GET | `/api/accounts` | Cloudflare accounts |
| GET | `/api/tunnels` | Tunnels |
| GET | `/api/zones` | Zones |
| GET | `/api/tunnel/config` | Ingress / tunnel config |
| GET | `/api/hostnames` | Public hostnames |
| POST | `/api/hostnames` | Open hostname `{ hostname, service, path?, noTLSVerify? }` |
| PUT | `/api/hostnames/:host` | Update hostname |
| POST | `/api/hostnames/:host/enable` | Enable |
| POST | `/api/hostnames/:host/disable` | Disable |
| POST | `/api/hostnames/:host/toggle` | Toggle |
| DELETE | `/api/hostnames/:host` | Delete hostname + DNS |
| GET | `/api/config` | Masked settings |
| PUT | `/api/config` | Update settings |
| GET | `/api/keys` | API keys (no secrets) |
| POST | `/api/keys` | Create key |
| DELETE | `/api/keys/:id` | Delete key |

```bash
curl -H "Authorization: Bearer czt_..." \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:7000/api/hostnames \
  -d "{\"hostname\":\"admin.example.com\",\"service\":\"http://127.0.0.1:3001\"}"
```

Root domain: use `"hostname":"example.com"`. Copy-paste samples live under **Integration**.

---

## Sidebar map

| Group | Page | What it does |
|-------|------|----------------|
| — | Dashboard | Account, stats, live tunnels |
| Selected tunnel | Manage Tunnel | Hostnames / DNS for the active tunnel |
| Selected tunnel | Tunnel Info | Ingress rules |
| Cloudflare | Domains | Zones |
| Cloudflare | DNS Records | Zone DNS CRUD |
| Cloudflare | Tunnels | All tunnels, live / closed |
| API | Manage | Start/stop REST server, port, logs, Swagger |
| API | Keys | `czt_…` keys and last-used info |
| API | Security | Whitelist, rate limit, quota, lockout |
| App | Settings | Token, account, tunnel, default origin |
| App | Audit | App + API log |
| App | Integration | Tutorials and code |
| App | About | Version and credits |

---

## Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [Cloudflare API](https://developers.cloudflare.com/api/) — tunnels, hostnames, DNS
- Node.js — local REST API (no extra runtime beyond Electron / Node)
- NSIS installer via electron-builder

Not an official Cloudflare product.

---

## Author

**Acarfx** — [github.com/acarfx](https://github.com/acarfx)

Star the repo if it helps. Issues and PRs are welcome.

---

## License

MIT — see [LICENSE](LICENSE).
