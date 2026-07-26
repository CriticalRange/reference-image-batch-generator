import { NextRequest } from 'next/server';
import { jsonWithCors, requireApiAccess } from '@/lib/security';
import {
  getDisplayLog,
  getLocalBatchPaths,
  isLocalBatchAllowed,
  isPidAlive,
  readLiveStatus,
  readPid,
  scanProgress,
} from '@/lib/localBatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseUpdatedAtMs(updatedAt?: string | null): number | null {
  if (!updatedAt) return null;
  // "2026-07-24T14:23:16" local wall clock without Z — treat as local
  const t = Date.parse(updatedAt.includes('T') && !updatedAt.endsWith('Z') ? updatedAt : updatedAt);
  if (Number.isFinite(t)) return t;
  const t2 = Date.parse(updatedAt + 'Z');
  return Number.isFinite(t2) ? t2 : null;
}

export async function GET(req: NextRequest) {
  // Status is polled every ~2s by the dashboard — do NOT rate-limit (local-only panel).
  const denied = requireApiAccess(req);
  if (denied) return denied;

  const allowed = isLocalBatchAllowed();
  if (!allowed.ok) {
    return jsonWithCors(req, { enabled: false, error: allowed.reason }, { status: 403 });
  }

  const force = req.nextUrl.searchParams.get('force') === '1';
  const live = readLiveStatus();
  const pid = (live?.pid as number | undefined) || readPid();
  const processAlive = pid ? isPidAlive(pid) : false;
  const updatedMs = parseUpdatedAtMs(live?.updated_at);
  const ageSec = updatedMs != null ? Math.max(0, Math.round((Date.now() - updatedMs) / 1000)) : null;
  // Canlı: process ayakta VEYA status son 45 sn içinde güncellendi
  const heartbeatFresh = ageSec != null && ageSec <= 45;
  const running = Boolean(processAlive || (live?.running && heartbeatFresh));

  let scan = null;
  try {
    scan = scanProgress(force);
  } catch (e) {
    scan = { error: e instanceof Error ? e.message : String(e) };
  }

  const paths = getLocalBatchPaths();
  return jsonWithCors(req, {
    enabled: true,
    running,
    processAlive,
    heartbeatFresh,
    heartbeatAgeSec: ageSec,
    serverNow: new Date().toISOString(),
    pid: pid ?? null,
    live,
    scan,
    logTail: getDisplayLog(60),
    paths: {
      scriptPath: paths.scriptPath,
      statusPath: paths.statusPath,
      logPath: paths.logPath,
      urunlerRoot: paths.urunlerRoot,
    },
  });
}
