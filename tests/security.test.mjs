import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSameOrigin,
  gatewayUrl,
  assertAIPath,
  stableAIUser,
  deletionReceipt,
  verifyDeletionReceipt,
} from "../server/security.mjs";
import { createAIClient } from "../server/ai.mjs";
const user = { id: "12345678-1234-4234-8234-123456789abc" };
test("writes require exact configured Origin and custom CSRF header", () => {
  assert.doesNotThrow(() =>
    assertSameOrigin(
      {
        headers: {
          origin: "https://dobao.example",
          "x-dobao-request": "1",
          "sec-fetch-site": "same-origin",
        },
      },
      "https://dobao.example",
    ),
  );
  for (const headers of [
    { origin: "https://evil.example", "x-dobao-request": "1" },
    { origin: "https://dobao.example" },
    { "x-dobao-request": "1" },
  ])
    assert.throws(
      () => assertSameOrigin({ headers }, "https://dobao.example"),
      { status: 403 },
    );
});
test("gateway and action path cannot be supplied by the browser or redirected", () => {
  assert.equal(gatewayUrl("https://ai.example"), "https://ai.example");
  for (const url of [
    "http://ai.example",
    "https://user:password@ai.example",
    "https://ai.example/path",
    "https://ai.example?x=1",
  ])
    assert.throws(() => gatewayUrl(url));
  assert.throws(() => gatewayUrl("http://127.0.0.1:8765", true));
  assert.throws(() => assertAIPath("../confirm", "POST"));
  assert.throws(() => assertAIPath("delete", "POST"));
  assert.throws(() => assertAIPath("confirm", "GET"));
});
test("owner is derived from verified UUID and secret stays in server request", async () => {
  let sent;
  const ai = createAIClient(user, {
    env: {
      RUAMWAN_BASE_URL: "http://127.0.0.1:8765",
      RUAMWAN_GATEWAY_URL: "https://ai.example",
      RUAMWAN_API_KEY: "x".repeat(40),
    },
    fetchImpl: async (url, options) => {
      sent = { url, ...options };
      return Response.json({ answer: "ok" });
    },
  });
  assert.deepEqual(
    await ai("chat", "POST", {
      messages: [{ role: "user", content: "ใช้งานยังไง" }],
    }),
    { answer: "ok" },
  );
  assert.equal(sent.headers["X-Ruamwan-User"], `dobao:${user.id}`);
  assert.equal(sent.url, "https://ai.example/api/chat");
  assert.equal(sent.redirect, "error");
  assert.equal(stableAIUser(user), `dobao:${user.id}`);
  assert.throws(() => stableAIUser({ id: "browser-chosen" }));
  await assert.rejects(ai("records", "GET", undefined, "?owner=someone-else"));
});
test("deletion after withdrawal requires a signed receipt bound to owner/draft/expiry", () => {
  const secret = "s".repeat(40),
    receipt = deletionReceipt("draft-1", user.id, secret, 1000);
  assert.equal(
    verifyDeletionReceipt(receipt, "draft-1", user.id, secret, 2000),
    true,
  );
  assert.equal(
    verifyDeletionReceipt(receipt, "draft-2", user.id, secret, 2000),
    false,
  );
  assert.equal(
    verifyDeletionReceipt(receipt, "draft-1", "other-user", secret, 2000),
    false,
  );
  assert.equal(
    verifyDeletionReceipt(receipt, "draft-1", user.id, secret, 2000000),
    false,
  );
  assert.equal(
    verifyDeletionReceipt(receipt + "x", "draft-1", user.id, secret, 2000),
    false,
  );
});
test("upstream credential errors and network errors do not leak secrets", async () => {
  const env = { RUAMWAN_API_KEY: "secret".repeat(8) };
  const ai = createAIClient(user, {
    env,
    fetchImpl: async () =>
      Response.json({ detail: "internal secret" }, { status: 401 }),
  });
  await assert.rejects(
    ai("summary"),
    (e) => e.status === 502 && !e.message.includes("internal secret"),
  );
  const offline = createAIClient(user, {
    env,
    fetchImpl: async () => {
      throw new TypeError("secret network internals");
    },
  });
  await assert.rejects(
    offline("summary"),
    (e) => e.status === 503 && !e.message.includes("internals"),
  );
});
