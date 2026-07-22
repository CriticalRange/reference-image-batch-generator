# Batch Image Generator

Author: Ceneyra Software

A Next.js starter app for generating image variants in parallel from one reference image + one base prompt.

## Storage

- Generated history is persisted locally using `idb-keyval` (IndexedDB-backed).
- This keeps history available after refresh and avoids `localStorage` size/sync limits for image-heavy data.

## Why Next.js for this use case

Next.js is a good fit when you want to host later because it gives you:

- Fast local UI development for prompt and image workflows.
- Server routes to securely call provider APIs with your secret key.
- Easy deployment path to Vercel, Docker, or your own VPS.

A standalone desktop app is better only if you need tight OS integration, offline-only packaging, or local GPU workflows.

## Important constraint

This project only supports compliant generation flows. It does not implement watermark/provenance removal or bypassing provider safeguards.

## HTTP API (UI parity)

The UI is a thin client over these routes. External scripts and websites can call the same endpoints and perform the same generation work (prompt, references, model, auth mode, resize, upscale, polling).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/generate` | Submit a generation job (same body as the UI) |
| `GET` | `/api/generate?job=<id>` | Poll async Gemini batch jobs until results are ready |
| `GET` | `/api/models` | List available models + default model |
| `OPTIONS` | above routes | CORS preflight when `API_CORS_ORIGINS` is set |

History, archive, zip download, and batch-mode looping are **client-side only** (IndexedDB / browser). Re-implement those in your script if needed by calling `POST /api/generate` once per reference.

### Auth & CORS

- **Local UI / trusted scripts:** leave `APP_ACCESS_TOKEN` unset.
- **External callers:** set `APP_ACCESS_TOKEN` and send `Authorization: Bearer <token>` on every request.
- **Browser sites on another origin:** set `API_CORS_ORIGINS` (e.g. `https://app.example.com` or `*`). Prefer a token when using `*`.
- Rate limit: `API_RATE_LIMIT` / `API_RATE_WINDOW_MS` (per client IP).

### `POST /api/generate` body

```json
{
  "prompt": "Studio product photo, soft light…",
  "negativePrompt": "blurry, watermark",
  "count": 5,
  "model": "vertex/gemini-2.5-flash-image",
  "authMode": "service_account",
  "aspectRatio": "2:3",
  "imageSize": "1K",
  "steps": 28,
  "resizeWidth": 2000,
  "resizeHeight": 3000,
  "aiUpscale": 2,
  "referenceImages": [
    { "base64": "<base64-without-data-url-prefix>", "mimeType": "image/jpeg" }
  ]
}
```

| Field | Notes |
| ----- | ----- |
| `prompt` | Required |
| `count` | Variant count (clamped by `MAX_BATCH_SIZE`) |
| `model` | e.g. `vertex/gemini-2.5-flash-image`, Together, fal codes |
| `authMode` | Vertex only: `service_account` (default) or `api_key` (`GEMINI_API_KEY`) |
| `referenceImages` | Preferred multi-ref array; or legacy `referenceImageBase64` + `referenceMimeType` |
| `aspectRatio` / `imageSize` / `steps` | Provider-dependent |
| `resizeWidth` + `resizeHeight` | Both required if resizing |
| `aiUpscale` | `2` or `3` (not supported on Vercel serverless) |

### Response shapes

**Sync providers** (Vertex, Together, fal) return results immediately:

```json
{
  "jobId": "…",
  "provider": "vertex",
  "results": {
    "usedModel": "vertex/gemini-2.5-flash-image",
    "requestedCount": 5,
    "succeededCount": 5,
    "failedCount": 0,
    "results": [
      {
        "promptVariant": "…",
        "mimeType": "image/png",
        "imageBase64": "…",
        "blobUrl": "https://….blob.vercel-storage.com/…"
      }
    ],
    "failures": []
  }
}
```

Prefer `blobUrl` when present (Vercel Blob). Otherwise decode `imageBase64`.

**Async Gemini batch** returns `{ jobId, provider: "gemini" }` without `results`. Poll:

```http
GET /api/generate?job=<jobId>
```

until `state` is `succeeded` and `results` is populated (or `failed` / `cancelled` / `expired`).

### Example (Node)

```bash
# Server running on :3000
node scripts/generate-example.mjs ./reference.jpg "Clean studio product shot"
```

Optional env: `API_BASE_URL`, `APP_ACCESS_TOKEN`.

### Example (curl)

```bash
# Encode a local JPEG (PowerShell)
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("reference.jpg"))

curl -s -X POST http://localhost:3000/api/generate `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $env:APP_ACCESS_TOKEN" `
  -d "{
    \"prompt\": \"Studio product photo\",
    \"count\": 2,
    \"model\": \"vertex/gemini-2.5-flash-image\",
    \"authMode\": \"service_account\",
    \"aspectRatio\": \"2:3\",
    \"referenceImages\": [{ \"base64\": \"$b64\", \"mimeType\": \"image/jpeg\" }]
  }"
```

## Security notes

- Keep `.env.local` and provider credential JSON files out of git. If a service account key is ever exposed, revoke it and create a new key.
- `POST /api/generate` enforces request size, reference image MIME/base64 validation, and a basic IP rate limit.
- For server-to-server / external API usage, set `APP_ACCESS_TOKEN` and send `Authorization: Bearer <token>`.
- For browser clients on other origins, set `API_CORS_ORIGINS` and prefer a strong access token.
- Before public hosting, put the app behind real user auth and provider-budget controls.

## Vercel Vertex AI credentials

Do not commit the service account JSON file. For Vercel, base64-encode the JSON locally and add it as `VERTEX_AI_CREDENTIALS_BASE64` in the Vercel project environment variables:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("free-494923-3c3b6ca698b4.json"))
```

Also set `VERTEX_AI_REGION` and `GEMINI_IMAGE_MODEL` in Vercel. `VERTEX_AI_CREDENTIALS_PATH` is only for local/server environments where the JSON file exists on disk.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy environment file:

```bash
cp .env.example .env.local
```

3. Set `GEMINI_API_KEY` in `.env.local`.
4. If you will use Together models, set `TOGETHER_API_KEY`.
5. If you will use fal.ai models, set `FAL_AI_API_KEY`.

6. Run in dev mode:

```bash
npm run dev
```

5. Open `http://localhost:3000`.

## Notes

- Default batch size is `5`.
- Maximum batch size is controlled with `MAX_BATCH_SIZE` (default `8`).
- Parallel request count is controlled with `MAX_PARALLEL_REQUESTS` (default `2`).
- API request throttling is controlled with `API_RATE_LIMIT` and `API_RATE_WINDOW_MS`.
- Model can be overridden with `GEMINI_IMAGE_MODEL` (default `vertex/gemini-2.5-flash-image`).
- History key used by IndexedDB cache: `reference-batch-history-v1`.

## Troubleshooting

If `POST /api/generate` returns `500`, check:

1. `GEMINI_API_KEY` is valid in `.env.local`.
2. `GEMINI_IMAGE_MODEL` is available for your account/region.
3. Reduce pressure by lowering `MAX_PARALLEL_REQUESTS` to `1`.
4. Check the UI "Failed Variants" section. It now shows per-variant API errors instead of a generic failure.
5. If using a Together model, verify `TOGETHER_API_KEY`.
6. If using a fal.ai model, verify `FAL_AI_API_KEY`.
