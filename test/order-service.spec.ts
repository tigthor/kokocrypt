import { Test, TestingModule } from '@nestjs/testing';
import { ClientKafka } from '@nestjs/microservices';
import { CryptoService } from '../src/core/crypto.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { of, firstValueFrom } from 'rxjs';
import { KeyProvider, KeyResult } from '../src/providers/key-provider';
import { Injectable } from '@nestjs/common';

@Injectable()
class OrderService {
  constructor(
    private readonly cryptoService: CryptoService,
    private readonly client: ClientKafka
  ) {}

  async createOrder(order: any) {
    const orderBuffer = Buffer.from(JSON.stringify(order));
    const { key } = await this.cryptoService.ready();
    const encryptedOrder = await this.cryptoService.boxRaw(orderBuffer, key);

    return this.client.send('orders.created', {
      value: encryptedOrder.toString('base64'),
      timestamp: Date.now().toString(),
    });
  }
}

describe('Order Service Integration', () => {
  let module: TestingModule;
  let orderService: OrderService;
  let cryptoService: CryptoService;
  let mockClientKafka: jest.Mocked<ClientKafka>;
  let testKey: Buffer;

  beforeAll(async () => {
    mockClientKafka = {
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockImplementation(() => of({ success: true })),
      subscribeToResponseOf: jest.fn(),
    } as any;

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

    testKey = randomBytes(32);
    const mockKeyProvider = {
      ready: jest.fn().mockResolvedValue(undefined),
      getCurrentKey: jest
        .fn()
        .mockResolvedValue({ key: testKey, kid: 'test-key-1' } as KeyResult),
      getKey: jest
        .fn()
        .mockImplementation((kid: string) =>
          kid === 'test-key-1'
            ? Promise.resolve(testKey)
            : Promise.resolve(null)
        ),
    };

    module = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: CryptoService,
          useFactory: () =>
            new CryptoService(mockKeyProvider as any, mockConfigService as any),
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ClientKafka,
          useValue: mockClientKafka,
        },
        {
          provide: KeyProvider,
          useValue: mockKeyProvider,
        },
      ],
    }).compile();

    orderService = module.get<OrderService>(OrderService);
    cryptoService = module.get<CryptoService>(CryptoService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should encrypt and send order message', async () => {
    const order = {
      id: '123',
      amount: 100,
      customerId: 'cust_123',
    };

    const result = await firstValueFrom(await orderService.createOrder(order));
    expect(result).toEqual({ success: true });
    expect(mockClientKafka.send).toHaveBeenCalledTimes(1);
  });
});
