import { createApp } from './app';
import { config } from './config';

const app = createApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`beento backend listening on port ${config.port}`);
});
