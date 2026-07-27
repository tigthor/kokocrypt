import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sodiumNative from 'sodium-native';
import sodium from 'libsodium-wrappers';
import { KeyProvider } from '../providers/key-provider';
import { AlgorithmType } from '../types/algorithm.type';

// liboqs is optional. it is only needed for the kyber methods, so it is
// required lazily and replaced with stubs that say what to install
let liboqs: any = null;

try {
  liboqs = require('liboqs-node');
} catch {
  liboqs = {
    init: async () => {},
    KeyEncapsulation: class {
      constructor(_algorithm: string) {
        throw new Error(
          'liboqs-node package is not installed. Install it with npm install liboqs-node'
        );
      }
      keypair() {
        throw new Error(
          'liboqs-node package is not installed. Install it with npm install liboqs-node'
        );
      }
      encapsulate(_publicKey: Buffer) {
        throw new Error(
          'liboqs-node package is not installed. Install it with npm install liboqs-node'
        );
      }
      decapsulate(_ciphertext: Buffer, _privateKey: Buffer) {
        throw new Error(
          'liboqs-node package is not installed. Install it with npm install liboqs-node'
        );
      }
    },
  };
}

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

  /**
   * derive the per session keys from the server long term keypair and the
   * client public key.
   *
   * this used to call crypto_kx_keypair(pk, sk) first. that generates a new
   * keypair *into* those buffers, and they are subarray views of the
   * provider's key, so every handshake overwrote the master key in place with
   * random bytes. the server never kept a stable identity, the public key
   * published at /.well-known/koko-enc-key was stale the moment anything else
   * ran, and data encrypted under the previous key became unrecoverable.
   */
  async deriveSession(clientPublicKey: Buffer, ts: number) {
    if (clientPublicKey.length !== sodiumNative.crypto_kx_PUBLICKEYBYTES) {
      throw new Error(
        `client public key must be ${sodiumNative.crypto_kx_PUBLICKEYBYTES} bytes, got ${clientPublicKey.length}`
      );
    }

    const { key: serverKey, kid } = await this.provider.getCurrentKey();
    if (serverKey.length !== 64) {
      throw new Error(
        `server key must be 64 bytes (secret||public), got ${serverKey.length}`
      );
    }

    const serverPrivateKey = serverKey.subarray(0, 32);
    const serverPublicKey = serverKey.subarray(32);

    const rx = Buffer.allocUnsafe(sodiumNative.crypto_kx_SESSIONKEYBYTES);
    const tx = Buffer.allocUnsafe(sodiumNative.crypto_kx_SESSIONKEYBYTES);

    sodiumNative.crypto_kx_server_session_keys(
      rx,
      tx,
      serverPublicKey,
      serverPrivateKey,
      clientPublicKey
    );

    return { rx, tx, kid, ts };
  }

  async getCurrentKey() {
    return this.provider.getCurrentKey();
  }

  async getKey(kid: string) {
    return this.provider.getKey(kid);
  }

  async encryptAesGcm(message: Buffer, key: Buffer): Promise<Buffer> {
    await sodium.ready;
    const nonceArray = sodium.randombytes_buf(
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    );
    const nonce = Buffer.from(nonceArray);

    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      message,
      null, // Additional data
      null, // nsec - secret nonce (unused)
      nonceArray,
      key
    );

    // Combine nonce and ciphertext
    const result = Buffer.allocUnsafe(nonce.length + ciphertext.length);
    nonce.copy(result, 0);
    Buffer.from(ciphertext).copy(result, nonce.length);

    return result;
  }

  async decryptAesGcm(encryptedMessage: Buffer, key: Buffer): Promise<Buffer> {
    if (
      encryptedMessage.length <
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES + 16
    ) {
      // nonce + min tag size
      throw new Error('Invalid encrypted message length');
    }

    // Extract nonce and ciphertext
    const nonce = encryptedMessage.slice(
      0,
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    );
    const ciphertext = encryptedMessage.slice(
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    );

    await sodium.ready;
    try {
      const decrypted = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null, // nsec - secret nonce (unused)
        ciphertext,
        null, // Additional data
        nonce,
        key
      );

      return Buffer.from(decrypted);
    } catch {
      throw new Error('Decryption failed');
    }
  }

  /**
   * the kid comes back because the secret key stays with the provider, and
   * without it the caller has no way to ask for that key again at decrypt
   * time. it used to be discarded, which left the stored key unreachable
   */
  async encryptKyber(
    message: Buffer
  ): Promise<{ ciphertext: Buffer; encapsulatedKey: Buffer; kid: string }> {
    await liboqs.init();
    const kem = new liboqs.KeyEncapsulation('Kyber512');
    const keyPair = kem.keypair();

    const keyResult = await this.provider.storeKey(
      Buffer.from(keyPair.secret_key),
      AlgorithmType.Kyber
    );

    const encapsulation = kem.encapsulate(keyPair.public_key);

    const encrypted = await this.boxRaw(
      message,
      Buffer.from(encapsulation.shared_secret)
    );

    return {
      ciphertext: encrypted,
      encapsulatedKey: Buffer.from(encapsulation.ciphertext),
      kid: keyResult.kid,
    };
  }

  async decryptKyber(
    ciphertext: Buffer,
    encapsulatedKey: Buffer,
    privateKey: Buffer
  ): Promise<Buffer> {
    await liboqs.init();
    const kem = new liboqs.KeyEncapsulation('Kyber512');

    const sharedSecret = kem.decapsulate(encapsulatedKey, privateKey);

    return this.unboxRaw(ciphertext, Buffer.from(sharedSecret));
  }

  async batchEncrypt(messages: Buffer[], key: Buffer): Promise<Buffer[]> {
    const results: Buffer[] = [];

    const nonces: Buffer[] = [];
    for (let i = 0; i < messages.length; i++) {
      const nonce = Buffer.allocUnsafe(
        sodiumNative.crypto_secretbox_NONCEBYTES
      );
      sodiumNative.randombytes_buf(nonce);
      nonces.push(nonce);
    }

    await Promise.all(
      messages.map(async (message, index) => {
        const nonce = nonces[index];
        const ciphertext = Buffer.allocUnsafe(
          message.length + sodiumNative.crypto_secretbox_MACBYTES
        );

        sodiumNative.crypto_secretbox_easy(ciphertext, message, nonce, key);

        // Combine nonce and ciphertext
        const result = Buffer.allocUnsafe(nonce.length + ciphertext.length);
        nonce.copy(result, 0);
        ciphertext.copy(result, nonce.length);

        results[index] = result;
      })
    );

    return results;
  }

  async batchDecrypt(
    encryptedMessages: Buffer[],
    key: Buffer
  ): Promise<Buffer[]> {
    const results: Buffer[] = [];

    await Promise.all(
      encryptedMessages.map(async (encryptedMessage, index) => {
        try {
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
            !sodiumNative.crypto_secretbox_open_easy(
              message,
              ciphertext,
              nonce,
              key
            )
          ) {
            throw new Error('Decryption failed');
          }

          results[index] = message;
        } catch (e) {
          // this used to swallow the failure and put an empty buffer in the
          // result. a caller looping over the batch could not tell a genuinely
          // empty message from one that failed its authentication tag, so a
          // tampered entry became silent data loss instead of an error
          throw new Error(
            `batchDecrypt failed for message ${index}: ${(e as Error).message}`
          );
        }
      })
    );

    return results;
  }
}
