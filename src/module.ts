import { DynamicModule, Global, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CryptoService } from './core/crypto.service';
import { ReplayGuard } from './core/replay.guard';
import { DeriveSessionMiddleware } from './http/derive-session.middleware';
import { DecryptMiddleware } from './http/decrypt.middleware';
import { EncryptInterceptor } from './http/encrypt.interceptor';
import { HandshakeController } from './http/handshake.controller';
import { EnvKeyProvider } from './providers/env.provider';
import { KeyProvider } from './providers/key-provider';

@Global()
@Module({
  controllers: [HandshakeController]
})
export class KokoEncryptionModule implements NestModule {
  static forRoot(opts?: { provider?: KeyProvider }): DynamicModule {
    const provider = opts?.provider ?? new EnvKeyProvider();
    const crypto = new CryptoService(provider);

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