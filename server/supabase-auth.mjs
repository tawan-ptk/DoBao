import { HTTPError, stableAIUser } from "./security.mjs";
import { databaseDiagnostic } from "./database-diagnostics.mjs";

// Public browser config only. The publishable key is designed to be public;
// the service-role key never leaves the server.
export function supabaseWebConfig(env = process.env) {
  const url = env.SUPABASE_URL || "",
    publishableKey = env.SUPABASE_PUBLISHABLE_KEY || "";
  if (!url.trim() || !publishableKey.trim()) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
      return null;
    return { url: u.origin, publishableKey };
  } catch {
    return null;
  }
}
export function supabaseAuthConfigured(env = process.env) {
  return !!supabaseWebConfig(env) && !!env.SUPABASE_SERVICE_ROLE_KEY?.trim();
}
export function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}
function tokenPayload(token) {
  try {
    const part = token.split(".")[1];
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
const expired = () =>
  new HTTPError(
    401,
    "การเข้าสู่ระบบหมดอายุหรือถูกยกเลิก กรุณาเข้าสู่ระบบใหม่",
    "unauthenticated",
  );
// Verifies the access token with Supabase Auth (signature, expiry, user still
// exists), then applies DoBao's own policy: verified Google account only.
export async function verifySupabaseToken(
  token,
  { admin, now = Date.now(), recent = false } = {},
) {
  if (typeof token !== "string" || !token || token.length > 16000)
    throw new HTTPError(401, "กรุณาเข้าสู่ระบบ Google ใหม่", "unauthenticated");
  let user;
  try {
    const result = await admin.auth.getUser(token);
    if (result.error || !result.data?.user) throw expired();
    user = result.data.user;
  } catch {
    throw expired();
  }
  // getUser has validated this exact token, so its payload can be trusted.
  const claims = tokenPayload(token);
  const seconds = Math.floor(now / 1000);
  const providers = user.app_metadata?.providers || [
    user.app_metadata?.provider,
  ];
  if (
    !claims ||
    claims.sub !== user.id ||
    claims.role !== "authenticated" ||
    user.role !== "authenticated" ||
    user.is_anonymous === true ||
    claims.is_anonymous === true ||
    !providers.includes("google") ||
    !user.email_confirmed_at ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= seconds
  )
    throw new HTTPError(
      401,
      "ต้องใช้บัญชี Google ที่ยืนยันแล้วของ DoBao",
      "unauthenticated",
    );
  if (recent) {
    // Registration requires a Google sign-in that happened in the last 5 minutes.
    const oauth = (Array.isArray(claims.amr) ? claims.amr : [])
      .filter((m) => m?.method === "oauth" && Number.isFinite(m.timestamp))
      .map((m) => m.timestamp);
    const latest = oauth.length ? Math.max(...oauth) : NaN;
    if (
      !Number.isFinite(latest) ||
      seconds - latest > 300 ||
      latest > seconds + 60
    )
      throw new HTTPError(
        401,
        "กรุณาเข้าสู่ระบบ Google อีกครั้งเพื่อยืนยันบัญชี",
        "recent_login_required",
      );
  }
  return { user, claims };
}
export async function accountForSupabase(admin, user, { register = false } = {}) {
  let result;
  if (register)
    result = await admin.rpc("dobao_register_supabase", { p_user: user.id });
  else
    result = await admin
      .from("dobao_accounts")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
  if (result.error) {
    const reference = databaseDiagnostic(
      result.error,
      register ? "register_account" : "read_account",
    );
    throw new HTTPError(
      503,
      `ยังเชื่อมบัญชีกับฐานข้อมูลไม่ได้ กรุณาติดต่อทีมพร้อมรหัส ${reference}`,
      "database_error",
    );
  }
  const id = register ? result.data : result.data?.id;
  if (!id) return null;
  stableAIUser({ id }); // Internal UUID owns AI data, never the email.
  return {
    id,
    email: user.email || "",
    user_metadata: {
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || "",
    },
  };
}
