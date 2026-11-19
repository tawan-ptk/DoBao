import test from "node:test";
import assert from "node:assert/strict";
import { databaseDiagnostic } from "../server/database-diagnostics.mjs";
test("database diagnostics identify JWT failures without exposing upstream private text", (t) => {
  const output = [];
  t.mock.method(console, "error", (line) => output.push(line));
  assert.equal(
    databaseDiagnostic(
      {
        code: "PGRST301",
        message: "JWT invalid: private-token",
        details: "private health value",
      },
      "app_query",
    ),
    "DB-PGRST301",
  );
  assert.equal(JSON.parse(output[0]).category, "identity");
  assert.ok(!output[0].includes("private"));
  assert.equal(
    databaseDiagnostic(
      { code: "private-token", message: "private record" },
      "app_query",
    ),
    "DB-UNKNOWN",
  );
  assert.ok(!output[1].includes("private"));
  assert.equal(
    databaseDiagnostic(
      { code: "", message: "TypeError: fetch failed" },
      "read_account",
    ),
    "DB-CONNECTION",
  );
});
