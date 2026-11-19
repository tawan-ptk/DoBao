# DoBao · Baobuddy

เว็บภาษาไทยสำหรับบันทึกสุขภาพและกิจวัตร คง HTML/CSS/JavaScript เดิม ใช้ Google Login ผ่าน Supabase Auth, ฐานข้อมูล Supabase และ API ร่วมวัน AI ไม่มีกล้อง/สแกนอาหาร และไม่มีคำตอบ AI จำลองเมื่อบริการล่ม

## สถานะสำคัญ

โค้ดพร้อมสำหรับ **ตั้งค่าและทดสอบ staging** ยังไม่ควรเปิดรับข้อมูลผู้ป่วยจริง จนกว่ารายการใน [DEPLOYMENT.md](docs/DEPLOYMENT.md) จะครบ

ตั้ง Supabase (URL, publishable key, secret key) ใน `.env.local` และเปิด Google provider ใน Supabase Auth ตาม [SUPABASE_LOGIN.md](docs/SUPABASE_LOGIN.md) ไฟล์ secret ไม่อยู่ใน static build การตรวจ `setup:check` ไม่ใช่การพิสูจน์ Google Login และ RLS end-to-end ซึ่งต้องทดสอบด้วยบัญชีจริง

## เปิดในเครื่อง

เปิดโหมดทดสอบ local ให้แล้วตามคำขอ ใช้ข้อมูลสมมติเท่านั้น ยังต้อง Google Login และเลือกอนุญาตเอง แต่ไม่ต้องกรอกประกาศ production ตอนนี้ ดูข้อจำกัดและวิธีปิดโหมดใน [SUPABASE_LOGIN.md](docs/SUPABASE_LOGIN.md#5-โหมดทดสอบในเครื่อง) และ [DEPLOYMENT.md](docs/DEPLOYMENT.md)

ต้องใช้ Node.js 22 ขึ้นไป การเปิด `index.html` โดยตรงหรือ Live Server ไม่เพียงพอแล้ว เพราะต้องมี backend และ bundle ของ Supabase SDK

```sh
npm ci
npm run dev
```

เปิด `http://localhost:3000` ตั้งค่า `.env.local` ตาม `.env.example` ห้ามใส่ server secrets ลง `script.js`, HTML, Git หรือแชต

```sh
npm run check
npm run setup:check
```

คำสั่งนี้ตรวจ syntax, รันทดสอบ และ build เฉพาะไฟล์สาธารณะไป `dist/` ไม่ได้พิสูจน์ว่าตั้งค่า Google/Supabase production สำเร็จ

`setup:check` ตรวจสิ่งที่ยังขาดพร้อมทดสอบการเชื่อมต่อแบบอ่านอย่างเดียว โดยไม่พิมพ์ secret และไม่อ่านข้อมูลผู้ป่วย

คู่มือทดลองแต่ละหน้าและรายการก่อนเผยแพร่อยู่ใน [HANDOFF.md](docs/HANDOFF.md) ก่อน deploy ใช้ `npm run release:check` ซึ่งจะไม่ผ่านเมื่อยังเปิด local test mode หรือการตั้งค่า production ไม่ครบ

## โครงสร้างข้อมูล

```text
Browser (Supabase Auth JWT จาก Google) → /api (Supabase Auth verify + consent)
                ├─ Supabase: บัญชี ชื่อ ความยินยอม น้ำดื่ม เป้าหมาย
                └─ AI gateway → FastAPI/MLX บน Mac: ต้นฉบับบันทึกสุขภาพ
                                      ↓ อ่านหลังยืนยัน
                       Supabase: สำเนาสุขภาพแบบ read-only projection
```

**สำคัญ:** ตามเอกสารส่งต่อของโมเดล ข้อมูลสุขภาพต้นฉบับอยู่ในบริการ AI สำเนาอยู่ Supabase ไม่ใช่ย้ายฐานต้นฉบับทั้งหมดมา Supabase เว็บจะไม่บันทึกสุขภาพแยกสองระบบเอง ถ้าต้องการให้ Supabase เป็นฐานสุขภาพต้นฉบับเพียงแห่งเดียว ต้องปรับสัญญาและฐานเก็บของบริการ AI เพิ่มเติมก่อน

ไม่มี AI วินิจฉัยโรค/สั่งยา ระบบแสดงข้อมูลที่กรอก ค่าพลังงานเป็นค่าประมาณจากแหล่งอ้างอิง ข้อมูลที่ไม่ทราบแสดงว่าไม่ทราบ ไม่แทนด้วยศูนย์ และทุกการเพิ่ม/แก้ไข/ลบต้องตรวจร่างแล้วกดยืนยัน

## ไฟล์หลัก

| ไฟล์ | หน้าที่ |
| --- | --- |
| `index.html`, `style.css` | หน้าจอไทย responsive เมนู Home กลางด้านล่าง หน้าบัญชีและ consent |
| `script.js`, `client-data.js` | flow ร่าง/ตรวจ/ยืนยัน ประวัติ แชต น้ำดื่ม เป้าหมาย กราฟ |
| `api/index.js`, `server/supabase-auth.mjs` | ตรวจ Supabase token จับคู่ UUID ตรวจ consent และ proxy |
| `auth-client.js` | Google redirect (PKCE), จดจำการล็อกอินใน localStorage, refresh token และ logout |
| `server/ai.mjs`, `server/security.mjs` | เชื่อม AI ฝั่ง server จำกัดปลายทาง origin และ owner |
| `supabase/migrations/001_dobao.sql` | ตาราง RLS RPC rate limit/concurrency/projection |
| `supabase/migrations/004_cleanup_recovery.sql`, `005_projection_barrier.sql` | ติดตามคำขอลบที่ค้างและป้องกันซิงก์เก่านำข้อมูลที่ลบแล้วกลับมา |
| `vercel.json` | build, Node function, HTTPS security headers |
| `tests/` | unit, security และ DOM flow tests ด้วย fixture |
| `scripts/smoke-ai.mjs` | ทดสอบ API จริงบน Mac ด้วย owner ทดสอบและไม่ยืนยันบันทึก |

รายละเอียด endpoint และข้อจำกัดดู [INTEGRATION.md](docs/INTEGRATION.md) ผลตรวจดู [TESTING.md](docs/TESTING.md)
