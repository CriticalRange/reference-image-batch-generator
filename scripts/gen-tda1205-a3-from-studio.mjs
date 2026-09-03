import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC =
  "G:\\Ortak Drive'lar\\Ceneyra\\ÜRÜNLER\\ASIR GROUP\\260828\\TDA1205 YUKA TV DUVARA MONTAJ\\TDA1205A6.jpg";
const DEST_DIR =
  "G:\\Ortak Drive'lar\\Ceneyra\\ÜRÜNLER\\ASIR GROUP\\260828\\TDA1205 YUKA TV DUVARA MONTAJ";
const BASE = 'http://localhost:3000';

const prompt =
  'The attached image is a studio cutout of a wall-mounted TV cabinet on white. Ignore where it sits on the white canvas. Keep the manufactured product identical: anthracite/dark-grey body, top, sides AND doors; two doors with a 3x3 grid of laser-engraved rectangles inside a double rectangular frame; each door has one square black knob in the centre. Laser grid lines are slightly darker engraved grooves on the anthracite doors — not gold, not silver, not plexiglass, not raised. No decorative plexiglass. Doors CLOSED. Place it in a photoreal living room as duvara monte. HANG HIGH: mid-wall with a thick empty wall band under the cabinet at least as tall as the cabinet body, then skirting, then a deep floor. No bench or plinth. TV on the wall above is fully in frame and black/off. Camera: three-quarter view from the left, product clearly readable. 2:3 portrait catalogue photo.';

const bytes = await readFile(SRC);
const res = await fetch(`${BASE}/api/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt,
    count: 1,
    model: 'vertex/gemini-3.1-flash-image-preview',
    authMode: 'api_key',
    renderMode: 'single',
    sceneVariation: true,
    sceneVariationStrength: 'high',
    aspectRatio: '2:3',
    imageSize: '2K',
    referenceImages: [{ base64: bytes.toString('base64'), mimeType: 'image/jpeg' }]
  }),
  signal: AbortSignal.timeout(360_000)
});
const payload = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(`HTTP ${res.status}: ${payload.error ?? JSON.stringify(payload).slice(0, 400)}`);
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
    if (['failed', 'cancelled', 'expired'].includes(p.state)) throw new Error(p.error || p.state);
  }
}
const item = batch?.results?.[0];
if (!item) throw new Error('no results');
await mkdir(DEST_DIR, { recursive: true });
const outPath = path.join(DEST_DIR, 'TDA1205A3.jpg');
if (item.blobUrl) {
  const img = await fetch(item.blobUrl);
  if (!img.ok) throw new Error(`blob ${img.status}`);
  await writeFile(outPath, Buffer.from(await img.arrayBuffer()));
} else if (item.imageBase64) {
  await writeFile(outPath, Buffer.from(item.imageBase64, 'base64'));
} else {
  throw new Error('empty image');
}
console.log(`saved ${outPath}`);
