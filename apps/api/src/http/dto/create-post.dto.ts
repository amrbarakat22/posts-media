import { IsString, Length } from 'class-validator';

/**
 * JSON-only post creation body (Part I §2.9/§8.1). Multipart creation with
 * initial media is layered on in Task 10.
 */
export class CreatePostDto {
  @IsString()
  @Length(1, 200)
  public title!: string;

  @IsString()
  @Length(0, 10000)
  public content!: string;
}
