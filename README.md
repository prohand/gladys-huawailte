# Huawei LTE — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com)
to a **Huawei 4G/5G router** or **HiLink USB stick** (B310, B315, B525, B535,
B618, B818, E5186, E5576, E3372h, 5G CPE…), through the router's own local web
API. Signal, data rates and data used, mobile data switch, SMS in and out,
scene triggers and actions, and a dashboard widget.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Requires **Gladys 5.3.0 or later**.

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) ·
[Deutsch](./docs/de.md) · [Español](./docs/es.md).

## What it does

| Surface               | Content                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device                | Signal (0-5), RSRP / RSRQ / SINR, internet connected, rates, data this month, uptime, unread SMS, network type, operator, WAN IP, **mobile data switch** |
| Scene triggers        | `sms_received` (filter on the sender), `connection_changed` (connected / disconnected / unreachable)                                                     |
| Scene actions         | `send_sms` (up to 5 numbers), `reboot_router`                                                                                                            |
| Dashboard widget      | `lte_router`: live tiles, connection status, optional control buttons                                                                                    |
| Configuration actions | Test the connection, send a test SMS, reboot                                                                                                             |

## Manifest

| Field            | Value                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | `device`                                                                                                                                                          |
| `transports`     | `["local"]`: the router is reached on the LAN only, never through a cloud                                                                                         |
| `categories`     | `network`, `notifications`                                                                                                                                        |
| `countries`      | 20 countries where these routers are common (France, Belgium, Switzerland, Germany, Spain, Morocco, Mexico…). Remove the field to list the integration everywhere |
| `keywords`       | huawei, hilink, lte, 4g, 5g, sms, b525, b535, b818, e5576                                                                                                         |
| `gladys_version` | `>=5.3.0` (`countries` and `keywords` need it)                                                                                                                    |
| Languages        | English, French, German, Spanish (manifest, messages, widget, docs)                                                                                               |

## How it talks to the router

`src/huawei/client.js` speaks the HiLink web API (`http://<router>/api/...`,
XML):

- session cookie + CSRF token (home page `<meta name="csrf_token">`, else
  `api/webserver/token` / `SesTokInfo`), a token consumed by every POST and
  handed back in the answer headers;
- login by `user/state-login` → SCRAM (`challenge_login` +
  `authentication_login`) on newer firmwares, salted SHA-256 or base64 on
  older ones, none on HiLink sticks;
- an expired session (100003 / 125002 / 125003) is reopened and the call
  retried once; a refused password is not retried for 10 minutes (the router
  locks its login after a few failures);
- one request at a time (tokens are sequential).

The protocol follows the router's own web UI and the reverse-engineering work of
[huawei-lte-api](https://github.com/Salamek/huawei-lte-api) (the library Home
Assistant uses); the tests check the password hashes against it.

## Development

```bash
npm install
npm test               # node --test, no router, no network
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

Try it on a real router without Gladys: `DATA_DIR=./data LOG_LEVEL=debug`
plus the three `GLADYS_*` variables of a Gladys developer-mode install, then
`npm start`.

## Release

Everything runs from GitHub Actions (same workflows as
[gladys-devmel](https://github.com/prohand/gladys-devmel)):

| Workflow             | When                                    | What                                                                              |
| -------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `ci.yml`             | push to `main`, pull requests           | Prettier, ESLint, tests on Node 22 and 24; store checks and Docker build on PRs   |
| `release.yml`        | Actions → Release → patch/minor/major   | bumps `package.json` + manifest, rolls `CHANGELOG.md`, tags, builds, store checks |
| `build.yml`          | `v*` tag, manual run, called by Release | multi-arch image (amd64 + arm64) on `ghcr.io/prohand/gladys-huawailte`            |
| `github-release.yml` | push to `main`, called by Release       | one GitHub Release per tag, notes from `CHANGELOG.md`                             |

The first image: push the tag of the current version (`git tag v1.0.0 && git
push origin v1.0.0`), or run **Release**. Make the package public in GitHub
→ Packages once, so Gladys can pull it.

## License

Apache-2.0
