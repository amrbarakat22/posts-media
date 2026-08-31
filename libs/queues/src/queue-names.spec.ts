import { MediaType } from '@posts-media/domain';

import { queueNameFor } from './queue-names';

describe('queueNameFor', () => {
  it.each([
    [MediaType.IMAGE, 'image-processing'],
    [MediaType.AUDIO, 'audio-processing'],
    [MediaType.VIDEO, 'video-processing'],
  ])('maps %s to %s', (mediaType, expected) => {
    expect(queueNameFor(mediaType)).toBe(expected);
  });
});
