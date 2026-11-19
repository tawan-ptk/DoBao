import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("every DoBao RPC revokes explicit anon/authenticated grants before regranting", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/001_dobao.sql", import.meta.url),
    "utf8",
  );
  const revokes = sql.match(/revoke all on function[^;]+;/g) || [];
  assert.equal(revokes.length, 5);
  for (const statement of revokes)
    assert.match(statement, /from public,anon,authenticated;/);
  const repair = await readFile(
    new URL("../supabase/migrations/002_rpc_permissions.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    repair,
    /has_function_privilege\('authenticated',fn,'EXECUTE'\)/,
  );
  assert.doesNotMatch(repair, /drop\s+(table|function)/i);
});
test("Firebase migration maps string UIDs and retains strict server-only grants", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/003_firebase_auth.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /from public,anon,authenticated/);
  assert.match(
    sql,
    /grant execute on function public.dobao_register_firebase\(text,text\) to service_role/,
  );
  assert.match(sql, /https:\/\/securetoken.google.com\/dobao-muge100/);
  assert.match(sql, /claims->>'aud'='dobao-muge100'/);
  assert.match(sql, /firebase_uid=claims->>'sub'/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.dobao_/i);
  assert.doesNotMatch(sql, /where\s+email\s*=/i);
});
test("cleanup recovery keeps writes server-only, owner-scoped and preserves newer daily edits", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/004_cleanup_recovery.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /enable row level security/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.match(
    sql,
    /grant select on public.dobao_cleanup_jobs to authenticated/,
  );
  assert.match(sql, /updated_at<=job.requested_at/);
  assert.match(sql, /if job.phase='complete' then return/);
  assert.doesNotMatch(
    sql,
    /grant (all|insert|update|delete).*to authenticated/i,
  );
});
test("projection repair keeps an empty revision barrier instead of deleting the floor", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/005_projection_barrier.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /revision=greatest/);
  assert.match(sql, /records='\[\]',summary='\{\}',plans='\[\]'/);
  assert.doesNotMatch(sql, /delete from public.dobao_health_projection/);
  assert.match(sql, /from public,anon,authenticated/);
});
test("Supabase Auth migration keeps registration server-only and refuses Firebase tokens", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/008_supabase_auth.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    sql,
    /revoke all on function public.dobao_register_supabase\(uuid\) from public,anon,authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function public.dobao_register_supabase\(uuid\) to service_role/,
  );
  assert.match(sql, /claims->>'iss' like 'https:\/\/%\/auth\/v1'/);
  assert.match(sql, /drop function if exists public.dobao_register_firebase/);
  assert.doesNotMatch(sql, /securetoken\.google\.com\/dobao/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.dobao_/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.doesNotMatch(sql, /where\s+email\s*=/i);
});
