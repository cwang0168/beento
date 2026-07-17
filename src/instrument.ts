import * as Sentry from '@sentry/node';
import { config } from './config';

// Must be imported before any other module (index.ts does this first) so
// Sentry's auto-instrumentation can patch things like express and pg
// before they're first required. Inert when SENTRY_DSN is unset, e.g.
// local dev.
if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    tracesSampleRate: 0.1,
  });
}
