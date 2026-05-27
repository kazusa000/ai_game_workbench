import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  applyColorKeyToBuffer,
  buildSpriteSheetFromBuffers,
  resizeNearestBuffer
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
