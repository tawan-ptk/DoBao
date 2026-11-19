import test from "node:test";
import assert from "node:assert/strict";
import { aiOriginFor, createAIClient } from "../server/ai.mjs";

const env = {
  VERCEL_ENV: "production",
  RUAMWAN_CORE_URL: "https://baobuddy-core.vercel.app",
  RUAMWAN_GATEWAY_URL: "https://mac-gateway.example.com",
  RUAMWAN_API_KEY: "k".repeat(48),
};
test("records go to the cloud service; only chat/extract need the Mac model", () => {
  for (const path of ["records", "records/batch-preview", "confirm", "plans/preview", "journal/prepare", "food-energy", "export"])
    assert.equal(aiOriginFor(path, env).origin, "https://baobuddy-core.vercel.app");
  for (const path of ["chat", "extract"])
    assert.equal(aiOriginFor(path, env).origin, "https://mac-gateway.example.com");
  // Without a cloud service everything still goes to the gateway, as before.
  const { RUAMWAN_CORE_URL, ...old } = env;
  assert.equal(aiOriginFor("records", old).origin, "https://mac-gateway.example.com");
});
test("saving records works even when the Mac gateway is misconfigured", async () => {
  const calls = [];
  const ai = createAIClient(
    { id: "11111111-1111-4111-8111-111111111111" },
    {
      env: { ...env, RUAMWAN_GATEWAY_URL: "http://127.0.0.1:8765" },
      fetchImpl: async (url) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      },
    },
  );
  await ai("records", "GET");
  assert.deepEqual(calls, ["https://baobuddy-core.vercel.app/api/records"]);
  await assert.rejects(ai("chat", "POST", { messages: [] }), { status: 503 });
});

test("hosted model mode sends chat and extract to the cloud core too", () => {
  const env = {
    VERCEL_ENV: "production",
    RUAMWAN_CORE_URL: "https://baobuddy-core.vercel.app",
    RUAMWAN_GATEWAY_URL: "https://mac-gateway.example.com",
    RUAMWAN_AI_ON_CORE: "true",
  };
  for (const path of ["chat", "extract", "records"])
    assert.equal(aiOriginFor(path, env).origin, "https://baobuddy-core.vercel.app");
});
