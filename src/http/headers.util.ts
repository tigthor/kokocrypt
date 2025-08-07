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

export function verifyKokoHeaders(
  headers: Record<string, any>,
  replayGuard: ReplayGuard,
  hmacSecret?: string
): boolean {
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
    if (expected !== sig) return false;
  }

  // Use EPK as a nonce token for replay guard window check
  return replayGuard.check(ts, String(epk));
}
