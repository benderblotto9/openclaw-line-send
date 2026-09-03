import test from "node:test";
import assert from "node:assert/strict";

const {
  sendText,
  sendSticker,
  sendImage,
  multicast,
  broadcast,
  getProfile,
  isRetryable,
  getRetryAfter,
  backoffWithJitter,
} = await import("../lib/line-api.js");

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

function mockResponse({ status, data, headers = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(data),
  };
}

function abortError() {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function networkError(code = "ECONNRESET") {
  const err = new Error("fetch failed");
  err.cause = { code };
  return err;
}

// --- pure helper functions ---

test("isRetryable: 429 and 5xx are retryable, everything else is not", () => {
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(599), true);
  assert.equal(isRetryable(400), false);
  assert.equal(isRetryable(401), false);
  assert.equal(isRetryable(200), false);
});

test("getRetryAfter parses a valid header and rejects invalid/missing ones", () => {
  assert.equal(getRetryAfter(mockResponse({ status: 429, data: {}, headers: { "retry-after": "5" } })), 5);
  assert.equal(getRetryAfter(mockResponse({ status: 429, data: {} })), null);
  assert.equal(getRetryAfter(mockResponse({ status: 429, data: {}, headers: { "retry-after": "not-a-number" } })), null);
  assert.equal(getRetryAfter(mockResponse({ status: 429, data: {}, headers: { "retry-after": "-5" } })), null);
  assert.equal(getRetryAfter(mockResponse({ status: 429, data: {}, headers: { "retry-after": "0" } })), null);
});

test("backoffWithJitter is capped at 30s even for large attempt numbers", () => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const wait = backoffWithJitter(attempt);
    assert.ok(wait <= 30_000, `attempt ${attempt} waited ${wait}ms, expected <= 30000ms`);
    assert.ok(wait >= 0, `attempt ${attempt} produced a negative wait`);
  }
});

test("backoffWithJitter(0) stays within its equal-jitter band [500, 1000]", () => {
  for (let i = 0; i < 25; i++) {
    const wait = backoffWithJitter(0);
    assert.ok(wait >= 500 && wait <= 1000, `unexpected wait ${wait}ms for attempt 0`);
  }
});

// --- request shape ---

test("sendText (push) posts to /message/push with the expected body", async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return mockResponse({ status: 200, data: { ok: true } });
  };

  const result = await sendText("tok", "U123", "hello");

  assert.equal(captured.url, "https://api.line.me/v2/bot/message/push");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(captured.opts.body), {
    to: "U123",
    messages: [{ type: "text", text: "hello" }],
  });
  assert.equal(result.ok, true);
});

test("sendText (reply) posts to /message/reply with replyToken instead of `to`", async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return mockResponse({ status: 200, data: { ok: true } });
  };

  await sendText("tok", "U123", "hi", "replyTok1");

  assert.equal(captured.url, "https://api.line.me/v2/bot/message/reply");
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body, { replyToken: "replyTok1", messages: [{ type: "text", text: "hi" }] });
  assert.equal(body.to, undefined);
});

test("sendSticker coerces numeric ids to strings", async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { opts };
    return mockResponse({ status: 200, data: {} });
  };

  await sendSticker("tok", "U123", 6325, 10979904);

  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body.messages[0], { type: "sticker", packageId: "6325", stickerId: "10979904" });
});

test("sendImage defaults previewImageUrl to the image url when not given", async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { opts };
    return mockResponse({ status: 200, data: {} });
  };

  await sendImage("tok", "U123", "https://example.com/a.jpg");

  const body = JSON.parse(captured.opts.body);
  assert.equal(body.messages[0].originalContentUrl, "https://example.com/a.jpg");
  assert.equal(body.messages[0].previewImageUrl, "https://example.com/a.jpg");
});

test("multicast posts the recipient array under `to`", async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return mockResponse({ status: 200, data: {} });
  };

  await multicast("tok", ["U1", "U2"], "hi all");

  assert.equal(captured.url, "https://api.line.me/v2/bot/message/multicast");
  assert.deepEqual(JSON.parse(captured.opts.body).to, ["U1", "U2"]);
});

test("broadcast has no `to` field", async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return mockResponse({ status: 200, data: {} });
  };

  await broadcast("tok", "hi everyone");

  assert.equal(captured.url, "https://api.line.me/v2/bot/message/broadcast");
  assert.equal(JSON.parse(captured.opts.body).to, undefined);
});

test("getProfile issues a GET to /profile/<id>", async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return mockResponse({ status: 200, data: { userId: "U123" } });
  };

  const result = await getProfile("tok", "U123");

  assert.equal(captured.url, "https://api.line.me/v2/bot/profile/U123");
  assert.equal(captured.opts.method, "GET");
  assert.deepEqual(result.data, { userId: "U123" });
});

// --- retry / idempotency behavior ---

test("a non-retryable status (400) fails immediately without retrying", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockResponse({ status: 400, data: { message: "bad request" } });
  };

  await assert.rejects(() => sendText("tok", "U123", "hi"), (err) => err.status === 400);
  assert.equal(calls, 1);
});

test("POST sends are not retried on 5xx — not idempotent", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockResponse({ status: 500, data: { message: "server error" } });
  };

  await assert.rejects(() => sendText("tok", "U123", "hi"), (err) => err.status === 500);
  assert.equal(calls, 1, "a POST send must not be retried on 5xx");
});

test("POST sends are not retried after a timeout (regression: retryOnBody must gate the abort path too)", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw abortError();
  };

  await assert.rejects(() => sendText("tok", "U123", "hi"), (err) => err.status === 0);
  assert.equal(calls, 1, "a timed-out POST send must not be retried — it may have already reached LINE");
});

test("POST sends are not retried after a network error (regression)", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw networkError();
  };

  await assert.rejects(() => sendText("tok", "U123", "hi"));
  assert.equal(calls, 1, "a POST send hit by a network error must not be retried");
});

test("GET requests retry on 429 and eventually succeed", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return mockResponse({ status: 429, data: { message: "rate limited" } });
    return mockResponse({ status: 200, data: { userId: "U123" } });
  };

  const result = await getProfile("tok", "U123");

  assert.equal(calls, 2);
  assert.deepEqual(result.data, { userId: "U123" });
});

test("GET requests retry on a network error and eventually succeed", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw networkError();
    return mockResponse({ status: 200, data: { userId: "U123" } });
  };

  const result = await getProfile("tok", "U123");

  assert.equal(calls, 2);
  assert.deepEqual(result.data, { userId: "U123" });
});

test("GET requests exhaust retries and throw the final error (1 initial + 3 retries)", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockResponse({ status: 503, data: { message: "unavailable" } });
  };

  await assert.rejects(() => getProfile("tok", "U123"), (err) => err.status === 503);
  assert.equal(calls, 4);
});
