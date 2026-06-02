# Module 01 Cleanup Design

## Objective

Rework Module 01 so it reads as a coherent character-production tool instead of a collection of unrelated buttons and parameters. The change keeps the existing generation APIs and provider system, but reorganizes the user experience around clear action pages, consistent layout rules, and a dedicated settings center.

## Scope

This design covers Module 01 only:

- One-click character generation.
- Base template generation.
- Walk, idle, run, attack 1, and jump action pages.
- Character preview and export pages.
- Module 01 settings for references, system prompts, defaults, and advanced parameters.

This design does not cover accounts, payments, quota tracking, or provider billing logic.

## Navigation

Module 01 should use this top-level navigation:

- `One-click Character`
- `Base Template`
- `Walk`
- `Idle`
- `Run`
- `Attack 1`
- `Jump`
- `Character Preview`
- `Export`
- `Module Settings`

Each action has one page. Related image generation, video generation, upload, and processing controls stay together on that action page. There should not be separate navigation entries for walk images, walk videos, or frame cutting.

The UI should not use "cut frames" as the user-facing concept. The user-facing action is `一键处理`.

## Core UX Rules

- Main workflow pages produce assets.
- Module Settings manages reusable defaults.
- One-click generation starts a full job and shows progress; it does not duplicate per-step configuration.
- Comparable controls must appear in consistent positions across pages.
- Blocks that do not apply to a page are not rendered.
- System prompts and final prompt previews should not occupy the main workflow by default.
- Main workflow pages show only a lightweight `本次生成要求` input for the current generation.

## Page Layouts

### One-click Character

This is a shortcut page, not a configuration page.

It should include:

- Character name.
- Character reference upload.
- Optional action checkboxes for run, attack 1, and jump.
- Start button.
- Job progress and step states.
- Result preview.

It should not include system prompt editors, final prompt previews, or duplicated model/size/video settings. It reads defaults from Module Settings.

### Base Template

This page is image-only.

It should include:

- Character reference preview.
- Base template output preview.
- Upload reference image.
- Generate base template.
- `本次生成要求`.
- Common image settings, such as image model and size.
- Collapsed advanced image settings if needed.

It should not show video controls or `一键处理`.

### Action Pages

Walk, idle, run, attack 1, and jump should use the same page grammar:

1. Page status area.
2. Image/input preparation area.
3. Video plus `一键处理` area.
4. Result area.

Each page shows only the blocks it needs, but comparable blocks use the same visual hierarchy and button placement.

#### Walk

Image area:

- Base template input.
- Walk 2x2 output.
- Generate walk image.
- Upload walk image.
- `本次生成要求` for the walk image.

Video and processing area:

- Generate walk video.
- Upload walk video.
- Video preview.
- `一键处理`.
- Processed walk result preview.
- `本次生成要求` for the walk video.

#### Idle

Image area:

- Walk 2x2 input.
- Idle 2x2 output.
- Generate idle image.
- Upload idle image if supported.
- `本次生成要求` for the idle image.

Video and processing area:

- Idle does not show AI video generation controls in this cleanup.
- It still has `一键处理` for producing aligned idle assets from the idle 2x2 output.
- The layout should align with other action pages but not render irrelevant video controls.

#### Run

Image area:

- Walk 2x2 input.
- Run keyframe output.
- Generate run keyframe.
- Upload run keyframe if supported.
- `本次生成要求` for the run keyframe.

Video and processing area:

- Generate run video.
- Upload run video.
- Video preview.
- `一键处理`.
- Processed run result preview.
- `本次生成要求` for the run video.

#### Attack 1

Image preparation area:

- Idle input.
- Attack start frame.
- Attack middle frame.
- Prepare attack start frame.
- Generate attack middle frame.
- `本次生成要求` for the middle frame.

Video and processing area:

- Generate attack video.
- Upload attack video.
- Video preview.
- `一键处理`.
- Processed attack result preview.
- `本次生成要求` for the attack video.

Attack can have one additional image slot compared with run and jump, but it must still follow the same top-to-bottom grammar: prepare images first, then video, then processing.

#### Jump

Image preparation area:

- Idle input.
- Prepared jump start frame.
- Prepare jump start frame.

Video and processing area:

- Generate jump video.
- Upload jump video.
- Video preview.
- `一键处理`.
- Processed jump result preview.
- `本次生成要求` for the jump video.

Jump does not need an AI image-generation prompt block unless that capability is added later. It should still show the prepared start frame clearly so the page aligns conceptually with attack.

## Module Settings

`Module Settings` replaces the standalone reference image settings page. Reference images are not a separate top-level category. Each reference image belongs to the step that uses it.

Settings groups:

- Base Template
- Walk
- Idle
- Run
- Attack 1
- Jump
- Character Preview
- Export

Each group should contain only settings relevant to that group:

- Reference images used by that step.
- System prompt templates.
- Default image model and size.
- Default video model, duration, and resolution where applicable.
- Advanced processing parameters, such as key color, tolerance, frame counts, loop frame limits, start-frame scale, and export size where applicable.
- A per-group save button, such as `保存步行设置`.

Settings groups should save independently. Editing walk settings must not accidentally overwrite attack settings.

## Parameter Visibility

Common parameters may be visible on workflow pages:

- Image model.
- Image size.
- Video model.
- Video duration.
- Video resolution.

Detailed parameters should be collapsed by default:

- Key color.
- Chroma tolerance.
- Frame count.
- FPS.
- Minimum and maximum loop frames.
- Export frame size.
- Attack and jump start-frame scale.

When advanced values are changed on a workflow page, their ownership remains the matching Module Settings group.

## State And Prerequisites

Each page should make current state clearer than the current button-heavy UI:

- Show the active character.
- Show whether prerequisites are ready.
- Show what output already exists.
- Show the next recommended action.
- Disable blocked actions with a useful status message.

Examples:

- Run requires walk output.
- Attack and jump require idle output.
- Idle requires walk processing output.
- Export requires processed assets for at least the base required actions.

## Component Direction

The implementation should move toward smaller UI units rather than continuing to expand `SpriteAnimator.tsx`.

Expected component boundaries:

- Module shell and navigation.
- One-click page.
- Base template page.
- Reusable action page shell.
- Action-specific content models for walk, idle, run, attack 1, and jump.
- Module settings center.
- Reusable settings group sections.
- Preview and export pages.

Existing API calls and server routes can remain in place for this cleanup. The first implementation should focus on UI structure, state ownership, and test coverage for the new user-visible layout.

## Testing Strategy

Web tests should verify:

- The new navigation labels and page order.
- One-click generation does not show system prompt editors or duplicate settings.
- Base Template has no video or `一键处理` section.
- Walk, run, attack, and jump use aligned image and video/process sections.
- Idle does not show irrelevant AI video controls unless required by the implementation.
- Module Settings groups references and prompts under the step that uses them.
- Main workflow pages no longer show system prompt and final prompt fields by default.
- Buttons use `一键处理` wording instead of frame-cutting wording.

Server tests should not need broad changes unless request payload ownership changes. Existing API behavior should remain compatible.

## Non-Goals

- No account system.
- No payment or quota system.
- No provider billing changes.
- No live provider behavior changes.
- No new generation model choices beyond the current provider catalog.

## Implementation Notes

- The existing workflow config file can still be used initially, but the UI should treat settings as grouped by action.
- If the current storage shape makes per-group saving hard, the implementation can add typed client helpers that merge only the edited settings group before saving.
- The design prefers preserving current generated asset locations to avoid breaking existing character folders.
