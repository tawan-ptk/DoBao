import test from "node:test";
import assert from "node:assert/strict";
import {
  supabaseWebConfig,
  supabaseAuthConfigured,
  verifySupabaseToken,
  bearerToken,
  accountForSupabase,
} from "../server/supabase-auth.mjs";

const now = 1800000000000,
  seconds = now / 1000,
  id = "11111111-1111-4111-8111-111111111111";
const user = {
  id,
  role: "authenticated",
  email: "user@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: { full_name: "Test" },
};
const claims = {
  sub: id,
  role: "authenticated",
  iss: "https://project.supabase.co/auth/v1",
  exp: seconds + 3600,
  is_anonymous: false,
  amr: [{ method: "oauth", timestamp: seconds - 30 }],
};
const jwt = (payload) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
const adminFor = (u, expectedToken) => ({
  auth: {
    getUser: async (token) => {
      if (expectedToken) assert.equal(token, expectedToken);
      return u ? { data: { user: u }, error: null } : { data: {}, error: { message: "PRIVATE" } };
    },
  },
});

test("Supabase token is verified by Auth server and requires a verified Google user", async () => {
  const token = jwt(claims);
  const ok = await verifySupabaseToken(token, {
    admin: adminFor(user, token),
    now,
    recent: true,
  });
  assert.equal(ok.user.id, id);
  for (const [userChange, claimChange] of [
    [{ app_metadata: { provider: "email", providers: ["email"] } }, {}],
    [{ email_confirmed_at: null }, {}],
    [{ is_anonymous: true }, {}],
    [{ role: "service_role" }, {}],
    [{}, { role: "anon" }],
    [{}, { sub: "22222222-2222-4222-8222-222222222222" }],
    [{}, { exp: seconds - 1 }],
  ]) {
    const t = jwt({ ...claims, ...claimChange });
    await assert.rejects(
      verifySupabaseToken(t, { admin: adminFor({ ...user, ...userChange }), now }),
      { status: 401 },
    );
  }
});
test("registration requires a recent Google sign-in", async () => {
  for (const amr of [
    [{ method: "oauth", timestamp: seconds - 301 }],
    [{ method: "password", timestamp: seconds - 10 }],
    undefined,
  ]) {
    const t = jwt({ ...claims, amr });
    await assert.rejects(
      verifySupabaseToken(t, { admin: adminFor(user), now, recent: true }),
      { status: 401, code: "recent_login_required" },
    );
  }
  // Ordinary requests later in the session do not need a recent login.
  const later = jwt({ ...claims, amr: [{ method: "oauth", timestamp: seconds - 3000 }] });
  assert.equal(
    (await verifySupabaseToken(later, { admin: adminFor(user), now })).user.id,
    id,
  );
});
test("invalid or revoked tokens fail closed without leaking upstream text", async () => {
  for (const token of [null, "", "x".repeat(16001)])
    await assert.rejects(verifySupabaseToken(token, { admin: adminFor(user), now }), {
      status: 401,
    });
  await assert.rejects(
    verifySupabaseToken(jwt(claims), { admin: adminFor(null), now }),
    (e) => e.status === 401 && !e.message.includes("PRIVATE"),
  );
  await assert.rejects(
    verifySupabaseToken(jwt(claims), {
      admin: { auth: { getUser: async () => { throw Error("PRIVATE network"); } } },
      now,
    }),
    (e) => e.status === 401 && !e.message.includes("PRIVATE"),
  );
});
test("public Supabase config exposes only URL and publishable key", () => {
  const env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "PRIVATE SECRET",
  };
  assert.deepEqual(supabaseWebConfig(env), {
    url: "https://project.supabase.co",
    publishableKey: "public-key",
  });
  assert.equal(JSON.stringify(supabaseWebConfig(env)).includes("PRIVATE"), false);
  assert.equal(supabaseAuthConfigured(env), true);
  assert.equal(supabaseAuthConfigured({ ...env, SUPABASE_SERVICE_ROLE_KEY: "" }), false);
  assert.equal(supabaseWebConfig({ ...env, SUPABASE_URL: "http://project.supabase.co" }), null);
  assert.equal(bearerToken({ headers: { authorization: "Bearer abc" } }), "abc");
  assert.equal(bearerToken({ headers: { cookie: "abc" } }), null);
});
test("Supabase owner maps through the server-only RPC, never email or caller input", async () => {
  let sent;
  const admin = {
    rpc: async (name, body) => {
      sent = { name, body };
      return { data: id, error: null };
    },
  };
  const owner = await accountForSupabase(admin, { ...user, email: "x@example.com" }, { register: true });
  assert.equal(owner.id, id);
  assert.deepEqual(sent, { name: "dobao_register_supabase", body: { p_user: id } });
  await assert.rejects(
    accountForSupabase(
      { rpc: async () => ({ error: { message: "PRIVATE SQL" }, data: null }) },
      user,
      { register: true },
    ),
    (e) => e.status === 503 && !e.message.includes("PRIVATE"),
  );
});
