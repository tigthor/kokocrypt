import { Injectable } from '@nestjs/common';

@Injectable()
export class ReplayGuard {
  private readonly window = 30_000; // 30 seconds
  private readonly seen = new Map<string, number>();
  private lastCleanup = Date.now();

  check(ts: number, nonce: string): boolean {
    const now = Date.now();
    
    // Cleanup old entries every minute
    if (now - this.lastCleanup > 60_000) {
      this.cleanup(now);
      this.lastCleanup = now;
    }

    // Check timestamp is within window
    if (Math.abs(now - ts) > this.window) {
      return false;
    }

    // Check nonce hasn't been seen before
    const key = `${ts}:${nonce}`;
    if (this.seen.has(key)) {
      return false;
    }

    this.seen.set(key, now);
    return true;
  }

  private cleanup(now: number) {
    for (const [key, timestamp] of this.seen.entries()) {
      if (now - timestamp > this.window) {
        this.seen.delete(key);
      }
    }
  }
} 