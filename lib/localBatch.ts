import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { spawn, execSync } from 'child_process';

/** Local-only KA Konsol batch control (Windows Desktop worker). */

export type LocalBatchLiveStatus = {
  running?: boolean;
  pid?: number | null;
  phase?: string;
  brand?: string | null;
  product?: string | null;
  product_code?: string | null;
  color?: string | null;
  stock?: string | null;
  have?: number;
  target?: number;
  refs?: string[];
  message?: string;
  last_saved?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  stats?: Record<string, unknown>;
  recent_log?: string[];
};

export type BrandProgress = {
  brand: string;
  products: number;
  readyColors: number;
  doneColors: number;
  files: number;
  slots: number;
  pctFiles: number;
  pctColors: number;
  completeCodes: string[];
  partial: Array<{ code: string; done: string[]; miss: string[] }>;
};

export type ScanResult = {
  target: number;
  minGenIndex: number;
  brands: BrandProgress[];
  combined: {
    readyColors: number;
    doneColors: number;
    files: number;
    slots: number;
    pctFiles: number;
    pctColors: number;
    remaining: number;
  };
  scannedAt: string;
};

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const DEFAULT_TARGET = 6;
const DEFAULT_MIN_GEN = 4;

function desktopDir(): string {
  return process.env.LOCAL_BATCH_DESKTOP?.trim() || join(homedir(), 'Desktop');
}

export function getLocalBatchPaths() {
  const desktop = desktopDir();
  return {
    desktop,
    statusPath: process.env.LOCAL_BATCH_STATUS_PATH?.trim() || join(desktop, 'ka_batch_status.json'),
    stopFlagPath: process.env.LOCAL_BATCH_STOP_FLAG?.trim() || join(desktop, 'ka_batch_STOP.flag'),
    pidPath: process.env.LOCAL_BATCH_PID_PATH?.trim() || join(desktop, 'ka_batch.pid'),
    logPath: process.env.LOCAL_BATCH_LOG_PATH?.trim() || join(desktop, 'ka_batch_full.log'),
    scriptPath:
      process.env.LOCAL_BATCH_SCRIPT?.trim() || join(desktop, 'batch_generate_konsol.py'),
    pythonPath: process.env.LOCAL_BATCH_PYTHON?.trim() || 'python',
    urunlerRoot:
      process.env.LOCAL_BATCH_URUNLER?.trim() ||
      String.raw`G:\Ortak Drive'lar\Ceneyra\ÜRÜNLER`,
  };
}

export function isLocalBatchAllowed(): { ok: boolean; reason?: string } {
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
    return { ok: false, reason: 'Local batch paneli Vercel üzerinde çalışmaz; sadece bilgisayarında next dev.' };
  }
  if (process.env.LOCAL_BATCH_ENABLED === '0' || process.env.LOCAL_BATCH_ENABLED === 'false') {
    return { ok: false, reason: 'LOCAL_BATCH_ENABLED kapalı.' };
  }
  // Default: allow in development; require explicit enable in production node
  if (process.env.NODE_ENV === 'production' && process.env.LOCAL_BATCH_ENABLED !== '1' && process.env.LOCAL_BATCH_ENABLED !== 'true') {
    return { ok: false, reason: 'Production’da LOCAL_BATCH_ENABLED=true gerekli.' };
  }
  return { ok: true };
}

export function readLiveStatus(): LocalBatchLiveStatus | null {
  const { statusPath } = getLocalBatchPaths();
  if (!existsSync(statusPath)) return null;
  try {
    return JSON.parse(readFileSync(statusPath, 'utf-8')) as LocalBatchLiveStatus;
  } catch {
    return null;
  }
}

export function readPid(): number | null {
  const { pidPath } = getLocalBatchPaths();
  if (!existsSync(pidPath)) return null;
  try {
    const n = Number.parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf-8' });
      return out.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function requestStop(): void {
  const { stopFlagPath, pidPath } = getLocalBatchPaths();
  writeFileSync(stopFlagPath, `stop ${new Date().toISOString()}\n`, 'utf-8');
  const pid = readPid();
  if (pid && isPidAlive(pid)) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      /* ignore */
    }
  }
  try {
    if (existsSync(pidPath)) unlinkSync(pidPath);
  } catch {
    /* ignore */
  }
}

export type StartBatchOptions = {
  fromCode?: string;
  brand?: 'zetuna' | 'ceneyra' | '';
  target?: number;
  count?: number;
  sleep?: number;
  requestTimeout?: number;
};

export function startBatch(opts: StartBatchOptions = {}): { pid: number; args: string[] } {
  const paths = getLocalBatchPaths();
  if (!existsSync(paths.scriptPath)) {
    throw new Error(`Script yok: ${paths.scriptPath}`);
  }

  const existing = readPid();
  if (existing && isPidAlive(existing)) {
    throw new Error(`Zaten çalışıyor (PID ${existing}). Önce durdur.`);
  }

  try {
    if (existsSync(paths.stopFlagPath)) unlinkSync(paths.stopFlagPath);
  } catch {
    /* ignore */
  }

  const args = [
    '-u',
    paths.scriptPath,
    '--target',
    String(opts.target ?? DEFAULT_TARGET),
    '--count',
    String(opts.count ?? 1),
    '--sleep',
    String(opts.sleep ?? 90),
    '--request-timeout',
    String(opts.requestTimeout ?? 120),
  ];
  if (opts.fromCode?.trim()) {
    args.push('--from-code', opts.fromCode.trim().toUpperCase());
  }
  if (opts.brand === 'zetuna' || opts.brand === 'ceneyra') {
    args.push('--brand', opts.brand);
  }

  // Non-Windows: detached python, ignore stdio (status.json carries progress)
  const child = spawn(paths.pythonPath, args, {
    cwd: paths.desktop,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
  });
  child.unref();
  if (!child.pid) {
    throw new Error('Process başlatılamadı (pid yok)');
  }
  writeFileSync(paths.pidPath, String(child.pid), 'utf-8');
  return { pid: child.pid, args };
}

/** More reliable Windows start with log redirect + pid capture via powershell. */
export function startBatchWindows(opts: StartBatchOptions = {}): { pid: number; args: string[] } {
  const paths = getLocalBatchPaths();
  if (!existsSync(paths.scriptPath)) {
    throw new Error(`Script yok: ${paths.scriptPath}`);
  }
  const existing = readPid();
  if (existing && isPidAlive(existing)) {
    throw new Error(`Zaten çalışıyor (PID ${existing}). Önce durdur.`);
  }
  try {
    if (existsSync(paths.stopFlagPath)) unlinkSync(paths.stopFlagPath);
  } catch {
    /* ignore */
  }

  const argList = [
    '-u',
    paths.scriptPath,
    '--target',
    String(opts.target ?? DEFAULT_TARGET),
    '--count',
    String(opts.count ?? 1),
    '--sleep',
    String(opts.sleep ?? 90),
    '--request-timeout',
    String(opts.requestTimeout ?? 120),
  ];
  if (opts.fromCode?.trim()) {
    argList.push('--from-code', opts.fromCode.trim().toUpperCase());
  }
  if (opts.brand === 'zetuna' || opts.brand === 'ceneyra') {
    argList.push('--brand', opts.brand);
  }

  // Do NOT use PowerShell RedirectStandard* (writes UTF-16 → "harf arası boşluk").
  // Python writes ka_batch_status.json; optional log via cmd UTF-8 append.
  const psScriptPath = join(paths.desktop, 'ka_batch_start_once.ps1');
  const psBody = [
    `$ErrorActionPreference = 'Stop'`,
    `$exe = ${JSON.stringify(paths.pythonPath)}`,
    `$wd = ${JSON.stringify(paths.desktop)}`,
    `$log = ${JSON.stringify(paths.logPath)}`,
    `$pidFile = ${JSON.stringify(paths.pidPath)}`,
    `$argList = @(${argList.map((a) => JSON.stringify(a)).join(', ')})`,
    // cmd /c with UTF-8 code page + append keeps log readable
    `$argStr = ($argList | ForEach-Object { if ($_ -match '\\s') { '"' + $_ + '"' } else { $_ } }) -join ' '`,
    `$cmd = 'chcp 65001 >NUL & "' + $exe + '" ' + $argStr + ' >> "' + $log + '" 2>&1'`,
    `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmd) -WorkingDirectory $wd -WindowStyle Hidden -PassThru`,
    // Find python child shortly
    `Start-Sleep -Milliseconds 800`,
    `$py = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*batch_generate_konsol*' } | Sort-Object ProcessId -Descending | Select-Object -First 1`,
    `$id = if ($py) { $py.ProcessId } else { $p.Id }`,
    `Set-Content -Path $pidFile -Value $id -Encoding ascii -NoNewline`,
    `Write-Output $id`,
  ].join('\r\n');
  writeFileSync(psScriptPath, psBody, 'utf-8');

  const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, {
    encoding: 'utf-8',
    windowsHide: true,
  });
  const pid = Number.parseInt(out.trim().split(/\r?\n/).pop() || '', 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`Process başlatılamadı: ${out}`);
  }
  writeFileSync(paths.pidPath, String(pid), 'utf-8');
  return { pid, args: argList };
}

export function startBatchSafe(opts: StartBatchOptions = {}): { pid: number; args: string[] } {
  if (process.platform === 'win32') {
    return startBatchWindows(opts);
  }
  return startBatch(opts);
}

function productCodeFromFolder(name: string): string {
  const m = name.replace(/-+$/, '').trim().match(/^([A-Za-z]{2,3}\d{3,5})\b/);
  return m ? m[1].toUpperCase() : name.slice(0, 12).toUpperCase();
}

function listDashKonsol(brandRoot: string): string[] {
  const ka = join(brandRoot, 'KA - Konsol');
  if (!existsSync(ka)) return [];
  return readdirSync(ka)
    .map((name) => join(ka, name))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && basename(p).trimEnd().endsWith('-');
      } catch {
        return false;
      }
    })
    .filter((p) => productCodeFromFolder(basename(p)).startsWith('KA'))
    .sort((a, b) => basename(a).localeCompare(basename(b), 'tr'));
}

function walkImages(dir: string, out: string[] = [], skipDirName?: string): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (skipDirName && name.toUpperCase() === skipDirName.toUpperCase()) continue;
      walkImages(p, out, skipDirName);
    } else if (st.isFile()) {
      const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
      if (IMG_EXTS.has(ext)) out.push(p);
    }
  }
  return out;
}

function parseColorGroups(productDir: string): Record<string, Record<number, string>> {
  const pcode = productCodeFromFolder(basename(productDir));
  const byColor: Record<string, Record<number, string>> = {};
  const files = walkImages(productDir, [], pcode);
  const re = new RegExp(`^${pcode}([A-Za-z]+)(\\d+)$`, 'i');
  for (const f of files) {
    const stem = basename(f).replace(/\.[^.]+$/, '');
    const m = stem.match(re);
    if (!m) continue;
    const color = m[1].toUpperCase();
    const idx = Number.parseInt(m[2], 10);
    if (!byColor[color]) byColor[color] = {};
    byColor[color][idx] = f;
  }
  const ready: Record<string, Record<number, string>> = {};
  for (const [color, idxs] of Object.entries(byColor)) {
    const keys = Object.keys(idxs)
      .map(Number)
      .sort((a, b) => a - b);
    if (keys.includes(1) && keys.includes(2) && keys.includes(3)) {
      ready[color] = { 1: idxs[1], 2: idxs[2], 3: idxs[3] };
    } else if (keys.length >= 3) {
      const picked = keys.slice(0, 3);
      ready[color] = { 1: idxs[picked[0]], 2: idxs[picked[1]], 3: idxs[picked[2]] };
    }
  }
  return ready;
}

function countGenFiles(outDir: string, stock: string, minIndex: number): number {
  if (!existsSync(outDir)) return 0;
  let n = 0;
  const re = new RegExp(`^${stock}(\\d+)\\.`, 'i');
  try {
    for (const name of readdirSync(outDir)) {
      const m = name.match(re);
      if (!m) continue;
      const idx = Number.parseInt(m[1], 10);
      if (idx >= minIndex) n += 1;
    }
  } catch {
    return 0;
  }
  return n;
}

let scanCache: { at: number; result: ScanResult } | null = null;

export function scanProgress(force = false, target = DEFAULT_TARGET, minGen = DEFAULT_MIN_GEN): ScanResult {
  if (!force && scanCache && Date.now() - scanCache.at < 8000) {
    return scanCache.result;
  }
  const { urunlerRoot } = getLocalBatchPaths();
  const brandRoots: Array<{ brand: string; root: string }> = [
    { brand: 'zetuna', root: join(urunlerRoot, 'Zetuna home') },
    { brand: 'ceneyra', root: join(urunlerRoot, 'Ceneyra') },
  ];

  const brands: BrandProgress[] = [];
  let tf = 0;
  let ts = 0;
  let tr = 0;
  let td = 0;

  for (const { brand, root } of brandRoots) {
    const products = listDashKonsol(root);
    let files = 0;
    let slots = 0;
    let ready = 0;
    let done = 0;
    const completeCodes: string[] = [];
    const partial: BrandProgress['partial'] = [];

    for (const pdir of products) {
      const pcode = productCodeFromFolder(basename(pdir));
      const colors = parseColorGroups(pdir);
      const outDir = join(pdir, pcode);
      const doneList: string[] = [];
      const missList: string[] = [];
      for (const color of Object.keys(colors).sort()) {
        const stock = `${pcode}${color}`;
        const n = countGenFiles(outDir, stock, minGen);
        ready += 1;
        files += n;
        slots += target;
        if (n >= target) {
          done += 1;
          doneList.push(`${color}=${n}`);
        } else {
          missList.push(`${color}=${n}`);
        }
      }
      if (Object.keys(colors).length > 0 && missList.length === 0) {
        completeCodes.push(pcode);
      } else if (doneList.length > 0) {
        partial.push({ code: pcode, done: doneList, miss: missList });
      }
    }

    brands.push({
      brand,
      products: products.length,
      readyColors: ready,
      doneColors: done,
      files,
      slots,
      pctFiles: slots ? (100 * files) / slots : 0,
      pctColors: ready ? (100 * done) / ready : 0,
      completeCodes,
      partial,
    });
    tf += files;
    ts += slots;
    tr += ready;
    td += done;
  }

  const result: ScanResult = {
    target,
    minGenIndex: minGen,
    brands,
    combined: {
      readyColors: tr,
      doneColors: td,
      files: tf,
      slots: ts,
      pctFiles: ts ? (100 * tf) / ts : 0,
      pctColors: tr ? (100 * td) / tr : 0,
      remaining: Math.max(0, ts - tf),
    },
    scannedAt: new Date().toISOString(),
  };
  scanCache = { at: Date.now(), result };
  return result;
}

/** Decode log file; PowerShell redirect often writes UTF-16 LE (spaces between letters). */
function readTextFileSmart(filePath: string): string {
  const buf = readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // rare BE — Node has no utf16be; swap roughly via utf16le after reverse pairs not worth it
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  // Heuristic: many NUL bytes → UTF-16 LE without BOM
  const sample = buf.subarray(0, Math.min(buf.length, 200));
  let nuls = 0;
  for (let i = 1; i < sample.length; i += 2) {
    if (sample[i] === 0) nuls += 1;
  }
  if (sample.length > 20 && nuls / (sample.length / 2) > 0.4) {
    return buf.toString('utf16le');
  }
  return buf.toString('utf8');
}

export function tailLog(maxLines = 40): string[] {
  const { logPath } = getLocalBatchPaths();
  if (!existsSync(logPath)) return [];
  try {
    const text = readTextFileSmart(logPath);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/** Prefer status.json recent_log (UTF-8); fallback to file tail. */
export function getDisplayLog(maxLines = 50): string[] {
  const live = readLiveStatus();
  const fromStatus = (live?.recent_log || []).filter(Boolean);
  if (fromStatus.length > 0) {
    return fromStatus.slice(-maxLines);
  }
  return tailLog(maxLines);
}
