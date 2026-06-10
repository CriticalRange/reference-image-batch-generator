import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const revalidate = 3600;
import {
  CURATED_MODEL_OPTIONS,
  humanizeModelCode,
  inferModelGroup,
  mergeModelOptions,
  normalizeModelCode,
  sortModelOptions,
  type UiModelOption
} from '@/lib/modelOptions';

const DEFAULT_MODEL = 'vertex/gemini-2.5-flash-image';
const MAX_DISCOVERED_MODELS = 300;

function isSelectableModel(code: string): boolean {
  return /^(gemini|imagen)-/i.test(code);
}

function buildDefaultModelOption(model: string): UiModelOption {
  return {
    code: model,
    name: humanizeModelCode(model),
    group: inferModelGroup(model)
  };
}

export async function GET() {
  const configuredDefault = process.env.NEXT_PUBLIC_GEMINI_IMAGE_MODEL ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const defaultModel = normalizeModelCode(configuredDefault);
  const fallback = sortModelOptions(mergeModelOptions(CURATED_MODEL_OPTIONS, [buildDefaultModelOption(defaultModel)]));
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ models: fallback, defaultModel, source: 'catalog' }, { status: 200 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const pager = await ai.models.list({
      config: {
        pageSize: 150,
        queryBase: true
      }
    });
    const discovered: UiModelOption[] = [];
    let discoveredCount = 0;

    for await (const model of pager) {
      const name = model.name?.trim();
      if (!name) {
        continue;
      }

      const code = normalizeModelCode(name);
      if (!isSelectableModel(code)) {
        continue;
      }

      discovered.push({
        code,
        name: model.displayName?.trim() || humanizeModelCode(code),
        group: inferModelGroup(code)
      });
      discoveredCount += 1;

      if (discoveredCount >= MAX_DISCOVERED_MODELS) {
        break;
      }
    }

    const models = sortModelOptions(mergeModelOptions(fallback, discovered));
    return NextResponse.json({ models, defaultModel, source: 'api' }, { status: 200 });
  } catch {
    return NextResponse.json({ models: fallback, defaultModel, source: 'catalog' }, { status: 200 });
  }
}
