import { ReplayGuard } from '../core/replay.guard';
import * as crypto from 'crypto';

export interface KokoHeaders {
  'x-client-epk': string;
  'x-client-ts': string | number;
  'x-client-sig'?: string;
}

export function buildKokoHeaders(
  clientEphemeralPublicKeyBase64: string,
  ts: number = Date.now(),
  hmacSecret?: string
): KokoHeaders {
  const headers: KokoHeaders = {
    'x-client-epk': clientEphemeralPublicKeyBase64,
    'x-client-ts': ts,
  };
  if (hmacSecret) {
    const h = crypto
      .createHmac('sha256', hmacSecret)
      .update(`${ts}.${clientEphemeralPublicKeyBase64}`)
      .digest('base64');
    headers['x-client-sig'] = h;
  }
  return headers;
}

/** constant time, so a signature cannot be guessed a byte at a time */
function sameSignature(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  // the length is not secret, and timingSafeEqual throws when they differ
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function verifyKokoHeaders(
  headers: Record<string, any>,
  replayGuard: ReplayGuard,
  hmacSecret?: string
): Promise<boolean> {
  const epk = headers['x-client-epk'];
  const tsRaw = headers['x-client-ts'];
  const sig = headers['x-client-sig'];
  const ts = Number(tsRaw);
  if (!epk || !Number.isFinite(ts)) return false;

  if (hmacSecret) {
    const expected = crypto
      .createHmac('sha256', hmacSecret)
      .update(`${ts}.${epk}`)
      .digest('base64');
    // this used to be `expected !== sig`, which leaks how much of the
    // signature was correct through how long the comparison ran
    if (!sameSignature(expected, sig)) return false;
  }

  // the ephemeral public key doubles as the replay nonce. awaited because the
  // store may live in redis rather than this process
  return await replayGuard.check(ts, String(epk));
}
