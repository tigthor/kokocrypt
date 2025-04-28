import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sodiumNative from 'sodium-native';
import sodium from 'libsodium-wrappers';
import { KeyProvider } from '../providers/key-provider';
import { AlgorithmType } from '../types/algorithm.type';

let ntru: any = null;
let liboqs: any = null;

try {
  ntru = require('ntru');
} catch (e) {
  ntru = {
    createKeyPair: () => {
      throw new Error('NTRU package is not installed. Install it with npm install ntru');
    },
    encrypt: () => {
      throw new Error('NTRU package is not installed. Install it with npm install ntru');
    },
    decrypt: () => {
      throw new Error('NTRU package is not installed. Install it with npm install ntru');
    }
  };
}

try {
  liboqs = require('liboqs-node');
} catch (e) {
  liboqs = {
    init: async () => {},
    KeyEncapsulation: class {
      constructor(algorithm: string) {
        throw new Error('liboqs-node package is not installed. Install it with npm install liboqs-node');
      }
      keypair() {
        throw new Error('liboqs-node package is not installed. Install it with npm install liboqs-node');
      }
      encapsulate(publicKey: Buffer) {
        throw new Error('liboqs-node package is not installed. Install it with npm install liboqs-node');
      }
      decapsulate(ciphertext: Buffer, privateKey: Buffer) {
        throw new Error('liboqs-node package is not installed. Install it with npm install liboqs-node');
      }
    }
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

  async getCurrentKey() {
    return this.provider.getCurrentKey();
  }

  async getKey(kid: string) {
    return this.provider.getKey(kid);
  }

  async encryptAesGcm(message: Buffer, key: Buffer): Promise<Buffer> {
    await sodium.ready;
    const nonceArray = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
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
    if (encryptedMessage.length < sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES + 16) { // nonce + min tag size
      throw new Error('Invalid encrypted message length');
    }
    
    // Extract nonce and ciphertext
    const nonce = encryptedMessage.slice(0, sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = encryptedMessage.slice(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    
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
    } catch (err) {
      throw new Error('Decryption failed');
    }
  }
  
  async encryptKyber(message: Buffer): Promise<{ ciphertext: Buffer, encapsulatedKey: Buffer }> {
    await liboqs.init();
    const kem = new liboqs.KeyEncapsulation('Kyber512');
    const keyPair = kem.keypair();
    
    const keyResult = await this.provider.storeKey(
      Buffer.from(keyPair.secret_key),
      AlgorithmType.Kyber
    );
    
    const encapsulation = kem.encapsulate(keyPair.public_key);
    
    const encrypted = await this.boxRaw(message, Buffer.from(encapsulation.shared_secret));
    
    return {
      ciphertext: encrypted,
      encapsulatedKey: Buffer.from(encapsulation.ciphertext)
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
      const nonce = Buffer.allocUnsafe(sodiumNative.crypto_secretbox_NONCEBYTES);
      sodiumNative.randombytes_buf(nonce);
      nonces.push(nonce);
    }
    
    await Promise.all(messages.map(async (message, index) => {
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
    }));
    
    return results;
  }
  
  async batchDecrypt(encryptedMessages: Buffer[], key: Buffer): Promise<Buffer[]> {
    const results: Buffer[] = [];
    
    await Promise.all(encryptedMessages.map(async (encryptedMessage, index) => {
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
          !sodiumNative.crypto_secretbox_open_easy(message, ciphertext, nonce, key)
        ) {
          throw new Error('Decryption failed');
        }
        
        results[index] = message;
      } catch (error) {
        results[index] = Buffer.from('');
      }
    }));
    
    return results;
  }
}
