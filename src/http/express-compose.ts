import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { CryptoService } from '../core/crypto.service';
import { DeriveSessionMiddleware } from './derive-session.middleware';
import { DecryptMiddleware } from './decrypt.middleware';
import { ReplayGuard } from '../core/replay.guard';

export function composeExpressEncryption(crypto: CryptoService): {
  deriveSession: RequestHandler;
  decrypt: RequestHandler;
} {
  const derive = new DeriveSessionMiddleware(crypto);
  const decrypt = new DecryptMiddleware(crypto, new ReplayGuard());

  const wrap = (
    fn: (
      req: Request,
      res: Response,
      next: NextFunction
    ) => Promise<void> | void
  ): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = fn(req, res, next);
        Promise.resolve(result)
          .then(() => undefined)
          .catch(next);
      } catch (err) {
        next(err as Error);
      }
    };
  };

  const deriveHandler: RequestHandler = (req, res, next) => {
    // Nest middleware supports async; adapt for Express
    void derive.use(req, res, next);
  };
  const decryptHandler: RequestHandler = (req, res, next) => {
    void decrypt.use(req, res, next);
  };

  return {
    deriveSession: wrap(deriveHandler),
    decrypt: wrap(decryptHandler),
  };
}
