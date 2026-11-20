# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [1.0.1] - 2026-11-20

### Added

- First version of the Huawei LTE integration, from the official Gladys
  JavaScript template.
- Local connection to Huawei 4G/5G routers and HiLink sticks: SCRAM, SHA-256
  and base64 logins, session recovery, protection against router lock-out.
- Router device: signal bars, RSRP, RSRQ, SINR, internet connected, download
  and upload rates, data used this month, connection time, unread SMS, network
  type, operator, WAN IP and a mobile data switch.
- Scene triggers "An SMS is received" and "The internet connection changes".
- Scene actions "Send an SMS" and "Reboot the router".
- "Huawei LTE router" dashboard widget, with optional control buttons.
- Configuration actions: test the connection, send a test SMS, reboot.
- English, French, German and Spanish texts and documentation; catalog
  countries, keywords and categories.
- CI, release, image build and GitHub Release workflows.

[Unreleased]: https://github.com/prohand/gladys-huawailte/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/prohand/gladys-huawailte/releases/tag/v1.0.1
