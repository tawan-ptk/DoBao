# ตั้งค่า Google OAuth สำหรับ Supabase

> ใช้ส่วน A (Google Cloud) ของหน้านี้ร่วมกับ [SUPABASE_LOGIN.md](SUPABASE_LOGIN.md) ซึ่งเป็นขั้นตอนปัจจุบัน Redirect URLs ใน Supabase ให้ใช้ตาม SUPABASE_LOGIN.md (`/` ไม่ใช่ `/api/auth/callback`)

ขั้นตอนจาก [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google) ใช้ Google Cloud และ Supabase Dashboard ของเจ้าของบัญชี ไม่ต้องแก้ frontend หรือส่ง secret ให้ผู้พัฒนาในแชต

## A. Google Cloud

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) เลือกหรือสร้าง project ชื่อ DoBao
2. เปิด [Google Auth Platform](https://console.cloud.google.com/auth/overview) แล้วกด Get started ถ้ายังไม่เคยตั้งค่า
3. ใน Branding ใส่ App name = DoBao, User support email และ Developer contact เป็นอีเมลจริงของผู้ดูแล
4. ใน Audience เลือก External หากต้องให้ผู้ใช้นอกองค์กรเข้าได้ ถ้าอยู่ใน Testing ให้เพิ่มอีเมลที่ใช้ทดสอบใน Test users
5. ใน Data Access ใช้เฉพาะ `openid`, `userinfo.email`, `userinfo.profile` ไม่ต้องเพิ่มสิทธิ์ Gmail/Drive/ข้อมูลสุขภาพ Google
6. เปิด Clients → Create client → Application type = Web application ตั้งชื่อ DoBao Web
7. ใส่ Authorized JavaScript origins:

```text
http://localhost:3000
https://dobaohealth.vercel.app
```

8. ใส่ Authorized redirect URIs **ตรงตามนี้**:

```text
https://sfybvpjalptxvzctigjz.supabase.co/auth/v1/callback
```

9. กด Create เก็บ Client ID และ Client Secret ไว้ในช่อง secret ของผู้ให้บริการ ห้ามใส่ใน `script.js`/Git/แชต

ชื่อเมนูอาจแสดงใน APIs & Services → OAuth consent screen / Credentials ใน UI บางรุ่น ถ้าใช้ local development กับ Supabase hosted project นี้ callback ยังคงเป็น URL Supabase ด้านบน ไม่ใช่ `localhost:54321`

## B. Supabase

1. เปิด [โปรเจกต์ Supabase](https://supabase.com/dashboard/project/sfybvpjalptxvzctigjz)
2. Authentication → Sign In / Providers → Google
3. เปิด Enable sign in with Google วาง Client ID และ Client Secret จาก Google Cloud แล้ว Save
4. Authentication → URL Configuration ตั้ง Site URL:

```text
https://dobaohealth.vercel.app
```

5. เพิ่ม Redirect URLs:

```text
http://localhost:3000/api/auth/callback
https://dobaohealth.vercel.app/api/auth/callback
```

6. กลับมาที่ terminal ของเว็บ รัน `npm run setup:check` ควรเห็น `PASS GOOGLE_PROVIDER` แปลว่าเปิด provider แล้ว ไม่ได้หมายความว่าผ่าน OAuth แบบ end-to-end

## C. ทดสอบ

- ต้องกำหนดและทบทวนประกาศความเป็นส่วนตัวให้ครบก่อนเปิดปุ่ม Login ห้ามกรอกข้อมูลผู้ควบคุมปลอมเพื่อข้าม gate
- `npm run dev` → `http://localhost:3000` → อ่านประกาศ/เลือก checkbox → เข้าสู่ระบบ Google
- ใช้ test user ที่ใส่ใน Google Audience จากนั้นควรกลับมาหน้าบัญชีเพื่อเลือก health/AI consent แยกกัน
- `redirect_uri_mismatch`: ตรวจ URI ของ Google ให้ลงท้าย `/auth/v1/callback` ที่ Supabase ไม่ใช่ callback ของเว็บ
- กลับไปโดเมนผิด: ตรวจ Supabase Redirect URLs และ `APP_ORIGIN` ให้ตรงกับเว็บที่กำลังเปิด
- ถูกบล็อกใน Testing: เพิ่มอีเมลใน Test users ก่อน ไม่ต้องเพิ่ม scopes ที่ไม่เกี่ยวข้อง
- ก่อนรับผู้ใช้ทั่วไป ต้องตั้งสถานะ Audience/Publishing ตามข้อกำหนดของ Google และตรวจ branding/privacy policy ตามที่ Google ขอ ไม่อ้างว่า Google อนุมัติแล้วจากการเปิด toggle
