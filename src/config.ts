import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: requireEnv('JWT_SECRET'),
  databaseUrl: requireEnv('DATABASE_URL'),
  // Shared secret for internal/cron-triggered endpoints (recommendations
  // refresh, post-trip prompt notify) -- these have no user auth token to
  // check, so without this anyone who finds the URL could trigger them.
  cronSecret: requireEnv('CRON_SECRET'),
  sentryDsn: process.env.SENTRY_DSN,
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY,
};
