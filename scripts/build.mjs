import { mkdir, copyFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
// Only these public files are shipped. Secrets, backend source and SQL stay out.
await mkdir("dist", { recursive: true });
// Refuse unexpected files instead of accidentally deploying stale/private files.
const assets = [
  "boot.js",
  "manifest.webmanifest",
  "apple-touch-icon.png",
  "icon-32.png",
  "icon-192.png",
  "icon-512.png",
];
const allowed = new Set([
  "index.html",
  "style.css",
  "client-data.js",
  "script.js",
  ...assets,
]);
if ((await readdir("dist")).some((name) => !allowed.has(name)))
  throw new Error(
    "dist contains unexpected files. Review them before building; no files were removed.",
  );
for (const name of ["index.html", "style.css", "client-data.js", ...assets])
  await copyFile(name, `dist/${name}`);
await build({
  entryPoints: ["script.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: "dist/script.js",
  minify: true,
});
console.log("Public files ready in dist/");
