/**
 * Config management — stores LINE credentials in ~/.line-send/config.json
 * Never writes secrets to git-tracked files.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Overridable so tests (and anyone who wants a non-default location) never
// have to touch the real ~/.line-send directory.
const CONFIG_DIR = process.env.LINE_SEND_CONFIG_DIR || join(homedir(), ".line-send");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigPath() {
  return CONFIG_FILE;
}

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch (err) {
    console.error(
      `Warning: could not parse config file at ${CONFIG_FILE} (${err.message}). Treating it as empty.`
    );
    return {};
  }
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function writeConfigFile(data) {
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
  // Contains the channel access token — keep it readable only by the owner.
  // writeFileSync's mode option only applies when the file is created, so
  // chmod explicitly to also cover the overwrite-existing-file case.
  chmodSync(CONFIG_FILE, 0o600);
}

export function saveConfig(merged) {
  ensureConfigDir();
  const current = loadConfig();
  const updated = { ...current, ...merged };
  // Remove keys set to null/undefined
  for (const [k, v] of Object.entries(updated)) {
    if (v === null || v === undefined) {
      delete updated[k];
    }
  }
  writeConfigFile(updated);
  return updated;
}

export function clearConfig() {
  ensureConfigDir();
  writeConfigFile({});
}
