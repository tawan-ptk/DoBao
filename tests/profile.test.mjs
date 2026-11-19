import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  identityPatch,
  shortcutPatch,
  avatarPatch,
  saveProfile,
} from "../server/profile.mjs";
import {
  healthProfileRecord,
  manualMealRecord,
  manualActivityRecord,
} from "../profile-data.js";

const values = {
  age: "",
  weight_kg: "",
  height_cm: "",
  conditions: "",
  medications: "",
  preferences: "",
  goals: "",
  mobility_limits: "",
  reported_type2: "",
  pregnant: "",
  complex_care: "",
  allergyStatus: "unknown",
};
test("health profile preserves unknown allergy, explicit none, and supported AI fields", () => {
  const unknown = healthProfileRecord(values);
  assert.equal(unknown.data.allergies, null);
  assert.equal(unknown.data.age, undefined);
  const previous = {
    ...unknown,
    id: "profile-1",
    data: { ...unknown.data, prohibited_catalog_ids: ["example"] },
  };
  const r = healthProfileRecord(
    {
      ...values,
      age: "65",
      conditions: "โรคตัวอย่าง\nโรคตัวอย่าง",
      mobility_limits: "ใช้รถเข็น",
      allergyStatus: "listed",
      allergies: "ถั่ว",
      reported_type2: "true",
    },
    previous,
  );
  assert.equal(r.previous_id, "profile-1");
  assert.deepEqual(r.data.mobility_limits, ["ใช้รถเข็น"]);
  assert.deepEqual(r.data.conditions, ["โรคตัวอย่าง"]);
  assert.deepEqual(r.data.prohibited_catalog_ids, ["example"]);
  assert.equal(r.data.reported_type2, true);
  assert.deepEqual(
    healthProfileRecord({ ...values, allergyStatus: "none" }).data.allergies,
    [],
  );
  assert.throws(() =>
    healthProfileRecord({ ...values, allergyStatus: "listed" }),
  );
  assert.throws(() => healthProfileRecord({ ...values, age: "121" }));
});
test("manual forms do not invent quantities, food state, time or activity duration", () => {
  const meal = manualMealRecord({
    name: "อาหารทดสอบ",
    quantity: "",
    unit: "",
    date: "2026-10-13",
    time: "",
  });
  assert.equal(meal.data.quantity, undefined);
  assert.equal(meal.data.food_state, "unknown");
  assert.equal(meal.data.occurred_at, null);
  const input = {
    name: "กิจกรรมทดสอบ",
    date: "2026-10-13",
    time: "",
    duration: "",
  };
  const activity = manualActivityRecord(input);
  assert.equal(activity.data.start, null);
  assert.equal(activity.data.end, undefined);
  assert.throws(() => manualActivityRecord({ ...input, duration: "15" }));
  const timed = manualActivityRecord({
    ...input,
    time: "23:50",
    duration: "20",
  });
  assert.equal(
    new Date(timed.data.end) - new Date(timed.data.start),
    20 * 60000,
  );
});
test("profile input is bounded and shortcuts allow explicit empty lists", () => {
  assert.throws(() => identityPatch({ displayName: "Test", theme: "unsafe" }));
  assert.throws(() =>
    identityPatch({ displayName: "Test", firstName: "x".repeat(81) }),
  );
  assert.deepEqual(shortcutPatch({ food: [], activity: [] }), {
    shortcuts: { initialized: true, food: [], activity: [] },
  });
  assert.deepEqual(
    shortcutPatch({ food: ["a", "a"], activity: [] }).shortcuts.food,
    ["a"],
  );
  assert.throws(() =>
    shortcutPatch({ food: Array(31).fill("a"), activity: [] }),
  );
});
test("avatar endpoint decodes pixels and stores only normalized private WebP", async () => {
  const image = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#80aa99" },
  })
    .withMetadata()
    .png()
    .toBuffer();
  const saved = await avatarPatch(
    `data:image/png;base64,${image.toString("base64")}`,
  );
  const meta = await sharp(
    Buffer.from(saved.avatar_data_url.split(",")[1], "base64"),
  ).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert.equal(meta.exif, undefined);
  assert.deepEqual(await avatarPatch(null), { avatar_data_url: null });
  await assert.rejects(
    avatarPatch(
      "data:image/png;base64," + Buffer.from("<svg/>").toString("base64"),
    ),
  );
  await assert.rejects(avatarPatch("https://example.com/photo.png"));
  const large = await sharp({
    create: { width: 1100, height: 1100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    avatarPatch(`data:image/png;base64,${large.toString("base64")}`),
  );
});
test("profile updates require owner and revision; stale writes fail closed", async () => {
  const filters = [];
  let updated;
  const query = {
    update(row) {
      updated = row;
      return this;
    },
    eq(...args) {
      filters.push(args);
      return this;
    },
    async select() {
      return { data: [] };
    },
  };
  const sb = {
    from(table) {
      assert.equal(table, "dobao_profiles");
      return query;
    },
  };
  await assert.rejects(
    saveProfile(sb, { id: "owner" }, 2, { theme: "mint" }),
    (e) => e.status === 409,
  );
  assert.deepEqual(filters, [
    ["user_id", "owner"],
    ["revision", 2],
  ]);
  assert.equal(updated.revision, 3);
  await assert.rejects(saveProfile(sb, { id: "owner" }, -1, {}));
});
