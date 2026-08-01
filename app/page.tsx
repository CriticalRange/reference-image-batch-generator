'use client';

import '@/lib/i18n';
import { get, set } from 'idb-keyval';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import Lightbox, { type Slide } from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import {
  CURATED_MODEL_OPTIONS,
  humanizeModelCode,
  inferModelGroup,
  mergeModelOptions,
  modelLooksImageCapable,
  modelSupportsImageSize,
  modelSupportsTogetherSteps,
  isTogetherImageModelCode,
  normalizeModelCode,
  sortModelOptions,
  type UiModelOption
} from '@/lib/modelOptions';
import { InfoHint, Tooltip } from '@/app/components/tooltip';
import {
  BODY_COLOR_VALUES,
  DOOR_COLOR_VALUES,
  finalizeAnalysis,
  PRODUCT_TYPE_VALUES,
  productTypeLabel,
  type BodyColorOption,
  type DoorColorOption,
  type ProductTypeOption,
  type ReferenceAnalysis,
  type ReferenceAnalysisDraft
} from '@/lib/referenceAnalysis';

type GenerationResult = {
  promptVariant: string;
  imageBase64?: string;
  blobUrl?: string;
  mimeType: string;
};

type GenerationFailure = {
  promptVariant: string;
  error: string;
};

type BatchSubmitResponse = {
  jobId: string;
  provider: 'gemini' | 'together' | 'fal' | 'vertex';
  // Present for synchronous providers (Together/fal.ai/vertex) — results are computed during submit.
  results?: {
    usedModel: string;
    requestedCount: number;
    succeededCount: number;
    failedCount: number;
    results: GenerationResult[];
    failures: GenerationFailure[];
  };
};

type BatchProgressStats = {
  requestCount: number;
  successfulCount: number;
  failedCount: number;
  pendingCount: number;
};

/** Live Gemini Batch job fields used for per-card status badges. */
type BatchJobUiStatus = {
  state: string;
  stateLabel: string;
  stateDetail?: string;
  progress?: BatchProgressStats;
  /** Once true for this product job, UI never regresses empty cards back to "queued". */
  hasEnteredRunning?: boolean;
};

type PendingCardPhase = 'queued' | 'running' | 'waiting' | 'done' | 'retrying';

type BatchStatusResponse = {
  jobId: string;
  state: string;
  stateLabel: string;
  stateDetail?: string;
  error?: string;
  /** Gemini Developer Batch API request-level stats (when available). */
  progress?: BatchProgressStats;
  results?: {
    usedModel: string;
    requestedCount: number;
    succeededCount: number;
    failedCount: number;
    results: GenerationResult[];
    failures: GenerationFailure[];
  };
};

type ReferenceImage = {
  id: string;
  base64: string;
  mimeType: string;
  previewDataUrl: string;
  fileName: string;
};

type BatchRunResult = {
  refIndex: number;
  refPreviewDataUrl: string;
  refFileName?: string;
  items: HistoryItem[];
};

type BatchQueueItem = {
  ref: ReferenceImage;
  refIndex: number;
  attempt: number;
};

/** Loading-card slots for the full generate submit (all refs × variants). */
type PendingHistorySlot = {
  id: string;
  /** Which product photo this slot belongs to. */
  refIndex: number;
  /** 0-based variant index within that product. */
  variantIndex: number;
  item: HistoryItem | null;
};

type RefAnalysisState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  analysis?: ReferenceAnalysis;
  error?: string;
};

type GenerationConfigSnapshot = {
  basePrompt: string;
  negativePrompt?: string;
  model: string;
  aspectRatio: string;
  steps?: number;
  imageSize?: string;
  resizePreset?: ResizePresetOption;
  resizeWidth?: number;
  resizeHeight?: number;
  aiUpscale?: number;
  requestedCount: number;
  /**
   * Reference metadata only in history/IDB — never store base64 here (quota).
   * base64 may exist only in ephemeral in-memory configs before strip.
   */
  referenceImages?: Array<{
    base64?: string;
    mimeType: string;
    fileName?: string;
  }>;
};

type HistoryItem = {
  id: string;
  createdAt: string;
  isNew: boolean;
  promptVariant: string;
  mimeType: string;
  imageBlob: Blob;
  imageUrl: string;
  /** One batch submit (even with a single product photo) shares this id. */
  collectionId?: string;
  generationConfig?: GenerationConfigSnapshot;
  /** Gemini Flash product analysis used for this image (persisted in history state). */
  referenceAnalysis?: ReferenceAnalysis;
};

/** Which analysis modal target is open. */
type AnalysisModalTarget =
  | { kind: 'ref'; refIndex: number }
  | { kind: 'history'; itemId: string };

type HistoryCollection = {
  id: string;
  createdAt: string;
  items: HistoryItem[];
  isNew: boolean;
  coverUrl: string;
  productCount: number;
};

type HistoryStorageItem = Omit<HistoryItem, 'imageUrl'>;

type ArchiveItem = HistoryItem & {
  archivedAt: string;
};

type ArchiveStorageItem = Omit<ArchiveItem, 'imageUrl'>;

type ThemeMode = 'light' | 'dark';
type AuthModeOption = 'service_account' | 'api_key' | 'vertex_express';
type RenderModeOption = 'batch' | 'single';
type AspectRatioOption = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
type ResolutionOption =  | '512'
  | '1K'
  | '2K'
  | '4K'
  | '1024x1024'
  | '1248x832'
  | '832x1248'
  | '1184x864'
  | '864x1184'
  | '896x1152'
  | '1152x896'
  | '768x1344'
  | '1344x768'
  | '1536x672';
type ResizePresetOption = 'none' | '2000x3000' | '1536x2048' | '1696x2528' | '2048x2048' | 'custom';
type PlexiglassOption = 'none' | 'gold-mirror' | 'silver-mirror';
type MountingOption = 'floor-standing' | 'wall-mounted';
type HandlePresenceOption = 'with-handle' | 'no-handle';
type RoomStyleOption = 'minimalist' | 'modern' | 'classic' | 'industrial';
type AccentColorOption = 'warm-beige' | 'soft-olive' | 'muted-terracotta' | 'slate-blue' | 'champagne-gold' | 'charcoal-grey';

const DEFAULT_COUNT = 1;
const DEFAULT_BATCH_RATE_LIMIT_SEC = 120;
/** attempt 0 + N retries = N+1 total tries per product (one queue item per reference) */
const MAX_BATCH_REFERENCE_RETRIES = 4;
const BATCH_RETRY_BASE_DELAY_MS = 8_000;
const MAX_BATCH_RATE_LIMIT_SEC = 600;
/** Interactive /api/generate POST can hang on provider — fail instead of infinite spinner. */
const MAX_GENERATE_REQUEST_MS = 15 * 60 * 1000;
/** Async batch poll wall-clock limit (Gemini queue can be long; still not forever). */
const MAX_BATCH_POLL_MS = 50 * 60 * 1000;
/** After job reports completed but dest is empty ("Waiting for results…"). */
const MAX_WAITING_RESULTS_MS = 12 * 60 * 1000;
const MAX_ANALYZE_REQUEST_MS = 3 * 60 * 1000;
const MAX_HISTORY_ITEMS = 120;
const MIN_RESIZE_DIMENSION = 64;
const MAX_RESIZE_DIMENSION = 8192;
const DEFAULT_CUSTOM_RESIZE_WIDTH = 2000;
const DEFAULT_CUSTOM_RESIZE_HEIGHT = 3000;
const DEFAULT_TOGETHER_STEPS = 28;
const MAX_REFERENCE_FILE_BYTES = 8 * 1024 * 1024;
const HISTORY_STORAGE_KEY = 'reference-batch-history-v1';
const ARCHIVE_STORAGE_KEY = 'reference-batch-archive-v1';
const ARCHIVE_TTL_DAYS = 15;
const THEME_STORAGE_KEY = 'reference-batch-theme-v1';
const LANGUAGE_STORAGE_KEY = 'reference-batch-language-v1';
const AUTH_MODE_STORAGE_KEY = 'reference-batch-auth-mode-v1';
const RENDER_MODE_STORAGE_KEY = 'reference-batch-render-mode-v1';
const BATCH_RATE_LIMIT_STORAGE_KEY = 'reference-batch-ratelimit-v1';
const LAST_PROMPT_STORAGE_KEY = 'reference-batch-last-prompt-v1';
const AUTO_AI_ANALYSIS_STORAGE_KEY = 'reference-batch-auto-ai-analysis-v1';
const DEFAULT_MODEL = 'vertex/gemini-2.5-flash-image';
const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const RESOLUTION_OPTIONS: ResolutionOption[] = ['512', '1K', '2K', '4K'];
const TOGETHER_RESOLUTION_OPTIONS: ResolutionOption[] = [
  '1024x1024',
  '1248x832',
  '832x1248',
  '1184x864',
  '864x1184',
  '896x1152',
  '1152x896',
  '768x1344',
  '1344x768',
  '1536x672'
];
const ALL_RESOLUTION_OPTIONS: ResolutionOption[] = [...RESOLUTION_OPTIONS, ...TOGETHER_RESOLUTION_OPTIONS];
const RESIZE_PRESET_OPTIONS: Array<Exclude<ResizePresetOption, 'custom'>> = ['none', '2000x3000', '1536x2048', '1696x2528', '2048x2048'];
const BODY_COLOR_OPTIONS: BodyColorOption[] = [...BODY_COLOR_VALUES];
const DOOR_COLOR_OPTIONS: DoorColorOption[] = [...DOOR_COLOR_VALUES];
const PLEXIGLASS_OPTIONS: PlexiglassOption[] = ['none', 'gold-mirror', 'silver-mirror'];
const MOUNTING_OPTIONS: MountingOption[] = ['floor-standing', 'wall-mounted'];
const HANDLE_PRESENCE_OPTIONS: HandlePresenceOption[] = ['with-handle', 'no-handle'];
const ROOM_STYLE_OPTIONS: RoomStyleOption[] = ['minimalist', 'modern', 'classic', 'industrial'];
const ACCENT_COLOR_OPTIONS: AccentColorOption[] = [
  'warm-beige',
  'soft-olive',
  'muted-terracotta',
  'slate-blue',
  'champagne-gold',
  'charcoal-grey'
];
const DEFAULT_HANDLE_DESCRIPTION =
  'Match the handle design, scale, finish and mounting position exactly as shown in the product reference.';
const ALLOWED_REFERENCE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const BATCH_PROMPT_PRESETS = [
  {
    label: 'GELİŞMİŞ YERLEŞTİR',
    // Full preset text — do not shorten. Paste/edit the complete prompt between the backticks.
    prompt: `1. Camera & Composition
Full Frame camera simulation.
Focal Length: 38–50 mm (ideal: 42 mm).
Camera height: 145–155 cm from the floor (human eye level).
Perfectly vertical architectural lines using perspective correction.
Balanced Rule of Thirds composition.
Strong foreground, midground and background depth.
Leave intentional negative space (especially in front of rugs and seating areas).
Avoid wide-angle distortion.
Slight cinematic depth while maintaining full product visibility.
Furniture should never touch frame edges unless intentionally cropped.
2. Commercial Lighting (Wayfair Style)
Use physically correct lighting only.
Natural Light
Large diffused window light
Soft overcast daylight
5500K–6500K color temperature
No harsh sunlight
No clipped highlights
Artificial Lighting
Warm practical lights
2700K–3000K
Lamps should emit realistic light intensity
Warm/cool balance must feel natural
Three Point Lighting
Key Light
Large soft source
Defines furniture
Fill Light
25–35% intensity
Preserves natural shadows
Back Light
Very subtle
Creates object separation
Indirect Lighting
Enable:
Multiple GI Bounces
Color Bleeding
Ambient Occlusion
Contact Shadows
Soft Shadow Penumbra
Lighting should feel invisible—not staged.
3. Ultra Realistic PBR Materials

Every material must include:

Albedo
Roughness
Normal
Height / Displacement
Ambient Occlusion
Metalness (when applicable)

No procedural plastic-looking materials.

Wood

Visible grain direction

Micro scratches

Slight gloss variation

Natural edge wear

Fabric

Visible weave

Fiber depth

Compression wrinkles

Subtle fuzz

Leather

Natural pores

Fine wrinkles

Uneven sheen

Soft edge wear

Metal

Micro brushing

Fine oxidation variation

Tiny imperfections

Real Fresnel reflections

Glass

Correct IOR (≈1.52)

Subtle dust

Real reflections

No perfectly invisible glass

Stone & Marble

Natural veins

Depth variation

Micro roughness

Real edge bevels

4. Styling (Wayfair Editorial)

Every room should feel professionally styled.

Use layered decoration:

Natural plants

Books

Ceramics

Art

Candles

Wood accents

Throw blankets

Decorative pillows

Coffee table books

Small trays

Vases

Baskets

Textured rugs

Curtains with realistic folds

Nothing should appear randomly placed.

Objects should create visual rhythm.

5. Color Palette

Premium neutral palette.

Recommended ratio:

70% neutral

20% secondary tones

10% accent color

Avoid oversaturated colors.

Maintain soft editorial color grading.

6. Micro Details

Realism comes from imperfections.

Include:

Tiny fabric wrinkles

Slight pillow deformation

Natural blanket folds

Book height variation

Leaf orientation differences

Wood color variation

Tiny edge imperfections

Microscopic dust

Very subtle fingerprints

Natural wear

Nothing should look factory perfect.

7. Rendering Quality

Use Path Tracing.

Ultra settings.

Recommended:

2048–4096 Samples

Adaptive Sampling

Multiple Importance Sampling

High Quality Caustics

High Bounce GI

Noise Threshold below 0.005

Minimal AI Denoising
No visible fireflies.
No rendering noise.
8. Color Management
ACES Filmic
16-bit workflow
Natural white balance
Highlight recovery
Soft contrast
Gentle shadow rolloff
No crushed blacks
No clipped whites
Preserve HDR dynamic range.
9. Post Processing
Very subtle only.
Bloom:
Minimal
Sharpen:
Low
Vignette:
2–4%
Chromatic Aberration:
Disabled
Lens Distortion:
Very subtle
No exaggerated cinematic effects.
Image must resemble a professional commercial photograph.
10. Quality Control Checklist
Before final render verify:
✓ Correct real-world scale
✓ Accurate proportions
✓ Natural lighting
✓ Physically correct reflections
✓ No texture stretching
✓ High-resolution textures (4K–8K where appropriate)
✓ Correct UV mapping
✓ Soft realistic shadows
✓ No floating objects
✓ No clipping geometry
✓ Clean topology
✓ Perfect anti-aliasing
✓ Consistent material response
✓ Professional editorial styling
✓ Balanced composition
✓ Premium commercial appearance`
  },
  {
    label: 'TURKEY',
    prompt:
      'Analyze the furniture, determine its type and style. Select the most common room in Turkey where this furniture is typically used. Place the product in that environment at a realistic scale. Add a few compatible decorative objects that are commonly used on this type of furniture in Turkey. The environment should feel clean, spacious, and modern, reflecting a contemporary Turkish home atmosphere. The product must remain the main focal point. Create a clean, photorealistic, and sales-oriented scene suitable for e-commerce. Do NOT modify the furniture in any way. The design, color, proportions, and details must remain exactly the same. Only create the background and surrounding environment.'
  },
  {
    label: 'GREEK ISLANDS',
    prompt: buildRegionalProductScenePrompt(
    'the Greek Islands',
    'an airy Aegean island home with whitewashed walls, soft sunlight, pale stone, and sea-breeze freshness',
    'the most natural Greek island room setting for this furniture',
    'subtle ceramic objects, linen textures, and restrained blue accents'
    )
  },
  {
    label: 'MEDITERRANEAN',
    prompt: buildRegionalProductScenePrompt(
    'the Mediterranean coast',
    'a warm Mediterranean interior with natural plaster, travertine tones, woven textures, and relaxed coastal brightness',
    'a bright coastal room where this furniture would realistically be used',
    'olive branches, ceramic vases, light books, and minimal woven decor'
    )
  },
  {
    label: 'GERMANY',
    prompt: buildRegionalProductScenePrompt(
    'Germany',
    'a refined German contemporary home with precise lines, high-quality materials, balanced symmetry, and understated warmth',
    'the most practical modern German room for this furniture',
    'neat functional decor, sculptural lighting, books, and subtle metal accents'
    )
  },
  {
    label: 'SCANDINAVIA',
    prompt: buildRegionalProductScenePrompt(
    'Scandinavia',
    'a calm Scandinavian room with pale wood, soft daylight, wool textures, and uncluttered functional styling',
    'a Nordic living space where this furniture feels natural and useful',
    'simple ceramics, neutral books, a small plant, and tactile textile accents'
    )
  },
  {
    label: 'ITALY',
    prompt: buildRegionalProductScenePrompt(
    'Italy',
    'a polished Italian modern interior with elegant marble notes, warm neutral walls, curated art, and boutique showroom refinement',
    'a sophisticated Milan-inspired room suited to this furniture',
    'design books, a sculptural vase, and refined decorative objects'
    )
  },
  {
    label: 'FRANCE',
    prompt: buildRegionalProductScenePrompt(
    'France',
    'a modern Parisian apartment with soft moldings, warm oak flooring, quiet elegance, and balanced contemporary styling',
    'a refined French room where this furniture is typically placed',
    'a small art book stack, a glass vase, and delicate decorative accents'
    )
  },
  {
    label: 'SPAIN',
    prompt: buildRegionalProductScenePrompt(
    'Spain',
    'a sunlit Spanish home with limewashed walls, warm terracotta hints, natural wood, and relaxed Andalusian character',
    'a comfortable Spanish living area appropriate for this furniture',
    'ceramic bowls, subtle greenery, and warm handcrafted decor'
    )
  },
  {
    label: 'JAPAN',
    prompt: buildRegionalProductScenePrompt(
    'Japan',
    'a quiet Japanese contemporary room with wabi-sabi restraint, natural textures, soft shadows, and precise negative space',
    'a serene Japanese room where the furniture can remain the focal point',
    'one ceramic vessel, a small branch arrangement, and minimal organic decor'
    )
  },
  {
    label: 'UK',
    prompt: buildRegionalProductScenePrompt(
    'the United Kingdom',
    'a tasteful London townhouse interior with warm neutrals, classic details, contemporary lighting, and composed styling',
    'an elegant British room where this furniture fits naturally',
    'coffee-table books, a framed artwork, and refined small accessories'
    )
  },
  {
    label: 'NETHERLANDS',
    prompt: buildRegionalProductScenePrompt(
    'the Netherlands',
    'a bright Dutch canal-house inspired interior with tall-window daylight, pale walls, clean wood floors, and practical modern styling',
    'a compact but spacious-feeling Dutch room for this furniture',
    'simple glassware, design books, and restrained greenery'
    )
  },
  {
    label: 'CALIFORNIA',
    prompt: buildRegionalProductScenePrompt(
    'California',
    'a clean California coastal home with soft natural light, sandy neutrals, casual luxury, and an open airy feeling',
    'a modern coastal room where this furniture can be used realistically',
    'light ceramics, neutral books, linen textures, and small organic decor'
    )
  },
  {
    label: 'SWITZERLAND',
    prompt: buildRegionalProductScenePrompt(
    'Switzerland',
    'a premium Swiss modern interior with alpine calm, precise craftsmanship, stone details, and warm minimal luxury',
    'a refined Swiss room that suits the furniture type',
    'a sculptural lamp, orderly books, and subtle natural stone accessories'
    )
  },
  {
    label: 'MOROCCO',
    prompt: buildRegionalProductScenePrompt(
    'Morocco',
    'a clean Moroccan-Mediterranean interior with soft arches, warm plaster, zellige-inspired texture, and modern restraint',
    'a bright room where Moroccan character supports the product without overpowering it',
    'handmade ceramics, a small brass object, and muted woven accents'
    )
  },
  {
    label: 'DUBAI',
    prompt: buildRegionalProductScenePrompt(
    'Dubai',
    'a contemporary Dubai apartment with polished stone, warm indirect lighting, premium finishes, and spacious luxury',
    'a modern upscale room where this furniture is typically showcased',
    'minimal metallic decor, designer books, and a refined sculptural object'
    )
  }
];
const BATCH_PROMPT_ROTATION = BATCH_PROMPT_PRESETS.map((preset) => preset.prompt);
const TURKEY_PROMPT = BATCH_PROMPT_ROTATION[0];
const INITIAL_MODEL_OPTIONS = sortModelOptions(
  mergeModelOptions(CURATED_MODEL_OPTIONS, [
    {
      code: DEFAULT_MODEL,
      name: humanizeModelCode(DEFAULT_MODEL),
      group: inferModelGroup(DEFAULT_MODEL)
    }
  ])
);

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [selectedBodyColor, setSelectedBodyColor] = useState<BodyColorOption | ''>('');
  const [selectedDoorColor, setSelectedDoorColor] = useState<DoorColorOption | ''>('');
  const [selectedPlexiglass, setSelectedPlexiglass] = useState<PlexiglassOption>('none');
  const [selectedMounting, setSelectedMounting] = useState<MountingOption>('floor-standing');
  const [selectedHandlePresence, setSelectedHandlePresence] = useState<HandlePresenceOption>('with-handle');
  const [selectedRoomStyle, setSelectedRoomStyle] = useState<RoomStyleOption>('minimalist');
  const [selectedAccentColor, setSelectedAccentColor] = useState<AccentColorOption>('warm-beige');
  const [handleDescription, setHandleDescription] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [countInput, setCountInput] = useState(String(DEFAULT_COUNT));
  const [resizeWidthInput, setResizeWidthInput] = useState(String(DEFAULT_CUSTOM_RESIZE_WIDTH));
  const [resizeHeightInput, setResizeHeightInput] = useState(String(DEFAULT_CUSTOM_RESIZE_HEIGHT));
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [failures, setFailures] = useState<GenerationFailure[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [pendingSlots, setPendingSlots] = useState<PendingHistorySlot[]>([]);
  /** Product photo currently being generated (drives "Sırada" vs "Üretiliyor" on cards). */
  const [activePendingRefIndex, setActivePendingRefIndex] = useState(0);
  /** Per-reference Gemini Flash analysis for the active generate run. */
  const [refAnalyses, setRefAnalyses] = useState<Record<number, RefAnalysisState>>({});
  const refAnalysesRef = useRef<Record<number, RefAnalysisState>>({});
  /** Modal: loading-card ref analysis or history-item analysis. */
  const [analysisModalTarget, setAnalysisModalTarget] = useState<AnalysisModalTarget | null>(null);
  const [analysisModalDraft, setAnalysisModalDraft] = useState<ReferenceAnalysis | null>(null);
  /** Lightbox override so partial pending cards can be opened before history commit. */
  const [viewerOverrideItems, setViewerOverrideItems] = useState<HistoryItem[] | null>(null);
  const [isHistoryHydrated, setIsHistoryHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [generationElapsedSec, setGenerationElapsedSec] = useState(0);
  const generationStartedAtRef = useRef<number | null>(null);
  /** Abort in-flight generate run (fetch + queue loops). */
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationCancelledRef = useRef(false);
  const activeCollectionIdRef = useRef<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [language, setLanguage] = useState<'tr' | 'en'>('tr');
  const [isReferenceDragOver, setIsReferenceDragOver] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('2:3');
  const [steps, setSteps] = useState(DEFAULT_TOGETHER_STEPS);
  const [imageSize, setImageSize] = useState<ResolutionOption>('1K');
  const [resizePreset, setResizePreset] = useState<ResizePresetOption>('2000x3000');
  const [customResizeWidth, setCustomResizeWidth] = useState(DEFAULT_CUSTOM_RESIZE_WIDTH);
  const [customResizeHeight, setCustomResizeHeight] = useState(DEFAULT_CUSTOM_RESIZE_HEIGHT);
  const [aiUpscale, setAiUpscale] = useState(0);
  /** When on, Gemini Flash analyzes each reference on generate and builds product prompts. */
  const [autoAiAnalysis, setAutoAiAnalysis] = useState(true);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [authMode, setAuthMode] = useState<AuthModeOption>('api_key');
  /** batch = toplu (async, cheaper); single = tekli (interactive, faster). */
  const [renderMode, setRenderMode] = useState<RenderModeOption>('single');
  const [modelOptions, setModelOptions] = useState<UiModelOption[]>(INITIAL_MODEL_OPTIONS);
  const [activeTab, setActiveTab] = useState<'generator' | 'history'>('generator');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([]);
  const [isArchiveHydrated, setIsArchiveHydrated] = useState(false);
  const [isArchiveSectionOpen, setIsArchiveSectionOpen] = useState(false);
  const [isHistoryViewerOpen, setIsHistoryViewerOpen] = useState(false);
  const [historyViewerIndex, setHistoryViewerIndex] = useState(0);
  /** When set, lightbox only shows items from this collection (batch run). */
  const [viewerCollectionId, setViewerCollectionId] = useState<string | null>(null);
  const [isViewerPromptCollapsed, setIsViewerPromptCollapsed] = useState(false);
  const [batchRateLimitSec, setBatchRateLimitSec] = useState(DEFAULT_BATCH_RATE_LIMIT_SEC);
  const [batchRateLimitInput, setBatchRateLimitInput] = useState(String(DEFAULT_BATCH_RATE_LIMIT_SEC));
  const [batchRunResults, setBatchRunResults] = useState<BatchRunResult[]>([]);
  const [batchTotalRefs, setBatchTotalRefs] = useState(0);
  /** Variants requested per reference for the active run (drives progress total). */
  const [batchCountPerRef, setBatchCountPerRef] = useState(1);
  /** Live stats for the in-flight async batch job (Gemini Developer Batch API). */
  const [batchInFlightProgress, setBatchInFlightProgress] = useState<BatchProgressStats | null>(null);
  /** Full job state/detail for the status strip above pending cards. */
  const [batchJobUiStatus, setBatchJobUiStatus] = useState<BatchJobUiStatus | null>(null);
  const historyObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const archiveObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const hasPromptHydratedRef = useRef(false);
  const lastBatchRunTimeRef = useRef<number>(0);
  const batchRunResultsRef = useRef<BatchRunResult[]>([]);
  /** All history items produced by the active generate submit (one collection). */
  const batchHistoryItemsRef = useRef<HistoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const negativePromptTextareaRef = useRef<HTMLTextAreaElement>(null);
  /** Avoid double-showing images that are still in the live pending grid. */
  const pendingFilledIds = useMemo(
    () => new Set(pendingSlots.map((slot) => slot.item?.id).filter((id): id is string => Boolean(id))),
    [pendingSlots]
  );
  const historyItemsForGrid = useMemo(
    () =>
      pendingFilledIds.size > 0
        ? historyItems.filter((item) => !pendingFilledIds.has(item.id))
        : historyItems,
    [historyItems, pendingFilledIds]
  );
  const historyCollections = useMemo(
    () => groupHistoryCollections(historyItemsForGrid),
    [historyItemsForGrid]
  );
  /** Album-style collections only when a batch produced 2+ images. */
  const multiCollections = useMemo(
    () => historyCollections.filter((collection) => collection.items.length > 1),
    [historyCollections]
  );
  const historyGroups = useMemo(
    () => groupCollectionsByDate(historyCollections, language),
    [historyCollections, language]
  );
  const modelGroups = useMemo(() => groupModelOptions(modelOptions), [modelOptions]);
  const selectedModelIsTogether = useMemo(() => isTogetherImageModelCode(selectedModel), [selectedModel]);
  /** Negative prompt is only wired for Together AI image models — Gemini ignores it. */
  const supportsNegativePrompt = selectedModelIsTogether;
  const supportsTogetherSteps = useMemo(() => modelSupportsTogetherSteps(selectedModel), [selectedModel]);
  const supportsResolutionSelector = useMemo(
    () => modelSupportsImageSize(selectedModel) || selectedModelIsTogether,
    [selectedModel, selectedModelIsTogether]
  );
  const availableResolutionOptions = useMemo<ResolutionOption[]>(
    () => (selectedModelIsTogether ? TOGETHER_RESOLUTION_OPTIONS : RESOLUTION_OPTIONS),
    [selectedModelIsTogether]
  );
  const selectedModelLooksImageCapable = useMemo(() => modelLooksImageCapable(selectedModel), [selectedModel]);
  const resolvedResize = useMemo(() => {
    if (resizePreset === 'none') {
      return undefined;
    }

    if (resizePreset === 'custom') {
      return {
        width: clampResizeDimension(customResizeWidth),
        height: clampResizeDimension(customResizeHeight)
      };
    }

    return parseResizeDimensionsFromPreset(resizePreset);
  }, [customResizeHeight, customResizeWidth, resizePreset]);
  const viewerItems = useMemo(() => {
    if (viewerOverrideItems && viewerOverrideItems.length > 0) {
      return viewerOverrideItems;
    }
    if (!viewerCollectionId) {
      return historyItems;
    }
    return historyItems.filter((item) => resolveCollectionId(item) === viewerCollectionId);
  }, [historyItems, viewerCollectionId, viewerOverrideItems]);
  const historySlides = useMemo<Slide[]>(
    () =>
      viewerItems.map((item, index) => ({
        src: item.imageUrl,
        alt: t('historySlideAlt', { index: index + 1 })
      })),
    [viewerItems, t]
  );
  const activeHistoryItem = viewerItems[historyViewerIndex];
  const newHistoryCount = useMemo(() => historyItems.filter((item) => item.isNew).length, [historyItems]);

  const generationTotal = useMemo(() => {
    const refs = Math.max(1, batchTotalRefs || referenceImages.length || 1);
    const perRef = Math.max(1, batchCountPerRef || 1);
    return refs * perRef;
  }, [batchTotalRefs, batchCountPerRef, referenceImages.length]);

  const generationCurrent = useMemo(() => {
    if (!isLoading) return 0;
    const perRef = Math.max(1, batchCountPerRef || 1);
    // Finished reference jobs contribute their full variant count.
    const base = batchRunResults.length * perRef;

    // While an async Gemini batch job is open, fold in request-level stats.
    if (batchInFlightProgress) {
      const doneInJob =
        batchInFlightProgress.successfulCount + batchInFlightProgress.failedCount;
      const jobTotal = Math.max(batchInFlightProgress.requestCount, perRef);
      if (doneInJob >= jobTotal) {
        return Math.min(base + jobTotal, generationTotal);
      }
      // "Working on" the next unfinished request (same pattern as pre-stats UI).
      return Math.min(Math.max(1, base + doneInJob + 1), generationTotal);
    }

    return Math.min(Math.max(1, base + 1), generationTotal);
  }, [isLoading, batchCountPerRef, batchRunResults.length, batchInFlightProgress, generationTotal]);

  const progressStatusText = useMemo(() => {
    if (!isLoading) return '';
    const current = generationCurrent;
    const total = generationTotal;
    const seconds = generationElapsedSec;
    const translated = t('generatingProgress', { current, total, seconds });
    // Guard against missing i18n key (stale HMR / cold bundle) showing the raw key name.
    let base =
      !translated || translated === 'generatingProgress'
        ? language === 'en'
          ? `generating ${current} / ${total}  ${seconds}s`
          : `üretiliyor ${current} / ${total}  ${seconds}s`
        : translated;

    // Surface live job phase so long single-mode POSTs / batch queues don't look frozen.
    const phaseLabel = batchJobUiStatus?.stateLabel?.trim();
    if (phaseLabel && !base.toLowerCase().includes(phaseLabel.toLowerCase())) {
      base = `${base} · ${phaseLabel}`;
    }
    const detail = batchJobUiStatus?.stateDetail?.trim();
    if (detail && detail.length <= 80) {
      base = `${base} · ${detail}`;
    }
    return base;
  }, [
    isLoading,
    generationCurrent,
    generationTotal,
    generationElapsedSec,
    language,
    t,
    batchJobUiStatus?.stateLabel,
    batchJobUiStatus?.stateDetail
  ]);

  /**
   * Shared batch phase for pending cards.
   * Once a job has been seen as running, never flash back to "queued" if Gemini
   * briefly reports PENDING/PAUSED mid-job (common during long batches).
   */
  const pendingBatchPhase = useMemo<PendingCardPhase>(() => {
    if (!isLoading || pendingSlots.length === 0) {
      return 'running';
    }

    const state = (batchJobUiStatus?.state ?? 'pending').toLowerCase();
    const stateLabel = batchJobUiStatus?.stateLabel?.toLowerCase() ?? '';
    const hasEverRun = Boolean(batchJobUiStatus?.hasEnteredRunning);

    if (state === 'retrying') {
      return 'retrying';
    }
    if (stateLabel.includes('waiting for results') || stateLabel.includes('waiting')) {
      return 'waiting';
    }
    if (state === 'succeeded') {
      return 'done';
    }
    if (state === 'running') {
      return 'running';
    }
    if (state === 'pending' || state === 'queued') {
      // Sticky: after first RUNNING poll, keep showing "Generating" not "In queue".
      return hasEverRun ? 'running' : 'queued';
    }
    if (!batchJobUiStatus) {
      return 'running';
    }
    return hasEverRun ? 'running' : 'queued';
  }, [isLoading, pendingSlots.length, batchJobUiStatus]);

  /**
   * Per-card badge phase across the full multi-ref grid.
   * - Future product photos → "Sırada" (especially meaningful in tekli mode)
   * - Active product photo → job phase (üretiliyor / sırada / yeniden deneniyor)
   * - Filled slots → tamamlandı
   */
  function getPendingCardStatus(slot: PendingHistorySlot, globalIndex: number): {
    phase: PendingCardPhase;
    badge: string;
    meta: string;
  } {
    const progress = batchJobUiStatus?.progress ?? batchInFlightProgress;
    const hasItem = Boolean(slot.item);

    let phase: PendingCardPhase;
    if (hasItem) {
      phase = 'done';
    } else if (slot.refIndex > activePendingRefIndex) {
      // Not started yet — waiting for earlier product jobs to finish.
      phase = 'queued';
    } else if (slot.refIndex < activePendingRefIndex) {
      // Earlier product should already be filled; if empty, treat as waiting/retry gap.
      phase = 'waiting';
    } else if (pendingBatchPhase === 'queued') {
      phase = 'queued';
    } else if (pendingBatchPhase === 'retrying') {
      phase = 'retrying';
    } else if (pendingBatchPhase === 'waiting') {
      phase = 'waiting';
    } else if (pendingBatchPhase === 'done') {
      phase = 'waiting';
    } else {
      // Active product job is running — variants for this ref are in flight.
      phase = 'running';
      if (
        progress &&
        progress.requestCount > 0 &&
        progress.pendingCount === 0 &&
        progress.successfulCount + progress.failedCount >= progress.requestCount
      ) {
        phase = 'waiting';
      }
    }

    const badgeKey =
      phase === 'queued'
        ? 'batchStatusQueued'
        : phase === 'retrying'
          ? 'batchStatusRetrying'
          : phase === 'waiting'
            ? 'batchStatusWaitingResults'
            : phase === 'done'
              ? 'batchStatusCompleted'
              : 'batchStatusProcessing';

    return {
      phase,
      badge: t(badgeKey),
      meta: `#${globalIndex + 1}`
    };
  }

  useEffect(() => {
    if (!isLoading) {
      generationStartedAtRef.current = null;
      setGenerationElapsedSec(0);
      return;
    }
    if (generationStartedAtRef.current === null) {
      generationStartedAtRef.current = Date.now();
      setGenerationElapsedSec(0);
    }
    const tick = () => {
      const started = generationStartedAtRef.current ?? Date.now();
      setGenerationElapsedSec(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  const countError = useMemo<string | null>(() => {
    const n = Number.parseInt(countInput, 10);
    if (!Number.isFinite(n)) return t('errorInvalidNumber');
    if (n < 1) return t('errorCountMin');
    if (n > 10) return t('errorCountMax');
    return null;
  }, [countInput, t]);

  const resizeWidthError = useMemo<string | null>(() => {
    if (resizePreset !== 'custom') return null;
    const n = Number.parseInt(resizeWidthInput, 10);
    if (!Number.isFinite(n)) return t('errorInvalidNumber');
    if (n < MIN_RESIZE_DIMENSION) return t('errorResizeTooSmall', { min: MIN_RESIZE_DIMENSION });
    if (n > MAX_RESIZE_DIMENSION) return t('errorResizeTooBig', { max: MAX_RESIZE_DIMENSION });
    return null;
  }, [resizePreset, resizeWidthInput, t]);

  const resizeHeightError = useMemo<string | null>(() => {
    if (resizePreset !== 'custom') return null;
    const n = Number.parseInt(resizeHeightInput, 10);
    if (!Number.isFinite(n)) return t('errorInvalidNumber');
    if (n < MIN_RESIZE_DIMENSION) return t('errorResizeTooSmall', { min: MIN_RESIZE_DIMENSION });
    if (n > MAX_RESIZE_DIMENSION) return t('errorResizeTooBig', { max: MAX_RESIZE_DIMENSION });
    return null;
  }, [resizePreset, resizeHeightInput, t]);

  const batchRateLimitError = useMemo<string | null>(() => {
    const n = Number.parseInt(batchRateLimitInput, 10);
    if (!Number.isFinite(n)) return t('errorInvalidNumber');
    if (n < 0) return t('errorRateLimitMin');
    if (n > MAX_BATCH_RATE_LIMIT_SEC) return t('errorRateLimitMax');
    return null;
  }, [batchRateLimitInput, t]);

  const canSubmit = useMemo(() => {
    // Base prompt is optional — per-reference Flash analysis builds the catalogue prompt.
    return (
      referenceImages.length > 0 &&
      !isLoading &&
      !countError &&
      !resizeWidthError &&
      !resizeHeightError &&
      !batchRateLimitError
    );
  }, [referenceImages.length, isLoading, countError, resizeWidthError, resizeHeightError, batchRateLimitError]);

  useEffect(() => {
    // Selecting product options overwrites the base prompt with the commercial catalogue template.
    if (!selectedBodyColor || !selectedDoorColor) {
      return;
    }

    setPrompt(
      buildCommercialCataloguePrompt({
        bodyColor: selectedBodyColor,
        doorColor: selectedDoorColor,
        plexiglass: selectedPlexiglass,
        mounting: selectedMounting,
        handlePresence: selectedHandlePresence,
        handle: handleDescription.trim() || DEFAULT_HANDLE_DESCRIPTION,
        roomStyle: selectedRoomStyle,
        accentColor: selectedAccentColor
      })
    );
  }, [
    selectedBodyColor,
    selectedDoorColor,
    selectedPlexiglass,
    selectedMounting,
    selectedHandlePresence,
    selectedRoomStyle,
    selectedAccentColor,
    handleDescription
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedPrompt = window.localStorage.getItem(LAST_PROMPT_STORAGE_KEY);
    if (storedPrompt) {
      setPrompt(storedPrompt);
    }
    hasPromptHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasPromptHydratedRef.current) {
      return;
    }

    const nextPrompt = prompt.trim();
    if (nextPrompt) {
      window.localStorage.setItem(LAST_PROMPT_STORAGE_KEY, prompt);
    } else {
      window.localStorage.removeItem(LAST_PROMPT_STORAGE_KEY);
    }
  }, [prompt]);

  useEffect(() => {
    autoResizeTextarea(promptTextareaRef.current);
  }, [prompt]);

  useEffect(() => {
    autoResizeTextarea(negativePromptTextareaRef.current);
  }, [negativePrompt]);

  useEffect(() => {
    if (!availableResolutionOptions.includes(imageSize)) {
      setImageSize(availableResolutionOptions[0] ?? '1K');
    }
  }, [availableResolutionOptions, imageSize]);

  useEffect(() => {
    if (resizePreset === 'custom') {
      setResizeWidthInput(String(customResizeWidth));
      setResizeHeightInput(String(customResizeHeight));
    }
    // Only sync strings when the preset switch happens, not on every width/height change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizePreset]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateHistoryFromIndexedDb() {
      try {
        const persisted = await get<unknown>(HISTORY_STORAGE_KEY);
        if (cancelled) {
          return;
        }

        if (Array.isArray(persisted)) {
          const sanitized: HistoryItem[] = [];
          for (const entry of persisted) {
            if (sanitized.length >= MAX_HISTORY_ITEMS) {
              break;
            }

            const normalized = normalizePersistedHistoryItem(entry);
            if (normalized) {
              sanitized.push(normalized);
            }
          }

          if (cancelled) {
            for (const entry of sanitized) {
              URL.revokeObjectURL(entry.imageUrl);
            }
            return;
          }

          setHistoryItems(repairHistoryCollectionIds(sanitized));
        }
      } catch {
        toast.error(t('toastHistoryLoadFailed'), {
          description: t('toastHistoryLoadFailedDesc'),
          duration: 10_000
        });
      } finally {
        if (!cancelled) {
          setIsHistoryHydrated(true);
        }
      }
    }

    void hydrateHistoryFromIndexedDb();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!isHistoryHydrated) {
      return;
    }

    const payload: HistoryStorageItem[] = historyItems.map(toHistoryStorageItem);
    void set(HISTORY_STORAGE_KEY, payload).catch(() => {
      toast.error(t('toastHistorySaveFailed'), {
        description: t('toastHistorySaveFailedDesc'),
        duration: 10_000
      });
    });
  }, [historyItems, isHistoryHydrated, t]);

  useEffect(() => {
    const nextUrls = new Map(historyItems.map((item) => [item.id, item.imageUrl]));
    for (const [id, existingUrl] of historyObjectUrlsRef.current.entries()) {
      const nextUrl = nextUrls.get(id);
      if (!nextUrl || nextUrl !== existingUrl) {
        URL.revokeObjectURL(existingUrl);
      }
    }
    historyObjectUrlsRef.current = nextUrls;
  }, [historyItems]);

  useEffect(() => {
    return () => {
      for (const url of historyObjectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      historyObjectUrlsRef.current.clear();
    };
  }, []);

  // Archive: hydrate, purge expired, persist, and manage object URLs
  useEffect(() => {
    let cancelled = false;

    async function hydrateArchiveFromIndexedDb() {
      try {
        const persisted = await get<unknown>(ARCHIVE_STORAGE_KEY);
        if (cancelled) return;

        if (Array.isArray(persisted)) {
          const ttlMs = ARCHIVE_TTL_DAYS * 24 * 60 * 60 * 1000;
          const now = Date.now();
          const sanitized: ArchiveItem[] = [];
          for (const entry of persisted) {
            const normalized = normalizePersistedArchiveItem(entry);
            if (!normalized) continue;
            if (now - new Date(normalized.archivedAt).getTime() > ttlMs) continue;
            sanitized.push(normalized);
          }

          if (cancelled) {
            for (const entry of sanitized) URL.revokeObjectURL(entry.imageUrl);
            return;
          }

          setArchiveItems(sanitized);
        }
      } catch {
        // silently ignore archive load errors
      } finally {
        if (!cancelled) setIsArchiveHydrated(true);
      }
    }

    void hydrateArchiveFromIndexedDb();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isArchiveHydrated) return;
    const payload: ArchiveStorageItem[] = archiveItems.map(toArchiveStorageItem);
    void set(ARCHIVE_STORAGE_KEY, payload).catch(() => {});
  }, [archiveItems, isArchiveHydrated]);

  useEffect(() => {
    const nextUrls = new Map(archiveItems.map((item) => [item.id, item.imageUrl]));
    for (const [id, existingUrl] of archiveObjectUrlsRef.current.entries()) {
      const nextUrl = nextUrls.get(id);
      if (!nextUrl || nextUrl !== existingUrl) URL.revokeObjectURL(existingUrl);
    }
    archiveObjectUrlsRef.current = nextUrls;
  }, [archiveItems]);

  useEffect(() => {
    return () => {
      for (const url of archiveObjectUrlsRef.current.values()) URL.revokeObjectURL(url);
      archiveObjectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const nextLanguage = storedLanguage === 'en' || storedLanguage === 'tr' ? storedLanguage : 'tr';
    setLanguage(nextLanguage);
    void i18n.changeLanguage(nextLanguage);
  }, [i18n]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    void i18n.changeLanguage(language);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [i18n, language]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedAuthMode = window.localStorage.getItem(AUTH_MODE_STORAGE_KEY);
    if (
      storedAuthMode === 'service_account' ||
      storedAuthMode === 'api_key' ||
      storedAuthMode === 'vertex_express'
    ) {
      setAuthMode(storedAuthMode);
    }
    const storedRenderMode = window.localStorage.getItem(RENDER_MODE_STORAGE_KEY);
    if (storedRenderMode === 'batch' || storedRenderMode === 'single') {
      setRenderMode(storedRenderMode);
    }
    const storedLimit = window.localStorage.getItem(BATCH_RATE_LIMIT_STORAGE_KEY);
    if (storedLimit !== null) {
      const parsed = Number.parseInt(storedLimit, 10);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_BATCH_RATE_LIMIT_SEC) {
        setBatchRateLimitSec(parsed);
        setBatchRateLimitInput(String(parsed));
      }
    }
    const storedAutoAi = window.localStorage.getItem(AUTO_AI_ANALYSIS_STORAGE_KEY);
    if (storedAutoAi === '0' || storedAutoAi === 'false') {
      setAutoAiAnalysis(false);
    } else if (storedAutoAi === '1' || storedAutoAi === 'true') {
      setAutoAiAnalysis(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTH_MODE_STORAGE_KEY, authMode);
  }, [authMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(RENDER_MODE_STORAGE_KEY, renderMode);
  }, [renderMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BATCH_RATE_LIMIT_STORAGE_KEY, String(batchRateLimitSec));
  }, [batchRateLimitSec]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTO_AI_ANALYSIS_STORAGE_KEY, autoAiAnalysis ? '1' : '0');
  }, [autoAiAnalysis]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      setThemeMode(stored);
      return;
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setThemeMode(prefersDark ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateModelOptions() {
      try {
        const response = await fetch('/api/models', { cache: 'no-store' });
        const payload = (await response.json()) as { models?: unknown; defaultModel?: unknown };
        if (!response.ok || !Array.isArray(payload.models) || cancelled) {
          return;
        }

        const discovered = payload.models.filter(isUiModelOption).map((option) => ({
          code: normalizeModelCode(option.code),
          name: option.name,
          group: option.group
        }));
        if (discovered.length === 0) {
          return;
        }

        const merged = sortModelOptions(mergeModelOptions(INITIAL_MODEL_OPTIONS, discovered));
        const suggestedDefault =
          typeof payload.defaultModel === 'string' && payload.defaultModel.trim()
            ? normalizeModelCode(payload.defaultModel)
            : DEFAULT_MODEL;

        setModelOptions(merged);
        setSelectedModel((current) => {
          if (merged.some((entry) => entry.code === current)) {
            return current;
          }

          if (merged.some((entry) => entry.code === suggestedDefault)) {
            return suggestedDefault;
          }

          return merged[0]?.code ?? current;
        });
      } catch {
        // Curated fallback remains available locally.
      }
    }

    void hydrateModelOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (viewerItems.length === 0) {
      if (isHistoryViewerOpen) {
        setIsHistoryViewerOpen(false);
      }
      setHistoryViewerIndex(0);
      return;
    }

    if (historyViewerIndex > viewerItems.length - 1) {
      setHistoryViewerIndex(viewerItems.length - 1);
    }
  }, [viewerItems.length, historyViewerIndex, isHistoryViewerOpen]);

  // Mark the currently viewed item as seen in a separate effect so that the
  // historyItems state update (which re-renders historySlides) never happens in
  // the same commit as the historyViewerIndex change. If both happen together,
  // YARL receives a new `slides` reference AND a new `index` in one render and
  // can misfire its "index-changed" navigation handler, causing prev/next to
  // intermittently not work.
  useEffect(() => {
    if (!isHistoryViewerOpen) {
      return;
    }
    const viewedId = viewerItems[historyViewerIndex]?.id;
    if (viewedId) {
      markHistoryItemAsViewed(viewedId);
    }
    // Intentionally excludes viewerItems content updates from deps beyond index/open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyViewerIndex, isHistoryViewerOpen]);

  function archiveSelected() {
    const selectedIds = new Set(selectedHistoryIds);
    const toArchive = historyItems.filter((item) => selectedIds.has(item.id));
    if (toArchive.length === 0) return;

    const archivedAt = new Date().toISOString();
    const newArchiveItems: ArchiveItem[] = toArchive.map((item) => ({
      ...item,
      imageUrl: URL.createObjectURL(item.imageBlob),
      archivedAt
    }));

    setArchiveItems((prev) => [...newArchiveItems, ...prev]);
    setHistoryItems((prev) => prev.filter((item) => !selectedIds.has(item.id)));
    setIsSelectionMode(false);
    setSelectedHistoryIds(new Set());

    toast.success(t('toastArchived'), {
      description: t('toastArchivedDesc', { count: toArchive.length }),
      duration: 3500
    });
  }

  function getDaysRemaining(archivedAt: string): number {
    const elapsed = Date.now() - new Date(archivedAt).getTime();
    return Math.max(0, ARCHIVE_TTL_DAYS - Math.floor(elapsed / (24 * 60 * 60 * 1000)));
  }

  function toggleSelectionMode() {
    setIsSelectionMode((prev) => !prev);
    setSelectedHistoryIds(new Set());
  }

  function toggleSelectImage(id: string) {
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function downloadSelected() {
    const selected = historyItems.filter((item) => selectedHistoryIds.has(item.id));
    if (selected.length === 0) return;

    if (selected.length === 1) {
      const item = selected[0];
      const fileExt = mimeTypeToFileExtension(item.mimeType);
      const anchor = document.createElement('a');
      anchor.href = item.imageUrl;
      anchor.download = getHistoryImageDownloadName(item, 1, fileExt);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        const fileExt = mimeTypeToFileExtension(item.mimeType);
        const fileName = getHistoryImageDownloadName(item, i + 1, fileExt);
        zip.file(fileName, item.imageBlob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${getDownloadBatchBaseName(selected)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('toastDownloadFailed'), { duration: 4000 });
    }
  }

  async function downloadHistoryItemsAsZip(
    items: HistoryItem[],
    zipBaseName: string,
    options?: {
      /** Put every file under this single root folder (e.g. "KA1232 1"). */
      rootFolderName?: string;
    }
  ) {
    if (items.length === 0) return;

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const catalog = multiCollections;

      const writeItemsToFolder = (
        folder: { file: (name: string, data: Blob) => unknown },
        folderItems: HistoryItem[]
      ) => {
        for (let i = 0; i < folderItems.length; i++) {
          const item = folderItems[i];
          const fileExt = mimeTypeToFileExtension(item.mimeType);
          folder.file(getHistoryImageDownloadName(item, i + 1, fileExt), item.imageBlob);
        }
      };

      if (options?.rootFolderName) {
        const folder = zip.folder(options.rootFolderName);
        if (!folder) {
          throw new Error('Failed to create zip folder.');
        }
        writeItemsToFolder(folder, items);
      } else {
        // Group by collection id; multi-image collections go into named folders.
        const byCollection = groupHistoryCollections(items);
        for (const collection of byCollection) {
          if (collection.items.length > 1) {
            const folderName = getCollectionFolderName(collection, catalog);
            const folder = zip.folder(folderName);
            if (!folder) continue;
            writeItemsToFolder(folder, collection.items);
          } else {
            writeItemsToFolder(zip, collection.items);
          }
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${zipBaseName}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('batchDownloadFailed'), { duration: 4000 });
    }
  }

  async function downloadCollection(collection: HistoryCollection) {
    if (collection.items.length === 1) {
      downloadHistoryItem(collection.items[0], 1);
      return;
    }
    const folderName = getCollectionFolderName(collection, multiCollections);
    await downloadHistoryItemsAsZip(collection.items, folderName, { rootFolderName: folderName });
  }

  function openReferencePicker() {
    fileInputRef.current?.click();
  }

  function openHistoryViewer(itemId: string) {
    // Prefer in-flight pending slots (partial batch results) when present.
    const pendingReady = pendingSlots.map((slot) => slot.item).filter((entry): entry is HistoryItem => Boolean(entry));
    const pendingIndex = pendingReady.findIndex((entry) => entry.id === itemId);
    if (pendingIndex >= 0) {
      setViewerOverrideItems(pendingReady);
      setViewerCollectionId(null);
      setHistoryViewerIndex(pendingIndex);
      setIsHistoryViewerOpen(true);
      return;
    }

    const item = historyItems.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }

    const collectionId = resolveCollectionId(item);
    const scoped = historyItems.filter((entry) => resolveCollectionId(entry) === collectionId);
    const targetIndex = scoped.findIndex((entry) => entry.id === itemId);
    if (targetIndex < 0) {
      return;
    }

    markHistoryItemAsViewed(itemId);
    setViewerOverrideItems(null);
    setViewerCollectionId(collectionId);
    setHistoryViewerIndex(targetIndex);
    setIsHistoryViewerOpen(true);
  }

  function openCollectionViewer(collection: HistoryCollection, startIndex = 0) {
    if (collection.items.length === 0) {
      return;
    }
    const safeIndex = Math.max(0, Math.min(startIndex, collection.items.length - 1));
    markHistoryItemAsViewed(collection.items[safeIndex].id);
    setViewerCollectionId(collection.id);
    setHistoryViewerIndex(safeIndex);
    setIsHistoryViewerOpen(true);
  }

  function markHistoryItemAsViewed(itemId: string) {
    setHistoryItems((previous) => {
      let changed = false;
      const next = previous.map((item) => {
        if (item.id !== itemId || !item.isNew) {
          return item;
        }

        changed = true;
        return { ...item, isNew: false };
      });

      return changed ? next : previous;
    });
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((previous) => previous.filter((image) => image.id !== id));
  }

  function downloadHistoryItem(item: HistoryItem, index = 1) {
    if (typeof document === 'undefined') {
      return;
    }

    const fileExt = mimeTypeToFileExtension(item.mimeType);
    const anchor = document.createElement('a');
    anchor.href = item.imageUrl;
    anchor.download = getHistoryImageDownloadName(item, index, fileExt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function downloadHistoryImage() {
    const item = activeHistoryItem;
    if (!item) {
      return;
    }
    downloadHistoryItem(item, historyViewerIndex + 1);
  }

  function applyRegenerateConfiguration() {
    const config = activeHistoryItem?.generationConfig;
    if (!activeHistoryItem || !config) {
      toast.error(t('toastRegenerateUnavailable'), {
        description: t('toastRegenerateUnavailableDesc'),
        duration: 4200
      });
      return;
    }

    const normalizedModel = normalizeModelCode(config.model);
    setModelOptions((previous) =>
      sortModelOptions(
        mergeModelOptions(previous, [
          {
            code: normalizedModel,
            name: humanizeModelCode(normalizedModel),
            group: inferModelGroup(normalizedModel)
          }
        ])
      )
    );
    setSelectedModel(normalizedModel);
    setPrompt(config.basePrompt);
    setNegativePrompt(config.negativePrompt?.trim() ?? '');
    setAspectRatio(toAspectRatioOption(config.aspectRatio));
    if (typeof config.steps === 'number' && Number.isFinite(config.steps)) {
      setSteps(Math.max(1, Math.min(Math.round(config.steps), 50)));
    } else {
      setSteps(DEFAULT_TOGETHER_STEPS);
    }
    setImageSize(toResolutionOption(config.imageSize));
    const restoredResizePreset = toResizePresetOption(config.resizePreset, config.resizeWidth, config.resizeHeight);
    setResizePreset(restoredResizePreset);
    setAiUpscale(typeof config.aiUpscale === 'number' && config.aiUpscale > 0 ? config.aiUpscale : 0);
    if (restoredResizePreset === 'custom') {
      const restoredWidth = clampResizeDimension(config.resizeWidth ?? DEFAULT_CUSTOM_RESIZE_WIDTH);
      const restoredHeight = clampResizeDimension(config.resizeHeight ?? DEFAULT_CUSTOM_RESIZE_HEIGHT);
      setCustomResizeWidth(restoredWidth);
      setCustomResizeHeight(restoredHeight);
      setResizeWidthInput(String(restoredWidth));
      setResizeHeightInput(String(restoredHeight));
    }
    const restoredCount = Math.max(1, Math.min(Number(config.requestedCount) || DEFAULT_COUNT, 10));
    setCount(restoredCount);
    setCountInput(String(restoredCount));
    // Reference image bytes are not kept in history (IndexedDB quota). Only metadata may remain.
    const restoredSourceReferences = config.referenceImages ?? [];
    const restoredReferences = restoredSourceReferences
      .filter((reference) => typeof reference.base64 === 'string' && reference.base64.length > 0)
      .map((reference) => ({
        id: makeId(),
        base64: reference.base64 as string,
        mimeType: reference.mimeType,
        previewDataUrl: `data:${reference.mimeType};base64,${reference.base64}`,
        fileName: reference.fileName ?? ''
      }));
    setReferenceImages(restoredReferences);
    setIsHistoryViewerOpen(false);

    if (restoredReferences.length === 0) {
      toast.error(t('toastReferenceUnavailable'), {
        description: t('toastReferenceUnavailableDesc'),
        duration: 5600
      });
    } else {
      toast.success(t('toastConfigLoaded'), {
        description: t('toastConfigLoadedDesc', {
          count: restoredReferences.length,
          resize: describeResize(config.resizeWidth, config.resizeHeight, t)
        }),
        duration: 4600
      });
    }
  }

  async function handleFileInput(files: FileList | File[] | null) {
    if (!files || files.length === 0) {
      return;
    }

    const selected = Array.from(files);
    const createdReferences: ReferenceImage[] = [];

    for (const file of selected) {
      if (!ALLOWED_REFERENCE_MIME_TYPES.has(file.type.toLowerCase())) {
        toast.error(t('toastReferenceReadFailed'), {
          description: t('toastReferenceReadFailedDesc'),
          duration: 5000
        });
        continue;
      }

      if (file.size > MAX_REFERENCE_FILE_BYTES) {
        toast.error(t('toastReferenceReadFailed'), {
          description: t('payloadTooLarge'),
          duration: 5000
        });
        continue;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const parsed = parseDataUrlImage(dataUrl);

      if (!parsed) {
        toast.error(t('toastReferenceReadFailed'), {
          description: t('toastReferenceReadFailedDesc'),
          duration: 5000
        });
        continue;
      }

      createdReferences.push({
        id: makeId(),
        base64: parsed.base64,
        mimeType: parsed.mimeType,
        previewDataUrl: dataUrl,
        fileName: file.name
      });
    }

    if (createdReferences.length > 0) {
      setReferenceImages((previous) => [...previous, ...createdReferences]);
    }
  }

  function onReferenceDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isReferenceDragOver) {
      setIsReferenceDragOver(true);
    }
  }

  function onReferenceDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsReferenceDragOver(true);
  }

  function onReferenceDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    // Ignore leave events that stay inside the drop surface (child nodes).
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsReferenceDragOver(false);
  }

  function onReferenceDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsReferenceDragOver(false);
    void handleFileInput(event.dataTransfer.files);
  }

  /** Abort all in-flight work and reset UI as if Generate was never pressed. */
  function cancelGeneration() {
    if (!isLoading && !generationAbortRef.current) {
      return;
    }

    generationCancelledRef.current = true;
    const collectionId = activeCollectionIdRef.current;
    activeCollectionIdRef.current = null;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;

    batchHistoryItemsRef.current = [];
    batchRunResultsRef.current = [];
    refAnalysesRef.current = {};
    generationStartedAtRef.current = null;

    flushSync(() => {
      setPendingSlots((previous) => {
        for (const slot of previous) {
          const url = slot.item?.imageUrl;
          if (url?.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
        }
        return [];
      });

      if (collectionId) {
        setHistoryItems((previous) => {
          const kept: HistoryItem[] = [];
          for (const item of previous) {
            if (item.collectionId === collectionId) {
              if (item.imageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(item.imageUrl);
              }
            } else {
              kept.push(item);
            }
          }
          return kept;
        });
      }

      setIsLoading(false);
      setActivePendingRefIndex(0);
      setBatchInFlightProgress(null);
      setBatchJobUiStatus(null);
      setGenerationElapsedSec(0);
      setFailures([]);
      setBatchRunResults([]);
      setRefAnalyses({});
      setAnalysisModalTarget(null);
      setAnalysisModalDraft(null);
      setViewerOverrideItems(null);
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prefer the live input value so Generate works without requiring blur on the count field.
    const parsedCount = Number.parseInt(countInput, 10);
    const submittedCount = Math.max(
      1,
      Math.min(Number.isFinite(parsedCount) ? parsedCount : count, 10)
    );
    if (submittedCount !== count) {
      setCount(submittedCount);
      setCountInput(String(submittedCount));
    }
    const submittedPrompt = prompt.trim();
    const submittedNegativePrompt = supportsNegativePrompt ? negativePrompt.trim() : '';
    const submittedModel = selectedModel;
    const submittedAuthMode = authMode;
    const submittedRenderMode = renderMode;
    const submittedAutoAiAnalysis = autoAiAnalysis;
    const submittedRefs = referenceImages.map((img) => ({ base64: img.base64, mimeType: img.mimeType, fileName: img.fileName }));

    if (submittedRefs.length === 0) {
      toast.error(t('toastReferenceRequired'), {
        description: t('errorReferenceRequired'),
        duration: 5000
      });
      return;
    }

    const submittedConfig: GenerationConfigSnapshot = {
      basePrompt: submittedPrompt,
      ...(submittedNegativePrompt ? { negativePrompt: submittedNegativePrompt } : {}),
      model: submittedModel,
      aspectRatio,
      ...(supportsTogetherSteps ? { steps } : {}),
      ...(supportsResolutionSelector ? { imageSize } : {}),
      resizePreset,
      ...(resolvedResize ? { resizeWidth: resolvedResize.width, resizeHeight: resolvedResize.height } : {}),
      ...(aiUpscale > 0 ? { aiUpscale } : {}),
      requestedCount: submittedCount,
    };

    // Cancel any previous run before starting a new one.
    generationAbortRef.current?.abort();
    const abortController = new AbortController();
    generationAbortRef.current = abortController;
    generationCancelledRef.current = false;
    const { signal } = abortController;

    const assertNotCancelled = () => {
      if (generationCancelledRef.current || signal.aborted) {
        const error = new Error('Generation cancelled');
        error.name = 'AbortError';
        throw error;
      }
    };

    const sleepCancellable = async (ms: number) => {
      let remaining = ms;
      while (remaining > 0) {
        assertNotCancelled();
        const chunk = Math.min(1000, remaining);
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, chunk);
          const onAbort = () => {
            window.clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            const error = new Error('Generation cancelled');
            error.name = 'AbortError';
            reject(error);
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
        remaining -= chunk;
      }
    };

    setIsLoading(true);
    setBatchCountPerRef(submittedCount);
    setBatchInFlightProgress(null);
    setBatchJobUiStatus(null);
    setActivePendingRefIndex(0);
    setRefAnalyses({});
    refAnalysesRef.current = {};
    setAnalysisModalTarget(null);
    setAnalysisModalDraft(null);
    setFailures([]);
    setBatchRunResults([]);
    batchRunResultsRef.current = [];
    batchHistoryItemsRef.current = [];
    generationStartedAtRef.current = Date.now();
    setGenerationElapsedSec(0);
    // One collection for the whole submit — every reference image joins this batch.
    const collectionId = makeId();
    activeCollectionIdRef.current = collectionId;
    const collectionCreatedAt = new Date().toISOString();

    // Calls /api/generate with the given refs, polls until done, returns structured output.
    // onPartialResults is invoked whenever the poll returns more finished images than before.
    async function callApiAndGetResults(
      refs: Array<{ base64: string; mimeType: string; fileName?: string }>,
      promptForRun = submittedPrompt,
      onPartialResults?: (results: GenerationResult[]) => Promise<void>
    ) {
      assertNotCancelled();
      const requestSignal = createTimeoutLinkedSignal(signal, MAX_GENERATE_REQUEST_MS);
      let submitResponse: Response;
      try {
        submitResponse = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: requestSignal,
          body: JSON.stringify({
            prompt: promptForRun,
            negativePrompt: submittedNegativePrompt || undefined,
            count: submittedCount,
            model: submittedModel,
            authMode: submittedAuthMode,
            renderMode: submittedRenderMode,
            aspectRatio,
            steps: supportsTogetherSteps ? steps : undefined,
            imageSize: supportsResolutionSelector ? imageSize : undefined,
            resizeWidth: resolvedResize?.width,
            resizeHeight: resolvedResize?.height,
            aiUpscale: aiUpscale > 0 ? aiUpscale : undefined,
            referenceImages: refs
          })
        });
      } catch (fetchError) {
        if (generationCancelledRef.current || signal.aborted) {
          throw Object.assign(new Error('Generation cancelled'), { name: 'AbortError' });
        }
        if (isAbortLikeError(fetchError)) {
          throw new Error(
            t('errorGenerateTimeout', { minutes: Math.round(MAX_GENERATE_REQUEST_MS / 60_000) })
          );
        }
        throw fetchError;
      }

      const submitPayload = await parseApiJsonOrThrow(submitResponse, '/api/generate');
      if (!submitResponse.ok) {
        throw new Error((submitPayload as { error?: string } | null)?.error ?? t('errorGenerationFailed'));
      }

      const submitResult = submitPayload as BatchSubmitResponse;
      const { jobId } = submitResult;

      type BatchOutputShape = NonNullable<BatchSubmitResponse['results']>;
      let batchOutput: BatchOutputShape;

      if (submitResult.results) {
        batchOutput = submitResult.results;
      } else {
        const POLL_INTERVAL_MS = 5000;
        let finalStatus: BatchStatusResponse | undefined;
        let lastPartialCount = 0;
        const pollStartedAt = Date.now();
        let waitingResultsSince: number | null = null;

        while (true) {
          assertNotCancelled();
          if (Date.now() - pollStartedAt > MAX_BATCH_POLL_MS) {
            throw new Error(
              t('errorBatchPollTimeout', { minutes: Math.round(MAX_BATCH_POLL_MS / 60_000) })
            );
          }

          let statusResponse: Response;
          try {
            statusResponse = await fetch(`/api/generate?job=${encodeURIComponent(jobId)}`, {
              signal
            });
          } catch (pollFetchError) {
            if (generationCancelledRef.current || signal.aborted) {
              throw Object.assign(new Error('Generation cancelled'), { name: 'AbortError' });
            }
            throw pollFetchError;
          }
          finalStatus = (await parseApiJsonOrThrow(statusResponse, '/api/generate')) as BatchStatusResponse;

          if (!statusResponse.ok) {
            throw new Error((finalStatus as unknown as { error?: string }).error ?? t('errorGenerationFailed'));
          }

          const polled = finalStatus;
          // Paint job status immediately (before any heavy partial image work).
          flushSync(() => {
            if (polled.progress && polled.progress.requestCount > 0) {
              setBatchInFlightProgress(polled.progress);
            }
            const stateLower = (polled.state ?? '').toLowerCase();
            const labelLower = (polled.stateLabel ?? '').toLowerCase();
            const isWaitingResults = labelLower.includes('waiting for results');
            const enteredRunning =
              stateLower === 'running' ||
              stateLower === 'succeeded' ||
              isWaitingResults;
            setBatchJobUiStatus((previous) => {
              let nextState = polled.state;
              // Avoid flashing "In queue" after retry or after we already saw RUNNING.
              if (
                !enteredRunning &&
                (stateLower === 'pending' || stateLower === 'queued') &&
                (previous?.state === 'retrying' || previous?.hasEnteredRunning)
              ) {
                nextState = previous?.state === 'retrying' ? 'retrying' : 'running';
              }
              return {
                state: nextState,
                stateLabel: polled.stateLabel,
                stateDetail: polled.stateDetail,
                progress: polled.progress,
                // Sticky for this product attempt — survives PENDING/PAUSED flicker from Gemini.
                hasEnteredRunning: Boolean(previous?.hasEnteredRunning) || enteredRunning
              };
            });
          });

          const waitingLabel = (polled.stateLabel ?? '').toLowerCase();
          if (waitingLabel.includes('waiting for results')) {
            if (waitingResultsSince == null) waitingResultsSince = Date.now();
            else if (Date.now() - waitingResultsSince > MAX_WAITING_RESULTS_MS) {
              throw new Error(
                t('errorBatchWaitingResultsTimeout', {
                  minutes: Math.round(MAX_WAITING_RESULTS_MS / 60_000)
                })
              );
            }
          } else {
            waitingResultsSince = null;
          }

          // Stream finished variants into pending history cards as they arrive.
          // Skip heavy partial materialization on the terminal poll — the caller commits
          // history + clears loading slots in one flush before the success toast.
          const isTerminal = isTerminalBatchState(polled.state);
          const partialList = (polled.results?.results ?? []) as GenerationResult[];
          if (!isTerminal && onPartialResults && partialList.length > lastPartialCount) {
            lastPartialCount = partialList.length;
            try {
              await onPartialResults(partialList);
            } catch (partialUiError) {
              console.warn('[batch-generate] partial UI update failed', partialUiError);
            }
          }

          if (isTerminal) break;
          await sleepCancellable(POLL_INTERVAL_MS);
        }

        if (!finalStatus || finalStatus.state !== 'succeeded') {
          throw new Error(finalStatus?.error?.trim() || `Batch job ${finalStatus?.stateLabel?.toLowerCase() ?? 'failed'}.`);
        }

        batchOutput = finalStatus.results as BatchOutputShape;
        // Keep in-flight UI status until the caller flushSync-commits history / clears slots.
      }

      return {
        outputResults: (batchOutput?.results ?? []) as GenerationResult[],
        outputFailures: (batchOutput?.failures ?? []) as GenerationFailure[],
        succeededCount: Number(batchOutput?.succeededCount ?? (batchOutput?.results ?? []).length),
        failedCount: Number(batchOutput?.failedCount ?? (batchOutput?.failures ?? []).length),
        usedModel: String(batchOutput?.usedModel ?? 'unknown-model')
      };
    }

    function applyUsedModel(usedModel: string): string {
      if (!usedModel || usedModel === 'unknown-model') {
        return submittedModel;
      }

      let normalizedUsedModel = normalizeModelCode(usedModel);

      // Gemini Developer Batch API reports bare model ids (no `vertex/` prefix).
      // Auth Mode is only shown for vertex/* — preserve the user's Vertex selection.
      if (/^vertex\//i.test(submittedModel) && !/^vertex\//i.test(normalizedUsedModel)) {
        normalizedUsedModel = `vertex/${normalizedUsedModel}`;
      }

      const submittedBase = normalizeModelCode(submittedModel).replace(/^vertex\//i, '');
      const usedBase = normalizedUsedModel.replace(/^vertex\//i, '');
      // Same model under a different reporting form — keep the exact UI selection.
      if (submittedBase.toLowerCase() === usedBase.toLowerCase()) {
        return submittedModel;
      }

      setSelectedModel(normalizedUsedModel);
      setModelOptions((previous) =>
        sortModelOptions(
          mergeModelOptions(previous, [
            {
              code: normalizedUsedModel,
              name: humanizeModelCode(normalizedUsedModel),
              group: inferModelGroup(normalizedUsedModel)
            }
          ])
        )
      );
      return normalizedUsedModel;
    }

    // Always one generation job per reference image (queue + rate limit + retries).
    const totalRefs = referenceImages.length;
    const rateLimitMs = batchRateLimitSec * 1000;
    const queue: BatchQueueItem[] = referenceImages.map((ref, refIndex) => ({ ref, refIndex, attempt: 0 }));
    let processedAttempts = 0;
    setBatchTotalRefs(totalRefs);

    /** Stable slots for every product × variant — full grid from first click. */
    const allPendingSlots: PendingHistorySlot[] = [];
    const slotIdsByRefIndex = new Map<number, string[]>();
    for (let r = 0; r < totalRefs; r++) {
      const ids: string[] = [];
      for (let v = 0; v < submittedCount; v++) {
        const id = makeId();
        ids.push(id);
        allPendingSlots.push({ id, refIndex: r, variantIndex: v, item: null });
      }
      slotIdsByRefIndex.set(r, ids);
    }
    /** Filled images for the whole submit, keyed by slot id. */
    const filledItemsBySlotId = new Map<string, HistoryItem>();

    const publishPendingSlots = () => {
      setPendingSlots(
        allPendingSlots.map((slot) => ({
          ...slot,
          item: filledItemsBySlotId.get(slot.id) ?? null
        }))
      );
    };

    // Manual catalogue template from product option dropdowns (used when AI auto-analysis is off
    // or as fallback when analysis fails / prompt field is empty).
    const manualCataloguePrompt =
      selectedBodyColor && selectedDoorColor
        ? buildCommercialCataloguePrompt({
            bodyColor: selectedBodyColor,
            doorColor: selectedDoorColor,
            plexiglass: selectedPlexiglass,
            mounting: selectedMounting,
            handlePresence: selectedHandlePresence,
            handle: handleDescription.trim() || DEFAULT_HANDLE_DESCRIPTION,
            roomStyle: selectedRoomStyle,
            accentColor: selectedAccentColor
          })
        : '';

    flushSync(() => {
      setActivePendingRefIndex(0);
      publishPendingSlots();
      if (submittedAutoAiAnalysis) {
        const loadingMap: Record<number, RefAnalysisState> = {};
        for (let r = 0; r < totalRefs; r++) {
          loadingMap[r] = { status: 'loading' };
        }
        refAnalysesRef.current = loadingMap;
        setRefAnalyses(loadingMap);
      } else {
        refAnalysesRef.current = {};
        setRefAnalyses({});
      }
    });

    // Gemini Flash: analyze every reference once so each product gets its own prompt.
    if (submittedAutoAiAnalysis) {
      try {
        await Promise.all(
          submittedRefs.map(async (ref, index) => {
            try {
              assertNotCancelled();
              const analyzeSignal = createTimeoutLinkedSignal(signal, MAX_ANALYZE_REQUEST_MS);
              let response: Response;
              try {
                response = await fetch('/api/analyze-reference', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  signal: analyzeSignal,
                  body: JSON.stringify({
                    base64: ref.base64,
                    mimeType: ref.mimeType,
                    fileName: ref.fileName
                  })
                });
              } catch (analyzeFetchError) {
                if (generationCancelledRef.current || signal.aborted) {
                  throw Object.assign(new Error('Generation cancelled'), { name: 'AbortError' });
                }
                if (isAbortLikeError(analyzeFetchError)) {
                  throw new Error(t('errorAnalysisTimeout'));
                }
                throw analyzeFetchError;
              }
              const payload = (await response.json().catch(() => ({}))) as {
                analysis?: ReferenceAnalysis;
                error?: string;
              };
              if (!response.ok || !payload.analysis) {
                throw new Error(payload.error?.trim() || t('analysisFailed'));
              }
              const next: RefAnalysisState = { status: 'ready', analysis: payload.analysis };
              refAnalysesRef.current = { ...refAnalysesRef.current, [index]: next };
              setRefAnalyses((prev) => ({ ...prev, [index]: next }));
            } catch (analyzeError) {
              if (
                generationCancelledRef.current ||
                signal.aborted ||
                (analyzeError instanceof Error && analyzeError.name === 'AbortError')
              ) {
                throw analyzeError instanceof Error
                  ? analyzeError
                  : Object.assign(new Error('Generation cancelled'), { name: 'AbortError' });
              }
              const message = getUnknownErrorMessage(analyzeError, t('analysisFailed'));
              console.warn('[analyze-reference] failed', { index, message });
              toast.error(t('toastAnalysisFailed', { product: ref.fileName?.trim() || String(index + 1) }), {
                description: message,
                duration: 5000
              });
              const next: RefAnalysisState = { status: 'error', error: message };
              refAnalysesRef.current = { ...refAnalysesRef.current, [index]: next };
              setRefAnalyses((prev) => ({ ...prev, [index]: next }));
            }
          })
        );
      } catch (analyzeWaveError) {
        if (
          generationCancelledRef.current ||
          signal.aborted ||
          (analyzeWaveError instanceof Error && analyzeWaveError.name === 'AbortError')
        ) {
          // Cancel path handles UI reset.
          return;
        }
        throw analyzeWaveError;
      }
    }

    try {
      while (queue.length > 0) {
        assertNotCancelled();
        const item = queue.shift();
        if (!item) break;

        const { ref, refIndex, attempt } = item;
        const analysisPrompt = refAnalysesRef.current[refIndex]?.analysis?.prompt?.trim();
        // Priority: AI analysis prompt → manual base prompt → product-option template → last-resort fallback.
        const promptForRun =
          analysisPrompt ||
          getBatchPromptForReference(submittedPrompt, refIndex) ||
          manualCataloguePrompt ||
          'Create a photorealistic commercial furniture catalogue image from the reference. Preserve product identity exactly. GENERATE.';
        const slotIds = slotIdsByRefIndex.get(refIndex) ?? [];

        if (processedAttempts > 0) {
          const targetTime = lastBatchRunTimeRef.current + rateLimitMs;
          const waitMs = Math.max(0, targetTime - Date.now());
          if (waitMs > 0) {
            await sleepCancellable(waitMs);
          }
        }

        setActivePendingRefIndex(refIndex);
        setBatchInFlightProgress(null);
        setBatchJobUiStatus({
          state: attempt > 0 ? 'retrying' : submittedRenderMode === 'single' ? 'running' : 'pending',
          stateLabel: attempt > 0 ? 'Retrying' : submittedRenderMode === 'single' ? 'Running' : 'Pending',
          stateDetail: undefined,
          progress: undefined,
          // Tekli starts interactive immediately; toplu sticky-running from first RUNNING poll.
          hasEnteredRunning: attempt === 0 && submittedRenderMode === 'single'
        });
        // Tracks which generation results already filled a pending slot (by stable key).
        const partialSeenKeys = new Set<string>();
        // Clear only this product's slots on a new attempt (keep other products' filled cards).
        for (const id of slotIds) {
          const existing = filledItemsBySlotId.get(id);
          if (existing?.imageUrl.startsWith('blob:') && attempt > 0) {
            URL.revokeObjectURL(existing.imageUrl);
          }
          if (attempt > 0) {
            filledItemsBySlotId.delete(id);
          }
        }
        publishPendingSlots();

        const singleRefConfig: GenerationConfigSnapshot = {
          ...submittedConfig,
          basePrompt: promptForRun,
          referenceImages: [{ base64: ref.base64, mimeType: ref.mimeType, fileName: ref.fileName }]
        };

        const resultKey = (entry: GenerationResult) =>
          entry.blobUrl?.trim() ||
          (entry.imageBase64 ? `b64:${entry.imageBase64.slice(0, 96)}` : '') ||
          `pv:${entry.promptVariant}:${entry.mimeType}`;

        const applyPartialResults = async (partialResults: GenerationResult[]) => {
          if (generationCancelledRef.current || signal.aborted) return;

          const newcomers = partialResults.filter((entry) => {
            const key = resultKey(entry);
            if (!key || partialSeenKeys.has(key)) return false;
            partialSeenKeys.add(key);
            return true;
          });
          if (newcomers.length === 0) return;

          // Fill this product's empty slots left-to-right.
          const emptySlotIds = slotIds.filter((id) => !filledItemsBySlotId.has(id));
          const toFill = newcomers.slice(0, emptySlotIds.length);
          const refAnalysis = refAnalysesRef.current[refIndex]?.analysis;
          const partialHistoryConfig = stripReferenceBase64FromConfig(singleRefConfig);
          const created = await Promise.all(
            toFill.map((entry, index) =>
              createHistoryItemFromGenerationResult(entry, {
                id: emptySlotIds[index],
                createdAt: collectionCreatedAt,
                isNew: true,
                collectionId,
                generationConfig: partialHistoryConfig,
                referenceAnalysis: refAnalysis
              })
            )
          );

          if (generationCancelledRef.current || signal.aborted) {
            for (const createdItem of created) {
              if (createdItem.imageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(createdItem.imageUrl);
              }
            }
            return;
          }

          for (const createdItem of created) {
            filledItemsBySlotId.set(createdItem.id, createdItem);
          }

          flushSync(() => {
            publishPendingSlots();
          });
        };

        try {
          const { outputResults, outputFailures, usedModel } = await callApiAndGetResults(
            [{ base64: ref.base64, mimeType: ref.mimeType }],
            promptForRun,
            applyPartialResults
          );

          // Cancel may land after the network response but before we commit history.
          assertNotCancelled();

          lastBatchRunTimeRef.current = Date.now();

          if (outputResults.length < submittedCount) {
            const firstFailure = outputFailures[0]?.error?.trim();
            throw new Error(firstFailure || `Generated ${outputResults.length} of ${submittedCount} requested image(s).`);
          }

          processedAttempts += 1;
          const resolvedUsedModel = applyUsedModel(usedModel);
          const historyConfig: GenerationConfigSnapshot = stripReferenceBase64FromConfig({
            ...singleRefConfig,
            model: resolvedUsedModel
          });
          const refAnalysis = refAnalysesRef.current[refIndex]?.analysis;

          if (outputFailures.length > 0) {
            const productLabel = ref.fileName?.trim() || String(refIndex + 1);
            setFailures((prev) => [
              ...prev,
              ...outputFailures.map((f) => ({
                promptVariant: productLabel,
                error: formatGenerationError(f.error, t)
              }))
            ]);
          }

          let runItems: HistoryItem[] = [];
          if (outputResults.length > 0) {
            // Prefer already-rendered partial slot images (same object URLs / no flash).
            const filledPartialCount = slotIds.filter((id) => filledItemsBySlotId.has(id)).length;
            if (filledPartialCount >= outputResults.length) {
              runItems = slotIds.slice(0, outputResults.length).map((id, index) => {
                const existing = filledItemsBySlotId.get(id)!;
                return {
                  ...existing,
                  promptVariant: outputResults[index]?.promptVariant || existing.promptVariant,
                  generationConfig: historyConfig,
                  referenceAnalysis: refAnalysis ?? existing.referenceAnalysis,
                  isNew: true
                };
              });
            } else {
              runItems = await Promise.all(
                outputResults.map(async (entry, index) => {
                  const slotId = slotIds[index] ?? makeId();
                  const existing = filledItemsBySlotId.get(slotId);
                  if (existing) {
                    return {
                      ...existing,
                      promptVariant: entry.promptVariant || existing.promptVariant,
                      generationConfig: historyConfig,
                      referenceAnalysis: refAnalysis ?? existing.referenceAnalysis,
                      isNew: true
                    } satisfies HistoryItem;
                  }
                  return createHistoryItemFromGenerationResult(entry, {
                    id: slotId,
                    createdAt: collectionCreatedAt,
                    isNew: true,
                    collectionId,
                    generationConfig: historyConfig,
                    referenceAnalysis: refAnalysis
                  });
                })
              );

              // Revoke object URLs for partial items not carried into the final run.
              const keptIds = new Set(runItems.map((entry) => entry.id));
              for (const id of slotIds) {
                const existing = filledItemsBySlotId.get(id);
                if (existing && !keptIds.has(id) && existing.imageUrl.startsWith('blob:')) {
                  URL.revokeObjectURL(existing.imageUrl);
                  filledItemsBySlotId.delete(id);
                }
              }
            }

            for (const runItem of runItems) {
              filledItemsBySlotId.set(runItem.id, runItem);
            }

            // Accumulate into the active batch collection (all refs share collectionId).
            batchHistoryItemsRef.current = [...batchHistoryItemsRef.current, ...runItems];
          }

          const runResult: BatchRunResult = {
            refIndex,
            refPreviewDataUrl: ref.previewDataUrl,
            refFileName: ref.fileName,
            items: runItems
          };
          batchRunResultsRef.current = [...batchRunResultsRef.current, runResult];

          // Keep the full loading grid; fill this product's cards and commit history.
          // Do not clear pendingSlots — remaining product cards stay as "Sırada".
          if (generationCancelledRef.current || signal.aborted) {
            return;
          }
          flushSync(() => {
            if (runItems.length > 0) {
              const batchItems = batchHistoryItemsRef.current;
              setHistoryItems((previous) => {
                const outsideBatch = previous
                  .filter((entry) => entry.collectionId !== collectionId)
                  .map((entry) => ({ ...entry, isNew: false }));
                return [...batchItems, ...outsideBatch].slice(0, MAX_HISTORY_ITEMS);
              });
            }
            setBatchRunResults([...batchRunResultsRef.current]);
            publishPendingSlots();
            setViewerOverrideItems(null);
            setBatchInFlightProgress(null);
            setBatchJobUiStatus(null);
          });
        } catch (stepError) {
          // User cancelled — exit quietly (cancelGeneration already resets UI).
          if (
            generationCancelledRef.current ||
            signal.aborted ||
            (stepError instanceof Error && stepError.name === 'AbortError')
          ) {
            return;
          }

          lastBatchRunTimeRef.current = Date.now();
          processedAttempts += 1;
          const rawMessage = getUnknownErrorMessage(stepError, t('unexpectedError'));
          // warn (not error): Next.js dev overlay treats console.error as a page error.
          console.warn('[batch-generate] step failed', {
            refIndex,
            attempt,
            product: ref.fileName?.trim() || String(refIndex + 1),
            error: rawMessage
          });
          const message = formatGenerationError(rawMessage, t);
          const nextAttempt = attempt + 1;
          const maxAttempts = MAX_BATCH_REFERENCE_RETRIES + 1;
          const productLabel = ref.fileName?.trim() || String(refIndex + 1);

          // Drop only this product's partial object URLs on failed attempt.
          for (const id of slotIds) {
            const existing = filledItemsBySlotId.get(id);
            if (existing?.imageUrl.startsWith('blob:')) {
              URL.revokeObjectURL(existing.imageUrl);
            }
            filledItemsBySlotId.delete(id);
          }

          if (attempt < MAX_BATCH_REFERENCE_RETRIES) {
            const delayMs = getBatchRetryDelayMs(rawMessage, attempt);
            const delaySec = Math.max(1, Math.round(delayMs / 1000));

            // Immediate toast so failures are never silent.
            toast.error(t('toastBatchStepFailed', { product: productLabel }), {
              description: `${message}\n${t('toastBatchStepFailedRetry', {
                attempt: nextAttempt,
                max: maxAttempts,
                seconds: delaySec
              })}`,
              duration: Math.min(12_000, Math.max(4500, delayMs + 1500))
            });

            // Keep full grid; this product's cards go empty + "Yeniden deneniyor".
            flushSync(() => {
              setViewerOverrideItems(null);
              setBatchInFlightProgress(null);
              publishPendingSlots();
              setBatchJobUiStatus({
                state: 'retrying',
                stateLabel: 'Retrying',
                stateDetail: message,
                progress: undefined,
                hasEnteredRunning: false
              });
            });

            try {
              await sleepCancellable(delayMs);
            } catch {
              if (generationCancelledRef.current || signal.aborted) {
                return;
              }
              throw new Error('Generation cancelled');
            }
            queue.unshift({ ref, refIndex, attempt: nextAttempt });
          } else {
            if (generationCancelledRef.current || signal.aborted) {
              return;
            }
            toast.error(t('toastBatchStepFailed', { product: productLabel }), {
              description: `${message}\n${t('toastBatchStepFailedFinal', { max: maxAttempts })}`,
              duration: 8000
            });

            flushSync(() => {
              publishPendingSlots();
              setViewerOverrideItems(null);
              setBatchInFlightProgress(null);
              setBatchJobUiStatus(null);
            });
            setFailures((prev) => [
              ...prev,
              {
                promptVariant: productLabel,
                error: t('batchRetryExhausted', {
                  product: productLabel,
                  max: maxAttempts,
                  error: message
                })
              }
            ]);
            const failedRunResult: BatchRunResult = {
              refIndex,
              refPreviewDataUrl: ref.previewDataUrl,
              refFileName: ref.fileName,
              items: []
            };
            batchRunResultsRef.current = [...batchRunResultsRef.current, failedRunResult];
            setBatchRunResults([...batchRunResultsRef.current]);
          }
        }
      }

      // Cancelled mid-queue — do not toast "completed" or switch tabs.
      if (generationCancelledRef.current || signal.aborted) {
        return;
      }

      const succeededRuns = batchRunResultsRef.current.filter((run) => run.items.length > 0).length;
      const failedRuns = totalRefs - succeededRuns;

      // End loading UI first, then toast — avoids "completed" while skeletons still show.
      flushSync(() => {
        setIsLoading(false);
        setPendingSlots([]);
        setActivePendingRefIndex(0);
        setBatchInFlightProgress(null);
        setBatchJobUiStatus(null);
        generationStartedAtRef.current = null;
      });

      if (failedRuns > 0) {
        toast.error(t('toastRunFinishedWithIssues'), {
          description: t('toastRunFinishedWithIssuesDesc', { success: succeededRuns, fail: failedRuns }),
          duration: 6500
        });
      } else if (totalRefs > 1) {
        toast.success(t('batchComplete', { total: totalRefs }), { duration: 4200 });
      } else if (succeededRuns > 0) {
        toast.success(t('toastGenerationCompleted'), {
          description: t('toastGenerationCompletedDesc', {
            count: batchRunResultsRef.current[0]?.items.length ?? submittedCount
          }),
          duration: 3200
        });
      }

      if (typeof window !== 'undefined' && window.innerWidth <= 980 && batchRunResultsRef.current.length > 0) {
        setActiveTab('history');
      }
    } finally {
      // Safety net if we bailed before the success-path flushSync.
      // When cancelled, cancelGeneration already wiped history + pending; keep UI idle.
      if (generationCancelledRef.current || signal.aborted) {
        if (generationAbortRef.current === abortController) {
          generationAbortRef.current = null;
        }
        if (activeCollectionIdRef.current === collectionId) {
          activeCollectionIdRef.current = null;
        }
        flushSync(() => {
          setIsLoading(false);
          setPendingSlots([]);
          setActivePendingRefIndex(0);
          setBatchInFlightProgress(null);
          setBatchJobUiStatus(null);
          generationStartedAtRef.current = null;
        });
        return;
      }

      flushSync(() => {
        setIsLoading(false);
        setPendingSlots([]);
        setActivePendingRefIndex(0);
        setBatchInFlightProgress(null);
        setBatchJobUiStatus(null);
        generationStartedAtRef.current = null;
      });

      if (generationAbortRef.current === abortController) {
        generationAbortRef.current = null;
      }
      if (activeCollectionIdRef.current === collectionId) {
        activeCollectionIdRef.current = null;
      }
    }
  }

  return (
    <main className="app-shell" data-mobile-tab={activeTab}>
      <aside className="panel history-tab">
        <div className="history-head">
          <h2 className="history-title">
            <span>{t('history')}</span>
            <span className="history-count-badge" aria-label={t('historyImageCount', { count: historyItems.length })}>
              <GalleryIcon />
              <span>{historyItems.length}</span>
            </span>
          </h2>
          {historyItems.length > 0 ? (
            <div className="history-selection-bar">
              <button
                type="button"
                className={`history-select-btn${isSelectionMode ? ' is-active' : ''}`}
                onClick={toggleSelectionMode}
              >
                {isSelectionMode ? t('cancelSelection') : t('selectImages')}
              </button>
              <AnimatePresence>
                {isSelectionMode && selectedHistoryIds.size > 0 ? (
                  <>
                    <motion.button
                      key="download-selected"
                      type="button"
                      className="history-download-selected-btn"
                      onClick={() => { void downloadSelected(); }}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    >
                      <DownloadIcon />
                      <span>{t('downloadSelected', { count: selectedHistoryIds.size })}</span>
                    </motion.button>
                    <motion.button
                      key="archive-selected"
                      type="button"
                      className="history-archive-selected-btn"
                      onClick={archiveSelected}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 26, delay: 0.04 }}
                    >
                      <ArchiveBoxIcon />
                      <span>{t('archiveBtn', { count: selectedHistoryIds.size })}</span>
                    </motion.button>
                  </>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}
        </div>

        {!isHistoryHydrated ? (
          <p className="history-empty">{t('loadingHistory')}</p>
        ) : historyGroups.length === 0 && pendingSlots.length === 0 ? (
          <p className="history-empty">{t('noHistory')}</p>
        ) : (
          <div className="history-list">
            {pendingSlots.length > 0 ? (
              <section className="history-group history-group-pending">
                <h3 className="history-date">{progressStatusText || t('generatingNow')}</h3>
                <div className="history-grid" role="status" aria-live="polite">
                  {pendingSlots.map((slot, index) => {
                    const item = slot.item;
                    const cardStatus = getPendingCardStatus(slot, index);
                    const analysisState = refAnalyses[slot.refIndex];
                    const openAnalysis = () => {
                      const ready = refAnalysesRef.current[slot.refIndex]?.analysis;
                      setAnalysisModalTarget({ kind: 'ref', refIndex: slot.refIndex });
                      setAnalysisModalDraft(ready ? { ...ready } : null);
                    };

                    if (!item) {
                      return (
                        <article
                          className={`history-item history-item-pending history-item-status--${cardStatus.phase}`}
                          key={slot.id}
                        >
                          <button
                            type="button"
                            className="history-pending-hit"
                            onClick={openAnalysis}
                            aria-label={t('openAnalysisModal')}
                          >
                            <div className="history-skeleton-thumb" />
                          </button>
                          <div className={`history-card-status history-card-status--${cardStatus.phase}`}>
                            <span className="history-card-status-badge">{cardStatus.badge}</span>
                            <span className="history-card-status-meta">{cardStatus.meta}</span>
                          </div>
                          {analysisState?.status === 'loading' ? (
                            <span className="history-analysis-chip">{t('analysisLoadingChip')}</span>
                          ) : analysisState?.status === 'ready' ? (
                            <span className="history-analysis-chip is-ready">{t('analysisReadyChip')}</span>
                          ) : analysisState?.status === 'error' ? (
                            <span className="history-analysis-chip is-error">{t('analysisErrorChip')}</span>
                          ) : null}
                        </article>
                      );
                    }

                    return (
                      <motion.article
                        className={`history-item history-item-partial history-item-status--${cardStatus.phase}`}
                        key={slot.id}
                        initial={{ opacity: 0, scale: 0.92, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                      >
                        <button
                          type="button"
                          className="history-open-btn"
                          onClick={() => openHistoryViewer(item.id)}
                          aria-label={t('openImageViewer')}
                        >
                          <img src={item.imageUrl} alt={t('historyResultAlt')} loading="lazy" />
                          <span className="history-open-indicator" aria-hidden="true">
                            <OpenViewerIcon />
                          </span>
                        </button>
                        <button
                          type="button"
                          className="history-analysis-open-btn"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openAnalysis();
                          }}
                          aria-label={t('openAnalysisModal')}
                          title={t('openAnalysisModal')}
                        >
                          AI
                        </button>
                        <Tooltip content={t('download')} side="top" triggerClassName="history-card-download-wrap">
                          <button
                            type="button"
                            className="history-card-download"
                            aria-label={t('download')}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              downloadHistoryItem(item, index + 1);
                            }}
                          >
                            <DownloadIcon />
                          </button>
                        </Tooltip>
                        <div className={`history-card-status history-card-status--${cardStatus.phase}`}>
                          <span className="history-card-status-badge">{cardStatus.badge}</span>
                          <span className="history-card-status-meta">{cardStatus.meta}</span>
                        </div>
                      </motion.article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {historyGroups.map((group) => (
              <section key={group.dateKey} className="history-group">
                <h3 className="history-date">{group.label}</h3>
                <div className="history-collections-grid">
                  {group.collections.map((collection) => {
                    // Single output image and single product → plain photo card.
                    // Multi-product batch (several references in one submit) always uses the album UI,
                    // even while the batch is still filling (items may grow as each ref finishes).
                    if (collection.items.length === 1 && collection.productCount <= 1) {
                      const item = collection.items[0];
                      return (
                        <article
                          className={`history-item${isSelectionMode && selectedHistoryIds.has(item.id) ? ' is-selected' : ''}`}
                          key={collection.id}
                        >
                          <button
                            type="button"
                            className="history-open-btn"
                            onClick={() =>
                              isSelectionMode ? toggleSelectImage(item.id) : openHistoryViewer(item.id)
                            }
                            aria-label={isSelectionMode ? t('selectImages') : t('openImageViewer')}
                            aria-pressed={isSelectionMode ? selectedHistoryIds.has(item.id) : undefined}
                          >
                            <img src={item.imageUrl} alt={t('historyResultAlt')} loading="lazy" />
                            {isSelectionMode ? (
                              <span
                                className={`history-select-circle${selectedHistoryIds.has(item.id) ? ' is-selected' : ''}`}
                                aria-hidden="true"
                              >
                                {selectedHistoryIds.has(item.id) ? <CheckIcon /> : null}
                              </span>
                            ) : (
                              <span className="history-open-indicator" aria-hidden="true">
                                <OpenViewerIcon />
                              </span>
                            )}
                          </button>
                          {!isSelectionMode ? (
                            <Tooltip content={t('download')} side="top" triggerClassName="history-card-download-wrap">
                              <button
                                type="button"
                                className="history-card-download"
                                aria-label={t('download')}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  downloadHistoryItem(item, 1);
                                }}
                              >
                                <DownloadIcon />
                              </button>
                            </Tooltip>
                          ) : null}
                          {item.isNew && !isSelectionMode ? <span className="new-badge">{t('newBadge')}</span> : null}
                        </article>
                      );
                    }

                    const previewItems = collection.items.slice(0, 4);
                    const collectionTitle = getCollectionDisplayName(collection, multiCollections);
                    const allSelected =
                      collection.items.length > 0 &&
                      collection.items.every((item) => selectedHistoryIds.has(item.id));
                    return (
                      <article
                        key={collection.id}
                        className={`history-collection-card${allSelected && isSelectionMode ? ' is-selected' : ''}${
                          collection.isNew && !isSelectionMode ? ' is-new' : ''
                        }`}
                      >
                        <button
                          type="button"
                          className="history-collection-open"
                          onClick={() => {
                            if (isSelectionMode) {
                              setSelectedHistoryIds((prev) => {
                                const next = new Set(prev);
                                if (allSelected) {
                                  for (const item of collection.items) next.delete(item.id);
                                } else {
                                  for (const item of collection.items) next.add(item.id);
                                }
                                return next;
                              });
                              return;
                            }
                            openCollectionViewer(collection, 0);
                          }}
                          aria-label={`${collectionTitle} — ${t('openCollectionViewer', { count: collection.items.length })}`}
                        >
                          <div className="history-collection-stack" aria-hidden="true">
                            <span className="history-collection-stack-layer history-collection-stack-layer--back" />
                            <span className="history-collection-stack-layer history-collection-stack-layer--mid" />
                          </div>
                          <div className="history-collection-face">
                            <div
                              className={`history-collection-mosaic history-collection-mosaic--${Math.min(
                                4,
                                Math.max(1, previewItems.length)
                              )}`}
                            >
                              {previewItems.map((item) => (
                                <img key={item.id} src={item.imageUrl} alt="" loading="lazy" />
                              ))}
                            </div>
                            <span className="history-collection-type-badge">{collectionTitle}</span>
                            {collection.isNew && !isSelectionMode ? (
                              <span className="new-badge">{t('newBadge')}</span>
                            ) : null}
                            {isSelectionMode ? (
                              <span
                                className={`history-select-circle${allSelected ? ' is-selected' : ''}`}
                                aria-hidden="true"
                              >
                                {allSelected ? <CheckIcon /> : null}
                              </span>
                            ) : (
                              <span className="history-open-indicator" aria-hidden="true">
                                <OpenViewerIcon />
                              </span>
                            )}
                          </div>
                          <div className="history-collection-meta">
                            <span className="history-collection-meta-title">{collectionTitle}</span>
                            <span className="history-collection-meta-stats">
                              {t('collectionImageCount', { count: collection.items.length })}
                              {collection.productCount > 1
                                ? ` · ${t('collectionProductCount', { count: collection.productCount })}`
                                : ''}
                            </span>
                          </div>
                        </button>
                        {!isSelectionMode ? (
                          <Tooltip
                            content={`${t('downloadCollection')}: ${collectionTitle}`}
                            side="top"
                            triggerClassName="history-card-download-wrap"
                          >
                            <button
                              type="button"
                              className="history-card-download"
                              aria-label={`${t('downloadCollection')}: ${collectionTitle}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void downloadCollection(collection);
                              }}
                            >
                              <DownloadIcon />
                            </button>
                          </Tooltip>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {isArchiveHydrated && archiveItems.length > 0 ? (
          <section className="archive-section">
            <button
              type="button"
              className={`archive-toggle${isArchiveSectionOpen ? ' is-open' : ''}`}
              onClick={() => setIsArchiveSectionOpen((prev) => !prev)}
            >
              <ArchiveBoxIcon />
              <span>{t('archiveSectionTitle')} ({archiveItems.length})</span>
              <ChevronDownIcon />
            </button>
            {isArchiveSectionOpen ? (
              <div className="archive-grid">
                {archiveItems.map((item) => {
                  const daysLeft = getDaysRemaining(item.archivedAt);
                  return (
                    <article className="history-item archive-item" key={item.id}>
                      <button
                        type="button"
                        className="history-open-btn"
                        onClick={() => {
                          window.open(item.imageUrl, '_blank');
                        }}
                        aria-label={t('openImageViewer')}
                      >
                        <img src={item.imageUrl} alt={t('historyResultAlt')} loading="lazy" />
                      </button>
                      <Tooltip content={t('download')} side="top" triggerClassName="history-card-download-wrap">
                        <button
                          type="button"
                          className="history-card-download"
                          aria-label={t('download')}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            downloadHistoryItem(item, 1);
                          }}
                        >
                          <DownloadIcon />
                        </button>
                      </Tooltip>
                      <span className={`archive-ttl-badge${daysLeft <= 3 ? ' is-urgent' : ''}`}>
                        {daysLeft}
                        {t('archiveDaysLabel')}
                      </span>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}
      </aside>

      <section className="workspace">
        <div className="workspace-header">
          <h1>{t('appTitle')}</h1>
          <div className="workspace-top">
            <Tooltip
              content={themeMode === 'dark' ? t('switchToLightMode') : t('switchToDarkMode')}
              side="bottom"
            >
              <button
                type="button"
                className="theme-toggle icon-only"
                onClick={() => setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'))}
                aria-label={themeMode === 'dark' ? t('switchToLightMode') : t('switchToDarkMode')}
              >
                {themeMode === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
            </Tooltip>
            <div className="language-dropdown-wrap">
              <GlobeIcon />
              <select
                className="language-dropdown"
                value={language}
                onChange={(event) => setLanguage(event.target.value as 'tr' | 'en')}
                aria-label={t('switchLanguage')}
                title={t('switchLanguage')}
              >
                <option value="tr">🇹🇷 Türkçe</option>
                <option value="en">🇺🇸 English</option>
              </select>
            </div>
          </div>
        </div>
        <p className="subtitle">{t('appSubtitle')}</p>

        <section className="panel generator-panel">
          <form className="form generator-form" onSubmit={onSubmit}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden-file-input"
              onChange={(event) => {
                void handleFileInput(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />

            <label htmlFor="render-mode-selector">
              <span className="field-head">
                <span>{t('renderMode')}</span>
                <InfoHint text={t('fieldInfo.renderMode')} />
              </span>
              <select
                id="render-mode-selector"
                value={renderMode}
                onChange={(event) => setRenderMode(event.target.value as RenderModeOption)}
              >
                <option value="single">{t('renderModeSingle')}</option>
                <option value="batch">{t('renderModeBatch')}</option>
              </select>
              {renderMode === 'batch' ? (
                <p className="reference-note">{t('renderModeBatchHint')}</p>
              ) : (
                <p className="reference-note">{t('renderModeSingleHint')}</p>
              )}
            </label>

            <label htmlFor="auth-mode-selector">
              <span className="field-head">
                <span>{t('authMode')}</span>
                <InfoHint text={t('fieldInfo.authMode')} />
              </span>
              <select
                id="auth-mode-selector"
                value={authMode}
                onChange={(event) => setAuthMode(event.target.value as AuthModeOption)}
              >
                <option value="api_key">{t('authModeApiKey')}</option>
                <option value="service_account">{t('authModeServiceAccount')}</option>
                <option value="vertex_express">{t('authModeVertexExpress')}</option>
              </select>
              {authMode === 'vertex_express' ? (
                <p className="reference-note">{t('authModeVertexExpressHint')}</p>
              ) : null}
            </label>

            <label htmlFor="model-selector">
              <span className="field-head">
                <ModelIcon />
                <span>{t('model')}</span>
                <InfoHint text={t('fieldInfo.model')} />
              </span>
              <select id="model-selector" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                {modelGroups.map((group) => (
                  <optgroup key={group.group} label={translateModelGroup(group.group, t)}>
                    {group.options.map((option) => (
                      <option key={option.code} value={option.code}>
                        {renderModelOptionLabel(option)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {!selectedModelLooksImageCapable ? (
                <p className="reference-note">{t('selectedModelTextOnlyWarning')}</p>
              ) : null}
            </label>

            <section className="reference-block">
              <div className="field-head">
                <GalleryIcon />
                <span>{t('referenceImages')}</span>
                <InfoHint text={t('fieldInfo.referenceImages')} />
              </div>

              <div
                className={[
                  'reference-drop-surface',
                  referenceImages.length === 0 ? 'is-empty' : '',
                  isReferenceDragOver ? 'is-drag-over' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onDragOver={onReferenceDragOver}
                onDragEnter={onReferenceDragEnter}
                onDragLeave={onReferenceDragLeave}
                onDrop={onReferenceDrop}
                onClick={(event) => {
                  if (event.target === event.currentTarget || (event.target as HTMLElement).closest('.ref-empty-state')) {
                    if (!(event.target as HTMLElement).closest('button')) {
                      openReferencePicker();
                    }
                  }
                }}
              >
                {isReferenceDragOver ? (
                  <div className="reference-drop-overlay" aria-live="polite">
                    <div className="reference-drop-overlay-ring" aria-hidden />
                    <div className="reference-drop-overlay-copy">
                      <span className="reference-drop-overlay-icon" aria-hidden>
                        <PlusIcon />
                      </span>
                      <strong>{t('referenceDropActive')}</strong>
                      <span>{t('referenceDropActiveHint')}</span>
                    </div>
                  </div>
                ) : null}

                {referenceImages.length === 0 ? (
                  <div className="ref-empty-state">
                    <button type="button" className="ref-add-primary" onClick={openReferencePicker} aria-label={t('addReferenceImage')}>
                      <PlusIcon />
                    </button>
                    <div className="ref-empty-copy">
                      <strong>{t('referenceDropTitle')}</strong>
                      <span>{t('referenceDropSubtitle')}</span>
                    </div>
                  </div>
                ) : (
                  <div className="ref-preview-row">
                    {referenceImages.map((image, index) => (
                      <article className="ref-preview-item" key={image.id}>
                        <div className="ref-preview-circle">
                          <img src={image.previewDataUrl} alt={t('referenceAlt', { index: index + 1 })} />
                        </div>
                        <button
                          type="button"
                          className="ref-remove-btn"
                          aria-label={t('removeReferenceImage', { index: index + 1 })}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeReferenceImage(image.id);
                          }}
                        >
                          <CloseIcon />
                        </button>
                      </article>
                    ))}

                    <button
                      type="button"
                      className="ref-add-circle"
                      onClick={(event) => {
                        event.stopPropagation();
                        openReferencePicker();
                      }}
                      aria-label={t('addReferenceImage')}
                    >
                      <PlusIcon />
                    </button>
                  </div>
                )}
              </div>

            </section>

            <label htmlFor="batch-rate-limit">
              <span className="field-head">
                <LayersIcon />
                <span>{t('batchRateLimit')}</span>
                <InfoHint text={t('fieldInfo.batchRateLimit')} />
              </span>
              <input
                id="batch-rate-limit"
                type="number"
                min={0}
                max={MAX_BATCH_RATE_LIMIT_SEC}
                value={batchRateLimitInput}
                className={batchRateLimitError ? 'is-invalid' : ''}
                onChange={(event) => setBatchRateLimitInput(event.target.value)}
                onBlur={() => {
                  const n = Number.parseInt(batchRateLimitInput, 10);
                  if (Number.isFinite(n) && n >= 0 && n <= MAX_BATCH_RATE_LIMIT_SEC) {
                    setBatchRateLimitSec(n);
                    setBatchRateLimitInput(String(n));
                  } else {
                    setBatchRateLimitInput(String(batchRateLimitSec));
                  }
                }}
              />
              {batchRateLimitError ? <p className="field-error">{batchRateLimitError}</p> : null}
            </label>

            <label htmlFor="prompt">
              <span className="field-head">
                <PromptIcon />
                <span>{t('basePrompt')}</span>
                <InfoHint text={t('fieldInfo.basePrompt')} />
              </span>
              <div className="inline-select-grid product-option-grid">
                <select
                  id="body-color"
                  value={selectedBodyColor}
                  onChange={(event) => setSelectedBodyColor(event.target.value as BodyColorOption | '')}
                  aria-label={t('bodyColorPlaceholder')}
                >
                  <option value="">{t('bodyColorPlaceholder')}</option>
                  {BODY_COLOR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`bodyColorOptions.${option}`)}
                    </option>
                  ))}
                </select>
                <select
                  id="door-color"
                  value={selectedDoorColor}
                  onChange={(event) => setSelectedDoorColor(event.target.value as DoorColorOption | '')}
                  aria-label={t('doorColorPlaceholder')}
                >
                  <option value="">{t('doorColorPlaceholder')}</option>
                  {DOOR_COLOR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`doorColorOptions.${option}`)}
                    </option>
                  ))}
                </select>
                <select
                  id="plexiglass-option"
                  value={selectedPlexiglass}
                  onChange={(event) => setSelectedPlexiglass(event.target.value as PlexiglassOption)}
                  aria-label={t('plexiglassPlaceholder')}
                >
                  {PLEXIGLASS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`plexiglassOptions.${option}`)}
                    </option>
                  ))}
                </select>
                <select
                  id="mounting-option"
                  value={selectedMounting}
                  onChange={(event) => setSelectedMounting(event.target.value as MountingOption)}
                  aria-label={t('mountingPlaceholder')}
                >
                  {MOUNTING_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`mountingOptions.${option}`)}
                    </option>
                  ))}
                </select>
                <select
                  id="handle-presence"
                  value={selectedHandlePresence}
                  onChange={(event) => setSelectedHandlePresence(event.target.value as HandlePresenceOption)}
                  aria-label={t('handlePresencePlaceholder')}
                >
                  {HANDLE_PRESENCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`handlePresenceOptions.${option}`)}
                    </option>
                  ))}
                </select>
                <select
                  id="room-style"
                  value={selectedRoomStyle}
                  onChange={(event) => setSelectedRoomStyle(event.target.value as RoomStyleOption)}
                  aria-label={t('roomStylePlaceholder')}
                >
                  {ROOM_STYLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`roomStyleOptions.${option}`)}
                    </option>
                  ))}
                </select>
                <select
                  id="accent-color"
                  value={selectedAccentColor}
                  onChange={(event) => setSelectedAccentColor(event.target.value as AccentColorOption)}
                  aria-label={t('accentColorPlaceholder')}
                >
                  {ACCENT_COLOR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`accentColorOptions.${option}`)}
                    </option>
                  ))}
                </select>
                {selectedHandlePresence === 'with-handle' ? (
                  <input
                    id="handle-description"
                    type="text"
                    className="product-handle-input"
                    value={handleDescription}
                    onChange={(event) => setHandleDescription(event.target.value)}
                    placeholder={t('handlePlaceholder')}
                    aria-label={t('handlePlaceholder')}
                  />
                ) : null}
              </div>
              <p className="reference-note">{t('productOptionsPromptHint')}</p>
              <div className="prompt-preset-row">
                {BATCH_PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="prompt-preset-btn"
                    onClick={() => {
                      setSelectedBodyColor('');
                      setSelectedDoorColor('');
                      setSelectedPlexiglass('none');
                      setSelectedMounting('floor-standing');
                      setSelectedHandlePresence('with-handle');
                      setSelectedAccentColor('warm-beige');
                      setHandleDescription('');
                      setPrompt(preset.prompt);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <textarea
                ref={promptTextareaRef}
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t('promptPlaceholder')}
              />
            </label>

            {supportsNegativePrompt ? (
              <label htmlFor="negative-prompt">
                <span className="field-head">
                  <PromptIcon />
                  <span>{t('negativePrompt')}</span>
                  <InfoHint text={t('fieldInfo.negativePrompt')} />
                </span>
                <textarea
                  ref={negativePromptTextareaRef}
                  id="negative-prompt"
                  value={negativePrompt}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                  placeholder={t('negativePromptPlaceholder')}
                />
              </label>
            ) : null}

            <label htmlFor="count">
              <span className="field-head">
                <LayersIcon />
                <span>{t('numberOfVariants')}</span>
                <InfoHint text={t('fieldInfo.variants')} />
              </span>
              <input
                id="count"
                type="number"
                min={1}
                max={10}
                value={countInput}
                className={countError ? 'is-invalid' : ''}
                onChange={(event) => {
                  const next = event.target.value;
                  setCountInput(next);
                  const n = Number.parseInt(next, 10);
                  if (Number.isFinite(n) && n >= 1 && n <= 10) {
                    setCount(n);
                  }
                }}
                onBlur={() => {
                  const n = Number.parseInt(countInput, 10);
                  if (Number.isFinite(n) && n >= 1 && n <= 10) {
                    setCount(n);
                    setCountInput(String(n));
                  } else {
                    setCountInput(String(count));
                  }
                }}
              />
              {countError ? <p className="field-error">{countError}</p> : null}
            </label>

            <label htmlFor="aspect-ratio">
              <span className="field-head">
                <RatioIcon />
                <span>{t('aspectRatio')}</span>
                <InfoHint text={t('fieldInfo.aspectRatio')} />
              </span>
              <select
                id="aspect-ratio"
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value as AspectRatioOption)}
              >
                {ASPECT_RATIO_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            {supportsTogetherSteps ? (
              <label htmlFor="steps">
                <span className="field-head">
                  <LayersIcon />
                  <span>{t('steps')}</span>
                  <InfoHint text={t('fieldInfo.steps')} />
                </span>
                <input
                  id="steps"
                  type="number"
                  min={1}
                  max={50}
                  value={steps}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    if (!Number.isFinite(next)) {
                      setSteps(DEFAULT_TOGETHER_STEPS);
                      return;
                    }

                    setSteps(Math.max(1, Math.min(next, 50)));
                  }}
                />
              </label>
            ) : null}

            {supportsResolutionSelector ? (
              <label htmlFor="image-size">
                <span className="field-head">
                  <ResolutionIcon />
                  <span>{t('resolution')}</span>
                  <InfoHint text={t('fieldInfo.resolution')} />
                </span>
                <select
                  id="image-size"
                  value={imageSize}
                  onChange={(event) => setImageSize(event.target.value as ResolutionOption)}
                >
                  {availableResolutionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="reference-note">{t('resolutionGeminiOnly')}</p>
            )}

            <label htmlFor="resize-preset">
              <span className="field-head">
                <ResizeIcon />
                <span>{t('resizeOutput')}</span>
                <InfoHint text={t('fieldInfo.resizeOutput')} />
              </span>
              <select
                id="resize-preset"
                value={resizePreset}
                onChange={(event) => setResizePreset(event.target.value as ResizePresetOption)}
              >
                {RESIZE_PRESET_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {resolveResizePresetLabel(option, t)}
                  </option>
                ))}
                <option value="custom">{t('custom')}</option>
              </select>
            </label>

            {resizePreset === 'custom' ? (
              <div className="resize-custom-grid">
                <label htmlFor="resize-width">
                  <span className="field-head">
                    <span>{t('resizeWidth')}</span>
                  </span>
                  <input
                    id="resize-width"
                    type="number"
                    min={MIN_RESIZE_DIMENSION}
                    max={MAX_RESIZE_DIMENSION}
                    value={resizeWidthInput}
                    className={resizeWidthError ? 'is-invalid' : ''}
                    onChange={(event) => setResizeWidthInput(event.target.value)}
                    onBlur={() => {
                      const n = Number.parseInt(resizeWidthInput, 10);
                      if (Number.isFinite(n) && n >= MIN_RESIZE_DIMENSION && n <= MAX_RESIZE_DIMENSION) {
                        setCustomResizeWidth(n);
                        setResizeWidthInput(String(n));
                      } else {
                        setResizeWidthInput(String(customResizeWidth));
                      }
                    }}
                  />
                  {resizeWidthError ? <p className="field-error">{resizeWidthError}</p> : null}
                </label>

                <label htmlFor="resize-height">
                  <span className="field-head">
                    <span>{t('resizeHeight')}</span>
                  </span>
                  <input
                    id="resize-height"
                    type="number"
                    min={MIN_RESIZE_DIMENSION}
                    max={MAX_RESIZE_DIMENSION}
                    value={resizeHeightInput}
                    className={resizeHeightError ? 'is-invalid' : ''}
                    onChange={(event) => setResizeHeightInput(event.target.value)}
                    onBlur={() => {
                      const n = Number.parseInt(resizeHeightInput, 10);
                      if (Number.isFinite(n) && n >= MIN_RESIZE_DIMENSION && n <= MAX_RESIZE_DIMENSION) {
                        setCustomResizeHeight(n);
                        setResizeHeightInput(String(n));
                      } else {
                        setResizeHeightInput(String(customResizeHeight));
                      }
                    }}
                  />
                  {resizeHeightError ? <p className="field-error">{resizeHeightError}</p> : null}
                </label>
              </div>
            ) : null}

            <label className="checkbox-row" htmlFor="auto-ai-analysis">
              <input
                id="auto-ai-analysis"
                type="checkbox"
                checked={autoAiAnalysis}
                onChange={(event) => setAutoAiAnalysis(event.target.checked)}
                disabled={isLoading}
              />
              <span className="field-head">
                <span>{t('autoAiAnalysis')}</span>
                <InfoHint text={t('fieldInfo.autoAiAnalysis')} />
              </span>
            </label>

            <label className="checkbox-row" htmlFor="ai-upscale">
              <input
                id="ai-upscale"
                type="checkbox"
                checked={aiUpscale > 0}
                onChange={(event) => setAiUpscale(event.target.checked ? 2 : 0)}
              />
              <span className="field-head">
                <ResizeIcon />
                <span>{t('aiUpscale')}</span>
                <InfoHint text={t('fieldInfo.aiUpscale')} />
              </span>
              {aiUpscale > 0 && (
                <select
                  className="field-select"
                  value={aiUpscale}
                  onChange={(event) => setAiUpscale(Number(event.target.value))}
                  style={{ marginLeft: 8 }}
                >
                  <option value={2}>2x</option>
                  <option value={3}>3x</option>
                </select>
              )}
            </label>

            <div className={`generate-btn-bar${isLoading ? ' has-cancel' : ''}`}>
              <motion.button
                type="submit"
                className={`generate-btn${isLoading ? ' is-loading' : ''}`}
                disabled={!canSubmit}
                aria-busy={isLoading}
                whileHover={!isLoading ? { y: -1, scale: 1.01 } : undefined}
                whileTap={!isLoading ? { scale: 0.98 } : undefined}
                animate={
                  isLoading
                    ? {
                        scale: [1, 1.008, 1],
                        boxShadow: [
                          '0 12px 28px color-mix(in oklab, var(--generate-grad-1) 45%, transparent)',
                          '0 18px 36px color-mix(in oklab, var(--generate-grad-2) 54%, transparent)',
                          '0 12px 28px color-mix(in oklab, var(--generate-grad-1) 45%, transparent)'
                        ]
                      }
                    : { scale: 1 }
                }
                transition={isLoading ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.18 }}
              >
                <span className="generate-btn-drift generate-btn-drift-1" aria-hidden="true" />
                <span className="generate-btn-drift generate-btn-drift-2" aria-hidden="true" />
                <span className="generate-btn-drift generate-btn-drift-3" aria-hidden="true" />
                <span className="generate-btn-drift generate-btn-drift-4" aria-hidden="true" />
                <span className="generate-btn-drift generate-btn-drift-5" aria-hidden="true" />
                <span className="generate-btn-drift generate-btn-drift-6" aria-hidden="true" />
                <span className="generate-btn-drift generate-btn-drift-7" aria-hidden="true" />
                <span className="generate-btn-drift generate-btn-drift-8" aria-hidden="true" />
                <span className="generate-btn-drift generate-btn-drift-9" aria-hidden="true" />
                <motion.span
                  className="generate-btn-content"
                  key={isLoading ? 'loading' : 'idle'}
                  initial={{ opacity: 0, y: 6, filter: 'blur(2px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  {isLoading ? (
                    <>
                      <span className="generate-btn-spinner" aria-hidden="true" />
                      <span className="generate-btn-loading-wrap">
                        <span>{progressStatusText || t('generating')}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="generate-btn-icon" aria-hidden="true">
                        ✨
                      </span>
                      <span>{t('generate')}</span>
                    </>
                  )}
                </motion.span>
              </motion.button>
              {isLoading ? (
                <button
                  type="button"
                  className="cancel-generate-btn"
                  onClick={cancelGeneration}
                  aria-label={t('cancelGenerate')}
                >
                  {t('cancelGenerate')}
                </button>
              ) : null}
            </div>
          </form>
        </section>

        {failures.length > 0 ? (
          <section className="run-issues-panel" aria-live="polite">
            <div className="run-issues-head">
              <span className="run-issues-title">
                <span aria-hidden>⚠</span>
                <span>{t('runIssuesTitle')}</span>
                <span className="run-issues-count">{t('runIssuesCount', { count: failures.length })}</span>
              </span>
              <button
                type="button"
                className="run-issues-dismiss"
                onClick={() => {
                  setFailures([]);
                }}
              >
                {t('dismissErrors')}
              </button>
            </div>
            <ul className="run-issues-list">
              {failures.map((failure, index) => (
                <li className="run-issues-item" key={`${failure.promptVariant}-${failure.error}-${index}`}>
                  {failure.promptVariant ? (
                    <span className="run-issues-item-label">{failure.promptVariant}</span>
                  ) : null}
                  <p className="run-issues-item-detail">{failure.error}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

      </section>

      {analysisModalTarget && typeof document !== 'undefined'
        ? createPortal(
        <div
          className="analysis-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            // Close only on backdrop (not when pressing inside dialog).
            if (event.target === event.currentTarget) {
              setAnalysisModalTarget(null);
              setAnalysisModalDraft(null);
            }
          }}
        >
          <div
            className="analysis-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analysis-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="analysis-modal-head">
              <div>
                <h2 id="analysis-modal-title">{t('analysisModalTitle')}</h2>
                <p className="analysis-modal-sub">
                  {t('analysisModalSubtitle', {
                    product:
                      analysisModalTarget.kind === 'ref'
                        ? submittedRefsLabel(referenceImages, analysisModalTarget.refIndex) ||
                          String(analysisModalTarget.refIndex + 1)
                        : historyItems.find((item) => item.id === analysisModalTarget.itemId)
                            ?.referenceAnalysis?.productTypeLabel ||
                          historyItems.find((item) => item.id === analysisModalTarget.itemId)
                            ?.generationConfig?.referenceImages?.[0]?.fileName ||
                          t('historyResultAlt')
                  })}
                </p>
              </div>
              <button
                type="button"
                className="analysis-modal-close"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setAnalysisModalTarget(null);
                  setAnalysisModalDraft(null);
                }}
              >
                {t('close')}
              </button>
            </header>

            {(() => {
              if (analysisModalTarget.kind === 'ref') {
                const state = refAnalyses[analysisModalTarget.refIndex];
                if (state?.status === 'loading' || (!state && isLoading)) {
                  return <p className="analysis-modal-empty">{t('analysisLoadingChip')}</p>;
                }
                if (state?.status === 'error') {
                  return (
                    <p className="analysis-modal-empty is-error">
                      {state.error || t('analysisFailed')}
                    </p>
                  );
                }
              }

              const historyAnalysis =
                analysisModalTarget.kind === 'history'
                  ? historyItems.find((item) => item.id === analysisModalTarget.itemId)
                      ?.referenceAnalysis
                  : undefined;
              const refAnalysis =
                analysisModalTarget.kind === 'ref'
                  ? refAnalyses[analysisModalTarget.refIndex]?.analysis
                  : undefined;
              const source = analysisModalDraft || historyAnalysis || refAnalysis;
              const draft = source ? finalizeAnalysis(source) : null;
              if (!draft) {
                return <p className="analysis-modal-empty">{t('analysisEmpty')}</p>;
              }

              const updateDraft = (patch: Partial<ReferenceAnalysis>) => {
                setAnalysisModalDraft((prev) => {
                  const base = prev || draft;
                  return finalizeAnalysis({ ...base, ...patch });
                });
              };

              return (
                <div className="analysis-modal-body">
                  <div className="analysis-modal-grid">
                    <label>
                      <span>{t('analysisProductType')}</span>
                      <select
                        value={draft.productType}
                        onChange={(e) =>
                          updateDraft({
                            productType: e.target.value as ProductTypeOption,
                            productTypeLabel: productTypeLabel(e.target.value as ProductTypeOption)
                          })
                        }
                      >
                        {PRODUCT_TYPE_VALUES.map((option) => (
                          <option key={option} value={option}>
                            {productTypeLabel(option, language === 'en' ? 'en' : 'tr')}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('bodyColorPlaceholder')}</span>
                      <select
                        value={draft.bodyColor}
                        onChange={(e) =>
                          updateDraft({
                            bodyColor: e.target.value as BodyColorOption
                          })
                        }
                      >
                        {BODY_COLOR_VALUES.map((option) => (
                          <option key={option} value={option}>
                            {t(`bodyColorOptions.${option}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('doorColorPlaceholder')}</span>
                      <select
                        value={draft.doorColor}
                        onChange={(e) =>
                          updateDraft({
                            doorColor: e.target.value as DoorColorOption
                          })
                        }
                      >
                        {DOOR_COLOR_VALUES.map((option) => (
                          <option key={option} value={option}>
                            {t(`doorColorOptions.${option}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('analysisMounting')}</span>
                      <select
                        value={draft.mounting}
                        onChange={(e) => {
                          const mounting = e.target.value as ReferenceAnalysis['mounting'];
                          // Wall-mounted ⇒ no freestanding legs — clear/disable leg count.
                          updateDraft({
                            mounting,
                            legCount: mounting === 'wall-mounted' ? null : draft.legCount
                          });
                        }}
                      >
                        {MOUNTING_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {t(`mountingOptions.${option}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('analysisLegCount')}</span>
                      <input
                        type="number"
                        min={0}
                        max={12}
                        disabled={draft.mounting === 'wall-mounted'}
                        value={draft.mounting === 'wall-mounted' ? '' : draft.legCount ?? ''}
                        placeholder={
                          draft.mounting === 'wall-mounted'
                            ? t('analysisLegCountDisabled')
                            : t('analysisLegCountPlaceholder')
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (!raw) {
                            updateDraft({ legCount: null });
                            return;
                          }
                          const n = Number.parseInt(raw, 10);
                          updateDraft({
                            legCount: Number.isFinite(n) ? Math.max(0, Math.min(12, n)) : null
                          });
                        }}
                      />
                    </label>
                    {draft.mounting !== 'wall-mounted' && draft.legCount != null && draft.legCount > 0 ? (
                      <label>
                        <span>{t('analysisLegLayout')}</span>
                        <input
                          type="text"
                          value={draft.legLayout || ''}
                          placeholder={t('analysisLegLayoutPlaceholder')}
                          onChange={(e) => updateDraft({ legLayout: e.target.value })}
                        />
                      </label>
                    ) : null}
                    <label>
                      <span>{t('analysisPlexiglass')}</span>
                      <select
                        value={draft.plexiglass}
                        onChange={(e) =>
                          updateDraft({
                            plexiglass: e.target.value as ReferenceAnalysis['plexiglass']
                          })
                        }
                      >
                        {PLEXIGLASS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {t(`plexiglassOptions.${option}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('analysisHandles')}</span>
                      <select
                        value={draft.handlePresence}
                        onChange={(e) =>
                          updateDraft({
                            handlePresence: e.target.value as ReferenceAnalysis['handlePresence']
                          })
                        }
                      >
                        {HANDLE_PRESENCE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {t(`handlePresenceOptions.${option}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('roomStylePlaceholder')}</span>
                      <select
                        value={draft.roomStyle}
                        onChange={(e) =>
                          updateDraft({
                            roomStyle: e.target.value as ReferenceAnalysis['roomStyle']
                          })
                        }
                      >
                        {ROOM_STYLE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {t(`roomStyleOptions.${option}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('accentColorPlaceholder')}</span>
                      <select
                        value={draft.accentColor}
                        onChange={(e) =>
                          updateDraft({
                            accentColor: e.target.value as ReferenceAnalysis['accentColor']
                          })
                        }
                      >
                        {ACCENT_COLOR_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {t(`accentColorOptions.${option}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {draft.handlePresence === 'with-handle' ? (
                      <label>
                        <span>{t('handlePlaceholder')}</span>
                        <input
                          value={draft.handleDescription}
                          onChange={(e) => updateDraft({ handleDescription: e.target.value })}
                          placeholder={t('handlePlaceholder')}
                        />
                      </label>
                    ) : null}
                    <label className="analysis-modal-check">
                      <input
                        type="checkbox"
                        checked={draft.hasLaserPatterns}
                        onChange={(e) => updateDraft({ hasLaserPatterns: e.target.checked })}
                      />
                      <span>{t('analysisLaser')}</span>
                    </label>
                    <label>
                      <span>{t('analysisConfidence')}</span>
                      <input
                        type="text"
                        readOnly
                        value={`${Math.round((draft.confidence || 0) * 100)}%`}
                      />
                    </label>
                  </div>
                  <label className="analysis-modal-prompt">
                    <span>{t('analysisPrompt')}</span>
                    <textarea
                      value={draft.prompt}
                      rows={12}
                      onChange={(e) =>
                        setAnalysisModalDraft((prev) =>
                          prev || draft ? { ...(prev || draft), prompt: e.target.value } : null
                        )
                      }
                    />
                  </label>
                  {draft.notes ? (
                    <p className="analysis-modal-notes">
                      <strong>{t('analysisNotes')}:</strong> {draft.notes}
                    </p>
                  ) : null}
                  <footer className="analysis-modal-actions">
                    <button
                      type="button"
                      className="analysis-modal-secondary"
                      onClick={() => {
                        setAnalysisModalTarget(null);
                        setAnalysisModalDraft(null);
                      }}
                    >
                      {t('close')}
                    </button>
                    <button
                      type="button"
                      className="analysis-modal-primary"
                      onClick={() => {
                        if (!analysisModalTarget || !analysisModalDraft) return;
                        const rebuilt = finalizeAnalysis(analysisModalDraft);
                        const saved: ReferenceAnalysis = {
                          ...rebuilt,
                          prompt: analysisModalDraft.prompt?.trim() || rebuilt.prompt
                        };

                        if (analysisModalTarget.kind === 'ref') {
                          const next: RefAnalysisState = { status: 'ready', analysis: saved };
                          refAnalysesRef.current = {
                            ...refAnalysesRef.current,
                            [analysisModalTarget.refIndex]: next
                          };
                          setRefAnalyses((prev) => ({
                            ...prev,
                            [analysisModalTarget.refIndex]: next
                          }));
                        } else {
                          const itemId = analysisModalTarget.itemId;
                          setHistoryItems((prev) =>
                            prev.map((entry) =>
                              entry.id === itemId ? { ...entry, referenceAnalysis: saved } : entry
                            )
                          );
                        }

                        toast.success(t('toastAnalysisSaved'), { duration: 2800 });
                        setAnalysisModalTarget(null);
                        setAnalysisModalDraft(null);
                      }}
                    >
                      {t('saveAnalysis')}
                    </button>
                  </footer>
                </div>
              );
            })()}
          </div>
        </div>,
        document.body
      ) : null}

      <nav className="mobile-tabbar" aria-label="Ana sekme navigasyonu">
        <button
          type="button"
          className={`mobile-tab${activeTab === 'generator' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('generator')}
          aria-current={activeTab === 'generator' ? 'page' : undefined}
        >
          <PromptIcon />
          <span>{t('tabGenerator')}</span>
        </button>
        <button
          type="button"
          className={`mobile-tab${activeTab === 'history' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('history')}
          aria-current={activeTab === 'history' ? 'page' : undefined}
        >
          <GalleryIcon />
          <span>{t('tabHistory')}</span>
          {newHistoryCount > 0 ? <span className="mobile-tab-badge" aria-hidden="true">{newHistoryCount}</span> : null}
        </button>
      </nav>

      <Lightbox
        open={isHistoryViewerOpen}
        close={() => {
          setIsHistoryViewerOpen(false);
          setViewerCollectionId(null);
          setViewerOverrideItems(null);
        }}
        index={historyViewerIndex}
        slides={historySlides}
        plugins={[Zoom]}
        zoom={{
          scrollToZoom: true,
          maxZoomPixelRatio: 2,
          wheelZoomDistanceFactor: 110
        }}
        carousel={{
          padding: '16px',
          spacing: '22%',
          finite: true
        }}
        on={{
          view: ({ index }) => {
            setHistoryViewerIndex(index);
          }
        }}
        render={{
          controls: () => (
            <HistoryViewerHeader
              item={activeHistoryItem}
              onDownload={downloadHistoryImage}
              onRegenerate={applyRegenerateConfiguration}
              onShowAnalysis={() => {
                const item = activeHistoryItem;
                if (!item) return;
                setAnalysisModalTarget({ kind: 'history', itemId: item.id });
                setAnalysisModalDraft(item.referenceAnalysis ? { ...item.referenceAnalysis } : null);
              }}
              isPromptCollapsed={isViewerPromptCollapsed}
              onToggleCollapsed={() => setIsViewerPromptCollapsed((v) => !v)}
            />
          )
        }}
      />
    </main>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

function parseDataUrlImage(dataUrl: string): { mimeType: string; base64: string } | null {
  const [prefix, base64 = ''] = dataUrl.split(',');
  const mimeMatch = /^data:(.*);base64$/.exec(prefix);

  if (!mimeMatch || !base64) {
    return null;
  }

  return {
    mimeType: mimeMatch[1],
    base64
  };
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const chunkSize = 1024;
  const bytes: BlobPart[] = [];

  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const chunk = new Uint8Array(new ArrayBuffer(slice.length));
    for (let index = 0; index < slice.length; index += 1) {
      chunk[index] = slice.charCodeAt(index);
    }
    bytes.push(chunk);
  }

  return new Blob(bytes, { type: mimeType });
}

async function createHistoryItemFromGenerationResult(
  result: GenerationResult,
  metadata: Pick<
    HistoryItem,
    'id' | 'createdAt' | 'isNew' | 'collectionId' | 'generationConfig' | 'referenceAnalysis'
  >
): Promise<HistoryItem> {
  let imageBlob: Blob;
  if (result.blobUrl) {
    // Download from Vercel Blob CDN instead of decoding base64.
    const response = await fetch(result.blobUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image from blob storage: ${response.status}`);
    }
    imageBlob = await response.blob();
  } else if (result.imageBase64) {
    imageBlob = base64ToBlob(result.imageBase64, result.mimeType);
  } else {
    throw new Error('Generation result has neither blobUrl nor imageBase64.');
  }

  return {
    id: metadata.id,
    createdAt: metadata.createdAt,
    isNew: metadata.isNew,
    promptVariant: result.promptVariant,
    mimeType: result.mimeType,
    imageBlob,
    imageUrl: URL.createObjectURL(imageBlob),
    collectionId: metadata.collectionId,
    generationConfig: metadata.generationConfig,
    referenceAnalysis: metadata.referenceAnalysis
  };
}

function isReferenceAnalysis(value: unknown): value is ReferenceAnalysis {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  // Split body/door colors, combined productColor, or very old free-text materials.
  const hasSplitColors = typeof r.bodyColor === 'string' && typeof r.doorColor === 'string';
  const hasCombinedColor = typeof r.productColor === 'string';
  const hasMaterialShape =
    typeof r.roomStyle === 'string' &&
    typeof r.accentColor === 'string' &&
    (hasSplitColors || hasCombinedColor);
  const hasLegacyShape =
    typeof r.bodyColorMaterial === 'string' &&
    typeof r.doorColorMaterial === 'string' &&
    typeof r.colorSummary === 'string';
  return (
    typeof r.productType === 'string' &&
    typeof r.productTypeLabel === 'string' &&
    typeof r.mounting === 'string' &&
    typeof r.hasLaserPatterns === 'boolean' &&
    typeof r.plexiglass === 'string' &&
    typeof r.handlePresence === 'string' &&
    typeof r.handleDescription === 'string' &&
    typeof r.confidence === 'number' &&
    typeof r.notes === 'string' &&
    typeof r.prompt === 'string' &&
    (hasMaterialShape || hasLegacyShape)
  );
}

/** Migrate legacy free-text analysis blobs into catalog enums when loading history. */
function coerceReferenceAnalysis(value: unknown): ReferenceAnalysis | undefined {
  if (!isReferenceAnalysis(value)) return undefined;
  try {
    return finalizeAnalysis(value as ReferenceAnalysisDraft);
  } catch {
    return undefined;
  }
}

/** Drop heavy reference image bytes before writing history to IndexedDB. */
function stripReferenceBase64FromConfig(config: GenerationConfigSnapshot): GenerationConfigSnapshot {
  if (!config.referenceImages?.length) {
    return config;
  }
  return {
    ...config,
    referenceImages: config.referenceImages.map((reference) => ({
      mimeType: reference.mimeType,
      ...(reference.fileName ? { fileName: reference.fileName } : {})
    }))
  };
}

function toHistoryStorageItem(item: HistoryItem): HistoryStorageItem {
  const { imageUrl: _imageUrl, generationConfig, ...rest } = item;
  return {
    ...rest,
    generationConfig: generationConfig ? stripReferenceBase64FromConfig(generationConfig) : undefined
  };
}

function toArchiveStorageItem(item: ArchiveItem): ArchiveStorageItem {
  const { imageUrl: _imageUrl, ...rest } = item;
  return rest;
}

function normalizePersistedArchiveItem(value: unknown): ArchiveItem | null {
  const base = normalizePersistedHistoryItem(value);
  if (!base) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.archivedAt !== 'string' || !record.archivedAt) return null;
  return { ...base, archivedAt: record.archivedAt };
}

function mimeTypeToFileExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic'
  };

  return map[mimeType.toLowerCase()] ?? 'png';
}

function getReferenceFileName(item: HistoryItem): string {
  return item.generationConfig?.referenceImages?.find((reference) => reference.fileName?.trim())?.fileName?.trim() ?? '';
}

function getReferenceBaseName(item: HistoryItem): string {
  return sanitizeDownloadName(stripFileExtension(getReferenceFileName(item))) || 'history';
}

/** Stable key for “which product photo” — filename, else reference payload fingerprint. */
function getHistoryProductKey(item: HistoryItem): string {
  const base = getReferenceBaseName(item);
  if (base && base !== 'history') {
    return base;
  }
  const ref = item.generationConfig?.referenceImages?.[0];
  if (ref?.fileName?.trim()) {
    return `file:${sanitizeDownloadName(ref.fileName)}`;
  }
  if (ref?.mimeType) {
    return `mime:${ref.mimeType}`;
  }
  return `item:${item.id}`;
}

/** Prefer product code (e.g. KA1232) from reference filename. */
function getItemProductCode(item: HistoryItem): string {
  const fileName = getReferenceFileName(item);
  const code = extractProductCodeFromFileName(fileName);
  if (code) {
    return code;
  }
  const base = getReferenceBaseName(item);
  return base !== 'history' ? base : '';
}

/** Unique product codes in collection, majority-first then alpha. */
function getCollectionProductCodes(collection: HistoryCollection): string[] {
  const counts = new Map<string, number>();
  for (const item of collection.items) {
    const code = getItemProductCode(item);
    if (!code || code.toUpperCase() === 'BATCH') continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([code]) => code);
}

function getCollectionProductCode(collection: HistoryCollection): string {
  return getCollectionProductCodes(collection)[0] || 'BATCH';
}

/** Short multi-code label: "KA1 + KA2" or "KA1 + KA2 +2". */
function formatProductCodeList(codes: string[]): string {
  if (codes.length === 0) return 'BATCH';
  if (codes.length === 1) return codes[0];
  if (codes.length <= 3) return codes.join(' + ');
  return `${codes.slice(0, 2).join(' + ')} +${codes.length - 2}`;
}

function getCollectionTitleBase(collection: HistoryCollection): string {
  return formatProductCodeList(getCollectionProductCodes(collection));
}

/** Among collections sharing the same title base: oldest = #1. */
function getCollectionOrdinal(collection: HistoryCollection, multiCollections: HistoryCollection[]): number {
  const titleBase = getCollectionTitleBase(collection);
  const sameTitle = multiCollections
    .filter((entry) => getCollectionTitleBase(entry) === titleBase)
    .sort((a, b) => {
      const time = a.createdAt.localeCompare(b.createdAt);
      return time !== 0 ? time : a.id.localeCompare(b.id);
    });
  const index = sameTitle.findIndex((entry) => entry.id === collection.id);
  return index >= 0 ? index + 1 : 1;
}

function getCollectionDisplayName(collection: HistoryCollection, multiCollections: HistoryCollection[]): string {
  // Prefer product codes from reference filenames for both single- and multi-product batches.
  // Only fall back to "Batch #N" when no usable product code can be extracted.
  const titleBase = getCollectionTitleBase(collection);
  const ordinal = getCollectionOrdinal(collection, multiCollections);
  return `${titleBase} #${ordinal}`;
}

/** Zip/folder form without "#": "KA1232 #1" → "KA1232 1" (then sanitized). */
function getCollectionFolderName(collection: HistoryCollection, multiCollections: HistoryCollection[]): string {
  const display = getCollectionDisplayName(collection, multiCollections);
  const withoutHash = display.replace(/#/g, '').replace(/\s+/g, ' ').trim();
  return sanitizeDownloadName(withoutHash) || 'collection';
}

function getHistoryImageDownloadName(item: HistoryItem, index: number, fileExt: string): string {
  const productCode = getItemProductCode(item) || getReferenceBaseName(item);
  const createdKey = item.createdAt.slice(0, 10);
  const suffix = String(Math.max(1, index)).padStart(2, '0');
  return `${productCode}-${createdKey}-${suffix}.${fileExt}`;
}

function getDownloadBatchBaseName(items: HistoryItem[]): string {
  const referenceNames = Array.from(new Set(items.map(getReferenceBaseName).filter((name) => name !== 'history')));
  const dateKey = new Date().toISOString().slice(0, 10);

  if (referenceNames.length === 1) {
    return `${referenceNames[0]}-${dateKey}`;
  }

  if (referenceNames.length > 1) {
    return `references-${dateKey}`;
  }

  return `history-${dateKey}`;
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '');
}

/**
 * Extract a product code from a reference filename.
 * Supports: KA1232, KA-1232, KA_1232, ka 1232, foto_KA1232_on, KA1232-front, etc.
 */
function extractProductCodeFromFileName(fileName: string): string {
  const baseName = stripFileExtension(fileName || '').trim();
  if (!baseName) return '';

  // Letter prefix + optional separator + digits (anywhere in name).
  // e.g. KA1232, KA-1232, YT_450, tv 12
  const letterDigit = baseName.match(/(?:^|[^A-Za-z0-9])([A-Za-z]{1,8})[-_\s]?(\d{2,8})(?=$|[^0-9])/);
  if (letterDigit) {
    return sanitizeDownloadName(`${letterDigit[1].toUpperCase()}${letterDigit[2]}`);
  }

  // Digits + letter suffix: 1232KA / 1232-KA
  const digitLetter = baseName.match(/(?:^|[^A-Za-z0-9])(\d{2,8})[-_\s]?([A-Za-z]{1,8})(?=$|[^A-Za-z])/);
  if (digitLetter) {
    return sanitizeDownloadName(`${digitLetter[2].toUpperCase()}${digitLetter[1]}`);
  }

  // First path token that mixes letters + digits (no generic camera names).
  const generic = /^(img|image|photo|pic|dsc|dcim|screenshot|whatsapp|copy|untitled|download|file|image\d*)$/i;
  const tokens = baseName.split(/[\s._\-()[\]{}]+/).filter(Boolean);
  for (const token of tokens) {
    if (generic.test(token)) continue;
    if (/[A-Za-z]/.test(token) && /\d/.test(token) && token.length <= 16) {
      return sanitizeDownloadName(token.toUpperCase());
    }
  }

  // Short non-generic basename as last resort (keeps human names usable).
  if (!generic.test(baseName) && baseName.length <= 28 && !/^\d+$/.test(baseName)) {
    return sanitizeDownloadName(baseName);
  }

  return '';
}

/** @deprecated Prefer extractProductCodeFromFileName — kept for any external callers. */
function getReferenceGroupingCode(fileName: string): string {
  return extractProductCodeFromFileName(fileName) || sanitizeDownloadName(stripFileExtension(fileName).trim());
}

function sanitizeDownloadName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePersistedHistoryItem(value: unknown): HistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const configValue = record.generationConfig;
  const hasValidConfig = typeof configValue === 'undefined' || isGenerationConfigSnapshot(configValue);
  if (
    !hasValidConfig ||
    typeof record.id !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.isNew !== 'boolean' ||
    typeof record.promptVariant !== 'string' ||
    typeof record.mimeType !== 'string'
  ) {
    return null;
  }

  const mimeType = record.mimeType;
  const imageBlob = getPersistedImageBlob(record, mimeType);
  if (!imageBlob) {
    return null;
  }

  const referenceAnalysis = coerceReferenceAnalysis(record.referenceAnalysis);

  return {
    id: record.id,
    createdAt: record.createdAt,
    isNew: record.isNew,
    promptVariant: record.promptVariant,
    mimeType,
    imageBlob,
    imageUrl: URL.createObjectURL(imageBlob),
    collectionId: typeof record.collectionId === 'string' && record.collectionId ? record.collectionId : undefined,
    generationConfig: hasValidConfig ? (configValue as GenerationConfigSnapshot | undefined) : undefined,
    referenceAnalysis
  };
}

function resolveCollectionId(item: HistoryItem): string {
  return item.collectionId?.trim() || item.id;
}

/**
 * Repair items that share the same batch timestamp but lost/missing collectionId
 * (legacy history / partial saves) so one generate-submit stays one collection.
 */
function repairHistoryCollectionIds(items: HistoryItem[]): HistoryItem[] {
  const byCreatedAt = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const stamp = item.createdAt;
    const list = byCreatedAt.get(stamp) ?? [];
    list.push(item);
    byCreatedAt.set(stamp, list);
  }

  return items.map((item) => {
    if (item.collectionId?.trim()) {
      return item;
    }
    const peers = byCreatedAt.get(item.createdAt) ?? [item];
    if (peers.length < 2) {
      return item;
    }
    // Prefer an existing collectionId from a peer; otherwise synthesize one for the group.
    const sharedId =
      peers.map((peer) => peer.collectionId?.trim()).find((id) => Boolean(id)) ||
      `batch-${item.createdAt}`;
    return { ...item, collectionId: sharedId };
  });
}

function groupHistoryCollections(items: HistoryItem[]): HistoryCollection[] {
  const repaired = repairHistoryCollectionIds(items);
  const map = new Map<string, HistoryItem[]>();
  for (const item of repaired) {
    const key = resolveCollectionId(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }

  const collections: HistoryCollection[] = [];
  for (const [id, collectionItems] of map) {
    const sorted = [...collectionItems].sort((a, b) => {
      // Stable order: reference index (filename) then recency within the same product.
      const nameA = getReferenceBaseName(a);
      const nameB = getReferenceBaseName(b);
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    const createdAt = sorted.reduce(
      (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
      sorted[0]?.createdAt ?? new Date(0).toISOString()
    );
    const productKeys = new Set(sorted.map((item) => getHistoryProductKey(item)));
    collections.push({
      id,
      createdAt,
      items: sorted,
      isNew: sorted.some((item) => item.isNew),
      coverUrl: sorted[0]?.imageUrl ?? '',
      productCount: Math.max(1, productKeys.size)
    });
  }

  return collections.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function groupCollectionsByDate(
  collections: HistoryCollection[],
  language: 'tr' | 'en'
): Array<{ dateKey: string; label: string; collections: HistoryCollection[] }> {
  const grouped = new Map<string, HistoryCollection[]>();
  for (const collection of collections) {
    const dateKey = collection.createdAt.slice(0, 10);
    const list = grouped.get(dateKey) ?? [];
    list.push(collection);
    grouped.set(dateKey, list);
  }

  return Array.from(grouped.entries()).map(([dateKey, groupCollections]) => ({
    dateKey,
    label: new Date(dateKey).toLocaleDateString(resolveDateLocale(language), {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }),
    collections: groupCollections
  }));
}

function getPersistedImageBlob(record: Record<string, unknown>, mimeType: string): Blob | null {
  if (record.imageBlob instanceof Blob) {
    return record.imageBlob;
  }

  if (typeof record.imageBase64 === 'string' && record.imageBase64) {
    try {
      return base64ToBlob(record.imageBase64, mimeType);
    } catch {
      return null;
    }
  }

  return null;
}

function isGenerationConfigSnapshot(value: unknown): value is GenerationConfigSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const referenceValue = record.referenceImages;
  const hasValidReferences =
    typeof referenceValue === 'undefined' ||
    (Array.isArray(referenceValue) &&
      referenceValue.every((entry) => {
        if (!entry || typeof entry !== 'object') {
          return false;
        }

        const referenceRecord = entry as Record<string, unknown>;
        // base64 is optional (stripped from history for IndexedDB quota).
        return (
          typeof referenceRecord.mimeType === 'string' &&
          (typeof referenceRecord.base64 === 'undefined' || typeof referenceRecord.base64 === 'string') &&
          (typeof referenceRecord.fileName === 'undefined' || typeof referenceRecord.fileName === 'string')
        );
      }));
  const hasValidResizePreset =
    typeof record.resizePreset === 'undefined' || (typeof record.resizePreset === 'string' && isResizePresetOption(record.resizePreset));
  const hasResizeWidth = typeof record.resizeWidth === 'number';
  const hasResizeHeight = typeof record.resizeHeight === 'number';
  const hasValidResizePair = (!hasResizeWidth && !hasResizeHeight) || (hasResizeWidth && hasResizeHeight);
  const hasValidAiUpscale = typeof record.aiUpscale === 'undefined' || typeof record.aiUpscale === 'number';
  return (
    typeof record.basePrompt === 'string' &&
    typeof record.model === 'string' &&
    typeof record.aspectRatio === 'string' &&
    (typeof record.steps === 'undefined' || typeof record.steps === 'number') &&
    (typeof record.imageSize === 'undefined' || typeof record.imageSize === 'string') &&
    typeof record.requestedCount === 'number' &&
    hasValidResizePreset &&
    hasValidResizePair &&
    hasValidAiUpscale &&
    hasValidReferences
  );
}

function isUiModelOption(value: unknown): value is UiModelOption {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.code === 'string' && typeof record.name === 'string' && typeof record.group === 'string';
}

function groupModelOptions(options: UiModelOption[]): Array<{ group: string; options: UiModelOption[] }> {
  const recommendedCodes = [
    'fal-ai/nano-banana/edit',
    'fal-ai/nano-banana-2/edit',
    'fal-ai/nano-banana-pro/edit',
    'google/flash-image-2.5',
    'google/flash-image-3.1',
    'qwen/qwen-image-2.0-pro',
    'black-forest-labs/flux.1-kontext-pro',
    'black-forest-labs/flux.1-kontext-max',
    'black-forest-labs/flux.1-krea-dev',
    'black-forest-labs/flux.1-schnell',
    'ideogram/ideogram-v3.0',
    'openai/gpt-image-1.5'
  ];
  const recommendedRank = new Map<string, number>(recommendedCodes.map((code, index) => [code, index]));
  const isRecommended = (option: UiModelOption): boolean => {
    const code = option.code.toLowerCase();
    const group = option.group.toLowerCase();
    if (!group.includes('together') && !group.includes('fal')) {
      return false;
    }

    return recommendedRank.has(code);
  };

  const recommended = options
    .filter(isRecommended)
    .sort((a, b) => {
      const aRank = recommendedRank.get(a.code.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const bRank = recommendedRank.get(b.code.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) {
        return aRank - bRank;
      }

      return a.name.localeCompare(b.name);
    });

  const grouped = new Map<string, UiModelOption[]>();
  for (const option of options) {
    const bucket = grouped.get(option.group) ?? [];
    bucket.push(option);
    grouped.set(option.group, bucket);
  }

  const groups = Array.from(grouped.entries()).map(([group, entries]) => ({
    group,
    options: entries
  }));

  if (recommended.length === 0) {
    return groups;
  }

  return [{ group: 'Recommended', options: recommended }, ...groups];
}

type HistoryViewerHeaderProps = {
  item: HistoryItem | undefined;
  onDownload: () => void;
  onRegenerate: () => void;
  onShowAnalysis: () => void;
  isPromptCollapsed: boolean;
  onToggleCollapsed: () => void;
};

function HistoryViewerHeader({
  item,
  onDownload,
  onRegenerate,
  onShowAnalysis,
  isPromptCollapsed,
  onToggleCollapsed
}: HistoryViewerHeaderProps) {
  const { t } = useTranslation();

  if (!item) {
    return null;
  }

  const config = item.generationConfig;
  const generatedDescription = item.promptVariant.trim() || config?.basePrompt?.trim() || t('historyViewer');
  const hasAnalysis = Boolean(item.referenceAnalysis);

  const collapseTransition = { duration: 0.22, ease: 'easeInOut' as const };

  return (
    <div className="history-viewer-header">
      <button
        type="button"
        className="history-viewer-toggle"
        onClick={onToggleCollapsed}
        title={isPromptCollapsed ? t('showPrompt') : t('hidePrompt')}
      >
        <motion.span
          animate={{ rotate: isPromptCollapsed ? 180 : 0 }}
          transition={collapseTransition}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {!isPromptCollapsed && (
          <motion.div
            key="prompt-meta"
            className="history-viewer-meta"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={collapseTransition}
            style={{ minWidth: 0, flex: '1 1 auto', marginRight: '0.25rem', overflow: 'hidden' }}
          >
            <strong className="history-viewer-title">{generatedDescription}</strong>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="history-viewer-actions">
        <div className="history-viewer-config-icons">
          {config ? (
            <>
              <span className="history-viewer-config-pill" title={config.model}>
                <ModelIcon />
                <span>{config.model}</span>
              </span>
              <span className="history-viewer-config-pill" title={config.aspectRatio}>
                <RatioIcon />
                <span>{config.aspectRatio}</span>
              </span>
              {config.imageSize ? (
                <span className="history-viewer-config-pill" title={config.imageSize}>
                  <ResolutionIcon />
                  <span>{config.imageSize}</span>
                </span>
              ) : null}
              <span className="history-viewer-config-pill" title={describeResize(config.resizeWidth, config.resizeHeight, t)}>
                <ResizeIcon />
                <span>{describeResize(config.resizeWidth, config.resizeHeight, t)}</span>
              </span>
            </>
          ) : (
            <span className="history-viewer-config">{t('historyViewerNoConfig')}</span>
          )}
        </div>
        <div className="history-viewer-action-col">
          <button
            type="button"
            className={`history-viewer-analysis${hasAnalysis ? '' : ' is-muted'}`}
            onClick={onShowAnalysis}
            title={hasAnalysis ? t('showAnalysis') : t('analysisEmpty')}
          >
            {t('showAnalysis')}
          </button>
          <div className="history-viewer-action-row">
            <button type="button" className="history-viewer-download" onClick={onDownload}>
              <DownloadIcon />
              {t('download')}
            </button>
            <button type="button" className="history-viewer-regenerate" onClick={onRegenerate}>
              <RegenerateIcon />
              {t('regenerate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toAspectRatioOption(value: string): AspectRatioOption {
  const match = ASPECT_RATIO_OPTIONS.find((option) => option === value);
  return match ?? '2:3';
}

function autoResizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }

  // Growing/shrinking a focused textarea often makes the browser scroll the field
  // (or its top) into view — which feels like the caret/text jumps to the top.
  const pageX = window.scrollX;
  const pageY = window.scrollY;
  const selectionStart = element.selectionStart;
  const selectionEnd = element.selectionEnd;
  const hadInternalOverflow = element.scrollHeight > element.clientHeight + 1;
  const innerScrollTop = element.scrollTop;

  // Disable height transition for this measure so layout settles in one frame.
  const previousTransition = element.style.transition;
  element.style.transition = 'none';
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
  // Force reflow before restoring transition so the browser does not animate the jump.
  void element.offsetHeight;
  element.style.transition = previousTransition;

  // Restore page scroll if the browser "helpfully" scrolled on resize.
  if (window.scrollX !== pageX || window.scrollY !== pageY) {
    window.scrollTo(pageX, pageY);
  }

  // Keep caret/selection. Only pin internal scroll when the field was already
  // overflowing (max-height cap) so typing mid-text does not jump to the top;
  // when growing freely, leave scrollTop alone so the caret can stay in view.
  try {
    element.setSelectionRange(selectionStart, selectionEnd);
  } catch {
    // Some input types reject setSelectionRange; textarea should be fine.
  }
  if (hadInternalOverflow && element.scrollHeight > element.clientHeight + 1) {
    element.scrollTop = innerScrollTop;
  }
}

function toResolutionOption(value: string | undefined): ResolutionOption {
  if (!value) {
    return '1K';
  }

  const match = ALL_RESOLUTION_OPTIONS.find((option) => option === value);
  return match ?? '1K';
}

function parseResizeDimensionsFromPreset(value: Exclude<ResizePresetOption, 'none' | 'custom'>): { width: number; height: number } {
  const [widthText, heightText] = value.split('x');
  return {
    width: clampResizeDimension(Number.parseInt(widthText, 10)),
    height: clampResizeDimension(Number.parseInt(heightText, 10))
  };
}

function clampResizeDimension(value: number): number {
  return Math.max(MIN_RESIZE_DIMENSION, Math.min(Math.round(value), MAX_RESIZE_DIMENSION));
}

function isResizePresetOption(value: string): value is ResizePresetOption {
  return value === 'none' || value === '2000x3000' || value === '1536x2048' || value === '1696x2528' || value === '2048x2048' || value === 'custom';
}

function toResizePresetOption(preset: unknown, width: unknown, height: unknown): ResizePresetOption {
  if (typeof preset === 'string' && isResizePresetOption(preset)) {
    return preset;
  }

  if (typeof width === 'number' && typeof height === 'number') {
    const normalizedWidth = clampResizeDimension(width);
    const normalizedHeight = clampResizeDimension(height);
    const candidate = `${normalizedWidth}x${normalizedHeight}`;
    return isResizePresetOption(candidate) ? candidate : 'custom';
  }

  return '2000x3000';
}

function describeResize(width: number | undefined, height: number | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (typeof width !== 'number' || typeof height !== 'number') {
    return t('resizeOff');
  }

  return `${width}x${height}`;
}

/** Backoff before re-queueing a failed batch product. Longer for 429/5xx/timeouts. */
function getBatchRetryDelayMs(message: string, attempt: number): number {
  const m = message.toLowerCase();
  const a = Math.max(0, attempt);
  if (/429|rate.?limit|too many requests/.test(m)) {
    return Math.min(180_000, 30_000 * 2 ** a);
  }
  if (/50[0-4]|timeout|timed out|network|econnreset|fetch failed|generation failed|server/.test(m)) {
    return Math.min(120_000, BATCH_RETRY_BASE_DELAY_MS * 2 ** a);
  }
  return Math.min(60_000, BATCH_RETRY_BASE_DELAY_MS * (a + 1));
}

/** Extract a useful message from thrown API/network values (avoids empty `{}` logs). */
function getUnknownErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    if (message) {
      return message;
    }
  }

  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail', 'statusText', 'cause'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (value instanceof Error && value.message.trim()) {
        return value.message.trim();
      }
    }

    try {
      const json = JSON.stringify(error);
      if (json && json !== '{}' && json !== 'null') {
        return json.length > 400 ? `${json.slice(0, 400)}…` : json;
      }
    } catch {
      // ignore
    }
  }

  return fallback;
}

function formatGenerationError(message: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const trimmed = message.trim();
  const noImageMatch = /No image returned:\s*([^|]+)$/i.exec(trimmed) ?? /No image returned:\s*([^|]+)/i.exec(trimmed);

  if (noImageMatch) {
    const modelText = noImageMatch[1]?.trim();
    if (modelText) {
      return t('modelReturnedText', { modelText });
    }

    return t('modelReturnedNoImage');
  }

  if (trimmed.includes('Generated payload too large')) {
    return t('payloadTooLarge');
  }

  const providerError = extractProviderError(trimmed);
  const providerErrorCode = providerError?.code;
  if (providerErrorCode === 'invalid_api_key' || trimmed.toLowerCase().includes('invalid_api_key')) {
    return t('providerInvalidApiKey');
  }

  if (providerErrorCode === 'rate_limit_exceeded') {
    return t('providerRateLimitExceeded');
  }

  if (providerErrorCode === 'model_not_available') {
    return t('providerModelNotAvailable');
  }

  if (!providerErrorCode && providerError?.message) {
    return providerError.message;
  }

  return trimmed;
}

function extractProviderError(message: string): { code?: string; message?: string } | undefined {
  const jsonStart = message.indexOf('{');
  if (jsonStart < 0) {
    return undefined;
  }

  const jsonCandidate = message.slice(jsonStart).trim();
  try {
    const parsed = JSON.parse(jsonCandidate) as {
      error?: {
        code?: unknown;
        message?: unknown;
      };
    };

    const code = parsed.error?.code;
    const messageValue = parsed.error?.message;
    const normalizedCode = typeof code === 'string' ? code.trim() : '';
    const normalizedMessage = typeof messageValue === 'string' ? messageValue.trim() : '';

    if (!normalizedCode && !normalizedMessage) {
      return undefined;
    }

    return {
      ...(normalizedCode ? { code: normalizedCode } : {}),
      ...(normalizedMessage ? { message: normalizedMessage } : {})
    };
  } catch {
    const messageMatch = /"message"\s*:\s*"([^"]+)"/i.exec(jsonCandidate);
    const codeMatch = /"code"\s*:\s*"([^"]+)"/i.exec(jsonCandidate);
    const extractedMessage = messageMatch?.[1]?.trim();
    const extractedCode = codeMatch?.[1]?.trim();

    if (!extractedMessage && !extractedCode) {
      return undefined;
    }

    return {
      ...(extractedCode ? { code: extractedCode } : {}),
      ...(extractedMessage ? { message: extractedMessage } : {})
    };
  }
}

function resolveDateLocale(language: 'tr' | 'en'): string {
  return language === 'tr' ? 'tr-TR' : 'en-US';
}

function buildRegionalProductScenePrompt(
  region: string,
  atmosphere: string,
  roomDirection: string,
  decorDirection: string
): string {
  return `Analyze the furniture, determine its type and style. Create a photorealistic e-commerce scene inspired by ${region}. Place the product in ${roomDirection} at a realistic scale. The environment should feel like ${atmosphere}. Add ${decorDirection}, keeping the styling minimal, compatible, and sales-oriented. The product must remain the main focal point. Do NOT modify the furniture in any way. The design, color, proportions, and details must remain exactly the same. Only create the background and surrounding environment.`;
}

function getBatchPromptForReference(submittedPrompt: string, referenceIndex: number): string {
  const trimmedPrompt = submittedPrompt.trim();
  const selectedPresetIndex = BATCH_PROMPT_ROTATION.indexOf(trimmedPrompt);

  if (selectedPresetIndex < 0) {
    return trimmedPrompt;
  }

  return BATCH_PROMPT_ROTATION[(selectedPresetIndex + referenceIndex) % BATCH_PROMPT_ROTATION.length];
}

function submittedRefsLabel(refs: ReferenceImage[], index: number): string {
  return refs[index]?.fileName?.trim() || '';
}

function buildCommercialCataloguePrompt(input: {
  bodyColor: BodyColorOption;
  doorColor: DoorColorOption;
  plexiglass: PlexiglassOption;
  mounting: MountingOption;
  handlePresence: HandlePresenceOption;
  handle: string;
  roomStyle: RoomStyleOption;
  accentColor: AccentColorOption;
}): string {
  const draft: ReferenceAnalysisDraft = {
    productType: 'console',
    productTypeLabel: productTypeLabel('console'),
    bodyColor: input.bodyColor,
    doorColor: input.doorColor,
    mounting: input.mounting,
    plexiglass: input.plexiglass,
    handlePresence: input.handlePresence,
    handleDescription: input.handle,
    roomStyle: input.roomStyle,
    accentColor: input.accentColor,
    hasLaserPatterns: false,
    doorCount: null,
    legCount: null,
    legLayout: '',
    confidence: 0.7,
    notes: 'Built from manual product option form (not vision analysis).'
  };
  return finalizeAnalysis(draft).prompt;
}

function isTerminalBatchState(state: string): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'expired';
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** Abort when parent aborts OR after `ms` — prevents infinite hung spinners. */
function createTimeoutLinkedSignal(parent: AbortSignal, ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    try {
      const timeoutSignal =
        typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : null;
      if (timeoutSignal) {
        return AbortSignal.any([parent, timeoutSignal]);
      }
    } catch {
      // Fall through to manual controller.
    }
  }

  const controller = new AbortController();
  if (parent.aborted) {
    controller.abort(parent.reason);
    return controller.signal;
  }
  const onParentAbort = () => {
    window.clearTimeout(timer);
    controller.abort(parent.reason);
  };
  const timer = window.setTimeout(() => {
    parent.removeEventListener('abort', onParentAbort);
    controller.abort();
  }, ms);
  parent.addEventListener('abort', onParentAbort, { once: true });
  controller.signal.addEventListener(
    'abort',
    () => {
      window.clearTimeout(timer);
      parent.removeEventListener('abort', onParentAbort);
    },
    { once: true }
  );
  return controller.signal;
}

async function parseApiJsonOrThrow(response: Response, routeLabel: string): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  if (isJson) {
    return response.json();
  }

  const bodyText = await response.text();
  const compactBody = bodyText.replace(/\s+/g, ' ').trim();
  const snippet = compactBody.slice(0, 220);
  const suffix = compactBody.length > 220 ? '...' : '';
  throw new Error(
    `Non-JSON response from ${routeLabel} (HTTP ${response.status} ${response.statusText}). ${snippet}${suffix}`
  );
}

function resolveResizePresetLabel(value: Exclude<ResizePresetOption, 'custom'>, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (value) {
    case 'none':
      return t('resizeNo');
    case '2000x3000':
      return t('resizePreset2000x3000');
    case '1536x2048':
      return t('resizePreset1536x2048');
    case '1696x2528':
      return t('resizePreset1696x2528');
    case '2048x2048':
      return t('resizePreset2048x2048');
  }
}

function translateModelGroup(group: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const knownGroups = new Set([
    'Recommended',
    'Gemini Image',
    'Together AI',
    'Fal AI',
    'Imagen',
    'Gemini Preview',
    'Gemini Pro Preview',
    'Gemini Flash Preview',
    'Gemini Flash Lite Preview',
    'Gemini',
    'Other'
  ]);

  if (knownGroups.has(group)) {
    return t(`modelGroups.${group}`);
  }

  return group;
}

function renderModelOptionLabel(option: UiModelOption): string {
  return `${option.name} (${normalizeModelCode(option.code)})`;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <path
        d="M12 1.8v2.4m0 15.6v2.4M4.2 4.2l1.7 1.7m12.2 12.2 1.7 1.7M1.8 12h2.4m15.6 0h2.4M4.2 19.8l1.7-1.7m12.2-12.2 1.7-1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.8 12h16.4M12 3.4c2.2 2.3 3.5 5.4 3.5 8.6S14.2 18.3 12 20.6M12 3.4C9.8 5.7 8.5 8.8 8.5 12s1.3 6.3 3.5 8.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M19.8 13.8A8.3 8.3 0 0 1 10.2 4.2a8.9 8.9 0 1 0 9.6 9.6Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.5"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" />
      <path d="m7 16 3.4-3.5 2.6 2.6L15.2 13 18 16" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ModelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 7.2 8-3.4 8 3.4-8 3.4zM4 11.6l8 3.4 8-3.4M4 16l8 3.4 8-3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function PromptIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M8.2 9.3h7.6m-7.6 3h6m-6 3h4.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 4 8 4-8 4-8-4zm8 7-8 4-8-4m16 5-8 4-8-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function RatioIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="6" width="17" height="12" rx="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.2 9.7 14.8 14.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.8v9.4m0 0-3.6-3.6m3.6 3.6 3.6-3.6M5 16.9h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M18.4 8.4A7 7 0 0 0 6.8 7.3M5.6 14.9a7 7 0 0 0 11.6 1.1M18.3 4.9v3.9h-3.9M5.7 19.1v-3.9h3.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResolutionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8.5h16m-16 7h16M8.2 4v16m7.6-16v16" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ResizeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 10.5V4h6.5M20 13.5V20h-6.5M20 10.5V4h-6.5M4 13.5V20h6.5M10 14 4 20M20 4l-6 6M14 10l6-6M4 4l6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArchiveBoxIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1H3V7z" fill="currentColor" opacity="0.4" />
      <path d="M3 8h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8zm6 5h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="archive-chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OpenViewerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
