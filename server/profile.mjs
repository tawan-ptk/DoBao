import sharp from "sharp";
import { HTTPError, boundedString } from "./security.mjs";
export const profileColumns =
  "display_name,first_name,last_name,theme,avatar_data_url,shortcuts,revision";
export function identityPatch(body) {
  const theme = body.theme ?? "mint";
  if (!["mint", "lavender", "peach"].includes(theme))
    throw new HTTPError(422, "กรุณาเลือกสีที่มีให้");
  return {
    display_name: boundedString(body.displayName, 80),
    first_name: boundedString(body.firstName ?? "", 80, true),
    last_name: boundedString(body.lastName ?? "", 80, true),
    theme,
  };
}
export function shortcutPatch(value) {
  const result = { initialized: true };
  for (const kind of ["food", "activity"]) {
    if (!Array.isArray(value?.[kind]) || value[kind].length > 30)
      throw new HTTPError(422, "เพิ่มปุ่มลัดได้หมวดละไม่เกิน 30 รายการ");
    result[kind] = [...new Set(value[kind].map((v) => boundedString(v, 120)))];
  }
  return { shortcuts: result };
}
export async function avatarPatch(value) {
  if (value === null) return { avatar_data_url: null };
  if (
    typeof value !== "string" ||
    value.length > 90000 ||
    !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  )
    throw new HTTPError(422, "เลือกรูป JPG, PNG หรือ WebP ขนาดเล็กอีกครั้ง");
  try {
    const input = sharp(
      Buffer.from(value.slice(value.indexOf(",") + 1), "base64"),
      { limitInputPixels: 1048576, failOn: "warning" },
    );
    const metadata = await input.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages || 1) > 1
    )
      throw new Error("unsupported");
    // Decode and re-encode pixels: strip image metadata/GPS and appended content.
    const result = await input
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 78 })
      .toBuffer();
    const data = `data:image/webp;base64,${result.toString("base64")}`;
    if (data.length > 90000) throw new Error("too large");
    return { avatar_data_url: data };
  } catch {
    throw new HTTPError(
      422,
      "อ่านรูปนี้ไม่ได้ กรุณาเลือกรูป JPG, PNG หรือ WebP ใหม่",
    );
  }
}
export async function saveProfile(sb, user, revision, patch) {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new HTTPError(422, "กรุณาโหลดโปรไฟล์ใหม่ก่อนบันทึก");
  const row = {
    ...patch,
    updated_at: new Date().toISOString(),
    revision: revision + 1,
  };
  const query =
    revision === 0
      ? sb.from("dobao_profiles").insert({ ...row, user_id: user.id })
      : sb
          .from("dobao_profiles")
          .update(row)
          .eq("user_id", user.id)
          .eq("revision", revision);
  const r = await query.select(profileColumns);
  if (r.error || r.data?.length !== 1) {
    if (r.error?.code === "23505" || !r.error)
      throw new HTTPError(
        409,
        "โปรไฟล์เปลี่ยนแล้ว กรุณาโหลดโปรไฟล์ล่าสุดก่อนแก้ไขอีกครั้ง",
      );
    throw new HTTPError(503, "ยังบันทึกโปรไฟล์ไม่ได้ กรุณาลองอีกครั้ง");
  }
  return r.data[0];
}
