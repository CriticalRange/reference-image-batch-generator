import { NextRequest, NextResponse } from 'next/server';
import { submitBatch, getBatchStatus, type BatchOutput, type BatchResult, type SubmitBatchResult } from '@/lib/gemini';
import { applyCorsHeaders, corsPreflightResponse, enforceRateLimit, jsonWithCors, requireApiAccess } from '@/lib/security';
import { uploadBatchToBlob } from '@/lib/blob';

type RequestBody = {
  prompt?: string;
  negativePrompt?: string;
  count?: number;
  model?: string;
  steps?: number;
  /** Vertex / Google auth mode: service_account (default) | api_key */
  authMode?: string;
  referenceImageBase64?: string;
  referenceMimeType?: string;
  aspectRatio?: string;
  imageSize?: string;
  resizeWidth?: number;
  resizeHeight?: number;
  aiUpscale?: number;
  referenceImages?: Array<{
    base64?: string;
    mimeType?: string;
  }>;
};

const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_REFERENCE_BYTES = 24 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 10_000;
const MAX_NEGATIVE_PROMPT_LENGTH = 2_000;
const MAX_JOB_ID_LENGTH = 220;
const JOB_ID_PATTERN = /^[a-zA-Z0-9_./:-]+$/;
const ALLOWED_REFERENCE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

export async function OPTIONS(req: NextRequest) {
  const preflight = corsPreflightResponse(req);
  if (preflight) {
    return preflight;
  }
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  try {
    const accessDenied = requireApiAccess(req);
    if (accessDenied) {
      return accessDenied;
    }

    const limited = enforceRateLimit(req, 'generate:post');
    if (limited) {
      return limited;
    }

    const bodyTooLarge = rejectLargeRequest(req);
    if (bodyTooLarge) {
      return applyCorsHeaders(req, bodyTooLarge);
    }

    const body = (await req.json()) as RequestBody;
    const prompt = body.prompt?.trim() ?? '';
    const negativePrompt = body.negativePrompt?.trim() ?? undefined;
    const count = body.count ?? 5;
    const model = body.model?.trim() ?? undefined;
    const authMode = parseAuthMode(body.authMode);
    const steps = parseStepCount(body.steps);
    const aspectRatio = body.aspectRatio?.trim() ?? undefined;
    const imageSize = body.imageSize?.trim() ?? undefined;
    const resizeWidth = parseResizeDimension(body.resizeWidth);
    const resizeHeight = parseResizeDimension(body.resizeHeight);
    const aiUpscale = typeof body.aiUpscale === 'number' && body.aiUpscale > 0 ? body.aiUpscale : 0;
    const referenceImageBase64 = body.referenceImageBase64?.trim() ?? '';
    const referenceMimeType = body.referenceMimeType?.trim() ?? '';
    const referenceImages =
      body.referenceImages
        ?.map((image) => ({
          base64: image.base64?.trim() ?? '',
          mimeType: image.mimeType?.trim() ?? ''
        }))
        .filter((image) => image.base64 && image.mimeType) ?? [];

    if (!prompt) {
      return jsonWithCors(req, { error: 'Prompt is required.' }, { status: 400 });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return jsonWithCors(req, { error: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.` }, { status: 400 });
    }

    if (negativePrompt && negativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
      return jsonWithCors(req, { error: `Negative prompt must be ${MAX_NEGATIVE_PROMPT_LENGTH} characters or fewer.` }, { status: 400 });
    }

    if ((typeof resizeWidth === 'number' && typeof resizeHeight !== 'number') || (typeof resizeHeight === 'number' && typeof resizeWidth !== 'number')) {
      return jsonWithCors(req, { error: 'Resize width and height must both be provided.' }, { status: 400 });
    }

    if (aiUpscale > 0 && process.env.VERCEL === '1') {
      return jsonWithCors(
        req,
        {
          error:
            'AI Upscale is not supported on Vercel Serverless because the TensorFlow/ESRGAN runtime exceeds function size limits. Use normal resize on Vercel, or deploy this app on VPS/Docker for AI Upscale.'
        },
        { status: 400 }
      );
    }

    const normalizedReferences =
      referenceImages.length > 0
        ? referenceImages
        : referenceImageBase64 && referenceMimeType
        ? [{ base64: referenceImageBase64, mimeType: referenceMimeType }]
        : [];
    console.error('[api/generate] refs parsed:', {
      arrayCount: referenceImages.length,
      hasLegacySingle: !!(referenceImageBase64 && referenceMimeType),
      normalizedCount: normalizedReferences.length,
      sizes: normalizedReferences.map(r => ({ mime: r.mimeType, kb: (r.base64.length / 1024).toFixed(1) }))
    });
    const referenceValidationError = validateReferenceImages(normalizedReferences);
    if (referenceValidationError) {
      return jsonWithCors(req, { error: referenceValidationError }, { status: 400 });
    }

    const resizeTo =
      typeof resizeWidth === 'number' && typeof resizeHeight === 'number'
        ? {
            width: resizeWidth,
            height: resizeHeight
          }
        : undefined;

    const submission: SubmitBatchResult = await submitBatch({
      basePrompt: prompt,
      negativePrompt,
      count,
      model,
      authMode,
      steps,
      aspectRatio,
      imageSize,
      resizeTo,
      aiUpscale,
      referenceImages: normalizedReferences
    });

    // Offload generated images to Vercel Blob so they don't consume
    // serverless-function bandwidth when returned as base64 JSON.
    if (submission.results) {
      submission.results = await transformBatchOutputForBlob(submission.results, submission.jobId);
    }

    return jsonWithCors(req, submission, { status: 200 });
  } catch (error) {
    return createErrorResponse(req, error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const accessDenied = requireApiAccess(req);
    if (accessDenied) {
      return accessDenied;
    }

    const limited = enforceRateLimit(req, 'generate:get');
    if (limited) {
      return limited;
    }

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('job');

    if (!jobId) {
      return jsonWithCors(req, { error: 'Missing job parameter.' }, { status: 400 });
    }

    if (jobId.length > MAX_JOB_ID_LENGTH || !JOB_ID_PATTERN.test(jobId)) {
      return jsonWithCors(req, { error: 'Invalid job parameter.' }, { status: 400 });
    }

    const status = await getBatchStatus(jobId);

    // Offload generated images to Vercel Blob when the async job completes.
    if (status.results) {
      status.results = await transformBatchOutputForBlob(status.results, status.jobId);
    }

    return jsonWithCors(req, status, { status: 200 });
  } catch (error) {
    return createErrorResponse(req, error);
  }
}

// ---- Vercel Blob offload ----
// Uploads generated base64 images to Vercel Blob and replaces them with
// lightweight blobUrl fields so the JSON response stays small and
// serverless-function bandwidth isn't consumed by image payloads.
// Falls back to keeping base64 when BLOB_READ_WRITE_TOKEN is not set
// or an individual upload fails.

async function transformBatchOutputForBlob(
  output: BatchOutput,
  jobId: string
): Promise<BatchOutput> {
  const blobResults = await uploadBatchToBlob(output.results, jobId);

  const transformedResults: BatchResult[] = output.results.map((result, index) => {
    const blobResult = blobResults[index];
    if (blobResult?.blobUrl) {
      // Successfully uploaded — strip the heavy base64 payload, keep only blob URL.
      return {
        promptVariant: result.promptVariant,
        imageBase64: '',
        mimeType: result.mimeType,
        blobUrl: blobResult.blobUrl
      };
    }
    // Upload failed or not configured — keep the original base64.
    return result;
  });

  return {
    ...output,
    results: transformedResults
  };
}

function parseByteLimit(envName: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[envName] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function rejectLargeRequest(req: NextRequest): NextResponse | null {
  const contentLength = Number.parseInt(req.headers.get('content-length') ?? '', 10);
  const maxBytes = parseByteLimit('MAX_REQUEST_BYTES', DEFAULT_MAX_REQUEST_BYTES);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
  }

  return null;
}

function parseAuthMode(value: unknown): 'service_account' | 'api_key' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'api_key' || normalized === 'apikey' || normalized === 'api-key') {
    return 'api_key';
  }
  return 'service_account';
}

function parseResizeDimension(value: unknown): number | undefined {
  if (typeof value === 'undefined' || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.round(parsed);
}

function parseStepCount(value: unknown): number | undefined {
  if (typeof value === 'undefined' || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(1, Math.min(Math.round(parsed), 50));
}

function estimateBase64Bytes(base64: string): number {
  const paddingMatch = base64.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function isValidBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }

  try {
    return Buffer.from(value, 'base64').toString('base64').replace(/=+$/g, '') === value.replace(/=+$/g, '');
  } catch {
    return false;
  }
}

function validateReferenceImages(images: Array<{ base64: string; mimeType: string }>): string | undefined {
  const maxReferenceBytes = parseByteLimit('MAX_REFERENCE_IMAGE_BYTES', DEFAULT_MAX_REFERENCE_BYTES);
  const maxTotalBytes = parseByteLimit('MAX_TOTAL_REFERENCE_IMAGE_BYTES', DEFAULT_MAX_TOTAL_REFERENCE_BYTES);
  let totalBytes = 0;

  for (const image of images) {
    const mimeType = image.mimeType.toLowerCase();
    if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType)) {
      return 'Reference images must be JPEG, PNG, WebP, HEIC, or HEIF.';
    }

    if (!isValidBase64(image.base64)) {
      return 'Reference image data is not valid base64.';
    }

    const bytes = estimateBase64Bytes(image.base64);
    if (bytes > maxReferenceBytes) {
      return 'A reference image is too large.';
    }

    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      return 'Combined reference images are too large.';
    }
  }

  return undefined;
}

function createErrorResponse(req: NextRequest, error: unknown) {
  const status = resolveHttpStatus(error);
  const message = safeClientErrorMessage(error, status);
  console.error('[api/generate] request failed', {
    status,
    message: formatApiError(error),
    error
  });
  return jsonWithCors(req, { error: message }, { status });
}

function safeClientErrorMessage(error: unknown, status: number): string {
  const message = redactSensitiveText(formatApiError(error));
  if (status >= 500) {
    return 'Generation failed. Check server logs for details.';
  }

  return message || 'Request failed.';
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-api-key]')
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[redacted-private-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/Key\s+[A-Za-z0-9._~+/=-]+/gi, 'Key [redacted]');
}

function resolveHttpStatus(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return 500;
  }

  const maybeStatus = (error as { status?: unknown }).status;
  const parsed = typeof maybeStatus === 'number' ? maybeStatus : Number.parseInt(String(maybeStatus), 10);
  if (Number.isFinite(parsed) && parsed >= 400 && parsed <= 599) {
    return parsed;
  }

  return 500;
}

function formatApiError(error: unknown): string {
  if (!error) {
    return 'Unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (!(error instanceof Error)) {
    return String(error);
  }

  const err = error as Error & {
    status?: number;
    code?: string;
    details?: unknown;
    cause?: unknown;
    error?: unknown;
    response?: unknown;
    data?: unknown;
  };

  const parts: string[] = [];
  if (typeof err.status === 'number') {
    parts.push(`[${err.status}]`);
  }

  parts.push(err.message || 'Unknown error');

  const detailCandidates = [err.details, err.error, err.data, err.response, err.cause];
  for (const candidate of detailCandidates) {
    const detail = normalizeUnknownDetail(candidate);
    if (detail && !parts.some((part) => part.includes(detail))) {
      parts.push(detail);
      break;
    }
  }

  return parts.join(' | ');
}

function normalizeUnknownDetail(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (value instanceof Error) {
    const trimmed = value.message.trim();
    return trimmed || undefined;
  }

  if (typeof value === 'object') {
    const maybeRecord = value as Record<string, unknown>;
    const preferredMessage = firstNonEmptyString(
      maybeRecord.message,
      maybeRecord.error as unknown,
      maybeRecord.detail as unknown,
      maybeRecord.type as unknown
    );
    if (preferredMessage) {
      return preferredMessage;
    }

    try {
      const json = JSON.stringify(value);
      return json.length > 500 ? `${json.slice(0, 500)}...` : json;
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return undefined;
}
