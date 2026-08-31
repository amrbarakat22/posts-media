import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { MediaService } from '@posts-media/media';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('media')
@ApiTags('media')
export class MediaController {
  public constructor(private readonly media: MediaService) {}

  @Get(':mediaId')
  @ApiOperation({ summary: 'Get media details' })
  public get(@Param('mediaId') mediaId: string) {
    return this.media.get(mediaId);
  }

  @Get(':mediaId/status')
  @ApiOperation({ summary: 'Get current processing status' })
  public status(@Param('mediaId') mediaId: string) {
    return this.media.get(mediaId);
  }

  @Get(':mediaId/access')
  @ApiOperation({ summary: 'Generate fresh private access URLs' })
  public access(@Param('mediaId') mediaId: string) {
    return this.media.access(mediaId);
  }

  @Post(':mediaId/retry')
  @ApiOperation({ summary: 'Retry terminally failed media' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  public retry(
    @Param('mediaId') mediaId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.media.retry(mediaId, idempotencyKey);
  }
}
