// Read-only gateway diagnostics; never print credentials or upstream bodies.
import { randomUUID } from "node:crypto";
import { loadLocalAISecret } from "../server/local-secrets.mjs";
import { gatewayUrl, aiGatewayValue } from "../server/security.mjs";
await loadLocalAISecret();
const origin = gatewayUrl(process.argv[2] || aiGatewayValue(), true);
const headers = {
  Authorization: `Bearer ${process.env.RUAMWAN_API_KEY}`,
  "X-Ruamwan-User": `dobao:${randomUUID()}`,
};
if (process.env.AI_GATEWAY_CLIENT_ID && process.env.AI_GATEWAY_CLIENT_SECRET) {
  headers["CF-Access-Client-Id"] = process.env.AI_GATEWAY_CLIENT_ID;
  headers["CF-Access-Client-Secret"] = process.env.AI_GATEWAY_CLIENT_SECRET;
}
async function probe(path, requestHeaders) {
  try {
    const r = await fetch(origin + path, {
      headers: requestHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json().catch(() => null);
    return { status: r.status, ok: r.ok, data };
  } catch {
    return { status: 0, ok: false, data: null };
  }
}
let failed = false;
for (const [label, path, auth, check] of [
  [
    "anonymous catalog blocked",
    "/api/food-catalog",
    {},
    (r) => [401, 403].includes(r.status),
  ],
  [
    "invalid key blocked",
    "/api/food-catalog",
    { ...headers, Authorization: `Bearer ${randomUUID()}` },
    (r) => [401, 403].includes(r.status),
  ],
  [
    "authenticated catalog",
    "/api/food-catalog",
    headers,
    (r) => r.ok && Array.isArray(r.data?.items),
  ],
  [
    "authenticated readiness",
    "/api/readiness",
    headers,
    (r) => r.ok && r.data?.model_available === true,
  ],
]) {
  const result = await probe(path, auth),
    passed = check(result);
  if (!passed) failed = true;
  console.log(
    `${passed ? "PASS" : "BLOCKED"} ${label}: HTTP ${result.status}${label === "authenticated readiness" && result.ok ? `, production=${result.data?.production === true}` : ""}`,
  );
}
process.exitCode = failed ? 1 : 0;
