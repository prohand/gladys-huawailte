// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+), declared in the manifest `scene_actions`.
//
// The triggers ("SMS received", "connection changed") are fired by
// src/service.js with `publishSceneEvent`; nothing to register for them.
//
// Rules: the fields arrive RESOLVED (scene variables substituted, defaults
// applied); the handler returns the declared `outputs`; throwing fails this
// action only. An action never fires a trigger itself (a scene bound to it
// would loop): the reboot even silences the "unreachable" it causes.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'scenes' });

/**
 * @param {import('../service.js').RouterService} service
 */
export function buildSceneActions(service) {
  return {
    async send_sms(fields) {
      logger.info('Scene action send_sms');
      const phones = await service.sendSms(fields.phone, fields.message);
      return { sent: true, recipients: phones.length };
    },

    async reboot_router() {
      logger.info('Scene action reboot_router');
      await service.reboot();
      return { rebooted: true };
    },
  };
}

/** The keys handled, for the manifest consistency test. */
export const SCENE_ACTION_KEYS = ['send_sms', 'reboot_router'];
