// Log categories/codes only. Never log the upstream message, JWT, SQL detail,
// email, UID, or rows: database errors can contain private record content.
export function databaseDiagnostic(error, operation) {
  const code = /^[A-Z0-9_]{1,20}$/.test(error?.code || "")
    ? error.code
    : "UNKNOWN";
  const message = String(error?.message || "");
  const category = /JWT|token|issuer|signature/i.test(message)
    ? "identity"
    : /permission|row.level|policy/i.test(message)
      ? "permission"
      : /schema|column|function.*not.*exist/i.test(message)
        ? "schema"
        : /fetch failed|network|timeout/i.test(message)
          ? "connection"
          : "other";
  // supabase-js reports an unreachable project with no code; name it plainly.
  const reference =
    code === "UNKNOWN" && category === "connection"
      ? "DB-CONNECTION"
      : `DB-${code}`;
  console.error(
    JSON.stringify({
      event: "dobao_database_error",
      operation,
      code,
      category,
    }),
  );
  return reference;
}
