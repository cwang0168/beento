import cors from 'cors';
import express, { Express } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { libraryRouter } from './modules/library/library.routes';
import { logsRouter } from './modules/logs/logs.routes';
import { mapRouter } from './modules/map/map.routes';
import { placesRouter } from './modules/places/places.routes';
import { preferencesRouter } from './modules/preferences/preferences.routes';
import { savesRouter } from './modules/saves/saves.routes';
import { tripsRouter } from './modules/trips/trips.routes';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/me/preferences', preferencesRouter);
  app.use('/places', placesRouter);
  app.use('/logs', logsRouter);
  app.use('/saves', savesRouter);
  app.use('/trips', tripsRouter);
  app.use('/map', mapRouter);
  app.use('/library', libraryRouter);

  return app;
}
