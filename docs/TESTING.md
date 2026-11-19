# ผลตรวจ 13 ตุลาคม 2026

> **12 พ.ย. 2569:** เปลี่ยน Login จาก Firebase เป็น Supabase Auth แล้ว รายการที่พูดถึง Firebase ด้านล่างเป็นประวัติ `npm test` ปัจจุบันผ่าน 81 รายการ (รวม token checks ของ Supabase, redirect/registration flow ใน DOM และ SQL 008) ยังไม่ได้ทดสอบ Google Login จริงกับ Supabase และยังไม่ได้รัน 008 บนฐานข้อมูลจริง

## ผ่านแล้ว

- `npm run check`: syntax + tests + production static build ผ่าน
- `npm test`: unit/security/DOM flow, Firebase token checks, SQL regression, local-test guards, HTTP validation และ cleanup recovery รวม 68 รายการผ่าน
- Chat-first: พิมพ์ประโยค → ตรวจสรุปแบบอ่านง่าย → ยืนยัน, ไม่บังคับปริมาณ/หน่วย, ฟอร์มเก็บในบันทึกเอง, ไม่ auto-confirm, logout ไม่คืนข้อความจาก response เก่า; ปิด AI แล้วยังเปิดบันทึกเองได้
- Live AI ตรวจประโยค “ตอนเช้ากินข้าวกับไข่ต้ม” และชื่ออาหาร “ข้าวกับไข่ต้ม” ผ่าน ไม่มีการเดาปริมาณ และ preview ไม่บันทึกสุขภาพ
- `scripts/test-profile-ai.mjs` ยืนยันโปรไฟล์สมมติ อ่าน personal-context จริง พบอายุ/โรค/ยา/การแพ้/ความชอบ/เป้าหมาย/ข้อจำกัดตรงกัน แก้ไขแล้ว context เปลี่ยนและ current profile เหลือเวอร์ชันล่าสุด ข้อมูลสมมติทุกเวอร์ชันและ consent ของ owner ทดสอบถูกลบแล้ว
- Contact unit/DOM: request ผูก verified owner ไม่รับ reply/status ที่ caller ปลอม, ลบผูก owner และ id, ติดต่อได้แม้ถอน health/AI consent, คำตอบทีมแสดงเป็น text, logout ล้างข้อความ; privacy notice รองรับช่องทางที่ไม่ใช่อีเมล
- Vercel CLI ตรวจ environment names แบบอ่านอย่างเดียว: Production ของ `test11-a0ca/muge` ยังไม่มี Environment Variables ไม่ได้ตั้ง cloud secrets และยังไม่ได้ deploy เวอร์ชันนี้
- Gateway ที่ผู้ดูแลให้มา `liked-logistics-identifier-urls.trycloudflare.com`: anonymous/invalid key ได้ 401, catalog/readiness พร้อม key ได้ 200; readiness รายงาน production=false ตั้ง RUAMWAN_GATEWAY_URL ในเครื่องแล้วและรองรับชื่อใหม่นี้ก่อน BASE_URL ตัวตรวจ readiness ส่ง server credential แล้ว
- ทดสอบ chat capture และ manual preview ผ่าน HTTPS gateway จริง ไม่มีการยืนยันบันทึกสุขภาพ; unit/build ยังผ่าน 68 รายการ การเพิ่ม env บน Vercel ถูกปฏิเสธในขั้นตอนยืนยันและยกเลิก CLI แล้ว ไม่ได้เพิ่ม env หรือ deploy
- หลังรัน 007: live RLS ผ่านข้อความติดต่อแยกเจ้าของ, ผู้ใช้ปลอม reply ไม่ได้, แก้ reply ไม่ได้, ลบข้ามเจ้าของไม่ได้, admin ตอบแล้วเจ้าของอ่านได้ และ anonymous อ่านไม่ได้ บัญชีสมมติทั้งสองและ app rows ถูกลบเรียบร้อย
- รอบปรับหน้ากรอกเอง/โปรไฟล์: ฟอร์มว่าง ไม่มีการเลือกอาหารหรือกิจกรรมให้, shortcut เติมชื่อเท่านั้น, ปิด AI consent แล้วยังตรวจและยืนยัน manual ได้, retry ใช้ key เดิม, storage consent ไม่ถูกติ๊กไว้ และชื่อ/ข้อมูลสุขภาพถูกล้างจากฟอร์มเมื่อออกจากระบบ
- ทดสอบรายการตัวเลือกและ IDs ใน HTML; ตรวจ unknown allergy เทียบกับ explicit none, field map ของ Profile, ข้อมูลเวลา/ปริมาณที่ไม่ได้กรอกไม่ถูกเดา, stale profile revision ถูกปฏิเสธ
- ทดสอบรูป: decode/re-encode เป็น WebP 256px, ไม่มี EXIF, ปฏิเสธ SVG ปลอม/URL ภายนอก/ภาพเกิน pixel limit; ลบรูปเป็น null
- หลังผู้ใช้รัน 006: setup schema metadata และ live RLS ผ่านชื่อ–นามสกุล/ธีม/ปุ่มลัดว่าง/เพิ่ม–ลบรูป/การแก้ไข revision เก่า/ข้ามเจ้าของ บัญชีทดสอบ 2 บัญชีและข้อมูลสังเคราะห์ถูกลบแล้ว (ยังเป็น legacy Supabase test ไม่ใช่ Firebase JWT end-to-end)
- `node --env-file-if-exists=.env.local scripts/check-manual-contract.mjs`: live AI ยอมรับ manual Profile/meal/activity จาก helper ของหน้าจอ ไม่เรียก generation และไม่ยืนยันบันทึก ตรวจ records ของ synthetic owner แล้วว่าง
- รีสตาร์ท local server หลัง build: HTML ใหม่, CSS และ bundle ตอบ 200; `.env.local`/Admin JSON ตอบ 404 และ anonymous `/api/profile/avatar` ตอบ 401
- แยกวัน Bangkok, รักษา captured_at, ลบ metadata ก่อนแก้ไข, ไม่รวม glucose คนละบริบท, unknown/partial energy
- ตรวจ Origin/CSRF, allowlist/gateway, owner UUID, server-only secret, signed deletion receipt และไม่รั่ว credential error
- DOM fixture: anonymous ไม่โหลดสุขภาพ, preview ไม่ auto-save, ยืนยันซ้ำใช้ key เดิม, ไม่ใช้ผลตรวจร่างเก่า, render chat เป็นข้อความ, action/link อันตรายไม่ทำงาน, logout ตัดผลตอบเก่า, ลบไม่ครบยังแสดง retry
- Live smoke กับ FastAPI ที่ `127.0.0.1:8765`: ข้อความ “กินข้าว”, “ตอนเช้ากินข้าว”, “เดิน 16.00”, “กินข้าวกับไข่พะโล้” ตรวจเวลา/องค์ประกอบผ่าน
- owner ทดสอบ B ยืนยัน draft ของ A ไม่ได้ (404)
- chat usage-help และ recall ตอบจากบริการจริง; preview/help/recall ไม่สร้าง records; อาหารไม่ทราบฐานอ้างอิงคืน kcal=null
- ใช้ synthetic owner แบบ random UUID ใน smoke test ไม่กดยืนยันบันทึกสุขภาพ ไม่อ้างว่าเป็นผลทดสอบผู้ป่วยจริง
- เปลี่ยน Login เป็น Firebase แล้ว ไม่ต้องเปิด Google provider ของ Supabase แบบเก่า
- Local HTTP หลังเปลี่ยน Firebase: public Web config ถูกต้องและไม่ส่ง Admin/private key, anonymous session ไม่มี user, Firebase bundle 200, `.env.local` 404 และประกาศยังไม่พร้อมทำให้ Login ถูกปิด 422
- ตรวจ Vercel CLI เข้าบัญชีได้ แต่โปรเจกต์ `muge` ยังไม่มี Environment Variables ทั้ง Production และ Preview
- หลังผู้ใช้บันทึก server key และรัน 001 ตรวจ OpenAPI metadata ของ Supabase ได้จริง โดยไม่อ่านข้อมูลผู้ป่วย: พบตาราง/RPC DoBao ครบ
- AI readiness และ server-key authentication ผ่าน โดยอ่านเฉพาะ food catalog ไม่อ่าน/เขียนสุขภาพ
- หลังรัน 002: Live RLS test ผ่านครบ profiles owner isolation, daily consent/revision, server-only RPCs, projection revision monotonicity, anonymous/cross-owner reads และถอน consent ปฏิเสธ writes บัญชีทดสอบ 2 บัญชีในรอบยืนยันผลถูกลบพร้อมข้อมูลสังเคราะห์เรียบร้อย
- หลังผู้ใช้รัน 003: Live RLS regression สำหรับ **บัญชี Supabase เดิม** ผ่านครบ และบัญชีทดสอบถูกลบเรียบร้อย นี่ไม่ใช่ผลพิสูจน์ Firebase JWT end-to-end
- ทดสอบ Firebase app/auth component registration ด้วย SDK จริงผ่าน; Firebase popup/claim-refresh/registration flow ผ่านใน DOM fixture
- npm install หลัง pin SDK ให้รองรับ Node 22 และ override gRPC advisory: audit รายงาน 0 vulnerabilities ณ รอบติดตั้งนี้
- Local test mode HTTP: authConfigured/notice.ready=true, productionReady=false, version แยก `-local-test`, anonymous ไม่มี user, token ปลอมยัง 401 และเซิร์ฟเวอร์ยังตอบต่อได้
- Standalone API handler/hosting ไม่เปิด test mode จาก env flag เพียงอย่างเดียว; ต้องเป็น loopback dev server และไม่ใช่ production/Vercel
- อ่าน Google provider config ด้วย Firebase Admin แบบ read-only: HTTP 200 และ enabled=true (ไม่ใช่การยืนยัน Google popup end-to-end)
- หลังผู้ใช้รัน 004/005: Live RLS regression ผ่าน รวมตารางติดตามการลบ, authenticated/anonymous เรียก cleanup RPC ไม่ได้, ไม่อ่านคำขอลบของบัญชีอื่น, key เปลี่ยนไม่ได้, ต้อง begin ก่อน finish, ล้างซ้ำไม่ทำรายการใหม่, ไม่ลบ daily edit ที่เกิดหลังยืนยัน และ snapshot เก่าไม่คืนข้อมูลที่ลบ บัญชีสังเคราะห์ทั้งสองบัญชีของแต่ละรอบถูกลบพร้อมข้อมูลเรียบร้อย
- DOM/unit เพิ่ม: logout ระหว่าง token refresh ไม่ส่ง write; reset chat ไม่ยกเลิก daily write; daily/health response เก่าไม่ทับข้อมูลใหม่; response เก่าไม่คืน daily หลังลบ; เปิดหน้าใหม่พบคำขอลบที่ค้างและไม่ retry จนผู้ใช้กด
- Cleanup fixture จำลอง AI ลบสำเร็จแต่ Supabase fail แล้ว retry, upstream draft หมดอายุ, edit ไม่ถูกตีความเป็น delete, daily-only deletion ไม่ฝืน AI confirm และ verification query ผ่าน allowlist ของ proxy จริง
- Production preflight แบบ offline ปฏิเสธ local test flag, loopback และประกาศ/production secrets ที่ยังขาดตามคาด ไม่ถือว่าพร้อม production
- HTTP รอบส่งมอบ: หน้าเว็บ/CSS/Firebase bundle 200, CSP และนโยบายปิดกล้องส่งจริงใน local server, `.env.local` และ credential JSON ตอบ 404, anonymous cleanup 401, token ปลอม 401 และเซิร์ฟเวอร์ยังตอบ 200 ต่อได้ ตรวจ Firebase Authorized domains รอบแรกพบเครือข่ายขัดข้องชั่วคราว ตรวจซ้ำแล้วผ่านพร้อม schema/AI readiness/auth

## พบและแก้ระหว่างตรวจ

Live RLS test พบ grant เริ่มต้นของโปรเจกต์ยังอนุญาต authenticated เรียก `dobao_project` ได้แม้ถอน PUBLIC แล้ว จึงแก้ 001 สำหรับติดตั้งใหม่และเพิ่ม 002 เพื่อถอน anon/authenticated อย่างชัดเจน บัญชีทดสอบทุกบัญชีในรอบที่พบปัญหาถูกลบพร้อมข้อมูลสังเคราะห์เรียบร้อย ทดสอบซ้ำหลังผู้ใช้รัน 002 แล้วผ่าน

ระหว่างเปิดทดสอบจริงพบการใช้ `.catch()` กับ PostgREST thenable ในการคืน model lease ทำให้ส่ง error ซ้ำหลัง response และ dev server หยุด แก้เป็น try/await/catch แบบ best-effort เพิ่ม regression tests และป้องกันการส่ง headers ซ้ำแล้ว รีสตาร์ทเซิร์ฟเวอร์และ HTTP smoke ผ่าน

## ยังไม่ได้พิสูจน์

- Firebase Google Login จริง, native Third-party Auth และ RLS สองบัญชี Firebase: Admin credential อ่านได้และ Google provider เปิดแล้ว แต่ยังไม่ได้ทดสอบ browser OAuth/JWT end-to-end
- End-to-end authenticated web → Supabase → private HTTPS gateway → Mac
- Model generation latency/safety/clinical accuracy (usage-help เป็น software route ไม่ใช่การประเมิน weights)
- หน้าจอจริงบนมือถือ/desktop: computer-use permission ไม่พร้อม จึงใช้ DOM checks ไม่ใช่ browser screenshot/visual QA
- Production deployment, backup/restore, retention, erasure จาก backups และการตรวจ PDPA โดยผู้รับผิดชอบ

## ทำซ้ำ

```sh
npm run check
node scripts/smoke-ai.mjs
node --env-file-if-exists=.env.local scripts/check-manual-contract.mjs
```

Smoke script อ่าน key จาก `RUAMWAN_API_KEY` หรือ secret file ของบริการบน Mac โดยไม่พิมพ์ key หลีกเลี่ยงการทดสอบ confirm ด้วยบัญชีผู้ป่วยจริง

ทดสอบ RLS ใน staging: Login A/B คนละ browser profile; A เพิ่มข้อมูลทดสอบ แล้วตรวจ B ทั้งใน UI และ Supabase REST โดยขอ `user_id` ของ A ต้องไม่ได้แถว ตรวจการ insert/update ของ B ด้วย UUID ของ A ต้องปฏิเสธ ตรวจ anonymous ไม่มีสิทธิ์อ่าน/เขียนทุกตาราง หลังจบทดสอบลบข้อมูล staging ตามนโยบาย

มีสคริปต์ทดสอบ RLS จริง:

```sh
npm run test:rls -- --create-test-users
```

คำสั่งนี้สร้าง Auth users ชั่วคราว 2 บัญชี ไม่ส่งอีเมล ใช้เฉพาะข้อมูลสังเคราะห์ ตรวจ RLS/consent/revision/server-only RPC และลบเฉพาะ UUID ที่สร้างรอบนั้นพร้อม app rows ที่ cascade ใช้ staging ก่อน ไม่อ่านข้อมูลผู้ป่วย ไม่แก้ Google provider ต้องมี service key ใน `.env.local` และ email/password provider สำหรับ test accounts หากโปรเซสถูก kill หรือ cleanup ล้มเหลวให้ตรวจ test UUID ที่รายงานและลบโดยผู้ดูแล หลักการ admin API ดู [createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser) และ [deleteUser](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)

หลัง 003 สคริปต์นี้ทดสอบ legacy Supabase branch เท่านั้น ต้องทดสอบ Google ผ่าน Firebase จริงด้วย A/B อีกครั้ง ห้ามอ้างว่าการทดสอบ legacy นี้ตรวจลายเซ็น Firebase/Third-party integration แล้ว
