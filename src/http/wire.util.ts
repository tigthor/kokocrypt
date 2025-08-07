import * as sodiumNative from 'sodium-native';

export interface WireBox {
  iv: string; // base64 nonce
  data: string; // base64 ciphertext (MAC included)
  kid: string; // key id or 'session'
  ts: number; // unix ms
}

/**
 * Convert a combined encrypted buffer (nonce + ciphertext) into a structured wire box
 */
export function toWireBox(
  combinedEncrypted: Buffer,
  kid: string,
  ts: number
): WireBox {
  const nonce = combinedEncrypted.slice(
    0,
    sodiumNative.crypto_secretbox_NONCEBYTES
  );
  const ciphertext = combinedEncrypted.slice(
    sodiumNative.crypto_secretbox_NONCEBYTES
  );
  return {
    iv: nonce.toString('base64'),
    data: ciphertext.toString('base64'),
    kid,
    ts,
  };
}

/**
 * Combine a structured wire box back into a single buffer (nonce + ciphertext)
 */
export function fromWireBox(box: WireBox): Buffer {
  const { iv, data } = box;
  const nonce = Buffer.from(iv, 'base64');
  const ciphertext = Buffer.from(data, 'base64');
  const combined = Buffer.allocUnsafe(nonce.length + ciphertext.length);
  nonce.copy(combined, 0);
  ciphertext.copy(combined, nonce.length);
  return combined;
}

export function isWireBox(value: unknown): value is WireBox {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<Record<keyof WireBox, unknown>>;
  return (
    typeof candidate.iv === 'string' &&
    typeof candidate.data === 'string' &&
    typeof candidate.kid === 'string' &&
    typeof candidate.ts === 'number'
  );
}
