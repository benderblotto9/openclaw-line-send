# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js CLI (`line-send`) for sending outbound/proactive LINE messages (text, stickers, images, multicast, broadcast) via the LINE Messaging API. It doubles as an OpenClaw skill (`skill/SKILL.md`) so an agent can send LINE messages on a user's behalf — this is for pushing messages TO users, not for replying in active conversations (OpenClaw's LINE channel plugin handles that).

## Commands

```bash
# Run directly without installing
node bin/line-send.js --help

# Install globally (exposes the `line-send` binary)
npm install -g .

# Tests
npm test   # runs `node --test test/*.test.js` — no test/ directory exists yet
```

There is no build step, linter, or bundler configured. Pure ESM (`"type": "module"`), zero runtime dependencies — uses Node's built-in `fetch`.

## Architecture

Three files, each with one responsibility:

- **`bin/line-send.js`** — CLI entry point. Hand-rolled arg parser (`parseArgs`, no library) that turns `--flag value` pairs into a `flags` object; `--user-id` is special-cased to accumulate into an array for multicast. Dispatches on `command` (`text`, `sticker`, `image`, `multicast`, `broadcast`, `profile`, `config`) with per-command required-flag validation, then calls into `lib/line-api.js`. Top-level `main().catch()` maps error `status` codes (429, 5xx, 0 for network/timeout) to specific user-facing messages and a non-zero exit code.
- **`lib/line-api.js`** — LINE Messaging API client. All public functions (`sendText`, `sendSticker`, `sendImage`, `multicast`, `broadcast`, `getProfile`) funnel through a single `lineRequest()` that handles timeouts (`AbortController`, 15s default), retry with exponential backoff (429/5xx, up to 3 attempts, honors `Retry-After`), and JSON parsing. **Retries are disabled by default for POST (message-send) endpoints** (`retryOnBody: false`) since LINE's send operations aren't idempotent — only `GET /profile` retries automatically. Functions return `{ ok, status, data }` or throw an `Error` with `.status`/`.data` attached; the CLI layer is responsible for turning that into exit codes.
- **`lib/config.js`** — Reads/writes `~/.line-send/config.json` (outside the repo, gitignored by location). `saveConfig()` merges into the existing file and drops any key set to `null`/`undefined` (used by `config --clear`).

### Token resolution order (matters when debugging auth issues)

1. `LINE_CHANNEL_ACCESS_TOKEN` env var (highest priority)
2. `~/.line-send/config.json` (`channelAccessToken`, set via `line-send config --token ...`)

### OpenClaw integration

`skill/SKILL.md` is the OpenClaw skill definition consumed by an agent — it documents the same commands as the README but frames them as agent instructions, including a safety rule: **always confirm recipient + message with the user before sending** an outbound LINE message. Keep this file's command docs in sync with `bin/line-send.js`'s actual flags when the CLI changes.

## Security notes specific to this repo

- Never write the LINE Channel Access Token into any git-tracked file; it only belongs in the env var or `~/.line-send/config.json`.
- `config --show` must keep masking the token (`slice(0,8) + "..." + slice(-4)`) — don't change it to print the full value.
