import { spawn } from 'node:child_process';

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
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('MEDIA_VALIDATION_TIMEOUT'));
        settled = true;
      }, timeoutMs);
      const append = (current: string, chunk: Buffer): string => {
        if (Buffer.byteLength(current) + chunk.byteLength > maxOutputBytes) {
          throw new Error('FFPROBE_OUTPUT_LIMIT');
        }
        return current + chunk.toString('utf8');
      };
      child.stdout.on('data', (chunk: Buffer) => {
        try {
          stdout = append(stdout, chunk);
        } catch (error) {
          child.kill('SIGTERM');
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.once('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
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
