import { Injectable } from '@nestjs/common';
import { DomainError } from '@posts-media/domain';
import { Prisma } from '@prisma/client';

import {
  normalizePostListQuery,
  type RawPostListQuery,
} from '../queries/post-list-query';
import {
  type PostWithMedia,
  PostsRepository,
} from '../repositories/posts.repository';

export interface CreatePostCommand {
  readonly title: string;
  readonly content: string;
}

export interface UpdatePostCommand {
  readonly title?: string;
  readonly content?: string;
}

export interface PostListPage {
  readonly items: readonly PostWithMedia[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

const isRecordNotFound = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2025';

const postNotFound = (): DomainError =>
  new DomainError('POST_NOT_FOUND', 'The requested post does not exist.', 404);

const postSoftDeleted = (): DomainError =>
  new DomainError(
    'POST_SOFT_DELETED',
    'The requested post has been deleted.',
    409,
  );

/**
 * Post CRUD/pagination/soft-delete use cases (Part I §2.15/§2.16). Task 8
 * builds JSON-only creation; atomic creation with initial media (Task 10)
 * and HTTP idempotency (Task 9) are layered on afterward.
 */
@Injectable()
export class PostsService {
  public constructor(private readonly repository: PostsRepository) {}

  public create(command: CreatePostCommand): Promise<PostWithMedia> {
    return this.repository.create(command);
  }

  public async getById(
    id: string,
    options: { includeDeleted: boolean },
  ): Promise<PostWithMedia> {
    if (options.includeDeleted) {
      const post = await this.repository.findById(id, {
        includeDeleted: true,
      });
      if (post === null) throw postNotFound();
      return post;
    }

    const post = await this.repository.findByIdIncludingDeleted(id);
    if (post === null) throw postNotFound();
    if (post.deletedAt !== null) throw postSoftDeleted();
    return post;
  }

  public async update(
    id: string,
    command: UpdatePostCommand,
  ): Promise<PostWithMedia> {
    const existing = await this.repository.findByIdIncludingDeleted(id);
    if (existing === null) throw postNotFound();
    if (existing.deletedAt !== null) throw postSoftDeleted();

    try {
      return await this.repository.update(id, command);
    } catch (error) {
      if (isRecordNotFound(error)) throw postNotFound();
      throw error;
    }
  }

  /**
   * Idempotent soft delete: deleting an already-deleted post is a no-op
   * that returns the current state rather than an error, since retrying a
   * `DELETE` must always be safe.
   */
  public async softDelete(id: string): Promise<PostWithMedia> {
    const existing = await this.repository.findByIdIncludingDeleted(id);
    if (existing === null) throw postNotFound();
    if (existing.deletedAt !== null) return existing;

    try {
      return await this.repository.softDelete(id);
    } catch (error) {
      if (isRecordNotFound(error)) throw postNotFound();
      throw error;
    }
  }

  /**
   * Idempotent restore: restoring a post that is already active is a
   * no-op that returns the current state.
   */
  public async restore(id: string): Promise<PostWithMedia> {
    const existing = await this.repository.findByIdIncludingDeleted(id);
    if (existing === null) throw postNotFound();
    if (existing.deletedAt === null) return existing;

    try {
      return await this.repository.restore(id);
    } catch (error) {
      if (isRecordNotFound(error)) throw postNotFound();
      throw error;
    }
  }

  public async list(raw: RawPostListQuery): Promise<PostListPage> {
    const query = normalizePostListQuery(raw);
    const { items, totalItems } = await this.repository.list(query);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}
