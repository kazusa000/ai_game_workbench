import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  applyColorKeyToBuffer,
  applySampledBackgroundKeyToBuffer,
  alignIdleFourDirectionSheetToWalkBuffers,
  buildSpriteSheetFromBuffers,
  centerFrameSequenceBuffers,
  createCharacterFrameProfileFromBuffer,
  findBestLoopSegment,
  normalizeFourDirectionFrameSequencesToProfile,
  resizeNearestBuffer,
  sliceSpriteSheetBuffer,
  splitAndCenterFourDirectionFrameBuffer,
  splitFourDirectionFrameBuffer
} from "../src/processing/imageProcessing";

describe("applyColorKeyToBuffer", () => {
  it("turns matching key-color pixels transparent and keeps other pixels opaque", async () => {
    const input = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .raw()
      .toBuffer();
    input.set([0, 255, 0, 255, 255, 0, 0, 255]);

    const png = await sharp(input, {
      raw: { width: 2, height: 1, channels: 4 }
    })
      .png()
      .toBuffer();

    const keyed = await applyColorKeyToBuffer(png, "#00ff00", 0);
    const output = await sharp(keyed).raw().toBuffer();

    expect([...output]).toEqual([0, 255, 0, 0, 255, 0, 0, 255]);
  });

  it("turns strong green-screen pixels transparent without hiding non-green pixels", async () => {
    const input = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .raw()
      .toBuffer();
    input.set([
      12, 228, 28, 255,
      236, 230, 215, 255
    ]);

    const png = await sharp(input, {
      raw: { width: 2, height: 1, channels: 4 }
    })
      .png()
      .toBuffer();

    const keyed = await applyColorKeyToBuffer(png, "#00ff00", 8);
    const output = await sharp(keyed).raw().toBuffer();

    expect([...output]).toEqual([
      12, 228, 28, 0,
      236, 230, 215, 255
    ]);
  });

  it("removes compressed darker green-screen pixels at the default tolerance", async () => {
    const input = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .raw()
      .toBuffer();
    input.set([
      6, 172, 12, 255,
      55, 42, 38, 255
    ]);

    const png = await sharp(input, {
      raw: { width: 2, height: 1, channels: 4 }
    })
      .png()
      .toBuffer();

    const keyed = await applyColorKeyToBuffer(png, "#00ff00", 8);
    const output = await sharp(keyed).raw().toBuffer();

    expect([...output]).toEqual([
      6, 172, 12, 0,
      55, 42, 38, 255
    ]);
  });

  it("uses higher tolerance to remove weaker green spill while keeping neutral light pixels", async () => {
    const input = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .raw()
      .toBuffer();
    input.set([70, 150, 75, 255, 236, 230, 215, 255]);

    const png = await sharp(input, {
      raw: { width: 2, height: 1, channels: 4 }
    })
      .png()
      .toBuffer();

    const strict = await sharp(await applyColorKeyToBuffer(png, "#00ff00", 0)).raw().toBuffer();
    const loose = await sharp(await applyColorKeyToBuffer(png, "#00ff00", 180)).raw().toBuffer();

    expect([...strict]).toEqual([70, 150, 75, 255, 236, 230, 215, 255]);
    expect([...loose]).toEqual([70, 150, 75, 0, 236, 230, 215, 255]);
  });
});

describe("applySampledBackgroundKeyToBuffer", () => {
  it("removes connected sampled background even when it is not bright green", async () => {
    const width = 5;
    const height = 5;
    const raw = Buffer.alloc(width * height * 4);
    for (let index = 0; index < raw.length; index += 4) {
      raw[index] = 28;
      raw[index + 1] = 76;
      raw[index + 2] = 32;
      raw[index + 3] = 255;
    }
    const center = ((2 * width) + 2) * 4;
    raw[center] = 240;
    raw[center + 1] = 40;
    raw[center + 2] = 40;

    const png = await sharp(raw, {
      raw: { width, height, channels: 4 }
    })
      .png()
      .toBuffer();

    const keyed = await applySampledBackgroundKeyToBuffer(png, { tolerance: 8 });
    const output = await sharp(keyed).raw().toBuffer();

    expect(output[3]).toBe(0);
    expect(output[center + 3]).toBe(255);
  });

  it("keeps enclosed character pixels even when they are close to the sampled background", async () => {
    const width = 5;
    const height = 5;
    const raw = Buffer.alloc(width * height * 4);
    for (let index = 0; index < raw.length; index += 4) {
      raw[index] = 24;
      raw[index + 1] = 80;
      raw[index + 2] = 28;
      raw[index + 3] = 255;
    }
    const center = ((2 * width) + 2) * 4;
    raw[center] = 20;
    raw[center + 1] = 22;
    raw[center + 2] = 20;

    const png = await sharp(raw, {
      raw: { width, height, channels: 4 }
    })
      .png()
      .toBuffer();

    const keyed = await applySampledBackgroundKeyToBuffer(png, { tolerance: 8 });
    const output = await sharp(keyed).raw().toBuffer();

    expect(output[3]).toBe(0);
    expect(output[center + 3]).toBe(255);
  });

  it("uses tolerance to remove dirty green connected to a pure green centered canvas", async () => {
    const width = 5;
    const height = 5;
    const raw = Buffer.alloc(width * height * 4);
    for (let index = 0; index < raw.length; index += 4) {
      raw[index] = 0;
      raw[index + 1] = 255;
      raw[index + 2] = 0;
      raw[index + 3] = 255;
    }
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        const offset = ((y * width) + x) * 4;
        raw[offset] = 28;
        raw[offset + 1] = 76;
        raw[offset + 2] = 32;
      }
    }
    const center = ((2 * width) + 2) * 4;
    raw[center] = 240;
    raw[center + 1] = 40;
    raw[center + 2] = 40;

    const png = await sharp(raw, {
      raw: { width, height, channels: 4 }
    })
      .png()
      .toBuffer();

    const keyed = await applySampledBackgroundKeyToBuffer(png, { tolerance: 255 });
    const output = await sharp(keyed).raw().toBuffer();
    const dirtyGreen = ((1 * width) + 1) * 4;

    expect(output[3]).toBe(0);
    expect(output[dirtyGreen + 3]).toBe(0);
    expect(output[center + 3]).toBe(255);
  });

  it("removes enclosed green-screen holes that are not connected to the image border", async () => {
    const width = 7;
    const height = 7;
    const raw = Buffer.alloc(width * height * 4);
    for (let index = 0; index < raw.length; index += 4) {
      raw[index] = 0;
      raw[index + 1] = 255;
      raw[index + 2] = 0;
      raw[index + 3] = 255;
    }
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        const offset = ((y * width) + x) * 4;
        raw[offset] = 40;
        raw[offset + 1] = 38;
        raw[offset + 2] = 36;
      }
    }
    const enclosedGreen = ((3 * width) + 3) * 4;
    raw[enclosedGreen] = 28;
    raw[enclosedGreen + 1] = 76;
    raw[enclosedGreen + 2] = 32;

    const png = await sharp(raw, {
      raw: { width, height, channels: 4 }
    })
      .png()
      .toBuffer();

    const keyed = await applySampledBackgroundKeyToBuffer(png, { tolerance: 255 });
    const output = await sharp(keyed).raw().toBuffer();
    const characterRing = ((2 * width) + 3) * 4;

    expect(output[3]).toBe(0);
    expect(output[enclosedGreen + 3]).toBe(0);
    expect(output[characterRing + 3]).toBe(255);
  });
});

describe("resizeNearestBuffer", () => {
  it("resizes an image to a square target size", async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    const resized = await resizeNearestBuffer(png, 4);
    const metadata = await sharp(resized).metadata();

    expect(metadata.width).toBe(4);
    expect(metadata.height).toBe(4);
  });
});

describe("buildSpriteSheetFromBuffers", () => {
  it("composes frames horizontally", async () => {
    const red = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer();
    const blue = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    const sheet = await buildSpriteSheetFromBuffers([red, blue], {
      frameWidth: 2,
      frameHeight: 2
    });
    const metadata = await sharp(sheet).metadata();

    expect(metadata.width).toBe(4);
    expect(metadata.height).toBe(2);
  });
});

describe("splitFourDirectionFrameBuffer", () => {
  it("keeps bleed from the owning quadrant and removes detached bleed from adjacent quadrants", async () => {
    const width = 8;
    const height = 8;
    const raw = Buffer.alloc(width * height * 4);
    for (let index = 0; index < raw.length; index += 4) {
      raw[index] = 0;
      raw[index + 1] = 255;
      raw[index + 2] = 0;
      raw[index + 3] = 255;
    }

    const paintPixel = (x: number, y: number, color: [number, number, number]) => {
      const offset = ((y * width) + x) * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
    };

    for (let y = 1; y <= 4; y += 1) {
      paintPixel(1, y, [255, 0, 0]);
    }
    for (let y = 5; y <= 7; y += 1) {
      paintPixel(2, y, [0, 0, 255]);
      paintPixel(3, y, [0, 0, 255]);
    }

    const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const split = await splitFourDirectionFrameBuffer(png, {
      bleedMargin: 2,
      keyColor: "#00ff00",
      tolerance: 0
    });
    const down = await sharp(split.down).raw().toBuffer({ resolveWithObject: true });
    const left = await sharp(split.left).raw().toBuffer({ resolveWithObject: true });

    const countColor = (
      image: typeof down,
      color: [number, number, number]
    ) => {
      let count = 0;
      for (let index = 0; index < image.data.length; index += 4) {
        if (
          image.data[index] === color[0]
          && image.data[index + 1] === color[1]
          && image.data[index + 2] === color[2]
        ) {
          count += 1;
        }
      }
      return count;
    };

    expect(down.info.width).toBe(8);
    expect(down.info.height).toBe(8);
    expect(countColor(down, [255, 0, 0])).toBe(4);
    expect(countColor(left, [255, 0, 0])).toBe(0);
    expect(countColor(left, [0, 0, 255])).toBe(6);
  });
});

describe("splitAndCenterFourDirectionFrameBuffer", () => {
  it("splits a 2x2 frame into direction quadrants and centers the visible character", async () => {
    const width = 8;
    const height = 8;
    const raw = Buffer.alloc(width * height * 4);
    for (let index = 0; index < raw.length; index += 4) {
      raw[index] = 0;
      raw[index + 1] = 255;
      raw[index + 2] = 0;
      raw[index + 3] = 255;
    }
    const paintRect = (left: number, top: number) => {
      for (let y = top; y < top + 2; y += 1) {
        for (let x = left; x < left + 2; x += 1) {
          const offset = ((y * width) + x) * 4;
          raw[offset] = 255;
          raw[offset + 1] = 0;
          raw[offset + 2] = 0;
        }
      }
    };
    paintRect(0, 0);
    paintRect(4, 0);
    paintRect(0, 4);
    paintRect(4, 4);
    const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();

    const result = await splitAndCenterFourDirectionFrameBuffer(png, "#00ff00", 0);
    const down = await sharp(result.down).raw().toBuffer({ resolveWithObject: true });

    expect(Object.keys(result).sort()).toEqual(["down", "left", "right", "up"]);
    expect(down.info.width).toBe(4);
    expect(down.info.height).toBe(4);
    const redOffsets = [];
    for (let y = 0; y < down.info.height; y += 1) {
      for (let x = 0; x < down.info.width; x += 1) {
        const offset = ((y * down.info.width) + x) * 4;
        if (down.data[offset] === 255 && down.data[offset + 1] === 0 && down.data[offset + 2] === 0) {
          redOffsets.push(`${x},${y}`);
        }
      }
    }
    expect(redOffsets.sort()).toEqual(["1,1", "1,2", "2,1", "2,2"]);
  });
});

describe("centerFrameSequenceBuffers", () => {
  it("uses one offset for the whole sequence instead of re-centering every frame", async () => {
    const createFrame = async (redX: number) => {
      const width = 4;
      const height = 4;
      const raw = Buffer.alloc(width * height * 4);
      for (let index = 0; index < raw.length; index += 4) {
        raw[index] = 0;
        raw[index + 1] = 255;
        raw[index + 2] = 0;
        raw[index + 3] = 255;
      }
      const offset = ((1 * width) + redX) * 4;
      raw[offset] = 255;
      raw[offset + 1] = 0;
      raw[offset + 2] = 0;
      return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    };
    const findRedX = async (png: Buffer) => {
      const image = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      for (let y = 0; y < image.info.height; y += 1) {
        for (let x = 0; x < image.info.width; x += 1) {
          const offset = ((y * image.info.width) + x) * 4;
          if (image.data[offset] === 255 && image.data[offset + 1] === 0 && image.data[offset + 2] === 0) {
            return x;
          }
        }
      }
      throw new Error("red pixel not found");
    };

    const centered = await centerFrameSequenceBuffers([
      await createFrame(0),
      await createFrame(1)
    ], "#00ff00", 0);

    await expect(findRedX(centered[0])).resolves.toBe(1);
    await expect(findRedX(centered[1])).resolves.toBe(2);
  });
});

describe("alignIdleFourDirectionSheetToWalkBuffers", () => {
  it("resizes and places idle directions against the processed walking frame boxes", async () => {
    const idleSheet = await createFourDirectionIdleSheet();
    const walkFrame = await createTransparentFrame({
      width: 8,
      height: 8,
      left: 3,
      top: 2,
      subjectWidth: 2,
      subjectHeight: 4
    });

    const aligned = await alignIdleFourDirectionSheetToWalkBuffers(
      idleSheet,
      {
        down: [walkFrame],
        up: [walkFrame],
        left: [walkFrame],
        right: [walkFrame]
      },
      {
        keyColor: "#00ff00",
        tolerance: 0,
        frameWidth: 8,
        frameHeight: 8
      }
    );

    for (const direction of ["down", "up", "left", "right"] as const) {
      const output = await sharp(aligned[direction]).raw().toBuffer({ resolveWithObject: true });
      const box = findAlphaBox(output.data, output.info.width, output.info.height);

      expect(output.info.width).toBe(8);
      expect(output.info.height).toBe(8);
      expect(box).toEqual({
        left: 3,
        top: 2,
        right: 4,
        bottom: 5,
        width: 2,
        height: 4
      });
    }
  });

  it("ignores detached idle artifacts before scaling and centering", async () => {
    const idleSheet = await createFourDirectionIdleSheetWithDetachedArtifact();
    const walkFrame = await createTransparentFrame({
      width: 24,
      height: 24,
      left: 9,
      top: 6,
      subjectWidth: 6,
      subjectHeight: 12
    });

    const aligned = await alignIdleFourDirectionSheetToWalkBuffers(
      idleSheet,
      {
        down: [walkFrame],
        up: [walkFrame],
        left: [walkFrame],
        right: [walkFrame]
      },
      {
        keyColor: "#00ff00",
        tolerance: 0,
        frameWidth: 24,
        frameHeight: 24
      }
    );

    const output = await sharp(aligned.down).raw().toBuffer({ resolveWithObject: true });
    const box = findAlphaBox(output.data, output.info.width, output.info.height);

    expect(box).toEqual({
      left: 9,
      top: 6,
      right: 14,
      bottom: 17,
      width: 6,
      height: 12
    });
  });
});

describe("normalizeFourDirectionFrameSequencesToProfile", () => {
  it("scales every direction to the first-frame character profile", async () => {
    const reference = await createTransparentFrame({
      width: 32,
      height: 32,
      left: 12,
      top: 8,
      subjectWidth: 8,
      subjectHeight: 16
    });
    const profile = await createCharacterFrameProfileFromBuffer(reference);
    expect(profile).not.toBeNull();

    const normalized = await normalizeFourDirectionFrameSequencesToProfile({
      down: [reference],
      up: [await createTransparentFrame({
        width: 32,
        height: 32,
        left: 14,
        top: 12,
        subjectWidth: 4,
        subjectHeight: 8
      })],
      left: [await createTransparentFrame({
        width: 32,
        height: 32,
        left: 10,
        top: 6,
        subjectWidth: 12,
        subjectHeight: 24
      })],
      right: [await createTransparentFrame({
        width: 32,
        height: 32,
        left: 15,
        top: 10,
        subjectWidth: 6,
        subjectHeight: 12
      })]
    }, profile);

    for (const direction of ["down", "up", "left", "right"] as const) {
      const output = await sharp(normalized[direction][0]).raw().toBuffer({ resolveWithObject: true });
      const box = findAlphaBox(output.data, output.info.width, output.info.height);
      expect(box).toMatchObject({
        left: 12,
        top: 8,
        right: 19,
        bottom: 23,
        width: 8,
        height: 16
      });
    }
  });

  it("uses each sequence first frame to choose one scale for later frames", async () => {
    const profile = await createCharacterFrameProfileFromBuffer(await createTransparentFrame({
      width: 64,
      height: 64,
      left: 24,
      top: 24,
      subjectWidth: 8,
      subjectHeight: 16
    }));
    expect(profile).not.toBeNull();

    const normalized = await normalizeFourDirectionFrameSequencesToProfile({
      down: [
        await createTransparentFrame({
          width: 64,
          height: 64,
          left: 30,
          top: 30,
          subjectWidth: 4,
          subjectHeight: 8
        }),
        await createTransparentFrame({
          width: 64,
          height: 64,
          left: 28,
          top: 24,
          subjectWidth: 4,
          subjectHeight: 12
        })
      ],
      up: [],
      left: [],
      right: []
    }, profile);

    const first = await sharp(normalized.down[0]).raw().toBuffer({ resolveWithObject: true });
    const second = await sharp(normalized.down[1]).raw().toBuffer({ resolveWithObject: true });
    const firstBox = findAlphaBox(first.data, first.info.width, first.info.height);
    const secondBox = findAlphaBox(second.data, second.info.width, second.info.height);

    expect(firstBox).toMatchObject({ width: 8, height: 16 });
    expect(secondBox).toMatchObject({ width: 8, height: 24 });
  });
});

describe("sliceSpriteSheetBuffer", () => {
  it("normalizes subjects to a fixed pixel height across different source sheet sizes", async () => {
    const smallSheet = await createSingleFrameSheet({
      width: 32,
      height: 64,
      subjectLeft: 8,
      subjectTop: 16,
      subjectWidth: 16,
      subjectHeight: 32
    });
    const largeSheet = await createSingleFrameSheet({
      width: 64,
      height: 128,
      subjectLeft: 16,
      subjectTop: 32,
      subjectWidth: 32,
      subjectHeight: 64
    });

    const [smallFrame] = await sliceSpriteSheetBuffer(smallSheet, {
      rows: 1,
      columns: 1,
      keyColor: "#00ff00",
      tolerance: 0,
      outputFrameWidth: 64,
      outputFrameHeight: 128,
      normalizeSubjectScale: true,
      targetSubjectHeight: 72
    });
    const [largeFrame] = await sliceSpriteSheetBuffer(largeSheet, {
      rows: 1,
      columns: 1,
      keyColor: "#00ff00",
      tolerance: 0,
      outputFrameWidth: 64,
      outputFrameHeight: 128,
      normalizeSubjectScale: true,
      targetSubjectHeight: 72
    });

    expect(smallFrame).toBeDefined();
    expect(largeFrame).toBeDefined();

    const smallOutput = await sharp(smallFrame!.buffer).raw().toBuffer({ resolveWithObject: true });
    const largeOutput = await sharp(largeFrame!.buffer).raw().toBuffer({ resolveWithObject: true });

    expect(findAlphaBox(smallOutput.data, smallOutput.info.width, smallOutput.info.height)).toMatchObject({
      width: 36,
      height: 72
    });
    expect(findAlphaBox(largeOutput.data, largeOutput.info.width, largeOutput.info.height)).toMatchObject({
      width: 36,
      height: 72
    });
  });
});

describe("findBestLoopSegment", () => {
  it("finds the most similar repeat frame and excludes it from the exported loop", () => {
    const signatures = [
      Buffer.from([0, 0, 0]),
      Buffer.from([10, 10, 10]),
      Buffer.from([50, 50, 50]),
      Buffer.from([90, 90, 90]),
      Buffer.from([11, 10, 10]),
      Buffer.from([200, 200, 200])
    ];

    const result = findBestLoopSegment(signatures, {
      minLoopFrames: 3,
      maxLoopFrames: 5
    });

    expect(result.startFrame).toBe(2);
    expect(result.endFrame).toBe(4);
    expect(result.frameCount).toBe(3);
    expect(result.score).toBeGreaterThan(0.98);
  });
});

async function createFourDirectionIdleSheet(): Promise<Buffer> {
  const width = 8;
  const height = 8;
  const raw = Buffer.alloc(width * height * 4);
  for (let index = 0; index < raw.length; index += 4) {
    raw[index] = 0;
    raw[index + 1] = 255;
    raw[index + 2] = 0;
    raw[index + 3] = 255;
  }

  const paintIdleSubject = (left: number, top: number) => {
    for (let y = top; y < top + 2; y += 1) {
      for (let x = left; x < left + 1; x += 1) {
        const offset = ((y * width) + x) * 4;
        raw[offset] = 255;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
      }
    }
  };
  paintIdleSubject(0, 0);
  paintIdleSubject(4, 0);
  paintIdleSubject(0, 4);
  paintIdleSubject(4, 4);

  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function createFourDirectionIdleSheetWithDetachedArtifact(): Promise<Buffer> {
  const width = 24;
  const height = 24;
  const raw = Buffer.alloc(width * height * 4);
  for (let index = 0; index < raw.length; index += 4) {
    raw[index] = 0;
    raw[index + 1] = 255;
    raw[index + 2] = 0;
    raw[index + 3] = 255;
  }

  const paintSubject = (left: number, top: number) => {
    for (let y = top; y < top + 6; y += 1) {
      for (let x = left; x < left + 3; x += 1) {
        const offset = ((y * width) + x) * 4;
        raw[offset] = 255;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
      }
    }
  };
  const paintArtifact = (left: number, top: number) => {
    for (let x = left; x < left + 4; x += 1) {
      const offset = ((top * width) + x) * 4;
      raw[offset] = 40;
      raw[offset + 1] = 40;
      raw[offset + 2] = 40;
    }
  };

  paintSubject(1, 1);
  paintArtifact(4, 11);
  paintSubject(13, 1);
  paintArtifact(16, 11);
  paintSubject(1, 13);
  paintArtifact(4, 23);
  paintSubject(13, 13);
  paintArtifact(16, 23);

  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function createTransparentFrame(input: {
  width: number;
  height: number;
  left: number;
  top: number;
  subjectWidth: number;
  subjectHeight: number;
}): Promise<Buffer> {
  const raw = Buffer.alloc(input.width * input.height * 4);
  for (let y = input.top; y < input.top + input.subjectHeight; y += 1) {
    for (let x = input.left; x < input.left + input.subjectWidth; x += 1) {
      const offset = ((y * input.width) + x) * 4;
      raw[offset] = 255;
      raw[offset + 1] = 0;
      raw[offset + 2] = 0;
      raw[offset + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width: input.width, height: input.height, channels: 4 } }).png().toBuffer();
}

async function createSingleFrameSheet(input: {
  width: number;
  height: number;
  subjectLeft: number;
  subjectTop: number;
  subjectWidth: number;
  subjectHeight: number;
}): Promise<Buffer> {
  const raw = Buffer.alloc(input.width * input.height * 4);
  for (let index = 0; index < raw.length; index += 4) {
    raw[index] = 0;
    raw[index + 1] = 255;
    raw[index + 2] = 0;
    raw[index + 3] = 255;
  }
  for (let y = input.subjectTop; y < input.subjectTop + input.subjectHeight; y += 1) {
    for (let x = input.subjectLeft; x < input.subjectLeft + input.subjectWidth; x += 1) {
      const offset = ((y * input.width) + x) * 4;
      raw[offset] = 255;
      raw[offset + 1] = 0;
      raw[offset + 2] = 0;
    }
  }
  return sharp(raw, { raw: { width: input.width, height: input.height, channels: 4 } }).png().toBuffer();
}

function findAlphaBox(raw: Buffer, width: number, height: number) {
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

  return right >= left && bottom >= top
    ? { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
    : null;
}
