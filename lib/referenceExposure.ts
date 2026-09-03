import sharp from 'sharp';

type ReferenceImage = {
  base64: string;
  mimeType: string;
};

/** Mean RGB above this is treated as a photographically bright / high-key plate. */
const BRIGHT_MEAN = 136;
/** Pull the plate toward this mean so the image model does not copy a blown histogram. */
const TARGET_MEAN = 112;
const MIN_BRIGHTNESS_FACTOR = 0.7;

function rgbMean(stats: sharp.Stats): number | null {
  const rgb = stats.channels.slice(0, 3);
  if (rgb.length < 3) {
    return null;
  }
  return rgb.reduce((sum, channel) => sum + channel.mean, 0) / rgb.length;
}

/**
 * Catalogue refs are often over-bright lifestyle shots. Image models copy that
 * exposure. Pull the plate down when it is statistically bright so generation
 * starts from a medium catalogue histogram. Product color stays readable;
 * lighting/EV is what we change. Skip variant-recolor (scene light is locked).
 */
export async function normalizeBrightCatalogueReferences(
  references: ReferenceImage[]
): Promise<ReferenceImage[]> {
  if (references.length === 0) {
    return references;
  }
  return Promise.all(references.map(toneDownIfBright));
}

async function toneDownIfBright(reference: ReferenceImage): Promise<ReferenceImage> {
  try {
    const input = Buffer.from(reference.base64, 'base64');
    const stats = await sharp(input, { failOn: 'none' }).stats();
    const mean = rgbMean(stats);
    if (mean == null || mean < BRIGHT_MEAN) {
      return reference;
    }

    const brightness = Math.max(MIN_BRIGHTNESS_FACTOR, TARGET_MEAN / mean);
    const buffer = await sharp(input, { failOn: 'none' })
      .rotate()
      .modulate({ brightness })
      .gamma(2.2, 2.48)
      .jpeg({ quality: 93 })
      .toBuffer();

    console.error('[reference-exposure] toned down bright plate', {
      mean: Math.round(mean),
      brightness: Number(brightness.toFixed(3))
    });

    return {
      base64: buffer.toString('base64'),
      mimeType: 'image/jpeg'
    };
  } catch (error) {
    console.error('[reference-exposure] skipped (decode failed)', {
      message: error instanceof Error ? error.message : String(error)
    });
    return reference;
  }
}
