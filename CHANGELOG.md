# changelog

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
