import sharp from "sharp";

export interface SpriteSheetOptions {
  frameWidth: number;
  frameHeight: number;
}

export async function applyColorKeyToBuffer(
  input: Buffer,
  keyColor: string,
  tolerance = 8
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
    const distance = Math.max(Math.abs(r - key.r), Math.abs(g - key.g), Math.abs(b - key.b));
    if (distance <= tolerance) {
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

function parseHexColor(hex: string): { r: number; g: number; b: number } {
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
