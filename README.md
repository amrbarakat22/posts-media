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

| Requirement               | Implementation                                                              |
| ------------------------- | --------------------------------------------------------------------------- |
| 1. Posts CRUD             | Posts controller/service/repository, delete and restore                     |
| 2. Upload validation      | MIME, extension, size, signature, Sharp/FFprobe inspection                  |
| 3. Organized storage      | Three private MinIO buckets and deterministic object keys                   |
| 4. Database records       | Prisma Post, Media, MediaVariant, attempt/outbox models                     |
| 5. Image processing       | Sharp auto-orient, resize/compress, optimized WebP and thumbnail            |
| 6. Audio processing       | FFprobe metadata/duration and normalized MP3                                |
| 7. Video processing       | FFprobe, H.264/AAC renditions and JPEG thumbnail                            |
| 8. Redis + BullMQ         | Three queues consumed by the worker                                         |
| 9. Processing states      | PENDING, PROCESSING, COMPLETED, FAILED                                      |
| 10. Retry                 | BullMQ attempts plus generation-incrementing manual retry                   |
| 11. Status endpoint       | `/api/media/:mediaId/status`                                                |
| 12. Idempotent processing | Deterministic jobs, generation and DB lease guards                          |
| 13. Pagination/filtering  | `GET /api/posts` typed query contract                                       |
| 14. Soft delete           | Delete, include-deleted reads, restore                                      |
| 15. Swagger               | `/api/docs` and `/api/docs-json`                                            |
| 16. Tests                 | Unit, PostgreSQL/Redis/MinIO integration, HTTP E2E, worker suites and smoke |
