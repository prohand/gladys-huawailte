import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { DEVICE_ID, feature, setup } from './helpers/setup.js';
import { REBOOT_GRACE_MS, parsePhoneNumbers } from '../src/service.js';
import { FEATURE_KEYS } from '../src/devices/router.js';

test('the first read publishes the router, its states, status and transport', async () => {
  const { gladys, service } = await setup();
  await service.refresh();

  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE_ID);
  assert.equal(device.name, 'Huawei B535-232');
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.features.map((f) => f.external_id),
    FEATURE_KEYS.map((key) => feature(key)),
  );
  for (const f of device.features) {
    for (const column of ['name', 'min', 'max', 'read_only', 'has_feedback']) {
      assert.notEqual(f[column], undefined, `${f.external_id}.${column}`);
    }
  }

  assert.equal(gladys.fake.lastState(feature('signal')), 4);
  assert.equal(gladys.fake.lastState(feature('rsrp')), -95);
  assert.equal(gladys.fake.lastState(feature('sinr')), 12);
  assert.equal(gladys.fake.lastState(feature('connected')), 1);
  assert.equal(gladys.fake.lastState(feature('download-rate')), 10);
  assert.equal(gladys.fake.lastState(feature('upload-rate')), 1);
  assert.equal(gladys.fake.lastState(feature('month-download')), 5);
  assert.equal(gladys.fake.lastState(feature('connected-time')), 121);
  assert.equal(gladys.fake.lastState(feature('mobile-data')), 1);
  assert.equal(gladys.fake.lastState(feature('unread-sms')), 0);
  assert.equal(gladys.fake.lastState(feature('network-type')), 'LTE+');
  assert.equal(gladys.fake.lastState(feature('operator')), 'Orange F');
  assert.equal(gladys.fake.lastState(feature('wan-ip')), '10.20.30.40');

  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
});

test('unchanged values are not published again', async () => {
  const { gladys, router, service } = await setup();
  await service.refresh();
  const count = gladys.fake.states.length;
  await service.refresh();
  assert.equal(gladys.fake.states.length, count);
  router.signal.rsrp = '-100dBm';
  await service.refresh();
  const fresh = gladys.fake.states.slice(count);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].device_feature_external_id, feature('rsrp'));
  assert.equal(fresh[0].state, -100);
});

test('an unreachable router: status, badge and trigger, once', async () => {
  const { gladys, router, service } = await setup();
  await service.refresh();
  router.reachable = false;
  await service.refresh();
  await service.refresh();

  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer/);
  assert.equal(gladys.fake.connectionStatus.message.de.length > 0, true);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  const events = gladys.fake.sceneEvents.filter((e) => e.key === 'connection_changed');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.state, 'unreachable');
  assert.equal(events[0].data.previous_state, 'connected');
  assert.equal(events[0].data.device, DEVICE_ID);

  router.reachable = true;
  await service.refresh();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const back = gladys.fake.sceneEvents.filter((e) => e.key === 'connection_changed');
  assert.equal(back.length, 2);
  assert.equal(back[1].data.state, 'connected');
  assert.equal(back[1].data.operator, 'Orange F');
});

test('the mobile network lost and back fires connection_changed', async () => {
  const { gladys, router, service } = await setup();
  await service.refresh(); // baseline: no event
  assert.equal(gladys.fake.sceneEvents.length, 0);
  router.status.ConnectionStatus = '900'; // connecting: wait
  await service.refresh();
  assert.equal(gladys.fake.sceneEvents.length, 0);
  router.status.ConnectionStatus = '902';
  await service.refresh();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.data.state),
    ['disconnected'],
  );
  assert.equal(gladys.fake.lastState(feature('connected')), 0);
});

test('the reboot Gladys asked for does not fire "unreachable"', async () => {
  const { gladys, router, service, clock } = await setup();
  await service.refresh();
  const result = await gladys.fake.sceneAction('reboot_router', {});
  assert.deepEqual(result.data.outputs, { rebooted: true });
  assert.equal(router.rebooted, 1);

  router.reachable = false;
  router.expireSessions();
  await service.refresh();
  router.reachable = true;
  await service.refresh();
  assert.deepEqual(gladys.fake.sceneEvents, []);

  // After the grace period, a lost router is an event again.
  clock.now += REBOOT_GRACE_MS + 1;
  router.reachable = false;
  await service.refresh();
  assert.equal(gladys.fake.sceneEvents.at(-1).data.state, 'unreachable');
});

test('SMS already waiting at the first run are history, new ones fire', async () => {
  const { gladys, router, service, dataDir } = await setup();
  router.addSms('+33600000000', 'old news', '2026-11-19 08:00:00');
  await service.refresh();
  assert.deepEqual(gladys.fake.sceneEvents, []);

  router.addSms('+33611111111', 'Alarm triggered', '2026-11-20 10:00:00');
  await service.refresh();
  const events = gladys.fake.sceneEvents.filter((e) => e.key === 'sms_received');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    device: DEVICE_ID,
    sender: '+33611111111',
    message: 'Alarm triggered',
    date: '2026-11-20 10:00:00',
  });
  // Marked read on the router (default), so not fired again.
  assert.equal(router.inbox.find((sms) => sms.content === 'Alarm triggered').read, true);
  await service.refresh();
  assert.equal(gladys.fake.sceneEvents.filter((e) => e.key === 'sms_received').length, 1);

  const saved = JSON.parse(await readFile(join(dataDir, 'sms-seen.json'), 'utf8'));
  assert.equal(saved.initialized, true);
});

test('with "mark as read" off, a message fires once and survives a restart', async () => {
  const first = await setup({ config: { sms_mark_read: false } });
  await first.service.refresh(); // baseline
  first.router.addSms('+33611111111', 'hello');
  await first.service.refresh();
  await first.service.refresh();
  assert.equal(first.gladys.fake.sceneEvents.length, 1);
  assert.equal(first.router.inbox[0].read, false);

  // Same /data, new process: the message is remembered.
  const second = await setup({ config: { sms_mark_read: false } });
  second.service.smsStore.path = join(first.dataDir, 'sms-seen.json');
  second.service.smsStore.directory = first.dataDir;
  second.service.client = first.service.client;
  await second.service.refresh();
  assert.equal(second.gladys.fake.sceneEvents.length, 0);
});

test('SMS watching can be turned off', async () => {
  const { gladys, router, service } = await setup({ config: { sms_watch: false } });
  await service.refresh();
  router.addSms('+33611111111', 'hello');
  await service.refresh();
  assert.deepEqual(gladys.fake.sceneEvents, []);
  assert.ok(!router.requests.some((r) => r.path === '/api/sms/sms-list'));
});

test('the send_sms scene action sends and returns its outputs', async () => {
  const { gladys, router } = await setup();
  const ack = await gladys.fake.sceneAction('send_sms', {
    phone: '+33 6 11 11 11 11, 0622222222',
    message: 'Door opened',
  });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.deepEqual(router.sent[0].phones, ['+33611111111', '0622222222']);
  assert.equal(router.sent[0].content, 'Door opened');

  const refused = await gladys.fake.sceneAction('send_sms', { phone: 'abc', message: 'x' });
  assert.equal(refused.success, false);
  assert.equal(router.sent.length, 1);
});

test('phone numbers are cleaned and checked', () => {
  assert.deepEqual(parsePhoneNumbers('+33 (0)6.11-22-33-44; 0611223344'), [
    '+330611223344',
    '0611223344',
  ]);
  assert.throws(() => parsePhoneNumbers(''), /No phone number/);
  assert.throws(() => parsePhoneNumbers('1,2,3,4,5,6'), /At most 5/);
  assert.throws(() => parsePhoneNumbers('12a'), /Invalid phone number/);
});

test('the mobile data switch drives the router', async () => {
  const { gladys, router, service } = await setup();
  await service.refresh();
  const device = gladys.fake.discoveredDevices[0];
  const dataFeature = device.features.find((f) => f.external_id === feature('mobile-data'));
  const ack = await gladys.fake.setValue(device, dataFeature, 0);
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.equal(router.dataswitch, 0);
  assert.equal(gladys.fake.lastState(feature('mobile-data')), 0);

  const signal = device.features.find((f) => f.external_id === feature('signal'));
  assert.equal((await gladys.fake.setValue(device, signal, 1)).success, false);
});

test('manifest actions: test, test SMS, reboot', async () => {
  const { gladys, router } = await setup();
  const tested = await gladys.fake.action('test_connection', {});
  assert.equal(tested.success, true);
  assert.match(tested.data.message.en, /Connected to B535-232/);
  assert.match(tested.data.message.fr, /Connecté au B535-232/);
  assert.match(tested.data.message.de, /Signal 4\/5/);
  assert.match(tested.data.message.es, /internet conectado/);

  const sms = await gladys.fake.action('send_test_sms', { phone: '+33611111111' });
  assert.equal(sms.success, true);
  assert.equal(router.sent[0].content, 'Test message from Gladys Assistant.');

  const reboot = await gladys.fake.action('reboot_router', {});
  assert.equal(reboot.success, true);
  assert.equal(router.rebooted, 1);
});

test('a wrong password shows a clear status, in every language', async () => {
  const { gladys, service } = await setup({ config: { password: 'nope' } });
  await service.refresh();
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.en, /refused the username or password/);
  assert.deepEqual(Object.keys(status.message).sort(), ['de', 'en', 'es', 'fr']);
  const tested = await gladys.fake.action('test_connection', {});
  assert.match(tested.data.message.fr, /mot de passe/);
});

test('a scan publishes the router', async () => {
  const { gladys } = await setup();
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices[0].external_id, DEVICE_ID);
});

test('a new configuration opens a new session on the next refresh', async () => {
  const { gladys, router, service, timers } = await setup();
  await service.refresh();
  const logins = router.loginAttempts;
  await gladys.fake.configUpdated({
    router_url: 'http://192.168.8.1',
    username: 'admin',
    password: 'secret',
    refresh_interval: 30,
  });
  assert.equal(service.config.refresh_interval, 30);
  assert.ok(timers.length > 0, 'a refresh is scheduled');
  await service.refresh();
  assert.equal(router.loginAttempts, logins, 'same credentials: same session');
});

test('the refresh loop reschedules itself at the configured interval', async () => {
  const { service, timers } = await setup({ config: { refresh_interval: 45 } });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 0);
  const first = timers.shift();
  first.fn();
  await service.refreshing;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.at(-1).ms, 45_000);
  service.pause();
  assert.equal(timers.length, 0);
});

test('the widget content fits the vocabulary in every state', async () => {
  const { gladys, router, service } = await setup({ config: { dashboard_controls: true } });

  const waiting = await gladys.fake.widgetGet('lte_router', {});
  assert.equal(waiting.success, true);
  assert.deepEqual(validateWidgetContent(waiting.data.content), []);

  await service.refresh();
  const live = (await gladys.fake.widgetGet('lte_router', { settings: { show_wan_ip: true } })).data
    .content;
  assert.deepEqual(validateWidgetContent(live), []);
  const types = live.components.map((c) => c.type);
  assert.deepEqual(types, [
    'value',
    'value',
    'value',
    'value',
    'status',
    'button',
    'button',
    'button',
  ]);
  const status = live.components.find((c) => c.type === 'status');
  assert.ok(status.items.some((item) => item.value === '10.20.30.40'));

  const hidden = (await gladys.fake.widgetGet('lte_router', {})).data.content;
  const hiddenStatus = hidden.components.find((c) => c.type === 'status');
  assert.ok(
    !hiddenStatus.items.some((item) => item.value === '10.20.30.40'),
    'WAN IP hidden by default',
  );

  router.reachable = false;
  await service.refresh();
  const down = (await gladys.fake.widgetGet('lte_router', {})).data.content;
  assert.deepEqual(validateWidgetContent(down), []);
  assert.equal(down.components[0].type, 'text');
  assert.ok(!down.components.some((c) => c.type === 'button'));
});

test('the widget tiles follow the live features once the router is created', async () => {
  const { gladys, service } = await setup({ devices: [{ external_id: DEVICE_ID, features: [] }] });
  await service.refresh();
  const content = (await gladys.fake.widgetGet('lte_router', {})).data.content;
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((t) => t.device_feature),
    [
      feature('signal'),
      feature('download-rate'),
      feature('upload-rate'),
      feature('month-download'),
    ],
  );
});

test('the widget has no control buttons unless the administrator enabled them', async () => {
  const { gladys, router, service } = await setup();
  await service.refresh();
  const content = (await gladys.fake.widgetGet('lte_router', {})).data.content;
  assert.ok(!content.components.some((c) => c.type === 'button'));
  const refused = await gladys.fake.widgetAction('lte_router', 'reboot', {}, {});
  assert.equal(refused.success, false);
  assert.equal(router.rebooted, 0);
});

test('the widget buttons send an SMS, switch the data and reboot', async () => {
  const { gladys, router, service } = await setup({ config: { dashboard_controls: true } });
  await service.refresh();

  const sms = await gladys.fake.widgetAction(
    'lte_router',
    'send_sms',
    {},
    {
      values: { phone: '+33611111111', message: 'From the dashboard' },
    },
  );
  assert.equal(sms.success, true, JSON.stringify(sms));
  assert.equal(router.sent[0].content, 'From the dashboard');

  const noForm = await gladys.fake.widgetAction('lte_router', 'send_sms', {}, {});
  assert.equal(noForm.success, false);

  const data = await gladys.fake.widgetAction('lte_router', 'mobile_data', { on: false }, {});
  assert.equal(data.success, true);
  assert.equal(router.dataswitch, 0);

  const reboot = await gladys.fake.widgetAction('lte_router', 'reboot', {}, {});
  assert.equal(reboot.success, true);
  assert.equal(router.rebooted, 1);
});
