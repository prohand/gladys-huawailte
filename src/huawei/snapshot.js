// -----------------------------------------------------------------------------
// One read of the router, turned into plain values.
//
// `monitoring/status` is the one read that must work: it says whether the
// router is reachable and connected. Every other endpoint is optional (each
// firmware has its own subset): a missing one leaves its values `null`, and
// those values are simply not published.
// -----------------------------------------------------------------------------

import { CONNECTION_STATUS, networkTypeName, parseMeasure, toInt } from './codes.js';

/**
 * @typedef {object} RouterSnapshot
 * @property {string} connection 'connected' | 'disconnected' | 'connecting' | 'disconnecting' | 'error'
 * @property {boolean} connected
 * @property {string | null} networkType  e.g. 'LTE+'
 * @property {string | null} operator     e.g. 'Orange F'
 * @property {string | null} wanIp
 * @property {number | null} signalBars   0-5
 * @property {number | null} rsrp         dBm
 * @property {number | null} rsrq         dB
 * @property {number | null} sinr         dB
 * @property {number | null} downloadRate bytes per second
 * @property {number | null} uploadRate   bytes per second
 * @property {number | null} monthDownload bytes, current month
 * @property {number | null} monthUpload   bytes, current month
 * @property {number | null} connectedSeconds current connection
 * @property {boolean | null} mobileData  the "mobile data" switch of the router
 * @property {number | null} unreadSms
 */

const CONNECTION_NAMES = {
  [CONNECTION_STATUS.CONNECTING]: 'connecting',
  [CONNECTION_STATUS.CONNECTED]: 'connected',
  [CONNECTION_STATUS.DISCONNECTED]: 'disconnected',
  [CONNECTION_STATUS.DISCONNECTING]: 'disconnecting',
};

/**
 * Read everything the dashboard and the scenes need, in one pass.
 * @param {import('./client.js').HuaweiClient} client
 * @returns {Promise<RouterSnapshot>}
 */
export async function readSnapshot(client) {
  const status = await client.get('monitoring/status');
  const signal = await client.getOptional('device/signal');
  const traffic = await client.getOptional('monitoring/traffic-statistics');
  const month = await client.getOptional('monitoring/month_statistics');
  const plmn = await client.getOptional('net/current-plmn');
  const dataSwitch = await client.getOptional('dialup/mobile-dataswitch');
  const notifications = await client.getOptional('monitoring/check-notifications');
  return buildSnapshot({ status, signal, traffic, month, plmn, dataSwitch, notifications });
}

/** Pure part of {@link readSnapshot}: raw answers → values. */
export function buildSnapshot({ status, signal, traffic, month, plmn, dataSwitch, notifications }) {
  const code = toInt(status?.ConnectionStatus);
  const connection = CONNECTION_NAMES[code] ?? 'error';
  return {
    connection,
    connected: connection === 'connected',
    networkType: networkTypeName(status ?? {}),
    operator: textOrNull(plmn?.FullName) ?? textOrNull(plmn?.ShortName),
    wanIp: textOrNull(status?.WanIPAddress),
    signalBars: signalBars(status),
    rsrp: parseMeasure(signal?.rsrp),
    rsrq: parseMeasure(signal?.rsrq),
    sinr: parseMeasure(signal?.sinr),
    downloadRate: numberOrNull(traffic?.CurrentDownloadRate),
    uploadRate: numberOrNull(traffic?.CurrentUploadRate),
    monthDownload: numberOrNull(month?.CurrentMonthDownload),
    monthUpload: numberOrNull(month?.CurrentMonthUpload),
    connectedSeconds: numberOrNull(traffic?.CurrentConnectTime),
    mobileData: dataSwitch ? toInt(dataSwitch.dataswitch) === 1 : null,
    unreadSms: toInt(notifications?.UnreadMessage),
  };
}

// Bars as the router's own UI shows them: SignalIcon (0-5), else the
// SignalStrength percentage on older firmwares.
function signalBars(status) {
  const icon = toInt(status?.SignalIcon);
  if (icon !== null) {
    return Math.max(0, Math.min(5, icon));
  }
  const percent = toInt(status?.SignalStrength);
  return percent === null ? null : Math.max(0, Math.min(5, Math.round(percent / 20)));
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  return text ? text : null;
}

/**
 * Identity of the router, from `device/information`: the serial number (or
 * the IMEI) is what the Gladys device is keyed on.
 */
export function buildIdentity(information = {}) {
  const serial = textOrNull(information.SerialNumber) ?? textOrNull(information.Imei);
  return {
    platformId: serial ? serial.replace(/[^A-Za-z0-9_-]/g, '') : null,
    model: textOrNull(information.DeviceName) ?? 'Huawei LTE',
    firmware: textOrNull(information.SoftwareVersion),
    serial: textOrNull(information.SerialNumber),
  };
}
