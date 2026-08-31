import { Injectable } from '@nestjs/common';
import { PrismaService } from '@posts-media/database';
import { ProcessingStep, ProcessingStatus } from '@posts-media/domain';
import type { Media, ProcessingAttempt } from '@prisma/client';

export interface ProcessingClaim {
  readonly media: Media;
  readonly leaseToken: string;
}

@Injectable()
export class WorkerClaimService {
  public constructor(private readonly prisma: PrismaService) {}

  public async claim(
    mediaId: string,
    generation: number,
    jobId: string,
    leaseSeconds: number,
    leaseToken: string,
  ): Promise<ProcessingClaim | null> {
    const now = new Date();
    const result = await this.prisma.media.updateMany({
      where: {
        id: mediaId,
        processingGeneration: generation,
        processingStatus: { not: ProcessingStatus.COMPLETED },
        OR: [
          { processingLeaseExpiresAt: null },
          { processingLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        processingStatus: ProcessingStatus.PROCESSING,
        currentStep: ProcessingStep.CLAIMING,
        processingLeaseToken: leaseToken,
        processingLeaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
        activeJobId: jobId,
        processingStartedAt: { set: now },
      },
    });
    if (result.count !== 1) return null;
    const media = await this.prisma.media.findUniqueOrThrow({
      where: { id: mediaId },
    });
    return { media, leaseToken };
  }

  public async renew(
    mediaId: string,
    generation: number,
    leaseToken: string,
    leaseSeconds: number,
  ): Promise<boolean> {
    const result = await this.prisma.media.updateMany({
      where: {
        id: mediaId,
        processingGeneration: generation,
        processingStatus: ProcessingStatus.PROCESSING,
        processingLeaseToken: leaseToken,
      },
      data: {
        processingLeaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
      },
    });
    return result.count === 1;
  }

  public createAttempt(
    mediaId: string,
    generation: number,
    bullAttemptNumber: number,
    jobId: string,
    processingProfile: string,
    workerInstanceId?: string,
  ): Promise<ProcessingAttempt> {
    return this.prisma.processingAttempt.upsert({
      where: {
        mediaId_generation_bullAttemptNumber: {
          mediaId,
          generation,
          bullAttemptNumber,
        },
      },
      create: {
        mediaId,
        generation,
        bullAttemptNumber,
        jobId,
        processingProfile,
        status: 'RUNNING',
        workerInstanceId,
      },
      update: {},
    });
  }

  public async complete(
    mediaId: string,
    generation: number,
    leaseToken: string,
    attemptId: string,
  ): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.withTransaction(async (tx) => {
      const media = await tx.media.updateMany({
        where: {
          id: mediaId,
          processingGeneration: generation,
          processingLeaseToken: leaseToken,
        },
        data: {
          processingStatus: ProcessingStatus.COMPLETED,
          progress: 100,
          currentStep: ProcessingStep.COMPLETED,
          processingCompletedAt: now,
          processingLeaseToken: null,
          processingLeaseExpiresAt: null,
          activeJobId: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (media.count !== 1) return false;
      await tx.processingAttempt.updateMany({
        where: { id: attemptId, mediaId, generation },
        data: { status: 'COMPLETED', completedAt: now },
      });
      return true;
    });
    return result;
  }

  public async fail(
    mediaId: string,
    generation: number,
    leaseToken: string,
    attemptId: string,
    final: boolean,
    errorCode: string,
    errorMessage: string,
  ): Promise<boolean> {
    const status = final ? ProcessingStatus.FAILED : ProcessingStatus.PENDING;
    const now = new Date();
    return this.prisma.withTransaction(async (tx) => {
      const media = await tx.media.updateMany({
        where: {
          id: mediaId,
          processingGeneration: generation,
          processingLeaseToken: leaseToken,
        },
        data: {
          processingStatus: status,
          progress: final ? 100 : 0,
          currentStep: final ? ProcessingStep.FAILED : ProcessingStep.PENDING,
          processingLeaseToken: null,
          processingLeaseExpiresAt: null,
          activeJobId: null,
          lastErrorCode: errorCode.slice(0, 64),
          lastErrorMessage: errorMessage.slice(0, 1000),
        },
      });
      if (media.count !== 1) return false;
      await tx.processingAttempt.updateMany({
        where: { id: attemptId, mediaId, generation },
        data: {
          status: final ? 'FAILED' : 'FAILED',
          errorCode: errorCode.slice(0, 64),
          errorMessage: errorMessage.slice(0, 1000),
          completedAt: now,
        },
      });
      return true;
    });
  }
}
