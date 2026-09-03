import {
  resolveColorMaterials,
  type BodyColorOption,
  type DoorColorOption,
  type PlexiglassOption
} from '@/lib/referenceAnalysis';

const BODY_COLOR_SET = new Set<string>(['white', 'anthracite', 'sapphire-oak', 'alina-walnut']);
const DOOR_COLOR_SET = new Set<string>(['white', 'anthracite', 'travertine', 'sapphire-oak', 'alina-walnut']);

export function parseBodyColorOption(value: unknown): BodyColorOption | undefined {
  return typeof value === 'string' && BODY_COLOR_SET.has(value) ? (value as BodyColorOption) : undefined;
}

export function parseDoorColorOption(value: unknown): DoorColorOption | undefined {
  return typeof value === 'string' && DOOR_COLOR_SET.has(value) ? (value as DoorColorOption) : undefined;
}

export function parsePlexiglassOption(value: unknown): PlexiglassOption | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'none' || normalized === 'yok' || normalized === 'no' || normalized === 'off') {
    return 'none';
  }
  if (normalized === 'gold' || normalized === 'gold-mirror' || normalized === 'altin' || normalized === 'altın') {
    return 'gold-mirror';
  }
  if (normalized === 'silver' || normalized === 'silver-mirror' || normalized === 'gumus' || normalized === 'gümüş') {
    return 'silver-mirror';
  }
  return undefined;
}

export type HardwareMetalOption = 'none' | 'gold' | 'silver' | 'black';
export type LegFinishOption = HardwareMetalOption | 'white';

export const HARDWARE_METAL_OPTIONS: HardwareMetalOption[] = ['none', 'gold', 'silver', 'black'];
export const LEG_FINISH_OPTIONS: LegFinishOption[] = ['none', 'gold', 'silver', 'black', 'white'];

export function parseHardwareMetalOption(value: unknown): HardwareMetalOption | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'none' || normalized === 'yok' || normalized === 'no' || normalized === 'off') {
    return 'none';
  }
  if (normalized === 'gold' || normalized === 'altin' || normalized === 'altın') {
    return 'gold';
  }
  if (normalized === 'silver' || normalized === 'gumus' || normalized === 'gümüş') {
    return 'silver';
  }
  if (normalized === 'black' || normalized === 'siyah') {
    return 'black';
  }
  return undefined;
}

export function parseLegFinishOption(value: unknown): LegFinishOption | undefined {
  const metal = parseHardwareMetalOption(value);
  if (metal) {
    return metal;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'white' || normalized === 'beyaz') {
    return 'white';
  }
  return undefined;
}

function metalFinishLabel(metal: Exclude<LegFinishOption, 'none'>): string {
  if (metal === 'gold') {
    return 'brushed gold / champagne metal';
  }
  if (metal === 'silver') {
    return 'brushed silver / chrome metal';
  }
  if (metal === 'white') {
    return 'matte white painted / lacquered leg finish';
  }
  return 'matte black metal';
}

function buildManualCatalogTargetLine(
  bodyColor?: BodyColorOption,
  doorColor?: DoorColorOption
): string {
  if (!bodyColor && !doorColor) {
    return '';
  }

  if (bodyColor && doorColor) {
    const colors = resolveColorMaterials(bodyColor, doorColor);
    return [
      `USER-SELECTED CATALOGUE FINISH (authoritative — do not invent another colourway): ${colors.summary}.`,
      `Body / carcass / sides / top: ${colors.body}.`,
      `Door / panel faces: ${colors.door}.`,
      doorColor === 'travertine'
        ? 'TRAVERTINE DOOR LOCK: door faces are stone laminate, not wood. Chevron / herringbone / diagonal slats stay the same geometry but each slat must keep ivory–cream travertine pores and taupe veins. Do not render oak, honey wood, or sapphire-oak on those slats.'
        : '',
      'IMAGE 2 is a photo of this same finish. Match the named catalogue finish, not a guessed fashion color.'
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (bodyColor) {
    const colors = resolveColorMaterials(bodyColor, bodyColor as DoorColorOption);
    return `USER-SELECTED CATALOGUE BODY FINISH (authoritative): ${colors.body}. Apply this to carcass, sides and top. Read door-face color only from IMAGE 2 furniture surfaces.`;
  }

  const door = doorColor as DoorColorOption;
  const bodyFallback: BodyColorOption = door === 'travertine' ? 'white' : door;
  const colors = resolveColorMaterials(bodyFallback, door);
  const travertineLock =
    door === 'travertine'
      ? ' TRAVERTINE DOOR LOCK: stone laminate, not wood. Slat/chevron/herringbone doors keep ivory–cream travertine on every slat — never oak or honey timber.'
      : '';
  return `USER-SELECTED CATALOGUE DOOR FINISH (authoritative): ${colors.door}. Apply this to door/panel faces. Read body color only from IMAGE 2 furniture surfaces.${travertineLock}`;
}

function buildManualPlexiglassLine(plexiglass?: PlexiglassOption): string {
  if (!plexiglass) {
    return '';
  }
  if (plexiglass === 'none') {
    return 'USER-SELECTED PLEXIGLASS: NONE (yok). Do not add gold or silver mirror plexiglass, acrylic strips or door-front overlays.';
  }
  if (plexiglass === 'gold-mirror') {
    return 'USER-SELECTED PLEXIGLASS: GOLD. Thin gold-mirror plexiglass on the door front, slightly proud of the surface — never recessed, embedded or carved. Preserve gold tone; no blown white glare. Do not use silver.';
  }
  return 'USER-SELECTED PLEXIGLASS: SILVER. Thin silver-mirror plexiglass on the door front, slightly proud of the surface — never recessed, embedded or carved. Preserve silver tone; no blown white glare. Do not use gold.';
}

function buildManualHandleLine(handleMetal?: HardwareMetalOption): string {
  if (!handleMetal) {
    return '';
  }
  if (handleMetal === 'none') {
    return 'USER-SELECTED HANDLES: NONE (yok). This product is handleless. Do not add knobs, pulls, bars or recessed grips.';
  }
  return `USER-SELECTED HANDLE COLOR: ${handleMetal.toUpperCase()} (${metalFinishLabel(handleMetal)}). Keep IMAGE 1 handle count and positions. Recolor only the handle/pull metal to this finish. Do not invent extra handles.`;
}

function buildManualLegLine(legMetal?: LegFinishOption, bodyMatch?: boolean): string {
  if (bodyMatch && !legMetal) {
    return 'USER-SELECTED LEGS: BODY-MATCH. Freestanding legs are wood/laminate matching the carcass — not gold, silver, black or white metal. Recolor them only to the new body wood/paint. Keep IMAGE 1 leg count and placement.';
  }
  if (!legMetal) {
    return '';
  }
  if (legMetal === 'none') {
    return 'USER-SELECTED LEG COLOR: NONE (yok). No separate metal/painted hardware legs. Do not add gold, silver, black or white metal legs. Keep IMAGE 1 leg count and placement (plinth / no feet stays that way).';
  }
  const materialWord = legMetal === 'white' ? 'painted finish' : 'metal';
  return `USER-SELECTED LEG COLOR: ${legMetal.toUpperCase()} (${metalFinishLabel(legMetal)}). Keep IMAGE 1 leg count and placement. Recolor only the freestanding legs/feet to this ${materialWord}. Chrome/steel is silver — do not turn chrome into gold. Do not copy plexiglass or handle color onto the legs. Do not add or remove legs.`;
}

const STYLE_MODIFIERS = [
  'photoreal editorial lighting with medium exposure and preserved shadows',
  'single soft window key light, low fill, natural contact shadows',
  'gentle natural contrast with clean focus falloff — not high-key',
  'high-detail catalogue product look, controlled reflections, no overexposure',
  'documentary realism with true-to-life midtones (no milky wash)',
  'subtle film grain and balanced color response, restrained ambient',
  'premium magazine look with refined reflections and medium exposure',
  'minimal composition, modern commercial finish, soft shadows not erased'
];

const SCENE_VARIATIONS = [
  'a quiet, high-end contemporary living room with warm limestone, pale oak and soft daylight from a large side window',
  'a refined Japandi interior with tactile plaster walls, natural oak, restrained styling and calm overcast daylight',
  'an architectural gallery space with warm white walls, a seamless mineral floor and precise museum-quality lighting',
  'a sophisticated urban apartment with smoked glass, brushed metal accents and soft late-afternoon city light',
  'a bright Mediterranean interior with limewashed walls, travertine flooring and gently filtered sun',
  'a premium boutique-hotel suite with layered neutral textiles, walnut accents and cinematic evening ambience',
  'a minimal Scandinavian room with pale timber, muted natural textiles and clean north-facing daylight',
  'a modern editorial studio set with sculptural wall planes, a matte stone floor and controlled softbox lighting',
  'an elegant contemporary home with subtle art, champagne-metal details and balanced morning light',
  'a dramatic but realistic penthouse interior with dark stone, warm wood and soft indirect architectural lighting'
];

/** How strongly the surrounding scene should diverge from the reference. */
export type SceneVariationStrength = 'low' | 'medium' | 'high';

export const SCENE_VARIATION_STRENGTHS: SceneVariationStrength[] = ['low', 'medium', 'high'];

export function isSceneVariationStrength(value: unknown): value is SceneVariationStrength {
  return value === 'low' || value === 'medium' || value === 'high';
}

export function normalizeSceneVariationStrength(value: unknown): SceneVariationStrength {
  return isSceneVariationStrength(value) ? value : 'low';
}

/**
 * How much non-product area in the scene photo may change during a color-variant transfer.
 * none = color-only product swap; high = room stays but nearby area may restyle.
 */
export type AreaChangeStrength = 'none' | 'low' | 'medium' | 'high';

export const AREA_CHANGE_STRENGTHS: AreaChangeStrength[] = ['none', 'low', 'medium', 'high'];

export function isAreaChangeStrength(value: unknown): value is AreaChangeStrength {
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high';
}

export function normalizeAreaChangeStrength(value: unknown): AreaChangeStrength {
  return isAreaChangeStrength(value) ? value : 'none';
}

export type PromptVariantOptions = {
  /** Preserve the referenced product while refreshing / replacing its surrounding scene. */
  sceneVariation?: boolean;
  /** Scene change amount. Only used when sceneVariation is true. Default: low. */
  sceneVariationStrength?: SceneVariationStrength;
  /**
   * Recolor the product in IMAGE 1 (scene) using IMAGE 2 (variant product).
   * Lighting, camera and room stay locked unless areaChangeStrength allows nearby restyle.
   */
  variantRecolor?: boolean;
  /** How much the scene area around the product may change. Default: none. */
  areaChangeStrength?: AreaChangeStrength;
  /** Optional user-picked catalogue body finish (not AI-inferred). */
  targetBodyColor?: BodyColorOption;
  /** Optional user-picked catalogue door finish (not AI-inferred). */
  targetDoorColor?: DoorColorOption;
  /** Optional user-picked plexiglass: none | gold-mirror | silver-mirror. */
  targetPlexiglass?: PlexiglassOption;
  /** Optional user-picked handle metal: none | gold | silver | black. */
  targetHandleMetal?: HardwareMetalOption;
  /** Optional user-picked leg finish: none | gold | silver | black | white. */
  targetLegMetal?: LegFinishOption;
  /** Auto: wood legs that should follow the new body finish, not metal. */
  targetLegBodyMatch?: boolean;
};

const PRODUCT_LOCK =
  'PRODUCT LOCK: keep the primary manufactured product visually identical to the reference — same silhouette, geometry, proportions, construction, colors, materials, texture, hardware, doors, drawers, shelves, handles, legs, seams, edges, logos and condition. Keep the same product count, camera viewpoint, pose, orientation, scale and placement in frame. Do not redesign, recolor, restyle, reshape or replace any manufactured part of the product.';

const PROP_NOTE =
  'Loose styling props (TV, lamps, books, vases, plants, frames, textiles, ornaments, electronics, etc.) are not part of the product even when they touch or sit on it.';

function buildSceneVariationPrompt(
  cleanPrompt: string,
  style: string,
  scene: string,
  strength: SceneVariationStrength
): string {
  const productContext = cleanPrompt
    ? `PRODUCT-ONLY CONTEXT: keep product facts from this text; ignore any room, background, prop or location instructions it may contain: ${cleanPrompt}`
    : '';

  const renderLine = `Render treatment: ${style}. One seamless photoreal commercial image — not a collage, cutout or before/after.`;

  if (strength === 'low') {
    return [
      'IMAGE EDIT — LIGHT SCENE REFRESH (low change).',
      'A reference photo is attached. Read the manufactured product from that photo — do not invent a different product and do not ignore the image.',
      'Use the reference as the base frame. Keep the same room structure, architecture, camera and overall layout.',
      PRODUCT_LOCK,
      PROP_NOTE,
      'Apply only a subtle commercial refresh: soft wall/floor tone shift, slightly warmer or cooler daylight, and a light restyle of a few props (recolor, swap one or two small accessories). Do not invent a new location.',
      `Hint mood (keep it mild): ${scene}. Stay close to the reference — a quiet polish, not a redesign.`,
      'Update contact shadows only where needed. Product remains the clear hero.',
      renderLine,
      productContext,
      'FINAL CHECK: product matches reference; the room still reads as the same place with a gentle makeover. Large architectural or layout changes are wrong for this low setting.'
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (strength === 'medium') {
    return [
      'IMAGE EDIT — MODERATE SCENE REDESIGN (medium change).',
      'A reference photo is attached. Read the manufactured product from that photo — do not invent a different product and do not ignore the image.',
      'Use the reference for product identity and camera framing. Keep a similar room type and product placement, but the surrounding design must clearly feel restyled.',
      PRODUCT_LOCK,
      PROP_NOTE,
      'Change wall and floor materials/palette, ambient lighting mood, and surrounding furniture finishes. Replace most loose props with different, scene-appropriate ones — do not copy the reference prop set.',
      `Target atmosphere: ${scene}. The room type may stay related, but materials, color story and styling must be obviously updated.`,
      'Rebuild contact shadows and only the reflections needed for a natural seat in the new materials. Nothing may hide the product.',
      renderLine,
      productContext,
      'FINAL CHECK: product matches reference; background and props look intentionally redesigned (not a near-copy, not a totally different building type).'
    ]
      .filter(Boolean)
      .join('\n');
  }

  // high
  return [
    'IMAGE EDIT — FULL SCENE REPLACEMENT (high change).',
    'A reference photo is attached. Read the manufactured product from that photo — do not invent a different product and do not ignore the image.',
    'Use the reference only as the product identity source. The output location must be unmistakably different from the source room.',
    PRODUCT_LOCK,
    PROP_NOTE,
    'MANDATORY VISIBLE CHANGE: remove and replace the entire original environment and all original decoration. Walls, floor, architecture, surrounding furniture, spatial depth, palette and ambient lighting must all change. The source background must not remain recognizable. Do not return a subtle restyle of the same room.',
    `Build this new environment around the locked product: ${scene}. If the source already resembles this setting, push architecture, materials, palette and lighting into a clearly contrasting version of that style.`,
    'Remove every original loose prop and replace with visibly different scene-appropriate decoration. Never copy the same TV, plant, vase, book set, artwork or arrangement from the reference.',
    'Rebuild only contact shadow and physically necessary environmental reflections. Preserve the product’s characteristic finish as identity cues. Nothing may overlap or hide the product.',
    renderLine,
    productContext,
    'FINAL CHECK: product matches reference; every loose decoration and the surrounding scene are visibly new. Returning the original room or near-identical background is incorrect for high change.'
  ]
    .filter(Boolean)
    .join('\n');
}

function buildVariantRecolorPrompt(
  extraPrompt: string,
  areaStrength: AreaChangeStrength,
  targetBodyColor?: BodyColorOption,
  targetDoorColor?: DoorColorOption,
  targetPlexiglass?: PlexiglassOption,
  targetHandleMetal?: HardwareMetalOption,
  targetLegMetal?: LegFinishOption,
  targetLegBodyMatch?: boolean
): string {
  const extraNotes = extraPrompt
    ? `OPTIONAL USER NOTES (apply only if they do not change the target product finish): ${extraPrompt}`
    : '';
  const catalogTarget = [
    buildManualCatalogTargetLine(targetBodyColor, targetDoorColor),
    buildManualPlexiglassLine(targetPlexiglass),
    buildManualHandleLine(targetHandleMetal),
    buildManualLegLine(targetLegMetal, targetLegBodyMatch)
  ]
    .filter(Boolean)
    .join(' ');

  const areaLine =
    areaStrength === 'none'
      ? 'AREA CHANGE: NONE. Recolor only the manufactured product surfaces. Do not restyle walls, floor, architecture, surrounding furniture, props, textiles, plants or camera. Product legs and handles are NOT area-change — they follow the leg/handle locks. Keep IMAGE 1 lighting. A tiny contact-shadow tint is allowed if the new finish requires it.'
      : areaStrength === 'low'
        ? 'AREA CHANGE: LOW. Keep the same room, architecture, camera and lighting. Allow only a faint contact-shadow / floor-reflection tint so the recolored product still sits naturally. No new props, no wall or furniture restyle. Do not recolor product legs or handles as part of area change.'
        : areaStrength === 'medium'
          ? 'AREA CHANGE: MEDIUM. Keep the same room type, camera, product placement and overall lighting. Nearby floor/wall immediately around the product may pick up a restrained harmony with the new body/door color. Do not redesign the architecture. Do not recolor, replace or restyle the product’s legs, feet or handles to “match” the room or the plexiglass.'
          : 'AREA CHANGE: HIGH. Keep the same location identity, camera and lighting setup. Nearby styling (small props, textiles immediately around the product) may be restyled to complement the new color. The room must still read as the same photograph. Product legs and handles stay under the hardware locks — area change must not paint them gold/silver/black.';

  return [
    'IMAGE EDIT — recolor the product in IMAGE 1 using the finish visible on the furniture in IMAGE 2.',
    'IMAGE 1 = scene to edit (room + current product color). IMAGE 2 = colour/material source only.',
    catalogTarget,
    'Read IMAGE 2 like a catalogue swatch: sample only large, well-lit furniture surfaces (body, doors, top, sides). Ignore IMAGE 2 background, floor, studio sweep, cast shadows, reflections and any props.',
    'Copy body and door finishes independently if they differ — hue, lightness, wood/stone grain, laminate and sheen. Do not invent a third colourway. Do not average IMAGE 1 with IMAGE 2. Do not keep IMAGE 1 product colors. Do not drift toward a random trendy wood, grey, cream or white that IMAGE 2 does not show.',
    'If IMAGE 2 door faces are pale cream slats with stone pores/speckles (travertine), copy that stone — do not “correct” slatted doors into oak or honey wood.',
    'HARDWARE LOCK: legs and handles are independent of body/door/plexi. Read IMAGE 2 legs and IMAGE 2 handles separately. Chrome / steel / nickel = silver. Warm highlights on chrome are still silver — never gold. Do not paint legs gold because plexiglass or handles are gold.',
    'SHAPE LOCK: keep IMAGE 1 silhouette, door splits, hardware, handles, legs, seams, shelves, logos, product count and placement. Do not paste the IMAGE 2 studio shot into the room.',
    'SCENE LOCK: keep IMAGE 1 camera, crop, room, architecture and lighting. Rebuild only the product’s local color response under that same light.',
    areaLine,
    PROP_NOTE,
    extraNotes,
    'One seamless photoreal commercial photograph — not a collage, split-screen or before/after.',
    'FINAL CHECK: same room and SKU as IMAGE 1; product finish matches IMAGE 2' +
      (catalogTarget ? ' and the user-selected catalogue finish' : '') +
      '. Wrong or invented product color is a failed edit.'
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildPromptVariants(
  basePrompt: string,
  count: number,
  options: PromptVariantOptions = {}
): string[] {
  const cleanPrompt = basePrompt.trim();
  const variants: string[] = [];
  const strength = normalizeSceneVariationStrength(options.sceneVariationStrength);
  const areaStrength = normalizeAreaChangeStrength(options.areaChangeStrength);
  const targetBodyColor = parseBodyColorOption(options.targetBodyColor);
  const targetDoorColor = parseDoorColorOption(options.targetDoorColor);
  const targetPlexiglass = parsePlexiglassOption(options.targetPlexiglass);
  const targetHandleMetal = parseHardwareMetalOption(options.targetHandleMetal);
  const targetLegMetal = parseLegFinishOption(options.targetLegMetal);
  const targetLegBodyMatch = options.targetLegBodyMatch === true;

  for (let i = 0; i < count; i += 1) {
    const style = STYLE_MODIFIERS[i % STYLE_MODIFIERS.length];
    if (options.variantRecolor) {
      // Do not cycle lighting/style modifiers here — they fight the scene lock
      // and make the model ignore IMAGE 2’s colourway.
      variants.push(
        buildVariantRecolorPrompt(
          cleanPrompt,
          areaStrength,
          targetBodyColor,
          targetDoorColor,
          targetPlexiglass,
          targetHandleMetal,
          targetLegMetal,
          targetLegBodyMatch
        )
      );
      continue;
    }
    if (options.sceneVariation) {
      const scene = SCENE_VARIATIONS[i % SCENE_VARIATIONS.length];
      variants.push(buildSceneVariationPrompt(cleanPrompt, style, scene, strength));
      continue;
    }
    variants.push(
      [
        'Use the attached reference photo as the product identity source. You must read it.',
        cleanPrompt ||
          'Create a photorealistic commercial furniture catalogue image from the reference.',
        `Keep the same subject identity and composition as the provided reference image. Render style: ${style}.`
      ].join(' ')
    );
  }

  return variants;
}
