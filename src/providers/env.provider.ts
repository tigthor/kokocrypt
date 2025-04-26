import { KeyProvider, KeyResult } from './key-provider';
import sodium from 'libsodium-wrappers';

export class EnvKeyProvider extends KeyProvider {
  private currentKey: KeyResult | null = null;

  async getCurrentKey(): Promise<KeyResult> {
    if (this.currentKey) return this.currentKey;

    await sodium.ready;
    const envKey = process.env.KOKO_ENCRYPTION_KEY;
    if (!envKey)
      throw new Error('KOKO_ENCRYPTION_KEY environment variable not set');

    const key = Buffer.from(envKey, 'base64');
    if (key.length !== 64)
      throw new Error('Invalid key length - must be 64 bytes');

    this.currentKey = { key, kid: 'env-1' };
    return this.currentKey;
  }

  async getKey(kid: string): Promise<Buffer | null> {
    const current = await this.getCurrentKey();
    return kid === current.kid ? current.key : null;
  }
}
