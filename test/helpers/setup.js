// The integration wired to the SDK's fake Gladys and to a fake router, with a
// clock and timers the test drives: nothing runs until the test says so.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { HuaweiClient } from '../../src/huawei/client.js';
import { registerHandlers } from '../../src/app.js';
import { createFakeRouter } from './fakeRouter.js';

export const SELECTOR = 'test-integration';
export const DEVICE_ID = `ext:${SELECTOR}:router:ABC123456789`;
export const feature = (key) => `${DEVICE_ID}:${key}`;

export async function setup({ config = {}, router: routerOptions = {}, devices = [] } = {}) {
  const router = createFakeRouter(routerOptions);
  const clock = { now: 1_800_000_000_000 };
  const timers = [];
  const dataDir = await mkdtemp(join(tmpdir(), 'huawei-lte-'));
  const gladys = createFakeGladys({
    config: { router_url: 'http://192.168.8.1', username: 'admin', password: 'secret', ...config },
    devices,
  });
  const service = registerHandlers(gladys, {
    createClient: (cfg) =>
      new HuaweiClient({
        url: cfg.router_url,
        username: cfg.username,
        password: cfg.password,
        fetch: router.fetch,
        now: () => clock.now,
      }),
    dataDir,
    now: () => clock.now,
    setTimer: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer);
      if (index !== -1) {
        timers.splice(index, 1);
      }
    },
  });
  await gladys.connect();
  return { gladys, router, service, clock, timers, dataDir };
}
