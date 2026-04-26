# AGENTS.md

## Project
- Name: `reference-image-batch-generator`
- Author: `Ceneyra Software`
- Stack: `Next.js` + `TypeScript`

## User Aim
Build a web app that:
- accepts one reference image and one base prompt,
- generates at least 5 image outputs in parallel,
- keeps outputs visually similar in identity/composition while varying style wording,
- can later be hosted online.

## Current Status
- Initial Next.js scaffold exists.
- UI exists for reference upload, prompt input, and variant count.
- API route exists for parallel generation through Gemini API.
- Prompt-variant utility exists.
- History tab exists and is persisted locally via `idb-keyval` (IndexedDB).

## Scope Boundaries
- Keep workflows local for app logic and processing where possible.
- Do not implement or automate watermark/provenance removal or bypass provider safeguards.
- Keep provider terms and legal compliance in scope for all new features.

## Product Direction
- Primary target: hosted web app (Vercel/VPS/Docker).
- Secondary target: strong local dev workflow before deployment.
- UX goal: one-click batch generation from one prompt + one reference.

## Immediate TODO
1. Install dependencies and run locally (`npm install`, `npm run dev`).
2. Validate Gemini model/API compatibility with current SDK usage.
3. Add robust error states (rate limits, per-variant failures, bad image input).
4. Add download options:
   - single image download,
   - batch zip download,
   - metadata JSON export (prompt variant + timestamp + model).
5. Add history management controls:
   - clear history,
   - optional export/import,
   - retention strategy beyond fixed item cap.
6. Add queue/worker control to avoid provider throttling when count is high.
7. Add retry strategy per failed variant instead of failing whole job.
8. Add basic auth/rate-limit plan before public hosting.
9. Add tests:
   - prompt variant builder unit tests,
   - API route validation tests,
   - minimal UI flow test.

## Suggested Architecture Notes
- Keep provider key server-side only (`.env.local`).
- Keep generation orchestration in `lib/gemini.ts`.
- Keep UI presentation in `app/page.tsx` and move to components as complexity grows.
- Keep generated history persistence on `idb-keyval` (IndexedDB), not raw `localStorage`, due image payload size.
- Add `app/api/download/*` routes if server-side zipping is introduced.

## Deployment Plan
1. Stabilize local dev and error handling.
2. Add logging/monitoring hooks.
3. Deploy preview environment.
4. Add production env vars and request safeguards.
5. Run load check for batch generation concurrency limits.

## Definition Of Done (MVP)
- User uploads one reference image.
- User enters one prompt.
- User requests N variants (default 5).
- App returns successful images with clear per-image prompt variant metadata.
- User can download outputs easily.
- App handles partial failures gracefully and remains responsive.
