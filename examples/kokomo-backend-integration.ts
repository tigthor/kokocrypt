import { KokoEncryptionModule } from '../src/module';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DeriveSessionMiddleware } from '../src/http/derive-session.middleware';
import { DecryptMiddleware } from '../src/http/decrypt.middleware';
import { EncryptInterceptor } from '../src/http/encrypt.interceptor';

/**
 * Example integration with Kokomo Backend API Gateway
 * 
 * This example demonstrates how to integrate the enhanced kokocrypt library
 * with the Kokomo Backend API Gateway for end-to-end encryption.
 */

@Module({
  imports: [
    ConfigModule.forRoot(),
    KokoEncryptionModule.forRoot({ enhanced: true }),
  ],
})
class ApiGatewayModule {}

async function bootstrap() {
  const app = await NestFactory.create(ApiGatewayModule);
  
  
  app.enableCors({
    origin: '*', // In production, specify your allowed origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-client-epk', 'x-client-ts'],
  });
  
  await app.listen(3333);
  console.log('API Gateway is running with enhanced encryption on port 3333');
}

/**
 * Example of how to configure the client-side integration
 * 
 * This code would be used in the client application to communicate
 * with the Kokomo Backend API Gateway.
 */
async function clientIntegrationExample() {
  
  
  
  
  
  
  
  
  
}

if (require.main === module) {
  bootstrap();
}

export { ApiGatewayModule };
