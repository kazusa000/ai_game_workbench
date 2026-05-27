# AI Game Workbench - AI Sprite Animator Design

## Status

Approved design draft for the first feature of `ai_game_workbench`.

The workspace is not currently a git repository, so this spec is saved as a file only and is not committed.

## Product Positioning

`ai_game_workbench` is an AI-assisted game creation workbench, intended to become an open-source web tool for game developers.

The first feature is `AI Sprite Animator`: a workflow for creating 2D character animation assets from a square pixel-art first frame and an action prompt.

The website should feel like a game creation workbench, not a generic SaaS dashboard. The first screen should be a usable game-styled workbench hub with feature cards or module navigation. Users click the `AI Sprite Animator` feature to enter this first tool. Future tools can share the same shell and asset library.

The visual style should use game UI cues, pixel-art accents, compact panels, sprite previews, progress bars, and tool-like controls. Pixel fonts can be used for headings and labels, but parameter text and dense controls should remain readable. The design should prioritize real production workflow over decorative game theming.

## Reference Scope

Rika AI is a functional reference for the first module:

- upload a 2D/pixel character image
- choose an action type
- generate animation
- preview the resulting animation
- split and inspect frames
- remove a solid-color background
- export GIF and sprite sheet assets

This project should not copy Rika's exact UI or branding. It should adapt the useful workflow concepts into a broader AI game creation workbench.

## First Feature Scope

`AI Sprite Animator` supports:

- uploaded square pixel-art first-frame images
- AI-generated square pixel-art first-frame images
- OpenRouter-backed image generation
- OpenRouter-backed image-to-video generation
- video download and local post-processing
- frame extraction
- solid-color key background removal
- nearest-neighbor resizing to target asset sizes
- PNG frame sequence export
- transparent PNG frame sequence export
- sprite sheet PNG export
- preview GIF export
- user-editable and saved asset keys in the web UI

The first version does not support:

- ComfyUI
- local model inference
- automatic uploaded-image quality checks
- automatic conversion of non-pixel uploaded images
- multi-character scenes
- complex backgrounds
- bone rigging
- Godot plugin integration
- generated Godot metadata files
- generated `.tres`, `.import`, or manifest files
- full pixel-painting editor
- magic wand editing
- frame-by-frame brush repair

## Site-Level Navigation

The app opens to a workbench hub. The first available module is `AI Sprite Animator`.

Planned module structure:

- `AI Sprite Animator`: first-frame to 2D sprite animation
- `Character Generator`: future character image generation workflow
- `Sprite Sheet Editor`: future frame editing and cleanup workflow
- `Tileset Generator`: future tile asset generation workflow
- `Portrait Generator`: future portrait and bust generation workflow
- `Export Hub`: future export preset and engine integration workflow
- `Asset Library`: future saved project assets and generation history

For the first implementation, only `AI Sprite Animator` needs to be functional. Other modules can appear as disabled or planned entries if that helps communicate the long-term product shape.

## AI Sprite Animator UX

The module should use a workbench layout:

- left side: app/module navigation and project assets
- center: first-frame preview, animation preview, frame timeline
- right side: generation, post-processing, and export settings
- bottom: task status, progress, logs, and output links

The first-frame panel has two explicit entries:

- `Upload First Frame`
- `Generate First Frame`

Uploaded images are assumed to be valid square pixel-art character images. The app should not block or auto-correct uploads in the first version.

The AI image generation entry asks for:

- character prompt
- pixel-art style prompt or preset
- target size: `64`, `128`, `256`, `512`, or `1024`
- solid background key color, defaulting to green or deep cyan
- seed, optional

The animation generation area asks for:

- action key, such as `idle`, `walk_front`, `attack_01`
- action template: `idle`, `walk`, `run`, `jump`, `attack`, `hit`, `defeated`, or `custom`
- action prompt
- video provider model, defaulting to an OpenRouter image-to-video model that supports 1:1 and first-frame input
- duration, with 4-6 seconds preferred for the first version
- FPS for preview/export
- target output size: `64`, `128`, `256`, `512`, or `1024`
- loop enabled/disabled
- key color for background removal

The frame timeline supports the lightweight operations needed for the first version:

- preview frames
- remove bad frames
- reorder frames if needed
- adjust FPS
- preview loop playback

Full pixel editing is intentionally deferred.

## Saved Web UI Keys

Godot metadata files should not be generated in the first version.

Instead, the web UI stores user-entered keys in the project data:

- `assetKey`, for example `hero_mecha`
- `animationKey`, for example `walk_front`
- `fps`, for example `12`
- `targetSize`, for example `256`
- `loop`, for example `true`

These values are used for:

- project history
- asset organization
- reopening a previous job
- export file naming

They are not exported as Godot-specific metadata.

Recommended export names:

- `hero_mecha_walk_front_sheet.png`
- `hero_mecha_walk_front_001.png`
- `hero_mecha_walk_front_002.png`
- `hero_mecha_walk_front_preview.gif`

## Technical Architecture

Use a local-first web application:

- frontend: React, Vite, TypeScript
- backend: Node.js, Fastify
- image processing: `sharp`
- video processing: `ffmpeg`
- storage: local filesystem
- AI provider: OpenRouter

Godot is an export target, not the runtime for the workbench.

Recommended structure:

```text
tool/ai_game_workbench/
  apps/
    web/
    server/
  packages/
    core/
  storage/
    projects/
  docs/
    superpowers/
      specs/
```

Frontend responsibilities:

- game-styled workbench shell
- module hub
- `AI Sprite Animator` route
- upload first-frame UI
- generate first-frame UI
- animation task form
- progress and status display
- animation preview
- frame timeline
- export settings
- output file links

Backend responsibilities:

- accept uploads
- manage project data
- call OpenRouter image generation
- call OpenRouter video generation
- poll video jobs
- download generated video
- run `ffmpeg` frame extraction
- run `sharp` post-processing
- build sprite sheets
- build preview GIFs
- serve local assets to the web UI

Core package responsibilities:

- provider interfaces
- job data types
- asset data types
- action templates
- prompt presets
- export naming rules
- shared validation for simple UI fields

## Provider Design

Use provider interfaces so OpenRouter is replaceable later.

Image provider:

```ts
interface ImageProvider {
  generateFirstFrame(input: GenerateFirstFrameInput): Promise<GeneratedImage>;
}
```

Video provider:

```ts
interface VideoProvider {
  createImageToVideoJob(input: ImageToVideoInput): Promise<VideoJob>;
  getVideoJob(jobId: string): Promise<VideoJobStatus>;
  downloadVideo(jobId: string): Promise<DownloadedVideo>;
}
```

The first concrete provider is `OpenRouterProvider`.

OpenRouter image generation is used for explicit AI first-frame generation.

OpenRouter video generation is used for image-to-video from the first-frame URL and action prompt. Prefer models that support:

- `1:1` aspect ratio
- first-frame conditioning
- image-to-video
- short durations
- audio disabled or ignored

Initial default model recommendation:

- `bytedance/seedance-2.0-fast`

Fallback candidates:

- `alibaba/wan-2.7`
- `kwaivgi/kling-v3.0-std`

The selected model should remain configurable because provider model availability and pricing change over time.

## Public Image URL Requirement

Cloud video generation APIs cannot read a local disk path.

For AI-generated first frames, the provider may return a remote image URL that can be passed directly into video generation.

For uploaded first frames, the backend needs a way to expose or upload the image to a URL accessible by OpenRouter. The storage layer should be abstracted as `BlobStorageProvider`.

First implementation options:

- use a configured public asset base URL if available
- use an object storage provider later, such as Cloudflare R2, S3, or Supabase Storage
- show a clear configuration error if uploaded images cannot be made public

Required environment variables:

```text
OPENROUTER_API_KEY=
PUBLIC_ASSET_BASE_URL=
FFMPEG_PATH=
STORAGE_DIR=
```

`PUBLIC_ASSET_BASE_URL` is required for uploaded-image image-to-video unless the implementation adds object storage or another upload bridge.

## Post-Processing Pipeline

Input:

- downloaded MP4 or GIF
- target size: `64`, `128`, `256`, `512`, or `1024`
- key color
- FPS
- asset and animation keys

Steps:

1. Extract frames with `ffmpeg`.
2. Optionally sample down or normalize FPS.
3. Remove key-color background with `sharp`.
4. Preserve hard sprite edges where possible.
5. Use nearest-neighbor resizing to target size.
6. Optionally reduce color count or apply pixelization cleanup.
7. Save opaque and transparent frame sequences.
8. Build sprite sheet PNG.
9. Build preview GIF.
10. Update web project data with output paths and saved keys.

The key-color removal approach is intentionally simple. The first version assumes the generated or uploaded first frame uses a solid background color, and prompts should push the video model to preserve that background.

Recommended action prompt constraints:

```text
single 2D game character, full body, centered, no camera movement,
solid pure green background, no shadow, no ground, no particles,
looping sprite animation style
```

The action-specific phrase is appended after these constraints.

## Storage Layout

Recommended per-project layout:

```text
storage/projects/{projectId}/
  project.json
  source/
    first_frame_uploaded.png
    first_frame_generated.png
  generated/
    video.mp4
    preview_raw.gif
  frames/
    raw/
    transparent/
    resized/
  exports/
    {assetKey}_{animationKey}_sheet.png
    {assetKey}_{animationKey}_preview.gif
    sequence/
      {assetKey}_{animationKey}_001.png
      {assetKey}_{animationKey}_002.png
```

`project.json` stores the workbench state and user-entered keys. It is not intended as Godot metadata.

## Error Handling

The UI should surface clear task states:

- idle
- uploading
- generating first frame
- generating video
- polling video job
- downloading video
- extracting frames
- removing background
- exporting
- succeeded
- failed

Important error cases:

- missing `OPENROUTER_API_KEY`
- uploaded image cannot be exposed as public URL
- OpenRouter model does not support requested settings
- video job fails
- video download fails
- `ffmpeg` is missing
- `sharp` processing fails
- no frames extracted
- output directory not writable

Errors should be recoverable when possible. The user should be able to retry from the failed step without restarting the entire project.

## Testing Strategy

Start with focused tests around the most fragile non-UI logic:

- export file naming
- action prompt construction
- provider request payload construction
- project state persistence
- frame list operations
- color key transparency on known sample images
- sprite sheet dimensions

Manual verification for the first version:

- upload a square first-frame PNG
- generate an AI first frame
- generate a video through OpenRouter
- extract frames from a sample MP4 without provider access
- remove a pure green background
- export a transparent PNG sequence
- export a sprite sheet
- export a preview GIF
- reload the project and confirm saved keys persist

## Open Questions

- Which exact OpenRouter image generation model should be the default for first-frame generation?
- Which object storage approach should be used for uploaded first frames: public local tunnel, R2, S3, or Supabase Storage?
- Should other planned modules be shown as disabled cards in the first build?
- Should the first implementation include project creation, or start with a single default project?

## Approval Notes

Confirmed decisions:

- project folder: `tool/ai_game_workbench`
- first feature: `AI Sprite Animator`
- the feature is entered by clicking it from the game-styled workbench hub
- first frame can be uploaded or AI-generated
- no automatic image checking for uploaded images
- first version uses OpenRouter provider
- no ComfyUI in the first version
- solid-color keying is the background removal strategy
- supported target asset sizes are `64` to `1024`
- no Godot metadata file generation
- asset and animation keys are entered and saved in the web UI
