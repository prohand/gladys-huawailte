// -----------------------------------------------------------------------------
// SDK wiring: every handler is registered here, BEFORE connect().
//
// Kept apart from index.js so the tests run the very same wiring against the
// SDK's fake Gladys (`@gladysassistant/integration-sdk/testing`).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { RouterService, WIDGET_KEY } from './service.js';
import { buildActions } from './capabilities/actions.js';
import { buildSceneActions } from './capabilities/scenes.js';
import { buildWidgetContent, runWidgetAction } from './capabilities/widget.js';

const logger = createLogger({ name: 'app' });

/**
 * @param {object} gladys a GladysIntegration (or the fake one)
 * @param {object} [options] passed to RouterService (tests: fake router, clock)
 * @returns {RouterService}
 */
export function registerHandlers(gladys, options = {}) {
  const service = new RouterService(gladys, options);
  let config = normalizeConfig();
  service.configure(config);

  // --- Discovery -----------------------------------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('Scan requested');
    await service.publishDiscovered();
  });

  // --- Commands: the mobile data switch -----------------------------------------
  gladys.onSetValue(async (_device, feature, value) => {
    await service.setValue(feature, value);
  });

  // --- Configuration screen buttons -----------------------------------------------
  for (const [key, handler] of Object.entries(buildActions(service))) {
    gladys.onAction(key, (fields) => handler(fields ?? {}));
  }

  // --- Scene actions ------------------------------------------------------------------
  for (const [key, handler] of Object.entries(buildSceneActions(service))) {
    gladys.onSceneAction(key, (fields) => handler(fields ?? {}));
  }

  // --- Dashboard widget -------------------------------------------------------------
  gladys.onWidgetGet(WIDGET_KEY, async ({ settings } = {}) =>
    buildWidgetContent(gladys, service, { settings, config }),
  );
  gladys.onWidgetAction(WIDGET_KEY, (actionKey, params, { values } = {}) =>
    runWidgetAction(service, { actionKey, params, values, config }),
  );

  // --- Configuration --------------------------------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    config = normalizeConfig(newConfig);
    service.configure(config);
  });

  // --- Lifecycle ----------------------------------------------------------------------
  gladys.on('connected', async () => {
    config = normalizeConfig(await gladys.getConfig());
    service.configure(config);
    // Published before the link dropped may have been lost: say it again.
    service.publishedPlatformId = null;
    service.lastStatusKey = null;
    service.lastTransport = null;
    service.lastWidgetKey = null;
    service.start();
  });

  gladys.on('disconnected', () => service.pause());

  return service;
}
