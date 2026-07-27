// properties a crypto library has to hold, none of which the original suite
// checked. these are the tests that would fail loudly if someone broke the
// nonce handling or the authentication tag
import { CryptoService } from '../src/core/crypto.service';
import { KeyProvider, KeyResult } from '../src/providers/key-provider';
import { EnhancedEnvKeyProvider } from '../src/providers/enhanced-env.provider';

class StubProvider extends KeyProvider {
  constructor(private readonly key: Buffer) {
    super();
  }

  async getCurrentKey(): Promise<KeyResult> {
    return {
      key: this.key,
      kid: 'stub',
      algorithm: 'XChaCha20-Poly1305',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
  }

  async getKey(): Promise<Buffer | null> {
    return this.key;
  }

  async rotateKeys(): Promise<void> {}

  async storeKey(
    key: Buffer,
    algorithm: string,
    expiresAt?: number
  ): Promise<KeyResult> {
    return { key, kid: 'stored', algorithm, createdAt: Date.now(), expiresAt };
  }
}

const KEY = Buffer.alloc(32, 7);
const configStub = { get: () => undefined } as never;

describe('secretbox', () => {
  let svc: CryptoService;

  beforeEach(() => {
    svc = new CryptoService(new StubProvider(KEY), configStub);
  });

  it('round trips', async () => {
    const msg = Buffer.from('attack at dawn');
    const back = await svc.unboxRaw(await svc.boxRaw(msg, KEY), KEY);
    expect(back.toString()).toBe('attack at dawn');
  });

  it('round trips an empty message', async () => {
    const back = await svc.unboxRaw(
      await svc.boxRaw(Buffer.alloc(0), KEY),
      KEY
    );
    expect(back.length).toBe(0);
  });

  it('round trips a large message', async () => {
    const msg = Buffer.alloc(200_000, 0xab);
    const back = await svc.unboxRaw(await svc.boxRaw(msg, KEY), KEY);
    expect(back.equals(msg)).toBe(true);
  });

  it('never emits the plaintext', async () => {
    const msg = Buffer.from('this exact string must not appear');
    const box = await svc.boxRaw(msg, KEY);
    expect(box.includes(msg)).toBe(false);
  });

  it('uses a fresh nonce every time', async () => {
    // a repeated nonce with the same key is what breaks a stream cipher
    const msg = Buffer.from('same message');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const box = await svc.boxRaw(msg, KEY);
      seen.add(box.subarray(0, 24).toString('hex'));
    }
    expect(seen.size).toBe(200);
  });

  it('produces different ciphertext for the same input', async () => {
    const msg = Buffer.from('same message');
    const a = await svc.boxRaw(msg, KEY);
    const b = await svc.boxRaw(msg, KEY);
    expect(a.equals(b)).toBe(false);
  });

  it('refuses the wrong key', async () => {
    const box = await svc.boxRaw(Buffer.from('secret'), KEY);
    await expect(svc.unboxRaw(box, Buffer.alloc(32, 9))).rejects.toThrow();
  });

  it('refuses a flipped bit in the ciphertext', async () => {
    const box = await svc.boxRaw(Buffer.from('secret message here'), KEY);
    box[box.length - 1] ^= 0x01;
    await expect(svc.unboxRaw(box, KEY)).rejects.toThrow();
  });

  it('refuses a flipped bit in the nonce', async () => {
    const box = await svc.boxRaw(Buffer.from('secret message here'), KEY);
    box[0] ^= 0x01;
    await expect(svc.unboxRaw(box, KEY)).rejects.toThrow();
  });

  it('refuses a truncated box', async () => {
    const box = await svc.boxRaw(Buffer.from('secret'), KEY);
    await expect(svc.unboxRaw(box.subarray(0, 10), KEY)).rejects.toThrow();
  });

  it('refuses two boxes spliced together', async () => {
    const a = await svc.boxRaw(Buffer.from('message one'), KEY);
    const b = await svc.boxRaw(Buffer.from('message two'), KEY);
    // the nonce of one with the body of the other must not authenticate
    const spliced = Buffer.concat([a.subarray(0, 24), b.subarray(24)]);
    await expect(svc.unboxRaw(spliced, KEY)).rejects.toThrow();
  });
});

describe('aes-gcm', () => {
  let svc: CryptoService;

  beforeEach(() => {
    svc = new CryptoService(new StubProvider(KEY), configStub);
  });

  it('round trips', async () => {
    const back = await svc.decryptAesGcm(
      await svc.encryptAesGcm(Buffer.from('hello'), KEY),
      KEY
    );
    expect(back.toString()).toBe('hello');
  });

  it('uses a fresh iv every time', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const out = await svc.encryptAesGcm(Buffer.from('same'), KEY);
      seen.add(out.subarray(0, 12).toString('hex'));
    }
    expect(seen.size).toBe(100);
  });

  it('refuses a tampered tag', async () => {
    const out = await svc.encryptAesGcm(Buffer.from('hello there'), KEY);
    out[out.length - 1] ^= 0xff;
    await expect(svc.decryptAesGcm(out, KEY)).rejects.toThrow();
  });

  it('refuses the wrong key', async () => {
    const out = await svc.encryptAesGcm(Buffer.from('hello'), KEY);
    await expect(svc.decryptAesGcm(out, Buffer.alloc(32, 3))).rejects.toThrow();
  });
});

describe('batch', () => {
  let svc: CryptoService;

  beforeEach(() => {
    svc = new CryptoService(new StubProvider(KEY), configStub);
  });

  it('round trips every message in order', async () => {
    const msgs = ['one', 'two', 'three', ''].map(s => Buffer.from(s));
    const back = await svc.batchDecrypt(await svc.batchEncrypt(msgs, KEY), KEY);
    expect(back.map(b => b.toString())).toEqual(['one', 'two', 'three', '']);
  });

  it('gives each message its own nonce', async () => {
    const msgs = Array.from({ length: 50 }, () => Buffer.from('identical'));
    const out = await svc.batchEncrypt(msgs, KEY);
    const nonces = new Set(out.map(b => b.subarray(0, 24).toString('hex')));
    expect(nonces.size).toBe(50);
  });

  it('handles an empty batch', async () => {
    expect(await svc.batchEncrypt([], KEY)).toEqual([]);
  });
});

describe('EnhancedEnvKeyProvider', () => {
  const saved = process.env.KOKOCRYPT_MASTER_KEY;

  afterEach(() => {
    if (saved === undefined) delete process.env.KOKOCRYPT_MASTER_KEY;
    else process.env.KOKOCRYPT_MASTER_KEY = saved;
  });

  it('rejects instead of crashing when the master key is missing', async () => {
    delete process.env.KOKOCRYPT_MASTER_KEY;
    const provider = new EnhancedEnvKeyProvider();
    // constructing used to fire an unawaited async init, so this arrived as an
    // unhandled rejection that took the process down. it must be catchable
    await expect(provider.getCurrentKey()).rejects.toThrow(
      /KOKOCRYPT_MASTER_KEY/
    );
  });

  it('rejects a key of the wrong length', async () => {
    process.env.KOKOCRYPT_MASTER_KEY = Buffer.alloc(16).toString('base64');
    const provider = new EnhancedEnvKeyProvider();
    await expect(provider.getCurrentKey()).rejects.toThrow(/key length/i);
  });

  it('loads a valid key', async () => {
    process.env.KOKOCRYPT_MASTER_KEY = Buffer.alloc(64, 5).toString('base64');
    const provider = new EnhancedEnvKeyProvider();
    const key = await provider.getCurrentKey();
    expect(key.key.length).toBe(64);
    expect(key.kid).toMatch(/^env-/);
  });

  it('initialises once even when called concurrently', async () => {
    process.env.KOKOCRYPT_MASTER_KEY = Buffer.alloc(64, 5).toString('base64');
    const provider = new EnhancedEnvKeyProvider();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => provider.getCurrentKey())
    );
    const ids = new Set(results.map(r => r.kid));
    expect(ids.size).toBe(1);
  });

  it('can be retried after a failure', async () => {
    delete process.env.KOKOCRYPT_MASTER_KEY;
    const provider = new EnhancedEnvKeyProvider();
    await expect(provider.getCurrentKey()).rejects.toThrow();

    // a cached failed promise would make this fail forever
    process.env.KOKOCRYPT_MASTER_KEY = Buffer.alloc(64, 1).toString('base64');
    const key = await provider.getCurrentKey();
    expect(key.key.length).toBe(64);
  });
});
