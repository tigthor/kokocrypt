import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface KeyResult {
  key: Buffer;
  kid: string;
  algorithm?: string;
  createdAt?: number;
  expiresAt?: number;
}

@Injectable()
export abstract class KeyProvider {
  abstract getCurrentKey(): Promise<KeyResult>;
  abstract getKey(kid: string): Promise<Buffer | null>;
  abstract rotateKeys(): Promise<void>;
  abstract storeKey(key: Buffer, algorithm: string, expiresAt?: number): Promise<KeyResult>;
}
