import {
  AvInspectorService,
  ChecksumService,
  ImageInspectorService,
  MediaValidationService,
  SignatureDetectorService,
  libraryName,
} from '@posts-media/media';

describe('@posts-media/media public contract', () => {
  it('preserves libraryName and exports the validation API', () => {
    expect(libraryName).toBe('media');
    expect(AvInspectorService).toBeDefined();
    expect(ChecksumService).toBeDefined();
    expect(ImageInspectorService).toBeDefined();
    expect(MediaValidationService).toBeDefined();
    expect(SignatureDetectorService).toBeDefined();
  });
});
