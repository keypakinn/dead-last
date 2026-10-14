# Dead Last (ออนไลน์)

เกมโหวตหักหลังสำหรับเล่นกับเพื่อน 6–12 คนบนมือถือ ธีมสมรภูมิ "ระเบิดเวลา"
ทุกคนแย่งกันเป็นผู้รอด 2 คนสุดท้ายเพื่อดวลแบ่งทองด้วยไพ่ SHARE / STEAL / GRAB ONE & GO ใครเก็บทองถึงเกณฑ์ก่อนชนะ
กติกาฉบับเต็มอยู่ในเกม (ปุ่ม 📖 วิธีเล่น และปุ่ม ? ทุกช่วง)

## เล่นในเครื่องตัวเอง

ต้องมี Node.js 18 ขึ้นไป

```
npm install
npm start
```

เปิด http://localhost:3000 — ทดลองคนเดียวหลายแท็บได้ ถ้าอยากเริ่มด้วยคนน้อยกว่า 6 ให้รัน `MIN_PLAYERS=2 npm start`

## ปรับตัวเลขในเกม (`config.js`)

แก้เลขหลัง `:` ได้เลย เช่น `voteSeconds: 30` → `voteSeconds: 45` แล้วอัปไฟล์ขึ้น GitHub (ทำตอนไม่มีคนเล่น)

| กลุ่ม | ค่า |
|---|---|
| เวลา (วินาที) | `conspireSeconds` เจรจา, `voteSeconds` โหวต, `ambushPickSeconds` ซุ่มโจมตีเลือกคน, `showdownTalkSeconds` / `showdownPickSeconds` ดวล, `resultSeconds` แสดงผล, `gmHandoverSeconds` ย้าย GM |
| ผู้เล่นและการชนะ | `minPlayers`, `maxPlayers`, `largeGroupFrom`, `winPointsSmall`, `winPointsLarge`, `tiebreakMaxShowdowns` |
| ทอง | `deckCount3/4/5` จำนวนแท่งแต่ละค่า, `potSize` ทองกลางวงต่อรอบ, `compensationBars` ทองปลอบใจ |
| แชท | `chatMaxLength`, `chatMinIntervalMs`, `chatHistory` |
| ตัวเลือกกฎ | `zeroSurvivorCompensation`, `hiddenScores`, `showdownTimeoutChoice`, `ambushTimeoutPick` |

ค่าที่ผิดชนิดหรือเกินช่วง เซิร์ฟเวอร์ใช้ค่าเริ่มต้นแทนและเขียนคำเตือนใน Logs ของ Render ตัวเลขในหน้ากติกาเปลี่ยนตามอัตโนมัติ

## การ์ดและภาพ (`cards/`)

- ข้อความบนการ์ดอยู่ที่ `cards/data.csv` ตำแหน่งอยู่ที่ `cards/template-*.json` กรอบคือ `cards/frame-*.png`
- ภาพในการ์ดใส่ที่ `cards/art/` 4 ไฟล์: `unit`, `ambush`, `showdown`, `gold` นามสกุล `.webp`, `.png` หรือ `.jpg` (ตัวพิมพ์เล็ก) ไม่ใส่ก็เล่นได้ จะเห็นพื้นสีกับชื่อแทน
- รายละเอียดคอลัมน์ ขนาดภาพ และ prompt สร้างภาพ ดู `cards/README.md`
- หลังแก้การ์ด เปิด `/preview` ดูว่าครบ ไม่มีกรอบแดง (ข้อความล้น) และภาพขึ้น

## ทดสอบ

```
npm test
```

จำลองกติกาตาม test scenario ใน spec (T-01 ถึง T-38) และเล่นสุ่ม 1,000 เกม ตรวจว่าทองรวมคงที่และทุกเกมจบ

## Deploy (GitHub + Render)

1. สร้าง repository ชื่อ `dead-last` บน GitHub แล้วลากไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้นไป **ยกเว้น `node_modules`**
2. Render → New → Web Service → เลือก repo `dead-last`
   - Region: Singapore · Build Command: `npm install` · Start Command: `npm start` · Instance: Free
   - Health Check Path: `/healthz`
3. รอ deploy เสร็จ เปิดลิงก์ `https://dead-last-xxxx.onrender.com` บนมือถือ

Render แบบฟรีหลับเมื่อไม่มีคนใช้ 15 นาที เปิดครั้งแรกรอประมาณ 1 นาที ทุกครั้งที่อัปไฟล์ใหม่ เซิร์ฟเวอร์เริ่มใหม่และห้องที่เล่นอยู่หายทั้งหมด

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `config.js` | ตัวเลขที่ปรับได้ |
| `game.js` | กติกาทั้งหมด (ไม่ยุ่งกับ network) |
| `server.js` | เว็บเซิร์ฟเวอร์ ห้อง และ Socket.IO |
| `server/settings.js` | ตรวจค่าใน config.js |
| `server/cards.js` | อ่านและตรวจ data.csv, template และภาพ |
| `shared/card-schema.js` | รูปแบบคอลัมน์ของ data.csv |
| `public/` | หน้าเว็บ: `app.js` หน้าจอเกม, `card.js` วาดการ์ด, `rules.js` ข้อความกติกา, `theme.css` สีธีม, `preview.html` หน้าตรวจการ์ด |
| `cards/` | ไฟล์การ์ด |
| `test/sim.js` | ชุดทดสอบ |
