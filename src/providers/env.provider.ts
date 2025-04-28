import { KeyProvider, KeyResult } from './key-provider';
import sodium from 'libsodium-wrappers';
import * as crypto from 'crypto';

export class EnvKeyProvider extends KeyProvider {
  private currentKey: KeyResult | null = null;
  private keys: Map<string, Buffer> = new Map();

  async getCurrentKey(): Promise<KeyResult> {
    if (this.currentKey) return this.currentKey;

    await sodium.ready;
    const envKey = process.env.KOKO_ENCRYPTION_KEY;
    if (!envKey)
      throw new Error('KOKO_ENCRYPTION_KEY environment variable not set');

    const key = Buffer.from(envKey, 'base64');
    if (key.length !== 64)
      throw new Error('Invalid key length - must be 64 bytes');

    this.currentKey = { 
      key, 
      kid: 'env-1',
      algorithm: 'XChaCha20-Poly1305',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    this.keys.set(this.currentKey.kid, key);
    return this.currentKey;
  }

  async getKey(kid: string): Promise<Buffer | null> {
    if (!this.keys.has(kid)) {
      const current = await this.getCurrentKey();
      if (kid === current.kid) return current.key;
      return null;
    }
    return this.keys.get(kid) || null;
  }
  
  async rotateKeys(): Promise<void> {
    await sodium.ready;
    const newKid = `env-${Date.now()}`;
    const newKey = Buffer.from(crypto.randomBytes(64));
    
    this.keys.set(newKid, newKey);
    this.currentKey = {
      key: newKey,
      kid: newKid,
      algorithm: 'XChaCha20-Poly1305',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    };
  }
  
  async storeKey(key: Buffer, algorithm: string, expiresAt?: number): Promise<KeyResult> {
    const kid = `custom-${Date.now()}`;
    this.keys.set(kid, key);
    
    const keyResult = {
      key,
      kid,
      algorithm,
      createdAt: Date.now(),
      expiresAt: expiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    
    return keyResult;
  }
}
