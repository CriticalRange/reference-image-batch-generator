const STYLE_MODIFIERS = [
  'photoreal editorial lighting',
  'natural daylight and soft shadows',
  'cinematic contrast with clean focus falloff',
  'high-detail studio product style',
  'documentary realism with true-to-life tones',
  'subtle film grain and balanced color response',
  'premium magazine look with refined reflections',
  'minimal composition and modern commercial finish'
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
