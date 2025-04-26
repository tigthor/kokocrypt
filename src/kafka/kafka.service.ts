import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { CryptoService } from '../core/crypto.service';
import { firstValueFrom } from 'rxjs';
import * as sodiumNative from 'sodium-native';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly topics = [
    'test.topic',
    'test.batch',
    'test.errors',
    'test.performance',
  ];

  constructor(
    private readonly cryptoService: CryptoService,
    @Inject('KAFKA_CLIENT') private readonly client: ClientKafka
  ) {}

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('✓ Connected to Kafka');

      // Subscribe to response topics
      for (const topic of this.topics) {
        this.client.subscribeToResponseOf(topic);
      }
      this.logger.log(
        `✓ Subscribed to response topics: ${this.topics.join(', ')}`
      );
    } catch (error) {
      this.logger.error('❌ Failed to initialize Kafka service:', error);
      throw new ServiceUnavailableException(
        'Failed to connect to Kafka service'
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.close();
      this.logger.log('✓ Disconnected from Kafka');
    } catch (error) {
      this.logger.error('❌ Error disconnecting from Kafka:', error);
    }
  }

  async sendMessage(topic: string, message: any, key: Buffer) {
    try {
      // Validate key length
      if (key.length !== sodiumNative.crypto_secretbox_KEYBYTES) {
        throw new BadRequestException(
          `Invalid key length. Expected ${sodiumNative.crypto_secretbox_KEYBYTES} bytes`
        );
      }

      this.logger.debug(`📤 Sending message to ${topic}`);

      // Validate message
      if (!message || typeof message !== 'object') {
        throw new BadRequestException('Invalid message format');
      }

      // Encrypt the message
      const encryptedMessage = await this.cryptoService.boxRaw(
        Buffer.from(JSON.stringify(message)),
        key
      );

      const response = await firstValueFrom(
        this.client.send(topic, {
          value: encryptedMessage.toString('base64'),
          timestamp: Date.now().toString(),
        })
      );

      this.logger.debug(`✓ Message sent to topic ${topic}`);
      return response;
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(`❌ Error sending message to ${topic}:`, error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error.message?.includes('ECONNREFUSED')) {
        throw new ServiceUnavailableException('Kafka service is not available');
      }

      if (error.message?.includes('decryption failed')) {
        throw new BadRequestException('Message encryption failed');
      }

      throw error;
    }
  }

  async sendBatch(topic: string, messages: any[], key: Buffer) {
    try {
      // Validate key length
      if (key.length !== sodiumNative.crypto_secretbox_KEYBYTES) {
        throw new BadRequestException(
          `Invalid key length. Expected ${sodiumNative.crypto_secretbox_KEYBYTES} bytes`
        );
      }

      if (!Array.isArray(messages) || messages.length === 0) {
        throw new BadRequestException('Invalid batch message format');
      }

      this.logger.debug(
        `📤 Sending batch of ${messages.length} messages to ${topic}`
      );

      // Encrypt each message
      const encryptedMessages = await Promise.all(
        messages.map(async message => {
          if (!message || typeof message !== 'object') {
            throw new BadRequestException('Invalid message in batch');
          }

          const encrypted = await this.cryptoService.boxRaw(
            Buffer.from(JSON.stringify(message)),
            key
          );
          return {
            value: encrypted.toString('base64'),
            timestamp: Date.now().toString(),
          };
        })
      );

      // Send all messages
      const responses = await Promise.all(
        encryptedMessages.map(msg =>
          firstValueFrom(this.client.send(topic, msg))
        )
      );

      this.logger.debug(`✓ Batch sent to topic ${topic}`);
      return responses;
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(`❌ Error sending batch to ${topic}:`, error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error.message?.includes('ECONNREFUSED')) {
        throw new ServiceUnavailableException('Kafka service is not available');
      }

      throw error;
    }
  }

  async sendInvalidMessage() {
    try {
      this.logger.debug('📤 Sending invalid message for error testing');

      // Send an intentionally invalid message
      const response = await firstValueFrom(
        this.client.send('test.errors', {
          value: 'invalid_data',
          timestamp: Date.now().toString(),
        })
      );

      return response;
    } catch (error) {
      this.logger.error('❌ Expected error sending invalid message:', error);
      throw error; // We want to propagate this error as it's expected in tests
    }
  }

  async runPerformanceTest(messageCount: number, key: Buffer) {
    try {
      // Validate key length
      if (key.length !== sodiumNative.crypto_secretbox_KEYBYTES) {
        throw new BadRequestException(
          `Invalid key length. Expected ${sodiumNative.crypto_secretbox_KEYBYTES} bytes`
        );
      }

      if (!Number.isInteger(messageCount) || messageCount <= 0) {
        throw new BadRequestException('Invalid message count');
      }

      this.logger.debug(
        `📊 Running performance test with ${messageCount} messages`
      );

      const startTime = Date.now();
      const messages = Array.from({ length: messageCount }, (_, i) => ({
        id: i,
        data: `Performance test message ${i}`,
        timestamp: Date.now(),
      }));

      const responses = await Promise.all(
        messages.map(message =>
          this.sendMessage('test.performance', message, key)
        )
      );

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000; // Convert to seconds
      const messagesPerSecond = messageCount / duration;

      this.logger.debug(`✓ Performance test completed:
        - Messages sent: ${messageCount}
        - Duration: ${duration.toFixed(2)} seconds
        - Rate: ${messagesPerSecond.toFixed(2)} messages/second`);

      return responses;
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error('❌ Error in performance test:', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error.message?.includes('ECONNREFUSED')) {
        throw new ServiceUnavailableException('Kafka service is not available');
      }

      throw error;
    }
  }
}
