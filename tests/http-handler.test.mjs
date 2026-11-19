import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/index.js";
process.env.APP_ORIGIN = "http://localhost:3000";
async function request(url, { method = "GET", body, headers = {} } = {}) {
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(value) {
      this.body = JSON.parse(value);
      this.writableEnded = true;
    },
  };
  await handler(
    {
      url,
      method,
      body,
      headers: {
        origin: "http://localhost:3000",
        "x-dobao-request": "1",
        "content-type": "application/json",
        ...headers,
      },
    },
    response,
  );
  return response;
}
test("anonymous health and cleanup API requests cannot read or mutate user data", async () => {
  for (const [path, method] of [
    ["health/sync", "POST"],
    ["daily", "GET"],
    ["account/cleanup", "GET"],
    ["account/cleanup", "POST"],
    ["account/export", "GET"],
    ["profile", "POST"],
    ["profile/avatar", "POST"],
    ["profile/shortcuts", "POST"],
    ["support", "GET"],
    ["support", "POST"],
    ["support/delete", "POST"],
  ]) {
    const r = await request(`/api/${path}`, { method, body: {} });
    assert.equal(r.statusCode, 401);
    assert.match(r.headers["Cache-Control"], /no-store/);
  }
});
test("API rejects malformed, non-object and oversized JSON before Supabase authentication", async () => {
  for (const body of ["null", "[]", "true", "{", Array(3).fill(1)]) {
    const r = await request("/api/auth/supabase", { method: "POST", body });
    assert.equal(r.statusCode, 400);
  }
  const large = await request("/api/auth/supabase", {
    method: "POST",
    body: JSON.stringify({ text: "x".repeat(100001) }),
  });
  assert.equal(large.statusCode, 413);
});
test("API rejects cross-origin writes and unsupported methods", async () => {
  assert.equal(
    (
      await request("/api/auth/logout", {
        method: "POST",
        body: {},
        headers: { origin: "https://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("/api/config", { method: "DELETE" })).statusCode,
    405,
  );
});
