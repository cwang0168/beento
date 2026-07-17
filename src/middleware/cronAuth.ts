import { NextFunction, Request, Response } from 'express';
import { config } from '../config';

const HEADER = 'x-cron-secret';

// Gates internal/cron-triggered endpoints (no end-user auth token exists
// for these) behind a shared secret rather than leaving them open to
// anyone who finds the URL.
export function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header(HEADER);
  if (!provided || provided !== config.cronSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
