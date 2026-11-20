// -----------------------------------------------------------------------------
// The router service: one router, read on a timer, mirrored into Gladys.
//
// Each refresh:
//   1. reads the router (src/huawei/snapshot.js);
//   2. publishes the device once its identity (serial number) is known, then
//      the states that changed;
//   3. reports the connection status, the transport badge and nudges the
//      dashboard widget when what it shows changed;
//   4. fires the `connection_changed` trigger on a transition, and
//      `sms_received` for each new message of the inbox.
//
// Refreshes never overlap: the next one is scheduled when the previous ended.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { HuaweiApiError, HuaweiClient, RouterUnreachableError } from './huawei/client.js';
import { CREDENTIAL_ERRORS, ERROR_CODES } from './huawei/codes.js';
import { buildIdentity, readSnapshot } from './huawei/snapshot.js';
import {
  DEVICE_TYPE,
  FEATURE,
  buildRouterDevice,
  buildRouterStates,
  featureKeyOf,
  routerIds,
} from './devices/router.js';
import { connectionKey } from './config.js';
import { SmsStore } from './smsStore.js';
import { localize, pick } from './i18n.js';

const logger = createLogger({ name: 'router' });

/** Key of the dashboard widget, as declared in the manifest `widgets` field. */
export const WIDGET_KEY = 'lte_router';

export const TRIGGERS = {
  CONNECTION_CHANGED: 'connection_changed',
  SMS_RECEIVED: 'sms_received',
};

export const CONNECTION_STATES = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  UNREACHABLE: 'unreachable',
};

// A router takes one to three minutes to come back from a reboot: the
// "unreachable" it goes through is expected, not an event to fire.
export const REBOOT_GRACE_MS = 4 * 60 * 1000;

// An unchanged value is re-sent this often, so it stays recently dated.
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

const MAX_RECIPIENTS = 5;
export const MAX_SMS_LENGTH = 1000;

/**
 * Split and check the phone numbers typed by a user or a scene:
 * `+33 6 12 34 56 78; 0612345678` → `['+33612345678', '0612345678']`.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parsePhoneNumbers(raw) {
  const numbers = String(raw ?? '')
    .split(/[,;\n]/)
    .map((part) => part.replace(/[\s.()-]/g, ''))
    .filter(Boolean);
  if (numbers.length === 0) {
    throw new Error('No phone number given');
  }
  if (numbers.length > MAX_RECIPIENTS) {
    throw new Error(`At most ${MAX_RECIPIENTS} phone numbers at once`);
  }
  for (const number of numbers) {
    if (!/^\+?\d{3,20}$/.test(number)) {
      throw new Error(`Invalid phone number: ${number}`);
    }
  }
  return numbers;
}

/** Plain-text reason of a failure, safe to show (never a secret). */
export function describeError(err, language = 'en') {
  if (err instanceof RouterUnreachableError) {
    return pick(language, {
      en: 'The router does not answer: check its address and that Gladys can reach it.',
      fr: "Le routeur ne répond pas : vérifiez son adresse et que Gladys peut l'atteindre.",
      de: 'Der Router antwortet nicht: Prüfe seine Adresse und ob Gladys ihn erreichen kann.',
      es: 'El router no responde: compruebe su dirección y que Gladys puede alcanzarlo.',
    });
  }
  if (err instanceof HuaweiApiError && err.code === ERROR_CODES.TOO_MANY_ATTEMPTS) {
    return pick(language, {
      en: 'The router locked its login after too many attempts: wait a few minutes.',
      fr: 'Le routeur a bloqué la connexion après trop de tentatives : attendez quelques minutes.',
      de: 'Der Router hat die Anmeldung nach zu vielen Versuchen gesperrt: Warte ein paar Minuten.',
      es: 'El router bloqueó el inicio de sesión tras demasiados intentos: espere unos minutos.',
    });
  }
  if (err instanceof HuaweiApiError && CREDENTIAL_ERRORS.has(err.code)) {
    return pick(language, {
      en: 'The router refused the username or password.',
      fr: "Le routeur a refusé le nom d'utilisateur ou le mot de passe.",
      de: 'Der Router hat den Benutzernamen oder das Passwort abgelehnt.',
      es: 'El router rechazó el nombre de usuario o la contraseña.',
    });
  }
  if (err instanceof HuaweiApiError && err.code === ERROR_CODES.NO_RIGHTS) {
    return pick(language, {
      en: 'The router asks for a login: fill in its password.',
      fr: 'Le routeur demande une connexion : renseignez son mot de passe.',
      de: 'Der Router verlangt eine Anmeldung: Gib sein Passwort ein.',
      es: 'El router pide iniciar sesión: indique su contraseña.',
    });
  }
  if (err instanceof HuaweiApiError) {
    return pick(language, {
      en: `The router refused the request (error ${err.code}).`,
      fr: `Le routeur a refusé la demande (erreur ${err.code}).`,
      de: `Der Router hat die Anfrage abgelehnt (Fehler ${err.code}).`,
      es: `El router rechazó la solicitud (error ${err.code}).`,
    });
  }
  return String(err?.message ?? err);
}

export class RouterService {
  /**
   * @param {object} gladys the SDK client
   * @param {object} [options]
   * @param {(config: object) => HuaweiClient} [options.createClient]
   * @param {string} [options.dataDir] writable directory (`/data`)
   * @param {() => number} [options.now]
   * @param {typeof setTimeout} [options.setTimer]
   * @param {typeof clearTimeout} [options.clearTimer]
   */
  constructor(gladys, options = {}) {
    this.gladys = gladys;
    this.createClient =
      options.createClient ??
      ((config) =>
        new HuaweiClient({
          url: config.router_url,
          username: config.username,
          password: config.password,
        }));
    this.smsStore = new SmsStore(options.dataDir ?? process.env.DATA_DIR ?? '/data');
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;

    this.config = null;
    this.client = null;
    this.clientKey = null;
    this.timer = null;
    this.running = false;
    this.refreshing = null;

    this.identity = null;
    this.publishedPlatformId = null;
    this.snapshot = null;
    this.reachable = null;
    this.lastError = null;
    this.lastRefreshAt = null;
    this.connectionState = null;
    this.rebootUntil = 0;
    this.lastTransport = null;
    this.lastStatusKey = null;
    this.lastWidgetKey = null;
  }

  // --- Lifecycle ----------------------------------------------------------------

  /** Apply a (new) configuration: new session when the router or login changed. */
  configure(config) {
    this.config = config;
    const key = connectionKey(config);
    if (key !== this.clientKey) {
      const previous = this.client;
      this.client = this.createClient(config);
      this.clientKey = key;
      // Another router (or another account): forget what the old one said.
      this.identity = null;
      this.lastStatusKey = null;
      previous?.logout().catch(() => {});
    }
    if (this.running) {
      this.#schedule(0);
    }
  }

  start() {
    this.running = true;
    this.#schedule(0);
  }

  /** Gladys is unreachable: stop reading the router until it is back. */
  pause() {
    this.running = false;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  async stop() {
    this.pause();
    await this.refreshing?.catch(() => {});
    await this.client?.logout().catch(() => {});
  }

  #schedule(delayMs) {
    if (this.timer) {
      this.clearTimer(this.timer);
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.refresh()
        .catch((err) => logger.error('Refresh failed', err))
        .finally(() => {
          if (this.running && !this.timer) {
            this.#schedule(this.config.refresh_interval * 1000);
          }
        });
    }, delayMs);
    this.timer?.unref?.();
  }

  // --- Refresh -------------------------------------------------------------------

  /** One read of the router (coalesced: a refresh asked while one runs joins it). */
  refresh() {
    if (!this.refreshing) {
      this.refreshing = this.#refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async #refresh() {
    if (!this.client) {
      return;
    }
    try {
      if (!this.identity) {
        this.identity = buildIdentity(await this.client.information());
        if (!this.identity.platformId) {
          throw new HuaweiApiError(
            ERROR_CODES.NOT_SUPPORTED,
            'device/information',
            'No serial number',
          );
        }
      }
      const snapshot = await readSnapshot(this.client);
      this.snapshot = snapshot;
      this.reachable = true;
      this.lastError = null;
      this.lastRefreshAt = new Date(this.now()).toISOString();
      await this.#publishDevice();
      await this.gladys.publishChangedStates(
        buildRouterStates(this.gladys, this.identity.platformId, snapshot),
        { heartbeat: STATE_HEARTBEAT_MS },
      );
      await this.#reportStatus(true);
      await this.#reportTransport(DEVICE_TRANSPORTS.LOCAL);
      await this.#onConnectionState(snapshot);
      if (this.config.sms_watch) {
        await this.#watchSms(snapshot).catch((err) => logger.warn('SMS check failed', err));
      }
    } catch (err) {
      this.reachable = false;
      this.lastError = err;
      if (err instanceof RouterUnreachableError) {
        logger.warn(err.message);
      } else {
        logger.error('Router read failed', err);
      }
      await this.#reportStatus(false, err);
      await this.#reportTransport(DEVICE_TRANSPORTS.UNREACHABLE);
      await this.#onUnreachable();
    }
    this.#nudgeWidget();
  }

  async #publishDevice() {
    if (this.publishedPlatformId === this.identity.platformId) {
      return;
    }
    await this.gladys.publishDiscoveredDevices([buildRouterDevice(this.gladys, this.identity)]);
    this.publishedPlatformId = this.identity.platformId;
    logger.info(`Router published: ${this.identity.model}`);
  }

  /** Answer a scan request of the Discovery screen. */
  async publishDiscovered() {
    if (!this.identity) {
      await this.refresh();
    }
    if (this.identity?.platformId) {
      this.publishedPlatformId = null;
      await this.#publishDevice();
    }
  }

  async #reportStatus(ok, err) {
    const key = ok ? 'ok' : `ko:${err?.name}:${err?.code ?? ''}`;
    if (key === this.lastStatusKey) {
      return;
    }
    this.lastStatusKey = key;
    await this.gladys
      .setConnectionStatus(
        ok,
        ok ? undefined : localize((language) => describeError(err, language)),
      )
      .catch((error) => logger.warn('Could not report the connection status', error));
  }

  /** External ids of the router devices: the one read, else the ones created. */
  deviceExternalIds() {
    if (this.identity?.platformId) {
      return [routerIds(this.gladys, this.identity.platformId).device];
    }
    const prefix = this.gladys.externalId(`${DEVICE_TYPE}:`);
    return (this.gladys.devices ?? [])
      .map((device) => device.external_id)
      .filter((id) => typeof id === 'string' && id.startsWith(prefix));
  }

  async #reportTransport(transport) {
    const ids = this.deviceExternalIds();
    const key = `${transport}:${ids.join(',')}`;
    if (ids.length === 0 || key === this.lastTransport) {
      return;
    }
    this.lastTransport = key;
    await this.gladys
      .publishTransports(ids.map((id) => ({ external_id: id, transport })))
      .catch((err) => logger.warn('Could not publish the transport badge', err));
  }

  // --- Scene triggers -------------------------------------------------------------

  async #onConnectionState(snapshot) {
    if (snapshot.connection === 'connecting' || snapshot.connection === 'disconnecting') {
      return; // a transition in progress: wait for where it lands
    }
    const state = snapshot.connected ? CONNECTION_STATES.CONNECTED : CONNECTION_STATES.DISCONNECTED;
    await this.#transition(state);
  }

  async #onUnreachable() {
    if (this.now() < this.rebootUntil) {
      return; // the reboot Gladys asked for: expected, not an event
    }
    await this.#transition(CONNECTION_STATES.UNREACHABLE);
  }

  async #transition(state) {
    const previous = this.connectionState;
    this.connectionState = state;
    if (previous === null || previous === state) {
      return; // the first read is the baseline, not a change
    }
    logger.info(`Connection: ${previous} -> ${state}`);
    await this.#fire(TRIGGERS.CONNECTION_CHANGED, {
      device: this.deviceExternalIds()[0] ?? null,
      state,
      previous_state: previous,
      network_type: this.snapshot && state !== 'unreachable' ? this.snapshot.networkType : null,
      operator: this.snapshot && state !== 'unreachable' ? this.snapshot.operator : null,
    });
  }

  async #watchSms(snapshot) {
    await this.smsStore.load();
    // Most firmwares count the unread messages in check-notifications: no
    // need to list the inbox when it says there is none.
    const unread = snapshot.unreadSms === 0 ? [] : await this.client.unreadSms();
    const current = new Set(unread.map((message) => message.index));
    let changed = false;

    if (!this.smsStore.initialized) {
      // First run: what is already waiting is history, not news.
      this.smsStore.seen = current;
      this.smsStore.initialized = true;
      await this.#saveSmsStore();
      return;
    }

    for (const message of unread) {
      if (this.smsStore.seen.has(message.index)) {
        continue;
      }
      logger.info(`SMS received (index ${message.index})`);
      await this.#fire(TRIGGERS.SMS_RECEIVED, {
        device: this.deviceExternalIds()[0] ?? null,
        sender: message.phone,
        message: message.content.slice(0, 1000),
        date: message.date,
      });
      this.smsStore.seen.add(message.index);
      changed = true;
      if (this.config.sms_mark_read) {
        await this.client
          .markSmsRead(message.index)
          .catch((err) => logger.warn(`Could not mark SMS ${message.index} read`, err));
      }
    }
    // Only the messages still unread need remembering: an index the router
    // frees can come back with a new message.
    for (const index of this.smsStore.seen) {
      if (!current.has(index)) {
        this.smsStore.seen.delete(index);
        changed = true;
      }
    }
    if (changed) {
      await this.#saveSmsStore();
    }
  }

  async #saveSmsStore() {
    await this.smsStore
      .save()
      .catch((err) => logger.warn('Could not save the SMS memory in /data', err));
  }

  async #fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Could not fire the ${key} trigger`, err);
    }
  }

  #nudgeWidget() {
    const s = this.snapshot;
    const key = JSON.stringify([
      this.reachable,
      this.connectionState,
      s?.networkType,
      s?.operator,
      s?.wanIp,
      s?.unreadSms,
      s?.mobileData,
    ]);
    if (key === this.lastWidgetKey) {
      return;
    }
    this.lastWidgetKey = key;
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget nudge dropped: ${err.message}`);
    }
  }

  // --- Operations -------------------------------------------------------------------

  #requireClient() {
    if (!this.client) {
      throw new RouterUnreachableError('The integration is not configured yet');
    }
    return this.client;
  }

  /** Send an SMS; resolves the numbers it went to. */
  async sendSms(rawPhones, rawMessage) {
    const phones = parsePhoneNumbers(rawPhones);
    const message = String(rawMessage ?? '').trim();
    if (!message) {
      throw new Error('The message is empty');
    }
    if (message.length > MAX_SMS_LENGTH) {
      throw new Error(`The message is longer than ${MAX_SMS_LENGTH} characters`);
    }
    await this.#requireClient().sendSms(phones, message);
    logger.info(`SMS sent to ${phones.length} number(s)`);
    return phones;
  }

  async reboot() {
    await this.#requireClient().reboot();
    this.rebootUntil = this.now() + REBOOT_GRACE_MS;
    logger.info('Reboot requested');
  }

  async setMobileData(on) {
    await this.#requireClient().setMobileData(on);
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, mobileData: on };
    }
    if (this.identity?.platformId) {
      await this.gladys.publishChangedStates([
        {
          device_feature_external_id: routerIds(this.gladys, this.identity.platformId).feature(
            FEATURE.MOBILE_DATA,
          ),
          state: on ? 1 : 0,
        },
      ]);
    }
    this.#nudgeWidget();
  }

  /** `onSetValue`: only the mobile data switch is controllable. */
  async setValue(feature, value) {
    if (featureKeyOf(feature.external_id) !== FEATURE.MOBILE_DATA) {
      throw new Error(`${feature.external_id} is read-only`);
    }
    await this.setMobileData(Number(value) === 1);
  }
}
