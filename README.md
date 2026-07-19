# Free Image Compress

Smart AVIF, WebP, PNG and JPEG compression for faster websites — like TinyPNG, but open source and 100% local. Your images never leave your machine. No database, nothing is stored.

## How it works

- **Smart quality search** — for each image, a binary search finds the lowest quality that still meets a perceptual (SSIM) similarity threshold. Maximum compression without visible loss, no manual quality slider guessing.
- **Per-format tricks** — JPEG uses mozjpeg, PNG uses palette quantization (the TinyPNG trick), WebP/AVIF use high-effort encoding.
- **Auto format** — optionally outputs whichever of AVIF / WebP / original format is smallest.
- **Stateless** — files are processed in memory and streamed back to the browser. Nothing touches disk.

## Run with Docker (recommended)

```bash
docker compose up -d
# open http://localhost:3210
docker compose down   # when done
```

Works great as an on/off toggle in OrbStack / Docker Desktop.

## Run with Node

Requires Node 22+ (Docker image uses 24.18.0).

```bash
npm install
npm start
# open http://localhost:3000
```

Or without cloning: `npx free-image-compress`

## Usage

Drop (or paste) images into the browser UI. Choose:

- **Output**: Auto (smallest of AVIF/WebP/original), keep format, or force a format
- **Level**: High quality (SSIM ≥ 0.97), Balanced (≥ 0.94), Smallest (≥ 0.90)

Download files individually or all as a ZIP.

## Config

| Env var | Default | |
| ------- | ------- | - |
| `PORT`  | `3000`  | HTTP port |
| `HOST`  | `0.0.0.0` | Bind address |

Max upload size: 50 MB per file.

## Stack

Node + [Hono](https://hono.dev) + [sharp](https://sharp.pixelplumbing.com) (libvips) on the server; the UI is a single HTML file — the server renders result cards as HTML fragments, a small client-side queue handles per-file progress, cancellation, and re-runs. No build step, no database, 3 runtime dependencies.

## License

MIT
