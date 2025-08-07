# KokoCrypt Enhanced

A robust, quantum-resistant encryption layer for Node.js, NestJS, Kafka, and browser clients. Works in traditional Node servers and is easy to adopt in Next.js (Node runtime) for API routes and server components.

## Features

- End-to-end encryption for HTTP requests and responses
- Secure key exchange mechanism with handshake protocol
- Kafka message encryption for secure asynchronous communication
- Post-quantum cryptographic algorithms (Kyber, NTRU)
- Browser-compatible client for frontend applications
- High-performance batch operations for encryption/decryption
- Automatic key rotation and management
- Protection against replay attacks
- Strong error handling and validation
- Comprehensive test suite

## Installation

```bash
npm install @kokomo/koko-encryption-enhanced
```

## Usage

### Import map

- CommonJS:
  - Core: `const { CryptoService } = require('@kokomo/koko-encryption-enhanced')`
  - Browser: `const { BrowserCryptoService } = require('@kokomo/koko-encryption-enhanced/browser')`
  - Kafka: `const { KafkaService } = require('@kokomo/koko-encryption-enhanced/kafka')`
- ESM/TypeScript:
  - Core: `import { CryptoService } from '@kokomo/koko-encryption-enhanced'`
  - Browser: `import { BrowserCryptoService } from '@kokomo/koko-encryption-enhanced/browser'`
  - Kafka: `import { KafkaService } from '@kokomo/koko-encryption-enhanced/kafka'`

### Server-side (NestJS)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KokoEncryptionModule } from '@kokomo/koko-encryption-enhanced';

@Module({
  imports: [
    ConfigModule.forRoot(),
    KokoEncryptionModule.forRoot({ enhanced: true }),
  ],
})
export class AppModule {}
```

The middleware will be automatically configured by the KokoEncryptionModule:
- `DeriveSessionMiddleware` runs first
- Followed by `DecryptMiddleware`
- `EncryptInterceptor` is registered as a global interceptor

### Client-side (Browser)

```typescript
import { BrowserCryptoService } from '@kokomo/koko-encryption-enhanced/browser';

async function setupEncryption() {
  const crypto = new BrowserCryptoService();
  await crypto.ready();
  
  // Generate client keys
  const keys = await crypto.generateKeys();
  
  // Fetch server public key
  const response = await fetch('/.well-known/koko-enc-key');
  const { pub: serverPublicKey } = await response.json();
  
  // Perform handshake
  const session = await crypto.serverHandshake(serverPublicKey);
  
  // Now you can encrypt/decrypt messages
  return {
    encrypt: (message) => crypto.encryptMessage(
      message,
      serverPublicKey,
      session.clientPrivateKey
    ),
    decrypt: (encryptedMessage, senderPublicKey) => crypto.decryptMessage(
      encryptedMessage,
      senderPublicKey,
      session.clientPrivateKey
    )
  };
}
```

### Node/Express

```ts
import express from 'express';
import bodyParser from 'body-parser';
import { CryptoService, EnvKeyProvider } from '@kokomo/koko-encryption-enhanced';
import { ConfigService } from '@nestjs/config';

// Env must expose a 64-byte base64 key: private(32) + public(32)
// process.env.KOKO_ENCRYPTION_KEY = base64(private||public)

const app = express();
app.use(bodyParser.json());

const crypto = new CryptoService(new EnvKeyProvider(), new ConfigService());
await crypto.ready();

app.post('/secure', async (req, res) => {
  try {
    const { data } = req.body;
    const { key } = await crypto.getCurrentKey();
    const decrypted = await crypto.unboxRaw(Buffer.from(data, 'base64'), key.subarray(0, 32));
    const response = await crypto.boxRaw(Buffer.from(JSON.stringify({ ok: true })), key.subarray(0, 32));
    res.json({ data: response.toString('base64') });
  } catch {
    res.status(400).json({ error: 'Decryption failed' });
  }
});
```

### Next.js (App Router) — API Route on Node runtime

Important: Use the Node.js runtime for API routes that rely on native crypto (`sodium-native`). Edge runtime is not supported for server-side encryption.

```ts
// app/api/secure/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { CryptoService, EnvKeyProvider } from '@kokomo/koko-encryption-enhanced';
import { ConfigService } from '@nestjs/config';

const crypto = new CryptoService(new EnvKeyProvider(), new ConfigService());

export async function POST(req: NextRequest) {
  await crypto.ready();
  const body = await req.json();
  const { key } = await crypto.getCurrentKey();
  const sk = key.subarray(0, 32);

  try {
    const decrypted = await crypto.unboxRaw(Buffer.from(body.data, 'base64'), sk);
    const result = JSON.parse(decrypted.toString());
    const response = await crypto.boxRaw(Buffer.from(JSON.stringify({ ok: true, result })), sk);
    return NextResponse.json({ data: response.toString('base64') });
  } catch {
    return NextResponse.json({ error: 'Decryption failed' }, { status: 400 });
  }
}
```

### Next.js (Pages Router) — API Route on Node runtime

```ts
// pages/api/secure.ts
export const config = { runtime: 'nodejs' };
import type { NextApiRequest, NextApiResponse } from 'next';
import { CryptoService, EnvKeyProvider } from '@kokomo/koko-encryption-enhanced';
import { ConfigService } from '@nestjs/config';

const crypto = new CryptoService(new EnvKeyProvider(), new ConfigService());

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await crypto.ready();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { key } = await crypto.getCurrentKey();
    const sk = key.subarray(0, 32);
    const decrypted = await crypto.unboxRaw(Buffer.from(req.body.data, 'base64'), sk);
    const payload = JSON.parse(decrypted.toString());
    const encrypted = await crypto.boxRaw(Buffer.from(JSON.stringify({ ok: true, payload })), sk);
    res.status(200).json({ data: encrypted.toString('base64') });
  } catch {
    res.status(400).json({ error: 'Decryption failed' });
  }
}
```

### Next.js Client (Browser)

Use the browser build under the `browser` subpath. Handshake with your API route that exposes `/.well-known/koko-enc-key`.

```ts
// Any client component
import { BrowserCryptoService } from '@kokomo/koko-encryption-enhanced/browser';

export async function useKoko() {
  const crypto = new BrowserCryptoService();
  await crypto.ready();
  const keys = await crypto.generateKeys();

  const r = await fetch('/.well-known/koko-enc-key');
  const { pub } = await r.json();

  const session = await crypto.serverHandshake(pub);
  return { crypto, keys, session };
}
```

### Kafka Messaging

```typescript
import { EnhancedKafkaService } from '@kokomo/koko-encryption-enhanced/kafka';
import { CryptoService } from '@kokomo/koko-encryption-enhanced';

// In your module
@Module({
  providers: [EnhancedKafkaService, CryptoService],
})
export class KafkaModule {}

// In your service
@Injectable()
export class MyService {
  constructor(
    private readonly kafkaService: EnhancedKafkaService,
    private readonly cryptoService: CryptoService,
  ) {}
  
  async sendEncryptedMessage(topic: string, message: any) {
    const { key } = await this.cryptoService.getCurrentKey();
    const encrypted = await this.kafkaService.encryptKafkaMessage(message, key);
    
    // Send the encrypted message using your Kafka client
    await this.kafkaClient.send({
      topic,
      messages: [{ value: encrypted }],
    });
  }
  
  async receiveEncryptedMessage(encryptedMessage: Buffer) {
    const { key } = await this.cryptoService.getCurrentKey();
    return this.kafkaService.decryptKafkaMessage(encryptedMessage, key);
  }
}
```

## Environment Variables

- `KOKOCRYPT_MASTER_KEY`: 64-byte master key for `EnhancedEnvKeyProvider` (required for enhanced mode)
- `KOKO_ENCRYPTION_KEY`: 64-byte base64 key (private(32) + public(32)) for `EnvKeyProvider`

## Security Features

### Encryption Algorithms

- **XChaCha20-Poly1305**: Fast, secure authenticated encryption
- **AES-GCM**: Industry-standard authenticated encryption
- **Kyber**: Post-quantum key encapsulation mechanism
- **NTRU**: Post-quantum asymmetric encryption

### Key Management

- **Automatic Key Rotation**: Keys are automatically rotated based on configurable expiration periods
- **Key Versioning**: Each key has a unique identifier (kid) for tracking and rotation
- **Multiple Key Support**: Support for multiple active keys during rotation periods

### Protection Mechanisms

- **Replay Protection**: Prevents replay attacks with timestamp verification
- **Authenticated Encryption**: All encryption methods use authenticated encryption to prevent tampering
- **Secure Key Derivation**: Session keys are derived using secure key exchange protocols

## Performance Optimizations

- **Batch Processing**: Efficient batch encryption and decryption for multiple messages
- **Parallel Processing**: Utilizes Promise.all for concurrent encryption/decryption operations
- **Memory Efficiency**: Optimized buffer handling to minimize memory usage

## Integration with Kokomo Backend

This library is designed to work seamlessly with the Kokomo Backend microservice architecture:

1. **API Gateway Integration**: API Gateway handles encryption/decryption of external HTTP traffic while keeping internal service communication in plaintext
2. **Middleware Order**: DeriveSessionMiddleware → DecryptMiddleware → controllers/guards → EncryptInterceptor
3. **Handshake Endpoint**: /.well-known/koko-enc-key exposes server's public key
4. **Required Headers**: x-client-epk (client's ephemeral public key) and x-client-ts (client's timestamp)
5. **Kafka Integration**: Provides encryption for Kafka messages between services

### Example Integration

See the [kokomo-backend-integration.ts](./examples/kokomo-backend-integration.ts) file for a complete example of integrating with Kokomo Backend.

## Runtime notes for Next.js

- Server-side encryption/decryption must run on the Node.js runtime due to `sodium-native`.
- Avoid Next.js Edge runtime for server encryption. Client-side usage is fully browser compatible via `libsodium-wrappers`.
- If you must use Edge, restrict to client-side operations or proxy to a Node API route.

## Development

- Run tests: `npm test`
- Lint: `npm run lint`
- Format: `npm run format`
- Check coverage: `npm run coverage`

## Test Coverage

To generate a coverage report:

```bash
npm run coverage
```

The HTML report will be available in the `coverage/` directory.

## Contributing

We welcome contributions! Please open issues and pull requests. See the `.github/PULL_REQUEST_TEMPLATE.md` for PR guidelines.

## License

MIT

---

Original Repository: [https://github.com/tigthor/kokocrypt](https://github.com/tigthor/kokocrypt)
