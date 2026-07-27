import { CryptoService } from '../src/core/crypto.service';
import { KeyProvider, KeyResult } from '../src/providers/key-provider';
import { SecureSession } from '../src/core/secure-session';
import { generateMasterKey } from '../src/core/keypair';

const MASTER = generateMasterKey();
class P extends KeyProvider {
  async getCurrentKey(): Promise<KeyResult> {
    return {
      key: MASTER.raw,
      kid: 'k',
      algorithm: 'x',
      createdAt: 0,
      expiresAt: Date.now() + 1e9,
    };
  }
  async getKey(): Promise<Buffer | null> {
    return MASTER.raw;
  }
  async rotateKeys(): Promise<void> {}
  async storeKey(key: Buffer, algorithm: string): Promise<KeyResult> {
    return { key, kid: 'z', algorithm, createdAt: 0 };
  }
}

jest.setTimeout(180000);

async function measure(name: string, n: number, fn: () => unknown) {
  await fn();
  const t = process.hrtime.bigint();
  for (let i = 0; i < n; i++) await fn();
  const us = Number(process.hrtime.bigint() - t) / 1e3 / n;
  const ops = 1e6 / us;
  console.log(
    `${name.padEnd(46)}${us.toFixed(2).padStart(9)} us  ${ops.toFixed(0).padStart(10)} ops/s`
  );
  return us;
}

it('old path versus the session path', async () => {
  const svc = new CryptoService(new P(), { get: () => undefined } as never);
  const clientPub = Buffer.alloc(32, 3);

  for (const size of [256, 1024, 16384]) {
    const msg = Buffer.alloc(size, 1);
    console.log(`\n=== ${size} byte payload ===`);

    const before = await measure(
      'old: deriveSession + boxRaw per request',
      2000,
      async () => {
        const s = await svc.deriveSession(clientPub, Date.now());
        return svc.boxRaw(msg, Buffer.from(s.tx));
      }
    );

    const wrapper = await measure(
      'old: encryptAesGcm (libsodium-wrappers)',
      2000,
      () => svc.encryptAesGcm(msg, Buffer.alloc(32, 7))
    );

    // handshake once, then just encrypt
    const s = await svc.deriveSession(clientPub, Date.now());
    const session = new SecureSession({
      tx: Buffer.from(s.tx),
      rx: Buffer.from(s.rx),
      kid: s.kid,
    });
    const after = await measure('new: SecureSession.seal', 20000, () =>
      session.seal(msg)
    );

    console.log(
      `${' '.repeat(46)}speedup vs chained  ${(before / after).toFixed(1)}x`
    );
    console.log(
      `${' '.repeat(46)}speedup vs wrappers ${(wrapper / after).toFixed(1)}x`
    );
  }

  console.log('\n=== round trip, 1 KB ===');
  const s = await svc.deriveSession(clientPub, Date.now());
  const server = new SecureSession({
    tx: Buffer.from(s.tx),
    rx: Buffer.from(s.rx),
    kid: s.kid,
  });
  const client = new SecureSession({
    tx: Buffer.from(s.rx),
    rx: Buffer.from(s.tx),
    kid: s.kid,
  });
  const msg = Buffer.alloc(1024, 1);
  await measure('new: seal + open', 20000, () => {
    client.open(server.seal(msg).bytes);
  });
});
