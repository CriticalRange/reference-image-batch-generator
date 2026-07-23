'use client';

import '@/lib/i18n';
import { get, set } from 'idb-keyval';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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

type BatchStatusResponse = {
  jobId: string;
  state: string;
  stateLabel: string;
  stateDetail?: string;
  error?: string;
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
  referenceImages?: Array<{
    base64: string;
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
  generationConfig?: GenerationConfigSnapshot;
};

type HistoryStorageItem = Omit<HistoryItem, 'imageUrl'>;

type ArchiveItem = HistoryItem & {
  archivedAt: string;
};

type ArchiveStorageItem = Omit<ArchiveItem, 'imageUrl'>;

type ThemeMode = 'light' | 'dark';
type AuthModeOption = 'service_account' | 'api_key';
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
type ProductColorOption =
  | 'white'
  | 'white-body-travertine-doors'
  | 'anthracite'
  | 'anthracite-body-travertine-doors'
  | 'sapphire-oak-body-white-doors';
type PlexiglassOption = 'none' | 'gold-mirror' | 'silver-mirror';
type MountingOption = 'floor-standing' | 'wall-mounted';
type HandlePresenceOption = 'with-handle' | 'no-handle';
type RoomStyleOption = 'minimalist' | 'modern' | 'classic' | 'industrial';
type AccentColorOption = 'warm-beige' | 'soft-olive' | 'muted-terracotta' | 'slate-blue' | 'champagne-gold' | 'charcoal-grey';

const DEFAULT_COUNT = 1;
const DEFAULT_BATCH_RATE_LIMIT_SEC = 120;
const MAX_BATCH_REFERENCE_RETRIES = 1;
const MAX_BATCH_RATE_LIMIT_SEC = 600;
const MAX_HISTORY_ITEMS = 120;
const MAX_REFERENCE_IMAGES = 6;
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
const BATCH_MODE_STORAGE_KEY = 'reference-batch-batchmode-v1';
const BATCH_RATE_LIMIT_STORAGE_KEY = 'reference-batch-ratelimit-v1';
const LAST_PROMPT_STORAGE_KEY = 'reference-batch-last-prompt-v1';
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
const PRODUCT_COLOR_OPTIONS: ProductColorOption[] = [
  'white',
  'white-body-travertine-doors',
  'anthracite',
  'anthracite-body-travertine-doors',
  'sapphire-oak-body-white-doors'
];
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
  const [selectedProductColor, setSelectedProductColor] = useState<ProductColorOption | ''>('');
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
  const [pendingHistoryIds, setPendingHistoryIds] = useState<string[]>([]);
  const [isHistoryHydrated, setIsHistoryHydrated] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
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
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [authMode, setAuthMode] = useState<AuthModeOption>('service_account');
  const [modelOptions, setModelOptions] = useState<UiModelOption[]>(INITIAL_MODEL_OPTIONS);
  const [activeTab, setActiveTab] = useState<'generator' | 'history'>('generator');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([]);
  const [isArchiveHydrated, setIsArchiveHydrated] = useState(false);
  const [isArchiveSectionOpen, setIsArchiveSectionOpen] = useState(false);
  const [isHistoryViewerOpen, setIsHistoryViewerOpen] = useState(false);
  const [historyViewerIndex, setHistoryViewerIndex] = useState(0);
  const [isViewerPromptCollapsed, setIsViewerPromptCollapsed] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchRateLimitSec, setBatchRateLimitSec] = useState(DEFAULT_BATCH_RATE_LIMIT_SEC);
  const [batchRateLimitInput, setBatchRateLimitInput] = useState(String(DEFAULT_BATCH_RATE_LIMIT_SEC));
  const [batchRunResults, setBatchRunResults] = useState<BatchRunResult[]>([]);
  const [batchTotalRefs, setBatchTotalRefs] = useState(0);
  const historyObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const archiveObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const hasPromptHydratedRef = useRef(false);
  const lastBatchRunTimeRef = useRef<number>(0);
  const batchRunResultsRef = useRef<BatchRunResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const negativePromptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const historyGroups = useMemo(() => groupHistoryByDate(historyItems, language), [historyItems, language]);
  const modelGroups = useMemo(() => groupModelOptions(modelOptions), [modelOptions]);
  const selectedModelIsTogether = useMemo(() => isTogetherImageModelCode(selectedModel), [selectedModel]);
  const selectedModelIsVertex = useMemo(() => /^vertex\//i.test(selectedModel), [selectedModel]);
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
  const canAddReferenceImage = isBatchMode || referenceImages.length < MAX_REFERENCE_IMAGES;
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
  const historySlides = useMemo<Slide[]>(
    () =>
      historyItems.map((item, index) => ({
        src: item.imageUrl,
        alt: t('historySlideAlt', { index: index + 1 })
      })),
    [historyItems, t]
  );
  const activeHistoryItem = historyItems[historyViewerIndex];
  const newHistoryCount = useMemo(() => historyItems.filter((item) => item.isNew).length, [historyItems]);

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
    if (!isBatchMode) return null;
    const n = Number.parseInt(batchRateLimitInput, 10);
    if (!Number.isFinite(n)) return t('errorInvalidNumber');
    if (n < 0) return t('errorRateLimitMin');
    if (n > MAX_BATCH_RATE_LIMIT_SEC) return t('errorRateLimitMax');
    return null;
  }, [isBatchMode, batchRateLimitInput, t]);

  const canSubmit = useMemo(() => {
    return (
      prompt.trim().length > 0 &&
      !isLoading &&
      !countError &&
      !resizeWidthError &&
      !resizeHeightError &&
      !batchRateLimitError
    );
  }, [prompt, isLoading, countError, resizeWidthError, resizeHeightError, batchRateLimitError]);

  useEffect(() => {
    // Selecting product options overwrites the base prompt with the commercial catalogue template.
    if (!selectedProductColor) {
      return;
    }

    setPrompt(
      buildCommercialCataloguePrompt({
        color: selectedProductColor,
        plexiglass: selectedPlexiglass,
        mounting: selectedMounting,
        handlePresence: selectedHandlePresence,
        handle: handleDescription.trim() || DEFAULT_HANDLE_DESCRIPTION,
        roomStyle: selectedRoomStyle,
        accentColor: selectedAccentColor
      })
    );
  }, [
    selectedProductColor,
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

          setHistoryItems(sanitized);
        }
      } catch {
        toast.error(t('toastHistoryLoadFailed'), {
          description: t('toastHistoryLoadFailedDesc'),
          duration: 4500
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
        duration: 4500
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
    if (storedAuthMode === 'service_account' || storedAuthMode === 'api_key') {
      setAuthMode(storedAuthMode);
    }
    const stored = window.localStorage.getItem(BATCH_MODE_STORAGE_KEY);
    if (stored === 'true') setIsBatchMode(true);
    const storedLimit = window.localStorage.getItem(BATCH_RATE_LIMIT_STORAGE_KEY);
    if (storedLimit !== null) {
      const parsed = Number.parseInt(storedLimit, 10);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_BATCH_RATE_LIMIT_SEC) {
        setBatchRateLimitSec(parsed);
        setBatchRateLimitInput(String(parsed));
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTH_MODE_STORAGE_KEY, authMode);
  }, [authMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BATCH_MODE_STORAGE_KEY, String(isBatchMode));
    if (!isBatchMode) {
      setBatchRunResults([]);
      batchRunResultsRef.current = [];
    }
  }, [isBatchMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BATCH_RATE_LIMIT_STORAGE_KEY, String(batchRateLimitSec));
  }, [batchRateLimitSec]);

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
    if (historyItems.length === 0) {
      if (isHistoryViewerOpen) {
        setIsHistoryViewerOpen(false);
      }
      setHistoryViewerIndex(0);
      return;
    }

    if (historyViewerIndex > historyItems.length - 1) {
      setHistoryViewerIndex(historyItems.length - 1);
    }
  }, [historyItems.length, historyViewerIndex, isHistoryViewerOpen]);

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
    const viewedId = historyItems[historyViewerIndex]?.id;
    if (viewedId) {
      markHistoryItemAsViewed(viewedId);
    }
    // Intentionally excludes historyItems: we only want to run when the viewer
    // opens or the user navigates — not when items are updated as a result of
    // this very effect, which would cause an update loop.
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

  async function downloadBatchResults() {
    const results = batchRunResultsRef.current;
    if (results.length === 0) return;

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      for (const run of results) {
        const folderName = getBatchReferenceFolderName(run);
        const folder = zip.folder(folderName);
        if (!folder) continue;

        for (let i = 0; i < run.items.length; i++) {
          const item = run.items[i];
          const fileExt = mimeTypeToFileExtension(item.mimeType);
          folder.file(getHistoryImageDownloadName(item, i + 1, fileExt), item.imageBlob);
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${getDownloadBatchBaseName(results.flatMap((run) => run.items))}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('batchDownloadFailed'), { duration: 4000 });
    }
  }

  function openReferencePicker() {
    fileInputRef.current?.click();
  }

  function openHistoryViewer(itemId: string) {
    const targetIndex = historyItems.findIndex((item) => item.id === itemId);
    if (targetIndex < 0) {
      return;
    }

    markHistoryItemAsViewed(itemId);
    setHistoryViewerIndex(targetIndex);
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

  function downloadHistoryImage() {
    const item = activeHistoryItem;
    if (!item || typeof document === 'undefined') {
      return;
    }

    const fileExt = mimeTypeToFileExtension(item.mimeType);
    const anchor = document.createElement('a');
    anchor.href = item.imageUrl;
    anchor.download = getHistoryImageDownloadName(item, historyViewerIndex + 1, fileExt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
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
    const hasStoredReferenceMetadata = Array.isArray(config.referenceImages);
    const restoredSourceReferences = config.referenceImages ?? [];
    const restoredReferences = (isBatchMode ? restoredSourceReferences : restoredSourceReferences.slice(0, MAX_REFERENCE_IMAGES)).map((reference) => ({
      id: makeId(),
      base64: reference.base64,
      mimeType: reference.mimeType,
      previewDataUrl: `data:${reference.mimeType};base64,${reference.base64}`,
      fileName: reference.fileName ?? ''
    }));
    setReferenceImages(restoredReferences);
    setIsHistoryViewerOpen(false);

    if (!hasStoredReferenceMetadata) {
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

    const incomingFiles = Array.from(files);
    const availableSlots = isBatchMode ? incomingFiles.length : Math.max(0, MAX_REFERENCE_IMAGES - referenceImages.length);
    const selected = isBatchMode ? incomingFiles : incomingFiles.slice(0, availableSlots);

    if (selected.length === 0) {
      toast.error(t('toastReferenceLimitReached'), {
        description: t('toastReferenceLimitReachedDesc', { max: MAX_REFERENCE_IMAGES }),
        duration: 4500
      });
      return;
    }

    const createdReferences: ReferenceImage[] = [];

    for (const file of selected) {
      if (!ALLOWED_REFERENCE_MIME_TYPES.has(file.type.toLowerCase())) {
        setError(t('errorFailedReadImageFile'));
        toast.error(t('toastReferenceReadFailed'), {
          description: t('toastReferenceReadFailedDesc'),
          duration: 5000
        });
        continue;
      }

      if (file.size > MAX_REFERENCE_FILE_BYTES) {
        setError(t('payloadTooLarge'));
        toast.error(t('toastReferenceReadFailed'), {
          description: t('payloadTooLarge'),
          duration: 5000
        });
        continue;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const parsed = parseDataUrlImage(dataUrl);

      if (!parsed) {
        setError(t('errorFailedReadImageFile'));
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
      setReferenceImages((previous) => {
        const nextReferences = [...previous, ...createdReferences];
        return isBatchMode ? nextReferences : nextReferences.slice(0, MAX_REFERENCE_IMAGES);
      });
      setError('');
    }
  }

  function onReferenceDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsReferenceDragOver(true);
  }

  function onReferenceDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsReferenceDragOver(true);
  }

  function onReferenceDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsReferenceDragOver(false);
  }

  function onReferenceDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsReferenceDragOver(false);
    void handleFileInput(event.dataTransfer.files);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const submittedCount = Math.max(1, Math.min(count, 10));
    const submittedPrompt = prompt.trim();
    const submittedNegativePrompt = negativePrompt.trim();
    const submittedModel = selectedModel;
    const submittedAuthMode = authMode;
    const submittedIsVertex = /^vertex\//i.test(submittedModel);
    const submittedRefs = referenceImages.map((img) => ({ base64: img.base64, mimeType: img.mimeType, fileName: img.fileName }));

    if (!isBatchMode && submittedRefs.length > MAX_REFERENCE_IMAGES) {
      const message = t('errorReferenceLimitNormalMode', { max: MAX_REFERENCE_IMAGES });
      setError(message);
      toast.error(t('toastReferenceLimitReached'), {
        description: message,
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

    setIsLoading(true);
    setError('');
    setFailures([]);
    setBatchRunResults([]);
    batchRunResultsRef.current = [];

    // Calls /api/generate with the given refs, polls until done, returns structured output.
    async function callApiAndGetResults(
      refs: Array<{ base64: string; mimeType: string; fileName?: string }>,
      promptForRun = submittedPrompt
    ) {
      setStatusText(t('statusSubmitting', { count: submittedCount }));

      const submitResponse = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptForRun,
          negativePrompt: submittedNegativePrompt || undefined,
          count: submittedCount,
          model: submittedModel,
          authMode: submittedIsVertex ? submittedAuthMode : undefined,
          aspectRatio,
          steps: supportsTogetherSteps ? steps : undefined,
          imageSize: supportsResolutionSelector ? imageSize : undefined,
          resizeWidth: resolvedResize?.width,
          resizeHeight: resolvedResize?.height,
          aiUpscale: aiUpscale > 0 ? aiUpscale : undefined,
          referenceImages: refs
        })
      });

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
        setStatusText(t('statusBatchSubmitted'));
        const POLL_INTERVAL_MS = 5000;
        let finalStatus: BatchStatusResponse | undefined;

        while (true) {
          const statusResponse = await fetch(`/api/generate?job=${encodeURIComponent(jobId)}`);
          finalStatus = (await parseApiJsonOrThrow(statusResponse, '/api/generate')) as BatchStatusResponse;

          if (!statusResponse.ok) {
            throw new Error((finalStatus as unknown as { error?: string }).error ?? t('errorGenerationFailed'));
          }

          setStatusText(getBatchStatusText(finalStatus.state, finalStatus.stateLabel, finalStatus.stateDetail, t));
          if (isTerminalBatchState(finalStatus.state)) break;
          await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        if (!finalStatus || finalStatus.state !== 'succeeded') {
          throw new Error(finalStatus?.error?.trim() || `Batch job ${finalStatus?.stateLabel?.toLowerCase() ?? 'failed'}.`);
        }

        batchOutput = finalStatus.results as BatchOutputShape;
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
      if (usedModel && usedModel !== 'unknown-model') {
        const normalizedUsedModel = normalizeModelCode(usedModel);
        setSelectedModel(normalizedUsedModel);
        setModelOptions((previous) =>
          sortModelOptions(mergeModelOptions(previous, [{
            code: normalizedUsedModel,
            name: humanizeModelCode(normalizedUsedModel),
            group: inferModelGroup(normalizedUsedModel)
          }]))
        );
        return normalizedUsedModel;
      }
      return submittedModel;
    }

    if (isBatchMode && referenceImages.length > 0) {
      // Batch mode: one generation run per reference image with retry items inserted next in line.
      const totalRefs = referenceImages.length;
      const rateLimitMs = batchRateLimitSec * 1000;
      const queue: BatchQueueItem[] = referenceImages.map((ref, refIndex) => ({ ref, refIndex, attempt: 0 }));
      let processedAttempts = 0;
      setBatchTotalRefs(totalRefs);

      try {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;

          const { ref, refIndex, attempt } = item;
          const promptForRun = getBatchPromptForReference(submittedPrompt, refIndex);

          if (processedAttempts > 0) {
            const targetTime = lastBatchRunTimeRef.current + rateLimitMs;
            let remaining = targetTime - Date.now();
            while (remaining > 0) {
              const seconds = Math.ceil(remaining / 1000);
              setStatusText(t('batchRateLimitWait', { seconds }));
              await new Promise<void>((r) => setTimeout(r, Math.min(1000, remaining)));
              remaining = targetTime - Date.now();
            }
          }

          setStatusText(t('batchGeneratingStep', { current: Math.min(batchRunResultsRef.current.length + 1, totalRefs), total: totalRefs }));
          setPendingHistoryIds(Array.from({ length: submittedCount }, () => makeId()));

          const singleRefConfig: GenerationConfigSnapshot = {
            ...submittedConfig,
            basePrompt: promptForRun,
            referenceImages: [{ base64: ref.base64, mimeType: ref.mimeType, fileName: ref.fileName }]
          };

          try {
            const { outputResults, outputFailures, usedModel } = await callApiAndGetResults([
              { base64: ref.base64, mimeType: ref.mimeType }
            ], promptForRun);

            lastBatchRunTimeRef.current = Date.now();

            if (outputResults.length < submittedCount) {
              const firstFailure = outputFailures[0]?.error?.trim();
              throw new Error(firstFailure || `Generated ${outputResults.length} of ${submittedCount} requested image(s).`);
            }

            processedAttempts += 1;
            const resolvedUsedModel = applyUsedModel(usedModel);
            const historyConfig: GenerationConfigSnapshot = { ...singleRefConfig, model: resolvedUsedModel };

            if (outputFailures.length > 0) {
              setFailures((prev) => [
                ...prev,
                ...outputFailures.map((f) => ({ ...f, error: formatGenerationError(f.error, t) }))
              ]);
              toast.error(t('toastSomeVariantsFailed'), {
                description: t('toastSomeVariantsFailedDesc', { count: outputFailures.length }),
                duration: 4500
              });
            }

            let runItems: HistoryItem[] = [];
            if (outputResults.length > 0) {
              const createdAt = new Date().toISOString();
              runItems = await Promise.all(
                outputResults.map((entry) =>
                  createHistoryItemFromGenerationResult(entry, {
                    id: makeId(),
                    createdAt,
                    isNew: true,
                    generationConfig: historyConfig
                  })
                )
              );

              setHistoryItems((previous) => {
                const olderItems = previous.map((e) => ({ ...e, isNew: false }));
                return [...runItems, ...olderItems].slice(0, MAX_HISTORY_ITEMS);
              });

              toast.success(t('toastGenerationCompleted'), {
                description: t('toastGenerationCompletedDesc', { count: outputResults.length }),
                duration: 3000
              });
            }

            const runResult: BatchRunResult = {
              refIndex,
              refPreviewDataUrl: ref.previewDataUrl,
              refFileName: ref.fileName,
              items: runItems
            };
            batchRunResultsRef.current = [...batchRunResultsRef.current, runResult];
            setBatchRunResults([...batchRunResultsRef.current]);

          } catch (stepError) {
            lastBatchRunTimeRef.current = Date.now();
            processedAttempts += 1;
            const rawMessage = stepError instanceof Error ? stepError.message : t('unexpectedError');
            console.error('[batch-generate] step failed', { refIndex, attempt, error: stepError });
            const message = formatGenerationError(rawMessage, t);

            if (attempt < MAX_BATCH_REFERENCE_RETRIES) {
              queue.unshift({ ref, refIndex, attempt: attempt + 1 });
              toast.error(t('errorGenerationFailed'), {
                description: `${message} Retrying this product next.`,
                duration: 4500
              });
            } else {
              setError(message);
              setFailures((prev) => [
                ...prev,
                {
                  promptVariant: promptForRun,
                  error: message
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
              toast.error(t('errorGenerationFailed'), { description: message, duration: 6000 });
            }
          } finally {
            setPendingHistoryIds([]);
          }
        }

        setStatusText(t('batchComplete', { total: totalRefs }));
        if (totalRefs > 1) {
          toast.success(t('batchComplete', { total: totalRefs }), { duration: 5000 });
        }

        if (typeof window !== 'undefined' && window.innerWidth <= 980 && batchRunResultsRef.current.length > 0) {
          setActiveTab('history');
        }
      } finally {
        setIsLoading(false);
      }

    } else {
      // Normal single generation: all reference images in one call.
      setPendingHistoryIds(Array.from({ length: submittedCount }, () => makeId()));

      try {
        const { outputResults, outputFailures, succeededCount, failedCount, usedModel } =
          await callApiAndGetResults(submittedRefs);

        const resolvedUsedModel = applyUsedModel(usedModel);
        const historyConfig: GenerationConfigSnapshot = {
          ...submittedConfig,
          model: resolvedUsedModel,
          referenceImages: submittedRefs
        };

        setFailures(outputFailures.map((failure) => ({
          ...failure,
          error: formatGenerationError(failure.error, t)
        })));

        setStatusText(t('statusModelSummary', { model: usedModel, success: succeededCount, fail: failedCount }));

        if (outputResults.length > 0) {
          const createdAt = new Date().toISOString();
          const latestItems = await Promise.all(
            outputResults.map((entry) =>
              createHistoryItemFromGenerationResult(entry, {
                id: makeId(),
                createdAt,
                isNew: true,
                generationConfig: historyConfig
              })
            )
          );
          setHistoryItems((previous) => {
            const olderItems = previous.map((entry) => ({ ...entry, isNew: false }));
            return [...latestItems, ...olderItems].slice(0, MAX_HISTORY_ITEMS);
          });
        }

        if (outputResults.length > 0 && typeof window !== 'undefined' && window.innerWidth <= 980) {
          setActiveTab('history');
        }

        if (succeededCount > 0) {
          toast.success(t('toastGenerationCompleted'), {
            description: t('toastGenerationCompletedDesc', { count: succeededCount }),
            duration: 4200
          });
        }

        if (failedCount > 0) {
          toast.error(t('toastSomeVariantsFailed'), {
            description: t('toastSomeVariantsFailedDesc', { count: failedCount }),
            duration: 6500
          });
        }
      } catch (submitError) {
        const rawMessage = submitError instanceof Error ? submitError.message : t('unexpectedError');
        console.error('[generate] request failed', { error: submitError, rawMessage, selectedModel, submittedCount });
        const message = formatGenerationError(rawMessage, t);
        setStatusText(t('statusGenerationFailed'));
        setError(message);
        toast.error(t('errorGenerationFailed'), { description: message, duration: 8000 });
      } finally {
        setPendingHistoryIds([]);
        setIsLoading(false);
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
          {isLoading ? <p className="history-meta is-busy">{t('historyGeneratingMeta', { count: pendingHistoryIds.length || count })}</p> : null}
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

        {isBatchMode && (batchRunResults.length > 0 || isLoading) ? (
          <section className="batch-mode-panel">
            <div className="batch-mode-panel-head">
              <span className="batch-mode-panel-title">{t('batchPanelTitle')}</span>
              {isLoading ? (
                <span className="batch-mode-panel-status">
                  {t('batchStillGenerating', {
                    current: Math.min(batchRunResults.length + 1, batchTotalRefs),
                    total: batchTotalRefs
                  })}
                </span>
              ) : null}
            </div>
            {batchRunResults.length > 0 ? (
              <div className="batch-ref-thumbs">
                {batchRunResults.map((run) => (
                  <div key={run.refIndex} className="batch-ref-thumb">
                    <img src={run.refPreviewDataUrl} alt={`Ref ${run.refIndex + 1}`} />
                  </div>
                ))}
              </div>
            ) : null}
            {!isLoading && batchRunResults.length > 0 ? (
              <button
                type="button"
                className="batch-download-btn"
                onClick={() => { void downloadBatchResults(); }}
              >
                <DownloadIcon />
                {t('downloadBatchResults')}
              </button>
            ) : null}
          </section>
        ) : null}

        {!isHistoryHydrated ? (
          <p className="history-empty">{t('loadingHistory')}</p>
        ) : historyGroups.length === 0 && pendingHistoryIds.length === 0 ? (
          <p className="history-empty">{t('noHistory')}</p>
        ) : (
          <div className="history-list">
            {pendingHistoryIds.length > 0 ? (
              <section className="history-group history-group-pending">
                <h3 className="history-date">{t('generatingNow')}</h3>
                {statusText ? <p className="history-pending-status">{statusText}</p> : null}
                <div className="history-grid">
                  {pendingHistoryIds.map((pendingId, index) => (
                    <article className="history-item history-item-pending" key={pendingId} aria-hidden="true">
                      <div className="history-skeleton-thumb" />
                      <span className="history-pending-badge">{t('generatingIndex', { index: index + 1 })}</span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            {historyGroups.map((group) => (
              <section key={group.dateKey} className="history-group">
                <h3 className="history-date">{group.label}</h3>
                <div className="history-grid">
                  {group.items.map((item) => (
                    <article
                      className={`history-item${isSelectionMode && selectedHistoryIds.has(item.id) ? ' is-selected' : ''}`}
                      key={item.id}
                    >
                      <button
                        type="button"
                        className="history-open-btn"
                        onClick={() => isSelectionMode ? toggleSelectImage(item.id) : openHistoryViewer(item.id)}
                        aria-label={isSelectionMode ? t('selectImages') : t('openImageViewer')}
                        aria-pressed={isSelectionMode ? selectedHistoryIds.has(item.id) : undefined}
                      >
                        <img src={item.imageUrl} alt={t('historyResultAlt')} loading="lazy" />
                        {isSelectionMode ? (
                          <span className={`history-select-circle${selectedHistoryIds.has(item.id) ? ' is-selected' : ''}`} aria-hidden="true">
                            {selectedHistoryIds.has(item.id) ? <CheckIcon /> : null}
                          </span>
                        ) : (
                          <span className="history-open-indicator" aria-hidden="true">
                            <OpenViewerIcon />
                          </span>
                        )}
                      </button>
                      {item.isNew && !isSelectionMode ? <span className="new-badge">{t('newBadge')}</span> : null}
                    </article>
                  ))}
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
                        onClick={() => { window.open(item.imageUrl, '_blank'); }}
                        aria-label={t('openImageViewer')}
                      >
                        <img src={item.imageUrl} alt={t('historyResultAlt')} loading="lazy" />
                      </button>
                      <span className={`archive-ttl-badge${daysLeft <= 3 ? ' is-urgent' : ''}`}>
                        {daysLeft}{t('archiveDaysLabel')}
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
            <button
              type="button"
              className="theme-toggle icon-only"
              onClick={() => setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'))}
              aria-label={themeMode === 'dark' ? t('switchToLightMode') : t('switchToDarkMode')}
              title={themeMode === 'dark' ? t('switchToLightMode') : t('switchToDarkMode')}
            >
              {themeMode === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
            <button
              type="button"
              className={`batch-mode-toggle${isBatchMode ? ' is-active' : ''}`}
              onClick={() => setIsBatchMode((prev) => !prev)}
              aria-label={t('batchModeToggle')}
              title={t('batchModeToggle')}
            >
              {isBatchMode ? t('batchModeOn') : t('batchModeOff')}
            </button>
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

            {selectedModelIsVertex ? (
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
                  <option value="service_account">{t('authModeServiceAccount')}</option>
                  <option value="api_key">{t('authModeApiKey')}</option>
                </select>
                {authMode === 'api_key' ? <p className="reference-note">{t('authModeApiKeyHint')}</p> : null}
              </label>
            ) : null}

            <section className="reference-block">
              <div className="field-head">
                <GalleryIcon />
                <span>{isBatchMode ? t('referenceImagesBatch') : t('referenceImages')}</span>
                <InfoHint text={t('fieldInfo.referenceImages')} />
              </div>

              <div
                className={`reference-drop-surface${isReferenceDragOver ? ' is-drag-over' : ''}`}
                onDragOver={onReferenceDragOver}
                onDragEnter={onReferenceDragEnter}
                onDragLeave={onReferenceDragLeave}
                onDrop={onReferenceDrop}
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    openReferencePicker();
                  }
                }}
              >
                {referenceImages.length === 0 ? (
                  <button type="button" className="ref-add-primary" onClick={openReferencePicker} aria-label={t('addReferenceImage')}>
                    <PlusIcon />
                  </button>
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

                  {canAddReferenceImage ? (
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
                  ) : null}
                  </div>
                )}
              </div>

              <p className="reference-note">
                {isBatchMode
                  ? t('referenceSelectedCountBatch', { selected: referenceImages.length })
                  : t('referenceSelectedCount', { selected: referenceImages.length, max: MAX_REFERENCE_IMAGES })}
              </p>
              {isBatchMode ? (
                <p className="reference-note batch-mode-note">
                  {t('batchReferenceNote', { count: referenceImages.length })}
                </p>
              ) : null}
            </section>

            {isBatchMode ? (
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
            ) : null}

            <label htmlFor="prompt">
              <span className="field-head">
                <PromptIcon />
                <span>{t('basePrompt')}</span>
                <InfoHint text={t('fieldInfo.basePrompt')} />
              </span>
              <div className="inline-select-grid product-option-grid">
                <select
                  id="product-color"
                  value={selectedProductColor}
                  onChange={(event) => setSelectedProductColor(event.target.value as ProductColorOption | '')}
                  aria-label={t('productColorPlaceholder')}
                >
                  <option value="">{t('productColorPlaceholder')}</option>
                  {PRODUCT_COLOR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`productColorOptions.${option}`)}
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
                      setSelectedProductColor('');
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
                onChange={(event) => setCountInput(event.target.value)}
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
                      <span>{aiUpscale > 0 ? t('upscaling') : t('generating')}</span>
                      {statusText ? <span className="generate-btn-sub-label">{statusText}</span> : null}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="generate-btn-icon" aria-hidden="true">✨</span>
                    <span>{t('generate')}</span>
                  </>
                )}
              </motion.span>
            </motion.button>
          </form>
        </section>

        {error ? <p className="error">{error}</p> : null}
        {statusText ? <p className="subtitle">{statusText}</p> : null}

        {failures.length > 0 ? (
          <section className="panel" style={{ marginTop: '1rem' }}>
            <div className="form">
              <strong>{t('failedVariants')}</strong>
              {failures.map((failure, index) => (
                <p className="error" key={`${failure.promptVariant}-${index}`}>
                  {index + 1}. {failure.error}
                </p>
              ))}
            </div>
          </section>
        ) : null}

      </section>

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
        close={() => setIsHistoryViewerOpen(false)}
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
  metadata: Pick<HistoryItem, 'id' | 'createdAt' | 'isNew' | 'generationConfig'>
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
    generationConfig: metadata.generationConfig
  };
}

function toHistoryStorageItem(item: HistoryItem): HistoryStorageItem {
  const { imageUrl: _imageUrl, ...rest } = item;
  return rest;
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

function getHistoryImageDownloadName(item: HistoryItem, index: number, fileExt: string): string {
  const baseName = getReferenceBaseName(item);
  const createdKey = item.createdAt.slice(0, 10);
  const suffix = String(Math.max(1, index)).padStart(2, '0');
  return `${baseName}-${createdKey}-${suffix}.${fileExt}`;
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

function getBatchReferenceFolderName(run: BatchRunResult): string {
  const safeName = getReferenceGroupingCode(run.refFileName ?? '');
  const fallback = `ref-${String(run.refIndex + 1).padStart(2, '0')}`;
  return safeName || fallback;
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '');
}

function getReferenceGroupingCode(fileName: string): string {
  const baseName = stripFileExtension(fileName).trim();
  const match = baseName.match(/^[A-Za-z]+\d+/);
  return sanitizeDownloadName(match?.[0] ?? baseName);
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

function groupHistoryByDate(items: HistoryItem[], language: 'tr' | 'en'): Array<{ dateKey: string; label: string; items: HistoryItem[] }> {
  const grouped = new Map<string, HistoryItem[]>();

  for (const item of items) {
    const dateKey = item.createdAt.slice(0, 10);
    const group = grouped.get(dateKey) ?? [];
    group.push(item);
    grouped.set(dateKey, group);
  }

  return Array.from(grouped.entries()).map(([dateKey, groupItems]) => ({
    dateKey,
    label: new Date(dateKey).toLocaleDateString(resolveDateLocale(language), {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }),
    items: groupItems
  }));
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

  return {
    id: record.id,
    createdAt: record.createdAt,
    isNew: record.isNew,
    promptVariant: record.promptVariant,
    mimeType,
    imageBlob,
    imageUrl: URL.createObjectURL(imageBlob),
    generationConfig: hasValidConfig ? (configValue as GenerationConfigSnapshot | undefined) : undefined
  };
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
        return (
          typeof referenceRecord.base64 === 'string' &&
          typeof referenceRecord.mimeType === 'string' &&
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
    if (!option.group.toLowerCase().includes('together')) {
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
  isPromptCollapsed: boolean;
  onToggleCollapsed: () => void;
};

function HistoryViewerHeader({ item, onDownload, onRegenerate, isPromptCollapsed, onToggleCollapsed }: HistoryViewerHeaderProps) {
  const { t } = useTranslation();

  if (!item) {
    return null;
  }

  const config = item.generationConfig;
  const generatedDescription = item.promptVariant.trim() || config?.basePrompt?.trim() || t('historyViewer');

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

  const currentHeight = element.offsetHeight;
  element.style.height = 'auto';
  const targetHeight = element.scrollHeight;
  element.style.height = `${currentHeight}px`;

  requestAnimationFrame(() => {
    element.style.height = `${targetHeight}px`;
  });
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

function getBatchStatusText(
  state: string,
  stateLabel: string,
  stateDetail: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const detailSuffix = stateDetail ? ` • ${stateDetail}` : '';

  switch (state) {
    case 'pending': return `${t('statusBatchPending')}${detailSuffix}`;
    case 'running': return `${t('statusBatchRunning')}${detailSuffix}`;
    case 'succeeded': return `${t('statusBatchSucceeded')}${detailSuffix}`;
    default: return stateLabel;
  }
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

function buildCommercialCataloguePrompt(input: {
  color: ProductColorOption;
  plexiglass: PlexiglassOption;
  mounting: MountingOption;
  handlePresence: HandlePresenceOption;
  handle: string;
  roomStyle: RoomStyleOption;
  accentColor: AccentColorOption;
}): string {
  const productColorVariant = resolveProductColorVariantText(input.color);
  const decorativePlexiglass = resolvePlexiglassText(input.plexiglass);
  const mountingType = resolveMountingTypeText(input.mounting);
  const mountingPlacement = resolveMountingPlacementText(input.mounting);
  const mountingVisibility = resolveMountingVisibilityText(input.mounting);
  const mountingAvoid = resolveMountingAvoidText(input.mounting);
  const hasHandle = input.handlePresence === 'with-handle';
  const handlePresenceLabel = hasHandle ? 'WITH HANDLE' : 'NO HANDLE';
  const handleDesign = hasHandle ? input.handle.trim() || DEFAULT_HANDLE_DESCRIPTION : 'NONE — this product has no handle';
  const handleInstructions = hasHandle
    ? `The handle must match the reference design, scale and position. It must be physically attached to the door, correctly aligned with the decorative pattern and shown without gaps or intersecting geometry.

Any circular design surrounding the handle must remain flat and parallel to the door surface. Do not interpret it as a convex bump, dome, thick disk, raised rosette, inflated shape or protruding ornament.

When the circular design is part of the laser pattern, engrave it 1 mm into the door surface.`
    : `This product has NO handle. Do not invent, add, attach or imply any handle, pull, knob, bar, recessed grip or handle hardware. Keep doors clean according to the reference without hardware additions.`;
  const productPartsVisibility = hasHandle
    ? `${mountingVisibility}, handles, doors and outer edges`
    : `${mountingVisibility}, doors and outer edges (no handles)`;
  const handleAvoid = hasHandle
    ? 'extra handles, detached handles'
    : 'any invented handles, knobs, pulls, handle hardware, recessed grips that are not in the reference';
  const handleClosing = hasHandle
    ? 'correct handle construction'
    : 'no handles (handleless product)';
  const roomStyle = resolveRoomStyleDescription(input.roomStyle);
  const accentColor = resolveAccentColorText(input.accentColor);
  const preserveParts = hasHandle
    ? 'top surface, legs, handles, laser patterns'
    : 'top surface, legs, laser patterns (and no handles)';

  return `Create a photorealistic, high-end commercial interior image featuring the provided furniture product.

Use the reference image strictly for the product’s geometry, proportions, construction and decorative placement. Preserve the original body dimensions, door count, panel divisions, ${preserveParts} and all pattern positions exactly as shown. Do not redesign, simplify, reinterpret or add new details to the product.

Product color variant: ${productColorVariant}

Decorative plexiglass option: ${decorativePlexiglass}

Mounting / installation: ${mountingType}

${mountingPlacement}

Handle presence: ${handlePresenceLabel}

Handle design and color: ${handleDesign}

Room style: ${roomStyle}

Accent color: ${accentColor}

Apply each specified color and material only to its assigned furniture part. Do not transfer the door color or texture to the body, top surface, legs or other components. Preserve the product’s true color under all lighting conditions.

Reproduce all laser patterns exactly as shown in the product reference. Every laser line must be engraved exactly 1 mm into the door surface. The lines must appear as narrow, precise recessed grooves physically integrated into the material. They must not appear raised, embossed, printed, painted, attached, floating, excessively wide or excessively deep.

${handleInstructions}

When the selected product includes gold or silver mirror plexiglass, create it as a thin, flat mirrored plexiglass detail closely fitted to the door surface. Keep its thickness visually minimal. Do not make it rounded, inflated, heavily bevelled or excessively raised.

Use decorative plexiglass only when the selected product option includes it. Do not automatically add plexiglass to circular patterns, laser lines, handles or other product areas.

Do not use glass anywhere on the furniture.

Use a natural full-frame commercial photography look with an approximately 42 mm lens. Position the camera at human eye level, keep architectural vertical lines straight and avoid wide-angle distortion. Show the complete product clearly, including ${productPartsVisibility}. Leave comfortable negative space around the product and create natural foreground, midground and background depth.

Illuminate the interior with soft, diffused skylight. Use portal lighting at the windows or openings to guide naturally reflected and surface-bounced daylight into the room. Allow the daylight to spread indirectly after reflecting from the walls, floor and surrounding surfaces, creating soft illumination, realistic ambient depth and a calm atmospheric effect.

Use a subtle sky-toned ambient fill in the room and background without creating an artificial blue cast on the furniture. Add a warm floor lamp as a low-intensity fill light to gently lift dark areas and soften shadows around the product.

Balance the cool skylight, neutral bounced daylight and warm floor-lamp illumination naturally. The lighting must create a welcoming ambience while remaining physically believable and visually unobtrusive. Avoid harsh direct sunlight, hard shadows, clipped highlights and dramatic studio lighting.

Keep the indirect daylight neutral and preserve the exact product colors and material appearance. Do not allow strong blue, yellow or orange color casts to alter the furniture.

Use realistic contact shadows, soft shadow transitions, natural indirect illumination and physically believable reflections. The lighting should feel atmospheric and naturally present rather than visibly staged.

Use realistic furniture materials with subtle surface texture. White and anthracite surfaces must look like premium furniture finishes rather than plastic. Sapphire oak surfaces must show correctly oriented natural wood grain and slight tonal variation. Travertine doors must show restrained natural pores, veins and mineral variation without exaggerated contrast. Gold and silver mirror plexiglass must show controlled reflections without looking like glass, chrome or liquid metal.

Place the product in a professionally styled, premium neutral interior resembling a high-end furniture catalogue photograph. Add a limited number of intentionally placed decorative elements such as plants, books, ceramics, artwork, textiles, a rug or a floor lamp. Keep the room elegant, balanced and uncluttered so the furniture remains the main subject.

Include subtle realism through natural material variation, soft contact shadows and minor surface imperfections. Nothing should look overly smooth, artificial, distorted or factory-generated.

Avoid incorrect proportions, changed door divisions, altered laser patterns, additional patterns, ${handleAvoid}, ${mountingAvoid}, thick circular ornaments, raised laser lines, automatic plexiglass additions, glass panels, plastic-looking surfaces, excessive reflections, texture stretching, oversaturated colors, harsh lighting, excessive bloom, strong vignette, rendering noise and unrealistic decoration.

The final image must resemble a professionally photographed premium furniture catalogue image, with accurate product geometry, clearly visible 1 mm recessed laser engraving, ${handleClosing}, correct ${mountingType.toLowerCase()} installation, optional flat mirror plexiglass details, natural indirect daylight and a refined atmospheric interior.`;
}

function resolveProductColorVariantText(color: ProductColorOption): string {
  switch (color) {
    case 'white':
      return 'WHITE';
    case 'white-body-travertine-doors':
      return 'WHITE BODY WITH TRAVERTINE DOORS';
    case 'anthracite':
      return 'ANTHRACITE';
    case 'anthracite-body-travertine-doors':
      return 'ANTHRACITE BODY WITH TRAVERTINE DOORS';
    case 'sapphire-oak-body-white-doors':
      return 'SAPPHIRE OAK BODY WITH WHITE DOORS';
  }
}

function resolvePlexiglassText(option: PlexiglassOption): string {
  switch (option) {
    case 'none':
      return 'NONE';
    case 'gold-mirror':
      return 'GOLD MIRROR PLEXIGLASS';
    case 'silver-mirror':
      return 'SILVER MIRROR PLEXIGLASS';
  }
}

function resolveMountingTypeText(mounting: MountingOption): string {
  switch (mounting) {
    case 'floor-standing':
      return 'FLOOR-STANDING WITH LEGS';
    case 'wall-mounted':
      return 'WALL-MOUNTED';
  }
}

function resolveMountingPlacementText(mounting: MountingOption): string {
  switch (mounting) {
    case 'floor-standing':
      return 'Installation: The product is freestanding / floor-standing on its own legs. All legs must rest firmly on the floor with realistic contact shadows. Do not mount the product on the wall. Do not hide, crop, or remove the legs.';
    case 'wall-mounted':
      return 'Installation: The product is wall-mounted, fixed flat against the wall at a realistic height. It must not rest on the floor and must not appear freestanding. Keep a clear gap between the product underside and the floor. Do not invent freestanding legs if the reference is wall-mounted.';
  }
}

function resolveMountingVisibilityText(mounting: MountingOption): string {
  switch (mounting) {
    case 'floor-standing':
      return 'all legs';
    case 'wall-mounted':
      return 'the full wall-mounted body and underside clearance';
  }
}

function resolveMountingAvoidText(mounting: MountingOption): string {
  switch (mounting) {
    case 'floor-standing':
      return 'floating legs, wall-mounted installation, missing legs, legs that do not touch the floor';
    case 'wall-mounted':
      return 'freestanding placement, floor-standing legs that rest on the floor, floating without wall attachment, incorrect wall height';
  }
}

function resolveRoomStyleDescription(scene: RoomStyleOption): string {
  switch (scene) {
    case 'minimalist':
      return 'a calm minimalist interior with clean lines, soft daylight, uncluttered composition and refined negative space';
    case 'modern':
      return 'a refined modern interior with geometric balance, polished contemporary surfaces and elegant understated styling';
    case 'classic':
      return 'a classic elegant interior with warm traditional detailing, soft ambient light and timeless refined proportions';
    case 'industrial':
      return 'an industrial loft interior with raw textures, metal accents, weathered materials and understated contemporary character';
  }
}

function resolveAccentColorText(accent: AccentColorOption): string {
  switch (accent) {
    case 'warm-beige':
      return 'warm beige';
    case 'soft-olive':
      return 'soft olive';
    case 'muted-terracotta':
      return 'muted terracotta';
    case 'slate-blue':
      return 'slate blue';
    case 'champagne-gold':
      return 'champagne gold';
    case 'charcoal-grey':
      return 'charcoal grey';
  }
}

function isTerminalBatchState(state: string): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'expired';
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

function InfoHint({ text }: { text: string }) {
  return (
    <span className="info-hint" tabIndex={0} aria-label={text}>
      <InfoIcon />
      <span className="info-hint-tooltip" role="tooltip">
        {text}
      </span>
    </span>
  );
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

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
      <path d="M12 11.3v5.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
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
