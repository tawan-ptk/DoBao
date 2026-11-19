import { createHmac, timingSafeEqual } from "node:crypto";
export class HTTPError extends Error {
  constructor(status, message, code = "request_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function appOrigin(env = process.env) {
  if (!env.APP_ORIGIN)
    throw new HTTPError(
      503,
      "ผู้ดูแลยังไม่ได้ตั้งค่าที่อยู่เว็บไซต์",
      "not_configured",
    );
  const url = new URL(env.APP_ORIGIN);
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new HTTPError(503, "การตั้งค่าเว็บไซต์ไม่ถูกต้อง");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new HTTPError(503, "เว็บไซต์ต้องใช้ HTTPS");
  return url.origin;
}
export function assertSameOrigin(req, origin) {
  if (req.headers.origin !== origin || req.headers["x-dobao-request"] !== "1")
    throw new HTTPError(
      403,
      "กรุณาทำรายการจากหน้า DoBao โดยตรง",
      "invalid_origin",
    );
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(site))
    throw new HTTPError(403, "ไม่อนุญาตคำขอข้ามเว็บไซต์");
}
export function gatewayUrl(value, production = false) {
  const url = new URL(value || "http://127.0.0.1:8765");
  const loopback = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (!loopback && url.protocol !== "https:") ||
    (production && loopback)
  )
    throw new HTTPError(
      503,
      "ยังไม่ได้ตั้งค่า AI gateway แบบ HTTPS สำหรับเว็บไซต์นี้",
      "ai_not_configured",
    );
  if (!["http:", "https:"].includes(url.protocol))
    throw new HTTPError(503, "ที่อยู่บริการ AI ไม่ถูกต้อง");
  return url.origin;
}
// Accept the gateway variable supplied by the AI service while retaining the
// original base URL for local setups and existing Vercel configuration.
export function aiGatewayValue(env = process.env) {
  return env.RUAMWAN_GATEWAY_URL?.trim() || env.RUAMWAN_BASE_URL;
}
const getPaths = new Set([
  "records",
  "summary",
  "personal-context",
  "food-catalog",
  "plans",
  "export",
  "readiness",
]);
const postPaths = new Set([
  "chat",
  "journal/prepare",
  "records/batch-preview",
  "records/preview",
  "records/delete-preview",
  "confirm",
  "plans/preview",
  "food-energy",
  "knowledge",
]);
export function assertAIPath(path, method) {
  if (
    !(method === "GET"
      ? getPaths.has(path) || /^plans\/[A-Za-z0-9_-]+\/recheck$/.test(path)
      : method === "POST" && postPaths.has(path))
  )
    throw new HTTPError(404, "ไม่พบการทำรายการนี้");
}
export function stableAIUser(user) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      user?.id || "",
    )
  )
    throw new HTTPError(401, "กรุณาเข้าสู่ระบบใหม่");
  return `dobao:${user.id}`;
}
export function boundedString(value, max = 200, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    value.length > max
  )
    throw new HTTPError(422, "ข้อมูลข้อความไม่ถูกต้อง");
  return value.trim();
}

// Owner-bound, signed receipt only authorizes deletion after consent withdrawal.
export function deletionReceipt(draftId, userId, secret, now = Date.now()) {
  const value = Buffer.from(
    JSON.stringify({ draftId, userId, expires: now + 1800000 }),
  ).toString("base64url");
  return `${value}.${createHmac("sha256", secret).update(value).digest("base64url")}`;
}
export function verifyDeletionReceipt(
  receipt,
  draftId,
  userId,
  secret,
  now = Date.now(),
) {
  try {
    const [value, signature, ...extra] = receipt.split(".");
    if (extra.length) return false;
    const expected = createHmac("sha256", secret).update(value).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return false;
    const data = JSON.parse(Buffer.from(value, "base64url").toString());
    return (
      data.draftId === draftId && data.userId === userId && data.expires > now
    );
  } catch {
    return false;
  }
}
