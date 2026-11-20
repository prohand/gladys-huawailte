// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// Each handler resolves the message shown under its button (a multi-language
// object). Throwing shows the error message instead.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { describeError } from '../service.js';
import { localize, pick } from '../i18n.js';

const logger = createLogger({ name: 'actions' });

const DEFAULT_TEST_MESSAGE = {
  en: 'Test message from Gladys Assistant.',
  fr: 'Message de test envoyé par Gladys Assistant.',
  de: 'Testnachricht von Gladys Assistant.',
  es: 'Mensaje de prueba de Gladys Assistant.',
};

/**
 * @param {import('../service.js').RouterService} service
 */
export function buildActions(service) {
  return {
    async test_connection() {
      logger.info('Action test_connection');
      await service.refresh();
      if (!service.reachable) {
        return localize((language) => describeError(service.lastError, language));
      }
      const { model, firmware } = service.identity;
      const s = service.snapshot;
      return localize((language) => {
        const parts = [
          pick(language, {
            en: `Connected to ${model}`,
            fr: `Connecté au ${model}`,
            de: `Verbunden mit ${model}`,
            es: `Conectado a ${model}`,
          }) + (firmware ? ` (${firmware})` : ''),
        ];
        if (s.operator || s.networkType) {
          parts.push([s.operator, s.networkType].filter(Boolean).join(', '));
        }
        if (s.signalBars !== null) {
          parts.push(
            pick(language, { en: 'signal', fr: 'signal', de: 'Signal', es: 'señal' }) +
              ` ${s.signalBars}/5`,
          );
        }
        parts.push(
          s.connected
            ? pick(language, {
                en: 'internet connected',
                fr: 'internet connecté',
                de: 'Internet verbunden',
                es: 'internet conectado',
              })
            : pick(language, {
                en: 'internet NOT connected',
                fr: 'internet NON connecté',
                de: 'Internet NICHT verbunden',
                es: 'internet NO conectado',
              }),
        );
        return `${parts.join(' · ')}.`;
      });
    },

    async send_test_sms(fields) {
      logger.info('Action send_test_sms');
      const message =
        typeof fields.message === 'string' && fields.message.trim()
          ? fields.message
          : DEFAULT_TEST_MESSAGE.en;
      const phones = await service.sendSms(fields.phone, message);
      return localize((language) =>
        pick(language, {
          en: `SMS sent to ${phones.join(', ')}.`,
          fr: `SMS envoyé à ${phones.join(', ')}.`,
          de: `SMS an ${phones.join(', ')} gesendet.`,
          es: `SMS enviado a ${phones.join(', ')}.`,
        }),
      );
    },

    async reboot_router() {
      logger.info('Action reboot_router');
      await service.reboot();
      return {
        en: 'The router reboots: back in one to three minutes.',
        fr: 'Le routeur redémarre : de retour dans une à trois minutes.',
        de: 'Der Router startet neu: in ein bis drei Minuten wieder da.',
        es: 'El router se reinicia: vuelve en uno a tres minutos.',
      };
    },
  };
}

export const ACTION_KEYS = ['test_connection', 'send_test_sms', 'reboot_router'];
