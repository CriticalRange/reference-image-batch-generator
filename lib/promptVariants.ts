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

export type PromptVariantOptions = {
  /** Preserve the referenced product while refreshing / replacing its surrounding scene. */
  sceneVariation?: boolean;
  /** Scene change amount. Only used when sceneVariation is true. Default: low. */
  sceneVariationStrength?: SceneVariationStrength;
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

export function buildPromptVariants(
  basePrompt: string,
  count: number,
  options: PromptVariantOptions = {}
): string[] {
  const cleanPrompt = basePrompt.trim();
  const variants: string[] = [];
  const strength = normalizeSceneVariationStrength(options.sceneVariationStrength);

  for (let i = 0; i < count; i += 1) {
    const style = STYLE_MODIFIERS[i % STYLE_MODIFIERS.length];
    if (options.sceneVariation) {
      const scene = SCENE_VARIATIONS[i % SCENE_VARIATIONS.length];
      variants.push(buildSceneVariationPrompt(cleanPrompt, style, scene, strength));
      continue;
    }
    variants.push(
      `${cleanPrompt}. Keep the same subject identity and composition as the provided reference image. Render style: ${style}.`
    );
  }

  return variants;
}
