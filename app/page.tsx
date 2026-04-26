'use client';

import '@/lib/i18n';
import { get, set } from 'idb-keyval';
import { motion } from 'framer-motion';
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
  normalizeModelCode,
  sortModelOptions,
  type UiModelOption
} from '@/lib/modelOptions';

type GenerationResult = {
  promptVariant: string;
  imageBase64: string;
  mimeType: string;
};

type GenerationFailure = {
  promptVariant: string;
  error: string;
};

type ReferenceImage = {
  id: string;
  base64: string;
  mimeType: string;
  previewDataUrl: string;
};

type GenerationConfigSnapshot = {
  basePrompt: string;
  model: string;
  aspectRatio: string;
  imageSize?: string;
  resizePreset?: ResizePresetOption;
  resizeWidth?: number;
  resizeHeight?: number;
  requestedCount: number;
  referenceImages?: Array<{
    base64: string;
    mimeType: string;
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

type ThemeMode = 'light' | 'dark';
type AspectRatioOption = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
type ResolutionOption = '512' | '1K' | '2K' | '4K';
type ResizePresetOption = 'none' | '2000x3000' | '1536x2048' | '1696x2528' | '2048x2048' | 'custom';

const DEFAULT_COUNT = 1;
const MAX_HISTORY_ITEMS = 120;
const MAX_REFERENCE_IMAGES = 6;
const MIN_RESIZE_DIMENSION = 64;
const MAX_RESIZE_DIMENSION = 8192;
const DEFAULT_CUSTOM_RESIZE_WIDTH = 2000;
const DEFAULT_CUSTOM_RESIZE_HEIGHT = 3000;
const HISTORY_STORAGE_KEY = 'reference-batch-history-v1';
const THEME_STORAGE_KEY = 'reference-batch-theme-v1';
const LANGUAGE_STORAGE_KEY = 'reference-batch-language-v1';
const DEFAULT_MODEL = process.env.NEXT_PUBLIC_GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const RESOLUTION_OPTIONS: ResolutionOption[] = ['512', '1K', '2K', '4K'];
const RESIZE_PRESET_OPTIONS: Array<Exclude<ResizePresetOption, 'custom'>> = ['none', '2000x3000', '1536x2048', '1696x2528', '2048x2048'];
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
  const [count, setCount] = useState(DEFAULT_COUNT);
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
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('1:1');
  const [imageSize, setImageSize] = useState<ResolutionOption>('1K');
  const [resizePreset, setResizePreset] = useState<ResizePresetOption>('none');
  const [customResizeWidth, setCustomResizeWidth] = useState(DEFAULT_CUSTOM_RESIZE_WIDTH);
  const [customResizeHeight, setCustomResizeHeight] = useState(DEFAULT_CUSTOM_RESIZE_HEIGHT);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [modelOptions, setModelOptions] = useState<UiModelOption[]>(INITIAL_MODEL_OPTIONS);
  const [isHistoryViewerOpen, setIsHistoryViewerOpen] = useState(false);
  const [historyViewerIndex, setHistoryViewerIndex] = useState(0);
  const historyObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyGroups = useMemo(() => groupHistoryByDate(historyItems, language), [historyItems, language]);
  const modelGroups = useMemo(() => groupModelOptions(modelOptions), [modelOptions]);
  const supportsResolutionSelector = useMemo(() => modelSupportsImageSize(selectedModel), [selectedModel]);
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
  const historySlides = useMemo<Slide[]>(
    () =>
      historyItems.map((item, index) => ({
        src: item.imageUrl,
        alt: t('historySlideAlt', { index: index + 1 })
      })),
    [historyItems, t]
  );
  const activeHistoryItem = historyItems[historyViewerIndex];

  const canSubmit = useMemo(() => {
    return prompt.trim().length > 0 && !isLoading;
  }, [prompt, isLoading]);

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

  function openReferencePicker() {
    fileInputRef.current?.click();
  }

  function openHistoryViewer(itemId: string) {
    const targetIndex = historyItems.findIndex((item) => item.id === itemId);
    if (targetIndex < 0) {
      return;
    }

    setHistoryViewerIndex(targetIndex);
    setIsHistoryViewerOpen(true);
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
    const createdKey = item.createdAt.slice(0, 10);
    const anchor = document.createElement('a');
    anchor.href = item.imageUrl;
    anchor.download = `history-${createdKey}-${historyViewerIndex + 1}.${fileExt}`;
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
    setAspectRatio(toAspectRatioOption(config.aspectRatio));
    setImageSize(toResolutionOption(config.imageSize));
    const restoredResizePreset = toResizePresetOption(config.resizePreset, config.resizeWidth, config.resizeHeight);
    setResizePreset(restoredResizePreset);
    if (restoredResizePreset === 'custom') {
      setCustomResizeWidth(clampResizeDimension(config.resizeWidth ?? DEFAULT_CUSTOM_RESIZE_WIDTH));
      setCustomResizeHeight(clampResizeDimension(config.resizeHeight ?? DEFAULT_CUSTOM_RESIZE_HEIGHT));
    }
    setCount(Math.max(1, Math.min(Number(config.requestedCount) || DEFAULT_COUNT, 10)));
    const hasStoredReferenceMetadata = Array.isArray(config.referenceImages);
    const restoredReferences = (config.referenceImages ?? []).slice(0, MAX_REFERENCE_IMAGES).map((reference) => ({
      id: makeId(),
      base64: reference.base64,
      mimeType: reference.mimeType,
      previewDataUrl: `data:${reference.mimeType};base64,${reference.base64}`
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
    const availableSlots = Math.max(0, MAX_REFERENCE_IMAGES - referenceImages.length);
    const selected = incomingFiles.slice(0, availableSlots);

    if (selected.length === 0) {
      toast.error(t('toastReferenceLimitReached'), {
        description: t('toastReferenceLimitReachedDesc', { max: MAX_REFERENCE_IMAGES }),
        duration: 4500
      });
      return;
    }

    const createdReferences: ReferenceImage[] = [];

    for (const file of selected) {
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
        previewDataUrl: dataUrl
      });
    }

    if (createdReferences.length > 0) {
      setReferenceImages((previous) => [...previous, ...createdReferences].slice(0, MAX_REFERENCE_IMAGES));
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
    setIsLoading(true);
    setError('');
    setStatusText(t('statusSubmitting', { count: submittedCount }));
    setFailures([]);
    setPendingHistoryIds(Array.from({ length: submittedCount }, () => makeId()));
    const submittedConfig: GenerationConfigSnapshot = {
      basePrompt: prompt.trim(),
      model: selectedModel,
      aspectRatio,
      ...(supportsResolutionSelector ? { imageSize } : {}),
      resizePreset,
      ...(resolvedResize ? { resizeWidth: resolvedResize.width, resizeHeight: resolvedResize.height } : {}),
      requestedCount: submittedCount,
      referenceImages: referenceImages.map((image) => ({
        base64: image.base64,
        mimeType: image.mimeType
      }))
    };

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          count: submittedCount,
          model: selectedModel,
          aspectRatio,
          imageSize: supportsResolutionSelector ? imageSize : undefined,
          resizeWidth: resolvedResize?.width,
          resizeHeight: resolvedResize?.height,
          referenceImages: referenceImages.map((image) => ({
            base64: image.base64,
            mimeType: image.mimeType
          }))
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? t('errorGenerationFailed'));
      }

      const outputResults = (payload.results ?? []) as GenerationResult[];
      const outputFailures = (payload.failures ?? []) as GenerationFailure[];
      const successCount = Number(payload.succeededCount ?? outputResults.length);
      const failCount = Number(payload.failedCount ?? outputFailures.length);
      const usedModel = String(payload.usedModel ?? 'unknown-model');
      if (usedModel && usedModel !== 'unknown-model') {
        const normalizedUsedModel = normalizeModelCode(usedModel);
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
      }

      setFailures(outputFailures);
      setStatusText(
        t('statusModelSummary', {
          model: usedModel,
          success: successCount,
          fail: failCount
        })
      );
      if (outputResults.length > 0) {
        const createdAt = new Date().toISOString();
        const resolvedHistoryModel = usedModel && usedModel !== 'unknown-model' ? normalizeModelCode(usedModel) : submittedConfig.model;
        const historyConfig: GenerationConfigSnapshot = {
          ...submittedConfig,
          model: resolvedHistoryModel
        };
        setHistoryItems((previous) => {
          const olderItems = previous.map((entry) => ({ ...entry, isNew: false }));
          const latestItems = outputResults.map((entry) =>
            createHistoryItemFromGenerationResult(entry, {
              id: makeId(),
              createdAt,
              isNew: true,
              generationConfig: historyConfig
            })
          );

          return [...latestItems, ...olderItems].slice(0, MAX_HISTORY_ITEMS);
        });
      }
      if (successCount > 0) {
        toast.success(t('toastGenerationCompleted'), {
          description: t('toastGenerationCompletedDesc', { count: successCount }),
          duration: 4200
        });
      }

      if (failCount > 0) {
        toast.error(t('toastSomeVariantsFailed'), {
          description: t('toastSomeVariantsFailedDesc', { count: failCount }),
          duration: 6500
        });
      }
    } catch (submitError) {
      const rawMessage = submitError instanceof Error ? submitError.message : t('unexpectedError');
      const message = formatGenerationError(rawMessage, t);
      setStatusText(t('statusGenerationFailed'));
      setError(message);
      toast.error(t('errorGenerationFailed'), {
        description: message,
        duration: 8000
      });
    } finally {
      setPendingHistoryIds([]);
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="panel history-tab">
        <div className="history-head">
          <h2 className="history-title">{t('history')}</h2>
          <p className={`history-meta${isLoading ? ' is-busy' : ''}`}>
            {t('historyImageCount', { count: historyItems.length })}
            {isLoading ? ` • ${t('historyGeneratingMeta', { count: pendingHistoryIds.length || count })}` : ''}
          </p>
        </div>

        {!isHistoryHydrated ? (
          <p className="history-empty">{t('loadingHistory')}</p>
        ) : historyGroups.length === 0 && pendingHistoryIds.length === 0 ? (
          <p className="history-empty">{t('noHistory')}</p>
        ) : (
          <div className="history-list">
            {pendingHistoryIds.length > 0 ? (
              <section className="history-group history-group-pending">
                <h3 className="history-date">{t('generatingNow')}</h3>
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
                    <article className="history-item" key={item.id}>
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
                      {item.isNew ? <span className="new-badge">{t('newBadge')}</span> : null}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </aside>

      <section className="workspace">
        <div className="workspace-top">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={themeMode === 'dark' ? t('switchToLightMode') : t('switchToDarkMode')}
          >
            {themeMode === 'dark' ? <SunIcon /> : <MoonIcon />}
            <span>{themeMode === 'dark' ? t('lightMode') : t('darkMode')}</span>
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setLanguage((current) => (current === 'tr' ? 'en' : 'tr'))}
            aria-label={t('switchLanguage')}
          >
            <span>{language.toUpperCase()}</span>
          </button>
        </div>

        <h1>{t('appTitle')}</h1>
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
              </span>
              <select id="model-selector" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                {modelGroups.map((group) => (
                  <optgroup key={group.group} label={translateModelGroup(group.group, t)}>
                    {group.options.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name} ({option.code})
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

                  {referenceImages.length < MAX_REFERENCE_IMAGES ? (
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
                {t('referenceSelectedCount', { selected: referenceImages.length, max: MAX_REFERENCE_IMAGES })}
              </p>
            </section>

            <label htmlFor="prompt">
              <span className="field-head">
                <PromptIcon />
                <span>{t('basePrompt')}</span>
              </span>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t('promptPlaceholder')}
              />
            </label>

            <label htmlFor="count">
              <span className="field-head">
                <LayersIcon />
                <span>{t('numberOfVariants')}</span>
              </span>
              <input
                id="count"
                type="number"
                min={1}
                max={10}
                value={count}
                onChange={(event) => setCount(Number.parseInt(event.target.value, 10) || DEFAULT_COUNT)}
              />
            </label>

            <label htmlFor="aspect-ratio">
              <span className="field-head">
                <RatioIcon />
                <span>{t('aspectRatio')}</span>
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

            {supportsResolutionSelector ? (
              <label htmlFor="image-size">
                <span className="field-head">
                  <ResolutionIcon />
                  <span>{t('resolution')}</span>
                </span>
                <select
                  id="image-size"
                  value={imageSize}
                  onChange={(event) => setImageSize(event.target.value as ResolutionOption)}
                >
                  {RESOLUTION_OPTIONS.map((option) => (
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
                    value={customResizeWidth}
                    onChange={(event) =>
                      setCustomResizeWidth(clampResizeDimension(Number.parseInt(event.target.value, 10) || DEFAULT_CUSTOM_RESIZE_WIDTH))
                    }
                  />
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
                    value={customResizeHeight}
                    onChange={(event) =>
                      setCustomResizeHeight(clampResizeDimension(Number.parseInt(event.target.value, 10) || DEFAULT_CUSTOM_RESIZE_HEIGHT))
                    }
                  />
                </label>
              </div>
            ) : null}

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
              {isLoading ? (
                <>
                  <span className="generate-btn-spinner" aria-hidden="true" />
                  <span>{t('generating')}</span>
                </>
              ) : (
                <>
                  <span className="generate-btn-icon" aria-hidden="true">✨</span>
                  <span>{t('generate')}</span>
                </>
              )}
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
          spacing: '22%'
        }}
        on={{
          view: ({ index }) => setHistoryViewerIndex(index)
        }}
        render={{
          slideHeader: () => (
            <HistoryViewerHeader
              item={activeHistoryItem}
              onDownload={downloadHistoryImage}
              onRegenerate={applyRegenerateConfiguration}
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

function createHistoryItemFromGenerationResult(
  result: GenerationResult,
  metadata: Pick<HistoryItem, 'id' | 'createdAt' | 'isNew' | 'generationConfig'>
): HistoryItem {
  const imageBlob = base64ToBlob(result.imageBase64, result.mimeType);
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
        return typeof referenceRecord.base64 === 'string' && typeof referenceRecord.mimeType === 'string';
      }));
  const hasValidResizePreset =
    typeof record.resizePreset === 'undefined' || (typeof record.resizePreset === 'string' && isResizePresetOption(record.resizePreset));
  const hasResizeWidth = typeof record.resizeWidth === 'number';
  const hasResizeHeight = typeof record.resizeHeight === 'number';
  const hasValidResizePair = (!hasResizeWidth && !hasResizeHeight) || (hasResizeWidth && hasResizeHeight);
  return (
    typeof record.basePrompt === 'string' &&
    typeof record.model === 'string' &&
    typeof record.aspectRatio === 'string' &&
    (typeof record.imageSize === 'undefined' || typeof record.imageSize === 'string') &&
    typeof record.requestedCount === 'number' &&
    hasValidResizePreset &&
    hasValidResizePair &&
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
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview'
  ];
  const recommendedRank = new Map<string, number>(recommendedCodes.map((code, index) => [code, index]));
  const isRecommended = (option: UiModelOption): boolean => {
    const code = option.code.toLowerCase();
    if (option.group.toLowerCase().includes('together') || code.startsWith('qwen/')) {
      return false;
    }

    return code.startsWith('gemini-3') || recommendedRank.has(code);
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
  for (const option of options.filter((entry) => !isRecommended(entry))) {
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
};

function HistoryViewerHeader({ item, onDownload, onRegenerate }: HistoryViewerHeaderProps) {
  const { t } = useTranslation();

  if (!item) {
    return null;
  }

  const config = item.generationConfig;
  const imageSizePart = config?.imageSize ? t('historyViewerImageSizePart', { size: config.imageSize }) : '';
  const configSummary = config
    ? t('historyViewerConfigSummary', {
        model: config.model,
        aspect: config.aspectRatio,
        imageSize: imageSizePart,
        count: config.requestedCount,
        refs: config.referenceImages?.length ?? 0,
        resize: describeResize(config.resizeWidth, config.resizeHeight, t)
      })
    : t('historyViewerNoConfig');

  return (
    <div className="history-viewer-header">
      <div className="history-viewer-meta">
        <strong>{t('historyViewer')}</strong>
        <span>{configSummary}</span>
        {config?.basePrompt ? <em>{config.basePrompt}</em> : null}
      </div>

      <div className="history-viewer-actions">
        <button type="button" className="history-viewer-download" onClick={onDownload}>
          {t('download')}
        </button>
        <button type="button" className="history-viewer-regenerate" onClick={onRegenerate}>
          {t('regenerate')}
        </button>
      </div>
    </div>
  );
}

function toAspectRatioOption(value: string): AspectRatioOption {
  const match = ASPECT_RATIO_OPTIONS.find((option) => option === value);
  return match ?? '1:1';
}

function toResolutionOption(value: string | undefined): ResolutionOption {
  if (!value) {
    return '1K';
  }

  const match = RESOLUTION_OPTIONS.find((option) => option === value);
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

  return 'none';
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

  if (trimmed.includes('Generation failed for all variants.')) {
    return t('allVariantsFailed');
  }

  if (trimmed.includes('Generated payload too large')) {
    return t('payloadTooLarge');
  }

  return trimmed;
}

function resolveDateLocale(language: 'tr' | 'en'): string {
  return language === 'tr' ? 'tr-TR' : 'en-US';
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
    'Imagen',
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

function OpenViewerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
