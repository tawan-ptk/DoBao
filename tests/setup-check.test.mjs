import test from "node:test";
import assert from "node:assert/strict";
import {
  checkConfiguration,
  checkConnections,
} from "../server/setup-check.mjs";
const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "sensitive-admin-secret",
  APP_ORIGIN: "http://localhost:3000",
  RUAMWAN_BASE_URL: "http://127.0.0.1:8765",
  RUAMWAN_API_KEY: "s".repeat(40),
  DATA_CONTROLLER: "Test",
  DATA_RETENTION_NOTICE: "Test",
  DATA_LOCATION_NOTICE: "Test",
  PRIVACY_CONTACT_EMAIL: "test@example.com",
  PRIVACY_NOTICE_READY: "true",
};
test("setup diagnostics never return secret values and production rejects loopback", () => {
  const local = checkConfiguration(env);
  assert.equal(
    local.every((r) => r.status === "PASS"),
    true,
  );
  assert.equal(
    JSON.stringify(local).includes(env.SUPABASE_SERVICE_ROLE_KEY),
    false,
  );
  const prod = checkConfiguration(env, { production: true });
  assert.equal(prod.find((r) => r.key === "APP_ORIGIN").status, "BLOCKED");
  assert.equal(
    prod.find((r) => r.key === "RUAMWAN_BASE_URL").status,
    "BLOCKED",
  );
});
test("setup connections read metadata only and sanitize upstream failures", async () => {
  const urls = [];
  const results = await checkConnections(env, {
    fetchImpl: async (url, options) => {
      urls.push(url);
      assert.equal(options.redirect, "error");
      if (url.endsWith("/auth/v1/settings"))
        return Response.json({ external: { google: false } });
      if (url.endsWith("/api/readiness")) {
        assert.equal(
          options.headers.Authorization,
          `Bearer ${env.RUAMWAN_API_KEY}`,
        );
        return Response.json({ model_available: true });
      }
      if (url.endsWith("/api/food-catalog"))
        return Response.json({ items: [] });
      if (url.endsWith("/rest/v1/"))
        return Response.json(
          { message: "sensitive-admin-secret" },
          { status: 401 },
        );
      throw new Error("Unexpected data query");
    },
  });
  assert.equal(results.find((r) => r.key === "AI_READINESS").status, "PASS");
  assert.equal(
    results.find((r) => r.key === "SUPABASE_GOOGLE_PROVIDER").status,
    "BLOCKED",
  );
  assert.equal(
    JSON.stringify(results).includes(env.SUPABASE_SERVICE_ROLE_KEY),
    false,
  );
  assert.equal(urls.length, 4);
});
