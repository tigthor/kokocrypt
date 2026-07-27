import * as sodiumNative from 'sodium-native';
import {
  SecureSession,
  SessionError,
  NONCE_BYTES,
  TAG_BYTES,
} from '../src/core/secure-session';
import {
  generateMasterKey,
  parseMasterKey,
  masterKeyFromSecret,
  MASTER_KEY_BYTES,
} from '../src/core/keypair';

/** two sessions wired to each other, the way a real handshake leaves them */
function pair() {
  const a = Buffer.allocUnsafe(32);
  const b = Buffer.allocUnsafe(32);
  sodiumNative.randombytes_buf(a);
  sodiumNative.randombytes_buf(b);

  const server = new SecureSession({ tx: a, rx: b, kid: 'k1' });
  const client = new SecureSession({
    tx: b,
    rx: a,
    kid: 'k1',
    txPrefix: undefined,
  });
  return { server, client };
}

describe('SecureSession', () => {
  it('round trips', () => {
    const { server, client } = pair();
    const out = client.open(server.seal(Buffer.from('hello there')).bytes);
    expect(out.toString()).toBe('hello there');
  });

  it('round trips an empty message', () => {
    const { server, client } = pair();
    expect(client.open(server.seal(Buffer.alloc(0)).bytes).length).toBe(0);
  });

  it('round trips a large message', () => {
    const { server, client } = pair();
    const msg = Buffer.alloc(256 * 1024, 0xcd);
    expect(client.open(server.seal(msg).bytes).equals(msg)).toBe(true);
  });

  it('never emits the plaintext', () => {
    const { server } = pair();
    const msg = Buffer.from('this must not appear anywhere');
    expect(server.seal(msg).bytes.includes(msg)).toBe(false);
  });

  it('counts up and never repeats a nonce', () => {
    const { server } = pair();
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const { bytes, counter } = server.seal(Buffer.from('x'));
      expect(counter).toBe(BigInt(i));
      seen.add(bytes.subarray(0, NONCE_BYTES).toString('hex'));
    }
    // a counter cannot collide, unlike 24 random bytes which have a birthday bound
    expect(seen.size).toBe(5000);
  });

  it('keeps one prefix for the whole session', () => {
    const { server } = pair();
    const first = server
      .seal(Buffer.from('a'))
      .bytes.subarray(0, 16)
      .toString('hex');
    const later = server
      .seal(Buffer.from('b'))
      .bytes.subarray(0, 16)
      .toString('hex');
    expect(later).toBe(first);
  });

  it('refuses a replayed message', () => {
    const { server, client } = pair();
    const sealed = server.seal(Buffer.from('once')).bytes;
    expect(client.open(sealed).toString()).toBe('once');
    // the same bytes a second time must not be accepted
    expect(() => client.open(sealed)).toThrow(SessionError);
    expect(() => client.open(sealed)).toThrow(/already been seen/);
  });

  it('accepts messages that arrive out of order', () => {
    const { server, client } = pair();
    const msgs = [0, 1, 2, 3, 4].map(
      i => server.seal(Buffer.from(`m${i}`)).bytes
    );
    // 3, 1, 4, 0, 2
    expect(client.open(msgs[3]).toString()).toBe('m3');
    expect(client.open(msgs[1]).toString()).toBe('m1');
    expect(client.open(msgs[4]).toString()).toBe('m4');
    expect(client.open(msgs[0]).toString()).toBe('m0');
    expect(client.open(msgs[2]).toString()).toBe('m2');
  });

  it('still refuses a replay after reordering', () => {
    const { server, client } = pair();
    const msgs = [0, 1, 2].map(i => server.seal(Buffer.from(`m${i}`)).bytes);
    client.open(msgs[2]);
    client.open(msgs[0]);
    expect(() => client.open(msgs[2])).toThrow(/already been seen/);
  });

  it('refuses a message far behind the window', () => {
    const { server, client } = pair();
    const old = server.seal(Buffer.from('old')).bytes;
    for (let i = 0; i < 100; i++)
      client.open(server.seal(Buffer.from('x')).bytes);
    expect(() => client.open(old)).toThrow(/too old/);
  });

  it('refuses a reflected message', () => {
    const { server } = pair();
    const sealed = server.seal(Buffer.from('for the client')).bytes;
    // bouncing our own ciphertext back at us must not authenticate, because
    // the direction is bound into the tag
    expect(() => server.open(sealed)).toThrow(SessionError);
  });

  it('refuses a flipped bit anywhere', () => {
    const { server, client } = pair();
    for (const at of [0, 5, NONCE_BYTES, NONCE_BYTES + 2]) {
      const sealed = server.seal(Buffer.from('a longer message body')).bytes;
      sealed[at] ^= 0x01;
      expect(() => client.open(sealed)).toThrow(SessionError);
    }
  });

  it('refuses a moved counter', () => {
    const { server, client } = pair();
    const sealed = server.seal(Buffer.from('hello')).bytes;
    // the counter is in the nonce and in the aad, so editing one breaks the tag
    sealed.writeBigUInt64BE(99n, 16);
    expect(() => client.open(sealed)).toThrow(SessionError);
  });

  it('refuses the wrong key', () => {
    const { server } = pair();
    const stranger = new SecureSession({
      tx: Buffer.alloc(32, 1),
      rx: Buffer.alloc(32, 2),
      kid: 'k1',
    });
    expect(() =>
      stranger.open(server.seal(Buffer.from('secret')).bytes)
    ).toThrow(SessionError);
  });

  it('refuses a different kid, because it is bound in', () => {
    const key = Buffer.alloc(32, 4);
    const a = new SecureSession({ tx: key, rx: key, kid: 'k1' });
    const b = new SecureSession({ tx: key, rx: key, kid: 'k2' });
    expect(() => b.open(a.seal(Buffer.from('x')).bytes)).toThrow(SessionError);
  });

  it('refuses a truncated message', () => {
    const { server, client } = pair();
    const sealed = server.seal(Buffer.from('hello')).bytes;
    expect(() =>
      client.open(sealed.subarray(0, NONCE_BYTES + TAG_BYTES - 1))
    ).toThrow(/too short/);
  });

  it('refuses a bad key length', () => {
    expect(
      () =>
        new SecureSession({
          tx: Buffer.alloc(16),
          rx: Buffer.alloc(32),
          kid: 'k',
        })
    ).toThrow(SessionError);
  });

  it('wipes its keys on close', () => {
    const { server } = pair();
    server.close();
    expect(() => server.seal(Buffer.from('x'))).toThrow(/closed/);
  });

  it('the wire format is header then body', () => {
    const { server } = pair();
    const msg = Buffer.from('0123456789');
    const { bytes } = server.seal(msg);
    expect(bytes.length).toBe(NONCE_BYTES + msg.length + TAG_BYTES);
  });
});

describe('master key', () => {
  it('generates a real keypair', () => {
    const k = generateMasterKey();
    expect(k.raw.length).toBe(MASTER_KEY_BYTES);
    expect(parseMasterKey(k.raw).publicKey.equals(k.publicKey)).toBe(true);
  });

  it('completes a 32 byte secret', () => {
    const secret = Buffer.alloc(32, 9);
    expect(parseMasterKey(secret).raw.length).toBe(MASTER_KEY_BYTES);
  });

  it('refuses 64 random bytes, which is what the docs used to imply', () => {
    const random = Buffer.allocUnsafe(64);
    sodiumNative.randombytes_buf(random);
    // the last 32 bytes are not the public key for the first 32, so every
    // handshake would have derived session keys the client could not reproduce
    expect(() => parseMasterKey(random)).toThrow(/malformed/);
  });

  it('can repair a malformed key instead of refusing to boot', () => {
    const random = Buffer.allocUnsafe(64);
    sodiumNative.randombytes_buf(random);
    const repaired = parseMasterKey(random, { repair: true });
    expect(
      repaired.publicKey.equals(
        masterKeyFromSecret(random.subarray(0, 32)).publicKey
      )
    ).toBe(true);
  });

  it('refuses a wrong length', () => {
    expect(() => parseMasterKey(Buffer.alloc(48))).toThrow(/must be 64 bytes/);
  });
});
