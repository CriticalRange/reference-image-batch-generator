import { appendFileSync } from 'fs';
import { NextRequest } from 'next/server';
import { enforceRateLimit, jsonWithCors, requireApiAccess } from '@/lib/security';
import { getLocalBatchPaths, isLocalBatchAllowed, startBatchSafe } from '@/lib/localBatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Start is intentional user action; light limit only (not the 20/min status poll).
  const denied = requireApiAccess(req) || enforceRateLimit(req, 'local-batch-start');
  if (denied) return denied;

  const allowed = isLocalBatchAllowed();
  if (!allowed.ok) {
    return jsonWithCors(req, { error: allowed.reason }, { status: 403 });
  }

  let body: {
    fromCode?: string;
    brand?: string;
    target?: number;
    count?: number;
    sleep?: number;
    requestTimeout?: number;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    const brand =
      body.brand === 'zetuna' || body.brand === 'ceneyra' ? body.brand : ('' as const);
    try {
      const { logPath } = getLocalBatchPaths();
      appendFileSync(
        logPath,
        `\n=== DASHBOARD START ${new Date().toISOString()} from=${body.fromCode || '-'} ===\n`,
        'utf-8'
      );
    } catch {
      /* ignore */
    }
    const result = startBatchSafe({
      fromCode: body.fromCode,
      brand: brand || undefined,
      target: body.target,
      count: body.count,
      sleep: body.sleep,
      requestTimeout: body.requestTimeout,
    });
    return jsonWithCors(req, {
      ok: true,
      pid: result.pid,
      args: result.args,
      message: `Batch başlatıldı (PID ${result.pid})`,
    });
  } catch (e) {
    return jsonWithCors(
      req,
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
