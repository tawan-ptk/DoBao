import { createClient } from "@supabase/supabase-js";
import { parse, serialize } from "cookie";
import { randomUUID } from "node:crypto";
import {
  HTTPError,
  appOrigin,
  assertSameOrigin,
  boundedString,
  deletionReceipt,
  verifyDeletionReceipt,
} from "../server/security.mjs";
import { createAIClient } from "../server/ai.mjs";
import {
  supabaseAuthConfigured,
  supabaseWebConfig,
  verifySupabaseToken,
  bearerToken,
  accountForSupabase,
} from "../server/supabase-auth.mjs";
import { getPrivacyNotice, isLocalTestMode } from "../server/privacy.mjs";
import {
  saveLocalTestConsent,
  saveLocalTestDaily,
} from "../server/local-test-data.mjs";
import { releaseModelLease } from "../server/leases.mjs";
import {
  registerDeletion,
  pendingCleanups,
  deletionJob,
  confirmDeletion,
  retryCleanup,
} from "../server/cleanup.mjs";
import {
  jsonObject,
  calendarDay,
  dailyPayload,
} from "../server/validation.mjs";
import {
  profileColumns,
  identityPatch,
  shortcutPatch,
  avatarPatch,
  saveProfile,
} from "../server/profile.mjs";
import { supportRequest, removeSupportRequest } from "../server/support.mjs";
import { databaseDiagnostic } from "../server/database-diagnostics.mjs";

function send(res, status, data) {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function check(result) {
  if (result.error) {
    const reference = databaseDiagnostic(result.error, "app_query");
    throw new HTTPError(
      result.error.message?.includes("stale_revision") ? 409 : 503,
      result.error.message?.includes("stale_revision")
        ? "ข้อมูลเปลี่ยนจากอุปกรณ์อื่น กรุณาโหลดใหม่แล้วทำรายการอีกครั้ง"
        : `ยังทำรายการกับฐานข้อมูลไม่สำเร็จ กรุณาติดต่อทีมพร้อมรหัส ${reference}`,
      "database_error",
    );
  }
  return result.data;
}
async function bodyOf(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json"))
    throw new HTTPError(415, "รูปแบบข้อมูลไม่ถูกต้อง");
  if (req.body && typeof req.body === "object") {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 100000)
      throw new HTTPError(413, "ข้อมูลมากเกินไป");
    return jsonObject(req.body);
  }
  let text = "";
  if (typeof req.body === "string") text = req.body;
  else
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 100000)
        throw new HTTPError(413, "ข้อมูลมากเกินไป");
    }
  if (Buffer.byteLength(text) > 100000)
    throw new HTTPError(413, "ข้อมูลมากเกินไป");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HTTPError(400, "ข้อมูล JSON ไม่ถูกต้อง");
  }
  return jsonObject(parsed);
}
function supabaseFor(token) {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new HTTPError(
      503,
      "ผู้ดูแลยังไม่ได้เชื่อมระบบเข้าสู่ระบบ",
      "not_configured",
    );
  // The user's own Supabase Auth token; queries remain under RLS, not service_role.
  return createClient(url, key, {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function adminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new HTTPError(
      503,
      "ผู้ดูแลยังไม่ได้ตั้งค่าการซิงก์ข้อมูลและจำกัดการใช้งาน AI",
      "not_configured",
    );
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
function notice() {
  return getPrivacyNotice();
}
async function exportRows(sb, table, userId, order) {
  // Supabase defaults to a row cap. Export every page, not only the first 1,000.
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = check(
      await sb
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .order(order)
        .range(offset, offset + 499),
    );
    rows.push(...page);
    if (page.length < 500) return rows;
    if (offset >= 50000)
      throw new HTTPError(503, "ข้อมูลส่งออกมีจำนวนมาก กรุณาติดต่อผู้ดูแล");
  }
}
async function snapshot(ai, admin, user) {
  // Read an entire revision consistently; no health data is fabricated in Supabase.
  for (let attempt = 0; attempt < 2; attempt++) {
    let items = [],
      offset = 0,
      revision = null,
      energies = {};
    while (true) {
      const page = await ai(
        "records",
        "GET",
        undefined,
        `?limit=500&offset=${offset}`,
      );
      if (revision !== null && revision !== page.revision) {
        revision = null;
        break;
      }
      revision = page.revision;
      items.push(...page.items);
      Object.assign(energies, page.meal_energy || {});
      if (page.items.length < 500) break;
      offset += 500;
      if (offset > 50000)
        throw new HTTPError(503, "ข้อมูลมีจำนวนมาก กรุณาติดต่อผู้ดูแล");
    }
    if (revision === null) continue;
    const [summary, plans, tail] = await Promise.all([
      ai("summary"),
      ai("plans"),
      ai("records", "GET", undefined, "?limit=1&offset=0"),
    ]);
    if (tail.revision !== revision) continue;
    check(
      await admin.rpc("dobao_project", {
        p_user: user.id,
        p_revision: revision,
        p_records: items,
        p_summary: summary,
        p_plans: plans.items,
      }),
    );
    return {
      items,
      meal_energy: energies,
      summary,
      plans: plans.items,
      revision,
    };
  }
  throw new HTTPError(409, "ข้อมูลเปลี่ยนระหว่างโหลด กรุณาโหลดอีกครั้ง");
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const url = new URL(req.url, "http://internal");
    const route =
      typeof req.query?.route === "string"
        ? req.query.route
        : url.searchParams.get("route") || url.pathname.replace(/^\/api\//, "");
    const origin = appOrigin();
    if (!["GET", "POST"].includes(req.method))
      throw new HTTPError(405, "ไม่รองรับวิธีทำรายการนี้");
    if (req.method === "POST") assertSameOrigin(req, origin);
    if (route === "config" && req.method === "GET")
      return send(res, 200, {
        authConfigured: supabaseAuthConfigured(),
        authProvider: "supabase",
        supabase: supabaseWebConfig(),
        notice: notice(),
      });
    if (route === "auth/supabase" && req.method === "POST") {
      const body = await bodyOf(req);
      if (body.noticeAcknowledged !== true || !notice().ready)
        throw new HTTPError(
          422,
          "กรุณาอ่านประกาศความเป็นส่วนตัวก่อนเข้าสู่ระบบ",
        );
      const admin = adminClient();
      const { user } = await verifySupabaseToken(bearerToken(req), {
        admin,
        recent: true,
      });
      if (!(await accountForSupabase(admin, user, { register: true })))
        throw new HTTPError(503, "ยังเชื่อมบัญชีไม่สำเร็จ กรุณาลองใหม่");
      return send(res, 200, { ok: true });
    }
    if (route === "auth/logout" && req.method === "POST") {
      res.setHeader(
        "Set-Cookie",
        serialize("dobao-delete-draft", "", {
          httpOnly: true,
          secure: origin.startsWith("https:"),
          sameSite: "strict",
          path: "/",
          maxAge: 0,
        }),
      );
      return send(res, 200, { ok: true }); // SDK signs out locally; no server session exists.
    }
    const token = bearerToken(req);
    if (!token) {
      if (route === "session") return send(res, 200, { user: null });
      throw new HTTPError(401, "กรุณาเข้าสู่ระบบใหม่", "unauthenticated");
    }
    const authAdmin = adminClient();
    const { user: authUser } = await verifySupabaseToken(token, {
      admin: authAdmin,
    });
    const user = await accountForSupabase(authAdmin, authUser);
    if (!user) {
      if (route === "session") return send(res, 200, { user: null });
      throw new HTTPError(
        401,
        "กรุณาอ่านประกาศและเข้าสู่ระบบก่อน",
        "unauthenticated",
      );
    }
    const sb = supabaseFor(token);
    const consent = check(
      await sb
        .from("dobao_consent_events")
        .select("health,ai,notice_version,accepted_at")
        .eq("user_id", user.id)
        .order("id", { ascending: false })
        .limit(1),
    )[0] || { health: false, ai: false };
    if (route === "session" && req.method === "GET") {
      const profile = check(
        await sb
          .from("dobao_profiles")
          .select(profileColumns)
          .eq("user_id", user.id)
          .maybeSingle(),
      );
      return send(res, 200, {
        user: {
          id: user.id,
          email: user.email,
          displayName:
            profile?.display_name ||
            user.user_metadata?.full_name ||
            "ผู้ใช้งาน",
          firstName: profile?.first_name || "",
          lastName: profile?.last_name || "",
          theme: profile?.theme || "mint",
          avatar: profile?.avatar_data_url || null,
          shortcuts: profile?.shortcuts || {},
          profileRevision: profile?.revision || 0,
        },
        consent,
        notice: notice(),
      });
    }
    const inference = [
      "ai/chat",
      "ai/journal/prepare",
      "ai/plans/preview",
      "ai/knowledge",
    ].includes(route);
    const quota = check(
      await sb.rpc("dobao_take_rate", {
        p_bucket: inference ? "ai" : req.method === "POST" ? "write" : "read",
      }),
    );
    if (!quota) {
      res.setHeader("Retry-After", "60");
      throw new HTTPError(429, "ทำรายการถี่เกินไป กรุณารอหนึ่งนาที");
    }
    const body = req.method === "POST" ? await bodyOf(req) : undefined;
    // Contact remains available when health/AI consent is withdrawn.
    if (route === "support")
      return send(res, 200, await supportRequest(sb, user, req.method, body));
    if (route === "support/delete" && req.method === "POST")
      return send(res, 200, await removeSupportRequest(sb, user, body.id));
    if (route === "account/cleanup" && req.method === "GET")
      return send(res, 200, { jobs: await pendingCleanups(sb, user) });
    if (route === "consent" && req.method === "POST") {
      if (
        typeof body.health !== "boolean" ||
        typeof body.ai !== "boolean" ||
        (body.ai && !body.health) ||
        body.version !== notice().version ||
        !notice().ready
      )
        throw new HTTPError(422, "กรุณาตรวจตัวเลือกความยินยอม");
      if (isLocalTestMode())
        await saveLocalTestConsent(adminClient(), user, body);
      else
        check(
          await sb.rpc("dobao_set_consent", {
            p_version: notice().version,
            p_health: body.health,
            p_ai: body.ai,
          }),
        );
      return send(res, 200, { ok: true });
    }
    if (route === "profile" && req.method === "POST") {
      return send(res, 200, {
        profile: await saveProfile(
          sb,
          user,
          body.revision,
          identityPatch(body),
        ),
      });
    }
    if (route === "profile/avatar" && req.method === "POST")
      return send(res, 200, {
        profile: await saveProfile(
          sb,
          user,
          body.revision,
          await avatarPatch(body.image),
        ),
      });
    const healthAllowed =
      consent.health &&
      consent.notice_version === notice().version &&
      notice().ready;
    const deletion =
      route === "ai/records/delete-preview" || route === "ai/confirm";
    const exportRoute = route === "account/export";
    const cleanupRoute = route === "account/cleanup";
    if (!healthAllowed && !deletion && !exportRoute && !cleanupRoute)
      throw new HTTPError(
        403,
        "กรุณาให้ความยินยอมข้อมูลสุขภาพในหน้าบัญชีก่อน",
        "consent_required",
      );
    if (route === "profile/shortcuts" && req.method === "POST")
      return send(res, 200, {
        profile: await saveProfile(
          sb,
          user,
          body.revision,
          shortcutPatch(body.shortcuts),
        ),
      });
    if (route === "daily") {
      const day = req.method === "GET" ? url.searchParams.get("day") : body.day;
      calendarDay(day);
      if (req.method === "GET")
        return send(res, 200, {
          daily: check(
            await sb
              .from("dobao_daily")
              .select("*")
              .eq("user_id", user.id)
              .eq("day", day)
              .maybeSingle(),
          ),
        });
      dailyPayload(body);
      if (isLocalTestMode())
        return send(res, 200, {
          daily: await saveLocalTestDaily(adminClient(), user, body),
        });
      const rows = check(
        await sb.rpc("dobao_save_daily", {
          p_day: day,
          p_water: body.water,
          p_goals: body.goals,
          p_revision: body.revision,
        }),
      );
      return send(res, 200, { daily: rows[0] });
    }
    const ai = createAIClient(user),
      admin = adminClient();
    if (cleanupRoute && req.method === "POST")
      return send(
        res,
        200,
        await retryCleanup(ai, admin, user, boundedString(body.draft_id, 200)),
      );
    if (route === "health/sync" && req.method === "POST")
      return send(res, 200, await snapshot(ai, admin, user));
    if (route === "account/export" && req.method === "GET") {
      const [health, profile, daily, events, cleanupRequests, supportRequests] =
        await Promise.all([
          ai("export"),
          exportRows(sb, "dobao_profiles", user.id, "user_id"),
          exportRows(sb, "dobao_daily", user.id, "day"),
          exportRows(sb, "dobao_consent_events", user.id, "id"),
          exportRows(sb, "dobao_cleanup_jobs", user.id, "draft_id"),
          exportRows(sb, "dobao_support_requests", user.id, "id"),
        ]);
      return send(res, 200, {
        exported_at: new Date().toISOString(),
        health,
        profile,
        daily,
        consents: events,
        cleanup_requests: cleanupRequests,
        support_requests: supportRequests,
      });
    }
    if (!route.startsWith("ai/")) throw new HTTPError(404, "ไม่พบรายการ");
    const path = route.slice(3);
    const generation = [
      "chat",
      "journal/prepare",
      "plans/preview",
      "knowledge",
    ].includes(path);
    if (generation && !consent.ai)
      throw new HTTPError(
        403,
        "กรุณาเลือกอนุญาตให้ Baobuddy ประมวลผลในหน้าบัญชีก่อน",
        "ai_consent_required",
      );
    // No confirmation of old recording/plan drafts after consent withdrawal.
    // Only a signed receipt of this user's deletion preview permits confirmation.
    if (!healthAllowed && path === "confirm") {
      const cookies = parse(req.headers.cookie || "");
      if (
        !verifyDeletionReceipt(
          cookies["dobao-delete-draft"] || "",
          body.draft_id,
          user.id,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
        )
      )
        throw new HTTPError(
          403,
          "อนุญาตเฉพาะการยืนยันลบข้อมูลหลังถอนความยินยอม",
        );
    }
    let lease;
    // The site-wide single slot existed for the one local Mac model. The hosted
    // model (RUAMWAN_AI_ON_CORE) answers many people at once, so no queue.
    if (generation && process.env.RUAMWAN_AI_ON_CORE !== "true") {
      lease = randomUUID();
      if (
        !check(
          await admin.rpc("dobao_acquire_lease", {
            p_slot: "model",
            p_id: lease,
          }),
        )
      ) {
        res.setHeader("Retry-After", "15");
        throw new HTTPError(429, "Baobuddy กำลังตอบคำถามอื่น กรุณารอสักครู่");
      }
    }
    // Manual entry refreshes on its own right after saving, so the server
    // does not repeat the full re-sync for it (that made saving slow).
    const skipSync = path === "confirm" && body?.sync === false;
    if (body && "sync" in body) delete body.sync;
    try {
      if (path === "journal/prepare") body.use_model = true;
      if (path === "confirm") {
        const job = await deletionJob(
          admin,
          user,
          boundedString(body.draft_id, 200),
        );
        if (job)
          return send(
            res,
            200,
            await confirmDeletion(ai, admin, user, body, job),
          );
      }
      let result = await ai(path, req.method, body);
      if (path === "records/delete-preview") {
        result = await registerDeletion(admin, user, result, body);
        const old = res.getHeader("Set-Cookie") || [];
        const receipt = deletionReceipt(
          result.draft_id,
          user.id,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
        );
        res.setHeader("Set-Cookie", [
          ...(Array.isArray(old) ? old : [old]),
          serialize("dobao-delete-draft", receipt, {
            httpOnly: true,
            secure: origin.startsWith("https:"),
            sameSite: "strict",
            path: "/",
            maxAge: 1800,
          }),
        ]);
      }
      if (path === "confirm" && !skipSync) {
        // Never turn a committed AI operation into an apparent failed write.
        // For deletion the UI retains the same confirmation key until cleanup succeeds.
        try {
          if (result.deleted)
            throw new HTTPError(
              503,
              "คำขอลบไม่มีรายการติดตาม กรุณาขอรายการลบใหม่",
            );
          await snapshot(ai, admin, user);
          result.projection_synced = true;
        } catch {
          result.projection_synced = false;
        }
      }
      return send(res, 200, result);
    } finally {
      if (lease) await releaseModelLease(admin, lease);
    }
  } catch (error) {
    const status = error instanceof HTTPError ? error.status : 500;
    return send(res, status, {
      error: {
        code: error.code || "internal_error",
        message:
          error instanceof HTTPError
            ? error.message
            : "ระบบทำรายการไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล",
      },
    });
  }
}
