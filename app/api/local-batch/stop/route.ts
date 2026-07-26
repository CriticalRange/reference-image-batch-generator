import { NextRequest } from 'next/server';
import { enforceRateLimit, jsonWithCors, requireApiAccess } from '@/lib/security';
import { isLocalBatchAllowed, requestStop } from '@/lib/localBatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const denied = requireApiAccess(req) || enforceRateLimit(req, 'local-batch-stop');
  if (denied) return denied;

  const allowed = isLocalBatchAllowed();
  if (!allowed.ok) {
    return jsonWithCors(req, { error: allowed.reason }, { status: 403 });
  }

  try {
    requestStop();
    return jsonWithCors(req, { ok: true, message: 'Durdurma sinyali gönderildi (STOP flag + process).' });
  } catch (e) {
    return jsonWithCors(
      req,
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
