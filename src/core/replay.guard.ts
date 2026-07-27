import { Injectable } from '@nestjs/common';

/**
 * somewhere to remember which nonces have been used.
 *
 * the default is in memory, which only holds for a single process. behind a
 * cluster or more than one pod a replay sent to a different worker used to be
 * accepted, because that worker had never seen the nonce. supply a shared
 * store (redis, memcached) to close that
 */
export interface ReplayStore {
  /**
   * record the nonce and say whether it was new. must be atomic: two workers
   * racing on the same nonce must not both be told it was new
   */
  add(key: string, ttlMs: number): boolean | Promise<boolean>;
}

export interface ReplayGuardOptions {
  /** how old a timestamp may be. default 30s */
  windowMs?: number;
  /**
   * how far ahead a timestamp may be. a clock slightly ahead is normal, one
   * hours ahead is not. the old check allowed the whole window in both
   * directions. default 5s
   */
  futureMs?: number;
  /**
   * most nonces to hold. the map used to be unbounded, so a flood of unique
   * nonces inside the window was a way to exhaust memory. default 100_000
   */
  maxEntries?: number;
  store?: ReplayStore;
  now?: () => number;
}

/** the default store. bounded, and drops the oldest entries when it is full */
export class MemoryReplayStore implements ReplayStore {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now
  ) {}

  add(key: string, ttlMs: number): boolean {
    const now = this.now();
    const expires = this.seen.get(key);
    if (expires !== undefined && expires > now) return false;

    if (this.seen.size >= this.maxEntries) {
      this.sweep(now);
      // a map iterates in insertion order, so the first key is the oldest
      while (this.seen.size >= this.maxEntries) {
        const oldest = this.seen.keys().next();
        if (oldest.done) break;
        this.seen.delete(oldest.value);
      }
    }

    this.seen.set(key, now + ttlMs);
    return true;
  }

  private sweep(now: number): void {
    for (const [key, expires] of this.seen) {
      if (expires <= now) this.seen.delete(key);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}

@Injectable()
export class ReplayGuard {
  private readonly windowMs: number;
  private readonly futureMs: number;
  private readonly store: ReplayStore;
  private readonly now: () => number;

  constructor(opts: ReplayGuardOptions = {}) {
    this.windowMs = opts.windowMs ?? 30_000;
    this.futureMs = opts.futureMs ?? 5_000;
    this.now = opts.now ?? Date.now;
    this.store =
      opts.store ?? new MemoryReplayStore(opts.maxEntries ?? 100_000, this.now);
  }

  /**
   * true the first time this nonce is seen inside the window.
   *
   * the nonce alone is the key. it used to be `${ts}:${nonce}`, so the same
   * nonce came back as new the moment the timestamp changed
   */
  check(ts: number, nonce: string): boolean | Promise<boolean> {
    if (!Number.isFinite(ts) || typeof nonce !== 'string' || nonce.length === 0)
      return false;

    const age = this.now() - ts;
    if (age < -this.futureMs) return false;
    if (age > this.windowMs) return false;

    // held a little past the window so it cannot come back at the edge
    return this.store.add(nonce, this.windowMs + this.futureMs);
  }
}
