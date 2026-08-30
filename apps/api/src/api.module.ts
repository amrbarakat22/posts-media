import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigurationModule } from '@posts-media/configuration';

import { RequestIdMiddleware } from './http/middleware/request-id.middleware';
import { RequestWorkspaceService } from './upload/request-workspace.service';
import { UploadCleanupService } from './upload/upload-cleanup.service';

@Module({
  imports: [ConfigurationModule],
  providers: [RequestWorkspaceService, UploadCleanupService],
})
export class ApiModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
