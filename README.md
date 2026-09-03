# openclaw-line-send

OpenClaw CLI tool for sending outbound LINE messages via the LINE Messaging API.

## What it does

Sends proactive/push messages to LINE users — text, stickers, images, multicast, and broadcast.
Pairs with OpenClaw as a skill so the agent can send LINE messages on your behalf.

## Install

```bash
npm install -g .
```

Or run directly:

```bash
node bin/line-send.js --help
```

## Setup

1. Get a **Channel Access Token** from the [LINE Developers Console](https://developers.line.biz/console/)
2. Configure it:

```bash
line-send config --token YOUR_CHANNEL_ACCESS_TOKEN
```

Or set the environment variable:

```bash
export LINE_CHANNEL_ACCESS_TOKEN=YOUR_TOKEN
```

## Usage

```bash
# Send a text message
line-send text --to Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 --message "Hello from Bender!"

# Reply to an inbound event (--to isn't needed for a reply)
line-send text --message "Thanks!" --reply-to <replyToken>

# Send a sticker
line-send sticker --to Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 --package-id 6325 --sticker-id 10979904

# Send an image
line-send image --to Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 --url https://example.com/photo.jpg

# Multicast to multiple users (max 500 recipients)
line-send multicast --user-id <userId1> --user-id <userId2> --message "Party at 7!"

# Broadcast to all followers
line-send broadcast --message "Good morning!"

# Get user profile
line-send profile --user-id Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4
```

`--to` and `--user-id` must look like a LINE id (a `U`/`C`/`R` prefix followed by 32 hex
characters) — the CLI validates this before making any API call.

## Development

```bash
npm test
```

Runs the test suite (`test/*.test.js`, via Node's built-in test runner) covering config
save/load/clear, the LINE API client's retry/backoff/timeout/idempotency behavior, and CLI
flag validation. Tests never touch your real `~/.line-send/config.json` or make network
calls — they use an isolated config directory (`LINE_SEND_CONFIG_DIR`) and a mocked `fetch`.

## OpenClaw Integration

Copy the `skill/SKILL.md` file into your OpenClaw workspace skills directory:

```bash
cp skill/SKILL.md ~/.openclaw/workspace/skills/line-send/SKILL.md
```

Or symlink it:

```bash
ln -s /path/to/openclaw-line-send/skill/SKILL.md ~/.openclaw/workspace/skills/line-send/SKILL.md
```

## Security

- **Never** commit your LINE Channel Access Token to git
- Config is stored in `~/.line-send/config.json` (outside the repo)
- The `.gitignore` excludes `.env` files and `node_modules`
- Token resolution: env var `LINE_CHANNEL_ACCESS_TOKEN` > `~/.line-send/config.json`

## License

MIT
