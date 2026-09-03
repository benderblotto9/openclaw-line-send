import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// These tests only exercise arg-parsing/validation/config paths, which all
// exit before lib/line-api.js ever calls fetch — no real network traffic,
// so they're safe to run offline and can't be flaky on a bad connection.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "bin", "line-send.js");

// Format-valid fake LINE ids (prefix + 32 hex chars), so tests that aren't
// specifically about id-format validation don't trip over it by accident.
const VALID_USER_ID_1 = "U" + "1".repeat(32);
const VALID_USER_ID_2 = "U" + "2".repeat(32);

const tempDirs = [];
function newConfigDir() {
  const dir = mkdtempSync(join(tmpdir(), "line-send-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function runCli(args, { configDir = newConfigDir(), env = {} } = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      // Blank out any real token/config the host machine might have so
      // these tests are deterministic regardless of where they run.
      LINE_CHANNEL_ACCESS_TOKEN: "",
      LINE_SEND_CONFIG_DIR: configDir,
      ...env,
    },
  });
}

test("--help prints usage and exits 0", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Send outbound LINE messages/);
});

test("no command prints usage and exits 0", () => {
  const result = runCli([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Send outbound LINE messages/);
});

test("unknown command exits 1 and shows usage", () => {
  const result = runCli(["bogus"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: bogus/);
});

test("missing access token: text command exits 1 with a clear message", () => {
  const result = runCli(["text", "--to", VALID_USER_ID_1, "--message", "hi"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No LINE Channel Access Token configured/);
});

test("text: missing --to exits 1", () => {
  const result = runCli(["text", "--message", "hi"], { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--to is required/);
});

test("text: --message with no value exits 1 with a clear error (regression: used to silently become `true`)", () => {
  const result = runCli(["text", "--to", VALID_USER_ID_1, "--message"], { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--message requires a value/);
});

test("text: --reply-to with no value exits 1 with a clear error", () => {
  const result = runCli(
    ["text", "--to", VALID_USER_ID_1, "--message", "hi", "--reply-to"],
    { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--reply-to requires a value/);
});

test("sticker: missing --package-id exits 1", () => {
  const result = runCli(
    ["sticker", "--to", VALID_USER_ID_1, "--sticker-id", "1"],
    { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--package-id is required/);
});

test("multicast: missing --user-id exits 1", () => {
  const result = runCli(["multicast", "--message", "hi"], { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--user-id is required/);
});

test("profile: more than one --user-id is rejected (regression for the array-shape bug)", () => {
  const result = runCli(
    ["profile", "--user-id", VALID_USER_ID_1, "--user-id", VALID_USER_ID_2],
    { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /profile accepts exactly one --user-id/);
});

test("text: --to with an invalid LINE id format is rejected", () => {
  const result = runCli(
    ["text", "--to", "not-a-valid-id", "--message", "hi"],
    { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--to doesn't look like a valid LINE id/);
});

test("multicast: an invalid --user-id format is rejected", () => {
  const result = runCli(
    ["multicast", "--user-id", "not-a-valid-id", "--message", "hi"],
    { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--user-id doesn't look like a valid LINE id/);
});

test("multicast: a group/room id (C.../R... prefix) is rejected for --user-id", () => {
  // Multicast recipients must be user ids specifically — unlike a push's
  // --to, groups/rooms aren't valid multicast targets.
  const groupId = "C" + "3".repeat(32);
  const result = runCli(
    ["multicast", "--user-id", groupId, "--message", "hi"],
    { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--user-id doesn't look like a valid LINE id/);
});

test("multicast: more than 500 --user-id values is rejected", () => {
  const manyIds = Array.from({ length: 501 }, () => ["--user-id", VALID_USER_ID_1]).flat();
  const result = runCli(
    ["multicast", ...manyIds, "--message", "hi"],
    { env: { LINE_CHANNEL_ACCESS_TOKEN: "dummy" } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /multicast accepts at most 500 --user-id values \(got 501\)/);
});

test("config: --token with no value exits 1 with a clear error", () => {
  const result = runCli(["config", "--token"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--token requires a value/);
});

test("config: --token=value syntax handles values starting with -- (arg-parser regression)", () => {
  const configDir = newConfigDir();
  const save = runCli(["config", "--token=--weird-token-value"], { configDir });
  assert.equal(save.status, 0);

  const show = runCli(["config", "--show"], { configDir });
  const shown = JSON.parse(show.stdout);
  assert.equal(shown.channelAccessToken, "--weird-...alue");
});

test("config: --clear actually removes the stored token (regression: --clear used to be a no-op)", () => {
  const configDir = newConfigDir();
  runCli(["config", "--token", "realtoken12345678"], { configDir });

  const beforeClear = runCli(["config", "--show"], { configDir });
  assert.match(beforeClear.stdout, /realtoke/);

  const clearResult = runCli(["config", "--clear"], { configDir });
  assert.equal(clearResult.status, 0);

  const afterClear = runCli(["config", "--show"], { configDir });
  const shown = JSON.parse(afterClear.stdout);
  assert.equal(shown.channelAccessToken, null);
});
