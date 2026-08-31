import { IsOptional, IsString, Length } from 'class-validator';

/** `PATCH /api/posts/:postId` modifies only `title` and/or `content`. */
export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  public title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10000)
  public content?: string;
}
