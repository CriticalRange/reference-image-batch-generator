import { put } from '@vercel/blob';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

function mimeTypeToExtension(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? 'png';
}

export type BlobUploadResult = {
  blobUrl: string;
  blobPath: string;
};

/**
 * Upload a base64-encoded image to Vercel Blob.
 * Falls back to returning undefined if BLOB_READ_WRITE_TOKEN is not configured.
 */
export async function uploadImageToBlob(
  imageBase64: string,
  mimeType: string,
  jobId: string,
  index: number
): Promise<BlobUploadResult | undefined> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn('[blob] BLOB_READ_WRITE_TOKEN not configured — skipping upload');
    return undefined;
  }

  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const extension = mimeTypeToExtension(mimeType);
    const sanitizedJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
    const filename = `generations/${sanitizedJobId}/${String(index).padStart(3, '0')}.${extension}`;

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: mimeType,
      cacheControlMaxAge: 3600 // 1 hour — client downloads immediately, no need to keep long
    });

    console.error(`[blob] uploaded ${((buffer.length / 1024).toFixed(1))}KB → ${blob.url}`);
    return { blobUrl: blob.url, blobPath: blob.pathname };
  } catch (error) {
    console.error('[blob] upload failed:', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

/**
 * Batch-upload multiple base64 images to Vercel Blob in parallel.
 * Each upload is independent — if one fails, others continue.
 * `startIndex` keeps partial-batch filenames stable across polls (001, 002, …).
 */
export async function uploadBatchToBlob(
  images: Array<{ imageBase64: string; mimeType: string }>,
  jobId: string,
  startIndex = 0
): Promise<Array<BlobUploadResult | undefined>> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn('[blob] BLOB_READ_WRITE_TOKEN not configured — skipping batch upload');
    return images.map(() => undefined);
  }

  return Promise.all(
    images.map((image, index) =>
      uploadImageToBlob(image.imageBase64, image.mimeType, jobId, startIndex + index)
    )
  );
}
