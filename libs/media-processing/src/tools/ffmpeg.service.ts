import { spawn } from 'node:child_process';

export interface FfmpegRunOptions {
  readonly binary?: string;
  readonly timeoutMs?: number;
  readonly onProgress?: (progress: number) => void;
}

export class FfmpegService {
  public async run(
    args: readonly string[],
    options: FfmpegRunOptions = {},
  ): Promise<void> {
    const child = spawn(options.binary ?? 'ffmpeg', [...args], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    const timeout = options.timeoutMs ?? 600_000;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        if (!settled) {
          settled = true;
          reject(new Error('PROCESSING_TIMEOUT'));
        }
      }, timeout);
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000);
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
        if (code === 0) {
          options.onProgress?.(100);
          resolve();
        } else
          reject(new Error(`FFMPEG_FAILED_${code ?? 'UNKNOWN'}: ${stderr}`));
      });
    });
  }
}
