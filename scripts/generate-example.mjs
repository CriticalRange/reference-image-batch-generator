/**
 * Example external client for POST /api/generate.
 *
 * Usage:
 *   node scripts/generate-example.mjs path/to/reference.jpg "Your prompt here"
 *
 * Env:
 *   API_BASE_URL   default http://localhost:3000
 *   APP_ACCESS_TOKEN  optional Bearer token when the server requires it
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const accessToken = process.env.APP_ACCESS_TOKEN?.trim();
const [imagePath, ...promptParts] = process.argv.slice(2);
const prompt = promptParts.join(' ').trim() || 'Product photo on a clean white background, studio lighting.';

if (!imagePath) {
  console.error('Usage: node scripts/generate-example.mjs <reference-image> [prompt...]');
  process.exit(1);
}

const mimeByExt = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
};

const ext = path.extname(imagePath).toLowerCase();
const mimeType = mimeByExt[ext];
if (!mimeType) {
  console.error(`Unsupported image extension: ${ext || '(none)'}`);
  process.exit(1);
}

const imageBase64 = (await readFile(imagePath)).toString('base64');
const headers = { 'Content-Type': 'application/json' };
if (accessToken) {
  headers.Authorization = `Bearer ${accessToken}`;
}

const submitResponse = await fetch(`${baseUrl}/api/generate`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    prompt,
    count: 2,
    model: 'vertex/gemini-2.5-flash-image',
    authMode: 'service_account', // or "api_key"
    aspectRatio: '2:3',
    resizeWidth: 2000,
    resizeHeight: 3000,
    referenceImages: [{ base64: imageBase64, mimeType }]
  })
});

const submitPayload = await submitResponse.json();
if (!submitResponse.ok) {
  console.error('Generate failed:', submitPayload);
  process.exit(1);
}

// Sync providers (vertex/together/fal) return results immediately.
if (submitPayload.results) {
  printResults(submitPayload.results);
  process.exit(0);
}

// Async Gemini batch: poll until terminal state.
const jobId = submitPayload.jobId;
if (!jobId) {
  console.error('No jobId or results in response:', submitPayload);
  process.exit(1);
}

console.error(`Job submitted: ${jobId}. Polling...`);
for (;;) {
  await sleep(5000);
  const statusResponse = await fetch(`${baseUrl}/api/generate?job=${encodeURIComponent(jobId)}`, { headers });
  const statusPayload = await statusResponse.json();
  if (!statusResponse.ok) {
    console.error('Status failed:', statusPayload);
    process.exit(1);
  }

  console.error(`State: ${statusPayload.state} — ${statusPayload.stateLabel ?? ''}`);
  if (statusPayload.state === 'succeeded' && statusPayload.results) {
    printResults(statusPayload.results);
    process.exit(0);
  }
  if (['failed', 'cancelled', 'expired'].includes(statusPayload.state)) {
    console.error('Job ended without success:', statusPayload);
    process.exit(1);
  }
}

function printResults(batch) {
  console.log(
    JSON.stringify(
      {
        usedModel: batch.usedModel,
        requestedCount: batch.requestedCount,
        succeededCount: batch.succeededCount,
        failedCount: batch.failedCount,
        failures: batch.failures,
        images: (batch.results ?? []).map((item, index) => ({
          index: index + 1,
          promptVariant: item.promptVariant,
          mimeType: item.mimeType,
          blobUrl: item.blobUrl ?? null,
          hasBase64: Boolean(item.imageBase64)
        }))
      },
      null,
      2
    )
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
