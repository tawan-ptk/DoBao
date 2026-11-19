# Google Login ผ่าน Supabase Auth

ตั้งแต่ 12 พฤศจิกายน 2569 DoBao ใช้ Supabase Auth (Google provider) อย่างเดียว ไม่ใช้ Firebase อีกแล้ว ไม่ต้องมี service account JSON หรือตัวแปร `FIREBASE_*`

**ขั้นตอนการทำงาน:** ผู้ใช้กดปุ่ม Google → ไปหน้า Google (redirect แบบเต็มหน้า ไม่ใช่ popup) → กลับมาที่ `APP_ORIGIN/?code=…` → `auth-client.js` แลก code เป็น session (PKCE) แล้วลบ code ออกจาก URL → `POST /api/auth/supabase` ลงทะเบียนบัญชี → เปิดหน้า Dashboard/consent

## 1. Google Cloud

ทำตาม [GOOGLE_LOGIN.md ส่วน A](GOOGLE_LOGIN.md#a-google-cloud) Authorized redirect URI ต้องเป็น callback ของ Supabase project **ที่ใช้อยู่จริง**:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

ถ้าสร้างโปรเจกต์ Supabase ใหม่ ref จะเปลี่ยน ต้องแก้ URI ใน Google Cloud ด้วย

## 2. Supabase Dashboard

1. Authentication → Sign In / Providers → **Google**: เปิด แล้ววาง Client ID/Secret จาก Google Cloud
2. Authentication → URL Configuration
   - Site URL: `https://dobaohealth.vercel.app`
   - Redirect URLs: `http://localhost:3000/` และ `https://dobaohealth.vercel.app/` (มี `/` ท้าย ไม่ใช่ `/api/auth/callback` แบบเก่า)
3. Authentication → Sign In / Providers → **Third-party Auth**: ลบ Firebase ออก (ถ้ามี)
4. SQL Editor: รัน migration ที่ยังไม่ได้รันตามลำดับใน `supabase/migrations/` จนถึง `008_supabase_auth.sql` ถ้าเป็นโปรเจกต์ใหม่ให้รัน 001 → 008 ทั้งหมด
5. Project Settings → API: คัดลอก URL, publishable key และ secret key ไปใส่ใน `.env.local` และ Vercel (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) แล้ว redeploy

ตรวจ:

```sh
npm run setup:check   # ต้องเห็น PASS SUPABASE_GOOGLE_PROVIDER และ PASS DATABASE_SCHEMA
npm run check
npm run dev           # http://localhost:3000
```

## 3. ความปลอดภัยที่คงไว้

- เซิร์ฟเวอร์ตรวจ access token กับ Supabase Auth (`auth.getUser`) ทุกคำขอ และรับเฉพาะบัญชี Google ที่ยืนยันอีเมลแล้ว ไม่รับ anonymous user
- การลงทะเบียนต้องรับทราบประกาศ และต้องเข้าสู่ระบบ Google มาไม่เกิน 5 นาที (ดูจาก claim `amr`)
- `dobao_register_supabase` เรียกได้เฉพาะ service role ส่วน RLS ทุกตารางยังผ่าน `dobao_current_user_id()` ซึ่งรับเฉพาะ token ของ Supabase Auth
- จดจำการเข้าสู่ระบบไว้ใน localStorage ของอุปกรณ์ จนกว่าจะกดออกจากระบบ (ถ้าเบราว์เซอร์ไม่ให้ใช้ localStorage เช่นโหมดส่วนตัว จะเก็บเฉพาะแท็บนี้) Logout ออกเฉพาะอุปกรณ์นี้
- CSP อนุญาต `connect-src https://*.supabase.co` ถ้าใช้ custom domain ของ Supabase ต้องเพิ่มโดเมนนั้นใน `vercel.json`

## 4. บัญชีเดิมจาก Firebase

ข้อมูลของบัญชีที่สร้างผ่าน Firebase **ยังอยู่ครบ** แต่ token ของ Firebase ใช้เข้าไม่ได้แล้ว เมื่อผู้ใช้เข้าสู่ระบบด้วย Supabase ครั้งแรก ระบบจะสร้างบัญชีใหม่ที่ยังว่าง ระบบไม่จับคู่ให้อัตโนมัติด้วยอีเมล

ถ้าต้องการย้ายข้อมูลเดิมให้ผู้ใช้คนหนึ่ง ผู้ดูแลต้องยืนยันตัวตนผู้ใช้ก่อน แล้วรันใน SQL Editor (สำรองข้อมูลก่อน):

```sql
-- <firebase-uid>: UID เดิมจาก Firebase Console → Authentication → Users
-- <auth-user-id>: UUID จาก Supabase → Authentication → Users
begin;
-- ถ้าผู้ใช้เข้าสู่ระบบ Supabase แล้ว จะมีบัญชีใหม่ที่ว่างอยู่ ต้องลบออกก่อน ถ้าบัญชีใหม่มีข้อมูลแล้ว ห้ามรัน และให้ติดต่อผู้พัฒนา
delete from public.dobao_accounts a where a.auth_user_id = '<auth-user-id>'
  and not exists (select 1 from public.dobao_consent_events where user_id = a.id)
  and not exists (select 1 from public.dobao_profiles where user_id = a.id)
  and not exists (select 1 from public.dobao_support_requests where user_id = a.id)
  and not exists (select 1 from public.dobao_cleanup_jobs where user_id = a.id);
update public.dobao_accounts
  set auth_user_id = '<auth-user-id>', firebase_project = null, firebase_uid = null
  where firebase_project = 'dobao-muge100' and firebase_uid = '<firebase-uid>';
commit;
```

ข้อมูลสุขภาพในบริการ AI ผูกกับ UUID ภายในของบัญชี (`dobao:<id>`) การย้ายแบบนี้จึงคง id เดิมไว้ และข้อมูล AI ตามไปด้วย

## 5. โหมดทดสอบในเครื่อง

ยังใช้ `LOCAL_TEST_MODE=true` ได้เหมือนเดิม ทำงานเฉพาะ `npm run dev` บน `http://localhost:3000` ใช้ข้อมูลสมมติเท่านั้น และต้องรับทราบประกาศ/เลือก consent เอง (รายละเอียดเดิมอยู่ใน [DEPLOYMENT.md](DEPLOYMENT.md))

## ข้อความผิดพลาด

| อาการ | สิ่งที่ต้องตรวจ |
| --- | --- |
| `DB-CONNECTION` | `SUPABASE_URL` ผิด หรือโปรเจกต์ถูกพัก/ลบ |
| `DB-PGRST202` / ไม่พบ RPC | ยังไม่ได้รัน `008_supabase_auth.sql` |
| ผู้ดูแลยังไม่ได้เปิด Google provider | ข้อ 2.1 |
| `redirect_uri_mismatch` (หน้า Google) | URI ใน Google Cloud ต้องเป็น `…supabase.co/auth/v1/callback` |
| กลับมาผิดโดเมน / ไป Site URL แทน | เพิ่มโดเมนที่เปิดอยู่ใน Redirect URLs (ข้อ 2.2) |
| “กรุณาเข้าสู่ระบบในแท็บเดิม…” | ต้องกลับมาในแท็บเดียวกับที่กดปุ่ม (PKCE เก็บในเบราว์เซอร์ของแท็บนั้น) |
| เบราว์เซอร์ในแอป LINE/Facebook | Google ไม่อนุญาต ให้เปิดใน Chrome/Safari ตามคำแนะนำบนหน้า Login |
