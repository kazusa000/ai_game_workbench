# AI Game Workbench

AI-assisted game creation workbench. The first module is `AI Sprite Animator`, a local-first workflow for turning a square pixel-art first frame into sprite animation assets.

## Current Feature

`AI Sprite Animator` is entered from the game-styled workbench hub. It currently includes:

- upload/generate first-frame entry points
- first-frame direction selector: front, back, left, right
- editable image and animation prompt controls
- custom first-frame generation size from 64 to 1024 pixels
- saved web UI keys: asset key, animation key, FPS, target size, loop
- OpenRouter provider payload builders
- local project state storage
- ffmpeg frame extraction helpers
- sharp color-key background removal
- nearest-neighbor resize helpers
- sprite sheet composition helper
- preview GIF pipeline script

Godot metadata is not generated. The saved keys are stored in workbench project state and used for naming.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` if running the API server with real providers.

```text
OPENROUTER_API_KEY=
PUBLIC_ASSET_BASE_URL=http://localhost:8787/assets
FFMPEG_PATH=ffmpeg
STORAGE_DIR=./storage
PORT=8787
```

Relative `STORAGE_DIR` values are resolved from `apps/server`, so the default `./storage` is always `apps/server/storage` no matter where the server is started from. Generated AI images, downloaded AI videos, character assets, jobs, and provider settings all use that same storage root unless `STORAGE_DIR` is set to an absolute path.

`ffmpeg-static` is installed for the test pipeline, so the e2e script does not require a global ffmpeg install.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run dev:workbench
npm run dev:server
npm run dev:web
```

Server: `http://127.0.0.1:8787`  
Web: Vite prints its local URL when started.

## One-Click Windows Launcher

Double-click:

```text
tools\launcher\release\AiGameWorkbenchLauncher.exe
```

The launcher runs `scripts/start-workbench.ps1 -OpenBrowser`, which starts or reuses the API server, starts a Cloudflare Quick Tunnel with `cloudflared`, starts the Vite web server, writes the temporary public URL into server storage, then opens the workbench page.

Advanced script arguments can be passed to the exe. For example:

```powershell
tools\launcher\release\AiGameWorkbenchLauncher.exe -NoTunnel
tools\launcher\release\AiGameWorkbenchLauncher.exe -Check -NoTunnel
```

Rebuild the exe after changing launcher source:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-launcher.ps1
```

`npm run dev:workbench` starts or reuses the API server, Cloudflare Quick Tunnel, and Vite web server together. The script looks for `cloudflared` on `PATH`, `tools\cloudflared\cloudflared.exe`, or `tools\cloudflared.exe`; if it is missing, the script downloads it into ignored runtime storage at `apps/server/storage/runtime/cloudflared/cloudflared.exe`. `CLOUDFLARED_PATH` can point to a custom exe. The generated `https://*.trycloudflare.com` URL is written to `apps/server/storage/config/public-tunnel.json`, and the web app uses it automatically for uploaded images that cloud video models need to fetch.

```powershell
$env:CLOUDFLARED_PATH="E:\tools\cloudflared.exe"
npm run dev:workbench
```

`-NoNgrok` is still accepted as a legacy alias for `-NoTunnel`.

## OpenRouter Key Note

OpenRouter provisioning or management keys can create and manage API keys, but they cannot call model inference endpoints directly. The e2e script detects provisioning keys and creates a temporary limited inference key, then deletes it at the end.

If OpenRouter returns provider Terms of Service errors for model calls, create a normal inference API key in OpenRouter settings or resolve the provider/account requirement in OpenRouter before rerunning the e2e test.

## E2E Pipeline

Place local test files in:

```text
test_api_and_image/
  Openrouter_api.txt
  <reference-image>.png|jpg|jpeg|webp
```

Run:

```bash
npm run e2e:openrouter
```

The script attempts:

1. reference image + prompt -> square front-facing pixel-art first frame
2. first frame + running prompt -> OpenRouter image-to-video
3. MP4 download
4. ffmpeg frame extraction
5. key-color background removal
6. nearest-neighbor resize
7. sprite sheet PNG export
8. preview GIF export

Outputs are written under `storage/e2e-*`, which is ignored by git.

## Known Limits

- The first UI version is a functional shell, not a complete editor.
- Live image/video generation depends on OpenRouter provider availability and account permissions.
- Uploaded local images need a public URL or object storage before cloud video models can fetch them.
- Full pixel editing, magic wand cleanup, and Godot metadata export are intentionally deferred.
