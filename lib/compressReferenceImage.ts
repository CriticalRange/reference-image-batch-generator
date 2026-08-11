import imageCompression from 'browser-image-compression';

/**
 * Client-side reference prep for Vercel’s ~4.5 MB function payload limit.
 * Base64 inflates size by ~33%, so the raw file target stays well under 4.5 MB.
 */
export const REFERENCE_COMPRESS_MAX_SIZE_MB = 2.2;
export const REFERENCE_COMPRESS_MAX_DIMENSION = 2048;
/** Reject originals larger than this before attempting compression. */
export const REFERENCE_ORIGINAL_MAX_BYTES = 20 * 1024 * 1024;

export type CompressedReferenceImage = {
  base64: string;
  mimeType: string;
  previewDataUrl: string;
  /** Compressed file size in bytes (decoded). */
  byteLength: number;
  /** Original file size in bytes. */
  originalByteLength: number;
  wasCompressed: boolean;
};

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read compressed image'));
    reader.readAsDataURL(file);
  });
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const [prefix, base64 = ''] = dataUrl.split(',');
  const mimeMatch = /^data:(.*);base64$/i.exec(prefix ?? '');
  if (!mimeMatch?.[1] || !base64) {
    return null;
  }
  return { mimeType: mimeMatch[1], base64 };
}

/**
 * Compress / downscale a product photo with browser-image-compression
 * so the API request stays under Vercel’s payload limit.
 */
export async function compressReferenceImageFile(file: File): Promise<CompressedReferenceImage> {
  const originalByteLength = file.size;

  if (originalByteLength > REFERENCE_ORIGINAL_MAX_BYTES) {
    throw new Error(
      `Reference image is too large (${Math.round(originalByteLength / (1024 * 1024))} MiB). ` +
        `Maximum original size is ${Math.round(REFERENCE_ORIGINAL_MAX_BYTES / (1024 * 1024))} MiB.`
    );
  }

  const compressed = await imageCompression(file, {
    maxSizeMB: REFERENCE_COMPRESS_MAX_SIZE_MB,
    maxWidthOrHeight: REFERENCE_COMPRESS_MAX_DIMENSION,
    useWebWorker: true,
    // JPEG keeps payload small while remaining widely supported by Gemini / Vertex.
    fileType: 'image/jpeg',
    initialQuality: 0.85,
    // Prefer quality when the source is already small enough.
    alwaysKeepResolution: false
  });

  const previewDataUrl = await fileToDataUrl(compressed);
  const parsed = parseDataUrl(previewDataUrl);
  if (!parsed) {
    throw new Error('Failed to encode compressed reference image.');
  }

  return {
    base64: parsed.base64,
    mimeType: parsed.mimeType || 'image/jpeg',
    previewDataUrl,
    byteLength: compressed.size,
    originalByteLength,
    wasCompressed: compressed.size < originalByteLength || compressed.type !== file.type
  };
}
