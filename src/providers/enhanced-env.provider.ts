import { Injectable } from '@nestjs/common';
import { KeyProvider, KeyResult } from './key-provider';
import sodium from 'libsodium-wrappers';

@Injectable()
export class EnhancedEnvKeyProvider extends KeyProvider {
  private keys: Map<string, KeyResult> = new Map();
  private currentKeyId: string = '';
  private readonly KEY_VALIDITY_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  /**
   * initialisation is async, so it cannot happen in the constructor. calling
   * it there left the rejection unhandled, which in node crashes the process
   * asynchronously instead of surfacing at the call site. the promise is kept
   * so concurrent callers share one initialisation rather than racing.
   */
  private initialising: Promise<void> | null = null;

  private async ready(): Promise<void> {
    if (this.currentKeyId !== '') return;
    this.initialising ??= this.initializeFromEnv().catch((e: unknown) => {
      // let the next caller try again rather than caching the failure
      this.initialising = null;
      throw e;
    });
    await this.initialising;
  }

  private async initializeFromEnv() {
    await sodium.ready;
    const envKey = process.env.KOKOCRYPT_MASTER_KEY;
    if (!envKey) {
      throw new Error('KOKOCRYPT_MASTER_KEY environment variable not set');
    }

    const key = Buffer.from(envKey, 'base64');
    if (key.length !== 64) {
      throw new Error('Invalid key length - must be 64 bytes');
    }

    const now = Date.now();
    const keyResult: KeyResult = {
      key,
      kid: `env-${now}`,
      algorithm: 'XChaCha20-Poly1305',
      createdAt: now,
      expiresAt: now + this.KEY_VALIDITY_PERIOD,
    };

    this.keys.set(keyResult.kid, keyResult);
    this.currentKeyId = keyResult.kid;
  }

  async getCurrentKey(): Promise<KeyResult> {
    await this.ready();

    let currentKey = this.keys.get(this.currentKeyId);
    if (!currentKey) {
      throw new Error('no current key after initialisation');
    }

    if (currentKey.expiresAt && currentKey.expiresAt < Date.now()) {
      await this.rotateKeys();
      currentKey = this.keys.get(this.currentKeyId);
      // rotateKeys always sets a fresh key, so this is a guard not a loop
      if (!currentKey) throw new Error('no current key after rotation');
    }

    return currentKey;
  }

  async getKey(kid: string): Promise<Buffer | null> {
    await this.ready();
    const keyResult = this.keys.get(kid);
    return keyResult ? keyResult.key : null;
  }

  async rotateKeys(): Promise<void> {
    await sodium.ready;
    const keypair = sodium.crypto_kx_keypair();
    const newKey = Buffer.concat([keypair.privateKey, keypair.publicKey]);

    const now = Date.now();
    const keyResult: KeyResult = {
      key: newKey,
      kid: `env-${now}`,
      algorithm: 'XChaCha20-Poly1305',
      createdAt: now,
      expiresAt: now + this.KEY_VALIDITY_PERIOD,
    };

    this.keys.set(keyResult.kid, keyResult);
    this.currentKeyId = keyResult.kid;

    for (const [kid, key] of this.keys.entries()) {
      if (key.expiresAt && key.expiresAt < now - 24 * 60 * 60 * 1000) {
        this.keys.delete(kid);
      }
    }
  }

  async storeKey(
    key: Buffer,
    algorithm: string,
    expiresAt?: number
  ): Promise<KeyResult> {
    const now = Date.now();
    const keyResult: KeyResult = {
      key,
      kid: `custom-${now}`,
      algorithm,
      createdAt: now,
      expiresAt: expiresAt || now + this.KEY_VALIDITY_PERIOD,
    };

    this.keys.set(keyResult.kid, keyResult);
    return keyResult;
  }
}
