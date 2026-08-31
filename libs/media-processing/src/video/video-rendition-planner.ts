export interface VideoSize {
  readonly width: number;
  readonly height: number;
}
export interface VideoRendition extends VideoSize {
  readonly label: '360p' | '720p' | '1080p' | 'source';
}

const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2);

export const planVideoRenditions = (
  width: number,
  height: number,
): VideoRendition[] => {
  const portrait = height > width;
  const shortEdge = Math.min(width, height);
  const labels: VideoRendition['label'][] =
    shortEdge < 360
      ? ['source']
      : shortEdge < 720
        ? ['360p']
        : shortEdge < 1080
          ? ['360p', '720p']
          : ['360p', '720p', '1080p'];
  return labels.map((label) => {
    if (label === 'source')
      return { label, width: even(width), height: even(height) };
    const targetShort = Number(label.slice(0, -1));
    const scale = targetShort / shortEdge;
    return portrait
      ? { label, width: even(width * scale), height: even(height * scale) }
      : { label, width: even(width * scale), height: even(height * scale) };
  });
};
