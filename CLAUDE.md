# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors working in
this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Huawei LTE (4G/5G) routers and HiLink USB
sticks**, reached on the LAN through the router's own web API. One router per integration
install. Requires Gladys 5.3+. Started from the official JavaScript template; CI/release
workflows mirror `prohand/gladys-devmel`.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/client.test.js             # one file
node --test --test-name-pattern "SCRAM"     # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24. Run the three before pushing.

## Architecture

```
index.js                    bootstrap only: SDK client, registerHandlers, shutdown, connect
src/app.js                  every SDK handler (scan, setValue, actions, scenes, widget, config)
src/service.js              RouterService: refresh timer, publication, triggers, SMS watch, operations
src/huawei/client.js        HiLink HTTP client: session, CSRF tokens, login (SCRAM/SHA-256/base64)
src/huawei/xml.js           minimal XML parse/build for the router dialect
src/huawei/codes.js         API error codes, connection codes, network type names
src/huawei/snapshot.js      raw answers -> RouterSnapshot (pure), identity from device/information
src/devices/router.js       Gladys device: features, states of a snapshot
src/capabilities/           manifest actions, scene actions, dashboard widget
src/smsStore.js             SMS already handled, in /data/sms-seen.json
src/config.js               DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                 LANGUAGES (en, fr, de, es), pick, localize
test/helpers/fakeRouter.js  in-memory router behind a fetch function (sessions, tokens, logins)
test/helpers/setup.js       integration wired to the SDK fake Gladys + fake router + fake timers
```

### Invariants worth knowing

- **Requests are serialized** in `HuaweiClient`: a POST consumes a CSRF token and the next one
  only arrives with the answer. Never bypass the queue.
- **Session recovery**: errors 100003 / 125001 / 125002 / 125003 reopen the session, log in again
  and retry once. Credential errors (1080xx, 115002) block new logins for 10 minutes: the router
  locks its web UI after a few failures.
- **SCRAM is not RFC 5802**: the firmware swaps key and message in two HMACs. `scramProof` and
  `hashPasswordSha256` are pinned by test vectors computed with huawei-lte-api. Do not "fix" them.
- **External ids**: `router:<serial number>` (IMEI if no serial), from `device/information`. The
  device is only published once that read succeeded. Feature keys (`signal`, `rsrp`,
  `mobile-data`…) are stored by users: never rename one.
- **No Gladys polling**: the device is published with `should_poll: false`; `RouterService` reads
  the router on its own timer (`refresh_interval`, 15-3600 s), refreshes never overlap, and it
  pauses while Gladys is disconnected.
- **States** go through `publishChangedStates` (30 min heartbeat); text features publish `text`.
- **Triggers**: `connection_changed` fires on transitions only (first read = baseline;
  connecting/disconnecting ignored); the "unreachable" caused by a reboot Gladys asked for is
  silenced for `REBOOT_GRACE_MS`. `sms_received`: the first run records the inbox without firing;
  then each new unread message fires once, is optionally marked read, and `/data/sms-seen.json`
  remembers the ones still unread.
- **Dashboard controls are opt-in** (`dashboard_controls`, admin config, default false): a widget
  setting is editable by any dashboard editor, so it cannot gate actions. The WAN IP is hidden
  unless the widget setting `show_wan_ip` is on.
- **Never log** the password, SMS contents or phone numbers.
- **The container rootfs is read-only**: write only under `/data` (`DATA_DIR` overrides it).

### Manifest

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code: action, scene
action, trigger and widget keys; `DEFAULT_CONFIG`; every text in **en, fr, de, es**; `countries`
(ISO codes, ≤ 20), `keywords`, `categories` vocabulary, `transports: ["local"]`,
`gladys_version >= 5.3.0`; version = package version = image tag. Change both sides together.

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit `version` in
  `package.json` or the manifest, nor the `docker_image` tag, by hand.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md`
  (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading.
- **User-facing text** is `{ en, fr, de, es }`: manifest, action answers, connection status,
  widget, and `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md` kept in sync (same
  headings; a test counts them).
- **Every feature carries `name`, `min`, `max`, `read_only`, `has_feedback`** (NOT NULL in
  Gladys).
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network.
