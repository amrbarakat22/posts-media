import { ProcessingStatus } from '../enums/processing-status.enum';
import { PostAggregateStatus } from '../enums/post-aggregate-status.enum';
import { calculatePostAggregateStatus } from './post-aggregate-status';

describe('calculatePostAggregateStatus', () => {
  it('returns NO_MEDIA when the post has no media', () => {
    expect(calculatePostAggregateStatus([])).toBe(PostAggregateStatus.NO_MEDIA);
  });

  it('returns PENDING when every media item is pending', () => {
    expect(
      calculatePostAggregateStatus([
        ProcessingStatus.PENDING,
        ProcessingStatus.PENDING,
      ]),
    ).toBe(PostAggregateStatus.PENDING);
  });

  it('returns PROCESSING when any media item is processing, regardless of the others', () => {
    expect(
      calculatePostAggregateStatus([
        ProcessingStatus.COMPLETED,
        ProcessingStatus.PROCESSING,
        ProcessingStatus.FAILED,
      ]),
    ).toBe(PostAggregateStatus.PROCESSING);
  });

  it('returns COMPLETED when every media item is completed', () => {
    expect(
      calculatePostAggregateStatus([
        ProcessingStatus.COMPLETED,
        ProcessingStatus.COMPLETED,
      ]),
    ).toBe(PostAggregateStatus.COMPLETED);
  });

  it('returns FAILED when every media item is failed', () => {
    expect(
      calculatePostAggregateStatus([
        ProcessingStatus.FAILED,
        ProcessingStatus.FAILED,
      ]),
    ).toBe(PostAggregateStatus.FAILED);
  });

  it('returns PARTIALLY_COMPLETED for a mix of terminal and pending statuses with none processing', () => {
    expect(
      calculatePostAggregateStatus([
        ProcessingStatus.COMPLETED,
        ProcessingStatus.FAILED,
      ]),
    ).toBe(PostAggregateStatus.PARTIALLY_COMPLETED);

    expect(
      calculatePostAggregateStatus([
        ProcessingStatus.COMPLETED,
        ProcessingStatus.PENDING,
      ]),
    ).toBe(PostAggregateStatus.PARTIALLY_COMPLETED);

    expect(
      calculatePostAggregateStatus([
        ProcessingStatus.PENDING,
        ProcessingStatus.FAILED,
      ]),
    ).toBe(PostAggregateStatus.PARTIALLY_COMPLETED);
  });
});
