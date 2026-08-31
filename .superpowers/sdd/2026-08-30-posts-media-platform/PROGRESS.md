# Posts Media Platform - Task Progress

Plan: `docs/superpowers/plans/2026-08-30-posts-media-platform.md`

| Task | Title | Status | Commit(s) |
|---|---|---|---|
| 1 | Scaffold NestJS monorepo and quality tooling | DONE | `5fcbc79`, `55e6132` |
| 2 | Environment validation and Docker infrastructure | DONE | `c0bcc4a`, `d84fad3` |
| 3 | Prisma schema, migration, and database module | DONE (verified) | `c2901e6` |
| 4 | Domain enums, errors, result types, presentation contracts | DONE | `d960ec3` |
| 5 | MinIO storage port and adapter | DONE | `70bbc63` |
| 6 | Request IDs, global errors, Multer staging, cleanup | DONE | `ab71900` |
| 7 | File validation pipeline | DONE (verified) | `1911545`, `553fc54` |
| 8 | Post CRUD, pagination, filtering, soft delete | DONE (verified) | `89776b6` (RED scaffold, pulled from origin), `869817e` |
| 9 | HTTP idempotency core | DONE (verified) | `7a063bc` |
| 10 | Atomic create post with initial media | DONE (verified) | `502107e` |
| 11 | Partial add-media flow | DONE (verified) | `a4f7224` |
| 12 | Transactional outbox dispatcher + BullMQ topology | IN PROGRESS (implementation committed; recovery matrix pending) | `5057b2e`, `7dcdf34` |
| 13 | Worker processing claim, lease renewal, attempts, workspace | TODO | - |
| 14 | Image processing and variant publication | TODO | - |
| 15 | Audio processing | TODO | - |
| 16 | Video rendition planning, transcoding, thumbnail | TODO | - |
| 17 | Media read/status/access and manual retry | TODO | - |
| 18 | Worker heartbeat, API health, diagnostics | TODO | - |
| 19 | Swagger and static testing UI | TODO | - |
| 20 | Full failure-recovery and idempotency test matrix | TODO | - |
| 21 | README, smoke test, final verification | TODO | - |

## Reconciliation note (Task 8)

Mid-Task-8, `git pull` surfaced that a different session had already pushed
`89776b6` ("wip(posts): start Task 8 E2E coverage") — the real interruption
point, one step further than this session's initial recovery briefing
assumed. That commit was the authoritative TDD Step 1 (RED E2E suite) for
Task 8. Reconciliation: stashed this session's independently-written
duplicate implementation, rebased the local `redis:8.6.6-trixie` fix onto
`89776b6`, then re-applied the implementation on top of the pulled test file
instead of overwriting it — keeping their committed test as the base,
extending it with a few additional edge cases, and fixing two real defects
in it (`PORT=0` fails the port validator's `min:1`; `bootstrap()`'s default
`abortOnError:true` masked startup failures behind `process.exit()`). Also
found the test expected `409` for `POST_SOFT_DELETED`, not `410` as this
session had initially guessed — conformed the implementation to `409`.

Lesson for future resumption: always `git pull` and diff against origin
*before* writing new implementation/tests, not only at session start.

## Environment notes

- Host shell Node is v20.19.2; the project requires Node 24 (`engines: ">=24 <25"`)
  and Prisma 7. All authoritative build/test/migration verification for this
  session runs inside a `node:24.15.0-bookworm-slim` Docker container
  (`pm-node24`) attached to the `posts-media-test_default` network, matching
  the pinned image used by `docker/api/Dockerfile` and `docker/worker/Dockerfile`.
- `docker-compose.test.yml` provides real PostgreSQL 18.0, Redis 8.6.6, and
  MinIO with the three private buckets pre-created by `minio-init`.
- Fixed a real project bug found during recovery: `redis:8.6.0-bookworm` does
  not exist on Docker Hub (that patch/base combination was never published).
  Repinned both `docker-compose.yml` and `docker-compose.test.yml` to the
  latest valid Redis 8.6.x image, `redis:8.6.6-trixie`.
- Do not downgrade Node, Prisma, or BullMQ to accommodate the host shell.

## How to resume verification in a new session

```bash
docker compose -f docker-compose.test.yml up -d
docker network ls | grep posts-media-test   # note the network name
docker run -d --name pm-node24 --network posts-media-test_default \
  -v "$(pwd)":/app -w /app \
  -e DATABASE_URL="postgresql://posts:posts@postgres:5432/posts_media_test" \
  -e MINIO_ENDPOINT=minio -e MINIO_PORT=9000 -e MINIO_USE_SSL=false \
  -e MINIO_ACCESS_KEY=minioadmin -e MINIO_SECRET_KEY=minioadmin123 \
  -e MINIO_ORIGINALS_BUCKET=post-originals -e MINIO_PROCESSED_BUCKET=post-processed -e MINIO_TEMP_BUCKET=post-temporary \
  -e REDIS_HOST=redis -e REDIS_PORT=6379 \
  node:24.15.0-bookworm-slim sleep infinity
docker exec pm-node24 bash -c "apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 make g++ ffmpeg ca-certificates"
docker exec pm-node24 bash -c "cd /app && npm ci && npx prisma generate && npx prisma migrate deploy"
```
