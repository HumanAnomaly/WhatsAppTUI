<p align="center">
  <img src="assets/icon.avif" width="80" alt="WhatsAppTUI">
</p>

<h1 align="center">WhatsAppTUI</h1>

<p align="center">
  WhatsApp in your terminal.
</p>

<p align="center">
  <a href="https://github.com/HumanAnomaly/WhatsAppTUI">
    <img src="https://img.shields.io/github/stars/HumanAnomaly/WhatsAppTUI?style=flat-square&logo=github" alt="GitHub Stars">
  </a>
  <a href="https://github.com/HumanAnomaly/WhatsAppTUI/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/HumanAnomaly/WhatsAppTUI?style=flat-square" alt="License">
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D20.9-green?style=flat-square&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/ink-v8-blue?style=flat-square&logo=react" alt="Ink">
  <img src="https://img.shields.io/badge/zapo--js-v1-25D366?style=flat-square" alt="zapo-js">
</p>

---

## What is this?

**WhatsAppTUI** is an experimental terminal user interface for WhatsApp, built on top of [`zapo-js`](https://github.com/HumanAnomaly/zapo-js).

It brings a WhatsApp-like experience directly to your terminal.

<p align="center">
  <img src="assets/screenshot_1.avif" alt="WhatsAppTUI Screenshot">
</p>

## Installation

```bash
pnpm install
```

## Connect

On the first launch, WhatsAppTUI will display a QR code.

On your phone, open:

**WhatsApp → Linked devices → Link a device**

You can also press `P` on the QR screen to switch to an 8-character pairing code.

## Usage

| Command | Description |
|---|---|
| `pnpm start` | Start WhatsAppTUI and connect your account |
| `pnpm run demo` | Run the demo with sample chats and scripted replies |

## Shortcuts

| Key | Action |
|---|---|
| `↑` / `↓` | Select chat |
| `Tab` | Cycle filter: all → groups → direct → channels |
| `Shift+Tab` | Toggle the archived folder |
| `Ctrl+F` | Search chats & messages |
| `PgUp` / `PgDn` | Scroll history (PgUp pages older messages from the server) |
| `Enter` | Send message · open chat |
| `Esc` | Clear draft · back / close |
| `Ctrl+O` | Chat options: pin, mute, read, archive, info |
| `Ctrl+P` | Profile & privacy |
| `Ctrl+S` | Settings |
| `Ctrl+K` | Help popup |
| `Ctrl+C` | Quit |

## Note

> [!WARNING]
> WhatsAppTUI is still in beta and under active development. Some features may be incomplete, unstable, or change without notice.

## License

MIT License. See [`LICENSE`](LICENSE) for details.
