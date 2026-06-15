# Migration Runbook — GitHub Pages → Plesk Subdomain

วิธีย้าย hosting แบบ **rollback ได้ทุก step**. ทำตามลำดับ ห้ามข้าม. ติ๊ก ✅ เมื่อทำเสร็จแต่ละจุด

---

## ⚙️ ตัวแปรที่ต้องเติม (กรอกก่อนเริ่ม)

```
SUBDOMAIN          = dashboard.wkwkp.com           ← เปลี่ยนเป็น subdomain ของจริง
OLD_DOMAIN         = wkwkp-project.github.io       ← เปลี่ยนเป็น domain เดิม
REPO_URL           = https://github.com/WkWkp-Project/dashboard.git
DEPLOY_BRANCH      = fix-dash-codex                ← หรือ main ถ้า merge แล้ว
GOOGLE_OAUTH_ID    = 165279376241-gbee5rudn234trve8fsm6ccl35kgrrei.apps.googleusercontent.com
FIREBASE_PROJECT   = (ดูจาก index.html — firebaseConfig.projectId)
```

> ⚠️ ใช้ **find & replace** ในเอกสารนี้ก่อนเริ่ม — เปลี่ยนทุกที่ที่เขียน `SUBDOMAIN` เป็นค่าจริง

---

## Phase 0 — Pre-flight (ทำที่เครื่องตัวเอง, 5 นาที)

ตรวจสภาพ code ก่อนเริ่ม:

```bash
cd /path/to/dashboard
git status                              # ควรเป็น clean (no uncommitted)
git log --oneline -5                    # ดู commit ล่าสุด
node test/run-tests.mjs 2>&1 | tail -5  # ควรเห็น 325+/329 pass
```

- [ ] Working tree clean (ไม่มี uncommitted change)
- [ ] Self-tests ผ่าน 325+ / 329 (5 fixture failures ถือว่า OK)
- [ ] ทราบ commit hash ที่จะ deploy (บันทึก: `__________`)

**ถ้า fail:** หยุด แก้ให้ผ่านก่อน

---

## Phase 1 — DNS Preparation (1 ชั่วโมง ก่อนเริ่ม — รอ propagate)

### 1.1 ลด TTL ของ DNS เดิม (ถ้ามี)
ถ้า `SUBDOMAIN` ยังไม่มี A/CNAME record:
- ข้าม — ตั้งใหม่ใน Phase 3.2

ถ้ามี record อยู่แล้ว:
- ไปที่ DNS provider (Cloudflare / GoDaddy / domain registrar)
- หา record ของ `SUBDOMAIN` → แก้ TTL เหลือ **300** (5 นาที)
- รอ propagate ตาม TTL เดิม (max 1 ชั่วโมง)

**Verify:** `dig +short SUBDOMAIN` (หรือใช้ https://dnschecker.org)

- [ ] DNS TTL = 300s
- [ ] ตรวจแล้ว propagate ทั่วโลก

---

## Phase 2 — Plesk Setup (15-20 นาที)

### 2.1 สร้าง Subdomain ใน Plesk
1. Login Plesk panel (`https://your-plesk-server:8443`)
2. ไปที่ **Domains** → กด **Add Subdomain**
3. กรอก:
   - Subdomain name: `dashboard` (หรือชื่อที่เลือก)
   - Parent domain: `wkwkp.com`
   - Document root: ใช้ default (เช่น `/httpdocs/dashboard.wkwkp.com/`) — **จด path นี้ไว้**
4. กด **OK**

- [ ] Subdomain ถูกสร้าง
- [ ] จด document root: `__________________________`

### 2.2 ตั้ง SSL (Let's Encrypt)
1. ใน Plesk → คลิกที่ subdomain ที่เพิ่งสร้าง
2. หา **SSL/TLS Certificates** → กด **Install** ใต้ Let's Encrypt
3. ตั้งค่า:
   - ☑ Secure the domain name
   - ☑ Include www subdomain: **ไม่ต้องเลือก** (เราใช้ root subdomain)
   - Email: ใส่ email admin
4. กด **Get it free**
5. รอ ~30 วินาที จนเห็น "Certificate installed successfully"

**Verify:**
```bash
curl -I https://SUBDOMAIN
# ควรเห็น HTTP/2 200 หรือ 403 (เพราะยังไม่มีไฟล์) แต่ ไม่ใช่ SSL error
```

- [ ] SSL ติดตั้งสำเร็จ
- [ ] `curl -I` ไม่ขึ้น cert error

### 2.3 เปิด HTTPS redirect (HTTP → HTTPS)
1. ใน Plesk subdomain → **Hosting Settings**
2. หา **Permanent SEO-safe 301 redirect from HTTP to HTTPS** → ☑ **เปิด**
3. กด **OK**

- [ ] HTTP redirect → HTTPS เปิดแล้ว

---

## Phase 3 — Git Deploy Setup (10 นาที)

### 3.1 ติดตั้ง Git Extension ใน Plesk (ถ้ายังไม่มี)
1. Plesk → **Extensions** → ค้นหา "Git"
2. ถ้าเจอ "Git" extension และยังไม่ได้ติดตั้ง → กด **Install**
3. ถ้าไม่มี → ข้าม Phase 3.2 ไปที่ 3.3 (manual sftp)

### 3.2 ตั้งค่า Git pull (ถ้ามี extension)
1. ที่ subdomain → คลิก **Git** ในเมนู
2. กด **Add Repository**
3. กรอก:
   - Repository URL: `REPO_URL`
   - Use Git authentication: ถ้า repo private → กรอก deploy key หรือ token
   - Server path: document root ของ subdomain (จาก Phase 2.1)
   - Webhook: ☑ **เปิด** (เพื่อ auto-deploy เมื่อ push)
   - Tracking branch: `DEPLOY_BRANCH`
4. กด **OK**
5. กด **Pull Updates** เพื่อ pull ครั้งแรก

**Verify:**
```bash
curl -sI https://SUBDOMAIN/index.html | head -1
# ควรเห็น HTTP/2 200

curl -s https://SUBDOMAIN/ | grep -o '<title>[^<]*</title>'
# ควรเห็น <title>...Wakuwaku...</title>
```

- [ ] Repository ถูกตั้งค่า
- [ ] Pull ครั้งแรกสำเร็จ
- [ ] `curl` เห็น `<title>` ของ dashboard

### 3.3 ถ้าไม่มี Git extension — Manual SFTP
1. ใน Plesk subdomain → **FTP Access** → จด username/password
2. ใช้ FileZilla / Cyberduck เชื่อม sftp
3. Upload **ทั้ง folder** `dashboard/` → document root
4. ตรวจว่ามี `index.html`, `js/control.js`, `firestore.rules`

---

## Phase 4 — Nginx Configuration (5 นาที)

### 4.1 ตั้ง Cache Headers (สำคัญ — กัน index.html ค้าง cache)

1. ใน Plesk subdomain → **Apache & nginx Settings**
2. หา **Additional nginx directives** (box ใหญ่ ๆ ล่างสุด)
3. วาง config นี้:

```nginx
# index.html: no cache — admin ต้องเห็นเวอร์ชันใหม่ทันทีหลัง deploy
location = /index.html {
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;
}
location = / {
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
}

# js/css/images: cache 1 วัน (admin update ได้บ่อย)
location ~* \.(js|css|svg|png|jpg|jpeg|woff2?)$ {
    add_header Cache-Control "public, max-age=86400" always;
}

# Security headers
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

4. กด **OK**

**Verify:**
```bash
curl -I https://SUBDOMAIN/index.html | grep -i cache-control
# ควรเห็น: cache-control: no-cache, no-store, must-revalidate
```

- [ ] Nginx directives บันทึกแล้ว
- [ ] `curl` เห็น `cache-control: no-cache` บน `/index.html`

---

## Phase 5 — Auth Whitelist (สำคัญ — ต้อง propagate 5-10 นาที)

### 5.1 Google Cloud Console — เพิ่ม OAuth origin
1. ไปที่ https://console.cloud.google.com/apis/credentials
2. คลิกที่ OAuth 2.0 Client ที่ขึ้นต้นด้วย `165279376241-gbee5...`
3. ส่วน **Authorized JavaScript origins**:
   - **❗ ห้ามลบ origin เดิม** (`https://wkwkp-project.github.io` หรือเดิม)
   - กด **+ ADD URI**
   - ใส่: `https://SUBDOMAIN` (ไม่มี trailing slash, ไม่มี path)
4. กด **SAVE**
5. **รอ 5-10 นาที** ให้ propagate (Google บอกในหน้า)

- [ ] เพิ่ม origin ใหม่
- [ ] เก็บ origin เดิมไว้
- [ ] กด SAVE
- [ ] เวลาที่ SAVE: `__________` (รอ 10 นาทีจากเวลานี้)

### 5.2 Firebase Console — เพิ่ม Authorized domain
1. ไปที่ https://console.firebase.google.com
2. เลือก project (ดูจาก `firebaseConfig.projectId` ใน `index.html`)
3. **Authentication** → **Settings** tab → **Authorized domains**
4. กด **Add domain**
5. ใส่: `SUBDOMAIN` (ไม่มี https://, แค่ host)
6. กด **Add**

- [ ] เพิ่ม domain ใหม่
- [ ] เก็บ domain เดิมไว้ (สำคัญ! เพื่อ rollback)

### 5.3 Verify (หลัง wait 10 นาที)
ทดสอบใน browser ของคุณเอง (ห้ามให้ admin คนอื่น login ก่อน):
1. เปิด `https://SUBDOMAIN/` ในโหมด **Incognito**
2. กด "Continue with Google Workspace"
3. ถ้า popup login ขึ้นปกติ → ✅
4. ถ้าขึ้น `redirect_uri_mismatch` → รออีก 5 นาที (propagate ช้า)
5. ถ้าขึ้น `auth/unauthorized-domain` → Firebase ยังไม่ propagate, รอเพิ่ม

- [ ] Login popup ขึ้นได้ปกติ
- [ ] เห็นชื่อตัวเองหลัง login

---

## Phase 6 — First Admin Smoke Test (สำคัญ — ห้ามข้าม)

ทำคุณคนเดียว ใน Incognito ของ subdomain ใหม่

### 6.1 Basic load
- [ ] เปิด `https://SUBDOMAIN/` → ไม่มี error ใน Console (F12)
- [ ] Login ผ่าน Google → เห็นชื่อตัวเองใน sidebar
- [ ] Sidebar แสดง members ครบ (เหมือนเดิม)
- [ ] คลิกเข้า member → เห็น campaigns ของเขา (เหมือนเดิม)

### 6.2 Read existing data
- [ ] เปิด campaign ที่มีงานจริง → **เห็น assets ครบเหมือนเดิม**
- [ ] รูป/วิดีโอแสดงได้ปกติ (โหลดจาก Drive)
- [ ] Section B prompts เห็นครบ
- [ ] Drive links แสดงปกติ

❗ **ถ้าเห็นงานไม่ครบ — หยุดทันที** → ไป Phase 11 (rollback) ก่อน

### 6.3 Write test (ใช้ test campaign — ไม่ใช่ของลูกค้าจริง)
- [ ] สร้าง test campaign ใหม่ (หรือใช้ test data)
- [ ] Add asset ใหม่ → กรอก H2 + prompt → Save
- [ ] เห็น "Asset saved →" toast เขียว
- [ ] **Refresh หน้า** → asset ยังอยู่
- [ ] ดูใน Drive folder จริง → ไฟล์ `wakuwaku_campaign.json` ถูก update

❗ ถ้า asset หาย — หยุด เก็บ console log → ไป Phase 11

### 6.4 ตรวจ Console log
- F12 → Console
- [ ] ไม่มี error สีแดง (ยกเว้น `CERT_AUTHORITY` ของ Google iframe — เป็นปกติ)
- [ ] ไม่มี "Firebase init failed"
- [ ] ไม่มี "Drive token request" pop-up ซ้ำๆ

---

## Phase 7 — Team Coordination (ก่อน cutover)

### 7.1 ประกาศใน Line/Slack ทีม (ก่อน cutover 1 วัน)

```
🔔 ประกาศ: ย้าย Dashboard ไป URL ใหม่

📅 วันที่ย้าย: ___________ เวลา ___________

URL ใหม่: https://SUBDOMAIN
URL เดิม: https://OLD_DOMAIN (ยังใช้ได้ 30 วัน เป็น backup)

📋 สิ่งที่ทุกคนต้องทำ ก่อนเวลาย้าย:
1. เซฟทุกงานที่ค้างให้หมด (ดู save indicator เขียว "Drive JSON saved")
2. ปิด browser ทั้งหมดก่อนเวลาย้าย
3. หลังย้าย ใช้ URL ใหม่เท่านั้น

⚠️ ห้ามแก้งานช่วงเวลา cutover (15 นาที)

ถ้ามีปัญหาหลังย้าย:
1. แจ้ง admin
2. ใช้ URL เดิมต่อได้ (ไม่หาย)
```

- [ ] ประกาศส่งให้ admin ทุกคน
- [ ] รับ confirmation ว่าทุกคนเข้าใจ

### 7.2 Verify ก่อน cutover (10 นาทีก่อนเวลา)
ที่ admin panel ของ Firestore Console:
1. เปิด collection `control_signals`
2. ดูว่ามี signal ใหม่ ๆ ในช่วง 5 นาทีล่าสุดไหม
3. ถ้าไม่มี → ทีมหยุดทำงานแล้ว ✅
4. ถ้ามี → รอ + ส่งข้อความเตือน

- [ ] ไม่มี signal ใหม่ใน 5 นาที = ทีมพร้อม

---

## Phase 8 — Cutover (15 นาที)

### 8.1 Soft cutover (แนะนำ — ปลอดภัยสุด)

ไม่ต้องตัด origin เดิม — แค่ประกาศให้ใช้ URL ใหม่
- [ ] ส่งข้อความ "เริ่มใช้ URL ใหม่ได้แล้ว: `https://SUBDOMAIN`"
- [ ] ทุกคนเปลี่ยน bookmark
- [ ] เก็บ origin เดิมไว้ 30 วันเป็น fallback

### 8.2 Hard cutover (ถ้ายืนยันใช้)
เพิ่ม JS redirect ที่ origin เดิม:
- Edit `index.html` ใน GitHub repo → เพิ่มบรรทัดล่างสุดก่อน `</head>`:
```html
<script>location.replace('https://SUBDOMAIN' + location.pathname + location.search);</script>
```
- Push → GitHub Pages deploy 1 นาที
- [ ] เปิด `OLD_DOMAIN` ใน Incognito → redirect ไป `SUBDOMAIN` อัตโนมัติ

⚠️ Hard cutover **ทำให้ rollback ยากขึ้น** — แนะนำ soft 30 วันก่อน

---

## Phase 9 — Post-Cutover Verification (30 นาที)

### 9.1 Multi-admin smoke test
ขอ admin 2 คนทดสอบบน subdomain ใหม่ (โทรหาทีละคน):
- [ ] Admin 1: login → เปิด camp → ดูได้ปกติ
- [ ] Admin 2: login → เปิด camp เดียวกัน → ดูได้ปกติ
- [ ] Admin 1: เพิ่ม asset
- [ ] Admin 2: refresh → เห็น asset ของ admin 1
- [ ] Admin 2: แก้ section B → save
- [ ] Admin 1: refresh → เห็นการแก้ของ admin 2

### 9.2 ตรวจ Drive ลูกค้า
- [ ] เปิด Drive folder ลูกค้า 1-2 ราย → ไฟล์ `wakuwaku_campaign.json` มี modifiedTime ใหม่
- [ ] ไม่มีไฟล์ duplicate

### 9.3 Monitor logs (15 นาที)
- F12 Console บนหลาย browser → ไม่มี error สีแดง
- Firestore Console → `control_signals` มี signal ใหม่ปกติ (= save ทำงาน)

---

## Phase 10 — 7-Day Monitor

ทุกวันเช็ค:
- [ ] วันที่ 1: ดู console errors, ถาม admin ว่ามีปัญหาไหม
- [ ] วันที่ 3: ตรวจ Drive ลูกค้า 1-2 ราย → JSON อัปเดตปกติ
- [ ] วันที่ 7: ถ้า zero issue → พิจารณาลบ origin เดิม

### Cleanup หลัง 7 วัน (ถ้าทุกอย่าง OK)
- [ ] Google OAuth: ลบ origin เดิม (`OLD_DOMAIN`) ออกจาก Authorized JS origins
- [ ] Firebase: ลบ domain เดิมออกจาก Authorized domains
- [ ] GitHub Pages: ปิด (Settings → Pages → Source: None)
- [ ] DNS: ลบ record ของ `OLD_DOMAIN`

⚠️ **อย่ารีบลบ origin เดิม** — รอครบ 7 วันที่ zero issue จริง

---

## Phase 11 — Rollback Procedure (ถ้าพังจริง)

### กรณีที่ 1: Subdomain login ไม่ได้
**สาเหตุ:** OAuth/Firebase whitelist ยังไม่ propagate
**แก้:**
- รอเพิ่ม 10 นาที
- บอก admin ใช้ `OLD_DOMAIN` ชั่วคราว (ยังใช้ได้)
- เช็คอีกครั้ง

### กรณีที่ 2: Subdomain โหลดไม่ขึ้น / 502 / SSL error
**สาเหตุ:** Plesk config ผิด
**แก้ฉุกเฉิน (admin ใช้งานต่อได้):**
- บอกทีม "ใช้ `OLD_DOMAIN` ต่อก่อน"
- คุณ debug Plesk
- ไม่ต้องแก้ DNS — แค่ใช้ URL เดิม

### กรณีที่ 3: เห็นงานไม่ครบ / asset หาย
**สาเหตุ:** ไม่น่าเกิด — data อยู่ที่ Drive/Firestore ไม่ใช่ hosting
**ตรวจ:**
1. F12 Console → มี error อะไร?
2. เปิด `OLD_DOMAIN` ทันที — ถ้าเห็นงานครบที่เดิม = Plesk config ปัญหา ไม่ใช่ data
3. ถ้าเห็นไม่ครบที่ **ทั้ง 2 origin** = ปัญหา Drive permission, แจ้งผม
**แก้:**
- ทุกคนใช้ `OLD_DOMAIN` ต่อ
- คุณส่ง screenshot console + รายชื่อ campaign ที่หาย ให้ผม

### กรณีที่ 4: ฉุกเฉินสุด — ต้องตัด subdomain ทันที
**แก้:**
- Plesk → subdomain → **Disable** (ไม่ใช่ลบ)
- subdomain จะ down ทันที
- ทุกคนเด้งกลับใช้ `OLD_DOMAIN` อัตโนมัติ (ถ้าเข้า bookmark เดิม)
- DNS ไม่ต้องแก้

### กรณีที่ 5: admin บางคนแก้งานบน subdomain แล้ว rollback
**สถานการณ์:** admin A แก้งานบน subdomain ใหม่, save ขึ้น Drive แล้ว → เรา rollback ใช้ `OLD_DOMAIN`
**ผล:** **ไม่หาย** — งานอยู่ที่ Drive แล้ว, ใช้ origin ไหนก็โหลดได้
**ถ้า admin B แก้ค้างไว้ใน localStorage subdomain ใหม่ ไม่ได้ save:**
- ไม่หายถาวร — เปิด subdomain นั้นอีกครั้งเมื่อ revive ระบบ → localStorage ยังอยู่
- กดปุ่ม restore → ได้งานกลับ

---

## 📎 Appendix — คำสั่ง verify ที่ใช้บ่อย

```bash
# ตรวจ SSL ทำงาน
curl -I https://SUBDOMAIN

# ตรวจ cache header
curl -I https://SUBDOMAIN/index.html | grep -i cache-control

# ตรวจ HTML โหลด
curl -s https://SUBDOMAIN/ | head -20

# ตรวจ DNS propagate
dig +short SUBDOMAIN

# ตรวจ commit hash ใน Plesk
ssh plesk-user@plesk-host "cd /path/to/subdomain && git log --oneline -1"
```

---

## 📞 ติดต่อ Claude (ผม)

ระหว่างทำ:
- ติดที่ Phase ไหน → ส่ง screenshot + บอกข้อความ error
- ทำเสร็จแต่ละ phase → แจ้ง "Phase X done"
- ถ้าฉุกเฉิน → "rollback NOW" → ผม guide step

ทำตามนี้ตั้งแต่ Phase 0 → ติดที่ไหน หยุด ส่ง screenshot ครับ
