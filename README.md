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

The UI is a thin client over these routes. External scripts and websites can call the same endpoints for generation (prompt, references, model, auth mode, resize, upscale, polling).

**Interactive docs:** [`/api-docs`](/api-docs) (Swagger UI)  
**Machine-readable spec:** [`docs/openapi.yaml`](docs/openapi.yaml) · served at `/api/openapi` (OpenAPI 3.1).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/generate` | Submit a generation job |
| `GET` | `/api/generate?job=<id>` | Poll async Gemini Developer batch jobs |
| `GET` | `/api/models` | List curated (+ discovered) models and default |
| `OPTIONS` | above routes | CORS preflight when `API_CORS_ORIGINS` is set |

History, archive, zip download, and multi-product queueing are **client-side only** (IndexedDB / browser). Scripts that process many product photos should call `POST /api/generate` once per reference (and apply their own rate limit between calls).

### Auth, CORS, rate limits

| Concern | Behaviour |
| ------- | --------- |
| Access token | If `APP_ACCESS_TOKEN` is set, every request needs `Authorization: Bearer <token>` (`401` otherwise). Leave unset for local UI-only dev. |
| CORS | Set `API_CORS_ORIGINS` to a comma-separated list or `*`. Same-origin UI needs no CORS. Prefer a strong token when using `*`. |
| Rate limit | `API_RATE_LIMIT` / `API_RATE_WINDOW_MS` per client IP (default 20 / 60s). Exceeded → `429` + `Retry-After`. |
| Body size | `MAX_REQUEST_BYTES` (default 16 MiB). Exceeded → `413`. |

### Provider routing (how jobs run)

| Model / auth | Behaviour |
| ------------ | --------- |
| `vertex/*` + `authMode: service_account` | Sync Vertex AI (service account). Response includes `results`. |
| `vertex/*` + `authMode: vertex_express` | Sync Vertex Express REST via `GEMINI_API_KEY`. Response includes `results`. |
| `vertex/*` + `authMode: api_key` | **Async** Gemini Developer Batch API. Poll `GET /api/generate?job=…`. |
| Non-`vertex/` Gemini / Imagen catalog ids | Async Gemini Developer Batch API (same poll path). |
| Together model codes | Sync Together. Needs `TOGETHER_API_KEY`. |
| `fal-ai/*` catalog ids | UI label only; generation runs on **Vertex service account** (fal.ai disabled). Sync `results`. |

Default model: `GEMINI_IMAGE_MODEL` / `NEXT_PUBLIC_GEMINI_IMAGE_MODEL` or `vertex/gemini-2.5-flash-image`.

### `POST /api/generate`

Submit one generation job (one logical product; optional multi-image `referenceImages` for multi-ref models).

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

| Field | Required | Notes |
| ----- | -------- | ----- |
| `prompt` | yes | Max 10 000 characters |
| `negativePrompt` | no | Max 2 000 characters; Together / some backends |
| `count` | no | Default `5`; clamped by `MAX_BATCH_SIZE` (default `8`) |
| `model` | no | e.g. `vertex/gemini-2.5-flash-image`, Together, or `fal-ai/…` facade |
| `authMode` | no | `service_account` (default), `api_key`, `vertex_express`. Sent for all models; only Vertex/Gemini paths use it |
| `referenceImages` | no* | Array of `{ base64, mimeType }`. MIME: jpeg/png/webp/heic/heif. Size: `MAX_REFERENCE_IMAGE_BYTES` / `MAX_TOTAL_REFERENCE_IMAGE_BYTES` |
| `referenceImageBase64` + `referenceMimeType` | no* | Legacy single-image fields |
| `aspectRatio` | no | e.g. `1:1`, `2:3`, `3:2`, `9:16`, `16:9`, `21:9`, … |
| `imageSize` | no | Gemini-style `512` / `1K` / `2K` / `4K`, or Together pixel sizes like `1024x1024` |
| `steps` | no | Together (and similar); clamped 1–50 |
| `resizeWidth` + `resizeHeight` | no | Both required together |
| `aiUpscale` | no | `2` or `3`. **Not supported on Vercel serverless** (`400`) |

\*References are optional at the HTTP layer, but most product workflows need at least one image.

#### Success responses

**Sync** (`provider`: `vertex` | `together` | `fal`, and Vertex Express / SA paths):

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

Prefer `blobUrl` when present (Vercel Blob offload). Otherwise decode `imageBase64`. Empty `imageBase64` with a `blobUrl` is normal after upload.

**Async** (Gemini Developer Batch — typically `authMode: api_key` or non-Vertex Gemini models):

```json
{
  "jobId": "batches/…",
  "provider": "gemini"
}
```

No `results` yet — poll the status endpoint.

### `GET /api/generate?job=<jobId>`

Poll an async batch job. Requires the same access token / rate-limit rules as `POST`.

| `state` | Meaning |
| ------- | ------- |
| `pending` | Queued |
| `running` | In progress |
| `succeeded` | Done; `results` present when outputs are ready |
| `failed` / `cancelled` / `expired` | Terminal error (`error` message) |

**Progress** (when the Batch API reports stats):

```json
{
  "jobId": "batches/…",
  "state": "running",
  "stateLabel": "Running",
  "stateDetail": "Running for 45s · 2/5 requests done",
  "progress": {
    "requestCount": 5,
    "successfulCount": 2,
    "failedCount": 0,
    "pendingCount": 3
  }
}
```

Use `successfulCount + failedCount` vs `requestCount` for UI progress. Images still arrive in bulk when `state` is `succeeded` and `results` is populated.

Poll interval suggestion: **5 seconds**.

### `GET /api/models`

```json
{
  "models": [
    { "code": "vertex/gemini-2.5-flash-image", "name": "Gemini 2.5 Flash Image (Vertex)", "group": "Vertex AI" }
  ],
  "defaultModel": "vertex/gemini-2.5-flash-image",
  "source": "catalog"
}
```

`source` is `api` when Gemini list discovery succeeds, otherwise `catalog` (curated fallback). No access token required today (still subject to CORS if configured).

### Error shape

Most errors:

```json
{ "error": "Human-readable message" }
```

| Status | Typical cause |
| ------ | ------------- |
| `400` | Validation (prompt, refs, resize pair, AI upscale on Vercel, …) |
| `401` | Missing/invalid `APP_ACCESS_TOKEN` |
| `413` | Body too large |
| `429` | Rate limit (`Retry-After` header) |
| `500` | Provider/server failure (details in server logs) |

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

Async poll:

```bash
curl -s "http://localhost:3000/api/generate?job=$jobId" `
  -H "Authorization: Bearer $env:APP_ACCESS_TOKEN"
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
