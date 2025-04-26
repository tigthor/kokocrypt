import { Controller, Get } from '@nestjs/common';
import { KeyProvider } from '../providers/key-provider';

@Controller('.well-known')
export class HandshakeController {
  constructor(private provider: KeyProvider) {}

  @Get('koko-enc-key')
  async pub() {
    const { key, kid } = await this.provider.getCurrentKey();
    const pub = key.subarray(32); // first 32 = sk, last 32 = pk (libsodium convention)
    return {
      kid,
      pub: Buffer.from(pub).toString('base64')
    };
  }
} 