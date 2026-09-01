import type { ChildProcess } from 'node:child_process';

import { Injectable } from '@nestjs/common';
import type { ChildProcessTracker } from '@posts-media/media-processing';

interface TrackedChild {
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'exit' | 'close', listener: () => void): this;
}

@Injectable()
export class GracefulShutdownService implements ChildProcessTracker {
  private readonly children = new Set<TrackedChild>();

  public track<T extends ChildProcess>(child: T): T;
  public track<T extends TrackedChild>(child: T): T;
  public track<T extends TrackedChild>(child: T): T {
    this.children.add(child);
    child.once('exit', () => this.children.delete(child));
    child.once('close', () => this.children.delete(child));
    return child;
  }

  public untrack(child: ChildProcess): void;
  public untrack(child: TrackedChild): void;
  public untrack(child: TrackedChild): void {
    this.children.delete(child);
  }

  public async shutdown(graceMs = 5000): Promise<void> {
    const children = [...this.children];
    if (children.length === 0) return;
    const exited = Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            let resolved = false;
            const resolveOnce = () => {
              if (resolved) return;
              resolved = true;
              resolve();
            };
            child.once('exit', resolveOnce);
            child.once('close', resolveOnce);
          }),
      ),
    );
    children.forEach((child) => child.kill('SIGTERM'));
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    [...this.children].forEach((child) => child.kill('SIGKILL'));
    this.children.clear();
  }
}
