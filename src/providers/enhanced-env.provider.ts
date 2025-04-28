import { Injectable } from '@nestjs/common';
import { KeyProvider, KeyResult } from './key-provider';
import sodium from 'libsodium-wrappers';

@Injectable()
export class EnhancedEnvKeyProvider extends KeyProvider {
  private keys: Map<string, KeyResult> = new Map();
  private currentKeyId: string = '';
  private readonly KEY_VALIDITY_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  
  constructor() {
    super();
    this.initializeFromEnv();
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
      expiresAt: now + this.KEY_VALIDITY_PERIOD
    };
    
    this.keys.set(keyResult.kid, keyResult);
    this.currentKeyId = keyResult.kid;
  }
  
  async getCurrentKey(): Promise<KeyResult> {
    const currentKey = this.keys.get(this.currentKeyId);
    if (!currentKey) {
      await this.initializeFromEnv();
      return this.getCurrentKey();
    }
    
    if (currentKey.expiresAt && currentKey.expiresAt < Date.now()) {
      await this.rotateKeys();
      return this.getCurrentKey();
    }
    
    return currentKey;
  }
  
  async getKey(kid: string): Promise<Buffer | null> {
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
      expiresAt: now + this.KEY_VALIDITY_PERIOD
    };
    
    this.keys.set(keyResult.kid, keyResult);
    this.currentKeyId = keyResult.kid;
    
    for (const [kid, key] of this.keys.entries()) {
      if (key.expiresAt && key.expiresAt < now - (24 * 60 * 60 * 1000)) {
        this.keys.delete(kid);
      }
    }
  }
  
  async storeKey(key: Buffer, algorithm: string, expiresAt?: number): Promise<KeyResult> {
    const now = Date.now();
    const keyResult: KeyResult = {
      key,
      kid: `custom-${now}`,
      algorithm,
      createdAt: now,
      expiresAt: expiresAt || now + this.KEY_VALIDITY_PERIOD
    };
    
    this.keys.set(keyResult.kid, keyResult);
    return keyResult;
  }
}
