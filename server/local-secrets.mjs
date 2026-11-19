import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

// Local development only. Never upload this file's contents or log the key.
// Existing env secrets take precedence; a file is not a production secret store.
export async function loadLocalAISecret(env = process.env, read = readFile) {
  if (env.RUAMWAN_API_KEY || !env.RUAMWAN_API_KEY_FILE) return false;
  if (env.VERCEL || env.NODE_ENV === "production")
    throw new Error("AI key files are only supported in local development");
  if (!isAbsolute(env.RUAMWAN_API_KEY_FILE))
    throw new Error("RUAMWAN_API_KEY_FILE must be an absolute local path");
  let key;
  try {
    key = (await read(env.RUAMWAN_API_KEY_FILE, "utf8")).trim();
  } catch {
    throw new Error(
      "Cannot read the local AI key file; check its path and permissions",
    );
  }
  if (key.length < 32 || /[^\x21-\x7E]/.test(key))
    throw new Error("The local AI key file has an invalid format");
  env.RUAMWAN_API_KEY = key;
  return true;
}
