# Posts & Media Processing Platform

A localhost-only NestJS monorepo demonstrating post CRUD and secure asynchronous mixed-media processing. The API stores durable state in PostgreSQL and private objects in MinIO. A separate worker publishes transactional outbox rows to three Redis/BullMQ queues and processes images with Sharp and audio/video with FFmpeg/FFprobe.

## Run locally

Prerequisites: Docker Compose; or Node.js 24, PostgreSQL 18, Redis 8.6, MinIO, FFmpeg, and FFprobe for running processes directly.

```bash
cp .env.example .env       # optional; Compose defaults work unchanged
docker compose up --build -d
docker compose ps
npm run smoke
```

Open:

- Dashboard: <http://127.0.0.1:3000/>
- Swagger: <http://127.0.0.1:3000/api/docs>
- MinIO console: <http://127.0.0.1:9001/> (default local credentials are in `.env.example`)

`minio-init` creates three private buckets and `migrate` applies `prisma/migrations` before API/worker startup. Host-exposed ports bind to `127.0.0.1`; PostgreSQL and Redis remain internal.

## Architecture and guarantees

Uploads are disk-staged, checked by extension, declared MIME, signature, size, and decoded/probed limits, then promoted to immutable MinIO originals. The database transaction creates `Media` and `ProcessingDispatch`; API success never depends on Redis. The worker claims outbox rows with leases and publishes deterministic generation-specific BullMQ job IDs. Processing claims, attempts, generation checks, and lease-guarded publication make duplicate delivery safe. A media row becomes `COMPLETED` only in the transaction that records its generated variants.

Queues and default concurrency:

- `image-processing`: 4
- `audio-processing`: 2
- `video-processing`: 1

The `balanced-v1` profile generates WebP image/thumbnail output, 192 kbps MP3 audio, and no-upscale H.264/AAC MP4 ladders (360p/720p/1080p as applicable) plus JPEG thumbnails. Buckets stay private; `/api/media/:id/access` creates fresh 900-second presigned URLs.

The default upload limits are 10 files/request, 500 MB total, 10 MB/image,
50 MB/audio, 250 MB/video, 40 million image pixels, 7,200 seconds/audio,
1,800 seconds/video, and 7,680x4,320 maximum video dimensions. Audio accepts
MP3, WAV, M4A/AAC, FLAC, and OGG inputs; video output is capped at 30 FPS and
uses yuv420p-compatible H.264/AAC MP4. Automatic retries use the configured
BullMQ attempt count; exhausted work is `FAILED` with sanitized diagnostics.
Processed objects are immutable by generation/attempt so a stale worker cannot
remove a newer worker's publication.

Mutating upload/retry routes require `Idempotency-Key`. Reusing a key with the same request replays its stored result; using it with different input is rejected. Manual retry is allowed only from `FAILED` and increments the processing generation. Automatic BullMQ retries retain the generation.

## API

- `POST /api/posts` — JSON or multipart create
- `GET /api/posts` — pagination, search, media/status/date filters, deleted inclusion and sorting
- `GET|PATCH|DELETE /api/posts/:postId`, `POST /api/posts/:postId/restore`
- `POST /api/posts/:postId/media` — partial-success mixed-media addition
- `GET /api/media/:mediaId`, `/status`, `/access`; `POST /retry`
- `GET /api/system/live`, `/ready`, `/diagnostics`

The vanilla HTML/CSS/JavaScript dashboard exposes creation, upload progress, filters, pagination, add media, delete/restore, status polling, retries, diagnostics, JSON/request IDs, and fresh private previews.

## Development and verification

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run lint
npm run format:check
npm run build
docker compose -f docker-compose.test.yml up -d
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:worker
npm run smoke
```

Generate deterministic valid and corrupt fixtures with `node scripts/create-test-media.mjs tmp/test-media`. Integration tests need the environment values from `.env.test.example`/`.env.example` pointed at the test Compose network. The repository's pinned runtime is Node 24; do not treat host Node 20 results as authoritative.

Troubleshooting: inspect `docker compose logs api worker`, then `/api/system/diagnostics`. `PENDING` dispatches while Redis is down are expected and publish after recovery. Readiness intentionally requires PostgreSQL and MinIO but not Redis. For processing failures, confirm `ffmpeg -version`, `ffprobe -version`, bucket initialization, and writable API/worker temporary roots.

## Assignment Requirement Coverage

Each row names the implementation, automated evidence, smoke evidence, and
current status. Commands below were run against the Node 24 test Compose stack;
the clean production-style stack and mixed-media smoke were also rerun.

| Requirement                                      | Implementation                                                         | Automated test evidence                                                        | Smoke evidence                                   | Status   |
| ------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ | -------- |
| Posts CRUD                                       | Posts controller/service/repository, delete/restore                    | `test/e2e/posts.e2e-spec.ts`                                                   | `npm run smoke` CRUD flow                        | COMPLETE |
| MIME validation                                  | `MediaValidationService` MIME policy                                   | `libs/media/src/validation/mime-policy.spec.ts`                                | invalid upload rejected                          | COMPLETE |
| Extension validation                             | Extension policy                                                       | `libs/media/src/validation/extension-policy.spec.ts`                           | spoofed extension rejected                       | COMPLETE |
| File-size validation                             | Per-type and total limits                                              | `media-validation.service.integration.spec.ts`                                 | invalid create rejected                          | COMPLETE |
| File-signature validation                        | Magic-byte detector                                                    | `signature-detector.service.spec.ts`, media validation integration             | corrupt fixture rejected                         | COMPLETE |
| Original media storage                           | Private originals bucket and immutable keys                            | `minio-object-storage.integration.spec.ts`, create-post integration            | mixed upload originals accessed by presigned URL | COMPLETE |
| Processed media storage                          | Private processed/temporary buckets and compensation                   | `variant-publication.service.spec.ts`, worker recovery                         | all mixed-media variants accessible              | COMPLETE |
| Post/Media database records                      | Prisma schema, repositories, outbox/attempt relations                  | `database.integration.spec.ts`                                                 | smoke post/media/status checks                   | COMPLETE |
| Image resize/compression/thumbnail               | Sharp image processor                                                  | `image-processor.service.spec.ts`, create-post integration                     | mixed image reaches COMPLETED with variants      | COMPLETE |
| Audio duration/metadata/MP3                      | FFprobe + normalized 192 kbps MP3                                      | `audio-processor.integration.spec.ts` (MP3/WAV/M4A/FLAC/OGG, channels)         | WAV mixed-media upload completes                 | COMPLETE |
| Video compression/metadata/thumbnail/resolutions | FFprobe + H.264/AAC no-upscale ladder                                  | `video-processor.integration.spec.ts` (1080/720/480/sub-360/portrait/no-audio) | MP4 mixed-media upload completes                 | COMPLETE |
| Redis + BullMQ processing                        | Transactional outbox and three queues                                  | `queue-publication.integration.spec.ts`, worker recovery                       | clean Compose worker/Redis healthy               | COMPLETE |
| Processing states                                | PENDING/PROCESSING/COMPLETED/FAILED transitions                        | `worker-recovery.integration.spec.ts`                                          | smoke polls to COMPLETED                         | COMPLETE |
| Failed-job retry                                 | Automatic attempts plus manual generation retry                        | `worker-recovery.integration.spec.ts`, `media-retry.e2e-spec.ts`               | retry path exercised in real queue               | COMPLETE |
| Media status endpoint                            | `GET /api/media/:mediaId/status`                                       | `media-retry.e2e-spec.ts`                                                      | smoke polling                                    | COMPLETE |
| Idempotent processing                            | Deterministic job IDs, leases, generation/attempt keys                 | queue publication, worker recovery, retry E2E                                  | replayed create request remains one resource     | COMPLETE |
| Pagination/filtering                             | Typed `GET /api/posts` query contract                                  | `posts.e2e-spec.ts`                                                            | smoke filtered list                              | COMPLETE |
| Soft delete                                      | Delete, include-deleted reads, restore                                 | `posts.e2e-spec.ts`                                                            | smoke delete/restore                             | COMPLETE |
| Swagger documentation                            | `/api/docs` and `/api/docs-json`                                       | `apps/api/src/main.spec.ts`                                                    | clean-stack docs JSON exposes 11 paths           | COMPLETE |
| Unit/integration/E2E tests                       | Jest unit, PostgreSQL/Redis/MinIO integration, HTTP E2E, worker suites | 279 unit, 105 integration, 32 E2E, 20 worker                                   | `npm run smoke`                                  | COMPLETE |
