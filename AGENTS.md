# AGENTS.md

## Scope

These instructions apply to the entire `ai_game_workbench` repository.

## Project Shape

- This is a private TypeScript npm-workspaces monorepo.
- Workspaces:
  - `apps/server`: Fastify API server, local storage, OpenRouter/provider routes, image/video processing helpers.
  - `apps/web`: React + Vite workbench UI.
  - `packages/core`: Shared types, naming, prompt/action helpers, and pure timeline logic.
- Generated runtime data and large assets belong under ignored output/storage folders such as `storage/`, `Export/`, and `apps/server/output/`; do not commit generated media unless explicitly requested.

## Commands

Use the narrowest verification command that covers the change:

```bash
npm test
npm run typecheck
npm run build
npm run test:launcher
npm run build:launcher
npm run test -w apps/server
npm run test -w apps/web
npm run test -w packages/core
npm run typecheck -w apps/server
npm run typecheck -w apps/web
npm run typecheck -w packages/core
```

For local development:

```bash
npm run dev:workbench
npm run dev:server
npm run dev:web
```

The server defaults to `http://127.0.0.1:8787`. The Vite web URL is printed by Vite.

## Coding Conventions

- Keep TypeScript code ESM-first and preserve existing import style.
- Use two-space indentation and double quotes to match the current source.
- Prefer small pure helpers in `packages/core` for shared deterministic behavior.
- Keep server route registration modular under `apps/server/src/routes`.
- Keep UI state and API calls close to the owning React component unless reuse already exists.
- Prefer typed request/response payloads over loose `unknown` plumbing once data crosses module boundaries.
- Avoid broad refactors while making targeted changes.

## Tests

- Server tests use Vitest and `app.inject`; prefer temporary directories from `node:fs/promises`/`node:os` for filesystem state.
- Web tests use Vitest, Testing Library, and jsdom; mock `fetch` at the test boundary.
- Add or update tests when changing route behavior, provider payloads, image processing, export naming, or user-visible UI flows.
- For provider-facing logic, test payload construction and failure handling without requiring live provider calls.

## Environment

- Copy `.env.example` to `.env` only for local real-provider runs.
- Do not commit secrets or real API keys.
- `OPENROUTER_API_KEY`, `PUBLIC_ASSET_BASE_URL`, `FFMPEG_PATH`, `STORAGE_DIR`, and `PORT` are the main runtime settings.
- `npm run e2e:openrouter` performs a live OpenRouter pipeline and may require valid provider/account permissions.

## Working Safely

- Check `git status --short` before editing; this repo may have user changes in progress.
- Do not revert unrelated edits or generated files you did not create.
- Keep generated assets out of source changes unless the user explicitly asks for them.
- Every intentional code or documentation change must be committed before completion.
- When unrelated user changes are present, stage and commit only the files you intentionally changed.
- On Windows/PowerShell, prefer repo npm scripts over ad hoc command chains.
