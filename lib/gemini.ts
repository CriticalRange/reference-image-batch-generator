import { GoogleGenAI } from '@google/genai';
import Together from 'together-ai';
import sharp from 'sharp';
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

export async function generateBatch(input: BatchInput): Promise<BatchOutput> {
  const clampedCount = Math.max(1, Math.min(input.count, parseMaxBatch()));
  const maxParallel = parseMaxParallelRequests();
  const maxReferenceImages = parseMaxReferenceImages();
  const model = normalizeRequestedModel(input.model) ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const prompts = buildPromptVariants(input.basePrompt, clampedCount);
  const references = (input.referenceImages ?? []).slice(0, maxReferenceImages);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const imageSize = normalizeImageSize(input.imageSize, model);
  const resizeTo = normalizeResizeTo(input.resizeTo);
  if (isTogetherImageModel(model)) {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      throw new Error('Missing TOGETHER_API_KEY');
    }

    const together = new Together({ apiKey });
    const referenceImageUrls = references.map(buildReferenceDataUrl);
    const dimensions = resolveTogetherDimensions(aspectRatio);

    const jobs = prompts.map((promptVariant) => {
      return async () => {
        const response = await together.images.generate({
          model,
          prompt: promptVariant,
          response_format: 'base64',
          output_format: 'jpeg',
          width: dimensions.width,
          height: dimensions.height,
          ...(referenceImageUrls.length > 0 ? { reference_images: referenceImageUrls } : {})
        });

        const generated = response.data?.[0];
        if (!generated || !('b64_json' in generated) || !generated.b64_json) {
          throw getNoImageReturnedError('Together API did not return base64 image data.');
        }

        const extracted: BatchResult = {
          promptVariant: '',
          imageBase64: generated.b64_json,
          mimeType: 'image/jpeg'
        };
        const processed = resizeTo ? await resizeGeneratedImage(extracted, resizeTo) : extracted;

        return {
          ...processed,
          promptVariant
        } satisfies BatchResult;
      };
    });

    const settled = await runWithConcurrency(jobs, maxParallel);
    return buildBatchOutput(model, clampedCount, prompts, settled);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const ai = new GoogleGenAI({ apiKey });
  const jobs = prompts.map((promptVariant) => {
    return async () => {
      const response = await ai.models.generateContent({
        model,
        contents: [{ text: promptVariant }, ...references.map((reference) => ({
          inlineData: {
            mimeType: reference.mimeType,
            data: reference.base64
          }
        }))],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: {
            aspectRatio,
            ...(imageSize ? { imageSize } : {})
          }
        }
      });

      const extracted = extractImageFromGenerateContentResponse(response);
      if (!extracted) {
        throw getNoImageReturnedError(undefined);
      }
      const processed = resizeTo ? await resizeGeneratedImage(extracted, resizeTo) : extracted;

      return {
        ...processed,
        promptVariant
      } satisfies BatchResult;
    };
  });

  const settled = await runWithConcurrency(jobs, maxParallel);
  return buildBatchOutput(model, clampedCount, prompts, settled);
}
