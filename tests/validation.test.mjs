import test from "node:test";
import assert from "node:assert/strict";
import {
  jsonObject,
  calendarDay,
  dailyPayload,
} from "../server/validation.mjs";
test("request JSON must be an object and calendar days must really exist", () => {
  for (const value of [null, [], true, 4, "text"])
    assert.throws(() => jsonObject(value), { status: 400 });
  for (const day of ["2026-02-30", "2026-13-01", "not-date", null])
    assert.throws(() => calendarDay(day), { status: 422 });
  assert.equal(calendarDay("2024-02-29"), "2024-02-29");
});
test("daily validation safely rejects null goals, duplicate IDs and invalid values", () => {
  const good = {
    day: "2026-10-13",
    water: 3,
    revision: 0,
    goals: [{ id: "a", label: "Example", done: false }],
  };
  assert.equal(dailyPayload(good), good);
  for (const patch of [
    { goals: [null] },
    { goals: [...good.goals, ...good.goals] },
    { water: 51 },
    { water: 1.2 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { goals: [{ id: "", label: "x", done: false }] },
  ])
    assert.throws(() => dailyPayload({ ...good, ...patch }), { status: 422 });
});
