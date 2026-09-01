import { spawn, type ChildProcess } from 'node:child_process';

export interface ChildProcessTracker {
  track<T extends ChildProcess>(child: T): T;
  untrack(child: ChildProcess): void;
}

export interface FfmpegRunOptions {
  readonly binary?: string;
  readonly timeoutMs?: number;
  readonly onProgress?: (progress: number) => void;
}

export class FfmpegService {
  public constructor(private readonly tracker?: ChildProcessTracker) {}

  public async run(
    args: readonly string[],
    options: FfmpegRunOptions = {},
  ): Promise<void> {
    const child = spawn(options.binary ?? 'ffmpeg', [...args], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.tracker?.track(child);
    let stderr = '';
    const timeout = options.timeoutMs ?? 600_000;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let escalation: NodeJS.Timeout | undefined;
      let tracked = this.tracker !== undefined;
      const untrack = () => {
        if (!tracked) return;
        tracked = false;
        this.tracker?.untrack(child);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
        escalation.unref();
      }, timeout);
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000);
      });
      child.once('error', (error) => {
        untrack();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (escalation !== undefined) clearTimeout(escalation);
          reject(timedOut ? new Error('PROCESSING_TIMEOUT') : error);
        }
      });
      child.once('close', (code) => {
        untrack();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (escalation !== undefined) clearTimeout(escalation);
        if (timedOut) {
          reject(new Error('PROCESSING_TIMEOUT'));
        } else if (code === 0) {
          options.onProgress?.(100);
          resolve();
        } else
          reject(new Error(`FFMPEG_FAILED_${code ?? 'UNKNOWN'}: ${stderr}`));
      });
    });
  }
}
