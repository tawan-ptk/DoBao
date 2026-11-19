import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmDeletion,
  retryCleanup,
  registerDeletion,
} from "../server/cleanup.mjs";
import { HTTPError } from "../server/security.mjs";
import { createAIClient } from "../server/ai.mjs";
const user = { id: "11111111-1111-4111-8111-111111111111" };
const key = "22222222-2222-4222-8222-222222222222";
function database({ finishFailures = 0, dailyCount = 0 } = {}) {
  let job = {
    user_id: user.id,
    draft_id: "draft",
    scope: "records",
    record_ids: ["old"],
    counts: { count: 1, history_count: 1, plan_count: 0 },
    source_revision: 2,
    phase: "preview",
    source_result: null,
  };
  const calls = [];
  return {
    calls,
    get job() {
      return job;
    },
    from(table) {
      let update, insert;
      const filters = {};
      const q = {
        select() {
          return q;
        },
        insert(value) {
          insert = value;
          return q;
        },
        update(value) {
          update = value;
          return q;
        },
        eq(k, v) {
          filters[k] = v;
          return q;
        },
        maybeSingle() {
          return q;
        },
        then(resolve) {
          calls.push({ table, filters, update, insert });
          if (table === "dobao_daily")
            return Promise.resolve({ data: null, count: dailyCount }).then(
              resolve,
            );
          if (insert) {
            job = { ...job, ...insert };
            return Promise.resolve({ data: null }).then(resolve);
          }
          assert.equal(filters.user_id, user.id);
          assert.equal(filters.draft_id, job.draft_id);
          if (update) {
            assert.equal(filters.request_key, job.request_key);
            Object.assign(job, update);
          }
          return Promise.resolve({ data: structuredClone(job) }).then(resolve);
        },
      };
      return q;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      assert.equal(args.p_user, user.id);
      assert.equal(args.p_draft, job.draft_id);
      if (job.request_key && job.request_key !== args.p_key)
        return { error: { message: "cleanup_key_conflict" } };
      if (name === "dobao_begin_cleanup") {
        if (job.phase === "preview")
          Object.assign(job, { phase: "uncertain", request_key: args.p_key });
        return { data: [structuredClone(job)] };
      }
      assert.equal(name, "dobao_finish_cleanup");
      if (finishFailures-- > 0)
        return { error: { message: "connection failed" } };
      job.phase = "complete";
      return { data: null };
    },
  };
}
const body = { draft_id: "draft", idempotency_key: key, confirmed: true };
test("deletion keeps durable owner-bound receipt when Supabase cleanup fails, then retries without repeating AI write", async () => {
  const db = database({ finishFailures: 1 });
  let writes = 0;
  const ai = async () => {
    writes++;
    return {
      deleted: true,
      scope: "records",
      count: 1,
      revision: 3,
      private_label: "must not persist",
    };
  };
  const first = await confirmDeletion(ai, db, user, body, db.job);
  assert.equal(first.projection_synced, false);
  assert.equal(db.job.phase, "cleanup");
  assert.equal("private_label" in db.job.source_result, false);
  const next = await retryCleanup(ai, db, user, "draft");
  assert.equal(next.projection_synced, true);
  assert.equal(db.job.phase, "complete");
  assert.equal(writes, 1);
  assert.equal(
    (await retryCleanup(ai, db, user, "draft")).projection_synced,
    true,
  );
  assert.equal(writes, 1);
});
test("expired upstream draft recovers only when full history proves selected IDs are gone at a newer stable revision", async () => {
  const db = database();
  let phase = "lost";
  const reads = [];
  const ai = async (path, method, _, query) => {
    if (path === "confirm")
      throw new HTTPError(phase === "lost" ? 503 : 404, "test");
    reads.push(query);
    return { items: [], revision: 3 };
  };
  await assert.rejects(confirmDeletion(ai, db, user, body, db.job), {
    status: 503,
  });
  assert.equal(db.job.phase, "uncertain");
  phase = "expired";
  const r = await retryCleanup(ai, db, user, "draft");
  assert.equal(r.recovered, true);
  assert.equal(r.projection_synced, true);
  assert.ok(reads.every((q) => q.includes("history=true")));
});
test("an edit or unchanged revision is never mistaken for a confirmed deletion", async () => {
  for (const history of [
    { items: [{ id: "old" }], revision: 3 },
    { items: [], revision: 2 },
  ]) {
    const db = database();
    const ai = async (path) => {
      if (path === "confirm") throw new HTTPError(404, "expired");
      return history;
    };
    await assert.rejects(confirmDeletion(ai, db, user, body, db.job), {
      status: 404,
    });
    await assert.rejects(retryCleanup(ai, db, user, "draft"), { status: 409 });
    assert.equal(db.job.phase, "uncertain");
    assert.equal(
      db.calls.some((c) => c.name === "dobao_finish_cleanup"),
      false,
    );
  }
});
test("confirmation is explicit and cannot switch idempotency keys", async () => {
  const db = database();
  const ai = async () => ({ deleted: true, scope: "records", revision: 3 });
  await assert.rejects(
    confirmDeletion(ai, db, user, { ...body, confirmed: false }, db.job),
    { status: 422 },
  );
  assert.equal(db.calls.length, 0);
  await confirmDeletion(ai, db, user, body, db.job);
  await assert.rejects(
    confirmDeletion(
      ai,
      db,
      user,
      { ...body, idempotency_key: "33333333-3333-4333-8333-333333333333" },
      db.job,
    ),
    { status: 409 },
  );
});
test("daily-only deletion has its own explicit server preview and never forces an AI confirmation", async () => {
  const db = database({ dailyCount: 1 });
  const preview = await registerDeletion(
    db,
    user,
    {
      draft_id: "empty-ai",
      can_confirm: false,
      count: 0,
      history_count: 0,
      plan_count: 0,
      input_revision: 0,
    },
    { scope: "all", record_ids: [] },
  );
  assert.equal(preview.can_confirm, true);
  assert.match(preview.draft_id, /^daily-/);
  let writes = 0;
  const ai = async (path) => {
    if (path === "confirm") writes++;
    return path === "plans" ? { items: [] } : { items: [], revision: 0 };
  };
  const result = await confirmDeletion(
    ai,
    db,
    user,
    { ...body, draft_id: preview.draft_id },
    db.job,
  );
  assert.equal(writes, 0);
  assert.equal(result.deleted, true);
  assert.equal(result.daily_count, 1);
});
test("daily-only confirmation refuses a changed AI record set", async () => {
  const db = database({ dailyCount: 1 });
  await registerDeletion(
    db,
    user,
    {
      draft_id: "empty",
      can_confirm: false,
      count: 0,
      history_count: 0,
      plan_count: 0,
      input_revision: 0,
    },
    { scope: "all" },
  );
  const ai = async (path) =>
    path === "plans" ? { items: [] } : { items: [{ id: "new" }], revision: 1 };
  await assert.rejects(confirmDeletion(ai, db, user, body, db.job), {
    status: 409,
  });
  assert.equal(
    db.calls.some((c) => c.name === "dobao_finish_cleanup"),
    false,
  );
});
test("daily-only verification uses queries accepted by the real AI proxy allowlist", async () => {
  const db = database({ dailyCount: 1 });
  await registerDeletion(
    db,
    user,
    {
      draft_id: "empty",
      can_confirm: false,
      count: 0,
      history_count: 0,
      plan_count: 0,
      input_revision: 0,
    },
    { scope: "all" },
  );
  const urls = [];
  const ai = createAIClient(user, {
    env: {
      RUAMWAN_BASE_URL: "http://127.0.0.1:8765",
      RUAMWAN_API_KEY: "s".repeat(40),
    },
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json(
        url.endsWith("/plans") ? { items: [] } : { items: [], revision: 0 },
      );
    },
  });
  assert.equal(
    (await confirmDeletion(ai, db, user, body, db.job)).projection_synced,
    true,
  );
  assert.equal(urls.length, 3);
  assert.ok(urls.every((url) => !url.endsWith("/confirm")));
});
