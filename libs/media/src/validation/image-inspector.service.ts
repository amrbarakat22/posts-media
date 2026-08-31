import { DomainError } from '@posts-media/domain';
import * as sharpModule from 'sharp';

interface SharpMetadata {
  readonly format?: string;
  readonly width?: number;
  readonly height?: number;
  readonly pageHeight?: number;
  readonly pages?: number;
}

interface SharpInstance {
  metadata(): Promise<SharpMetadata>;
  clone(): SharpInstance;
  raw(): SharpInstance;
  toBuffer(): Promise<Buffer>;
}

type SharpFactory = (
  input: string,
  options: {
    readonly animated: boolean;
    readonly failOn: 'error';
    readonly limitInputPixels: false;
  },
) => SharpInstance;

// Sharp 0.35 exposes a CommonJS callable. Its conditional declaration export is
// not callable under this repository's classic CommonJS resolver, so retain a
// narrow local port instead of weakening compiler settings.
const sharp = sharpModule as unknown as SharpFactory;

export interface ImageInspection {
  readonly format: 'jpeg' | 'png' | 'webp';
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly pages: number;
}

const mimeByFormat = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

export class ImageInspectorService {
  public constructor(private readonly maxPixels: number) {}

  public async inspect(
    temporaryPath: string,
    enforceSafetyLimits = true,
  ): Promise<ImageInspection> {
    try {
      const image = sharp(temporaryPath, {
        animated: true,
        failOn: 'error',
        limitInputPixels: false,
      });
      const metadata = await image.metadata();
      const format = metadata.format;
      const width = metadata.width;
      const pageHeight = metadata.pageHeight ?? metadata.height;
      const pages = metadata.pages ?? 1;
      if (
        (format !== 'jpeg' && format !== 'png' && format !== 'webp') ||
        width === undefined ||
        pageHeight === undefined ||
        width < 1 ||
        pageHeight < 1
      ) {
        throw corruptedFile();
      }
      // Metadata alone is not acceptance: force libvips to decode the body.
      await image.clone().raw().toBuffer();
      const inspection: ImageInspection = {
        format,
        mimeType: mimeByFormat[format],
        width,
        height: pageHeight,
        pages,
      };
      if (enforceSafetyLimits) this.assertSafety(inspection);
      return inspection;
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw corruptedFile();
    }
  }

  public assertSafety(inspection: ImageInspection): void {
    if (inspection.pages > 1) {
      throw new DomainError(
        'ANIMATED_IMAGE_NOT_SUPPORTED',
        'Animated or multi-frame images are not supported.',
        422,
        { pages: inspection.pages },
      );
    }
    if (inspection.width * inspection.height > this.maxPixels) {
      throw new DomainError(
        'IMAGE_PIXEL_LIMIT_EXCEEDED',
        'The decoded image exceeds the pixel limit.',
        422,
        {
          width: inspection.width,
          height: inspection.height,
          maxPixels: this.maxPixels,
        },
      );
    }
  }
}

const corruptedFile = (): DomainError =>
  new DomainError(
    'CORRUPTED_FILE',
    'The uploaded image could not be decoded.',
    422,
  );
