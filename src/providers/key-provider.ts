import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface KeyResult {
  key: Buffer;
  kid: string;
}

@Injectable()
export abstract class KeyProvider {
  abstract getCurrentKey(): Promise<KeyResult>;
  abstract getKey(kid: string): Promise<Buffer | null>;
}
