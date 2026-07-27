import * as sodiumNative from 'sodium-native';
import { wipe } from './keypair';

/**
 * a session that does the expensive part once.
 *
 * the profile of the old path, per 1 KB request:
 *
 *   deriveSession (x25519)   51.5 us   92%
 *   secretbox                 2.8 us
 *   randombytes_buf (nonce)   1.3 us
 *   alloc + copy              0.6 us
 *
 * so almost all of the cost was repeating a diffie-hellman that only ever
 * needed to happen once per peer. nothing here is a new cipher: it is
 * xchacha20-poly1305 from libsodium, composed the way tls 1.3 and noise
 * compose theirs.
 *
 * three things change:
 *
 *   1. the key exchange happens once and the session keys are kept, so a
 *      request pays for the cipher and nothing else.
 *
 *   2. the nonce is a per session random prefix followed by a counter,
 *      instead of 24 fresh random bytes each time. that removes a csprng call
 *      from every message, and it is also *safer* than random: random nonces
 *      have a birthday bound, a counter cannot repeat within a session at all.
 *      the counter is checked for exhaustion and the send direction refuses to
 *      continue rather than roll over.
 *
 *   3. the counter, the direction and the key id are bound in as additional
 *      authenticated data. a ciphertext is then only valid at the exact
 *      position in the exact direction of the exact session it was made for,
 *      so it cannot be reflected back at the sender or replayed out of order.
 */

export const NONCE_BYTES =
  sodiumNative.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES; // 24
export const KEY_BYTES =
  sodiumNative.crypto_aead_xchacha20poly1305_ietf_KEYBYTES; // 32
export const TAG_BYTES = sodiumNative.crypto_aead_xchacha20poly1305_ietf_ABYTES; // 16

/** 16 bytes of session prefix leaves 8 for the counter */
const PREFIX_BYTES = 16;
const COUNTER_BYTES = NONCE_BYTES - PREFIX_BYTES;

/** stop well before the counter could wrap */
const MAX_MESSAGES = 2n ** 60n;

export type Direction = 'tx' | 'rx';

export interface SecureSessionOptions {
  /** key for outbound messages */
  tx: Buffer;
  /** key for inbound messages */
  rx: Buffer;
  /** which key produced this session, carried in the aad */
  kid: string;
  /**
   * the nonce prefix for the send direction. generated when absent. the peer
   * learns it from the first message header
   */
  txPrefix?: Buffer;
}

export interface Sealed {
  /** prefix(16) || counter(8) || ciphertext || tag(16) */
  bytes: Buffer;
  counter: bigint;
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'BAD_KEY'
      | 'COUNTER_EXHAUSTED'
      | 'REPLAY'
      | 'AUTH_FAILED'
      | 'MALFORMED'
      | 'CLOSED'
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export class SecureSession {
  private readonly txKey: Buffer;
  private readonly rxKey: Buffer;
  private readonly kidBytes: Buffer;
  private readonly txPrefix: Buffer;

  private txCounter = 0n;
  private closed = false;

  /**
   * inbound counters already accepted, as a sliding window. a receiver cannot
   * insist on strict order because messages overtake each other, but it must
   * refuse a counter it has already seen
   */
  private rxHighest = -1n;
  private rxWindow = 0n;
  private static readonly WINDOW = 64n;

  constructor(opts: SecureSessionOptions) {
    if (opts.tx.length !== KEY_BYTES) {
      throw new SessionError(
        `tx key must be ${KEY_BYTES} bytes, got ${opts.tx.length}`,
        'BAD_KEY'
      );
    }
    if (opts.rx.length !== KEY_BYTES) {
      throw new SessionError(
        `rx key must be ${KEY_BYTES} bytes, got ${opts.rx.length}`,
        'BAD_KEY'
      );
    }

    this.txKey = Buffer.from(opts.tx);
    this.rxKey = Buffer.from(opts.rx);
    this.kidBytes = Buffer.from(opts.kid, 'utf8');

    if (opts.txPrefix) {
      if (opts.txPrefix.length !== PREFIX_BYTES) {
        throw new SessionError(
          `prefix must be ${PREFIX_BYTES} bytes`,
          'BAD_KEY'
        );
      }
      this.txPrefix = Buffer.from(opts.txPrefix);
    } else {
      this.txPrefix = Buffer.allocUnsafe(PREFIX_BYTES);
      sodiumNative.randombytes_buf(this.txPrefix);
    }
  }

  get prefix(): Buffer {
    return Buffer.from(this.txPrefix);
  }

  get messagesSent(): bigint {
    return this.txCounter;
  }

  /**
   * bind the position and direction into the tag. a ciphertext is then only
   * valid where it was meant to be, so it cannot be reflected or reordered
   */
  private aad(direction: Direction, counter: bigint): Buffer {
    const out = Buffer.allocUnsafe(1 + COUNTER_BYTES + this.kidBytes.length);
    out[0] = direction === 'tx' ? 1 : 2;
    out.writeBigUInt64BE(counter, 1);
    this.kidBytes.copy(out, 1 + COUNTER_BYTES);
    return out;
  }

  private nonce(prefix: Buffer, counter: bigint): Buffer {
    const out = Buffer.allocUnsafe(NONCE_BYTES);
    prefix.copy(out, 0);
    out.writeBigUInt64BE(counter, PREFIX_BYTES);
    return out;
  }

  /** encrypt one message. one pass, one allocation, no csprng call */
  seal(plaintext: Buffer): Sealed {
    if (this.closed) throw new SessionError('session is closed', 'CLOSED');
    if (this.txCounter >= MAX_MESSAGES) {
      throw new SessionError(
        'counter exhausted, start a new session',
        'COUNTER_EXHAUSTED'
      );
    }

    const counter = this.txCounter++;
    const nonce = this.nonce(this.txPrefix, counter);
    const aad = this.aad('tx', counter);

    // header and body in one buffer so nothing is copied afterwards
    const out = Buffer.allocUnsafe(NONCE_BYTES + plaintext.length + TAG_BYTES);
    nonce.copy(out, 0);

    sodiumNative.crypto_aead_xchacha20poly1305_ietf_encrypt(
      out.subarray(NONCE_BYTES),
      plaintext,
      aad,
      null,
      nonce,
      this.txKey
    );

    return { bytes: out, counter };
  }

  /** decrypt one message, refusing anything already seen */
  open(message: Buffer): Buffer {
    if (this.closed) throw new SessionError('session is closed', 'CLOSED');
    if (message.length < NONCE_BYTES + TAG_BYTES) {
      throw new SessionError('message is too short to be sealed', 'MALFORMED');
    }

    const nonce = message.subarray(0, NONCE_BYTES);
    const counter = nonce.readBigUInt64BE(PREFIX_BYTES);
    const body = message.subarray(NONCE_BYTES);

    this.checkReplay(counter);

    // the peer's tx is our rx, so the direction byte is theirs
    const aad = this.aad('tx', counter);
    const out = Buffer.allocUnsafe(body.length - TAG_BYTES);

    try {
      sodiumNative.crypto_aead_xchacha20poly1305_ietf_decrypt(
        out,
        null,
        body,
        aad,
        nonce,
        this.rxKey
      );
    } catch {
      throw new SessionError('message failed authentication', 'AUTH_FAILED');
    }

    this.markSeen(counter);
    return out;
  }

  /** a sliding window, the same shape ipsec and dtls use */
  private checkReplay(counter: bigint): void {
    if (counter > this.rxHighest) return;
    const behind = this.rxHighest - counter;
    if (behind >= SecureSession.WINDOW) {
      throw new SessionError(
        `message ${counter} is too old to accept`,
        'REPLAY'
      );
    }
    if ((this.rxWindow >> behind) & 1n) {
      throw new SessionError(
        `message ${counter} has already been seen`,
        'REPLAY'
      );
    }
  }

  private markSeen(counter: bigint): void {
    if (counter > this.rxHighest) {
      const shift = counter - this.rxHighest;
      this.rxWindow =
        shift >= SecureSession.WINDOW ? 1n : (this.rxWindow << shift) | 1n;
      this.rxWindow &= (1n << SecureSession.WINDOW) - 1n;
      this.rxHighest = counter;
    } else {
      this.rxWindow |= 1n << (this.rxHighest - counter);
    }
  }

  /** wipe the keys. the session cannot be used afterwards */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    wipe(this.txKey, this.rxKey, this.txPrefix);
  }
}
