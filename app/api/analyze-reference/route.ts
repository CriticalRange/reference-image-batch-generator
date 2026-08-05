import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserText,
  finalizeAnalysis,
  parseAnalysisJson,
  type ReferenceAnalysis
} from '@/lib/referenceAnalysis';
import { applyCorsHeaders, corsPreflightResponse, enforceRateLimit, jsonWithCors, requireApiAccess } from '@/lib/security';

type RequestBody = {
  base64?: string;
  mimeType?: string;
  fileName?: string;
};

const DEFAULT_ANALYSIS_MODEL = 'gemini-2.5-flash';
const MAX_BASE64_CHARS = 12 * 1024 * 1024;

export async function OPTIONS(req: NextRequest) {
  const preflight = corsPreflightResponse(req);
  if (preflight) {
    return preflight;
  }
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  try {
    const accessDenied = requireApiAccess(req);
    if (accessDenied) {
      return accessDenied;
    }

    const limited = enforceRateLimit(req, 'analyze-reference:post');
    if (limited) {
      return limited;
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return jsonWithCors(
        req,
        { error: 'Missing GEMINI_API_KEY. Required for reference analysis (Gemini Flash).' },
        { status: 500 }
      );
    }

    const body = (await req.json()) as RequestBody;
    const base64 = body.base64?.replace(/^data:[^;]+;base64,/, '').trim() ?? '';
    const mimeType = (body.mimeType?.trim() || 'image/jpeg').toLowerCase();
    const fileName = body.fileName?.trim();

    if (!base64) {
      return jsonWithCors(req, { error: 'Reference image base64 is required.' }, { status: 400 });
    }
    if (base64.length > MAX_BASE64_CHARS) {
      return jsonWithCors(req, { error: 'Reference image is too large for analysis.' }, { status: 413 });
    }
    if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(mimeType)) {
      return jsonWithCors(req, { error: 'Unsupported image MIME type for analysis.' }, { status: 400 });
    }

    const model =
      process.env.GEMINI_ANALYSIS_MODEL?.trim() ||
      process.env.NEXT_PUBLIC_GEMINI_ANALYSIS_MODEL?.trim() ||
      DEFAULT_ANALYSIS_MODEL;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${ANALYSIS_SYSTEM_PROMPT}\n\n${buildAnalysisUserText(fileName)}` },
            { inlineData: { mimeType, data: base64 } }
          ]
        }
      ],
      config: {
        // Catalogue classification should be deterministic; creativity belongs in image generation.
        temperature: 0,
        responseMimeType: 'application/json'
      }
    });

    const text =
      response.text?.trim() ||
      response.candidates
        ?.flatMap((c) => c.content?.parts ?? [])
        .map((p) => p.text)
        .filter(Boolean)
        .join('\n')
        .trim() ||
      '';

    if (!text) {
      return jsonWithCors(req, { error: 'Analysis model returned empty response.' }, { status: 502 });
    }

    let analysis: ReferenceAnalysis;
    try {
      analysis = finalizeAnalysis(parseAnalysisJson(text));
    } catch (parseError) {
      console.error('[api/analyze-reference] JSON parse failed', {
        preview: text.slice(0, 400),
        parseError
      });
      return jsonWithCors(
        req,
        { error: 'Failed to parse analysis JSON from the model.', raw: text.slice(0, 800) },
        { status: 502 }
      );
    }

    return jsonWithCors(req, { analysis, model }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/analyze-reference] failed', message);
    return jsonWithCors(
      req,
      { error: message || 'Reference analysis failed.' },
      { status: 500 }
    );
  }
}
