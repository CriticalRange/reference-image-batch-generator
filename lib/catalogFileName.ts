/**
 * Catalogue SKU filenames: KA1801AG1.jpg, TVR1801BTG4.jpg
 * {2–3 letter prefix}{4 digits}{finish suffix}{optional source sequence}
 */

export const CATALOG_FINISH_SUFFIXES = ['ATG', 'BTG', 'DBG', 'AG', 'BG', 'BT', 'DB', 'A', 'B'] as const;

export type CatalogFinishSuffix = (typeof CATALOG_FINISH_SUFFIXES)[number];

export type ParsedCatalogSku = {
  prefix: string;
  digits: string;
  suffix: CatalogFinishSuffix;
  /** PREFIX + digits + suffix, e.g. KA1801AG */
  stem: string;
  sourceSequence?: number;
};

const SUFFIX_ALTERNATION = [...CATALOG_FINISH_SUFFIXES]
  .sort((a, b) => b.length - a.length)
  .join('|');

const CATALOG_SKU_PATTERN = new RegExp(
  `([A-Za-z]{2,3})(\\d{4})(${SUFFIX_ALTERNATION})(\\d+)?`,
  'i'
);

export function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '');
}

export function parseCatalogSku(fileName: string): ParsedCatalogSku | null {
  const baseName = stripFileExtension(fileName || '').trim();
  if (!baseName) {
    return null;
  }

  const match = baseName.match(CATALOG_SKU_PATTERN);
  if (!match) {
    return null;
  }

  const prefix = match[1].toUpperCase();
  const digits = match[2];
  const suffix = match[3].toUpperCase() as CatalogFinishSuffix;
  const sourceSequence = match[4] ? Number.parseInt(match[4], 10) : undefined;

  return {
    prefix,
    digits,
    suffix,
    stem: `${prefix}${digits}${suffix}`,
    sourceSequence: Number.isFinite(sourceSequence) ? sourceSequence : undefined
  };
}

/** Prefer a filename that already looks like a catalogue SKU (usually the variant product). */
export function pickCatalogSourceFileName(fileNames: Array<string | undefined | null>): string {
  const names = fileNames.map((name) => name?.trim() ?? '').filter(Boolean);
  for (let index = names.length - 1; index >= 0; index -= 1) {
    if (parseCatalogSku(names[index])) {
      return names[index];
    }
  }
  return names[names.length - 1] || names[0] || '';
}

export function buildCatalogOutputFileName(stem: string, sequence: number, fileExt: string): string {
  const safeStem = stem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
  const seq = Math.max(1, Math.round(sequence));
  const ext = fileExt.replace(/^\./, '').toLowerCase() || 'jpg';
  return `${safeStem}${seq}.${ext}`;
}
