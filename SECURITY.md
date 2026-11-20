# Security policy

## Supported versions

Only the latest release of the Huawei LTE integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-huawailte](https://github.com/prohand/gladys-huawailte/security),
then **Report a vulnerability**.

Include, when you can:

- the version of the integration, of Gladys, and the router model and firmware;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove passwords, phone numbers, SMS contents and
  addresses first).

You should get a first answer within 7 days. A fix is released as a new version
of the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)),
the Huawei router firmware and its web interface (report to Huawei PSIRT), and
the mobile operator.

## How the integration handles sensitive data

- The router password is a `secret` field: Gladys never sends it back to the
  browser, and the integration only sends it to the router address you gave.
  It is never logged.
- The integration only talks to that router, on your local network
  (`transports: ["local"]`). It calls no cloud service.
- SMS contents and phone numbers are given to your scenes only, never logged.
  `/data/sms-seen.json` only holds message indexes.
- Sending SMS, switching mobile data and rebooting from the **dashboard** are
  off by default: an administrator must enable "Control buttons on the
  dashboard", because anyone who sees a dashboard can press its buttons.
- A refused password is not retried for 10 minutes, so a wrong configuration
  does not lock the router web interface.

## Good practices for users

- Change the default password of the router web interface.
- Do not expose the router web interface to the internet.
- Keep Gladys, the integration and the router firmware up to date.
