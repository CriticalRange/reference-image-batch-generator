import { GoogleGenAI, JobState as GeminiJobState } from '@google/genai';
import type { BatchJob, InlinedResponse } from '@google/genai';
import { JWT } from 'google-auth-library';
import Together from 'together-ai';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { modelSupportsImageSize, normalizeModelCode } from '@/lib/modelOptions';
import { buildPromptVariants } from '@/lib/promptVariants';

export type BatchInput = {
  basePrompt: string;
  negativePrompt?: string;
  model?: string;
  steps?: number;
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
  aiUpscale?: boolean;
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
  provider: 'gemini' | 'together' | 'fal' | 'vertex';
  // Populated immediately for sync providers — no polling required.
  results?: BatchOutput;
};

export type BatchStatusResult = {
  jobId: string;
  state: JobState;
  stateLabel: string;
  stateDetail?: string;
  error?: string;
  results?: BatchOutput;
};

type UpscalerConstructor = new (options: { model: unknown }) => {
  upscale(input: Buffer): Promise<string>;
};

const DEFAULT_MODEL = 'vertex/gemini-2.5-flash-image';
const DEFAULT_MAX_BATCH = 10;
const DEFAULT_MAX_PARALLEL_REQUESTS = 2;
const VERTEX_MAX_SAMPLE_COUNT = 10;
const VERTEX_IMAGEN_MAX_PER_REQUEST = 4;
const DEFAULT_MAX_REFERENCE_IMAGES = 4;
const DEFAULT_ASPECT_RATIO = '1:1';
const DEFAULT_MIN_RESIZE_DIMENSION = 64;
const DEFAULT_MAX_RESIZE_DIMENSION = 8192;
const DEFAULT_MAX_RESPONSE_BYTES = 48 * 1024 * 1024;
const MODEL_CODE_PATTERN = /^[a-z0-9][a-z0-9./-]*$/i;
const QWEN_TOGETHER_MODEL_PATTERN = /^qwen\/qwen-image/i;
const FLUX_TOGETHER_MODEL_PATTERN = /^black-forest-labs\/flux/i;
const GOOGLE_IMAGEN_TOGETHER_MODEL_PATTERN = /^google\/imagen-/i;
const GOOGLE_FLASH_IMAGE_TOGETHER_MODEL_PATTERN = /^google\/flash-image-/i;
const GPT_IMAGE_TOGETHER_MODEL_PATTERN = /^openai\/gpt-image-/i;
const IDEOGRAM_TOGETHER_MODEL_PATTERN = /^ideogram\//i;
const FAL_MODEL_PATTERN = /^fal-ai\//i;
const VERTEX_MODEL_PATTERN = /^vertex\//i;
const FLUX_KONTEXT_TOGETHER_MODEL_PATTERN = /^black-forest-labs\/FLUX\.1-kontext-(pro|max)$/i;
const FLUX2_TOGETHER_MODEL_PATTERN = /^black-forest-labs\/FLUX\.2-/i;
const GOOGLE_GEMINI_PRO_IMAGE_TOGETHER_MODEL_PATTERN = /^google\/gemini-3-pro-image$/i;
let esrgan2xUpscalerPromise: Promise<InstanceType<UpscalerConstructor>> | undefined;
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
type GeminiResultExtractionContext = {
  jobId: string;
  model: string;
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
  return (
    QWEN_TOGETHER_MODEL_PATTERN.test(model) ||
    FLUX_TOGETHER_MODEL_PATTERN.test(model) ||
    GOOGLE_IMAGEN_TOGETHER_MODEL_PATTERN.test(model) ||
    GOOGLE_FLASH_IMAGE_TOGETHER_MODEL_PATTERN.test(model) ||
    GPT_IMAGE_TOGETHER_MODEL_PATTERN.test(model) ||
    IDEOGRAM_TOGETHER_MODEL_PATTERN.test(model)
  );
}

function isFalImageModel(model: string): boolean {
  return FAL_MODEL_PATTERN.test(model);
}

function isVertexImageModel(model: string): boolean {
  return VERTEX_MODEL_PATTERN.test(model);
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

function normalizeSteps(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.min(Math.round(value), 50));
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

type TogetherReferenceMode = 'none' | 'image_url' | 'reference_images';

function resolveTogetherReferenceMode(model: string): TogetherReferenceMode {
  if (FLUX_KONTEXT_TOGETHER_MODEL_PATTERN.test(model)) {
    return 'image_url';
  }

  if (
    FLUX2_TOGETHER_MODEL_PATTERN.test(model) ||
    GOOGLE_IMAGEN_TOGETHER_MODEL_PATTERN.test(model) ||
    GOOGLE_FLASH_IMAGE_TOGETHER_MODEL_PATTERN.test(model) ||
    GOOGLE_GEMINI_PRO_IMAGE_TOGETHER_MODEL_PATTERN.test(model)
  ) {
    return 'reference_images';
  }

  return 'none';
}

function parseTogetherRequestedDimensions(value: string | undefined): { width: number; height: number } | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{3,5})x(\d{3,5})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }

  return { width, height };
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

async function downloadImageAsBase64(url: string): Promise<{ imageBase64: string; mimeType: string }> {
  const file = await fetch(url);
  if (!file.ok) {
    throw new Error(`Failed to download image URL (${file.status}).`);
  }

  const bytes = await file.arrayBuffer();
  return {
    imageBase64: Buffer.from(bytes).toString('base64'),
    mimeType: file.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
  };
}

function firstStringValue(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function resolveFalImageUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const images = Array.isArray(record.images) ? record.images : undefined;
  if (images && images.length > 0) {
    const firstImage = images[0];
    if (typeof firstImage === 'string') {
      return firstImage;
    }
    if (firstImage && typeof firstImage === 'object') {
      const imageRecord = firstImage as Record<string, unknown>;
      return firstStringValue([imageRecord.url, imageRecord.image_url, imageRecord.href]);
    }
  }

  const image = record.image;
  if (typeof image === 'string') {
    return image;
  }
  if (image && typeof image === 'object') {
    const imageRecord = image as Record<string, unknown>;
    const imageUrl = firstStringValue([imageRecord.url, imageRecord.image_url, imageRecord.href]);
    if (imageUrl) {
      return imageUrl;
    }
  }

  return firstStringValue([record.url, record.image_url, record.output_url]);
}

type VertexCredentials = {
  client_email: string;
  private_key: string;
  project_id: string;
};

type VertexTokenCache = {
  token: string;
  projectId: string;
  expiresAt: number;
};

let vertexTokenCache: VertexTokenCache | null = null;

async function getVertexAccessToken(): Promise<{ token: string; projectId: string }> {
  const now = Date.now();
  if (vertexTokenCache && vertexTokenCache.expiresAt > now) {
    return { token: vertexTokenCache.token, projectId: vertexTokenCache.projectId };
  }

  const credentialsPath = process.env.VERTEX_AI_CREDENTIALS_PATH;
  const credentialsJson = process.env.VERTEX_AI_CREDENTIALS;
  const credentialsBase64 = process.env.VERTEX_AI_CREDENTIALS_BASE64;

  let credentialsText: string;
  if (credentialsPath) {
    credentialsText = await fs.readFile(credentialsPath, 'utf8');
  } else if (credentialsBase64) {
    credentialsText = Buffer.from(credentialsBase64, 'base64').toString('utf8');
  } else if (credentialsJson) {
    credentialsText = credentialsJson;
  } else {
    throw new Error('Missing VERTEX_AI_CREDENTIALS_PATH, VERTEX_AI_CREDENTIALS_BASE64, or VERTEX_AI_CREDENTIALS environment variable.');
  }

  const credentials = JSON.parse(credentialsText) as VertexCredentials;
  const jwt = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const tokenResponse = await jwt.getAccessToken();
  if (!tokenResponse.token) {
    throw new Error('Failed to obtain Vertex AI access token.');
  }

  // Google service account JWT tokens expire after 1 hour; refresh 5 min before expiry.
  vertexTokenCache = {
    token: tokenResponse.token,
    projectId: credentials.project_id,
    expiresAt: now + 55 * 60 * 1000
  };

  return { token: tokenResponse.token, projectId: credentials.project_id };
}

function extractVertexImageFromResponse(response: Record<string, unknown>): BatchResult | null {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const parts: unknown[] = (candidate as Record<string, unknown>)?.content
      ? ((candidate as Record<string, unknown>).content as Record<string, unknown>)?.parts as unknown[]
      : [];
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      const inlineData = (part as Record<string, unknown>)?.inlineData as Record<string, unknown> | undefined;
      if (inlineData?.data && typeof inlineData.data === 'string') {
        return {
          promptVariant: '',
          imageBase64: inlineData.data,
          mimeType: typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png'
        };
      }
    }
  }
  return null;
}

function isVertexImagenModel(modelName: string): boolean {
  return /^imagen-/i.test(modelName);
}

function extractAllImagenVertexImagesFromResponse(response: Record<string, unknown>): BatchResult[] {
  const predictions = Array.isArray(response.predictions) ? response.predictions : [];
  const collected: BatchResult[] = [];
  for (const prediction of predictions) {
    const pred = prediction as Record<string, unknown>;
    if (typeof pred.bytesBase64Encoded === 'string' && pred.bytesBase64Encoded) {
      collected.push({
        promptVariant: '',
        imageBase64: pred.bytesBase64Encoded,
        mimeType: typeof pred.mimeType === 'string' ? pred.mimeType : 'image/png'
      });
    }
  }
  return collected;
}

async function runVertexBatch(
  model: string,
  requestedCount: number,
  prompts: string[],
  references: Array<{ base64: string; mimeType: string }>,
  resizeTo: { width: number; height: number } | undefined,
  aiUpscale: boolean
): Promise<BatchOutput> {
  const { token, projectId } = await getVertexAccessToken();
  const region = process.env.VERTEX_AI_REGION ?? 'us-central1';
  const modelName = model.replace(VERTEX_MODEL_PATTERN, '');
  const useImagenApi = isVertexImagenModel(modelName);
  const apiEndpoint = useImagenApi ? 'predict' : 'generateContent';
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelName}:${apiEndpoint}`;

  if (useImagenApi) {
    // Imagen batch: chunk requests using sampleCount (max VERTEX_IMAGEN_MAX_PER_REQUEST per call).
    const totalCount = Math.min(requestedCount, VERTEX_MAX_SAMPLE_COUNT);
    const chunks: number[] = [];
    for (let rem = totalCount; rem > 0; rem -= VERTEX_IMAGEN_MAX_PER_REQUEST) {
      chunks.push(Math.min(rem, VERTEX_IMAGEN_MAX_PER_REQUEST));
    }

    const chunkJobs = chunks.map((chunkSize, chunkIndex) => {
      const promptVariant = prompts[chunkIndex % prompts.length];
      return async (): Promise<BatchResult[]> => {
        const payload = {
          instances: [{ prompt: promptVariant }],
          parameters: { sampleCount: chunkSize }
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (!response.ok) {
          const errDetail = (data.error as Record<string, unknown> | undefined)?.message;
          const errMsg = firstStringValue([errDetail, data.message]) ?? `Vertex AI request failed (${response.status})`;
          throw new Error(String(errMsg));
        }

        const extracted = extractAllImagenVertexImagesFromResponse(data);
        if (extracted.length === 0) {
          throw getNoImageReturnedError('Vertex AI returned no images in response.');
        }

        return Promise.all(
          extracted.map(async (image) => {
            const processed = await processGeneratedImage(image, resizeTo, aiUpscale);
            return { ...processed, promptVariant } satisfies BatchResult;
          })
        );
      };
    });

    const settledChunks = await runWithConcurrency(chunkJobs, aiUpscale ? 1 : parseMaxParallelRequests());

    const allResults: BatchResult[] = [];
    const allFailures: BatchFailure[] = [];

    for (let i = 0; i < settledChunks.length; i++) {
      const chunk = settledChunks[i];
      if (chunk.status === 'fulfilled') {
        allResults.push(...chunk.value);
      } else {
        allFailures.push({ promptVariant: prompts[i % prompts.length], error: formatError(chunk.reason) });
      }
    }

    if (allResults.length === 0) {
      const failureSummary = allFailures.map((entry, i) => `#${i + 1}: ${entry.error}`).join(' || ');
      throw new Error(`Generation failed for all variants. ${failureSummary}`);
    }

    enforceBatchPayloadLimit(allResults);

    return {
      usedModel: model,
      requestedCount: totalCount,
      succeededCount: allResults.length,
      failedCount: allFailures.length,
      results: allResults,
      failures: allFailures
    };
  }

  // Vertex Gemini: parallel generateContent requests with prompt variants.
  const maxParallel = aiUpscale ? 1 : parseMaxParallelRequests();
  const jobs = prompts.map((promptVariant) => {
    return async () => {
      const parts: unknown[] = [{ text: promptVariant }];
      for (const ref of references) {
        parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
      }

      const payload = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT']
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const errDetail = (data.error as Record<string, unknown> | undefined)?.message;
        const errMsg = firstStringValue([errDetail, data.message]) ?? `Vertex AI request failed (${response.status})`;
        throw new Error(String(errMsg));
      }

      const extracted = extractVertexImageFromResponse(data);
      if (!extracted) {
        throw getNoImageReturnedError('Vertex AI returned no image in response.');
      }

      const processed = await processGeneratedImage(extracted, resizeTo, aiUpscale);
      return { ...processed, promptVariant } satisfies BatchResult;
    };
  });

  const settled = await runWithConcurrency(jobs, maxParallel);
  return buildBatchOutput(model, requestedCount, prompts, settled);
}

async function runFalBatch(
  model: string,
  requestedCount: number,
  prompts: string[],
  negativePrompt: string | undefined,
  references: Array<{ base64: string; mimeType: string }>,
  aspectRatio: string,
  resizeTo: { width: number; height: number } | undefined,
  aiUpscale: boolean
): Promise<BatchOutput> {
  const apiKey = process.env.FAL_AI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing FAL_AI_API_KEY');
  }

  const endpoint = `https://fal.run/${model}`;
  const maxParallel = aiUpscale ? 1 : parseMaxParallelRequests();
  const referenceImageUrl = references[0] ? buildReferenceDataUrl(references[0]) : undefined;

  const jobs = prompts.map((promptVariant) => {
    return async () => {
      const requestBody: Record<string, unknown> = {
        prompt: promptVariant,
        aspect_ratio: aspectRatio
      };

      if (negativePrompt) {
        requestBody.negative_prompt = negativePrompt;
      }
      if (referenceImageUrl) {
        requestBody.image_url = referenceImageUrl;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const detail = firstStringValue([payload.detail, payload.error, payload.message]) || `fal.ai request failed (${response.status})`;
        throw new Error(detail);
      }

      const imageUrl = resolveFalImageUrl(payload);
      if (!imageUrl) {
        throw getNoImageReturnedError('fal.ai response contained no image URL.');
      }

      const downloaded = await downloadImageAsBase64(imageUrl);
      const extracted: BatchResult = {
        promptVariant: '',
        imageBase64: downloaded.imageBase64,
        mimeType: downloaded.mimeType
      };
      const processed = await processGeneratedImage(extracted, resizeTo, aiUpscale);

      return {
        ...processed,
        promptVariant
      } satisfies BatchResult;
    };
  });

  const settled = await runWithConcurrency(jobs, maxParallel);
  return buildBatchOutput(model, requestedCount, prompts, settled);
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

async function processGeneratedImage(
  result: BatchResult,
  resizeTo: { width: number; height: number } | undefined,
  aiUpscale: boolean
): Promise<BatchResult> {
  const enhanced = aiUpscale ? await upscaleGeneratedImage(result) : result;
  return resizeTo ? resizeGeneratedImage(enhanced, resizeTo) : enhanced;
}

async function upscaleGeneratedImage(result: BatchResult): Promise<BatchResult> {
  const upscaler = await getEsrgan2xUpscaler();
  const inputBuffer = Buffer.from(result.imageBase64, 'base64');
  const upscaledDataUrl = await upscaler.upscale(inputBuffer);
  const parsed = parseUpscalerDataUrl(upscaledDataUrl);

  return {
    ...result,
    imageBase64: parsed.imageBase64,
    mimeType: parsed.mimeType
  };
}

async function getEsrgan2xUpscaler(): Promise<InstanceType<UpscalerConstructor>> {
  esrgan2xUpscalerPromise ??= (async () => {
    try {
      const runtimeRequire = Function('return require')() as NodeRequire;
      const upscalerModule = runtimeRequire('upscaler/node') as { default?: unknown };
      const modelModule = runtimeRequire('@upscalerjs/esrgan-thick/2x') as { default?: unknown };
      const Upscaler = (upscalerModule.default ?? upscalerModule) as unknown as UpscalerConstructor;
      const model = (modelModule.default ?? modelModule) as unknown;
      return new Upscaler({ model });
    } catch (error) {
      esrgan2xUpscalerPromise = undefined;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        'AI Upscale requires UpscalerJS with @tensorflow/tfjs-node available in this Node environment. ' +
          `Install a supported Node LTS runtime or TensorFlow.js native backend. ${detail}`
      );
    }
  })();

  return esrgan2xUpscalerPromise;
}

function parseUpscalerDataUrl(value: string): { imageBase64: string; mimeType: string } {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value.trim());
  if (match) {
    return {
      mimeType: match[1],
      imageBase64: match[2]
    };
  }

  return {
    mimeType: 'image/png',
    imageBase64: value.trim()
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

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : undefined;
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function buildGeminiStateDetail(state: JobState, job: BatchJob): string | undefined {
  const now = Date.now();
  const createdAt = parseTimestamp(job.createTime);
  const startedAt = parseTimestamp(job.startTime);
  const updatedAt = parseTimestamp(job.updateTime);
  const activeStart = startedAt ?? createdAt;

  if (state === 'pending') {
    if (createdAt) {
      return `Queued for ${formatDuration((now - createdAt) / 1000)}`;
    }

    return undefined;
  }

  if (state === 'running') {
    if (activeStart) {
      return `Running for ${formatDuration((now - activeStart) / 1000)}`;
    }

    return undefined;
  }

  if (state === 'succeeded') {
    if (createdAt && updatedAt) {
      return `Finished in ${formatDuration((updatedAt - createdAt) / 1000)}`;
    }
  }

  return undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }

  return parsed;
}

function parseResizeFromMetadata(metadata: Record<string, string> | undefined): { width: number; height: number } | undefined {
  if (!metadata) {
    return undefined;
  }

  const width = parsePositiveInt(metadata.resizeWidth);
  const height = parsePositiveInt(metadata.resizeHeight);
  if (typeof width !== 'number' || typeof height !== 'number') {
    return undefined;
  }

  return {
    width: clampResizeDimension(width),
    height: clampResizeDimension(height)
  };
}

function findRequestedCountFromMetadata(inlinedResponses: InlinedResponse[]): number | undefined {
  for (const response of inlinedResponses) {
    const count = parsePositiveInt(response.metadata?.requestedCount);
    if (typeof count === 'number') {
      return count;
    }
  }

  return undefined;
}

function findResizeFromMetadata(inlinedResponses: InlinedResponse[]): { width: number; height: number } | undefined {
  for (const response of inlinedResponses) {
    const resizeTo = parseResizeFromMetadata(response.metadata);
    if (resizeTo) {
      return resizeTo;
    }
  }

  return undefined;
}

function findAiUpscaleFromMetadata(inlinedResponses: InlinedResponse[]): boolean {
  return inlinedResponses.some((response) => response.metadata?.aiUpscale === 'true');
}

function normalizePromptVariant(metadata: Record<string, string> | undefined, fallbackIndex: number): string {
  const variant = metadata?.promptVariant?.trim();
  if (variant) {
    return variant;
  }

  return `Variant ${fallbackIndex + 1}`;
}

async function downloadBatchResponsesFile(ai: GoogleGenAI, fileName: string, jobId: string): Promise<InlinedResponse[]> {
  const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const downloadPath = path.join(tmpdir(), `gemini-batch-${safeJobId}-${Date.now()}.jsonl`);

  try {
    await ai.files.download({
      file: fileName,
      downloadPath
    });

    const contents = await fs.readFile(downloadPath, 'utf8');
    const lines = contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsedResponses: InlinedResponse[] = [];

    for (const line of lines) {
      let parsedLine: unknown;
      try {
        parsedLine = JSON.parse(line);
      } catch {
        continue;
      }

      if (!parsedLine || typeof parsedLine !== 'object') {
        continue;
      }

      const parsedObject = parsedLine as Record<string, unknown>;
      const response = parsedObject.response as InlinedResponse['response'];
      const error = parsedObject.error as InlinedResponse['error'];
      const metadataValue = parsedObject.metadata;
      const metadata =
        metadataValue && typeof metadataValue === 'object'
          ? Object.fromEntries(
              Object.entries(metadataValue as Record<string, unknown>).map(([key, value]) => [key, String(value)])
            )
          : undefined;

      const entry: InlinedResponse = {};
      if (typeof response !== 'undefined') {
        entry.response = response;
      }
      if (typeof error !== 'undefined') {
        entry.error = error;
      }
      if (metadata) {
        entry.metadata = metadata;
      }

      parsedResponses.push(entry);
    }

    return parsedResponses;
  } finally {
    await fs.unlink(downloadPath).catch(() => undefined);
  }
}

async function runTogetherBatch(
  model: string,
  requestedCount: number,
  prompts: string[],
  negativePrompt: string | undefined,
  references: Array<{ base64: string; mimeType: string }>,
  aspectRatio: string,
  requestedDimensions: { width: number; height: number } | undefined,
  steps: number | undefined,
  resizeTo: { width: number; height: number } | undefined,
  aiUpscale: boolean
): Promise<BatchOutput> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing TOGETHER_API_KEY');
  }

  const together = new Together({ apiKey });
  const referenceImageUrls = references.map(buildReferenceDataUrl);
  const dimensions = requestedDimensions ?? resolveTogetherDimensions(aspectRatio);
  const maxParallel = aiUpscale ? 1 : parseMaxParallelRequests();
  const referenceMode = resolveTogetherReferenceMode(model);
  const referencePayload =
    referenceMode === 'image_url'
      ? referenceImageUrls[0]
        ? { image_url: referenceImageUrls[0] }
        : {}
      : referenceMode === 'reference_images'
        ? referenceImageUrls.length > 0
          ? { reference_images: referenceImageUrls }
          : {}
        : {};

  const jobs = prompts.map((promptVariant) => {
    return async () => {
      const baseRequest = {
        model,
        prompt: promptVariant,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        response_format: 'base64' as const,
        output_format: 'jpeg' as const,
        width: dimensions.width,
        height: dimensions.height,
        ...(typeof steps === 'number' ? { steps } : {}),
        ...referencePayload
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
      const processed = await processGeneratedImage(extracted, resizeTo, aiUpscale);

      return {
        ...processed,
        promptVariant
      } satisfies BatchResult;
    };
  });

  const settled = await runWithConcurrency(jobs, maxParallel);
  return buildBatchOutput(model, requestedCount, prompts, settled);
}

async function extractGeminiBatchResults(ai: GoogleGenAI, job: BatchJob, context: GeminiResultExtractionContext): Promise<BatchOutput> {
  let inlinedResponses = job.dest?.inlinedResponses ?? [];
  if (inlinedResponses.length === 0 && job.dest?.fileName) {
    inlinedResponses = await downloadBatchResponsesFile(ai, job.dest.fileName, context.jobId);
  }
  if (inlinedResponses.length === 0) {
    throw new Error('Batch job completed but returned no responses.');
  }

  const requestedCount = findRequestedCountFromMetadata(inlinedResponses) ?? inlinedResponses.length;
  const resizeTo = findResizeFromMetadata(inlinedResponses);
  const aiUpscale = findAiUpscaleFromMetadata(inlinedResponses);
  const prompts = inlinedResponses.map((response, index) => normalizePromptVariant(response.metadata, index));

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

      const processed = await processGeneratedImage(extracted, resizeTo, aiUpscale);
      const promptVariant = normalizePromptVariant(inlined.metadata, i);

      return { ...processed, promptVariant } satisfies BatchResult;
    })
  );

  return buildBatchOutput(context.model, requestedCount, prompts, settled);
}

export async function submitBatch(input: BatchInput): Promise<SubmitBatchResult> {
  const clampedCount = Math.max(1, Math.min(input.count, parseMaxBatch()));
  const maxReferenceImages = parseMaxReferenceImages();
  const model = normalizeRequestedModel(input.model) ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const prompts = buildPromptVariants(input.basePrompt, clampedCount);
  const references = (input.referenceImages ?? []).slice(0, maxReferenceImages);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const imageSize = normalizeImageSize(input.imageSize, model);
  const togetherRequestedDimensions = parseTogetherRequestedDimensions(input.imageSize);
  const steps = normalizeSteps(input.steps);
  const resizeTo = normalizeResizeTo(input.resizeTo);
  const aiUpscale = input.aiUpscale === true;

  if (isTogetherImageModel(model)) {
    // Together AI has no async batch API — run synchronously and return results directly.
    // This avoids any module-state dependency between the submit and status requests.
    const jobId = randomUUID();
    const result = await runTogetherBatch(
      model,
      clampedCount,
      prompts,
      input.negativePrompt?.trim() || undefined,
      references,
      aspectRatio,
      togetherRequestedDimensions,
      steps,
      resizeTo,
      aiUpscale
    );
    return { jobId, provider: 'together', results: result };
  }

  if (isFalImageModel(model)) {
    const jobId = randomUUID();
    const result = await runFalBatch(
      model,
      clampedCount,
      prompts,
      input.negativePrompt?.trim() || undefined,
      references,
      aspectRatio,
      resizeTo,
      aiUpscale
    );
    return { jobId, provider: 'fal', results: result };
  }

  if (isVertexImageModel(model)) {
    const jobId = randomUUID();
    const result = await runVertexBatch(
      model,
      clampedCount,
      prompts,
      references,
      resizeTo,
      aiUpscale
    );
    return { jobId, provider: 'vertex', results: result };
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
    metadata: {
      promptVariant,
      requestedCount: String(clampedCount),
      ...(aiUpscale ? { aiUpscale: 'true' } : {}),
      ...(resizeTo
        ? {
            resizeWidth: String(resizeTo.width),
            resizeHeight: String(resizeTo.height)
          }
        : {})
    }
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
    return {
      jobId,
      state,
      stateLabel: getStateLabel(state),
      stateDetail: buildGeminiStateDetail(state, job),
      error: job.error?.message?.trim() || 'Batch job failed.'
    };
  }
  if (state === 'cancelled') {
    return {
      jobId,
      state,
      stateLabel: getStateLabel(state),
      stateDetail: buildGeminiStateDetail(state, job),
      error: 'Batch job was cancelled.'
    };
  }
  if (state === 'expired') {
    return {
      jobId,
      state,
      stateLabel: getStateLabel(state),
      stateDetail: buildGeminiStateDetail(state, job),
      error: 'Batch job has expired (48-hour limit reached).'
    };
  }

  if (state === 'succeeded') {
    const hasInlineResponses = (job.dest?.inlinedResponses?.length ?? 0) > 0;
    const hasFileOutput = Boolean(job.dest?.fileName);
    if (!hasInlineResponses && !hasFileOutput) {
      return { jobId, state: 'running', stateLabel: 'Waiting for results...' };
    }

    const results = await extractGeminiBatchResults(ai, job, {
      jobId,
      model: normalizeModelCode(job.model ?? DEFAULT_MODEL)
    });
    return { jobId, state, stateLabel: getStateLabel(state), stateDetail: buildGeminiStateDetail(state, job), results };
  }

  return { jobId, state, stateLabel: getStateLabel(state), stateDetail: buildGeminiStateDetail(state, job) };
}
