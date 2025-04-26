import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CryptoService } from '../core/crypto.service';
import { SessionContext } from '../core/session.context';

@Injectable()
export class DeriveSessionMiddleware implements NestMiddleware {
  constructor(private crypto: CryptoService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const epk = req.headers['x-client-epk'];
    const ts = Number(req.headers['x-client-ts'] ?? '0');

    if (!epk || !ts) {
      return next();
    }

    try {
      const keys = await this.crypto.deriveSession(
        Buffer.from(epk as string, 'base64'),
        ts
      );
      SessionContext.set(keys, next);
    } catch {
      next();
    }
  }
} 