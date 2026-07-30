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

export function buildPromptVariants(basePrompt: string, count: number): string[] {
  const cleanPrompt = basePrompt.trim();
  const variants: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const style = STYLE_MODIFIERS[i % STYLE_MODIFIERS.length];
    variants.push(
      `${cleanPrompt}. Keep the same subject identity and composition as the provided reference image. Render style: ${style}.`
    );
  }

  return variants;
}
