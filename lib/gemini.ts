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
import { buildPromptVariants, normalizeSceneVariationStrength, type SceneVariationStrength } from '@/lib/promptVariants';

export type AuthMode = 'service_account' | 'api_key' | 'vertex_express';
/** batch = toplu (async Batch API, cheaper); single = tekli (interactive generateContent, faster). */
export type RenderMode = 'batch' | 'single';

export type BatchInput = {
  basePrompt: string;
  negativePrompt?: string;
  model?: string;
  steps?: number;
  /** Vertex-listed models: api_key (Gemini Developer API, default), service_account, vertex_express. */
  authMode?: AuthMode;
  /**
   * Production style:
   * - batch (toplu): Gemini Developer Batch API — cheaper, async poll
   * - single (tekli): interactive generateContent — faster, standard pricing
   */
  renderMode?: RenderMode;
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
  aiUpscale?: number;
  /** Semantic image edit: lock the product and refresh / replace its surrounding scene. */
  sceneVariation?: boolean;
  /** Scene change amount when sceneVariation is on. Default: low. */
  sceneVariationStrength?: SceneVariationStrength;
};

export type BatchResult = {
  promptVariant: string;
  imageBase64: string;
  mimeType: string;
  /** Set when the image has been offloaded to Vercel Blob — clients should prefer this over imageBase64. */
  blobUrl?: string;
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

/** Per-request progress from Gemini Batch (`batchStats` / `completionStats`). */
export type BatchProgressStats = {
  requestCount: number;
  successfulCount: number;
  failedCount: number;
  pendingCount: number;
};

export type BatchStatusResult = {
  jobId: string;
  state: JobState;
  stateLabel: string;
  stateDetail?: string;
  error?: string;
  results?: BatchOutput;
  /** Present when the Batch API reports request-level stats while the job runs. */
  progress?: BatchProgressStats;
};

type UpscalerConstructor = new (options: { model: unknown }) => {
  upscale(input: Buffer): Promise<{ dispose?: () => void }>;
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
const esrganUpscalerCache = new Map<number, Promise<InstanceType<UpscalerConstructor>>>();
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
    const maybeApiError = error as Error & { status?: number; code?: number | string; details?: unknown; error?: unknown };
    const status = maybeApiError.status ?? maybeApiError.code;
    const statusPrefix = status !== undefined && status !== '' ? `[${status}] ` : '';
    const nestedMessage = extractNestedErrorMessage(error);
    const message = nestedMessage || error.message;
    return `${statusPrefix}${message}`.trim();
  }

  if (error && typeof error === 'object') {
    const nestedMessage = extractNestedErrorMessage(error);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return String(error);
}

function extractNestedErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const direct = firstStringValue([record.message, record.statusText]);
  if (direct && !/^\[?\d+\]?$/.test(direct.trim())) {
    // Prefer real messages over bare status codes like "404"
    if (!/^\[0:\s*\d+\]/.test(direct)) {
      const asError = record.error;
      if (asError && typeof asError === 'object') {
        const nested = extractNestedErrorMessage(asError);
        if (nested) return nested;
      }
      if (direct.length > 8) {
        return direct;
      }
    }
  }

  if (record.error && typeof record.error === 'object') {
    const nested = extractNestedErrorMessage(record.error);
    if (nested) return nested;
  }

  if (Array.isArray(record.details)) {
    for (const detail of record.details) {
      const nested = extractNestedErrorMessage(detail);
      if (nested) return nested;
    }
  }

  // @google/genai sometimes stringifies as "[0: 404]\n{\nerror: {…}\n}"
  if (typeof record.message === 'string') {
    const match = record.message.match(/"message"\s*:\s*"([^"]+)"/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return typeof record.message === 'string' ? record.message : null;
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

/**
 * Public fal-ai/* catalog ids stay in the UI / history.
 * Generation always runs on Vertex AI (service account). Real fal.ai traffic is disabled.
 */
function mapFalModelToVertexBackend(model: string): string {
  const code = normalizeModelCode(model).toLowerCase();

  // Nano Banana family → matching Gemini image models on Vertex.
  if (code === 'fal-ai/nano-banana/edit') {
    return 'vertex/gemini-2.5-flash-image';
  }
  if (code === 'fal-ai/nano-banana-2/edit') {
    return 'vertex/gemini-3.1-flash-image-preview';
  }
  if (code === 'fal-ai/nano-banana-pro/edit') {
    // Pro maps to the strongest available flash-image family on this project.
    return 'vertex/gemini-3.1-flash-image-preview';
  }

  // Flux / GPT Image / any other fal catalog entry → default Vertex Gemini image model.
  return 'vertex/gemini-2.5-flash-image';
}

/** Soft-mask Vertex/GCP wording so the fal catalog UI still reads as fal. */
function maskBackendErrorForFalFacade(message: string): string {
  return message
    .replace(/Vertex AI/gi, 'image service')
    .replace(/\bVertex\b/gi, 'image service')
    .replace(/\bVERTEX_[A-Z0-9_]+\b/g, 'backend configuration')
    .replace(/\bGOOGLE_CLOUD_[A-Z0-9_]+\b/g, 'backend configuration')
    .replace(/aiplatform\.googleapis\.com/gi, 'api')
    .replace(/service account/gi, 'credentials');
}

function isVertexImageModel(model: string): boolean {
  return VERTEX_MODEL_PATTERN.test(model);
}

function normalizeAuthMode(value: string | undefined): AuthMode {
  const normalized = value?.trim().toLowerCase().replace(/-/g, '_');
  if (
    normalized === 'service_account' ||
    normalized === 'serviceaccount' ||
    normalized === 'vertex' ||
    normalized === 'sa'
  ) {
    return 'service_account';
  }
  if (
    normalized === 'vertex_express' ||
    normalized === 'vertexexpress' ||
    normalized === 'express' ||
    normalized === 'express_mode'
  ) {
    return 'vertex_express';
  }
  // Default: Gemini Developer API (api key).
  return 'api_key';
}

function normalizeRenderMode(value: string | undefined): RenderMode {
  const normalized = value?.trim().toLowerCase().replace(/-/g, '_');
  if (
    normalized === 'single' ||
    normalized === 'tekli' ||
    normalized === 'interactive' ||
    normalized === 'fast'
  ) {
    return 'single';
  }
  if (
    normalized === 'batch' ||
    normalized === 'toplu' ||
    normalized === 'bulk' ||
    normalized === 'economy'
  ) {
    return 'batch';
  }
  // Default: interactive (tekli) for snappier UX unless caller opts into batch.
  return 'single';
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

function firstStringValue(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
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

function extractVertexTextFromResponse(response: Record<string, unknown>): string | null {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const parts: unknown[] = (candidate as Record<string, unknown>)?.content
      ? ((candidate as Record<string, unknown>).content as Record<string, unknown>)?.parts as unknown[]
      : [];
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const text = (part as Record<string, unknown>)?.text;
      if (typeof text === 'string' && text.trim()) return text.trim();
    }
  }
  return null;
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

/**
 * Auth mode: API Key — Gemini Developer API Batch job (`ai.batches.create`).
 * Async job; poll via getBatchStatus. ~50% cost vs interactive generateContent.
 * Does not use Vertex Express.
 */
async function createGeminiDeveloperBatchJob(input: {
  model: string;
  prompts: string[];
  references: Array<{ base64: string; mimeType: string }>;
  aspectRatio: string;
  imageSize: string | undefined;
  requestedCount: number;
  resizeTo: { width: number; height: number } | undefined;
  aiUpscale: number;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Set it in .env.local to use API key authentication.');
  }

  // Developer API model ids never use the vertex/ prefix.
  const modelName = input.model.replace(VERTEX_MODEL_PATTERN, '');
  if (isVertexImagenModel(modelName)) {
    throw new Error(
      'Imagen models require Service Account (Vertex AI) authentication. Switch auth mode to Service Account or choose a Gemini image model.'
    );
  }

  console.error('[gemini-api-key] createGeminiDeveloperBatchJob:', {
    model: modelName,
    mode: 'gemini-developer-batch-api',
    referenceCount: input.references.length,
    promptCount: input.prompts.length,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize ?? null
  });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const inlinedRequests = input.prompts.map((promptVariant) => ({
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptVariant },
            ...input.references.map((ref) => ({
              inlineData: { mimeType: ref.mimeType, data: ref.base64 }
            }))
          ]
        }
      ],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: {
          aspectRatio: input.aspectRatio,
          ...(input.imageSize ? { imageSize: input.imageSize } : {})
        }
      },
      metadata: {
        promptVariant,
        requestedCount: String(input.requestedCount),
        ...(input.aiUpscale > 0 ? { aiUpscale: String(input.aiUpscale) } : {}),
        ...(input.resizeTo
          ? {
              resizeWidth: String(input.resizeTo.width),
              resizeHeight: String(input.resizeTo.height)
            }
          : {})
      }
    }));

    const batchJob = await ai.batches.create({
      model: modelName,
      src: inlinedRequests,
      config: { displayName: `image-batch-${Date.now()}` }
    });

    const jobId = batchJob.name;
    if (!jobId) {
      throw new Error('Batch job was created but returned no job name.');
    }
    return jobId;
  } catch (error) {
    throw new Error(formatApiKeyAuthError(error, modelName));
  }
}

/**
 * Tekli (interactive): Gemini Developer API generateContent in parallel.
 * Faster than Batch API; standard pricing (not the ~50% Batch discount).
 */
async function runGeminiDeveloperInteractiveBatch(input: {
  model: string;
  prompts: string[];
  references: Array<{ base64: string; mimeType: string }>;
  aspectRatio: string;
  imageSize: string | undefined;
  requestedCount: number;
  resizeTo: { width: number; height: number } | undefined;
  aiUpscale: number;
}): Promise<BatchOutput> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Set it in .env.local for API key / interactive generation.');
  }

  const modelName = input.model.replace(VERTEX_MODEL_PATTERN, '');
  if (isVertexImagenModel(modelName)) {
    throw new Error(
      'Imagen models require Service Account (Vertex AI) authentication. Switch auth mode to Service Account or use batch mode with a Gemini image model.'
    );
  }

  const maxParallel = input.aiUpscale > 0 ? 1 : parseMaxParallelRequests();
  console.error('[gemini-api-key] runGeminiDeveloperInteractiveBatch:', {
    model: modelName,
    mode: 'gemini-developer-interactive',
    referenceCount: input.references.length,
    promptCount: input.prompts.length,
    maxParallel
  });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const jobs = input.prompts.map((promptVariant) => {
      return async () => {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  ...input.references.map((ref) => ({
                    inlineData: { mimeType: ref.mimeType, data: ref.base64 }
                  })),
                  { text: promptVariant }
                ]
              }
            ],
            config: {
              responseModalities: ['IMAGE', 'TEXT'],
              imageConfig: {
                aspectRatio: input.aspectRatio,
                ...(input.imageSize ? { imageSize: input.imageSize } : {})
              }
            }
          });

          const extracted = extractImageFromGenerateContentResponse(response);
          if (!extracted) {
            throw getNoImageReturnedError(undefined);
          }
          const processed = await processGeneratedImage(extracted, input.resizeTo, input.aiUpscale);
          return { ...processed, promptVariant } satisfies BatchResult;
        } catch (error) {
          throw new Error(formatApiKeyAuthError(error, modelName));
        }
      };
    });

    const settled = await runWithConcurrency(jobs, maxParallel);
    return buildBatchOutput(input.model, input.requestedCount, input.prompts, settled);
  } catch (error) {
    throw new Error(formatApiKeyAuthError(error, modelName));
  }
}

/**
 * Auth mode: Vertex Express — GEMINI_API_KEY against Vertex Express / publishers REST.
 * Separate from Gemini Developer API (authMode=api_key) and Service Account.
 */
async function runVertexExpressBatch(
  model: string,
  requestedCount: number,
  prompts: string[],
  references: Array<{ base64: string; mimeType: string }>,
  resizeTo: { width: number; height: number } | undefined,
  aiUpscale: number,
  aspectRatio: string,
  imageSize: string | undefined
): Promise<BatchOutput> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Missing GEMINI_API_KEY. Set a Vertex Express / Google Cloud API key in .env.local for Express mode.'
    );
  }

  const modelName = model.replace(VERTEX_MODEL_PATTERN, '');
  if (isVertexImagenModel(modelName)) {
    throw new Error(
      'Imagen models require Service Account (Vertex AI) authentication. Switch auth mode to Service Account.'
    );
  }

  const maxParallel = aiUpscale > 0 ? 1 : parseMaxParallelRequests();

  console.error('[vertex-express] runVertexExpressBatch:', {
    model: modelName,
    mode: 'vertex-express-rest',
    referenceCount: references.length,
    promptCount: prompts.length,
    aspectRatio,
    imageSize: imageSize ?? null
  });

  const jobs = prompts.map((promptVariant) => {
    return async () => {
      try {
        const extracted = await generateVertexExpressImage({
          apiKey,
          modelName,
          promptVariant,
          references,
          aspectRatio,
          imageSize
        });
        const processed = await processGeneratedImage(extracted, resizeTo, aiUpscale);
        return { ...processed, promptVariant } satisfies BatchResult;
      } catch (error) {
        throw new Error(formatVertexExpressAuthError(error, modelName));
      }
    };
  });

  const settled = await runWithConcurrency(jobs, maxParallel);
  return buildBatchOutput(model, requestedCount, prompts, settled);
}

/**
 * Vertex Express REST image call.
 *
 * Express API keys belong to the Express project (e.g. numeric 7465…).
 * Do NOT send them against the service-account project — that yields 403.
 * Flash-image models require locations/global.
 */
async function generateVertexExpressImage(input: {
  apiKey: string;
  modelName: string;
  promptVariant: string;
  references: Array<{ base64: string; mimeType: string }>;
  aspectRatio: string;
  imageSize: string | undefined;
}): Promise<BatchResult> {
  const parts: unknown[] = input.references.map((ref) => ({
    inlineData: { mimeType: ref.mimeType, data: ref.base64 }
  }));
  parts.push({ text: input.promptVariant });

  const payload: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      ...(input.aspectRatio || input.imageSize
        ? {
            imageConfig: {
              ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
              ...(input.imageSize ? { imageSize: input.imageSize } : {})
            }
          }
        : {})
    }
  };

  let expressProjectId = resolveExpressProjectIdFromEnv();
  const modelCandidates = expandVertexImageModelAliases(input.modelName);
  const errors: string[] = [];
  const triedUrls = new Set<string>();

  const tryUrl = async (label: string, url: string): Promise<BatchResult | null> => {
    if (triedUrls.has(url)) {
      return null;
    }
    triedUrls.add(url);
    console.error('[vertex-express] trying', label);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': input.apiKey
      },
      body: JSON.stringify(payload)
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const errDetail = (data.error as Record<string, unknown> | undefined)?.message;
      const errMsg =
        firstStringValue([errDetail, data.message]) ??
        `Vertex Express request failed (${response.status}) for ${label}`;
      const full = `[${response.status}] ${String(errMsg)}`;
      errors.push(`${label}: ${full}`);

      if (response.status === 429 || /resource has been exhausted|quota/i.test(full)) {
        throw new Error(
          `[429] Vertex Express quota exhausted for model ${input.modelName} ` +
            `(project ${expressProjectId ?? extractProjectIdFromText(full) ?? 'unknown'}). ` +
            `Wait for quota reset, reduce count/parallelism, or switch Auth Method to Service Account.`
        );
      }

      const projectFromError = extractProjectIdFromText(full);
      if (projectFromError && !expressProjectId) {
        expressProjectId = projectFromError;
        console.error('[vertex-express] discovered Express project from error:', expressProjectId);
      }
      return null;
    }

    const extracted = extractVertexImageFromResponse(data);
    if (!extracted) {
      const textResponse = extractVertexTextFromResponse(data);
      errors.push(
        `${label}: no image${textResponse ? ` (model text: "${textResponse.slice(0, 120)}")` : ''}`
      );
      return null;
    }
    return extracted;
  };

  if (expressProjectId) {
    for (const candidateModel of modelCandidates) {
      const hit = await tryUrl(
        `global/${expressProjectId}/${candidateModel}`,
        buildVertexModelUrl(expressProjectId, 'global', candidateModel, 'generateContent')
      );
      if (hit) return hit;
    }
  }

  for (const candidateModel of modelCandidates) {
    const hit = await tryUrl(
      `publishers/${candidateModel}`,
      `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(candidateModel)}:generateContent`
    );
    if (hit) return hit;
  }

  if (expressProjectId) {
    for (const candidateModel of modelCandidates) {
      const hit = await tryUrl(
        `global-discovered/${expressProjectId}/${candidateModel}`,
        buildVertexModelUrl(expressProjectId, 'global', candidateModel, 'generateContent')
      );
      if (hit) return hit;
    }
  }

  throw new Error(
    `Vertex Express failed for model ${input.modelName}. ` +
      `Set VERTEX_EXPRESS_PROJECT to the Express project number (from the API key / 404 path) ` +
      `if needed. Do not point Express keys at the service-account project. ` +
      `Attempts: ${errors.join(' || ')}`
  );
}

/** Express project id/number for Express REST calls (never service-account project_id). */
function resolveExpressProjectIdFromEnv(): string | undefined {
  const fromEnv = (
    process.env.VERTEX_EXPRESS_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.VERTEX_AI_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    process.env.GCP_PROJECT
  )?.trim();
  return fromEnv || undefined;
}

function expandVertexImageModelAliases(modelName: string): string[] {
  const names = [modelName];
  if (/^gemini-2\.5-flash-image$/i.test(modelName)) {
    names.push('gemini-2.5-flash-image-preview');
  } else if (/^gemini-2\.5-flash-image-preview$/i.test(modelName)) {
    names.push('gemini-2.5-flash-image');
  }
  return [...new Set(names)];
}

function extractProjectIdFromText(text: string): string | null {
  const match = text.match(/projects\/([a-zA-Z0-9-]+)\//);
  return match?.[1] ?? null;
}

function modelRequiresGlobalVertexEndpoint(modelName: string): boolean {
  // Gemini 3 family + flash-image models are published on the global endpoint.
  return /^(gemini-3|gemini-2\.5-flash-image)/i.test(modelName) || /image-preview|flash-image/i.test(modelName);
}

function resolveVertexServiceAccountLocation(modelName: string): string {
  const configured = (process.env.VERTEX_AI_REGION ?? process.env.GOOGLE_CLOUD_LOCATION ?? '').trim();
  if (modelRequiresGlobalVertexEndpoint(modelName)) {
    if (configured && configured.toLowerCase() !== 'global') {
      console.error(
        `[vertex] model "${modelName}" requires the global endpoint; overriding VERTEX_AI_REGION="${configured}" → "global"`
      );
    }
    return 'global';
  }
  return configured || 'us-central1';
}

function buildVertexModelUrl(projectId: string, location: string, modelName: string, apiEndpoint: string): string {
  if (location.toLowerCase() === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/global/publishers/google/models/${encodeURIComponent(modelName)}:${apiEndpoint}`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(modelName)}:${apiEndpoint}`;
}

function formatApiKeyAuthError(error: unknown, modelName: string): string {
  const raw = formatError(error);
  const modelHint = `Requested model: ${modelName}.`;
  if (/429|resource has been exhausted|quota/i.test(raw)) {
    return (
      `${raw} | ${modelHint} Gemini API key quota is exhausted. Wait for reset, lower count, ` +
      `or switch Auth Method to Service Account (Vertex AI) or Vertex Express.`
    );
  }
  if (/generativelanguage\.googleapis\.com|SERVICE_DISABLED|Gemini API has not been used/i.test(raw)) {
    return (
      `${raw} | ${modelHint} Hint: enable the Gemini API for this API key in Google AI Studio / Cloud Console, ` +
      `or switch Auth Method to Service Account / Vertex Express.`
    );
  }
  if (/404|NOT_FOUND|was not found or your project does not have access/i.test(raw)) {
    return (
      `${raw} | ${modelHint} Hint: this model may not be available for Gemini Developer API keys. ` +
      `Try another Gemini image model, or switch Auth Method to Service Account / Vertex Express.`
    );
  }
  if (/PERMISSION_DENIED|not available|not allowed|403|API_KEY_INVALID|invalid.?api.?key/i.test(raw)) {
    return (
      `${raw} | ${modelHint} Hint: check GEMINI_API_KEY (Google AI Studio key), ` +
      `or switch Auth Method to Service Account / Vertex Express.`
    );
  }
  return `${raw} | ${modelHint}`;
}

function formatVertexExpressAuthError(error: unknown, modelName: string): string {
  const raw = formatError(error);
  const modelHint = `Requested model: ${modelName}.`;
  if (/429|resource has been exhausted|quota/i.test(raw)) {
    return (
      `${raw} | ${modelHint} Vertex Express quota is exhausted. Wait for reset, lower count, ` +
      `or switch Auth Method to Service Account (Vertex AI).`
    );
  }
  if (/free-494923|Permission 'aiplatform.endpoints.predict' denied/i.test(raw)) {
    return (
      `${raw} | ${modelHint} Hint: Express key was pointed at the service-account project. ` +
      `Set VERTEX_EXPRESS_PROJECT to the Express project number, or use Service Account mode.`
    );
  }
  if (/404|NOT_FOUND|was not found or your project does not have access/i.test(raw)) {
    return (
      `${raw} | ${modelHint} Hint: model missing for this Express project/region. ` +
      `Flash-image usually needs locations/global + VERTEX_EXPRESS_PROJECT. Or use Service Account.`
    );
  }
  if (/PERMISSION_DENIED|not available|not allowed|403|API_KEY_INVALID|invalid.?api.?key/i.test(raw)) {
    return (
      `${raw} | ${modelHint} Hint: use a Vertex Express / Google Cloud API key (often AQ.…), ` +
      `set VERTEX_EXPRESS_PROJECT if needed, or switch to Service Account.`
    );
  }
  return `${raw} | ${modelHint}`;
}

async function runVertexBatch(
  model: string,
  requestedCount: number,
  prompts: string[],
  references: Array<{ base64: string; mimeType: string }>,
  resizeTo: { width: number; height: number } | undefined,
  aiUpscale: number
): Promise<BatchOutput> {
  const { token, projectId } = await getVertexAccessToken();
  const modelName = model.replace(VERTEX_MODEL_PATTERN, '');
  const region = resolveVertexServiceAccountLocation(modelName);
  const useImagenApi = isVertexImagenModel(modelName);
  const apiEndpoint = useImagenApi ? 'predict' : 'generateContent';
  const url = buildVertexModelUrl(projectId, region, modelName, apiEndpoint);

  console.error('[vertex] runVertexBatch:', {
    model: modelName,
    region,
    projectId,
    endpoint: apiEndpoint,
    urlHost: new URL(url).host,
    referenceCount: references.length,
    referenceSizesKb: references.map(r => (r.base64.length / 1024).toFixed(1)),
    promptCount: prompts.length,
    firstPromptPreview: prompts[0]?.substring(0, 80)
  });

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
          throw new Error(`[${response.status}] ${String(errMsg)} (model=${modelName}, location=${region})`);
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

    const settledChunks = await runWithConcurrency(chunkJobs, aiUpscale > 0 ? 1 : parseMaxParallelRequests());

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
  const maxParallel = aiUpscale > 0 ? 1 : parseMaxParallelRequests();
  const jobs = prompts.map((promptVariant) => {
    return async () => {
      const parts: unknown[] = references.map((ref) => ({
        inlineData: { mimeType: ref.mimeType, data: ref.base64 }
      }));
      parts.push({ text: promptVariant });
      const payload = {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const errDetail = (data.error as Record<string, unknown> | undefined)?.message;
        const errMsg = firstStringValue([errDetail, data.message]) ?? `Vertex AI request failed (${response.status})`;
        throw new Error(`[${response.status}] ${String(errMsg)} (model=${modelName}, location=${region})`);
      }

      const extracted = extractVertexImageFromResponse(data);
      if (!extracted) {
        const textResponse = extractVertexTextFromResponse(data);
        throw getNoImageReturnedError(`Vertex AI returned no image in response.${textResponse ? ` Model said: "${textResponse.slice(0, 150)}"` : ''}`);
      }

      const processed = await processGeneratedImage(extracted, resizeTo, aiUpscale);
      return { ...processed, promptVariant } satisfies BatchResult;
    };
  });

  const settled = await runWithConcurrency(jobs, maxParallel);
  return buildBatchOutput(model, requestedCount, prompts, settled);
}

/**
 * Fal catalog facade: public model id stays fal-ai/*, generation uses Vertex SA only.
 * FAL_AI_API_KEY and fal.run are not used.
 */
async function runFalBatchViaVertexServiceAccount(
  publicFalModel: string,
  requestedCount: number,
  prompts: string[],
  references: Array<{ base64: string; mimeType: string }>,
  resizeTo: { width: number; height: number } | undefined,
  aiUpscale: number
): Promise<BatchOutput> {
  const backendModel = mapFalModelToVertexBackend(publicFalModel);

  console.error('[fal→vertex] proxy (fal.ai disabled):', {
    publicModel: publicFalModel,
    backendModel,
    promptCount: prompts.length,
    referenceCount: references.length
  });

  try {
    const result = await runVertexBatch(
      backendModel,
      requestedCount,
      prompts,
      references,
      resizeTo,
      aiUpscale
    );

    return {
      ...result,
      // Keep the catalog id the user selected (fal-ai/...).
      usedModel: publicFalModel,
      failures: result.failures.map((failure) => ({
        ...failure,
        error: maskBackendErrorForFalFacade(failure.error)
      }))
    };
  } catch (error) {
    throw new Error(maskBackendErrorForFalFacade(formatError(error)));
  }
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
  aiUpscale: number
): Promise<BatchResult> {
  const enhanced = aiUpscale > 0 ? await upscaleGeneratedImage(result, aiUpscale) : result;
  return resizeTo ? resizeGeneratedImage(enhanced, resizeTo) : enhanced;
}

async function upscaleGeneratedImage(result: BatchResult, scale: number): Promise<BatchResult> {
  const upscaler = await getEsrganUpscaler(scale);
  // ESRGAN only supports 3-channel RGB input. Strip alpha channel if present.
  const inputBuffer = await sharp(Buffer.from(result.imageBase64, 'base64'))
    .removeAlpha()
    .toBuffer();
  // upscaler.upscale() returns a TF Tensor3D (typed loosely via UpscalerConstructor).
  const tensor = await upscaler.upscale(inputBuffer);
  const { node: tfnode } = await getTfjsNode();
  // encodePng expects Tensor3D; UpscalerConstructor only exposes dispose on the return type.
  const encodePng = tfnode.encodePng as (image: unknown) => Promise<Uint8Array>;
  const upscaledPng = await encodePng(tensor);
  tensor.dispose?.();

  return {
    ...result,
    imageBase64: Buffer.from(upscaledPng).toString('base64'),
    mimeType: 'image/png'
  };
}

let tfjsNodePromise: Promise<typeof import('@tensorflow/tfjs-node')> | undefined;

/** Resolve a Node require that works outside the Next webpack bundle. */
function getRuntimeRequire(): NodeRequire {
  const globalRequire = (globalThis as typeof globalThis & { __non_webpack_require__?: NodeRequire })
    .__non_webpack_require__;
  if (typeof globalRequire === 'function') {
    return globalRequire;
  }
  return Function('return require')() as NodeRequire;
}

async function getTfjsNode(): Promise<typeof import('@tensorflow/tfjs-node')> {
  tfjsNodePromise ??= (async () => {
    // Dynamic require keeps tfjs-node out of the Next.js webpack graph (Vercel size limits).
    return getRuntimeRequire()('@tensorflow/tfjs-node') as typeof import('@tensorflow/tfjs-node');
  })();
  return tfjsNodePromise;
}

async function getEsrganUpscaler(scale: number): Promise<InstanceType<UpscalerConstructor>> {
  const cached = esrganUpscalerCache.get(scale);
  if (cached) return cached;

  const promise = (async () => {
    try {
      // Dynamic require keeps Upscaler/ESRGAN out of the Next.js webpack graph (Vercel size limits).
      const runtimeRequire = getRuntimeRequire();
      const upscalerModule = runtimeRequire('upscaler/node') as { default?: unknown };
      const modelModule = runtimeRequire(`@upscalerjs/esrgan-thick/${scale}x`) as { default?: unknown };
      const Upscaler = (upscalerModule.default ?? upscalerModule) as unknown as UpscalerConstructor;
      const model = (modelModule.default ?? modelModule) as unknown;
      return new Upscaler({ model });
    } catch (error) {
      esrganUpscalerCache.delete(scale);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `AI Upscale ${scale}x requires UpscalerJS with @tensorflow/tfjs-node available in this Node environment. ` +
          `Install a supported Node LTS runtime or TensorFlow.js native backend. ${detail}`
      );
    }
  })();

  esrganUpscalerCache.set(scale, promise);
  return promise;
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
  settled: PromiseSettledResult<BatchResult>[],
  options?: { allowEmpty?: boolean }
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
    if (options?.allowEmpty) {
      return {
        usedModel: model,
        requestedCount,
        succeededCount: 0,
        failedCount: failures.length,
        results: [],
        failures
      };
    }
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
  const progress = extractBatchProgressStats(job);
  const progressHint = progress
    ? `${progress.successfulCount + progress.failedCount}/${progress.requestCount} requests done` +
      (progress.failedCount > 0 ? ` (${progress.failedCount} failed)` : '')
    : undefined;

  if (state === 'pending') {
    if (createdAt) {
      const queued = `Queued for ${formatDuration((now - createdAt) / 1000)}`;
      return progressHint ? `${queued} · ${progressHint}` : queued;
    }
    return progressHint;
  }

  if (state === 'running') {
    if (activeStart) {
      const running = `Running for ${formatDuration((now - activeStart) / 1000)}`;
      return progressHint ? `${running} · ${progressHint}` : running;
    }
    return progressHint;
  }

  if (state === 'succeeded') {
    if (createdAt && updatedAt) {
      const finished = `Finished in ${formatDuration((updatedAt - createdAt) / 1000)}`;
      return progressHint ? `${finished} · ${progressHint}` : finished;
    }
    return progressHint;
  }

  return progressHint;
}

/**
 * Read request-level batch progress from the job payload.
 * - Gemini Developer API: `batchStats` (requestCount / successfulRequestCount / …)
 * - Vertex-style BatchJob: `completionStats` (successfulCount / failedCount / incompleteCount)
 */
function extractBatchProgressStats(job: BatchJob): BatchProgressStats | undefined {
  const raw = job as BatchJob & {
    batchStats?: {
      requestCount?: string | number;
      successfulRequestCount?: string | number;
      failedRequestCount?: string | number;
      pendingRequestCount?: string | number;
    };
  };

  if (raw.batchStats) {
    const requestCount = parseNonNegativeInt(raw.batchStats.requestCount) ?? 0;
    const successfulCount = parseNonNegativeInt(raw.batchStats.successfulRequestCount) ?? 0;
    const failedCount = parseNonNegativeInt(raw.batchStats.failedRequestCount) ?? 0;
    const pendingFromApi = parseNonNegativeInt(raw.batchStats.pendingRequestCount);
    const pendingCount =
      pendingFromApi ?? Math.max(0, requestCount - successfulCount - failedCount);
    if (requestCount > 0 || successfulCount > 0 || failedCount > 0 || pendingCount > 0) {
      return {
        requestCount: requestCount > 0 ? requestCount : successfulCount + failedCount + pendingCount,
        successfulCount,
        failedCount,
        pendingCount
      };
    }
  }

  if (job.completionStats) {
    const successfulCount = parseNonNegativeInt(job.completionStats.successfulCount) ?? 0;
    const failedCount = parseNonNegativeInt(job.completionStats.failedCount) ?? 0;
    // incompleteCount can be -1 ("unknown"); only use non-negative values as pending.
    const incompleteRaw = Number.parseInt(String(job.completionStats.incompleteCount ?? ''), 10);
    const pendingCount =
      Number.isFinite(incompleteRaw) && incompleteRaw >= 0 ? incompleteRaw : 0;
    const requestCount =
      Number.isFinite(incompleteRaw) && incompleteRaw >= 0
        ? successfulCount + failedCount + pendingCount
        : successfulCount + failedCount;
    if (successfulCount > 0 || failedCount > 0 || requestCount > 0) {
      return { requestCount, successfulCount, failedCount, pendingCount };
    }
  }

  return undefined;
}

function parseNonNegativeInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
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

function findAiUpscaleFromMetadata(inlinedResponses: InlinedResponse[]): number {
  return inlinedResponses.reduce((maxScale, response) => {
    const val = Number(response.metadata?.aiUpscale);
    if (!Number.isFinite(val) || val <= 0) {
      return maxScale;
    }
    return val > maxScale ? val : maxScale;
  }, 0);
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
  aiUpscale: number
): Promise<BatchOutput> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing TOGETHER_API_KEY');
  }

  const together = new Together({ apiKey });
  const referenceImageUrls = references.map(buildReferenceDataUrl);
  const dimensions = requestedDimensions ?? resolveTogetherDimensions(aspectRatio);
  const maxParallel = aiUpscale > 0 ? 1 : parseMaxParallelRequests();
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

async function extractGeminiBatchResults(
  ai: GoogleGenAI,
  job: BatchJob,
  context: GeminiResultExtractionContext,
  options?: { allowPartial?: boolean }
): Promise<BatchOutput> {
  const allowPartial = options?.allowPartial === true;
  let inlinedResponses = job.dest?.inlinedResponses ?? [];
  // File-backed dest is usually complete only at job end; skip mid-job downloads.
  if (inlinedResponses.length === 0 && job.dest?.fileName && !allowPartial) {
    inlinedResponses = await downloadBatchResponsesFile(ai, job.dest.fileName, context.jobId);
  }
  if (inlinedResponses.length === 0) {
    if (allowPartial) {
      return {
        usedModel: context.model,
        requestedCount: 0,
        succeededCount: 0,
        failedCount: 0,
        results: [],
        failures: []
      };
    }
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

  return buildBatchOutput(context.model, requestedCount, prompts, settled, {
    allowEmpty: allowPartial
  });
}

export async function submitBatch(input: BatchInput): Promise<SubmitBatchResult> {
  const clampedCount = Math.max(1, Math.min(input.count, parseMaxBatch()));
  const maxReferenceImages = parseMaxReferenceImages();
  const model = normalizeRequestedModel(input.model) ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const prompts = buildPromptVariants(input.basePrompt, clampedCount, {
    sceneVariation: input.sceneVariation === true,
    sceneVariationStrength: normalizeSceneVariationStrength(input.sceneVariationStrength)
  });
  const references = (input.referenceImages ?? []).slice(0, maxReferenceImages);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const imageSize = normalizeImageSize(input.imageSize, model);
  const togetherRequestedDimensions = parseTogetherRequestedDimensions(input.imageSize);
  const steps = normalizeSteps(input.steps);
  const resizeTo = normalizeResizeTo(input.resizeTo);
  const aiUpscale = typeof input.aiUpscale === 'number' && input.aiUpscale > 0 ? input.aiUpscale : 0;

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
    // UI still shows fal-ai/* models; backend is Vertex service account (fal.ai disabled).
    const jobId = randomUUID();
    const result = await runFalBatchViaVertexServiceAccount(
      model,
      clampedCount,
      prompts,
      references,
      resizeTo,
      aiUpscale
    );
    return { jobId, provider: 'fal', results: result };
  }

  const renderMode = normalizeRenderMode(input.renderMode);
  const authMode = normalizeAuthMode(input.authMode);

  // --- Toplu (batch): async Gemini Developer Batch API (~50% cost, poll for results) ---
  if (renderMode === 'batch') {
    const jobId = await createGeminiDeveloperBatchJob({
      model,
      prompts,
      references,
      aspectRatio,
      imageSize,
      requestedCount: clampedCount,
      resizeTo,
      aiUpscale
    });
    return { jobId, provider: 'gemini' };
  }

  // --- Tekli (single / interactive): sync generateContent (faster, standard pricing) ---
  if (isVertexImageModel(model)) {
    if (authMode === 'vertex_express') {
      const jobId = randomUUID();
      const result = await runVertexExpressBatch(
        model,
        clampedCount,
        prompts,
        references,
        resizeTo,
        aiUpscale,
        aspectRatio,
        imageSize
      );
      return { jobId, provider: 'gemini', results: result };
    }

    if (authMode === 'api_key') {
      const jobId = randomUUID();
      const result = await runGeminiDeveloperInteractiveBatch({
        model,
        prompts,
        references,
        aspectRatio,
        imageSize,
        requestedCount: clampedCount,
        resizeTo,
        aiUpscale
      });
      return { jobId, provider: 'gemini', results: result };
    }

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

  // Non-Vertex Gemini catalog models: interactive with API key (tekli default path).
  const jobId = randomUUID();
  const result = await runGeminiDeveloperInteractiveBatch({
    model,
    prompts,
    references,
    aspectRatio,
    imageSize,
    requestedCount: clampedCount,
    resizeTo,
    aiUpscale
  });
  return { jobId, provider: 'gemini', results: result };
}

/** Avoid re-decoding the same partial inlined responses on every poll. */
const partialBatchResultCache = new Map<string, { inlineCount: number; results: BatchOutput }>();

export async function getBatchStatus(jobId: string): Promise<BatchStatusResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const ai = new GoogleGenAI({ apiKey });
  const job = await ai.batches.get({ name: jobId });
  const state = mapGeminiJobState(job.state);
  const progress = extractBatchProgressStats(job);

  if (state === 'failed') {
    partialBatchResultCache.delete(jobId);
    return {
      jobId,
      state,
      stateLabel: getStateLabel(state),
      stateDetail: buildGeminiStateDetail(state, job),
      error: job.error?.message?.trim() || 'Batch job failed.',
      ...(progress ? { progress } : {})
    };
  }
  if (state === 'cancelled') {
    partialBatchResultCache.delete(jobId);
    return {
      jobId,
      state,
      stateLabel: getStateLabel(state),
      stateDetail: buildGeminiStateDetail(state, job),
      error: 'Batch job was cancelled.',
      ...(progress ? { progress } : {})
    };
  }
  if (state === 'expired') {
    partialBatchResultCache.delete(jobId);
    return {
      jobId,
      state,
      stateLabel: getStateLabel(state),
      stateDetail: buildGeminiStateDetail(state, job),
      error: 'Batch job has expired (48-hour limit reached).',
      ...(progress ? { progress } : {})
    };
  }

  if (state === 'succeeded') {
    const hasInlineResponses = (job.dest?.inlinedResponses?.length ?? 0) > 0;
    const hasFileOutput = Boolean(job.dest?.fileName);
    if (!hasInlineResponses && !hasFileOutput) {
      return {
        jobId,
        state: 'running',
        stateLabel: 'Waiting for results...',
        stateDetail: buildGeminiStateDetail('running', job),
        ...(progress ? { progress } : {})
      };
    }

    const results = await extractGeminiBatchResults(ai, job, {
      jobId,
      model: normalizeModelCode(job.model ?? DEFAULT_MODEL)
    });
    partialBatchResultCache.delete(jobId);
    return {
      jobId,
      state,
      stateLabel: getStateLabel(state),
      stateDetail: buildGeminiStateDetail(state, job),
      results,
      ...(progress ? { progress } : {})
    };
  }

  // While the job is still running, surface any already-finished inlined responses
  // so the UI can fill pending history cards incrementally.
  const inlineCount = job.dest?.inlinedResponses?.length ?? 0;
  if (inlineCount > 0) {
    try {
      const cached = partialBatchResultCache.get(jobId);
      let partialResults: BatchOutput;
      if (cached && cached.inlineCount === inlineCount) {
        partialResults = cached.results;
      } else {
        partialResults = await extractGeminiBatchResults(
          ai,
          job,
          {
            jobId,
            model: normalizeModelCode(job.model ?? DEFAULT_MODEL)
          },
          { allowPartial: true }
        );
        if (partialResults.results.length > 0) {
          partialBatchResultCache.set(jobId, { inlineCount, results: partialResults });
        }
      }
      if (partialResults.results.length > 0) {
        return {
          jobId,
          state,
          stateLabel: getStateLabel(state),
          stateDetail: buildGeminiStateDetail(state, job),
          results: partialResults,
          ...(progress ? { progress } : {})
        };
      }
    } catch (partialError) {
      console.warn('[gemini] partial batch extract skipped:', partialError);
    }
  }

  return {
    jobId,
    state,
    stateLabel: getStateLabel(state),
    stateDetail: buildGeminiStateDetail(state, job),
    ...(progress ? { progress } : {})
  };
}
