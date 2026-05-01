import { NextRequest, NextResponse } from 'next/server';
import { submitBatch, getBatchStatus, type SubmitBatchResult } from '@/lib/gemini';

type RequestBody = {
  prompt?: string;
  negativePrompt?: string;
  count?: number;
  model?: string;
  steps?: number;
  referenceImageBase64?: string;
  referenceMimeType?: string;
  aspectRatio?: string;
  imageSize?: string;
  resizeWidth?: number;
  resizeHeight?: number;
  referenceImages?: Array<{
    base64?: string;
    mimeType?: string;
  }>;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const prompt = body.prompt?.trim() ?? '';
    const negativePrompt = body.negativePrompt?.trim() ?? undefined;
    const count = body.count ?? 5;
    const model = body.model?.trim() ?? undefined;
    const steps = parseStepCount(body.steps);
    const aspectRatio = body.aspectRatio?.trim() ?? undefined;
    const imageSize = body.imageSize?.trim() ?? undefined;
    const resizeWidth = parseResizeDimension(body.resizeWidth);
    const resizeHeight = parseResizeDimension(body.resizeHeight);
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
      return NextResponse.json({ error: 'Prompt is required.' }, { status: 400 });
    }

    if ((typeof resizeWidth === 'number' && typeof resizeHeight !== 'number') || (typeof resizeHeight === 'number' && typeof resizeWidth !== 'number')) {
      return NextResponse.json({ error: 'Resize width and height must both be provided.' }, { status: 400 });
    }

    const normalizedReferences =
      referenceImages.length > 0
        ? referenceImages
        : referenceImageBase64 && referenceMimeType
          ? [{ base64: referenceImageBase64, mimeType: referenceMimeType }]
          : [];
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
      steps,
      aspectRatio,
      imageSize,
      resizeTo,
      referenceImages: normalizedReferences
    });

    return NextResponse.json(submission, { status: 200 });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('job');

    if (!jobId) {
      return NextResponse.json({ error: 'Missing job parameter.' }, { status: 400 });
    }

    const status = await getBatchStatus(jobId);
    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    return createErrorResponse(error);
  }
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

function createErrorResponse(error: unknown) {
  const status = resolveHttpStatus(error);
  const message = formatApiError(error);
  console.error('[api/generate] request failed', {
    status,
    message,
    error
  });
  return NextResponse.json({ error: message }, { status });
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
