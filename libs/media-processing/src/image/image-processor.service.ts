import { Injectable } from '@nestjs/common';
import * as sharpModule from 'sharp';

interface SharpPipeline {
  metadata(): Promise<{ pages?: number }>;
  rotate(): SharpPipeline;
  toColourspace(space: string): SharpPipeline;
  resize(options: Record<string, unknown>): SharpPipeline;
  webp(options: Record<string, unknown>): SharpPipeline;
  toFile(path: string): Promise<{ width: number; height: number }>;
}

const sharp = sharpModule as unknown as (
  input: string,
  options: Record<string, unknown>,
) => SharpPipeline;

export interface ImageProcessingResult {
  readonly optimizedPath: string;
  readonly thumbnailPath: string;
  readonly width: number;
  readonly height: number;
  readonly thumbnailWidth: number;
  readonly thumbnailHeight: number;
  readonly format: 'webp';
}

export interface ImageProcessingOptions {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly thumbnailSize: number;
  readonly quality: number;
  readonly thumbnailQuality?: number;
  readonly maxInputPixels?: number;
}

@Injectable()
export class ImageProcessorService {
  public async process(
    inputPath: string,
    optimizedPath: string,
    thumbnailPath: string,
    options: ImageProcessingOptions,
  ): Promise<ImageProcessingResult> {
    const input = sharp(inputPath, {
      failOn: 'error',
      limitInputPixels: options.maxInputPixels ?? 40_000_000,
    });
    const metadata = await input.metadata();
    if (metadata.pages !== undefined && metadata.pages > 1) {
      throw new Error('ANIMATED_IMAGE_NOT_ALLOWED');
    }

    const optimized = await sharp(inputPath, {
      failOn: 'error',
      limitInputPixels: options.maxInputPixels ?? 40_000_000,
    })
      .rotate()
      .toColourspace('srgb')
      .resize({
        width: options.maxWidth,
        height: options.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: options.quality, effort: 4 })
      .toFile(optimizedPath);

    const thumbnail = await sharp(inputPath, {
      failOn: 'error',
      limitInputPixels: options.maxInputPixels ?? 40_000_000,
    })
      .rotate()
      .toColourspace('srgb')
      .resize({
        width: options.thumbnailSize,
        height: options.thumbnailSize,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: options.thumbnailQuality ?? 75, effort: 4 })
      .toFile(thumbnailPath);

    return {
      optimizedPath,
      thumbnailPath,
      width: optimized.width,
      height: optimized.height,
      thumbnailWidth: thumbnail.width,
      thumbnailHeight: thumbnail.height,
      format: 'webp',
    };
  }
}
