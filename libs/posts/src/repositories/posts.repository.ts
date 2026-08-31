import { Injectable } from '@nestjs/common';
import { PrismaService } from '@posts-media/database';
import type { Media, Post, Prisma } from '@prisma/client';

import type { PostListQuery } from '../queries/post-list-query';

export type PostWithMedia = Post & { media: Media[] };

export interface PostListResult {
  readonly items: readonly PostWithMedia[];
  readonly totalItems: number;
}

export interface CreatePostInput {
  readonly title: string;
  readonly content: string;
}

export interface UpdatePostInput {
  readonly title?: string;
  readonly content?: string;
}

const includeMedia = { media: { orderBy: { sortOrder: 'asc' as const } } };

/**
 * Prisma-backed data access for `Post`. Owns query construction (Part I
 * §2.16 pagination/filtering, §2.15 soft delete) but no business rules —
 * those live in `PostsService`.
 */
@Injectable()
export class PostsRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public create(input: CreatePostInput): Promise<PostWithMedia> {
    return this.prisma.post.create({
      data: { title: input.title, content: input.content },
      include: includeMedia,
    });
  }

  public findById(
    id: string,
    options: { includeDeleted: boolean } = { includeDeleted: false },
  ): Promise<PostWithMedia | null> {
    return this.prisma.post.findFirst({
      where: {
        id,
        ...(options.includeDeleted ? {} : { deletedAt: null }),
      },
      include: includeMedia,
    });
  }

  /**
   * Finds a post by id regardless of soft-delete state, distinguishing
   * "does not exist at all" from "exists but is soft-deleted" so callers
   * can choose between `POST_NOT_FOUND` and `POST_SOFT_DELETED`.
   */
  public findByIdIncludingDeleted(id: string): Promise<PostWithMedia | null> {
    return this.prisma.post.findUnique({
      where: { id },
      include: includeMedia,
    });
  }

  public async update(
    id: string,
    input: UpdatePostInput,
  ): Promise<PostWithMedia> {
    return this.prisma.post.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
      },
      include: includeMedia,
    });
  }

  public softDelete(id: string): Promise<PostWithMedia> {
    return this.prisma.post.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: includeMedia,
    });
  }

  public restore(id: string): Promise<PostWithMedia> {
    return this.prisma.post.update({
      where: { id },
      data: { deletedAt: null },
      include: includeMedia,
    });
  }

  public async list(query: PostListQuery): Promise<PostListResult> {
    const where = this.buildWhere(query);
    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        include: includeMedia,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.post.count({ where }),
    ]);
    return { items, totalItems };
  }

  private buildWhere(query: PostListQuery): Prisma.PostWhereInput {
    const mediaFilter: Prisma.MediaListRelationFilter | undefined =
      query.mediaType !== undefined || query.processingStatus !== undefined
        ? {
            some: {
              ...(query.mediaType !== undefined
                ? { mediaType: query.mediaType }
                : {}),
              ...(query.processingStatus !== undefined
                ? { processingStatus: query.processingStatus }
                : {}),
            },
          }
        : undefined;

    return {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.search !== undefined
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { content: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.createdFrom !== undefined || query.createdTo !== undefined
        ? {
            createdAt: {
              ...(query.createdFrom !== undefined
                ? { gte: query.createdFrom }
                : {}),
              ...(query.createdTo !== undefined
                ? { lte: query.createdTo }
                : {}),
            },
          }
        : {}),
      ...(mediaFilter !== undefined ? { media: mediaFilter } : {}),
    };
  }
}
