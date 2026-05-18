# Contributing

Thanks for considering a contribution.

## Local setup

```bash
git clone https://github.com/david-courtis/google-reverse-proxy
cd google-reverse-proxy
npm install
npm start
```

Node 24 is required for byte-identical parity. The launchers `start.sh` and `start.ps1` install a pinned Node 24 if needed.

## Repo map

| Path | Purpose |
| :--- | :--- |
| `src/app.ts`                | Hono app composition, middleware, route mounts. |
| `src/routes/openai.ts`      | `/v1/chat/completions` and `/v1/models` OpenAI surface. |
| `src/routes/auth.ts`        | OAuth login, account list, onboard, reset. |
| `src/routes/webui-api.ts`   | Dashboard JSON endpoints under `/api/*`. |
| `src/routes/account-limits.ts` | Live pool state for the dashboard. |
| `src/bridge/`               | Upstream bridges: `AccountBridge` (Code Assist) and `ApiKeyBridge` (AI Studio). |
| `src/translate/`            | OpenAI to Google envelope conversion. |
| `src/account-pool.ts`       | Pool management, rotation, cooldown. |
| `src/webui-store.ts`        | Settings, metrics, dashboard config in KV. |
| `src/runtime/`              | Node-side KV file store and config loader. |
| `public/`                   | Alpine + Tailwind dashboard. |
| `test/`                     | Parity golden-diff against captured real-client baseline. |

## Before opening a PR

1. `npm run lint` clean (ESLint + `tsc --noEmit`).
2. `npm test` passing (parity golden-diff stays green).
3. New tests for new behavior where practical.
4. Keep diffs small and focused. One concern per PR.

## Style

- TypeScript strict, no `any`, no `as unknown` casts.
- Comments are removed by default. Keep one only when removing it would lose meaning a future reader cannot recover from the code itself, and write it in one sentence with no em dash and no semicolon.
- Same rule for prose in docs and commit messages.
- Tables aligned with consistent column widths.

## Bumping `@google/gemini-cli-core`

Bumps invalidate the parity baseline. Run `npm run test:capture` against a real account on Node 24 to refresh the golden, then `npm test` to confirm. Update the version badge in `README.md` and the dependency pin in `package.json`. Dependabot is configured to skip this package.

## Commits

One-line subjects. Past tense or imperative is fine. Examples that pass:

- `fix CORS default to localhost-only`
- `add round-robin offset persistence`
- `docs explain :api model suffix`

No Co-Authored-By trailer. No multi-paragraph commit bodies. Put the why in the PR description.

## License

By contributing you agree your changes ship under the MIT license.
