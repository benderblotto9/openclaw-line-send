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
line-send text --to U1234567890abcdef --message "Hello from Bender!"

# Reply to an inbound event
line-send text --to U1234567890abcdef --message "Thanks!" --reply-to <replyToken>

# Send a sticker
line-send sticker --to U1234567890abcdef --package-id 6325 --sticker-id 10979904

# Send an image
line-send image --to U1234567890abcdef --url https://example.com/photo.jpg

# Multicast to multiple users
line-send multicast --user-id U111 --user-id U222 --message "Party at 7!"

# Broadcast to all followers
line-send broadcast --message "Good morning!"

# Get user profile
line-send profile --user-id U1234567890abcdef
```

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
