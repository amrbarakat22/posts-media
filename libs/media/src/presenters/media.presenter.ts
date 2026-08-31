import type { Media, MediaVariant } from '@prisma/client';

export interface MediaVariantResponseDto {
  variantType: string;
  mimeType: string;
  format: string;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  resolutionLabel: string | null;
}

export interface MediaLastErrorDto {
  code: string;
  message: string;
}

export interface MediaLinksDto {
  self: string;
  status: string;
  access: string;
  retry?: string;
}

export interface MediaResponseDto {
  id: string;
  postId: string;
  sortOrder: number;
  mediaType: string;
  originalFilename: string;
  detectedMimeType: string;
  originalSize: string;
  checksumSha256: string;
  processingProfile: string;
  processingGeneration: number;
  processingStatus: string;
  progress: number;
  currentStep: string;
  metadata: Record<string, unknown> | null;
  variants: MediaVariantResponseDto[];
  lastError: MediaLastErrorDto | null;
  links: MediaLinksDto;
}

export type MediaWithVariants = Media & { variants: MediaVariant[] };

const presentVariant = (variant: MediaVariant): MediaVariantResponseDto => ({
  variantType: variant.variantType,
  mimeType: variant.mimeType,
  format: variant.format,
  width: variant.width,
  height: variant.height,
  bitrateKbps: variant.bitrateKbps,
  resolutionLabel: variant.resolutionLabel,
});

/**
 * Converts a raw Prisma `Media` record (with its variants) into the stable
 * API response DTO. `BigInt` fields become decimal strings, and only
 * presentation-safe fields are included: bucket names and object keys
 * (Part I §20 "variants metadata without permanent URL") are never
 * serialized.
 */
export function presentMedia(media: MediaWithVariants): MediaResponseDto {
  const links: MediaLinksDto = {
    self: `/api/media/${media.id}`,
    status: `/api/media/${media.id}/status`,
    access: `/api/media/${media.id}/access`,
  };

  if (media.processingStatus === 'FAILED') {
    links.retry = `/api/media/${media.id}/retry`;
  }

  return {
    id: media.id,
    postId: media.postId,
    sortOrder: media.sortOrder,
    mediaType: media.mediaType,
    originalFilename: media.originalFilename,
    detectedMimeType: media.detectedMimeType,
    originalSize: media.originalSize.toString(),
    checksumSha256: media.checksumSha256,
    processingProfile: media.processingProfile,
    processingGeneration: media.processingGeneration,
    processingStatus: media.processingStatus,
    progress: media.progress,
    currentStep: media.currentStep,
    metadata: (media.metadata as Record<string, unknown> | null) ?? null,
    variants: media.variants.map(presentVariant),
    lastError:
      media.lastErrorCode !== null && media.lastErrorMessage !== null
        ? { code: media.lastErrorCode, message: media.lastErrorMessage }
        : null,
    links,
  };
}
