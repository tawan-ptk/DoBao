# ตั้งค่า DoBao ก่อนเปิดใช้งานจริง

## 1. Supabase

โปรเจกต์ที่ผู้ใช้ระบุ: `sfybvpjalptxvzctigjz`

1. สำรองข้อมูลและทดลองใน staging ก่อน รัน SQL ตามลำดับ `001_dobao.sql` → `002_rpc_permissions.sql` → `003_firebase_auth.sql` → `004_cleanup_recovery.sql` → `005_projection_barrier.sql` → `006_profile_customization.sql` → `007_support_requests.sql` → `008_supabase_auth.sql` ในโฟลเดอร์ migrations รันเฉพาะไฟล์ที่ยังไม่ได้รัน ไม่รัน 001 ซ้ำในฐานเดิม
2. ตรวจว่าทุกตารางเปิด RLS และผู้ใช้ทั่วไปเขียน health projection/leases ไม่ได้
3. ใน `.env.local` และ Vercel Environment Variables ใส่:
   - `SUPABASE_URL=https://sfybvpjalptxvzctigjz.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: key ที่ให้ไว้ (ตั้ง local แล้ว)
   - `SUPABASE_SERVICE_ROLE_KEY`: ใส่ผ่านช่อง secret ของ Vercel และ `.env.local` เท่านั้น ห้ามส่งในแชต/ฝั่ง browser

Service role ใช้สำหรับ private identity mapping, ซิงก์สำเนาสุขภาพและล็อกคิว AI แต่ไม่ใช้แทนการตรวจบัญชี คำขอตรวจ Supabase access token กับ Supabase Auth ก่อน แล้วใช้ token เดียวกันภายใต้ RLS และ UUID จาก mapping ฝั่ง server เท่านั้น

ถ้าเคยรัน 001 เวอร์ชันแรก ต้องรัน 002 เพิ่ม: การถอน `PUBLIC` อย่างเดียวไม่ถอน grant ของ `anon`/`authenticated` ที่โปรเจกต์มีอยู่ จึงต้องปิดสิทธิ์ทั้งสาม role แล้วให้กลับเฉพาะฟังก์ชันที่แต่ละ role ใช้

## 2. Google Login (Supabase Auth)

ขั้นตอนปัจจุบันอยู่ใน [SUPABASE_LOGIN.md](SUPABASE_LOGIN.md) (เลิกใช้ Firebase ตั้งแต่ 12 พ.ย. 2569) ข้อความด้านล่างในหัวข้อนี้เป็นประวัติของระบบ Firebase เดิม

ใน Firebase project `dobao-muge100` เปิด Authentication → Google provider และเพิ่ม Authorized domains: `localhost`, `dobaohealth.vercel.app` ตั้ง Web config และ Admin credential ตาม `.env.example`

ใน Supabase Authentication → Third-party Auth เพิ่ม Firebase Project ID:

```text
dobao-muge100
```

Service account JSON เป็น private key ให้เก็บนอก repo แล้วตั้ง `FIREBASE_SERVICE_ACCOUNT_FILE` สำหรับ local บน Vercel ตั้ง `FIREBASE_SERVICE_ACCOUNT_JSON` เป็น secret โดยตรง **ไม่ส่ง private key ในแชตหรือฝั่ง browser** ถ้าโดเมนเปลี่ยน ให้เปลี่ยน `APP_ORIGIN`, Firebase Authorized domains และ CSP frame-src ตามจริง

## 3. บริการ AI

โมเดล MLX ใน `/Users/tawan/aimuge` ต้องรันบน Mac ที่รองรับ ไม่ได้อัปโหลด weights ไป Vercel

สำหรับ local:

```text
APP_ORIGIN=http://localhost:3000
RUAMWAN_BASE_URL=http://127.0.0.1:8765
```

สำหรับเครื่องนี้ตั้ง `RUAMWAN_API_KEY_FILE=/Users/tawan/aimuge/.secrets/api-key` แล้ว `npm run dev` จะอ่าน key เดิมเข้า memory โดยไม่คัดลอกลงโค้ดหรือแสดงค่า ถ้าตั้ง `RUAMWAN_API_KEY` เองจะใช้ค่าจาก env ก่อน การอ่าน secret file ใช้ได้เฉพาะ local ไม่รองรับบน Vercel/production

สำหรับ Vercel:

- ผู้ดูแลต้องจัดเตรียม **HTTPS gateway แบบ authenticated/private** ไปยัง Mac พร้อม TLS และนโยบายเข้าถึง ไม่เปิด port 8765 สาธารณะ
- ตั้ง `RUAMWAN_BASE_URL=https://<your-private-gateway>` เป็น origin เท่านั้น ไม่มี path, query หรือ username/password
- ใช้ `RUAMWAN_GATEWAY_URL` แทนได้ ชื่อนี้มีลำดับก่อน `RUAMWAN_BASE_URL` หากกำหนดทั้งคู่; Quick Tunnel ที่ตั้งในเครื่องตอนนี้เป็น URL ทดสอบชั่วคราว
- ตั้ง `RUAMWAN_API_KEY` ฝั่ง server ถ้า gateway ใช้ Cloudflare Access ให้ตั้ง `AI_GATEWAY_CLIENT_ID` และ `AI_GATEWAY_CLIENT_SECRET` ด้วย
- Gateway ต้องส่ง `Authorization` และ `X-Ruamwan-User` ต่อ และ rewrite upstream `Host` เป็น `127.0.0.1:8765` หรือ `localhost:8765` ตาม TrustedHost ของบริการ
- ไม่ต้องเปิด CORS ให้ browser เรียก AI โดยตรง เว็บเรียกผ่าน `/api` เท่านั้น
- ตั้ง read timeout ของ gateway ให้รองรับ 210 วินาทีจริง อย่าสันนิษฐานว่า tunnel ทุกแบบรองรับได้
- Mac ต้องออนไลน์ ไม่ sleep มี backup ที่เข้ารหัส จำกัดสิทธิ์ไฟล์ และทดสอบ recovery บริการ AI ต้องรองรับการแยก owner จริงก่อนเปิดรับคนหลายบัญชี

ห้ามสร้าง public tunnel โดยไม่ทบทวนนโยบายข้อมูลสุขภาพ เว็บไม่ fallback เป็นคำตอบปลอมเมื่อ Mac/gateway หยุดทำงาน

## 4. ประกาศความเป็นส่วนตัว

สำหรับการทดสอบของเจ้าของในเครื่องตอนนี้ เปิด `LOCAL_TEST_MODE=true` ให้แล้ว ไม่ต้องกรอก metadata production เพื่อเริ่มลองข้อมูลสมมติ ระบบยัง Login/บันทึกจริงและแสดงคำเตือน ไม่ใช่ข้อมูล mock ดู [ข้อจำกัด local test](SUPABASE_LOGIN.md#5-โหมดทดสอบในเครื่อง) ห้ามเปิด dev server ผ่าน public tunnel และห้ามใช้ข้อมูลผู้ป่วยจริง

ให้ผู้รับผิดชอบตรวจข้อความใน `index.html` และตั้งค่า:

```text
DATA_CONTROLLER=<ชื่อบุคคล/องค์กรผู้ควบคุมข้อมูลจริง>
PRIVACY_CONTACT=<ช่องทางติดต่อจริง เช่น LINE เบอร์โทร หรือ URL ติดต่อ>
# หรือใช้ PRIVACY_CONTACT_EMAIL แทนได้
DATA_RETENTION_NOTICE=<เก็บนานเท่าใด ครอบคลุม active data, logs และ backups>
DATA_LOCATION_NOTICE=<region ของ Supabase/Vercel/Google และที่ตั้ง Mac รวมการโอนข้อมูล>
PRIVACY_NOTICE_READY=true
```

อย่าใส่ค่าตัวอย่างเพื่อข้าม gate บน production ระบบปิดปุ่มเข้าสู่ระบบจนผู้ดูแลกำหนดประกาศครบ การรับทราบข้อกำหนดตอน Login แยกจาก consent ข้อมูลสุขภาพ และ AI เป็นตัวเลือกแยกที่ไม่ถูกเลือกไว้ล่วงหน้า ผู้ใช้เปลี่ยน/ถอน consent ได้

ต้องกำหนดฐานกฎหมายสำหรับข้อมูลบัญชี ช่องทางใช้สิทธิ อายุผู้ใช้/ผู้แทนโดยชอบธรรม วิธีจัดการเหตุข้อมูลรั่ว ข้อตกลงกับผู้ประมวลผล และนโยบายสำรองข้อมูลเพิ่มเติมก่อนรับข้อมูลจริง Checkbox ไม่ได้ทำให้ระบบรับรอง PDPA โดยอัตโนมัติ ควรให้ผู้รับผิดชอบกฎหมายตรวจ [พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล](https://www.etda.or.th/getattachment/Our-Service/Standard/eCommerceServiceProviders/Content/seminar/Data-Protection-Act.pdf.aspx?lang=th-TH)

การลบในแอปเป็นการลบบันทึกสุขภาพ/แผน น้ำดื่มและเป้าหมาย **ไม่ใช่การปิดบัญชี Google/Supabase Auth** บัญชีอ้างอิงใน Supabase และประวัติ consent ยังคงอยู่ตามประกาศ การลบสำรองข้อมูล/บัญชีต้องมีขั้นตอนที่ผู้ดูแลดำเนินการได้จริง

## 5. Vercel

โปรเจกต์เดิมคือ `muge` ตั้ง Framework preset เป็น Other, Node 22+, Build command `npm run build`, Output directory `dist` ตาม `vercel.json`

ใส่ env ทุกตัวใน Production/Preview ให้ตรง environment โดย `APP_ORIGIN` ต้องเป็น URL เดียวกับที่กำลังเปิดเว็บ และเพิ่ม URL ของ environment นั้นใน Supabase Auth Redirect URLs

เปิด Fluid Compute/แผนที่อนุญาต function duration 300s (`vercel.json` ตั้งไว้) ตรวจข้อจำกัดแผนจริงจาก [Vercel duration](https://vercel.com/docs/functions/configuring-functions/duration)

```sh
npm run release:check
vercel
```

ทดสอบ Preview ด้วยบัญชีทดสอบก่อน เมื่อผ่าน checklist แล้วจึง deploy Production:

```sh
vercel --prod
```

ยังไม่เผยแพร่ทับ prototype เดิม จนกว่า Google Login/RLS end-to-end, production secrets, HTTPS AI gateway และประกาศจะตรวจครบ ปิด `LOCAL_TEST_MODE` ก่อน release ห้ามคัดลอก `.env.local` ทั้งไฟล์ไป Vercel เพราะมีค่าที่ใช้เฉพาะเครื่อง

## 6. Checklist ก่อนรับข้อมูลผู้ป่วย

ตรวจค่าที่ตั้งและการเชื่อมต่อโดยไม่อ่านข้อมูลผู้ป่วย/ไม่พิมพ์ secret:

```sh
npm run setup:check
npm run setup:check -- --offline
npm run setup:check -- --production
```

คำสั่งแรกตรวจ Google provider ของ Supabase Auth, ตาราง/RPC ผ่าน schema metadata และ AI readiness/auth ด้วย food catalog คำสั่ง production ไม่ใช้ local key file และปฏิเสธ loopback รวมถึงบริการ AI ที่ยังรายงาน `production=false` การตรวจผ่านไม่ทดแทน Google Login จริง, RLS สองบัญชี หรือการตรวจ clinical/legal

- [ ] SQL migration ผ่านใน staging; ทดสอบผู้ใช้ A/B ข้ามบัญชีไม่ได้ทั้ง REST และ RPC; anonymous อ่านไม่ได้
- [ ] Google Login (Supabase Auth) จริงบนมือถือ/desktop, token refresh และ logout ผ่าน
- [ ] หน้าแรกไม่มี mock health data; เพิ่ม/แก้/ลบ/โหลดใหม่/สองอุปกรณ์ผ่าน
- [ ] เข้าระบบโดยไม่ให้ consent แล้วบันทึกไม่ได้; AI off แล้วยังบันทึก manual ได้; ถอน consent หยุดการประมวลผล
- [ ] AI gateway production ผ่าน readiness/owner isolation/timeout/busy; secrets ไม่อยู่ใน response หรือไฟล์ public
- [ ] ยืนยันซ้ำด้วย key เดิมไม่สร้างข้อมูลซ้ำ; cancel ร่างไม่บันทึก; AI action ไม่ auto-confirm
- [ ] export มีข้อมูลครบและลบครบทั้ง AI/Supabase; ทดสอบ failure ระหว่าง sync ด้วย
- [ ] ปิดหน้าเว็บระหว่างลบแล้วเข้ามากดตรวจต่อได้; snapshot เก่าไม่คืนข้อมูลที่ลบ; daily edit ใหม่หลังยืนยันไม่ถูกล้าง
- [ ] ตรวจข้อมูลยา/เวลา/หน่วยและ safety ของคำตอบกับผู้เชี่ยวชาญ ไม่ใช้แทนแพทย์
- [ ] ตรวจจอจริง 360px/390px/tablet/desktop, keyboard, screen reader, contrast และผู้สูงอายุทดลองใช้งาน
- [ ] ผู้รับผิดชอบอนุมัติประกาศ PDPA, retention, backup/restore, access logs และแผน incident
