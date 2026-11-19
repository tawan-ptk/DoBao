import { HTTPError, boundedString } from "./security.mjs";
export const supportColumns =
  "id,topic,message,status,reply,created_at,answered_at";
export async function supportRequest(sb, user, method, body) {
  let result;
  if (method === "GET")
    result = await sb
      .from("dobao_support_requests")
      .select(supportColumns)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);
  else
    result = await sb
      .from("dobao_support_requests")
      .insert({
        user_id: user.id,
        topic: boundedString(body.topic, 120),
        message: boundedString(body.message, 2000),
      })
      .select(supportColumns);
  if (result.error)
    throw new HTTPError(503, "ยังติดต่อทีมผ่านระบบไม่ได้ กรุณาลองใหม่ภายหลัง");
  return { items: result.data };
}
export async function removeSupportRequest(sb, user, id) {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
  )
    throw new HTTPError(422, "รหัสข้อความไม่ถูกต้อง");
  const result = await sb
    .from("dobao_support_requests")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id)
    .select("id");
  if (result.error) throw new HTTPError(503, "ยังลบข้อความไม่ได้ กรุณาลองใหม่");
  if (!result.data?.length) throw new HTTPError(404, "ไม่พบข้อความของบัญชีนี้");
  return { deleted: true };
}
