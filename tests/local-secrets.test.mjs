import test from "node:test";
import assert from "node:assert/strict";
import { loadLocalAISecret } from "../server/local-secrets.mjs";

test("local AI key loads in memory without changing the source file", async () => {
  let reads = 0;
  const env = { RUAMWAN_API_KEY_FILE: "/test/key" };
  assert.equal(
    await loadLocalAISecret(env, async (path, encoding) => {
      reads++;
      assert.equal(path, "/test/key");
      assert.equal(encoding, "utf8");
      return "x".repeat(40) + "\n";
    }),
    true,
  );
  assert.equal(env.RUAMWAN_API_KEY, "x".repeat(40));
  await loadLocalAISecret(env, () => {
    throw Error("must not read again");
  });
  assert.equal(reads, 1);
});
test("local key file refuses production and sanitizes file errors", async () => {
  for (const env of [
    { VERCEL: "1", RUAMWAN_API_KEY_FILE: "/test/key" },
    { NODE_ENV: "production", RUAMWAN_API_KEY_FILE: "/test/key" },
    { RUAMWAN_API_KEY_FILE: "relative" },
  ])
    await assert.rejects(
      loadLocalAISecret(env, () => {
        throw Error("must not read");
      }),
    );
  await assert.rejects(
    loadLocalAISecret({ RUAMWAN_API_KEY_FILE: "/test/key" }, () => {
      throw Error("sensitive-path-secret");
    }),
    (e) => !e.message.includes("sensitive-path-secret"),
  );
  await assert.rejects(
    loadLocalAISecret({ RUAMWAN_API_KEY_FILE: "/test/key" }, async () => "bad"),
    /invalid format/,
  );
});
