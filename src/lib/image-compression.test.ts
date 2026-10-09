import { describe, expect, it, vi } from "vitest";
import {
  compressHusPhotoForUpload,
  HUS_PHOTO_SAFE_MAX_BYTES,
  HUS_PHOTO_TARGET_MAX_BYTES,
  type ImageCompressionRuntime,
} from "./image-compression";

describe("HUS photo browser compression", () => {
  it("compresses a 4.5 MB phone JPG before upload and keeps the longest side at 1600 px", async () => {
    const calls: Array<{ height: number; quality: number; width: number }> = [];
    const runtime = runtimeMock({
      height: 4032,
      width: 3024,
      encode: (_width, _height, _quality) => {
        calls.push({ height: _height, quality: _quality, width: _width });
        return 420 * 1024;
      },
    });

    const result = await compressHusPhotoForUpload(jpegFile(4.5 * 1024 * 1024), runtime);

    expect(result.type).toBe("image/jpeg");
    expect(result.size).toBeLessThanOrEqual(HUS_PHOTO_TARGET_MAX_BYTES);
    expect(calls[0]).toMatchObject({ height: 1600, width: 1200 });
  });

  it("tries lower quality/dimensions until the target size is reached", async () => {
    const sizes = [980 * 1024, 760 * 1024, 520 * 1024, 440 * 1024];
    const runtime = runtimeMock({
      height: 3000,
      width: 4000,
      encode: () => sizes.shift() ?? 440 * 1024,
    });

    const result = await compressHusPhotoForUpload(jpegFile(5 * 1024 * 1024), runtime);

    expect(result.size).toBe(440 * 1024);
  });

  it("uses a safe compressed image when the 300-500 KB target cannot be reached", async () => {
    const runtime = runtimeMock({
      height: 3000,
      width: 4000,
      encode: () => 720 * 1024,
    });

    const result = await compressHusPhotoForUpload(jpegFile(6 * 1024 * 1024), runtime);

    expect(result.size).toBeLessThanOrEqual(HUS_PHOTO_SAFE_MAX_BYTES);
  });

  it("fails before upload when the image cannot be reduced to a safe request size", async () => {
    const runtime = runtimeMock({
      height: 3000,
      width: 4000,
      encode: () => 1.4 * 1024 * 1024,
    });

    await expect(compressHusPhotoForUpload(jpegFile(6 * 1024 * 1024), runtime)).rejects.toThrow(
      "Fotogrāfija ir par lielu",
    );
  });

  it("does not try to draw non-image files", async () => {
    const runtime = runtimeMock({
      height: 1000,
      width: 1000,
      encode: () => 400 * 1024,
    });
    const file = new File(["demo"], "note.txt", { type: "text/plain" });

    await expect(compressHusPhotoForUpload(file, runtime)).resolves.toBe(file);
  });
});

function jpegFile(size: number): File {
  return new File([new Uint8Array(Math.round(size))], "roots.jpg", { type: "image/jpeg" });
}

function runtimeMock({
  encode,
  height,
  width,
}: {
  encode: (width: number, height: number, quality: number) => number;
  height: number;
  width: number;
}): ImageCompressionRuntime {
  return {
    decode: vi.fn().mockResolvedValue({
      height,
      source: {} as CanvasImageSource,
      width,
    }),
    encodeJpeg: vi.fn().mockImplementation(async (_image, targetWidth: number, targetHeight: number, quality: number) => {
      const size = encode(targetWidth, targetHeight, quality);
      return new Blob([new Uint8Array(Math.round(size))], { type: "image/jpeg" });
    }),
  };
}
