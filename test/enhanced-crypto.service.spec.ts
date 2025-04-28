import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../src/core/crypto.service';
import { KeyProvider } from '../src/providers/key-provider';
import { EnhancedEnvKeyProvider } from '../src/providers/enhanced-env.provider';
import { AlgorithmType } from '../src/types/algorithm.type';
import * as sodium from 'libsodium-wrappers';
import * as crypto from 'crypto';

describe('Enhanced CryptoService', () => {
  let cryptoService: CryptoService;
  let keyProvider: EnhancedEnvKeyProvider;
  let configService: ConfigService;

  beforeAll(async () => {
    await sodium.ready;
    const randomKey = crypto.randomBytes(64);
    process.env.KOKOCRYPT_MASTER_KEY = randomKey.toString('base64');

    const moduleRef = await Test.createTestingModule({
      providers: [
        CryptoService,
        {
          provide: KeyProvider,
          useClass: EnhancedEnvKeyProvider,
        },
        EnhancedEnvKeyProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key) => {
              if (key === 'encryption.masterKey') {
                return process.env.KOKOCRYPT_MASTER_KEY;
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    cryptoService = moduleRef.get<CryptoService>(CryptoService);
    keyProvider = moduleRef.get<EnhancedEnvKeyProvider>(EnhancedEnvKeyProvider);
    configService = moduleRef.get<ConfigService>(ConfigService);
  });

  describe('Basic Encryption', () => {
    it('should encrypt and decrypt with XChaCha20-Poly1305', async () => {
      const message = Buffer.from('test message');
      const { key } = await keyProvider.getCurrentKey();
      
      const secretBoxKey = key.slice(0, 32);

      const encrypted = await cryptoService.boxRaw(message, secretBoxKey);
      const decrypted = await cryptoService.unboxRaw(encrypted, secretBoxKey);

      expect(decrypted.toString()).toBe(message.toString());
    });

    it('should encrypt and decrypt with AES-GCM equivalent', async () => {
      const message = Buffer.from('test message for AES-GCM');
      const { key } = await keyProvider.getCurrentKey();
      
      const aesKey = key.slice(0, 32);

      const encrypted = await cryptoService.encryptAesGcm(message, aesKey);
      const decrypted = await cryptoService.decryptAesGcm(encrypted, aesKey);

      expect(decrypted.toString()).toBe(message.toString());
    });

    it('should throw error when decrypting invalid data', async () => {
      const { key } = await keyProvider.getCurrentKey();
      const secretBoxKey = key.slice(0, 32);
      const invalidData = Buffer.from('invalid data');

      await expect(cryptoService.unboxRaw(invalidData, secretBoxKey)).rejects.toThrow();
      await expect(cryptoService.decryptAesGcm(invalidData, secretBoxKey)).rejects.toThrow();
    });
  });

  describe('Batch Operations', () => {
    it('should perform batch encryption and decryption', async () => {
      const messages = [
        Buffer.from('message 1'),
        Buffer.from('message 2'),
        Buffer.from('message 3'),
      ];
      const { key } = await keyProvider.getCurrentKey();
      const secretBoxKey = key.slice(0, 32);

      const encrypted = await cryptoService.batchEncrypt(messages, secretBoxKey);
      const decrypted = await cryptoService.batchDecrypt(encrypted, secretBoxKey);

      expect(decrypted[0].toString()).toBe(messages[0].toString());
      expect(decrypted[1].toString()).toBe(messages[1].toString());
      expect(decrypted[2].toString()).toBe(messages[2].toString());
    });

    it('should handle empty messages in batch operations', async () => {
      const messages = [
        Buffer.from(''),
        Buffer.from('non-empty message'),
        Buffer.from(''),
      ];
      const { key } = await keyProvider.getCurrentKey();
      const secretBoxKey = key.slice(0, 32);

      const encrypted = await cryptoService.batchEncrypt(messages, secretBoxKey);
      const decrypted = await cryptoService.batchDecrypt(encrypted, secretBoxKey);

      expect(decrypted[0].toString()).toBe(messages[0].toString());
      expect(decrypted[1].toString()).toBe(messages[1].toString());
      expect(decrypted[2].toString()).toBe(messages[2].toString());
    });

    it('should handle large batch operations efficiently', async () => {
      const messages = Array(100).fill(null).map((_, i) => 
        Buffer.from(`message ${i} with some content to make it larger`)
      );
      const { key } = await keyProvider.getCurrentKey();
      const secretBoxKey = key.slice(0, 32);

      const startTime = Date.now();
      const encrypted = await cryptoService.batchEncrypt(messages, secretBoxKey);
      const decrypted = await cryptoService.batchDecrypt(encrypted, secretBoxKey);
      const endTime = Date.now();

      messages.forEach((msg, i) => {
        expect(decrypted[i].toString()).toBe(msg.toString());
      });

      console.log(`Batch processing time for 100 messages: ${endTime - startTime}ms`);
    });
  });

  describe('Key Management', () => {
    it('should generate and retrieve keys', async () => {
      const keyResult = await keyProvider.getCurrentKey();
      
      expect(keyResult).toBeDefined();
      expect(keyResult.key).toBeInstanceOf(Buffer);
      expect(keyResult.kid).toBeDefined();
      expect(keyResult.algorithm).toBeDefined();
      expect(keyResult.createdAt).toBeDefined();
      expect(keyResult.expiresAt).toBeDefined();
    });

    it('should store and retrieve a custom key', async () => {
      const customKey = Buffer.from('custom-key-for-testing'.padEnd(32, '0'));
      const algorithm = AlgorithmType.XChaCha20Poly1305;
      
      const storedKey = await keyProvider.storeKey(customKey, algorithm);
      const retrievedKey = await keyProvider.getKey(storedKey.kid);
      
      expect(retrievedKey).toEqual(customKey);
    });

    it('should rotate keys', async () => {
      const originalKey = await keyProvider.getCurrentKey();
      
      await keyProvider.rotateKeys();
      
      const newKey = await keyProvider.getCurrentKey();
      
      expect(newKey.kid).not.toBe(originalKey.kid);
      expect(newKey.key.toString('hex')).not.toBe(originalKey.key.toString('hex'));
      
      const retrievedOriginalKey = await keyProvider.getKey(originalKey.kid);
      expect(retrievedOriginalKey).toEqual(originalKey.key);
    });
  });

  describe('Session Management', () => {
    it('should derive session keys', async () => {
      await sodium.ready;
      const keypair = {
        publicKey: Buffer.from(crypto.randomBytes(32)),
        secretKey: Buffer.from(crypto.randomBytes(32))
      };
      const timestamp = Date.now();
      
      const session = await cryptoService.deriveSession(
        Buffer.from(keypair.publicKey),
        timestamp
      );
      
      expect(session).toBeDefined();
      expect(session.rx).toBeInstanceOf(Buffer);
      expect(session.tx).toBeInstanceOf(Buffer);
      expect(session.kid).toBe('session');
      expect(session.ts).toBe(timestamp);
    });
  });
});
