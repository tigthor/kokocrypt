import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka,
  Producer,
  CompressionTypes,
  Message,
  Partitioners,
} from 'kafkajs';

@Injectable()
export class ProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly logger = new Logger(ProducerService.name);

  constructor(private configService: ConfigService) {
    this.kafka = new Kafka({
      clientId:
        this.configService.get('kafka.clientId') || 'api-gateway-client',
      brokers: [this.configService.get('kafka.broker') || 'localhost:9092'],
      retry: {
        initialRetryTime: 300,
        retries: 5,
        maxRetryTime: 30000,
      },
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
      createPartitioner: Partitioners.LegacyPartitioner,
    });
  }

  async onModuleInit() {
    try {
      await this.producer.connect();
      this.logger.log('Kafka producer connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect Kafka producer', error);
    }
  }

  async onModuleDestroy() {
    try {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected successfully');
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka producer', error);
    }
  }

  async sendMessage(
    topic: string,
    message: any,
    key?: string,
    headers?: Record<string, string>
  ) {
    try {
      const kafkaMessage: Message = {
        value: typeof message === 'string' ? message : JSON.stringify(message),
        key: key,
        headers,
      };

      const response = await this.producer.send({
        topic,
        compression: CompressionTypes.GZIP,
        messages: [kafkaMessage],
        acks: 1,
      });

      this.logger.debug(
        `Message sent to topic ${topic}: ${JSON.stringify(response)}`
      );
      return response;
    } catch (error) {
      this.logger.error(`Error sending message to topic ${topic}:`, error);
      throw error;
    }
  }

  async sendBatchMessages(topic: string, messages: any[], keys?: string[]) {
    try {
      const kafkaMessages = messages.map((message, index) => ({
        value: typeof message === 'string' ? message : JSON.stringify(message),
        key: keys && keys[index] ? keys[index] : undefined,
      }));

      const response = await this.producer.send({
        topic,
        compression: CompressionTypes.GZIP,
        messages: kafkaMessages,
        acks: 1,
      });

      this.logger.debug(
        `Batch messages sent to topic ${topic}: ${JSON.stringify(response)}`
      );
      return response;
    } catch (error) {
      this.logger.error(
        `Error sending batch messages to topic ${topic}:`,
        error
      );
      throw error;
    }
  }
}
