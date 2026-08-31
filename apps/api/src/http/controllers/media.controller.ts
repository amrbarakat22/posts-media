import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { MediaService } from '@posts-media/media';

@Controller('media')
export class MediaController {
  public constructor(private readonly media: MediaService) {}

  @Get(':mediaId')
  public get(@Param('mediaId') mediaId: string) {
    return this.media.get(mediaId);
  }

  @Get(':mediaId/status')
  public status(@Param('mediaId') mediaId: string) {
    return this.media.get(mediaId);
  }

  @Get(':mediaId/access')
  public access(@Param('mediaId') mediaId: string) {
    return this.media.access(mediaId);
  }

  @Post(':mediaId/retry')
  public retry(
    @Param('mediaId') mediaId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.media.retry(mediaId, idempotencyKey);
  }
}
