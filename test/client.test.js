import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HuaweiApiError,
  HuaweiClient,
  RouterUnreachableError,
  hashPasswordSha256,
  normalizeRouterUrl,
  routerDate,
  scramProof,
} from '../src/huawei/client.js';
import { createFakeRouter } from './helpers/fakeRouter.js';

function clientFor(router, extra = {}) {
  return new HuaweiClient({
    url: 'http://192.168.8.1',
    username: 'admin',
    password: 'secret',
    fetch: router.fetch,
    ...extra,
  });
}

test('normalizes the router address', () => {
  assert.equal(normalizeRouterUrl('192.168.8.1'), 'http://192.168.8.1');
  assert.equal(normalizeRouterUrl(' http://192.168.8.1/ '), 'http://192.168.8.1');
  assert.equal(normalizeRouterUrl('http://admin:pw@192.168.1.1/html/'), 'http://192.168.1.1/html');
  assert.equal(normalizeRouterUrl(''), '');
});

test('the legacy SHA-256 hash matches the reference implementation', () => {
  // Computed with huawei-lte-api's User._encode_password (password_type 4).
  assert.equal(
    hashPasswordSha256('admin', 'password', 'token'),
    'NzE3MDU1ZWFlNDA2NWMwN2Q5ZjQ3OWEzMDJhZmY2MzEwZDM4MzFhYjM5MWQxMDNlMzExOGFhOTljNjdjNTE2ZA==',
  );
});

test('the SCRAM proof matches the reference implementation', () => {
  // Computed with huawei-lte-api's scram_client_proof (the firmware's own
  // key/message order, not plain RFC 5802).
  assert.deepEqual(scramProof('secret', 'aa'.repeat(32), 100, 'first', 'firstserver'), {
    clientProof: '653198da9d47a6d5535d9cf18076bff006a02ece61fddea0784432e57fa6b943',
    serverSignature: '33c4e4f94603b2f890519e87b310d0c81f4222221fcf78f9e6befad4f1d07f55',
  });
});

test('routerDate writes the local date the way the router does', () => {
  assert.equal(routerDate(new Date(2026, 0, 5, 7, 8, 9)), '2026-01-05 07:08:09');
});

for (const loginMode of ['sha256', 'scram', 'base64', 'none']) {
  test(`logs in (${loginMode}) and reads protected endpoints`, async () => {
    const router = createFakeRouter({ loginMode });
    const client = clientFor(router);
    const info = await client.information();
    assert.equal(info.SerialNumber, 'ABC123456789');
    const status = await client.get('monitoring/status');
    assert.equal(status.ConnectionStatus, '901');
  });
}

test('gets its token from the API when the home page has none', async () => {
  const router = createFakeRouter({ homeTokens: false });
  const client = clientFor(router);
  assert.equal((await client.information()).DeviceName, 'B535-232');
  assert.ok(router.requests.some((r) => r.path === '/api/webserver/token'));
});

test('an expired session is reopened, logged in again, and the call retried', async () => {
  const router = createFakeRouter();
  const client = clientFor(router);
  await client.information();
  assert.equal(router.loginAttempts, 1);
  router.expireSessions();
  assert.equal((await client.get('monitoring/status')).SignalIcon, '4');
  assert.equal(router.loginAttempts, 2);
  // POSTs recover too (their token is refused by the new session).
  router.expireSessions();
  await client.setMobileData(false);
  assert.equal(router.dataswitch, 0);
});

test('consecutive POSTs each use a fresh token', async () => {
  const router = createFakeRouter();
  const client = clientFor(router);
  await client.setMobileData(false);
  await client.setMobileData(true);
  await client.markSmsRead(40001);
  await client.reboot();
  assert.equal(router.dataswitch, 1);
  assert.equal(router.rebooted, 1);
  assert.equal(router.loginAttempts, 1, 'no token was refused, no new login needed');
});

test('parallel calls are queued, never sharing a token', async () => {
  const router = createFakeRouter();
  const client = clientFor(router);
  await Promise.all([
    client.setMobileData(false),
    client.get('monitoring/status'),
    client.sendSms(['+33600000001'], 'one'),
    client.sendSms(['+33600000002'], 'two'),
  ]);
  assert.equal(router.sent.length, 2);
  assert.equal(router.loginAttempts, 1);
});

test('a wrong password is not retried for a while (the router would lock)', async () => {
  let now = 1_000_000;
  const router = createFakeRouter({ password: 'right' });
  const client = clientFor(router, { password: 'wrong', now: () => now });
  await assert.rejects(
    client.information(),
    (err) => err instanceof HuaweiApiError && err.code === 108006,
  );
  assert.equal(router.loginAttempts, 1);
  await assert.rejects(client.information(), HuaweiApiError);
  assert.equal(router.loginAttempts, 1, 'second call did not hit the login');
  now += 11 * 60 * 1000;
  await assert.rejects(client.information(), HuaweiApiError);
  assert.equal(router.loginAttempts, 2);
});

test('an unreachable router is a RouterUnreachableError', async () => {
  const router = createFakeRouter();
  router.reachable = false;
  await assert.rejects(clientFor(router).information(), RouterUnreachableError);
  await assert.rejects(new HuaweiClient({ url: '' }).information(), RouterUnreachableError);
});

test('getOptional turns an unsupported endpoint into null', async () => {
  const router = createFakeRouter();
  const client = clientFor(router);
  assert.equal(await client.getOptional('lan/HostInfo'), null);
});

test('lists the unread SMS, oldest first', async () => {
  const router = createFakeRouter();
  router.addSms('+33611111111', 'second', '2026-11-20 10:05:00');
  router.addSms('+33622222222', 'first', '2026-11-20 10:00:00');
  const read = router.addSms('+33633333333', 'old', '2026-11-19 10:00:00');
  router.inbox.find((sms) => sms.index === read).read = true;
  const client = clientFor(router);
  const unread = await client.unreadSms();
  assert.deepEqual(
    unread.map((sms) => sms.content),
    ['first', 'second'],
  );
  assert.equal(unread[0].phone, '+33622222222');
  await client.markSmsRead(unread[0].index);
  assert.equal((await client.unreadSms()).length, 1);
});

test('sends an SMS with the fields the router expects', async () => {
  const router = createFakeRouter();
  const client = clientFor(router);
  await client.sendSms(
    ['+33611111111', '0622222222'],
    'Hello & bye',
    new Date(2026, 10, 20, 9, 0, 0),
  );
  assert.deepEqual(router.sent, [
    {
      phones: ['+33611111111', '0622222222'],
      content: 'Hello & bye',
      length: 11,
      date: '2026-11-20 09:00:00',
    },
  ]);
  const body = router.requests.find((r) => r.path === '/api/sms/send-sms').body;
  assert.match(body, /<Index>-1<\/Index><Phones><Phone>/);
});

test('logout frees the session', async () => {
  const router = createFakeRouter();
  const client = clientFor(router);
  await client.information();
  await client.logout();
  assert.ok(router.requests.some((r) => r.path === '/api/user/logout'));
});
