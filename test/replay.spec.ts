import { ReplayGuard, MemoryReplayStore } from '../src/core/replay.guard';

describe('ReplayGuard', () => {
  let now = 1_000_000;
  const clock = () => now;
  const guard = (opts = {}) => new ReplayGuard({ now: clock, ...opts });

  beforeEach(() => {
    now = 1_000_000;
  });

  it('accepts a fresh nonce once', () => {
    const g = guard();
    expect(g.check(now, 'n1')).toBe(true);
  });

  it('refuses the same nonce twice', () => {
    const g = guard();
    void g.check(now, 'n1');
    expect(g.check(now, 'n1')).toBe(false);
  });

  it('refuses the same nonce even with a different timestamp', () => {
    // the key used to be `${ts}:${nonce}`, so bumping ts made a replay look new
    const g = guard();
    expect(g.check(now, 'n1')).toBe(true);
    now += 1000;
    expect(g.check(now, 'n1')).toBe(false);
  });

  it('refuses a timestamp that is too old', () => {
    const g = guard({ windowMs: 30_000 });
    expect(g.check(now - 31_000, 'old')).toBe(false);
  });

  it('refuses a timestamp far in the future', () => {
    // Math.abs used to allow the whole window forwards as well
    const g = guard({ windowMs: 30_000, futureMs: 5_000 });
    expect(g.check(now + 20_000, 'future')).toBe(false);
  });

  it('allows a little clock skew forwards', () => {
    expect(guard({ futureMs: 5_000 }).check(now + 2_000, 'skewed')).toBe(true);
  });

  it('lets a nonce back in once the window has passed', () => {
    const g = guard({ windowMs: 30_000, futureMs: 5_000 });
    expect(g.check(now, 'n1')).toBe(true);
    now += 40_000;
    expect(g.check(now, 'n1')).toBe(true);
  });

  it('refuses nonsense input', () => {
    const g = guard();
    expect(g.check(NaN, 'n')).toBe(false);
    expect(g.check(now, '')).toBe(false);
    expect(g.check(Infinity, 'n')).toBe(false);
  });

  it('stays bounded under a flood of unique nonces', () => {
    // the map used to grow without limit, which is a way to exhaust memory
    const store = new MemoryReplayStore(1000, clock);
    const g = guard({ store });
    for (let i = 0; i < 50_000; i++) void g.check(now, `nonce-${i}`);
    expect(store.size).toBeLessThanOrEqual(1000);
  });

  it('still catches a replay while bounded', () => {
    const store = new MemoryReplayStore(1000, clock);
    const g = guard({ store });
    expect(g.check(now, 'important')).toBe(true);
    expect(g.check(now, 'important')).toBe(false);
  });

  it('takes a shared store, so a cluster is covered', async () => {
    // an in memory guard per worker means a replay to another worker is
    // accepted. one store shared between them is the fix
    const rows = new Map<string, number>();
    const shared = {
      add(key: string, ttlMs: number) {
        if ((rows.get(key) ?? 0) > now) return false;
        rows.set(key, now + ttlMs);
        return true;
      },
    };

    const workerA = guard({ store: shared });
    const workerB = guard({ store: shared });

    expect(await workerA.check(now, 'n1')).toBe(true);
    expect(await workerB.check(now, 'n1')).toBe(false);
  });
});
