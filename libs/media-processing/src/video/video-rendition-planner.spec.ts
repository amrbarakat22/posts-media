import { planVideoRenditions } from './video-rendition-planner';

describe('planVideoRenditions', () => {
  it.each([
    [1920, 1080, ['360p', '720p', '1080p']],
    [1280, 720, ['360p', '720p']],
    [854, 480, ['360p']],
    [320, 240, ['source']],
  ])('plans no-upscale labels for %sx%s', (width, height, labels) => {
    expect(
      planVideoRenditions(width, height).map((item) => item.label),
    ).toEqual(labels);
  });

  it('preserves portrait orientation', () => {
    expect(planVideoRenditions(1080, 1920)[2]).toMatchObject({
      label: '1080p',
      width: 1080,
      height: 1920,
    });
  });
});
