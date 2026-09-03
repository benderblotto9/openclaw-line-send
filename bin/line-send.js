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
  line-send text --to U1234567890abcdef --message "Hey, how are you?"
  line-send text --to U1234567890abcdef --message "Thanks!" --reply-to abc123
  line-send sticker --to U1234567890abcdef --package-id 6325 --sticker-id 10979904
  line-send image --to U1234567890abcdef --url https://example.com/photo.jpg
  line-send multicast --user-id U111 --user-id U222 --message "Party at 7!"
  line-send broadcast --message "Good morning everyone!"
  line-send profile --user-id U1234567890abcdef
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

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  // --- Config commands ---
  if (command === "config") {
    if (flags.token) {
      saveConfig({ channelAccessToken: flags.token });
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
    if (!flags.to) { printError("--to is required"); process.exit(1); }
    if (!flags.message) { printError("--message is required"); process.exit(1); }

    const result = await sendText(token, flags.to, flags.message, flags["reply-to"]);
    printJson(result);
    process.exit(0);
  }

  // --- Sticker ---
  if (command === "sticker") {
    if (!flags.to) { printError("--to is required"); process.exit(1); }
    if (!flags["package-id"]) { printError("--package-id is required"); process.exit(1); }
    if (!flags["sticker-id"]) { printError("--sticker-id is required"); process.exit(1); }

    const result = await sendSticker(token, flags.to, flags["package-id"], flags["sticker-id"]);
    printJson(result);
    process.exit(0);
  }

  // --- Image ---
  if (command === "image") {
    if (!flags.to) { printError("--to is required"); process.exit(1); }
    if (!flags.url) { printError("--url is required"); process.exit(1); }

    const result = await sendImage(token, flags.to, flags.url);
    printJson(result);
    process.exit(0);
  }

  // --- Multicast ---
  if (command === "multicast") {
    if (!flags["user-id"] || !Array.isArray(flags["user-id"]) || flags["user-id"].length === 0) {
      printError("--user-id is required (can be specified multiple times)");
      process.exit(1);
    }
    if (!flags.message) { printError("--message is required"); process.exit(1); }

    const result = await multicast(token, flags["user-id"], flags.message);
    printJson(result);
    process.exit(0);
  }

  // --- Broadcast ---
  if (command === "broadcast") {
    if (!flags.message) { printError("--message is required"); process.exit(1); }

    const result = await broadcast(token, flags.message);
    printJson(result);
    process.exit(0);
  }

  // --- Profile ---
  if (command === "profile") {
    if (!flags["user-id"]) { printError("--user-id is required"); process.exit(1); }
    if (flags["user-id"].length !== 1) {
      printError("profile accepts exactly one --user-id");
      process.exit(1);
    }

    const result = await getProfile(token, flags["user-id"][0]);
    printJson(result.data);
    process.exit(0);
  }

  printError(`Unknown command: ${command}`);
  console.log(USAGE);
  process.exit(1);
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
