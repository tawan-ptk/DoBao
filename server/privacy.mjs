import { appOrigin } from "./security.mjs";
export const NOTICE_VERSION = "2026-10-13";
export const LOCAL_TEST_WARNING =
  "โหมดทดสอบในเครื่อง · ใช้ข้อมูลสมมติเท่านั้น ข้อมูลที่ยืนยันจะเก็บจริงในระบบ ประกาศความเป็นส่วนตัวยังไม่สมบูรณ์";
export function privacyContact(env = process.env) {
  return (env.PRIVACY_CONTACT || env.PRIVACY_CONTACT_EMAIL || "").trim();
}
export function validPrivacyContact(env = process.env) {
  if (env.PRIVACY_CONTACT?.trim())
    return (
      env.PRIVACY_CONTACT.trim().length >= 5 &&
      env.PRIVACY_CONTACT.length <= 300
    );
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.PRIVACY_CONTACT_EMAIL || "");
}
let localServer = false;
export function localTestEligible(
  env = process.env,
  { devServer = false } = {},
) {
  if (
    !devServer ||
    env.LOCAL_TEST_MODE !== "true" ||
    env.VERCEL ||
    env.VERCEL_ENV ||
    env.NODE_ENV === "production"
  )
    return false;
  try {
    return ["http://localhost:3000", "http://127.0.0.1:3000"].includes(
      appOrigin(env),
    );
  } catch {
    return false;
  }
}
// Only the loopback dev server calls this; API handlers never accept a client flag.
export function enableLocalTestServer() {
  localServer = true;
}
export function isLocalTestMode(env = process.env) {
  return localTestEligible(env, { devServer: localServer });
}
export function getPrivacyNotice(env = process.env) {
  const testMode = isLocalTestMode(env);
  // An online pilot banner does not bypass the notice/consent readiness checks.
  const pilotMode = env.PUBLIC_PILOT_MODE === "true";
  const productionReady =
    env.PRIVACY_NOTICE_READY === "true" &&
    ["DATA_CONTROLLER", "DATA_RETENTION_NOTICE", "DATA_LOCATION_NOTICE"].every(
      (k) => !!env[k]?.trim(),
    ) &&
    validPrivacyContact(env);
  return {
    // Hosted consent and daily RPCs validate this exact policy version.
    // A release-mode flag must not invent a version the database rejects.
    version: testMode ? `${NOTICE_VERSION}-local-test` : NOTICE_VERSION,
    ready: productionReady || testMode,
    productionReady,
    testMode,
    pilotMode,
    warning: testMode
      ? LOCAL_TEST_WARNING
      : pilotMode
        ? "เปิดทดสอบ DoBao · กรุณาใช้ข้อมูลสมมติเท่านั้น ข้อมูลที่ยืนยันจะถูกเก็บจริงในระบบ"
        : "",
    controller: env.DATA_CONTROLLER || "ยังไม่ได้ระบุผู้ควบคุมข้อมูล",
    contact: privacyContact(env),
    retention:
      env.DATA_RETENTION_NOTICE || "ผู้ดูแลยังไม่ได้กำหนดระยะเวลาเก็บรักษา",
    location:
      env.DATA_LOCATION_NOTICE || "ผู้ดูแลยังไม่ได้ระบุที่ตั้งและการโอนข้อมูล",
  };
}
