// Bundled locally. Uses only the public Supabase URL + publishable key.
import { createClient } from "@supabase/supabase-js";

const INTENT = "dobao-login-intent";
let client = null;
let startupError = null;

// The pending-login note only needs to survive the Google redirect in this tab.
function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
// The login itself is remembered on this device until the user logs out.
function sessionStore() {
  try {
    const store = window.localStorage,
      probe = "dobao-storage-check";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return storage(); // private mode etc.: fall back to this tab only
  }
}
export async function initializeAuth(config) {
  if (!config?.url || !config?.publishableKey) return;
  client = createClient(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
      // Stay signed in across visits on this device until "ออกจากระบบ".
      storage: sessionStore(),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  // Completes the Google redirect (?code=…) before the app asks for a token.
  const { error } = await client.auth.getSession();
  const params = new URLSearchParams(location.search);
  if (error || params.has("error")) startupError = authMessage(error, params);
  // Never leave an OAuth code or error in the address bar or history.
  if (["code", "error", "error_code", "error_description"].some((k) => params.has(k)))
    history.replaceState(null, "", location.pathname + location.hash);
}
function authMessage(error, params) {
  const code = params.get("error_code") || params.get("error") || error?.code;
  const messages = {
    access_denied: "ยกเลิกการเข้าสู่ระบบแล้ว",
    provider_disabled: "ผู้ดูแลยังไม่ได้เปิด Google provider ใน Supabase",
    bad_oauth_state: "การเข้าสู่ระบบหมดเวลา กรุณาลองใหม่",
    flow_state_expired: "การเข้าสู่ระบบหมดเวลา กรุณาลองใหม่",
    flow_state_not_found:
      "กรุณาเข้าสู่ระบบในแท็บเดิมที่กดปุ่ม Google แล้วลองใหม่",
  };
  return messages[code] || "เข้าสู่ระบบ Google ไม่สำเร็จ กรุณาลองใหม่";
}
export function authStartupError() {
  const message = startupError;
  startupError = null;
  return message;
}
export async function authToken() {
  if (!client) return null;
  // getSession refreshes an expired access token automatically.
  const { data } = await client.auth.getSession();
  return data.session?.access_token || null;
}
// Remembers (in this tab) that the user accepted the notice, then leaves for Google.
export async function authGoogleLogin(returnHash = "") {
  if (!client) throw new Error("ผู้ดูแลยังไม่ได้ตั้งค่าการเข้าสู่ระบบ");
  try {
    storage()?.setItem(
      INTENT,
      JSON.stringify({ at: Date.now(), hash: returnHash === "#support" ? "#support" : "" }),
    );
  } catch {}
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${location.origin}/`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    consumeLoginIntent();
    throw new Error(
      error.code === "provider_disabled" || /provider is not enabled/i.test(error.message)
        ? "ผู้ดูแลยังไม่ได้เปิด Google provider ใน Supabase"
        : "เปิดหน้าเข้าสู่ระบบ Google ไม่สำเร็จ กรุณาลองใหม่",
    );
  }
}
// Returns the pending login (accepted < 10 minutes ago) once, or null.
export function consumeLoginIntent() {
  try {
    const raw = storage()?.getItem(INTENT);
    storage()?.removeItem(INTENT);
    const intent = raw ? JSON.parse(raw) : null;
    return intent && Date.now() - intent.at < 600000 ? intent : null;
  } catch {
    return null;
  }
}
export async function authLogout() {
  // Local scope: signs out this tab without ending the user's other devices.
  if (client) await client.auth.signOut({ scope: "local" });
}
