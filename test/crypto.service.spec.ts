import { CryptoService } from '../src/core/crypto.service';
import { EnvKeyProvider } from '../src/providers/env.provider';
import { ConfigService } from '@nestjs/config';
import sodium from 'libsodium-wrappers';
import * as sodiumNative from 'sodium-native';

describe('CryptoService', () => {
  let crypto: CryptoService;
  let provider: EnvKeyProvider;
  let configService: ConfigService;
  let serverKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };

  beforeAll(async () => {
    await sodium.ready;

    // Generate a key pair for testing
    serverKeyPair = sodium.crypto_kx_keypair();
    process.env.KOKO_ENCRYPTION_KEY = Buffer.concat([
      Buffer.from(serverKeyPair.privateKey),
      Buffer.from(serverKeyPair.publicKey),
    ]).toString('base64');

    provider = new EnvKeyProvider();
    configService = new ConfigService();
    crypto = new CryptoService(provider, configService);
    await crypto.ready();
  });

  it('should encrypt and decrypt data', async () => {
    const data = Buffer.from('test data');
    const key = Buffer.alloc(sodiumNative.crypto_secretbox_KEYBYTES);
    const { key: currentKey } = await crypto.getCurrentKey();
    currentKey.copy(key, 0, 0, sodiumNative.crypto_secretbox_KEYBYTES);

    // Encrypt data
    const encrypted = await crypto.boxRaw(data, key);
    expect(encrypted).toBeDefined();
    expect(encrypted).toBeInstanceOf(Buffer);

    // Decrypt data
    const decrypted = await crypto.unboxRaw(encrypted, key);
    expect(decrypted.toString()).toBe('test data');
  });

  describe('deriveSession', () => {
    it('should derive session keys', async () => {
      // Generate client keypair
      const clientKeyPair = sodium.crypto_kx_keypair();
      const ts = Date.now();

      // Get server session keys
      const serverSession = await crypto.deriveSession(
        Buffer.from(clientKeyPair.publicKey),
        ts
      );
      expect(serverSession).toBeDefined();
      expect(serverSession.rx).toBeInstanceOf(Buffer);
      expect(serverSession.tx).toBeInstanceOf(Buffer);
      expect(serverSession.rx.length).toBe(32);
      expect(serverSession.tx.length).toBe(32);
      expect(serverSession.kid).toBe('session');
      expect(serverSession.ts).toBe(ts);

      // Get client session keys
      const { key: srv_key } = await crypto.getCurrentKey();
      const srv_pk = srv_key.subarray(32);
      const { sharedRx: clientRx, sharedTx: clientTx } =
        sodium.crypto_kx_client_session_keys(
          clientKeyPair.publicKey,
          clientKeyPair.privateKey,
          srv_pk
        );

      // Test server -> client communication
      const serverMsg = Buffer.from('server to client');
      const encrypted = await crypto.boxRaw(
        serverMsg,
        Buffer.from(serverSession.tx)
      );

      expect(encrypted).toBeDefined();
      expect(encrypted).toBeInstanceOf(Buffer);

      const decrypted = await crypto.unboxRaw(encrypted, Buffer.from(clientRx));
      expect(decrypted.toString()).toBe('server to client');

      // Test client -> server communication
      const clientMsg = Buffer.from('client to server');
      const clientEncrypted = await crypto.boxRaw(
        clientMsg,
        Buffer.from(clientTx)
      );
      const serverDecrypted = await crypto.unboxRaw(
        clientEncrypted,
        Buffer.from(serverSession.rx)
      );
      expect(serverDecrypted.toString()).toBe('client to server');
    });
  });
});
