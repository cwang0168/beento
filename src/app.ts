import cors from 'cors';
import express, { Express } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { blocksRouter } from './modules/blocks/blocks.routes';
import { connectionsRouter } from './modules/connections/connections.routes';
import { libraryRouter } from './modules/library/library.routes';
import { logsRouter } from './modules/logs/logs.routes';
import { mapRouter } from './modules/map/map.routes';
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

  app.use('/auth', authRouter);
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

  return app;
}
