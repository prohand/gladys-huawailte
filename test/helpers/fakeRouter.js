// -----------------------------------------------------------------------------
// An in-memory Huawei router, served through a `fetch` function.
//
// It plays the parts of the HiLink web API the integration relies on, with the
// same rules as a real router: a SessionID cookie, CSRF tokens consumed by
// every POST and handed back in the answer headers, a login (legacy SHA-256,
// SCRAM, base64 or none), sessions that expire, and `<error>` answers.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { hashPasswordSha256, scramProof } from '../../src/huawei/client.js';
import { buildRequest, parseXml } from '../../src/huawei/xml.js';

const ok = '<?xml version="1.0" encoding="UTF-8"?><response>OK</response>';

function error(code) {
  return `<?xml version="1.0" encoding="UTF-8"?><error><code>${code}</code><message></message></error>`;
}

function response(data) {
  // Reuse the request builder, then rename the root.
  return buildRequest(data).replace('<request>', '<response>').replace('</request>', '</response>');
}

/**
 * @param {object} [options]
 * @param {'sha256' | 'scram' | 'base64' | 'none'} [options.loginMode]
 * @param {boolean} [options.homeTokens] CSRF tokens in the home page (else API)
 */
export function createFakeRouter({
  username = 'admin',
  password = 'secret',
  loginMode = 'sha256',
  homeTokens = true,
} = {}) {
  let sessionCounter = 0;
  const router = {
    reachable: true,
    loginAttempts: 0,
    sessions: new Map(), // id -> { loggedIn }
    tokens: new Set(),
    requests: [],
    information: {
      DeviceName: 'B535-232',
      SerialNumber: 'ABC123456789',
      Imei: '861234567890123',
      SoftwareVersion: '11.0.2.1(H195SP7C983)',
      HardwareVersion: 'WL1B530FM',
    },
    status: {
      ConnectionStatus: '901',
      SignalIcon: '4',
      CurrentNetworkType: '19',
      CurrentNetworkTypeEx: '1011',
      WanIPAddress: '10.20.30.40',
    },
    signal: { rsrp: '-95dBm', rsrq: '-10.0dB', sinr: '12dB', rssi: '-67dBm' },
    traffic: {
      CurrentConnectTime: '7260',
      CurrentDownloadRate: '1250000',
      CurrentUploadRate: '125000',
      TotalDownload: '1000',
    },
    month: { CurrentMonthDownload: String(5 * 1024 ** 3), CurrentMonthUpload: String(1024 ** 3) },
    plmn: { FullName: 'Orange F', ShortName: 'Orange', Numeric: '20801' },
    dataswitch: 1,
    inbox: [], // { index, phone, content, date, read }
    sent: [],
    rebooted: 0,
  };

  function newToken() {
    const token = randomBytes(16).toString('hex');
    router.tokens.add(token);
    return token;
  }

  function newSession() {
    sessionCounter += 1;
    const id = `fake${sessionCounter}`;
    router.sessions.set(id, { loggedIn: loginMode === 'none' });
    return id;
  }

  /** Forget every session, as an idle timeout or a reboot does. */
  router.expireSessions = () => {
    router.sessions.clear();
    router.tokens.clear();
  };

  router.addSms = (phone, content, date = '2026-11-20 10:00:00') => {
    const index = 40000 + router.inbox.length + 1;
    router.inbox.push({ index, phone, content, date, read: false });
    return index;
  };

  const scramState = new Map();

  router.fetch = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const path = new URL(url).pathname;
    router.requests.push({ method, path, body });
    if (!router.reachable) {
      throw new TypeError('fetch failed');
    }
    const cookie = String(headers.Cookie ?? '').match(/SessionID=([^;]+)/)?.[1];
    const session = cookie ? router.sessions.get(cookie) : undefined;
    const answerHeaders = new Headers({ 'Content-Type': 'text/xml' });
    const send = (text, status = 200) => new Response(text, { status, headers: answerHeaders });

    if (method === 'GET' && path === '/') {
      answerHeaders.set('Content-Type', 'text/html');
      answerHeaders.append('set-cookie', `SessionID=${newSession()}; path=/; HttpOnly`);
      const meta = homeTokens
        ? `<meta name="csrf_token" content="${newToken()}"/><meta name="csrf_token" content="${newToken()}"/>`
        : '';
      return send(`<!DOCTYPE html><html><head>${meta}</head><body></body></html>`);
    }

    const endpoint = path.replace(/^\/api\//, '');

    if (method === 'GET' && endpoint === 'webserver/token') {
      return send(response({ token: newToken() }));
    }
    if (method === 'GET' && endpoint === 'webserver/SesTokInfo') {
      return send(response({ SesInfo: `SessionID=${newSession()}`, TokInfo: newToken() }));
    }
    if (method === 'GET' && endpoint === 'user/state-login') {
      if (loginMode === 'none') {
        return send(error(100002));
      }
      return send(
        response({
          State: session?.loggedIn ? 0 : -1,
          Username: '',
          password_type: loginMode === 'base64' ? 0 : 4,
        }),
      );
    }

    if (method === 'POST') {
      const token = headers.__RequestVerificationToken;
      if (!session || !token || !router.tokens.has(token)) {
        return send(error(125002));
      }
      router.tokens.delete(token);
      const request = parseXml(body).request ?? {};
      const result = handlePost(endpoint, request, session, token);
      if (result.login) {
        // A login hands two tokens and a new session cookie.
        const id = newSession();
        router.sessions.get(id).loggedIn = true;
        answerHeaders.append('set-cookie', `SessionID=${id}; path=/; HttpOnly`);
        answerHeaders.set('__RequestVerificationTokenone', newToken());
        answerHeaders.set('__RequestVerificationTokentwo', newToken());
      } else {
        answerHeaders.set('__RequestVerificationToken', newToken());
      }
      return send(result.text);
    }

    if (method === 'GET') {
      if (!session?.loggedIn) {
        return send(error(100003));
      }
      return send(handleGet(endpoint));
    }
    return send('', 405);
  };

  function handleGet(endpoint) {
    switch (endpoint) {
      case 'device/information':
        return response(router.information);
      case 'monitoring/status':
        return response(router.status);
      case 'device/signal':
        return response(router.signal);
      case 'monitoring/traffic-statistics':
        return response(router.traffic);
      case 'monitoring/month_statistics':
        return response(router.month);
      case 'net/current-plmn':
        return response(router.plmn);
      case 'dialup/mobile-dataswitch':
        return response({ dataswitch: router.dataswitch });
      case 'monitoring/check-notifications':
        return response({
          UnreadMessage: router.inbox.filter((sms) => !sms.read).length,
          SmsStorageFull: 0,
        });
      default:
        return error(100002);
    }
  }

  function handlePost(endpoint, request, session, token) {
    if (endpoint === 'user/login') {
      router.loginAttempts += 1;
      const expected =
        Number(request.password_type) === 4
          ? hashPasswordSha256(username, password, token)
          : Buffer.from(password).toString('base64');
      if (loginMode === 'scram' || request.Username !== username || request.Password !== expected) {
        return { text: error(108006) };
      }
      return { text: ok, login: true };
    }
    if (endpoint === 'user/challenge_login') {
      if (loginMode !== 'scram') {
        return { text: error(100002) };
      }
      const salt = randomBytes(32).toString('hex');
      const serverNonce = `${request.firstnonce}${randomBytes(16).toString('hex')}`;
      scramState.set(serverNonce, { salt, firstNonce: request.firstnonce, user: request.username });
      return {
        text: response({ salt, iterations: 100, servernonce: serverNonce, modeselected: 1 }),
      };
    }
    if (endpoint === 'user/authentication_login') {
      router.loginAttempts += 1;
      const pending = scramState.get(request.finalnonce);
      if (!pending || pending.user !== username) {
        return { text: error(108006) };
      }
      const { clientProof, serverSignature } = scramProof(
        password,
        pending.salt,
        100,
        pending.firstNonce,
        request.finalnonce,
      );
      if (clientProof !== request.clientproof) {
        return { text: error(108006) };
      }
      return { text: response({ serversignature: serverSignature }), login: true };
    }
    if (!session.loggedIn) {
      return { text: error(100003) };
    }
    switch (endpoint) {
      case 'user/logout':
        session.loggedIn = false;
        return { text: ok };
      case 'sms/sms-list': {
        const messages = [...router.inbox]
          .sort((a, b) => Number(a.read) - Number(b.read) || b.date.localeCompare(a.date))
          .slice(0, Number(request.ReadCount))
          .map((sms) => ({
            Smstat: sms.read ? 1 : 0,
            Index: sms.index,
            Phone: sms.phone,
            Content: sms.content,
            Date: sms.date,
            Sca: '',
            SaveType: 4,
            Priority: 0,
            SmsType: 1,
          }));
        return {
          text: response({ Count: messages.length, Messages: { Message: messages } }),
        };
      }
      case 'sms/set-read': {
        const sms = router.inbox.find((item) => item.index === Number(request.Index));
        if (sms) {
          sms.read = true;
        }
        return { text: ok };
      }
      case 'sms/send-sms': {
        const phones = request.Phones?.Phone;
        router.sent.push({
          phones: Array.isArray(phones) ? phones : [phones],
          content: request.Content,
          length: Number(request.Length),
          date: request.Date,
        });
        return { text: ok };
      }
      case 'dialup/mobile-dataswitch':
        router.dataswitch = Number(request.dataswitch);
        return { text: ok };
      case 'device/control':
        if (Number(request.Control) === 1) {
          router.rebooted += 1;
        }
        return { text: ok };
      default:
        return { text: error(100002) };
    }
  }

  return router;
}
