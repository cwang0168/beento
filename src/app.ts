import cors from 'cors';
import express, { Express } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { placesRouter } from './modules/places/places.routes';
import { preferencesRouter } from './modules/preferences/preferences.routes';

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

  return app;
}
