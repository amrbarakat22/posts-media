import { Module } from '@nestjs/common';
import { DatabaseModule, IdempotencyModule } from '@posts-media/database';
import { MediaModule } from '@posts-media/media';
import { StorageModule } from '@posts-media/storage';

import { CreatePostService } from './application/create-post.service';
import { PostsService } from './application/posts.service';
import { PostsRepository } from './repositories/posts.repository';

@Module({
  imports: [DatabaseModule, IdempotencyModule, MediaModule, StorageModule],
  providers: [PostsRepository, PostsService, CreatePostService],
  exports: [PostsService, CreatePostService],
})
export class PostsModule {}
