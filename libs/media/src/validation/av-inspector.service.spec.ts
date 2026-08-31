import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { EnvironmentConfiguration } from '@posts-media/configuration';
import { MediaType } from '@posts-media/domain';

import {
  AvInspectorService,
  type ProbeProcess,
  type ProbeSpawner,
} from './av-inspector.service';

const configuration = {
  maxAudioDurationSeconds: 7_200,
  maxVideoDurationSeconds: 1_800,
  maxVideoWidth: 7_680,
  maxVideoHeight: 4_320,
  maxMediaStreams: 10,
  mediaProbeTimeoutMs: 5,
} as EnvironmentConfiguration['upload'];

class FakeProbeProcess extends EventEmitter implements ProbeProcess {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public killedWith?: NodeJS.Signals;

  public kill(signal: NodeJS.Signals): boolean {
    this.killedWith = signal;
    return true;
  }
}

describe('AvInspectorService subprocess safety', () => {
  it('uses an argument array, shell false, and terminates a timed-out probe', async () => {
    const child = new FakeProbeProcess();
    const spawn: ProbeSpawner = jest.fn(() => child);
    const inspection = new AvInspectorService(
      configuration,
      'ffprobe',
      spawn,
    ).inspect('/generated/staged-file', {
      mediaType: MediaType.VIDEO,
      expectedFormat: 'mp4',
    });

    await expect(inspection).rejects.toMatchObject({
      code: 'MEDIA_VALIDATION_TIMEOUT',
      details: undefined,
    });
    expect(child.killedWith).toBe('SIGKILL');
    expect(spawn).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['/generated/staged-file']),
      expect.objectContaining({ shell: false }),
    );
  });

  it('sanitizes probe process failures', async () => {
    const child = new FakeProbeProcess();
    const spawn: ProbeSpawner = () => child;
    const inspection = new AvInspectorService(
      { ...configuration, mediaProbeTimeoutMs: 1_000 },
      'ffprobe',
      spawn,
    ).inspect('/generated/staged-file', {
      mediaType: MediaType.AUDIO,
      expectedFormat: 'mp3',
    });
    child.emit('error', new Error('secret /local/path -- credential'));

    await expect(inspection).rejects.toMatchObject({
      code: 'CORRUPTED_FILE',
      message: 'The uploaded media could not be inspected.',
      details: undefined,
    });
  });
});
