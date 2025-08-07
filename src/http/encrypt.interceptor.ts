import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { map, from } from 'rxjs';
import { CryptoService } from '../core/crypto.service';
import { SessionContext } from '../core/session.context';
import { toWireBox } from './wire.util';

@Injectable()
export class EncryptInterceptor implements NestInterceptor {
  constructor(private crypto: CryptoService) {}

  intercept(_: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map(async payload => {
        const buf = Buffer.from(JSON.stringify(payload));
        const session = SessionContext.get();

        if (session) {
          const combined = await this.crypto.boxRaw(
            buf,
            Buffer.from(session.tx)
          );
          return toWireBox(combined, 'session', session.ts);
        }

        const { key, kid } = await this.crypto.getCurrentKey();
        const ts = Date.now();
        const combined = await this.crypto.boxRaw(buf, key.subarray(0, 32));
        return toWireBox(combined, kid, ts);
      }),
      from
    );
  }
}
