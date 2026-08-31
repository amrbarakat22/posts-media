import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigurationModule } from '@posts-media/configuration';
import { DatabaseModule } from '@posts-media/database';
import { PostsModule } from '@posts-media/posts';

import { PostsController } from './http/controllers/posts.controller';
import { RequestIdMiddleware } from './http/middleware/request-id.middleware';
import { RequestWorkspaceService } from './upload/request-workspace.service';
import { UploadCleanupService } from './upload/upload-cleanup.service';

@Module({
  imports: [ConfigurationModule, DatabaseModule, PostsModule],
  controllers: [PostsController],
  providers: [RequestWorkspaceService, UploadCleanupService],
})
export class ApiModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
