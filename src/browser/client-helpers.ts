import * as sodium from 'libsodium-wrappers';
import { WireBox } from '../http/wire.util';

/**
 * Create a WireBox from a browser crypto_box payload (nonce + ciphertext)
 */
export function toWireBoxFromBrowser(
  combinedBase64: string,
  kid: string,
  ts: number
): WireBox {
  const combined = sodium.from_base64(combinedBase64);
  const nonce = combined.slice(0, sodium.crypto_box_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_box_NONCEBYTES);
  return {
    iv: sodium.to_base64(nonce),
    data: sodium.to_base64(ciphertext),
    kid,
    ts,
  };
}

/**
 * Combine a WireBox back into nonce + ciphertext base64 for browser usage
 */
export function fromWireBoxToBrowser(box: WireBox): string {
  const nonce = sodium.from_base64(box.iv);
  const ciphertext = sodium.from_base64(box.data);
  const full = new Uint8Array(nonce.length + ciphertext.length);
  full.set(nonce);
  full.set(ciphertext, nonce.length);
  return sodium.to_base64(full);
}
