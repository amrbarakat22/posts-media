import { MediaType } from '@posts-media/domain';

import { jobNameFor, mediaJobId } from './job-names';

describe('jobNameFor', () => {
  it.each([
    [MediaType.IMAGE, 'process-image'],
    [MediaType.AUDIO, 'process-audio'],
    [MediaType.VIDEO, 'process-video'],
  ])('maps %s to %s', (mediaType, expected) => {
    expect(jobNameFor(mediaType)).toBe(expected);
  });
});

describe('mediaJobId', () => {
  it('builds the deterministic media-{mediaId}-generation-{generation} id', () => {
    expect(mediaJobId('abc-123', 1)).toBe('media-abc-123-generation-1');
    expect(mediaJobId('abc-123', 2)).toBe('media-abc-123-generation-2');
  });

  it('produces the same id for the same media/generation and a different one otherwise', () => {
    expect(mediaJobId('m1', 1)).toBe(mediaJobId('m1', 1));
    expect(mediaJobId('m1', 1)).not.toBe(mediaJobId('m1', 2));
    expect(mediaJobId('m1', 1)).not.toBe(mediaJobId('m2', 1));
  });
});
