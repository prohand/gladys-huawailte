// -----------------------------------------------------------------------------
// The numeric codes of the Huawei HiLink API, and what they mean.
//
// Sources: the router's own web UI and the reverse-engineering work of the
// huawei-lte-api project (used by Home Assistant). Codes not listed here are
// passed through as numbers: a firmware is free to invent new ones.
// -----------------------------------------------------------------------------

/** API error codes (`<error><code>`). */
export const ERROR_CODES = {
  UNKNOWN: 100001,
  NOT_SUPPORTED: 100002,
  NO_RIGHTS: 100003, // login required
  BUSY: 100004,
  FORMAT_ERROR: 100005,
  USERNAME_WRONG: 108001,
  PASSWORD_WRONG: 108002,
  ALREADY_LOGGED_IN: 108003,
  USERNAME_PASSWORD_WRONG: 108006,
  TOO_MANY_ATTEMPTS: 108007,
  PASSWORD_MUST_CHANGE: 115002,
  WRONG_TOKEN: 125001,
  CSRF: 125002, // session / token expired
  WRONG_SESSION_TOKEN: 125003,
};

/** The errors a fresh session (and a new login) cures. */
export const SESSION_ERRORS = new Set([
  ERROR_CODES.NO_RIGHTS,
  ERROR_CODES.WRONG_TOKEN,
  ERROR_CODES.CSRF,
  ERROR_CODES.WRONG_SESSION_TOKEN,
]);

/** The login errors that mean "the credentials are wrong": retrying is useless. */
export const CREDENTIAL_ERRORS = new Set([
  ERROR_CODES.USERNAME_WRONG,
  ERROR_CODES.PASSWORD_WRONG,
  ERROR_CODES.USERNAME_PASSWORD_WRONG,
  ERROR_CODES.TOO_MANY_ATTEMPTS,
  ERROR_CODES.PASSWORD_MUST_CHANGE,
]);

/** `monitoring/status` ConnectionStatus. */
export const CONNECTION_STATUS = {
  CONNECTING: 900,
  CONNECTED: 901,
  DISCONNECTED: 902,
  DISCONNECTING: 903,
};

/** `user/state-login` State. */
export const LOGIN_STATE = { LOGGED_IN: 0, LOGGED_OUT: -1 };

/** `user/state-login` password_type: 4 is the salted SHA-256 (or SCRAM) scheme. */
export const PASSWORD_TYPE = { BASE64: 0, BASE64_AFTER_CHANGE: 3, SHA256: 4 };

// `monitoring/status` CurrentNetworkTypeEx (newer firmwares).
const NETWORK_TYPES_EX = {
  0: 'No service',
  1: 'GSM',
  2: 'GPRS',
  3: 'EDGE',
  41: 'WCDMA',
  42: 'HSDPA',
  43: 'HSUPA',
  44: 'HSPA',
  45: 'HSPA+',
  46: 'DC-HSPA+',
  61: 'TD-SCDMA',
  62: 'TD-HSDPA',
  63: 'TD-HSUPA',
  64: 'TD-HSPA',
  65: 'TD-HSPA+',
  81: '802.16e',
  101: 'LTE',
  1011: 'LTE+',
  111: '5G NSA',
  112: '5G SA',
};

// `monitoring/status` CurrentNetworkType (older firmwares).
const NETWORK_TYPES = {
  0: 'No service',
  1: 'GSM',
  2: 'GPRS',
  3: 'EDGE',
  4: 'WCDMA',
  5: 'HSDPA',
  6: 'HSUPA',
  7: 'HSPA',
  8: 'TD-SCDMA',
  9: 'HSPA+',
  19: 'LTE',
  41: 'WCDMA',
  101: 'LTE',
  1011: 'LTE+',
};

/**
 * Human name of the radio access technology in use, e.g. `LTE+`.
 * @param {{ CurrentNetworkTypeEx?: string, CurrentNetworkType?: string }} status
 * @returns {string | null}
 */
export function networkTypeName(status = {}) {
  const ex = toInt(status.CurrentNetworkTypeEx);
  if (ex !== null && NETWORK_TYPES_EX[ex]) {
    return NETWORK_TYPES_EX[ex];
  }
  const legacy = toInt(status.CurrentNetworkType);
  if (legacy !== null && NETWORK_TYPES[legacy]) {
    return NETWORK_TYPES[legacy];
  }
  if (ex !== null) {
    return `Type ${ex}`;
  }
  return legacy !== null ? `Type ${legacy}` : null;
}

/**
 * Parse a measurement the router writes with its unit: `-95dBm`, `12dB`,
 * `>=-44dBm`, `-10.5dB`. Returns `null` when there is no number.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseMeasure(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** Integer value of a field, `null` when absent or not a number. */
export function toInt(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? number : null;
}
