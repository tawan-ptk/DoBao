# DoBao — สถานะเว็บบน Vercel

เว็บไซต์ที่เลือก: **https://dobaohealth.vercel.app** · ผู้ดูแล: **ทีมพัฒนา DoBao**

อัปเดต 13 ตุลาคม 2569: deploy ขึ้น Vercel แล้ว ตั้งค่า Production 18 ตัวแปร รวม server secrets แบบ encrypted, Firebase อนุญาต `dobaohealth.vercel.app` แล้ว และ Google provider เปิดอยู่ ผู้ดูแลยืนยันเปิดทดสอบด้วยข้อมูลสมมติและรับรองข้อความประกาศที่แสดงอยู่ ไม่ใช่การรับรองความพร้อมด้านการแพทย์หรือกฎหมาย

แชทมีจุดขยับพร้อม “กำลังคิด…” ระหว่างรอ รองรับ reduced motion และล้างสถานะเมื่อจบ/ผิดพลาด/เริ่มใหม่/ออกจากระบบ ตามคำขอล่าสุดเอาแบนเนอร์โหมดทดสอบออกจากหน้าจอแล้ว ยังอ่านประกาศและให้ความยินยอมตามปกติ ไม่ได้แก้การเลือกภาษาคำตอบ

โค้ดพร้อมสร้าง bundle ด้วย `npm run check` ใช้ `vercel.json` เดิม: Other, Node 22, `npm run build`, output `dist`, API `/api/index.js` และ Fluid Compute ที่รองรับ 300 วินาที ไม่ต้องอัปโหลดโฟลเดอร์ AI/weights ไป Vercel

## หน้าจอใหม่

หน้าหลักใช้ปุ่มลัดบันทึกและคุยกับ Baobuddy ส่วนหน้าอาหารและกิจกรรมเริ่มจากคำถามของ Baobuddy → พิมพ์เล่า → ตรวจสรุป → ยืนยันบันทึก ปริมาณ/หน่วยที่ไม่ทราบเว้นไว้ได้ ฟอร์มและปุ่มลัดอยู่ใน “บันทึกเอง” การแก้ไขรายละเอียดเปิดได้จากหน้าตรวจรายการ

หน้าโปรไฟล์แยกชื่อ/รูป/สีออกจากข้อมูลสุขภาพ ข้อมูลสุขภาพเก็บเป็น Profile ของ AI พร้อม previous_id เมื่อแก้ไข และมี “ข้อมูลที่ Baobuddy ใช้” อ่านจาก `/api/personal-context` จริง การแนะนำใช้บันทึกที่ยืนยันแล้วของบัญชีเดียวกัน

## ยังต้องได้ข้อมูลเหล่านี้

1. **AI gateway สำหรับทดสอบ** ตั้งแล้ว: `https://liked-logistics-identifier-urls.trycloudflare.com` ตรวจ anonymous/invalid key ได้ 401 และ key จริงได้ catalog/readiness 200 บริการยังรายงาน `production=false` ต้องใช้ tunnel ถาวรสำหรับ production เพราะ [Quick Tunnel เป็นลิงก์ชั่วคราว](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
2. **หน้าติดต่อทีม** สร้างแล้วที่ `#support` ตามที่เลือก ต้องรัน SQL 007 ก่อน และทีมต้องตรวจ/ตอบข้อความตาม [SUPPORT.md](SUPPORT.md)
3. **region** ฐานข้อมูลหลักสิงคโปร์, API ของเว็บตั้ง `sin1` (สิงคโปร์), AI อยู่บน Mac ในประเทศไทยตามผู้ดูแลยืนยัน หน้าเว็บ/CDN และการยืนยันตัวตนอาจประมวลผลในประเทศอื่น
4. **ประกาศสำหรับรอบทดสอบ** ผู้ดูแลยืนยันแล้ว: สุขภาพเก็บจนผู้ใช้ลบ บัญชี/ประวัติความยินยอมยังเก็บต่อ ไม่มีลบอัตโนมัติ ติดต่อทีมผ่านเว็บเมื่อต้องการลบ สำเนาสำรองไม่ได้ลบทันทีและทีมยังไม่ได้กำหนดรอบลบ เปิด `PRIVACY_NOTICE_READY=true` และ `PUBLIC_PILOT_MODE=true` (ไม่เปลี่ยนเวอร์ชัน consent และไม่แสดงแบนเนอร์ตามคำขอ)

หน้าใช้งานเรียก “ฐานข้อมูลของแอป” ประกาศระบุประเภทผู้ให้บริการตามหน้าที่ เอกสารผู้ดูแลนี้เก็บชื่อบริการจริงไว้สำหรับตั้งค่าและตรวจสอบ

## ตั้งค่าใน Vercel → Settings → Environment Variables → Production

| ตัวแปร | วิธีตั้ง |
| --- | --- |
| `APP_ORIGIN` | `https://dobaohealth.vercel.app` |
| `LOCAL_TEST_MODE` | `false` |
| `PUBLIC_PILOT_MODE` | `true` สำหรับรอบทดสอบที่ผู้ดูแลอนุมัติ ไม่ข้ามการตรวจ notice/consent |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | โปรเจกต์เดิม |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret เดิม ใส่ตรงใน Vercel |
| `RUAMWAN_BASE_URL` | HTTPS gateway origin ที่ยืนยันแล้ว |
| `RUAMWAN_GATEWAY_URL` | รองรับชื่อที่คุณให้มา ตั้ง URL gateway ที่นี่ได้ โดยค่านี้จะใช้ก่อน `RUAMWAN_BASE_URL` |
| `RUAMWAN_API_KEY` | Secret ของ AI ใส่ตรงใน Vercel; ไม่ใช้ file path |
| `AI_GATEWAY_CLIENT_ID`, `AI_GATEWAY_CLIENT_SECRET` | ใส่ทั้งคู่ถ้า gateway ใช้ Cloudflare Access |
| `DATA_CONTROLLER` | `ทีมพัฒนา DoBao` |
| `PRIVACY_CONTACT` | `https://dobaohealth.vercel.app/#support (ติดต่อทีมผ่านเว็บหลังเข้าสู่ระบบ)` |
| `DATA_RETENTION_NOTICE` | สุขภาพจนผู้ใช้ลบ พร้อมระยะเวลา/ขั้นตอนของบัญชี logs backups ตามจริง |
| `DATA_LOCATION_NOTICE` | ประเทศ/region จริงของแต่ละส่วน |
| `PRIVACY_NOTICE_READY` | `true` หลังข้อมูลประกาศครบและผู้ดูแลตรวจแล้ว |

เปิด Google provider และ Redirect URL `https://dobaohealth.vercel.app/` ใน Supabase Auth ตาม [SUPABASE_LOGIN.md](SUPABASE_LOGIN.md) รัน SQL 008 เพิ่ม (001–007 ติดตั้งแล้วในโปรเจกต์เดิม) ลบตัวแปร `FIREBASE_*` ออกจาก Vercel ได้

ตรวจด้วย `vercel env ls production` แล้ว: โปรเจกต์ `test11-a0ca/muge` มีค่าครบ 18 ตัวแปร ค่าฝั่งเครื่องไม่ได้ซิงก์โดยอัตโนมัติ สคริปต์ `scripts/configure-vercel.mjs` อัปโหลดเฉพาะ allowlist ผ่าน stdin โดยไม่พิมพ์ secret และไม่ทับค่าที่มีอยู่ ยกเว้น `--pilot-notice` ซึ่งอัปเดตเฉพาะข้อความ/สถานะประกาศที่ผู้ดูแลยืนยัน

## ตรวจและปล่อยเวอร์ชัน

1. รัน `npm run check` และ `npm run setup:check` ในเครื่องด้วยข้อมูลสมมติ
2. รัน `npm run release:check` ด้วย env ของ production ที่ถูกต้อง การตรวจจาก `.env.local` ปัจจุบันจะยังแจ้ง loopback/test mode และ production secrets ที่ยังขาดตามจริง
3. Redeploy โปรเจกต์ Vercel หลังตั้ง env; เปิด Fluid Compute ตรวจ duration ตาม [เอกสาร Vercel](https://vercel.com/docs/functions/configuring-functions/duration)
4. ทดลอง Google Login และสองบัญชีจริงบน staging ตรวจบันทึก/แก้ไข/ลบ/รูปโปรไฟล์และมือถือก่อนรับข้อมูลผู้ใช้จริง

ตรวจ software integration เพิ่มได้ด้วย `node --env-file-if-exists=.env.local scripts/check-manual-contract.mjs` (preview ไม่ยืนยันสุขภาพ) และ `node --env-file-if-exists=.env.local scripts/test-profile-ai.mjs` (ยืนยันเฉพาะ synthetic owner ใหม่ แล้วลบข้อมูลทดสอบทุกเวอร์ชัน)

การตรวจรอบนี้: ชุดทดสอบ 71 รายการผ่าน, build ผ่าน, gateway ปฏิเสธ anonymous/invalid key ด้วย 401 และตอบคำถามด้วยโมเดลจริง (`answered_by_model`) โดยไม่เขียนบันทึกสุขภาพ การผ่าน tests ไม่ได้แทนการลอง Google popup และแชทหลังล็อกอินในเบราว์เซอร์จริง ซึ่งยังต้องให้ผู้ใช้ทดลอง

(ประวัติ — ไม่ใช้แล้วหลังเลิก Firebase Admin) แก้ runtime 500 จาก [jwks-rsa require(esm)](https://github.com/auth0/node-jwks-rsa/issues/507) ด้วย `scripts/patch-jwks.cjs` ให้โหลด jose ด้วย dynamic import โดยคงเวอร์ชัน cryptography เดิม รันตอน postinstall/build และตรวจใน `tests/runtime.test.mjs` ด้วย `--no-experimental-require-module` รวมการอ่าน signing key หากอัปเดต jwks-rsa แล้วโครงสร้างเปลี่ยน สคริปต์จะหยุดเพื่อให้ตรวจ compatibility ก่อน deploy ล็อก Node เป็น 22.x

AI ใช้งานได้เมื่อ Mac, API, gateway และ Cloudflare Tunnel เปิดอยู่ URL แบบ `trycloudflare.com` เป็น URL ชั่วคราว หากเปลี่ยนต้องอัปเดต `RUAMWAN_GATEWAY_URL` ใน Vercel แล้ว redeploy ไม่ต้องอัปโหลด model weights ไป Vercel

ตรวจเว็บจริงหลังแก้ runtime: `/api/config` ตอบ 200 พร้อม `authConfigured=true`, notice ready; `/api/session` ตอบ 200 สำหรับผู้ยังไม่ล็อกอิน; token ปลอมถูกปฏิเสธ 401; `.env.local` และ source server ไม่เปิดให้ดาวน์โหลด (404) ยังไม่ได้ใช้บัญชี Google จริงของผู้ใช้ทดสอบบทสนทนาครบเส้นทาง

## ติดตามปัญหา Login บนมือถือ / ฐานข้อมูล

แก้ปัญหาบันทึกความยินยอม: log จริงพบ P0001 ที่ `/api/consent` และโค้ดส่ง `2026-10-13-pilot` ขณะที่ SQL 003 รับ `2026-10-13` เท่านั้น แก้ให้ hosted notice ใช้เวอร์ชันตรง SQL ทั้ง consent และ daily RPC เพิ่ม regression test เทียบสัญญาทั้งสอง ไม่เปลี่ยนตาราง/RLS ไม่ยืนยันความยินยอมแทนผู้ใช้ และไม่ต้องรัน migration ใหม่ ผู้ใช้ต้องรีเฟรชหน้าเว็บก่อนกดบันทึกใหม่

ผู้ใช้รายงานค้างที่ Firebase `/__/auth/handler` จากมือถือ/เบราว์เซอร์ในแอป ยังไม่ยืนยันสาเหตุในอุปกรณ์จริง เพิ่มตัวตรวจ LINE/Facebook/Instagram/Android WebView ให้เปิดคำแนะนำ Chrome/Safari และไม่เริ่ม popup ในเบราว์เซอร์ที่ตรวจพบ ส่วน Chrome/Safari ปกติยังใช้ popup ตามเดิม คัดลอกเฉพาะ URL แอป ไม่คัดลอก query/token และแสดงคำแนะนำเมื่อรอเกิน 20 วินาที นี่เป็นทางออกสำหรับเบราว์เซอร์ในแอป ไม่ใช่การอ้างว่าแก้หน้า callback ของ Firebase โดยตรง

Supabase: ตรวจตาราง accounts/profiles/consent ด้วย limit=0 ได้ 200 และ RPC ลงทะเบียนปฏิเสธ identity ว่างตามที่ออกแบบ โดยไม่มีการเขียนข้อมูล ผู้ใช้ยืนยันเพิ่ม Third-party Auth แล้ว แต่ยังไม่ได้รหัสความผิดพลาดจากคำขอจริง เพิ่ม log `dobao_database_error` เฉพาะ operation/code/category ไม่บันทึก JWT, UID, SQL detail หรือข้อความสุขภาพ และแสดงรหัส `DB-…` เพื่อวิเคราะห์ต่อ ไม่เปลี่ยน RLS หรือใช้ service role ข้ามสิทธิ์ผู้ใช้ ชุดตรวจล่าสุด 74 tests ผ่าน
