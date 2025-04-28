import {
  DynamicModule,
  Global,
  Module,
  MiddlewareConsumer,
  NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './core/crypto.service';
import { ReplayGuard } from './core/replay.guard';
import { DeriveSessionMiddleware } from './http/derive-session.middleware';
import { DecryptMiddleware } from './http/decrypt.middleware';
import { EncryptInterceptor } from './http/encrypt.interceptor';
import { HandshakeController } from './http/handshake.controller';
import { EnvKeyProvider } from './providers/env.provider';
import { EnhancedEnvKeyProvider } from './providers/enhanced-env.provider';
import { KeyProvider } from './providers/key-provider';

@Global()
@Module({
  controllers: [HandshakeController],
})
export class KokoEncryptionModule implements NestModule {
  static forRoot(opts?: { provider?: KeyProvider, enhanced?: boolean }): DynamicModule {
    const provider = opts?.provider ?? (opts?.enhanced ? new EnhancedEnvKeyProvider() : new EnvKeyProvider());
    const configService = new ConfigService();
    const crypto = new CryptoService(provider, configService);

    return {
      module: KokoEncryptionModule,
      providers: [
        { provide: KeyProvider, useValue: provider },
        { provide: CryptoService, useValue: crypto },
        { provide: ReplayGuard, useClass: ReplayGuard },
        { provide: 'APP_INTERCEPTOR', useClass: EncryptInterceptor },
      ],
      exports: [CryptoService, KeyProvider],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DeriveSessionMiddleware) // must run **first**
      .forRoutes('*')
      .apply(DecryptMiddleware) // decrypt body thereafter
      .forRoutes('*');
  }
}
