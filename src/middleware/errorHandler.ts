import { NextFunction, Request, Response } from 'express';

// Final safety net: anything reaching here already went through Sentry's
// error handler (see app.ts) if SENTRY_DSN is set. Callers always get a
// real JSON response instead of Express's default HTML error page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function jsonErrorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  res.status(500).json({ error: 'Internal server error' });
}
