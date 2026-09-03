import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point lib/config.js at an isolated temp directory before importing it —
// CONFIG_DIR is read from this env var once, at module load time, so it
// must be set first. This must never fall back to the real ~/.line-send.
const tempDir = mkdtempSync(join(tmpdir(), "line-send-config-test-"));
process.env.LINE_SEND_CONFIG_DIR = tempDir;

const { saveConfig, loadConfig, clearConfig, getConfigPath } = await import("../lib/config.js");

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("getConfigPath points inside the isolated temp dir, not the real home config", () => {
  assert.ok(getConfigPath().startsWith(tempDir));
});

test("loadConfig returns {} when no config file exists yet", () => {
  assert.deepEqual(loadConfig(), {});
});

test("saveConfig writes and loadConfig reads it back", () => {
  const result = saveConfig({ channelAccessToken: "tok123" });
  assert.deepEqual(result, { channelAccessToken: "tok123" });
  assert.deepEqual(loadConfig(), { channelAccessToken: "tok123" });
});

test("saveConfig merges into the existing config instead of replacing it", () => {
  saveConfig({ channelAccessToken: "tok123" });
  saveConfig({ otherKey: "value" });
  assert.deepEqual(loadConfig(), { channelAccessToken: "tok123", otherKey: "value" });
});

test("saveConfig drops keys explicitly set to null/undefined", () => {
  saveConfig({ channelAccessToken: "tok123", otherKey: "value" });
  saveConfig({ otherKey: null });
  assert.deepEqual(loadConfig(), { channelAccessToken: "tok123" });
});

test("config file is written with 0600 permissions (owner read/write only)", () => {
  saveConfig({ channelAccessToken: "tok123" });
  const mode = statSync(getConfigPath()).mode & 0o777;
  assert.equal(mode, 0o600, `expected mode 0600, got ${mode.toString(8)}`);
});

test("clearConfig actually empties the config (regression: --clear used to be a no-op)", () => {
  saveConfig({ channelAccessToken: "tok123" });
  assert.deepEqual(loadConfig(), { channelAccessToken: "tok123" });

  clearConfig();

  assert.deepEqual(loadConfig(), {});
});

test("clearConfig is written with 0600 permissions too", () => {
  clearConfig();
  const mode = statSync(getConfigPath()).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("loadConfig treats a corrupted config file as empty rather than throwing", () => {
  writeFileSync(getConfigPath(), "{ not valid json", "utf-8");
  assert.deepEqual(loadConfig(), {});
});
