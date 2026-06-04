import sharp from "sharp";

export interface SpriteSheetOptions {
  frameWidth: number;
  frameHeight: number;
}

export interface SliceSpriteSheetOptions {
  rows: number;
  columns: number;
  keyColor: string;
  tolerance: number;
  centerFrames?: boolean;
  centerMode?: "frame" | "row";
  outputFrameWidth?: number;
  outputFrameHeight?: number;
  normalizeSubjectScale?: boolean;
  targetSubjectHeight?: number;
  directionLayout?: "grid" | "contact-2x2";
}

export interface SlicedSpriteFrame {
  row: number;
  index: number;
  width: number;
  height: number;
  buffer: Buffer;
}

export type FourDirectionKey = "down" | "up" | "left" | "right";

export type FourDirectionBuffers = Record<FourDirectionKey, Buffer>;

export interface LoopSegment {
  startFrame: number;
  endFrame: number;
  frameCount: number;
  score: number;
}

export interface LoopSegmentOptions {
  minLoopFrames: number;
  maxLoopFrames: number;
}

export interface FrameSignatureOptions {
  size?: number;
  keyColor?: string;
  tolerance?: number;
}

export interface SampledBackgroundKeyOptions {
  tolerance?: number;
}

export interface SplitFourDirectionOptions {
  bleedMargin?: number;
  keyColor?: string;
  tolerance?: number;
}

export interface AlignIdleFourDirectionOptions extends SpriteSheetOptions {
  keyColor: string;
  tolerance?: number;
  profile?: CharacterFrameProfile | null;
}

export interface CharacterFrameProfile extends SpriteSheetOptions {
  referenceBox: ForegroundBox;
}

type RgbColor = { r: number; g: number; b: number };
type ForegroundBox = { left: number; top: number; right: number; bottom: number };
type AlphaComponent = ForegroundBox & { count: number; pixels: number[] };
const DEFAULT_CHROMA_KEY_TOLERANCE = 255;

interface AlphaArtifactCleanupOptions {
  preferredBox?: ForegroundBox;
  nearMargin?: number;
}

export async function applyColorKeyToBuffer(
  input: Buffer,
  keyColor: string,
  tolerance = DEFAULT_CHROMA_KEY_TOLERANCE
): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot apply color key to image without dimensions");
  }

  const raw = await image.raw().toBuffer();
  const key = parseHexColor(keyColor);

  for (let index = 0; index < raw.length; index += 4) {
    const r = raw[index] ?? 0;
    const g = raw[index + 1] ?? 0;
    const b = raw[index + 2] ?? 0;
    if (isKeyColorPixel({ r, g, b }, key, tolerance)) {
      raw[index + 3] = 0;
    }
  }

  return sharp(raw, {
    raw: {
      width: metadata.width,
      height: metadata.height,
      channels: 4
    }
  })
    .png()
    .toBuffer();
}

export async function applySampledBackgroundKeyToBuffer(
  input: Buffer,
  options: SampledBackgroundKeyOptions = {}
): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot apply sampled background key without dimensions");
  }

  const raw = await image.raw().toBuffer();
  const backgroundModel = buildSampledBackgroundModel(raw, metadata.width, metadata.height, options.tolerance ?? DEFAULT_CHROMA_KEY_TOLERANCE);
  const backgroundMask = findConnectedBackgroundMask(raw, metadata.width, metadata.height, backgroundModel);
  for (let pixelIndex = 0; pixelIndex < backgroundMask.length; pixelIndex += 1) {
    if (backgroundMask[pixelIndex] === 1 || isGlobalGreenScreenBackgroundPixel(raw, pixelIndex, backgroundModel)) {
      raw[(pixelIndex * 4) + 3] = 0;
    }
  }

  return sharp(raw, {
    raw: {
      width: metadata.width,
      height: metadata.height,
      channels: 4
    }
  })
    .png()
    .toBuffer();
}

export async function matteFrameBuffer(
  input: Buffer,
  options: {
    tolerance?: number;
  } = {}
): Promise<Buffer> {
  return applySampledBackgroundKeyToBuffer(input, { tolerance: getSpriteSheetKeyTolerance(options.tolerance ?? DEFAULT_CHROMA_KEY_TOLERANCE) });
}

export async function splitAndCenterFourDirectionFrameBuffer(
  input: Buffer,
  keyColor: string,
  tolerance = DEFAULT_CHROMA_KEY_TOLERANCE
): Promise<FourDirectionBuffers> {
  const split = await splitFourDirectionFrameBuffer(input);
  return {
    down: await centerSubjectBuffer(split.down, keyColor, tolerance),
    up: await centerSubjectBuffer(split.up, keyColor, tolerance),
    left: await centerSubjectBuffer(split.left, keyColor, tolerance),
    right: await centerSubjectBuffer(split.right, keyColor, tolerance)
  };
}

export async function splitFourDirectionFrameBuffer(
  input: Buffer,
  options: SplitFourDirectionOptions = {}
): Promise<FourDirectionBuffers> {
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot split image without dimensions");
  }
  const halfWidth = Math.floor(metadata.width / 2);
  const halfHeight = Math.floor(metadata.height / 2);
  if (halfWidth <= 0 || halfHeight <= 0) {
    throw new Error("Cannot split image smaller than 2x2 pixels");
  }
  const bleedMargin = Math.max(0, Math.round(options.bleedMargin ?? 0));

  const extractQuadrant = async (left: number, top: number) => {
    if (bleedMargin <= 0) {
      return sharp(input)
        .extract({ left, top, width: halfWidth, height: halfHeight })
        .png()
        .toBuffer();
    }

    const sourceLeft = Math.max(0, left - bleedMargin);
    const sourceTop = Math.max(0, top - bleedMargin);
    const sourceRight = Math.min(metadata.width, left + halfWidth + bleedMargin);
    const sourceBottom = Math.min(metadata.height, top + halfHeight + bleedMargin);
    const sourceWidth = sourceRight - sourceLeft;
    const sourceHeight = sourceBottom - sourceTop;
    const outputWidth = halfWidth + (bleedMargin * 2);
    const outputHeight = halfHeight + (bleedMargin * 2);
    const destinationLeft = bleedMargin - (left - sourceLeft);
    const destinationTop = bleedMargin - (top - sourceTop);
    const background = options.keyColor ? parseHexColor(options.keyColor) : { r: 0, g: 255, b: 0 };
    const expanded = await sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 4,
        background: { ...background, alpha: 1 }
      }
    })
      .composite([{
        input: await sharp(input)
          .extract({ left: sourceLeft, top: sourceTop, width: sourceWidth, height: sourceHeight })
          .png()
          .toBuffer(),
        left: destinationLeft,
        top: destinationTop
      }])
      .png()
      .toBuffer();

    if (!options.keyColor) {
      return expanded;
    }

    const keyed = await applySampledBackgroundKeyToBuffer(expanded, { tolerance: options.tolerance });
    const cleaned = await removeDetachedAlphaArtifacts(keyed, {
      preferredBox: {
        left: bleedMargin,
        top: bleedMargin,
        right: bleedMargin + halfWidth - 1,
        bottom: bleedMargin + halfHeight - 1
      },
      nearMargin: 0
    });
    return sharp(cleaned)
      .flatten({ background })
      .ensureAlpha()
      .png()
      .toBuffer();
  };

  return {
    down: await extractQuadrant(0, 0),
    up: await extractQuadrant(halfWidth, 0),
    left: await extractQuadrant(0, halfHeight),
    right: await extractQuadrant(halfWidth, halfHeight)
  };
}

export async function alignIdleFourDirectionSheetToWalkBuffers(
  idleSheet: Buffer,
  walkFrames: Record<FourDirectionKey, readonly Buffer[]>,
  options: AlignIdleFourDirectionOptions
): Promise<FourDirectionBuffers> {
  const split = await splitFourDirectionFrameBuffer(idleSheet);
  if (options.profile) {
    const keyed: Record<FourDirectionKey, Buffer[]> = {
      down: [await keyCleanAndPadIdleDirection(split.down, options)],
      up: [await keyCleanAndPadIdleDirection(split.up, options)],
      left: [await keyCleanAndPadIdleDirection(split.left, options)],
      right: [await keyCleanAndPadIdleDirection(split.right, options)]
    };
    const normalized = await normalizeFourDirectionFrameSequencesToProfile(keyed, options.profile);
    return {
      down: normalized.down[0] ?? await createTransparentCanvas(options.frameWidth, options.frameHeight),
      up: normalized.up[0] ?? await createTransparentCanvas(options.frameWidth, options.frameHeight),
      left: normalized.left[0] ?? await createTransparentCanvas(options.frameWidth, options.frameHeight),
      right: normalized.right[0] ?? await createTransparentCanvas(options.frameWidth, options.frameHeight)
    };
  }
  return {
    down: await alignIdleDirectionToWalkFrames(split.down, walkFrames.down, options),
    up: await alignIdleDirectionToWalkFrames(split.up, walkFrames.up, options),
    left: await alignIdleDirectionToWalkFrames(split.left, walkFrames.left, options),
    right: await alignIdleDirectionToWalkFrames(split.right, walkFrames.right, options)
  };
}

export async function createCharacterFrameProfileFromBuffer(input: Buffer): Promise<CharacterFrameProfile | null> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot create character frame profile without dimensions");
  }
  const raw = await image.raw().toBuffer();
  const referenceBox = findAlphaForegroundBox(raw, metadata.width, metadata.height);
  return referenceBox ? {
    frameWidth: metadata.width,
    frameHeight: metadata.height,
    referenceBox
  } : null;
}

export async function normalizeFourDirectionFrameSequencesToProfile(
  directionFrames: Record<FourDirectionKey, readonly Buffer[]>,
  profile: CharacterFrameProfile | null
): Promise<Record<FourDirectionKey, Buffer[]>> {
  return {
    down: await normalizeFrameSequenceToProfile(directionFrames.down, profile),
    up: await normalizeFrameSequenceToProfile(directionFrames.up, profile),
    left: await normalizeFrameSequenceToProfile(directionFrames.left, profile),
    right: await normalizeFrameSequenceToProfile(directionFrames.right, profile)
  };
}

export async function centerFrameSequenceBuffers(
  inputs: readonly Buffer[],
  keyColor: string,
  tolerance = DEFAULT_CHROMA_KEY_TOLERANCE
): Promise<Buffer[]> {
  if (inputs.length === 0) {
    return [];
  }

  const key = parseHexColor(keyColor);
  const frames = [];
  let expectedWidth: number | undefined;
  let expectedHeight: number | undefined;
  let unionBox: ForegroundBox | null = null;

  for (const input of inputs) {
    const image = sharp(input).ensureAlpha();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Cannot center image sequence without dimensions");
    }
    expectedWidth ??= metadata.width;
    expectedHeight ??= metadata.height;
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      throw new Error("Cannot center image sequence with mixed frame dimensions");
    }

    const raw = await image.raw().toBuffer();
    const box = findForegroundBox(raw, metadata.width, metadata.height, key, tolerance);
    if (box) {
      unionBox = mergeForegroundBoxes(unionBox, box);
    }
    frames.push({
      input,
      width: metadata.width,
      height: metadata.height,
      box
    });
  }

  if (!unionBox || expectedWidth === undefined || expectedHeight === undefined) {
    return Promise.all(inputs.map((input) => sharp(input).png().toBuffer()));
  }

  const unionWidth = unionBox.right - unionBox.left + 1;
  const unionHeight = unionBox.bottom - unionBox.top + 1;
  const offsetX = Math.round((expectedWidth - unionWidth) / 2) - unionBox.left;
  const offsetY = Math.round((expectedHeight - unionHeight) / 2) - unionBox.top;

  return Promise.all(
    frames.map((frame) => shiftFrameBuffer(frame.input, frame.width, frame.height, key, offsetX, offsetY))
  );
}

export async function centerSubjectBuffer(
  input: Buffer,
  keyColor: string,
  tolerance = DEFAULT_CHROMA_KEY_TOLERANCE
): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot center image without dimensions");
  }
  const raw = await image.raw().toBuffer();
  const key = parseHexColor(keyColor);
  const box = findForegroundBox(raw, metadata.width, metadata.height, key, tolerance);
  if (!box) {
    return sharp(input).png().toBuffer();
  }

  const subject = await sharp(input)
    .extract({
      left: box.left,
      top: box.top,
      width: box.right - box.left + 1,
      height: box.bottom - box.top + 1
    })
    .png()
    .toBuffer();
  const background = parseHexColor(keyColor);
  const left = Math.round((metadata.width - (box.right - box.left + 1)) / 2);
  const top = Math.round((metadata.height - (box.bottom - box.top + 1)) / 2);

  return sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: { ...background, alpha: 1 }
    }
  })
    .composite([{ input: subject, left, top }])
    .png()
    .toBuffer();
}

export async function createFrameSignatureBuffer(
  input: Buffer,
  options: FrameSignatureOptions = {}
): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot create frame signature without dimensions");
  }
  const raw = await image.raw().toBuffer();
  if (options.keyColor) {
    const key = parseHexColor(options.keyColor);
    const tolerance = options.tolerance ?? DEFAULT_CHROMA_KEY_TOLERANCE;
    for (let index = 0; index < raw.length; index += 4) {
      const pixel = {
        r: raw[index] ?? 0,
        g: raw[index + 1] ?? 0,
        b: raw[index + 2] ?? 0
      };
      if (isKeyColorPixel(pixel, key, tolerance)) {
        raw[index] = 0;
        raw[index + 1] = 0;
        raw[index + 2] = 0;
        raw[index + 3] = 0;
      }
    }
  }

  return sharp(raw, {
    raw: {
      width: metadata.width,
      height: metadata.height,
      channels: 4
    }
  })
    .resize(options.size ?? 48, options.size ?? 48, {
      fit: "fill",
      kernel: "nearest"
    })
    .raw()
    .toBuffer();
}

export function findBestLoopSegment(
  signatures: readonly Buffer[],
  options: LoopSegmentOptions
): LoopSegment {
  if (signatures.length === 0) {
    return { startFrame: 0, endFrame: 0, frameCount: 0, score: 0 };
  }
  if (signatures.length === 1) {
    return { startFrame: 1, endFrame: 1, frameCount: 1, score: 1 };
  }

  const longestCandidateLength = signatures.length - 1;
  const minLoopFrames = Math.min(
    Math.max(1, Math.round(options.minLoopFrames)),
    longestCandidateLength
  );
  const maxLoopFrames = Math.min(
    Math.max(minLoopFrames, Math.round(options.maxLoopFrames)),
    longestCandidateLength
  );
  let best = {
    startIndex: 0,
    repeatIndex: minLoopFrames,
    difference: Number.POSITIVE_INFINITY
  };

  for (let startIndex = 0; startIndex < signatures.length - 1; startIndex += 1) {
    const minRepeatIndex = startIndex + minLoopFrames;
    const maxRepeatIndex = Math.min(signatures.length - 1, startIndex + maxLoopFrames);
    for (let repeatIndex = minRepeatIndex; repeatIndex <= maxRepeatIndex; repeatIndex += 1) {
      const first = signatures[startIndex];
      const second = signatures[repeatIndex];
      if (!first || !second) {
        continue;
      }
      const difference = calculateSignatureDifference(first, second);
      const currentLength = repeatIndex - startIndex;
      const bestLength = best.repeatIndex - best.startIndex;
      if (
        difference < best.difference
        || (difference === best.difference && currentLength > bestLength)
      ) {
        best = { startIndex, repeatIndex, difference };
      }
    }
  }

  if (!Number.isFinite(best.difference)) {
    best = { startIndex: 0, repeatIndex: signatures.length - 1, difference: 255 };
  }
  const endIndex = Math.max(best.startIndex, best.repeatIndex - 1);

  return {
    startFrame: best.startIndex + 1,
    endFrame: endIndex + 1,
    frameCount: endIndex - best.startIndex + 1,
    score: Number((1 - Math.min(255, best.difference) / 255).toFixed(4))
  };
}

export async function resizeNearestBuffer(input: Buffer, targetSize: number): Promise<Buffer> {
  return sharp(input)
    .resize(targetSize, targetSize, {
      fit: "contain",
      kernel: "nearest",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

export async function buildFourDirectionSpriteSheetFromBuffers(
  directionFrames: Record<FourDirectionKey, readonly Buffer[]>,
  options: SpriteSheetOptions
): Promise<Buffer> {
  const directions: FourDirectionKey[] = ["down", "up", "left", "right"];
  const maxFrames = Math.max(...directions.map((direction) => directionFrames[direction].length));
  if (maxFrames === 0) {
    throw new Error("Cannot build four-direction sprite sheet without frames");
  }

  const composites = [];
  for (const [rowIndex, direction] of directions.entries()) {
    for (const [frameIndex, frame] of directionFrames[direction].entries()) {
      composites.push({
        input: frame,
        left: frameIndex * options.frameWidth,
        top: rowIndex * options.frameHeight
      });
    }
  }

  return sharp({
    create: {
      width: maxFrames * options.frameWidth,
      height: directions.length * options.frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function buildFourDirectionContactSheetFromBuffers(
  directionFrames: FourDirectionBuffers,
  options: SpriteSheetOptions
): Promise<Buffer> {
  const directions: FourDirectionKey[] = ["down", "up", "left", "right"];
  const composites = directions.map((direction, index) => ({
    input: directionFrames[direction],
    left: (index % 2) * options.frameWidth,
    top: Math.floor(index / 2) * options.frameHeight
  }));

  return sharp({
    create: {
      width: options.frameWidth * 2,
      height: options.frameHeight * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function buildSpriteSheetFromBuffers(
  frames: readonly Buffer[],
  options: SpriteSheetOptions
): Promise<Buffer> {
  if (frames.length === 0) {
    throw new Error("Cannot build sprite sheet without frames");
  }

  const width = options.frameWidth * frames.length;
  const height = options.frameHeight;
  const composites = frames.map((frame, index) => ({
    input: frame,
    left: index * options.frameWidth,
    top: 0
  }));

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function sliceSpriteSheetBuffer(
  input: Buffer,
  options: SliceSpriteSheetOptions
): Promise<SlicedSpriteFrame[]> {
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot slice sprite sheet without dimensions");
  }
  const frameWidth = Math.floor(metadata.width / options.columns);
  const frameHeight = Math.floor(metadata.height / options.rows);
  if (frameWidth < 1 || frameHeight < 1) {
    throw new Error("Sprite sheet grid is larger than the image");
  }

  let frames: SlicedSpriteFrame[] = [];
  if (options.directionLayout === "grid") {
    frames = await sliceSpriteSheetByForegroundRows(input, options, metadata.width, metadata.height, frameWidth, frameHeight);
  }
  if (frames.length === 0) {
    for (let row = 0; row < options.rows; row += 1) {
      for (let column = 0; column < options.columns; column += 1) {
        const cropped = await sharp(input)
          .extract({
            left: column * frameWidth,
            top: row * frameHeight,
            width: frameWidth,
            height: frameHeight
          })
          .png()
          .toBuffer();
        frames.push({
          row: row + 1,
          index: column + 1,
          width: frameWidth,
          height: frameHeight,
          buffer: await matteFrameBuffer(cropped, {
            tolerance: options.tolerance
          })
        });
      }
    }
  }

  if (options.directionLayout === "contact-2x2") {
    frames = mapContactSheet2x2ToDirectionRows(frames);
  }
  if (options.outputFrameWidth && options.outputFrameHeight && options.normalizeSubjectScale) {
    await normalizeTransparentFrameSubjectScale(frames, options.targetSubjectHeight, {
      frameWidth: options.outputFrameWidth,
      frameHeight: options.outputFrameHeight
    });
  } else if (options.outputFrameWidth && options.outputFrameHeight) {
    for (const frame of frames) {
      frame.buffer = await resizeTransparentBufferToSize(frame.buffer, options.outputFrameWidth, options.outputFrameHeight);
      frame.width = options.outputFrameWidth;
      frame.height = options.outputFrameHeight;
    }
  }
  if (isGreenScreenKey(parseHexColor(options.keyColor))) {
    for (const frame of frames) {
      frame.buffer = await applySpriteSheetGreenScreenCleanupToBuffer(
        await applyColorKeyToBuffer(frame.buffer, options.keyColor, getSpriteSheetKeyTolerance(options.tolerance))
      );
    }
  }
  if (options.normalizeSubjectScale && !(options.outputFrameWidth && options.outputFrameHeight)) {
    await normalizeTransparentFrameSubjectScale(frames, options.targetSubjectHeight);
  }
  if (options.centerFrames) {
    const centerMode = options.centerMode === "row" ? "row" : "frame";
    if (centerMode === "row") {
      for (const row of uniqueFrameRows(frames)) {
        const rowFrames = frames.filter((frame) => frame.row === row);
        const centered = await centerTransparentFrameSequenceBuffers(rowFrames.map((frame) => frame.buffer));
        rowFrames.forEach((frame, index) => {
          frame.buffer = centered[index] ?? frame.buffer;
        });
      }
    } else {
      for (const frame of frames) {
        frame.buffer = await centerTransparentFrameBuffer(frame.buffer);
      }
    }
  }
  if (isGreenScreenKey(parseHexColor(options.keyColor))) {
    for (const frame of frames) {
      frame.buffer = await applySpriteSheetGreenScreenCleanupToBuffer(
        await applyColorKeyToBuffer(frame.buffer, options.keyColor, getSpriteSheetKeyTolerance(options.tolerance))
      );
    }
  }
  return frames;
}

async function applySpriteSheetGreenScreenCleanupToBuffer(input: Buffer): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot clean sprite sheet green screen without dimensions");
  }
  const raw = await image.raw().toBuffer();
  for (let index = 0; index < raw.length; index += 4) {
    if ((raw[index + 3] ?? 0) === 0) {
      continue;
    }
    const pixel = {
      r: raw[index] ?? 0,
      g: raw[index + 1] ?? 0,
      b: raw[index + 2] ?? 0
    };
    if (isSpriteSheetGreenSpillPixel(pixel)) {
      raw[index + 3] = 0;
    }
  }
  return sharp(raw, {
    raw: {
      width: metadata.width,
      height: metadata.height,
      channels: 4
    }
  }).png().toBuffer();
}

async function sliceSpriteSheetByForegroundRows(
  input: Buffer,
  options: SliceSpriteSheetOptions,
  sheetWidth: number,
  sheetHeight: number,
  fallbackFrameWidth: number,
  fallbackFrameHeight: number
): Promise<SlicedSpriteFrame[]> {
  const key = parseHexColor(options.keyColor);
  const raw = await sharp(input).ensureAlpha().raw().toBuffer();
  const rowSegments = findForegroundRowSegments(raw, sheetWidth, sheetHeight, key, options.tolerance);
  if (rowSegments.length < 2) {
    return [];
  }
  const rows = rowSegments.slice(0, options.rows);
  const frames: SlicedSpriteFrame[] = [];
  for (const [row, rowSegment] of rows.entries()) {
    const top = Math.max(0, rowSegment.top - 8);
    const bottom = Math.min(sheetHeight - 1, rowSegment.bottom + 8);
    const height = bottom - top + 1;
    const rowBuffer = await sharp(input)
      .extract({ left: 0, top, width: sheetWidth, height })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const segments = findForegroundColumnSegmentsForExpectedColumns(rowBuffer, sheetWidth, height, key, options.tolerance, options.columns);
    if (segments.length < 2) {
      return [];
    }
    for (const [index, segment] of segments.entries()) {
      const left = Math.max(0, segment.left - 4);
      const right = Math.min(sheetWidth - 1, segment.right + 4);
      const cropped = await sharp(input)
        .extract({
          left,
          top,
          width: right - left + 1,
          height
        })
        .png()
        .toBuffer();
      frames.push({
        row: row + 1,
        index: index + 1,
        width: fallbackFrameWidth,
        height: fallbackFrameHeight,
        buffer: await matteFrameBuffer(cropped, {
          tolerance: options.tolerance
        })
      });
    }
  }
  return frames;
}

function findForegroundRowSegments(
  raw: Buffer,
  width: number,
  height: number,
  key: RgbColor,
  tolerance: number
): Array<{ top: number; bottom: number }> {
  const occupied = new Uint8Array(height);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      const alpha = raw[index + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }
      const r = raw[index] ?? 0;
      const g = raw[index + 1] ?? 0;
      const b = raw[index + 2] ?? 0;
      if (!isKeyColorPixel({ r, g, b }, key, tolerance)) {
        count += 1;
      }
    }
    if (count >= 8) {
      occupied[y] = 1;
    }
  }

  const merged: Array<{ top: number; bottom: number }> = [];
  let current: { top: number; bottom: number } | null = null;
  let lastOccupied = -1;
  for (let y = 0; y < height; y += 1) {
    if (occupied[y] !== 1) {
      continue;
    }
    if (!current || (lastOccupied >= 0 && y - lastOccupied > 20)) {
      if (current) {
        merged.push(current);
      }
      current = { top: y, bottom: y };
    } else {
      current.bottom = y;
    }
    lastOccupied = y;
  }
  if (current) {
    merged.push(current);
  }
  return merged.filter((segment) => segment.bottom - segment.top + 1 >= 24);
}

function findForegroundColumnSegments(
  raw: Buffer,
  width: number,
  height: number,
  key: RgbColor,
  tolerance: number,
  maxGap = 18
): Array<{ left: number; right: number }> {
  const occupied = new Uint8Array(width);
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      const index = ((y * width) + x) * 4;
      const alpha = raw[index + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }
      const r = raw[index] ?? 0;
      const g = raw[index + 1] ?? 0;
      const b = raw[index + 2] ?? 0;
      if (!isKeyColorPixel({ r, g, b }, key, tolerance)) {
        count += 1;
      }
    }
    if (count >= 3) {
      occupied[x] = 1;
    }
  }

  const merged: Array<{ left: number; right: number }> = [];
  let current: { left: number; right: number } | null = null;
  let lastOccupied = -1;
  for (let x = 0; x < width; x += 1) {
    if (occupied[x] !== 1) {
      continue;
    }
    if (!current || (lastOccupied >= 0 && x - lastOccupied > maxGap)) {
      if (current) {
        merged.push(current);
      }
      current = { left: x, right: x };
    } else {
      current.right = x;
    }
    lastOccupied = x;
  }
  if (current) {
    merged.push(current);
  }
  return merged.filter((segment) => segment.right - segment.left + 1 >= 12);
}

function findForegroundColumnSegmentsForExpectedColumns(
  raw: Buffer,
  width: number,
  height: number,
  key: RgbColor,
  tolerance: number,
  expectedColumns: number
): Array<{ left: number; right: number }> {
  const gapAttempts = [18, 14, 10];
  let best = findForegroundColumnSegments(raw, width, height, key, tolerance, gapAttempts[0]);
  if (expectedColumns <= 0 || best.length >= expectedColumns) {
    return best;
  }
  for (const gap of gapAttempts.slice(1)) {
    const segments = findForegroundColumnSegments(raw, width, height, key, tolerance, gap);
    if (segments.length === expectedColumns) {
      return segments;
    }
    if (segments.length > best.length && segments.length <= expectedColumns) {
      best = segments;
    }
  }
  return best;
}

function getSpriteSheetKeyTolerance(tolerance: number): number {
  return Math.max(tolerance, 220);
}

export async function alignTransparentFrameToReferenceBuffers(
  input: Buffer,
  referenceBuffers: readonly Buffer[]
): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot align image without dimensions");
  }
  const raw = await image.raw().toBuffer();
  const inputBox = findAlphaForegroundBox(raw, metadata.width, metadata.height);
  const referenceBox = await findUnionAlphaForegroundBox(referenceBuffers);
  if (!inputBox || !referenceBox) {
    return sharp(input).png().toBuffer();
  }

  const subjectWidth = getBoxWidth(inputBox);
  const subjectHeight = getBoxHeight(inputBox);
  const referenceHeight = getBoxHeight(referenceBox);
  const scale = Math.min(
    referenceHeight / subjectHeight,
    (metadata.width - 2) / subjectWidth,
    (metadata.height - 2) / subjectHeight
  );
  const resizedWidth = Math.max(1, Math.round(subjectWidth * scale));
  const resizedHeight = Math.max(1, Math.round(subjectHeight * scale));
  const subject = await sharp(input)
    .extract({
      left: inputBox.left,
      top: inputBox.top,
      width: subjectWidth,
      height: subjectHeight
    })
    .resize(resizedWidth, resizedHeight, {
      fit: "fill",
      kernel: "nearest"
    })
    .png()
    .toBuffer();
  const referenceCenterX = (referenceBox.left + referenceBox.right) / 2;
  const referenceCenterY = (referenceBox.top + referenceBox.bottom) / 2;
  const left = clampInteger(Math.round(referenceCenterX - (resizedWidth / 2)), 0, Math.max(0, metadata.width - resizedWidth));
  const top = clampInteger(Math.round(referenceCenterY - (resizedHeight / 2)), 0, Math.max(0, metadata.height - resizedHeight));

  return sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: subject, left, top }])
    .png()
    .toBuffer();
}

function mapContactSheet2x2ToDirectionRows(frames: readonly SlicedSpriteFrame[]): SlicedSpriteFrame[] {
  const findFrame = (row: number, index: number) => frames.find((frame) => frame.row === row && frame.index === index);
  const directionMap = [
    { sourceRow: 1, sourceIndex: 1, targetRow: 1 },
    { sourceRow: 1, sourceIndex: 2, targetRow: 2 },
    { sourceRow: 2, sourceIndex: 1, targetRow: 3 },
    { sourceRow: 2, sourceIndex: 2, targetRow: 4 }
  ];
  return directionMap.flatMap((entry) => {
    const frame = findFrame(entry.sourceRow, entry.sourceIndex);
    return frame ? [{ ...frame, row: entry.targetRow, index: 1 }] : [];
  });
}

function uniqueFrameRows(frames: readonly SlicedSpriteFrame[]): number[] {
  return Array.from(new Set(frames.map((frame) => frame.row))).sort((first, second) => first - second);
}

async function resizeTransparentBufferToSize(input: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(input)
    .resize(width, height, {
      fit: "contain",
      kernel: "nearest",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function centerTransparentFrameSequenceBuffers(inputs: readonly Buffer[]): Promise<Buffer[]> {
  if (inputs.length === 0) {
    return [];
  }

  const frames = [];
  let expectedWidth: number | undefined;
  let expectedHeight: number | undefined;
  let unionBox: ForegroundBox | null = null;

  for (const input of inputs) {
    const image = sharp(input).ensureAlpha();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Cannot center image sequence without dimensions");
    }
    expectedWidth ??= metadata.width;
    expectedHeight ??= metadata.height;
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      throw new Error("Cannot center image sequence with mixed frame dimensions");
    }
    const raw = await image.raw().toBuffer();
    const box = findAlphaForegroundBox(raw, metadata.width, metadata.height);
    if (box) {
      unionBox = mergeForegroundBoxes(unionBox, box);
    }
    frames.push({
      input,
      width: metadata.width,
      height: metadata.height
    });
  }

  if (!unionBox || expectedWidth === undefined || expectedHeight === undefined) {
    return Promise.all(inputs.map((input) => sharp(input).png().toBuffer()));
  }

  const unionWidth = getBoxWidth(unionBox);
  const unionHeight = getBoxHeight(unionBox);
  const offsetX = Math.round((expectedWidth - unionWidth) / 2) - unionBox.left;
  const offsetY = Math.round((expectedHeight - unionHeight) / 2) - unionBox.top;

  return Promise.all(frames.map((frame) => shiftTransparentFrameBuffer(frame.input, frame.width, frame.height, offsetX, offsetY)));
}

async function centerTransparentFrameBuffer(input: Buffer): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot center transparent image without dimensions");
  }
  const raw = await image.raw().toBuffer();
  const box = findAlphaForegroundBox(raw, metadata.width, metadata.height);
  if (!box) {
    return sharp(input).png().toBuffer();
  }
  const width = getBoxWidth(box);
  const height = getBoxHeight(box);
  const offsetX = Math.round((metadata.width - width) / 2) - box.left;
  const offsetY = Math.round((metadata.height - height) / 2) - box.top;
  return shiftTransparentFrameBuffer(input, metadata.width, metadata.height, offsetX, offsetY);
}

async function shiftTransparentFrameBuffer(
  input: Buffer,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{
      input,
      left: offsetX,
      top: offsetY
    }])
    .png()
    .toBuffer();
}

async function normalizeTransparentFrameSubjectScale(
  frames: SlicedSpriteFrame[],
  targetSubjectHeight?: number,
  outputCanvas?: SpriteSheetOptions
): Promise<void> {
  const boxes = await Promise.all(frames.map(async (frame) => {
    const image = sharp(frame.buffer).ensureAlpha();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      return null;
    }
    const raw = await image.raw().toBuffer();
    return findAlphaForegroundBox(raw, metadata.width, metadata.height);
  }));
  const heights = boxes
    .filter((box): box is ForegroundBox => Boolean(box))
    .map(getBoxHeight);
  if (heights.length === 0) {
    return;
  }
  const normalizedTargetSubjectHeight = Number.isFinite(targetSubjectHeight)
    ? Math.max(1, Math.round(targetSubjectHeight ?? 0))
    : undefined;
  const targetHeight = normalizedTargetSubjectHeight ?? Math.max(...heights);
  for (const [index, frame] of frames.entries()) {
    const box = boxes[index];
    if (!box) {
      continue;
    }
    const sourceWidth = getBoxWidth(box);
    const sourceHeight = getBoxHeight(box);
    const outputWidth = outputCanvas?.frameWidth ?? frame.width;
    const outputHeight = outputCanvas?.frameHeight ?? frame.height;
    const scale = normalizedTargetSubjectHeight
      ? Math.min(targetHeight / sourceHeight, outputHeight / sourceHeight)
      : Math.min(targetHeight / sourceHeight, outputWidth / sourceWidth, outputHeight / sourceHeight);
    const resizedWidth = Math.max(1, Math.round(sourceWidth * scale));
    const resizedHeight = Math.max(1, Math.round(sourceHeight * scale));
    let subject = await sharp(frame.buffer)
      .extract({
        left: box.left,
        top: box.top,
        width: sourceWidth,
        height: sourceHeight
      })
      .resize(resizedWidth, resizedHeight, {
        fit: "fill",
        kernel: "nearest"
      })
      .png()
      .toBuffer();
    const subjectWidth = Math.min(resizedWidth, outputWidth);
    const subjectHeight = Math.min(resizedHeight, outputHeight);
    if (resizedWidth > outputWidth || resizedHeight > outputHeight) {
      subject = await sharp(subject)
        .extract({
          left: Math.max(0, Math.floor((resizedWidth - subjectWidth) / 2)),
          top: Math.max(0, Math.floor((resizedHeight - subjectHeight) / 2)),
          width: subjectWidth,
          height: subjectHeight
        })
        .png()
        .toBuffer();
    }
    const left = Math.round((outputWidth - subjectWidth) / 2);
    const top = Math.round((outputHeight - subjectHeight) / 2);
    frame.buffer = await sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: subject, left, top }])
      .png()
      .toBuffer();
    frame.width = outputWidth;
    frame.height = outputHeight;
  }
}

async function normalizeFrameSequenceToProfile(
  buffers: readonly Buffer[],
  profile: CharacterFrameProfile | null
): Promise<Buffer[]> {
  if (!profile || buffers.length === 0) {
    return [...buffers];
  }

  const baselineBuffer = buffers[0];
  if (!baselineBuffer) {
    return [...buffers];
  }
  const baseline = await getAlphaFrameInfo(baselineBuffer);
  if (!baseline) {
    return [...buffers];
  }
  const referenceBox = scaleProfileBoxToFrame(profile, baseline.width, baseline.height);
  const baselineHeight = getBoxHeight(baseline.box);
  if (baselineHeight <= 0) {
    return [...buffers];
  }
  const scale = clampScaleToFrame(
    getBoxHeight(referenceBox) / baselineHeight,
    baseline.box,
    baseline.width,
    baseline.height
  );
  const baselineCenter = getBoxCenter(baseline.box);
  const referenceCenter = getBoxCenter(referenceBox);

  return Promise.all(buffers.map(async (buffer) => {
    const frame = await getAlphaFrameInfo(buffer);
    if (!frame) {
      return buffer;
    }
    const boxWidth = getBoxWidth(frame.box);
    const boxHeight = getBoxHeight(frame.box);
    const outputWidth = Math.max(1, Math.min(frame.width, Math.round(boxWidth * scale)));
    const outputHeight = Math.max(1, Math.min(frame.height, Math.round(boxHeight * scale)));
    const frameCenter = getBoxCenter(frame.box);
    const targetCenterX = referenceCenter.x + ((frameCenter.x - baselineCenter.x) * scale);
    const targetCenterY = referenceCenter.y + ((frameCenter.y - baselineCenter.y) * scale);
    const left = clampInteger(Math.round(targetCenterX - (outputWidth / 2)), 0, Math.max(0, frame.width - outputWidth));
    const top = clampInteger(Math.round(targetCenterY - (outputHeight / 2)), 0, Math.max(0, frame.height - outputHeight));
    const subject = await sharp(buffer)
      .extract({
        left: frame.box.left,
        top: frame.box.top,
        width: boxWidth,
        height: boxHeight
      })
      .resize(outputWidth, outputHeight, {
        fit: "fill",
        kernel: "nearest"
      })
      .png()
      .toBuffer();
    return sharp({
      create: {
        width: frame.width,
        height: frame.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: subject, left, top }])
      .png()
      .toBuffer();
  }));
}

async function getAlphaFrameInfo(buffer: Buffer): Promise<{ width: number; height: number; box: ForegroundBox } | null> {
  const image = sharp(buffer).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return null;
  }
  const raw = await image.raw().toBuffer();
  const box = findAlphaForegroundBox(raw, metadata.width, metadata.height);
  return box ? { width: metadata.width, height: metadata.height, box } : null;
}

function scaleProfileBoxToFrame(profile: CharacterFrameProfile, frameWidth: number, frameHeight: number): ForegroundBox {
  const scaleX = frameWidth / profile.frameWidth;
  const scaleY = frameHeight / profile.frameHeight;
  return {
    left: Math.round(profile.referenceBox.left * scaleX),
    top: Math.round(profile.referenceBox.top * scaleY),
    right: Math.round(((profile.referenceBox.right + 1) * scaleX) - 1),
    bottom: Math.round(((profile.referenceBox.bottom + 1) * scaleY) - 1)
  };
}

function clampScaleToFrame(scale: number, box: ForegroundBox, frameWidth: number, frameHeight: number): number {
  const width = getBoxWidth(box);
  const height = getBoxHeight(box);
  const maxScale = Math.min(frameWidth / width, frameHeight / height);
  return Math.max(0.05, Math.min(scale, maxScale));
}

function getBoxCenter(box: ForegroundBox): { x: number; y: number } {
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2
  };
}

async function keyAndCleanIdleDirection(
  idleDirection: Buffer,
  options: AlignIdleFourDirectionOptions
): Promise<Buffer> {
  return removeDetachedAlphaArtifacts(
    await applySampledBackgroundKeyToBuffer(idleDirection, { tolerance: options.tolerance })
  );
}

async function keyCleanAndPadIdleDirection(
  idleDirection: Buffer,
  options: AlignIdleFourDirectionOptions
): Promise<Buffer> {
  const keyed = await keyAndCleanIdleDirection(idleDirection, options);
  const frame = await getAlphaFrameInfo(keyed);
  if (!frame) {
    return createTransparentCanvas(options.frameWidth, options.frameHeight);
  }
  const width = getBoxWidth(frame.box);
  const height = getBoxHeight(frame.box);
  const subject = await sharp(keyed)
    .extract({
      left: frame.box.left,
      top: frame.box.top,
      width,
      height
    })
    .png()
    .toBuffer();
  const left = clampInteger(Math.round((options.frameWidth - width) / 2), 0, Math.max(0, options.frameWidth - width));
  const top = clampInteger(Math.round((options.frameHeight - height) / 2), 0, Math.max(0, options.frameHeight - height));

  return sharp({
    create: {
      width: options.frameWidth,
      height: options.frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: subject, left, top }])
    .png()
    .toBuffer();
}

async function createTransparentCanvas(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).png().toBuffer();
}

async function alignIdleDirectionToWalkFrames(
  idleDirection: Buffer,
  walkFrames: readonly Buffer[],
  options: AlignIdleFourDirectionOptions
): Promise<Buffer> {
  const keyedIdle = await keyAndCleanIdleDirection(idleDirection, options);
  const idleImage = sharp(keyedIdle).ensureAlpha();
  const idleMetadata = await idleImage.metadata();
  if (!idleMetadata.width || !idleMetadata.height) {
    throw new Error("Cannot align idle image without dimensions");
  }
  const idleRaw = await idleImage.raw().toBuffer();
  const idleBox = findAlphaForegroundBox(idleRaw, idleMetadata.width, idleMetadata.height)
    ?? findForegroundBox(idleRaw, idleMetadata.width, idleMetadata.height, parseHexColor(options.keyColor), options.tolerance ?? DEFAULT_CHROMA_KEY_TOLERANCE);
  const referenceBox = await findUnionAlphaForegroundBox(walkFrames);

  if (!idleBox || !referenceBox) {
    return sharp({
      create: {
        width: options.frameWidth,
        height: options.frameHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).png().toBuffer();
  }

  const idleWidth = getBoxWidth(idleBox);
  const idleHeight = getBoxHeight(idleBox);
  const referenceWidth = getBoxWidth(referenceBox);
  const referenceHeight = getBoxHeight(referenceBox);
  const scale = Math.min(referenceWidth / idleWidth, referenceHeight / idleHeight);
  const outputWidth = Math.max(1, Math.round(idleWidth * scale));
  const outputHeight = Math.max(1, Math.round(idleHeight * scale));
  const subject = await sharp(keyedIdle)
    .extract({
      left: idleBox.left,
      top: idleBox.top,
      width: idleWidth,
      height: idleHeight
    })
    .resize(outputWidth, outputHeight, {
      fit: "fill",
      kernel: "lanczos3"
    })
    .png()
    .toBuffer();
  const referenceCenterX = (referenceBox.left + referenceBox.right) / 2;
  const referenceCenterY = (referenceBox.top + referenceBox.bottom) / 2;
  const left = clampInteger(Math.round(referenceCenterX - (outputWidth / 2)), 0, Math.max(0, options.frameWidth - outputWidth));
  const top = clampInteger(Math.round(referenceCenterY - (outputHeight / 2)), 0, Math.max(0, options.frameHeight - outputHeight));

  return sharp({
    create: {
      width: options.frameWidth,
      height: options.frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: subject, left, top }])
    .png()
    .toBuffer();
}

export async function removeDetachedAlphaArtifacts(
  input: Buffer,
  options: AlphaArtifactCleanupOptions = {}
): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot clean alpha artifacts without dimensions");
  }
  const raw = await image.raw().toBuffer();
  const components = findAlphaComponents(raw, metadata.width, metadata.height);
  if (components.length <= 1) {
    return sharp(raw, {
      raw: {
        width: metadata.width,
        height: metadata.height,
        channels: 4
      }
    }).png().toBuffer();
  }

  const primary = selectPrimaryAlphaComponent(components, metadata.width, options.preferredBox);
  if (!primary) {
    return sharp(raw, {
      raw: {
        width: metadata.width,
        height: metadata.height,
        channels: 4
      }
    }).png().toBuffer();
  }
  const margin = options.nearMargin ?? Math.max(2, Math.round(Math.min(metadata.width, metadata.height) * 0.03));
  for (const component of components) {
    if (component === primary || boxesAreNear(component, primary, margin)) {
      continue;
    }
    for (const pixelIndex of component.pixels) {
      raw[(pixelIndex * 4) + 3] = 0;
    }
  }

  return sharp(raw, {
    raw: {
      width: metadata.width,
      height: metadata.height,
      channels: 4
    }
  }).png().toBuffer();
}

async function findUnionAlphaForegroundBox(frames: readonly Buffer[]): Promise<ForegroundBox | null> {
  let unionBox: ForegroundBox | null = null;
  for (const frame of frames) {
    const image = sharp(frame).ensureAlpha();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      continue;
    }
    const raw = await image.raw().toBuffer();
    const box = findAlphaForegroundBox(raw, metadata.width, metadata.height);
    if (box) {
      unionBox = mergeForegroundBoxes(unionBox, box);
    }
  }
  return unionBox;
}

function findAlphaComponents(
  raw: Buffer,
  width: number,
  height: number
): AlphaComponent[] {
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: AlphaComponent[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = (y * width) + x;
      if (seen[startIndex] === 1 || (raw[(startIndex * 4) + 3] ?? 0) === 0) {
        continue;
      }

      let left = x;
      let top = y;
      let right = x;
      let bottom = y;
      let head = 0;
      let tail = 0;
      const pixels: number[] = [];
      queue[tail] = startIndex;
      tail += 1;
      seen[startIndex] = 1;

      while (head < tail) {
        const pixelIndex = queue[head] ?? 0;
        head += 1;
        pixels.push(pixelIndex);
        const pixelX = pixelIndex % width;
        const pixelY = Math.floor(pixelIndex / width);
        left = Math.min(left, pixelX);
        top = Math.min(top, pixelY);
        right = Math.max(right, pixelX);
        bottom = Math.max(bottom, pixelY);

        const enqueue = (nextX: number, nextY: number) => {
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            return;
          }
          const nextIndex = (nextY * width) + nextX;
          if (seen[nextIndex] === 1 || (raw[(nextIndex * 4) + 3] ?? 0) === 0) {
            return;
          }
          seen[nextIndex] = 1;
          queue[tail] = nextIndex;
          tail += 1;
        };
        enqueue(pixelX + 1, pixelY);
        enqueue(pixelX - 1, pixelY);
        enqueue(pixelX, pixelY + 1);
        enqueue(pixelX, pixelY - 1);
      }

      components.push({
        left,
        top,
        right,
        bottom,
        count: pixels.length,
        pixels
      });
    }
  }

  return components.sort((first, second) => second.count - first.count);
}

function selectPrimaryAlphaComponent(
  components: readonly AlphaComponent[],
  width: number,
  preferredBox: ForegroundBox | undefined
): AlphaComponent | undefined {
  if (!preferredBox) {
    return components[0];
  }

  let best = components[0];
  let bestOverlap = -1;
  for (const component of components) {
    const overlap = countComponentPixelsInsideBox(component, width, preferredBox);
    if (
      overlap > bestOverlap
      || (overlap === bestOverlap && best && component.count > best.count)
    ) {
      best = component;
      bestOverlap = overlap;
    }
  }

  return bestOverlap > 0 ? best : components[0];
}

function countComponentPixelsInsideBox(component: AlphaComponent, width: number, box: ForegroundBox): number {
  let count = 0;
  for (const pixelIndex of component.pixels) {
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      count += 1;
    }
  }
  return count;
}

function findAlphaForegroundBox(raw: Buffer, width: number, height: number): ForegroundBox | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = raw[((y * width) + x) * 4 + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return right >= left && bottom >= top ? { left, top, right, bottom } : null;
}

function boxesAreNear(first: ForegroundBox, second: ForegroundBox, margin: number): boolean {
  return first.left <= second.right + margin
    && first.right >= second.left - margin
    && first.top <= second.bottom + margin
    && first.bottom >= second.top - margin;
}

function getBoxWidth(box: ForegroundBox): number {
  return box.right - box.left + 1;
}

function getBoxHeight(box: ForegroundBox): number {
  return box.bottom - box.top + 1;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHexColor(hex: string): RgbColor {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function buildSampledBackgroundModel(
  raw: Buffer,
  width: number,
  height: number,
  tolerance: number
): { color: RgbColor; threshold: number; tolerance: number } {
  const samples = sampleBorderColors(raw, width, height);
  if (samples.length === 0) {
    return { color: { r: 0, g: 0, b: 0 }, threshold: 0, tolerance };
  }
  const color = {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b))
  };
  const distances = samples.map((sample) => calculateColorDistance(sample, color)).sort((a, b) => a - b);
  const spread = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.9))] ?? 0;
  const toleranceBoost = Math.max(0, Math.min(255, tolerance)) * 0.35;
  const threshold = Math.max(28, Math.min(150, 38 + toleranceBoost + (spread * 0.8)));
  return { color, threshold, tolerance };
}

function sampleBorderColors(raw: Buffer, width: number, height: number): RgbColor[] {
  const samples: RgbColor[] = [];
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 96));
  const addSample = (x: number, y: number) => {
    const offset = ((y * width) + x) * 4;
    const alpha = raw[offset + 3] ?? 0;
    if (alpha === 0) {
      return;
    }
    samples.push({
      r: raw[offset] ?? 0,
      g: raw[offset + 1] ?? 0,
      b: raw[offset + 2] ?? 0
    });
  };

  for (let x = 0; x < width; x += stride) {
    addSample(x, 0);
    addSample(x, height - 1);
  }
  for (let y = 0; y < height; y += stride) {
    addSample(0, y);
    addSample(width - 1, y);
  }
  addSample(width - 1, 0);
  addSample(width - 1, height - 1);
  addSample(0, height - 1);
  return samples;
}

function findConnectedBackgroundMask(
  raw: Buffer,
  width: number,
  height: number,
  background: { color: RgbColor; threshold: number; tolerance: number }
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    const pixelIndex = (y * width) + x;
    if (mask[pixelIndex] === 1 || !isSampledBackgroundPixel(raw, pixelIndex, background)) {
      return;
    }
    mask[pixelIndex] = 1;
    queue[tail] = pixelIndex;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const pixelIndex = queue[head] ?? 0;
    head += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return mask;
}

function isSampledBackgroundPixel(
  raw: Buffer,
  pixelIndex: number,
  background: { color: RgbColor; threshold: number; tolerance: number }
): boolean {
  const offset = pixelIndex * 4;
  if ((raw[offset + 3] ?? 0) === 0) {
    return false;
  }
  const pixel = {
    r: raw[offset] ?? 0,
    g: raw[offset + 1] ?? 0,
    b: raw[offset + 2] ?? 0
  };
  if (calculateColorDistance(pixel, background.color) <= background.threshold) {
    return true;
  }
  return isGreenScreenKey(background.color) && isGreenScreenPixel(pixel, background.tolerance);
}

function isGlobalGreenScreenBackgroundPixel(
  raw: Buffer,
  pixelIndex: number,
  background: { color: RgbColor; threshold: number; tolerance: number }
): boolean {
  if (!isGreenScreenKey(background.color)) {
    return false;
  }
  const offset = pixelIndex * 4;
  if ((raw[offset + 3] ?? 0) === 0) {
    return false;
  }
  return isGreenScreenPixel({
    r: raw[offset] ?? 0,
    g: raw[offset + 1] ?? 0,
    b: raw[offset + 2] ?? 0
  }, background.tolerance);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function findForegroundBox(
  raw: Buffer,
  width: number,
  height: number,
  key: RgbColor,
  tolerance: number
): ForegroundBox | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const alpha = raw[offset + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }
      const pixel = {
        r: raw[offset] ?? 0,
        g: raw[offset + 1] ?? 0,
        b: raw[offset + 2] ?? 0
      };
      if (isKeyColorPixel(pixel, key, tolerance)) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return right >= left && bottom >= top ? { left, top, right, bottom } : null;
}

function mergeForegroundBoxes(current: ForegroundBox | null, next: ForegroundBox): ForegroundBox {
  if (!current) {
    return next;
  }
  return {
    left: Math.min(current.left, next.left),
    top: Math.min(current.top, next.top),
    right: Math.max(current.right, next.right),
    bottom: Math.max(current.bottom, next.bottom)
  };
}

async function shiftFrameBuffer(
  input: Buffer,
  width: number,
  height: number,
  background: RgbColor,
  offsetX: number,
  offsetY: number
): Promise<Buffer> {
  const sourceLeft = Math.max(0, -offsetX);
  const sourceTop = Math.max(0, -offsetY);
  const destinationLeft = Math.max(0, offsetX);
  const destinationTop = Math.max(0, offsetY);
  const extractWidth = Math.min(width - sourceLeft, width - destinationLeft);
  const extractHeight = Math.min(height - sourceTop, height - destinationTop);
  const canvas = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { ...background, alpha: 1 }
    }
  });

  if (extractWidth <= 0 || extractHeight <= 0) {
    return canvas.png().toBuffer();
  }

  const shiftedRegion = await sharp(input)
    .extract({
      left: sourceLeft,
      top: sourceTop,
      width: extractWidth,
      height: extractHeight
    })
    .png()
    .toBuffer();

  return canvas
    .composite([{ input: shiftedRegion, left: destinationLeft, top: destinationTop }])
    .png()
    .toBuffer();
}

function calculateSignatureDifference(first: Buffer, second: Buffer): number {
  const length = Math.min(first.length, second.length);
  if (length === 0) {
    return 255;
  }
  if (first.length % 4 === 0 && second.length % 4 === 0) {
    let total = 0;
    let foregroundPixels = 0;
    for (let index = 0; index < length; index += 4) {
      const firstAlpha = first[index + 3] ?? 0;
      const secondAlpha = second[index + 3] ?? 0;
      if (firstAlpha === 0 && secondAlpha === 0) {
        continue;
      }
      total += (
        Math.abs((first[index] ?? 0) - (second[index] ?? 0))
        + Math.abs((first[index + 1] ?? 0) - (second[index + 1] ?? 0))
        + Math.abs((first[index + 2] ?? 0) - (second[index + 2] ?? 0))
        + Math.abs(firstAlpha - secondAlpha)
      ) / 4;
      foregroundPixels += 1;
    }
    if (foregroundPixels > 0) {
      return total / foregroundPixels;
    }
  }
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((first[index] ?? 0) - (second[index] ?? 0));
  }
  return total / length;
}

function calculateColorDistance(first: RgbColor, second: RgbColor): number {
  return Math.max(
    Math.abs(first.r - second.r),
    Math.abs(first.g - second.g),
    Math.abs(first.b - second.b)
  );
}

function isKeyColorPixel(
  pixel: RgbColor,
  key: RgbColor,
  tolerance: number
): boolean {
  if (isGreenScreenKey(key)) {
    return isGreenScreenPixel(pixel, tolerance);
  }
  const distance = Math.max(
    Math.abs(pixel.r - key.r),
    Math.abs(pixel.g - key.g),
    Math.abs(pixel.b - key.b)
  );
  return distance <= tolerance;
}

function isGreenScreenKey(key: RgbColor): boolean {
  return key.g > 160 && key.g > key.r * 1.8 && key.g > key.b * 1.8;
}

function isGreenScreenPixel(pixel: RgbColor, tolerance: number): boolean {
  const strength = Math.max(0, Math.min(255, tolerance)) / 255;
  const minGreen = 170 - (strength * 110);
  const minDominance = 96 - (strength * 76);
  const dominance = pixel.g - Math.max(pixel.r, pixel.b);
  return pixel.g >= minGreen && dominance >= minDominance;
}

function isSpriteSheetGreenSpillPixel(pixel: RgbColor): boolean {
  return pixel.g >= 28 && pixel.g > pixel.r + 6 && pixel.g > pixel.b + 4;
}
