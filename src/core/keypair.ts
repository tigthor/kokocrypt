import * as sodiumNative from 'sodium-native';

/**
 * a kokocrypt master key is 64 bytes: an x25519 secret key followed by its
 * matching public key.
 *
 * nothing used to check that the second half really was the public key for
 * the first. generating 64 random bytes, which is what the docs implied, gave
 * a key whose public half was meaningless, so every handshake derived session
 * keys the client could not reproduce, silently.
 */
export const MASTER_KEY_BYTES = 64;
export const SECRET_KEY_BYTES = 32;

export interface MasterKey {
  secretKey: Buffer;
  publicKey: Buffer;
  /** the full 64 byte form */
  raw: Buffer;
}

/** derive the public half from a 32 byte secret, giving the 64 byte form */
export function masterKeyFromSecret(secretKey: Buffer): MasterKey {
  if (secretKey.length !== SECRET_KEY_BYTES) {
    throw new Error(
      `secret key must be ${SECRET_KEY_BYTES} bytes, got ${secretKey.length}`
    );
  }
  const raw = Buffer.allocUnsafe(MASTER_KEY_BYTES);
  secretKey.copy(raw, 0);
  const publicKey = raw.subarray(SECRET_KEY_BYTES);
  sodiumNative.crypto_scalarmult_base(publicKey, secretKey);
  return { secretKey: raw.subarray(0, SECRET_KEY_BYTES), publicKey, raw };
}

/** a fresh master key */
export function generateMasterKey(): MasterKey {
  const secret = Buffer.allocUnsafe(SECRET_KEY_BYTES);
  sodiumNative.randombytes_buf(secret);
  return masterKeyFromSecret(secret);
}

export interface ParseOptions {
  /**
   * when the public half does not match the secret, recompute it instead of
   * throwing. keeps existing deployments booting, and the corrected key is
   * what gets used
   */
  repair?: boolean;
}

/**
 * take a 64 byte key and make sure the halves actually belong together.
 * a 32 byte input is accepted and completed
 */
export function parseMasterKey(
  raw: Buffer,
  opts: ParseOptions = {}
): MasterKey {
  if (raw.length === SECRET_KEY_BYTES) return masterKeyFromSecret(raw);

  if (raw.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `master key must be ${MASTER_KEY_BYTES} bytes (secret||public) or ${SECRET_KEY_BYTES} bytes (secret), got ${raw.length}`
    );
  }

  const derived = masterKeyFromSecret(raw.subarray(0, SECRET_KEY_BYTES));
  const given = raw.subarray(SECRET_KEY_BYTES);

  // constant time, so a wrong key cannot be probed byte by byte
  if (sodiumNative.sodium_memcmp(derived.publicKey, given)) return derived;

  if (opts.repair) return derived;

  throw new Error(
    'master key is malformed: the last 32 bytes are not the public key for the first 32. ' +
      'generate one with generateMasterKey(), or pass { repair: true } to recompute it'
  );
}

/** wipe key material rather than waiting for the collector */
export function wipe(
  ...buffers: Array<Buffer | Uint8Array | undefined | null>
): void {
  for (const b of buffers) {
    if (b && b.length > 0) sodiumNative.sodium_memzero(b as Buffer);
  }
}
