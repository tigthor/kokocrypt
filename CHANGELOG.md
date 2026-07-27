# changelog

## 2.1.0

### the handshake never worked

**`deriveSession` destroyed the master key on every call.** it began with

```ts
const serverPrivateKey = serverKey.subarray(0, 32); // views into the master key
const serverPublicKey = serverKey.subarray(32);
sodiumNative.crypto_kx_keypair(serverPublicKey, serverPrivateKey);
```

`crypto_kx_keypair(pk, sk)` _generates_ a new keypair into those buffers, and
they are `subarray` views of the provider's key. so every handshake overwrote
`KOKOCRYPT_MASTER_KEY` in memory with random bytes. proven:

```
master mutated by deriveSession   : true
mutated again on the second call  : true
same client, same session key     : false
```

consequences: the server never held a stable identity, the public key served
at `/.well-known/koko-enc-key` was stale as soon as anything else ran, and
anything encrypted under the previous key became unrecoverable. the fix is
removing that line — the stored keypair was meant to be used, not replaced.

**nothing checked the master key was a real keypair.** the 64 bytes are
`secret(32) || public(32)`, but any 64 bytes were accepted. generating 64
random bytes, which is what the docs implied, gave a key whose public half was
meaningless, so sessions derived silently wrong. new `parseMasterKey` verifies
the halves belong together in constant time, `generateMasterKey` produces a
correct one, and a 32 byte secret is completed automatically.

**`deriveSession` returns the real `kid`.** it used to return the literal
string `'session'`, which told you nothing about which key derived it.

### faster

**`SecureSession` — up to 21x.** profiling a 1 KB request found the cost was
not the cipher:

```
deriveSession (x25519)   51.5 us   92%
secretbox                 2.8 us
randombytes_buf (nonce)   1.3 us
alloc + copy              0.6 us
```

almost all of it was repeating a diffie-hellman that only needed to happen
once per peer. `SecureSession` keeps the session keys, derives nonces from a
per session prefix plus a counter instead of calling the csprng per message,
binds the counter, direction and kid as additional authenticated data, and
writes header and body into one allocation.

| payload | chained | SecureSession |           |
| ------- | ------- | ------------- | --------- |
| 256 B   | 41.2 us | **1.94 us**   | **21.2x** |
| 1 KB    | 41.5 us | **3.72 us**   | **11.2x** |
| 16 KB   | 83.7 us | **36.5 us**   | 2.3x      |

24k to **514k ops/s** at 256 bytes. the win shrinks on large payloads because
there the cipher genuinely dominates.

no new primitive is involved. it is xchacha20-poly1305 from libsodium composed
the way tls 1.3 and noise compose theirs. the counter nonce is also _safer_
than a random one — random 24 byte nonces carry a birthday bound, a counter
cannot repeat within a session at all, and the send side refuses to continue
rather than wrap. a sliding window of 64, the shape ipsec and dtls use, lets
messages arrive out of order while still refusing anything already seen.

### replay protection

- **bounded.** the `seen` map had no size limit, so unique nonces at request
  rate were a way to exhaust memory. now capped, oldest evicted first.
- **works in a cluster.** it was an in-process `Map`, so a replay sent to a
  different worker was accepted. `ReplayStore` is pluggable — hand it redis.
- **the nonce alone is the key.** it was `` `${ts}:${nonce}` ``, so changing
  the timestamp made a replay look new.
- **future timestamps are bounded separately.** `Math.abs` allowed the whole
  window forwards too.
- **11 tests.** it previously had none, despite being the anti-replay control.

### fixed

- **`verifyKokoHeaders` compared the hmac signature with `!==`.** that leaks
  how much of the signature was correct through how long the comparison took.
  now `crypto.timingSafeEqual`.
- **coverage was measuring nothing.** `collectCoverageFrom: ['**/*.(t|j)s']`
  swept in `dist/*.d.ts`, so the reported 12.53% was fiction. scoped to `src`,
  the real number is **46.4%**.

### added

- `SecureSession`, `generateMasterKey`, `parseMasterKey`, `masterKeyFromSecret`,
  `wipe`, `MemoryReplayStore`.
- key material is zeroed with `sodium_memzero` on `close()` rather than left
  for the collector.
- 94 tests, up from 58.

### note

`encryptAesGcm` and `decryptAesGcm` do **not** use AES-GCM — they call
`crypto_aead_xchacha20poly1305_ietf_*`. xchacha20-poly1305 is a good choice,
but the names are wrong and will be renamed in 3.0.0 with deprecated aliases.
do not cite them as AES-GCM in a compliance answer.

## 2.0.0

### breaking

**`batchDecrypt` now throws when a message fails to decrypt.**

it used to catch the failure and put `Buffer.from('')` in that slot. a caller
looping over the results could not tell a genuinely empty message from one
whose authentication tag did not match, so a tampered entry became silent data
loss instead of an error. the thrown message names the index:

```
batchDecrypt failed for message 1: Decryption failed
```

if you were relying on the old behaviour, wrap the call and decide what an
unauthenticated message should mean for you — but do not treat it as empty.

**`encryptKyber` returns a `kid`.**

```ts
// before
{ ciphertext: Buffer, encapsulatedKey: Buffer }
// after
{ ciphertext: Buffer, encapsulatedKey: Buffer, kid: string }
```

the method stores the kyber secret key with the key provider and used to
discard the identifier it got back, which left that key unreachable —
`decryptKyber` wants a private key the caller had no way to look up. additive,
so existing destructuring keeps working.

### fixed

- **`EnhancedEnvKeyProvider` no longer crashes the process on a bad
  configuration.** the constructor called an `async` initialiser without
  awaiting it, so a missing or malformed `KOKOCRYPT_MASTER_KEY` surfaced as an
  unhandled promise rejection — which node turns into a process exit, away from
  the call site. initialisation is now lazy and awaited, shared between
  concurrent callers, and retried after a failure rather than cached.

- **the published package installs.** `@nestjs/common`, `@nestjs/config` and
  `@nestjs/microservices` were imported by `dist/` but listed only in
  `devDependencies`, so `require('@tigthor/kokocrypt')` threw
  `MODULE_NOT_FOUND` on a clean install. they are peer dependencies now, which
  is also correct for a nest library — bundling nest gives the host two DI
  containers and providers silently fail to resolve. _(released in 1.0.2)_

- **`@nestjs/platform-express` removed.** it was a dependency but never
  imported, and it was pulling the whole `path-to-regexp` / `qs` /
  `body-parser` chain along with it. production advisories went from 8 to 0.

### security

- **0 advisories, down from 47.** every one was development scope, so no
  release ever shipped a vulnerable runtime dependency — but the toolchain is
  now current: eslint 9 with flat config, typescript-eslint 8, jest 30,
  lint-staged 17, and a `brace-expansion` override for the last transitive one.

### added

- **`n/no-extraneous-import` is enforced.** this is the lint rule that would
  have caught the broken 1.0.1 release: it fails when `src` imports something
  that is in neither `dependencies` nor `peerDependencies`.

- **a packaging workflow.** it packs the tarball and `require`s it from a clean
  directory with only the peers installed. every unit test passed while 1.0.1
  was unusable, because they all ran inside this repo where the dev tree
  exists. installing the artifact somewhere else is the only test that catches
  that.

- **26 security tests.** nonce uniqueness across 200 encryptions, ciphertext
  never containing the plaintext, rejection of the wrong key, a flipped bit in
  the ciphertext, a flipped bit in the nonce, a truncated box, two boxes
  spliced together, a fresh IV per AEAD call, per-message nonces in a batch,
  and the key provider's failure and concurrency behaviour.

  58 tests total, up from 32.

### changed

- `.eslintrc.js` → `eslint.config.js`. the old config referenced
  `eslint-plugin-node`, which is unmaintained and was not installed, so the
  pre-commit hook failed for everyone.
- lint-staged no longer type-lints root `.js` config files, which are outside
  the tsconfig project.
- tests type-check against a new `tsconfig.eslint.json`, since the build config
  excludes `test/`.

## 1.0.2

- fixed the broken install described above.

## 1.0.1

- do not use. `require` of this version fails unless the nest packages happen
  to be installed already.
