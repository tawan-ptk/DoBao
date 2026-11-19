import { HTTPError, stableAIUser } from "./security.mjs";
import { isLocalTestMode, getPrivacyNotice } from "./privacy.mjs";
function gate(user) {
  if (!isLocalTestMode())
    throw new HTTPError(
      403,
      "ไม่อนุญาตการเขียนข้อมูลแบบทดสอบนอก local dev server",
    );
  stableAIUser(user);
}
function check(result) {
  if (result.error)
    throw new HTTPError(
      result.error.code === "23505" ? 409 : 503,
      result.error.code === "23505"
        ? "ข้อมูลเปลี่ยนจากอุปกรณ์อื่น กรุณาโหลดใหม่"
        : "บันทึกข้อมูลทดสอบไม่สำเร็จ กรุณาตรวจ Supabase",
    );
  return result.data;
}
export async function saveLocalTestConsent(admin, user, { health, ai }) {
  gate(user);
  if (typeof health !== "boolean" || typeof ai !== "boolean" || (ai && !health))
    throw new HTTPError(422, "ตัวเลือกทดสอบไม่ถูกต้อง");
  check(
    await admin
      .from("dobao_consent_events")
      .insert({
        user_id: user.id,
        notice_version: getPrivacyNotice().version,
        health,
        ai,
      }),
  );
}
export async function saveLocalTestDaily(admin, user, body) {
  gate(user);
  // Only called after the handler's authenticated consent + payload checks.
  // Production keeps the native RLS RPC; this branch accepts a distinct test notice.
  const row = {
    user_id: user.id,
    day: body.day,
    water: body.water,
    goals: body.goals,
    revision: body.revision + 1,
    updated_at: new Date().toISOString(),
  };
  const query =
    body.revision === 0
      ? admin.from("dobao_daily").insert(row)
      : admin
          .from("dobao_daily")
          .update({
            water: row.water,
            goals: row.goals,
            revision: row.revision,
            updated_at: row.updated_at,
          })
          .eq("user_id", user.id)
          .eq("day", body.day)
          .eq("revision", body.revision);
  const rows = check(await query.select());
  if (rows.length !== 1)
    throw new HTTPError(409, "ข้อมูลเปลี่ยนจากอุปกรณ์อื่น กรุณาโหลดใหม่");
  return rows[0];
}
