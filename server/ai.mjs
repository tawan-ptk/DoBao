import {
  HTTPError,
  gatewayUrl,
  assertAIPath,
  stableAIUser,
  aiGatewayValue,
} from "./security.mjs";

// Only these need the AI model. Everything else (records, plans, food energy,
// journal parsing, export) is served by the always-on cloud record service
// when RUAMWAN_CORE_URL is set. With RUAMWAN_AI_ON_CORE=true the cloud service
// also answers chat/extract through its hosted model (OpenRouter), so the Mac
// and its tunnel are no longer needed.
const MODEL_PATHS = new Set(["chat", "extract"]);
export function aiOriginFor(path, env = process.env) {
  const production = env.VERCEL_ENV === "production",
    core = env.RUAMWAN_CORE_URL?.trim();
  if (core && (!MODEL_PATHS.has(path) || env.RUAMWAN_AI_ON_CORE === "true"))
    return { origin: gatewayUrl(core, production), model: false };
  return { origin: gatewayUrl(aiGatewayValue(env), production), model: true };
}

// Destination is operator-configured, never accepted from a browser or AI action.
export function createAIClient(
  user,
  { env = process.env, fetchImpl = fetch } = {},
) {
  const key = env.RUAMWAN_API_KEY;
  if (!key || key.length < 32 || /[^\x21-\x7E]/.test(key))
    throw new HTTPError(
      503,
      "ผู้ดูแลยังไม่ได้เชื่อมบริการ Baobuddy",
      "ai_not_configured",
    );
  const owner = stableAIUser(user);
  return async (path, method = "GET", body, query = "") => {
    assertAIPath(path, method);
    if (query && !/^\?(limit=\d+&offset=\d+)(&history=true)?$/.test(query))
      throw new HTTPError(422, "พารามิเตอร์ไม่ถูกต้อง");
    const { origin, model } = aiOriginFor(path, env);
    let response;
    try {
      response = await fetchImpl(`${origin}/api/${path}${query}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(210000),
        headers: {
          Authorization: `Bearer ${key}`,
          "X-Ruamwan-User": owner,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(model && env.AI_GATEWAY_CLIENT_ID && env.AI_GATEWAY_CLIENT_SECRET
            ? {
                "CF-Access-Client-Id": env.AI_GATEWAY_CLIENT_ID,
                "CF-Access-Client-Secret": env.AI_GATEWAY_CLIENT_SECRET,
              }
            : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new HTTPError(
        error.name === "TimeoutError" ? 504 : 503,
        error.name === "TimeoutError"
          ? "บริการใช้เวลานานเกินไป กรุณาลองใหม่ หากเป็นการยืนยันให้ใช้รายการเดิม"
          : "ยังเชื่อมต่อระบบบันทึกข้อมูลไม่ได้ กรุณาลองใหม่ภายหลัง",
        "ai_unavailable",
      );
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new HTTPError(502, "บริการ AI ส่งข้อมูลที่อ่านไม่ได้");
    }
    if (!response.ok) {
      const status = [400, 404, 409, 422, 429, 503].includes(response.status)
        ? response.status
        : 502;
      const message =
        typeof result.detail === "string"
          ? result.detail
          : "ข้อมูลไม่ผ่านการตรวจสอบ กรุณาตรวจชื่อ เวลา และหน่วย";
      throw new HTTPError(
        status,
        response.status === 401 || response.status === 403
          ? "การเชื่อมต่อบริการ AI ยังไม่ถูกต้อง กรุณาติดต่อผู้ดูแล"
          : message,
        `ai_${response.status}`,
      );
    }
    return result;
  };
}
