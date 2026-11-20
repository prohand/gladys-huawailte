import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentity, buildSnapshot } from '../src/huawei/snapshot.js';
import { networkTypeName, parseMeasure } from '../src/huawei/codes.js';

test('parses the measures the router writes with their unit', () => {
  assert.equal(parseMeasure('-95dBm'), -95);
  assert.equal(parseMeasure('-10.5dB'), -10.5);
  assert.equal(parseMeasure('>=-44dBm'), -44);
  assert.equal(parseMeasure('12dB'), 12);
  assert.equal(parseMeasure(''), null);
  assert.equal(parseMeasure(undefined), null);
});

test('names the network type, the newer code first', () => {
  assert.equal(networkTypeName({ CurrentNetworkTypeEx: '1011', CurrentNetworkType: '19' }), 'LTE+');
  assert.equal(networkTypeName({ CurrentNetworkType: '19' }), 'LTE');
  assert.equal(networkTypeName({ CurrentNetworkTypeEx: '111' }), '5G NSA');
  assert.equal(networkTypeName({ CurrentNetworkTypeEx: '999' }), 'Type 999');
  assert.equal(networkTypeName({}), null);
});

test('builds the snapshot from the raw answers', () => {
  const snapshot = buildSnapshot({
    status: {
      ConnectionStatus: '901',
      SignalIcon: '4',
      CurrentNetworkTypeEx: '101',
      WanIPAddress: '10.0.0.1',
    },
    signal: { rsrp: '-95dBm', rsrq: '-10.0dB', sinr: '12dB' },
    traffic: { CurrentDownloadRate: '1250000', CurrentUploadRate: '0', CurrentConnectTime: '120' },
    month: { CurrentMonthDownload: '1073741824', CurrentMonthUpload: '' },
    plmn: { FullName: ' ', ShortName: 'Orange' },
    dataSwitch: { dataswitch: '1' },
    notifications: { UnreadMessage: '2' },
  });
  assert.deepEqual(snapshot, {
    connection: 'connected',
    connected: true,
    networkType: 'LTE',
    operator: 'Orange',
    wanIp: '10.0.0.1',
    signalBars: 4,
    rsrp: -95,
    rsrq: -10,
    sinr: 12,
    downloadRate: 1250000,
    uploadRate: 0,
    monthDownload: 1073741824,
    monthUpload: null,
    connectedSeconds: 120,
    mobileData: true,
    unreadSms: 2,
  });
});

test('a firmware giving only the status still gives a snapshot', () => {
  const snapshot = buildSnapshot({ status: { ConnectionStatus: '902', SignalStrength: '61' } });
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.connection, 'disconnected');
  assert.equal(snapshot.signalBars, 3);
  assert.equal(snapshot.rsrp, null);
  assert.equal(snapshot.mobileData, null);
  assert.equal(snapshot.unreadSms, null);
});

test('an unknown connection code is an error state', () => {
  assert.equal(buildSnapshot({ status: { ConnectionStatus: '112' } }).connection, 'error');
});

test('the identity is keyed on the serial number, else the IMEI', () => {
  assert.deepEqual(
    buildIdentity({ DeviceName: 'B535-232', SerialNumber: 'AB 12/34', SoftwareVersion: '11.0' }),
    {
      platformId: 'AB1234',
      model: 'B535-232',
      firmware: '11.0',
      serial: 'AB 12/34',
    },
  );
  assert.equal(buildIdentity({ Imei: '861234567890123' }).platformId, '861234567890123');
  assert.equal(buildIdentity({}).platformId, null);
  assert.equal(buildIdentity({}).model, 'Huawei LTE');
});
