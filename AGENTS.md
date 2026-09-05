# pzv-terminal

## Project

pzv-terminal is an Nx monorepo for a crypto market monitoring application.

Main stack:

- TypeScript
- NestJS
- Nx
- Redis
- pnpm
- Docker

Applications:

- `apps/server` - HTTP API
- `apps/worker` - background market-data, signal and notification worker

Shared libraries:

- `libs/shared-types` - shared domain types
- `libs/shared-utils` - shared calculations and utilities
- `libs/core-config` - environment/configuration
- `libs/core-logger` - logging
- `libs/core-redis` - Redis integration

## Package manager

Use `pnpm`.

Do not use npm or yarn.

## Common commands

Install:

`pnpm install`

Start Redis:

`pnpm infra:up`

Run development:

`pnpm dev`

Build:

`pnpm build`

Lint:

`pnpm lint`

Tests:

`pnpm test`

Reset Nx:

`pnpm reset`

## Engineering rules

- Prefer small, focused changes over large refactors.
- Preserve the existing Nx monorepo structure.
- Reuse existing shared libraries before creating new abstractions.
- Keep domain types in `shared-types`.
- Keep reusable calculations/utilities in `shared-utils`.
- Keep infrastructure-specific Redis logic in `core-redis`.
- Do not add production dependencies unless necessary.
- Ask before adding a new dependency.
- Do not change unrelated code while implementing a task.
- Do not silently change existing behavior outside the requested scope.
- When changing backend, infrastructure, Redis or Docker code, briefly explain non-obvious concepts and why the chosen solution works.
- Do not over-engineer simple tasks. Prefer the simplest implementation that fits the current project stage.

## Secrets and environment

`.env.local` contains local secrets.

It is intentionally inaccessible to Codex.

Expected secret variables:

- `TELEGRAM_BOT_TOKEN` - secret Telegram bot token used by the worker to send notifications.
- `TELEGRAM_CHAT_ID` - private Telegram chat ID used when `RUNNER_MODE=single`.

Rules:

- Never read, inspect, print, modify, copy, summarize, expose or commit `.env.local`.
- Do not attempt to access `.env.local` through shell commands, scripts, IDE tools or indirect file reads.
- Never attempt to discover the values of `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID`.
- Code may reference these variables through `process.env`.
- Assume these secret variables are configured locally when implementing features that depend on them.
- If a task requires a new secret, add only its name and purpose to the documented environment contract and ask the user to configure the actual value manually.

## Environment

Public runtime configuration is stored in `.env`.

Current market configuration:

- `DATA_SOURCE=binance`
- `BINANCE_BASE_URL=https://api.binance.com`
- `RUNNER_MODE` - notification recipient mode. Supported values: `single` and `subs`.

`.env` contains non-secret project configuration and may be read or modified when relevant.

Code may use environment variables through `process.env`.

## Git safety

- Never run `git push` unless explicitly requested.
- Never run `git rebase`, `git reset --hard`, force push, or rewrite history unless explicitly requested.
- Do not create commits unless explicitly requested.
- Do not switch branches unless explicitly requested.

## Validation

After changing code:

- run the smallest relevant validation first;
- prefer project-targeted Nx commands instead of validating the entire monorepo when possible;
- run build, lint and tests relevant to the changed application or library;
- do not claim completion when validation fails;
- if a check cannot be run, explicitly explain why.

When finished, report:

- what changed;
- which files changed;
- which commands/checks were run;
- whether they passed;
- any remaining risks or assumptions.

## Infrastructure safety

- `pnpm infra:reset` removes Docker volumes and Redis data. Never run it without explicit approval.
- `pnpm reset-markets` deletes cached `market:*` data from Redis. Ask before running it if existing market data may be important.
