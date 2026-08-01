/**
 * Per-reference furniture analysis (Gemini Flash vision).
 * Predictions are constrained to the same dropdown enums as the base-prompt form.
 */

export type ProductColorOption =
  | 'white'
  | 'white-body-travertine-doors'
  | 'anthracite'
  | 'anthracite-body-travertine-doors'
  | 'sapphire-oak-body-white-doors'
  | 'alina-walnut-laser';

export type PlexiglassOption = 'none' | 'gold-mirror' | 'silver-mirror';
export type MountingOption = 'floor-standing' | 'wall-mounted';
export type HandlePresenceOption = 'with-handle' | 'no-handle';
export type RoomStyleOption = 'minimalist' | 'modern' | 'classic' | 'industrial';
export type AccentColorOption =
  | 'warm-beige'
  | 'soft-olive'
  | 'muted-terracotta'
  | 'slate-blue'
  | 'champagne-gold'
  | 'charcoal-grey';

export const PRODUCT_COLOR_VALUES: ProductColorOption[] = [
  'white',
  'white-body-travertine-doors',
  'anthracite',
  'anthracite-body-travertine-doors',
  'sapphire-oak-body-white-doors',
  'alina-walnut-laser'
];
export const PLEXIGLASS_VALUES: PlexiglassOption[] = ['none', 'gold-mirror', 'silver-mirror'];
export const MOUNTING_VALUES: MountingOption[] = ['floor-standing', 'wall-mounted'];
export const HANDLE_PRESENCE_VALUES: HandlePresenceOption[] = ['with-handle', 'no-handle'];
export const ROOM_STYLE_VALUES: RoomStyleOption[] = ['minimalist', 'modern', 'classic', 'industrial'];
export const ACCENT_COLOR_VALUES: AccentColorOption[] = [
  'warm-beige',
  'soft-olive',
  'muted-terracotta',
  'slate-blue',
  'champagne-gold',
  'charcoal-grey'
];

/** Catalog product types used in the shop (UI + AI must pick only these). */
export type ProductTypeOption =
  | 'console'
  | 'dresser'
  | 'tv_unit'
  | 'tv_wall_mounted'
  | 'tv_stand'
  | 'tv_with_top_shelf';

export const PRODUCT_TYPE_VALUES: ProductTypeOption[] = [
  'console',
  'dresser',
  'tv_unit',
  'tv_wall_mounted',
  'tv_stand',
  'tv_with_top_shelf'
];

export type ReferenceAnalysis = {
  productType: ProductTypeOption;
  productTypeLabel: string;
  /** Same enum as base-prompt product color dropdown */
  productColor: ProductColorOption;
  mounting: MountingOption;
  plexiglass: PlexiglassOption;
  handlePresence: HandlePresenceOption;
  /** Only free-text allowed field (optional handle description) */
  handleDescription: string;
  roomStyle: RoomStyleOption;
  accentColor: AccentColorOption;
  hasLaserPatterns: boolean;
  doorCount: number | null;
  /**
   * Visible freestanding leg count from the reference.
   * Always null when mounting is wall-mounted (no legs).
   */
  legCount: number | null;
  /**
   * Short free-text layout of freestanding legs (positions), empty when no legs.
   * Example: "2 left + 2 right + 1 center-front only (no rear center)".
   */
  legLayout: string;
  confidence: number;
  notes: string;
  prompt: string;
};

export type ReferenceAnalysisDraft = Omit<ReferenceAnalysis, 'prompt'> & {
  prompt?: string;
};

const COLOR_MATERIALS: Record<
  ProductColorOption,
  { body: string; door: string; top: string; legs: string; summary: string }
> = {
  white: {
    body: 'matte white premium furniture lacquer',
    door: 'matte white premium furniture lacquer',
    top: 'matte white premium furniture lacquer',
    legs: 'as shown in the reference (match white / metal finish)',
    summary: 'All-white lacquer furniture'
  },
  'white-body-travertine-doors': {
    body: 'matte white premium furniture lacquer',
    door: 'natural travertine stone-look doors',
    top: 'matte white premium furniture lacquer',
    legs: 'as shown in the reference',
    summary: 'White body with travertine doors'
  },
  anthracite: {
    body: 'anthracite premium furniture finish',
    door: 'anthracite premium furniture finish',
    top: 'anthracite premium furniture finish',
    legs: 'as shown in the reference (match anthracite / metal finish)',
    summary: 'All-anthracite furniture'
  },
  'anthracite-body-travertine-doors': {
    body: 'anthracite premium furniture finish',
    door: 'natural travertine stone-look doors',
    top: 'anthracite premium furniture finish',
    legs: 'as shown in the reference',
    summary: 'Anthracite body with travertine doors'
  },
  'sapphire-oak-body-white-doors': {
    body: 'sapphire oak wood veneer with natural grain',
    door: 'matte white premium furniture lacquer',
    top: 'sapphire oak wood veneer with natural grain',
    legs: 'as shown in the reference',
    summary: 'Sapphire oak body with white doors'
  },
  'alina-walnut-laser': {
    body: 'Alina walnut wood veneer with warm natural grain',
    door: 'Alina walnut wood veneer with warm natural grain and laser-engraved decorative patterns',
    top: 'Alina walnut wood veneer with warm natural grain',
    legs: 'as shown in the reference (match walnut / metal finish)',
    summary: 'Alina walnut with laser patterns'
  }
};

const PRODUCT_TYPE_LABELS_EN: Record<ProductTypeOption, string> = {
  console: 'Console',
  dresser: 'Dresser',
  tv_unit: 'TV unit',
  tv_wall_mounted: 'Wall-mounted TV unit',
  tv_stand: 'TV stand / coffee TV table',
  tv_with_top_shelf: 'TV unit with top shelf'
};

const PRODUCT_TYPE_LABELS_TR: Record<ProductTypeOption, string> = {
  console: 'Konsol',
  dresser: 'Dresuar',
  tv_unit: 'TV Ünitesi',
  tv_wall_mounted: 'TV Duvara Monte',
  tv_stand: 'TV Sehpası',
  tv_with_top_shelf: 'TV Üst Raflı'
};

const ANALYSIS_SYSTEM = `You are a furniture product photo analyst for premium e-commerce catalogue generation.
Analyze the single furniture product in the image. Ignore background as product identity.

Return ONLY valid JSON (no markdown) with exactly these keys and ONLY the allowed enum values:
{
  "productType": "console|dresser|tv_unit|tv_wall_mounted|tv_stand|tv_with_top_shelf",
  "productColor": "white|white-body-travertine-doors|anthracite|anthracite-body-travertine-doors|sapphire-oak-body-white-doors|alina-walnut-laser",
  "mounting": "floor-standing|wall-mounted",
  "plexiglass": "none|gold-mirror|silver-mirror",
  "handlePresence": "with-handle|no-handle",
  "handleDescription": "short description if handles exist, else empty string",
  "roomStyle": "minimalist|modern|classic|industrial",
  "accentColor": "warm-beige|soft-olive|muted-terracotta|slate-blue|champagne-gold|charcoal-grey",
  "hasLaserPatterns": boolean,
  "doorCount": number or null,
  "legCount": number or null,
  "legLayout": "short description of freestanding leg positions, or empty string",
  "confidence": 0.0-1.0,
  "notes": "short caveats if uncertain"
}

CRITICAL — productType must be ONE of these six catalog types only (Turkish shop names in parentheses):
- console (Konsol): short/wide console table, hallway/living console, low long body, not primarily a TV unit
- dresser (Dresuar): taller storage chest/dresser for bedroom/hallway, higher than a console, multiple drawers/doors stacked
- tv_unit (TV Ünitesi): floor TV cabinet/unit designed to hold a TV, typically wider low media furniture (not wall-hung)
- tv_wall_mounted (TV Duvara Monte): wall-mounted TV panel/unit with clear wall installation and floor clearance (no freestanding legs supporting full weight)
- tv_stand (TV Sehpası): TV stand / low TV table / media table, often more open or lighter than a full TV unit
- tv_with_top_shelf (TV Üst Raflı): TV unit that includes a distinct upper shelf / top shelf structure above the main body

CRITICAL — productColor must be ONE of the six catalog variants only. Do NOT invent free-text colors like "light grey" or "beige matte".
Pick the closest catalog match:
- white: overall white body+doors
- white-body-travertine-doors: white body, travertine/stone-look doors
- anthracite: overall dark grey/anthracite
- anthracite-body-travertine-doors: anthracite body, travertine doors
- sapphire-oak-body-white-doors: oak/wood body, white doors
- alina-walnut-laser: Alina walnut (ceviz) finish overall, typically with laser-engraved decorative patterns — prefer hasLaserPatterns true

Rules:
- Do not invent product types outside the six enums. Prefer the closest match.
- mounting: legs visible on floor → floor-standing; clearly wall-hung with underside clearance → wall-mounted. tv_wall_mounted should usually pair with wall-mounted.
- legCount + legLayout (CRITICAL — count AND place carefully; do not invent):
  * Count EVERY freestanding leg/foot/support post that reaches the floor (metal pins, wood legs, tapered feet, mid supports).
  * INCLUDE rear corner legs even if partially hidden by perspective when the design has corner legs.
  * Continuous plinth / full-width base skirting with NO separate legs → legCount = 0, legLayout = "" or "plinth only".
  * Wall-mounted / fully floating with no floor supports → legCount = null, legLayout = "".
  * Do NOT count handles, laser grooves, door panels, or side walls as legs.
  * Do not leave legCount null for floor-standing products that clearly have freestanding legs.

  GENERAL FURNITURE LEG KNOWLEDGE (use only when the photo matches — not every product is like this):
  * Common 4-leg: one near each corner (front-left, front-right, rear-left, rear-right).
  * Common 5-leg: four corner legs PLUS one extra support under the CENTER FRONT only. There is often NO center-rear leg. Do not “complete” it to 6.
  * Common 6-leg: four corners PLUS center-front AND center-rear.
  * If a mid support is visible only under the front apron/middle front, count it and set legLayout accordingly (e.g. "2 left + 2 right + 1 center-front only; no center-rear"). Do NOT invent a matching rear mid leg.
  * If only corner legs exist, legCount is usually 4 — do not invent a center leg.
  * legLayout: brief English positions string (empty when no freestanding legs). Prefer phrases like "four corners", "four corners + center-front only", "four corners + center-front + center-rear", "two front legs only".
- plexiglass: only gold-mirror / silver-mirror if clearly visible; else none. Never invent.
- handlePresence: with-handle only if handles are visible.
- doorCount: optional approximate door/panel count when obvious, else null (not critical).
- roomStyle / accentColor: best fit for a catalogue scene (not free text).
- Do not invent laser patterns or hardware.`;

export const ANALYSIS_SYSTEM_PROMPT = ANALYSIS_SYSTEM;

export function buildAnalysisUserText(fileName?: string): string {
  const name = fileName?.trim() ? ` Filename: ${fileName.trim()}.` : '';
  return `Analyze this furniture product reference photo.${name} Return JSON only using the allowed enum values.`;
}

export function resolveColorMaterials(productColor: ProductColorOption) {
  return COLOR_MATERIALS[productColor];
}

export function productTypeLabel(type: ProductTypeOption, language: 'tr' | 'en' = 'tr'): string {
  return language === 'en' ? PRODUCT_TYPE_LABELS_EN[type] : PRODUCT_TYPE_LABELS_TR[type];
}

export function parseAnalysisJson(raw: string): ReferenceAnalysisDraft {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const productType = normalizeProductType(parsed.productType ?? parsed.productTypeLabel);
  const productColor = normalizeProductColor(parsed.productColor ?? parsed.colorVariant ?? parsed.color);
  const mounting = normalizeEnum(parsed.mounting, MOUNTING_VALUES, 'floor-standing');
  const plexiglass = normalizePlexiglass(parsed.plexiglass);
  const handlePresence = normalizeHandlePresence(parsed.handlePresence);
  const roomStyle = normalizeEnum(parsed.roomStyle, ROOM_STYLE_VALUES, 'modern');
  const accentColor = normalizeEnum(parsed.accentColor, ACCENT_COLOR_VALUES, 'warm-beige');
  const confidence = clamp01(
    typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence)
  );

  return {
    productType,
    productTypeLabel: productTypeLabel(productType, 'tr'),
    productColor,
    mounting,
    plexiglass,
    handlePresence,
    handleDescription: String(parsed.handleDescription ?? '').trim(),
    roomStyle,
    accentColor,
    hasLaserPatterns: Boolean(parsed.hasLaserPatterns),
    doorCount: normalizeDoorCount(parsed.doorCount),
    legCount: normalizeLegCount(parsed.legCount, mounting),
    legLayout: normalizeLegLayout(parsed.legLayout, mounting, parsed.legCount),
    confidence,
    notes: String(parsed.notes ?? '').trim()
  };
}

export function finalizeAnalysis(draft: ReferenceAnalysisDraft): ReferenceAnalysis {
  const productType = normalizeProductType(draft.productType ?? draft.productTypeLabel);
  const productColor = normalizeProductColor(draft.productColor);
  const mounting = normalizeEnum(draft.mounting, MOUNTING_VALUES, 'floor-standing');
  const plexiglass = normalizePlexiglass(draft.plexiglass);
  const handlePresence = normalizeHandlePresence(draft.handlePresence);
  const roomStyle = normalizeEnum(draft.roomStyle, ROOM_STYLE_VALUES, 'modern');
  const accentColor = normalizeEnum(draft.accentColor, ACCENT_COLOR_VALUES, 'warm-beige');
  const legCount = normalizeLegCount(draft.legCount, mounting);

  const normalized: Omit<ReferenceAnalysis, 'prompt'> = {
    productType,
    productTypeLabel: productTypeLabel(productType, 'tr'),
    productColor,
    mounting,
    plexiglass,
    handlePresence,
    handleDescription: String(draft.handleDescription ?? '').trim(),
    roomStyle,
    accentColor,
    hasLaserPatterns: Boolean(draft.hasLaserPatterns),
    doorCount: normalizeDoorCount(draft.doorCount),
    // Wall-mounted / no freestanding legs → leg count is disabled (null).
    legCount,
    legLayout: normalizeLegLayout(draft.legLayout, mounting, legCount),
    confidence: clamp01(draft.confidence),
    notes: String(draft.notes ?? '').trim()
  };

  return {
    ...normalized,
    prompt: buildCommercialCataloguePromptFromAnalysis(normalized)
  };
}

function normalizeDoorCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(20, Math.round(value)));
  }
  return null;
}

/** Wall-mounted products never carry a freestanding leg count. */
function normalizeLegCount(value: unknown, mounting: MountingOption): number | null {
  if (mounting === 'wall-mounted') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(12, Math.round(value)));
  }
  return null;
}

function normalizeLegLayout(
  value: unknown,
  mounting: MountingOption,
  legCount: unknown
): string {
  if (mounting === 'wall-mounted') {
    return '';
  }
  const count =
    typeof legCount === 'number' && Number.isFinite(legCount) ? Math.round(legCount) : null;
  if (count === 0) {
    return '';
  }
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 180);
  return text;
}

export function buildCommercialCataloguePromptFromAnalysis(
  analysis: Omit<ReferenceAnalysis, 'prompt'>
): string {
  const colors = resolveColorMaterials(analysis.productColor);
  const mountingBlock = buildMountingBlock(analysis.mounting, analysis.legCount);
  const handleBlock =
    analysis.handlePresence === 'with-handle'
      ? `Preserve all visible handles and hardware exactly as shown${
          analysis.handleDescription ? ` (${analysis.handleDescription})` : ''
        }. Do not invent handles, knobs, pulls, recessed grips or other hardware.`
      : `This product is handleless / no handles in the reference. Do not add invented handles, knobs, pulls, recessed grips or other hardware.`;

  const plexiBlock =
    analysis.plexiglass === 'none'
      ? `Do not add plexiglass or gold/silver mirror overlays (none in the reference).`
      : analysis.plexiglass === 'gold-mirror'
        ? `Gold mirror plexiglass is present: thin separate layer on the door front, slightly proud of the surface — never recessed/embedded/carved. Preserve gold tone; no blown white glare.`
        : `Silver mirror plexiglass is present: thin separate layer on the door front, slightly proud of the surface — never recessed/embedded/carved. Preserve silver tone; no blown white glare.`;

  const laserBlock = analysis.hasLaserPatterns
    ? `Reproduce every laser pattern exactly: each line is a narrow ~1 mm recessed groove engraved into the door — not raised, embossed, printed or thickened. Do not invent extra laser patterns.`
    : `No laser patterns in the reference — do not invent engraving or decorative grooves.`;

  const hasLegs = analysis.mounting !== 'wall-mounted' && analysis.legCount != null && analysis.legCount > 0;
  const legsMaterial = !hasLegs
    ? analysis.mounting === 'wall-mounted'
      ? 'n/a — wall-mounted (no floor legs)'
      : 'n/a — no freestanding legs (plinth/base only as in reference)'
    : colors.legs;

  const legsBlock = buildLegsBlock(
    analysis.mounting,
    analysis.legCount,
    analysis.legLayout,
    legsMaterial
  );

  const layoutNote = analysis.legLayout?.trim()
    ? ` Layout: ${analysis.legLayout.trim()}.`
    : '';

  const productIdentity = [
    `Product type: ${analysis.productTypeLabel} (${analysis.productType}).`,
    analysis.legCount != null && analysis.mounting !== 'wall-mounted'
      ? `HARD LEG COUNT: ${analysis.legCount}.${layoutNote}`
      : analysis.mounting === 'wall-mounted'
        ? 'HARD LEG COUNT: 0 / none (wall-mounted).'
        : '',
    `Catalog color variant: ${analysis.productColor} — ${colors.summary}.`,
    `Body: ${colors.body}.`,
    `Doors: ${colors.door}.`,
    `Top: ${colors.top}.`,
    `Installation: ${analysis.mounting}.`,
    `Room style: ${analysis.roomStyle}. Accent: ${analysis.accentColor.replace(/-/g, ' ')}.`
  ]
    .filter(Boolean)
    .join(' ');

  const legGenerateLine =
    analysis.mounting === 'wall-mounted'
      ? 'No freestanding legs.'
      : analysis.legCount != null && analysis.legCount > 0
        ? `EXACTLY ${analysis.legCount} freestanding legs (no more, no fewer)${
            analysis.legLayout?.trim() ? `; positions: ${analysis.legLayout.trim()}` : ''
          }. Do not invent extra mid/rear supports not in the reference.`
        : analysis.legCount === 0
          ? 'No freestanding legs (plinth/base only).'
          : 'Match reference freestanding leg count and positions exactly.';

  // Keep this template concise: API allows a finite prompt budget; avoid repeating the same rules.
  return `Create a photorealistic premium furniture catalogue image of the provided product.

<main>
Reference image is ground truth for geometry, proportions, construction, installation, colors, materials and decorative placement.
Preserve body dimensions, silhouette, top, handles, patterns, legs/base and mounting exactly. Prefer reference over any conflicting text.
Do not redesign, stretch, squash, invent details, or invent free-form colors outside the catalog variant.
Product identity: ${productIdentity}
</main>

<installation>
Catalog installation: ${analysis.mounting}. Match the reference exactly; never convert installation type.
${mountingBlock}
</installation>

${legsBlock}

<composition>
Full product in frame (body, doors, edges, legs/base or wall clearance). Keep true proportions — never stretch a low console into a tall cabinet/wardrobe.
~42–50 mm commercial look, natural camera height for ${analysis.productTypeLabel}, straight verticals, no wide-angle distortion.
Product is the hero with comfortable negative space and natural depth. All freestanding legs must be fully visible where the reference shows them.
</composition>

<laser_patterns>
${laserBlock}
</laser_patterns>

<plexiglass>
Add plexiglass only where clearly present in the reference. Never invent overlays on laser lines, handles or patterns.
${plexiBlock}
No bright white glare, blown specular hotspots or exaggerated room reflections on mirrors.
</plexiglass>

<materials>
Keep body/doors/top/legs materials separate — never transfer door finish onto body/top/legs.
Catalog under all lighting — Body: ${colors.body}. Doors: ${colors.door}. Top: ${colors.top}. Legs/base: ${legsMaterial}.
White/anthracite: premium matte-satin furniture finish (not plastic). Sapphire oak / Alina walnut: correct grain, restrained tone. Travertine: subtle pores/veins, no stretched texture. Mirror plexi: controlled metal-mirror, not glass/chrome/liquid metal. No transparent glass on the furniture.
${handleBlock}
</materials>

<interior>
${analysis.roomStyle} neutral catalogue interior with ${analysis.accentColor.replace(/-/g, ' ')} accents.
Beige/greige/soft-grey matte plaster walls (not reflective white that floods light). Mid-tone neutral wood or concrete floor — avoid pure white floors.
Sparse decor (books, ceramics, art, textile, plant). Optional floor lamp is a practical object only, not a second key light. Rug may not hide legs/base/floor contact. Do not block product details. Wall-mounted pieces: no objects under them that look like supports.
</interior>

<lighting>
Use one coherent, directional daylight hierarchy.

KEY: one large soft overcast window light from one front-side and slightly above the product. Create a clearly illuminated side, gradual tonal transition and visibly darker shadow side. No hard sun, flat frontal light or second key.

PORTAL / SKY: guide exterior daylight naturally through the window, with only a restrained cool-neutral sky tone in indirect shadows. No blue cast, glowing window, excessive skylight or HDR wash.

FILL: use low neutral bounce only to recover essential shadow detail. Preserve panel separation, corner depth, soft ambient occlusion, floor contact and shadows beneath the body and legs. Do not brighten the shadow side to match the key side.

GRAZING: use subtle side-grazing daylight from the same window direction to reveal existing wood grain, travertine texture, laser patterns and plexiglass edges. Do not invent or exaggerate surface depth.

RIM: allow only faint natural edge separation where needed. No halo, neon outline or bright border.

PRACTICAL: any visible lamp stays dim and warm and must not become a second key light.

EXPOSURE: use medium-low premium catalogue exposure with controlled highlight roll-off. Keep whites clean and detailed, anthracite deep but readable, materials accurately colored and specular reflections broad and restrained. Use a clean near-white background with slight tonal separation from the product.

All shadows, highlights and reflections must follow the same window direction. No blown highlights, glowing whites, flat illumination, milky shadows, excessive fill, heavy bloom or high-key wash.
</lighting>

<avoid>
Wrong proportions/category (this is a ${analysis.productTypeLabel}), invented hardware, wrong leg count or mounting${
    analysis.legCount != null && analysis.legCount > 0
      ? ` (ILLEGAL: ${analysis.legCount - 1} legs, ${analysis.legCount + 1} legs, merged plinth instead of ${analysis.legCount} separate legs)`
      : ''
  }, recessed/embedded plexiglass, chrome/liquid-metal mirrors, free-form recolor, heavy grade/WB shifts, dual keys, high fill that erases shadows, over-bright bounce, milky midtones, plastic surfaces, strong vignette, noise.
</avoid>

GENERATE. Same product identity, geometry, construction, installation and composition as the reference. ${legGenerateLine} Use one directional soft window key, restrained portal-guided sky tone, low fill, subtle grazing detail, faint natural edge separation, protected highlights and preserved contact shadows. Clean near-white background — no clipped whites, flat shading or high-key wash.`;
}

function buildLegsBlock(
  mounting: MountingOption,
  legCount: number | null,
  legLayout: string,
  legsMaterial: string
): string {
  const generalKnowledge = `General note (only if the reference matches — not every product): common patterns are 4 corner legs; 5 legs = 4 corners + 1 center-FRONT only (no automatic center-rear); 6 legs = 4 corners + center-front + center-rear. Never invent a missing mid/rear leg to “balance” the design.`;

  if (mounting === 'wall-mounted') {
    return `<legs>
HARD CONSTRAINT: wall-mounted product — ZERO freestanding legs. No legs, feet, pins, plinths or pedestals. Underside clearance only with soft shadow under the body.
</legs>`;
  }
  if (legCount != null && legCount > 0) {
    const layoutLine = legLayout.trim()
      ? `Positions (from analysis / reference): ${legLayout.trim()}.`
      : `Positions: match the reference exactly (corner vs center-front vs center-rear).`;
    return `<legs>
HARD CONSTRAINT: EXACTLY ${legCount} freestanding legs. Count before finishing: ${legCount} separate legs on the floor — not ${Math.max(0, legCount - 1)}, not ${legCount + 1}, not a continuous plinth.
${layoutLine}
Preserve each leg's shape, height, thickness, angle, spacing and finish (${legsMaterial}) as in the reference. Full legs body-to-floor with contact shadows. Do not hide, merge, drop or invent legs.
${generalKnowledge}
</legs>`;
  }
  if (legCount === 0) {
    return `<legs>
HARD CONSTRAINT: ZERO freestanding legs — plinth/base only as in the reference. Do not invent legs, pins or feet.
</legs>`;
  }
  return `<legs>
Match the reference freestanding leg count AND positions exactly (including whether a mid support is front-only or also rear). Every leg in the reference must touch the floor with a contact shadow. Do not invent or remove legs.
${generalKnowledge}
</legs>`;
}

function buildMountingBlock(mounting: MountingOption, legCount: number | null): string {
  if (mounting === 'wall-mounted') {
    return `Wall-mounted: keep original floor clearance; no freestanding legs/plinths/pedestals; soft shadows behind and under the body.`;
  }
  if (legCount != null && legCount > 0) {
    return `Floor-standing on exactly ${legCount} freestanding legs — not a plinth, not fewer/more legs.`;
  }
  if (legCount === 0) {
    return `Floor-standing with no freestanding legs (plinth/base only as in the reference). Do not invent legs.`;
  }
  return `Floor-standing: preserve exact freestanding leg count and placement from the reference.`;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  for (const option of allowed) {
    const normalizedOption = option.replace(/-/g, '_');
    if (raw === normalizedOption || raw === option) {
      return option;
    }
  }
  // Soft contains match for product types / colors
  for (const option of allowed) {
    const token = option.replace(/-/g, '_');
    if (raw.includes(token) || token.includes(raw)) {
      return option;
    }
  }
  return fallback;
}

function normalizeProductType(value: unknown): ProductTypeOption {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

  // Exact enum
  for (const option of PRODUCT_TYPE_VALUES) {
    if (raw === option || raw === option.replace(/_/g, '-')) {
      return option;
    }
  }

  // Turkish + English heuristics
  if (/dresuar|dresser|chest|komodin.*yüksek|tall.?storage/.test(raw)) return 'dresser';
  if (/duvara.?monte|wall.?mount|wall.?hung|asılı/.test(raw) && /tv|televizyon/.test(raw)) {
    return 'tv_wall_mounted';
  }
  if (/üst.?raf|top.?shelf|ust.?rafli|raflı.?tv|rafli.?tv/.test(raw)) return 'tv_with_top_shelf';
  if (/tv.?sehpa|sehpa|tv.?stand|media.?table|tv.?table/.test(raw)) return 'tv_stand';
  if (/tv.?ünite|tv.?unite|tv.?unit|tv.?cabinet|medya|media.?unit|televizyon.?ünite/.test(raw)) {
    return 'tv_unit';
  }
  if (/konsol|console|hallway.?table|entry.?table/.test(raw)) return 'console';

  // Default: low wide storage → tv_unit is safer than wrong dresser; prefer console for non-TV short pieces
  if (/tv|televizyon/.test(raw)) return 'tv_unit';
  return 'console';
}

function normalizeProductColor(value: unknown): ProductColorOption {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  if (PRODUCT_COLOR_VALUES.includes(raw as ProductColorOption)) {
    return raw as ProductColorOption;
  }

  // Heuristic closest-match from free-text / legacy fields
  const hasTravertine = /travertine|stone|mermer|traverten/.test(raw);
  const hasOak = /oak|meşe|mese|sapphir|safir/.test(raw);
  const hasAlinaWalnut = /alina|ceviz|walnut|cevizli/.test(raw);
  const hasAnthracite = /anthracite|antrasit|dark.?grey|dark.?gray|charcoal|siyah.?gri/.test(raw);
  const hasWhite = /white|beyaz/.test(raw);

  if (hasAlinaWalnut) return 'alina-walnut-laser';
  if (hasOak && hasWhite) return 'sapphire-oak-body-white-doors';
  if (hasAnthracite && hasTravertine) return 'anthracite-body-travertine-doors';
  if (hasWhite && hasTravertine) return 'white-body-travertine-doors';
  if (hasAnthracite) return 'anthracite';
  if (hasWhite) return 'white';
  if (hasOak) return 'sapphire-oak-body-white-doors';

  return 'white';
}

function normalizePlexiglass(value: unknown): PlexiglassOption {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (v.includes('gold')) return 'gold-mirror';
  if (v.includes('silver')) return 'silver-mirror';
  if (PLEXIGLASS_VALUES.includes(v as PlexiglassOption)) return v as PlexiglassOption;
  return 'none';
}

function normalizeHandlePresence(value: unknown): HandlePresenceOption {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (v.includes('no') || v.includes('without') || v.includes('handleless')) return 'no-handle';
  if (v === 'with-handle') return 'with-handle';
  return 'with-handle';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}
