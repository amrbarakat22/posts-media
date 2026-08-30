import { PostAggregateStatus } from '../enums/post-aggregate-status.enum';
import { ProcessingStatus } from '../enums/processing-status.enum';

/**
 * Computes a post's aggregate processing status from its media items'
 * individual statuses. The result is always derived, never stored.
 *
 * Precedence (Part I §2.16):
 *   no media               -> NO_MEDIA
 *   any PROCESSING         -> PROCESSING
 *   all PENDING            -> PENDING
 *   all COMPLETED          -> COMPLETED
 *   all FAILED             -> FAILED
 *   otherwise              -> PARTIALLY_COMPLETED
 */
export function calculatePostAggregateStatus(
  statuses: readonly ProcessingStatus[],
): PostAggregateStatus {
  if (statuses.length === 0) {
    return PostAggregateStatus.NO_MEDIA;
  }

  if (statuses.some((status) => status === ProcessingStatus.PROCESSING)) {
    return PostAggregateStatus.PROCESSING;
  }

  if (statuses.every((status) => status === ProcessingStatus.PENDING)) {
    return PostAggregateStatus.PENDING;
  }

  if (statuses.every((status) => status === ProcessingStatus.COMPLETED)) {
    return PostAggregateStatus.COMPLETED;
  }

  if (statuses.every((status) => status === ProcessingStatus.FAILED)) {
    return PostAggregateStatus.FAILED;
  }

  return PostAggregateStatus.PARTIALLY_COMPLETED;
}
