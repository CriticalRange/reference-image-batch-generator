import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_API_RATE_LIMIT = 20;
const DEFAULT_API_RATE_WINDOW_MS = 60_000;
const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization';
const CORS_MAX_AGE_SECONDS = '86400';

type RateEntry = {
  count: number;
  resetAt: number;
};

const requestBuckets = new Map<string, RateEntry>();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

function safeTokenEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * Parse API_CORS_ORIGINS:
 * - unset / empty → no CORS (same-origin / non-browser clients only)
 * - `*` → allow any Origin
 * - comma-separated list → allow exact matches
 */
function parseCorsOrigins(): string[] | '*' | null {
  const raw = process.env.API_CORS_ORIGINS?.trim();
  if (!raw) {
    return null;
  }
  if (raw === '*') {
    return '*';
  }
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function resolveAllowedCorsOrigin(req: NextRequest): string | null {
  const allowed = parseCorsOrigins();
  if (!allowed) {
    return null;
  }
  if (allowed === '*') {
    return '*';
  }

  const origin = req.headers.get('origin')?.trim();
  if (!origin) {
    return null;
  }
  return allowed.includes(origin) ? origin : null;
}

/** Attach CORS headers when API_CORS_ORIGINS is configured. */
export function applyCorsHeaders(req: NextRequest, response: NextResponse): NextResponse {
  const allowedOrigin = resolveAllowedCorsOrigin(req);
  if (!allowedOrigin) {
    return response;
  }

  response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  response.headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
  response.headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  response.headers.set('Access-Control-Max-Age', CORS_MAX_AGE_SECONDS);
  if (allowedOrigin !== '*') {
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

/** Browser preflight response (204). Returns null when CORS is disabled. */
export function corsPreflightResponse(req: NextRequest): NextResponse | null {
  if (!parseCorsOrigins()) {
    return null;
  }
  return applyCorsHeaders(req, new NextResponse(null, { status: 204 }));
}

export function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit): NextResponse {
  return applyCorsHeaders(req, NextResponse.json(body, init));
}

export function requireApiAccess(req: NextRequest): NextResponse | null {
  const expectedToken = process.env.APP_ACCESS_TOKEN?.trim();
  if (!expectedToken) {
    return null;
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token || !safeTokenEquals(token, expectedToken)) {
    return jsonWithCors(req, { error: 'Unauthorized.' }, { status: 401 });
  }

  return null;
}

export function enforceRateLimit(req: NextRequest, scope: string): NextResponse | null {
  const limit = parsePositiveInt(process.env.API_RATE_LIMIT, DEFAULT_API_RATE_LIMIT);
  const windowMs = parsePositiveInt(process.env.API_RATE_WINDOW_MS, DEFAULT_API_RATE_WINDOW_MS);
  const now = Date.now();
  const key = `${scope}:${getClientIp(req)}`;
  const current = requestBuckets.get(key);

  if (!current || current.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  current.count += 1;
  if (current.count <= limit) {
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return jsonWithCors(
    req,
    { error: 'Too many requests. Please wait and try again.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds)
      }
    }
  );
}

