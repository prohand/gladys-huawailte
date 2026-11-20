// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module only gives the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay equal to the `default` values of the manifest
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // The address most Huawei LTE routers and HiLink sticks answer on.
  router_url: 'http://192.168.8.1',
  username: 'admin',
  // `secret` field: no default allowed in the manifest. Empty = no login
  // (HiLink sticks without a password).
  password: '',
  // Seconds between two reads of the router.
  refresh_interval: 60,
  // Fire the "SMS received" trigger for each new message of the inbox.
  sms_watch: true,
  // Mark a message read once the trigger fired, like the router's web UI does.
  sms_mark_read: true,
  // Buttons on the dashboard widget that act on the router (send an SMS,
  // reboot, mobile data). Off by default: a dashboard can hang on a wall.
  dashboard_controls: false,
};

export const REFRESH_MIN_SECONDS = 15;
export const REFRESH_MAX_SECONDS = 3600;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const refresh = Number(raw.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
  return {
    ...DEFAULT_CONFIG,
    router_url: stringOr(raw.router_url, DEFAULT_CONFIG.router_url),
    username: stringOr(raw.username, DEFAULT_CONFIG.username),
    password: typeof raw.password === 'string' ? raw.password : '',
    refresh_interval: Number.isFinite(refresh)
      ? Math.min(REFRESH_MAX_SECONDS, Math.max(REFRESH_MIN_SECONDS, Math.round(refresh)))
      : DEFAULT_CONFIG.refresh_interval,
    sms_watch: booleanOr(raw.sms_watch, DEFAULT_CONFIG.sms_watch),
    sms_mark_read: booleanOr(raw.sms_mark_read, DEFAULT_CONFIG.sms_mark_read),
    dashboard_controls: booleanOr(raw.dashboard_controls, DEFAULT_CONFIG.dashboard_controls),
  };
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function booleanOr(value, fallback) {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return fallback;
}

/** The part of the config that needs a new router session when it changes. */
export function connectionKey(config) {
  return JSON.stringify([config.router_url, config.username, config.password]);
}
