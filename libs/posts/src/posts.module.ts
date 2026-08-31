import { Module } from '@nestjs/common';
import { DatabaseModule } from '@posts-media/database';

import { PostsService } from './application/posts.service';
import { PostsRepository } from './repositories/posts.repository';

@Module({
  imports: [DatabaseModule],
  providers: [PostsRepository, PostsService],
  exports: [PostsService],
})
export class PostsModule {}
