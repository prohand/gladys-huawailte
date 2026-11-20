// -----------------------------------------------------------------------------
// Entry point of the Huawei LTE integration for Gladys Assistant.
//
// Only the bootstrap lives here: the handlers are registered by src/app.js,
// the router logic is in src/service.js and src/huawei/.
//
// Environment variables given by the Gladys supervisor to the container, read
// by the SDK itself: GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR. LOG_LEVEL (debug | info | warn | error) sets
// the log level, DATA_DIR overrides /data (the only writable path).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const service = registerHandlers(gladys);

// Stop the timer and log out of the router when the container stops: the
// router has few session slots, a dangling one blocks the web UI for minutes.
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}, stopping`);
  await service.stop();
});

logger.info('Starting the Huawei LTE integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
