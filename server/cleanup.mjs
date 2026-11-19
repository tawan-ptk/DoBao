import { HTTPError } from "./security.mjs";
import { randomUUID } from "node:crypto";
const columns =
  "user_id,draft_id,scope,record_ids,counts,source_revision,request_key,phase,requested_at,source_result";
function check(r) {
  if (r.error)
    throw new HTTPError(
      r.error.message?.includes("cleanup_key_conflict") ? 409 : 503,
      r.error.message?.includes("cleanup_key_conflict")
        ? "รหัสยืนยันไม่ตรงกับคำขอเดิม"
        : "ยังติดต่อระบบติดตามการลบไม่ได้ กรุณาตรวจ migration 004 หรือโหลดใหม่",
      "cleanup_unavailable",
    );
  return r.data;
}
export async function registerDeletion(admin, user, preview, body) {
  // The AI owns records; Supabase independently owns water/goals. If the AI has
  // nothing to delete, create a server-only preview for these daily rows instead
  // of overriding the AI's can_confirm=false or sending it a forced confirm.
  let dailyCount = 0;
  if (body.scope === "all") {
    const count = await admin
      .from("dobao_daily")
      .select("day", { count: "exact", head: true })
      .eq("user_id", user.id);
    check(count);
    dailyCount = count.count || 0;
  }
  const dailyOnly =
    body.scope === "all" &&
    !preview.can_confirm &&
    dailyCount > 0 &&
    preview.history_count === 0 &&
    preview.plan_count === 0;
  if (dailyOnly)
    preview = {
      ...preview,
      draft_id: `daily-${randomUUID()}`,
      can_confirm: true,
    };
  preview = { ...preview, daily_count: dailyCount };
  check(
    await admin
      .from("dobao_cleanup_jobs")
      .insert({
        user_id: user.id,
        draft_id: preview.draft_id,
        scope: body.scope,
        record_ids: body.record_ids || [],
        source_revision: preview.input_revision,
        counts: {
          count: preview.count,
          history_count: preview.history_count,
          plan_count: preview.plan_count,
          daily_count: dailyCount,
          daily_only: dailyOnly,
        },
      }),
  );
  return preview;
}
export async function pendingCleanups(admin, user) {
  return check(
    await admin
      .from("dobao_cleanup_jobs")
      .select("draft_id,scope,phase,requested_at")
      .eq("user_id", user.id)
      .in("phase", ["uncertain", "cleanup"])
      .order("requested_at"),
  );
}
export async function deletionJob(admin, user, draft) {
  return check(
    await admin
      .from("dobao_cleanup_jobs")
      .select(columns)
      .eq("user_id", user.id)
      .eq("draft_id", draft)
      .maybeSingle(),
  );
}
function resultMetadata(result) {
  // Never retain the deleted payload, labels or conversation as a cleanup receipt.
  return Object.fromEntries(
    [
      "deleted",
      "scope",
      "count",
      "history_count",
      "plan_count",
      "daily_count",
      "revision",
      "recovered",
    ]
      .filter((k) => k in result)
      .map((k) => [k, result[k]]),
  );
}
async function finish(admin, user, job, result) {
  try {
    if (job.phase !== "complete") {
      check(
        await admin
          .from("dobao_cleanup_jobs")
          .update({
            phase: "cleanup",
            source_result: resultMetadata(result),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id)
          .eq("draft_id", job.draft_id)
          .eq("request_key", job.request_key),
      );
      check(
        await admin.rpc("dobao_finish_cleanup", {
          p_user: user.id,
          p_draft: job.draft_id,
          p_key: job.request_key,
        }),
      );
    }
    return { ...result, projection_synced: true, cleanup_pending: false };
  } catch {
    return { ...result, projection_synced: false, cleanup_pending: true };
  }
}
export async function confirmDeletion(ai, admin, user, body, job) {
  if (
    body.confirmed !== true ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      body.idempotency_key || "",
    )
  )
    throw new HTTPError(422, "กรุณายืนยันด้วยรหัสรายการเดิม");
  const rows = check(
    await admin.rpc("dobao_begin_cleanup", {
      p_user: user.id,
      p_draft: job.draft_id,
      p_key: body.idempotency_key,
    }),
  );
  job = rows[0];
  if (!job) throw new HTTPError(503, "ยังอ่านสถานะคำขอลบไม่ได้");
  if (job.phase === "complete")
    return {
      ...job.source_result,
      projection_synced: true,
      cleanup_pending: false,
    };
  if (job.source_result?.deleted)
    return finish(admin, user, job, job.source_result);
  if (job.counts.daily_only) {
    // Recheck the original AI revision; never silently delete a newly added record.
    const history = await ai(
      "records",
      "GET",
      undefined,
      "?limit=1&offset=0&history=true",
    );
    const plans = await ai("plans");
    const tail = await ai(
      "records",
      "GET",
      undefined,
      "?limit=1&offset=0&history=true",
    );
    if (
      history.items.length ||
      plans.items.length ||
      tail.items.length ||
      history.revision !== job.source_revision ||
      tail.revision !== job.source_revision
    )
      throw new HTTPError(
        409,
        "ข้อมูลต้นฉบับเปลี่ยนแล้ว กรุณาตรวจรายการก่อนขอลบใหม่",
        "cleanup_needs_review",
      );
    return finish(admin, user, job, {
      deleted: true,
      scope: "all",
      count: 0,
      history_count: 0,
      plan_count: 0,
      daily_count: job.counts.daily_count,
      revision: job.source_revision,
    });
  }
  const result = await ai("confirm", "POST", body);
  if (result.deleted !== true || result.scope !== job.scope)
    throw new HTTPError(502, "บริการต้นฉบับยังไม่ยืนยันผลการลบ");
  return finish(admin, user, job, result);
}
// This runs only after the user presses retry. It NEVER sends a new confirmation.
export async function retryCleanup(ai, admin, user, draft) {
  const job = await deletionJob(admin, user, draft);
  if (!job || !job.request_key || job.phase === "preview")
    throw new HTTPError(404, "ไม่พบคำขอลบที่คุณเคยยืนยัน");
  if (job.phase === "complete")
    return {
      ...job.source_result,
      projection_synced: true,
      cleanup_pending: false,
    };
  if (job.source_result?.deleted)
    return finish(admin, user, job, job.source_result);
  try {
    return await confirmDeletion(
      ai,
      admin,
      user,
      {
        draft_id: job.draft_id,
        idempotency_key: job.request_key,
        confirmed: true,
      },
      job,
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    // After an upstream restart/expired draft, verify deletion using full history.
    // Checking current records alone would mistake an edit for deletion.
    const removed = new Set(job.record_ids),
      history = [];
    let revision = null;
    for (let offset = 0; offset <= 50000; offset += 500) {
      const page = await ai(
        "records",
        "GET",
        undefined,
        `?limit=500&offset=${offset}&history=true`,
      );
      if (revision !== null && revision !== page.revision)
        throw new HTTPError(409, "ข้อมูลเปลี่ยนระหว่างตรวจผล กรุณาลองใหม่");
      revision = page.revision;
      history.push(...page.items);
      if (page.items.length < 500) break;
      if (offset === 50000)
        throw new HTTPError(
          503,
          "ข้อมูลมาก กรุณาติดต่อผู้ดูแลเพื่อตรวจผลการลบ",
        );
    }
    const plans = job.scope === "all" ? await ai("plans") : null;
    const tail = await ai(
      "records",
      "GET",
      undefined,
      "?limit=1&offset=0&history=true",
    );
    if (tail.revision !== revision)
      throw new HTTPError(409, "ข้อมูลเปลี่ยนระหว่างตรวจผล กรุณาลองใหม่");
    const removedFromHistory =
      job.scope === "all"
        ? history.length === 0 && plans.items.length === 0
        : removed.size > 0 && !history.some((r) => removed.has(r.id));
    if (
      !Number.isInteger(revision) ||
      revision <= job.source_revision ||
      !removedFromHistory
    )
      throw new HTTPError(
        409,
        "ร่างหมดอายุและยังยืนยันว่าลบครบไม่ได้ กรุณาตรวจประวัติหรือติดต่อผู้ดูแล ไม่สร้างคำขอใหม่อัตโนมัติ",
        "cleanup_needs_review",
      );
    return finish(admin, user, job, {
      deleted: true,
      scope: job.scope,
      ...job.counts,
      revision,
      recovered: true,
    });
  }
}
