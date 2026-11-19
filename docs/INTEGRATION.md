# สัญญาการเชื่อมต่อ

เว็บใช้ API ตามเอกสารร่วมวัน 0.10.0 และโค้ดใน `/Users/tawan/aimuge` ไม่เรียกโมเดลภายนอกเพิ่มเติม

| หน้าจอ/การกระทำ | API ของเว็บ | ปลายทางจริง |
| --- | --- | --- |
| Login/Logout | Supabase Google redirect → `/api/auth/supabase`, `/api/auth/logout` | Supabase Auth verify + Google/recent-login check + UUID mapping |
| บัญชี/consent | `/api/session`, `/api/profile`, `/api/consent` | Supabase RLS + consent events |
| รูป/ปุ่มลัด | `/api/profile/avatar`, `/api/profile/shortcuts` | Supabase owner RLS + profile revision จาก 006 |
| น้ำดื่ม/เป้าหมาย | `/api/daily` | Supabase compare-and-swap revision |
| Dashboard/ประวัติ | `/api/health/sync` | AI records + summary + plans → Supabase projection |
| บันทึกข้อความ | `/api/ai/journal/prepare` | AI `/api/journal/prepare` |
| เพิ่ม/แก้ไขด้วยตนเอง | `/api/ai/records/batch-preview` | AI draft และ validation |
| ยืนยันทุกชนิด | `/api/ai/confirm` | AI confirm + projection sync |
| ลบข้อมูล | `/api/ai/records/delete-preview` → confirm | AI preview, explicit confirm |
| ตรวจการลบที่ค้าง | `/api/account/cleanup` GET/POST | owner-scoped durable receipt; ทำต่อเมื่อผู้ใช้กดเอง |
| พลังงานอาหาร | `/api/ai/food-energy` | ฐานอ้างอิงของ AI ไม่เดาตัวเลข |
| Baobuddy | `/api/ai/chat` | AI chat ตอบตาม status/details/citations/actions |
| ตารางกิจวัตร | `/api/ai/plans/preview`, `/api/ai/plans/<id>/recheck` | preview → confirm / recheck |
| ดาวน์โหลดข้อมูล | `/api/account/export` | AI export + Supabase profile/daily/consent/cleanup requests ทุกหน้า |

ทุก AI request มี server-only Bearer key และ `X-Ruamwan-User: dobao:<UUID ภายในที่จับคู่จากบัญชี Supabase Auth ที่ตรวจแล้ว>` ไม่รับ owner/gateway URL จาก browser Secret ต้องไม่ถูกส่งกลับ client ไม่มี service role ใน static bundle

## ร่างและการยืนยัน

- หลัง parse ให้แก้ชนิดบันทึก วัน เวลา รายละเอียด รายการย่อยได้ เลือกรายการที่ต้องการบันทึกก่อนตรวจ
- `captured_at` คงเดิมตลอดการแก้ไข และวันใช้ Asia/Bangkok เวลาไม่ชัดเจนไม่เติมเวลาเอง ช่วงเช้าไม่แปลงเป็นชั่วโมงสมมติ
- การแก้ไขใช้ `previous_id` และตัด metadata ของ server ออกก่อนส่ง ข้อมูลเดิมไม่ถูกเขียนทับตรง ๆ
- มี components แล้วตัด quantity/unit ของแม่ออก Unknown ไม่แทนด้วย 0 รายงานพลังงาน partial/assumed portion ให้เห็น
- ตรวจครั้งใหม่ทุกครั้งเมื่อแก้ไข ผลตรวจที่กลับมาช้าจะไม่ปลดล็อกยืนยันร่างที่เปลี่ยนแล้ว
- ครั้งแรกที่กดยืนยันล็อก payload และเก็บ UUID idempotency key เดิมไว้ เมื่อเครือข่ายขาดผู้ใช้กดลองซ้ำเอง ไม่มี automatic retry generation/confirmation
- ถ้าร่างหมดอายุ ให้โหลดประวัติเพื่อตรวจว่าบันทึกแล้วหรือไม่ก่อนสร้างร่างใหม่
- AI storage consent กับ Supabase health consent เป็นคนละชั้น ถ้า API ขอ local-storage consent จะแสดง checkbox ก่อน preview ใหม่
- บันทึกสุขภาพสำเร็จแต่ projection ล้มเหลว แจ้งว่าต้นฉบับบันทึกแล้ว และให้โหลดใหม่ ไม่สร้างบันทึกซ้ำ
- ก่อนส่งยืนยันลบ เก็บ durable receipt ที่ผูกกับ owner/draft/key ไว้ใน Supabase ถ้า AI ลบแล้วแต่ล้างสำเนายังไม่ครบ จะไม่แสดงว่าลบครบ เมื่อเปิดเว็บใหม่จะแสดงปุ่ม “ตรวจและทำต่อ” ใช้คำขอและ key เดิม ไม่ retry เองใน background
- ถ้า AI draft หมดอายุ/บริการ restart แล้วไม่รู้ผล ต้องตรวจประวัติทุกเวอร์ชันและ revision ที่คงที่ก่อนสรุปว่า IDs ที่เลือกหายไปจริง การดูเฉพาะ current records อาจเข้าใจผิดว่าการแก้ไขเป็นการลบ หากยังพิสูจน์ไม่ได้ จะหยุดและให้ผู้ดูแลตรวจ ไม่สร้างคำยืนยันใหม่อัตโนมัติ
- ถ้ามีเฉพาะน้ำดื่ม/เป้าหมาย แต่ AI ไม่มีบันทึกหรือแผน ใช้ร่างแยกฝั่ง server ตรวจ AI ว่างและ revision เดิมอีกครั้งก่อนล้าง daily ไม่ฝืน `can_confirm=false` ของ AI
- ล้าง Supabase ภายใน transaction และรักษา daily edits ที่เกิดหลังเวลายืนยันเดิมไว้ เหลือ projection ว่างที่มี revision floor ป้องกัน snapshot เก่ากลับมาเติมข้อมูลที่ลบไปแล้ว ข้อมูลใหม่จากต้นฉบับจะซิงก์ได้ตาม revision ปัจจุบัน
- Receipt เก็บเฉพาะ UUID/IDs/จำนวน/revision/เวลา/สถานะ ไม่มีข้อความยา อาหาร หรือแชต บัญชี ประวัติ consent และ receipt ยังอยู่ ผู้ดูแลต้องกำหนด retention ของ metadata นี้ด้วย การลบไม่ใช่ distributed transaction หรือการลบข้อมูลจาก backups

## ความยินยอมและความปลอดภัย

Health/AI consent แยกกัน ไม่บังคับ AI เพื่อใช้ manual entry เว้นแต่ upstream เองต้องขอ storage consent เพื่อเก็บต้นฉบับ ต้องยืนยันประกาศฉบับปัจจุบันก่อนประมวลผลสุขภาพ หลังถอน consent ยัง export/ลบข้อมูลได้ การยืนยันใหม่หลังถอนอนุญาตเฉพาะ deletion draft ที่มี signed owner-bound receipt ส่วน `/account/cleanup` ทำต่อได้เฉพาะคำขอของผู้ใช้นั้นที่เคยยืนยันด้วย key แล้ว

Supabase SDK จดจำสถานะ auth ใน localStorage ของอุปกรณ์จนกว่าจะออกจากระบบ ส่ง access token ผ่าน Authorization header และ refresh เมื่อจำเป็น Backend ตรวจ token กับ Supabase Auth/Google provider/email verified ทุกคำขอ จากนั้นใช้ token เดียวกันภายใต้ RLS ไม่ใช้ service key แทนผู้ใช้ ไม่เก็บสุขภาพใน browser คุกกี้ HttpOnly ใช้เฉพาะ deletion receipt เขียนต้องมี Origin ตรง `APP_ORIGIN` และ custom CSRF header จำกัด API path และห้าม redirect ของ AI gateway ข้อความโมเดลแสดงด้วย textContent ลิงก์อ้างอิงรับ HTTPS เท่านั้น Actions เป็น allowlist ไม่รันโค้ด/URL ที่โมเดลส่งมา

Rate limit ใน Supabase: inference 8/min/บัญชี, write 40/min/บัญชี, read 100/min/บัญชี มี global lease สำหรับ inference 1 คำขอพร้อมกัน ช่วยป้องกัน Mac งานล้น แต่ไม่ใช่ระบบป้องกัน DDoS เต็มรูปแบบ ควรเปิด WAF/platform limits เพิ่ม

## ข้อจำกัดที่ต้องรับทราบ

- `profile-data.js` แมปแบบฟอร์มเป็น `Profile` ของ AI: age/weight_kg/height_cm, conditions/medications/allergies/preferences/goals/mobility_limits และ reported_type2/pregnant/complex_care; เก็บ prohibited_catalog_ids เดิมเมื่อแก้ไข ไม่ส่งชื่อ/รูปที่ schema ไม่รองรับ การแก้ไขใช้ previous_id ไม่เพิ่มโปรไฟล์ซ้ำโดยตั้งใจ
- `/profile/avatar` รับภาพย่อจาก browser แล้ว decode/re-encode ฝั่ง server เป็น WebP 256px จำกัด pixels/ขนาด ตัด metadata; `/profile` ไม่รับ image URL ภายนอก ข้อมูลที่เขียนใช้ revision กันแท็บเก่าทับแท็บใหม่
- รูป ชื่อ ธีม และปุ่มลัดอยู่ในบัญชี ไม่ลบด้วย “ลบสุขภาพทั้งหมด”; มีปุ่มลบรูปและปุ่มลัดแยกใน UI

- Mac/gateway ล่ม จะอ่าน/เขียนสุขภาพไม่ได้ ไม่มี offline write queue และไม่แสดง cache เก่าว่าเป็นปัจจุบัน
- การนอนบันทึกเป็นช่วงเวลาเริ่ม/สิ้นสุดและวิธีวัด จำนวนก้าวยังไม่มี structured field ในสัญญาโมเดลที่ใช้ ไม่แอบเก็บเป็น glucose/ค่าอื่น
- ตารางและยาที่บันทึกไม่ได้ส่ง push notification จริง; ไม่ถือเป็นระบบรับประกันการเตือนยา
- กราฟแยกค่าที่เงื่อนไข/หน่วย/วิธีวัด/ที่มาเหมือนกัน ไม่จัดประเภทน้ำตาลว่าอันตราย/ปกติแทนแพทย์
- ตรวจครบเฉพาะ software contract ไม่ได้ยืนยัน clinical accuracy ของโมเดล หรือ legal compliance ขององค์กร
- ประวัติร่างที่ยังไม่ยืนยันและแชตบนหน้าจออยู่ใน memory ฝั่งเว็บ บริการ upstream อาจมี temporary drafts/logs; ผู้ดูแลต้องระบุ retention ให้ตรงความจริง
