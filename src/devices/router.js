// -----------------------------------------------------------------------------
// The router as a Gladys device: its features, and the states of a snapshot.
//
// Feature keys are stored by Gladys (history, scenes, dashboards): NEVER rename
// one. A new reading is a new key.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'router';

export const FEATURE = {
  SIGNAL: 'signal',
  RSRP: 'rsrp',
  RSRQ: 'rsrq',
  SINR: 'sinr',
  CONNECTED: 'connected',
  DOWNLOAD_RATE: 'download-rate',
  UPLOAD_RATE: 'upload-rate',
  MONTH_DOWNLOAD: 'month-download',
  MONTH_UPLOAD: 'month-upload',
  CONNECTED_TIME: 'connected-time',
  MOBILE_DATA: 'mobile-data',
  UNREAD_SMS: 'unread-sms',
  NETWORK_TYPE: 'network-type',
  OPERATOR: 'operator',
  WAN_IP: 'wan-ip',
};

const BYTES_PER_GB = 1024 ** 3; // the router's own UI counts in binary units

// Every feature carries name, min, max, read_only and has_feedback: Gladys
// stores them NOT NULL (a missing one: HTTP 422 when the user clicks "Add").
const FEATURES = [
  {
    key: FEATURE.SIGNAL,
    name: 'Signal (bars)',
    category: CATEGORIES.SIGNAL,
    type: TYPES.SIGNAL.QUALITY,
    min: 0,
    max: 5,
    keep_history: true,
    value: (s) => s.signalBars,
  },
  {
    key: FEATURE.RSRP,
    name: 'RSRP (dBm)',
    category: CATEGORIES.UNKNOWN,
    type: TYPES.UNKNOWN.UNKNOWN,
    min: -140,
    max: -44,
    keep_history: true,
    value: (s) => s.rsrp,
  },
  {
    key: FEATURE.RSRQ,
    name: 'RSRQ',
    category: CATEGORIES.UNKNOWN,
    type: TYPES.UNKNOWN.UNKNOWN,
    unit: UNITS.DECIBEL,
    min: -30,
    max: 0,
    keep_history: true,
    value: (s) => s.rsrq,
  },
  {
    key: FEATURE.SINR,
    name: 'SINR',
    category: CATEGORIES.UNKNOWN,
    type: TYPES.UNKNOWN.UNKNOWN,
    unit: UNITS.DECIBEL,
    min: -20,
    max: 40,
    keep_history: true,
    value: (s) => s.sinr,
  },
  {
    key: FEATURE.CONNECTED,
    name: 'Internet connected',
    category: CATEGORIES.UNKNOWN,
    type: TYPES.UNKNOWN.UNKNOWN,
    min: 0,
    max: 1,
    keep_history: true,
    value: (s) => (s.connected ? 1 : 0),
  },
  {
    key: FEATURE.DOWNLOAD_RATE,
    name: 'Download rate',
    category: CATEGORIES.DATARATE,
    type: TYPES.DATARATE.RATE,
    unit: UNITS.MEGABITS_PER_SECOND,
    min: 0,
    max: 10000,
    keep_history: true,
    value: (s) => megabits(s.downloadRate),
  },
  {
    key: FEATURE.UPLOAD_RATE,
    name: 'Upload rate',
    category: CATEGORIES.DATARATE,
    type: TYPES.DATARATE.RATE,
    unit: UNITS.MEGABITS_PER_SECOND,
    min: 0,
    max: 10000,
    keep_history: true,
    value: (s) => megabits(s.uploadRate),
  },
  {
    key: FEATURE.MONTH_DOWNLOAD,
    name: 'Data downloaded this month',
    category: CATEGORIES.DATA,
    type: TYPES.DATA.SIZE,
    unit: UNITS.GIGABYTE,
    min: 0,
    max: 100000,
    keep_history: true,
    value: (s) => gigabytes(s.monthDownload),
  },
  {
    key: FEATURE.MONTH_UPLOAD,
    name: 'Data uploaded this month',
    category: CATEGORIES.DATA,
    type: TYPES.DATA.SIZE,
    unit: UNITS.GIGABYTE,
    min: 0,
    max: 100000,
    keep_history: true,
    value: (s) => gigabytes(s.monthUpload),
  },
  {
    key: FEATURE.CONNECTED_TIME,
    name: 'Connected for',
    category: CATEGORIES.DURATION,
    type: TYPES.DURATION.INTEGER,
    unit: UNITS.MINUTES,
    min: 0,
    max: 5256000,
    keep_history: false,
    value: (s) => (s.connectedSeconds === null ? null : Math.floor(s.connectedSeconds / 60)),
  },
  {
    key: FEATURE.MOBILE_DATA,
    name: 'Mobile data',
    category: CATEGORIES.SWITCH,
    type: TYPES.SWITCH.BINARY,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
    keep_history: true,
    value: (s) => (s.mobileData === null ? null : s.mobileData ? 1 : 0),
  },
  {
    key: FEATURE.UNREAD_SMS,
    name: 'Unread SMS',
    category: CATEGORIES.UNKNOWN,
    type: TYPES.UNKNOWN.UNKNOWN,
    min: 0,
    max: 1000,
    keep_history: false,
    value: (s) => s.unreadSms,
  },
  {
    key: FEATURE.NETWORK_TYPE,
    name: 'Network type',
    category: CATEGORIES.TEXT,
    type: TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    keep_history: false,
    text: (s) => s.networkType,
  },
  {
    key: FEATURE.OPERATOR,
    name: 'Operator',
    category: CATEGORIES.TEXT,
    type: TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    keep_history: false,
    text: (s) => s.operator,
  },
  {
    key: FEATURE.WAN_IP,
    name: 'WAN IP address',
    category: CATEGORIES.TEXT,
    type: TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    keep_history: false,
    text: (s) => s.wanIp,
  },
];

function megabits(bytesPerSecond) {
  return bytesPerSecond === null ? null : round((bytesPerSecond * 8) / 1e6, 2);
}

function gigabytes(bytes) {
  return bytes === null ? null : round(bytes / BYTES_PER_GB, 3);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** The external ids of a router, from its serial number (or IMEI). */
export function routerIds(gladys, platformId) {
  return gladys.externalIds(DEVICE_TYPE, platformId);
}

/**
 * The discovery payload of the router.
 * @param {object} gladys the SDK client
 * @param {{ platformId: string, model: string, firmware: string | null }} identity
 */
export function buildRouterDevice(gladys, identity) {
  const ids = routerIds(gladys, identity.platformId);
  return {
    name: identity.model.startsWith('Huawei') ? identity.model : `Huawei ${identity.model}`,
    external_id: ids.device,
    model: identity.model,
    // The integration reads the router on its own timer (refresh interval of
    // the configuration): Gladys has nothing to poll.
    should_poll: false,
    features: FEATURES.map((feature) => ({
      name: feature.name,
      external_id: ids.feature(feature.key),
      category: feature.category,
      type: feature.type,
      ...(feature.unit ? { unit: feature.unit } : {}),
      min: feature.min,
      max: feature.max,
      read_only: feature.read_only ?? true,
      has_feedback: feature.has_feedback ?? false,
      keep_history: feature.keep_history,
    })),
  };
}

/**
 * The states of a snapshot, in the `publishStates` format. A value the
 * firmware does not give (null) is left out.
 */
export function buildRouterStates(gladys, platformId, snapshot) {
  const ids = routerIds(gladys, platformId);
  const states = [];
  for (const feature of FEATURES) {
    if (feature.text) {
      const text = feature.text(snapshot);
      if (text !== null && text !== undefined) {
        states.push({ device_feature_external_id: ids.feature(feature.key), text: String(text) });
      }
      continue;
    }
    const value = feature.value(snapshot);
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(feature.key), state: value });
    }
  }
  return states;
}

/** The feature key of a feature external id of this integration, or null. */
export function featureKeyOf(externalId) {
  const key = String(externalId).split(':').pop();
  return FEATURES.some((feature) => feature.key === key) ? key : null;
}

export const FEATURE_KEYS = FEATURES.map((feature) => feature.key);
