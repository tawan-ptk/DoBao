import test from "node:test";
import assert from "node:assert/strict";
import {
  bangkokParts,
  newRecord,
  applyJournalTime,
  recordFromStored,
  measurementGroups,
  energyText,
  safeSourceUrl,
} from "../client-data.js";
test("Bangkok date survives midnight and editing preserves capture time", () => {
  const captured = "2026-10-12T17:02:59Z",
    r = newRecord("meal", captured);
  assert.equal(r.journal.date, "2026-10-13");
  assert.equal(r.journal.clock_source, "capture_time");
  applyJournalTime(r, "2026-10-14", "16:00", "afternoon", true);
  assert.equal(r.journal.captured_at, captured);
  assert.equal(r.data.occurred_at, "2026-10-14T16:00:00+07:00");
  assert.equal(r.journal.clock_source, "user_edited");
  applyJournalTime(r, "2026-10-14", "", "morning", true);
  assert.equal(r.data.occurred_at, null);
  assert.equal(r.journal.clock, null);
  assert.deepEqual(bangkokParts(captured), {
    date: "2026-10-13",
    clock: "00:02",
  });
});
test("editing strips server-only metadata and retains components and unknowns", () => {
  const row = {
    ...newRecord("meal"),
    id: "server-id",
    version: 3,
    status: "user_confirmed",
    created_at: "now",
  };
  row.data.components = [
    { name: "ข้าว", quantity: null, unit: null },
    { name: "ไข่พะโล้", quantity: 1, unit: "ส่วน" },
  ];
  const r = recordFromStored(row);
  assert.equal(r.id, undefined);
  assert.equal(r.version, undefined);
  assert.equal(r.data.components.length, 2);
  assert.equal(r.data.components[0].quantity, null);
});
test("only comparable glucose observations share a line", () => {
  const row = (context, unit = "mg/dL", method = "measured") => ({
    kind: "measurement",
    origin: "measured",
    data: {
      name: "glucose",
      value: 125,
      unit,
      method,
      context,
      occurred_at: "2026-10-13T08:00:00+07:00",
    },
  });
  const groups = measurementGroups([
    row("fasting"),
    row("after_meal"),
    row("unknown"),
    row("fasting", "mmol/L"),
    row("fasting", "mg/dL", "device_estimate"),
  ]);
  assert.equal(groups.size, 3);
});
test("missing/partial calories and citations stay honest", () => {
  assert.match(energyText({ kcal: null }), /ยังประเมิน/);
  assert.match(
    energyText({ kcal: [100, 120], status: "partial", assumed_portion: true }),
    /ยังรวมไม่ครบ/,
  );
  assert.equal(safeSourceUrl("javascript:alert(1)"), null);
  assert.equal(safeSourceUrl("https://user:pass@example.com"), null);
  assert.equal(
    safeSourceUrl("https://www.niddk.nih.gov/health-information"),
    "https://www.niddk.nih.gov/health-information",
  );
});
