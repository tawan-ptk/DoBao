// Confirms only synthetic records for a fresh random owner, then removes them.
// Run: node --env-file-if-exists=.env.local scripts/test-profile-ai.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadLocalAISecret } from "../server/local-secrets.mjs";
import { createAIClient } from "../server/ai.mjs";
import { healthProfileRecord } from "../profile-data.js";
await loadLocalAISecret();
const owner = randomUUID(),
  api = createAIClient({ id: owner });
let touched = false,
  phase = "start",
  failed = false;
const values = {
  age: "65",
  weight_kg: "60",
  height_cm: "160",
  conditions: "ภาวะทดสอบ",
  medications: "ยาสมมติ",
  allergyStatus: "listed",
  allergies: "ถั่ว",
  mobility_limits: "ใช้รถเข็น",
  preferences: "อาหารรสอ่อน",
  goals: "เป้าหมายทดสอบ",
  reported_type2: "true",
  pregnant: "false",
  complex_care: "false",
};
async function confirm(records) {
  const draft = await api("records/batch-preview", "POST", {
    records,
    compact: true,
  });
  assert.equal(draft.can_confirm, true);
  assert.equal(draft.requires_consent, false);
  touched = true;
  return api("confirm", "POST", {
    draft_id: draft.draft_id,
    idempotency_key: randomUUID(),
    confirmed: true,
  });
}
try {
  phase = "save synthetic profile";
  await confirm([
    {
      kind: "consent",
      data: { local_storage: true },
      source: "Synthetic integration test",
    },
    healthProfileRecord(values),
  ]);
  phase = "read actual AI personal context";
  const context = await api("personal-context");
  assert.equal(context.profile.age, 65);
  for (const key of [
    "conditions",
    "medications",
    "allergies",
    "mobility_limits",
    "preferences",
    "goals",
  ])
    assert.deepEqual(
      context.profile[key],
      healthProfileRecord(values).data[key],
    );
  assert.ok(context.source_record_ids.age);
  console.log(
    "PASS confirmed profile reaches live AI context with allergies, conditions, medicines and mobility limits",
  );
  const previous = (await api("records")).items.find(
    (r) => r.kind === "profile",
  );
  phase = "edit synthetic profile";
  await confirm([
    healthProfileRecord(
      {
        ...values,
        age: "66",
        allergyStatus: "none",
        mobility_limits: "ข้อจำกัดทดสอบที่แก้ไข",
      },
      previous,
    ),
  ]);
  const updated = await api("personal-context");
  assert.equal(updated.profile.age, 66);
  assert.deepEqual(updated.profile.allergies, []);
  assert.deepEqual(updated.profile.mobility_limits, ["ข้อจำกัดทดสอบที่แก้ไข"]);
  assert.equal(
    (await api("records")).items.filter((r) => r.kind === "profile").length,
    1,
  );
  console.log(
    "PASS edited profile supersedes previous version and changes AI context",
  );
} catch (e) {
  failed = true;
  console.error(
    `FAIL ${phase}: ${Number.isInteger(e.status) ? `HTTP ${e.status}` : "assertion or connection failed"}`,
  );
} finally {
  if (touched) {
    try {
      const draft = await api("records/delete-preview", "POST", {
        scope: "all",
        record_ids: [],
      });
      if (draft.can_confirm)
        await api("confirm", "POST", {
          draft_id: draft.draft_id,
          idempotency_key: randomUUID(),
          confirmed: true,
        });
      assert.equal(
        (
          await api(
            "records",
            "GET",
            undefined,
            "?limit=100&offset=0&history=true",
          )
        ).items.length,
        0,
      );
      console.log(
        "PASS removed all synthetic profile/consent versions for test owner",
      );
    } catch {
      failed = true;
      console.error(
        "Cleanup incomplete; inspect ONLY synthetic owner:",
        `dobao:${owner}`,
      );
    }
  }
}
process.exitCode = failed ? 1 : 0;
