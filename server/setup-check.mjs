import { appOrigin, gatewayUrl, aiGatewayValue } from "./security.mjs";
import { randomUUID } from "node:crypto";
import { localTestEligible, validPrivacyContact } from "./privacy.mjs";

const tables = [
  "dobao_profiles",
  "dobao_consent_events",
  "dobao_daily",
  "dobao_health_projection",
  "dobao_rate_limits",
  "dobao_leases",
  "dobao_accounts",
  "dobao_cleanup_jobs",
  "dobao_support_requests",
];
const functions = [
  "dobao_set_consent",
  "dobao_save_daily",
  "dobao_take_rate",
  "dobao_acquire_lease",
  "dobao_release_lease",
  "dobao_project",
  "dobao_register_supabase",
  "dobao_current_user_id",
  "dobao_begin_cleanup",
  "dobao_finish_cleanup",
];
const item = (key, ok, detail) => ({
  key,
  status: ok ? "PASS" : "BLOCKED",
  detail,
});
export function checkConfiguration(env, { production = false } = {}) {
  const results = [];
  if (production)
    results.push(
      item(
        "LOCAL_TEST_MODE_OFF",
        env.LOCAL_TEST_MODE !== "true",
        "ปิดโหมดทดสอบก่อน release; ไม่ใช้ flag ทดสอบบน hosting",
      ),
    );
  let supabase = false;
  try {
    const u = new URL(env.SUPABASE_URL);
    supabase =
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash;
  } catch {}
  results.push(item("SUPABASE_URL", supabase, "Supabase HTTPS origin"));
  for (const key of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"])
    results.push(
      item(
        key,
        !!env[key]?.trim(),
        key === "SUPABASE_SERVICE_ROLE_KEY"
          ? "ตั้ง server secret ใน .env.local/Vercel เท่านั้น"
          : "Public API key",
      ),
    );
  let origin = false;
  try {
    origin =
      !!appOrigin(env) &&
      (!production || env.APP_ORIGIN.startsWith("https://"));
  } catch {}
  results.push(
    item(
      "APP_ORIGIN",
      origin,
      production
        ? "ต้องเป็น HTTPS ของเว็บ production"
        : "ต้องตรง URL ที่เปิดเว็บ",
    ),
  );
  let gateway = false;
  try {
    gateway = !!gatewayUrl(aiGatewayValue(env), production);
  } catch {}
  results.push(
    item(
      "RUAMWAN_BASE_URL",
      gateway,
      production
        ? "Private HTTPS gateway ไปยัง Mac"
        : "AI origin สำหรับเครื่องนี้",
    ),
  );
  results.push(
    item(
      "RUAMWAN_API_KEY",
      !!env.RUAMWAN_API_KEY &&
        env.RUAMWAN_API_KEY.length >= 32 &&
        !/[^\x21-\x7E]/.test(env.RUAMWAN_API_KEY),
      "server-only API key",
    ),
  );
  for (const key of [
    "DATA_CONTROLLER",
    "DATA_RETENTION_NOTICE",
    "DATA_LOCATION_NOTICE",
  ])
    results.push(
      item(key, !!env[key]?.trim(), "ผู้ดูแลต้องระบุข้อมูลจริงก่อนเปิดใช้งาน"),
    );
  results.push(
    item(
      "PRIVACY_CONTACT",
      validPrivacyContact(env),
      "ช่องทางติดต่อผู้ควบคุมข้อมูลที่ใช้งานจริง เช่น LINE โทรศัพท์ หรืออีเมล",
    ),
  );
  results.push(
    item(
      "PRIVACY_NOTICE_READY",
      env.PRIVACY_NOTICE_READY === "true",
      "เปิดเมื่อผู้รับผิดชอบตรวจประกาศแล้ว ไม่ใช่การรับรองกฎหมาย",
    ),
  );
  const gatewayPair =
    !!env.AI_GATEWAY_CLIENT_ID === !!env.AI_GATEWAY_CLIENT_SECRET;
  results.push(
    item(
      "GATEWAY_SERVICE_TOKEN",
      gatewayPair,
      "หากใช้ Access ต้องตั้งทั้ง ID และ secret",
    ),
  );
  if (!production && localTestEligible(env, { devServer: true })) {
    for (const r of results)
      if (
        [
          "DATA_CONTROLLER",
          "DATA_RETENTION_NOTICE",
          "DATA_LOCATION_NOTICE",
          "PRIVACY_CONTACT",
          "PRIVACY_NOTICE_READY",
        ].includes(r.key) &&
        r.status === "BLOCKED"
      ) {
        r.status = "WARN";
        r.detail =
          "ยังไม่พร้อม production; ทดสอบข้อมูลสมมติได้เฉพาะ npm run dev บน localhost";
      }
    results.push({
      key: "LOCAL_TEST_MODE",
      status: "WARN",
      detail:
        "ใช้ข้อมูลสมมติเท่านั้น; ข้อมูลที่ยืนยันเก็บจริง; ไม่ใช่การตรวจผ่านประกาศ production",
    });
  }
  return results;
}

export async function checkConnections(
  env,
  { fetchImpl = fetch, production = false } = {},
) {
  const config = checkConfiguration(env, { production });
  const passed = (key) => config.find((c) => c.key === key)?.status === "PASS";
  async function request(url, headers = {}) {
    try {
      const r = await fetchImpl(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      return {
        status: r.status,
        ok: r.ok,
        data: await r.json().catch(() => null),
      };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  }
  const jobs = [];
  if (passed("SUPABASE_URL") && passed("SUPABASE_PUBLISHABLE_KEY"))
    jobs.push(
      (async () => {
        // Public Auth settings: which providers are enabled. No user data.
        const r = await request(`${env.SUPABASE_URL}/auth/v1/settings`, {
          apikey: env.SUPABASE_PUBLISHABLE_KEY,
        });
        return item(
          "SUPABASE_GOOGLE_PROVIDER",
          r.ok && r.data?.external?.google === true,
          r.status === 0
            ? "ติดต่อ Supabase ไม่ได้ ตรวจ SUPABASE_URL ว่าโปรเจกต์ยังอยู่และไม่ได้ถูกพัก"
            : r.ok
              ? r.data?.external?.google === true
                ? "เปิด Google provider แล้ว; ยังต้องตั้ง Redirect URLs และทดสอบ Login จริง"
                : "เปิด Authentication → Sign In / Providers → Google ใน Supabase"
              : "อ่าน Auth settings ไม่สำเร็จ ตรวจ publishable key",
        );
      })(),
    );
  if (passed("SUPABASE_URL") && passed("SUPABASE_PUBLISHABLE_KEY")) {
    const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY };
    if (passed("SUPABASE_SERVICE_ROLE_KEY"))
      jobs.push(
        (async () => {
          // OpenAPI metadata only: never query or print patient rows.
          const r = await request(`${env.SUPABASE_URL}/rest/v1/`, {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            Accept: "application/openapi+json",
          });
          const paths = r.data?.paths || {};
          const missing = [
            ...tables.filter((t) => !paths[`/${t}`]),
            ...functions.filter((f) => !paths[`/rpc/${f}`]),
            ...[
              "first_name",
              "last_name",
              "theme",
              "avatar_data_url",
              "shortcuts",
              "revision",
            ]
              .filter(
                (c) => !r.data?.definitions?.dobao_profiles?.properties?.[c],
              )
              .map((c) => `dobao_profiles.${c} (006)`),
          ];
          return item(
            "DATABASE_SCHEMA",
            r.ok && !!r.data?.paths && !missing.length,
            r.ok
              ? missing.length
                ? `ยังไม่พบ schema: ${missing.join(", ")} (รัน SQL migration)`
                : "พบตาราง/RPC ครบ; ยังต้องทดสอบ RLS A/B จริง"
              : "อ่าน schema ไม่สำเร็จ ตรวจ server key/API schema access",
          );
        })(),
      );
    else
      jobs.push(
        (async () => {
          const r = await request(
            `${env.SUPABASE_URL}/rest/v1/dobao_profiles?select=user_id&limit=0`,
            headers,
          );
          return item(
            "DATABASE_SCHEMA",
            false,
            r.data?.code === "PGRST205"
              ? "ยังไม่พบตาราง DoBao ให้รัน SQL migration"
              : "ต้องมี server key เพื่อตรวจตาราง/RPC โดยไม่อ่านข้อมูลผู้ป่วย",
          );
        })(),
      );
  }
  if (passed("RUAMWAN_BASE_URL"))
    jobs.push(
      (async () => {
        const headers = {};
        // The gateway authenticates readiness too; use the server credential.
        if (passed("RUAMWAN_API_KEY")) {
          headers.Authorization = `Bearer ${env.RUAMWAN_API_KEY}`;
          headers["X-Ruamwan-User"] = `dobao:${randomUUID()}`;
        }
        if (env.AI_GATEWAY_CLIENT_ID && env.AI_GATEWAY_CLIENT_SECRET) {
          headers["CF-Access-Client-Id"] = env.AI_GATEWAY_CLIENT_ID;
          headers["CF-Access-Client-Secret"] = env.AI_GATEWAY_CLIENT_SECRET;
        }
        const origin = gatewayUrl(aiGatewayValue(env), production);
        const r = await request(`${origin}/api/readiness`, headers);
        return item(
          "AI_READINESS",
          r.ok &&
            r.data?.model_available === true &&
            (!production || r.data?.production === true),
          !r.ok
            ? "ติดต่อ AI readiness ไม่สำเร็จ ตรวจ Mac/gateway"
            : production && r.data?.production !== true
              ? "บริการ AI ยังรายงาน production=false ต้องผ่านการทบทวนของผู้ดูแลก่อนเปิดใช้งานจริง"
              : "ตรวจ model_available ผ่าน; ไม่ใช่การรับรอง clinical accuracy",
        );
      })(),
    );
  if (passed("RUAMWAN_BASE_URL") && passed("RUAMWAN_API_KEY"))
    jobs.push(
      (async () => {
        // Catalog is public reference content, not a health record. Random owner for diagnostics.
        const headers = {
          Authorization: `Bearer ${env.RUAMWAN_API_KEY}`,
          "X-Ruamwan-User": `dobao:${randomUUID()}`,
        };
        if (env.AI_GATEWAY_CLIENT_ID && env.AI_GATEWAY_CLIENT_SECRET) {
          headers["CF-Access-Client-Id"] = env.AI_GATEWAY_CLIENT_ID;
          headers["CF-Access-Client-Secret"] = env.AI_GATEWAY_CLIENT_SECRET;
        }
        const r = await request(
          `${gatewayUrl(aiGatewayValue(env), production)}/api/food-catalog`,
          headers,
        );
        return item(
          "AI_AUTH",
          r.ok && Array.isArray(r.data?.items),
          "ตรวจ key ด้วยรายการอ้างอิงอาหาร ไม่อ่าน/เขียนบันทึกสุขภาพ",
        );
      })(),
    );
  return Promise.all(jobs);
}
