import { Controller, Get } from '@nestjs/common';
import { KeyProvider } from '../providers/key-provider';
import { CryptoService } from '../core/crypto.service';

@Controller('.well-known')
export class HandshakeController {
  constructor(
    private provider: KeyProvider,
    private crypto: CryptoService
  ) {}

  @Get('koko-enc-key')
  async pub() {
    const { key, kid } = await this.crypto.getCurrentKey();
    const pub = key.subarray(32); // first 32 = sk, last 32 = pk (libsodium convention)
    return {
      kid,
      pub: Buffer.from(pub).toString('base64'),
    };
  }
}
