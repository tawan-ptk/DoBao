// Read-only diagnostics. Never prints env values, tokens or upstream error bodies.
import { loadLocalAISecret } from "../server/local-secrets.mjs";
import {
  checkConfiguration,
  checkConnections,
} from "../server/setup-check.mjs";
const production = process.argv.includes("--production");
const offline = process.argv.includes("--offline");
try {
  if (!production) await loadLocalAISecret();
  const results = [
    ...checkConfiguration(process.env, { production }),
    ...(offline ? [] : await checkConnections(process.env, { production })),
  ];
  for (const result of results)
    console.log(`${result.status} ${result.key}: ${result.detail}`);
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  const testing = results.some((r) => r.key === "LOCAL_TEST_MODE");
  console.log(
    blocked
      ? `\nยังติด ${blocked} รายการ ดู docs/DEPLOYMENT.md`
      : testing
        ? "\nพร้อมเริ่มทดสอบในเครื่องด้วยข้อมูลสมมติ: npm run dev (ยังไม่พร้อม production/ข้อมูลผู้ป่วยจริง)"
        : "\nการตรวจที่รันผ่านแล้ว; ยังต้องทดสอบ OAuth, RLS สองบัญชี และตรวจประกาศก่อนเปิดรับผู้ใช้",
  );
  if (offline)
    console.log("Offline: ยังไม่ได้ตรวจ Google/ตาราง/AI ผ่านเครือข่าย");
  process.exitCode = blocked ? 1 : 0;
} catch (error) {
  // loadLocalAISecret only emits fixed, sanitized error messages.
  console.error(error.message);
  process.exitCode = 1;
}
