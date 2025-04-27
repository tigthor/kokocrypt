import { Test, TestingModule } from '@nestjs/testing';
import { KafkaService } from '../src/kafka/kafka.service';
import { CryptoService } from '../src/core/crypto.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { ClientKafka } from '@nestjs/microservices';
import { of } from 'rxjs';
import { KeyProvider, KeyResult } from '../src/providers/key-provider';
import { EnvKeyProvider } from '../src/providers/env.provider';

interface KafkaMessage {
  topic: string;
  partition: number;
  message: {
    value: Buffer;
    key?: Buffer;
    timestamp?: string;
    headers?: Record<string, Buffer>;
  };
}

class TestKeyProvider extends KeyProvider {
  private readonly testKey: Buffer = Buffer.from(
    'test-key-32-bytes-long-padding-123',
    'utf8'
  );
  private readonly testKid: string = 'test-kid-1';
  private keys: Map<string, Buffer> = new Map();

  constructor() {
    super();
    this.keys.set(this.testKid, this.testKey);
  }

  async getCurrentKey(): Promise<KeyResult> {
    return {
      key: this.testKey,
      kid: this.testKid,
      algorithm: 'XChaCha20-Poly1305',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    };
  }

  async getKey(kid: string): Promise<Buffer | null> {
    if (kid === this.testKid) {
      return this.testKey;
    }
    return this.keys.get(kid) || null;
  }

  async rotateKeys(): Promise<void> {
    const newKid = `test-kid-${Date.now()}`;
    const newKey = Buffer.from(
      `test-key-${Date.now()}-padding-123456789`,
      'utf8'
    );
    this.keys.set(newKid, newKey);
  }

  async storeKey(key: Buffer, algorithm: string, expiresAt?: number): Promise<KeyResult> {
    const kid = `custom-${Date.now()}`;
    this.keys.set(kid, key);
    
    return {
      key,
      kid,
      algorithm,
      createdAt: Date.now(),
      expiresAt: expiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    };
  }
}

describe('Kafka Integration Tests', () => {
  let module: TestingModule;
  let kafkaService: KafkaService;
  let cryptoService: CryptoService;
  let testKey: Buffer;
  let mockClientKafka: jest.Mocked<ClientKafka>;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'ENCRYPTION_KEY':
          return 'test-key';
        default:
          return undefined;
      }
    }),
  };

  beforeAll(async () => {
    // Create mock ClientKafka
    mockClientKafka = {
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockImplementation(() => of({ success: true })),
      subscribeToResponseOf: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Create the testing module
    module = await Test.createTestingModule({
      providers: [
        KafkaService,
        CryptoService,
        ConfigService,
        {
          provide: KeyProvider,
          useClass: TestKeyProvider,
        },
        EnvKeyProvider,
        {
          provide: 'KAFKA_CLIENT',
          useValue: mockClientKafka,
        },
      ],
    }).compile();

    kafkaService = module.get<KafkaService>(KafkaService);
    cryptoService = module.get<CryptoService>(CryptoService);
    testKey = randomBytes(32);

    // Initialize Kafka service
    await kafkaService.onModuleInit();
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    mockClientKafka.send.mockImplementation(() => of({ success: true }));
  });

  afterAll(async () => {
    await kafkaService.onModuleDestroy();
    await module.close();
  });

  it('should send and receive encrypted messages', async () => {
    const testMessage = { data: 'test message' };
    const response = await kafkaService.sendMessage(
      'test.topic',
      testMessage,
      testKey
    );
    expect(response).toBeDefined();
    expect(response).toEqual({ success: true });
    expect(mockClientKafka.send).toHaveBeenCalledTimes(1);
  });

  it('should handle batch messages', async () => {
    const messages = [
      { id: 1, data: 'message 1' },
      { id: 2, data: 'message 2' },
    ];

    const responses = await kafkaService.sendBatch(
      'test-topic',
      messages,
      testKey
    );
    expect(responses).toHaveLength(messages.length);
    expect(responses).toEqual([{ success: true }, { success: true }]);
    expect(mockClientKafka.send).toHaveBeenCalledTimes(messages.length);
  });

  it('should handle invalid messages', async () => {
    mockClientKafka.send.mockImplementationOnce(() => {
      throw new Error('decryption failed');
    });

    await expect(kafkaService.sendInvalidMessage()).rejects.toThrow(
      'decryption failed'
    );
    expect(mockClientKafka.send).toHaveBeenCalledWith(
      'test.errors',
      expect.any(Object)
    );
  });

  it('should handle connection failures gracefully', async () => {
    mockClientKafka.send.mockImplementationOnce(() => {
      throw new Error('connect ECONNREFUSED');
    });

    await expect(
      kafkaService.sendMessage('test.topic', { data: 'test' }, testKey)
    ).rejects.toThrow('Kafka service is not available');
  });

  it('should run performance test', async () => {
    const messageCount = 10;
    mockClientKafka.send.mockImplementation(() => of({ success: true }));

    const responses = await kafkaService.runPerformanceTest(
      messageCount,
      testKey
    );
    expect(responses).toHaveLength(messageCount);
    expect(mockClientKafka.send).toHaveBeenCalledTimes(messageCount);
  });

  describe('Error Handling', () => {
    it('should handle encryption errors', async () => {
      const invalidKey = Buffer.alloc(0); // Invalid key
      await expect(
        kafkaService.sendMessage('test.topic', { data: 'test' }, invalidKey)
      ).rejects.toThrow();
    });

    it('should handle network timeouts', async () => {
      mockClientKafka.send.mockImplementationOnce(() => {
        throw new Error('Network timeout');
      });

      await expect(
        kafkaService.sendMessage('test.topic', { data: 'test' }, testKey)
      ).rejects.toThrow('Network timeout');
    });

    it('should handle broker unavailable', async () => {
      mockClientKafka.send.mockImplementationOnce(() => {
        throw new Error('Broker not available');
      });

      await expect(
        kafkaService.sendMessage('test.topic', { data: 'test' }, testKey)
      ).rejects.toThrow('Broker not available');
    });
  });

  it('should throw on non-object message', async () => {
    await expect(
      kafkaService.sendMessage('test.topic', 'not-an-object' as any, testKey)
    ).rejects.toThrow('Invalid message format');
    await expect(
      kafkaService.sendMessage('test.topic', null as any, testKey)
    ).rejects.toThrow('Invalid message format');
  });

  it('should throw on key of wrong length (sendMessage)', async () => {
    const badKey = Buffer.alloc(10);
    await expect(
      kafkaService.sendMessage('test.topic', { data: 'test' }, badKey)
    ).rejects.toThrow('Invalid key length');
  });

  it('should throw on empty batch', async () => {
    await expect(
      kafkaService.sendBatch('test.topic', [], testKey)
    ).rejects.toThrow('Invalid batch message format');
  });

  it('should throw if any message in batch is not an object', async () => {
    await expect(
      kafkaService.sendBatch('test.topic', [{ foo: 1 }, 'bad' as any], testKey)
    ).rejects.toThrow('Invalid message in batch');
  });

  it('should throw on key of wrong length (sendBatch)', async () => {
    const badKey = Buffer.alloc(10);
    await expect(
      kafkaService.sendBatch('test.topic', [{ foo: 1 }], badKey)
    ).rejects.toThrow('Invalid key length');
  });

  it('should throw on invalid messageCount in runPerformanceTest', async () => {
    await expect(
      kafkaService.runPerformanceTest(0, testKey)
    ).rejects.toThrow('Invalid message count');
    await expect(
      kafkaService.runPerformanceTest(-1, testKey)
    ).rejects.toThrow('Invalid message count');
    await expect(
      kafkaService.runPerformanceTest(1.5, testKey)
    ).rejects.toThrow('Invalid message count');
  });

  it('should propagate unknown errors from client.send', async () => {
    mockClientKafka.send.mockImplementationOnce(() => { throw new Error('some unknown error'); });
    await expect(
      kafkaService.sendMessage('test.topic', { data: 'test' }, testKey)
    ).rejects.toThrow('some unknown error');
  });
});
