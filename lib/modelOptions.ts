export type UiModelOption = {
  code: string;
  name: string;
  group: string;
};

const MODELS_PREFIX = 'models/';

export const CURATED_MODEL_OPTIONS: UiModelOption[] = [
  { name: 'Nano Banana 2', code: 'gemini-3.1-flash-image-preview', group: 'Gemini Image' },
  { name: 'Gemini 3 Pro Image Preview', code: 'gemini-3-pro-image-preview', group: 'Gemini Image' },
  { name: 'Gemini 2.5 Flash Image', code: 'gemini-2.5-flash-image', group: 'Gemini Image' },
  { name: 'Gemini 2.0 Flash Image Preview', code: 'gemini-2.0-flash-preview-image-generation', group: 'Gemini Image' },
  { name: 'Qwen Image 2.0 Pro', code: 'Qwen/Qwen-Image-2.0-Pro', group: 'Together AI' },
  { name: 'FLUX.2 Dev', code: 'black-forest-labs/FLUX.2-dev', group: 'Together AI' },
  { name: 'FLUX.1 Schnell', code: 'black-forest-labs/FLUX.1-schnell', group: 'Together AI' },
  { name: 'FLUX.1 Kontext Pro', code: 'black-forest-labs/FLUX.1-kontext-pro', group: 'Together AI' },
  { name: 'FLUX.1 Kontext Max', code: 'black-forest-labs/FLUX.1-kontext-max', group: 'Together AI' },
  { name: 'FLUX.1 Krea Dev', code: 'black-forest-labs/FLUX.1-krea-dev', group: 'Together AI' },
  { name: 'Imagen 4 Fast (Together)', code: 'google/imagen-4.0-fast', group: 'Together AI' },
  { name: 'GPT Image 1.5', code: 'openai/gpt-image-1.5', group: 'Together AI' },
  { name: 'Nano Banana', code: 'google/flash-image-2.5', group: 'Together AI' },
  { name: 'Nano Banana 2', code: 'google/flash-image-3.1', group: 'Together AI' },
  { name: 'Ideogram 3.0', code: 'ideogram/ideogram-v3.0', group: 'Together AI' },
  { name: 'Imagen 4 Ultra', code: 'imagen-4.0-ultra-generate-001', group: 'Imagen' },
  { name: 'Imagen 4', code: 'imagen-4.0-generate-001', group: 'Imagen' },
  { name: 'Imagen 4 Fast', code: 'imagen-4.0-fast-generate-001', group: 'Imagen' },
  { name: 'Imagen 3 Capability', code: 'imagen-3.0-capability-001', group: 'Imagen' },
  { name: 'Gemini 3.1 Pro Preview', code: 'gemini-3.1-pro-preview', group: 'Gemini Pro Preview' },
  { name: 'Gemini 3 Pro Preview', code: 'gemini-3-pro-preview', group: 'Gemini Pro Preview' },
  { name: 'Gemini 3 Flash Preview', code: 'gemini-3-flash-preview', group: 'Gemini Flash Preview' },
  { name: 'Gemini 3.1 Flash Lite Preview', code: 'gemini-3.1-flash-lite-preview', group: 'Gemini Flash Lite Preview' },
  { name: 'Gemini 2.5 Flash Lite Preview', code: 'gemini-2.5-flash-lite-preview-09-2025', group: 'Gemini Flash Lite Preview' },
  { name: 'Gemini 2.5 Flash Preview', code: 'gemini-2.5-flash-preview-09-2025', group: 'Gemini Flash Preview' }
];

const GROUP_ORDER = [
  'Gemini Image',
  'Together AI',
  'Imagen',
  'Gemini Pro Preview',
  'Gemini Flash Preview',
  'Gemini Flash Lite Preview',
  'Gemini',
  'Other'
];

export function normalizeModelCode(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith(MODELS_PREFIX) ? trimmed.slice(MODELS_PREFIX.length) : trimmed;
}

export function mergeModelOptions(...lists: UiModelOption[][]): UiModelOption[] {
  const merged = new Map<string, UiModelOption>();

  for (const list of lists) {
    for (const entry of list) {
      const code = normalizeModelCode(entry.code);
      if (!code) {
        continue;
      }

      const next: UiModelOption = {
        code,
        name: entry.name.trim() || humanizeModelCode(code),
        group: entry.group.trim() || inferModelGroup(code)
      };

      const previous = merged.get(code);
      if (!previous) {
        merged.set(code, next);
        continue;
      }

      const resolved: UiModelOption = {
        code,
        name: previous.name === humanizeModelCode(code) ? next.name : previous.name,
        group: previous.group === 'Other' ? next.group : previous.group
      };
      merged.set(code, resolved);
    }
  }

  return Array.from(merged.values());
}

export function sortModelOptions(options: UiModelOption[]): UiModelOption[] {
  const order = new Map<string, number>(GROUP_ORDER.map((group, index) => [group, index]));
  return [...options].sort((a, b) => {
    const aRank = order.get(a.group) ?? Number.MAX_SAFE_INTEGER;
    const bRank = order.get(b.group) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }

    return a.name.localeCompare(b.name);
  });
}

export function inferModelGroup(code: string): string {
  if (
    /^qwen\/qwen-image/i.test(code) ||
    /qwen-image/i.test(code) ||
    /^black-forest-labs\/flux/i.test(code) ||
    /^google\/imagen-/i.test(code) ||
    /^google\/flash-image-/i.test(code) ||
    /^openai\/gpt-image-/i.test(code) ||
    /^ideogram\//i.test(code)
  ) {
    return 'Together AI';
  }

  if (/^imagen-/i.test(code)) {
    return 'Imagen';
  }

  if (/flash-image|image-preview|image-generation/i.test(code)) {
    return 'Gemini Image';
  }

  if (/flash-lite/i.test(code)) {
    return 'Gemini Flash Lite Preview';
  }

  if (/flash-preview|flash/i.test(code)) {
    return 'Gemini Flash Preview';
  }

  if (/pro-preview|pro/i.test(code)) {
    return 'Gemini Pro Preview';
  }

  if (/^gemini-/i.test(code)) {
    return 'Gemini';
  }

  return 'Other';
}

export function humanizeModelCode(code: string): string {
  const slashSeparated = code.split('/');
  if (slashSeparated.length === 2) {
    return slashSeparated[1].replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return code
    .replace(/^gemini-/i, 'Gemini ')
    .replace(/^imagen-/i, 'Imagen ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function modelSupportsImageSize(model: string): boolean {
  return /^gemini-3/i.test(model);
}

export function isTogetherImageModelCode(model: string): boolean {
  const code = normalizeModelCode(model);
  return inferModelGroup(code) === 'Together AI';
}

export function modelSupportsTogetherSteps(model: string): boolean {
  const code = normalizeModelCode(model);
  return (
    /^black-forest-labs\/FLUX\.1-schnell$/i.test(code) ||
    /^black-forest-labs\/FLUX\.1-kontext-(pro|max)$/i.test(code) ||
    /^black-forest-labs\/FLUX\.1-krea-dev$/i.test(code)
  );
}

export function modelLooksImageCapable(model: string): boolean {
  return /^imagen-/i.test(model) || /image|imagen|flux/i.test(model);
}
