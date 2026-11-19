import { HTTPError } from "./security.mjs";

// Validate before either the production RPC or local-test writer is called.
export function jsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HTTPError(400, "ข้อมูล JSON ต้องเป็น object");
  return value;
}
export function calendarDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new HTTPError(422, "วันที่ไม่ถูกต้อง");
  const date = new Date(`${day}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new HTTPError(422, "วันที่ไม่ถูกต้อง");
  return day;
}
export function dailyPayload(body) {
  jsonObject(body);
  calendarDay(body.day);
  if (
    !Number.isInteger(body.water) ||
    body.water < 0 ||
    body.water > 50 ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0 ||
    !Array.isArray(body.goals) ||
    body.goals.length > 20 ||
    body.goals.some(
      (g) =>
        !g ||
        typeof g !== "object" ||
        Array.isArray(g) ||
        typeof g.id !== "string" ||
        !g.id.trim() ||
        g.id.length > 50 ||
        typeof g.label !== "string" ||
        !g.label.trim() ||
        g.label.length > 120 ||
        typeof g.done !== "boolean",
    ) ||
    new Set(body.goals.map((g) => g.id)).size !== body.goals.length
  )
    throw new HTTPError(422, "ข้อมูลเป้าหมายหรือน้ำดื่มไม่ถูกต้อง");
  return body;
}
