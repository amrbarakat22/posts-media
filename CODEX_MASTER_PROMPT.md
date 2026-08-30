# Codex Master Implementation Prompt - NestJS Posts + Media Processing Assignment

You are implementing a complete technical assignment, not writing another plan.

The authoritative design and implementation plan is the file:

```text
posts-media-platform-master-plan.md
```

Read that file completely before editing code. Treat its Part I as the approved specification and Part II as the required task order. Do not silently replace its architectural decisions with simpler alternatives.

## Mission

Build the entire Posts + Media Processing platform end to end using:

```text
NestJS monorepo
TypeScript strict mode
PostgreSQL
Prisma
Redis
BullMQ
MinIO
Sharp
FFmpeg/FFprobe
Docker Compose
Swagger
Jest/Supertest
Static HTML/CSS/vanilla JavaScript test UI
```

The final repository must run locally and demonstrate every assignment feature from the browser UI and Swagger.

## Source Assignment Requirements

The implementation must satisfy all of these, with real code and real tests:

1. CRUD for Posts.
2. Upload files with validation of MIME type, extension, file size, and file signature.
3. Organized storage of Original and Processed files.
4. Database records for Post and Media.
5. Image Processing: resize, compression, thumbnail.
6. Audio Processing: duration, metadata, conversion to MP3.
7. Video Processing: compression, metadata, thumbnail, multiple resolutions.
8. Redis + BullMQ background processing.
9. Processing Status values exactly: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`.
10. Retry mechanism for failed jobs.
11. Endpoint that reports Media processing state.
12. Idempotent processing when requests or jobs are repeated.
13. Pagination and filtering for Posts.
14. Soft Delete.
15. Swagger documentation.
16. Unit and Integration Tests.

The master plan expands these requirements into the architecture below. Those decisions are already approved.

## Non-Negotiable Architecture

Use a NestJS monorepo:

```text
apps/api
apps/worker

libs/configuration
libs/database
libs/domain
libs/posts
libs/media
libs/storage
libs/queues
libs/media-processing
libs/observability
libs/testing
```

`apps/api` owns:

```text
REST API
Swagger
static HTML/CSS/JavaScript UI
Express/Multer request upload staging
HTTP error mapping
request IDs
```

`apps/worker` owns:

```text
transactional outbox dispatcher
BullMQ image consumer
BullMQ audio consumer
BullMQ video consumer
worker heartbeat
worker lifecycle/graceful shutdown
```

Shared libraries own business/infrastructure concerns as defined by the master plan.

Do not make the API and worker import each other.

## Storage

Use private local MinIO buckets:

```text
post-originals
post-processed
post-temporary
```

Do not use the local filesystem for accepted permanent storage.

Use local disk only for:

```text
/tmp/posts-media-api
/tmp/posts-media-worker
```

Original MinIO key:

```text
posts/{postId}/{mediaId}/original.{canonicalExtension}
```

Processed keys use:

```text
posts/{postId}/{mediaId}/balanced-v1/...
```

All buckets remain private. Generate short-lived presigned GET URLs only through the API.

## API Upload Behavior

Support both:

```http
POST /api/posts
POST /api/posts/:postId/media
```

`POST /api/posts` supports JSON without files and multipart form data with initial mixed media.

Create-with-media is atomic from the client's perspective:

```text
one invalid initial file -> no Post and no Media are created
```

Add-media is partial success:

```text
valid files -> accepted
invalid files -> rejected with per-file error details
```

Use Express + Multer temporary disk storage. Do not buffer video files fully in Node memory.

## Supported Input Formats

Images:

```text
JPEG
PNG
WebP
max 10 MiB
animated/multi-frame rejected
max decoded pixels 40,000,000
```

Audio:

```text
MP3
WAV
M4A
AAC
FLAC
OGG
max 50 MiB
max duration 7200 seconds
```

Video:

```text
MP4
MOV
WebM
MKV
max 250 MiB
max duration 1800 seconds
max dimensions 7680x4320
max streams 10
```

Request:

```text
max files 10
max aggregate upload 500 MiB
```

Validate using all of:

```text
extension
browser-declared MIME
binary signature/container family
Sharp or FFprobe parser validation
size
duration/resolution/stream safety limits
SHA-256 checksum
```

Treat client MIME as untrusted. Do not rely on extension or MIME alone.

## Processing Profile

Use exactly:

```text
balanced-v1
```

Images:

```text
auto-orient
sRGB
WebP
max 1920x1920
quality 82
no upscale
400 px max-edge WebP thumbnail
thumbnail quality 75
```

Audio:

```text
output MP3
libmp3lame
192 kbps
preserve mono/stereo
multichannel -> stereo
sample rate <=48kHz
```

Video:

```text
MP4
H.264/libx264
AAC 128k if audio exists
CRF 23
preset veryfast
yuv420p
fast-start
max 30 FPS
no upscale
360p/720p/1080p depending on source
source-sized normalized MP4 if below 360p
JPEG thumbnail
rotation physically applied
```

Do not create 720p or 1080p if that would upscale the source.

## Database

Implement the Prisma schema from the master plan, including:

```text
Post
Media
MediaVariant
ProcessingAttempt
ProcessingDispatch
IdempotencyRequest
WorkerInstance
```

and the exact domain enums/constraints described there.

Post soft delete uses `deletedAt`.

Do not soft-delete or physically delete media when a Post is soft-deleted. Soft deletion is reversible.

## HTTP Idempotency

These endpoints require:

```http
Idempotency-Key: <key>
```

Endpoints:

```http
POST /api/posts
POST /api/posts/:postId/media
POST /api/media/:mediaId/retry
```

Implement database-backed idempotency.

Fingerprint must include canonical normalized body plus file order/name/MIME/size/SHA-256.

Behavior:

```text
same key + same request -> replay original stable result
same key + different request -> 409 IDEMPOTENCY_KEY_REUSED
active same-key request -> 409 IDEMPOTENCY_REQUEST_IN_PROGRESS + Retry-After
```

Stable replay responses must not contain MinIO presigned URLs.

Do not implement global checksum deduplication.

## Transactional Outbox

Do not enqueue BullMQ jobs directly inside Post/Media mutation use cases.

In the same PostgreSQL transaction that creates/updates Media, create one `ProcessingDispatch` per processing generation.

The worker process owns the dispatcher.

Dispatcher states:

```text
PENDING
PUBLISHING
RETRY_WAIT
PUBLISHED
DEAD
```

Claim eligible rows with PostgreSQL row locks and `FOR UPDATE SKIP LOCKED` in a short transaction.

Publish outside the DB transaction.

Use deterministic job IDs:

```text
media-{mediaId}-generation-{generation}
```

Transient Redis errors become `RETRY_WAIT` with exponential backoff + jitter.

Programming/configuration payload failures become `DEAD`.

Never age-delete unpublished outbox rows.

## BullMQ

Use three queues:

```text
image-processing
  concurrency 4

audio-processing
  concurrency 2

video-processing
  concurrency 1
```

Default job attempts:

```text
3
```

Backoff:

```text
exponential, 5000 ms base
```

Automatic retries stay in the same media generation.

Manual retry after `FAILED` increments `processingGeneration`, resets state to `PENDING`, and transactionally creates a new outbox row.

## Worker Idempotency

BullMQ job identity is not enough. Add a PostgreSQL processing lease.

Before processing, atomically claim only if:

```text
media exists
job generation matches current generation
media is not already COMPLETED for that generation
another valid lease does not own it
```

Processing lease:

```text
60 seconds
renew every 20 seconds
```

A duplicate active job is a no-op.
A stale generation is a no-op.
A repeated job for already-completed media is a no-op.

Track every real execution in `ProcessingAttempt`.

## Media Progress and Failure Semantics

Status values remain exactly:

```text
PENDING
PROCESSING
COMPLETED
FAILED
```

During automatic retries, after a failed attempt that still has attempts remaining:

```text
set Media back to PENDING
release processing lease
record last sanitized error
throw so BullMQ retries
```

After the final attempt:

```text
set Media FAILED
```

`POST /api/media/:mediaId/retry` is allowed only for `FAILED` media.

Do not mark Media `FAILED` because Redis is temporarily unavailable. Outbox problems are separate from media-processing problems.

## Required REST Endpoints

Implement at minimum:

```http
POST   /api/posts
GET    /api/posts
GET    /api/posts/:postId
PATCH  /api/posts/:postId
DELETE /api/posts/:postId
POST   /api/posts/:postId/restore
POST   /api/posts/:postId/media

GET    /api/media/:mediaId
GET    /api/media/:mediaId/status
GET    /api/media/:mediaId/access
POST   /api/media/:mediaId/retry

GET    /api/system/health/live
GET    /api/system/health/ready
GET    /api/system/diagnostics
```

Global prefix:

```text
/api
```

Swagger:

```text
/api/docs
/api/docs-json
```

Static UI:

```text
/
```

## Pagination and Filtering

Use page-based pagination:

```text
page default 1
pageSize default 20, max 100
search title/content case-insensitive
mediaType
processingStatus
createdFrom
createdTo
includeDeleted
sortBy = createdAt | updatedAt | title
sortOrder = asc | desc
```

Compute Post aggregate status, do not store it:

```text
NO_MEDIA
PENDING
PROCESSING
PARTIALLY_COMPLETED
COMPLETED
FAILED
```

## Static UI

Do not use React/Vue/Angular.

Build one responsive dashboard served by NestJS with:

```text
system/worker/outbox status
create Post form
optional initial mixed media
upload progress
idempotency key display
Post list
pagination
filters
edit
soft delete
restore
Post details
add more mixed media
partial upload accepted/rejected results
per-Media cards
processing progress/status/current step
metadata
variants
preview/download
retry FAILED media
last API response JSON inspector
```

Use:

```text
fetch for JSON
XMLHttpRequest for multipart upload progress
crypto.randomUUID for idempotency keys
sessionStorage to preserve a key for retrying the same submission
```

Poll active Media every 2 seconds.
Poll diagnostics every 5 seconds while page is visible.

Never render user-controlled values with unsafe `innerHTML`. Prefer `textContent` and DOM construction.

## Swagger

Swagger must document:

```text
all endpoints
all query parameters
multipart media fields
Idempotency-Key requirement
all response DTOs
processing statuses
representative validation errors
partial add-media response
retry conflicts
```

Swagger is part of the acceptance criteria, not optional polish.

## Docker Compose

Create:

```text
postgres
redis
minio
minio-init
migrate
api
worker
```

Bind host ports only:

```text
127.0.0.1:3000
127.0.0.1:9000
127.0.0.1:9001
```

PostgreSQL and Redis stay internal in normal Compose.

Use named volumes.

Use a one-shot migration service.
Use a one-shot MinIO bucket initialization service.
Use signal-friendly container entrypoints such as `dumb-init`.

Pin images/dependencies. Do not use unpinned `latest` Docker image tags.

## Dependency Policy

Use stable compatible releases in these majors:

```text
Node 24 LTS
NestJS 11.x
PostgreSQL 18.x
Prisma 7.x
Redis 8.6.x
@nestjs/bullmq 11.x
BullMQ 5.81.x
Sharp 0.35.x
```

Do not opportunistically move to Prisma 8 or BullMQ 6 during this assignment. The selected majors are intentional compatibility choices.

For the MinIO server container, resolve an official stable current tag and pin it. Do not use `latest`.

Use `package-lock.json` and `npm ci` for verification.

## Security Rules

Even though localhost-only:

```text
Helmet enabled
no permissive CORS
private MinIO buckets
strict environment validation
request IDs
no filesystem path leakage
no credentials in logs/errors
no shell interpolation
spawn FFmpeg/FFprobe with shell:false
subprocess timeouts
bounded FFprobe output
safe filename normalization
UUID-based paths/object keys
safe temp cleanup path containment
```

Do not add fake security claims. There is deliberately no authentication.

## Logging and Diagnostics

Use structured logging (`nestjs-pino`/Pino or equivalent approved in the plan).

Include contextual IDs where relevant:

```text
requestId
postId
mediaId
dispatchId
jobId
generation
attempt
workerInstanceId
```

Never log media content, secrets, or presigned URLs.

Worker heartbeat is stored in PostgreSQL every 10 seconds and is stale after 30 seconds.

If Redis is unavailable:

```text
API can remain ready if DB + MinIO are ready
worker becomes DEGRADED
outbox remains durable
```

## Implementation Workflow

If the `superpowers` skills are available in Codex, use them.

Recommended execution workflow:

```text
1. Read the master plan completely.
2. Inspect the repository before changing anything.
3. If feature work needs isolation, use the git-worktree skill.
4. Use test-driven-development for implementation.
5. Use subagent-driven-development for independent plan tasks when practical.
6. Apply systematic-debugging whenever a test or runtime behavior fails unexpectedly.
7. Use verification-before-completion before any completion claim.
```

The brainstorming/design phase is already complete and approved. Do not restart requirements discovery unless the master plan is internally impossible to implement.

Do not ask the user routine implementation questions. Resolve minor gaps using the master plan's intent and the safest/simple option. If a third-party API changed, inspect its installed/official documentation and adapt while preserving the behavior specified here.

## Task Execution Order

Implement the 21 tasks in Part II of the master plan in order:

```text
1. monorepo/tooling
2. config/Docker
3. Prisma/database
4. domain/errors/presentation
5. MinIO storage
6. request IDs/Multer/temp cleanup
7. validation
8. Posts CRUD/filtering/soft delete
9. HTTP idempotency
10. atomic create-with-media
11. partial add-media
12. outbox/BullMQ
13. worker claims/attempts/workspace
14. images
15. audio
16. video
17. media status/access/retry
18. heartbeat/health/diagnostics
19. Swagger/static UI
20. failure/recovery matrix
21. README/smoke/final verification
```

For every task:

```text
write failing tests first
run the narrow test and confirm expected failure
implement the smallest correct behavior
run narrow tests until green
run relevant neighboring tests
commit if git identity is available
continue to the next task
```

Do not stop after scaffolding, CRUD, or upload support. Complete the processors, worker, UI, Swagger, tests, recovery behavior, and verification.

If git identity is unavailable, do not block implementation waiting for a commit; continue and report that commits were skipped.

## Required Test Coverage

You must implement real tests for at least:

### Validation

```text
valid JPEG/PNG/WebP
animated image rejection
pixel bomb limit
JPEG renamed .mp4
MP4 renamed .jpg
corrupt image header/body
valid/truncated audio
ambiguous MP4/M4A container inspection
valid MOV/WebM/MKV
unsupported codec
missing extension
uppercase extension
generic application/octet-stream
MIME/signature mismatch
empty file
per-type size limits
request aggregate size
probe timeout
stream count limit
```

### Idempotency

```text
same key + same JSON request replay
same key + same multipart replay
same key + changed title -> 409
same key + changed file bytes -> 409
same key + changed file order -> 409
same key different operation -> 409
concurrent same-key request -> one logical execution
expired lease recovery
retryable infrastructure failure reacquisition
```

### Outbox

```text
DB transaction + outbox atomicity
SKIP LOCKED concurrent claims
Redis down -> retry wait
Redis recovery -> publish
duplicate publication -> same deterministic job ID
publisher crash window safety
DEAD invalid payload
published cleanup only after retention
```

### Worker

```text
one processing claim
active duplicate claim no-op
expired lease recovery
stale generation no-op
completed generation no-op
automatic retry same generation
manual retry new generation
```

### Processors

```text
image resize/orientation/no-upscale/thumbnail
audio conversion/channel/sample-rate rules
video 1080/720/480/sub360 ladder
portrait/rotation
60fps cap
video with/without audio
fast-start
thumbnail
output verification
```

### API/E2E

```text
Post CRUD
pagination/filtering
soft delete/restore
JSON create
mixed multipart create
atomic invalid initial media
partial add media
media status
media access URLs
manual retry
Swagger route coverage
static UI assets
```

### Failure Recovery

```text
Redis unavailable during upload
MinIO failure
DB finalization failure
FFmpeg timeout
worker interruption
response lost after commit then same-key replay
```

Use low test-specific size limits rather than creating enormous files.

Use tiny real media fixtures so processor tests are fast but genuine.

## Error Contract

Return consistent errors:

```json
{
  "statusCode": 422,
  "code": "FILE_SIGNATURE_MISMATCH",
  "message": "Human readable safe message",
  "requestId": "uuid",
  "details": {}
}
```

Implement the stable error codes from the master plan.

Do not send raw stack traces to the browser.

## No Fake Completion

The following are unacceptable:

```text
processor methods that only sleep and mark COMPLETED
mocked FFmpeg in final integration behavior
media variants recorded without actual MinIO objects
public MinIO buckets
Multer memory storage for video
job publication without outbox
idempotency based only on BullMQ jobId
status endpoints that read only BullMQ state instead of PostgreSQL
React/Vite UI
missing Swagger schemas
skipped core tests
placeholder comments for required behavior
```

## Final Verification

Before saying the assignment is complete, run from a clean dependency/install state as far as the environment permits:

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run lint
npm run format:check
npm run build
```

Then clean/start infrastructure:

```bash
docker compose down -v --remove-orphans
docker compose up --build -d
docker compose ps
```

Then run:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:worker
npm run smoke
```

Inspect service logs for startup/runtime errors.

Verify manually or through HTTP checks:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/api/docs
http://127.0.0.1:9001/
```

The smoke test must:

```text
create a Post
upload tiny image/audio/video
poll to terminal processing states
assert required variants exist
exercise status/access
exercise pagination/filtering
soft-delete and restore
replay an idempotent mutation
exit nonzero on mismatch
```

Do not claim success from code inspection alone.

## Final Response Expected From You

When implementation is genuinely complete, provide a concise engineering report containing:

```text
1. What was implemented.
2. Important architecture decisions actually present in code.
3. Exact verification commands executed.
4. Test counts/results.
5. Docker service status.
6. URLs for UI, Swagger, and MinIO console.
7. Any deliberate deviations from the master plan, with technical reason.
8. Any remaining limitation, only if one truly could not be completed.
```

Also point the reviewer to the README section that maps all 16 source assignment requirements to the implementation.

Start now. Read `posts-media-platform-master-plan.md`, inspect the repository, and implement the entire system task-by-task. Do not return another high-level plan instead of code.
