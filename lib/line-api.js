/**
 * LINE Messaging API client — Push, Reply, Multicast, Broadcast
 *
 * All functions return { ok, status, data } or throw on network errors.
 * The caller is responsible for exit codes.
 */

const LINE_API = "https://api.line.me/v2/bot";

async function lineRequest(token, method, path, body = null) {
  const url = `${LINE_API}${path}`;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const opts = { method, headers };
  if (body !== null) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    const err = new Error(`LINE API ${res.status}: ${JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return { ok: true, status: res.status, data };
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
    });
  }

  return lineRequest(token, "POST", "/message/push", {
    to,
    messages,
  });
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
  });
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
  });
}

/**
 * Multicast — send to multiple users (max 500)
 */
export async function multicast(token, userIds, text) {
  return lineRequest(token, "POST", "/message/multicast", {
    to: userIds,
    messages: [{ type: "text", text }],
  });
}

/**
 * Broadcast — send to all followers
 */
export async function broadcast(token, text) {
  return lineRequest(token, "POST", "/message/broadcast", {
    messages: [{ type: "text", text }],
  });
}

/**
 * Get a user profile
 */
export async function getProfile(token, userId) {
  return lineRequest(token, "GET", `/profile/${userId}`);
}
