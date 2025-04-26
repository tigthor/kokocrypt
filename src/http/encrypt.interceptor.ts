import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { map, from } from 'rxjs';
import { CryptoService } from '../core/crypto.service';
import { SessionContext } from '../core/session.context';

@Injectable()
export class EncryptInterceptor implements NestInterceptor {
  constructor(private crypto: CryptoService) {}

  intercept(_: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map(async (payload) => {
        const buf = Buffer.from(JSON.stringify(payload));
        const session = SessionContext.get();

        if (session) {
          return this.crypto.boxRaw(buf, session.tx, session.kid, Date.now());
        }

        const { key, kid } = await this.crypto.provider.getCurrentKey();
        return this.crypto.boxRaw(buf, key, kid, Date.now());
      }),
      from
    );
  }
} 