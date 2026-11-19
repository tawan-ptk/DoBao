import test from "node:test";
import { execFileSync } from "node:child_process";

test("API module loads when Vercel disables require(esm)", () => {
  execFileSync(
    process.execPath,
    [
      "--no-experimental-require-module",
      "--input-type=module",
      "-e",
      `await import("./api/index.js");`,
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
});
