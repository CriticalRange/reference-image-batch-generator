import { GoogleGenAI, JobState as GeminiJobState } from '@google/genai';
import type { BatchJob } from '@google/genai';
import Together from 'together-ai';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { modelSupportsImageSize, normalizeModelCode } from '@/lib/modelOptions';
import { buildPromptVariants } from '@/lib/promptVariants';

export type BatchInput = {
  basePrompt: string;
  model?: string;
  referenceImages?: Array<{
    base64: string;
    mimeType: string;
  }>;
  count: number;
  aspectRatio?: string;
  imageSize?: string;
  resizeTo?: {
    width: number;
    height: number;
  };
};

export type BatchResult = {
  promptVariant: string;
  imageBase64: string;
  mimeType: string;
};

export type BatchFailure = {
  promptVariant: string;
  error: string;
};

export type BatchOutput = {
  usedModel: string;
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  results: BatchResult[];
  failures: BatchFailure[];
};

export type JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'unknown';

export type SubmitBatchResult = {
  jobId: string;
  provider: 'gemini' | 'together';
  // Populated immediately for Together AI — no polling required.
  results?: BatchOutput;
};

export type BatchStatusResult = {
  jobId: string;
  state: JobState;
  stateLabel: string;
  results?: BatchOutput;
};

type GeminiBatchMeta = {
  resizeTo?: { width: number; height: number };
  requestedCount: number;
  prompts: string[];
  model: string;
};

const DEFAULT_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_MAX_BATCH = 8;
const DEFAULT_MAX_PARALLEL_REQUESTS = 2;
const DEFAULT_MAX_REFERENCE_IMAGES = 4;
const DEFAULT_ASPECT_RATIO = '1:1';
const DEFAULT_MIN_RESIZE_DIMENSION = 64;
const DEFAULT_MAX_RESIZE_DIMENSION = 8192;
const DEFAULT_MAX_RESPONSE_BYTES = 48 * 1024 * 1024;
const MODEL_CODE_PATTERN = /^[a-z0-9][a-z0-9./-]*$/i;
const QWEN_TOGETHER_MODEL_PATTERN = /^qwen\/qwen-image/i;
const FLUX_TOGETHER_MODEL_PATTERN = /^black-forest-labs\/flux/i;
const ALLOWED_ASPECT_RATIOS = new Set([
  '1:1',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9'
]);
const ALLOWED_IMAGE_SIZES = new Set(['512', '1K', '2K', '4K']);
const TOGETHER_DIMENSIONS_BY_ASPECT: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '1:4': { width: 512, height: 2048 },
  '4:1': { width: 2048, height: 512 },
  '1:8': { width: 512, height: 4096 },
  '8:1': { width: 4096, height: 512 },
  '2:3': { width: 1024, height: 1536 },
  '3:2': { width: 1536, height: 1024 },
  '3:4': { width: 1024, height: 1368 },
  '4:3': { width: 1368, height: 1024 },
  '4:5': { width: 1024, height: 1280 },
  '5:4': { width: 1280, height: 1024 },
  '9:16': { width: 768, height: 1368 },
  '16:9': { width: 1368, height: 768 },
  '21:9': { width: 1344, height: 576 }
};

type TogetherImageResponse = Awaited<ReturnType<Together['images']['generate']>>;

// Module-level store: persists across requests within the same server process.
// Gemini: stores job metadata (resize config, prompts) needed to process results after the async job completes.
const geminiBatchMetaStore = new Map<string, GeminiBatchMeta>();

function parseMaxBatch(): number {
  const value = Number.parseInt(process.env.MAX_BATCH_SIZE ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_BATCH;
}

function parseMaxParallelRequests(): number {
  const value = Number.parseInt(process.env.MAX_PARALLEL_REQUESTS ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_PARALLEL_REQUESTS;
}

function parseMaxReferenceImages(): number {
  const value = Number.parseInt(process.env.MAX_REFERENCE_IMAGES ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_REFERENCE_IMAGES;
}

function parseMaxResponseBytes(): number {
  const value = Number.parseInt(process.env.MAX_RESPONSE_BYTES ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_RESPONSE_BYTES;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const maybeApiError = error as Error & { status?: number; details?: unknown };
    const statusPrefix = maybeApiError.status ? `[${maybeApiError.status}] ` : '';
    return `${statusPrefix}${error.message}`.trim();
  }

  return String(error);
}

function isTogetherUnsupportedStepsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Unsupported use of 'steps' parameter/i.test(error.message);
}

function normalizeRequestedModel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeModelCode(value);
  return MODEL_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

function isTogetherImageModel(model: string): boolean {
  return QWEN_TOGETHER_MODEL_PATTERN.test(model) || FLUX_TOGETHER_MODEL_PATTERN.test(model);
}

function normalizeAspectRatio(value: string | undefined): string {
  if (!value) {
    return DEFAULT_ASPECT_RATIO;
  }

  return ALLOWED_ASPECT_RATIOS.has(value) ? value : DEFAULT_ASPECT_RATIO;
}

function normalizeImageSize(value: string | undefined, model: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (!ALLOWED_IMAGE_SIZES.has(value)) {
    return undefined;
  }

  return modelSupportsImageSize(model) ? value : undefined;
}

function normalizeResizeTo(value: BatchInput['resizeTo']): { width: number; height: number } | undefined {
  if (!value) {
    return undefined;
  }

  const width = clampResizeDimension(value.width);
  const height = clampResizeDimension(value.height);
  return { width, height };
}

function clampResizeDimension(value: number): number {
  return Math.max(DEFAULT_MIN_RESIZE_DIMENSION, Math.min(Math.round(value), DEFAULT_MAX_RESIZE_DIMENSION));
}

function getNoImageReturnedError(detail: string | undefined): Error {
  return detail ? new Error(`No image returned: ${detail}`) : new Error('No image returned');
}

function buildReferenceDataUrl(reference: { base64: string; mimeType: string }): string {
  return `data:${reference.mimeType};base64,${reference.base64}`;
}

function resolveTogetherDimensions(aspectRatio: string): { width: number; height: number } {
  return TOGETHER_DIMENSIONS_BY_ASPECT[aspectRatio] ?? TOGETHER_DIMENSIONS_BY_ASPECT[DEFAULT_ASPECT_RATIO];
}

async function extractTogetherImageFromResponse(response: TogetherImageResponse): Promise<BatchResult> {
  const generated = response.data?.[0];
  if (!generated) {
    throw getNoImageReturnedError('Together API returned no image entries.');
  }

  if ('b64_json' in generated && generated.b64_json) {
    return {
      promptVariant: '',
      imageBase64: generated.b64_json,
      mimeType: 'image/jpeg'
    };
  }

  if ('url' in generated && generated.url) {
    const file = await fetch(generated.url);
    if (!file.ok) {
      throw new Error(`Failed to download Together image URL (${file.status}).`);
    }

    const bytes = await file.arrayBuffer();
    return {
      promptVariant: '',
      imageBase64: Buffer.from(bytes).toString('base64'),
      mimeType: file.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
    };
  }

  throw getNoImageReturnedError('Together API returned image data in an unsupported format.');
}

function estimateBase64Bytes(base64: string): number {
  const sanitizedLength = base64.length;
  if (sanitizedLength === 0) {
    return 0;
  }

  const paddingMatch = base64.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return Math.floor((sanitizedLength * 3) / 4) - padding;
}

function enforceBatchPayloadLimit(results: BatchResult[]): void {
  const totalBytes = results.reduce((sum, result) => sum + estimateBase64Bytes(result.imageBase64), 0);
  const maxBytes = parseMaxResponseBytes();
  if (totalBytes > maxBytes) {
    throw new Error(
      `Generated payload too large (${Math.round(totalBytes / (1024 * 1024))} MiB). ` +
        'Reduce variant count, use smaller output dimensions, or enable resize.'
    );
  }
}

function extractImageFromGenerateContentResponse(response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>): BatchResult | null {
  const parts = response?.candidates?.flatMap((candidate) => candidate?.content?.parts ?? []) ?? [];
  const imagePart = parts.find((part) => part?.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    const textReason = parts.find((part) => part?.text?.trim())?.text?.trim();
    const promptBlockReason = response?.promptFeedback?.blockReason;
    const reasonParts = [textReason, promptBlockReason].filter(Boolean);
    throw getNoImageReturnedError(reasonParts.join(' | '));
  }

  return {
    promptVariant: '',
    imageBase64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/png'
  };
}

async function resizeGeneratedImage(result: BatchResult, resizeTo: { width: number; height: number }): Promise<BatchResult> {
  const inputBuffer = Buffer.from(result.imageBase64, 'base64');
  const resizedBuffer = await sharp(inputBuffer, { failOn: 'none' })
    .resize(resizeTo.width, resizeTo.height, {
      fit: 'cover',
      position: 'centre'
    })
    .png()
    .toBuffer();

  return {
    ...result,
    imageBase64: resizedBuffer.toString('base64'),
    mimeType: 'image/png'
  };
}

async function runWithConcurrency<T>(jobs: Array<() => Promise<T>>, concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const settled: PromiseSettledResult<T>[] = new Array(jobs.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;

      if (current >= jobs.length) {
        return;
      }

      try {
        const value = await jobs[current]();
        settled[current] = { status: 'fulfilled', value };
      } catch (reason) {
        settled[current] = { status: 'rejected', reason };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, jobs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return settled;
}

function buildBatchOutput(
  model: string,
  requestedCount: number,
  prompts: string[],
  settled: PromiseSettledResult<BatchResult>[]
): BatchOutput {
  const successful = settled
    .filter((entry): entry is PromiseFulfilledResult<BatchResult> => entry.status === 'fulfilled')
    .map((entry) => entry.value);
  const failures = settled
    .map((entry, index) => {
      if (entry.status === 'fulfilled') {
        return null;
      }

      return {
        promptVariant: prompts[index],
        error: formatError(entry.reason)
      } satisfies BatchFailure;
    })
    .filter((entry): entry is BatchFailure => entry !== null);

  if (successful.length === 0) {
    const failureSummary = failures.map((entry, index) => `#${index + 1}: ${entry.error}`).join(' || ');
    throw new Error(`Generation failed for all variants. ${failureSummary}`);
  }

  enforceBatchPayloadLimit(successful);

  return {
    usedModel: model,
    requestedCount,
    succeededCount: successful.length,
    failedCount: failures.length,
    results: successful,
    failures
  };
}

function mapGeminiJobState(state: GeminiJobState | undefined): JobState {
  switch (state) {
    case GeminiJobState.JOB_STATE_QUEUED:
    case GeminiJobState.JOB_STATE_PENDING:
    case GeminiJobState.JOB_STATE_UNSPECIFIED:
    case GeminiJobState.JOB_STATE_PAUSED:
      return 'pending';
    case GeminiJobState.JOB_STATE_RUNNING:
    case GeminiJobState.JOB_STATE_CANCELLING:
    case GeminiJobState.JOB_STATE_UPDATING:
      return 'running';
    case GeminiJobState.JOB_STATE_SUCCEEDED:
    case GeminiJobState.JOB_STATE_PARTIALLY_SUCCEEDED:
      return 'succeeded';
    case GeminiJobState.JOB_STATE_FAILED:
      return 'failed';
    case GeminiJobState.JOB_STATE_CANCELLED:
      return 'cancelled';
    case GeminiJobState.JOB_STATE_EXPIRED:
      return 'expired';
    default:
      return 'unknown';
  }
}

function getStateLabel(state: JobState): string {
  switch (state) {
    case 'pending': return 'Pending';
    case 'running': return 'Processing';
    case 'succeeded': return 'Completed';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    case 'expired': return 'Expired';
    default: return 'Unknown';
  }
}

async function runTogetherBatch(
  model: string,
  requestedCount: number,
  prompts: string[],
  references: Array<{ base64: string; mimeType: string }>,
  aspectRatio: string,
  resizeTo: { width: number; height: number } | undefined
): Promise<BatchOutput> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing TOGETHER_API_KEY');
  }

  const together = new Together({ apiKey });
  const referenceImageUrls = references.map(buildReferenceDataUrl);
  const dimensions = resolveTogetherDimensions(aspectRatio);
  const maxParallel = parseMaxParallelRequests();

  const jobs = prompts.map((promptVariant) => {
    return async () => {
      const baseRequest = {
        model,
        prompt: promptVariant,
        response_format: 'base64' as const,
        output_format: 'jpeg' as const,
        width: dimensions.width,
        height: dimensions.height,
        ...(referenceImageUrls.length > 0 ? { reference_images: referenceImageUrls } : {})
      };
      let response: TogetherImageResponse;

      try {
        response = await together.images.generate(baseRequest);
      } catch (error) {
        if (!isTogetherUnsupportedStepsError(error)) {
          throw error;
        }

        response = await together.images.generate({
          model,
          prompt: promptVariant,
          response_format: 'base64' as const,
          output_format: 'jpeg' as const
        });
      }

      const extracted = await extractTogetherImageFromResponse(response);
      const processed = resizeTo ? await resizeGeneratedImage(extracted, resizeTo) : extracted;

      return {
        ...processed,
        promptVariant
      } satisfies BatchResult;
    };
  });

  const settled = await runWithConcurrency(jobs, maxParallel);
  return buildBatchOutput(model, requestedCount, prompts, settled);
}

async function extractGeminiBatchResults(job: BatchJob, meta: GeminiBatchMeta): Promise<BatchOutput> {
  const inlinedResponses = job.dest?.inlinedResponses ?? [];

  if (inlinedResponses.length === 0) {
    throw new Error('Batch job completed but returned no responses.');
  }

  const settled = await Promise.allSettled(
    inlinedResponses.map(async (inlined, i) => {
      if (inlined.error) {
        throw new Error(inlined.error.message ?? 'Request failed');
      }

      const response = inlined.response;
      if (!response) {
        throw getNoImageReturnedError('No response in batch item');
      }

      const extracted = extractImageFromGenerateContentResponse(
        response as Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>
      );
      if (!extracted) {
        throw getNoImageReturnedError(undefined);
      }

      const processed = meta.resizeTo ? await resizeGeneratedImage(extracted, meta.resizeTo) : extracted;
      const promptVariant = (inlined.metadata?.['promptVariant'] ?? meta.prompts[i]) ?? '';

      return { ...processed, promptVariant } satisfies BatchResult;
    })
  );

  return buildBatchOutput(meta.model, meta.requestedCount, meta.prompts, settled);
}

export async function submitBatch(input: BatchInput): Promise<SubmitBatchResult> {
  const clampedCount = Math.max(1, Math.min(input.count, parseMaxBatch()));
  const maxReferenceImages = parseMaxReferenceImages();
  const model = normalizeRequestedModel(input.model) ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const prompts = buildPromptVariants(input.basePrompt, clampedCount);
  const references = (input.referenceImages ?? []).slice(0, maxReferenceImages);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const imageSize = normalizeImageSize(input.imageSize, model);
  const resizeTo = normalizeResizeTo(input.resizeTo);

  if (isTogetherImageModel(model)) {
    // Together AI has no async batch API — run synchronously and return results directly.
    // This avoids any module-state dependency between the submit and status requests.
    const jobId = randomUUID();
    const result = await runTogetherBatch(model, clampedCount, prompts, references, aspectRatio, resizeTo);
    return { jobId, provider: 'together', results: result };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const ai = new GoogleGenAI({ apiKey });

  const inlinedRequests = prompts.map((promptVariant) => ({
    contents: [
      {
        role: 'user',
        parts: [
          { text: promptVariant },
          ...references.map((ref) => ({
            inlineData: { mimeType: ref.mimeType, data: ref.base64 }
          }))
        ]
      }
    ],
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio,
        ...(imageSize ? { imageSize } : {})
      }
    },
    // Carry prompt variant through so result extraction can label each image correctly.
    metadata: { promptVariant }
  }));

  const batchJob = await ai.batches.create({
    model,
    src: inlinedRequests,
    config: { displayName: `image-batch-${Date.now()}` }
  });

  const jobId = batchJob.name;
  if (!jobId) {
    throw new Error('Batch job was created but returned no job name.');
  }

  geminiBatchMetaStore.set(jobId, { resizeTo, requestedCount: clampedCount, prompts, model });

  return { jobId, provider: 'gemini' };
}

export async function getBatchStatus(jobId: string): Promise<BatchStatusResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const ai = new GoogleGenAI({ apiKey });
  const job = await ai.batches.get({ name: jobId });
  const state = mapGeminiJobState(job.state);

  if (state === 'failed') {
    geminiBatchMetaStore.delete(jobId);
    throw new Error('Batch job failed.');
  }
  if (state === 'cancelled') {
    geminiBatchMetaStore.delete(jobId);
    throw new Error('Batch job was cancelled.');
  }
  if (state === 'expired') {
    geminiBatchMetaStore.delete(jobId);
    throw new Error('Batch job has expired (48-hour limit reached).');
  }

  if (state === 'succeeded') {
    const meta = geminiBatchMetaStore.get(jobId);
    if (!meta) {
      throw new Error('Batch metadata not found. The server may have restarted. Please submit a new batch.');
    }

    // The Gemini API may mark the job succeeded before inline responses are fully
    // populated in the get() response. Treat an empty response list as still running
    // so the client keeps polling until results are available.
    const inlinedResponses = job.dest?.inlinedResponses ?? [];
    if (inlinedResponses.length === 0) {
      return { jobId, state: 'running', stateLabel: 'Waiting for results...' };
    }

    const results = await extractGeminiBatchResults(job, meta);
    geminiBatchMetaStore.delete(jobId);
    return { jobId, state, stateLabel: getStateLabel(state), results };
  }

  return { jobId, state, stateLabel: getStateLabel(state) };
}
