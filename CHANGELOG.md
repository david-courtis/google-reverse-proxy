# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-05-24

Initial public release.

### Added
- OpenAI-compatible HTTP API at `/v1/chat/completions` and `/v1/models`. Streaming, tool calls, vision, audio, video, PDF, JSON mode, reasoning effort.
- Two upstream bridges behind one front door.
  - `AccountBridge` over `@google/gemini-cli-core@0.42.0` for Code Assist (OAuth).
  - `ApiKeyBridge` over `@google/genai` for AI Studio API keys.
- Three model id variants per base model.
  - Bare id picks the preferred upstream first, falls back to the other on exhaustion.
  - `:cli` suffix forces the Code Assist (OAuth) pool.
  - `:api` suffix forces the AI Studio (API key) pool.
- Account pool with `random`, `round-robin`, `failover` rotation and per-account cooldown.
- Free-tier API key pool with a configurable daily budget that resets at midnight America/Los_Angeles.
- Auto model-switching fallback for the case where every account is rate-limited.
- Real Gemini thinking with optional `<thinking>` inline streaming.
- Built-in dashboard for accounts, per-model quota, request volume, model visibility, dashboard password.
- Auto-generated dashboard password on first run, persisted to `~/.gemini-cli-openai/kv.json` and printed in the startup banner.
- Auto-generated proxy bearer token if `OPENAI_API_KEY` is unset, persisted to `~/.gemini-cli-openai/config.json` and printed in the startup banner.
- Parity test suite (`npm test`) asserts the on-the-wire `streamGenerateContent` envelope and headers match a captured real-client baseline.
- Cross-platform launchers `start.sh` and `start.ps1` that install a pinned Node 24 and start the proxy on port 8787.

### Security
- CORS defaults to localhost only. `CORS_ALLOWED_ORIGINS=*` is opt-in.
- `/api/accounts/export` requires a dashboard password to be set before it returns credentials.
- OAuth callback `postMessage` targets the page origin instead of `*`.
- `kv.json` and `config.json` are written `0o600`, state directory `0o700`.
- `safe-equal` hashes both inputs to SHA-256 before constant-time compare, so neither length nor early-mismatch position is a timing oracle.

### Notes
- Built and tested on Node 24. Older Node versions may work but parity is not guaranteed.
- `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` ship the published Gemini CLI public-client values from `@google/gemini-cli-core`. Required for byte-identical parity per RFC 8252.

[Unreleased]: https://github.com/david-courtis/google-reverse-proxy/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/david-courtis/google-reverse-proxy/releases/tag/v1.0.0
