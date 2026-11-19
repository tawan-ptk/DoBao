// Uses only synthetic, unconfirmed inputs in a unique test owner. No health write.
// Run on the Mac: node scripts/smoke-ai.mjs
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createAIClient } from "../server/ai.mjs";
const key =
  process.env.RUAMWAN_API_KEY ||
  (await readFile("/Users/tawan/aimuge/.secrets/api-key", "utf8")).trim();
const env = { RUAMWAN_API_KEY: key, RUAMWAN_BASE_URL: "http://127.0.0.1:8765" };
const a = createAIClient({ id: randomUUID() }, { env }),
  b = createAIClient({ id: randomUUID() }, { env });
const captured_at = "2026-10-13T00:02:59+07:00";
const cases = [
  [
    "กินข้าว",
    (r) => {
      assert.equal(r.items[0].record.journal.clock_source, "capture_time");
      assert.equal(r.items[0].record.journal.clock, "00:02:00");
    },
  ],
  [
    "ตอนเช้ากินข้าว",
    (r) => {
      assert.equal(r.items[0].record.journal.period, "morning");
      assert.equal(r.items[0].record.journal.clock, null);
    },
  ],
  [
    "เดิน 16.00",
    (r) => {
      assert.equal(r.items[0].record.journal.clock, "16:00:00");
      assert.ok(!r.items[0].record.data.end);
    },
  ],
  [
    "กินข้าวกับไข่พะโล้",
    (r) => {
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].record.data.components.length, 2);
    },
  ],
];
let records;
for (const [text, check] of cases) {
  const r = await a("journal/prepare", "POST", {
    text,
    captured_at,
    compact: true,
    use_model: false,
  });
  check(r);
  records = r.items.map((i) => i.record);
  console.log("PASS journal:", text);
}
const preview = await a("records/batch-preview", "POST", {
  records,
  compact: true,
});
assert.equal(preview.requires_consent, true);
assert.ok(preview.draft_id);
await assert.rejects(
  b("confirm", "POST", {
    draft_id: preview.draft_id,
    idempotency_key: randomUUID(),
    confirmed: true,
  }),
  (e) => e.status === 404,
);
console.log("PASS owner B cannot confirm owner A draft");
const help = await a("chat", "POST", {
  messages: [{ role: "user", content: "ใช้งานยังไง" }],
  scope: "auto",
  captured_at,
});
assert.ok(help.answer);
assert.equal(help.status, "usage_help");
console.log("PASS live API usage response");
const recall = await a("chat", "POST", {
  messages: [{ role: "user", content: "วันนี้กินอะไรไปบ้าง" }],
  scope: "auto",
  captured_at,
});
assert.ok(["no_records", "answered_from_records"].includes(recall.status));
assert.equal((await a("records")).items.length, 0);
console.log("PASS preview/help/recall did not write records");
const energy = await a("food-energy", "POST", {
  name: "รายการอาหารที่ไม่อยู่ในฐานอ้างอิง-ทดสอบ",
});
assert.equal(energy.kcal, null);
console.log("PASS unknown energy is null");
console.log(
  "Live software smoke passed. This does not verify Google OAuth, Supabase RLS, or clinical accuracy.",
);
