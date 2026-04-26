import { NextRequest, NextResponse } from 'next/server';
import { submitBatch, getBatchStatus } from '@/lib/gemini';

type RequestBody = {
  prompt?: string;
  count?: number;
  model?: string;
  referenceImageBase64?: string;
  referenceMimeType?: string;
  aspectRatio?: string;
  imageSize?: string;
  resizeWidth?: number;
  resizeHeight?: number;
  referenceImages?: Array<{
    base64?: string;
    mimeType?: string;
  }>;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const prompt = body.prompt?.trim() ?? '';
    const count = body.count ?? 5;
    const model = body.model?.trim() ?? undefined;
    const aspectRatio = body.aspectRatio?.trim() ?? undefined;
    const imageSize = body.imageSize?.trim() ?? undefined;
    const resizeWidth = parseResizeDimension(body.resizeWidth);
    const resizeHeight = parseResizeDimension(body.resizeHeight);
    const referenceImageBase64 = body.referenceImageBase64?.trim() ?? '';
    const referenceMimeType = body.referenceMimeType?.trim() ?? '';
    const referenceImages =
      body.referenceImages
        ?.map((image) => ({
          base64: image.base64?.trim() ?? '',
          mimeType: image.mimeType?.trim() ?? ''
        }))
        .filter((image) => image.base64 && image.mimeType) ?? [];

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required.' }, { status: 400 });
    }

    if ((typeof resizeWidth === 'number' && typeof resizeHeight !== 'number') || (typeof resizeHeight === 'number' && typeof resizeWidth !== 'number')) {
      return NextResponse.json({ error: 'Resize width and height must both be provided.' }, { status: 400 });
    }

    const normalizedReferences =
      referenceImages.length > 0
        ? referenceImages
        : referenceImageBase64 && referenceMimeType
          ? [{ base64: referenceImageBase64, mimeType: referenceMimeType }]
          : [];
    const resizeTo =
      typeof resizeWidth === 'number' && typeof resizeHeight === 'number'
        ? {
            width: resizeWidth,
            height: resizeHeight
          }
        : undefined;

    const submission = await submitBatch({
      basePrompt: prompt,
      count,
      model,
      aspectRatio,
      imageSize,
      resizeTo,
      referenceImages: normalizedReferences
    });

    return NextResponse.json(submission, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('job');
    const provider = searchParams.get('provider');

    if (!jobId || !provider) {
      return NextResponse.json({ error: 'Missing job or provider parameter.' }, { status: 400 });
    }

    if (provider !== 'gemini' && provider !== 'together') {
      return NextResponse.json({ error: 'Invalid provider.' }, { status: 400 });
    }

    const status = await getBatchStatus(jobId, provider);
    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseResizeDimension(value: unknown): number | undefined {
  if (typeof value === 'undefined' || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.round(parsed);
}
