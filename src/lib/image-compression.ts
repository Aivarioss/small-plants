export const HUS_PHOTO_MAX_DIMENSION = 1600;
export const HUS_PHOTO_TARGET_MAX_BYTES = 500 * 1024;
export const HUS_PHOTO_TARGET_MIN_BYTES = 300 * 1024;
export const HUS_PHOTO_SAFE_MAX_BYTES = 900 * 1024;

type DecodedImage = {
  close?: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
};

export type ImageCompressionRuntime = {
  decode: (file: File) => Promise<DecodedImage>;
  encodeJpeg: (image: DecodedImage, width: number, height: number, quality: number) => Promise<Blob>;
};

type CompressionCandidate = {
  blob: Blob;
  height: number;
  quality: number;
  width: number;
};

const dimensionsToTry = [1600, 1400, 1200, 1000];
const qualitiesToTry = [0.82, 0.76, 0.7, 0.64, 0.58];

export async function compressHusPhotoForUpload(file: File, runtime: ImageCompressionRuntime = browserImageRuntime): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  const decoded = await runtime.decode(file);
  try {
    const candidates: CompressionCandidate[] = [];
    for (const maxDimension of dimensionsToTry) {
      const dimensions = fitWithin(decoded.width, decoded.height, maxDimension);
      for (const quality of qualitiesToTry) {
        const blob = await runtime.encodeJpeg(decoded, dimensions.width, dimensions.height, quality);
        const candidate = { blob, height: dimensions.height, quality, width: dimensions.width };
        candidates.push(candidate);
        if (blob.size <= HUS_PHOTO_TARGET_MAX_BYTES && blob.size >= HUS_PHOTO_TARGET_MIN_BYTES) {
          return blobToFile(blob, file);
        }
      }
    }

    const bestUnderTarget = candidates
      .filter((candidate) => candidate.blob.size <= HUS_PHOTO_TARGET_MAX_BYTES)
      .sort((left, right) => right.blob.size - left.blob.size)[0];
    if (bestUnderTarget) {
      return blobToFile(bestUnderTarget.blob, file);
    }

    const bestSafe = candidates
      .filter((candidate) => candidate.blob.size <= HUS_PHOTO_SAFE_MAX_BYTES)
      .sort((left, right) => left.blob.size - right.blob.size)[0];
    if (bestSafe) {
      return blobToFile(bestSafe.blob, file);
    }

    throw new Error("Fotogrāfija ir par lielu. Samazini to telefonā un mēģini vēlreiz.");
  } finally {
    decoded.close?.();
  }
}

function fitWithin(width: number, height: number, maxDimension: number): { height: number; width: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) {
    return { height, width };
  }

  const scale = maxDimension / longest;
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

function blobToFile(blob: Blob, original: File): File {
  const baseName = original.name.replace(/\.[^.]+$/, "") || "hus-photo";
  return new File([blob], `${baseName}.jpg`, {
    lastModified: Date.now(),
    type: "image/jpeg",
  });
}

const browserImageRuntime: ImageCompressionRuntime = {
  async decode(file) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width,
      };
    }

    const image = await loadHtmlImage(file);
    return {
      height: image.naturalHeight,
      source: image,
      width: image.naturalWidth,
    };
  },

  async encodeJpeg(image, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Neizdevās sagatavot attēlu augšupielādei.");
    }

    context.drawImage(image.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) {
      throw new Error("Neizdevās samazināt attēlu pirms augšupielādes.");
    }

    return blob;
  },
};

async function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Neizdevās nolasīt attēlu."));
    });
    image.src = url;
    return await loaded;
  } finally {
    URL.revokeObjectURL(url);
  }
}
