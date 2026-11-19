import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  localTestEligible,
  enableLocalTestServer,
  getPrivacyNotice,
  isLocalTestMode,
  NOTICE_VERSION,
  validPrivacyContact,
} from "../server/privacy.mjs";
import {
  saveLocalTestConsent,
  saveLocalTestDaily,
} from "../server/local-test-data.mjs";
const env = {
  LOCAL_TEST_MODE: "true",
  APP_ORIGIN: "http://localhost:3000",
  PRIVACY_NOTICE_READY: "false",
};
const user = { id: "11111111-1111-4111-8111-111111111111" };
test("hosted pilot consent version matches both deployed SQL write contracts", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/003_firebase_auth.sql", import.meta.url),
    "utf8",
  );
  const consentVersion = sql.match(/p_version is distinct from '([^']+)'/)[1];
  const dailyVersion = sql.match(/health and notice_version='([^']+)'/)[1];
  for (const pilot of ["true", "false"]) {
    const n = getPrivacyNotice({ VERCEL: "1", PUBLIC_PILOT_MODE: pilot });
    assert.equal(n.version, consentVersion);
    assert.equal(n.version, dailyVersion);
  }
});
test("online pilot banner does not bypass privacy readiness", () => {
  const n = getPrivacyNotice({
    VERCEL: "1",
    PUBLIC_PILOT_MODE: "true",
    PRIVACY_NOTICE_READY: "false",
  });
  assert.equal(n.ready, false);
  assert.equal(n.testMode, false);
  assert.equal(n.pilotMode, true);
  assert.match(n.warning, /ข้อมูลสมมติ/);
  assert.equal(n.version, NOTICE_VERSION);
});
test("production notice supports a real non-email contact while missing contact stays blocked", () => {
  const configured = {
    APP_ORIGIN: "https://muge-eight.vercel.app",
    PRIVACY_NOTICE_READY: "true",
    DATA_CONTROLLER: "ทีมพัฒนา DoBao",
    DATA_RETENTION_NOTICE: "Test policy",
    DATA_LOCATION_NOTICE: "Confirmed test location",
  };
  assert.equal(getPrivacyNotice(configured).ready, false);
  const alternate = { ...configured, PRIVACY_CONTACT: "LINE: @test-support" };
  assert.equal(validPrivacyContact(alternate), true);
  assert.equal(getPrivacyNotice(alternate).productionReady, true);
  assert.equal(getPrivacyNotice(alternate).contact, "LINE: @test-support");
});
test("local test mode requires explicit loopback dev server and never runs on hosting", () => {
  assert.equal(localTestEligible(env), false);
  assert.equal(localTestEligible(env, { devServer: true }), true);
  for (const change of [
    { VERCEL: "1" },
    { VERCEL_ENV: "preview" },
    { NODE_ENV: "production" },
    { APP_ORIGIN: "https://dobao.example" },
    { LOCAL_TEST_MODE: "false" },
  ])
    assert.equal(
      localTestEligible({ ...env, ...change }, { devServer: true }),
      false,
    );
  enableLocalTestServer();
  const n = getPrivacyNotice(env);
  assert.equal(n.ready, true);
  assert.equal(n.productionReady, false);
  assert.equal(n.testMode, true);
  assert.notEqual(n.version, NOTICE_VERSION);
  const production = getPrivacyNotice({ ...env, VERCEL: "1" });
  assert.equal(production.ready, false);
  assert.equal(production.testMode, false);
  assert.equal(production.version, NOTICE_VERSION);
});
test("test-only writes bind to verified owner and use a separate notice version", async () => {
  const saved = {};
  const names = Object.keys(env),
    prior = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  enableLocalTestServer();
  try {
    const admin = {
      from: (table) => ({
        insert: async (row) => {
          saved.table = table;
          saved.row = row;
          return { error: null };
        },
      }),
    };
    await saveLocalTestConsent(admin, user, {
      health: true,
      ai: false,
      user_id: "attacker",
    });
    assert.equal(saved.row.user_id, user.id);
    assert.equal(saved.row.notice_version, `${NOTICE_VERSION}-local-test`);
    process.env.LOCAL_TEST_MODE = "false";
    await assert.rejects(
      saveLocalTestConsent(admin, user, { health: true, ai: false }),
      { status: 403 },
    );
  } finally {
    for (const k of names)
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
  }
});
test("local daily test updates retain owner and optimistic concurrency checks", async () => {
  const names = Object.keys(env),
    prior = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  enableLocalTestServer();
  try {
    const filters = [];
    let result = [{ user_id: user.id, revision: 2 }];
    const q = {
      update: () => q,
      eq: (k, v) => {
        filters.push([k, v]);
        return q;
      },
      select: async () => ({ error: null, data: result }),
    };
    const admin = { from: () => q };
    const row = await saveLocalTestDaily(admin, user, {
      day: "2026-10-13",
      water: 1,
      goals: [],
      revision: 1,
      user_id: "attacker",
    });
    assert.equal(row.user_id, user.id);
    assert.ok(filters.some(([k, v]) => k === "user_id" && v === user.id));
    assert.ok(filters.some(([k, v]) => k === "revision" && v === 1));
    result = [];
    await assert.rejects(
      saveLocalTestDaily(admin, user, {
        day: "2026-10-13",
        water: 1,
        goals: [],
        revision: 1,
      }),
      { status: 409 },
    );
  } finally {
    for (const k of names)
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
  }
});
