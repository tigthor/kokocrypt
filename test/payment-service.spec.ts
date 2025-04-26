import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from '../src/core/crypto.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { KeyProvider, KeyResult } from '../src/providers/key-provider';
import { Injectable } from '@nestjs/common';

@Injectable()
class PaymentService {
  constructor(private readonly cryptoService: CryptoService) {}

  async processPayment(encryptedMessage: string) {
    const encryptedBuffer = Buffer.from(encryptedMessage, 'base64');
    const { key } = await this.cryptoService.ready();
    const decryptedBuffer = await this.cryptoService.unboxRaw(
      encryptedBuffer,
      key
    );
    const order = JSON.parse(decryptedBuffer.toString());

    // Process payment logic here
    return {
      orderId: order.id,
      status: 'success',
      amount: order.amount,
    };
  }
}

describe('Payment Service Integration', () => {
  let module: TestingModule;
  let paymentService: PaymentService;
  let cryptoService: CryptoService;
  let testKey: Buffer;

  beforeAll(async () => {
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
        PaymentService,
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
          provide: KeyProvider,
          useValue: mockKeyProvider,
        },
      ],
    }).compile();

    paymentService = module.get<PaymentService>(PaymentService);
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

  it('should decrypt and process payment message', async () => {
    const order = {
      id: '123',
      amount: 100,
      customerId: 'cust_123',
    };

    const orderBuffer = Buffer.from(JSON.stringify(order));
    const { key } = await cryptoService.ready();
    const encryptedOrder = await cryptoService.boxRaw(orderBuffer, key);
    const encryptedMessage = encryptedOrder.toString('base64');

    const result = await paymentService.processPayment(encryptedMessage);

    expect(result).toEqual({
      orderId: order.id,
      status: 'success',
      amount: order.amount,
    });
  });
});
