// Shared pure helpers. Health values stay unknown when the user has not supplied them.
export function bangkokParts(stamp = new Date().toISOString()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(stamp))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    clock: `${p.hour}:${p.minute}`,
  };
}
export function recordDate(r) {
  const stamp = r.data?.occurred_at || r.data?.start;
  return r.journal?.date || (stamp ? bangkokParts(stamp).date : "");
}
export function recordFromStored(r) {
  return Object.fromEntries(
    [
      "kind",
      "text",
      "data",
      "origin",
      "source",
      "evidence",
      "previous_id",
      "journal",
    ]
      .filter((k) => k in r)
      .map((k) => [k, structuredClone(r[k])]),
  );
}
export function newRecord(kind, captured = new Date().toISOString()) {
  const t = bangkokParts(captured),
    r = {
      kind,
      text: "",
      data: {},
      origin: "self_report",
      source: "ผู้ใช้กรอกและตรวจยืนยันผ่าน DoBao",
      evidence: {},
      previous_id: null,
    };
  if (
    [
      "meal",
      "activity",
      "sleep",
      "medication",
      "appointment",
      "measurement",
      "wellbeing",
    ].includes(kind)
  ) {
    r.journal = {
      date: t.date,
      timezone: "Asia/Bangkok",
      clock: t.clock,
      period: "unspecified",
      clock_source: "capture_time",
      date_source: "capture_date",
      captured_at: captured,
      context_text: "",
    };
    r.data[
      ["activity", "sleep", "appointment"].includes(kind)
        ? "start"
        : "occurred_at"
    ] = `${t.date}T${t.clock}:00+07:00`;
  }
  return r;
}
export function applyJournalTime(r, date, clock, period, changed) {
  if (!r.journal) return r;
  const j = r.journal;
  if (date !== j.date) j.date_source = "user_edited";
  if (changed || clock !== (j.clock || "").slice(0, 5))
    j.clock_source = clock ? "user_edited" : "unspecified";
  j.date = date;
  j.clock = clock ? `${clock}:00` : null;
  j.period = period;
  r.data[
    ["activity", "sleep", "appointment"].includes(r.kind)
      ? "start"
      : "occurred_at"
  ] = clock ? `${date}T${clock}:00+07:00` : null;
  return r; // captured_at deliberately remains unchanged.
}
export function measurementGroups(records) {
  const groups = new Map();
  for (const r of records) {
    const d = r.data;
    if (
      r.kind !== "measurement" ||
      d.name !== "glucose" ||
      d.unit !== "mg/dL" ||
      !Number.isFinite(d.value) ||
      !d.occurred_at ||
      !d.method ||
      !d.context ||
      d.context === "unknown"
    )
      continue;
    const key = [d.unit, d.context, d.method, r.origin].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const group of groups.values())
    group.sort((a, b) => a.data.occurred_at.localeCompare(b.data.occurred_at));
  return groups;
}
export function energyText(e) {
  if (!e || !Array.isArray(e.kcal) || !e.kcal.every(Number.isFinite))
    return "ยังประเมินพลังงานไม่ได้";
  const [lo, hi] = e.kcal;
  return `${lo === hi ? lo : `${lo}–${hi}`} kcal${e.status === "partial" ? " · ยังรวมไม่ครบ" : ""}${e.assumed_portion ? " · ใช้ปริมาณอ้างอิง" : ""}`;
}
export function safeSourceUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
// Known embedded browsers only: ordinary mobile Chrome/Safari remain supported.
export function isEmbeddedGoogleBrowser(userAgent = "") {
  return /\bLine\/|FBAN|FBAV|Instagram|\bMicroMessenger\b|;\s*wv\)/i.test(
    userAgent,
  );
}
