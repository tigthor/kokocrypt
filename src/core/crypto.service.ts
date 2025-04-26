import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sodiumNative from 'sodium-native';
import { KeyProvider } from '../providers/key-provider';

@Injectable()
export class CryptoService {
  constructor(
    private readonly provider: KeyProvider,
    private readonly configService: ConfigService
  ) {}

  async ready() {
    return this.provider.getCurrentKey();
  }

  async boxRaw(message: Buffer, key: Buffer): Promise<Buffer> {
    const nonce = Buffer.allocUnsafe(sodiumNative.crypto_secretbox_NONCEBYTES);
    sodiumNative.randombytes_buf(nonce);

    const ciphertext = Buffer.allocUnsafe(
      message.length + sodiumNative.crypto_secretbox_MACBYTES
    );
    sodiumNative.crypto_secretbox_easy(ciphertext, message, nonce, key);

    // Combine nonce and ciphertext
    const result = Buffer.allocUnsafe(nonce.length + ciphertext.length);
    nonce.copy(result, 0);
    ciphertext.copy(result, nonce.length);

    return result;
  }

  async unboxRaw(encryptedMessage: Buffer, key: Buffer): Promise<Buffer> {
    if (
      encryptedMessage.length <
      sodiumNative.crypto_secretbox_NONCEBYTES +
        sodiumNative.crypto_secretbox_MACBYTES
    ) {
      throw new Error('Invalid encrypted message length');
    }

    // Extract nonce and ciphertext
    const nonce = encryptedMessage.slice(
      0,
      sodiumNative.crypto_secretbox_NONCEBYTES
    );
    const ciphertext = encryptedMessage.slice(
      sodiumNative.crypto_secretbox_NONCEBYTES
    );

    const message = Buffer.allocUnsafe(
      ciphertext.length - sodiumNative.crypto_secretbox_MACBYTES
    );

    if (
      !sodiumNative.crypto_secretbox_open_easy(message, ciphertext, nonce, key)
    ) {
      throw new Error('Decryption failed');
    }

    return message;
  }

  async deriveSession(clientPublicKey: Buffer, ts: number) {
    const { key: serverKey } = await this.provider.getCurrentKey();
    const serverPrivateKey = serverKey.subarray(0, 32);
    const serverPublicKey = serverKey.subarray(32);

    const rx = Buffer.allocUnsafe(32);
    const tx = Buffer.allocUnsafe(32);

    sodiumNative.crypto_kx_keypair(serverPublicKey, serverPrivateKey);
    sodiumNative.crypto_kx_server_session_keys(
      rx,
      tx,
      serverPublicKey,
      serverPrivateKey,
      clientPublicKey
    );

    return {
      rx,
      tx,
      kid: 'session',
      ts,
    };
  }
}
