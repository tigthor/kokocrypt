import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly logger = new Logger(ConsumerService.name);
  private isConnected = false;

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2
  ) {
    this.kafka = new Kafka({
      clientId:
        this.configService.get('kafka.clientId') || 'api-gateway-client',
      brokers: [this.configService.get('kafka.broker') || 'localhost:9092'],
      retry: {
        initialRetryTime: 300,
        retries: 10,
        maxRetryTime: 30000,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId: this.configService.get('kafka.groupId') || 'api-gateway-group',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      rebalanceTimeout: 60000,
      maxWaitTimeInMs: 1000,
      maxBytes: 1048576, // 1MB
    });
  }

  async onModuleInit() {
    try {
      await this.consumer.connect();
      this.isConnected = true;
      this.logger.log('Kafka consumer connected successfully');

      // Subscribe to essential topics
      const topics = [
        'user-events',
        'wallet-events',
        'points-events',
        'game-events',
        'activity-events',
        'bonus-events',
        'nft-events',
        'chat-events',
        'report-events',
        'socket-topic',
      ];

      for (const topic of topics) {
        await this.consumer.subscribe({
          topic,
          fromBeginning: false,
        });
        this.logger.log(`Subscribed to topic: ${topic}`);
      }

      // Configure consumer with optimized settings
      await this.consumer.run({
        autoCommit: true,
        autoCommitInterval: 5000,
        partitionsConsumedConcurrently: 3,
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessage(payload);
        },
      });
    } catch (error) {
      this.logger.error('Failed to connect Kafka consumer', error);
    }
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      try {
        await this.consumer.disconnect();
        this.logger.log('Kafka consumer disconnected successfully');
      } catch (error) {
        this.logger.error('Failed to disconnect Kafka consumer', error);
      }
    }
  }

  private async handleMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload) {
    try {
      if (!message.value) return;

      const messageValue = message.value.toString();
      let parsedMessage: unknown;

      try {
        parsedMessage = JSON.parse(messageValue);
      } catch (error) {
        this.logger.warn(`Failed to parse message from topic ${topic}:`, error);
        return;
      }

      // Log received message details for debugging
      this.logger.debug(
        `Received message from topic ${topic}, partition ${partition}`
      );

      // Emit events for other parts of the application to consume
      const eventName = `kafka.${topic}`;
      this.eventEmitter.emit(eventName, {
        value: parsedMessage,
        topic,
        partition,
        offset: message.offset,
        headers: message.headers,
        key: message.key?.toString(),
        timestamp: message.timestamp,
      });

      // Handle specific topics with custom logic
      switch (topic) {
        case 'user-events':
          // Process user events
          break;
        case 'game-events':
          // Process game events
          break;
        case 'points-events':
          // Process points events
          break;
        default:
          // Default handling for other topics
          break;
      }
    } catch (error) {
      this.logger.error(
        `Error handling message from topic ${topic}, partition ${partition}:`,
        error
      );
    }
  }

  // Method to subscribe to additional topics dynamically
  async subscribeToTopic(topic: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Kafka consumer is not connected');
    }

    try {
      await this.consumer.subscribe({ topic, fromBeginning: false });
      this.logger.log(`Dynamically subscribed to topic: ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to topic ${topic}:`, error);
      throw error;
    }
  }
}
