import { stat } from 'node:fs/promises';

import type { EnvironmentConfiguration } from '@posts-media/configuration';
import {
  DomainError,
  type DomainErrorDetails,
  type ErrorCode,
  MediaType,
} from '@posts-media/domain';

import { AvInspectorService } from './av-inspector.service';
import { ChecksumService } from './checksum.service';
import {
  normalizeOriginalFilename,
  resolveExtensionPolicy,
  type ExtensionPolicy,
} from './extension-policy';
import { ImageInspectorService } from './image-inspector.service';
import { canonicalizeDeclaredMimeType } from './mime-policy';
import {
  SignatureDetectorService,
  type SignatureDetection,
} from './signature-detector.service';

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

export interface FileValidationError {
  fileIndex: number;
  originalFilename: string;
  code: ErrorCode;
  message: string;
  details?: DomainErrorDetails;
}

export type FileValidationOutcome =
  | { readonly ok: true; readonly value: ValidatedUpload }
  | { readonly ok: false; readonly error: FileValidationError };

export interface MediaValidationResult {
  readonly outcomes: readonly FileValidationOutcome[];
  readonly validatedUploads: readonly ValidatedUpload[];
  readonly errors: readonly FileValidationError[];
}

const MEBIBYTE = 1024n * 1024n;

export class MediaValidationService {
  private readonly signatureDetector = new SignatureDetectorService();
  private readonly checksum = new ChecksumService();
  private readonly imageInspector: ImageInspectorService;
  private readonly avInspector: AvInspectorService;

  public constructor(
    private readonly configuration: EnvironmentConfiguration['upload'],
  ) {
    this.imageInspector = new ImageInspectorService(
      configuration.maxImagePixels,
    );
    this.avInspector = new AvInspectorService(configuration);
  }

  public async validateFiles(
    files: readonly Express.Multer.File[],
  ): Promise<MediaValidationResult> {
    const preflight = await this.preflight(files);
    const outcomes = await Promise.all(
      files.map(async (file, fileIndex): Promise<FileValidationOutcome> => {
        const failure = preflight.errors.get(fileIndex);
        if (failure !== undefined) return { ok: false, error: failure };

        const sizeBytes = preflight.sizes.get(fileIndex);
        if (sizeBytes === undefined) {
          return failureOutcome(fileIndex, file.originalname, corruptedFile());
        }
        return this.validateFile(file, fileIndex, sizeBytes);
      }),
    );
    const validatedUploads = outcomes.flatMap((outcome) =>
      outcome.ok ? [outcome.value] : [],
    );
    const errors = outcomes.flatMap((outcome) =>
      outcome.ok ? [] : [outcome.error],
    );
    return { outcomes, validatedUploads, errors };
  }

  private async preflight(files: readonly Express.Multer.File[]): Promise<{
    sizes: ReadonlyMap<number, bigint>;
    errors: ReadonlyMap<number, FileValidationError>;
  }> {
    const sizes = new Map<number, bigint>();
    const errors = new Map<number, FileValidationError>();
    const eligible = files.slice(0, this.configuration.maxFilesPerRequest);

    for (
      let fileIndex = eligible.length;
      fileIndex < files.length;
      fileIndex += 1
    ) {
      const file = files[fileIndex];
      if (file !== undefined) {
        errors.set(
          fileIndex,
          toFileError(
            fileIndex,
            file.originalname,
            new DomainError(
              'FILE_COUNT_EXCEEDED',
              'The request contains too many uploaded files.',
              400,
              { maximum: this.configuration.maxFilesPerRequest },
            ),
          ),
        );
      }
    }

    await Promise.all(
      eligible.map(async (file, fileIndex) => {
        try {
          const details = await stat(file.path, { bigint: true });
          sizes.set(fileIndex, details.size);
        } catch {
          errors.set(
            fileIndex,
            toFileError(fileIndex, file.originalname, corruptedFile()),
          );
        }
      }),
    );

    let aggregate = 0n;
    const maximum = BigInt(this.configuration.maxTotalUploadSizeMb) * MEBIBYTE;
    for (let fileIndex = 0; fileIndex < eligible.length; fileIndex += 1) {
      const size = sizes.get(fileIndex);
      if (size === undefined || errors.has(fileIndex)) continue;
      aggregate += size;
      if (aggregate > maximum) {
        const file = files[fileIndex];
        if (file !== undefined) {
          errors.set(
            fileIndex,
            toFileError(
              fileIndex,
              file.originalname,
              new DomainError(
                'TOTAL_UPLOAD_SIZE_EXCEEDED',
                'The request exceeds the total upload size limit.',
                413,
                { maximumBytes: maximum.toString() },
              ),
            ),
          );
        }
      }
    }
    return { sizes, errors };
  }

  private async validateFile(
    file: Express.Multer.File,
    fileIndex: number,
    sizeBytes: bigint,
  ): Promise<FileValidationOutcome> {
    try {
      if (sizeBytes === 0n) {
        throw new DomainError('EMPTY_FILE', 'The uploaded file is empty.', 422);
      }

      const originalFilename = normalizeOriginalFilename(file.originalname);
      const policy = resolveExtensionPolicy(originalFilename);
      const declaredMimeType = canonicalizeDeclaredMimeType(file.mimetype);
      const signature = await this.signatureDetector.detect(file.path);

      if (
        !signatureMatchesPolicy(signature, policy) ||
        (declaredMimeType !== 'application/octet-stream' &&
          declaredMimeType !== policy.detectedMimeType)
      ) {
        throw signatureMismatch(policy, declaredMimeType, signature.mimeType);
      }

      let detectedFormat: string;
      let detectedMimeType: string;
      let preliminaryMetadata: Record<string, unknown>;
      let assertSafety: () => void;
      if (policy.mediaType === MediaType.IMAGE) {
        const inspection = await this.imageInspector.inspect(file.path, false);
        detectedFormat = inspection.format;
        detectedMimeType = inspection.mimeType;
        assertSafety = () => this.imageInspector.assertSafety(inspection);
        preliminaryMetadata = {
          width: inspection.width,
          height: inspection.height,
          pages: inspection.pages,
        };
      } else {
        const avMediaType =
          policy.mediaType === MediaType.AUDIO
            ? MediaType.AUDIO
            : MediaType.VIDEO;
        const inspection = await this.avInspector.inspect(
          file.path,
          {
            mediaType: avMediaType,
            expectedFormat: policy.format,
          },
          false,
        );
        detectedFormat = inspection.format;
        detectedMimeType = inspection.mimeType;
        assertSafety = () =>
          this.avInspector.assertSafety(inspection, avMediaType);
        preliminaryMetadata = {
          durationSeconds: inspection.durationSeconds,
          streamCount: inspection.streamCount,
          ...(inspection.audioCodec === undefined
            ? {}
            : { audioCodec: inspection.audioCodec }),
          ...(inspection.videoCodec === undefined
            ? {}
            : { videoCodec: inspection.videoCodec }),
          ...(inspection.width === undefined
            ? {}
            : { width: inspection.width }),
          ...(inspection.height === undefined
            ? {}
            : { height: inspection.height }),
        };
      }

      if (
        detectedFormat !== policy.format ||
        detectedMimeType !== policy.detectedMimeType
      ) {
        throw signatureMismatch(policy, declaredMimeType, detectedMimeType);
      }

      const maximumBytes = this.maximumBytes(policy.mediaType);
      if (sizeBytes > maximumBytes) {
        throw new DomainError(
          'FILE_SIZE_EXCEEDED',
          'The uploaded file exceeds the size limit for its media type.',
          422,
          { maximumBytes: maximumBytes.toString() },
        );
      }

      assertSafety();
      const checksumSha256 = await this.checksum.calculate(file.path);
      return {
        ok: true,
        value: {
          fileIndex,
          temporaryPath: file.path,
          originalFilename,
          extension: policy.extension,
          declaredMimeType,
          detectedMimeType,
          detectedFormat,
          mediaType: policy.mediaType,
          sizeBytes,
          checksumSha256,
          preliminaryMetadata,
        },
      };
    } catch (error) {
      return failureOutcome(
        fileIndex,
        file.originalname,
        error instanceof DomainError ? error : corruptedFile(),
      );
    }
  }

  private maximumBytes(mediaType: MediaType): bigint {
    const megabytes =
      mediaType === MediaType.IMAGE
        ? this.configuration.maxImageSizeMb
        : mediaType === MediaType.AUDIO
          ? this.configuration.maxAudioSizeMb
          : this.configuration.maxVideoSizeMb;
    return BigInt(megabytes) * MEBIBYTE;
  }
}

const signatureMatchesPolicy = (
  signature: SignatureDetection,
  policy: ExtensionPolicy,
): boolean => {
  if (signature.containerFamily === 'iso-bmff') {
    return (
      (policy.format === 'm4a' ||
        policy.format === 'mp4' ||
        policy.format === 'mov') &&
      (signature.containerVariant === undefined ||
        signature.containerVariant === policy.format)
    );
  }
  if (signature.containerFamily === 'ebml') {
    return (
      (policy.format === 'webm' || policy.format === 'mkv') &&
      (signature.containerVariant === undefined ||
        signature.containerVariant === policy.format)
    );
  }
  return (
    signature.format === policy.format &&
    signature.mediaType === policy.mediaType
  );
};

const signatureMismatch = (
  policy: ExtensionPolicy,
  declaredMimeType: string,
  detectedMimeType: string,
): DomainError =>
  new DomainError(
    'FILE_SIGNATURE_MISMATCH',
    'The uploaded content does not match the submitted media format.',
    422,
    {
      extension: policy.extension,
      declaredMimeType,
      detectedMimeType,
    },
  );

const failureOutcome = (
  fileIndex: number,
  originalFilename: string,
  error: DomainError,
): FileValidationOutcome => ({
  ok: false,
  error: toFileError(fileIndex, originalFilename, error),
});

const toFileError = (
  fileIndex: number,
  originalFilename: string,
  error: DomainError,
): FileValidationError => ({
  fileIndex,
  originalFilename: safeFilename(originalFilename),
  code: error.code,
  message: error.message,
  ...(error.details === undefined ? {} : { details: error.details }),
});

const safeFilename = (originalFilename: string): string => {
  try {
    return normalizeOriginalFilename(originalFilename);
  } catch {
    return 'unnamed';
  }
};

const corruptedFile = (): DomainError =>
  new DomainError(
    'CORRUPTED_FILE',
    'The uploaded file could not be inspected.',
    422,
  );
