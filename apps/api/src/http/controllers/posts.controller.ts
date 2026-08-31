import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PostsService } from '@posts-media/posts';

import { CreatePostDto } from '../dto/create-post.dto';
import { GetPostQueryDto } from '../dto/get-post-query.dto';
import { ListPostsQueryDto } from '../dto/list-posts-query.dto';
import { UpdatePostDto } from '../dto/update-post.dto';
import { presentPost } from '../presenters/post.presenter';

/**
 * Post CRUD/pagination/soft-delete transport (Part I §8.1). This
 * controller only translates HTTP <-> application service; all rules live
 * in `PostsService`.
 */
@Controller('posts')
export class PostsController {
  public constructor(private readonly posts: PostsService) {}

  @Post()
  public async create(@Body() body: CreatePostDto) {
    const post = await this.posts.create(body);
    return presentPost(post);
  }

  @Get()
  public async list(@Query() query: ListPostsQueryDto) {
    const page = await this.posts.list(query);
    return {
      data: page.items.map(presentPost),
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        totalItems: page.totalItems,
        totalPages: page.totalPages,
      },
    };
  }

  @Get(':postId')
  public async getById(
    @Param('postId') postId: string,
    @Query() query: GetPostQueryDto,
  ) {
    const post = await this.posts.getById(postId, {
      includeDeleted: query.includeDeleted ?? false,
    });
    return presentPost(post);
  }

  @Patch(':postId')
  public async update(
    @Param('postId') postId: string,
    @Body() body: UpdatePostDto,
  ) {
    const post = await this.posts.update(postId, body);
    return presentPost(post);
  }

  @Delete(':postId')
  @HttpCode(HttpStatus.OK)
  public async softDelete(@Param('postId') postId: string) {
    const post = await this.posts.softDelete(postId);
    return presentPost(post);
  }

  @Post(':postId/restore')
  @HttpCode(HttpStatus.OK)
  public async restore(@Param('postId') postId: string) {
    const post = await this.posts.restore(postId);
    return presentPost(post);
  }
}
