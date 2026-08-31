import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import {
  ConfigurationModule,
  EnvironmentConfigurationService,
} from '@posts-media/configuration';

import { createMulterOptions } from './multer.config';
import { RequestWorkspaceService } from './request-workspace.service';
import { UploadCleanupService } from './upload-cleanup.service';

/**
 * Wires Multer's disk-storage options from typed configuration (Part I
 * §2.8/§10.1). Uses `registerAsync` rather than a decorator-level options
 * object because `EnvironmentConfigurationService` only has a fully
 * validated `process.env` once Nest starts resolving providers — the
 * `RequestWorkspaceService` used to build Multer's storage `destination`
 * is constructed here directly (a cheap, side-effect-free instantiation)
 * rather than injected, to avoid a nested dynamic-module resolution
 * dance for a single-field dependency.
 */
@Module({
  imports: [
    ConfigurationModule,
    MulterModule.registerAsync({
      inject: [EnvironmentConfigurationService],
      useFactory: (
        configuration: EnvironmentConfigurationService,
      ): MulterModuleOptions => {
        const workspace = new RequestWorkspaceService(configuration);
        // `@nestjs/platform-express`'s bundled Multer types and the
        // `multer` package's own types disagree on `fileFilter`'s
        // callback signature (a version-skew type-only issue); the
        // options object itself is a plain, runtime-compatible Multer
        // config either way.
        return createMulterOptions(workspace, {
          maxFilesPerRequest: configuration.values.upload.maxFilesPerRequest,
          maxSingleFileSizeBytes:
            configuration.values.upload.maxVideoSizeMb * 1024 * 1024,
        }) as unknown as MulterModuleOptions;
      },
    }),
  ],
  providers: [RequestWorkspaceService, UploadCleanupService],
  exports: [MulterModule, RequestWorkspaceService, UploadCleanupService],
})
export class UploadModule {}
