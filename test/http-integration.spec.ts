import express from 'express';
import axios from 'axios';
import { Server } from 'http';
import { CryptoService } from '../src/core/crypto.service';
import { EnvKeyProvider } from '../src/providers/env.provider';
import { ConfigService } from '@nestjs/config';
import sodium from 'libsodium-wrappers';
import bodyParser from 'body-parser';

describe('HTTP Integration Tests', () => {
  let server: Server;
  let serverCrypto: CryptoService;
  let clientCrypto: CryptoService;
  let provider: EnvKeyProvider;
  let configService: ConfigService;
  let serverKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
  let clientKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
  let serverSession: any;
  let clientSession: any;
  const PORT = 4567;
  const BASE_URL = `http://localhost:${PORT}`;

  beforeAll(async () => {
    console.log('🚀 Setting up test environment...');
    await sodium.ready;
    console.log('✓ Sodium initialized');

    // Generate server keypair and set up environment
    serverKeyPair = sodium.crypto_kx_keypair();
    console.log('✓ Server keypair generated');

    process.env.KOKO_ENCRYPTION_KEY = Buffer.concat([
      Buffer.from(serverKeyPair.privateKey),
      Buffer.from(serverKeyPair.publicKey),
    ]).toString('base64');
    console.log('✓ Environment key set');

    // Set up crypto services
    provider = new EnvKeyProvider();
    configService = new ConfigService();
    serverCrypto = new CryptoService(provider, configService);
    clientCrypto = new CryptoService(provider, configService);
    await serverCrypto.ready();
    await clientCrypto.ready();
    console.log('✓ Server crypto service initialized');

    // Generate client keypair
    clientKeyPair = sodium.crypto_kx_keypair();
    console.log('✓ Client keypair generated');

    const ts = Date.now();
    console.log(`✓ Using timestamp: ${ts}`);

    // Derive sessions for both server and client
    console.log('📦 Deriving server session...');
    serverSession = await serverCrypto.deriveSession(
      Buffer.from(clientKeyPair.publicKey),
      ts
    );
    console.log('✓ Server session derived');

    const { key: srv_key } = await serverCrypto.getCurrentKey();
    const srv_pk = srv_key.subarray(32);
    const { sharedRx: clientRx, sharedTx: clientTx } =
      sodium.crypto_kx_client_session_keys(
        clientKeyPair.publicKey,
        clientKeyPair.privateKey,
        srv_pk
      );

    clientSession = {
      rx: Buffer.from(clientRx),
      tx: Buffer.from(clientTx),
      kid: 'session',
      ts,
    };
    console.log('✓ Client session derived');

    // Set up Express server
    const app = express();
    app.use(bodyParser.json());

    // Test endpoint that requires encryption
    app.post('/test', async (req, res) => {
      try {
        if (!req.body.data) {
          return res.status(400).json({ error: 'Decryption failed' });
        }

        const encrypted = Buffer.from(req.body.data, 'base64');
        const decrypted = await serverCrypto.unboxRaw(
          encrypted,
          serverSession.rx
        );
        const response = { message: 'Success: ' + decrypted.toString() };
        const encryptedResponse = await serverCrypto.boxRaw(
          Buffer.from(JSON.stringify(response)),
          serverSession.tx
        );
        res.json({ data: encryptedResponse.toString('base64') });
      } catch (error) {
        res.status(400).json({ error: 'Decryption failed' });
      }
    });

    // Test endpoint for replay attack
    app.post('/replay', async (req, res) => {
      try {
        if (!req.body.data) {
          return res.status(400).json({ error: 'Decryption failed' });
        }

        const encrypted = Buffer.from(req.body.data, 'base64');
        const decrypted = await serverCrypto.unboxRaw(
          encrypted,
          serverSession.rx
        );
        res.json({ message: 'Success: ' + decrypted.toString() });
      } catch (error) {
        res.status(400).json({ error: 'Decryption failed' });
      }
    });

    // Start server
    server = app.listen(PORT);
    console.log(`✓ Test server listening on port ${PORT}`);
  });

  afterAll(done => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  it('should successfully encrypt and decrypt messages', async () => {
    const message = { test: 'Hello, World!' };
    const encrypted = await clientCrypto.boxRaw(
      Buffer.from(JSON.stringify(message)),
      clientSession.tx
    );

    const response = await axios.post(
      `${BASE_URL}/test`,
      {
        data: encrypted.toString('base64'),
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const decrypted = await clientCrypto.unboxRaw(
      Buffer.from(response.data.data, 'base64'),
      clientSession.rx
    );
    const result = JSON.parse(decrypted.toString());
    expect(result.message).toBe('Success: {"test":"Hello, World!"}');
  });

  it('should handle invalid messages', async () => {
    const invalidMessage = Buffer.from('invalid message');
    try {
      await axios.post(
        `${BASE_URL}/test`,
        {
          data: invalidMessage.toString('base64'),
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.error).toBe('Decryption failed');
    }
  });

  it('should handle wrong decryption key', async () => {
    const message = { test: 'Hello, World!' };
    const wrongKey = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
    try {
      const encrypted = await clientCrypto.boxRaw(
        Buffer.from(JSON.stringify(message)),
        wrongKey
      );
      await axios.post(
        `${BASE_URL}/test`,
        {
          data: encrypted.toString('base64'),
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.error).toBe('Decryption failed');
    }
  });
});
