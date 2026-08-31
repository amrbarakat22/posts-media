import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

import { toBoolean } from './transforms';

/** Query string for `GET /api/posts/:postId`. */
export class GetPostQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  public includeDeleted?: boolean;
}
