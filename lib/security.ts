import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_API_RATE_LIMIT = 20;
const DEFAULT_API_RATE_WINDOW_MS = 60_000;

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

export function requireApiAccess(req: NextRequest): NextResponse | null {
  const expectedToken = process.env.APP_ACCESS_TOKEN?.trim();
  if (!expectedToken) {
    return null;
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token || !safeTokenEquals(token, expectedToken)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
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
  return NextResponse.json(
    { error: 'Too many requests. Please wait and try again.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds)
      }
    }
  );
}

