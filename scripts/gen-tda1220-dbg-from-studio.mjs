import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC =
  "G:\\Ortak Drive'lar\\Ceneyra\\ÜRÜNLER\\Ceneyra\\TDA - TV DUVARA MONTE\\TDA1220 RANY TV DUVARA MONTAJ\\GOLD\\TDA1220DBG5.jpg";
const DEST_DIR =
  "G:\\Ortak Drive'lar\\Ceneyra\\ÜRÜNLER\\Ceneyra\\TDA - TV DUVARA MONTE\\TDA1220 RANY TV DUVARA MONTAJ\\secim\\GOLD";
const BASE = 'http://localhost:3000';

const LOCK =
  'The attached image is a studio cutout of a wall-mounted TV cabinet on a white background. Ignore where it sits on the white canvas — that is not a room. Keep the manufactured product identical: oak/wood body and top, white laminate doors, gold-mirror plexiglass stadiums glued ON TOP of the doors (yapıştırma, slightly proud sticker — never recessed, sunken, inset or inner-flush), two concentric PURE BLACK laser ovals on the white doors around each plexi (not gold, not a metal frame). Place it in a photoreal living room as a duvara monte unit. HANG HIGH: mid-wall, a thick empty wall band under the cabinet at least as tall as the cabinet body, then skirting, then a deep floor. No bench or plinth under it. TV on the wall above is black/off. 2:3 portrait catalogue photo.';

const SHOTS = [
  {
    name: 'TDA1220DBG1',
    extra: 'Camera: straight-on front elevation, centred on the product.'
  },
  {
    name: 'TDA1220DBG2',
    extra: 'Camera: three-quarter view from the left, product still clearly readable.'
  },
  {
    name: 'TDA1220DBG3',
    extra:
      'Same product with both doors dropped open downward as flaps (aşağı açılan kapak), showing the interior cubbies. Keep plexi and black laser on the outer door faces.'
  }
];

const bytes = await readFile(SRC);
const base64 = bytes.toString('base64');
await mkdir(DEST_DIR, { recursive: true });

for (const shot of SHOTS) {
  console.log(`generate ${shot.name}`);
  const body = {
    prompt: `${LOCK} ${shot.extra}`,
    count: 1,
    model: 'vertex/gemini-3.1-flash-image-preview',
    authMode: 'api_key',
    renderMode: 'single',
    sceneVariation: true,
    sceneVariationStrength: 'high',
    aspectRatio: '2:3',
    imageSize: '2K',
    referenceImages: [{ base64, mimeType: 'image/jpeg' }]
  };
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(360_000)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${shot.name} HTTP ${res.status}: ${payload.error ?? JSON.stringify(payload).slice(0, 400)}`);
  let batch = payload.results;
  if (!batch && payload.jobId) {
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 5000));
      const poll = await fetch(`${BASE}/api/generate?job=${encodeURIComponent(payload.jobId)}`);
      const p = await poll.json().catch(() => ({}));
      if (p.state === 'succeeded' && p.results) {
        batch = p.results;
        break;
      }
      if (['failed', 'cancelled', 'expired'].includes(p.state)) throw new Error(`${shot.name} ${p.error || p.state}`);
    }
  }
  const item = batch?.results?.[0];
  if (!item) throw new Error(`${shot.name} no results`);
  const outPath = path.join(DEST_DIR, `${shot.name}.jpg`);
  if (item.blobUrl) {
    const img = await fetch(item.blobUrl);
    if (!img.ok) throw new Error(`blob ${img.status}`);
    await writeFile(outPath, Buffer.from(await img.arrayBuffer()));
  } else if (item.imageBase64) {
    await writeFile(outPath, Buffer.from(item.imageBase64, 'base64'));
  } else {
    throw new Error(`${shot.name} empty image`);
  }
  console.log(`saved ${outPath}`);
}
