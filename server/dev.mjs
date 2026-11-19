import http from "node:http";
import { readFile } from "node:fs/promises";
import handler from "../api/index.js";
import { loadLocalAISecret } from "./local-secrets.mjs";
import { build } from "esbuild";
import { enableLocalTestServer, isLocalTestMode } from "./privacy.mjs";
enableLocalTestServer();
const securityHeaders = JSON.parse(
  await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
).headers[0].headers;
const client = await build({
  entryPoints: [new URL("../script.js", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  write: false,
});
try {
  await loadLocalAISecret();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const files = {
  "/": "index.html",
  "/index.html": "index.html",
  "/style.css": "style.css",
  "/script.js": "script.js",
  "/client-data.js": "client-data.js",
  "/boot.js": "boot.js",
  "/manifest.webmanifest": "manifest.webmanifest",
  "/apple-touch-icon.png": "apple-touch-icon.png",
  "/icon-32.png": "icon-32.png",
  "/icon-192.png": "icon-192.png",
  "/icon-512.png": "icon-512.png",
};
const types = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  png: "image/png",
  webmanifest: "application/manifest+json",
};
http
  .createServer(async (req, res) => {
    // Preview uses the same CSP/popup policy as Vercel; never serves secret files.
    for (const header of securityHeaders)
      res.setHeader(header.key, header.value);
    res.setHeader("Cache-Control", "no-store");
    if (req.url.startsWith("/api/")) {
      try {
        await handler(req, res);
      } catch {
        if (!res.headersSent)
          res.writeHead(500, {
            "Content-Type": "application/json; charset=utf-8",
          });
        if (!res.writableEnded && !res.destroyed)
          res.end(
            JSON.stringify({
              error: { message: "ระบบทำรายการไม่สำเร็จ กรุณาลองใหม่" },
            }),
          );
      }
      return;
    }
    const path = new URL(req.url, "http://localhost").pathname;
    if (!files[path]) {
      res.writeHead(404);
      return res.end("Not found");
    }
    try {
      res.setHeader("Content-Type", types[files[path].split(".").at(-1)]);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(
        path === "/script.js"
          ? client.outputFiles[0].contents
          : await readFile(new URL(`../${files[path]}`, import.meta.url)),
      );
    } catch {
      res.writeHead(500);
      res.end("Unable to load file");
    }
  })
  .listen(3000, "127.0.0.1", () => {
    console.log("DoBao: http://localhost:3000");
    if (isLocalTestMode())
      console.log(
        "LOCAL TEST MODE: synthetic data only; real Supabase/AI storage. Production privacy gate is unchanged.",
      );
  });
