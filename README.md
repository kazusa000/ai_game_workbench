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

`ffmpeg-static` is installed for the test pipeline, so the e2e script does not require a global ffmpeg install.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run dev:server
npm run dev:web
```

Server: `http://127.0.0.1:8787`  
Web: Vite prints its local URL when started.

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
