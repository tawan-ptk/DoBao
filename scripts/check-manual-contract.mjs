// Synthetic preview only. Never confirms or writes health records.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadLocalAISecret } from "../server/local-secrets.mjs";
import { createAIClient } from "../server/ai.mjs";
import {
  healthProfileRecord,
  manualMealRecord,
  manualActivityRecord,
} from "../profile-data.js";
try {
  await loadLocalAISecret();
  const api = createAIClient({ id: randomUUID() });
  // Same extraction request used by the chat-first UI; no confirmation here.
  for (const text of ["ตอนเช้ากินข้าวกับไข่ต้ม", "ข้าวกับไข่ต้ม"]) {
    const result = await api("journal/prepare", "POST", {
      text,
      captured_at: new Date().toISOString(),
      compact: true,
      use_model: true,
    });
    assert.ok(result.items?.length);
    const records = result.items.map((i) => i.record);
    assert.equal(records[0].kind, "meal");
    for (const record of records) {
      assert.ok(record.data.quantity == null);
      for (const component of record.data.components || [])
        assert.ok(component.quantity == null);
    }
    const preview = await api("records/batch-preview", "POST", {
      records,
      compact: true,
    });
    assert.equal(preview.can_confirm, true);
  }
  console.log(
    "PASS chat capture: sentence and food name accepted without inventing quantities",
  );
  const profile = healthProfileRecord({
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
    pregnant: "",
    complex_care: "",
  });
  const meal = manualMealRecord({
    name: "อาหารทดสอบ",
    date: "2026-10-13",
    time: "",
    quantity: "",
    unit: "",
  });
  const activity = manualActivityRecord({
    name: "กิจกรรมทดสอบ",
    date: "2026-10-13",
    time: "16:00",
    duration: "15",
  });
  for (const record of [profile, meal, activity]) {
    const r = await api("records/batch-preview", "POST", {
      records: [
        {
          kind: "consent",
          data: { local_storage: true },
          source: "Synthetic contract preview only",
        },
        record,
      ],
      compact: true,
    });
    assert.equal(r.can_confirm, true, `${record.kind} validation failed`);
    assert.equal(r.requires_consent, false);
    console.log(
      `PASS manual ${record.kind}: accepted by live schema without model generation`,
    );
  }
  assert.equal((await api("records")).items.length, 0);
  console.log("PASS previews did not persist health records");
} catch (e) {
  console.error(
    `FAIL manual contract: ${Number.isInteger(e.status) ? `HTTP ${e.status}` : "validation or connection failed"}`,
  );
  process.exitCode = 1;
}
