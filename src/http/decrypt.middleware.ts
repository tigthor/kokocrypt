import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CryptoService } from '../core/crypto.service';
import { SessionContext } from '../core/session.context';
import { ReplayGuard } from '../core/replay.guard';

@Injectable()
export class DecryptMiddleware implements NestMiddleware {
  constructor(
    private crypto: CryptoService,
    private guard: ReplayGuard
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const box = req.body ?? {};
    
    if (!(box.iv && box.data && box.kid && box.ts)) {
      return next();
    }

    if (!this.guard.check(box.ts, box.iv)) {
      return next();
    }

    try {
      const session = SessionContext.get();
      const key = session && session.kid === 'session'
        ? session.rx
        : await this.crypto.provider.getKey(box.kid);

      if (!key) {
        throw new Error('key not found');
      }

      const plain = this.crypto.unboxRaw(box, key);
      req.body = JSON.parse(plain.toString('utf8'));
    } catch {
      // swallow for route guards to handle
    }

    next();
  }
} 