import { Injectable } from '@nestjs/common';
import { CryptoService } from '../core/crypto.service';
import { AlgorithmType } from '../types/algorithm.type';

@Injectable()
export class EnhancedKafkaService {
  constructor(private readonly cryptoService: CryptoService) {}
  
  async encryptKafkaMessage(message: any, key: Buffer): Promise<Buffer> {
    const messageBuffer = Buffer.from(JSON.stringify(message));
    return this.cryptoService.boxRaw(messageBuffer, key);
  }
  
  async decryptKafkaMessage(encryptedMessage: Buffer, key: Buffer): Promise<any> {
    const decrypted = await this.cryptoService.unboxRaw(encryptedMessage, key);
    return JSON.parse(decrypted.toString());
  }
  
  async encryptKafkaMessages(messages: any[], key: Buffer): Promise<Buffer[]> {
    const messageBuffers = messages.map(msg => Buffer.from(JSON.stringify(msg)));
    return this.cryptoService.batchEncrypt(messageBuffers, key);
  }
  
  async decryptKafkaMessages(encryptedMessages: Buffer[], key: Buffer): Promise<any[]> {
    const decrypted = await this.cryptoService.batchDecrypt(encryptedMessages, key);
    return decrypted
      .filter(buf => buf.length > 0)
      .map(buf => JSON.parse(buf.toString()));
  }
  
  async encryptSensitiveKafkaMessage(message: any): Promise<{
    ciphertext: Buffer;
    encapsulatedKey: Buffer;
  }> {
    const messageBuffer = Buffer.from(JSON.stringify(message));
    return this.cryptoService.encryptKyber(messageBuffer);
  }
  
  async decryptSensitiveKafkaMessage(
    ciphertext: Buffer,
    encapsulatedKey: Buffer,
    privateKey: Buffer
  ): Promise<any> {
    const decrypted = await this.cryptoService.decryptKyber(
      ciphertext,
      encapsulatedKey,
      privateKey
    );
    return JSON.parse(decrypted.toString());
  }
}
