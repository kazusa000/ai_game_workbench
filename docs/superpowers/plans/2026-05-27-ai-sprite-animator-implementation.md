# AI Sprite Animator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable version of `ai_game_workbench`: a game-styled web workbench hub with an `AI Sprite Animator` module for first-frame upload/generation, OpenRouter image-to-video task setup, local frame/post-processing export, and saved asset keys.

**Architecture:** Use an npm workspace with `packages/core` for shared behavior, `apps/server` for Fastify APIs and local processing, and `apps/web` for the React workbench UI. Keep provider calls and post-processing behind small interfaces so OpenRouter and ffmpeg/sharp can be tested without live API access.

**Tech Stack:** TypeScript, npm workspaces, Vitest, React, Vite, Fastify, sharp, ffmpeg via child process, local filesystem storage.

---

## File Structure

- Create `package.json`: npm workspace scripts for install, test, build, dev.
- Create `tsconfig.base.json`: shared TypeScript compiler options.
- Create `apps/server/package.json`: server package scripts and dependencies.
- Create `apps/server/src/index.ts`: Fastify server entrypoint.
- Create `apps/server/src/app.ts`: server factory used by runtime and tests.
- Create `apps/server/src/config.ts`: environment parsing for OpenRouter, storage, ffmpeg, public asset URL.
- Create `apps/server/src/storage/projectStore.ts`: local project JSON and asset path management.
- Create `apps/server/src/providers/openRouter.ts`: OpenRouter request payload builders and API client.
- Create `apps/server/src/processing/ffmpeg.ts`: frame extraction command construction and execution.
- Create `apps/server/src/processing/imageProcessing.ts`: color-key transparency, resizing, sprite sheet helpers.
- Create `apps/server/src/routes/projects.ts`: project state and saved key APIs.
- Create `apps/server/src/routes/assets.ts`: upload and static asset APIs.
- Create `apps/server/src/routes/generation.ts`: first-frame and video generation APIs.
- Create `apps/server/src/routes/processing.ts`: post-processing/export APIs.
- Create `apps/server/test/*.test.ts`: focused server tests.
- Create `apps/web/package.json`: web package scripts and dependencies.
- Create `apps/web/index.html`: Vite entry HTML.
- Create `apps/web/src/main.tsx`: React root.
- Create `apps/web/src/App.tsx`: route/state shell for hub and module.
- Create `apps/web/src/api/client.ts`: typed API wrapper.
- Create `apps/web/src/components/WorkbenchHub.tsx`: game-styled feature hub.
- Create `apps/web/src/components/SpriteAnimator.tsx`: first module UI.
- Create `apps/web/src/components/*.tsx`: focused panels for first frame, animation, frames, export, status.
- Create `apps/web/src/styles.css`: game workbench visual system.
- Create `apps/web/test/*.test.tsx`: web behavior tests.
- Create `packages/core/package.json`: shared package scripts.
- Create `packages/core/src/index.ts`: exports.
- Create `packages/core/src/types.ts`: shared `ProjectState`, jobs, assets, export settings.
- Create `packages/core/src/actionTemplates.ts`: action templates and prompt builder.
- Create `packages/core/src/exportNaming.ts`: filename helpers.
- Create `packages/core/src/frameTimeline.ts`: delete/reorder frame helpers.
- Create `packages/core/test/*.test.ts`: core unit tests.
- Create `.env.example`: required local environment variables.

---

## Task 1: Scaffold Workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `apps/server/package.json`
- Create: `apps/web/package.json`
- Create: `.env.example`

- [ ] **Step 1: Add workspace package configuration**

Create npm workspace scripts:

```json
{
  "name": "ai_game_workbench",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev -w apps/server",
    "dev:web": "npm run dev -w apps/web",
    "dev:server": "npm run dev -w apps/server",
    "build": "npm run build -ws --if-present",
    "test": "npm run test -ws --if-present",
    "typecheck": "npm run typecheck -ws --if-present"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "typescript": "^5.9.3",
    "vitest": "^4.0.14"
  }
}
```

- [ ] **Step 2: Add shared TypeScript settings**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 3: Add package manifests**

Create manifests for `@ai-game-workbench/core`, `@ai-game-workbench/server`, and `@ai-game-workbench/web` with `test`, `build`, and `typecheck` scripts.

- [ ] **Step 4: Add `.env.example`**

Include:

```text
OPENROUTER_API_KEY=
PUBLIC_ASSET_BASE_URL=http://localhost:8787/assets
FFMPEG_PATH=ffmpeg
STORAGE_DIR=./storage
PORT=8787
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`

Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 6: Commit scaffold**

Run:

```bash
git add package.json package-lock.json tsconfig.base.json packages apps .env.example
git commit -m "chore: scaffold ai game workbench workspace"
```

---

## Task 2: Core Behavior With TDD

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/actionTemplates.ts`
- Create: `packages/core/src/exportNaming.ts`
- Create: `packages/core/src/frameTimeline.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/actionTemplates.test.ts`
- Test: `packages/core/test/exportNaming.test.ts`
- Test: `packages/core/test/frameTimeline.test.ts`

- [ ] **Step 1: Write failing tests for prompt construction**

Test that `buildAnimationPrompt("walk", "walks forward")` includes single-character, centered, no-camera, solid-background, and user action text.

- [ ] **Step 2: Run the prompt test and verify RED**

Run: `npm run test -w packages/core -- actionTemplates`

Expected: FAIL because `buildAnimationPrompt` does not exist.

- [ ] **Step 3: Implement action templates and prompt builder**

Implement `buildAnimationPrompt`, `ACTION_TEMPLATES`, and `ActionTemplateKey`.

- [ ] **Step 4: Run the prompt test and verify GREEN**

Run: `npm run test -w packages/core -- actionTemplates`

Expected: PASS.

- [ ] **Step 5: Write failing tests for export naming**

Test that `buildExportNames({ assetKey: "hero mecha", animationKey: "walk/front" })` sanitizes keys and returns:

```text
hero_mecha_walk_front_sheet.png
hero_mecha_walk_front_preview.gif
hero_mecha_walk_front_001.png
```

- [ ] **Step 6: Run export naming test and verify RED**

Run: `npm run test -w packages/core -- exportNaming`

Expected: FAIL because `buildExportNames` does not exist.

- [ ] **Step 7: Implement export naming**

Implement `sanitizeKey` and `buildExportNames`.

- [ ] **Step 8: Run export naming test and verify GREEN**

Run: `npm run test -w packages/core -- exportNaming`

Expected: PASS.

- [ ] **Step 9: Write failing tests for frame timeline operations**

Test `removeFrame` removes a frame id and `moveFrame` reorders frames without mutating the original array.

- [ ] **Step 10: Run frame timeline test and verify RED**

Run: `npm run test -w packages/core -- frameTimeline`

Expected: FAIL because helpers do not exist.

- [ ] **Step 11: Implement frame timeline helpers**

Implement immutable `removeFrame` and `moveFrame`.

- [ ] **Step 12: Run all core tests**

Run: `npm run test -w packages/core`

Expected: all core tests pass.

- [ ] **Step 13: Commit core behavior**

Run:

```bash
git add packages/core
git commit -m "feat: add sprite animator core behavior"
```

---

## Task 3: Server APIs and Provider Payloads With TDD

**Files:**
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/storage/projectStore.ts`
- Create: `apps/server/src/providers/openRouter.ts`
- Create: `apps/server/src/routes/projects.ts`
- Create: `apps/server/src/routes/generation.ts`
- Test: `apps/server/test/openRouter.test.ts`
- Test: `apps/server/test/projectStore.test.ts`
- Test: `apps/server/test/projectsRoute.test.ts`

- [ ] **Step 1: Write failing tests for OpenRouter payloads**

Test `buildImageGenerationPayload` uses `/chat/completions` style fields with `modalities: ["image", "text"]` and `image_config.aspect_ratio: "1:1"`. Test `buildVideoGenerationPayload` uses `frame_images` with `frame_type: "first_frame"`.

- [ ] **Step 2: Run provider test and verify RED**

Run: `npm run test -w apps/server -- openRouter`

Expected: FAIL because payload builders do not exist.

- [ ] **Step 3: Implement OpenRouter provider builders and client skeleton**

Implement request builders and API methods with injected `fetch`.

- [ ] **Step 4: Run provider test and verify GREEN**

Run: `npm run test -w apps/server -- openRouter`

Expected: PASS.

- [ ] **Step 5: Write failing tests for project store**

Test `getOrCreateProject("default")` creates `project.json` with default keys and `saveProjectKeys` persists `assetKey`, `animationKey`, `fps`, `targetSize`, and `loop`.

- [ ] **Step 6: Run project store test and verify RED**

Run: `npm run test -w apps/server -- projectStore`

Expected: FAIL because project store does not exist.

- [ ] **Step 7: Implement project store**

Implement filesystem-backed project state using `node:fs/promises` and configurable `storageDir`.

- [ ] **Step 8: Run project store test and verify GREEN**

Run: `npm run test -w apps/server -- projectStore`

Expected: PASS.

- [ ] **Step 9: Write failing tests for project route**

Test `GET /api/projects/default` returns project state and `PUT /api/projects/default/keys` saves keys.

- [ ] **Step 10: Run route test and verify RED**

Run: `npm run test -w apps/server -- projectsRoute`

Expected: FAIL because server app/routes do not exist.

- [ ] **Step 11: Implement Fastify app and project routes**

Implement `createApp` and register project routes.

- [ ] **Step 12: Run server tests**

Run: `npm run test -w apps/server`

Expected: all server tests pass.

- [ ] **Step 13: Commit server core**

Run:

```bash
git add apps/server
git commit -m "feat: add server project and provider foundations"
```

---

## Task 4: Processing Utilities With TDD

**Files:**
- Create: `apps/server/src/processing/ffmpeg.ts`
- Create: `apps/server/src/processing/imageProcessing.ts`
- Create: `apps/server/src/routes/processing.ts`
- Test: `apps/server/test/ffmpeg.test.ts`
- Test: `apps/server/test/imageProcessing.test.ts`

- [ ] **Step 1: Write failing test for ffmpeg command construction**

Test `buildExtractFramesArgs({ inputPath, outputPattern, fps })` returns args containing `-i`, input path, `-vf`, `fps=12`, and output pattern.

- [ ] **Step 2: Run ffmpeg test and verify RED**

Run: `npm run test -w apps/server -- ffmpeg`

Expected: FAIL because `buildExtractFramesArgs` does not exist.

- [ ] **Step 3: Implement ffmpeg helpers**

Implement args construction and a `runFfmpeg` wrapper.

- [ ] **Step 4: Run ffmpeg test and verify GREEN**

Run: `npm run test -w apps/server -- ffmpeg`

Expected: PASS.

- [ ] **Step 5: Write failing tests for key-color transparency**

Create an in-memory PNG with one green pixel and one red pixel. Test green becomes alpha `0` and red remains alpha `255`.

- [ ] **Step 6: Run image processing test and verify RED**

Run: `npm run test -w apps/server -- imageProcessing`

Expected: FAIL because `applyColorKeyToBuffer` does not exist.

- [ ] **Step 7: Implement image processing helpers**

Implement color-key transparency, nearest-neighbor resize, and sprite sheet composition.

- [ ] **Step 8: Run processing tests**

Run: `npm run test -w apps/server -- ffmpeg imageProcessing`

Expected: PASS.

- [ ] **Step 9: Commit processing utilities**

Run:

```bash
git add apps/server/src/processing apps/server/test
git commit -m "feat: add sprite post-processing utilities"
```

---

## Task 5: Web Workbench UI

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/WorkbenchHub.tsx`
- Create: `apps/web/src/components/SpriteAnimator.tsx`
- Create: `apps/web/src/components/FirstFramePanel.tsx`
- Create: `apps/web/src/components/AnimationPanel.tsx`
- Create: `apps/web/src/components/FrameTimeline.tsx`
- Create: `apps/web/src/components/ExportPanel.tsx`
- Create: `apps/web/src/components/StatusLog.tsx`
- Create: `apps/web/src/styles.css`
- Test: `apps/web/test/App.test.tsx`

- [ ] **Step 1: Write failing UI test for hub navigation**

Render `App`, assert the `AI Sprite Animator` module appears, click it, assert upload and generate first-frame entries appear.

- [ ] **Step 2: Run web test and verify RED**

Run: `npm run test -w apps/web -- App`

Expected: FAIL because UI files do not exist.

- [ ] **Step 3: Implement React shell and module UI**

Implement the hub and `AI Sprite Animator` view with controlled fields for asset key, animation key, FPS, target size, loop, key color, first-frame upload, and first-frame generation prompt.

- [ ] **Step 4: Add game-styled CSS**

Implement a compact workbench layout with module cards, panels, pixel accents, readable dense controls, and no marketing landing page.

- [ ] **Step 5: Run web test and verify GREEN**

Run: `npm run test -w apps/web -- App`

Expected: PASS.

- [ ] **Step 6: Commit web UI**

Run:

```bash
git add apps/web
git commit -m "feat: add game-styled sprite animator web UI"
```

---

## Task 6: Integration Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Add README**

Document setup, environment variables, dev commands, and first-version limitations.

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: all workspace tests pass.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: all TypeScript packages typecheck.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: server, core, and web build.

- [ ] **Step 5: Start dev server**

Run: `npm run dev:server`

Expected: Fastify starts on `http://localhost:8787`.

- [ ] **Step 6: Commit docs and integration**

Run:

```bash
git add README.md .env.example package.json package-lock.json apps packages
git commit -m "docs: document ai game workbench setup"
```

---

## Self-Review

Spec coverage:

- Workbench hub and click-through into `AI Sprite Animator`: Task 5.
- Upload and AI first-frame entries: Task 5 and Task 3 generation route foundation.
- OpenRouter provider: Task 3.
- Solid-color key post-processing: Task 4.
- PNG sequence, sprite sheet, preview GIF foundations: Task 4.
- Saved web UI keys instead of Godot metadata: Task 2 types, Task 3 project store, Task 5 UI.
- No ComfyUI/local model: no tasks include them.

Known implementation boundary:

- The first pass builds the local workbench, provider request construction, API skeleton, UI, and post-processing utilities. Live OpenRouter generation depends on `OPENROUTER_API_KEY` and a publicly reachable first-frame URL for uploaded images.
