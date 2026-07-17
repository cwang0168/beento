import dotenv from 'dotenv';

dotenv.config();

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret';
}
if (!process.env.CRON_SECRET) {
  process.env.CRON_SECRET = 'test-cron-secret';
}
