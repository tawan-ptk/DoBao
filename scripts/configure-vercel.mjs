// Upload only allowlisted configuration; secret values travel over stdin, not argv/logs.
import { spawn } from "node:child_process";
import { loadLocalAISecret } from "../server/local-secrets.mjs";

await loadLocalAISecret();
const names = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RUAMWAN_API_KEY",
  "DATA_CONTROLLER",
  "PRIVACY_CONTACT",
  "DATA_RETENTION_NOTICE",
  "DATA_LOCATION_NOTICE",
];
const values = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
Object.assign(values, {
  APP_ORIGIN: "https://dobaohealth.vercel.app",
  LOCAL_TEST_MODE: "false",
  PRIVACY_NOTICE_READY:
    process.env.PRIVACY_NOTICE_READY === "true" ? "true" : "false",
  RUAMWAN_GATEWAY_URL: process.env.RUAMWAN_GATEWAY_URL,
});
for (const name of ["AI_GATEWAY_CLIENT_ID", "AI_GATEWAY_CLIENT_SECRET"])
  if (process.env[name]) values[name] = process.env[name];
// Operator approved this wording for the synthetic-data pilot on 2026-10-13.
const pilotNotice = {
  PUBLIC_PILOT_MODE: "true",
  PRIVACY_NOTICE_READY: "true",
  DATA_RETENTION_NOTICE:
    "ข้อมูลสุขภาพเก็บจนผู้ใช้ลบ บัญชีและประวัติความยินยอมยังเก็บต่อและไม่มีการลบอัตโนมัติ หากต้องการลบให้ติดต่อทีม DoBao ผ่านเว็บ ส่วนสำเนาสำรองไม่ได้ถูกลบทันทีพร้อมข้อมูลหลัก และทีมยังไม่ได้กำหนดรอบลบสำรอง",
  DATA_LOCATION_NOTICE:
    "ฐานข้อมูลหลัก (รวมบันทึกสุขภาพทั้งหมด) และ API ของเว็บไซต์: Supabase สิงคโปร์ การประมวลผล AI: เครื่อง Mac ในประเทศไทย (ไม่เก็บบันทึกสุขภาพในเครื่อง) การให้บริการหน้าเว็บ การยืนยันตัวตน และการส่งต่อข้อมูลใช้ผู้ให้บริการคลาวด์ซึ่งอาจประมวลผลในประเทศอื่น",
};
if (process.argv.includes("--pilot-notice")) Object.assign(values, pilotNotice);
for (const [name, value] of Object.entries(values)) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing ${name}`);
}
if (!values.RUAMWAN_GATEWAY_URL.startsWith("https://"))
  throw new Error("HTTPS gateway required");
if (!process.argv.includes("--apply")) {
  console.log(
    `Validated ${Object.keys(values).length} variable names. Use --apply to upload.`,
  );
  process.exit(0);
}
for (const [name, value] of Object.entries(values)) {
  if (process.argv.includes("--pilot-notice") && !(name in pilotNotice))
    continue;
  const args = ["env", "add", name, "production"];
  if (process.argv.includes("--pilot-notice")) args.push("--force");
  if (
    /SERVICE_ROLE_KEY|RUAMWAN_API_KEY|CLIENT_SECRET/.test(
      name,
    )
  )
    args.push("--sensitive");
  const code = await new Promise((resolve) => {
    // Suppress CLI output defensively; show only each variable's name/status.
    const child = spawn("vercel", args, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => resolve(-1));
    child.on("close", resolve);
    child.stdin.on("error", () => {});
    child.stdin.end(value.trim());
  });
  if (code !== 0)
    throw new Error(
      `Upload failed for ${name}; no existing value was overwritten.`,
    );
  console.log(`Configured ${name}`);
}
