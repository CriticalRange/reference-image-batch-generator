import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { corsPreflightResponse, jsonWithCors } from '@/lib/security';

export const runtime = 'nodejs';

/**
 * Serves the OpenAPI 3.1 document from docs/openapi.yaml.
 * Swagger UI and external tools fetch this URL.
 */
export async function OPTIONS(req: NextRequest) {
  const preflight = corsPreflightResponse(req);
  if (preflight) {
    return preflight;
  }
  return new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const filePath = path.join(process.cwd(), 'docs', 'openapi.yaml');
    const yaml = await readFile(filePath, 'utf8');

    return new NextResponse(yaml, {
      status: 200,
      headers: {
        'Content-Type': 'application/yaml; charset=utf-8',
        'Cache-Control': 'public, max-age=60'
      }
    });
  } catch (error) {
    console.error('[api/openapi] failed to read openapi.yaml', error);
    return jsonWithCors(req, { error: 'OpenAPI document is not available.' }, { status: 500 });
  }
}
