import { NextRequest, NextResponse } from 'next/server';

type FalPricingEntry = {
  endpointId: string;
  unitPrice: number;
  unit?: string;
  currency?: string;
};

const FAL_MODEL_CODE_PATTERN = /^fal-ai\/[a-z0-9./_-]+$/i;
const MAX_ENDPOINTS_PER_REQUEST = 50;

export async function GET(req: NextRequest) {
  const apiKey = process.env.FAL_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ prices: [] satisfies FalPricingEntry[] }, { status: 200 });
  }

  const endpointIds = parseEndpointIds(req);
  if (endpointIds.length === 0) {
    return NextResponse.json({ prices: [] satisfies FalPricingEntry[] }, { status: 200 });
  }

  const query = endpointIds.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join('&');
  const response = await fetch(`https://api.fal.ai/v1/models/pricing?${query}`, {
    method: 'GET',
    headers: {
      Authorization: `Key ${apiKey}`
    },
    cache: 'no-store'
  });

  const payload = (await response.json().catch(() => ({}))) as { prices?: unknown; error?: unknown; message?: unknown };
  if (!response.ok) {
    const detail = String(payload.error ?? payload.message ?? `fal pricing request failed (${response.status})`);
    return NextResponse.json({ error: detail }, { status: response.status });
  }

  const prices = Array.isArray(payload.prices) ? payload.prices : [];
  const normalized = prices
    .map(normalizePricingEntry)
    .filter((entry): entry is FalPricingEntry => entry !== null);

  return NextResponse.json({ prices: normalized }, { status: 200 });
}

function parseEndpointIds(req: NextRequest): string[] {
  const raw = req.nextUrl.searchParams
    .getAll('endpoint_id')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  for (const value of raw) {
    if (!FAL_MODEL_CODE_PATTERN.test(value)) {
      continue;
    }
    unique.add(value);
    if (unique.size >= MAX_ENDPOINTS_PER_REQUEST) {
      break;
    }
  }

  return Array.from(unique.values());
}

function normalizePricingEntry(value: unknown): FalPricingEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const row = value as Record<string, unknown>;
  const endpointIdRaw = row.endpoint_id;
  const unitPriceRaw = row.unit_price;
  if (typeof endpointIdRaw !== 'string' || !endpointIdRaw.trim()) {
    return null;
  }

  const unitPrice = typeof unitPriceRaw === 'number' ? unitPriceRaw : Number.parseFloat(String(unitPriceRaw));
  if (!Number.isFinite(unitPrice)) {
    return null;
  }

  const unit = typeof row.unit === 'string' && row.unit.trim() ? row.unit.trim() : undefined;
  const currency = typeof row.currency === 'string' && row.currency.trim() ? row.currency.trim() : undefined;

  return {
    endpointId: endpointIdRaw.trim(),
    unitPrice,
    ...(unit ? { unit } : {}),
    ...(currency ? { currency } : {})
  };
}
