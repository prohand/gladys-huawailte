// -----------------------------------------------------------------------------
// HTTP client of the Huawei HiLink web API (B310, B315, B525, B535, B618,
// B818, E5186, E5576, E3372h in HiLink mode, 5G CPE...).
//
// The router answers XML on http://<router>/api/<endpoint>. Three things make
// it more than a plain fetch:
//
//   1. A SESSION cookie (`SessionID`) plus a CSRF token. The token comes from
//      the home page (`<meta name="csrf_token">`), or from
//      `api/webserver/token` / `api/webserver/SesTokInfo`. Every POST consumes
//      one; the answer hands the next ones back in its headers
//      (`__RequestVerificationToken[one|two]`).
//   2. A LOGIN, on most models. `user/state-login` says which scheme:
//      password_type 4 is either SCRAM (`user/challenge_login` +
//      `user/authentication_login`, newer web UIs) or a salted SHA-256 sent to
//      `user/login`; older firmwares take the password in base64.
//   3. Sessions EXPIRE (a few minutes idle, a reboot, another login from the
//      web UI): an expired session answers 100003 / 125002 / 125003, and the
//      client then opens a new one, logs in again and retries once.
//
// Requests run ONE AT A TIME: the token of a POST is only known once the
// previous answer arrived, so two requests in flight would share one and the
// router refuses the second.
//
// The password is never logged, nor kept anywhere but in this object.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { buildRequest, parseXml } from './xml.js';
import {
  CREDENTIAL_ERRORS,
  ERROR_CODES,
  LOGIN_STATE,
  PASSWORD_TYPE,
  SESSION_ERRORS,
  toInt,
} from './codes.js';

/** An `<error>` answer of the router. */
export class HuaweiApiError extends Error {
  constructor(code, endpoint, message) {
    super(message || `Router error ${code} on ${endpoint}`);
    this.name = 'HuaweiApiError';
    this.code = code;
    this.endpoint = endpoint;
  }
}

/** The router could not be reached at all (network, timeout, HTTP error). */
export class RouterUnreachableError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'RouterUnreachableError';
  }
}

class ScramUnavailableError extends Error {}

// A wrong password locks the web UI after a few attempts (108007): after a
// refusal, the same credentials are not tried again for this long.
const LOGIN_BACKOFF_MS = 10 * 60 * 1000;

const CSRF_META = /name="csrf_token"\s+content="([^"]+)"/g;

/**
 * Normalize the address typed by the user: `192.168.8.1` →
 * `http://192.168.8.1`, credentials and trailing slashes removed.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeRouterUrl(raw) {
  let text = String(raw ?? '').trim();
  if (!text) {
    return '';
  }
  if (!/^https?:\/\//i.test(text)) {
    text = `http://${text}`;
  }
  const url = new URL(text);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/**
 * Password hash of the legacy password_type 4 login:
 * base64(hex(sha256(username + base64(hex(sha256(password))) + token))).
 * The hex digests are base64-encoded as text, as the router's own JS does.
 */
export function hashPasswordSha256(username, password, token) {
  const inner = Buffer.from(createHash('sha256').update(password, 'utf8').digest('hex')).toString(
    'base64',
  );
  const outer = createHash('sha256').update(`${username}${inner}${token}`, 'utf8').digest('hex');
  return Buffer.from(outer).toString('base64');
}

/**
 * Client proof and expected server signature of the SCRAM login.
 *
 * Ported from the router's own JavaScript (CryptoJS.SCRAM). It is NOT plain
 * RFC 5802: the firmware swaps key and message in two HMACs
 * (hmac(key="Client Key", saltedPassword) and hmac(key=authMessage, storedKey)).
 * An RFC-correct proof is refused with 108006.
 */
export function scramProof(password, saltHex, iterations, firstNonce, serverNonce) {
  const authMessage = Buffer.from(`${firstNonce},${serverNonce},${serverNonce}`, 'utf8');
  const salted = pbkdf2Sync(
    Buffer.from(password, 'utf8'),
    Buffer.from(saltHex, 'hex'),
    iterations,
    32,
    'sha256',
  );
  const clientKey = createHmac('sha256', 'Client Key').update(salted).digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const signature = createHmac('sha256', authMessage).update(storedKey).digest();
  const proof = Buffer.alloc(clientKey.length);
  for (let i = 0; i < clientKey.length; i += 1) {
    proof[i] = clientKey[i] ^ signature[i];
  }
  const serverKey = createHmac('sha256', 'Server Key').update(salted).digest();
  const serverSignature = createHmac('sha256', authMessage).update(serverKey).digest('hex');
  return { clientProof: proof.toString('hex'), serverSignature };
}

/** Local date as the router writes it: `2026-11-20 14:03:09`. */
export function routerDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export class HuaweiClient {
  #cookie = '';
  #tokens = [];
  #ready = false;
  #queue = Promise.resolve();
  #loginRefusedAt = 0;

  /**
   * @param {object} options
   * @param {string} options.url router address (`http://192.168.8.1`)
   * @param {string} [options.username] web UI user, `admin` by default
   * @param {string} [options.password] web UI password; empty: no login
   * @param {number} [options.timeoutMs] per request
   * @param {typeof fetch} [options.fetch] injected by the tests
   * @param {() => number} [options.now] injected by the tests
   */
  constructor({ url, username, password, timeoutMs = 10_000, fetch, now } = {}) {
    this.url = normalizeRouterUrl(url);
    this.username = username || 'admin';
    this.password = password || '';
    this.timeoutMs = timeoutMs;
    this.fetch = fetch ?? globalThis.fetch;
    this.now = now ?? Date.now;
  }

  // --- Public API: every call is queued, and recovers an expired session -----

  /** GET `api/<endpoint>`, the `<response>` content. */
  get(endpoint) {
    return this.#serialize(() => this.#withSession(() => this.#rawGet(endpoint)));
  }

  /** POST `api/<endpoint>` with a `<request>` body, the `<response>` content. */
  post(endpoint, data) {
    return this.#serialize(() => this.#withSession(() => this.#rawPost(endpoint, data)));
  }

  /** GET an endpoint the firmware may not have: `null` instead of an API error. */
  async getOptional(endpoint) {
    try {
      return await this.get(endpoint);
    } catch (err) {
      if (err instanceof HuaweiApiError) {
        return null;
      }
      throw err;
    }
  }

  /** Log out, best effort (frees the router's session slot). */
  logout() {
    return this.#serialize(async () => {
      if (!this.#ready || !this.password) {
        return;
      }
      try {
        await this.#rawPost('user/logout', { Logout: 1 });
      } catch {
        // Already expired, or not supported: nothing to free.
      }
      this.#ready = false;
    });
  }

  // --- Router operations ------------------------------------------------------

  information() {
    return this.get('device/information');
  }

  /**
   * The unread messages of the local inbox, oldest first.
   * @param {number} [count] how many of the most recent messages to look at
   * @returns {Promise<Array<{ index: number, phone: string, content: string, date: string }>>}
   */
  async unreadSms(count = 20) {
    // Field order matters to some firmwares (B525s-23a): keep it.
    const answer = await this.post('sms/sms-list', {
      PageIndex: 1,
      ReadCount: count,
      BoxType: 1,
      SortType: 0,
      Ascending: 0,
      UnreadPreferred: 1,
    });
    const raw = answer?.Messages?.Message;
    const messages = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    return messages
      .filter((message) => toInt(message.Smstat) === 0)
      .map((message) => ({
        index: toInt(message.Index),
        phone: String(message.Phone ?? ''),
        content: String(message.Content ?? ''),
        date: String(message.Date ?? ''),
      }))
      .filter((message) => message.index !== null)
      .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
  }

  markSmsRead(index) {
    return this.post('sms/set-read', { Index: index });
  }

  /**
   * Send one SMS to one or more numbers.
   * @param {string[]} phones
   * @param {string} content
   */
  sendSms(phones, content, date = new Date()) {
    return this.post('sms/send-sms', {
      Index: -1,
      Phones: { Phone: phones },
      Sca: '',
      Content: content,
      Length: content.length,
      Reserved: 1,
      Date: routerDate(date),
    });
  }

  setMobileData(on) {
    return this.post('dialup/mobile-dataswitch', { dataswitch: on ? 1 : 0 });
  }

  reboot() {
    return this.post('device/control', { Control: 1 });
  }

  // --- Session -----------------------------------------------------------------

  #serialize(task) {
    const run = this.#queue.then(task, task);
    // The queue itself never rejects: one failed call must not fail the next.
    this.#queue = run.catch(() => {});
    return run;
  }

  async #withSession(call) {
    await this.#ensureSession();
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof HuaweiApiError) || !SESSION_ERRORS.has(err.code)) {
        throw err;
      }
      // Expired session (idle timeout, reboot, login from the web UI): a new
      // one, a new login, and one more try.
      this.#ready = false;
      await this.#ensureSession();
      return call();
    }
  }

  async #ensureSession() {
    if (this.#ready) {
      return;
    }
    if (!this.url) {
      throw new RouterUnreachableError('No router address configured');
    }
    await this.#openSession();
    await this.#login();
    this.#ready = true;
  }

  async #openSession() {
    this.#cookie = '';
    this.#tokens = [];
    // The home page carries the CSRF tokens on most firmwares.
    const home = await this.#request('GET', '/');
    const html = await home.text();
    const tokens = [...html.matchAll(CSRF_META)].map((match) => match[1]);
    if (tokens.length > 0) {
      this.#tokens = tokens;
      return;
    }
    // Otherwise the API hands one out.
    try {
      const answer = await this.#rawGet('webserver/token');
      if (answer?.token) {
        this.#tokens = [String(answer.token)];
        return;
      }
    } catch (err) {
      if (!(err instanceof HuaweiApiError)) {
        throw err;
      }
    }
    try {
      const answer = await this.#rawGet('webserver/SesTokInfo');
      const session = String(answer?.SesInfo ?? '');
      if (session.startsWith('SessionID=')) {
        this.#cookie = session;
      }
      if (answer?.TokInfo) {
        this.#tokens = [String(answer.TokInfo)];
      }
    } catch (err) {
      if (!(err instanceof HuaweiApiError)) {
        throw err;
      }
    }
  }

  async #login() {
    if (!this.password) {
      return;
    }
    let state;
    try {
      state = await this.#rawGet('user/state-login');
    } catch (err) {
      if (err instanceof HuaweiApiError && err.code === ERROR_CODES.NOT_SUPPORTED) {
        return; // no login on this model (HiLink sticks)
      }
      throw err;
    }
    if (toInt(state?.State) === LOGIN_STATE.LOGGED_IN) {
      return;
    }
    if (this.#loginRefusedAt && this.now() - this.#loginRefusedAt < LOGIN_BACKOFF_MS) {
      throw new HuaweiApiError(
        ERROR_CODES.USERNAME_PASSWORD_WRONG,
        'user/login',
        'Login refused recently: check the username and password',
      );
    }
    try {
      const passwordType = toInt(state?.password_type) ?? PASSWORD_TYPE.BASE64;
      if (passwordType === PASSWORD_TYPE.SHA256) {
        try {
          await this.#loginScram();
          return;
        } catch (err) {
          if (!(err instanceof ScramUnavailableError)) {
            throw err;
          }
          // The probe may have consumed the only token: get a fresh one.
          if (this.#tokens.length === 0) {
            await this.#openSession();
          }
        }
      }
      await this.#loginLegacy(passwordType);
    } catch (err) {
      if (err instanceof HuaweiApiError && CREDENTIAL_ERRORS.has(err.code)) {
        this.#loginRefusedAt = this.now();
      }
      throw err;
    }
  }

  async #loginLegacy(passwordType) {
    const password =
      passwordType === PASSWORD_TYPE.SHA256
        ? hashPasswordSha256(this.username, this.password, this.#tokens[0] ?? '')
        : Buffer.from(this.password, 'utf8').toString('base64');
    await this.#rawPost(
      'user/login',
      { Username: this.username, Password: password, password_type: passwordType },
      { refreshTokens: true },
    );
  }

  async #loginScram() {
    const firstNonce = randomBytes(32).toString('hex');
    let challenge;
    try {
      challenge = await this.#rawPost(
        'user/challenge_login',
        { username: this.username, firstnonce: firstNonce, mode: 1 },
        { refreshTokens: true },
      );
    } catch (err) {
      if (
        err instanceof HuaweiApiError &&
        (err.code === ERROR_CODES.NOT_SUPPORTED || err.code === ERROR_CODES.NO_RIGHTS)
      ) {
        throw new ScramUnavailableError();
      }
      throw err;
    }
    if (!challenge?.salt || !challenge?.iterations || !challenge?.servernonce) {
      throw new ScramUnavailableError();
    }
    const { clientProof, serverSignature } = scramProof(
      this.password,
      String(challenge.salt),
      Number(challenge.iterations),
      firstNonce,
      String(challenge.servernonce),
    );
    const answer = await this.#rawPost(
      'user/authentication_login',
      { clientproof: clientProof, finalnonce: String(challenge.servernonce) },
      { refreshTokens: true },
    );
    const returned = Buffer.from(String(answer?.serversignature ?? ''));
    const expected = Buffer.from(serverSignature);
    if (returned.length !== expected.length || !timingSafeEqual(returned, expected)) {
      throw new HuaweiApiError(0, 'user/authentication_login', 'Invalid router signature');
    }
  }

  // --- HTTP ----------------------------------------------------------------------

  async #rawGet(endpoint) {
    const headers = {};
    if (this.#tokens.length === 1) {
      headers.__RequestVerificationToken = this.#tokens[0];
    }
    const response = await this.#request('GET', `/api/${endpoint}`, { headers });
    return this.#read(response, endpoint);
  }

  async #rawPost(endpoint, data, { refreshTokens = false } = {}) {
    const headers = { 'Content-Type': 'application/xml' };
    if (this.#tokens.length > 1) {
      headers.__RequestVerificationToken = this.#tokens.shift();
    } else if (this.#tokens.length === 1) {
      headers.__RequestVerificationToken = this.#tokens[0];
    }
    const response = await this.#request('POST', `/api/${endpoint}`, {
      headers,
      body: buildRequest(data),
    });
    if (refreshTokens) {
      this.#tokens = [];
    }
    const one = response.headers.get('__RequestVerificationTokenone');
    if (one) {
      this.#tokens.push(one);
      const two = response.headers.get('__RequestVerificationTokentwo');
      if (two) {
        this.#tokens.push(two);
      }
    } else {
      const next = response.headers.get('__RequestVerificationToken');
      if (next) {
        // Some firmwares send several tokens in one header, `#`-separated.
        this.#tokens.push(...next.split('#').filter(Boolean));
      }
    }
    return this.#read(response, endpoint);
  }

  async #request(method, path, { headers = {}, body } = {}) {
    if (this.#cookie) {
      headers.Cookie = this.#cookie;
    }
    let response;
    try {
      response = await this.fetch(`${this.url}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new RouterUnreachableError(`Router unreachable (${err.name}: ${err.message})`, err);
    }
    const cookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
    for (const cookie of cookies) {
      const session = cookie.split(';')[0].trim();
      if (session.startsWith('SessionID=')) {
        this.#cookie = session;
      }
    }
    if (!response.ok) {
      throw new RouterUnreachableError(`Router answered HTTP ${response.status} on ${path}`);
    }
    return response;
  }

  async #read(response, endpoint) {
    const text = await response.text();
    if (!text.trim()) {
      return {};
    }
    let document;
    if (/^\s*[{[]/.test(text)) {
      document = JSON.parse(text);
    } else {
      try {
        document = parseXml(text);
      } catch {
        // An unknown endpoint redirects to the home page on some firmwares.
        throw new HuaweiApiError(ERROR_CODES.NOT_SUPPORTED, endpoint);
      }
    }
    if (document.error !== undefined) {
      const code = toInt(document.error?.code) ?? ERROR_CODES.UNKNOWN;
      throw new HuaweiApiError(code, endpoint, document.error?.message || undefined);
    }
    if (!('response' in document)) {
      // HTML (a redirect followed to the web UI): not an API endpoint here.
      if (Object.keys(document).some((key) => key.toLowerCase() === 'html')) {
        throw new HuaweiApiError(ERROR_CODES.NOT_SUPPORTED, endpoint);
      }
      return document;
    }
    return document.response ?? {};
  }
}
