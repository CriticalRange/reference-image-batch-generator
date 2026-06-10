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

## Security notes

- Keep `.env.local` and provider credential JSON files out of git. If a service account key is ever exposed, revoke it and create a new key.
- `POST /api/generate` enforces request size, reference image MIME/base64 validation, and a basic IP rate limit.
- For server-to-server usage, set `APP_ACCESS_TOKEN` and send `Authorization: Bearer <token>`.
- Before public hosting, put the app behind real user auth and provider-budget controls.

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
