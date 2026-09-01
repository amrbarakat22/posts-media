import { spawn } from 'node:child_process';

import type { ChildProcessTracker } from './ffmpeg.service';

export interface ProbeStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly sample_rate?: string;
  readonly channels?: number;
  readonly channel_layout?: string;
  readonly width?: number;
  readonly height?: number;
  readonly r_frame_rate?: string;
  readonly duration?: string;
  readonly side_data_list?: readonly {
    readonly rotation?: number;
  }[];
}

export interface ProbeResult {
  readonly format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
  };
  readonly streams: readonly ProbeStream[];
  readonly tags?: Record<string, string>;
}

export interface FfprobeOptions {
  readonly binary?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export class FfprobeService {
  public constructor(private readonly tracker?: ChildProcessTracker) {}

  public async probe(
    path: string,
    options: FfprobeOptions = {},
  ): Promise<ProbeResult> {
    const binary = options.binary ?? 'ffprobe';
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxOutputBytes = options.maxOutputBytes ?? 1_000_000;
    return new Promise((resolve, reject) => {
      const child = spawn(
        binary,
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          path,
        ],
        {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      this.tracker?.track(child);
      let stdout = '';
      let stderr = '';
      let settled = false;
      let terminationError: Error | undefined;
      let escalation: NodeJS.Timeout | undefined;
      let tracked = this.tracker !== undefined;
      const untrack = () => {
        if (!tracked) return;
        tracked = false;
        this.tracker?.untrack(child);
      };
      const terminate = (error: Error) => {
        if (terminationError !== undefined) return;
        terminationError = error;
        clearTimeout(timer);
        child.kill('SIGTERM');
        escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
        escalation.unref();
      };
      const timer = setTimeout(() => {
        terminate(new Error('MEDIA_VALIDATION_TIMEOUT'));
      }, timeoutMs);
      const append = (current: string, chunk: Buffer): string => {
        if (Buffer.byteLength(current) + chunk.byteLength > maxOutputBytes) {
          throw new Error('FFPROBE_OUTPUT_LIMIT');
        }
        return current + chunk.toString('utf8');
      };
      child.stdout.on('data', (chunk: Buffer) => {
        if (terminationError !== undefined) return;
        try {
          stdout = append(stdout, chunk);
        } catch (error) {
          terminate(error as Error);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (terminationError !== undefined) return;
        try {
          stderr = append(stderr, chunk);
        } catch (error) {
          terminate(error as Error);
        }
      });
      child.once('error', (error) => {
        untrack();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (escalation !== undefined) clearTimeout(escalation);
          reject(terminationError ?? error);
        }
      });
      child.once('close', (code) => {
        untrack();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (escalation !== undefined) clearTimeout(escalation);
        if (terminationError !== undefined) return reject(terminationError);
        if (code !== 0)
          return reject(
            new Error(
              `FFPROBE_FAILED_${code ?? 'UNKNOWN'}: ${stderr.slice(0, 500)}`,
            ),
          );
        try {
          const parsed = JSON.parse(stdout) as ProbeResult;
          resolve({
            format: parsed.format,
            streams: parsed.streams ?? [],
            tags: parsed.tags,
          });
        } catch {
          reject(new Error('FFPROBE_INVALID_OUTPUT'));
        }
      });
    });
  }
}
