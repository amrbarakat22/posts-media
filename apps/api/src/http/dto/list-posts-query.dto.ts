import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { MediaType, ProcessingStatus } from '@posts-media/domain';

import { toBoolean } from './transforms';

/**
 * Query string for `GET /api/posts` (Part I §2.16). Raw string query
 * parameters are coerced to their typed form here; bounds/defaults/sort
 * allowlisting are applied afterward by `normalizePostListQuery`.
 */
export class ListPostsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  public pageSize?: number;

  @IsOptional()
  @IsString()
  public search?: string;

  @IsOptional()
  @IsEnum(MediaType)
  public mediaType?: MediaType;

  @IsOptional()
  @IsEnum(ProcessingStatus)
  public processingStatus?: ProcessingStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  public createdFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  public createdTo?: Date;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  public includeDeleted?: boolean;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'title'])
  public sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  public sortOrder?: string;
}
