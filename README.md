<div align="center">

# LanShare

**局域网文件共享 —— 打开浏览器就能传文件**
Share files across your local network — no app, no account, no cable.

⭐ 如果对你有用，给个 Star 吧 / If it helps, give it a star ⭐

![version](https://img.shields.io/badge/version-1.0.0-4fd6c4?style=for-the-badge)
![node](https://img.shields.io/badge/Node.js-%E2%89%A522.5-3c873a?style=for-the-badge&logo=node.js&logoColor=white)
![dependencies](https://img.shields.io/badge/dependencies-0-black?style=for-the-badge)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-1d2024?style=for-the-badge)
![license](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)

[English](#english) · [简体中文](#简体中文)

</div>

---

## English

LanShare is a zero-dependency Node.js service that turns any folder into a file-sharing page for your LAN. Start it on one machine, and every phone, tablet and laptop on the same Wi-Fi can open it in a browser to upload and download files.

### Two modes

**Share a file** — pick files, get a one-off link and QR code. Best for sending something once.

**Shared space** — create a folder and get a permanent link. Anything dropped into that folder (from the web UI or your OS file manager) shows up on the phone instantly. Browse subfolders, download files individually, or grab the whole folder as a ZIP. Phones can upload too, and you can switch a space to read-only.

### Quick start

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite`, so no `npm install`).

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
  local:  http://localhost:<port>
  LAN:    http://<your-lan-ip>:<port>   (<interface>)
  storage: <absolute path to shared folder>
```

Open the LAN address on your phone. Both devices just need to be on the same network.

### Features

- Drag & drop, file picker, or whole-folder upload
- 4 MB chunks, 3 concurrent, automatic retry; large files never buffered in memory
- Downloads support HTTP Range, so video seeking and resumable downloads work
- Multi-select or folders streamed to a ZIP without touching disk
- Inline preview for images, video, audio, PDF and text
- Share links use your real LAN IP, never `localhost`
- Responsive layouts for phone, tablet and desktop; dark and light themes
- Live refresh via SSE when another device uploads

### Usage

```bash
LANSHARE_ROOT=~/Downloads node server.js    # share another folder
PORT=9000 LANSHARE_NAME="Living room NAS" node server.js
```

| Flag | Env | Default | Description |
| --- | --- | --- | --- |
| `--port` | `PORT` | `8090` | Listen port |
| `--root` | `LANSHARE_ROOT` | `./files` | Shared folder |
| `--name` | `LANSHARE_NAME` | hostname | Display name |
| `--host` | `HOST` | `0.0.0.0` | Bind address |
| — | `LANSHARE_MAX_UPLOAD` | 1 TB | Max file size in bytes |

### FAQ

**Phone can't open the address.** Check that both devices are on the same Wi-Fi, that the firewall allows the port, and that you used the LAN IP rather than `localhost` (on a phone, `localhost` means the phone itself).

**`node:sqlite` error on start.** Your Node is too old — run `node -v`, you need 22.5+.

**Duplicate file name.** Nothing is overwritten silently; it becomes `report (1).pdf`.

**Link shows `127.0.0.1`.** It won't — the server swaps loopback for a real interface address and skips virtual adapters such as `tun`, `docker` and `Meta`.

### Security

LanShare is a **personal LAN tool with no authentication**:

- Anyone on the same network can read and write the shared folder
- Run it only on networks you trust
- **Do not expose it to the public internet** without a reverse proxy and authentication

Path arguments are normalized and checked, so `..` traversal and the internal `.lanshare` directory are unreachable.

---

## 简体中文

LanShare 是一个零依赖的 Node.js 服务，把一个普通文件夹变成局域网里的文件共享页面。在一台机器上启动，同一个 Wi-Fi 下的手机、平板和电脑打开浏览器就能互传文件。

### 两种模式

**分享文件** —— 选中文件，生成一次性链接和二维码，适合「把这个东西发给你」。

**共享空间** —— 建一个文件夹，得到一个固定不变的链接。之后放进去的东西（网页上传或直接用系统文件管理器拖进去都行）手机打开链接就能看到，可以浏览子文件夹、逐个下载，或把整个目录打成 ZIP。手机也能上传，也可以切换成只读。

### 快速开始

需要 **Node.js 22.5 或更高版本**（用到内置的 `node:sqlite`，所以不需要 `npm install`）。

```bash
git clone https://github.com/1194042851/LanShare.git
cd LanShare
./start.sh
```

Windows 上：

```bash
node server.js
```

启动后终端会打印所有可访问地址：

```
  <设备名> —— 局域网共享
  local:  http://localhost:<端口>
  LAN:    http://<你的局域网IP>:<端口>   (<网卡名>)
  storage: <共享目录的绝对路径>
```

把 LAN 那一行发到手机上打开即可，两台设备在同一个网络里就行。

### 功能

- 拖拽、点选或整文件夹上传
- 4 MB 分片、3 路并发、失败自动重试；大文件不占内存
- 下载支持 HTTP Range，视频可拖进度条，也能断点续传
- 多选或整个文件夹流式打包成 ZIP，不落盘缓存
- 图片、视频、音频、PDF、文本页内预览
- 分享链接使用真实局域网 IP，不会是 `localhost`
- 手机、平板、桌面三套响应式布局，深色与浅色主题
- 其他设备上传后通过 SSE 自动刷新

### 使用说明

```bash
LANSHARE_ROOT=~/Downloads node server.js    # 换一个共享目录
PORT=9000 LANSHARE_NAME="客厅 NAS" node server.js
```

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--port` | `PORT` | `8090` | 监听端口 |
| `--root` | `LANSHARE_ROOT` | `./files` | 共享目录 |
| `--name` | `LANSHARE_NAME` | 主机名 | 页面显示的名称 |
| `--host` | `HOST` | `0.0.0.0` | 监听地址 |
| — | `LANSHARE_MAX_UPLOAD` | 1 TB | 单文件大小上限（字节） |

### 常见问题

**手机打不开地址。** 确认两台设备在同一个 Wi-Fi、防火墙放行了端口，并且用的是局域网 IP 而不是 `localhost`（在手机上 `localhost` 指的是手机自己）。

**启动报 `node:sqlite` 错误。** Node 版本太低，`node -v` 看一下，需要 22.5 以上。

**文件名重复。** 不会静默覆盖，会自动变成 `报告 (1).pdf` 这样的名字。

**链接里显示 `127.0.0.1`。** 不会。服务端会把回环地址换成真实网卡 IP，并跳过 `tun`、`docker`、`Meta` 这类虚拟网卡。

### 安全提醒

LanShare 是**给自己用的局域网工具，没有登录鉴权**：

- 同一网络内的任何人都能读写共享目录
- 只在自己信任的网络里运行
- **不要直接暴露到公网**，除非放在反向代理和认证之后

服务端对路径参数做了规范化与越界检查，`..` 穿越和内部 `.lanshare` 目录均不可访问。

---

## License

[MIT](LICENSE)
