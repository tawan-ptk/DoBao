import {
  bangkokParts,
  recordDate,
  recordFromStored,
  newRecord,
  applyJournalTime,
  measurementGroups,
  energyText,
  safeSourceUrl,
  isEmbeddedGoogleBrowser,
} from "./client-data.js";
import {
  initializeAuth,
  authStartupError,
  authToken,
  authGoogleLogin,
  consumeLoginIntent,
  authLogout,
} from "./auth-client.js";
import {
  healthProfileFields,
  healthProfileRecord,
  defaultShortcuts,
  manualMealRecord,
  manualActivityRecord,
} from "./profile-data.js";

/* Supabase Auth remembers the login on this device (localStorage) until logout; health data stays in server storage. */
const $ = (id) => document.getElementById(id);
const embeddedLoginBrowser = isEmbeddedGoogleBrowser(navigator.userAgent);
const state = {
  user: null,
  consent: { health: false, ai: false },
  notice: null,
  authConfigured: false,
  records: [],
  energies: {},
  summary: {},
  plans: [],
  daily: null,
  cleanupJobs: [],
  healthRevision: -1,
  page: "dashboard",
  profileDirty: false,
  healthProfileDirty: false,
};
let epoch = 0,
  dailyGeneration = 0,
  refreshSequence = 0,
  controllers = new Set(),
  dailyBusy = false,
  toastTimer,
  draft = null,
  operation = null,
  chatController = null,
  chatHistory = [],
  failedChat = null;
let manualReview = null,
  profileBusy = false,
  photoSequence = 0,
  supportSequence = 0;
const shortcutEditing = { food: false, activity: false };
const captureViews = new Map();
const kinds = {
  meal: "อาหาร",
  activity: "กิจกรรม",
  sleep: "การนอน",
  medication: "ยา",
  appointment: "นัดหมาย",
  measurement: "ค่าที่วัด",
  wellbeing: "ความรู้สึก",
  profile: "ข้อมูลประกอบการดูแล",
  routine: "กิจวัตรสำหรับตาราง",
  constraint: "ช่วงเวลาที่ไม่ว่าง",
  feedback: "ข้อเสนอแนะต่อแผน",
};
const periods = {
  unspecified: "ไม่ระบุช่วง",
  morning: "เช้า",
  noon: "เที่ยง",
  afternoon: "บ่าย",
  evening: "เย็น",
  night: "กลางคืน",
};
const contextLabels = {
  unknown: "ยังไม่ระบุ",
  fasting: "ก่อนอาหาร / อดอาหาร",
  after_meal: "หลังอาหาร",
  random: "เวลาอื่น",
};
function el(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
const SVG_NS = "http://www.w3.org/2000/svg";
// Baobuddy mascot (or any sprite icon) as an inline <svg><use>.
function icon(name, cls = "") {
  const svg = document.createElementNS(SVG_NS, "svg"),
    use = document.createElementNS(SVG_NS, "use");
  const mascot = name === "bao" || name === "bao-face";
  if (mascot) svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", mascot ? `bao ${cls}`.trim() : cls);
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#${name}`);
  svg.append(use);
  return svg;
}
const calmMotion = () =>
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// Replays a short CSS animation when a number changes; the text itself is set at once.
function setValue(node, value) {
  const text = String(value);
  if (node.textContent === text) return;
  node.textContent = text;
  node.classList.remove("bump");
  void node.offsetWidth;
  node.classList.add("bump");
}
function friendlyDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "ไม่ระบุวัน";
  const today = bangkokParts().date,
    diff = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
        86400000,
    );
  if (diff === 0) return "วันนี้";
  if (diff === 1) return "เมื่อวาน";
  if (diff === -1) return "พรุ่งนี้";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "2-digit" }),
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
function celebrate() {
  if (calmMotion() || document.querySelector(".confetti")) return;
  const layer = el("div", undefined, "confetti");
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 18; i++) {
    const bit = el("i");
    bit.style.setProperty("--x", `${Math.round(Math.random() * 100)}%`);
    bit.style.setProperty("--d", `${(Math.random() * 0.5).toFixed(2)}s`);
    bit.style.setProperty("--r", `${Math.round(Math.random() * 360)}deg`);
    bit.style.setProperty("--c", i % 5);
    layer.append(bit);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}
function button(text, fn, cls = "secondary-btn") {
  const n = el("button", text, cls);
  n.type = "button";
  n.addEventListener("click", () => run(n, fn));
  return n;
}
function showToast(title, message = "") {
  $("toast-title").textContent = title;
  $("toast-message").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4500);
}
function errorMessage(e) {
  return e.name === "AbortError"
    ? "หยุดรอแล้ว ยังไม่ได้ยืนยันบันทึก"
    : e.message || "ติดต่อระบบไม่ได้ กรุณาลองใหม่";
}
async function run(node, fn) {
  if (node?.disabled) return;
  if (node) node.disabled = true;
  node?.setAttribute("aria-busy", "true");
  try {
    await fn();
  } catch (e) {
    if (e.name !== "AbortError")
      showToast("ทำรายการไม่สำเร็จ", errorMessage(e));
  } finally {
    node?.removeAttribute("aria-busy");
    if (node?.isConnected && !node.dataset.keepDisabled) node.disabled = false;
  }
}
async function api(path, { method = "GET", body, signal } = {}) {
  const c = new AbortController(),
    myEpoch = epoch;
  controllers.add(c);
  const abort = () => c.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 235000);
  try {
    const token = path === "config" ? null : await authToken();
    // A logout/account change during token refresh must not send an old mutation.
    if (epoch !== myEpoch || c.signal.aborted)
      throw new DOMException("Session changed", "AbortError");
    const response = await fetch(`/api/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: c.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method === "POST" ? { "X-DoBao-Request": "1" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "เซิร์ฟเวอร์ส่งข้อมูลที่อ่านไม่ได้ กรุณาโหลดใหม่ หากเป็นการยืนยันให้ตรวจประวัติก่อนลองซ้ำ",
      );
    }
    if (epoch !== myEpoch || c.signal.aborted)
      throw new DOMException("Session changed", "AbortError");
    if (!response.ok) {
      const e = new Error(data.error?.message || "ติดต่อระบบไม่ได้");
      e.status = response.status;
      e.code = data.error?.code;
      if (response.status === 401) {
        clearPrivateState();
        showLogin();
        await authLogout().catch(() => {});
      }
      throw e;
    }
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controllers.delete(c);
  }
}
const post = (path, body = {}, options = {}) =>
  api(path, { method: "POST", body, ...options });
/* While any sheet is open the page behind stays still. iOS Safari ignores
   overflow:hidden on the body, so the page is pinned in place and the
   scroll position is restored when the last sheet closes. */
let lockedScrollY = null;
function lockPage() {
  if (lockedScrollY !== null) return;
  lockedScrollY = window.scrollY || 0;
  document.documentElement.classList.add("sheet-open");
  document.body.style.top = `-${lockedScrollY}px`;
}
/* Phone sheets. On phones the sheets are opened non-modally and layered
   with z-index, so the tab bar can always sit above them in every browser
   (iOS Safari stacks modal dialogs above everything). The page behind is
   made inert, a backdrop dims it, and Escape closes the top sheet. Larger
   screens keep native modal dialogs. */
const sheetStack = [];
const phoneSheets = () =>
  !!window.matchMedia?.("(max-width: 820px)").matches &&
  typeof HTMLDialogElement.prototype.show === "function";
function syncSheets() {
  const open = sheetStack.length > 0;
  $("sheet-backdrop")?.classList.toggle("show", open);
  for (const n of document.querySelectorAll(".sidebar, .main-content, .chat-launcher"))
    n.inert = open;
  sheetStack.forEach((d, i) => (d.style.zIndex = String(50 + i)));
}
function closeSheets() {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
}
function unlockPage() {
  if (document.querySelector("dialog[open]")) return;
  if (lockedScrollY === null) return;
  document.documentElement.classList.remove("sheet-open");
  document.body.style.top = "";
  window.scrollTo(0, lockedScrollY);
  lockedScrollY = null;
}
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("close", () => {
    const i = sheetStack.indexOf(d);
    if (i >= 0) sheetStack.splice(i, 1);
    d.style.zIndex = "";
    syncSheets();
    unlockPage();
  }),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheetStack.length) {
    e.preventDefault();
    sheetStack.at(-1).close();
  }
});
function openDialog(id) {
  const d = $(id);
  if (!d.open) {
    if (phoneSheets()) {
      d.show();
      sheetStack.push(d);
      syncSheets();
    } else d.showModal();
  }
  lockPage();
}
/* Keyboard handling for phones. While a text field is focused the tab bar
   tucks away (it is never pushed up by the keyboard), and open sheets sit
   right above the keyboard. Also keeps the bar clear of Safari's own
   bottom toolbar. */
(() => {
  const vv = window.visualViewport,
    root = document.documentElement,
    coarse = () => !!window.matchMedia?.("(pointer: coarse)").matches;
  const typing = (n) =>
    !!n &&
    (n.matches?.("textarea, select, [contenteditable='true']") ||
      (n.tagName === "INPUT" &&
        !["checkbox", "radio", "button", "submit", "file", "range", "color", "reset"].includes(n.type)));
  let tallest = 0;
  const update = () => {
    const layout = root.clientHeight || window.innerHeight,
      height = vv ? vv.height : layout,
      top = vv ? vv.offsetTop : 0;
    tallest = Math.max(tallest, height);
    const covered = Math.max(0, layout - height - top),
      keyboard =
        (coarse() && typing(document.activeElement)) || tallest - height > 150;
    root.classList.toggle("keyboard-open", keyboard);
    root.style.setProperty("--kb", `${keyboard ? Math.round(covered) : 0}px`);
    root.style.setProperty("--vv-gap", `${keyboard ? 0 : Math.min(Math.round(covered), 120)}px`);
    root.style.setProperty("--vvh", `${Math.round(height)}px`);
  };
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
      // Keep the latest message in view while the chat resizes.
      const log = document.getElementById("chat-messages");
      if (log && document.getElementById("chat-dialog")?.open)
        log.scrollTop = log.scrollHeight;
    });
  };
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  window.addEventListener("orientationchange", () => {
    tallest = 0;
    setTimeout(update, 300);
  });
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", () => setTimeout(schedule, 120));
  update();
})();
function clearPrivateState() {
  state.aiOffline = false;
  currentChatId = null;
  state.showDone = false;
  expandedLists.clear();
  state.timelineDay = null;
  dayCache.clear();
  lastWater = null;
  lastGoalPercent = null;
  epoch++;
  dailyGeneration++;
  dailyBusy = false;
  manualReview = null;
  profileBusy = false;
  photoSequence++;
  supportSequence++;
  state.profileDirty = false;
  state.healthProfileDirty = false;
  document.body.dataset.theme = "mint";
  controllers.forEach((c) => c.abort());
  controllers.clear();
  chatController?.abort();
  chatController = null;
  $("chat-messages").setAttribute("aria-busy", "false");
  $("chat-form").querySelector("button").disabled = false;
  $("cancel-chat").hidden = true;
  $("retry-chat").hidden = true;
  chatHistory = [];
  failedChat = null;
  draft = null;
  operation = null;
  state.records = [];
  state.energies = {};
  state.summary = {};
  state.plans = [];
  state.daily = null;
  state.cleanupJobs = [];
  state.healthRevision = -1;
  $("cleanup-status").replaceChildren();
  $("cleanup-status").hidden = true;
  state.user = null;
  state.consent = { health: false, ai: false };
  delete $("ai-profile-context").dataset.revision;
  resetCaptureViews();
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  for (const id of [
    "chat-messages",
    "chat-suggestions",
    "draft-items",
    "draft-checks",
    "operation-details",
    "food-records",
    "activity-records",
    "medicine-records",
    "health-records",
    "plan-list",
    "goal-list",
    "manual-review-details",
    "food-shortcuts",
    "activity-shortcuts",
    "ai-profile-context",
    "support-records",
  ])
    $(id).replaceChildren();
  for (const id of ["chat-input", "journal-text", "new-goal", "meal-name"])
    $(id).value = "";
  $("profile-form").reset();
  $("health-profile-form").reset();
  $("meal-form").reset();
  $("activity-form").reset();
  $("medication-form").reset();
  $("wellbeing-form").reset();
  $("support-form").reset();
  $("support-status").textContent = "";
  $("avatar-file").value = "";
  document
    .querySelectorAll("[data-avatar]")
    .forEach((n) => n.replaceChildren(el("span", "☺")));
  $("health-form").reset();
  $("welcome-consent").reset();
  $("account-email").textContent = "";
  $("chat-status").textContent = "";
  $("journal-status").textContent = "";
  $("draft-status").textContent = "";
  $("operation-status").textContent = "";
  document
    .querySelectorAll("[data-user-name]")
    .forEach((n) => (n.textContent = "บัญชีของฉัน"));
  $("dashboard-sugar").textContent = "—";
  $("sugar-timestamp").textContent = "ยังไม่มีบันทึก";
  $("chart-dots").replaceChildren();
  $("chart-line").setAttribute("d", "");
  $("chart-area").setAttribute("d", "");
  $("chart-group").replaceChildren();
  $("connection-status").replaceChildren();
  $("connection-status").hidden = true;
  $("sync-status").textContent = "";
  document.querySelectorAll(".chat-launcher").forEach((n) => (n.hidden = true));
  clearTimeout(toastTimer);
  $("toast").classList.remove("show");
  $("toast-title").textContent = "";
  $("toast-message").textContent = "";
  renderAll();
}
// The launch screen (see boot.js) hides the login page while a session opens.
function endLaunch() {
  document.documentElement.classList.remove(
    "auth-resuming",
    "auth-returning",
    "auth-leaving",
  );
}
function showLogin() {
  endLaunch();
  $("login-screen").hidden = false;
  $("app-shell").hidden = true;
  document.querySelectorAll(".chat-launcher").forEach((n) => (n.hidden = true));
}
function navigateTo(page) {
  if (
    ![
      "dashboard",
      "food",
      "exercise",
      "medicine",
      "health",
      "profile",
      "support",
    ].includes(page)
  )
    page = "dashboard";
  if (!document.querySelector(`[data-page-panel="${page}"]`)) return;
  state.page = page;
  if (page === "support") run(null, loadSupport);
  document
    .querySelectorAll("[data-page-panel]")
    .forEach((n) => n.classList.toggle("active", n.dataset.pagePanel === page));
  document.querySelectorAll("[data-page]").forEach((n) => {
    n.classList.toggle("active", n.dataset.page === page);
    n.setAttribute("aria-current", n.dataset.page === page ? "page" : "false");
  });
  history.replaceState(null, "", `#${page}`);
  $("topbar-title").textContent = pageTitles[page];
  const tab = ["dashboard", "food", "exercise", "medicine", "health"].indexOf(page);
  document.querySelector(".bottom-nav")?.style.setProperty("--tab", tab);
  document.querySelector(".bottom-nav")?.classList.toggle("no-tab", tab < 0);
  // A sheet closing on the way here should reveal the new page from the top.
  if (lockedScrollY !== null) lockedScrollY = 0;
  window.scrollTo({ top: 0, behavior: calmMotion() ? "auto" : "smooth" });
}
const pageTitles = {
  dashboard: "หน้าแรก",
  food: "อาหาร",
  exercise: "ออกกำลังกาย",
  medicine: "ยาของฉัน",
  health: "ติดตามสุขภาพ",
  profile: "โปรไฟล์ของฉัน",
  support: "ติดต่อทีม DoBao",
};
/* Glass tab bar: press and slide a finger across it. The highlight follows
   the finger; lifting it opens the tab underneath. A plain tap still works
   through the buttons' own click handlers. */
(() => {
  const dock = document.querySelector(".bottom-nav");
  if (!dock) return;
  const tabs = [...dock.querySelectorAll("button[data-page]")];
  let drag = null,
    swallowClick = false;
  const position = (x) => {
    const r = dock.getBoundingClientRect(),
      w = (r.width - 12) / tabs.length;
    return Math.max(0, Math.min(tabs.length - 1, (x - r.left - 6) / w - 0.5));
  };
  const hover = (i) =>
    tabs.forEach((t, n) => t.classList.toggle("is-hover", n === i));
  const end = (e, commit) => {
    if (!drag || e.pointerId !== drag.id) return;
    const i = Math.round(position(e.clientX)),
      moved = drag.moved;
    dock.releasePointerCapture?.(e.pointerId);
    dock.classList.remove("dragging");
    hover(-1);
    drag = null;
    if (moved && commit) {
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 400);
      closeSheets();
      navigateTo(tabs[i].dataset.page);
    } else {
      const current = tabs.findIndex((t) => t.classList.contains("active"));
      dock.style.setProperty("--tab", current);
    }
  };
  dock.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, moved: false, last: -1 };
  });
  dock.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) < 6) return;
      drag.moved = true;
      dock.setPointerCapture?.(e.pointerId);
      dock.classList.add("dragging");
    }
    const pos = position(e.clientX),
      i = Math.round(pos);
    dock.style.setProperty("--tab", pos);
    if (i !== drag.last) {
      drag.last = i;
      hover(i);
      tap();
    }
  });
  dock.addEventListener("pointerup", (e) => end(e, true));
  dock.addEventListener("pointercancel", (e) => end(e, false));
  dock.addEventListener(
    "click",
    (e) => {
      if (swallowClick) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      // Choosing a tab while a sheet is open closes it, then switches page.
      if (e.target.closest("button[data-page]")) closeSheets();
    },
    true,
  );
})();
// Large page titles collapse into the top bar as you scroll, like iOS.
window.addEventListener(
  "scroll",
  () => document.body.classList.toggle("scrolled", window.scrollY > 64),
  { passive: true },
);
// Login preview tilts gently with the pointer (desktop only).
document.querySelector(".login-visual")?.addEventListener("pointermove", (e) => {
  if (calmMotion() || e.pointerType !== "mouse") return;
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
  e.currentTarget.style.setProperty("--rx", `${((e.clientY - r.top) / r.height - 0.5) * -8}deg`);
});
document.querySelector(".login-visual")?.addEventListener("pointerleave", (e) => {
  e.currentTarget.style.setProperty("--rx", "0deg");
  e.currentTarget.style.setProperty("--ry", "0deg");
});
document
  .querySelectorAll("[data-page]")
  .forEach((n) =>
    n.addEventListener("click", () => navigateTo(n.dataset.page)),
  );
document
  .querySelectorAll("[data-jump]")
  .forEach((n) =>
    n.addEventListener("click", () => navigateTo(n.dataset.jump)),
  );
document.querySelectorAll("[data-nav]").forEach((n) =>
  n.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo(n.dataset.nav);
  }),
);
document
  .querySelectorAll("[data-close]")
  .forEach((n) =>
    n.addEventListener("click", () => $(n.dataset.close).close()),
  );
function applyNotice(n) {
  state.notice = n;
  $("login-notice-label").textContent =
    "ฉันอ่านประกาศความเป็นส่วนตัวและยอมรับข้อกำหนดการใช้งานแล้ว";
  $("privacy-controller").textContent = n.controller;
  $("privacy-location").textContent = n.location;
  $("privacy-retention").textContent = n.retention;
  document
    .querySelectorAll("[data-privacy-contact]")
    .forEach(
      (node) =>
        (node.textContent = n.contact || "ผู้ดูแลยังไม่ได้ระบุช่องทางติดต่อ"),
    );
}
document
  .querySelectorAll("[data-open-privacy]")
  .forEach((n) =>
    n.addEventListener("click", () => openDialog("privacy-dialog")),
  );
function openAccount() {
  if (!state.user) return;
  $("account-email").textContent = state.user.email || "";
  const c = state.consent || {};
  $("consent-summary").textContent =
    c.health && c.notice_version === state.notice?.version
      ? `ข้อมูลสุขภาพ ✓ · Baobuddy ${c.ai ? "✓" : "ปิดอยู่"}`
      : "ยังไม่ได้อนุญาต";
  openDialog("account-dialog");
}
document
  .querySelectorAll("[data-open-account]")
  .forEach((n) => n.addEventListener("click", openAccount));
// First-time (or outdated) consent: a short sheet instead of the whole account page.
// First time: "เริ่มใช้งาน" needs health. Editing later: "บันทึก" also allows withdrawing.
let consentEditing = false;
function syncWelcomeConsent() {
  $("welcome-save").disabled = !consentEditing && !$("welcome-health").checked;
}
function openConsent() {
  if (!state.user) return;
  const current = state.consent.notice_version === state.notice.version;
  consentEditing = current && !!state.consent.health;
  $("consent-title").textContent = consentEditing ? "การอนุญาตของฉัน" : "ก่อนเริ่มใช้งาน";
  $("consent-sub").textContent = consentEditing
    ? "แตะเพื่อเปิดหรือปิด แล้วกดบันทึก"
    : "เลือกสิ่งที่อนุญาต เปลี่ยนได้ทุกเมื่อในหน้าบัญชี";
  $("welcome-save").textContent = consentEditing ? "บันทึก" : "เริ่มใช้งาน";
  $("consent-note").hidden = !consentEditing;
  $("welcome-health").checked = current && !!state.consent.health;
  $("welcome-ai").checked = current && !!state.consent.ai;
  syncWelcomeConsent();
  openDialog("consent-dialog");
}
$("open-consent").addEventListener("click", openConsent);
document
  .querySelectorAll("[data-open-consent]")
  .forEach((n) => n.addEventListener("click", openConsent));
$("welcome-health").addEventListener("change", () => {
  if (!$("welcome-health").checked) $("welcome-ai").checked = false;
  syncWelcomeConsent();
});
$("welcome-ai").addEventListener("change", () => {
  // Baobuddy needs stored health data, so choosing it also turns that on.
  if ($("welcome-ai").checked) $("welcome-health").checked = true;
  syncWelcomeConsent();
});
function canHealth() {
  if (!state.user) return false;
  if (
    !state.consent.health ||
    state.consent.notice_version !== state.notice.version
  ) {
    openConsent();
    showToast("เลือกความยินยอมก่อน", "กรุณาอนุญาตการเก็บและใช้ข้อมูลสุขภาพ");
    return false;
  }
  return true;
}
function canAI() {
  if (!canHealth()) return false;
  if (!state.consent.ai) {
    openConsent();
    showToast("เลือกใช้ Baobuddy", "ติ๊ก “ให้ Baobuddy ช่วย” เพื่อเริ่มแชต");
    return false;
  }
  return true;
}
function setConnection(message) {
  $("connection-status").replaceChildren(
    el("span", message),
    button("โหลดข้อมูลใหม่", refreshAll),
  );
  $("connection-status").hidden = false;
}
async function loadSession() {
  const r = await api("session");
  if (!r.user) {
    if (state.user) clearPrivateState();
    showLogin();
    return false;
  }
  if (state.user && state.user.id !== r.user.id) clearPrivateState();
  // An older session request must not overwrite a just-saved profile.
  if (
    !state.user ||
    (r.user.profileRevision || 0) >= (state.user.profileRevision || 0)
  )
    state.user = r.user;
  state.consent = r.consent;
  renderIdentity();
  if (!r.consent.health || r.consent.notice_version !== r.notice.version) {
    state.records = [];
    state.daily = null;
    state.energies = {};
    state.summary = {};
    state.plans = [];
  }
  applyNotice(r.notice);
  document
    .querySelectorAll("[data-user-name]")
    .forEach((n) => (n.textContent = state.user.displayName));
  $("login-screen").hidden = true;
  $("app-shell").hidden = false;
  document
    .querySelectorAll(".chat-launcher")
    .forEach((n) => (n.hidden = false));
  $("consent-banner").hidden =
    !!state.consent.health &&
    state.consent.notice_version === state.notice.version;
  return true;
}
async function refreshAll() {
  if (!state.user) return;
  const myEpoch = epoch;
  const sequence = ++refreshSequence;
  $("sync-status").textContent = "กำลังตรวจข้อมูลล่าสุด…";
  await refreshCleanupStatus();
  if (myEpoch !== epoch || !state.user) return;
  if (
    !state.consent.health ||
    state.consent.notice_version !== state.notice.version
  ) {
    $("sync-status").textContent = "เลือกความยินยอมในหน้าบัญชีเพื่อเริ่มบันทึก";
    renderAll();
    return;
  }
  const dailyReadGeneration = dailyGeneration;
  const results = await Promise.allSettled([
    api(`daily?day=${bangkokParts().date}`),
    post("health/sync"),
  ]);
  if (myEpoch !== epoch || !state.user) return;
  // Daily rows can be deleted/recreated (their revisions restart). Accept only
  // the latest issued read, and never a read that started before a local write.
  if (
    results[0].status === "fulfilled" &&
    sequence === refreshSequence &&
    dailyReadGeneration === dailyGeneration
  )
    state.daily = results[0].value.daily;
  if (results[1].status === "fulfilled") {
    const r = results[1].value;
    if (Number.isInteger(r.revision) && r.revision >= state.healthRevision) {
      state.records = r.items;
      state.energies = r.meal_energy;
      state.summary = r.summary;
      state.plans = r.plans;
      state.healthRevision = r.revision;
    }
    $("connection-status").hidden = true;
    state.aiOffline = false;
  }
  for (const r of results) {
    if (r.status !== "rejected" || r.reason.name === "AbortError") continue;
    // Baobuddy being unreachable is reported inside the chat only, so it never
    // covers the pages. Other failures still show the banner.
    if (r.reason.code === "ai_unavailable") state.aiOffline = true;
    else setConnection(errorMessage(r.reason));
  }
  $("sync-status").textContent = results.every((r) => r.status === "fulfilled")
    ? `อัปเดตข้อมูล ${new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date())} น.`
    : state.aiOffline
      ? "ข้อมูลบางส่วนยังไม่อัปเดต"
      : "ข้อมูลยังอัปเดตไม่ครบ · ตรวจข้อความแจ้งเตือน";
  if (state.user) renderAll();
  return results[1].status === "fulfilled";
}
async function refreshCleanupStatus() {
  if (!state.user) return;
  try {
    const r = await api("account/cleanup");
    state.cleanupJobs = r.jobs;
    $("cleanup-status").hidden = !r.jobs.length;
    $("cleanup-status").replaceChildren();
    if (r.jobs.length)
      $("cleanup-status").append(
        el(
          "span",
          `มีคำขอลบ ${r.jobs.length} รายการที่ต้องตรวจผล/ล้างสำเนาต่อ ระบบยังไม่ถือว่าลบครบ`,
        ),
        button("ตรวจและทำต่อ", async () => {
          const result = await post("account/cleanup", {
            draft_id: state.cleanupJobs[0].draft_id,
          });
          if (!result.projection_synced)
            throw new Error(
              "ยังล้างสำเนาไม่ครบ คำขอเดิมยังถูกเก็บไว้ กรุณาลองภายหลัง",
            );
          applyDeletion(result);
          showToast("ตรวจผลและล้างสำเนาเรียบร้อย");
          await refreshAll();
        }),
      );
  } catch (e) {
    if (e.name !== "AbortError") {
      $("cleanup-status").hidden = false;
      $("cleanup-status").replaceChildren(
        el("span", errorMessage(e)),
        button("ตรวจอีกครั้ง", refreshCleanupStatus),
      );
    }
  }
}
$("login-notice").addEventListener("change", () => {
  $("google-login").disabled =
    embeddedLoginBrowser ||
    !$("login-notice").checked ||
    !state.notice?.ready ||
    !state.authConfigured;
});
// Share only the app URL, never an OAuth callback, code, or query string.
$("login-browser-url").value =
  `${location.origin}/${location.hash === "#support" ? "#support" : ""}`;
// Google blocks sign-in inside in-app browsers (LINE, Instagram, Facebook…).
// LINE reopens the page in the phone's browser when asked; others get a
// one-tap button that opens Safari (iPhone) or Chrome (Android).
function externalBrowserLink() {
  const ua = navigator.userAgent,
    url = new URL(location.href);
  url.search = "";
  url.hash = location.hash === "#support" ? "#support" : "";
  if (/\bLine\//i.test(ua)) {
    url.searchParams.set("openExternalBrowser", "1");
    return { href: url.href, label: "เปิดในเบราว์เซอร์ของโทรศัพท์" };
  }
  if (/Android/i.test(ua))
    return {
      href: `intent://${url.host}${url.pathname}${url.hash}#Intent;scheme=https;package=com.android.chrome;end`,
      label: "เปิดใน Chrome",
    };
  return {
    href: `x-safari-https://${url.host}${url.pathname}${url.hash}`,
    label: "เปิดใน Safari",
  };
}
if (embeddedLoginBrowser) {
  const link = externalBrowserLink();
  $("open-external").href = link.href;
  $("open-external-label").textContent = link.label;
  $("login-browser-help").hidden = false;
  $("login-browser-help").open = true;
  if (
    /\bLine\//i.test(navigator.userAgent) &&
    !new URLSearchParams(location.search).has("openExternalBrowser")
  )
    location.replace(link.href);
}
$("copy-login-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("login-browser-url").value);
    $("login-browser-status").textContent =
      "คัดลอกแล้ว เปิด Chrome หรือ Safari แล้ววางลิงก์นี้";
  } catch {
    $("login-browser-url").focus();
    $("login-browser-url").select();
    $("login-browser-status").textContent =
      "แตะค้างที่ลิงก์เพื่อคัดลอก แล้วเปิดใน Chrome หรือ Safari";
  }
});
$("google-login").addEventListener("click", () =>
  run($("google-login"), async () => {
    if (
      embeddedLoginBrowser ||
      !state.authConfigured ||
      !state.notice?.ready ||
      !$("login-notice").checked
    )
      return;
    $("login-status").textContent = "กำลังไปที่หน้าเข้าสู่ระบบ Google…";
    // Cover the page right away so the tap feels instant until Google opens.
    document.documentElement.classList.add("auth-resuming", "auth-leaving");
    try {
      // Leaves the page; the app resumes in finishLogin after Google returns.
      await authGoogleLogin(location.hash);
    } catch (error) {
      clearPrivateState();
      showLogin();
      $("login-status").textContent = errorMessage(error);
      $("login-browser-help").open = true;
      throw error;
    }
  }),
);
// Runs once after the Google redirect: registers the account, then opens it.
async function finishLogin(intent) {
  $("login-status").textContent = "กำลังเปิดบัญชี DoBao…";
  try {
    const result = await post("auth/supabase", { noticeAcknowledged: true });
    if (!result.ok) throw new Error("ยังเชื่อมบัญชีไม่สำเร็จ กรุณาลองใหม่");
  } catch (error) {
    await authLogout().catch(() => {});
    clearPrivateState();
    showLogin();
    $("login-status").textContent = errorMessage(error);
    $("login-browser-help").open = true;
    return false;
  }
  if (intent.hash) history.replaceState(null, "", location.pathname + intent.hash);
  return true;
}
$("profile-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, async () => {
    await writeProfile("profile", {
      displayName: $("display-name").value,
      firstName: $("first-name").value,
      lastName: $("last-name").value,
      theme: document.querySelector('[name="profile-theme"]:checked').value,
    });
    state.profileDirty = false;
    renderIdentity();
    $("identity-status").textContent = "บันทึกชื่อและสีที่เลือกแล้ว";
    showToast("บันทึกโปรไฟล์แล้ว");
  });
});
$("profile-form").addEventListener("input", () => {
  state.profileDirty = true;
  $("identity-status").textContent = "มีการแก้ไขที่ยังไม่ได้บันทึก";
});
function renderIdentity() {
  if (!state.user) return;
  const u = state.user;
  document.body.dataset.theme = ["mint", "lavender", "peach"].includes(u.theme)
    ? u.theme
    : "mint";
  document
    .querySelectorAll("[data-user-name]")
    .forEach((n) => (n.textContent = u.displayName));
  document
    .querySelectorAll("[data-user-email]")
    .forEach((n) => (n.textContent = u.email || ""));
  document.querySelectorAll("[data-avatar]").forEach((n) => {
    n.replaceChildren();
    if (
      typeof u.avatar === "string" &&
      /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(u.avatar)
    ) {
      const img = el("img");
      img.src = u.avatar;
      img.alt = "รูปโปรไฟล์";
      n.append(img);
    } else n.append(el("span", Array.from(u.displayName || "☺")[0]));
  });
  $("remove-avatar").hidden = !u.avatar;
  if (!state.profileDirty) {
    $("display-name").value = u.displayName;
    $("first-name").value = u.firstName || "";
    $("last-name").value = u.lastName || "";
    document
      .querySelectorAll('[name="profile-theme"]')
      .forEach((n) => (n.checked = n.value === (u.theme || "mint")));
  }
  renderShortcuts();
}
async function writeProfile(path, body) {
  if (profileBusy) throw new Error("กำลังบันทึกโปรไฟล์ กรุณารอสักครู่");
  profileBusy = true;
  const ownerEpoch = epoch;
  try {
    const { profile: p } = await post(path, {
      ...body,
      revision: state.user.profileRevision || 0,
    });
    Object.assign(state.user, {
      displayName: p.display_name || state.user.displayName,
      firstName: p.first_name,
      lastName: p.last_name,
      theme: p.theme,
      avatar: p.avatar_data_url,
      shortcuts: p.shortcuts,
      profileRevision: p.revision,
    });
    renderIdentity();
  } finally {
    if (ownerEpoch === epoch) profileBusy = false;
  }
}
function showProfileTab(name) {
  document.querySelectorAll("[data-profile-tab]").forEach((t) =>
    t.setAttribute("aria-selected", String(t.dataset.profileTab === name)),
  );
  document
    .querySelectorAll("[data-profile-panel]")
    .forEach((n) => (n.hidden = n.dataset.profilePanel !== name));
}
document
  .querySelectorAll("[data-profile-tab]")
  .forEach((t) =>
    t.addEventListener("click", () => showProfileTab(t.dataset.profileTab)),
  );
// Opens the profile on the health tab (used by "edit care details" links).
function openHealthProfile() {
  openProfile();
  showProfileTab("health");
  $("health-profile-section").scrollIntoView?.({ behavior: "smooth", block: "start" });
}
function openProfile() {
  if (!state.user) return;
  $("account-dialog").close();
  navigateTo("profile");
  renderIdentity();
  renderHealthProfile();
}
document
  .querySelectorAll("[data-open-profile]")
  .forEach((n) => n.addEventListener("click", openProfile));
function openSupport() {
  document.querySelectorAll("dialog[open]").forEach((n) => n.close());
  if (!state.user) {
    history.replaceState(null, "", "#support");
    showLogin();
    $("login-status").textContent =
      "เข้าสู่ระบบ Google เพื่อส่งข้อความถึงทีมและอ่านคำตอบของคุณ";
    return;
  }
  navigateTo("support");
}
document
  .querySelectorAll("[data-open-support]")
  .forEach((n) => n.addEventListener("click", openSupport));
async function loadSupport() {
  if (!state.user) return;
  const ownerEpoch = epoch,
    sequence = ++supportSequence;
  try {
    const r = await api("support");
    if (ownerEpoch !== epoch || sequence !== supportSequence) return;
    const target = $("support-records");
    target.replaceChildren();
    for (const item of r.items || []) {
      const card = el("article", undefined, "saved-record");
      card.append(
        el(
          "small",
          new Intl.DateTimeFormat("th-TH", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Bangkok",
          }).format(new Date(item.created_at)),
        ),
        el("h3", item.topic),
        el("p", item.message, "support-body"),
      );
      if (item.reply)
        card.append(
          el("strong", "คำตอบจากทีม DoBao"),
          el("p", item.reply, "support-reply"),
        );
      else
        card.append(
          el(
            "small",
            item.status === "closed"
              ? "ปิดคำขอแล้ว"
              : "ส่งข้อความแล้ว · รอทีมตอบกลับในหน้านี้",
          ),
        );
      card.append(
        button(
          "ลบข้อความ",
          () => {
            operation = {
              custom: async () => {
                await post("support/delete", { id: item.id });
                card.remove();
                try {
                  await loadSupport();
                } catch {
                  /* Deletion committed; the remaining list can be reloaded. */
                }
                showToast("ลบข้อความแล้ว");
              },
            };
            $("operation-title").textContent = "ลบข้อความติดต่อทีมนี้?";
            $("operation-details").replaceChildren(
              el("p", "ข้อความและคำตอบของทีมจะถูกลบจากประวัติของคุณ"),
            );
            $("operation-status").textContent = "";
            $("confirm-operation").disabled = false;
            delete $("confirm-operation").dataset.keepDisabled;
            $("confirm-operation").textContent = "ยืนยันลบข้อความ";
            openDialog("operation-dialog");
          },
          "danger-btn",
        ),
      );
      target.append(card);
    }
    if (!r.items?.length)
      target.append(
        el(
          "p",
          "ยังไม่มีข้อความถึงทีม เมื่อส่งแล้วข้อความและคำตอบจะแสดงที่นี่",
          "empty-state",
        ),
      );
  } catch (e) {
    if (ownerEpoch === epoch && sequence === supportSequence)
      $("support-status").textContent = errorMessage(e);
    throw e;
  }
}
$("reload-support").addEventListener("click", () =>
  run($("reload-support"), loadSupport),
);
$("support-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, async () => {
    const message = $("support-message").value.trim();
    if (!message) return;
    const ownerEpoch = epoch;
    $("support-status").textContent = "กำลังส่งข้อความ…";
    try {
      await post("support", { topic: $("support-topic").value, message });
      if (ownerEpoch !== epoch) return;
      if ($("support-message").value.trim() === message)
        $("support-message").value = "";
      $("support-status").textContent =
        "ส่งข้อความแล้ว กลับมาอ่านคำตอบในหน้านี้ได้";
      try {
        await loadSupport();
      } catch {
        $("support-status").textContent =
          "ส่งข้อความแล้ว แต่ยังโหลดประวัติไม่ครบ กดตรวจคำตอบล่าสุดได้";
      }
    } catch (e) {
      if (ownerEpoch === epoch)
        $("support-status").textContent =
          `${errorMessage(e)} หากเพิ่งส่ง ให้ตรวจประวัติก่อนส่งซ้ำ`;
      throw e;
    }
  });
});
document.querySelectorAll(".profile-section-nav a").forEach((n) =>
  n.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(n.getAttribute("href"));
    if (target?.closest("details")) target.closest("details").open = true;
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    target
      ?.querySelector("input,select,textarea,button")
      ?.focus({ preventScroll: true });
  }),
);
$("reload-identity").addEventListener("click", () =>
  run($("reload-identity"), async () => {
    await loadSession();
    state.profileDirty = false;
    renderIdentity();
    $("identity-status").textContent = "โหลดข้อมูลที่บันทึกไว้แล้ว";
  }),
);
function currentShortcuts() {
  const s = state.user?.shortcuts;
  return structuredClone(
    s?.initialized
      ? {
          food: Array.isArray(s.food) ? s.food : [],
          activity: Array.isArray(s.activity) ? s.activity : [],
        }
      : defaultShortcuts,
  );
}
function renderShortcuts() {
  if (!state.user) return;
  const lists = currentShortcuts();
  for (const kind of ["food", "activity"]) {
    const target = $(`${kind}-shortcuts`);
    target.replaceChildren();
    lists[kind].forEach((name, index) => {
      const group = el("div", undefined, "shortcut-item");
      group.append(
        button(
          name,
          () => {
            const input = $(kind === "food" ? "meal-name" : "activity-name");
            input.value = name;
            input.focus();
            input.scrollIntoView?.({ behavior: "smooth", block: "center" });
          },
          "shortcut-button",
        ),
      );
      if (shortcutEditing[kind]) {
        const remove = button(
          "×",
          async () => {
            if (!canHealth()) return;
            const next = currentShortcuts();
            next[kind].splice(index, 1);
            await writeProfile("profile/shortcuts", { shortcuts: next });
            showToast("ลบปุ่มลัดแล้ว");
          },
          "shortcut-remove",
        );
        remove.setAttribute("aria-label", `ลบปุ่มลัด ${name}`);
        group.append(remove);
      }
      target.append(group);
    });
    if (!lists[kind].length)
      target.append(
        el(
          "p",
          "ยังไม่มีปุ่มลัด พิมพ์รายการด้านบนแล้วกดเก็บได้เลย",
          "form-hint",
        ),
      );
    document.querySelector(`[data-manage-shortcuts="${kind}"]`).textContent =
      shortcutEditing[kind] ? "เสร็จแล้ว" : "จัดการ";
  }
}
document.querySelectorAll("[data-manage-shortcuts]").forEach((n) =>
  n.addEventListener("click", () => {
    const kind = n.dataset.manageShortcuts;
    shortcutEditing[kind] = !shortcutEditing[kind];
    renderShortcuts();
  }),
);
for (const kind of ["food", "activity"])
  $(`add-${kind}-shortcut`).addEventListener("click", () =>
    run($(`add-${kind}-shortcut`), async () => {
      if (!canHealth()) return;
      const name = $(
        kind === "food" ? "meal-name" : "activity-name",
      ).value.trim();
      if (!name) throw new Error("พิมพ์ชื่อในช่องด้านบนก่อนเก็บเป็นปุ่มลัด");
      const next = currentShortcuts();
      if (next[kind].includes(name)) {
        showToast("มีปุ่มลัดนี้แล้ว");
        return;
      }
      next[kind].push(name);
      await writeProfile("profile/shortcuts", { shortcuts: next });
      showToast("เพิ่มปุ่มลัดแล้ว");
    }),
  );
async function thumbnail(file) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    throw new Error("เลือกรูป JPG, PNG หรือ WebP ไม่เกิน 8 MB");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const size = Math.min(bitmap.width, bitmap.height);
    canvas
      .getContext("2d")
      .drawImage(
        bitmap,
        (bitmap.width - size) / 2,
        (bitmap.height - size) / 2,
        size,
        size,
        0,
        0,
        256,
        256,
      );
    const data = canvas.toDataURL("image/webp", 0.78);
    if (data.length > 90000)
      throw new Error("รูปนี้มีรายละเอียดมาก กรุณาเลือกรูปอื่น");
    return data;
  } finally {
    bitmap.close();
  }
}
$("avatar-file").addEventListener("change", () =>
  run(null, async () => {
    const file = $("avatar-file").files[0];
    if (!file) return;
    const seq = ++photoSequence,
      ownerEpoch = epoch;
    $("avatar-status").textContent = "กำลังเตรียมรูป…";
    try {
      const image = await thumbnail(file);
      if (seq !== photoSequence || ownerEpoch !== epoch) return;
      await writeProfile("profile/avatar", { image });
      $("avatar-status").textContent = "บันทึกรูปโปรไฟล์แล้ว";
    } catch (e) {
      if (ownerEpoch === epoch)
        $("avatar-status").textContent = errorMessage(e);
      throw e;
    } finally {
      if (seq === photoSequence) $("avatar-file").value = "";
    }
  }),
);
$("remove-avatar").addEventListener("click", () =>
  run($("remove-avatar"), async () => {
    photoSequence++;
    await writeProfile("profile/avatar", { image: null });
    $("avatar-status").textContent = "ลบรูปโปรไฟล์แล้ว";
  }),
);
function latestHealthProfile() {
  return state.records
    .filter((r) => r.kind === "profile")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
}
function renderHealthProfile() {
  const previous = latestHealthProfile(),
    data = previous?.data || {};
  const context = $("ai-profile-context");
  if (
    context.dataset.revision !== undefined &&
    context.dataset.revision !== String(state.healthRevision)
  ) {
    context.textContent = "มีการเปลี่ยนแปลงข้อมูล กดตรวจข้อมูลล่าสุดได้เลย";
    delete context.dataset.revision;
  }
  $("profile-completeness").textContent = previous
    ? "มีข้อมูลที่บันทึกแล้ว · แตะเพื่อดูหรือแก้ไข"
    : "เพิ่มโรคประจำตัว การแพ้ และข้อจำกัดเมื่อพร้อม";
  $("delete-health-profile").hidden = !previous;
  if (state.healthProfileDirty) return;
  for (const key of Object.keys(healthProfileFields)) {
    const node = $(`hp-${key}`),
      v = data[key];
    node.value = Array.isArray(v)
      ? v.join("\n")
      : typeof v === "boolean"
        ? String(v)
        : (v ?? "");
  }
  $("hp-allergy-status").value = Array.isArray(data.allergies)
    ? data.allergies.length
      ? "listed"
      : "none"
    : "unknown";
  $("hp-allergy-field").hidden = $("hp-allergy-status").value !== "listed";
  $("health-profile-saved").textContent = previous
    ? "แสดงข้อมูลที่บันทึกไว้ · แก้ไขได้ตามต้องการ"
    : "ยังไม่ได้บันทึกข้อมูลสุขภาพส่วนตัว";
}
$("health-profile-form").addEventListener("input", () => {
  state.healthProfileDirty = true;
  $("health-profile-saved").textContent = "มีการแก้ไขที่ยังไม่ได้บันทึก";
});
$("hp-allergy-status").addEventListener("change", () => {
  $("hp-allergy-field").hidden = $("hp-allergy-status").value !== "listed";
});
$("health-profile-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, () => {
    const values = Object.fromEntries(
      Object.keys(healthProfileFields).map((key) => [
        key,
        $(`hp-${key}`).value,
      ]),
    );
    values.allergyStatus = $("hp-allergy-status").value;
    const record = healthProfileRecord(values, latestHealthProfile());
    return reviewManual([record], (result) => {
      state.healthProfileDirty = !(
        Number.isInteger(result.revision) &&
        state.healthRevision >= result.revision
      );
      if (!state.healthProfileDirty) renderHealthProfile();
      else
        $("health-profile-saved").textContent =
          "บันทึกต้นฉบับแล้ว รอโหลดข้อมูลล่าสุด";
    });
  });
});
$("reload-health-profile").addEventListener("click", () =>
  run($("reload-health-profile"), async () => {
    if (await refreshAll()) {
      state.healthProfileDirty = false;
      renderHealthProfile();
    }
  }),
);
$("delete-health-profile").addEventListener("click", () =>
  run($("delete-health-profile"), () =>
    previewDelete({
      scope: "records",
      record_ids: state.records
        .filter((r) => r.kind === "profile")
        .map((r) => r.id),
    }),
  ),
);
document.querySelectorAll("[data-profile-chat]").forEach((n) =>
  n.addEventListener("click", () => {
    if (state.healthProfileDirty) {
      showToast(
        "บันทึกข้อมูลสุขภาพที่แก้ไขก่อน เพื่อให้ Baobuddy ใช้ข้อมูลล่าสุด",
      );
      showProfileTab("health");
      $("save-health-profile").focus();
      return;
    }
    if (!canAI()) return;
    openDialog("chat-dialog");
    sendChat(n.dataset.profileChat);
  }),
);
$("load-ai-profile").addEventListener("click", () =>
  run($("load-ai-profile"), async () => {
    if (!canHealth()) return;
    const ownerEpoch = epoch,
      requestedRevision = state.healthRevision;
    $("ai-profile-context").textContent = "กำลังโหลดข้อมูลที่ยืนยันแล้ว…";
    try {
      const result = await api("ai/personal-context");
      if (ownerEpoch !== epoch) return;
      if (requestedRevision !== state.healthRevision) {
        $("ai-profile-context").textContent =
          "ข้อมูลเพิ่งเปลี่ยน กรุณากดตรวจข้อมูลล่าสุดอีกครั้ง";
        return;
      }
      const list = el("dl");
      for (const [key, label] of Object.entries(healthProfileFields)) {
        const value = result.profile?.[key];
        const text = Array.isArray(value)
          ? value.length
            ? value.join(" / ")
            : key === "allergies"
              ? "ไม่มีประวัติแพ้ที่ทราบ"
              : "ยังไม่ระบุ"
          : value == null
            ? "ยังไม่ระบุ"
            : typeof value === "boolean"
              ? value
                ? "ใช่"
                : "ไม่ใช่"
              : String(value);
        list.append(el("dt", label), el("dd", text));
      }
      $("ai-profile-context").replaceChildren(list);
      $("ai-profile-context").dataset.revision = String(requestedRevision);
    } catch (e) {
      if (ownerEpoch === epoch)
        $("ai-profile-context").textContent = errorMessage(e);
      throw e;
    }
  }),
);
async function saveConsent(health, ai) {
    await post("consent", { health, ai, version: state.notice.version });
    epoch++;
    controllers.forEach((c) => c.abort());
    chatController?.abort();
    chatHistory = [];
    failedChat = null;
    draft = null;
    operation = null;
    $("chat-messages").replaceChildren();
    $("chat-messages").setAttribute("aria-busy", "false");
    $("draft-items").replaceChildren();
    $("operation-details").replaceChildren();
    if (!health) {
      state.records = [];
      state.daily = null;
      state.summary = {};
      state.plans = [];
      state.energies = {};
    }
    await loadSession();
    await refreshAll();
}
$("welcome-consent").addEventListener("submit", (e) => {
  e.preventDefault();
  run($("welcome-save"), async () => {
    await saveConsent($("welcome-health").checked, $("welcome-ai").checked);
    const editing = consentEditing;
    $("consent-dialog").close();
    if ($("account-dialog").open) $("account-dialog").close();
    showToast(
      editing ? "บันทึกการอนุญาตแล้ว" : "พร้อมใช้งานแล้ว",
      editing ? "" : "เปลี่ยนการอนุญาตได้ทุกเมื่อในหน้าบัญชี",
    );
  });
});
$("logout").addEventListener("click", () =>
  run($("logout"), async () => {
    controllers.forEach((c) => c.abort());
    try {
      await post("auth/logout");
    } finally {
      await authLogout().catch(() => {});
      clearPrivateState();
      showLogin();
      $("login-status").textContent = "ออกจากระบบแล้ว";
    }
  }),
);

/* Supabase stores water/goals with optimistic concurrency per Bangkok calendar day. */
function currentDaily() {
  return state.daily?.day === bangkokParts().date
    ? state.daily
    : { day: bangkokParts().date, water: 0, goals: [], revision: 0 };
}
async function saveDaily(transform) {
  if (!canHealth() || dailyBusy) return;
  dailyBusy = true;
  dailyGeneration++;
  const ownerEpoch = epoch;
  try {
    const next = structuredClone(currentDaily());
    transform(next);
    state.daily = (await post("daily", next)).daily;
    dailyGeneration++;
    renderDaily();
    showToast("บันทึกแล้ว");
  } catch (e) {
    if (e.status === 409) {
      state.daily = (await api(`daily?day=${bangkokParts().date}`)).daily;
      renderDaily();
    }
    throw e;
  } finally {
    if (ownerEpoch === epoch) dailyBusy = false;
  }
}
function renderDaily() {
  const d = currentDaily(),
    done = d.goals.filter((g) => g.done).length,
    percent = d.goals.length ? Math.round((done / d.goals.length) * 100) : 0;
  setValue($("water-count"), d.water);
  $("water-dots").replaceChildren(
    ...Array.from({ length: 8 }, (_, i) => {
      const glass = el("span", undefined, i < d.water ? "filled" : "");
      if (i === d.water - 1 && lastWater !== null && d.water > lastWater)
        glass.classList.add("just-filled");
      return glass;
    }),
  );
  lastWater = d.water;
  $("water-dots").setAttribute("aria-label", `ดื่มน้ำ ${d.water} แก้ว`);
  $("goal-list").replaceChildren(
    ...d.goals.map((g) => {
      const row = el("div", undefined, `goal-row ${g.done ? "completed" : ""}`),
        label = el("label", undefined, "goal-item"),
        input = el("input");
      input.type = "checkbox";
      input.checked = g.done;
      input.addEventListener("change", () => {
        const checked = input.checked;
        tap();
        input.checked = g.done;
        run(null, () =>
          saveDaily(
            (next) => (next.goals.find((x) => x.id === g.id).done = checked),
          ),
        );
      });
      label.append(
        input,
        el("span", g.done ? "✓" : "", "custom-check"),
        el("strong", g.label),
      );
      row.append(
        label,
        button("แก้", () => openGoalEditor(g), "text-button"),
      );
      return row;
    }),
  );
  if (!d.goals.length)
    $("goal-list").append(
      el(
        "p",
        "เพิ่มเป้าหมายที่เหมาะกับคุณ แล้วทำเครื่องหมายเมื่อสำเร็จ",
        "empty-state",
      ),
    );
  setValue($("goal-done-count"), done);
  $("goal-total-count").textContent = d.goals.length;
  // Nothing to measure yet: hide the 0/0 badge, empty bar and 0% ring.
  document.querySelector(".goal-count").hidden = !d.goals.length;
  document.querySelector(".goal-footer").hidden = !d.goals.length;
  document.querySelector(".day-score").hidden = !d.goals.length;
  if (percent === 100 && lastGoalPercent !== null && lastGoalPercent < 100)
    celebrate();
  lastGoalPercent = percent;
  $("goal-progress").style.width = `${percent}%`;
  $("goal-percent").textContent = `${percent}%`;
  $("header-goal-percent").textContent = `${percent}%`;
  document
    .querySelector(".score-ring")
    .style.setProperty("--progress", percent);
  document
    .querySelector(".day-score")
    .setAttribute("aria-label", `สำเร็จ ${percent} เปอร์เซ็นต์`);
  renderBuddy();
  renderToday();
}
let lastWater = null,
  lastGoalPercent = null;
/* ---- Today: what to do next ------------------------------------------
   Built only from confirmed data: the latest confirmed 7-day plan, routines
   the user saved, medication reminders/appointments, and records logged
   today. Nothing is invented; a meal nudge only asks the user to log. */
const domainVerb = {
  meal: "จดมื้อนี้",
  activity: "จดว่าทำแล้ว",
  medication: "จดว่าทานยาแล้ว",
  measurement: "จดค่าที่วัด",
  sleep: "จดการนอน",
  appointment: "จดบันทึก",
  wellbeing: "จดความรู้สึก",
};
const periodClock = {
  morning: "08:00",
  noon: "12:00",
  afternoon: "15:00",
  evening: "18:00",
  night: "21:00",
};
function zoned(iso) {
  if (typeof iso !== "string" || !iso) return null;
  const ms = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}+07:00`);
  return Number.isFinite(ms)
    ? { ...bangkokParts(new Date(ms).toISOString()), ms }
    : null;
}
const at = (date, clock) => Date.parse(`${date}T${clock}:00+07:00`);
function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
function relTime(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return "ตอนนี้";
  if (m < 60) return `อีก ${m} นาที`;
  const h = Math.floor(m / 60);
  return m % 60 ? `อีก ${h} ชม. ${m % 60} นาที` : `อีก ${h} ชม.`;
}
const sameLabel = (a, b) => {
  const n = (x) => String(x || "").replace(/\s+/g, "").toLowerCase();
  return !!n(a) && !!n(b) && (n(a).includes(n(b)) || n(b).includes(n(a)));
};
function latestPlan() {
  return state.plans.find((p) => p.user_status === "confirmed") || null;
}
function scheduleFor(date) {
  const items = [],
    plan = latestPlan();
  for (const it of plan?.items || []) {
    const s = zoned(it.start),
      e = zoned(it.end);
    if (s?.date !== date) continue;
    items.push({
      kind: "plan",
      domain: it.domain,
      label: it.label || kinds[it.domain] || "กิจวัตร",
      start: s.clock,
      end: e?.date === date ? e.clock : null,
      startMs: s.ms,
      endMs: e?.ms ?? s.ms,
      stale: !!plan.requires_revalidation,
    });
  }
  if (!items.length)
    for (const r of state.records) {
      if (r.kind !== "routine" || !(r.data.dates || []).includes(date)) continue;
      const a = String(r.data.earliest || "").slice(0, 5),
        b = String(r.data.latest || "").slice(0, 5);
      if (!/^\d\d:\d\d$/.test(a)) continue;
      items.push({
        kind: "window",
        domain: r.data.domain,
        label: r.data.label || kinds[r.data.domain],
        start: a,
        end: /^\d\d:\d\d$/.test(b) && b !== a ? b : null,
        startMs: at(date, a),
        endMs: at(date, /^\d\d:\d\d$/.test(b) ? b : a),
      });
    }
  for (const r of state.records) {
    if (r.kind === "medication" && r.data.state === "reminder_due") {
      const t = zoned(r.data.occurred_at);
      if (t?.date === date)
        items.push({
          kind: "reminder",
          domain: "medication",
          label: r.data.name || "ยา",
          start: t.clock,
          end: null,
          startMs: t.ms,
          endMs: t.ms + 30 * 60000,
        });
    }
    if (r.kind === "appointment") {
      const t = zoned(r.data.start),
        e = zoned(r.data.end);
      if (t?.date === date)
        items.push({
          kind: "reminder",
          domain: "appointment",
          label: recordTitle(r),
          start: t.clock,
          end: e?.date === date ? e.clock : null,
          startMs: t.ms,
          endMs: e?.ms ?? t.ms + 60 * 60000,
        });
    }
  }
  const logged = [];
  for (const r of state.records) {
    if (!["meal", "activity", "medication", "measurement", "sleep", "wellbeing"].includes(r.kind))
      continue;
    if (r.kind === "medication" && r.data.state !== "reported_taken") continue;
    if (recordDate(r) !== date) continue;
    const clock =
      r.journal?.clock?.slice(0, 5) ||
      (!r.journal ? zoned(r.data.occurred_at || r.data.start)?.clock : null) ||
      null;
    logged.push({
      kind: "done",
      domain: r.kind,
      label: recordTitle(r),
      start: clock,
      periodLabel: clock ? null : periods[r.journal?.period] || "ไม่ระบุเวลา",
      startMs: at(date, clock || periodClock[r.journal?.period] || "23:59"),
      endMs: 0,
      used: false,
    });
  }
  // A logged record completes the matching scheduled item (same kind, and the
  // same name or logged within 90 minutes of it). Each record is used once.
  for (const it of items.sort((a, b) => a.startMs - b.startMs)) {
    const match = logged.find(
      (l) =>
        !l.used &&
        l.domain === it.domain &&
        (sameLabel(l.label, it.label) ||
          (l.start && Math.abs(l.startMs - it.startMs) <= 90 * 60000)),
    );
    if (match) {
      match.used = true;
      it.done = true;
    }
  }
  return [...items, ...logged.filter((l) => !l.used)].sort(
    (a, b) => a.startMs - b.startMs,
  );
}
function hasSchedule() {
  return (
    !!latestPlan()?.items?.length ||
    state.records.some((r) => r.kind === "routine")
  );
}
function healthReady() {
  return (
    !!state.user &&
    !!state.consent.health &&
    state.consent.notice_version === state.notice?.version
  );
}
function currentMealPeriod(hour) {
  return hour >= 5 && hour < 10
    ? "morning"
    : hour >= 11 && hour < 14
      ? "noon"
      : hour >= 17 && hour < 20
        ? "evening"
        : null;
}
function nextUp() {
  if (!healthReady()) return { type: "consent" };
  const today = bangkokParts().date,
    now = Date.now(),
    pending = scheduleFor(today).filter(
      (x) => x.kind !== "done" && !x.done && x.endMs >= now,
    );
  if (pending.length)
    return { type: "item", item: pending[0], active: pending[0].startMs <= now };
  const hour = Number(bangkokParts().clock.slice(0, 2)),
    period = currentMealPeriod(hour);
  if (
    period &&
    !state.records.some((r) => {
      if (r.kind !== "meal" || recordDate(r) !== today) return false;
      const h = Number((r.journal?.clock || "99").slice(0, 2));
      return r.journal?.period === period || currentMealPeriod(h) === period;
    })
  )
    return { type: "meal", period };
  const goal = currentDaily().goals.find((g) => !g.done);
  if (goal) return { type: "goal", goal };
  if (!hasSchedule()) return { type: "setup" };
  return { type: "done" };
}
function goCapture(kind, text) {
  if (!canHealth()) return;
  navigateTo(kind === "activity" ? "exercise" : "food");
  const input = $(`capture-${kind}-text`);
  if (!input) return;
  input.value = text || "";
  setTimeout(() => {
    input.focus();
    input.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, 250);
}
// "จดว่าทำแล้ว" is a manual entry — it never goes through Baobuddy.
// Activities and medicines save in one tap from the plan; meals and
// measurements open the form because the user must add what/how much.
function doItem(item) {
  if (!canHealth()) return;
  const today = bangkokParts().date,
    now = bangkokParts().clock,
    started = item.startMs && item.startMs <= Date.now() ? item.start : now;
  if (item.domain === "activity") {
    const minutes = Math.round((item.endMs - item.startMs) / 60000);
    return reviewManual(
      [
        manualActivityRecord({
          name: item.label,
          date: today,
          time: started,
          duration: minutes > 0 && minutes <= 1440 ? String(minutes) : "",
          intensity: "",
        }),
      ],
      () => renderToday(),
      "",
      { fast: true },
    );
  }
  if (item.domain === "medication") {
    const r = newRecord("medication");
    r.text = item.label;
    r.data = { name: item.label, state: "reported_taken" };
    applyJournalTime(r, today, started, "unspecified", true);
    return reviewManual([r], () => renderToday(), "", { fast: true });
  }
  if (item.domain === "meal") {
    navigateTo("food");
    $("food-manual").open = true;
    $("meal-date").value = today;
    $("meal-time").value = started;
    const hour = Number(started.slice(0, 2));
    $("meal-period").value =
      hour < 10 ? "morning" : hour < 14 ? "noon" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    setTimeout(() => $("meal-name").focus(), 250);
    return;
  }
  if (item.domain === "measurement") {
    navigateTo("health");
    setTimeout(() => $("sugar-input").focus(), 250);
    return;
  }
  openDialog("journal-dialog");
  $("journal-text").value = item.label || "";
}
function openScheduleSetup() {
  if (!canHealth()) return;
  navigateTo("health");
  setTimeout(
    () =>
      document
        .querySelector(".plan-panel")
        ?.scrollIntoView?.({ behavior: "smooth", block: "start" }),
    250,
  );
}
function renderNextUp() {
  const host = $("next-up");
  if (!host) return;
  const n = nextUp(),
    now = Date.now(),
    card = el("div", undefined, "next-card"),
    main = el("div", undefined, "next-main"),
    actions = el("div", undefined, "next-actions"),
    badge = el("span", undefined, "next-icon");
  badge.setAttribute("aria-hidden", "true");
  let tone = "neutral";
  const line = (kicker, title, sub, time) => {
    main.append(el("span", kicker, "next-kicker"));
    if (time) main.append(el("strong", time, "next-time"));
    main.append(el("h2", title, "next-title"));
    if (sub) main.append(el("p", sub, "next-sub"));
  };
  if (n.type === "item") {
    const x = n.item;
    tone = x.domain;
    badge.textContent = kindIcons[x.domain] || "⏰";
    const range = x.end ? `${x.start}–${x.end} น.` : `${x.start} น.`,
      source =
        x.kind === "plan"
          ? x.stale
            ? "ข้อมูลเปลี่ยนแล้ว ควรตรวจตารางอีกครั้ง"
            : "จากตาราง 7 วันที่คุณยืนยัน"
          : x.kind === "window"
            ? "ช่วงเวลาที่ตั้งไว้ ยังไม่ได้จัดตาราง"
            : "รายการที่คุณบันทึกไว้";
    line(
      n.active ? "ตอนนี้" : `ถัดไป · ${relTime(x.startMs - now)}`,
      x.label,
      `${range} · ${source}`,
      x.start,
    );
    if (n.active) card.classList.add("is-active");
    actions.append(
      button(domainVerb[x.domain] || "จดบันทึก", () => doItem(x), "next-primary"),
      button("ดูทั้งวัน", () => {
        $("schedule-panel").scrollIntoView?.({ behavior: "smooth", block: "start" });
      }, "next-ghost"),
    );
  } else if (n.type === "meal") {
    tone = "meal";
    badge.textContent = "🍽️";
    line(
      "ถึงเวลาแล้ว",
      `จดมื้อ${periods[n.period]}กันไหม?`,
      "เล่าให้ Baobuddy ฟังสั้น ๆ ว่ากินอะไรไป แล้วตรวจก่อนบันทึก",
    );
    actions.append(
      button("จดมื้อนี้", () => goCapture("food", ""), "next-primary"),
    );
  } else if (n.type === "goal") {
    tone = "goal";
    badge.textContent = "🎯";
    line("เป้าหมายที่เหลือวันนี้", n.goal.label, "ทำเสร็จแล้วแตะเพื่อติ๊กได้เลย");
    actions.append(
      button("ทำแล้ว", () => {
        tap();
        return saveDaily((d) => {
          const g = d.goals.find((x) => x.id === n.goal.id);
          if (g) g.done = true;
        });
      }, "next-primary"),
    );
  } else if (n.type === "setup") {
    tone = "setup";
    badge.append(icon("bao"));
    line(
      "เริ่มต้นใช้ตาราง",
      "ตั้งกิจวัตรประจำวันของคุณ",
      "เพิ่มสิ่งที่ทำเป็นประจำ เช่น เดิน ทานยา หรือวัดน้ำตาล แล้วจัดตาราง 7 วันให้ลงตัว",
    );
    actions.append(
      button("ตั้งกิจวัตร", openScheduleSetup, "next-primary"),
    );
  } else if (n.type === "consent") {
    tone = "setup";
    badge.append(icon("bao"));
    line(
      "ก่อนเริ่ม",
      "เลือกความยินยอมข้อมูลสุขภาพ",
      "เลือกได้ว่าจะให้เก็บและใช้ข้อมูลแค่ไหน แก้ไขได้ทุกเมื่อ",
    );
    actions.append(button("ตั้งค่าความยินยอม", openConsent, "next-primary"));
  } else {
    tone = "done";
    badge.textContent = "🎉";
    line("เยี่ยมมาก", "วันนี้ครบทุกอย่างแล้ว", "ไว้เจอกันพรุ่งนี้นะ");
  }
  card.dataset.tone = tone;
  card.append(main, badge, actions);
  host.replaceChildren(card);
}
const dayCache = new Map();
function weekStartOf(date) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7)); // Monday-based weeks
}
function selectDay(date) {
  const today = bangkokParts().date,
    last = addDays(today, 6);
  state.timelineDay = date > last ? last : date;
  tap();
  renderWeekStrip();
  renderTimeline();
}
function renderWeekStrip() {
  const host = $("week-strip");
  if (!host) return;
  const today = bangkokParts().date,
    last = addDays(today, 6);
  if (!state.timelineDay || state.timelineDay > last) state.timelineDay = today;
  const start = weekStartOf(state.timelineDay),
    weekday = { format: (d) => ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"][d.getUTCDay()] },
    month = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" }),
    nav = el("div", undefined, "week-nav"),
    prev = button("‹", () => selectDay(addDays(state.timelineDay, -7)), "week-arrow"),
    next = button("›", () => selectDay(addDays(state.timelineDay, 7)), "week-arrow"),
    label = el("strong", month.format(new Date(`${addDays(start, 3)}T00:00:00Z`)), "week-label"),
    days = el("div", undefined, "week-days");
  prev.setAttribute("aria-label", "สัปดาห์ก่อน");
  next.setAttribute("aria-label", "สัปดาห์ถัดไป");
  next.disabled = addDays(start, 7) > last;
  nav.append(prev, label);
  if (state.timelineDay !== today)
    nav.append(button("กลับไปวันนี้", () => selectDay(today), "chip-button week-today"));
  nav.append(next);
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i),
      b = el("button", undefined, "day-pill"),
      items = scheduleFor(date),
      count = items.length;
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(date === state.timelineDay));
    b.setAttribute("aria-label", `${friendlyDay(date)}${count ? ` ${count} รายการ` : ""}`);
    if (date === today) b.classList.add("is-today");
    if (date < today) b.classList.add("is-past-day");
    b.disabled = date > last;
    b.append(
      el("small", weekday.format(new Date(`${date}T00:00:00Z`))),
      el("strong", String(Number(date.slice(8)))),
      el(
        "i",
        undefined,
        !count ? "" : items.every((x) => x.kind === "done" || x.done) ? "has-items all-done" : "has-items",
      ),
    );
    b.addEventListener("click", () => selectDay(date));
    days.append(b);
  }
  host.replaceChildren(nav, days);
}
// Summary for the selected day, counted from confirmed records only.
function renderDaySummary(date, list) {
  const host = $("day-summary");
  if (!host) return;
  const rows = state.records.filter((r) => recordDate(r) === date),
    meals = rows.filter((r) => r.kind === "meal"),
    acts = rows.filter((r) => r.kind === "activity"),
    meds = rows.filter((r) => r.kind === "medication" && r.data.state === "reported_taken");
  let lo = 0,
    hi = 0,
    minutes = 0;
  for (const m of meals) {
    const k = state.energies[m.id]?.kcal;
    if (Array.isArray(k) && k.every(Number.isFinite)) {
      lo += k[0];
      hi += k[1];
    }
  }
  for (const r of acts)
    if (r.data.start && r.data.end)
      minutes += (Date.parse(r.data.end) - Date.parse(r.data.start)) / 60000;
  const daily = date === bangkokParts().date ? currentDaily() : dayCache.get(date),
    total = list.length,
    done = list.filter((x) => x.kind === "done" || x.done).length,
    nothing = !total && !meals.length && !acts.length && !meds.length,
    pct = total ? Math.round((done / total) * 100) : 0,
    ring = el("div", undefined, "agenda-ring"),
    text = el("div", undefined, "agenda-progress"),
    stats = el("p", undefined, "agenda-stats");
  ring.style.setProperty("--progress", pct);
  ring.append(el("span", `${pct}%`));
  text.append(
    el("strong", total ? `ทำแล้ว ${done} จาก ${total} รายการ` : "ยังไม่มีรายการ"),
    stats,
  );
  const stat = (emoji, value) => {
    const n = el("span");
    n.append(el("i", emoji), document.createTextNode(` ${value}`));
    return n;
  };
  stats.append(
    stat("🍽️", `${meals.length} มื้อ${lo || hi ? ` · ${lo === hi ? lo : `${lo}–${hi}`} kcal` : ""}`),
    stat("🏃", `${Math.round(minutes)} นาที`),
    stat("💊", `${meds.length} ครั้ง`),
    stat("💧", daily ? `${daily.water} แก้ว` : "…"),
  );
  host.replaceChildren(ring, text);
  host.hidden = nothing;
  if (!daily && healthReady())
    api(`daily?day=${encodeURIComponent(date)}`)
      .then((r) => {
        dayCache.set(date, r.daily || { water: 0, goals: [] });
        if (state.timelineDay === date) renderDaySummary(date, list);
      })
      .catch(() => dayCache.set(date, { water: 0, goals: [] }));
}
const dayParts = [
  ["morning", "เช้า", "🌅", 5, 11],
  ["noon", "กลางวัน", "☀️", 11, 14],
  ["afternoon", "บ่าย", "🌤", 14, 17],
  ["evening", "เย็น", "🌇", 17, 21],
  ["night", "กลางคืน", "🌙", 21, 29],
];
function partOf(ms) {
  const h = Number(bangkokParts(new Date(ms).toISOString()).clock.slice(0, 2)),
    hh = h < 5 ? h + 24 : h;
  return dayParts.find(([, , , from, to]) => hh >= from && hh < to) || dayParts[4];
}
function renderTimeline() {
  const host = $("timeline");
  if (!host) return;
  const today = bangkokParts().date,
    date = state.timelineDay || today,
    isToday = date === today,
    isPastDay = date < today,
    now = Date.now(),
    list = scheduleFor(date),
    next = isToday
      ? list.find((x) => x.kind !== "done" && !x.done && x.endMs >= now)
      : null;
  $("timeline-title").textContent = isToday
    ? "ตารางวันนี้"
    : new Intl.DateTimeFormat("th-TH", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`));
  host.replaceChildren();
  renderDaySummary(date, list);
  if (!list.length) {
    const empty = el("li", undefined, "timeline-empty"),
      setup = !hasSchedule() && !isPastDay;
    empty.append(
      icon("bao"),
      el(
        "strong",
        isPastDay ? "ไม่มีบันทึกในวันนี้" : setup ? "ยังไม่มีตารางกิจวัตร" : "ยังไม่มีรายการในวันนี้",
      ),
      el(
        "p",
        isPastDay
          ? "วันนี้ยังไม่ได้จดอะไรไว้ เลือกวันอื่นด้านบนได้"
          : setup
            ? "เพิ่มกิจวัตรที่ทำประจำ แล้วให้ระบบช่วยจัดเวลา 7 วัน รายการที่จดแล้วจะขึ้นที่นี่ด้วย"
            : "จดสิ่งที่ทำวันนี้ได้เลย แล้วรายการจะขึ้นที่นี่",
      ),
    );
    host.append(empty);
    return;
  }
  const doneCount = list.filter((x) => x.kind === "done" || x.done).length,
    foldDone = isToday && !state.showDone && doneCount > 0 && doneCount < list.length;
  if (isToday && doneCount > 0 && doneCount < list.length) {
    const toggle = el("li", undefined, "agenda-fold");
    toggle.append(
      button(
        state.showDone
          ? "ซ่อนรายการที่จดแล้ว"
          : `✓ จดแล้ว ${doneCount} รายการ · แตะเพื่อดู`,
        () => {
          state.showDone = !state.showDone;
          renderTimeline();
        },
        "agenda-fold-btn",
      ),
    );
    host.append(toggle);
  }
  let part = null,
    group,
    nowShown = !isToday,
    i = 0;
  const nowLine = () => {
    const n = el("li", undefined, "agenda-now");
    n.append(el("span", `ตอนนี้ ${bangkokParts().clock}`));
    return n;
  };
  for (const x of list) {
    if (foldDone && (x.kind === "done" || x.done)) continue;
    const p = partOf(x.startMs);
    if (p !== part) {
      part = p;
      const section = el("li", undefined, "agenda-part"),
        head = el("h3", undefined, "agenda-part-title");
      head.append(el("span", p[2], "agenda-part-icon"), document.createTextNode(p[1]));
      group = el("ol", undefined, "agenda-list");
      section.append(head, group);
      host.append(section);
    }
    if (!nowShown && x.startMs > now) {
      group.append(nowLine());
      nowShown = true;
    }
    const done = x.kind === "done" || x.done,
      active = isToday && !done && x.startMs <= now && now <= x.endMs,
      past = !done && (isPastDay || (isToday && x.endMs < now)),
      li = el("li", undefined, "agenda-item tl-item"),
      icn = el("span", done ? "✓" : kindIcons[x.domain] || "•", "agenda-icon"),
      body = el("div", undefined, "agenda-body"),
      meta = el("small"),
      side = el("div", undefined, "agenda-side");
    li.classList.add(done ? "is-done" : active ? "is-active" : past ? "is-past" : "is-upcoming");
    if (x === next) li.classList.add("is-next");
    li.dataset.domain = x.domain;
    li.style.setProperty("--i", i++);
    icn.setAttribute("aria-hidden", "true");
    const time = x.start ? `${x.start}${x.end ? `–${x.end}` : ""} น.` : x.periodLabel || "ไม่ระบุเวลา";
    meta.textContent = `${time} · ${
      x.kind === "window"
        ? "ช่วงที่ตั้งไว้"
        : x.kind === "plan"
          ? "ตามตาราง"
          : x.kind === "reminder"
            ? "ที่บันทึกไว้"
            : kinds[x.domain] || "บันทึก"
    }`;
    body.append(el("strong", x.label), meta);
    const status = done
      ? ["จดแล้ว ✓", "done"]
      : active
        ? ["ตอนนี้", "now"]
        : x === next
          ? [`ถัดไป · ${relTime(x.startMs - now)}`, "next"]
          : past
            ? ["ยังไม่ได้จด", "missed"]
            : null;
    if (status) side.append(el("span", status[0], `agenda-status ${status[1]}`));
    if (!done && isToday && (x === next || active || past))
      side.append(button(domainVerb[x.domain] || "จด", () => doItem(x), "chip-button agenda-action"));
    li.append(icn, body, side);
    group.append(li);
  }
  if (!nowShown && group) group.append(nowLine());
}
function renderToday() {
  const eyebrow = $("today-eyebrow");
  if (eyebrow)
    eyebrow.textContent = new Intl.DateTimeFormat("th-TH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Asia/Bangkok",
    }).format(new Date());
  renderNextUp();
  renderWeekStrip();
  renderTimeline();
}
// Light haptic tick on supported phones (Android); silent elsewhere.
function tap() {
  if (!calmMotion()) navigator.vibrate?.(8);
}
// Greeting and a short encouragement. Counts only; never health advice.
function renderBuddy() {
  const hour = Number(bangkokParts().clock.slice(0, 2));
  $("greeting-text").textContent =
    hour >= 5 && hour < 11
      ? "อรุณสวัสดิ์"
      : hour < 16 && hour >= 11
        ? "สวัสดีตอนบ่าย"
        : hour >= 16 && hour < 19
          ? "สวัสดีตอนเย็น"
          : "สวัสดีตอนค่ำ";
  const d = currentDaily(),
    day = bangkokParts().date,
    logged = state.records.filter(
      (r) => r.kind !== "consent" && r.kind !== "profile" && recordDate(r) === day,
    ).length,
    allDone = d.goals.length > 0 && d.goals.every((g) => g.done);
  $("buddy-message").textContent = allDone
    ? "ครบทุกเป้าหมายของวันนี้แล้ว เยี่ยมมากเลย 🎉"
    : logged
      ? `วันนี้จดไปแล้ว ${logged} รายการ ค่อย ๆ ทำไปด้วยกันนะ`
      : "เริ่มจดมื้อแรกหรือกิจกรรมแรกของวันกันไหม";
  document
    .querySelectorAll(".today-header")
    .forEach((n) => n.classList.toggle("all-done", allDone));
}
function openGoalEditor(g) {
  $("operation-title").textContent = "แก้เป้าหมาย";
  const input = el("input");
  input.value = g.label;
  input.maxLength = 120;
  input.setAttribute("aria-label", "ชื่อเป้าหมาย");
  $("operation-details").replaceChildren(
    input,
    button(
      "ลบเป้าหมายนี้",
      async () => {
        await saveDaily(
          (d) => (d.goals = d.goals.filter((x) => x.id !== g.id)),
        );
        $("operation-dialog").close();
      },
      "danger-btn",
    ),
  );
  operation = {
    custom: async () => {
      if (!input.value.trim()) throw new Error("กรุณาใส่ชื่อเป้าหมาย");
      await saveDaily(
        (d) => (d.goals.find((x) => x.id === g.id).label = input.value.trim()),
      );
    },
  };
  $("confirm-operation").disabled = false;
  $("confirm-operation").textContent = "บันทึกเป้าหมาย";
  $("operation-status").textContent = "";
  openDialog("operation-dialog");
}
$("goal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, async () => {
    if (currentDaily().goals.length >= 20)
      throw new Error("เพิ่มได้สูงสุด 20 เป้าหมาย");
    await saveDaily((d) =>
      d.goals.push({
        id: crypto.randomUUID(),
        label: $("new-goal").value.trim(),
        done: false,
      }),
    );
    $("new-goal").value = "";
  });
});
$("add-water").addEventListener("click", () =>
  run($("add-water"), () => tap() ||
    saveDaily((d) => {
      if (d.water >= 50) throw new Error("ตรวจจำนวนแก้วก่อนเพิ่ม");
      d.water++;
    }),
  ),
);
$("remove-water").addEventListener("click", () =>
  run($("remove-water"), () =>
    saveDaily((d) => (d.water = Math.max(0, d.water - 1))),
  ),
);

/* Confirmed records only. No dummy trends or default medication orders. */
function stampLabel(r) {
  const j = r.journal;
  if (j)
    return `${friendlyDay(j.date)} · ${j.clock ? `${j.clock.slice(0, 5)} น.` : periods[j.period] || "ไม่ระบุเวลา"}`;
  const stamp = r.data.occurred_at || r.data.start;
  if (!stamp) return "ไม่ระบุเวลา";
  const parts = bangkokParts(stamp);
  return `${friendlyDay(parts.date)} · ${parts.clock} น.`;
}
const kindIcons = {
  meal: "🍽️",
  activity: "🏃",
  sleep: "😴",
  medication: "💊",
  appointment: "📅",
  measurement: "🩸",
  wellbeing: "📝",
  routine: "🔁",
  constraint: "⏰",
  profile: "💜",
  feedback: "💬",
};
const measureNames = { glucose: "น้ำตาลในเลือด", weight: "น้ำหนัก" };
function recordTitle(r) {
  if (r.kind === "measurement" && measureNames[r.data.name])
    return measureNames[r.data.name];
  return (
    r.data.name ||
    r.data.label ||
    r.data.note ||
    r.text ||
    kinds[r.kind] ||
    r.kind
  );
}
function renderSources(target, sources) {
  if (!Array.isArray(sources)) return;
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    const href = safeSourceUrl(s.url),
      text = [s.publisher, s.heading || s.name, s.basis, s.location]
        .filter((x) => typeof x === "string")
        .join(" · ");
    if (href) {
      const a = el("a", text || "อ่านแหล่งอ้างอิง", "source-link");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      target.append(a);
    } else if (text) target.append(el("small", text, "source-link"));
  }
}
function renderEnergy(target, e, withLabel = true) {
  if (withLabel) target.append(el("p", energyText(e), "energy-label"));
  if (e?.assumption) target.append(el("small", e.assumption));
  if (e?.note) target.append(el("small", e.note));
  if (Array.isArray(e?.components))
    for (const item of e.components) {
      const part = el("div", undefined, "energy-component");
      part.append(el("span", item.name || "ส่วนประกอบ"));
      renderEnergy(part, item.energy || item);
      target.append(part);
    }
  if (e?.reference) renderSources(target, [e.reference]);
}
const expandedLists = new Set();
const RECORD_PREVIEW = 6;
function recordValue(r) {
  if (r.kind === "measurement")
    return `${r.data.value ?? "ยังไม่ระบุ"} ${r.data.unit || ""}${r.data.context && r.data.context !== "unknown" ? ` · ${contextLabels[r.data.context] || r.data.context}` : ""}`;
  if (r.kind === "medication")
    return `${r.data.dose != null ? `${r.data.dose} ${r.data.unit || ""} · ` : ""}${optionLabels[r.data.state] || "ยังไม่ระบุสถานะ"}`;
  if (["activity", "sleep"].includes(r.kind))
    return r.data.start && r.data.end
      ? `${Math.round((Date.parse(r.data.end) - Date.parse(r.data.start)) / 60000)} นาที`
      : "ยังระบุระยะเวลาไม่ครบ";
  if (r.kind === "meal") return energyText(state.energies[r.id]);
  return "";
}
function recordCard(r) {
  const card = el("article", undefined, "saved-record"),
    main = el("div", undefined, "record-main"),
    value = recordValue(r),
    actions = el("div", undefined, "record-actions"),
    more = el("details", undefined, "record-more"),
    symbol = el("span", kindIcons[r.kind] || "•", "record-icon");
  card.dataset.kind = r.kind;
  symbol.setAttribute("aria-hidden", "true");
  main.append(el("h3", recordTitle(r)));
  if (value) {
    const known = r.kind !== "meal" || Array.isArray(state.energies[r.id]?.kcal);
    main.append(
      el(
        "p",
        value,
        r.kind === "meal"
          ? `record-value energy-label${known ? "" : " is-unknown"}`
          : "record-value",
      ),
    );
  }
  main.append(el("small", stampLabel(r), "record-time"));
  actions.append(
    button(
      "แก้ไข",
      () => {
        if (r.kind === "profile") openHealthProfile();
        else openDraft([{ ...recordFromStored(r), previous_id: r.id }]);
      },
      "chip-button",
    ),
    button(
      "ลบ",
      () => previewDelete({ scope: "records", record_ids: [r.id] }),
      "chip-button danger",
    ),
  );
  more.append(el("summary", "รายละเอียด"));
  if (r.kind === "meal") renderEnergy(more, state.energies[r.id], false);
  if (r.journal?.clock_source === "capture_time")
    more.append(el("small", "เวลา: ใช้เวลาที่พิมพ์บันทึก"));
  more.append(
    el(
      "small",
      `${kinds[r.kind] || r.kind} · เวอร์ชัน ${r.version}${r.source ? ` · ${r.source}` : ""}`,
    ),
  );
  card.append(symbol, main, actions, more);
  return card;
}
function renderRecordList(id, records) {
  const target = $(id);
  target.replaceChildren();
  if (!records.length) {
    const empty = el("div", undefined, "empty-state");
    empty.append(icon("bao"), el("p", "ยังไม่มีบันทึกในหมวดนี้"));
    target.append(empty);
    return;
  }
  const dayOf = (r) => recordDate(r) || (r.created_at || "").slice(0, 10),
    sorted = records
      .slice()
      .sort(
        (a, b) =>
          dayOf(b).localeCompare(dayOf(a)) ||
          (b.created_at || "").localeCompare(a.created_at || ""),
      ),
    shown = expandedLists.has(id) ? sorted : sorted.slice(0, RECORD_PREVIEW);
  let day = null,
    group;
  for (const r of shown) {
    if (dayOf(r) !== day) {
      day = dayOf(r);
      target.append(el("h3", friendlyDay(day), "record-day"));
      group = el("div", undefined, "record-group");
      target.append(group);
    }
    group.append(recordCard(r));
  }
  if (sorted.length > shown.length)
    target.append(
      button(
        `ดูเพิ่มอีก ${sorted.length - shown.length} รายการ`,
        () => {
          expandedLists.add(id);
          renderRecordList(id, records);
        },
        "secondary-btn show-more",
      ),
    );
}
function renderAll() {
  renderHealthProfile();
  renderDaily();
  const day = bangkokParts().date,
    today = state.records.filter((r) => recordDate(r) === day),
    glucose = state.records
      .filter(
        (r) =>
          r.kind === "measurement" &&
          r.data.name === "glucose" &&
          r.data.unit === "mg/dL",
      )
      .sort((a, b) =>
        (b.data.occurred_at || "").localeCompare(a.data.occurred_at || ""),
      )[0];
  setValue($("dashboard-sugar"), glucose?.data.value ?? "—");
  $("sugar-timestamp").textContent = glucose
    ? stampLabel(glucose)
    : "ยังไม่มีบันทึก";
  setValue($("meal-count"), today.filter((r) => r.kind === "meal").length);
  $("meal-energy-summary").textContent = state.summary.energy_summary
    ? energyText(state.summary.energy_summary)
    : "ยังไม่มีบันทึก";
  const activities = today.filter((r) => r.kind === "activity");
  let minutes = 0,
    incomplete = 0;
  for (const r of activities) {
    if (r.data.start && r.data.end)
      minutes += (Date.parse(r.data.end) - Date.parse(r.data.start)) / 60000;
    else incomplete++;
  }
  $("exercise-summary").textContent =
    !activities.length || !activities.some((r) => r.data.start && r.data.end)
      ? "—"
      : Math.round(minutes);
  $("exercise-total").textContent = $("exercise-summary").textContent;
  const activityNote = activities.length
    ? `${activities.length} ครั้ง${incomplete ? ` · ${incomplete} รายการยังไม่ระบุเวลา` : ""}`
    : "ยังไม่มีบันทึก";
  $("exercise-mini-bar").textContent = activityNote;
  $("exercise-message").textContent = activities.length
    ? `วันนี้ขยับร่างกาย ${activityNote}`
    : "ยังไม่มีบันทึกกิจกรรมวันนี้";
  $("medicine-summary").textContent = today.filter(
    (r) => r.kind === "medication" && r.data.state === "reported_taken",
  ).length;
  document.querySelectorAll(".meal-tab").forEach((tab) => {
    const p = { เช้า: "morning", กลางวัน: "noon", เย็น: "evening" }[
      tab.dataset.meal
    ];
    tab.querySelector("small").textContent = today.some(
      (r) => r.kind === "meal" && r.journal?.period === p,
    )
      ? "มีบันทึกแล้ว"
      : "ยังไม่มีบันทึก";
  });
  renderRecordList(
    "food-records",
    state.records.filter((r) => r.kind === "meal"),
  );
  renderRecordList(
    "activity-records",
    state.records.filter((r) => r.kind === "activity"),
  );
  renderRecordList(
    "medicine-records",
    state.records.filter((r) => r.kind === "medication"),
  );
  renderRecordList(
    "health-records",
    state.records.filter(
      (r) => !["meal", "activity", "medication", "consent"].includes(r.kind),
    ),
  );
  renderChart();
  renderPlans();
  renderBuddy();
  renderToday();
}
let chartGroups = new Map();
const methodLabels = { self_monitor: "วัดเอง", lab: "ผลจากห้องแล็บ" };
function renderChart() {
  const selected = $("chart-group").value;
  chartGroups = measurementGroups(state.records);
  $("chart-group").replaceChildren();
  for (const [key] of chartGroups) {
    const [, context, method, origin] = key.split("|"),
      o = el(
        "option",
        `${contextLabels[context] || context}${method === "self_monitor" && origin === "self_report" ? "" : ` · ${methodLabels[method] || method}`}`,
      );
    o.value = key;
    $("chart-group").append(o);
  }
  if (chartGroups.has(selected)) $("chart-group").value = selected;
  $("chart-group").hidden = chartGroups.size < 2;
  $("chart-group-label").hidden = chartGroups.size < 2;
  drawChart();
}
function drawChart() {
  const rows = (chartGroups.get($("chart-group").value) || []).slice(-7);
  document.querySelector(".chart-wrap").hidden = !rows.length;
  $("chart-empty").hidden = !!rows.length;
  if (!rows.length) {
    $("chart-latest").textContent = "—";
    return;
  }
  const values = rows.map((r) => r.data.value),
    lo = Math.floor(Math.min(...values) - 10),
    hi = Math.ceil(Math.max(...values) + 10),
    span = hi - lo,
    points = values.map((v, i) => ({
      x: values.length === 1 ? 280 : (i / (values.length - 1)) * 560,
      y: 20 + ((hi - v) / span) * 150,
    })),
    path = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  $("chart-line").setAttribute("d", path);
  $("chart-area").setAttribute(
    "d",
    `${path} L ${points.at(-1).x} 190 L ${points[0].x} 190 Z`,
  );
  $("chart-dots").replaceChildren(
    ...points.map((p) => {
      const c = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      c.setAttribute("cx", p.x);
      c.setAttribute("cy", p.y);
      c.setAttribute("r", "6");
      return c;
    }),
  );
  $("chart-y").replaceChildren(
    ...[hi, hi - span / 3, lo + span / 3, lo].map((v) =>
      el("span", Math.round(v)),
    ),
  );
  $("chart-x").replaceChildren(
    ...rows.map((r) =>
      el("span", bangkokParts(r.data.occurred_at).date.slice(5)),
    ),
  );
  $("chart-latest").textContent = values.at(-1);
}
$("chart-group").addEventListener("change", drawChart);

/* The editor follows services/schemas.py, including unknown values and meal parts. */
const fields = {
  meal: [
    ["name", "ชื่ออาหาร"],
    ["quantity", "ปริมาณ", "number"],
    ["unit", "หน่วย"],
    ["food_state", "สถานะอาหาร", ["unknown", "cooked", "raw", "packaged"]],
  ],
  activity: [
    ["name", "ชื่อกิจกรรม"],
    ["end", "เวลาสิ้นสุด", "datetime"],
    ["method", "วิธีบันทึก", ["self_report", "device_estimate", "measured"]],
    ["intensity", "ความหนัก (ถ้าทราบ)"],
  ],
  sleep: [
    ["end", "เวลาตื่น / สิ้นสุด", "datetime"],
    [
      "method",
      "ข้อมูลการนอน",
      ["self_report_sleep", "time_in_bed", "device_estimate"],
    ],
    ["episode", "ประเภท", ["main", "nap"]],
    ["quality", "คุณภาพการนอน"],
  ],
  medication: [
    ["name", "ชื่อยา"],
    ["dose", "ขนาดที่รับประทาน", "number"],
    ["unit", "หน่วย"],
    ["instruction_source", "คำสั่งจากแพทย์ / เภสัชกร"],
    [
      "state",
      "สถานะ",
      ["unknown", "reported_taken", "reminder_due", "acknowledged"],
    ],
  ],
  appointment: [
    ["name", "ชื่อนัดหมาย"],
    ["end", "เวลาสิ้นสุด", "datetime"],
    ["location", "สถานที่"],
  ],
  measurement: [
    [
      "name",
      "ชนิดค่าที่วัด",
      [
        "glucose",
        "weight",
        "height",
        "waist",
        "hba1c",
        "systolic",
        "diastolic",
      ],
    ],
    ["value", "ค่าที่วัด", "number"],
    ["unit", "หน่วย"],
    ["context", "บริบท", ["unknown", "fasting", "after_meal", "random"]],
    ["method", "วิธีวัด"],
  ],
  wellbeing: [["note", "บันทึกความรู้สึก"]],
  profile: [
    ["age", "อายุ", "number"],
    ["weight_kg", "น้ำหนัก (กก.)", "number"],
    ["height_cm", "ส่วนสูง (ซม.)", "number"],
    ["conditions", "ภาวะสุขภาพ (คั่นด้วย ,)", "list"],
    ["medications", "ยาประจำ (คั่นด้วย ,)", "list"],
    ["allergies", "การแพ้อาหาร (เว้นว่าง = ยังไม่ทราบ)", "allergies"],
    ["preferences", "อาหารที่ชอบ (คั่นด้วย ,)", "list"],
    ["goals", "เป้าหมาย (คั่นด้วย ,)", "list"],
    ["mobility_limits", "ข้อจำกัดการเคลื่อนไหว (คั่นด้วย ,)", "list"],
    ["pregnant", "การตั้งครรภ์", "boolean"],
    ["complex_care", "อยู่ในการดูแลซับซ้อน", "boolean"],
    ["reported_type2", "ได้รับแจ้งว่าเป็นเบาหวานชนิดที่ 2", "boolean"],
  ],
  routine: [
    [
      "domain",
      "หมวดกิจวัตร",
      [
        "meal",
        "activity",
        "sleep",
        "medication",
        "appointment",
        "measurement",
        "wellbeing",
      ],
    ],
    ["label", "ชื่อกิจวัตร"],
    ["dates", "วันที่ ปี-เดือน-วัน (คั่นด้วย ,)", "list"],
    ["earliest", "เริ่มได้ตั้งแต่", "time"],
    ["latest", "เริ่มได้ช้าที่สุด", "time"],
    ["duration_minutes", "ระยะเวลา (นาที)", "number"],
    ["fixed", "ล็อกเวลา", "boolean"],
    ["goal", "เป้าหมายกิจวัตร"],
    ["instruction_source", "แหล่งคำสั่งใช้ยา"],
    [
      "meal_relation",
      "สัมพันธ์กับมื้อ",
      ["none", "before", "after", "with", "unknown"],
    ],
    ["related_routine_id", "รหัสกิจวัตรมื้อที่สัมพันธ์"],
    ["relation_minutes", "ระยะห่างจากมื้อ (นาที)", "number"],
  ],
  constraint: [
    ["label", "ชื่อช่วงที่ไม่ว่าง"],
    ["start", "เริ่ม", "datetime"],
    ["end", "สิ้นสุด", "datetime"],
  ],
  feedback: [
    ["plan_id", "รหัสแผน"],
    ["reason", "เหตุผล"],
    ["occurred_at", "เวลา", "datetime"],
  ],
};
const optionLabels = {
  unknown: "ยังไม่ทราบ",
  cooked: "ปรุงสุก",
  raw: "ดิบ",
  packaged: "บรรจุสำเร็จ",
  self_report: "รายงานด้วยตนเอง",
  device_estimate: "ค่าจากอุปกรณ์",
  measured: "วัดจริง",
  self_report_sleep: "เวลาที่รายงานว่าหลับ",
  time_in_bed: "เวลาบนเตียง",
  main: "นอนหลัก",
  nap: "งีบ",
  reported_taken: "รับประทานแล้ว",
  reminder_due: "เตือนเมื่อถึงเวลา",
  acknowledged: "รับทราบ",
  glucose: "น้ำตาล",
  weight: "น้ำหนัก",
  height: "ส่วนสูง",
  waist: "รอบเอว",
  hba1c: "HbA1c",
  systolic: "ความดันตัวบน",
  diastolic: "ความดันตัวล่าง",
  ...contextLabels,
  ...kinds,
  none: "ไม่มี",
  before: "ก่อนมื้อ",
  after: "หลังมื้อ",
  with: "พร้อมมื้อ",
};
function fieldControl(text, type, value) {
  const label = el("label", undefined, "editor-field");
  label.append(el("span", text));
  let input;
  if (Array.isArray(type) || type === "boolean") {
    input = el("select");
    for (const v of type === "boolean"
      ? ["", "true", "false"]
      : ["", ...type]) {
      const o = el(
        "option",
        v === ""
          ? "ยังไม่ระบุ"
          : v === "true"
            ? "ใช่"
            : v === "false"
              ? "ไม่ใช่"
              : optionLabels[v] || v,
      );
      o.value = v;
      input.append(o);
    }
    input.value = value == null ? "" : String(value);
  } else {
    input = el("input");
    input.type =
      type === "datetime"
        ? "datetime-local"
        : type === "number"
          ? "number"
          : type === "time"
            ? "time"
            : "text";
    if (type === "number") {
      input.step = "any";
      input.min = "0";
    }
    input.maxLength = type === "list" ? 1000 : 300;
    input.value =
      type === "datetime"
        ? value
          ? `${bangkokParts(value).date}T${bangkokParts(value).clock}`
          : ""
        : Array.isArray(value)
          ? value.join(", ")
          : (value ?? "");
  }
  label.append(input);
  return {
    label,
    input,
    read: () => {
      const v = input.value.trim();
      if (type === "number") return v === "" ? null : Number(v);
      if (type === "datetime") return v ? `${v}:00+07:00` : null;
      if (type === "boolean") return v === "" ? null : v === "true";
      if (type === "list")
        return v === ""
          ? []
          : v
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
      if (type === "allergies")
        return v === ""
          ? null
          : v
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
      return v || null;
    },
  };
}
function invalidateDraft() {
  if (!draft || draft.locked) return;
  draft.revision++;
  draft.preview = null;
  draft.key = null;
  $("confirm-draft").disabled = true;
  $("draft-checks").replaceChildren();
  $("draft-status").textContent = "มีการแก้ไข กรุณาตรวจข้อมูลอีกครั้ง";
}
function createDraftCard(record) {
  let data = structuredClone(record),
    timeChanged = false,
    energySeq = 0,
    energyTimer,
    controls = [],
    journalControls,
    parts = [],
    energyArea;
  const card = el("section", undefined, "draft-card"),
    keep = el("input");
  keep.type = "checkbox";
  keep.checked = true;
  const label = el("label", undefined, "consent-option");
  label.append(keep, el("strong", "เลือกรายการนี้"));
  card.append(label);
  const kindField = fieldControl("หมวดรายการ", Object.keys(kinds), data.kind);
  card.append(kindField.label);
  const body = el("div", undefined, "editor-grid");
  card.append(body);
  function build() {
    body.replaceChildren();
    controls = [];
    parts = [];
    journalControls = null;
    timeChanged = false;
    energyArea = null;
    if (data.journal) {
      const j = data.journal,
        date = fieldControl("วันที่", "text", j.date);
      date.input.type = "date";
      const clock = fieldControl(
          j.clock_source === "capture_time"
            ? "เวลาที่พิมพ์ · แก้ได้"
            : "เวลาที่ระบุ (เว้นว่างได้)",
          "time",
          (j.clock || "").slice(0, 5),
        ),
        period = fieldControl("ช่วงเวลา", Object.keys(periods), j.period);
      for (const o of period.input.options)
        o.textContent = periods[o.value] || "ยังไม่ระบุ";
      clock.input.addEventListener("input", () => (timeChanged = true));
      journalControls = { date, clock, period };
      body.append(date.label, clock.label, period.label);
    }
    for (const [key, text, type] of fields[data.kind] || []) {
      const c = fieldControl(text, type, data.data[key]);
      controls.push({ key, ...c });
      body.append(c.label);
    }
    if (data.kind === "profile") {
      const l = el("label", undefined, "consent-option"),
        n = el("input");
      n.type = "checkbox";
      n.checked =
        Array.isArray(data.data.allergies) && !data.data.allergies.length;
      l.append(n, el("span", "ยืนยันว่าไม่มีการแพ้อาหารที่ทราบ"));
      body.append(l);
      controls.push({ key: "_no_allergies", read: () => n.checked });
      const allergies = controls.find((c) => c.key === "allergies");
      allergies.input.addEventListener("input", () => {
        if (allergies.input.value.trim()) n.checked = false;
      });
      n.addEventListener("change", () => {
        if (n.checked) allergies.input.value = "";
      });
    }
    if (data.kind === "meal") {
      const container = el("div", undefined, "component-editor");
      body.append(container);
      function addPart(v = {}) {
        const row = el("div", undefined, "component-row"),
          cc = [
            ["name", "ชื่อส่วนประกอบ"],
            ["quantity", "ปริมาณ", "number"],
            ["unit", "หน่วย"],
            ["food_state", "สถานะ", ["unknown", "cooked", "raw", "packaged"]],
          ].map(([key, text, type]) => ({
            key,
            ...fieldControl(text, type, v[key]),
          }));
        row.append(...cc.map((c) => c.label));
        const part = { row, controls: cc };
        parts.push(part);
        row.append(
          button(
            "นำส่วนประกอบออก",
            () => {
              parts = parts.filter((p) => p !== part);
              row.remove();
              invalidateDraft();
              queueEnergy();
            },
            "text-button",
          ),
        );
        container.append(row);
      }
      for (const part of data.data.components || []) addPart(part);
      body.append(
        button("＋ เพิ่มส่วนประกอบในมื้อ", () => {
          if (parts.length >= 30)
            throw new Error("เพิ่มได้สูงสุด 30 ส่วนประกอบ");
          addPart();
          invalidateDraft();
          queueEnergy();
        }),
      );
      energyArea = el("div", undefined, "draft-energy");
      body.append(energyArea);
    }
  }
  function read() {
    const r = structuredClone(data);
    r.evidence = {};
    for (const c of controls) {
      if (c.key === "_no_allergies") continue;
      const v = c.read();
      if (v === null) delete r.data[c.key];
      else r.data[c.key] = v;
    }
    if (data.kind === "profile") {
      if (controls.find((c) => c.key === "_no_allergies")?.read())
        r.data.allergies = [];
      else if (r.data.allergies === undefined) r.data.allergies = null;
    }
    if (journalControls)
      applyJournalTime(
        r,
        journalControls.date.input.value,
        journalControls.clock.input.value,
        journalControls.period.input.value || "unspecified",
        timeChanged,
      );
    if (data.kind === "meal") {
      if (parts.length) {
        r.data.components = parts.map((p) =>
          Object.fromEntries(p.controls.map((c) => [c.key, c.read()])),
        );
        delete r.data.quantity;
        delete r.data.unit;
      } else delete r.data.components;
    }
    r.text = String(
      r.data.name || r.data.label || r.data.note || kinds[r.kind],
    ).slice(0, 120);
    return r;
  }
  async function estimate(seq) {
    if (!energyArea || !draft || draft.locked) return;
    energyArea.replaceChildren(el("small", "กำลังประเมินพลังงาน…"));
    try {
      const d = read().data,
        b = Object.fromEntries(
          ["name", "quantity", "unit", "food_state", "components"]
            .filter((k) => d[k] !== undefined)
            .map((k) => [k, d[k]]),
        ),
        energy = await post("ai/food-energy", b);
      if (seq !== energySeq || !card.isConnected) return;
      energyArea.replaceChildren();
      renderEnergy(energyArea, energy);
    } catch (e) {
      if (seq === energySeq && card.isConnected)
        energyArea.replaceChildren(el("small", errorMessage(e)));
    }
  }
  function queueEnergy() {
    if (!energyArea) return;
    const seq = ++energySeq;
    energyArea.replaceChildren(el("small", "ค่าพลังงานเดิมถูกล้างหลังแก้ไข"));
    clearTimeout(energyTimer);
    energyTimer = setTimeout(() => run(null, () => estimate(seq)), 1000);
  }
  kindField.input.addEventListener("change", () => {
    const kind = kindField.input.value;
    if (!kinds[kind]) return;
    if (data.previous_id) {
      kindField.input.value = data.kind;
      showToast(
        "รายการเดิมเปลี่ยนหมวดไม่ได้",
        "สร้างบันทึกใหม่หากต้องการเปลี่ยนหมวด",
      );
      return;
    }
    data = newRecord(kind, data.journal?.captured_at || draft.captured);
    build();
    invalidateDraft();
  });
  card.addEventListener("input", () => {
    invalidateDraft();
    queueEnergy();
  });
  keep.addEventListener("change", invalidateDraft);
  build();
  return { card, keep, read };
}
async function openDraft(
  records,
  captured = new Date().toISOString(),
  onSaved,
) {
  if (!canHealth()) return;
  if (!records?.length) {
    showToast("ยังไม่มีรายการที่แยกได้", "ลองกรอกด้วยตนเอง");
    return;
  }
  if (records.length > 29) throw new Error("ตรวจได้ครั้งละไม่เกิน 29 รายการ");
  if ($("draft-dialog").open)
    throw new Error("กรุณายืนยันหรือยกเลิกร่างที่เปิดอยู่ก่อน");
  draft = {
    captured,
    onSaved,
    preview: null,
    key: null,
    cards: [],
    locked: false,
    revision: 0,
  };
  $("draft-items").replaceChildren();
  $("draft-checks").replaceChildren();
  $("draft-status").textContent = "ยังไม่บันทึก จนกว่าคุณจะกดยืนยัน";
  $("confirm-draft").disabled = true;
  delete $("confirm-draft").dataset.keepDisabled;
  $("validate-draft").disabled = false;
  $("ai-storage-consent").hidden = true;
  $("ai-storage-checkbox").checked = false;
  $("ai-storage-checkbox").disabled = false;
  for (const r of records) {
    const item = createDraftCard(r);
    draft.cards.push(item);
    $("draft-items").append(item.card);
  }
  openDialog("draft-dialog");
}
$("draft-dialog").addEventListener("close", () => {
  draft = null;
  $("draft-items").replaceChildren();
});
$("validate-draft").addEventListener("click", () =>
  run($("validate-draft"), async () => {
    if (!draft || draft.locked) return;
    const records = draft.cards
      .filter((c) => c.keep.checked)
      .map((c) => c.read());
    if (!records.length) throw new Error("เลือกรายการอย่างน้อยหนึ่งรายการ");
    if ($("ai-storage-checkbox").checked)
      records.unshift({
        kind: "consent",
        data: { local_storage: true },
        source: "ผู้ใช้เลือกยินยอมเก็บข้อมูล Baobuddy ผ่าน DoBao",
      });
    const current = draft;
    const revision = current.revision;
    const r = await post("ai/records/batch-preview", {
      records,
      compact: true,
    });
    if (draft !== current || current.revision !== revision) return;
    current.preview = r;
    current.key = crypto.randomUUID();
    $("draft-checks").replaceChildren();
    for (let i = 0; i < (r.checks || []).length; i++) {
      const c = r.checks[i],
        box = el(
          "div",
          undefined,
          `check-result ${c.errors?.length ? "check-error" : ""}`,
        );
      box.append(
        el(
          "strong",
          `รายการ ${i + 1}: ${c.errors?.length ? "ต้องแก้ไข" : c.missing?.length ? "ข้อมูลยังไม่ครบ" : "ตรวจรูปแบบแล้ว"}`,
        ),
      );
      if (c.errors?.length) box.append(el("p", c.errors.join(" / ")));
      if (c.missing?.length)
        box.append(
          el(
            "p",
            `ยังไม่ระบุ: ${c.missing.join(", ")} · การบันทึกได้ไม่ได้หมายถึงผ่านการประเมินทางคลินิก`,
          ),
        );
      if (c.calculated?.energy) renderEnergy(box, c.calculated.energy);
      $("draft-checks").append(box);
    }
    $("ai-storage-consent").hidden = !r.requires_consent;
    $("confirm-draft").disabled = !r.can_confirm || r.requires_consent;
    $("draft-status").textContent = r.requires_consent
      ? "เลือกความยินยอมเก็บในบริการ Baobuddy แล้วตรวจข้อมูลอีกครั้ง"
      : r.can_confirm
        ? "ตรวจแล้ว คุณกดยืนยันเพื่อบันทึกได้"
        : "กรุณาแก้ข้อมูลแล้วตรวจอีกครั้ง";
  }),
);
$("ai-storage-checkbox").addEventListener("change", invalidateDraft);
$("confirm-draft").addEventListener("click", () =>
  run($("confirm-draft"), async () => {
    const current = draft;
    const ownerEpoch = epoch;
    if (!current?.preview?.can_confirm || current.preview.requires_consent)
      return;
    current.locked = true;
    current.cards.forEach((c) =>
      c.card
        .querySelectorAll("input,select,button")
        .forEach((n) => (n.disabled = true)),
    );
    $("validate-draft").disabled = true;
    $("ai-storage-checkbox").disabled = true;
    $("draft-status").textContent =
      "กำลังยืนยัน… หากเครือข่ายขาดให้ลองยืนยันรายการเดิมอีกครั้ง";
    try {
      const r = await post("ai/confirm", {
        draft_id: current.preview.draft_id,
        idempotency_key: current.key,
        confirmed: true,
      });
      if (draft !== current) return;
      $("draft-dialog").close();
      $("journal-dialog").close();
      showToast(
        "บันทึกข้อมูลแล้ว",
        r.projection_synced
          ? "ซิงก์ข้อมูลเรียบร้อย"
          : "บันทึกแล้ว แต่ยังโหลดข้อมูลล่าสุดไม่ครบ กรุณาโหลดใหม่",
      );
      await refreshAll();
      if (ownerEpoch === epoch && state.user) current.onSaved?.(r);
    } catch (e) {
      $("draft-status").textContent =
        e.status === 404
          ? "ร่างหมดอายุ กรุณาปิดและโหลดประวัติเพื่อตรวจว่าเคยยืนยันสำเร็จแล้วหรือไม่ ก่อนสร้างร่างใหม่"
          : errorMessage(e);
      if (e.status === 404) {
        current.preview = null;
        $("confirm-draft").dataset.keepDisabled = "1";
      }
      throw e;
    }
  }),
);

/* Manual input uses deterministic validation/storage, without model generation. */
function readMealForm() {
  return manualMealRecord({
    name: $("meal-name").value,
    quantity: $("meal-quantity").value,
    unit: $("meal-unit").value,
    date: $("meal-date").value,
    time: $("meal-time").value,
    period: $("meal-period").value,
    foodState: $("meal-state").value,
  });
}
function resetEntry(form) {
  $(form).reset();
  setEntryDates();
}
function setEntryDates() {
  for (const id of ["meal-date", "activity-date", "med-date"])
    if (!$(id).value) $(id).value = bangkokParts().date;
}
$("meal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, () =>
    reviewManual([readMealForm()], () => resetEntry("meal-form"), "", { fast: true }),
  );
});
$("meal-components").addEventListener("click", () =>
  run($("meal-components"), () => {
    if (!$("meal-form").reportValidity()) return;
    return openDraft([readMealForm()]);
  }),
);
$("activity-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, () =>
    reviewManual(
      [
        manualActivityRecord({
          name: $("activity-name").value,
          date: $("activity-date").value,
          time: $("activity-time").value,
          duration: $("activity-duration").value,
          intensity: $("activity-intensity").value,
        }),
      ],
      () => resetEntry("activity-form"),
      "",
      { fast: true },
    ),
  );
});

function reviewSummary(records) {
  const target = $("manual-review-details");
  target.replaceChildren();
  for (const record of records) {
    const card = el("section", undefined, "review-card");
    card.append(el("h3", kinds[record.kind]));
    if (record.text) card.append(el("p", record.text, "review-original"));
    const labels = {
      ...Object.fromEntries(
        (fields[record.kind] || []).map(([key, label]) => [key, label]),
      ),
      ...healthProfileFields,
      occurred_at: "เวลา",
      start: "เวลาเริ่ม",
      end: "เวลาสิ้นสุด",
    };
    if (record.journal)
      card.append(
        el(
          "p",
          `วันที่ ${record.journal.date}${record.journal.clock ? ` เวลา ${record.journal.clock.slice(0, 5)}` : " · ยังไม่ระบุเวลา"}`,
        ),
      );
    const list = el("dl");
    for (const [key, value] of Object.entries(record.data)) {
      if (
        !labels[key] ||
        (["occurred_at", "start"].includes(key) && record.journal)
      )
        continue;
      let text = value;
      if (Array.isArray(value))
        text = value.length
          ? value.join(" / ")
          : key === "allergies"
            ? "ไม่มีประวัติแพ้ที่ทราบ"
            : "ยังไม่ระบุ";
      else if (value === null || value === "") text = "ยังไม่ทราบ";
      else if (typeof value === "boolean") text = value ? "ใช่" : "ไม่ใช่";
      else if (key === "end")
        text = new Intl.DateTimeFormat("th-TH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Bangkok",
        }).format(new Date(value));
      else text = optionLabels[value] || value;
      list.append(el("dt", labels[key]), el("dd", String(text)));
    }
    card.append(list);
    if (record.data.components?.length) {
      const parts = el("ul");
      for (const part of record.data.components)
        parts.append(
          el(
            "li",
            `${part.name}${part.quantity != null ? " · " + part.quantity : ""}${part.unit ? " " + part.unit : ""}`,
          ),
        );
      card.append(parts);
    }
    target.append(card);
  }
}
/* Manual entry (fast): the user typed it, so a passing entry is saved right
   away — no review sheet, no Baobuddy. The sheet only opens when something
   needs attention (first-time storage consent, a value that does not pass,
   or a failed save that can be retried with the same key). */
async function reviewManual(records, onSaved, note = "", { fast = false } = {}) {
  if (!canHealth()) return;
  const current = {
    records: structuredClone(records),
    onSaved,
    preview: null,
    key: null,
    locked: false,
    sequence: 0,
    note,
  };
  manualReview = current;
  $("manual-storage-consent").checked = false;
  $("manual-storage-consent").disabled = false;
  $("manual-storage-option").hidden = true;
  $("confirm-manual").disabled = true;
  $("edit-reviewed-records").disabled = false;
  delete $("confirm-manual").dataset.keepDisabled;
  reviewSummary(records);
  current.fast = fast;
  if (!fast) {
    openDialog("manual-review-dialog");
    await validateManual(current);
    return;
  }
  try {
    await validateManual(current);
  } catch (e) {
    openDialog("manual-review-dialog");
    throw e;
  }
  if (manualReview !== current) return;
  if (current.preview?.can_confirm && !current.preview.requires_consent)
    await confirmManual(current);
  else openDialog("manual-review-dialog");
}
async function validateManual(current) {
  if (!current || current.locked) return;
  const seq = ++current.sequence;
  current.preview = null;
  $("confirm-manual").disabled = true;
  $("manual-review-status").textContent = "กำลังตรวจรายการที่คุณกรอก…";
  const records = structuredClone(current.records);
  if ($("manual-storage-consent").checked)
    records.unshift({
      kind: "consent",
      data: { local_storage: true },
      source: "ผู้ใช้ยินยอมจัดเก็บข้อมูลผ่าน DoBao",
    });
  try {
    const r = await post("ai/records/batch-preview", {
      records,
      compact: true,
    });
    if (manualReview !== current || seq !== current.sequence) return;
    current.preview = r;
    current.key = crypto.randomUUID();
    if (r.requires_consent) $("manual-storage-option").hidden = false;
    const missing = (r.checks || []).flatMap((c) => c.missing || []);
    const names = {
      quantity: "ปริมาณ",
      unit: "หน่วย",
      occurred_at: "เวลา",
      food_state: "ลักษณะอาหาร",
      start: "เวลาเริ่ม",
      end: "เวลาสิ้นสุด",
      method: "วิธีบันทึก",
      context: "ช่วงเวลาที่วัด",
      dose: "ขนาดยา",
      instruction_source: "คำแนะนำจากทีมรักษา",
      state: "สถานะ",
    };
    const status = r.requires_consent
      ? "อ่านและเลือกความยินยอมการจัดเก็บด้านล่างก่อนบันทึก"
      : !r.can_confirm
        ? "ข้อมูลยังไม่ผ่านการตรวจ กรุณากลับไปแก้ไข"
        : missing.length
          ? `บันทึกได้เลย ข้อมูลที่ยังไม่ทราบเว้นไว้ได้ (${[...new Set(missing.map((k) => names[k] || k))].join(" / ")})`
          : "ตรวจรายการแล้ว กดยืนยันเพื่อบันทึกได้";
    $("manual-review-status").textContent = [status, current.note]
      .filter(Boolean)
      .join("\n");
    if (!r.can_confirm)
      for (const c of r.checks || [])
        for (const error of c.errors || [])
          $("manual-review-status").append(el("p", error));
    $("confirm-manual").disabled = !r.can_confirm || !!r.requires_consent;
  } catch (e) {
    if (manualReview === current)
      $("manual-review-status").textContent = errorMessage(e);
    throw e;
  }
}
$("manual-storage-consent").addEventListener("change", () =>
  run(null, () => validateManual(manualReview)),
);
$("edit-reviewed-records").addEventListener("click", () =>
  run($("edit-reviewed-records"), async () => {
    if (!manualReview || manualReview.locked) return;
    const records = structuredClone(manualReview.records),
      onSaved = manualReview.onSaved;
    $("manual-review-dialog").close();
    await openDraft(records, new Date().toISOString(), onSaved);
  }),
);
$("manual-review-dialog").addEventListener("close", () => {
  manualReview = null;
});
$("manual-review-dialog").addEventListener("cancel", (e) => {
  if (manualReview?.locked) e.preventDefault();
});
async function confirmManual(current) {
  if (!current?.preview?.can_confirm || current.preview.requires_consent) return;
  const ownerEpoch = epoch;
  current.locked = true;
  $("edit-reviewed-records").disabled = true;
  $("manual-storage-consent").disabled = true;
  const closeButtons = $("manual-review-dialog").querySelectorAll("[data-close]");
  closeButtons.forEach((n) => (n.disabled = true));
  $("manual-review-status").textContent = "กำลังบันทึก…";
  try {
    const result = await post("ai/confirm", {
      draft_id: current.preview.draft_id,
      idempotency_key: current.key,
      confirmed: true,
      ...(current.fast ? { sync: false } : {}),
    });
    if (manualReview !== current) return;
    if ($("manual-review-dialog").open) $("manual-review-dialog").close();
    manualReview = null;
    if (current.fast) {
      // Show the result at once; the lists refresh in the background.
      current.onSaved?.(result);
      showToast("บันทึกแล้ว", "");
      run(null, refreshAll);
      return;
    }
    await refreshAll();
    if (ownerEpoch !== epoch || !state.user) return;
    current.onSaved?.(result);
    showToast(
      "บันทึกแล้ว",
      result.projection_synced
        ? ""
        : "บันทึกต้นฉบับแล้ว แต่ยังโหลดข้อมูลล่าสุดไม่ครบ",
    );
  } catch (e) {
    if (manualReview === current) {
      $("manual-review-status").textContent =
        e.status === 404
          ? "รายการหมดอายุ กรุณากลับไปตรวจประวัติก่อนทำใหม่"
          : `${errorMessage(e)} · หากลองอีกครั้งจะใช้รายการเดิม`;
      if (e.status === 404) {
        current.preview = null;
        $("confirm-manual").dataset.keepDisabled = "1";
      }
      // A failed quick save opens the sheet so it can be retried safely.
      if (!$("manual-review-dialog").open) openDialog("manual-review-dialog");
    }
    throw e;
  } finally {
    current.locked = false;
    closeButtons.forEach((n) => (n.disabled = false));
    $("edit-reviewed-records").disabled = false;
  }
}
$("confirm-manual").addEventListener("click", () =>
  run($("confirm-manual"), () => confirmManual(manualReview)),
);
$("medication-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, () => {
    const r = newRecord("medication");
    r.text = $("med-name").value.trim();
    r.data = { name: r.text, state: $("med-state").value };
    if ($("med-dose").value) r.data.dose = Number($("med-dose").value);
    if ($("med-unit").value.trim()) r.data.unit = $("med-unit").value.trim();
    if ($("med-instruction").value.trim())
      r.data.instruction_source = $("med-instruction").value.trim();
    applyJournalTime(
      r,
      $("med-date").value,
      $("med-time").value,
      "unspecified",
      true,
    );
    return reviewManual([r], () => resetEntry("medication-form"), "", { fast: true });
  });
});
$("wellbeing-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, () => {
    const r = newRecord("wellbeing");
    r.text = $("wellbeing-note").value.trim();
    r.data.note = r.text;
    return reviewManual([r], () => $("wellbeing-form").reset(), "", { fast: true });
  });
});
$("health-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, () => {
    const captured = new Date().toISOString(),
      records = [];
    for (const [id, name, unit] of [
      ["sugar-input", "glucose", "mg/dL"],
      ["weight-input", "weight", "kg"],
    ]) {
      if (!$(id).value) continue;
      const r = newRecord("measurement", captured);
      r.data = {
        ...r.data,
        name,
        unit,
        value: Number($(id).value),
        context: name === "glucose" ? $("glucose-context").value : "unknown",
        method: "self_report",
      };
      if ($("measurement-time").value) {
        const [date, clock] = $("measurement-time").value.split("T");
        applyJournalTime(r, date, clock, "unspecified", true);
      }
      records.push(r);
    }
    if (!records.length) throw new Error("กรอกอย่างน้อยหนึ่งค่าที่ทราบ");
    return reviewManual(records, () => $("health-form").reset(), "", { fast: true });
  });
});
function openManual(kind = "wellbeing") {
  if (canHealth()) return openDraft([newRecord(kind)]);
}
$("manual-record").addEventListener("click", () =>
  run($("manual-record"), () => openManual()),
);
$("add-other-record").addEventListener("click", () =>
  run($("add-other-record"), () => openManual("sleep")),
);
$("add-routine").addEventListener("click", () =>
  run($("add-routine"), () => openManual("routine")),
);
$("edit-health-profile").addEventListener("click", () =>
  run($("edit-health-profile"), () => {
    openHealthProfile();
  }),
);
$("open-journal").addEventListener("click", () => {
  if (canHealth()) openDialog("journal-dialog");
});
/* A shared chat-style composer keeps daily capture identical across pages.
   Extraction only prepares records. Confirmation remains a separate action. */
function resetCaptureViews() {
  for (const view of captureViews.values()) {
    view.sequence++;
    view.input.value = "";
    view.messages.replaceChildren();
    view.status.textContent = "";
    view.submit.disabled = false;
  }
}
function captureMessage(view, text, type) {
  view.messages.append(el("div", text, `capture-message ${type}`));
  while (view.messages.children.length > 4)
    view.messages.firstElementChild.remove();
}
function initCaptureViews() {
  for (const host of document.querySelectorAll("[data-capture]")) {
    const kind = host.dataset.capture,
      question =
        kind === "activity"
          ? "วันนี้ได้ขยับร่างกายบ้างไหม?"
          : "วันนี้กินอะไรมาบ้าง?",
      placeholder =
        kind === "activity"
          ? "เช่น ตอนเย็นเดินรอบบ้าน 15 นาที"
          : "เช่น ตอนเช้ากินข้าวกับไข่ต้ม";
    const heading = el("div", undefined, "capture-heading"),
      avatar = el("span", undefined, "capture-avatar");
    avatar.append(icon("bao-face"));
    avatar.setAttribute("aria-hidden", "true");
    const copy = el("div");
    copy.append(
      el("span", "Baobuddy · ช่วยจดให้", "capture-kicker"),
      el("h2", question),
    );
    heading.append(avatar, copy);
    const messages = el("div", undefined, "capture-messages");
    messages.setAttribute("role", "log");
    messages.setAttribute("aria-label", "บทสนทนาช่วยบันทึก");
    const form = el("form", undefined, "capture-composer"),
      label = el("label", "พิมพ์เล่าให้ฟังได้เลย", "sr-only"),
      input = el("textarea");
    input.id = `capture-${kind}-text`;
    input.rows = 2;
    input.maxLength = 4000;
    input.required = true;
    input.placeholder = placeholder;
    label.htmlFor = input.id;
    const submit = el(
      "button",
      "ส่งให้ Baobuddy",
      "primary-btn capture-submit",
    );
    submit.type = "submit";
    form.append(label, input, submit);
    const footer = el("div", undefined, "capture-footer");
    footer.append(
      el("span", "เล่าเท่าที่ทราบ Baobuddy ช่วยแยกให้ แล้วตรวจก่อนบันทึก"),
    );
    const status = el("p", undefined, "capture-status");
    status.setAttribute("role", "status");
    host.replaceChildren(heading, messages, form, footer, status);
    const view = { kind, input, submit, messages, status, sequence: 0 };
    captureViews.set(kind, view);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      run(submit, () => captureJournal(view));
    });
  }
}
async function extractJournal(text, captured) {
  const r = await post("ai/journal/prepare", {
    text,
    captured_at: captured,
    compact: true,
    use_model: true,
  });
  const records = (r.items || []).map((i) => i.record);
  const warnings = [
    ...(r.unparsed || []).map((x) =>
      typeof x === "string"
        ? `ยังแยกไม่ได้: ${x}`
        : `ยังแยกไม่ได้: ${x.text || ""}`,
    ),
    ...(r.items || []).flatMap((i) => i.warnings || []),
  ].filter(Boolean);
  return { records, note: warnings.join(" / ") };
}
async function captureJournal(view) {
  if (!canAI()) return;
  const text = view.input.value.trim();
  if (!text) return;
  const ownerEpoch = epoch,
    sequence = ++view.sequence;
  captureMessage(view, text, "user");
  view.status.textContent = "Baobuddy กำลังเตรียมรายการให้…";
  try {
    const { records, note } = await extractJournal(
      text,
      new Date().toISOString(),
    );
    if (ownerEpoch !== epoch || sequence !== view.sequence) return;
    if (!records.length) {
      view.status.textContent =
        "ยังแยกรายการไม่ได้ ลองเล่าอีกครั้ง หรือเลือกบันทึกเอง";
      return;
    }
    captureMessage(
      view,
      `เตรียมให้แล้ว ${records.length} รายการ ตรวจแล้วกดยืนยันบันทึกได้เลย`,
      "bot",
    );
    view.status.textContent = "รายการนี้ยังไม่ได้บันทึก";
    await reviewManual(
      records,
      () => {
        if (sequence !== view.sequence) return;
        if (view.input.value.trim() === text) view.input.value = "";
        captureMessage(
          view,
          "บันทึกแล้ว ดู แก้ไข หรือลบได้ในประวัติด้านล่าง",
          "bot",
        );
        view.status.textContent = "บันทึกเรียบร้อย";
      },
      note,
    );
  } catch (e) {
    if (ownerEpoch === epoch && sequence === view.sequence)
      view.status.textContent = errorMessage(e);
    throw e;
  }
}
async function prepareJournal(text, captured) {
  if (!canAI()) return;
  const ownerEpoch = epoch;
  $("journal-status").textContent = "กำลังแยกข้อมูล กรุณารอสักครู่…";
  try {
    const { records, note } = await extractJournal(text, captured);
    if (ownerEpoch !== epoch) return;
    if (records.length) {
      $("journal-dialog").close();
      await reviewManual(
        records,
        () => {
          $("journal-text").value = "";
          $("journal-status").textContent = "บันทึกแล้ว";
        },
        note,
      );
    } else
      $("journal-status").textContent =
        "ยังไม่มีรายการที่แยกได้ ลองเลือกกรอกด้วยตนเอง";
  } catch (e) {
    $("journal-status").textContent = errorMessage(e);
    throw e;
  }
}
$("journal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(e.submitter, () =>
    prepareJournal($("journal-text").value, new Date().toISOString()),
  );
});

/* Delete/plan operations never confirm automatically. Retries retain their key. */
async function previewDelete(body) {
  if (!state.user) return;
  const r = await post("ai/records/delete-preview", body);
  $("operation-title").textContent =
    body.scope === "all" ? "ลบข้อมูลสุขภาพทั้งหมด?" : "ลบบันทึกนี้?";
  $("operation-details").replaceChildren(
    el(
      "p",
      `รายการปัจจุบัน ${r.count} รายการ · รวมประวัติ ${r.history_count} เวอร์ชัน · กระทบ ${r.plan_count} แผน${body.scope === "all" ? ` · น้ำดื่ม/เป้าหมาย ${r.daily_count || 0} วัน` : ""}`,
    ),
  );
  for (const row of r.records || [])
    $("operation-details").append(el("p", recordTitle(row)));
  if (body.scope === "all")
    $("operation-details").append(
      el(
        "p",
        "ลบข้อมูลสุขภาพและสำเนาที่ใช้งาน รวมถึงน้ำดื่มและเป้าหมาย บัญชีและประวัติความยินยอมยังคงอยู่ การลบข้อมูลสำรองให้ติดต่อผู้ควบคุมข้อมูล",
      ),
    );
  setOperation(r, "ยืนยันลบข้อมูล");
  operation.removesProfile =
    body.scope === "all" ||
    state.records.some(
      (record) =>
        record.kind === "profile" && body.record_ids?.includes(record.id),
    );
}
function setOperation(r, label) {
  operation = { preview: r, key: crypto.randomUUID() };
  $("operation-status").textContent = "ยังไม่ทำรายการจนกว่าจะกดยืนยัน";
  $("confirm-operation").textContent = label;
  $("confirm-operation").disabled = !r.can_confirm;
  delete $("confirm-operation").dataset.keepDisabled;
  openDialog("operation-dialog");
}
function applyDeletion(result) {
  if (!result.deleted) return;
  state.records = [];
  state.plans = [];
  state.energies = {};
  state.summary = {};
  if (Number.isInteger(result.revision))
    state.healthRevision = Math.max(state.healthRevision, result.revision);
  if (result.scope === "all") {
    clearAllChats();
    state.healthProfileDirty = false;
    state.daily = null;
    dailyGeneration++;
  }
  renderAll();
}
$("confirm-operation").addEventListener("click", () =>
  run($("confirm-operation"), async () => {
    const current = operation;
    if (!current) return;
    if (current.custom) {
      await current.custom();
      $("operation-dialog").close();
      return;
    }
    if (!current.preview) return;
    try {
      const r = await post("ai/confirm", {
        draft_id: current.preview.draft_id,
        idempotency_key: current.key,
        confirmed: true,
      });
      if (operation !== current) return;
      if (r.deleted && !r.projection_synced) {
        $("operation-status").textContent =
          "ลบต้นฉบับแล้ว แต่สำเนายังลบไม่ครบ คำขอถูกติดตามไว้ แม้ปิดหน้าต่างก็กลับมากดตรวจและทำต่อได้ กรุณาใช้รหัสรายการเดิม";
        $("confirm-operation").textContent = "ลองลบสำเนาที่เหลืออีกครั้ง";
        return;
      }
      $("operation-dialog").close();
      showToast(
        r.deleted ? "ลบข้อมูลแล้ว" : "ยืนยันตารางแล้ว",
        r.projection_synced ? "" : "ข้อมูลล่าสุดยังโหลดไม่ครบ กรุณาโหลดใหม่",
      );
      if (r.deleted && current.removesProfile) state.healthProfileDirty = false;
      applyDeletion(r);
      await refreshAll();
    } catch (e) {
      $("operation-status").textContent =
        e.status === 404
          ? "ร่างหมดอายุ กรุณาโหลดประวัติเพื่อตรวจผลก่อนสร้างรายการใหม่"
          : errorMessage(e);
      if (e.status === 404) {
        current.preview = null;
        $("confirm-operation").dataset.keepDisabled = "1";
      }
      throw e;
    }
  }),
);
$("operation-dialog").addEventListener("close", () => {
  operation = null;
});
$("delete-all").addEventListener("click", () =>
  run($("delete-all"), () => previewDelete({ scope: "all", record_ids: [] })),
);
function renderObject(target, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) renderObject(target, item);
  } else if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const row = el("div", undefined, "detail-row");
      row.append(el("strong", key));
      if (typeof item === "object") renderObject(row, item);
      else row.append(el("span", String(item)));
      target.append(row);
    }
  } else target.append(el("p", String(value)));
}
const planStatus = {
  pass: "จัดเวลาได้ครบ",
  unknown: "ข้อมูลยังไม่พอจัดเวลา",
  infeasible: "จัดเวลาไม่ลงตัว",
};
// "พฤ 12 พ.ย. · 08:00–08:15 น." instead of raw ISO timestamps.
function planWhen(start, end) {
  const s = zoned(start),
    e = zoned(end);
  if (!s) return "";
  const day = new Intl.DateTimeFormat("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${s.date}T00:00:00Z`));
  return `${day} · ${s.clock}${e && e.date === s.date ? `–${e.clock}` : ""} น.`;
}
function renderPlanDetails(target, plan) {
  target.append(
    el("p", `สถานะ: ${planStatus[plan.status] || plan.status || "ไม่ระบุ"}`),
  );
  for (const item of plan.items || [])
    target.append(
      el(
        "p",
        `${kindIcons[item.domain] || "•"} ${item.label || item.name || kinds[item.domain] || ""} · ${planWhen(item.start, item.end) || "ไม่ระบุเวลา"}`,
      ),
    );
  for (const key of ["conflicts", "errors", "warnings", "missing"])
    if (plan[key]?.length) renderObject(target, plan[key]);
}
async function previewPlan(
  start_date = bangkokParts().date,
  previous_plan_id,
  reason,
) {
  if (!canAI()) return;
  const body = { start_date, general_time_only: true };
  if (previous_plan_id) {
    body.previous_plan_id = previous_plan_id;
    body.reason = reason;
  }
  const r = await post("ai/plans/preview", body);
  $("operation-title").textContent = "ตรวจตารางก่อนยืนยัน";
  $("operation-details").replaceChildren();
  renderPlanDetails($("operation-details"), r.plan);
  if (r.comparison) renderObject($("operation-details"), r.comparison);
  setOperation(r, "ยืนยันตารางนี้");
}
function renderPlans() {
  $("plan-list").replaceChildren();
  for (const plan of state.plans) {
    const card = el("article", undefined, "saved-record");
    renderPlanDetails(card, plan);
    card.append(
      button("ตรวจแผนกับข้อมูลล่าสุด", async () => {
        if (!canAI()) return;
        const r = await api(`ai/plans/${encodeURIComponent(plan.id)}/recheck`);
        $("operation-title").textContent = "ผลตรวจตารางล่าสุด";
        $("operation-details").replaceChildren();
        renderPlanDetails($("operation-details"), r.current_check);
        renderObject($("operation-details"), r.comparison);
        operation = null;
        $("confirm-operation").disabled = true;
        $("operation-status").textContent = "ยังไม่เปลี่ยนแผนเดิม";
        openDialog("operation-dialog");
      }),
    );
    $("plan-list").append(card);
  }
  if (!state.plans.length)
    $("plan-list").append(el("p", "ยังไม่มีตารางที่ยืนยัน", "empty-state"));
}
$("preview-plan").addEventListener("click", () =>
  run($("preview-plan"), () => previewPlan()),
);
async function exportData() {
  const data = await api("account/export"),
    blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = el("a");
  a.href = url;
  a.download = `dobao-${bangkokParts().date}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("ส่งออกข้อมูลแล้ว", "ไฟล์มีข้อมูลส่วนบุคคลของคุณ");
}
$("export-data").addEventListener("click", () =>
  run($("export-data"), exportData),
);

/* API answers are escaped text. Model actions are mapped to a fixed allowlist. */
document.querySelectorAll("[data-open-chat]").forEach((n) =>
  n.addEventListener("click", () => {
    if (!canAI()) return;
    if (!$("chat-messages").childElementCount)
      $("chat-messages").append(
        el(
          "div",
          "สวัสดีครับ ผมคือ Baobuddy ลองถาม “วันนี้กินอะไรไปบ้าง” หรือ “กินข้าวกับอะไรดี” ได้เลยครับ",
          "message bot",
        ),
      );
    if (state.aiOffline && !chatController)
      $("chat-status").textContent =
        "ตอนนี้ยังติดต่อ Baobuddy ไม่ได้ ลองส่งข้อความได้ หากยังไม่ตอบให้ลองใหม่ภายหลัง";
    openDialog("chat-dialog");
  }),
);
function renderActions(target, actions, captured) {
  if (!Array.isArray(actions)) return;
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    let fn;
    if (a.type === "navigate") {
      const map = {
        overview: "dashboard",
        record: "health",
        plan: "health",
        dashboard: "dashboard",
        food: "food",
        exercise: "exercise",
        medicine: "medicine",
        health: "health",
      };
      if (map[a.page])
        fn = () => {
          $("chat-dialog").close();
          navigateTo(map[a.page]);
        };
      else if (a.page === "profile")
        fn = () => {
          $("chat-dialog").close();
          openProfile();
        };
      else if (["chat", "knowledge"].includes(a.page))
        fn = () => openDialog("chat-dialog");
    } else if (a.type === "records" && Array.isArray(a.records))
      fn = () => openDraft(a.records, captured);
    else if (a.type === "journal" && typeof a.text === "string")
      fn = () => {
        openDialog("journal-dialog");
        $("journal-text").value = a.text;
        return prepareJournal(a.text, a.captured_at || captured);
      };
    else if (a.type === "plan" && typeof a.start_date === "string")
      fn = () => previewPlan(a.start_date);
    else if (
      a.type === "delete_records" &&
      ["all", "records"].includes(a.scope)
    )
      fn = () =>
        previewDelete({ scope: a.scope, record_ids: a.record_ids || [] });
    else if (a.type === "export") fn = exportData;
    if (fn)
      target.append(
        button(
          typeof a.label === "string" ? a.label : "ตรวจรายการ",
          fn,
          "chat-action",
        ),
      );
  }
}
// One answer bubble: the reply first, then buttons and sources. Supporting
// details (records used, menu ingredients, notes) fold away under one toggle.
function chatSources(sources) {
  if (!Array.isArray(sources)) return null;
  const row = el("div", undefined, "answer-sources"),
    seen = new Set();
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    const href = safeSourceUrl(s.url),
      heading = typeof (s.heading || s.name) === "string" ? s.heading || s.name : "",
      name = typeof s.publisher === "string" && s.publisher.trim() ? s.publisher : heading;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const a = el("a", name || "แหล่งข้อมูล", "source-chip");
    if (heading) a.title = heading;
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    row.append(a);
  }
  if (!row.childElementCount) return null;
  row.prepend(el("span", "แหล่งข้อมูล", "answer-sources-label"));
  return row;
}
function displayChatResult(r, captured) {
  const bot = el("div", undefined, "message bot");
  bot.append(
    el(
      "div",
      typeof r.answer === "string"
        ? r.answer
        : "บริการยังไม่มีคำตอบสำหรับข้อความนี้",
      "answer-text",
    ),
  );
  for (const energy of r.energy_estimates || []) renderEnergy(bot, energy);
  const more = [];
  for (const detail of r.details || [])
    if (typeof detail === "string") more.push(el("p", detail));
  if (Array.isArray(r.menus))
    for (const menu of r.menus) {
      if (typeof menu === "string") more.push(el("p", menu));
      else if (menu && typeof menu.name === "string") {
        const parts = [menu.name];
        if (Array.isArray(menu.ingredients) && menu.ingredients.length)
          parts.push(`ส่วนผสม: ${menu.ingredients.filter((x) => typeof x === "string").join(", ")}`);
        if (typeof menu.note === "string") parts.push(menu.note);
        more.push(el("p", `• ${parts.join(" · ")}`));
      }
    }
  const records = (r.record_sources || []).filter(
    (x) => x && typeof x === "object" && typeof x.text === "string",
  );
  if (records.length)
    more.push(
      el(
        "p",
        `อ้างอิงบันทึกของคุณ: ${records
          .slice(0, 6)
          .map((x) => x.text)
          .join(", ")}${records.length > 6 ? ` และอีก ${records.length - 6} รายการ` : ""}`,
        "record-source",
      ),
    );
  for (const ref of r.meal_references || [])
    if (ref && typeof ref.name === "string" && typeof ref.note === "string")
      more.push(el("p", `${ref.name}: ${ref.note}`, "record-source"));
  renderActions(bot, r.actions, captured);
  const sources = chatSources(r.citations);
  if (sources) bot.append(sources);
  if (more.length) {
    const box = el("details", undefined, "answer-more");
    box.append(el("summary", "ดูที่มาของคำตอบ"), ...more);
    bot.append(box);
  }
  $("chat-messages").append(bot);
  if (Array.isArray(r.suggestions))
    $("chat-suggestions").replaceChildren(
      ...r.suggestions
        .filter((s) => typeof s === "string")
        .slice(0, 6)
        .map((s) => button(s, () => sendChat(s), "suggestion-button")),
    );
  $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
}
async function sendChat(text, retry = false) {
  if (chatController || !canAI()) return;
  text = text.trim();
  if (!text) return;
  if (failedChat && !retry) {
    showToast("ลองส่งข้อความเดิมอีกครั้งหรือเริ่มบทสนทนาใหม่");
    return;
  }
  const captured = retry ? failedChat.captured : new Date().toISOString();
  if (!retry) {
    $("chat-messages").append(el("div", text, "message user"));
    chatHistory.push({ role: "user", content: text });
    persistChat();
  }
  const messages = chatHistory.slice(-19);
  while (
    messages.reduce((n, m) => n + m.content.length, 0) > 16000 &&
    messages.length > 1
  )
    messages.shift();
  const controller = new AbortController();
  chatController = controller;
  const myEpoch = epoch;
  // A temporary bubble belongs to this request only, never to chat history.
  const thinking = el("div", "", "message bot chat-thinking");
  thinking.setAttribute("aria-hidden", "true");
  const dots = el("span", "", "thinking-dots");
  for (let i = 0; i < 3; i++) dots.append(el("span", ""));
  thinking.append(dots, el("span", "กำลังคิด…"));
  $("chat-messages").append(thinking);
  $("chat-messages").setAttribute("aria-busy", "true");
  $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
  $("chat-status").textContent = "Baobuddy กำลังคิด อาจใช้เวลาสักครู่…";
  $("cancel-chat").hidden = false;
  $("retry-chat").hidden = true;
  $("chat-form").querySelector("button").disabled = true;
  try {
    const r = await post(
      "ai/chat",
      { messages, scope: "auto", captured_at: captured },
      { signal: controller.signal },
    );
    if (epoch !== myEpoch || chatController !== controller) return;
    thinking.remove();
    $("chat-messages").setAttribute("aria-busy", "false");
    displayChatResult(r, captured);
    if (typeof r.answer === "string" && r.answer.trim())
      chatHistory.push({ role: "assistant", content: r.answer.slice(0, 4000) });
    persistChat();
    $("chat-input").value = "";
    $("chat-status").textContent = "";
    failedChat = null;
  } catch (e) {
    if (epoch !== myEpoch || chatController !== controller) return;
    $("chat-status").textContent =
      e.code === "ai_unavailable"
        ? "ตอนนี้ยังติดต่อ Baobuddy ไม่ได้ ลองส่งใหม่ภายหลังนะ"
        : errorMessage(e);
    failedChat = { text, captured };
    $("retry-chat").hidden = false;
  } finally {
    thinking.remove();
    if (chatController === controller) {
      $("chat-messages").setAttribute("aria-busy", "false");
      chatController = null;
      $("cancel-chat").hidden = true;
      $("chat-form").querySelector("button").disabled = false;
    }
  }
}
document
  .querySelectorAll("[data-chat-prompt]")
  .forEach((n) =>
    n.addEventListener("click", () =>
      run(n, () => sendChat(n.dataset.chatPrompt)),
    ),
  );
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  sendChat($("chat-input").value);
});
$("retry-chat").addEventListener("click", () => {
  if (failedChat) sendChat(failedChat.text, true);
});
$("cancel-chat").addEventListener("click", () => chatController?.abort());
/* Chat history lives on this device only (per account), never on the server. */
let currentChatId = null;
const chatKey = () => (state.user ? `dobao-chats:${state.user.id}` : null);
function loadChats() {
  try {
    const key = chatKey();
    return key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
  } catch {
    return [];
  }
}
function saveChats(list) {
  try {
    const key = chatKey();
    if (!key) return;
    if (list.length) localStorage.setItem(key, JSON.stringify(list.slice(0, 30)));
    else localStorage.removeItem(key);
  } catch {}
}
function persistChat() {
  if (!state.user || !chatHistory.length) return;
  const list = loadChats().filter((c) => c.id !== currentChatId);
  if (!currentChatId) currentChatId = crypto.randomUUID();
  const firstQuestion = chatHistory.find((m) => m.role === "user")?.content || "แชต";
  list.unshift({
    id: currentChatId,
    title: firstQuestion.slice(0, 60),
    updated: Date.now(),
    messages: chatHistory.slice(-50),
  });
  saveChats(list);
}
function clearAllChats() {
  saveChats([]);
  currentChatId = null;
}
function showChatHistory(open) {
  $("chat-history").hidden = !open;
  $("chat-dialog").classList.toggle("show-history", open);
  if (open) renderChatHistory();
}
function renderChatHistory() {
  const host = $("chat-history-list"),
    list = loadChats(),
    when = new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok",
    });
  host.replaceChildren();
  $("clear-chat-history").hidden = !list.length;
  if (!list.length) {
    const empty = el("li", undefined, "chat-history-empty");
    empty.append(icon("bao-face"), el("p", "ยังไม่มีประวัติแชต"));
    host.append(empty);
    return;
  }
  for (const c of list) {
    const row = el("li", undefined, "chat-history-item"),
      open = el("button", undefined, "chat-history-open"),
      remove = button(
        "",
        () => {
          saveChats(loadChats().filter((x) => x.id !== c.id));
          if (c.id === currentChatId) startNewChat();
          renderChatHistory();
          showToast("ลบแชตนี้แล้ว");
        },
        "chat-history-delete",
      );
    open.type = "button";
    open.append(
      el("strong", c.title),
      el("small", `${when.format(new Date(c.updated))} · ${c.messages.length} ข้อความ`),
    );
    if (c.id === currentChatId) row.classList.add("is-current");
    open.addEventListener("click", () => openChat(c.id));
    remove.append(icon("icon-trash"));
    remove.setAttribute("aria-label", `ลบแชต ${c.title}`);
    row.append(open, remove);
    host.append(row);
  }
}
function openChat(id) {
  const c = loadChats().find((x) => x.id === id);
  if (!c) return;
  chatController?.abort();
  chatController = null;
  currentChatId = c.id;
  chatHistory = c.messages.slice();
  failedChat = null;
  $("chat-messages").replaceChildren(
    ...chatHistory.map((m) =>
      el("div", m.content, m.role === "user" ? "message user" : "message bot"),
    ),
  );
  $("chat-status").textContent = "";
  $("retry-chat").hidden = true;
  $("cancel-chat").hidden = true;
  $("chat-form").querySelector("button").disabled = false;
  showChatHistory(false);
  $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
}
function startNewChat() {
  currentChatId = null;
}
$("open-chat-history").addEventListener("click", () =>
  showChatHistory($("chat-history").hidden),
);
$("close-chat-history").addEventListener("click", () => showChatHistory(false));
$("clear-chat-history").addEventListener("click", () => {
  if (!window.confirm("ลบประวัติแชตทั้งหมดในอุปกรณ์นี้?")) return;
  clearAllChats();
  renderChatHistory();
  showToast("ลบประวัติแชตแล้ว");
});
$("chat-dialog").addEventListener("close", () => showChatHistory(false));
$("reset-chat").addEventListener("click", () => {
  startNewChat();
  showChatHistory(false);
  chatController?.abort();
  chatController = null;
  $("chat-form").querySelector("button").disabled = false;
  $("cancel-chat").hidden = true;
  chatHistory = [];
  failedChat = null;
  $("chat-messages").replaceChildren();
  $("chat-messages").setAttribute("aria-busy", "false");
  $("chat-input").value = "";
  $("chat-status").textContent = "เริ่มบทสนทนาใหม่แล้ว";
  $("retry-chat").hidden = true;
});

async function init() {
  initCaptureViews();
  setEntryDates();
  const f = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });
  $("today-date").textContent = f.format(new Date());
  $("medicine-date").textContent = f.format(new Date());
  try {
    const c = await api("config");
    state.authConfigured = !!c.authConfigured;
    await initializeAuth(c.supabase);
    const authError = authStartupError();
    applyNotice(c.notice);
    $("login-status").textContent = embeddedLoginBrowser
      ? "เปิด DoBao ใน Chrome หรือ Safari เพื่อเข้าสู่ระบบด้วย Google"
      : !c.authConfigured
        ? "ผู้ดูแลยังตั้งค่าการเข้าสู่ระบบไม่ครบ"
        : !c.notice.ready
          ? "ผู้ดูแลกำลังตั้งค่าประกาศความเป็นส่วนตัวก่อนเปิดรับผู้ใช้"
          : "เข้าสู่ระบบเพื่อเริ่มดูแลสุขภาพ";
    if (authError) {
      consumeLoginIntent();
      $("login-status").textContent = authError;
      $("login-browser-help").open = true;
    }
    const intent = consumeLoginIntent();
    if (intent && (await authToken()) && !(await finishLogin(intent))) return;
    if (await loadSession()) {
      navigateTo(location.hash.slice(1) || "dashboard");
      // Keep the launch screen up briefly so the home page opens already
      // filled in, but never wait on a slow network for more than 1.5 s.
      const refreshing = refreshAll();
      await Promise.race([
        refreshing.catch(() => {}),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
      endLaunch();
      await refreshing;
      if (!state.consent.notice_version) openConsent();
    }
  } catch (e) {
    $("login-status").textContent = errorMessage(e);
  } finally {
    endLaunch();
  }
}
// Coming back from Google with the browser's Back button restores this page
// from cache with the launch screen still up; show the login page again.
window.addEventListener("pageshow", (e) => {
  if (e.persisted && !state.user) endLaunch();
});
setInterval(() => {
  if (state.user && state.page === "dashboard" && !document.hidden) renderToday();
}, 60000);
let lastDay = bangkokParts().date;
setInterval(() => {
  const day = bangkokParts().date;
  if (day !== lastDay) {
    lastDay = day;
    run(null, refreshAll);
  }
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.user)
    run(null, async () => {
      if (await loadSession()) await refreshAll();
    });
});
window.addEventListener("offline", () => {
  if (!state.user) return;
  $("sync-status").textContent = "ขณะนี้ออฟไลน์";
  setConnection(
    "การเชื่อมต่อขาดหาย เว็บไม่เก็บคำขอบันทึกไว้แบบออฟไลน์ หากเพิ่งกดยืนยัน ให้ตรวจประวัติเมื่อเชื่อมต่อกลับก่อนทำซ้ำ",
  );
});
window.addEventListener("online", () => {
  if (state.user) run(null, refreshAll);
});
/* ---- Share a health summary as an image ---------------------------------
   Built in the browser from records already on screen; nothing is uploaded.
   The image can be shared (LINE, Messages…) through the phone's share sheet
   or saved to the photo library. */
const share = { days: 1, url: "", blob: null, sequence: 0 };
const shareInclude = () =>
  Object.fromEntries(
    [...document.querySelectorAll("[data-share-include]")].map((n) => [
      n.dataset.shareInclude,
      n.checked,
    ]),
  );
function recordClock(r) {
  return (
    r.journal?.clock?.slice(0, 5) ||
    (!r.journal ? zoned(r.data.occurred_at || r.data.start)?.clock : null) ||
    periods[r.journal?.period] ||
    "—"
  );
}
async function shareData(days) {
  const today = bangkokParts().date,
    end = state.timelineDay && state.timelineDay <= today ? state.timelineDay : today,
    dates = Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));
  await Promise.all(
    dates.map(async (d) => {
      if (d === today || dayCache.has(d) || !healthReady()) return;
      try {
        const r = await api(`daily?day=${encodeURIComponent(d)}`);
        dayCache.set(d, r.daily || { water: 0, goals: [] });
      } catch {
        dayCache.set(d, null);
      }
    }),
  );
  return dates.map((date) => {
    const rows = state.records.filter((r) => recordDate(r) === date),
      meals = rows.filter((r) => r.kind === "meal");
    let lo = 0,
      hi = 0,
      known = 0,
      minutes = 0;
    for (const m of meals) {
      const k = state.energies[m.id]?.kcal;
      if (Array.isArray(k) && k.every(Number.isFinite)) {
        lo += k[0];
        hi += k[1];
        known++;
      }
    }
    const acts = rows.filter((r) => r.kind === "activity");
    for (const r of acts)
      if (r.data.start && r.data.end)
        minutes += (Date.parse(r.data.end) - Date.parse(r.data.start)) / 60000;
    const glucose = rows
      .filter(
        (r) =>
          r.kind === "measurement" &&
          r.data.name === "glucose" &&
          Number.isFinite(r.data.value),
      )
      .map((r) => ({
        value: r.data.value,
        unit: r.data.unit || "mg/dL",
        time: recordClock(r),
        context:
          r.data.context && r.data.context !== "unknown"
            ? contextLabels[r.data.context] || ""
            : "",
        ms: Date.parse(r.data.occurred_at || "") || 0,
      }))
      .sort((a, b) => a.ms - b.ms);
    return {
      date,
      meals,
      kcal: known ? [Math.round(lo), Math.round(hi)] : null,
      kcalPartial: known < meals.length,
      minutes: Math.round(minutes),
      acts,
      meds: rows.filter(
        (r) => r.kind === "medication" && r.data.state === "reported_taken",
      ),
      glucose,
      daily: date === today ? currentDaily() : dayCache.get(date),
      done: scheduleFor(date).filter((x) => x.kind === "done" || x.done),
    };
  });
}
function wrapText(g, text, width) {
  const parts =
    typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter("th", { granularity: "word" }).segment(text)].map(
          (s) => s.segment,
        )
      : [...text];
  const lines = [];
  let line = "";
  for (const part of parts) {
    if (g.measureText(line + part).width > width && line) {
      lines.push(line.trimEnd());
      line = part.trimStart();
    } else line += part;
  }
  if (line) lines.push(line);
  return lines;
}
function drawShareImage(days, include) {
  const W = 1080,
    P = 60,
    canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 5200;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const font = (weight, size) => `${weight} ${size}px Anuphan, "Noto Sans Thai", sans-serif`,
    ink = "#1d1d1f",
    muted = "#6e6e73",
    teal = "#0f766e",
    multi = days.length > 1,
    fmt = (d, opts) =>
      new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", ...opts }).format(
        new Date(`${d}T00:00:00Z`),
      );
  const box = (x, y, w, h, r, fill) => {
    g.beginPath();
    g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
    g.fillStyle = fill;
    g.fill();
  };
  const text = (s, x, y, f, color = ink, align = "left") => {
    g.font = f;
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(s, x, y);
  };
  g.fillStyle = "#f5f5f7";
  g.fillRect(0, 0, W, canvas.height);
  // Header
  const head = g.createLinearGradient(0, 0, W, 340);
  head.addColorStop(0, "#16b8a6");
  head.addColorStop(1, "#0b6b64");
  g.fillStyle = head;
  g.fillRect(0, 0, W, 330);
  box(P, 56, 84, 84, 24, "rgba(255,255,255,0.18)");
  g.save();
  g.translate(P + 42, 100);
  g.scale(2.4, 2.4);
  g.translate(-12, -12.5);
  g.strokeStyle = "#fff";
  g.lineWidth = 1.9;
  g.lineCap = g.lineJoin = "round";
  g.stroke(new Path2D("M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"));
  g.stroke(new Path2D("M7 12h3l1-3 2 6 1-3h3"));
  g.restore();
  text("DoBao", P + 104, 112, font(700, 40), "#fff");
  text(multi ? `สรุปสุขภาพ ${days.length} วัน` : "สรุปสุขภาพประจำวัน", P, 210, font(700, 58), "#fff");
  const range = multi
    ? `${fmt(days[0].date, { day: "numeric", month: "short" })} – ${fmt(days.at(-1).date, { day: "numeric", month: "short", year: "numeric" })}`
    : fmt(days[0].date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  text(`${state.user?.displayName || ""} · ${range}`, P, 272, font(500, 32), "rgba(255,255,255,0.92)");
  let y = 380;
  // Optional basics from the health profile
  if (include.profile) {
    const d = latestHealthProfile()?.data || {},
      bits = [
        d.age ? `อายุ ${d.age} ปี` : "",
        d.weight_kg ? `น้ำหนัก ${d.weight_kg} กก.` : "",
        d.height_cm ? `ส่วนสูง ${d.height_cm} ซม.` : "",
        Array.isArray(d.conditions) && d.conditions.length
          ? `โรคประจำตัว: ${d.conditions.join(", ")}`
          : "",
      ].filter(Boolean);
    if (bits.length) {
      g.font = font(500, 30);
      const lines = wrapText(g, bits.join(" · "), W - P * 2 - 48);
      box(P, y, W - P * 2, 40 + lines.length * 44, 24, "#fff");
      lines.forEach((l, i) => text(l, P + 24, y + 54 + i * 44, font(500, 30), ink));
      y += 64 + lines.length * 44;
    }
  }
  const tiles = (list) => {
    const cols = 2,
      gap = 24,
      tw = (W - P * 2 - gap) / cols,
      th = 170;
    list.forEach((t, i) => {
      const x = P + (i % cols) * (tw + gap),
        ty = y + Math.floor(i / cols) * (th + gap);
      box(x, ty, tw, th, 28, "#fff");
      text(t.icon, x + 28, ty + 70, font(400, 46));
      text(t.value, x + 96, ty + 74, font(700, 50), ink);
      text(t.label, x + 28, ty + 136, font(500, 28), muted);
    });
    y += Math.ceil(list.length / cols) * (th + gap) + 12;
  };
  const section = (title) => {
    text(title, P, y + 40, font(700, 36), ink);
    y += 66;
  };
  const sumMeals = days.reduce((n, d) => n + d.meals.length, 0),
    sumMin = days.reduce((n, d) => n + d.minutes, 0),
    sumMeds = days.reduce((n, d) => n + d.meds.length, 0),
    readings = days.flatMap((d) => d.glucose.map((r) => ({ ...r, date: d.date }))),
    waters = days.map((d) => d.daily?.water).filter(Number.isFinite);
  const list = [];
  if (!multi) {
    const d = days[0];
    if (include.meals)
      list.push({ icon: "🍽️", value: `${d.meals.length} มื้อ`, label: d.kcal ? `${d.kcal[0] === d.kcal[1] ? d.kcal[0] : `${d.kcal[0]}–${d.kcal[1]}`} kcal${d.kcalPartial ? " (บางมื้อ)" : ""}` : "พลังงาน: ยังไม่มีข้อมูล" });
    if (include.activity) list.push({ icon: "🏃", value: `${d.minutes} นาที`, label: `ขยับร่างกาย ${d.acts.length} ครั้ง` });
    if (include.meds) list.push({ icon: "💊", value: `${d.meds.length} ครั้ง`, label: "ทานยาตามที่บันทึก" });
    if (include.water) list.push({ icon: "💧", value: `${d.daily?.water ?? "–"} แก้ว`, label: d.daily?.goals?.length ? `เป้าหมาย ${d.daily.goals.filter((x) => x.done).length}/${d.daily.goals.length} สำเร็จ` : "ดื่มน้ำวันนี้" });
  } else {
    const mealDays = days.filter((d) => d.kcal),
      avgKcal = mealDays.length ? Math.round(mealDays.reduce((n, d) => n + (d.kcal[0] + d.kcal[1]) / 2, 0) / mealDays.length) : null;
    if (include.meals) list.push({ icon: "🍽️", value: avgKcal ? `${avgKcal} kcal` : `${sumMeals} มื้อ`, label: avgKcal ? `เฉลี่ยต่อวัน · ${sumMeals} มื้อ` : "ยังประเมินพลังงานไม่ได้" });
    if (include.activity) list.push({ icon: "🏃", value: `${Math.round(sumMin / days.length)} นาที`, label: `เฉลี่ยต่อวัน · รวม ${sumMin} นาที` });
    if (include.meds) list.push({ icon: "💊", value: `${days.filter((d) => d.meds.length).length}/${days.length} วัน`, label: `วันที่บันทึกว่าทานยา (${sumMeds} ครั้ง)` });
    if (include.water) list.push({ icon: "💧", value: waters.length ? `${(waters.reduce((a, b) => a + b, 0) / waters.length).toFixed(1)} แก้ว` : "–", label: "น้ำเฉลี่ยต่อวัน" });
  }
  if (list.length) tiles(list);
  // Blood glucose
  if (include.glucose) {
    section("🩸 ค่าน้ำตาลในเลือด");
    if (!readings.length) {
      box(P, y, W - P * 2, 96, 24, "#fff");
      text("ยังไม่มีบันทึกค่าน้ำตาลในช่วงนี้", P + 28, y + 60, font(500, 30), muted);
      y += 120;
    } else {
      if (readings.length >= 2) {
        const ch = 260,
          cw = W - P * 2,
          vals = readings.map((r) => r.value),
          lo = Math.min(...vals) - 10,
          hi = Math.max(...vals) + 10;
        box(P, y, cw, ch + 60, 24, "#fff");
        const px = (i) => P + 60 + (i / (readings.length - 1)) * (cw - 120),
          py = (v) => y + 30 + ((hi - v) / (hi - lo)) * ch;
        g.strokeStyle = "#e5e5ea";
        g.lineWidth = 2;
        for (let k = 0; k <= 3; k++) {
          const ly = y + 30 + (k / 3) * ch;
          g.beginPath();
          g.moveTo(P + 40, ly);
          g.lineTo(P + cw - 40, ly);
          g.stroke();
        }
        g.strokeStyle = "#14b8a6";
        g.lineWidth = 6;
        g.beginPath();
        readings.forEach((r, i) => (i ? g.lineTo(px(i), py(r.value)) : g.moveTo(px(i), py(r.value))));
        g.stroke();
        readings.forEach((r, i) => {
          g.beginPath();
          g.arc(px(i), py(r.value), 9, 0, Math.PI * 2);
          g.fillStyle = "#fff";
          g.fill();
          g.strokeStyle = "#14b8a6";
          g.lineWidth = 5;
          g.stroke();
        });
        text(`${Math.round(hi)}`, P + 16, y + 40, font(500, 22), muted);
        text(`${Math.round(lo)}`, P + 16, y + 30 + ch, font(500, 22), muted);
        y += ch + 84;
      }
      const shown = readings.slice(-12);
      box(P, y, W - P * 2, 24 + shown.length * 62, 24, "#fff");
      shown.forEach((r, i) => {
        const ry = y + 62 + i * 62;
        text(multi ? `${fmt(r.date, { day: "numeric", month: "short" })} ${r.time}` : r.time, P + 28, ry, font(500, 30), muted);
        text(`${r.value} ${r.unit}`, P + (multi ? 330 : 200), ry, font(700, 34), ink);
        if (r.context) text(r.context, W - P - 28, ry, font(500, 28), muted, "right");
      });
      y += 48 + shown.length * 62;
      if (readings.length > shown.length)
        text(`และอีก ${readings.length - shown.length} ค่า`, P + 28, y + 10, font(500, 26), muted), (y += 40);
      if (multi) {
        const avg = readings.reduce((n, r) => n + r.value, 0) / readings.length;
        text(`เฉลี่ย ${avg.toFixed(0)} · ต่ำสุด ${Math.min(...readings.map((r) => r.value))} · สูงสุด ${Math.max(...readings.map((r) => r.value))} mg/dL`, P, y + 30, font(600, 28), teal);
        y += 60;
      }
    }
  }
  const allowed = (domain) =>
    (domain === "meal" && include.meals) ||
    (domain === "activity" && include.activity) ||
    (domain === "medication" && include.meds) ||
    (domain === "measurement" && include.glucose) ||
    ["sleep", "wellbeing", "appointment"].includes(domain);
  if (!multi) {
    const items = days[0].done.filter((x) => allowed(x.domain));
    section("✅ วันนี้ทำอะไรไปบ้าง");
    if (!items.length) {
      box(P, y, W - P * 2, 96, 24, "#fff");
      text("ยังไม่มีรายการที่จดไว้", P + 28, y + 60, font(500, 30), muted);
      y += 120;
    } else {
      const shown = items.slice(0, 14);
      box(P, y, W - P * 2, 24 + shown.length * 64, 24, "#fff");
      shown.forEach((x, i) => {
        const ry = y + 62 + i * 64;
        text(x.start || x.periodLabel || "", P + 28, ry, font(600, 28), muted);
        text(kindIcons[x.domain] || "•", P + 150, ry, font(400, 32));
        g.font = font(600, 32);
        let label = x.label;
        while (g.measureText(label).width > W - P * 2 - 260 && label.length > 4) label = label.slice(0, -2);
        text(label === x.label ? label : `${label}…`, P + 205, ry, font(600, 32), ink);
      });
      y += 48 + shown.length * 64;
      if (items.length > shown.length) text(`และอีก ${items.length - shown.length} รายการ`, P + 28, y + 10, font(500, 26), muted), (y += 44);
    }
    const goals = days[0].daily?.goals || [];
    if (include.water && goals.length) {
      section("🎯 เป้าหมายวันนี้");
      box(P, y, W - P * 2, 24 + goals.length * 60, 24, "#fff");
      goals.forEach((goal, i) =>
        text(`${goal.done ? "✓" : "○"}  ${goal.label}`, P + 28, y + 60 + i * 60, font(600, 30), goal.done ? teal : muted),
      );
      y += 48 + goals.length * 60;
    }
  } else {
    section("📅 รายวัน");
    const cols = [
      ["วัน", P + 28, "left"],
      ...(include.meals ? [["อาหาร", P + 300, "center"]] : []),
      ...(include.activity ? [["ขยับ", P + 480, "center"]] : []),
      ...(include.meds ? [["ยา", P + 610, "center"]] : []),
      ...(include.glucose ? [["น้ำตาล", P + 760, "center"]] : []),
      ...(include.water ? [["น้ำ", W - P - 60, "center"]] : []),
    ];
    box(P, y, W - P * 2, 92 + days.length * 62, 24, "#fff");
    cols.forEach(([label, x, align]) => text(label, x, y + 56, font(700, 26), muted, align));
    days.forEach((d, i) => {
      const ry = y + 122 + i * 62,
        vals = {
          อาหาร: d.meals.length ? `${d.meals.length} มื้อ` : "–",
          ขยับ: d.minutes ? `${d.minutes}′` : "–",
          ยา: d.meds.length ? `${d.meds.length}` : "–",
          น้ำตาล: d.glucose.length ? (d.glucose.length > 1 ? `${Math.min(...d.glucose.map((r) => r.value))}–${Math.max(...d.glucose.map((r) => r.value))}` : `${d.glucose[0].value}`) : "–",
          น้ำ: Number.isFinite(d.daily?.water) ? `${d.daily.water}` : "–",
        };
      if (i % 2) box(P + 12, ry - 42, W - P * 2 - 24, 58, 14, "#f7f7f9");
      cols.forEach(([label, x, align]) =>
        text(label === "วัน" ? fmt(d.date, { weekday: "short", day: "numeric", month: "short" }) : vals[label], x, ry, font(label === "วัน" ? 600 : 500, 28), ink, align),
      );
    });
    y += 116 + days.length * 62;
  }
  // Footer
  y += 24;
  g.strokeStyle = "#d1d1d6";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(P, y);
  g.lineTo(W - P, y);
  g.stroke();
  text("สร้างจาก DoBao · ข้อมูลที่ผู้ใช้บันทึกเอง ไม่ใช่ผลการวินิจฉัย", P, y + 52, font(500, 26), muted);
  text(
    `สร้างเมื่อ ${new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date())}`,
    P,
    y + 92,
    font(500, 24),
    muted,
  );
  y += 130;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = Math.min(y, canvas.height);
  out.getContext("2d").drawImage(canvas, 0, 0);
  return out;
}
async function renderShare() {
  const seq = ++share.sequence;
  $("share-status").textContent = "กำลังสร้างภาพ…";
  $("share-status").hidden = false;
  try {
    await Promise.all([
      document.fonts?.load?.('700 40px "Anuphan"'),
      document.fonts?.load?.('500 30px "Anuphan"'),
      document.fonts?.load?.('600 30px "Anuphan"'),
    ]);
  } catch {}
  const data = await shareData(share.days);
  if (seq !== share.sequence) return;
  const canvas = drawShareImage(data, shareInclude());
  if (!canvas) {
    $("share-status").textContent = "เบราว์เซอร์นี้สร้างภาพไม่ได้";
    return;
  }
  share.url = canvas.toDataURL("image/png");
  share.blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (seq !== share.sequence) return;
  $("share-image").src = share.url;
  $("share-image").hidden = false;
  $("share-save").href = share.url;
  $("share-save").download = `DoBao-สรุป-${data[0].date}${data.length > 1 ? `-${data.at(-1).date}` : ""}.png`;
  $("share-status").hidden = true;
}
$("open-share").addEventListener("click", () => {
  if (!canHealth()) return;
  $("share-image").hidden = true;
  openDialog("share-dialog");
  run(null, renderShare);
});
document.querySelectorAll("[data-share-days]").forEach((b) =>
  b.addEventListener("click", () => {
    share.days = Number(b.dataset.shareDays);
    document
      .querySelectorAll("[data-share-days]")
      .forEach((n) => n.setAttribute("aria-selected", String(n === b)));
    run(null, renderShare);
  }),
);
document
  .querySelectorAll("[data-share-include]")
  .forEach((n) => n.addEventListener("change", () => run(null, renderShare)));
$("share-send").addEventListener("click", () =>
  run($("share-send"), async () => {
    if (!share.blob) return;
    const file = new File([share.blob], $("share-save").download, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "สรุปสุขภาพจาก DoBao" });
      } catch (e) {
        if (e.name !== "AbortError") throw e;
      }
      return;
    }
    // No share sheet (most desktops): save the image instead.
    $("share-save").click();
    showToast("บันทึกรูปแล้ว", "เปิด LINE แล้วแนบรูปนี้เพื่อส่งได้เลย");
  }),
);

init();
