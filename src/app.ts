import * as Sentry from '@sentry/node';
import cors from 'cors';
import express, { Express } from 'express';
import { jsonErrorHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { blocksRouter } from './modules/blocks/blocks.routes';
import { connectionsRouter } from './modules/connections/connections.routes';
import { libraryRouter } from './modules/library/library.routes';
import { logsRouter } from './modules/logs/logs.routes';
import { mapRouter } from './modules/map/map.routes';
import { authLimiter, generalApiLimiter } from './middleware/rateLimit';
import { peopleRouter } from './modules/people/people.routes';
import { placesRouter } from './modules/places/places.routes';
import { preferencesRouter } from './modules/preferences/preferences.routes';
import { profileRouter } from './modules/profile/profile.routes';
import { recommendationsRouter } from './modules/recommendations/recommendations.routes';
import { tripSuggestionsRouter } from './modules/recommendations/tripSuggestions.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { savesRouter } from './modules/saves/saves.routes';
import { tripsRouter } from './modules/trips/trips.routes';
import { usersRouter } from './modules/users/users.routes';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // General backstop applies to everything registered after this point;
  // /health above stays exempt for uptime probes.
  app.use(generalApiLimiter);

  app.use('/auth', authLimiter, authRouter);
  app.use('/me/preferences', preferencesRouter);
  app.use('/me/profile', profileRouter);
  app.use('/places', placesRouter);
  app.use('/logs', logsRouter);
  app.use('/saves', savesRouter);
  // Must be registered before /trips -- otherwise tripsRouter's /:id route
  // would swallow /trips/suggestions, treating "suggestions" as a trip id.
  app.use('/trips/suggestions', tripSuggestionsRouter);
  app.use('/trips', tripsRouter);
  app.use('/map', mapRouter);
  app.use('/library', libraryRouter);
  app.use('/connections', connectionsRouter);
  app.use('/blocks', blocksRouter);
  app.use('/reports', reportsRouter);
  app.use('/people', peopleRouter);
  app.use('/users', usersRouter);
  app.use('/recommendations', recommendationsRouter);

  // Reports anything passed to next(err) to Sentry (a no-op when
  // SENTRY_DSN is unset -- see instrument.ts), then falls through to the
  // JSON handler below so callers always get a real response instead of
  // Express's default HTML error page.
  Sentry.setupExpressErrorHandler(app);
  app.use(jsonErrorHandler);

  return app;
}
