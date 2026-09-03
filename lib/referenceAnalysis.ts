/**
 * Per-reference furniture analysis (Gemini Flash vision).
 * Predictions are constrained to the same dropdown enums as the base-prompt form.
 */

/** Body (carcass / gövde) finish — no travertine body in catalog. */
export type BodyColorOption = 'white' | 'anthracite' | 'sapphire-oak' | 'alina-walnut';

/** Door / panel (kapak) finish. */
export type DoorColorOption =
  | 'white'
  | 'anthracite'
  | 'travertine'
  | 'sapphire-oak'
  | 'alina-walnut';

/** @deprecated Combined legacy catalog variant — kept for history migration only. */
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
/** @deprecated Replaced by free-text roomVibe — kept for history migration. */
export type AccentColorOption =
  | 'warm-beige'
  | 'soft-olive'
  | 'muted-terracotta'
  | 'slate-blue'
  | 'champagne-gold'
  | 'charcoal-grey';

export const BODY_COLOR_VALUES: BodyColorOption[] = [
  'white',
  'anthracite',
  'sapphire-oak',
  'alina-walnut'
];
export const DOOR_COLOR_VALUES: DoorColorOption[] = [
  'white',
  'anthracite',
  'travertine',
  'sapphire-oak',
  'alina-walnut'
];
/** @deprecated Use BODY_COLOR_VALUES / DOOR_COLOR_VALUES. */
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
  /** Body / carcass finish (gövde). */
  bodyColor: BodyColorOption;
  /** Door / panel finish (kapak). */
  doorColor: DoorColorOption;
  mounting: MountingOption;
  plexiglass: PlexiglassOption;
  handlePresence: HandlePresenceOption;
  /** Free-text handle description (optional). */
  handleDescription: string;
  roomStyle: RoomStyleOption;
  /**
   * Best room atmosphere for this product (AI-written free text).
   * Complements roomStyle — palette, mood, materials; not a fixed enum.
   */
  roomVibe: string;
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
  /** Handle metal when handles exist. none = handleless. */
  handleMetal?: 'none' | 'gold' | 'silver' | 'black';
  /**
   * Leg hardware finish from the photo.
   * none = no separate legs; body-match = wood legs that follow the carcass (not metal).
   */
  legFinish?: 'none' | 'gold' | 'silver' | 'black' | 'white' | 'body-match';
  confidence: number;
  notes: string;
  prompt: string;
};

export type ReferenceAnalysisDraft = Omit<ReferenceAnalysis, 'prompt'> & {
  prompt?: string;
  /** Legacy combined field from older history / API responses. */
  productColor?: string;
  /** Legacy accent enum — mapped into roomVibe when roomVibe empty. */
  accentColor?: string;
};

/** Default vibe when AI/user leave roomVibe empty. */
export const DEFAULT_ROOM_VIBE =
  'calm premium living interior, mid-tone greige walls, mid-tone wood floor, sparse elegant decor, north-window daylight with opposite bounce fill';

const FINISH_MATERIAL: Record<string, string> = {
  white: 'matte white premium furniture lacquer',
  anthracite: 'anthracite premium furniture finish',
  travertine:
    'Traverten (catalogue lock): light ivory–cream limestone-look laminate on the door faces, cool-warm pale beige / greige — NEVER yellow honey oak. Soft wavy sedimentary veins in muted taupe, plus fine sand-grain pores and tiny speckles (stone, not wood fiber). Matte or very soft satin, dry stone look — not glossy marble, not oak veneer. SLAT / CHEVRON / HERRINGBONE doors: the slat layout is geometry only. Each slat face is still this same travertine stone laminate — do NOT turn slats into oak, walnut, or linear wood grain. HARD LOCK: keep ivory–cream stone; do not drift to sapphire-oak, amber wood, espresso, rust-orange, terracotta, charcoal, or bright white Carrara. Shadows may deepen slightly; lit door faces stay light cream travertine.',
  'sapphire-oak':
    'Safir meşe (catalogue lock): light–medium yellowish natural oak veneer, straw/pale-honey base with a slight golden-yellow cast — not walnut, not grey, not blue. Straight longitudinal oak grain, medium contrast only (soft darker streaks, no rustic high-contrast grain). Matte or very soft satin lacquer, factory laminate/veneer look. HARD LOCK: keep this same lightness in every light; do not drift to espresso, dark walnut, smoked oak, amber-heavy honey oak, bleached white oak, or bluish “sapphire” wood. Shadows may darken slightly; the lit surface must stay light–medium yellow oak.',
  // Alina is a laser-less wood color; laser lines (if any) are separate shallow illusion-like patterns.
  'alina-walnut':
    'Alina walnut wood veneer with warm natural grain (color finish is not laser-cut; any laser pattern is a separate decorative illusion on the surface)'
};

function finishLabel(code: string): string {
  switch (code) {
    case 'white':
      return 'white';
    case 'anthracite':
      return 'anthracite';
    case 'travertine':
      return 'Traverten (light ivory–cream stone)';
    case 'sapphire-oak':
      return 'Safir meşe (light–medium yellowish oak)';
    case 'alina-walnut':
      return 'Alina walnut';
    default:
      return code;
  }
}

function legsMaterialForBody(bodyColor: BodyColorOption): string {
  if (bodyColor === 'white') return 'as shown in the reference (match white / metal finish)';
  if (bodyColor === 'anthracite') return 'as shown in the reference (match anthracite / metal finish)';
  if (bodyColor === 'alina-walnut') {
    return 'as shown in the reference (match walnut / metal finish)';
  }
  return 'as shown in the reference';
}

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
  "bodyColor": "white|anthracite|sapphire-oak|alina-walnut",
  "doorColor": "white|anthracite|travertine|sapphire-oak|alina-walnut",
  "mounting": "floor-standing|wall-mounted",
  "plexiglass": "none|gold-mirror|silver-mirror",
  "handlePresence": "with-handle|no-handle",
  "handleDescription": "short description if handles exist, else empty string",
  "handleMetal": "none|gold|silver|black",
  "legFinish": "none|gold|silver|black|white|body-match",
  "roomStyle": "minimalist|modern|classic|industrial",
  "roomVibe": "short English atmosphere phrase for the best room vibe for THIS product",
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

CRITICAL — bodyColor and doorColor are SEPARATE. Do NOT invent free-text colors.
bodyColor (gövde / carcass / sides / top structure — not door faces): white | anthracite | sapphire-oak | alina-walnut
doorColor (kapak / door panels only): white | anthracite | travertine | sapphire-oak | alina-walnut
- Judge body and doors independently (e.g. white body + travertine doors, sapphire-oak body + white doors, both alina-walnut).
- travertine is door-only in this catalog — never use travertine as bodyColor.
- travertine (Traverten, door faces only): LIGHT ivory–cream / pale beige limestone-look with soft taupe veins, fine pores and speckles. It is NOT rust-orange, terracotta, dark brown stone, grey concrete, or polished Carrara.
- SLATTED / CHEVRON / HERRINGBONE / DIAGONAL door faces (CRITICAL): slat geometry is NOT a material. Pale cream slats with pores, speckles or wavy stone veins = travertine even if they look “wood-like” at a glance. Do NOT classify those doors as sapphire-oak just because they are slatted. sapphire-oak requires continuous yellow-oak wood fiber along the slat. When unsure between pale stone slats vs pale oak slats, prefer travertine if you see pinholes/speckles/cloudy limestone; prefer sapphire-oak only if you see clear linear wood grain and honey-yellow timber.
- sapphire-oak (Safir meşe): LIGHT–MEDIUM yellowish natural oak only (straw / pale honey, slight gold). Straight grain, medium contrast, matte/satin. It is NOT dark walnut, smoked oak, grey oak, blue-tinted wood, or heavy amber honey oak. If the wood is clearly dark brown (Alina/walnut), use alina-walnut — not sapphire-oak.
- alina-walnut (Alina ceviz): this is a LASER-LESS wood COLOR/finish. It is not a laser material. However, Alina products often have laser-style decorative lines that are an ILLUSION — shallow surface patterns that look laser-cut but the finish code stays alina-walnut only. When those patterns are visible set hasLaserPatterns=true; when not, false. Never invent a separate laser color enum.
- If body and doors match, set the same enum on both (e.g. both white or both alina-walnut).

COLOR CONSTANCY / SHADOW RULES (CRITICAL):
- Classify the product's physical base finish from broad, continuous, front-facing or top panel surfaces — especially portions receiving direct or soft light.
- Completely ignore the background, floor, wall, cast shadow behind/below the product, contact shadow, ambient-occlusion gaps, dark panel seams, reflections and edge shading when choosing bodyColor or doorColor.
- A white product remains white where it falls into grey shadow. Grey-looking undersides, side edges, gaps or shadows on a white product are NOT anthracite panels.
- Before returning anthracite, require positive evidence: at least one large illuminated body/door surface itself must remain consistently dark charcoal, not merely a shaded white/grey area.
- Compare lit and shaded portions of the SAME continuous panel. If its lit portion is white/near-white and only its shaded portion is grey, classify that whole panel as white.
- When uncertain specifically between white and anthracite because of lighting, prefer white unless a large illuminated panel provides clear anthracite evidence.

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
- handleMetal (CRITICAL — metal color of pulls/knobs only):
  * no-handle → "none".
  * gold = clearly brass / champagne / yellow-gold metal.
  * silver = chrome, nickel, steel, cool grey mirror metal. Warm studio glare on chrome is STILL silver — do not call chrome gold.
  * black = matte black metal hardware.
  * Do not copy plexiglass gold/silver onto handles. Judge the handle itself.
- legFinish (CRITICAL — look only at freestanding legs/feet that reach the floor):
  * wall-mounted / no floor legs / plinth only → "none".
  * gold = brass / champagne metal legs.
  * silver = chrome, nickel, steel, tapered metal pins. Cool grey shine = silver. Do NOT call chrome gold because the room light is warm or because plexiglass is gold.
  * black = matte black metal legs.
  * white = painted/lacquered white legs (not just a highlight on chrome).
  * body-match = wooden / laminate legs that match the carcass wood or paint — not a separate metal color.
  * Ignore filename letters (AG/BG/ATG). Those are not the leg color.
  * Do not invent metal legs if the photo shows wood feet or a plinth.
- doorCount: optional approximate door/panel count when obvious, else null (not critical).
- roomStyle: one of minimalist|modern|classic|industrial for the catalogue scene framework.
- roomVibe (CRITICAL free text — invent a good fit from product type, finish and style):
  * Write 12–28 English words describing the BEST room atmosphere for THIS exact product.
  * Template: "[mood] [room type], [wall palette], [floor material tone], [1–2 restrained accent materials], even wrap lighting on the product".
  * LIGHTING IN THE VIBE: north-facing / overcast window daylight with a white bounce on the shadow side. One real light direction. Not high-key, not cinematic, not a sunbeam.
  * FORBIDDEN vibe words: bright, airy, sunlit, sun-drenched, high-key, floodlit, luminous, glowing, daylight-flooded, sun-soaked, sun patch, window splash, shaft of light, IKEA-bright. Never write "bright contemporary".
  * Examples:
    - "Warm contemporary living room, mid-tone greige plaster, mid oak floor, muted brass accents, north-window daylight and bounce fill"
    - "Modern hallway, cool greige walls, pale stone floor, sparse ceramic decor, overcast window light"
    - "Soft classic bedroom, warm ivory walls, light wood floor, linen textiles, natural window light, no high-key"
  * Match roomStyle loosely but personalize to body/door finishes (e.g. Alina walnut → warmer woods; anthracite → cooler greige).
  * Do NOT return a color enum. Do NOT overcrowd the scene description.
- hasLaserPatterns: true only if decorative laser-style lines are actually visible (including Alina illusion patterns). Do not invent laser patterns or hardware.`;

export const ANALYSIS_SYSTEM_PROMPT = ANALYSIS_SYSTEM;

export function buildAnalysisUserText(fileName?: string): string {
  const name = fileName?.trim() ? ` Filename: ${fileName.trim()}.` : '';
  return `Analyze this furniture product reference photo.${name} Return JSON only using the allowed enum values.`;
}

export function resolveColorMaterials(bodyColor: BodyColorOption, doorColor: DoorColorOption) {
  const body = FINISH_MATERIAL[bodyColor] ?? FINISH_MATERIAL.white;
  const door = FINISH_MATERIAL[doorColor] ?? FINISH_MATERIAL.white;
  const top = body;
  const legs = legsMaterialForBody(bodyColor);
  const summary =
    bodyColor === doorColor
      ? `All-${finishLabel(bodyColor)} furniture`
      : `${finishLabel(bodyColor)} body with ${finishLabel(doorColor)} doors`;
  return { body, door, top, legs, summary, bodyColor, doorColor };
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
  const { bodyColor, doorColor } = resolveBodyDoorColors(parsed);
  const mounting = normalizeEnum(parsed.mounting, MOUNTING_VALUES, 'floor-standing');
  const plexiglass = normalizePlexiglass(parsed.plexiglass);
  const handlePresence = normalizeHandlePresence(parsed.handlePresence);
  const roomStyle = normalizeEnum(parsed.roomStyle, ROOM_STYLE_VALUES, 'modern');
  const roomVibe = normalizeRoomVibe(parsed.roomVibe ?? parsed.accentColor);
  const confidence = clamp01(
    typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence)
  );
  const legacyColorHint = String(parsed.productColor ?? parsed.colorVariant ?? parsed.color ?? '');
  const hasLaserPatterns =
    Boolean(parsed.hasLaserPatterns) || /alina-walnut-laser|alina.*laser|alina.*lazer/i.test(legacyColorHint);

  return {
    productType,
    productTypeLabel: productTypeLabel(productType, 'tr'),
    bodyColor,
    doorColor,
    mounting,
    plexiglass,
    handlePresence,
    handleDescription: String(parsed.handleDescription ?? '').trim(),
    roomStyle,
    roomVibe,
    hasLaserPatterns,
    doorCount: normalizeDoorCount(parsed.doorCount),
    legCount: normalizeLegCount(parsed.legCount, mounting),
    legLayout: normalizeLegLayout(parsed.legLayout, mounting, parsed.legCount),
    handleMetal: normalizeHandleMetal(parsed.handleMetal, handlePresence, parsed.handleDescription),
    legFinish: normalizeLegFinish(parsed.legFinish, mounting, parsed.legCount),
    confidence,
    notes: String(parsed.notes ?? '').trim()
  };
}

export function finalizeAnalysis(draft: ReferenceAnalysisDraft): ReferenceAnalysis {
  const productType = normalizeProductType(draft.productType ?? draft.productTypeLabel);
  const { bodyColor, doorColor } = resolveBodyDoorColors(draft as unknown as Record<string, unknown>);
  const mounting = normalizeEnum(draft.mounting, MOUNTING_VALUES, 'floor-standing');
  const plexiglass = normalizePlexiglass(draft.plexiglass);
  const handlePresence = normalizeHandlePresence(draft.handlePresence);
  const roomStyle = normalizeEnum(draft.roomStyle, ROOM_STYLE_VALUES, 'modern');
  const roomVibe = normalizeRoomVibe(draft.roomVibe ?? draft.accentColor);
  const legCount = normalizeLegCount(draft.legCount, mounting);
  const legacyColorHint = String(draft.productColor ?? '');
  const hasLaserPatterns =
    Boolean(draft.hasLaserPatterns) || /alina-walnut-laser|alina.*laser|alina.*lazer/i.test(legacyColorHint);

  const normalized: Omit<ReferenceAnalysis, 'prompt'> = {
    productType,
    productTypeLabel: productTypeLabel(productType, 'tr'),
    bodyColor,
    doorColor,
    mounting,
    plexiglass,
    handlePresence,
    handleDescription: String(draft.handleDescription ?? '').trim(),
    roomStyle,
    roomVibe,
    hasLaserPatterns,
    doorCount: normalizeDoorCount(draft.doorCount),
    // Wall-mounted / no freestanding legs → leg count is disabled (null).
    legCount,
    legLayout: normalizeLegLayout(draft.legLayout, mounting, legCount),
    handleMetal: normalizeHandleMetal(draft.handleMetal, handlePresence, draft.handleDescription),
    legFinish: normalizeLegFinish(draft.legFinish, mounting, legCount),
    confidence: clamp01(draft.confidence),
    notes: String(draft.notes ?? '').trim()
  };

  return {
    ...normalized,
    prompt: buildCommercialCataloguePromptFromAnalysis(normalized)
  };
}

/** Lighting-intensity adjectives that push the image model into a one-sided blast. */
const ROOM_VIBE_FORBIDDEN_LIGHTING =
  /\b(bright|airy|sunlit|sun-drenched|sundrenched|high-key|highkey|floodlit|luminous|glowing|daylight-flooded|sun-soaked|sunsoaked)\b/gi;

function hasEvenProductLightingPhrase(text: string): boolean {
  return /\beven (wrap|commercial|catalogue)?\s*(light|lighting|illumination)\b|\bbalanced (wrap |commercial )?(light|lighting|illumination)\b|\bwrap lighting\b/i.test(
    text
  );
}

function sanitizeRoomVibeLighting(text: string): string {
  let next = text
    .replace(ROOM_VIBE_FORBIDDEN_LIGHTING, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
  if (!next) {
    return DEFAULT_ROOM_VIBE;
  }
  if (!hasEvenProductLightingPhrase(next)) {
    next = `${next.replace(/[.,;]+$/, '')}, even wrap lighting on all camera-visible product faces`;
  }
  return next.slice(0, 240);
}

function normalizeRoomVibe(value: unknown): string {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!text) {
    return DEFAULT_ROOM_VIBE;
  }

  // Legacy accent enums → short vibe seeds (AI will rewrite on next analysis).
  const legacyAccent: Record<string, string> = {
    'warm-beige':
      'Warm soft-beige living interior, greige walls, mid-tone wood floor, quiet champagne metal notes, even wrap lighting on the product',
    'soft-olive':
      'Calm modern room with soft olive textile accents, greige walls, light wood floor, even wrap lighting on the product',
    'muted-terracotta':
      'Warm contemporary room with muted terracotta accents, soft plaster walls, natural wood floor, even wrap lighting on the product',
    'slate-blue':
      'Cool modern living room with slate-blue soft accents, greige walls, mid-tone neutral floor, even wrap lighting on the product',
    'champagne-gold':
      'Quiet luxury interior with champagne-gold metal accents, warm greige walls, even wrap lighting on the product',
    'charcoal-grey':
      'Restrained modern interior with charcoal soft accents, cool greige walls, clean neutral floor, even wrap lighting on the product'
  };
  const key = text.toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (legacyAccent[key]) {
    return legacyAccent[key];
  }

  return sanitizeRoomVibeLighting(text);
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

type CataloguePromptAnalysis = Omit<
  ReferenceAnalysis,
  'prompt' | 'productType' | 'productTypeLabel'
> &
  Partial<Pick<ReferenceAnalysis, 'productType' | 'productTypeLabel'>>;

export function buildCommercialCataloguePromptFromAnalysis(
  analysis: CataloguePromptAnalysis,
  options: { inferProductTypeFromReference?: boolean } = {}
): string {
  const inferProductType = options.inferProductTypeFromReference === true;
  const declaredProductType =
    analysis.productType && analysis.productTypeLabel
      ? `${analysis.productTypeLabel} (${analysis.productType})`
      : '';
  if (!inferProductType && !declaredProductType) {
    throw new Error('A declared product type is required when reference inference is disabled.');
  }
  const productTypeDescription = inferProductType
    ? 'the exact furniture category visible in the reference'
    : analysis.productTypeLabel || 'the declared furniture category';
  const colors = resolveColorMaterials(analysis.bodyColor, analysis.doorColor);
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

  const isAlina =
    analysis.bodyColor === 'alina-walnut' || analysis.doorColor === 'alina-walnut';
  const laserBlock = analysis.hasLaserPatterns
    ? isAlina
      ? `Alina walnut color is laser-less as a finish; laser lines are a separate shallow decorative illusion on the surface. Reproduce every laser pattern exactly: each line is a narrow ~1 mm recessed groove — not raised, embossed, printed, deep-cut or inventing extra patterns.`
      : `Reproduce every laser pattern exactly: each line is a narrow ~1 mm recessed groove engraved into the door — not raised, embossed, printed or thickened. Do not invent extra laser patterns.`
    : isAlina
      ? `Alina walnut is a laser-less color finish. No laser patterns in this reference — do not invent engraving or illusion laser lines.`
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
    inferProductType
      ? 'Product type: infer it only from the reference image using the visible geometry, proportions, installation and intended use. Do not assign a default category or reshape it into another furniture type.'
      : `Product type: ${declaredProductType}.`,
    analysis.legCount != null && analysis.mounting !== 'wall-mounted'
      ? `HARD LEG COUNT: ${analysis.legCount}.${layoutNote}`
      : analysis.mounting === 'wall-mounted'
        ? 'HARD LEG COUNT: 0 / none (wall-mounted).'
        : '',
    `Body color: ${analysis.bodyColor} — ${colors.body}.`,
    `Door color: ${analysis.doorColor} — ${colors.door}.`,
    `Top: ${colors.top} (match body).`,
    `Catalog finishes: ${colors.summary}.`,
    `Installation: ${analysis.mounting}.`,
    `Room style: ${analysis.roomStyle}.`,
    `Room vibe: ${analysis.roomVibe || DEFAULT_ROOM_VIBE}.`
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
Reference image is ground truth for geometry, proportions, construction, installation, catalog colors, materials and decorative placement — NOT for exposure, brightness, lighting intensity or highlight clipping.
Preserve body dimensions, silhouette, top, handles, patterns, legs/base and mounting exactly.
Prefer the reference over text for product shape and catalog finish. Prefer this prompt over the reference for lighting, exposure and room brightness.
If the reference is photographically bright, high-key or blown on the window side, do not match that look — treat it as an identity plate shot in too much light.
Do not redesign, stretch, squash, invent details, or invent free-form colors outside the catalog variant.
Product identity: ${productIdentity}
</main>

<installation>
Catalog installation: ${analysis.mounting}. Match the reference exactly; never convert installation type.
${mountingBlock}
</installation>

${legsBlock}

<composition>
Full product in frame (body, doors, edges, legs/base or wall clearance). Keep true proportions — never stretch, compress or reshape it into a different furniture category.
Shot like a real catalog still: full-frame camera, ~42–50 mm, ISO 100, f/5.6–f/8, tripod, natural camera height for ${productTypeDescription}, straight verticals, no wide-angle distortion, no beauty glow.
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
White/anthracite: premium matte-satin furniture finish (not plastic). Sapphire oak / Alina walnut: correct grain, restrained tone. Travertine: ivory–cream stone laminate with taupe veins and fine pores — if doors are slatted/chevron/herringbone, keep TRAVERTINE on each slat (never convert slats to oak). Mirror plexi: controlled metal-mirror, not glass/chrome/liquid metal. No transparent glass on the furniture.
${handleBlock}
</materials>

<interior>
Place the product in a ${analysis.roomStyle} catalogue interior with this vibe: ${analysis.roomVibe || DEFAULT_ROOM_VIBE}.
Keep walls mid-tone matte greige with real pigment (not pale, not reflective white). Floor mid-tone wood or concrete with visible grain — not bleached.
A large north-facing or overcast window may sit at the frame edge; sheer curtains diffuse it. Mirrors must not bounce a bright window onto the furniture.
Sparse decor only (books, ceramics, art, textile, plant). Turn off mixed indoor lights. Floor lamps / sconces if present are unlit props — they must not glow, bloom or wall-wash.
Rug may not hide legs/base/floor contact. Do not block product details. Wall-mounted pieces: no objects under them that look like supports.
</interior>

<lighting>
Light this as a real furniture catalog still — one physical setup, photographed in-camera. Not a 3D render, not HDR, not a high-key e-commerce composite, not cinematic.

RECIPE (use only this):
1. KEY — large north-facing / overcast window to camera-left (or camera-right; pick one). The window is a wall-sized soft source, further softened by sheer curtains or a diffusion sheet. Never direct sun, never a small nearby pane dumping a patch.
2. ANGLE — the product faces the camera; the window sits ~45° off-axis so form reads (gentle raking), not flat frontal light and not a hard side blast.
3. FILL — a large white bounce (foamcore / opposite wall) on the shadow side. Bounce recovers shadow detail; it does not erase shadows or match the key side. About 3:1 on the room, ~2:1 on the product.
4. COLOR — one daylight white balance (~5200K). No mixed tungsten. Practicals in frame do not emit.
5. PHYSICS — every shadow, highlight and floor contact follows that single window. Soft contact shadows under legs (dark at the contact, fading out). Subtle color bounce from the floor onto the underside. Inverse-square falloff: far corners and the wall away from the window are slightly darker. Speculars on handles/plexi are large and dim like a window, not pin-spot LEDs.

PRODUCT: camera-facing doors/panels stay close in brightness so the catalog finish is readable (leftmost ≈ rightmost), with only gentle modeling. Do not clip the window-facing end. White is paint, not a light source.

EXPOSURE: expose for the furniture (protect whites). Mid-tone walls, textured floor. Sheer is muted, not blown. No beauty glow, no bloom, no milky wash.

Failed if: two keys, lamp bloom, sun patch, everywhere-light with no shadow logic, plastic CGI sheen, a light pool on one corner, or a pale high-key catalog page.
</lighting>

<avoid>
Wrong proportions/category${
    inferProductType
      ? ' (infer the real category from the reference; never force a default category)'
      : ` (this is a ${analysis.productTypeLabel || 'declared furniture category'})`
  }, invented hardware, wrong leg count or mounting${
    analysis.legCount != null && analysis.legCount > 0
      ? ` (ILLEGAL: ${analysis.legCount - 1} legs, ${analysis.legCount + 1} legs, merged plinth instead of ${analysis.legCount} separate legs)`
      : ''
  }, recessed/embedded plexiglass, chrome/liquid-metal mirrors, free-form recolor, heavy grade/WB shifts, mixed color temperatures, dual keys, copying the reference photo’s brightness, CGI everywhere-light, HDR bloom, floor-lamp glow, sun patch, light pool on one door, plastic sheen, milky high-key wash, erased contact shadows.
</avoid>

GENERATE. Same product identity, geometry, construction, installation and composition as the reference. ${legGenerateLine} Photograph with one north/overcast window key at ~45° plus opposite white bounce. One shadow direction, real contact shadows, inverse-square falloff. Product doors even enough to read the finish. Expose for the furniture — mid-tone room, protected whites, no HDR, no CGI glow.`;
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

function resolveBodyDoorColors(source: Record<string, unknown>): {
  bodyColor: BodyColorOption;
  doorColor: DoorColorOption;
} {
  const hasBody = source.bodyColor != null && String(source.bodyColor).trim() !== '';
  const hasDoor = source.doorColor != null && String(source.doorColor).trim() !== '';

  if (hasBody || hasDoor) {
    return {
      bodyColor: normalizeBodyColor(source.bodyColor ?? source.doorColor),
      doorColor: normalizeDoorColor(source.doorColor ?? source.bodyColor)
    };
  }

  // Legacy combined productColor / free-text color fields
  return splitLegacyProductColor(
    source.productColor ?? source.colorVariant ?? source.color ?? source.bodyColorMaterial
  );
}

/** Map old single-dropdown codes (and free text) → body + door. */
export function splitLegacyProductColor(value: unknown): {
  bodyColor: BodyColorOption;
  doorColor: DoorColorOption;
} {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  switch (raw as ProductColorOption | string) {
    case 'white':
      return { bodyColor: 'white', doorColor: 'white' };
    case 'white-body-travertine-doors':
      return { bodyColor: 'white', doorColor: 'travertine' };
    case 'anthracite':
      return { bodyColor: 'anthracite', doorColor: 'anthracite' };
    case 'anthracite-body-travertine-doors':
      return { bodyColor: 'anthracite', doorColor: 'travertine' };
    case 'sapphire-oak-body-white-doors':
      return { bodyColor: 'sapphire-oak', doorColor: 'white' };
    case 'alina-walnut-laser':
    case 'alina-walnut':
      return { bodyColor: 'alina-walnut', doorColor: 'alina-walnut' };
    case 'sapphire-oak':
      return { bodyColor: 'sapphire-oak', doorColor: 'sapphire-oak' };
    case 'travertine':
      return { bodyColor: 'white', doorColor: 'travertine' };
    default:
      break;
  }

  const hasTravertine = /travertine|stone|mermer|traverten/.test(raw);
  const hasOak = /oak|meşe|mese|sapphir|safir/.test(raw);
  const hasAlinaLaser = /alina.*lazer|alina.*laser|lazer.*ceviz|laser.*walnut/.test(raw);
  const hasAlinaWalnut = /alina|ceviz|walnut|cevizli/.test(raw);
  const hasAnthracite = /anthracite|antrasit|dark.?grey|dark.?gray|charcoal|siyah.?gri/.test(raw);
  const hasWhite = /white|beyaz/.test(raw);

  if (hasAlinaLaser || hasAlinaWalnut) return { bodyColor: 'alina-walnut', doorColor: 'alina-walnut' };
  if (hasOak && hasWhite) return { bodyColor: 'sapphire-oak', doorColor: 'white' };
  if (hasAnthracite && hasTravertine) return { bodyColor: 'anthracite', doorColor: 'travertine' };
  if (hasWhite && hasTravertine) return { bodyColor: 'white', doorColor: 'travertine' };
  if (hasAnthracite) return { bodyColor: 'anthracite', doorColor: 'anthracite' };
  if (hasOak) return { bodyColor: 'sapphire-oak', doorColor: 'sapphire-oak' };
  if (hasWhite) return { bodyColor: 'white', doorColor: 'white' };
  return { bodyColor: 'white', doorColor: 'white' };
}

function normalizeBodyColor(value: unknown): BodyColorOption {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');
  if (BODY_COLOR_VALUES.includes(raw as BodyColorOption)) {
    return raw as BodyColorOption;
  }
  // Common mistakes / aliases
  if (raw === 'travertine' || raw.includes('travert')) return 'white';
  if (raw.includes('alina') || raw.includes('ceviz') || raw.includes('walnut')) return 'alina-walnut';
  if (raw.includes('oak') || raw.includes('meşe') || raw.includes('safir')) return 'sapphire-oak';
  if (raw.includes('anthracite') || raw.includes('antrasit')) return 'anthracite';
  if (raw.includes('white') || raw.includes('beyaz')) return 'white';
  // Legacy combo codes
  if (raw.includes('sapphire-oak-body')) return 'sapphire-oak';
  if (raw.includes('anthracite-body')) return 'anthracite';
  if (raw.includes('white-body')) return 'white';
  return 'white';
}

function normalizeDoorColor(value: unknown): DoorColorOption {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');
  if (DOOR_COLOR_VALUES.includes(raw as DoorColorOption)) {
    return raw as DoorColorOption;
  }
  if (raw.includes('travert') || raw.includes('mermer') || raw.includes('stone')) return 'travertine';
  if (raw.includes('alina') || raw.includes('ceviz') || raw.includes('walnut')) return 'alina-walnut';
  if (raw.includes('oak') || raw.includes('meşe') || raw.includes('safir')) return 'sapphire-oak';
  if (raw.includes('anthracite') || raw.includes('antrasit')) return 'anthracite';
  if (raw.includes('white') || raw.includes('beyaz')) return 'white';
  // Legacy combo codes → door side
  if (raw.includes('travertine-doors')) return 'travertine';
  if (raw.includes('white-doors')) return 'white';
  if (raw === 'sapphire-oak-body-white-doors') return 'white';
  if (raw === 'alina-walnut-laser' || raw === 'alina-walnut') return 'alina-walnut';
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

function normalizeHandleMetal(
  value: unknown,
  handlePresence: HandlePresenceOption,
  handleDescription?: unknown
): ReferenceAnalysis['handleMetal'] {
  if (handlePresence === 'no-handle') {
    return 'none';
  }
  const raw = `${String(value ?? '')} ${String(handleDescription ?? '')}`
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (/\b(chrome|nickel|steel|stainless|silver|gumus|gümüş)\b/.test(raw)) {
    return 'silver';
  }
  if (/\b(black|siyah|matte-black)\b/.test(raw)) {
    return 'black';
  }
  if (/\b(gold|brass|champagne|altin|altın)\b/.test(raw) && !/\bchrome\b/.test(raw)) {
    return 'gold';
  }
  return undefined;
}

function normalizeLegFinish(
  value: unknown,
  mounting: MountingOption,
  legCount: unknown
): ReferenceAnalysis['legFinish'] {
  if (mounting === 'wall-mounted') {
    return 'none';
  }
  const count =
    typeof legCount === 'number' && Number.isFinite(legCount) ? Math.round(legCount) : null;
  if (count === 0) {
    return 'none';
  }
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!raw) {
    return undefined;
  }
  if (raw === 'none' || raw === 'yok' || raw.includes('plinth') || raw.includes('no-leg')) {
    return 'none';
  }
  if (raw.includes('body') || raw.includes('wood') || raw.includes('match') || raw.includes('ahsap') || raw.includes('ahşap')) {
    return 'body-match';
  }
  if (raw.includes('white') || raw.includes('beyaz')) {
    return 'white';
  }
  if (raw.includes('black') || raw.includes('siyah')) {
    return 'black';
  }
  if (raw.includes('chrome') || raw.includes('nickel') || raw.includes('steel') || raw.includes('silver') || raw.includes('gümüş') || raw.includes('gumus')) {
    return 'silver';
  }
  if (raw.includes('gold') || raw.includes('brass') || raw.includes('champagne') || raw.includes('altın') || raw.includes('altin')) {
    return 'gold';
  }
  return undefined;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}
