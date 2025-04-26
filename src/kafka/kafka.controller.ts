import { Controller } from '@nestjs/common';
import {
  MessagePattern,
  Payload,
  Transport,
  KafkaMessage,
} from '@nestjs/microservices';
import { KafkaService } from './kafka.service';
import { CryptoService } from '../core/crypto.service';

@Controller()
export class KafkaController {
  constructor(
    private readonly kafkaService: KafkaService,
    private readonly cryptoService: CryptoService,
  ) {}

  @MessagePattern('test.topic', Transport.KAFKA)
  async handleTestMessage(
    @Payload() message: KafkaMessage,
  ): Promise<any> {
    console.log('📥 Received message on test.topic');
    try {
      // Decrypt the message
      const decrypted = await this.cryptoService.unboxRaw(
        message.value as any,
        Buffer.from('test-key'),
      );
      
      // Process the message
      const data = JSON.parse(decrypted.toString());
      console.log('✓ Message decrypted and processed:', data);

      // Encrypt the response
      const response = await this.cryptoService.boxRaw(
        Buffer.from(JSON.stringify(data)),
        Buffer.from('test-key'),
        'test-session',
        Date.now(),
      );

      return response;
    } catch (error) {
      console.error('❌ Error processing message:', error);
      throw error;
    }
  }

  @MessagePattern('test.batch', Transport.KAFKA)
  async handleBatchMessage(
    @Payload() message: KafkaMessage,
  ): Promise<any> {
    console.log('📥 Received message on test.batch');
    try {
      // Decrypt the message
      const decrypted = await this.cryptoService.unboxRaw(
        message.value as any,
        Buffer.from('test-key'),
      );
      
      // Process the batch message
      const data = JSON.parse(decrypted.toString());
      console.log('✓ Batch message decrypted and processed:', data);

      // Encrypt the response
      const response = await this.cryptoService.boxRaw(
        Buffer.from(JSON.stringify(data)),
        Buffer.from('test-key'),
        'test-session',
        Date.now(),
      );

      return response;
    } catch (error) {
      console.error('❌ Error processing batch message:', error);
      throw error;
    }
  }

  @MessagePattern('test.errors', Transport.KAFKA)
  async handleErrorMessage(
    @Payload() message: KafkaMessage,
  ): Promise<any> {
    console.log('📥 Received message on test.errors');
    try {
      // Attempt to decrypt invalid data (will fail)
      const decrypted = await this.cryptoService.unboxRaw(
        message.value as any,
        Buffer.from('test-key'),
      );
      
      return decrypted;
    } catch (error) {
      console.error('❌ Expected error in error test:', error);
      throw error;
    }
  }

  @MessagePattern('test.performance', Transport.KAFKA)
  async handlePerformanceMessage(
    @Payload() message: KafkaMessage,
  ): Promise<any> {
    try {
      // Quick processing for performance test
      const decrypted = await this.cryptoService.unboxRaw(
        message.value as any,
        Buffer.from('test-key'),
      );
      
      return decrypted;
    } catch (error) {
      console.error('❌ Error in performance test:', error);
      throw error;
    }
  }
} 