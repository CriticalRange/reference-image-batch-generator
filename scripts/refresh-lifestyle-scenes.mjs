/**
 * Refresh YUMEDİ lifestyle shots (SKU ending 1/2/3) via local generate API
 * (sceneVariation + medium) and drop them into matching Ceneyra folders.
 *
 * Usage:
 *   node scripts/refresh-lifestyle-scenes.mjs
 *   node scripts/refresh-lifestyle-scenes.mjs --codes TVR1819,KA1809
 *   node scripts/refresh-lifestyle-scenes.mjs --overwrite
 *   node scripts/refresh-lifestyle-scenes.mjs --dry-run
 *   node scripts/refresh-lifestyle-scenes.mjs --stems TVR1819B2,TVR1819B3 --overwrite
 *   node scripts/refresh-lifestyle-scenes.mjs --limit 1
 *
 * Env:
 *   API_BASE_URL        default http://localhost:3000
 *   APP_ACCESS_TOKEN    optional
 *   LIFESTYLE_MODEL     default vertex/gemini-3.1-flash-image-preview
 *   LIFESTYLE_AUTH_MODE default api_key
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const YUMEDI_ROOT = "G:\\Ortak Drive'lar\\Ceneyra\\ÜRÜNLER\\YUMEDİ DESİGN";
const CENEYRA_ROOT = "G:\\Ortak Drive'lar\\Ceneyra\\ÜRÜNLER\\Ceneyra";
const ZETUNA_ROOT = "G:\\Ortak Drive'lar\\Ceneyra\\ÜRÜNLER\\Zetuna home";

const FAMILY_DIR = {
  TVR: 'TVR - TV RAF',
  KA: 'KA - Konsol',
  TSA: 'TSA - TV STAND',
  TDA: 'TDA - TV DUVARA MONTE',
  DA: 'DA - Dresuar'
};

/** destSku, optional photoSku (KA1518 reads KA1818), source folder under YUMEDİ */
const PRODUCT_JOBS = [
  { destSku: 'TVR1819', photoSku: 'TVR1819', srcRel: path.join('TVR - TV RAF', 'TVR1819 TARÇIN TV ÜNİTESİ TAKIMI') },
  { destSku: 'TVR1804', photoSku: 'TVR1804', srcRel: path.join('TVR - TV RAF', 'TVR1804 ETHEMA TV ÜNİTESİ TAKIMI') },
  { destSku: 'TVR1801', photoSku: 'TVR1801', srcRel: path.join('TVR - TV RAF', 'TVR1801 KEREM TV ÜNİTESİ') },
  { destSku: 'TVR1803', photoSku: 'TVR1803', srcRel: path.join('TVR - TV RAF', 'TVR1803 DÜNYA TV ÜNİTESİ TAKIMI') },
  { destSku: 'KA1809', photoSku: 'KA1809', srcRel: path.join('KA - Konsol', 'KA1809 GÜMÜŞ KONSOL') },
  { destSku: 'KA1811', photoSku: 'KA1811', srcRel: path.join('KA - Konsol', 'KA1811 TEMTEM KONSOL') },
  { destSku: 'KA1812', photoSku: 'KA1812', srcRel: path.join('KA - Konsol', 'KA1812 AYSHE KONSOL') },
  { destSku: 'KA1828', photoSku: 'KA1828', srcRel: path.join('KA - Konsol', 'KA1828 MEBA KONSOL') },
  { destSku: 'KA1818', photoSku: 'KA1818', srcRel: path.join('KA - Konsol', 'KA1818 SHERİFA KONSOL'), destFolder: 'KA1818 PELLA KONSOL' },
  { destSku: 'KA1518', photoSku: 'KA1518', srcRel: path.join('KA - Konsol', 'KA1518 SHERİFA KONSOL'), destFolder: 'KA1518 PELLA KONSOL' },
  { destSku: 'KA1513', photoSku: 'KA1513', srcRel: path.join('KA - Konsol', 'KA1513 GRADİSHTE KONSOL'), destFolder: 'KA1513 ZEYNEP KONSOL-' },
  { destSku: 'KA1509', photoSku: 'KA1509', srcRel: path.join('KA - Konsol', 'KA1509 LEYLA KONSOL'), destFolder: 'KA1509 YUKA KONSOL-' },
  { destSku: 'KA1831', photoSku: 'KA1831', srcRel: path.join('KA - Konsol', 'KA1831 İLHANİYE KONSOL'), destFolder: 'KA1831 NOTA KONSOL' },
  { destSku: 'KA1242', photoSku: 'KA1242', srcRel: path.join('KA - Konsol', 'KA1242 İLAY KONSOL'), destFolder: 'KA1242 MADE KONSOL-' },
  { destSku: 'KA1842', photoSku: 'KA1842', srcRel: path.join('KA - Konsol', 'KA1842 İLAY KONSOL'), destFolder: 'KA1842 MADE KONSOL-' },
  { destSku: 'TVR1502', photoSku: 'TVR1502', srcRel: path.join('TVR - TV RAF', 'TVR1502 DÜNYA TV ÜNİTESİ TAKIMI'), destFolder: 'TVR1502 MEYRA TV ÜNİTESİ TAKIM-' },
  { destSku: 'DA1207', photoSku: 'DA1207', srcRel: path.join('DA - Dresuar', 'DA1207 RABBİT DRESUAR'), destFolder: 'DA1207 MOKA DRESUAR-' },
  { destSku: 'TVR1813', photoSku: 'TVR1813', srcRel: path.join('TVR - TV RAF', 'TVR1813 BAŞARI TV ÜNİTESİ TAKIMI'), destFolder: 'TVR1813 ELİPS TV ÜNİTESİ TAKIM-' },
  { destSku: 'TVR1501', photoSku: 'TVR1501', srcRel: path.join('TVR - TV RAF', 'TVR1501 KEREM TV ÜNİTESİ TAKIMI'), destFolder: 'TVR1501 TUNA TV ÜNİTESİ TAKIM-' },
  { destSku: 'DA1206', photoSku: 'DA1206', srcRel: path.join('DA - Dresuar', 'DA1206 KEREM DRESUAR'), destFolder: 'DA1206 TUNA DRESUAR-' },
  { destSku: 'KA1209', photoSku: 'KA1209', srcRel: path.join('KA - Konsol', 'KA1209 KANEL KONSOL'), destFolder: 'KA1209 LESSİ KONSOL-' },
  { destSku: 'KA1526', photoSku: 'KA1526', srcRel: path.join('KA - Konsol', 'KA1526 TEMTEM KONSOL'), destFolder: 'KA1526 PEGA KONSOL-' },
  { destSku: 'KA1803', photoSku: 'KA1803', srcRel: path.join('KA - Konsol', 'KA1803 RABBİT KONSOL'), destFolder: 'KA1803 MOKA KONSOL-' },
  { destSku: 'KA1810', photoSku: 'KA1810', srcRel: path.join('KA - Konsol', 'KA1810 ETHEMA KONSOL'), destFolder: 'KA1810 RANY KONSOL-' },
  {
    destSku: 'KA1540',
    photoSku: 'KA1540',
    srcRel: path.join('KA - Konsol', 'KA1540 EMİNA KONSOL'),
    destFolder: 'KA1540 KONSOL-',
    destRoot: ZETUNA_ROOT
  },
  {
    destSku: 'KA1541',
    photoSku: 'KA1541',
    srcRel: path.join('KA - Konsol', 'KA1541 MEDİSH KONSOL'),
    destFolder: 'KA1541 KONSOL-',
    destRoot: ZETUNA_ROOT
  },
  {
    destSku: 'KA1542',
    photoSku: 'KA1542',
    srcRel: path.join('KA - Konsol', 'KA1542 İLAY KONSOL'),
    destFolder: 'KA1542 KONSOL-',
    destRoot: ZETUNA_ROOT
  },
  {
    destSku: 'KA1543',
    photoSku: 'KA1543',
    srcRel: path.join('KA - Konsol', 'KA1543 UYGUN KONSOL'),
    destFolder: 'KA1543 LURA KONSOL-'
  },
  { destSku: 'TDA1204', photoSku: 'TDA1204', srcRel: path.join('TDA - TV DUVARA MONTE', 'TDA1204 TARÇIN DUVARA MONTAJ TV STAND'), destFolder: 'TDA1204 CORSA TV DUVARA MONTAJ-' },
  { destSku: 'TDA1205', photoSku: 'TDA1205', srcRel: path.join('TDA - TV DUVARA MONTE', 'TDA1205 LEYLA DUVARA MONTAJ TV STAND'), destFolder: 'TDA1205 YUKA TV DUVARA MONTAJ-' },
  {
    destSku: 'TDA1220',
    photoSku: 'TDA1220',
    srcRel: path.join('TDA - TV DUVARA MONTE', 'TDA1220 ETHEMA DUVARA MONTAJ TV STAND'),
    destFolder: 'TDA1220 RANY TV DUVARA MONTAJ',
    extraPrompt:
      'PLEXIGLASS LOCK (yapıştırma, not gömme): each door has a stadium/capsule mirror plexiglass applied as a thin OPAQUE sheet glued ON TOP of the door face, sitting slightly proud like a sticker overlay. The door plane continues under it. NEVER recessed, sunken, carved, inset, pocketed, channelled or inner-flush (içe göçük). No trough around the capsule. Not a window, not transparent glass, not an open cubby. Keep the plexi metal colour EXACTLY as in the reference: gold stays warm gold; silver/chrome stays cool silver. LASER LINE LOCK: each door has exactly TWO concentric stadium outlines around the plexi — CNC laser-engraved grooves that MUST render PURE BLACK (siyah #111) on every colourway including white and travertine, even in side-angle shots. Even if the reference shows a warm gold/beige tint on those lines from light bouncing off the plexi, output ink-black engraved lines. They are not plexiglass and must not become a gold/silver frame. Do not add extra rings. When doors are open they drop forward/down as flaps (aşağı açılan kapak), not swinging sideways. Keep the wall TV as a black switched-off screen — no on-screen UI. WALL-MOUNT HEIGHT: this is a wall-hung cabinet (duvara monte), not floor-standing. Keep a clearly visible gap of about 25–40 cm of wall between the cabinet underside and the floor or skirting — never rest it on the floor and never hang it only a few centimetres above the floor.'
  },
  { destSku: 'DA1220', photoSku: 'DA1220', srcRel: path.join('DA - Dresuar', 'DA1220 ETHEMA DRESUAR'), destFolder: 'DA1220 RANY DRESUAR' },
  {
    destSku: 'TSA1503',
    photoSku: 'TSA1503',
    srcRel: path.join('TSA - TV STAND', 'TSA1503 KEREM TV STAND'),
    destFolder: 'TSA1503 TUNA TV STAND-',
    sceneVariationStrength: 'high',
    extraPrompt:
      'FLOOR-STANDING TV bench (tv sehpası): four tapered metal legs rest on the floor. Never wall-hung, never floating, never mid-wall. Keep the two drop-down doors, the open centre cubby and the four legs identical. Each door has a colour-matched insert with short vertical laser-reeded slats and a gold/silver mirror plexiglass picture-frame around that insert, thicker at the inner-top corner toward the cubby — applied thin sheet sitting slightly proud, never recessed. Each door has TWO small round knobs placed close together horizontally at the centre — not a bar pull, not handleless. Do not place a sofa, armchair, pouf, ottoman or coffee table in front of the product. A wall TV above may stay a black switched-off screen. Fill the entire 2:3 frame edge to edge with a real living-room interior — no white letterbox bars, no empty canvas, no watermarks, no sparkles.'
  },
  {
    destSku: 'TSA1508',
    photoSku: 'TSA1508',
    srcRel: path.join('TSA - TV STAND', 'TSA1508 DÜNYA TV STAND'),
    destFolder: 'TSA1508 MEYRA TV STAND-',
    sceneVariationStrength: 'high',
    extraPrompt:
      'FLOOR-STANDING TV bench (tv sehpası): four tapered metal legs rest on the floor. Never wall-hung, never floating, never mid-wall. Handleless — no knobs, no pulls. Keep the two doors, the open centre cubby and the four legs identical. Each door has concentric arc/rainbow CNC grooves radiating from the inner-top corner; the grooves are laser-engraved in the door colour (black on white, darker mineral on travertine) — they are not plexiglass and not gold/silver. Each door has a thin gold/silver mirror plexiglass rectangle glued ON TOP of the inner-top of the door (yapıştırma, slightly proud sticker), never recessed. Do not place a sofa, armchair, pouf, ottoman or coffee table in front of the product. A wall TV above may stay a black switched-off screen. Fill the entire 2:3 frame edge to edge with a real living-room interior — no white letterbox bars, no empty canvas, no watermarks, no sparkles.'
  }
];

const SKU_RE = /^(KA|TVR|TSA|TDA|DAL|DA)(\d{4})([A-Z]+?)(\d+)$/i;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const LIFESTYLE_SEQ = new Set([1, 2, 3]);

const args = parseArgs(process.argv.slice(2));
const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const accessToken = process.env.APP_ACCESS_TOKEN?.trim();
const model = process.env.LIFESTYLE_MODEL ?? 'vertex/gemini-3.1-flash-image-preview';
const authMode = process.env.LIFESTYLE_AUTH_MODE ?? 'api_key';
const statePath = path.join(PROJECT_ROOT, '_lifestyle_refresh_state.json');
const logPath = path.join(PROJECT_ROOT, '_lifestyle_refresh.log');

const PROMPT =
  'Keep this manufactured furniture product identical. Refresh only the surrounding interior scene. Keep door and body sheen exactly as in the reference: matte stays matte with no specular window reflections; gloss stays gloss. If the product has gold or silver decorative plexiglass on the doors, it is applied (yapıştırma): a thin mirror sheet sitting slightly proud of the door face — never recessed, carved, inset, sunken or inner-flush (içe göçük). Laser/CNC outline lines stay the same colour as in the reference; if they are black, they stay pure black — never gold, silver or door-coloured, and they are not plexiglass.';

async function main() {
  const jobs = await buildJobs();
  log(`jobs: ${jobs.length} (skip=${jobs.filter((j) => j.skip).length}, todo=${jobs.filter((j) => !j.skip).length})`);
  if (args.dryRun) {
    for (const job of jobs) {
      log(`${job.skip ? 'SKIP' : 'TODO'} ${job.destName} <- ${job.srcName} -> ${job.destDir}`);
    }
    return;
  }

  const todo = jobs.filter((j) => !j.skip);
  const limited = typeof args.limit === 'number' ? todo.slice(0, args.limit) : todo;
  const state = (await readJson(statePath)) ?? { done: [], failed: [], startedAt: new Date().toISOString() };

  for (let i = 0; i < limited.length; i += 1) {
    const job = limited[i];
    if (!args.overwrite && state.done?.includes(job.id)) {
      log(`[${i + 1}/${limited.length}] already in state, skip ${job.id}`);
      continue;
    }
    log(`[${i + 1}/${limited.length}] generate ${job.id}`);
    try {
      const saved = await generateAndSave(job);
      state.done = [...new Set([...(state.done ?? []), job.id])];
      state.failed = (state.failed ?? []).filter((id) => id !== job.id);
      state.lastOk = { id: job.id, path: saved, at: new Date().toISOString() };
      await writeJson(statePath, state);
      log(`  saved ${saved}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.failed = [...new Set([...(state.failed ?? []), job.id])];
      state.lastError = { id: job.id, message, at: new Date().toISOString() };
      await writeJson(statePath, state);
      log(`  FAIL ${job.id}: ${message}`);
      if (/429|quota|exhausted|rate limit/i.test(message)) {
        log('rate/quota hit — waiting 70s');
        await sleep(70_000);
      } else {
        await sleep(3000);
      }
    }
  }

  log('done');
}

async function buildJobs() {
  const wanted = args.codes ? new Set(args.codes) : null;
  const destIndex = await indexDestFolders();
  const jobs = [];

  for (const product of PRODUCT_JOBS) {
    if (wanted && !wanted.has(product.destSku) && !wanted.has(product.photoSku)) continue;
    const srcDir = path.join(YUMEDI_ROOT, product.srcRel);
    const destProductDir = resolveProductDestDir(product, destIndex);
    if (!destProductDir) {
      log(`NO DEST FOLDER for ${product.destSku}`);
      continue;
    }

    let names;
    try {
      names = await readdir(srcDir);
    } catch {
      log(`NO SRC FOLDER ${srcDir}`);
      continue;
    }

    for (const name of names) {
      const parsed = parseSkuFile(name);
      if (!parsed) continue;
      if (parsed.sku !== product.photoSku) continue;
      if (!LIFESTYLE_SEQ.has(parsed.seq)) continue;

      const destNameStem = `${product.destSku}${parsed.suffix}${parsed.seq}`;
      if (args.stems && !args.stems.has(destNameStem)) continue;
      const destDir = args.outSubdir
        ? path.join(destProductDir, args.outSubdir, metalFolder(parsed.suffix) ?? '')
        : await resolveVariantDir(destProductDir, parsed.suffix);
      const existing = await findExisting(destDir, destNameStem);
      const skip = Boolean(existing) && !args.overwrite;
      jobs.push({
        id: args.outSubdir ? `${args.outSubdir}-${destNameStem}` : destNameStem,
        destSku: product.destSku,
        srcName: name,
        srcPath: path.join(srcDir, name),
        destDir,
        destName: destNameStem,
        suffix: parsed.suffix,
        seq: parsed.seq,
        extraPrompt: product.extraPrompt ?? '',
        sceneVariationStrength: product.sceneVariationStrength,
        skip,
        existing
      });
    }
  }

  jobs.sort((a, b) => a.id.localeCompare(b.id));
  return jobs;
}

function resolveProductDestDir(product, destIndex) {
  if (product.destRoot && product.destFolder) {
    const familyKey = product.destSku.match(/^(KA|TVR|TSA|TDA|DAL|DA)/i)?.[0]?.toUpperCase();
    const family = FAMILY_DIR[familyKey] ?? FAMILY_DIR.KA;
    return path.join(product.destRoot, family, product.destFolder);
  }
  return destIndex.get(product.destSku) ?? null;
}

async function indexDestFolders() {
  const map = new Map();
  for (const family of Object.values(FAMILY_DIR)) {
    const familyDir = path.join(CENEYRA_ROOT, family);
    let entries = [];
    try {
      entries = await readdir(familyDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const bySku = new Map();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sku = entry.name.match(/^(KA|TVR|TSA|TDA|DAL|DA)\d{4}/i)?.[0]?.toUpperCase();
      if (!sku) continue;
      const list = bySku.get(sku) ?? [];
      list.push(path.join(familyDir, entry.name));
      bySku.set(sku, list);
    }
    for (const [sku, dirs] of bySku) {
      const preferredName = PRODUCT_JOBS.find((product) => product.destSku === sku)?.destFolder;
      const preferred = preferredName ? dirs.find((dir) => path.basename(dir) === preferredName) : null;
      const dashed = dirs.filter((dir) => dir.replace(/[\\/]+$/, '').trimEnd().endsWith('-'));
      map.set(sku, preferred ?? dashed[0] ?? dirs.sort((a, b) => b.length - a.length)[0]);
    }
  }
  return map;
}

async function resolveVariantDir(productDir, suffix) {
  const metal = metalFolder(suffix);
  if (!metal) return productDir;
  const entries = await readdir(productDir, { withFileTypes: true });
  const gold = entries.find((e) => e.isDirectory() && /^gold$/i.test(e.name));
  const silver = entries.find((e) => e.isDirectory() && /^s[iıİ]lver$/i.test(e.name));
  if (metal === 'GOLD' && gold) return path.join(productDir, gold.name);
  if (metal === 'SILVER' && silver) return path.join(productDir, silver.name);
  return productDir;
}

function metalFolder(suffix) {
  const last = suffix.slice(-1).toUpperCase();
  if (last === 'G') return 'GOLD';
  if (last === 'S') return 'SILVER';
  return null;
}

function parseSkuFile(fileName) {
  const ext = path.extname(fileName);
  if (!IMAGE_EXT.has(ext.toLowerCase())) return null;
  const base = path.basename(fileName, ext);
  const match = base.match(SKU_RE);
  if (!match) return null;
  return {
    sku: `${match[1].toUpperCase()}${match[2]}`,
    suffix: match[3].toUpperCase(),
    seq: Number.parseInt(match[4], 10)
  };
}

async function findExisting(dir, stem) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const hit = names.find((name) => {
    const ext = path.extname(name).toLowerCase();
    return IMAGE_EXT.has(ext) && path.basename(name, path.extname(name)).toUpperCase() === stem.toUpperCase();
  });
  return hit ? path.join(dir, hit) : null;
}

async function generateAndSave(job) {
  const bytes = await readFile(job.srcPath);
  const mimeType = mimeOf(job.srcPath);
  const aspectRatio = inferAspectRatio(bytes) ?? '2:3';
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const metalLock =
    job.suffix?.slice(-1).toUpperCase() === 'S'
      ? ' This reference is SILVER plexiglass: cool chrome/nickel mirror only — never gold, brass, champagne or bronze.'
      : job.suffix?.slice(-1).toUpperCase() === 'G'
        ? ' This reference is GOLD plexiglass: warm gold mirror only — never silver or chrome.'
        : '';
  const suffix = (job.suffix ?? '').toUpperCase();
  const isWallMount = String(job.destSku || '').toUpperCase().startsWith('TDA');
  const whiteDoorLock =
    isWallMount && /^(BG|BS|DBG|DBS)$/.test(suffix)
      ? ' WHITE DOOR LOCK: doors are white laminate. The concentric laser ovals around the plexi stay jet-black on the white doors — never gold, never beige, never a metallic frame. Gold/silver exists only as the applied plexi capsule, not as the engraved lines.'
      : '';
  const hangHighLock =
    isWallMount && /^(DBG|DBS)$/.test(suffix)
      ? ' HANG HIGH (override the reference if it is low). Place the cabinet mid-wall: a thick EMPTY painted wall band under it at least as tall as the cabinet body, then a thin skirting, then deep floor. NO bench, plinth, second shelf or console under it — only empty wall. Cabinet in the middle third of the frame, not the bottom third. PLEXI DEPTH: gold stadium is a FLAT glued overlay on the white door (slightly proud sticker), not a sunken pocket. Two black laser ovals on the white laminate around it — never gold frames.'
      : '';
  const sceneStrength =
    job.sceneVariationStrength ??
    (isWallMount && /^(DBG|DBS)$/.test(suffix) ? 'high' : 'medium');
  const body = {
    prompt: `${PROMPT}${job.extraPrompt ? ` ${job.extraPrompt}` : ''}${metalLock}${whiteDoorLock}${hangHighLock}`,
    count: 1,
    model,
    authMode,
    renderMode: 'single',
    sceneVariation: true,
    sceneVariationStrength: sceneStrength,
    aspectRatio,
    imageSize: '2K',
    referenceImages: [{ base64: bytes.toString('base64'), mimeType }]
  };

  const submitResponse = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(360_000)
  });
  const payload = await submitResponse.json().catch(() => ({}));
  if (!submitResponse.ok) {
    throw new Error(`HTTP ${submitResponse.status}: ${payload.error ?? JSON.stringify(payload).slice(0, 400)}`);
  }

  let batch = payload.results;
  if (!batch && payload.jobId) {
    batch = await pollJob(payload.jobId, headers);
  }
  if (!batch?.results?.length) {
    const fail = batch?.failures?.[0]?.error ?? payload.error ?? 'no results';
    throw new Error(String(fail));
  }

  const item = batch.results[0];
  const outExt = (item.mimeType || '').includes('jpeg') || (item.mimeType || '').includes('jpg') ? 'jpg' : 'png';
  await mkdir(job.destDir, { recursive: true });
  const outPath = path.join(job.destDir, `${job.destName}.${outExt}`);

  if (item.blobUrl) {
    const imgRes = await fetch(item.blobUrl, { signal: AbortSignal.timeout(120_000) });
    if (!imgRes.ok) throw new Error(`blob ${imgRes.status}`);
    await writeFile(outPath, Buffer.from(await imgRes.arrayBuffer()));
    return outPath;
  }
  if (!item.imageBase64) throw new Error('empty image payload');
  await writeFile(outPath, Buffer.from(item.imageBase64, 'base64'));
  return outPath;
}

async function pollJob(jobId, headers) {
  for (let i = 0; i < 120; i += 1) {
    await sleep(5000);
    const res = await fetch(`${baseUrl}/api/generate?job=${encodeURIComponent(jobId)}`, { headers });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`poll HTTP ${res.status}: ${payload.error ?? ''}`);
    if (payload.state === 'succeeded' && payload.results) return payload.results;
    if (['failed', 'cancelled', 'expired'].includes(payload.state)) {
      throw new Error(payload.error || payload.state);
    }
    log(`  poll ${payload.stateLabel ?? payload.state}`);
  }
  throw new Error('poll timeout');
}

function mimeOf(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function inferAspectRatio(buf) {
  const dim = jpegSize(buf) || pngSize(buf);
  if (!dim) return null;
  const { w, h } = dim;
  if (!w || !h) return null;
  const r = w / h;
  const candidates = [
    ['1:1', 1],
    ['2:3', 2 / 3],
    ['3:2', 3 / 2],
    ['3:4', 3 / 4],
    ['4:3', 4 / 3],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
    ['9:16', 9 / 16],
    ['16:9', 16 / 9]
  ];
  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    const d = Math.abs(r - c[1]);
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }
  return best[0];
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const size = (buf[i + 2] << 8) + buf[i + 3];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { h: (buf[i + 5] << 8) + buf[i + 6], w: (buf[i + 7] << 8) + buf[i + 8] };
    }
    i += 2 + size;
  }
  return null;
}

function pngSize(buf) {
  if (buf.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (buf[i] !== sig[i]) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function parseArgs(argv) {
  const out = { overwrite: false, dryRun: false, codes: null, stems: null, limit: null, outSubdir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--overwrite') out.overwrite = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--codes') out.codes = (argv[++i] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--stems') out.stems = new Set((argv[++i] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
    else if (a === '--limit') out.limit = Number.parseInt(argv[++i], 10);
    else if (a === '--out-subdir') out.outSubdir = (argv[++i] || '').trim();
  }
  return out;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  await writeFile(logPath, `${line}\n`, { flag: 'a' }).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
