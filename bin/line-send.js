#!/usr/bin/env node

/**
 * openclaw-line-send — CLI for sending outbound LINE messages
 *
 * Usage:
 *   line-send text --to <userId> --message "Hello!"
 *   line-send text --to <userId> --message "Hello!" --reply-to <replyToken>
 *   line-send sticker --to <userId> --package-id 6325 --sticker-id 10979904
 *   line-send image --to <userId> --url https://example.com/photo.jpg
 *   line-send multicast --user-id <id1> --user-id <id2> --message "Broadcast!"
 *   line-send broadcast --message "Hello everyone!"
 *   line-send profile --user-id <userId>
 *   line-send config --token <channelAccessToken>
 *   line-send config --show
 *   line-send config --clear
 */

import { sendText, sendSticker, sendImage, multicast, broadcast, getProfile } from "../lib/line-api.js";
import { loadConfig, saveConfig, clearConfig, getConfigPath } from "../lib/config.js";

const KNOWN_COMMANDS = new Set(["text", "sticker", "image", "multicast", "broadcast", "profile"]);

const USAGE = `
openclaw-line-send — Send outbound LINE messages

Usage:
  line-send text --to <userId> --message <text> [--reply-to <token>]
  line-send sticker --to <userId> --package-id <id> --sticker-id <id>
  line-send image --to <userId> --url <imageUrl>
  line-send multicast --user-id <id> [--user-id <id>...] --message <text>
  line-send broadcast --message <text>
  line-send profile --user-id <userId>
  line-send config --token <channelAccessToken>   Set the LINE Channel Access Token
  line-send config --show                         Show current config (token masked)
  line-send config --clear                        Remove stored config

Environment Variables:
  LINE_CHANNEL_ACCESS_TOKEN   LINE channel access token (highest priority)
  LINE_CHANNEL_SECRET         LINE channel secret (optional, for webhook verification)

Config File:
  ${getConfigPath()}

Examples:
  line-send text --to Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 --message "Hey, how are you?"
  line-send text --to Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 --message "Thanks!" --reply-to abc123
  line-send sticker --to Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 --package-id 6325 --sticker-id 10979904
  line-send image --to Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 --url https://example.com/photo.jpg
  line-send multicast --user-id U11111111111111111111111111111111 --user-id U22222222222222222222222222222222 --message "Party at 7!"
  line-send broadcast --message "Good morning everyone!"
  line-send profile --user-id Ua1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4
`.trim();

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const flags = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      // Support --flag=value explicitly, so values that themselves start
      // with "--" (e.g. --message="--call me now") aren't mistaken for a
      // separate flag.
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        if (key === "user-id") {
          if (!flags[key]) flags[key] = [];
          flags[key].push(value);
        } else {
          flags[key] = value;
        }
        continue;
      }

      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        if (key === "user-id") {
          if (!flags[key]) flags[key] = [];
          flags[key].push(next);
        } else {
          flags[key] = next;
        }
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}

function getAccessToken() {
  // Environment variable takes priority
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    return process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }

  // Fall back to config file
  const config = loadConfig();
  return config.channelAccessToken || null;
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printError(msg) {
  console.error(`Error: ${msg}`);
}

function printSuccess(msg) {
  console.log(JSON.stringify({ ok: true, message: msg }));
}

/**
 * Get a required string flag. Exits with a clear error if the flag is
 * missing entirely, or if it was passed with no value (e.g. a trailing
 * `--message` with nothing after it, which parseArgs records as `true`
 * rather than a string).
 */
function requireString(flags, key) {
  const value = flags[key];
  if (value === undefined) {
    printError(`--${key} is required`);
    process.exit(1);
  }
  if (value === true) {
    printError(`--${key} requires a value`);
    process.exit(1);
  }
  return value;
}

/**
 * Get an optional string flag. Returns undefined if not passed, but still
 * rejects the "passed with no value" case the same way requireString does.
 */
function optionalString(flags, key) {
  const value = flags[key];
  if (value === true) {
    printError(`--${key} requires a value`);
    process.exit(1);
  }
  return value;
}

/**
 * A LINE user/group/room id is a single-letter prefix followed by 32 hex
 * characters (33 chars total). Catching an obviously malformed id here
 * gives a clear client-side error instead of a confusing 400 from LINE.
 */
function isValidLineId(value, allowedPrefixes) {
  return new RegExp(`^[${allowedPrefixes}][0-9a-f]{32}$`, "i").test(value);
}

function checkLineId(value, key, allowedPrefixes) {
  if (value !== undefined && !isValidLineId(value, allowedPrefixes)) {
    printError(
      `--${key} doesn't look like a valid LINE id ` +
      `(expected one of "${allowedPrefixes.split("").join('", "')}" followed by 32 hex characters), got: ${value}`
    );
    process.exit(1);
  }
  return value;
}

/** Push targets (text/sticker/image) can be a user, group, or room id. */
function requireLineId(flags, key, allowedPrefixes = "UCR") {
  return checkLineId(requireString(flags, key), key, allowedPrefixes);
}

function optionalLineId(flags, key, allowedPrefixes = "UCR") {
  return checkLineId(optionalString(flags, key), key, allowedPrefixes);
}

const MAX_MULTICAST_RECIPIENTS = 500;

/**
 * Get the --user-id list (multicast allows several). Exits if none were
 * given a value, if any of them aren't shaped like a LINE user id, or if
 * there are more than LINE's multicast recipient limit.
 */
function requireUserIds(flags) {
  const value = flags["user-id"];
  if (!Array.isArray(value) || value.length === 0) {
    printError("--user-id is required (can be specified multiple times)");
    process.exit(1);
  }
  for (const id of value) {
    checkLineId(id, "user-id", "U");
  }
  if (value.length > MAX_MULTICAST_RECIPIENTS) {
    printError(`multicast accepts at most ${MAX_MULTICAST_RECIPIENTS} --user-id values (got ${value.length})`);
    process.exit(1);
  }
  return value;
}

/** Get exactly one --user-id (profile doesn't support multiple). */
function requireSingleUserId(flags) {
  const userIds = requireUserIds(flags);
  if (userIds.length !== 1) {
    printError("profile accepts exactly one --user-id");
    process.exit(1);
  }
  return userIds[0];
}

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  // --- Config commands ---
  if (command === "config") {
    const tokenValue = optionalString(flags, "token");
    if (tokenValue !== undefined) {
      saveConfig({ channelAccessToken: tokenValue });
      printSuccess(`Token saved to ${getConfigPath()}`);
      process.exit(0);
    }
    if (flags.show) {
      const config = loadConfig();
      const token = config.channelAccessToken;
      if (token) {
        const masked = token.slice(0, 8) + "..." + token.slice(-4);
        printJson({ channelAccessToken: masked, path: getConfigPath() });
      } else {
        printJson({ channelAccessToken: null, path: getConfigPath(), note: "No token configured. Use --token to set one." });
      }
      process.exit(0);
    }
    if (flags.clear) {
      clearConfig();
      printSuccess("Config cleared");
      process.exit(0);
    }
    printError("config requires --token, --show, or --clear");
    process.exit(1);
  }

  // Reject unknown commands before requiring a token, so a typo'd command
  // name gets "Unknown command" instead of a misleading auth error.
  if (!KNOWN_COMMANDS.has(command)) {
    printError(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }

  // --- All other commands need a token ---
  const token = getAccessToken();
  if (!token) {
    printError(
      "No LINE Channel Access Token configured.\n" +
      "Set LINE_CHANNEL_ACCESS_TOKEN env var or run: line-send config --token <your-token>"
    );
    process.exit(1);
  }

  // --- Text ---
  if (command === "text") {
    const message = requireString(flags, "message");
    const replyTo = optionalString(flags, "reply-to");
    // --to is only meaningful for a push; a reply is scoped to the
    // replyToken and doesn't take a recipient.
    const to = replyTo ? optionalLineId(flags, "to") : requireLineId(flags, "to");

    const result = await sendText(token, to, message, replyTo);
    printJson(result);
    process.exit(0);
  }

  // --- Sticker ---
  if (command === "sticker") {
    const to = requireLineId(flags, "to");
    const packageId = requireString(flags, "package-id");
    const stickerId = requireString(flags, "sticker-id");

    const result = await sendSticker(token, to, packageId, stickerId);
    printJson(result);
    process.exit(0);
  }

  // --- Image ---
  if (command === "image") {
    const to = requireLineId(flags, "to");
    const url = requireString(flags, "url");

    const result = await sendImage(token, to, url);
    printJson(result);
    process.exit(0);
  }

  // --- Multicast ---
  if (command === "multicast") {
    const userIds = requireUserIds(flags);
    const message = requireString(flags, "message");

    const result = await multicast(token, userIds, message);
    printJson(result);
    process.exit(0);
  }

  // --- Broadcast ---
  if (command === "broadcast") {
    const message = requireString(flags, "message");

    const result = await broadcast(token, message);
    printJson(result);
    process.exit(0);
  }

  // --- Profile ---
  if (command === "profile") {
    const userId = requireSingleUserId(flags);

    const result = await getProfile(token, userId);
    printJson(result);
    process.exit(0);
  }
}

main().catch((err) => {
  const status = err.status || 0;
  if (status === 429) {
    printError(`Rate limited by LINE API. Try again in a few seconds. (${err.message})`);
  } else if (status >= 500) {
    printError(`LINE API server error (${status}). This may be temporary — try again. (${err.message})`);
  } else if (status === 0) {
    printError(`Network/timeout error: ${err.message}. Check your connection and try again.`);
  } else {
    printError(err.message);
  }
  process.exit(1);
});
