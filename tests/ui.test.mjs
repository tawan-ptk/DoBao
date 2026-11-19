// DOM flow tests use explicit fixtures, not a substitute for live OAuth/RLS tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import * as helpers from "../client-data.js";
import * as profileHelpers from "../profile-data.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = (
  await readFile(new URL("../script.js", import.meta.url), "utf8")
)
  .replace(/^import[\s\S]*?from "\.\/client-data\.js";/, "")
  .replace(/import[\s\S]*?from ['"]\.\/auth-client\.js['"];/, "")
  .replace(/import[\s\S]*?from ['"]\.\/profile-data\.js['"];/, "");
const tick = async () => {
  for (let i = 0; i < 12; i++) await new Promise(setImmediate);
};
const notice = {
  version: "2026-10-13",
  ready: true,
  controller: "Test operator",
  contact: "test@example.com",
  location: "Test only",
  retention: "Test only",
};
const snapshot = {
  items: [],
  meal_energy: {},
  summary: {},
  plans: [],
  revision: 0,
};
test("manual option lists retain all choices, unique IDs and explicit allergy state", async (t) => {
  const a = await app(t);
  for (const [id, expected] of Object.entries({
    "meal-period": [
      "unspecified",
      "morning",
      "noon",
      "evening",
      "afternoon",
      "night",
    ],
    "meal-state": ["unknown", "cooked", "raw", "packaged"],
    "activity-intensity": ["", "เบา", "ปานกลาง", "หนัก"],
    "hp-allergy-status": ["unknown", "listed", "none"],
  }))
    assert.deepEqual(
      Array.from(a.$(id).options, (n) => n.value),
      expected,
    );
  const ids = Array.from(a.w.document.querySelectorAll("[id]"), (n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  a.$("hp-allergy-status").value = "listed";
  a.$("hp-allergy-status").dispatchEvent(new a.w.Event("change"));
  assert.equal(a.$("hp-allergy-field").hidden, false);
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test("in-app contact works after health consent withdrawal and treats replies as text", async (t) => {
  const items = [];
  const a = await app(t, {
    override: (path, body) => {
      if (path === "support") {
        if (body)
          items.push({
            id: "11111111-1111-4111-8111-111111111111",
            ...body,
            created_at: "2026-10-13T08:00:00Z",
            status: "answered",
            reply: "<script>unsafe()</script>",
          });
        return { items: [...items] };
      }
    },
  });
  a.flow.state.consent = { health: false, ai: false };
  a.w.document.querySelector("[data-open-support]").click();
  await tick();
  assert.equal(a.flow.state.page, "support");
  a.$("support-message").value = "ขอแก้ไขข้อมูลบัญชี";
  a.$("support-form").dispatchEvent(
    new a.w.SubmitEvent("submit", {
      cancelable: true,
      submitter: a.$("send-support"),
    }),
  );
  await tick();
  assert.match(a.$("support-records").textContent, /ขอแก้ไขข้อมูลบัญชี/);
  assert.match(a.$("support-records").textContent, /<script>/);
  assert.equal(a.$("support-records").querySelector("script"), null);
  a.flow.clearPrivateState();
  assert.equal(a.$("support-records").textContent, "");
});
test("chat-first capture accepts a sentence and requires explicit confirmation without quantity fields", async (t) => {
  const record = helpers.newRecord("meal");
  record.text = "ตอนเช้ากินข้าวกับไข่ต้ม";
  record.data = { name: "ข้าวกับไข่ต้ม", food_state: "unknown" };
  const a = await app(t, {
    override: (path) =>
      path === "ai/journal/prepare"
        ? { items: [{ record }], unparsed: [] }
        : undefined,
  });
  assert.equal(a.$("food-manual").open, false);
  assert.equal(a.$("activity-manual").open, false);
  const input = a.$("capture-food-text");
  input.value = record.text;
  input.form.dispatchEvent(
    new a.w.SubmitEvent("submit", {
      cancelable: true,
      submitter: input.form.querySelector("button"),
    }),
  );
  await tick();
  assert.equal(a.$("manual-review-dialog").open, true);
  assert.equal(a.$("draft-dialog").open, false);
  assert.match(a.$("manual-review-details").textContent, /ข้าวกับไข่ต้ม/);
  assert.equal(
    a.calls.some((c) => c.path === "ai/confirm"),
    false,
  );
  assert.equal(
    a.calls.find((c) => c.path === "ai/journal/prepare").body.text,
    record.text,
  );
  assert.equal(
    a.calls.find((c) => c.path === "ai/records/batch-preview").body.records[0]
      .data.quantity,
    undefined,
  );
  a.$("confirm-manual").click();
  await tick();
  assert.equal(input.value, "");
  assert.match(
    a.w.document.querySelector('[data-capture="food"]').textContent,
    /บันทึกแล้ว/,
  );
});
test("chat capture late responses cannot restore private text after logout", async (t) => {
  const pending = deferred();
  const a = await app(t, {
    override: (path) =>
      path === "ai/journal/prepare" ? pending.promise : undefined,
  });
  const input = a.$("capture-food-text");
  input.value = "ข้อมูลสมมติส่วนตัว";
  input.form.dispatchEvent(
    new a.w.SubmitEvent("submit", {
      cancelable: true,
      submitter: input.form.querySelector("button"),
    }),
  );
  await tick();
  a.flow.clearPrivateState();
  const record = helpers.newRecord("meal");
  record.text = "ข้อมูลสมมติส่วนตัว";
  record.data.name = "อาหารทดสอบ";
  pending.resolve({ items: [{ record }] });
  await tick();
  assert.equal(input.value, "");
  assert.equal(a.$("manual-review-dialog").open, false);
  assert.equal(a.w.document.querySelector(".capture-messages").textContent, "");
});
test("manual entry stays available with AI consent disabled and no extraction request", async (t) => {
  const a = await app(t);
  a.flow.state.consent.ai = false;
  a.flow.navigateTo("food");
  a.w.document.querySelector("#food-manual > summary").click();
  assert.equal(a.$("food-manual").open, true);
  assert.equal(a.flow.state.page, "food");
  assert.equal(
    a.calls.some((c) => c.path === "ai/journal/prepare"),
    false,
  );
});
test("profile inspector reads confirmed AI context and does not submit unsaved profile", async (t) => {
  const a = await app(t, {
    override: (path) =>
      path === "ai/personal-context"
        ? {
            profile: {
              age: 65,
              allergies: ["ถั่ว"],
              mobility_limits: ["ใช้รถเข็น"],
            },
          }
        : undefined,
  });
  a.$("hp-age").value = "44";
  a.$("load-ai-profile").click();
  await tick();
  assert.match(a.$("ai-profile-context").textContent, /65/);
  assert.match(a.$("ai-profile-context").textContent, /ใช้รถเข็น/);
  assert.equal(
    a.calls.find((c) => c.path === "ai/personal-context").body,
    undefined,
  );
  assert.equal(
    a.calls.some((c) => c.path === "ai/records/batch-preview"),
    false,
  );
  a.flow.clearPrivateState();
  assert.equal(a.$("ai-profile-context").textContent, "");
});
test("manual meal entry is blank; shortcuts only fill text; confirm retries retain key without inference", async (t) => {
  let attempts = 0;
  const a = await app(t, {
    override: (path) => {
      if (path === "ai/confirm")
        return ++attempts === 1
          ? { __status: 503 }
          : { projection_synced: true, revision: 1 };
    },
  });
  assert.equal(a.$("meal-name").value, "");
  assert.equal(a.$("activity-name").value, "");
  const count = a.calls.length;
  a.$("food-shortcuts").querySelector("button").click();
  assert.notEqual(a.$("meal-name").value, "");
  assert.equal(a.calls.length, count);
  a.flow.state.consent.ai = false;
  a.$("meal-form").dispatchEvent(
    new a.w.SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: a.$("save-meal"),
    }),
  );
  await tick();
  // Manual entry saves straight away; only a failed save opens the sheet.
  const preview = a.calls.find((c) => c.path === "ai/records/batch-preview");
  assert.equal(preview.body.records[0].kind, "meal");
  assert.equal(preview.body.records[0].data.quantity, undefined);
  assert.equal(a.calls.filter((c) => c.path === "ai/confirm").length, 1);
  assert.equal(a.$("manual-review-dialog").open, true);
  a.$("confirm-manual").click();
  await tick();
  assert.equal(a.$("manual-review-dialog").open, false);
  const confirms = a.calls.filter((c) => c.path === "ai/confirm");
  assert.equal(confirms.length, 2);
  assert.equal(confirms[0].body.sync, false);
  assert.equal(
    confirms[0].body.idempotency_key,
    confirms[1].body.idempotency_key,
  );
  assert.equal(a.$("meal-name").value, "");
  assert.equal(
    a.calls.some((c) =>
      ["ai/chat", "ai/journal/prepare", "ai/plans/prepare"].includes(c.path),
    ),
    false,
  );
});
test("manual storage consent is explicit, unchecked, and revalidates before confirm", async (t) => {
  const a = await app(t, {
    override: (path, body) => {
      if (path === "ai/records/batch-preview")
        return {
          draft_id: "manual",
          can_confirm: true,
          requires_consent: !body.records.some((r) => r.kind === "consent"),
          checks: [],
        };
    },
  });
  a.$("activity-name").value = "เดินทดสอบ";
  a.$("activity-form").dispatchEvent(
    new a.w.SubmitEvent("submit", {
      cancelable: true,
      submitter: a.$("finish-activity"),
    }),
  );
  await tick();
  assert.equal(a.$("manual-storage-consent").checked, false);
  assert.equal(a.$("confirm-manual").disabled, true);
  a.$("manual-storage-consent").checked = true;
  a.$("manual-storage-consent").dispatchEvent(new a.w.Event("change"));
  await tick();
  assert.equal(a.$("confirm-manual").disabled, false);
  assert.equal(a.calls.filter((c) => c.path === "ai/confirm").length, 0);
});
test("profile saves customization, guards stale session hydration, and clears private inputs on logout", async (t) => {
  const a = await app(t, {
    override: (path, body) => {
      if (path === "profile")
        return {
          profile: {
            display_name: body.displayName,
            first_name: body.firstName,
            last_name: body.lastName,
            theme: body.theme,
            revision: 2,
            shortcuts: { initialized: true, food: [], activity: [] },
          },
        };
    },
  });
  a.w.document.querySelector("[data-open-profile]").click();
  assert.equal(a.$("page-profile").classList.contains("active"), true);
  a.$("first-name").value = "ชื่อทดสอบ";
  a.$("display-name").value = "TEST";
  a.$("profile-form").dispatchEvent(new a.w.Event("input", { bubbles: true }));
  a.$("profile-form").dispatchEvent(
    new a.w.SubmitEvent("submit", { cancelable: true }),
  );
  await tick();
  assert.equal(a.flow.state.user.firstName, "ชื่อทดสอบ");
  assert.equal(a.$("food-shortcuts").querySelectorAll("button").length, 0);
  await a.flow.loadSession();
  assert.equal(a.flow.state.user.displayName, "TEST");
  a.$("hp-conditions").value = "ข้อมูลทดสอบส่วนตัว";
  a.flow.clearPrivateState();
  assert.equal(a.$("first-name").value, "");
  assert.equal(a.$("hp-conditions").value, "");
});
async function app(
  t,
  {
    anonymous = false,
    override = () => undefined,
    authHooks = {},
    testNotice = notice,
    userAgent,
  } = {},
) {
  const dom = new JSDOM(html, {
    url: "http://localhost:3000",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window,
    calls = [];
  if (userAgent)
    Object.defineProperty(w.navigator, "userAgent", { value: userAgent });
  Object.assign(w, helpers, profileHelpers, {
    initializeAuth: async () => {},
    authStartupError: () => null,
    authToken: async () => null,
    authGoogleLogin: async () => {},
    consumeLoginIntent: () => null,
    authLogout: async () => {},
    ...authHooks,
    structuredClone,
    fetch: async (url, options = {}) => {
      const path = url.replace("/api/", ""),
        body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ path, body, options });
      let result = await override(path, body, options);
      if (result === undefined) {
        if (path === "config")
          result = { authConfigured: true, notice: testNotice };
        else if (path === "session")
          result = anonymous
            ? { user: null }
            : {
                user: {
                  id: "11111111-1111-4111-8111-111111111111",
                  email: "test@example.com",
                  displayName: "MUGE",
                },
                consent: {
                  health: true,
                  ai: true,
                  notice_version: testNotice.version,
                },
                notice: testNotice,
              };
        else if (path.startsWith("daily?")) result = { daily: null };
        else if (path === "health/sync") result = snapshot;
        else if (path === "account/cleanup") result = { jobs: [] };
        else if (path === "ai/food-energy") result = { kcal: null };
        else if (path === "ai/records/batch-preview")
          result = {
            draft_id: "draft-a",
            can_confirm: true,
            requires_consent: false,
            checks: [],
          };
        else if (path === "ai/confirm") result = { projection_synced: true };
        else if (path === "auth/logout") result = { ok: true };
        else throw new Error(`Unexpected fixture request: ${path}`);
      }
      if (result.__status)
        return {
          ok: false,
          status: result.__status,
          json: async () => ({ error: { message: "Test failure" } }),
        };
      return { ok: true, status: 200, json: async () => result };
    },
  });
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    if (this.open) {
      this.open = false;
      this.dispatchEvent(new w.Event("close"));
    }
  };
  w.eval(
    script +
      "\nwindow.flowTest={state,openDraft,clearPrivateState,displayChatResult,sendChat,previewDelete,refreshAll,post,navigateTo,saveDaily,applyDeletion,loadSession};",
  );
  await tick();
  return {
    w,
    calls,
    $: (id) => w.document.getElementById(id),
    flow: w.flowTest,
  };
}
test("anonymous landing shows no patient records and requests no health endpoint", async (t) => {
  const a = await app(t, { anonymous: true });
  assert.equal(a.$("app-shell").hidden, true);
  assert.equal(a.$("login-screen").hidden, false);
  assert.equal(
    a.calls.some((c) => c.path === "health/sync"),
    false,
  );
  assert.equal(a.w.localStorage.length, 0);
  assert.equal(a.w.document.querySelector("video"), null);
});
test("login omits test banners but still requires notice acknowledgement", async (t) => {
  const a = await app(t, {
    anonymous: true,
    testNotice: {
      ...notice,
      version: "2026-10-13-local-test",
      productionReady: false,
      testMode: true,
      warning: "ใช้ข้อมูลสมมติเท่านั้น",
    },
  });
  assert.equal(a.flow.state.notice.productionReady, false);
  assert.equal(
    a.w.document.querySelectorAll("[data-local-test-banner]").length,
    0,
  );
  assert.match(a.$("login-notice-label").textContent, /ประกาศความเป็นส่วนตัว/);
  assert.equal(a.$("google-login").disabled, true);
  a.$("login-notice").checked = true;
  a.$("login-notice").dispatchEvent(new a.w.Event("change"));
  assert.equal(a.$("google-login").disabled, false);
});
test("embedded browser explains external login without launching a broken popup", async (t) => {
  let popups = 0;
  const a = await app(t, {
    anonymous: true,
    userAgent: "Mozilla/5.0 iPhone Line/15.1",
    authHooks: { authGoogleLogin: async () => popups++ },
  });
  a.$("login-notice").checked = true;
  a.$("login-notice").dispatchEvent(new a.w.Event("change"));
  a.$("google-login").click();
  await tick();
  assert.equal(popups, 0);
  assert.equal(a.$("google-login").disabled, true);
  assert.equal(a.$("login-browser-help").open, true);
  assert.equal(a.$("login-browser-url").value, "http://localhost:3000/");
});
test("Google failure remains readable on the login screen even if sign-out fails", async (t) => {
  const a = await app(t, {
    anonymous: true,
    authHooks: {
      authGoogleLogin: async () => {
        throw new Error("Redirect could not start");
      },
    },
  });
  a.$("login-notice").checked = true;
  a.$("login-notice").dispatchEvent(new a.w.Event("change"));
  a.$("google-login").click();
  await tick();
  assert.equal(a.$("login-screen").hidden, false);
  assert.equal(a.$("login-status").textContent, "Redirect could not start");
  assert.equal(a.$("login-browser-help").open, true);
});
test("Google login requires explicit notice and only redirects; registration waits for return", async (t) => {
  const redirects = [];
  const a = await app(t, {
    anonymous: true,
    authHooks: { authGoogleLogin: async (hash) => redirects.push(hash) },
  });
  assert.equal(a.$("google-login").disabled, true);
  a.$("google-login").click();
  await tick();
  assert.equal(redirects.length, 0);
  a.$("login-notice").checked = true;
  a.$("login-notice").dispatchEvent(new a.w.Event("change"));
  a.$("google-login").click();
  await tick();
  assert.deepEqual(redirects, [""]);
  assert.equal(
    a.calls.some((c) => c.path === "auth/supabase"),
    false,
  );
});
test("returning from Google registers with the Supabase token, then opens the account", async (t) => {
  let registered = false,
    intent = { at: Date.now(), hash: "" };
  const a = await app(t, {
    anonymous: true,
    authHooks: {
      authToken: async () => "supabase-token",
      consumeLoginIntent: () => {
        const value = intent;
        intent = null;
        return value;
      },
    },
    override: (path) => {
      if (path === "auth/supabase") {
        registered = true;
        return { ok: true };
      }
      if (path === "session" && registered)
        return {
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "test@example.com",
            displayName: "Test",
          },
          consent: { health: false, ai: false },
          notice,
        };
    },
  });
  const requests = a.calls.filter((c) => c.path === "auth/supabase");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.noticeAcknowledged, true);
  assert.equal(
    requests[0].options.headers.Authorization,
    "Bearer supabase-token",
  );
  assert.equal(a.$("login-screen").hidden, true);
  assert.equal(a.$("consent-dialog").open, true);
  // Minimal sheet: nothing pre-ticked, start needs health; Baobuddy implies health.
  assert.equal(a.$("welcome-health").checked, false);
  assert.equal(a.$("welcome-save").disabled, true);
  a.$("welcome-ai").click();
  assert.equal(a.$("welcome-health").checked, true);
  assert.equal(a.$("welcome-save").disabled, false);
  a.$("welcome-health").click();
  assert.equal(a.$("welcome-ai").checked, false);
  assert.equal(a.$("welcome-save").disabled, true);
});
test("a Supabase session without an accepted notice is never registered", async (t) => {
  const a = await app(t, {
    anonymous: true,
    authHooks: { authToken: async () => "supabase-token" },
  });
  assert.equal(
    a.calls.some((c) => c.path === "auth/supabase"),
    false,
  );
  assert.equal(a.$("login-screen").hidden, false);
});
test("Google redirect errors are shown on return and clear the pending login", async (t) => {
  let consumed = 0;
  const a = await app(t, {
    anonymous: true,
    authHooks: {
      authStartupError: () => "ยกเลิกการเข้าสู่ระบบแล้ว",
      consumeLoginIntent: () => {
        consumed++;
        return null;
      },
    },
  });
  assert.equal(a.$("login-status").textContent, "ยกเลิกการเข้าสู่ระบบแล้ว");
  assert.ok(consumed >= 1);
  assert.equal(
    a.calls.some((c) => c.path === "auth/supabase"),
    false,
  );
});
test("draft needs preview and explicit confirmation; retry retains idempotency key", async (t) => {
  let confirmations = 0;
  const a = await app(t, {
    override: (path) =>
      path === "ai/confirm" && ++confirmations === 1
        ? { __status: 503 }
        : undefined,
  });
  const r = helpers.newRecord("medication");
  r.data.name = "Example user entry";
  await a.flow.openDraft([r]);
  assert.equal(a.$("confirm-draft").disabled, true);
  assert.equal(
    a.calls.some((c) => c.path === "ai/confirm"),
    false,
  );
  a.$("validate-draft").click();
  await tick();
  assert.equal(a.$("confirm-draft").disabled, false);
  assert.equal(
    a.calls.some((c) => c.path === "ai/confirm"),
    false,
  );
  a.$("confirm-draft").click();
  await tick();
  assert.equal(a.$("draft-dialog").open, true);
  a.$("confirm-draft").click();
  await tick();
  const writes = a.calls.filter((c) => c.path === "ai/confirm");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.idempotency_key, writes[1].body.idempotency_key);
  assert.equal(writes[0].body.confirmed, true);
  assert.equal(a.$("draft-dialog").open, false);
});
test("editing while preview is pending cannot enable stale confirmation", async (t) => {
  const pending = deferred();
  const a = await app(t, {
    override: (path) =>
      path === "ai/records/batch-preview" ? pending.promise : undefined,
  });
  await a.flow.openDraft([helpers.newRecord("wellbeing")]);
  a.$("validate-draft").click();
  await tick();
  a.$("draft-items")
    .querySelector("input[type=text]")
    .dispatchEvent(new a.w.Event("input", { bubbles: true }));
  pending.resolve({
    draft_id: "old",
    can_confirm: true,
    requires_consent: false,
    checks: [],
  });
  await tick();
  assert.equal(a.$("confirm-draft").disabled, true);
  a.$("draft-dialog").close();
  assert.equal(
    a.calls.some((c) => c.path === "ai/confirm"),
    false,
  );
});
test("chat treats markup as text and ignores non-allowlisted actions and unsafe links", async (t) => {
  const a = await app(t);
  a.flow.displayChatResult(
    {
      answer: '<img src=x onerror="window.attacked=true">',
      citations: [{ url: "javascript:alert(1)", title: "unsafe" }],
      actions: [
        { type: "execute", code: "alert(1)" },
        { type: "navigate", page: "https://evil.example" },
        {
          type: "records",
          records: [helpers.newRecord("meal")],
          label: "Review first",
        },
      ],
    },
    new Date().toISOString(),
  );
  assert.equal(a.$("chat-messages").querySelector("img"), null);
  assert.equal(a.$("chat-messages").querySelectorAll("button").length, 1);
  assert.equal(a.$("chat-messages").querySelector("a"), null);
  assert.equal(
    a.calls.some((c) => c.path === "ai/confirm"),
    false,
  );
  assert.equal(a.w.attacked, undefined);
});
test("chat waiting bubble disappears after success or failure and stays out of history", async (t) => {
  let pending = deferred();
  const a = await app(t, {
    override: (path) => (path === "ai/chat" ? pending.promise : undefined),
  });
  const response = a.flow.sendChat("วันนี้กินอะไรดี");
  await tick();
  assert.equal(a.$("chat-messages").getAttribute("aria-busy"), "true");
  assert.match(
    a.$("chat-messages").querySelector(".chat-thinking").textContent,
    /กำลังคิด/,
  );
  pending.resolve({ answer: "คำตอบทดสอบ" });
  await response;
  assert.equal(a.$("chat-messages").querySelector(".chat-thinking"), null);
  assert.equal(a.$("chat-messages").getAttribute("aria-busy"), "false");
  pending = deferred();
  const failed = a.flow.sendChat("แล้วมื้อเย็นล่ะ");
  await tick();
  const request = a.calls.filter((c) => c.path === "ai/chat").at(-1);
  assert.equal(
    request.body.messages.some((m) => m.content.includes("กำลังคิด")),
    false,
  );
  pending.resolve({ __status: 503 });
  await failed;
  assert.equal(a.$("chat-messages").querySelector(".chat-thinking"), null);
  assert.equal(a.$("chat-messages").getAttribute("aria-busy"), "false");
  assert.equal(a.$("retry-chat").hidden, false);
});
test("logout discards a late chat response even if the transport ignores abort", async (t) => {
  const pending = deferred();
  const a = await app(t, {
    override: (path) => (path === "ai/chat" ? pending.promise : undefined),
  });
  const response = a.flow.sendChat("test");
  await tick();
  a.$("logout").click();
  await tick();
  pending.resolve({ answer: "Private late response" });
  await response;
  await tick();
  assert.equal(a.flow.state.user, null);
  assert.equal(a.$("chat-messages").textContent, "");
  assert.equal(a.$("chat-messages").getAttribute("aria-busy"), "false");
  assert.equal(a.$("app-shell").hidden, true);
});
test("incomplete deletion keeps explicit retry open and reuses confirmation key", async (t) => {
  let attempts = 0;
  const a = await app(t, {
    override: (path) =>
      path === "ai/records/delete-preview"
        ? {
            draft_id: "deletion",
            can_confirm: true,
            count: 1,
            history_count: 1,
            plan_count: 0,
            records: [],
          }
        : path === "ai/confirm"
          ? { deleted: true, scope: "all", projection_synced: ++attempts > 1 }
          : undefined,
  });
  await a.flow.previewDelete({ scope: "all", record_ids: [] });
  a.$("confirm-operation").click();
  await tick();
  assert.equal(a.$("operation-dialog").open, true);
  assert.match(a.$("operation-status").textContent, /ยังลบ/);
  a.$("confirm-operation").click();
  await tick();
  const writes = a.calls.filter((c) => c.path === "ai/confirm");
  assert.equal(writes[0].body.idempotency_key, writes[1].body.idempotency_key);
  assert.equal(a.$("operation-dialog").open, false);
});
test("logout during token refresh stops a queued mutation before fetch", async (t) => {
  const a = await app(t);
  const pending = deferred();
  a.w.authToken = () => pending.promise;
  const request = a.flow.post("daily", { water: 5 });
  a.flow.clearPrivateState();
  pending.resolve("new-account-token");
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(
    a.calls.some((c) => c.path === "daily"),
    false,
  );
  assert.equal(a.$("water-count").textContent, "0");
});
test("older health and daily reads never overwrite a newer revision", async (t) => {
  let slow = false;
  const health = deferred(),
    daily = deferred();
  const a = await app(t, {
    override: (path) => {
      if (!slow) return;
      if (path === "health/sync") return health.promise;
      if (path.startsWith("daily?")) return daily.promise;
      if (path === "daily")
        return {
          daily: {
            day: helpers.bangkokParts().date,
            water: 6,
            goals: [],
            revision: 3,
          },
        };
    },
  });
  slow = true;
  const refresh = a.flow.refreshAll();
  await tick();
  a.flow.state.healthRevision = 5;
  a.flow.state.summary = { newest: true };
  await a.flow.saveDaily((d) => {
    d.water = 6;
  });
  health.resolve({ ...snapshot, revision: 4 });
  daily.resolve({
    daily: {
      day: helpers.bangkokParts().date,
      water: 1,
      goals: [],
      revision: 2,
    },
  });
  await refresh;
  assert.equal(a.flow.state.summary.newest, true);
  assert.equal(a.flow.state.daily.water, 6);
});
test("a late daily read cannot recreate data after confirmed deletion", async (t) => {
  let slow = false;
  const pending = deferred();
  const a = await app(t, {
    override: (path) =>
      slow && path.startsWith("daily?") ? pending.promise : undefined,
  });
  slow = true;
  const refresh = a.flow.refreshAll();
  await tick();
  a.flow.applyDeletion({ deleted: true, scope: "all", revision: 3 });
  pending.resolve({
    daily: {
      day: helpers.bangkokParts().date,
      water: 7,
      goals: [],
      revision: 4,
    },
  });
  await refresh;
  assert.equal(a.flow.state.daily, null);
  assert.equal(a.flow.state.records.length, 0);
});
test("pending cleanup survives reopening and requires an explicit retry click", async (t) => {
  let complete = false;
  const a = await app(t, {
    override: (path, body, options) => {
      if (path === "account/cleanup") {
        if (options.method === "POST") {
          complete = true;
          assert.equal(body.draft_id, "saved");
          return { projection_synced: true };
        }
        return {
          jobs: complete
            ? []
            : [{ draft_id: "saved", scope: "all", phase: "cleanup" }],
        };
      }
    },
  });
  assert.equal(a.$("cleanup-status").hidden, false);
  assert.equal(
    a.calls.some(
      (c) => c.path === "account/cleanup" && c.options.method === "POST",
    ),
    false,
  );
  a.$("cleanup-status").querySelector("button").click();
  await tick();
  assert.equal(a.$("cleanup-status").hidden, true);
});
test("unknown URL hash safely falls back to dashboard", async (t) => {
  const a = await app(t);
  assert.doesNotThrow(() => a.flow.navigateTo('\"] not-a-selector'));
  assert.equal(a.flow.state.page, "dashboard");
});
test("resetting chat does not abort an unrelated daily write and ignores the old chat response", async (t) => {
  const chat = deferred(),
    daily = deferred();
  const a = await app(t, {
    override: (path) =>
      path === "ai/chat"
        ? chat.promise
        : path === "daily"
          ? daily.promise
          : undefined,
  });
  const chatRequest = a.flow.sendChat("example");
  const dailyRequest = a.flow.post("daily", { water: 2 });
  await tick();
  a.$("reset-chat").click();
  chat.resolve({ answer: "Old private answer" });
  daily.resolve({ daily: { water: 2 } });
  const result = await dailyRequest;
  await chatRequest;
  assert.equal(result.daily.water, 2);
  assert.equal(a.$("chat-messages").textContent, "");
  assert.equal(a.$("chat-form").querySelector("button").disabled, false);
});
test("'done' on a planned activity saves in one tap without Baobuddy", async (t) => {
  const start = new Date(Date.now() + 10 * 60000),
    end = new Date(start.getTime() + 20 * 60000);
  const a = await app(t, {
    override: (path) => {
      if (path === "health/sync")
        return {
          ...snapshot,
          plans: [
            {
              id: "p1",
              user_status: "confirmed",
              items: [
                { domain: "activity", label: "เดินเร็ว", start: start.toISOString(), end: end.toISOString() },
              ],
            },
          ],
        };
      if (path === "ai/records/batch-preview")
        return { draft_id: "d1", can_confirm: true, requires_consent: false, checks: [] };
    },
  });
  await tick();
  const primary = a.$("next-up").querySelector(".next-primary");
  assert.equal(primary.textContent, "จดว่าทำแล้ว");
  primary.click();
  await tick();
  const preview = a.calls.find((c) => c.path === "ai/records/batch-preview");
  assert.equal(preview.body.records[0].kind, "activity");
  assert.equal(preview.body.records[0].data.name, "เดินเร็ว");
  assert.ok(preview.body.records[0].data.end, "planned duration is kept");
  assert.equal(a.calls.filter((c) => c.path === "ai/confirm").length, 1);
  assert.equal(a.$("manual-review-dialog").open, false);
  assert.equal(
    a.calls.some((c) => ["ai/chat", "ai/journal/prepare"].includes(c.path)),
    false,
  );
});
