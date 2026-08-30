-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProcessingStep" AS ENUM ('PENDING', 'CLAIMING', 'DOWNLOADING', 'VERIFYING', 'PROBING', 'PLANNING', 'PROCESSING', 'UPLOADING', 'FINALIZING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaVariantType" AS ENUM ('OPTIMIZED_IMAGE', 'IMAGE_THUMBNAIL', 'NORMALIZED_AUDIO', 'VIDEO_360P', 'VIDEO_720P', 'VIDEO_1080P', 'VIDEO_SOURCE', 'VIDEO_THUMBNAIL');

-- CreateEnum
CREATE TYPE "ProcessingAttemptStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'PUBLISHING', 'RETRY_WAIT', 'PUBLISHED', 'DEAD');

-- CreateEnum
CREATE TYPE "DispatchReason" AS ENUM ('INITIAL_UPLOAD', 'MANUAL_RETRY');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'FINALIZED', 'RETRYABLE_FAILURE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IdempotencyOperation" AS ENUM ('CREATE_POST', 'ADD_POST_MEDIA', 'RETRY_MEDIA');

-- CreateEnum
CREATE TYPE "WorkerInstanceStatus" AS ENUM ('STARTING', 'READY', 'DEGRADED', 'SHUTTING_DOWN', 'STOPPED');

-- CreateTable
CREATE TABLE "Post" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "originalExtension" VARCHAR(16) NOT NULL,
    "declaredMimeType" VARCHAR(100) NOT NULL,
    "detectedMimeType" VARCHAR(100) NOT NULL,
    "detectedFormat" VARCHAR(32) NOT NULL,
    "originalBucket" VARCHAR(63) NOT NULL,
    "originalObjectKey" VARCHAR(1024) NOT NULL,
    "originalSize" BIGINT NOT NULL,
    "checksumSha256" CHAR(64) NOT NULL,
    "processingProfile" VARCHAR(64) NOT NULL DEFAULT 'balanced-v1',
    "processingGeneration" INTEGER NOT NULL DEFAULT 1,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" "ProcessingStep" NOT NULL DEFAULT 'PENDING',
    "processingStartedAt" TIMESTAMP(3),
    "processingCompletedAt" TIMESTAMP(3),
    "processingLeaseToken" UUID,
    "processingLeaseExpiresAt" TIMESTAMP(3),
    "activeJobId" VARCHAR(200),
    "lastErrorCode" VARCHAR(64),
    "lastErrorMessage" VARCHAR(1000),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaVariant" (
    "id" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "processingProfile" VARCHAR(64) NOT NULL,
    "variantType" "MediaVariantType" NOT NULL,
    "bucket" VARCHAR(63) NOT NULL,
    "objectKey" VARCHAR(1024) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "format" VARCHAR(32) NOT NULL,
    "size" BIGINT NOT NULL,
    "checksumSha256" CHAR(64) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bitrateKbps" INTEGER,
    "resolutionLabel" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingAttempt" (
    "id" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "bullAttemptNumber" INTEGER NOT NULL,
    "jobId" VARCHAR(200) NOT NULL,
    "processingProfile" VARCHAR(64) NOT NULL,
    "status" "ProcessingAttemptStatus" NOT NULL,
    "workerInstanceId" VARCHAR(200),
    "errorCode" VARCHAR(64),
    "errorMessage" VARCHAR(1000),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "ProcessingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingDispatch" (
    "id" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "reason" "DispatchReason" NOT NULL,
    "queueName" VARCHAR(100) NOT NULL,
    "jobName" VARCHAR(100) NOT NULL,
    "jobId" VARCHAR(200) NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "publishAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(64),
    "lastErrorMessage" VARCHAR(1000),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRequest" (
    "id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "operation" "IdempotencyOperation" NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "routeTemplate" VARCHAR(200) NOT NULL,
    "targetResourceId" UUID,
    "requestFingerprint" CHAR(64),
    "state" "IdempotencyState" NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "resourceIds" JSONB,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerInstance" (
    "id" VARCHAR(200) NOT NULL,
    "instanceName" VARCHAR(200) NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "status" "WorkerInstanceStatus" NOT NULL,
    "redisConnected" BOOLEAN NOT NULL DEFAULT false,
    "storageConnected" BOOLEAN NOT NULL DEFAULT false,
    "dispatcherActive" BOOLEAN NOT NULL DEFAULT false,
    "consumersActive" BOOLEAN NOT NULL DEFAULT false,
    "activeJobCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shutdownAt" TIMESTAMP(3),

    CONSTRAINT "WorkerInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "Post_deletedAt_idx" ON "Post"("deletedAt");

-- CreateIndex
CREATE INDEX "Media_postId_processingStatus_idx" ON "Media"("postId", "processingStatus");

-- CreateIndex
CREATE INDEX "Media_processingStatus_idx" ON "Media"("processingStatus");

-- CreateIndex
CREATE INDEX "Media_mediaType_idx" ON "Media"("mediaType");

-- CreateIndex
CREATE UNIQUE INDEX "Media_postId_sortOrder_key" ON "Media"("postId", "sortOrder");

-- CreateIndex
CREATE INDEX "MediaVariant_mediaId_idx" ON "MediaVariant"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaVariant_mediaId_processingProfile_variantType_key" ON "MediaVariant"("mediaId", "processingProfile", "variantType");

-- CreateIndex
CREATE INDEX "ProcessingAttempt_mediaId_generation_idx" ON "ProcessingAttempt"("mediaId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingAttempt_mediaId_generation_bullAttemptNumber_key" ON "ProcessingAttempt"("mediaId", "generation", "bullAttemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingDispatch_jobId_key" ON "ProcessingDispatch"("jobId");

-- CreateIndex
CREATE INDEX "ProcessingDispatch_status_nextAttemptAt_idx" ON "ProcessingDispatch"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ProcessingDispatch_leaseExpiresAt_idx" ON "ProcessingDispatch"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingDispatch_mediaId_generation_key" ON "ProcessingDispatch"("mediaId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRequest_key_key" ON "IdempotencyRequest"("key");

-- CreateIndex
CREATE INDEX "IdempotencyRequest_state_idx" ON "IdempotencyRequest"("state");

-- CreateIndex
CREATE INDEX "IdempotencyRequest_expiresAt_idx" ON "IdempotencyRequest"("expiresAt");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaVariant" ADD CONSTRAINT "MediaVariant_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingAttempt" ADD CONSTRAINT "ProcessingAttempt_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingDispatch" ADD CONSTRAINT "ProcessingDispatch_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
