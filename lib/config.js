/**
 * Config management — stores LINE credentials in ~/.line-send/config.json
 * Never writes secrets to git-tracked files.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".line-send");
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
  } catch {
    return {};
  }
}

export function saveConfig(merged) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const current = loadConfig();
  const updated = { ...current, ...merged };
  // Remove keys set to null/undefined
  for (const [k, v] of Object.entries(updated)) {
    if (v === null || v === undefined) {
      delete updated[k];
    }
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  return updated;
}
