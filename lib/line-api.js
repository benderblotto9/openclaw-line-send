/**
 * LINE Messaging API client — Push, Reply, Multicast, Broadcast
 *
 * All functions return { ok, status, data } or throw on network errors.
 * Includes retry with exponential backoff for transient failures (429, 5xx, network).
 *
 * The caller is responsible for exit codes.
 */

const LINE_API = "https://api.line.me/v2/bot";

// --- Retry / timeout configuration ---
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;

/**
 * Check whether a status code is retryable.
 * 429 (rate limit) and 5xx (server errors) are transient.
 */
function isRetryable(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Parse the Retry-After header (seconds) from a Response.
 * Falls back to null if missing or unparseable.
 */
function getRetryAfter(res) {
  const raw = res.headers?.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs > 0 ? secs : null;
}

/**
 * Sleep for `ms` milliseconds. Resolves when done.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Core request function with timeout, retry, and backoff.
 *
 * @param {string} token    - LINE Channel Access Token
 * @param {string} method   - HTTP method
 * @param {string} path     - API path (appended to LINE_API base)
 * @param {object|null} body - JSON body (null for GET)
 * @param {object} [opts]   - Override options
 * @param {number} [opts.timeoutMs]    - Request timeout (default 15s)
 * @param {number} [opts.maxRetries]   - Max retry attempts (default 3)
 * @param {boolean} [opts.retryOnBody] - Whether retrying is safe for this endpoint
 *                                       (default: true for GET, false for POST)
 */
async function lineRequest(token, method, path, body = null, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryOnBody = method === "GET",
  } = opts;

  const url = `${LINE_API}${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOpts = { method, headers, signal: controller.signal };
      if (body !== null) {
        fetchOpts.body = JSON.stringify(body);
      }

      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      // Success
      if (res.ok) {
        return { ok: true, status: res.status, data };
      }

      // --- Error path ---
      const err = new Error(`LINE API ${res.status}: ${JSON.stringify(data)}`);
      err.status = res.status;
      err.data = data;

      // Not retryable or retries exhausted
      if (!isRetryable(res.status) || attempt >= maxRetries) {
        throw err;
      }

      // Retryable: check idempotency safety
      if (!retryOnBody) {
        // POST endpoints are not idempotent — don't blindly retry message sends.
        // LINE's own docs warn against automatic retries for send operations.
        throw err;
      }

      // Respect Retry-After header if present (429), otherwise use backoff
      const retryAfter = getRetryAfter(res);
      const waitMs = retryAfter
        ? retryAfter * 1000
        : BASE_BACKOFF_MS * Math.pow(2, attempt);

      console.error(
        `[line-api] Retryable ${res.status} on ${method} ${path} ` +
        `(attempt ${attempt + 1}/${maxRetries + 1}), waiting ${waitMs}ms...`
      );
      await sleep(waitMs);
      lastError = err;

    } catch (err) {
      clearTimeout(timer);

      const isAbort = err.name === "AbortError";
      const isNetwork = err.cause?.code === "ENOTFOUND" ||
                        err.cause?.code === "ECONNRESET" ||
                        err.cause?.code === "ECONNREFUSED" ||
                        err.cause?.code === "UND_ERR_SOCKET";

      // Timeout or network error — retryable if we have attempts left.
      // Also gated by retryOnBody: a timed-out POST send may have already
      // reached LINE, so retrying it risks a duplicate message.
      if ((isAbort || isNetwork) && retryOnBody && attempt < maxRetries) {
        const waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        console.error(
          `[line-api] ${isAbort ? "Timeout" : "Network error"} on ${method} ${path} ` +
          `(attempt ${attempt + 1}/${maxRetries + 1}), waiting ${waitMs}ms...`
        );
        await sleep(waitMs);
        lastError = err;
        continue;
      }

      // Not retryable or retries exhausted — throw with clear message
      if (isAbort) {
        const timeoutErr = new Error(
          `LINE API request timed out after ${timeoutMs}ms (${method} ${path})`
        );
        timeoutErr.status = 0;
        throw timeoutErr;
      }

      throw err;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error(`LINE API request failed after ${maxRetries + 1} attempts`);
}

/**
 * Send a text message (push or reply)
 */
export async function sendText(token, to, text, replyToken = null) {
  const messages = [{ type: "text", text }];

  if (replyToken) {
    return lineRequest(token, "POST", "/message/reply", {
      replyToken,
      messages,
    }, { retryOnBody: false });
  }

  return lineRequest(token, "POST", "/message/push", {
    to,
    messages,
  }, { retryOnBody: false });
}

/**
 * Send a sticker
 */
export async function sendSticker(token, to, packageId, stickerId) {
  return lineRequest(token, "POST", "/message/push", {
    to,
    messages: [
      {
        type: "sticker",
        packageId: String(packageId),
        stickerId: String(stickerId),
      },
    ],
  }, { retryOnBody: false });
}

/**
 * Send an image
 */
export async function sendImage(token, to, imageUrl, previewImageUrl = null) {
  return lineRequest(token, "POST", "/message/push", {
    to,
    messages: [
      {
        type: "image",
        originalContentUrl: imageUrl,
        previewImageUrl: previewImageUrl || imageUrl,
      },
    ],
  }, { retryOnBody: false });
}

/**
 * Multicast — send to multiple users (max 500)
 */
export async function multicast(token, userIds, text) {
  return lineRequest(token, "POST", "/message/multicast", {
    to: userIds,
    messages: [{ type: "text", text }],
  }, { retryOnBody: false });
}

/**
 * Broadcast — send to all followers
 */
export async function broadcast(token, text) {
  return lineRequest(token, "POST", "/message/broadcast", {
    messages: [{ type: "text", text }],
  }, { retryOnBody: false });
}

/**
 * Get a user profile
 */
export async function getProfile(token, userId) {
  return lineRequest(token, "GET", `/profile/${userId}`, null, { retryOnBody: true });
}
