<div align="center">

# LanShare

**Local file sharing over your LAN — just open a browser**
Share files between your phone, tablet and computer. No app, no account, no cable.

⭐ If LanShare is useful to you, give it a star ⭐

![version](https://img.shields.io/badge/version-1.0.0-4fd6c4?style=for-the-badge)
![node](https://img.shields.io/badge/Node.js-%E2%89%A522.5-3c873a?style=for-the-badge&logo=node.js&logoColor=white)
![dependencies](https://img.shields.io/badge/dependencies-0-black?style=for-the-badge)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-1d2024?style=for-the-badge)
![license](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)

English | [中文](README_ZH.md)

**[Quick Start](#quick-start) · [Features](#features) · [Usage](#usage) · [FAQ](#faq)**

</div>

---

## What it is

LanShare is a zero-dependency Node.js service that turns any folder into a file-sharing page for your local network. Start it on one machine, and every phone, tablet and laptop on the same Wi-Fi can open it in a browser to upload and download files.

## Two modes

**Share a file** — select files and get a one-off link with a QR code. Best for sending something once.

**Shared space** — create a folder and get a permanent link. Anything dropped into that folder (from the web UI or your OS file manager) appears on the phone immediately. Browse subfolders, download files individually, or grab the whole folder as a ZIP. Phones can upload too, and any space can be switched to read-only.

## Quick start

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite`, so there is no `npm install`).

```bash
git clone https://github.com/1194042851/LanShare.git
cd LanShare
./start.sh
```

On Windows:

```bash
node server.js
```

The terminal prints every reachable address:

```
  <device name> —— 局域网共享
  local:   http://localhost:<port>
  LAN:     http://<your-lan-ip>:<port>   (<interface>)
  storage: <absolute path to the shared folder>
```

Open the LAN address on your phone. Both devices only need to be on the same network.

## Features

- Drag & drop, file picker, or whole-folder upload
- 4 MB chunks, 3 concurrent uploads, automatic retry; large files are never buffered in memory
- Downloads support HTTP Range, so video seeking and resumable downloads work
- Multi-select or entire folders streamed to a ZIP without touching disk
- Inline preview for images, video, audio, PDF and text
- Share links use your real LAN IP, never `localhost`
- Responsive layouts for phone, tablet and desktop; dark and light themes
- Live refresh via SSE when another device uploads

## Usage

```bash
LANSHARE_ROOT=~/Downloads node server.js          # share another folder
PORT=9000 LANSHARE_NAME="Living room NAS" node server.js
```

| Flag | Env | Default | Description |
| --- | --- | --- | --- |
| `--port` | `PORT` | `8090` | Listen port |
| `--root` | `LANSHARE_ROOT` | `./files` | Shared folder |
| `--name` | `LANSHARE_NAME` | hostname | Display name |
| `--host` | `HOST` | `0.0.0.0` | Bind address |
| — | `LANSHARE_MAX_UPLOAD` | 1 TB | Max file size in bytes |

## FAQ

**My phone can't open the address.** Check that both devices are on the same Wi-Fi, that the firewall allows the port, and that you used the LAN IP rather than `localhost` (on a phone, `localhost` means the phone itself).

**`node:sqlite` error on startup.** Your Node version is too old — run `node -v`, you need 22.5+.

**A file with the same name already exists.** Nothing is overwritten silently; it becomes `report (1).pdf`.

**The share link shows `127.0.0.1`.** It won't — the server replaces loopback addresses with a real interface IP and skips virtual adapters such as `tun`, `docker` and `Meta`.

## Security

LanShare is a **personal LAN tool with no authentication**:

- Anyone on the same network can read and write the shared folder
- Run it only on networks you trust
- **Do not expose it to the public internet** without a reverse proxy and authentication

Path arguments are normalized and checked, so `..` traversal and the internal `.lanshare` directory are unreachable.

## License

[MIT](LICENSE)
