// -----------------------------------------------------------------------------
// The "Huawei LTE router" dashboard widget (Gladys 5.1+).
//
// Live tiles (signal, rates, data used) follow the device features once the
// router is created in Gladys; before that they show the last values read.
// A status list says what no feature says well (connection, network,
// operator). The buttons that ACT on the router (send an SMS, mobile data,
// reboot) only appear when the administrator enabled "dashboard controls" in
// the configuration: a dashboard can hang on a wall, and a widget setting can
// be changed by any user who edits the dashboard.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE, routerIds } from '../devices/router.js';
import { CONNECTION_STATES, WIDGET_KEY, describeError } from '../service.js';
import { localize } from '../i18n.js';

const logger = createLogger({ name: 'widget' });

export const WIDGET_ACTIONS = {
  SEND_SMS: 'send_sms',
  MOBILE_DATA: 'mobile_data',
  REBOOT: 'reboot',
};

const T = {
  signal: { en: 'Signal', fr: 'Signal', de: 'Signal', es: 'Señal' },
  download: { en: 'Download', fr: 'Descente', de: 'Download', es: 'Bajada' },
  upload: { en: 'Upload', fr: 'Montée', de: 'Upload', es: 'Subida' },
  month: { en: 'This month', fr: 'Ce mois-ci', de: 'Diesen Monat', es: 'Este mes' },
  connection: { en: 'Internet', fr: 'Internet', de: 'Internet', es: 'Internet' },
  network: { en: 'Network', fr: 'Réseau', de: 'Netz', es: 'Red' },
  operator: { en: 'Operator', fr: 'Opérateur', de: 'Anbieter', es: 'Operador' },
  sms: { en: 'Unread SMS', fr: 'SMS non lus', de: 'Ungelesene SMS', es: 'SMS sin leer' },
  wanIp: { en: 'WAN IP', fr: 'IP WAN', de: 'WAN-IP', es: 'IP WAN' },
  sendSms: { en: 'Send an SMS', fr: 'Envoyer un SMS', de: 'SMS senden', es: 'Enviar un SMS' },
  phone: {
    en: 'Phone number(s)',
    fr: 'Numéro(s) de téléphone',
    de: 'Telefonnummer(n)',
    es: 'Número(s) de teléfono',
  },
  message: { en: 'Message', fr: 'Message', de: 'Nachricht', es: 'Mensaje' },
  dataOff: { en: 'Data off', fr: 'Couper data', de: 'Daten aus', es: 'Datos off' },
  dataOn: { en: 'Data on', fr: 'Activer data', de: 'Daten an', es: 'Datos on' },
  reboot: { en: 'Reboot', fr: 'Redémarrer', de: 'Neustart', es: 'Reiniciar' },
};

const CONNECTION_ROWS = {
  [CONNECTION_STATES.CONNECTED]: {
    value: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
    color: WIDGET_COLORS.SUCCESS,
  },
  [CONNECTION_STATES.DISCONNECTED]: {
    value: { en: 'Disconnected', fr: 'Déconnecté', de: 'Getrennt', es: 'Desconectado' },
    color: WIDGET_COLORS.DANGER,
  },
  [CONNECTION_STATES.UNREACHABLE]: {
    value: {
      en: 'Router unreachable',
      fr: 'Routeur injoignable',
      de: 'Router nicht erreichbar',
      es: 'Router inaccesible',
    },
    color: WIDGET_COLORS.WARNING,
  },
};

function isCreated(gladys, externalId) {
  return (gladys.devices ?? []).some((device) => device.external_id === externalId);
}

/**
 * A tile: bound to the live feature when the router exists in Gladys, the
 * last value read otherwise (or no tile at all when nothing was read).
 */
function tile({ gladys, service, featureKey, label, icon, value, unit }) {
  const platformId = service.identity?.platformId;
  if (platformId) {
    const ids = routerIds(gladys, platformId);
    if (isCreated(gladys, ids.device)) {
      return { type: 'value', label, icon, device_feature: ids.feature(featureKey) };
    }
  }
  if (value === null || value === undefined) {
    return null;
  }
  return { type: 'value', label, icon, value, unit };
}

function round(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * The widget content.
 * @param {object} gladys
 * @param {import('../service.js').RouterService} service
 * @param {{ settings?: object, config: object }} request
 */
export function buildWidgetContent(gladys, service, { settings = {}, config }) {
  const s = service.snapshot;
  const reachable = service.reachable === true;
  const components = [];

  if (service.reachable === false) {
    components.push({
      type: 'text',
      variant: 'body',
      text: localize((language) => describeError(service.lastError, language).slice(0, 300)),
    });
  } else if (service.reachable === null) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: 'Waiting for the first read of the router…',
        fr: 'En attente de la première lecture du routeur…',
        de: 'Warte auf das erste Auslesen des Routers…',
        es: 'Esperando la primera lectura del router…',
      },
    });
  }

  const tiles = [
    tile({
      gladys,
      service,
      featureKey: FEATURE.SIGNAL,
      label: T.signal,
      icon: 'bar-chart-2',
      value: s?.signalBars === null || s?.signalBars === undefined ? null : `${s.signalBars}/5`,
    }),
    tile({
      gladys,
      service,
      featureKey: FEATURE.DOWNLOAD_RATE,
      label: T.download,
      icon: 'download',
      value: s?.downloadRate == null ? null : round((s.downloadRate * 8) / 1e6, 1),
      unit: 'Mbit/s',
    }),
    tile({
      gladys,
      service,
      featureKey: FEATURE.UPLOAD_RATE,
      label: T.upload,
      icon: 'upload',
      value: s?.uploadRate == null ? null : round((s.uploadRate * 8) / 1e6, 1),
      unit: 'Mbit/s',
    }),
    tile({
      gladys,
      service,
      featureKey: FEATURE.MONTH_DOWNLOAD,
      label: T.month,
      icon: 'database',
      value: s?.monthDownload == null ? null : round(s.monthDownload / 1024 ** 3, 2),
      unit: 'GB',
    }),
  ].filter(Boolean);
  components.push(...tiles);

  const items = [];
  const connection =
    service.reachable === false
      ? CONNECTION_STATES.UNREACHABLE
      : s
        ? s.connected
          ? CONNECTION_STATES.CONNECTED
          : CONNECTION_STATES.DISCONNECTED
        : null;
  if (connection) {
    items.push({ label: T.connection, icon: 'globe', ...CONNECTION_ROWS[connection] });
  }
  if (reachable && s?.networkType) {
    items.push({
      label: T.network,
      icon: 'radio',
      value: s.networkType,
      color: WIDGET_COLORS.INFO,
    });
  }
  if (reachable && s?.operator) {
    items.push({
      label: T.operator,
      icon: 'flag',
      value: s.operator.slice(0, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (reachable && s?.unreadSms !== null && s?.unreadSms !== undefined) {
    items.push({
      label: T.sms,
      icon: 'message-square',
      value: s.unreadSms,
      color: s.unreadSms > 0 ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (reachable && settings.show_wan_ip === true && s?.wanIp) {
    items.push({ label: T.wanIp, icon: 'hash', value: s.wanIp, color: WIDGET_COLORS.NEUTRAL });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  if (config.dashboard_controls && reachable) {
    components.push({
      type: 'button',
      label: T.sendSms,
      icon: 'send',
      style: 'primary',
      action: {
        key: WIDGET_ACTIONS.SEND_SMS,
        fields: [
          { key: 'phone', type: 'string', required: true, label: T.phone },
          { key: 'message', type: 'string', required: true, label: T.message },
        ],
      },
    });
    if (s?.mobileData !== null && s?.mobileData !== undefined) {
      components.push({
        type: 'button',
        label: s.mobileData ? T.dataOff : T.dataOn,
        icon: s.mobileData ? 'wifi-off' : 'wifi',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.MOBILE_DATA, params: { on: !s.mobileData }, confirm: true },
      });
    }
    components.push({
      type: 'button',
      label: T.reboot,
      icon: 'refresh-cw',
      style: 'danger',
      action: { key: WIDGET_ACTIONS.REBOOT, confirm: true },
    });
  }

  return {
    // Device-bound tiles are live; the rest is nudged by the service when it
    // changes (see RouterService#nudgeWidget). The TTL is a safety net.
    ttl_seconds: Math.max(30, Math.min(600, config.refresh_interval)),
    components,
  };
}

/**
 * A tapped button of the widget.
 * @returns {Promise<Record<string, string>>} the toast
 */
export async function runWidgetAction(service, { actionKey, params = {}, values, config }) {
  logger.info(`Widget action ${actionKey}`);
  if (!config.dashboard_controls) {
    throw new Error('Dashboard controls are disabled in the integration configuration');
  }
  if (actionKey === WIDGET_ACTIONS.SEND_SMS) {
    // An older core drops the form and relays the tap without `values`.
    if (!values?.phone || !values?.message) {
      throw new Error('This Gladys version does not support the SMS form: update Gladys');
    }
    const phones = await service.sendSms(values.phone, values.message);
    return localize((language) => {
      const texts = {
        en: `SMS sent to ${phones.length} number(s).`,
        fr: `SMS envoyé à ${phones.length} numéro(s).`,
        de: `SMS an ${phones.length} Nummer(n) gesendet.`,
        es: `SMS enviado a ${phones.length} número(s).`,
      };
      return texts[language] ?? texts.en;
    });
  }
  if (actionKey === WIDGET_ACTIONS.MOBILE_DATA) {
    const on = params.on === true;
    await service.setMobileData(on);
    return on
      ? {
          en: 'Mobile data on.',
          fr: 'Data mobile activée.',
          de: 'Mobile Daten an.',
          es: 'Datos móviles activados.',
        }
      : {
          en: 'Mobile data off.',
          fr: 'Data mobile coupée.',
          de: 'Mobile Daten aus.',
          es: 'Datos móviles desactivados.',
        };
  }
  if (actionKey === WIDGET_ACTIONS.REBOOT) {
    await service.reboot();
    return {
      en: 'The router reboots: back in one to three minutes.',
      fr: 'Le routeur redémarre : de retour dans une à trois minutes.',
      de: 'Der Router startet neu: in ein bis drei Minuten wieder da.',
      es: 'El router se reinicia: vuelve en uno a tres minutos.',
    };
  }
  throw new Error(`Unknown widget action: ${actionKey}`);
}

export { WIDGET_KEY };
