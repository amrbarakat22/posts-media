import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  AddPostMediaService,
  CreatePostService,
  presentPost,
  PostsService,
} from '@posts-media/posts';
import type { Request } from 'express';

import { CreatePostDto } from '../dto/create-post.dto';
import { GetPostQueryDto } from '../dto/get-post-query.dto';
import { ListPostsQueryDto } from '../dto/list-posts-query.dto';
import { UpdatePostDto } from '../dto/update-post.dto';
import type { RequestWithId } from '../middleware/request-id.middleware';

/** Any single-field multipart upload cap comfortably above the real limit (10, Part I §2.9) — the configured limit remains the actual enforcement point (see UploadModule). */
const MULTIPART_FIELD_DECORATOR_MAX_FILES = 50;

/**
 * Post CRUD/pagination/soft-delete/atomic-create transport (Part I §8.1).
 * This controller only translates HTTP <-> application service; all rules
 * live in `PostsService`/`CreatePostService`.
 */
@Controller('posts')
@ApiTags('posts')
export class PostsController {
  public constructor(
    private readonly posts: PostsService,
    private readonly createPost: CreatePostService,
    private readonly addPostMedia: AddPostMediaService,
  ) {}

  /**
   * Accepts JSON (no files) or multipart (`title`, `content`, repeated
   * `media` fields) and atomically creates the Post plus any initial media
   * (Part I §2.4/§10.4). `FilesInterceptor` is a no-op for a JSON request.
   */
  @Post()
  @ApiOperation({ summary: 'Create a post with optional initial media' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        content: { type: 'string', maxLength: 10000 },
        media: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('media', MULTIPART_FIELD_DECORATOR_MAX_FILES),
  )
  public async create(
    @Body() body: CreatePostDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.createPost.execute({
      idempotencyKey,
      title: body.title,
      content: body.content,
      files: files ?? [],
      requestId: (request as RequestWithId).requestId,
    });
  }

  /**
   * Adds media to an existing post with partial-success semantics (Part I
   * §2.5/§10.5): valid files are persisted, invalid ones are reported
   * back, and the whole request only fails when zero files are accepted.
   */
  @Post(':postId/media')
  @ApiOperation({ summary: 'Add mixed media with partial-success semantics' })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['media'],
      properties: {
        media: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('media', MULTIPART_FIELD_DECORATOR_MAX_FILES),
  )
  public async addMedia(
    @Param('postId') postId: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.addPostMedia.execute({
      postId,
      idempotencyKey,
      files: files ?? [],
      requestId: (request as RequestWithId).requestId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List and filter posts' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({
    name: 'mediaType',
    required: false,
    enum: ['IMAGE', 'AUDIO', 'VIDEO'],
  })
  @ApiQuery({
    name: 'processingStatus',
    required: false,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
  })
  @ApiQuery({ name: 'includeDeleted', required: false, type: Boolean })
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
