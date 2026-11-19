import {
  newRecord,
  recordFromStored,
  applyJournalTime,
  bangkokParts,
} from "./client-data.js";

// The names here match aimuge/services/schemas.py Profile exactly.
export const healthProfileFields = {
  age: "อายุ",
  weight_kg: "น้ำหนัก (กก.)",
  height_cm: "ส่วนสูง (ซม.)",
  conditions: "โรคประจำตัว / ภาวะสุขภาพ",
  medications: "ยาประจำ",
  allergies: "สิ่งที่แพ้",
  mobility_limits: "ความพิการ / ข้อจำกัดในการทำกิจกรรม",
  preferences: "ความชอบด้านอาหาร",
  goals: "เป้าหมาย",
  reported_type2: "ได้รับแจ้งว่าเป็นเบาหวานชนิดที่ 2",
  pregnant: "การตั้งครรภ์",
  complex_care: "การดูแลเป็นพิเศษ",
};
export const defaultShortcuts = {
  food: ["ข้าวกล้องกับกับข้าว", "ต้มจืดเต้าหู้", "ผลไม้"],
  activity: ["เดิน", "ยืดกล้ามเนื้อ", "ทำสวน"],
};
export function splitProfileList(value) {
  const entries = [
    ...new Set(
      String(value || "")
        .split(/[\n,]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (entries.length > 30 || entries.some((v) => v.length > 200))
    throw new Error(
      "กรอกได้ไม่เกิน 30 รายการต่อช่อง และไม่เกิน 200 ตัวอักษรต่อรายการ",
    );
  return entries;
}
export function healthProfileRecord(values, previous) {
  const r = previous
    ? { ...recordFromStored(previous), previous_id: previous.id }
    : newRecord("profile");
  r.evidence = {};
  r.text = "ข้อมูลประกอบการดูแลที่ผู้ใช้กรอกและตรวจยืนยัน";
  r.data = { ...r.data, timezone: "Asia/Bangkok" };
  for (const key of ["age", "weight_kg", "height_cm"]) {
    if (values[key] === "") delete r.data[key];
    else {
      const value = Number(values[key]);
      const max = { age: 120, weight_kg: 500, height_cm: 260 }[key];
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        value > max ||
        (key === "age" && !Number.isInteger(value))
      )
        throw new Error(`กรุณาตรวจ${healthProfileFields[key]}`);
      r.data[key] = value;
    }
  }
  for (const key of [
    "conditions",
    "medications",
    "preferences",
    "goals",
    "mobility_limits",
  ])
    r.data[key] = splitProfileList(values[key]);
  r.data.allergies =
    values.allergyStatus === "none"
      ? []
      : values.allergyStatus === "listed"
        ? splitProfileList(values.allergies)
        : null;
  if (values.allergyStatus === "listed" && !r.data.allergies.length)
    throw new Error("กรุณาระบุสิ่งที่แพ้ หรือเลือก “ยังไม่ทราบ”");
  for (const key of ["reported_type2", "pregnant", "complex_care"]) {
    if (values[key] === "") delete r.data[key];
    else r.data[key] = values[key] === "true";
  }
  return r;
}
export function manualMealRecord(values, captured = new Date().toISOString()) {
  const r = newRecord("meal", captured),
    name = values.name.trim();
  if (!name) throw new Error("กรุณาพิมพ์ชื่ออาหาร");
  r.text = name;
  r.data = { name, food_state: values.foodState || "unknown" };
  if (values.quantity !== "") r.data.quantity = Number(values.quantity);
  if (values.unit?.trim()) r.data.unit = values.unit.trim();
  applyJournalTime(
    r,
    values.date || bangkokParts(captured).date,
    values.time || "",
    values.period || "unspecified",
    true,
  );
  return r;
}
export function manualActivityRecord(
  values,
  captured = new Date().toISOString(),
) {
  const r = newRecord("activity", captured),
    name = values.name.trim();
  if (!name) throw new Error("กรุณาพิมพ์ชื่อกิจกรรม");
  r.text = name;
  r.data = { name, method: "self_report" };
  applyJournalTime(
    r,
    values.date || bangkokParts(captured).date,
    values.time || "",
    "unspecified",
    true,
  );
  if (values.duration !== "") {
    const minutes = Number(values.duration);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
      throw new Error("ระบุระยะเวลา 1–1,440 นาที");
    if (!r.data.start)
      throw new Error("ระบุเวลาเริ่มด้วย เมื่อกรอกระยะเวลากิจกรรม");
    r.data.end = new Date(
      new Date(r.data.start).getTime() + minutes * 60000,
    ).toISOString();
  }
  if (values.intensity) r.data.intensity = values.intensity;
  return r;
}
