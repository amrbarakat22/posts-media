import { Injectable } from '@nestjs/common';

interface TrackedChild {
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit' | 'close', listener: () => void): this;
}

@Injectable()
export class GracefulShutdownService {
  private readonly children = new Set<TrackedChild>();

  public track<T extends TrackedChild>(child: T): T {
    this.children.add(child);
    child.once('exit', () => this.children.delete(child));
    child.once('close', () => this.children.delete(child));
    return child;
  }

  public untrack(child: TrackedChild): void {
    this.children.delete(child);
  }

  public async shutdown(graceMs = 5000): Promise<void> {
    const children = [...this.children];
    children.forEach((child) => child.kill('SIGTERM'));
    if (children.length === 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, graceMs));
    [...this.children].forEach((child) => child.kill('SIGKILL'));
    this.children.clear();
  }
}
