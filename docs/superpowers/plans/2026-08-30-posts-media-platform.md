# Posts Media Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete local Posts Module in NestJS with PostgreSQL/Prisma, secure mixed-media uploads, MinIO object storage, Redis/BullMQ background processing, idempotent execution, a transactional outbox, soft deletion, Swagger, automated tests, and a simple static browser UI that exposes every feature for testing.

**Architecture:** Use a NestJS monorepo with two applications: `apps/api` serves REST, Swagger, and the static UI; `apps/worker` owns the transactional outbox dispatcher, BullMQ consumers, and media processing. PostgreSQL is the durable source of truth, MinIO stores immutable originals and generated variants, and Redis/BullMQ transports processing jobs. HTTP idempotency and database processing leases prevent duplicate mutations and duplicate media processing.

**Tech Stack:** Node.js 24 LTS, TypeScript strict mode, NestJS 11.x, Express/Multer, PostgreSQL 18.x, Prisma ORM 7.x, Redis 8.6.x, `@nestjs/bullmq` 11.x with BullMQ 5.81.x, MinIO S3-compatible object storage, Sharp 0.35.x, FFmpeg/FFprobe, Jest, Supertest, Docker Compose, HTML/CSS/vanilla JavaScript.

**Spec:** Part I of this document is the approved design specification. Part II is the executable implementation plan.

## Global Constraints

- This is a localhost-only assignment application. Do not add users, JWT, OAuth, roles, sessions, or API-key authentication.
- Bind host-exposed services to `127.0.0.1`; PostgreSQL and Redis stay on the internal Docker network unless a test command explicitly needs a host port.
- Use MinIO, not local permanent storage, for accepted originals and processed variants.
- Use local temporary disk only for request staging and worker processing workspaces.
- `POST /api/posts`, `POST /api/posts/:postId/media`, and `POST /api/media/:mediaId/retry` require `Idempotency-Key`.
- Use three BullMQ queues: `image-processing`, `audio-processing`, and `video-processing`.
- Worker concurrency defaults: image `4`, audio `2`, video `1`.
- Media processing statuses are exactly `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`.
- Never upscale images or videos.
- Never expose MinIO buckets publicly. Use short-lived presigned GET URLs for previews/downloads.
- Do not store presigned URLs in PostgreSQL or in replayable idempotency responses.
- Do not put file buffers, base64 media, MinIO credentials, or presigned URLs into BullMQ payloads.
- Do not use controllers to query Prisma or MinIO directly. Controllers call application services/use cases.
- Do not call BullMQ directly from mutation use cases. Mutations create `ProcessingDispatch` outbox rows transactionally.
- The API must be able to commit valid uploads while Redis is unavailable.
- The worker owns both outbox publication and BullMQ consumption.
- Use TypeScript strict mode. Avoid `any`; isolate unavoidable third-party untyped values behind adapters.
- Use TDD for domain rules, validators, idempotency, outbox logic, and processors.
- No feature is complete until its unit/integration tests and the relevant build/lint checks pass.
- Do not use global checksum deduplication. The same physical file can be intentionally uploaded again with a new idempotency key.
- Do not implement WebSockets. The static UI polls status while work is active.
- Do not add Kubernetes, cloud S3, CDN, external auth, message brokers other than Redis/BullMQ, or a frontend framework.

---

# Part I - Approved Design Specification

## 1. Source Assignment Requirements

The source assignment requires the Posts module to provide all of the following:

1. CRUD for posts.
2. Media upload validation using MIME type, extension, file size, and file signature.
3. Organized storage of original and processed files.
4. Database records for posts and media.
5. Image processing: resize, compression, thumbnail.
6. Audio processing: duration, metadata, MP3 conversion.
7. Video processing: compression, metadata, thumbnail, multiple resolutions.
8. Redis + BullMQ background processing.
9. Media processing states: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`.
10. Retry for failed jobs.
11. Endpoint to inspect media processing state.
12. Idempotent processing so repeated requests or repeated jobs do not process the same media twice.
13. Post pagination and filtering.
14. Soft delete.
15. Swagger documentation.
16. Unit and integration tests.

Everything below is either a precise interpretation of those requirements or an engineering extension selected during design to make the assignment robust and testable.

## 2. Locked Architecture Decisions

### 2.1 Storage

Use local MinIO with an S3-compatible storage abstraction.

Private buckets:

```text
post-originals
post-processed
post-temporary
```

Object layout:

```text
post-originals/
  posts/{postId}/{mediaId}/original.{canonicalExtension}

post-processed/
  posts/{postId}/{mediaId}/balanced-v1/
    optimized.webp
    thumbnail.webp
    audio-192k.mp3
    video-360p.mp4
    video-720p.mp4
    video-1080p.mp4
    video-source.mp4
    thumbnail.jpg

post-temporary/
  uploads/{requestId}/{fileId}
  processing/{mediaId}/{generation}/{attemptId}/{variantFile}
```

Only files applicable to the media type/source resolution are created.

### 2.2 UI

Use static HTML/CSS/vanilla JavaScript served by NestJS at `/`. Do not create a separate frontend package or framework build.

### 2.3 Media relationship

A post has zero or more mixed media items. One post can contain images, audio, and video together. Each media item owns its own status, generation, attempts, metadata, variants, and retry lifecycle.

```text
Post 1 --- * Media 1 --- * MediaVariant
                    \
                     --- * ProcessingAttempt
                     --- * ProcessingDispatch (one per generation)
```

### 2.4 Upload API flows

Support both:

```http
POST /api/posts
POST /api/posts/:postId/media
```

`POST /api/posts` accepts either JSON without files or multipart form data with initial files.

`POST /api/posts/:postId/media` adds files later.

### 2.5 Validation behavior

- Create post with initial media: atomic from the client's perspective. If any initial file is invalid, create no post and no media.
- Add media to existing post: partial success. Accept valid files and return rejected files with stable validation error codes.

### 2.6 Authentication

No authentication. Localhost-only. Add no identity-related database columns.

### 2.7 Runtime topology

Use one NestJS monorepo and two processes:

```text
apps/api
  REST
  Swagger
  static UI

apps/worker
  outbox dispatcher
  image queue consumer
  audio queue consumer
  video queue consumer
  Sharp/FFmpeg/FFprobe processing
```

### 2.8 Upload adapter

Use NestJS Express adapter with Multer disk storage. Incoming large files must never be buffered fully in Node.js memory.

### 2.9 Input formats and size limits

Images:

```text
JPEG: .jpg, .jpeg, image/jpeg
PNG:  .png, image/png
WebP: .webp, image/webp
Maximum: 10 MiB
Animated/multi-frame images: rejected
Maximum decoded pixels: 40,000,000
```

Audio:

```text
MP3:  .mp3
WAV:  .wav
M4A:  .m4a
AAC:  .aac
FLAC: .flac
OGG:  .ogg, .oga
Maximum: 50 MiB
Maximum duration: 7,200 seconds
```

Video:

```text
MP4:  .mp4
MOV:  .mov
WebM: .webm
MKV:  .mkv
Maximum: 250 MiB
Maximum duration: 1,800 seconds
Maximum dimensions: 7680 x 4320
Maximum streams: 10
```

Request limits:

```text
Maximum files per request: 10
Maximum aggregate upload size: 500 MiB
Maximum title length: 200 characters
Maximum content length: 10,000 characters
```

### 2.10 Balanced processing profile

Profile identifier: `balanced-v1`.

Images:

```text
auto-orient
sRGB
optimized WebP
max 1920 x 1920
quality 82
no upscaling
400 px max-edge WebP thumbnail
thumbnail quality 75
strip arbitrary metadata
```

Audio:

```text
output MP3
libmp3lame
192 kbps
preserve mono/stereo
multichannel downmix to stereo
sample rate <= 48 kHz
strip embedded artwork and arbitrary metadata from output
store selected sanitized input tags in PostgreSQL
```

Video:

```text
MP4
H.264/libx264
AAC 128 kbps when source has audio
CRF 23
preset veryfast
yuv420p
fast-start
maximum 30 FPS
no upscaling
360p, 720p, 1080p ladder where source is large enough
source-sized normalized MP4 if source is below 360p
JPEG thumbnail
apply rotation physically
```

Resolution bounds:

```text
Landscape 360p:  640 x 360
Landscape 720p:  1280 x 720
Landscape 1080p: 1920 x 1080
Portrait 360p:   360 x 640
Portrait 720p:   720 x 1280
Portrait 1080p:  1080 x 1920
```

Use even dimensions for H.264.

Suggested H.264 VBV limits while still using CRF:

```text
360p:  maxrate 800k,  bufsize 1200k
720p:  maxrate 2500k, bufsize 3750k
1080p: maxrate 5000k, bufsize 7500k
```

### 2.11 HTTP and queue idempotency

Required mutation header:

```http
Idempotency-Key: <8-128 character key; UI uses crypto.randomUUID()>
```

Protected operations:

```text
CREATE_POST
ADD_POST_MEDIA
RETRY_MEDIA
```

Same key + same fingerprint:

```text
return original stable result
create nothing new
```

Same key + different fingerprint or operation:

```http
409 IDEMPOTENCY_KEY_REUSED
```

Concurrent same-key request:

```http
409 IDEMPOTENCY_REQUEST_IN_PROGRESS
Retry-After: 2
```

Default idempotency retention: 24 hours.
Default request lease: 900 seconds.

Fingerprint inputs:

```text
operation
route parameters
normalized body
file order
normalized original filename
declared MIME
size
SHA-256 content checksum
```

Do not include generated IDs, temp paths, MinIO keys, timestamps, or presigned URLs.

### 2.12 Transactional outbox

Mutation transactions create `ProcessingDispatch` records; they do not publish directly to Redis.

The worker dispatcher:

```text
claims PENDING / eligible RETRY_WAIT / expired PUBLISHING rows
publishes deterministic BullMQ jobs
marks rows PUBLISHED
retries transient Redis failures with exponential backoff + jitter
marks programming/configuration failures DEAD
```

Default outbox settings:

```text
poll: 1000 ms
batch size: 25
publish concurrency: 5
lease: 30 seconds
retry delay cap: 60 seconds
published retention: 7 days
```

### 2.13 BullMQ topology

Three queues:

```text
image-processing  concurrency 4
audio-processing  concurrency 2
video-processing  concurrency 1
```

Deterministic logical job ID:

```text
media-{mediaId}-generation-{generation}
```

Default processing attempts:

```text
attempts: 3
backoff: exponential, 5000 ms base
```

Automatic retry keeps the same generation. Manual retry after final failure increments the generation.

### 2.14 Worker processing leases

The database is the final duplicate-processing guard. A worker must atomically claim a media generation before doing expensive work.

Defaults:

```text
processing lease: 60 seconds
lease renewal: every 20 seconds
```

A job exits without processing when:

```text
media does not exist
job generation is stale
media generation is already COMPLETED
another worker owns a valid lease
```

### 2.15 Soft delete

Soft delete applies to Posts. `DELETE /api/posts/:id` sets `deletedAt` and does not delete MinIO media.

- Default list/get endpoints exclude deleted posts.
- `includeDeleted=true` can expose them in the local testing application.
- `POST /api/posts/:id/restore` clears `deletedAt`.
- Soft deletion does not cancel processing because restoration is allowed.
- Permanent purge is outside the normal REST API. Test cleanup scripts can delete test records and test objects.

### 2.16 Pagination/filtering

Use page-based pagination for the assignment UI:

```text
page: default 1
pageSize: default 20, max 100
search: title/content contains, case-insensitive
mediaType: IMAGE | AUDIO | VIDEO
processingStatus: PENDING | PROCESSING | COMPLETED | FAILED
createdFrom: ISO date-time
createdTo: ISO date-time
includeDeleted: boolean
sortBy: createdAt | updatedAt | title
sortOrder: asc | desc
```

Post aggregate status is computed, never stored:

```text
NO_MEDIA
PENDING
PROCESSING
PARTIALLY_COMPLETED
COMPLETED
FAILED
```

Algorithm:

```text
no media -> NO_MEDIA
any PROCESSING -> PROCESSING
all PENDING -> PENDING
all COMPLETED -> COMPLETED
all FAILED -> FAILED
otherwise -> PARTIALLY_COMPLETED
```

## 3. Version and Dependency Policy

Use stable, pinned dependency versions compatible with the following majors:

```text
Node.js 24 LTS
NestJS 11.x
TypeScript compatible with NestJS 11 toolchain
PostgreSQL 18.x
Prisma ORM 7.x
Redis 8.6.x
@nestjs/bullmq 11.x
BullMQ 5.81.x
Sharp 0.35.x
```

Rationale for conservative queue/ORM majors:

- Prisma 8 is newer, but Prisma 7 remains supported and preserves the conventional generated-client workflow that is mature for NestJS application repositories.
- BullMQ 6 is newer, but the official NestJS BullMQ integration is currently centered on BullMQ 5.x; use the mature compatible major for this assignment.

Pin the resulting lockfile. Do not use floating `latest` tags in Docker Compose. For MinIO, resolve an official stable server image tag at implementation time and pin the exact tag/digest in Compose rather than using `latest`.

Core runtime packages:

```text
@nestjs/common
@nestjs/core
@nestjs/config
@nestjs/platform-express
@nestjs/swagger
@nestjs/serve-static
@nestjs/bullmq
@nestjs/terminus
class-validator
class-transformer
prisma
@prisma/client
bullmq
minio
sharp
helmet
nestjs-pino
pino
fast-json-stable-stringify
```

Development/test packages:

```text
@nestjs/testing
jest
ts-jest
supertest
@types/supertest
@types/multer
eslint
prettier
```

Use Node `child_process.spawn` for FFmpeg/FFprobe rather than adding a wrapper that hides process lifecycle behavior.

## 4. Runtime Architecture

```text
Browser
  |
  | http://127.0.0.1:3000
  v
NestJS API
  |-- REST /api/*
  |-- Swagger /api/docs
  |-- static UI /
  |-- Multer temp workspace
  |
  +--> PostgreSQL/Prisma
  |      Post
  |      Media
  |      MediaVariant
  |      ProcessingAttempt
  |      ProcessingDispatch
  |      IdempotencyRequest
  |      WorkerInstance
  |
  +--> MinIO
         post-temporary
         post-originals
         post-processed

PostgreSQL ProcessingDispatch
  |
  v
NestJS Worker - Outbox Dispatcher
  |
  v
Redis/BullMQ
  |-- image-processing
  |-- audio-processing
  |-- video-processing
  |
  v
NestJS Worker Consumers
  |-- Sharp
  |-- FFprobe
  |-- FFmpeg
  |
  +--> MinIO
  +--> PostgreSQL
```

The API does not require Redis for mutation durability. The worker does.

## 5. Repository Structure

```text
posts-media-platform/
  apps/
    api/
      src/
        main.ts
        api.module.ts
        http/
          controllers/
            posts.controller.ts
            media.controller.ts
            system.controller.ts
          dto/
          filters/
          interceptors/
          middleware/
          presenters/
        upload/
          multer.config.ts
          request-workspace.service.ts
          upload-cleanup.service.ts
      public/
        index.html
        css/styles.css
        js/
          app.js
          api.js
          posts.js
          media.js
          uploads.js
          diagnostics.js
          ui.js
      test/e2e/
    worker/
      src/
        main.ts
        worker.module.ts
        outbox/
          outbox-dispatcher.module.ts
          outbox-dispatcher.service.ts
          outbox-claim.repository.ts
          dispatch-publication.service.ts
          publication-backoff.service.ts
          outbox-cleanup.service.ts
        consumers/
          image.consumer.ts
          audio.consumer.ts
          video.consumer.ts
        lifecycle/
          worker-heartbeat.service.ts
          graceful-shutdown.service.ts
      test/integration/
  libs/
    configuration/src/
      configuration.module.ts
      environment.schema.ts
      app.config.ts
      storage.config.ts
      queue.config.ts
      processing.config.ts
    database/src/
      database.module.ts
      prisma.service.ts
      transaction.service.ts
      repositories/
    domain/src/
      enums/
      errors/
      models/
      value-objects/
      result/
    posts/src/
      posts.module.ts
      application/
      repositories/
      queries/
    media/src/
      media.module.ts
      application/
      validation/
        media-validation.service.ts
        extension-policy.ts
        mime-policy.ts
        signature-detector.service.ts
        image-inspector.service.ts
        av-inspector.service.ts
        checksum.service.ts
      repositories/
      metadata/
    storage/src/
      storage.module.ts
      ports/object-storage.port.ts
      minio/minio-object-storage.adapter.ts
      object-key.service.ts
      storage.types.ts
    queues/src/
      queues.module.ts
      contracts/media-job-payload.ts
      producers/media-job-publisher.service.ts
      queue-names.ts
      job-names.ts
      queue-options.ts
    media-processing/src/
      media-processing.module.ts
      workspace/processing-workspace.service.ts
      ffmpeg/ffmpeg.service.ts
      ffmpeg/ffprobe.service.ts
      ffmpeg/ffmpeg-command-builder.ts
      image/image-processor.service.ts
      audio/audio-processor.service.ts
      video/video-processor.service.ts
      video/video-rendition-planner.ts
      variants/variant-publication.service.ts
    observability/src/
      observability.module.ts
      correlation/
      logging/
      sanitization/
    testing/src/
      factories/
      fixtures/
      helpers/
  prisma/
    schema.prisma
    migrations/
    seed.ts
  docker/
    api/Dockerfile
    worker/Dockerfile
    minio/initialize.sh
  scripts/
    create-test-media.mjs
    smoke-test.mjs
    verify-runtime-tools.sh
    clean-test-data.mjs
  test-assets/
    valid/
    invalid/
  docker-compose.yml
  docker-compose.test.yml
  nest-cli.json
  tsconfig.json
  tsconfig.build.json
  package.json
  package-lock.json
  .env.example
  .gitignore
  README.md
```

## 6. Shared Interfaces

### 6.1 Validated upload

```ts
export interface ValidatedUpload {
  fileIndex: number;
  temporaryPath: string;
  originalFilename: string;
  extension: string;
  declaredMimeType: string;
  detectedMimeType: string;
  detectedFormat: string;
  mediaType: MediaType;
  sizeBytes: bigint;
  checksumSha256: string;
  preliminaryMetadata: Record<string, unknown>;
}
```

### 6.2 Object storage port

```ts
export interface ObjectRef {
  bucket: string;
  objectKey: string;
}

export interface StoredObject extends ObjectRef {
  etag?: string;
  sizeBytes: bigint;
}

export interface ObjectStoragePort {
  putFile(ref: ObjectRef, localPath: string, metadata?: Record<string, string>): Promise<StoredObject>;
  copy(source: ObjectRef, destination: ObjectRef): Promise<StoredObject>;
  stat(ref: ObjectRef): Promise<StoredObject>;
  downloadToFile(ref: ObjectRef, destinationPath: string): Promise<void>;
  remove(ref: ObjectRef): Promise<void>;
  removeMany(refs: ObjectRef[]): Promise<void>;
  exists(ref: ObjectRef): Promise<boolean>;
  presignedGet(ref: ObjectRef, expiresInSeconds: number): Promise<string>;
}
```

### 6.3 Queue payload

```ts
export interface MediaJobPayloadV1 {
  payloadVersion: 1;
  dispatchId: string;
  mediaId: string;
  postId: string;
  mediaType: MediaType;
  generation: number;
  processingProfile: 'balanced-v1';
  reason: 'INITIAL_UPLOAD' | 'MANUAL_RETRY';
}
```

### 6.4 Stable mutation response rule

All replayable mutation responses must contain stable IDs, states, and API links only. They must not contain presigned URLs or timestamps that are generated only for presentation.

## 7. Prisma Data Model

Use UUID primary keys and UTC timestamps.

### 7.1 Enums

```prisma
enum MediaType {
  IMAGE
  AUDIO
  VIDEO
}

enum ProcessingStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum ProcessingStep {
  PENDING
  CLAIMING
  DOWNLOADING
  VERIFYING
  PROBING
  PLANNING
  PROCESSING
  UPLOADING
  FINALIZING
  COMPLETED
  FAILED
}

enum MediaVariantType {
  OPTIMIZED_IMAGE
  IMAGE_THUMBNAIL
  NORMALIZED_AUDIO
  VIDEO_360P
  VIDEO_720P
  VIDEO_1080P
  VIDEO_SOURCE
  VIDEO_THUMBNAIL
}

enum ProcessingAttemptStatus {
  RUNNING
  COMPLETED
  FAILED
  INTERRUPTED
}

enum DispatchStatus {
  PENDING
  PUBLISHING
  RETRY_WAIT
  PUBLISHED
  DEAD
}

enum DispatchReason {
  INITIAL_UPLOAD
  MANUAL_RETRY
}

enum IdempotencyState {
  IN_PROGRESS
  FINALIZED
  RETRYABLE_FAILURE
  EXPIRED
}

enum IdempotencyOperation {
  CREATE_POST
  ADD_POST_MEDIA
  RETRY_MEDIA
}

enum WorkerInstanceStatus {
  STARTING
  READY
  DEGRADED
  SHUTTING_DOWN
  STOPPED
}
```

### 7.2 Models

```prisma
model Post {
  id        String   @id @default(uuid()) @db.Uuid
  title     String   @db.VarChar(200)
  content   String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  media Media[]

  @@index([createdAt])
  @@index([deletedAt])
}

model Media {
  id                String   @id @default(uuid()) @db.Uuid
  postId            String   @db.Uuid
  sortOrder         Int
  mediaType         MediaType
  originalFilename  String   @db.VarChar(255)
  originalExtension String   @db.VarChar(16)
  declaredMimeType  String   @db.VarChar(100)
  detectedMimeType  String   @db.VarChar(100)
  detectedFormat    String   @db.VarChar(32)
  originalBucket    String   @db.VarChar(63)
  originalObjectKey String   @db.VarChar(1024)
  originalSize      BigInt
  checksumSha256    String   @db.Char(64)

  processingProfile    String           @default("balanced-v1") @db.VarChar(64)
  processingGeneration Int              @default(1)
  processingStatus     ProcessingStatus @default(PENDING)
  progress             Int              @default(0)
  currentStep          ProcessingStep   @default(PENDING)
  processingStartedAt  DateTime?
  processingCompletedAt DateTime?
  processingLeaseToken String?          @db.Uuid
  processingLeaseExpiresAt DateTime?
  activeJobId          String?          @db.VarChar(200)
  lastErrorCode        String?          @db.VarChar(64)
  lastErrorMessage     String?          @db.VarChar(1000)
  metadata             Json?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  post       Post                @relation(fields: [postId], references: [id])
  variants   MediaVariant[]
  attempts   ProcessingAttempt[]
  dispatches ProcessingDispatch[]

  @@unique([postId, sortOrder])
  @@index([postId, processingStatus])
  @@index([processingStatus])
  @@index([mediaType])
}

model MediaVariant {
  id                String           @id @default(uuid()) @db.Uuid
  mediaId           String           @db.Uuid
  processingProfile String           @db.VarChar(64)
  variantType       MediaVariantType
  bucket            String           @db.VarChar(63)
  objectKey         String           @db.VarChar(1024)
  mimeType          String           @db.VarChar(100)
  format            String           @db.VarChar(32)
  size              BigInt
  checksumSha256    String           @db.Char(64)
  width             Int?
  height            Int?
  bitrateKbps       Int?
  resolutionLabel   String?          @db.VarChar(32)
  createdAt         DateTime         @default(now())

  media Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)

  @@unique([mediaId, processingProfile, variantType])
  @@index([mediaId])
}

model ProcessingAttempt {
  id                String                  @id @default(uuid()) @db.Uuid
  mediaId           String                  @db.Uuid
  generation        Int
  bullAttemptNumber Int
  jobId             String                  @db.VarChar(200)
  processingProfile String                  @db.VarChar(64)
  status            ProcessingAttemptStatus
  workerInstanceId  String?                 @db.VarChar(200)
  errorCode         String?                 @db.VarChar(64)
  errorMessage      String?                 @db.VarChar(1000)
  startedAt         DateTime                @default(now())
  completedAt       DateTime?
  durationMs        Int?

  media Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)

  @@unique([mediaId, generation, bullAttemptNumber])
  @@index([mediaId, generation])
}

model ProcessingDispatch {
  id               String         @id @default(uuid()) @db.Uuid
  mediaId          String         @db.Uuid
  generation       Int
  reason           DispatchReason
  queueName        String         @db.VarChar(100)
  jobName          String         @db.VarChar(100)
  jobId            String         @unique @db.VarChar(200)
  payloadVersion   Int            @default(1)
  payload          Json
  status           DispatchStatus @default(PENDING)
  publishAttempts  Int            @default(0)
  nextAttemptAt    DateTime?
  leaseToken       String?        @db.Uuid
  leaseExpiresAt   DateTime?
  lastErrorCode    String?        @db.VarChar(64)
  lastErrorMessage String?        @db.VarChar(1000)
  publishedAt      DateTime?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  media Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)

  @@unique([mediaId, generation])
  @@index([status, nextAttemptAt])
  @@index([leaseExpiresAt])
}

model IdempotencyRequest {
  id                 String               @id @default(uuid()) @db.Uuid
  key                String               @unique @db.VarChar(128)
  operation          IdempotencyOperation
  method             String               @db.VarChar(10)
  routeTemplate      String               @db.VarChar(200)
  targetResourceId   String?              @db.Uuid
  requestFingerprint String?              @db.Char(64)
  state              IdempotencyState
  responseStatus     Int?
  responseBody       Json?
  resourceIds        Json?
  leaseToken         String?              @db.Uuid
  leaseExpiresAt     DateTime?
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt
  finalizedAt        DateTime?
  expiresAt          DateTime

  @@index([state])
  @@index([expiresAt])
}

model WorkerInstance {
  id               String               @id @db.VarChar(200)
  instanceName     String               @db.VarChar(200)
  version          String               @db.VarChar(50)
  status           WorkerInstanceStatus
  redisConnected   Boolean              @default(false)
  storageConnected Boolean              @default(false)
  dispatcherActive Boolean              @default(false)
  consumersActive  Boolean              @default(false)
  activeJobCount   Int                  @default(0)
  metadata         Json?
  startedAt        DateTime             @default(now())
  lastHeartbeatAt  DateTime             @default(now())
  shutdownAt       DateTime?
}
```

If Prisma migration generation reveals a PostgreSQL type incompatibility, fix the schema while preserving the exact domain semantics and constraints above.

## 8. HTTP API Contract

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

### 8.1 Posts

```http
POST   /api/posts
GET    /api/posts
GET    /api/posts/:postId
PATCH  /api/posts/:postId
DELETE /api/posts/:postId
POST   /api/posts/:postId/restore
POST   /api/posts/:postId/media
```

Create JSON:

```json
{
  "title": "Post without media",
  "content": "Text content"
}
```

Create multipart:

```text
title=<string>
content=<string>
media=<file repeated 0..10 times>
```

Add-media multipart:

```text
media=<file repeated 1..10 times>
```

List response:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

### 8.2 Media

```http
GET  /api/media/:mediaId
GET  /api/media/:mediaId/status
GET  /api/media/:mediaId/access
POST /api/media/:mediaId/retry
```

`GET /access` returns fresh presigned URLs with `expiresAt` and never mutates idempotency state.

Example status:

```json
{
  "mediaId": "uuid",
  "processingStatus": "PROCESSING",
  "progress": 45,
  "currentStep": "PROCESSING",
  "generation": 1,
  "processingProfile": "balanced-v1",
  "lastError": null,
  "dispatch": {
    "status": "PUBLISHED",
    "publishAttempts": 1,
    "nextAttemptAt": null,
    "lastErrorCode": null
  },
  "latestAttempt": {
    "bullAttemptNumber": 1,
    "status": "RUNNING",
    "startedAt": "ISO-8601"
  }
}
```

### 8.3 System/diagnostics

```http
GET /api/system/health/live
GET /api/system/health/ready
GET /api/system/diagnostics
```

Diagnostics reads PostgreSQL plus WorkerInstance heartbeat/outbox data. The API should not need Redis solely to render diagnostics.

Example diagnostics:

```json
{
  "api": "READY",
  "database": "UP",
  "storage": "UP",
  "worker": {
    "status": "READY",
    "heartbeatAgeSeconds": 4,
    "redisConnected": true,
    "dispatcherActive": true,
    "consumersActive": true,
    "activeJobCount": 1
  },
  "outbox": {
    "pending": 0,
    "publishing": 0,
    "retryWait": 0,
    "dead": 0,
    "oldestUnpublishedAgeSeconds": null
  }
}
```

## 9. Error Contract

Use a global exception filter and stable machine-readable codes.

Shape:

```json
{
  "statusCode": 422,
  "code": "POST_MEDIA_VALIDATION_FAILED",
  "message": "The post was not created because one or more files are invalid.",
  "requestId": "uuid",
  "details": {}
}
```

Per-file validation error:

```json
{
  "fileIndex": 1,
  "originalFilename": "fake-video.mp4",
  "code": "FILE_SIGNATURE_MISMATCH",
  "message": "The uploaded content does not match the submitted media format.",
  "details": {
    "extension": "mp4",
    "declaredMimeType": "video/mp4",
    "detectedMimeType": "image/jpeg"
  }
}
```

Required error codes include:

```text
IDEMPOTENCY_KEY_REQUIRED
IDEMPOTENCY_KEY_INVALID
IDEMPOTENCY_KEY_REUSED
IDEMPOTENCY_REQUEST_IN_PROGRESS
POST_NOT_FOUND
POST_SOFT_DELETED
MEDIA_NOT_FOUND
MEDIA_RETRY_NOT_ALLOWED
MULTIPART_BODY_INVALID
UNEXPECTED_FILE_FIELD
FILE_COUNT_EXCEEDED
TOTAL_UPLOAD_SIZE_EXCEEDED
FILE_TRANSPORT_SIZE_EXCEEDED
EMPTY_FILE
INVALID_ORIGINAL_FILENAME
MISSING_EXTENSION
UNSUPPORTED_EXTENSION
UNSUPPORTED_MIME_TYPE
UNKNOWN_FILE_SIGNATURE
FILE_SIGNATURE_MISMATCH
CORRUPTED_FILE
ANIMATED_IMAGE_NOT_SUPPORTED
IMAGE_PIXEL_LIMIT_EXCEEDED
MEDIA_STREAM_NOT_FOUND
UNSUPPORTED_AUDIO_CODEC
UNSUPPORTED_VIDEO_CODEC
MEDIA_VALIDATION_TIMEOUT
FILE_SIZE_EXCEEDED
TEMPORARY_FILE_WRITE_FAILED
CHECKSUM_CALCULATION_FAILED
STORAGE_UNAVAILABLE
ORIGINAL_PROMOTION_FAILED
QUEUE_DISPATCH_DEAD
PROCESSING_TIMEOUT
PROCESSING_OUTPUT_INVALID
PROCESSING_CHECKSUM_MISMATCH
```

Never return local filesystem paths, secrets, Redis URLs, MinIO credentials, raw stack traces, or full FFprobe output.

## 10. Upload Staging and Validation

### 10.1 API request workspace

Root:

```text
/tmp/posts-media-api
```

For each request, create a private UUID-named directory and generated file names. Never use the client filename as a disk path.

Use restrictive permissions where supported:

```text
directory: 0700
file: 0600
```

Immediate cleanup happens in `finally` on success or failure. A stale-workspace cleanup service removes request directories older than 60 minutes.

### 10.2 Validation stages

For every file:

```text
1. transport limits
2. normalized display filename
3. extension allowlist
4. declared MIME allowlist/alias canonicalization
5. signature/container detection
6. Sharp or FFprobe parser validation
7. type-specific size limit
8. media safety limits
9. SHA-256 checksum
10. sanitized preliminary metadata
```

Treat browser MIME as untrusted. `application/octet-stream` may be accepted only when extension, signature, and parser validation all prove a supported format.

### 10.3 Signature specifics

At minimum validate these signatures/container families:

```text
JPEG: FF D8 FF
PNG:  89 50 4E 47 0D 0A 1A 0A
WebP: RIFF....WEBP
WAV:  RIFF....WAVE
OGG:  OggS
MP3:  ID3 or valid MPEG audio frame sync
AAC:  ADTS sync when raw AAC
MP4/MOV/M4A: ISO BMFF ftyp family + FFprobe stream/container check
WebM/MKV: EBML family + FFprobe container/doc/stream check
FLAC: fLaC
```

Signature detection is not sufficient alone. Images must decode in Sharp; audio/video must probe successfully with FFprobe.

### 10.4 Atomic create-post flow

```text
Multer writes all request files locally
-> hash/validate all
-> if any invalid: finalize deterministic 422 idempotency result, cleanup, stop
-> upload validated files to post-temporary
-> copy all to deterministic post-originals keys
-> PostgreSQL transaction:
     create Post
     create all Media
     create one ProcessingDispatch per Media
     finalize IdempotencyRequest
-> delete MinIO upload-stage objects
-> cleanup local workspace
-> return 201 stable response
```

If final original promotion or database commit fails, delete promoted originals as compensation and leave the idempotency request retryable only after compensation is safe.

### 10.5 Partial add-media flow

Validate every file independently. Persist only accepted files. The stable 201 response contains:

```json
{
  "postId": "uuid",
  "summary": { "submitted": 3, "accepted": 2, "rejected": 1 },
  "accepted": [],
  "rejected": []
}
```

If zero files are accepted, return 422.

## 11. HTTP Idempotency Detailed Rules

Implement an `IdempotencyService` around the three mutation use cases.

Canonical fingerprint uses deterministic JSON serialization (`fast-json-stable-stringify`) plus SHA-256.

A complete file hash must be available before multipart request fingerprint finalization.

State rules:

```text
new key -> create IN_PROGRESS lease
same key, same fingerprint, FINALIZED -> replay status/body
same key, different fingerprint -> 409
same key, active IN_PROGRESS -> 409 + Retry-After
expired IN_PROGRESS lease -> same request may reacquire
infrastructure failure after safe compensation -> RETRYABLE_FAILURE
same request may reacquire RETRYABLE_FAILURE
24h expiry -> cleanup marks/removes old finalized rows safely
```

Finalized deterministic validation responses are replayable. Transport failures that occur before a reliable fingerprint is available do not consume the key.

## 12. Outbox and Queue Dispatch

### 12.1 Dispatch creation

Each Media generation creates exactly one dispatch row.

Queue mapping:

```text
IMAGE -> image-processing / process-image
AUDIO -> audio-processing / process-audio
VIDEO -> video-processing / process-video
```

### 12.2 Claiming

Use a short PostgreSQL transaction with `FOR UPDATE SKIP LOCKED`, implemented in a focused repository using Prisma `$queryRaw`/`$executeRaw` with parameterized values.

Never keep row locks while calling Redis.

### 12.3 Publication

Use deterministic BullMQ job IDs and stable payload version 1.

On Redis transient failure:

```text
PUBLISHING -> RETRY_WAIT
nextAttemptAt = exponential backoff + jitter, capped at 60 seconds
```

On unsupported payload/job mapping:

```text
PUBLISHING -> DEAD
```

### 12.4 Outbox cleanup

Delete only `PUBLISHED` rows older than 7 days. Never age-delete unpublished rows.

## 13. Worker Claim and Attempt Lifecycle

Before expensive work, atomically claim a media generation.

Claim conditions:

```text
media.id matches
media.processingGeneration matches job generation
media is not COMPLETED
no other unexpired lease owns this generation
```

On claim:

```text
processingStatus = PROCESSING
currentStep = CLAIMING
processingLeaseToken = random UUID
processingLeaseExpiresAt = now + 60 seconds
activeJobId = deterministic job id
processingStartedAt = now if empty
```

Renew the lease every 20 seconds while processing.

Create a ProcessingAttempt record using `job.attemptsMade + 1`.

On successful completion:

```text
Media -> COMPLETED
progress -> 100
currentStep -> COMPLETED
clear lease
clear activeJobId
set processingCompletedAt
ProcessingAttempt -> COMPLETED
```

On non-final BullMQ failure:

```text
Media -> PENDING
progress -> 0
currentStep -> PENDING
record sanitized last error
clear lease
ProcessingAttempt -> FAILED or INTERRUPTED
throw so BullMQ retries same generation
```

On final BullMQ attempt failure:

```text
Media -> FAILED
currentStep -> FAILED
clear lease
ProcessingAttempt -> FAILED
```

Manual retry is allowed only from `FAILED`. It increments generation and transactionally creates a new outbox dispatch.

## 14. Worker Local Workspace

Root:

```text
/tmp/posts-media-worker
```

Per attempt:

```text
/tmp/posts-media-worker/{mediaId}/{generation}/{attemptId}/
```

The worker downloads the original from MinIO, rechecks exact byte size and SHA-256, then processes.

On checksum mismatch:

```text
fail the attempt with PROCESSING_CHECKSUM_MISMATCH
never produce variants
```

Cleanup local attempt workspace in `finally`.

FFmpeg/FFprobe child processes must be tracked. On timeout or shutdown:

```text
SIGTERM
wait 5 seconds
SIGKILL if still alive
```

## 15. Variant Publication

Processors generate files locally first. Validate each output before publication.

Upload to attempt-scoped temporary MinIO keys:

```text
processing/{mediaId}/{generation}/{attemptId}/...
```

After all required outputs are valid:

```text
copy each to final post-processed key
stat each final object
transactionally upsert all MediaVariant rows and finalize Media
remove attempt-scoped temporary objects
```

A required-output failure makes the attempt fail. Do not expose partial variants.

Final variant uniqueness:

```text
mediaId + processingProfile + variantType
```

## 16. Image Processor

Input: JPEG/PNG/WebP.

Processing:

```text
Sharp decode with input pixel limit
reject animated/multi-frame
rotate() to apply orientation
convert to sRGB
optimized WebP max 1920x1920, fit inside, withoutEnlargement, quality 82
thumbnail WebP max 400x400, fit inside, withoutEnlargement, quality 75
```

Store original and variant dimensions, format, color metadata needed for debugging, sizes, checksums, and compression ratio.

Required output types:

```text
OPTIMIZED_IMAGE
IMAGE_THUMBNAIL
```

## 17. Audio Processor

Use FFprobe to select the first valid audio stream.

Processing:

```text
input -> libmp3lame 192k
-vn
mono stays mono
stereo stays stereo
>2 channels downmix to stereo
sample rate preserved up to 48 kHz; higher rates output at 48 kHz
-map_metadata -1 for processed output
```

Store sanitized source tags only for `title`, `artist`, `album`, and `date`, each length-limited.

Required output type:

```text
NORMALIZED_AUDIO
```

## 18. Video Processor

Use FFprobe to determine display dimensions after rotation, duration, frame rate, codecs, stream layout, and audio presence.

Rendition planning:

```text
source >= 1080p -> 360p + 720p + 1080p
source >= 720p and <1080p -> 360p + 720p
source >= 360p and <720p -> 360p
source < 360p -> one VIDEO_SOURCE normalized rendition at source display size
```

Do not upscale. Preserve aspect ratio. Round dimensions to even values.

Video command policy:

```text
libx264
CRF 23
preset veryfast
yuv420p
-movflags +faststart
fps min(source, 30)
AAC 128k only when source has audio
```

Generate one JPEG thumbnail near 10% of duration, with safe fallback for short/undecodable frames. Max landscape bounds 1280x720, no upscale.

Required output types as applicable:

```text
VIDEO_360P
VIDEO_720P
VIDEO_1080P
VIDEO_SOURCE
VIDEO_THUMBNAIL
```

## 19. Worker Heartbeat and Diagnostics

Worker heartbeat defaults:

```text
interval: 10 seconds
stale after: 30 seconds
```

Worker status:

```text
STARTING
READY
DEGRADED
SHUTTING_DOWN
STOPPED
```

If Redis is down but PostgreSQL and MinIO are available, keep the process alive as `DEGRADED`. Do not mark media failed merely because queue publication is unavailable.

Diagnostics exposed through the API read durable database state and latest worker heartbeat.

## 20. API Read Models and Presentation

Never return Prisma models directly. Use presenters/response DTOs so `BigInt` values are serialized as decimal strings.

Post response includes:

```text
id
title
content
createdAt
updatedAt
deletedAt
aggregateStatus
mediaCount
media[] summary
links
```

Media response includes:

```text
id
postId
sortOrder
mediaType
originalFilename
detectedMimeType
originalSize as string
checksumSha256
processingProfile
processingGeneration
processingStatus
progress
currentStep
sanitized metadata
variants metadata without permanent URL
lastError
links: self/status/access/retry
```

## 21. Static Testing UI

One-page dashboard with these sections:

### 21.1 System status

Show:

```text
API ready/not ready
PostgreSQL
MinIO
worker heartbeat
worker Redis connectivity
outbox pending/retry/dead counts
active job count
```

### 21.2 Create Post

Fields:

```text
title
content
multiple mixed media files
drag/drop
selected-file table
client-side type/size hints
upload progress
idempotency key display
```

Allow create with no files or with initial files.

### 21.3 Posts browser

Controls:

```text
search
media type
processing status
created date range
include deleted
sort
page size
pagination
```

Actions:

```text
view
edit title/content
soft delete
restore
```

### 21.4 Post detail

Show all media cards. Provide `Add More Media` with partial-success result panel.

### 21.5 Media card

Show:

```text
original filename
media type
status/progress/current step
generation
size
metadata
last error
dispatch status
latest attempt
variant list
fresh preview/download buttons
retry button only when FAILED
```

Render images with `<img>`, audio with `<audio controls>`, and videos with `<video controls>` after obtaining fresh presigned URLs.

### 21.6 Debug panel

Show formatted JSON for the last API response and request ID. Escape all text via DOM APIs; never inject untrusted strings with `innerHTML`.

### 21.7 Polling

Poll active media every 2 seconds. Stop polling a media item after `COMPLETED` or `FAILED`. Refresh diagnostics every 5 seconds while the dashboard is visible.

Use `XMLHttpRequest` for multipart upload progress; use `fetch` for normal JSON operations.

## 22. Security and Robustness Rules

- Validate environment variables at startup; fail fast on malformed required values.
- Use Helmet for HTTP security headers even though the app is local.
- Do not enable permissive CORS; UI is same-origin.
- Use a request ID middleware. Accept a valid incoming `X-Request-Id` or generate UUID; return it on responses.
- Normalize client filenames for display only; never use them as disk or object paths.
- Prevent traversal by generating all local paths/object keys from UUIDs and controlled constants.
- Cleanup helpers must verify the target path resolves under the configured temp root and must not follow arbitrary symlinks.
- Limit child-process runtime and output capture. Parse FFprobe JSON with an output-size cap.
- Never use shell interpolation for FFmpeg arguments. Call `spawn(binary, argsArray, { shell: false })`.
- Store sanitized/truncated external error messages; keep detailed internal stack traces only in structured server logs.
- Buckets are private. No public-read policy.
- Use health/readiness checks before accepting traffic in Compose.
- Use Docker `dumb-init` or equivalent init behavior for signal forwarding.
- Use named volumes for PostgreSQL, Redis, MinIO, API temp, worker temp.

## 23. Docker Compose Design

Services:

```text
postgres
redis
minio
minio-init
migrate
api
worker
```

Host bindings:

```text
127.0.0.1:3000 -> api:3000
127.0.0.1:9000 -> minio:9000
127.0.0.1:9001 -> minio:9001
```

Do not publish PostgreSQL/Redis host ports in normal `docker-compose.yml`.

API and worker share source image build stages but can have separate final targets. Both need FFprobe; worker needs full FFmpeg runtime. Installing the Debian `ffmpeg` package in both is acceptable; the API must only invoke FFprobe.

One-shot `migrate` service runs `prisma migrate deploy` after PostgreSQL is healthy. `minio-init` creates all three private buckets idempotently.

## 24. Environment Contract

`.env.example` must define at least:

```dotenv
NODE_ENV=development
PORT=3000
API_PREFIX=api
LOG_LEVEL=debug

DATABASE_URL=postgresql://posts:posts@postgres:5432/posts_media

REDIS_HOST=redis
REDIS_PORT=6379

MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_ORIGINALS_BUCKET=post-originals
MINIO_PROCESSED_BUCKET=post-processed
MINIO_TEMP_BUCKET=post-temporary
MINIO_PRESIGNED_URL_TTL_SECONDS=900

UPLOAD_TEMP_ROOT=/tmp/posts-media-api
UPLOAD_TEMP_MAX_AGE_MINUTES=60
MAX_FILES_PER_REQUEST=10
MAX_TOTAL_UPLOAD_SIZE_MB=500
MAX_IMAGE_SIZE_MB=10
MAX_AUDIO_SIZE_MB=50
MAX_VIDEO_SIZE_MB=250
MAX_IMAGE_PIXELS=40000000
MAX_AUDIO_DURATION_SECONDS=7200
MAX_VIDEO_DURATION_SECONDS=1800
MAX_VIDEO_WIDTH=7680
MAX_VIDEO_HEIGHT=4320
MAX_MEDIA_STREAMS=10
MEDIA_PROBE_TIMEOUT_MS=10000

IDEMPOTENCY_TTL_HOURS=24
IDEMPOTENCY_LEASE_SECONDS=900

OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_BATCH_SIZE=25
OUTBOX_PUBLISH_CONCURRENCY=5
OUTBOX_LEASE_SECONDS=30
OUTBOX_MAX_RETRY_DELAY_SECONDS=60
OUTBOX_PUBLISHED_RETENTION_DAYS=7

IMAGE_WORKER_CONCURRENCY=4
AUDIO_WORKER_CONCURRENCY=2
VIDEO_WORKER_CONCURRENCY=1
MEDIA_JOB_ATTEMPTS=3
MEDIA_JOB_BACKOFF_MS=5000
PROCESSING_LEASE_SECONDS=60
PROCESSING_LEASE_RENEW_SECONDS=20

WORKER_TEMP_ROOT=/tmp/posts-media-worker
WORKER_HEARTBEAT_INTERVAL_SECONDS=10
WORKER_HEARTBEAT_STALE_SECONDS=30

IMAGE_PROCESSING_TIMEOUT_MS=60000
AUDIO_PROCESSING_TIMEOUT_MS=600000
VIDEO_PROCESSING_TIMEOUT_MS=3600000
IMAGE_WEBP_QUALITY=82
IMAGE_MAX_WIDTH=1920
IMAGE_MAX_HEIGHT=1920
IMAGE_THUMBNAIL_SIZE=400
AUDIO_MP3_BITRATE_KBPS=192
AUDIO_MAX_SAMPLE_RATE=48000
VIDEO_MAX_FPS=30
VIDEO_H264_CRF=23
VIDEO_H264_PRESET=veryfast
VIDEO_AUDIO_BITRATE_KBPS=128
```

In real repositories, development secrets may differ from `.env.example`; do not commit non-example secrets.

## 25. Testing Strategy

### 25.1 Unit tests

Cover pure rules and isolated services:

```text
extension/MIME mapping
signature detection
filename normalization
checksum
post aggregate status
pagination parameter normalization
idempotency fingerprinting
idempotency state transitions
outbox backoff
queue mapping
job ID generation
video rendition planning
FFmpeg argument construction
metadata sanitization
object-key generation
error sanitization
```

### 25.2 Integration tests

Use real PostgreSQL, Redis, and MinIO through `docker-compose.test.yml` with isolated database/buckets.

Cover:

```text
Prisma constraints and transactions
SKIP LOCKED outbox claim
concurrent idempotency acquisition
MinIO put/copy/stat/remove/presign
BullMQ publish/consume
worker database claim leases
variant upsert uniqueness
heartbeat writes
```

### 25.3 E2E API tests

Cover:

```text
create post JSON
create post multipart with mixed valid media
atomic rejection when one initial file is invalid
add media partial success
same idempotency key replay
same key changed request -> 409
list pagination/filtering
get/update/delete/restore
media status
media access URLs
manual retry only after FAILED
Swagger endpoint available
```

### 25.4 Real processor tests

Use tiny deterministic fixtures, not large production files.

Image:

```text
JPEG/PNG/WebP
EXIF orientation
no upscale
thumbnail
metadata stripping
animated image rejection
corrupt image
```

Audio:

```text
WAV -> MP3
FLAC -> MP3
M4A -> MP3
mono
stereo
multichannel downmix
96kHz -> <=48kHz
truncated input
```

Video:

```text
1080p -> 360/720/1080
720p -> 360/720
480p -> 360
sub-360 -> VIDEO_SOURCE
portrait
rotation
60fps -> <=30fps
with audio
without audio
fast-start verification
thumbnail
```

### 25.5 Failure/recovery tests

```text
Redis down during upload: API commits; outbox stays pending/retry
Redis returns: dispatcher publishes
publisher crash after Queue.add but before DB finalization: deterministic re-publication safe
worker duplicate job: one processing claim
worker stale generation: no-op
worker lease expires: recoverable
FFmpeg timeout: child killed, attempt retryable/final failure depending attempt number
MinIO upload failure: no COMPLETED state
DB finalization failure: no partial published variant state
same request replay after response loss: original mutation response replayed
```

For byte-limit tests, lower configured limits in the test environment instead of generating 250 MiB fixtures.

## 26. Acceptance Criteria

The project is accepted only when all are true:

- `docker compose up --build` starts PostgreSQL, Redis, MinIO, migrations, API, and worker successfully.
- `http://127.0.0.1:3000/` shows the static test dashboard.
- `http://127.0.0.1:3000/api/docs` exposes complete Swagger docs.
- A post can be created with no media.
- A post can be created with mixed image/audio/video media.
- Invalid initial media makes the entire create-with-media request fail without a Post.
- Add-media supports partial success.
- Originals appear only in the private originals bucket after validation.
- Images produce optimized WebP + thumbnail.
- Audio produces normalized MP3 and stored metadata/duration.
- Videos produce only applicable 360p/720p/1080p/source variants plus thumbnail.
- No processor upscales source media.
- Media transitions through `PENDING` -> `PROCESSING` -> `COMPLETED` or `FAILED`.
- Failed media can be manually retried and receives a new generation.
- Repeated HTTP mutations with the same idempotency key do not create duplicates.
- Repeated BullMQ jobs do not process a completed/current generation twice.
- Redis can be stopped during upload without losing the dispatch request.
- Soft-delete and restore work.
- Pagination/filtering work.
- Presigned URLs are short-lived and buckets remain private.
- Unit, integration, E2E, and processor tests pass.
- Lint, format check, type/build, Prisma validation, and smoke test pass.
- README contains exact setup, run, test, debugging, and architecture instructions.

---

# Part II - Executable Implementation Plan

## File Map Before Implementation

The implementation must preserve these responsibility boundaries:

```text
apps/api: HTTP transport and static UI only
apps/worker: outbox loop, queue consumers, worker lifecycle only
libs/posts: post use cases and queries
libs/media: media use cases and upload validation orchestration
libs/storage: MinIO port + adapter only
libs/queues: BullMQ contracts + queue publisher only
libs/media-processing: Sharp/FFmpeg/FFprobe processing services only
libs/database: Prisma service and infrastructure repositories
libs/domain: framework-independent enums/errors/value objects
libs/observability: logging/correlation/sanitization
libs/testing: reusable factories/helpers only
```

### Task 1: Scaffold the NestJS Monorepo and Quality Tooling

**Files:**
- Create/modify: `package.json`, `package-lock.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`, ESLint/Prettier config.
- Create: `apps/api/src/main.ts`, `apps/api/src/api.module.ts`, `apps/worker/src/main.ts`, `apps/worker/src/worker.module.ts`.
- Create library barrels under `libs/*/src/index.ts`.

**Interfaces:**
- Produces buildable `api` and `worker` Nest projects plus path aliases used by all later tasks.

- [ ] **Step 1: Scaffold a NestJS 11 monorepo with API and worker projects plus the shared libraries listed in the repository structure.**

Use the Nest CLI monorepo layout and keep the generated module system unless a dependency requires an explicit NodeNext adjustment.

- [ ] **Step 2: Add exact scripts.**

```json
{
  "scripts": {
    "build": "npm run build:api && npm run build:worker",
    "build:api": "nest build api",
    "build:worker": "nest build worker",
    "start:dev:api": "nest start api --watch",
    "start:dev:worker": "nest start worker --watch",
    "start:prod:api": "node dist/apps/api/main.js",
    "start:prod:worker": "node dist/apps/worker/main.js",
    "prisma:generate": "prisma generate",
    "prisma:validate": "prisma validate",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "lint": "eslint \"{apps,libs,prisma,scripts}/**/*.{ts,mts,js,mjs}\"",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "jest",
    "test:unit": "jest --selectProjects unit",
    "test:integration": "jest --selectProjects integration --runInBand",
    "test:e2e": "jest --selectProjects e2e --runInBand",
    "test:worker": "jest --selectProjects worker --runInBand",
    "smoke": "node scripts/smoke-test.mjs"
  }
}
```

- [ ] **Step 3: Configure TypeScript strictness and path aliases.**

At minimum enable:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Add a trivial unit test that imports one value from each shared-library public barrel. Run it and fix path/build configuration until it passes.**

Run:

```bash
npm run build
npm run test:unit -- --runTestsByPath libs/domain/src/index.spec.ts
```

Expected: both Nest applications compile and the alias smoke test passes.

- [ ] **Step 5: Commit.**

```bash
git add .
git commit -m "chore: scaffold posts media monorepo"
```

### Task 2: Environment Validation and Docker Infrastructure

**Files:**
- Create: `libs/configuration/src/*`, `.env.example`, `docker-compose.yml`, `docker-compose.test.yml`, `docker/api/Dockerfile`, `docker/worker/Dockerfile`, `docker/minio/initialize.sh`, `scripts/verify-runtime-tools.sh`.

**Interfaces:**
- Produces typed configuration services consumed by API, worker, storage, queues, and processors.

- [ ] **Step 1: Write unit tests for environment parsing, including invalid numeric limits, missing MinIO credentials, and invalid concurrency. Verify they fail.**

- [ ] **Step 2: Implement `environment.schema.ts` using explicit parsing/validation. Reject non-positive sizes, invalid ports, retry counts <1, lease renew >= lease duration, and unsupported profile names.**

- [ ] **Step 3: Create Docker Compose services `postgres`, `redis`, `minio`, `minio-init`, `migrate`, `api`, and `worker`.**

Use host bindings only for API and MinIO:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

and equivalent `9000`/`9001` bindings for MinIO. Do not publish Postgres/Redis ports in normal Compose.

- [ ] **Step 4: Create multi-stage API/worker Dockerfiles from Node 24 LTS. Install `ffmpeg`, `ca-certificates`, and `dumb-init`. API may have the ffmpeg package installed but must only execute FFprobe.**

- [ ] **Step 5: Make `minio-init` create the three private buckets idempotently. Make `migrate` run `npm run prisma:migrate:deploy`.**

- [ ] **Step 6: Run configuration tests and validate Compose.**

```bash
npm run test:unit -- --runTestsByPath libs/configuration/src/environment.schema.spec.ts
docker compose config
```

Expected: PASS and valid Compose configuration.

- [ ] **Step 7: Commit.**

```bash
git add .
git commit -m "chore: add local infrastructure and configuration"
```

### Task 3: Prisma Schema, Migration, and Database Module

**Files:**
- Create: `prisma/schema.prisma`, initial migration, `libs/database/src/prisma.service.ts`, `libs/database/src/database.module.ts`, transaction helpers.
- Test: `libs/database/src/database.integration.spec.ts`.

**Interfaces:**
- Produces Prisma models and `PrismaService` for later repositories.

- [ ] **Step 1: Write an integration test asserting unique constraints for `Media(postId, sortOrder)`, `MediaVariant(mediaId, processingProfile, variantType)`, `ProcessingDispatch(mediaId, generation)`, dispatch `jobId`, and idempotency `key`. Verify it fails before schema creation.**

- [ ] **Step 2: Implement the Prisma schema from Part I and generate the first migration.**

Run:

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:dev -- --name init_posts_media
```

- [ ] **Step 3: Implement `PrismaService` with clean Nest lifecycle connect/disconnect behavior and a transaction helper that accepts a callback using the Prisma transaction client.**

- [ ] **Step 4: Run the database integration tests against the test PostgreSQL service.**

Expected: all constraints and rollback behavior pass.

- [ ] **Step 5: Commit.**

```bash
git add prisma libs/database
git commit -m "feat: add posts media persistence model"
```

### Task 4: Domain Enums, Errors, Result Types, and Presentation Contracts

**Files:**
- Create: `libs/domain/src/enums/*`, `libs/domain/src/errors/*`, `libs/domain/src/models/*`, `apps/api/src/http/presenters/*`.

**Interfaces:**
- Produces `MediaType`, `ProcessingStatus`, `ProcessingStep`, `MediaVariantType`, stable error codes, and response DTO contracts.

- [ ] **Step 1: Write unit tests for post aggregate status and error serialization.**

Cases: no media, all pending, any processing, all complete, all failed, mixed terminal/pending.

- [ ] **Step 2: Implement framework-independent enums/errors and `calculatePostAggregateStatus(statuses)`.**

Signature:

```ts
export function calculatePostAggregateStatus(
  statuses: readonly ProcessingStatus[],
): PostAggregateStatus;
```

- [ ] **Step 3: Implement API presenters that convert BigInt to strings and never leak Prisma records or MinIO credentials.**

- [ ] **Step 4: Run unit tests and commit.**

```bash
npm run test:unit -- --runTestsByPath libs/domain/src/models/post-aggregate-status.spec.ts
git add libs/domain apps/api/src/http/presenters
git commit -m "feat: define posts media domain contracts"
```

### Task 5: MinIO Storage Port and Adapter

**Files:**
- Create: `libs/storage/src/ports/object-storage.port.ts`, `libs/storage/src/minio/minio-object-storage.adapter.ts`, `libs/storage/src/object-key.service.ts`, `libs/storage/src/storage.module.ts`.
- Test: unit object-key tests and MinIO integration tests.

**Interfaces:**
- Produces `ObjectStoragePort` exactly as defined in Part I.

- [ ] **Step 1: Write object-key tests proving user filenames cannot influence paths and keys are deterministic from controlled IDs/profile/variant type.**

- [ ] **Step 2: Implement `ObjectKeyService` for upload staging, originals, processing temp, and final variants.**

- [ ] **Step 3: Write failing MinIO integration tests for put, stat, copy, download, presign, remove, and missing-object behavior.**

- [ ] **Step 4: Implement `MinioObjectStorageAdapter` using streams/files without loading large objects into memory.**

- [ ] **Step 5: Ensure startup checks verify all three buckets exist and are private.**

- [ ] **Step 6: Run integration tests and commit.**

```bash
npm run test:integration -- --runTestsByPath libs/storage/src/minio/minio-object-storage.integration.spec.ts
git add libs/storage
git commit -m "feat: add private minio object storage"
```

### Task 6: Request IDs, Global Errors, Multer Disk Staging, and Workspace Cleanup

**Files:**
- Create: `apps/api/src/http/middleware/request-id.middleware.ts`, `apps/api/src/http/filters/api-exception.filter.ts`, `apps/api/src/upload/multer.config.ts`, `request-workspace.service.ts`, `upload-cleanup.service.ts`.

**Interfaces:**
- Produces request-scoped temp file paths plus standard `requestId` error responses.

- [ ] **Step 1: Write tests that assert `X-Request-Id` is returned, unsafe incoming IDs are replaced, and API errors never include local paths.**

- [ ] **Step 2: Implement request ID middleware using UUID generation and a strict length/character policy for accepted incoming IDs.**

- [ ] **Step 3: Implement Multer disk storage using generated names under a request-specific directory. Configure file count, file size, field count, and part count limits.**

- [ ] **Step 4: Implement safe cleanup with path containment checks and stale-workspace cleanup older than 60 minutes.**

- [ ] **Step 5: Add global exception mapping for Multer limit errors into stable API codes.**

- [ ] **Step 6: Run unit/E2E staging tests and commit.**

### Task 7: File Validation Pipeline

**Files:**
- Create: `libs/media/src/validation/*` exactly as mapped in Part I.
- Test: detailed unit tests plus tiny real-media validation integration tests.

**Interfaces:**
- Produces `ValidatedUpload[]` and `FileValidationError[]`.

- [ ] **Step 1: Write table-driven unit tests for accepted extension/MIME aliases and all unsupported combinations.**

- [ ] **Step 2: Implement filename normalization, extension policy, MIME canonicalization, and safe error details.**

- [ ] **Step 3: Write signature tests for JPEG, PNG, WebP, WAV, MP3, AAC, FLAC, OGG, ISO BMFF, and EBML families.**

- [ ] **Step 4: Implement `SignatureDetectorService` using bounded header reads plus FFprobe refinement for ambiguous containers.**

- [ ] **Step 5: Write real parser tests: Sharp decode/animation/pixel limit and FFprobe stream/duration/codec/container limits.**

- [ ] **Step 6: Implement `ImageInspectorService`, `AvInspectorService`, and timeout-controlled FFprobe spawning with `shell: false`.**

- [ ] **Step 7: Implement streaming SHA-256 checksum calculation.**

- [ ] **Step 8: Implement `MediaValidationService.validateFiles(files)` that returns per-file outcomes without throwing away sibling outcomes. Create-post orchestration will decide atomic vs partial semantics.**

- [ ] **Step 9: Run all validation tests and commit.**

### Task 8: Post CRUD, Pagination, Filtering, and Soft Delete

**Files:**
- Create: `libs/posts/src/repositories/*`, `libs/posts/src/application/*`, `libs/posts/src/queries/*`, `apps/api/src/http/controllers/posts.controller.ts`, DTOs/presenters.

**Interfaces:**
- Produces JSON-only post creation first, list/get/update/delete/restore, and read models reused by media workflows.

- [ ] **Step 1: Write E2E tests for JSON create, list pagination, filters, update, soft delete exclusion, includeDeleted, and restore.**

- [ ] **Step 2: Implement repository queries with page normalization, pageSize max 100, case-insensitive search, relation filters for media type/status, date filters, and safe sort allowlist.**

- [ ] **Step 3: Implement post application services and controllers. `PATCH` modifies only title/content.**

- [ ] **Step 4: Compute aggregate status from included media statuses; do not store it.**

- [ ] **Step 5: Run E2E tests and commit.**

### Task 9: HTTP Idempotency Core

**Files:**
- Create: idempotency repository/service/fingerprint helpers under `libs/database` or a focused `libs/media/application/idempotency` package; API interceptor/decorator only for header extraction if useful.

**Interfaces:**
- Produces `executeIdempotent(operationContext, fingerprintInput, action)` semantics used by three mutations.

- [ ] **Step 1: Write unit tests for stable canonical fingerprints, changed body/file/order fingerprints, and key syntax.**

- [ ] **Step 2: Write PostgreSQL integration tests for first acquisition, finalized replay, key reuse conflict, active concurrent lease conflict, expired lease reacquisition, and retryable failure reacquisition.**

- [ ] **Step 3: Implement canonical deterministic serialization + SHA-256.**

- [ ] **Step 4: Implement transactional acquisition/finalization methods that never store presigned URLs.**

- [ ] **Step 5: Add cleanup for expired finalized idempotency rows.**

- [ ] **Step 6: Run tests and commit.**

### Task 10: Atomic Create Post With Initial Media

**Files:**
- Modify: post application service/controller.
- Create: media persistence repository and upload orchestration service.

**Interfaces:**
- Consumes: validation, storage, idempotency, Prisma.
- Produces: stable 201 response with Post/Media IDs and `PENDING` states plus ProcessingDispatch rows.

- [ ] **Step 1: Write E2E test: one valid image + one invalid fake video must return 422 and leave zero Post, Media, original objects, and dispatches.**

- [ ] **Step 2: Write E2E test: valid mixed image/audio/video creates one Post, three Media rows, three original objects, and three PENDING dispatch rows.**

- [ ] **Step 3: Implement `POST /api/posts` so the Multer interceptor is a no-op for JSON and handles repeated `media` fields for multipart.**

- [ ] **Step 4: Implement atomic orchestration exactly from Part I: validate all, stage MinIO, promote originals, transactionally create DB state/outbox/idempotency result, cleanup stage.**

- [ ] **Step 5: Add compensation tests for MinIO promotion failure and DB transaction failure.**

- [ ] **Step 6: Add same-key same-request replay test proving no duplicate objects/records.**

- [ ] **Step 7: Run E2E/integration tests and commit.**

### Task 11: Partial Add-Media Flow

**Files:**
- Create/modify: media application service, post media controller route/presenters.

**Interfaces:**
- Produces accepted/rejected arrays with one Media + dispatch per accepted file.

- [ ] **Step 1: Write E2E test with two valid files and one signature mismatch; expect 201 with accepted=2/rejected=1 and exactly two new Media/dispatch/original objects.**

- [ ] **Step 2: Write test where every file is invalid; expect 422 and no new Media.**

- [ ] **Step 3: Implement next `sortOrder` allocation inside a transaction. Lock or serialize the target Post row during allocation so concurrent add-media requests cannot collide.**

- [ ] **Step 4: Implement per-file storage compensation for accepted candidates that fail before transaction commit.**

- [ ] **Step 5: Apply HTTP idempotency to the whole batch response.**

- [ ] **Step 6: Run tests and commit.**

### Task 12: Transactional Outbox Dispatcher and BullMQ Queue Configuration

**Files:**
- Create: `libs/queues/src/*`, `apps/worker/src/outbox/*`.

**Interfaces:**
- Produces deterministic BullMQ jobs from durable ProcessingDispatch rows.

- [ ] **Step 1: Write unit tests for queue mapping, job IDs, queue options, exponential backoff, and DEAD classification.**

- [ ] **Step 2: Configure three BullMQ queues with attempts=3, exponential backoff=5000ms, bounded retention, and chosen concurrency in worker consumers.**

- [ ] **Step 3: Write PostgreSQL integration test with two concurrent claimers proving `FOR UPDATE SKIP LOCKED` yields disjoint dispatch sets.**

- [ ] **Step 4: Implement short claim transaction and lease ownership. Publish to Redis outside the transaction.**

- [ ] **Step 5: Implement transient Redis retry and PUBLISHED/DEAD finalization guarded by lease token.**

- [ ] **Step 6: Write Redis integration test for publish success and deterministic duplicate publication.**

- [ ] **Step 7: Simulate Redis unavailability, verify dispatch remains retryable, restore Redis, and verify publication.**

- [ ] **Step 8: Implement published-row cleanup and non-overlapping poll loop.**

- [ ] **Step 9: Run tests and commit.**

### Task 13: Worker Processing Claim, Lease Renewal, Attempts, and Workspace

**Files:**
- Create: worker claim repository/service, processing workspace service, graceful shutdown service, shared processor orchestration base/helper.

**Interfaces:**
- Produces a lease-protected execution context used by image/audio/video consumers.

- [ ] **Step 1: Write database integration tests for one successful claim, duplicate active claim rejection, expired lease recovery, stale generation no-op, and completed generation no-op.**

- [ ] **Step 2: Implement atomic claim and lease renewal every 20 seconds.**

- [ ] **Step 3: Implement `ProcessingAttempt` creation/finalization and non-final vs final failure media-state transitions.**

- [ ] **Step 4: Implement worker local workspace create/containment/cleanup and stale-workspace cleanup.**

- [ ] **Step 5: Implement original MinIO download plus size/SHA-256 verification before processing.**

- [ ] **Step 6: Implement graceful child-process tracking and SIGTERM/SIGKILL behavior.**

- [ ] **Step 7: Run worker integration tests and commit.**

### Task 14: Image Processing and Variant Publication

**Files:**
- Create: `libs/media-processing/src/image/image-processor.service.ts`, variant publication service/tests.

**Interfaces:**
- Produces `OPTIMIZED_IMAGE` and `IMAGE_THUMBNAIL` artifacts plus metadata.

- [ ] **Step 1: Write real fixture tests for resize, portrait, EXIF rotation, no-upscale, thumbnail, alpha preservation, metadata stripping, corrupt input failure.**

- [ ] **Step 2: Implement Sharp pipeline with pixel limit, `.rotate()`, sRGB, max 1920x1920 WebP q82, thumbnail max 400 q75.**

- [ ] **Step 3: Implement output SHA-256 and metadata extraction.**

- [ ] **Step 4: Implement atomic variant publication to MinIO temp -> final objects -> DB upsert/finalize.**

- [ ] **Step 5: Wire `image.consumer.ts` through the shared worker claim/orchestration.**

- [ ] **Step 6: Run image processor tests and commit.**

### Task 15: Audio Processing

**Files:**
- Create: FFprobe/FFmpeg services and command builder as needed, `audio-processor.service.ts`, `audio.consumer.ts`.

**Interfaces:**
- Produces `NORMALIZED_AUDIO` MP3 and sanitized metadata/duration.

- [ ] **Step 1: Write fixtures/tests for WAV, FLAC, M4A, mono, stereo, multichannel, 96kHz, truncated input.**

- [ ] **Step 2: Implement FFprobe service with timeout, JSON output cap, `shell:false`, and sanitized parsed result.**

- [ ] **Step 3: Implement FFmpeg service with tracked process, timeout, progress callback, and safe args arrays.**

- [ ] **Step 4: Implement audio command planning: libmp3lame 192k, no video/artwork, channel policy, sample-rate cap, metadata stripped from output.**

- [ ] **Step 5: Probe generated MP3 before publication; reject invalid output.**

- [ ] **Step 6: Wire audio consumer and progress updates.**

- [ ] **Step 7: Run tests and commit.**

### Task 16: Video Rendition Planning, Transcoding, and Thumbnail

**Files:**
- Create: `video-rendition-planner.ts`, `video-processor.service.ts`, `video.consumer.ts`, command builder tests.

**Interfaces:**
- Produces applicable video variant set plus `VIDEO_THUMBNAIL`.

- [ ] **Step 1: Write pure rendition-planner tests for landscape/portrait 1080p, 720p, 480p, and sub-360 sources.**

- [ ] **Step 2: Implement planner with no-upscale, aspect preservation, even dimensions, rotation-adjusted display size.**

- [ ] **Step 3: Write command-builder tests for H.264/AAC, CRF 23, veryfast, yuv420p, max 30fps, fast-start, audio/no-audio behavior, and per-rendition VBV limits.**

- [ ] **Step 4: Implement thumbnail timestamp selection near 10% with safe fallback.**

- [ ] **Step 5: Implement sequential rendition generation for one job to control CPU/memory. Parse FFmpeg progress and map it into the media progress range.**

- [ ] **Step 6: Probe every generated MP4 to verify codec/container/dimensions/FPS before publication.**

- [ ] **Step 7: Write real tiny-video tests for every resolution case, portrait, rotation, 60fps, audio/no-audio, thumbnail, and fast-start.**

- [ ] **Step 8: Wire video consumer and run tests. Commit.**

### Task 17: Media Read/Status/Access and Manual Retry

**Files:**
- Create/modify: media controller, DTOs, read queries, retry use case.

**Interfaces:**
- Produces `/media/:id`, `/status`, `/access`, and idempotent `/retry`.

- [ ] **Step 1: Write E2E tests for media details/status, access URLs, retry rejection while PENDING/PROCESSING/COMPLETED, and successful retry from FAILED.**

- [ ] **Step 2: Implement access endpoint that generates fresh 900-second presigned URLs for original and current variants.**

- [ ] **Step 3: Implement retry transaction: verify FAILED, increment generation, reset status/progress/currentStep/error/completion fields, create new ProcessingDispatch, finalize idempotency response.**

- [ ] **Step 4: Verify automatic BullMQ retries do not increment generation.**

- [ ] **Step 5: Run tests and commit.**

### Task 18: Worker Heartbeat, API Health, and Diagnostics

**Files:**
- Create: worker heartbeat service, API system controller, diagnostics query service, Terminus health indicators.

**Interfaces:**
- Produces live/ready/diagnostics endpoints and durable worker status.

- [ ] **Step 1: Write unit/integration tests for heartbeat freshness and stale-worker classification.**

- [ ] **Step 2: Implement worker heartbeat every 10 seconds with Redis/storage/dispatcher/consumer/active-job fields.**

- [ ] **Step 3: Implement API liveness and readiness: readiness requires PostgreSQL + MinIO; it must not require Redis.**

- [ ] **Step 4: Implement diagnostics counts from ProcessingDispatch plus latest heartbeat.**

- [ ] **Step 5: Simulate Redis outage and verify API can stay READY while worker becomes DEGRADED.**

- [ ] **Step 6: Run tests and commit.**

### Task 19: Swagger and Static Testing UI

**Files:**
- Modify/create: Swagger bootstrap and all `apps/api/public/*` files.

**Interfaces:**
- Produces the human-testable dashboard and complete API documentation.

- [ ] **Step 1: Add Swagger schemas, multipart content declarations, idempotency header docs, pagination/filter query docs, error examples, and response DTOs for every endpoint.**

- [ ] **Step 2: Create semantic accessible HTML for system status, create form, post browser, post detail, media cards, add-media form, diagnostics, and JSON inspector.**

- [ ] **Step 3: Implement `api.js` fetch wrapper with request-ID display, JSON errors, and safe text rendering helpers.**

- [ ] **Step 4: Implement `uploads.js` with XHR upload progress and `crypto.randomUUID()` idempotency key generation/reuse for retrying the same submission.**

- [ ] **Step 5: Implement posts/media UI, filters, pagination, soft delete/restore, polling every 2 seconds for active media, diagnostics every 5 seconds.**

- [ ] **Step 6: Implement fresh access URL retrieval before setting `img/audio/video` sources.**

- [ ] **Step 7: Add a small E2E/static test that `/` serves HTML, `/css/styles.css` and JS modules are reachable, and `/api/docs-json` contains all required routes.**

- [ ] **Step 8: Manually verify keyboard navigation and that user-controlled strings are assigned with `textContent`, not `innerHTML`. Commit.**

### Task 20: Full Failure-Recovery and Idempotency Test Matrix

**Files:**
- Expand: `apps/api/test/e2e`, `apps/worker/test/integration`, `libs/testing`, `docker-compose.test.yml`.

**Interfaces:**
- Produces confidence that the architecture survives repeated requests, duplicate jobs, and temporary infrastructure loss.

- [x] **Step 1: Add response-loss replay test: commit succeeds, simulated client failure, repeat same idempotency request, assert one resource and replayed response.**

- [x] **Step 2: Add two concurrent same-key requests; assert one execution and one `IDEMPOTENCY_REQUEST_IN_PROGRESS`/replay outcome depending timing.**

- [x] **Step 3: Add outbox publish-after-Redis-recovery test.**

- [x] **Step 4: Add publish-success/database-finalize-failure simulation and prove deterministic job publication plus worker claim remains safe.**

- [x] **Step 5: Add duplicate worker delivery test and stale-generation test.**

- [x] **Step 6: Add processing timeout and interrupted child process test.**

- [x] **Step 7: Add MinIO failure before and during variant publication tests; assert no media is marked COMPLETED with missing required variants.**

- [x] **Step 8: Run entire automated suite repeatedly to detect race/flakiness.**

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:worker
```

- [x] **Step 9: Commit.**

### Task 21: README, Smoke Test, and Final Verification

**Files:**
- Create/finish: `README.md`, `scripts/create-test-media.mjs`, `scripts/smoke-test.mjs`, `.gitignore`.

**Interfaces:**
- Produces a reproducible submission a reviewer can run from a clean clone.

- [x] **Step 1: Document architecture, prerequisites, environment setup, Docker Compose startup, migration flow, endpoints, UI, Swagger, MinIO console, processing profile, queues, idempotency, outbox, troubleshooting, and test commands.**

- [x] **Step 2: Implement `create-test-media.mjs` to generate tiny valid fixtures using Sharp and FFmpeg plus controlled invalid signature/corruption fixtures.**

- [x] **Step 3: Implement `smoke-test.mjs` to create a post, upload tiny mixed media, poll each to terminal state, verify variants, exercise list/filter, soft-delete/restore, and repeat one idempotent request. Exit nonzero on any mismatch.**

- [x] **Step 4: Run static verification.**

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run lint
npm run format:check
npm run build
```

Expected: all exit 0.

- [x] **Step 5: Run clean infrastructure verification.**

```bash
docker compose down -v --remove-orphans
docker compose up --build -d
docker compose ps
```

Expected: required services become healthy/running and one-shot init/migrate services complete successfully.

- [x] **Step 6: Run all tests and smoke test.**

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:worker
npm run smoke
```

Expected: all pass.

- [x] **Step 7: Manually inspect:**

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/api/docs
http://127.0.0.1:9001/
```

Verify the dashboard can demonstrate every assignment feature.

- [x] **Step 8: Run a final source-requirement audit against the 16 source assignment requirements in Section 1. Record the mapping in README under `Assignment Requirement Coverage`.**

- [x] **Step 9: Commit final documentation and verification tooling.**

```bash
git add .
git commit -m "docs: complete posts media assignment verification"
```

## Final Verification Gate

Do not claim completion until the exact evidence below exists in the terminal output:

```text
prisma validate: success
lint: success
format check: success
api build: success
worker build: success
unit tests: pass
integration tests: pass
e2e tests: pass
worker/processor tests: pass
smoke test: pass
Docker Compose services: running/healthy
```

If any verification fails, fix the root cause and rerun the smallest failing command first, then rerun the full verification gate.

## Delivery Checklist

The final repository must contain:

```text
working NestJS monorepo
API app
worker app
PostgreSQL/Prisma schema + migrations
MinIO storage abstraction
Redis/BullMQ queues
transactional outbox
HTTP idempotency
worker idempotency/leases
image/audio/video processing
processing status/retry endpoints
post CRUD/pagination/filter/soft delete
Swagger
static test dashboard
Docker Compose
unit tests
integration tests
E2E tests
real processor tests
failure/recovery tests
README
smoke test
.env.example
```

No placeholders, dead routes, fake processor results, skipped core tests, or mocked media processing are acceptable in the final submission.
