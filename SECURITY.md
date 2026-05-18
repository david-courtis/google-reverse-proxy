# Security Policy

## Reporting a vulnerability

Use GitHub's private security advisories:
<https://github.com/david-courtis/google-reverse-proxy/security/advisories/new>

Please do not open a public issue for security-relevant findings.

## Scope

In scope:

- Code under `src/`, `public/`, `scripts/`, `test/`.
- Credential and token handling (OAuth refresh tokens, AI Studio API keys, dashboard password, generated `OPENAI_API_KEY`).
- The Hono HTTP server and all routes mounted in `src/app.ts`.

Out of scope:

- The `@google/gemini-cli-core` dependency and its transitive packages. Report those upstream at <https://github.com/google-gemini/gemini-cli>.
- Issues that require physical access to the machine running the proxy.
- Theoretical findings without a working proof of concept.

## What to include in a report

A minimal repro, the proxy version (`/info`), the affected endpoint or file path, your environment (OS, Node version, bridge in use), and the impact you observed.

## Response

Triage within seven days. Fix or mitigation within thirty days for high-impact issues. You will be credited in the release notes unless you ask otherwise.

## Known accepted risks

- `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` in `src/config.ts` are the published Gemini CLI public-client values. RFC 8252 Section 8.5 treats these as not confidential. Using a different OAuth app would break the byte-identical parity guarantee tested by `npm test`.
- The dashboard is local-first. CORS is restricted to localhost by default. If you set `CORS_ALLOWED_ORIGINS=*`, also set a dashboard password to keep `/api/*` and `/account-limits` safe from cross-origin reads.
- `/api/accounts/export` returns full credentials by design. It refuses unless a dashboard password is set.
