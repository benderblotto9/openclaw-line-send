---
name: line-send
description: "Send outbound LINE messages (text, stickers, images) to users via the LINE Messaging API."
metadata:
  {
    "openclaw":
      {
        "emoji": "💬",
        "requires": { "bins": ["node"] },
      },
  }
---

# line-send

Use `line-send` to send proactive/outbound LINE messages to specific users.
This is for pushing messages TO LINE users — not for replying in active conversations
(OpenClaw handles that automatically via the LINE channel plugin).

## When to use

- User asks you to send a message to someone on LINE
- You need to proactively notify a LINE user about something
- Sending reminders, alerts, or updates via LINE

## Auth

Token is resolved in order:
1. `LINE_CHANNEL_ACCESS_TOKEN` environment variable
2. `~/.line-send/config.json` (set via `line-send config --token ***`)

## Commands

### Send text

```bash
line-send text --to <userId> --message "Your message here"
```

Reply to an inbound event (use the replyToken):

```bash
line-send text --to <userId> --message "Reply text" --reply-to <replyToken>
```

### Send sticker

```bash
line-send sticker --to <userId> --package-id <pkgId> --sticker-id <stickerId>
```

### Send image

```bash
line-send image --to <userId> --url https://example.com/photo.jpg
```

### Multicast (up to 500 users)

```bash
line-send multicast --user-id U111 --user-id U222 --message "Hello!"
```

### Broadcast (all followers)

```bash
line-send broadcast --message "Good morning everyone!"
```

### Get user profile

```bash
line-send profile --user-id <userId>
```

### Manage config

```bash
line-send config --token <channelAccessToken>   # save token
line-send config --show                          # show masked token
line-send config --clear                         # remove stored config
```

## Safety

- Always confirm recipient + message before sending outbound messages
- If the user asks you to message someone, confirm the target and content first
- Never log or expose the LINE Channel Access Token
- The `--reply-to` flag is for replying to inbound webhook events only
