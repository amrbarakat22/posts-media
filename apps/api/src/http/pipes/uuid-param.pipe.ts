import type { PipeTransform } from '@nestjs/common';
import { DomainError } from '@posts-media/domain';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates UUID route parameters before they can reach PostgreSQL casts. */
export const uuidParamPipe = (
  parameterName: 'postId' | 'mediaId',
): PipeTransform<string, string> => ({
  transform(value: string): string {
    if (!UUID_PATTERN.test(value)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `The ${parameterName} path parameter must be a valid UUID.`,
        400,
      );
    }
    return value;
  },
});
