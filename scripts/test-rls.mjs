// Integration test: opt-in, disposable accounts only. Never uses a patient UUID.
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { bangkokParts } from "../client-data.js";
import {
  saveProfile,
  identityPatch,
  shortcutPatch,
  avatarPatch,
  profileColumns,
} from "../server/profile.mjs";
import sharp from "sharp";
if (!process.argv.includes("--create-test-users")) {
  console.log(
    "This creates 2 temporary Auth accounts, synthetic app rows, then deletes ONLY those accounts (cascade). Prefer staging.",
  );
  console.log("Run explicitly: npm run test:rls -- --create-test-users");
  process.exit(1);
}
for (const key of [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
])
  if (!process.env[key]) {
    console.error(`Missing ${key}`);
    process.exit(1);
  }
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (url, opts) =>
      fetch(url, { ...opts, signal: AbortSignal.timeout(15000) }),
  },
};
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const publicClient = () =>
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    options,
  );
const runId = randomUUID(),
  created = [];
let phase = "schema",
  failed = false;
function ok(r) {
  if (r.error)
    throw new Error(`API code ${r.error.code || r.error.status || "unknown"}`);
  return r.data;
}
function denied(r, code = "42501") {
  if (r.error?.code !== code) {
    const error = new Error("Unexpected permission result");
    error.safeCode = /^[A-Z0-9_]{1,16}$/.test(r.error?.code || "")
      ? r.error.code
      : r.error
        ? "unknown_error"
        : "no_error";
    throw error;
  }
}
async function createTestUser(label) {
  const email = `dobao-rls-${runId}-${label}@example.com`,
    password = randomBytes(32).toString("base64url");
  const user = ok(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { dobao_rls_run: runId },
    }),
  ).user;
  created.push({ id: user.id, email });
  // Migration 003 preserves legacy Auth owners in a separate account namespace.
  const account = await admin
    .from("dobao_accounts")
    .insert({ id: user.id, legacy_auth_user_id: user.id });
  if (account.error && account.error.code !== "PGRST205") ok(account);
  const client = publicClient();
  ok(await client.auth.signInWithPassword({ email, password }));
  return { id: user.id, client };
}
try {
  // Fail before creating any test accounts if the migration has not run.
  ok(await admin.from("dobao_profiles").select(profileColumns).limit(0));
  ok(await admin.from("dobao_cleanup_jobs").select("user_id").limit(0));
  ok(await admin.from("dobao_support_requests").select("id").limit(0));
  phase = "create disposable users";
  const a = await createTestUser("a"),
    b = await createTestUser("b"),
    anon = publicClient();
  console.log("Created disposable test UUIDs:", a.id, b.id);
  phase = "profiles / owner isolation";
  ok(
    await a.client
      .from("dobao_profiles")
      .insert({ user_id: a.id, display_name: "RLS TEST A" }),
  );
  denied(
    await b.client
      .from("dobao_profiles")
      .insert({ user_id: a.id, display_name: "FORBIDDEN" }),
  );
  assert.deepEqual(
    ok(await b.client.from("dobao_profiles").select("*").eq("user_id", a.id)),
    [],
  );
  assert.deepEqual(
    ok(
      await b.client
        .from("dobao_profiles")
        .update({ display_name: "FORBIDDEN" })
        .eq("user_id", a.id)
        .select(),
    ),
    [],
  );
  assert.equal(
    ok(
      await a.client
        .from("dobao_profiles")
        .select("display_name")
        .eq("user_id", a.id)
        .single(),
    ).display_name,
    "RLS TEST A",
  );
  console.log("PASS profiles: cannot read/insert/update another owner");
  phase = "profile customization / revision / private avatar";
  let profile = await saveProfile(
    a.client,
    a,
    1,
    identityPatch({
      displayName: "RLS TEST A",
      firstName: "Synthetic",
      lastName: "Only",
      theme: "lavender",
    }),
  );
  assert.equal(profile.first_name, "Synthetic");
  assert.equal(profile.theme, "lavender");
  await assert.rejects(
    saveProfile(a.client, a, 1, { display_name: "STALE" }),
    (e) => e.status === 409,
  );
  profile = await saveProfile(
    a.client,
    a,
    profile.revision,
    shortcutPatch({ food: [], activity: ["Synthetic activity"] }),
  );
  assert.deepEqual(profile.shortcuts.food, []);
  const pixels = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#8899aa" },
  })
    .png()
    .toBuffer();
  profile = await saveProfile(
    a.client,
    a,
    profile.revision,
    await avatarPatch(`data:image/png;base64,${pixels.toString("base64")}`),
  );
  assert.match(profile.avatar_data_url, /^data:image\/webp;base64,/);
  assert.deepEqual(
    ok(
      await b.client
        .from("dobao_profiles")
        .select(profileColumns)
        .eq("user_id", a.id),
    ),
    [],
  );
  await assert.rejects(
    saveProfile(b.client, a, profile.revision, { first_name: "FORBIDDEN" }),
    (e) => e.status === 409,
  );
  profile = await saveProfile(
    a.client,
    a,
    profile.revision,
    await avatarPatch(null),
  );
  assert.equal(profile.avatar_data_url, null);
  console.log(
    "PASS 006: names, theme, empty shortcuts, private photo add/remove, stale writes and cross-owner isolation",
  );
  phase = "daily RPC consent / revision";
  const contact = ok(
    await a.client
      .from("dobao_support_requests")
      .insert({
        user_id: a.id,
        topic: "Synthetic contact",
        message: "Test only",
      })
      .select("id"),
  )[0];
  denied(
    await a.client
      .from("dobao_support_requests")
      .insert({
        user_id: a.id,
        topic: "Test",
        message: "Test",
        reply: "Forged",
      }),
  );
  denied(
    await a.client
      .from("dobao_support_requests")
      .update({ reply: "Forged" })
      .eq("id", contact.id),
  );
  assert.deepEqual(
    ok(
      await b.client
        .from("dobao_support_requests")
        .delete()
        .eq("id", contact.id)
        .select("id"),
    ),
    [],
  );
  ok(
    await admin
      .from("dobao_support_requests")
      .update({
        reply: "Synthetic team reply",
        status: "answered",
        answered_at: new Date().toISOString(),
      })
      .eq("id", contact.id),
  );
  assert.equal(
    ok(
      await a.client
        .from("dobao_support_requests")
        .select("reply")
        .eq("id", contact.id)
        .single(),
    ).reply,
    "Synthetic team reply",
  );
  console.log(
    "PASS 007: private contact requests, team reply protected, cross-owner delete denied",
  );
  const day = bangkokParts().date;
  const save = (c, water, revision) =>
    c.rpc("dobao_save_daily", {
      p_day: day,
      p_water: water,
      p_goals: [{ id: "test", label: "Synthetic RLS goal", done: false }],
      p_revision: revision,
    });
  denied(await save(a.client, 3, 0), "P0001");
  for (const u of [a, b])
    ok(
      await u.client.rpc("dobao_set_consent", {
        p_version: "2026-10-13",
        p_health: true,
        p_ai: false,
      }),
    );
  ok(await save(a.client, 3, 0));
  ok(await save(b.client, 7, 0));
  denied(await save(a.client, 4, 0), "P0001");
  assert.equal(
    ok(
      await a.client
        .from("dobao_daily")
        .select("water")
        .eq("user_id", a.id)
        .single(),
    ).water,
    3,
  );
  denied(
    await a.client
      .from("dobao_daily")
      .insert({ user_id: a.id, day, water: 10, goals: [] }),
  );
  console.log(
    "PASS daily: consent, owner derived in SQL, stale revision, direct writes denied",
  );
  phase = "projection and server-only RPCs";
  const project = (revision) =>
    admin.rpc("dobao_project", {
      p_user: a.id,
      p_revision: revision,
      p_records: [],
      p_summary: { test_only: true },
      p_plans: [],
    });
  ok(await project(2));
  ok(await project(1));
  phase = "projection revision monotonicity";
  assert.equal(
    ok(
      await a.client
        .from("dobao_health_projection")
        .select("revision")
        .eq("user_id", a.id)
        .single(),
    ).revision,
    2,
  );
  phase = "authenticated cannot call dobao_project";
  denied(
    await a.client.rpc("dobao_project", {
      p_user: a.id,
      p_revision: 3,
      p_records: [],
      p_summary: {},
      p_plans: [],
    }),
  );
  phase = "authenticated cannot acquire model lease";
  denied(
    await a.client.rpc("dobao_acquire_lease", {
      p_slot: "model",
      p_id: randomUUID(),
    }),
  );
  for (const table of [
    "dobao_profiles",
    "dobao_daily",
    "dobao_consent_events",
    "dobao_health_projection",
    "dobao_cleanup_jobs",
    "dobao_support_requests",
  ]) {
    phase = `anonymous read ${table}`;
    denied(await anon.from(table).select("*").limit(1));
    phase = `cross-owner read ${table}`;
    assert.deepEqual(
      ok(await b.client.from(table).select("*").eq("user_id", a.id)),
      [],
    );
  }
  for (const table of ["dobao_rate_limits", "dobao_leases"]) {
    phase = `anonymous read ${table}`;
    denied(await anon.from(table).select("*").limit(1));
    phase = `authenticated read ${table}`;
    denied(await a.client.from(table).select("*").limit(1));
  }
  phase = "anonymous consent RPC";
  denied(
    await anon.rpc("dobao_set_consent", {
      p_version: "2026-10-13",
      p_health: true,
      p_ai: false,
    }),
  );
  console.log(
    "PASS projection monotonicity, server-only RPCs, all-table anonymous and cross-owner access",
  );
  phase = "durable cleanup RLS / explicit begin / atomic completion";
  const cleanupDraft = `test-${runId}`,
    cleanupKey = randomUUID();
  const beginArgs = { p_user: a.id, p_draft: cleanupDraft, p_key: cleanupKey };
  ok(
    await admin.from("dobao_cleanup_jobs").insert({
      user_id: a.id,
      draft_id: cleanupDraft,
      scope: "all",
      source_revision: 2,
    }),
  );
  denied(
    await a.client.from("dobao_cleanup_jobs").insert({
      user_id: a.id,
      draft_id: "forbidden",
      scope: "all",
      source_revision: 0,
    }),
  );
  denied(await a.client.rpc("dobao_begin_cleanup", beginArgs));
  denied(await a.client.rpc("dobao_finish_cleanup", beginArgs));
  denied(await anon.rpc("dobao_finish_cleanup", beginArgs));
  assert.deepEqual(
    ok(
      await b.client.from("dobao_cleanup_jobs").select("*").eq("user_id", a.id),
    ),
    [],
  );
  denied(await admin.rpc("dobao_finish_cleanup", beginArgs), "P0001");
  const begun = ok(await admin.rpc("dobao_begin_cleanup", beginArgs))[0];
  assert.equal(begun.phase, "uncertain");
  denied(
    await admin.rpc("dobao_begin_cleanup", {
      ...beginArgs,
      p_key: randomUUID(),
    }),
    "P0001",
  );
  // A new daily edit after confirmation must survive delayed all-data cleanup.
  ok(await save(a.client, 4, 1));
  ok(
    await admin
      .from("dobao_cleanup_jobs")
      .update({
        phase: "cleanup",
        source_result: { deleted: true, scope: "all", revision: 3 },
      })
      .eq("user_id", a.id)
      .eq("draft_id", cleanupDraft),
  );
  ok(await admin.rpc("dobao_finish_cleanup", beginArgs));
  assert.equal(
    ok(
      await a.client
        .from("dobao_daily")
        .select("water")
        .eq("user_id", a.id)
        .single(),
    ).water,
    4,
  );
  const emptyProjection = ok(
    await a.client
      .from("dobao_health_projection")
      .select("records,revision")
      .eq("user_id", a.id)
      .single(),
  );
  assert.deepEqual(emptyProjection.records, []);
  assert.equal(emptyProjection.revision, 3);
  // A snapshot that started before deletion cannot restore the old payload.
  ok(
    await admin.rpc("dobao_project", {
      p_user: a.id,
      p_revision: 2,
      p_records: [{ test_only: "late old snapshot" }],
      p_summary: {},
      p_plans: [],
    }),
  );
  assert.deepEqual(
    ok(
      await a.client
        .from("dobao_health_projection")
        .select("records")
        .eq("user_id", a.id)
        .single(),
    ).records,
    [],
  );
  assert.equal(
    ok(
      await b.client
        .from("dobao_daily")
        .select("water")
        .eq("user_id", b.id)
        .single(),
    ).water,
    7,
  );
  ok(await admin.rpc("dobao_finish_cleanup", beginArgs));
  assert.equal(
    ok(
      await a.client
        .from("dobao_cleanup_jobs")
        .select("phase")
        .eq("user_id", a.id)
        .single(),
    ).phase,
    "complete",
  );
  // A second request removes only daily data that existed before it was confirmed.
  const oldArgs = {
    p_user: a.id,
    p_draft: `older-${runId}`,
    p_key: randomUUID(),
  };
  ok(
    await admin.from("dobao_cleanup_jobs").insert({
      user_id: a.id,
      draft_id: oldArgs.p_draft,
      scope: "all",
      source_revision: 3,
    }),
  );
  ok(await admin.rpc("dobao_begin_cleanup", oldArgs));
  ok(
    await admin
      .from("dobao_cleanup_jobs")
      .update({ phase: "cleanup" })
      .eq("user_id", a.id)
      .eq("draft_id", oldArgs.p_draft),
  );
  ok(await admin.rpc("dobao_finish_cleanup", oldArgs));
  assert.deepEqual(
    ok(await a.client.from("dobao_daily").select("*").eq("user_id", a.id)),
    [],
  );
  console.log(
    "PASS cleanup: owner isolation, server-only RPCs, explicit begin, idempotency, late-sync barrier and newer daily edit preservation",
  );
  phase = "withdrawal";
  ok(
    await a.client.rpc("dobao_set_consent", {
      p_version: "2026-10-13",
      p_health: false,
      p_ai: false,
    }),
  );
  denied(await save(a.client, 4, 1), "P0001");
  console.log("PASS withdrawal blocks daily writes");
} catch (error) {
  failed = true;
  // Only output phase and a numeric/known code; never raw SQL, token or row data.
  console.error(
    `FAIL ${phase}: ${error.safeCode || (/^API code [A-Za-z0-9_-]+$/.test(error.message) ? error.message : "assertion or connection failed")}`,
  );
} finally {
  for (const target of created) {
    try {
      const current = ok(await admin.auth.admin.getUserById(target.id)).user;
      assert.equal(current.email, target.email);
      assert.equal(current.app_metadata?.dobao_rls_run, runId);
      ok(await admin.auth.admin.deleteUser(target.id));
      console.log(
        "Removed disposable test account and cascaded app rows:",
        target.id,
      );
    } catch {
      failed = true;
      console.error(
        "Cleanup incomplete; manually inspect ONLY this test UUID:",
        target.id,
      );
    }
  }
}
console.log(
  failed
    ? "RLS test incomplete."
    : "Live RLS tests passed. Google OAuth and AI owner isolation require separate tests.",
);
process.exitCode = failed ? 1 : 0;
