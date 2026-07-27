// jest's node environment builds a fresh global object that does not carry
// node's webcrypto across. libsodium probes for a csprng at load time and
// refuses to initialise without one, so put it back before anything imports it
import { webcrypto } from 'node:crypto';

if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

// libsodium looks for `window` or `self` before it tries require('crypto'),
// and jest's sandbox gives it neither, so it decides there is no csprng
if ((globalThis as Record<string, unknown>).self === undefined) {
  Object.defineProperty(globalThis, 'self', {
    value: globalThis,
    configurable: true,
    writable: true,
  });
}
