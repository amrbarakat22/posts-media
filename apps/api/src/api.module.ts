import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigurationModule } from '@posts-media/configuration';
import { DatabaseModule } from '@posts-media/database';
import { PostsModule } from '@posts-media/posts';
import { MediaModule } from '@posts-media/media';

import { PostsController } from './http/controllers/posts.controller';
import { MediaController } from './http/controllers/media.controller';
import { RequestIdMiddleware } from './http/middleware/request-id.middleware';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    PostsModule,
    MediaModule,
    UploadModule,
  ],
  controllers: [PostsController, MediaController],
})
export class ApiModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
