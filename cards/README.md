# Dead Last — ไฟล์การ์ด (แบบ I · ระเบิดเวลา)

การ์ดทุกใบประกอบบนหน้าเว็บจาก 3 ชั้น: ภาพในการ์ด (`art/<art>.webp` / `.png` / `.jpg`) → กรอบ (`frame-<template>.png`) → ข้อความจาก `data.csv` ตามตำแหน่งใน `template-<template>.json`
แก้ข้อความ = แก้ CSV · เปลี่ยนภาพ = เปลี่ยนไฟล์ใน `art/` · ไม่ต้องแก้โค้ด

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `template-unit.json`, `template-ambush.json`, `template-showdown.json`, `template-gold.json` | ตำแหน่ง ฟอนต์ สี ของแต่ละช่อง (แหล่งจริงของตำแหน่ง โค้ดต้องอ่านจากไฟล์นี้) |
| `frame-unit.png`, `frame-ambush.png`, `frame-showdown.png`, `frame-gold.png` | กรอบ 1200×1800 ช่องภาพวงกลมโปร่งใส ไม่มีตัวหนังสือ |
| `back.png` | ด้านหลังการ์ด ใช้ใบเดียวกันทุกชนิด (ทองในมือคนอื่น, ไพ่ที่ยังไม่เปิด) |
| `data.csv` | ข้อมูลการ์ดครบ 19 ใบ (ใช้เป็นข้อมูลจริงได้เลย หรือแก้ใน Google Sheet) |
| `art/` | **ยังไม่มี** — ใส่ภาพ 4 ไฟล์ตามตารางด้านล่าง (ไม่ใส่ก็เล่นได้ จะเห็นพื้นสีกับชื่อการ์ดแทน) |

ดูการ์ดทุกใบได้ที่หน้า `/preview` ของเกม (ต้นฉบับกรอบ `source/*.svg` อยู่ในโฟลเดอร์ `dead-last-cards` เดิม)

## คอลัมน์ใน data.csv

| คอลัมน์ | ชนิด | ค่าที่อนุญาต | ใช้ในกติกา / แสดงอย่างเดียว | ใช้กับ |
|---|---|---|---|---|
| `id` | ข้อความ | ดูตาราง id ด้านล่าง | ใช้ในกติกา | ทุกใบ |
| `template` | ตัวเลือก | `unit`, `ambush`, `showdown`, `gold` | ใช้ในกติกา | ทุกใบ |
| `name` | ข้อความ | ไม่เกิน 18 ตัวอักษร | แสดงอย่างเดียว | ทุกใบ (หน่วยรบ = ชื่อสีของหน่วย เช่น หน่วยน้ำเงิน ให้ตรงกับคอลัมน์ `color`) |
| `kind_label` | ข้อความ | ไม่เกิน 16 ตัวอักษร | แสดงอย่างเดียว | ทุกใบ |
| `effect` | ข้อความหลายบรรทัด | ไม่เกิน 5 บรรทัด (ทองคำ 1 บรรทัด) | แสดงอย่างเดียว | ทุกใบ |
| `color` | hex `#RRGGBB` | ห้ามซ้ำกัน | ใช้ในกติกา (สีประจำผู้เล่น) | หน่วยรบเท่านั้น |
| `value` | ตัวเลข | 3, 4, 5 | ใช้ในกติกา | ทองคำเท่านั้น |
| `art` | ข้อความ | ชื่อไฟล์ภาพไม่มีนามสกุล: `unit`, `ambush`, `showdown`, `gold` | แสดงอย่างเดียว | ทุกใบ (การ์ดชนิดเดียวกันใช้ภาพเดียวกัน ถ้าว่างใช้ `id`) |

`player_name` (ชื่อผู้เล่นบนจอ LED ของการ์ดหน่วยรบ) **ไม่อยู่ใน CSV** เกมเติมให้ตอนเล่นจากชื่อที่ผู้เล่นพิมพ์ ยาวไม่เกิน 16 ตัวอักษร

จำนวนทองแต่ละค่า (26 / 43 / 11 แท่ง) อยู่ใน `config.js` ไม่อยู่ใน CSV

## กฎของ id

- รูปแบบ: ตัวพิมพ์เล็ก ตัวเลข และ `-` เท่านั้น ยาวไม่เกิน 40 ตัว
- **ห้ามเปลี่ยน id** เพราะกติกาใช้ id ตัดสินผล: `ambush`, `share`, `steal`, `grab`, `gold-3`, `gold-4`, `gold-5`, `unit-01` ถึง `unit-12`
- ชื่อไฟล์ภาพต้องตรงกับค่าในคอลัมน์ `art` ทุกตัวอักษร เช่น `unit.webp` (Render แยกตัวพิมพ์เล็กใหญ่ ถ้าตั้งเป็น `Unit.webp` ภาพจะไม่ขึ้นบนเว็บจริง แม้ในเครื่องจะเห็นปกติ)

## วิธีทำใน Google Sheet

1. File → Import → อัปโหลด `data.csv` → Replace spreadsheet
2. View → Freeze → 1 row (ล็อกแถวหัว)
3. คอลัมน์ `template` และ `value` ใช้ Data → Data validation → Dropdown
4. ตัวเลขห้ามมีจุลภาคหรือหน่วย ช่องที่ไม่ใช้ปล่อยว่าง
5. ขึ้นบรรทัดใหม่ในช่อง `effect` ได้ (Ctrl+Enter)
6. File → Download → Comma-separated values (.csv) แล้วตั้งชื่อ `data.csv`

## สเปกภาพในการ์ด

- ไฟล์ `art/<art>.webp` หรือ `.png` หรือ `.jpg` (นามสกุลตัวพิมพ์เล็ก) สัดส่วน **1:1 (สี่เหลี่ยมจัตุรัส)** ขนาดแนะนำ **840 × 840 px** ไม่เกินประมาณ 300 KB
- ภาพจะถูกตัดเป็น**วงกลม** มุมทั้ง 4 จะหายไป ให้วัตถุหลักอยู่ใน 70% ตรงกลาง
- ไม่มีตัวหนังสือ โลโก้ ธงชาติ เครื่องหมายหน่วยทหารจริง หรือยี่ห้อปืนจริง และไม่มีเลือดหรือศพ
- ใส่ PNG หรือ JPG ตรง ๆ ได้เลย ถ้ามีชื่อเดียวกันหลายนามสกุล เกมเลือก webp ก่อน แล้ว png แล้ว jpg
- ไฟล์ใหญ่เกิน 300 KB โหลดช้าบนมือถือ (เซิร์ฟเวอร์เขียนเตือนใน log) → ครอปเป็นจัตุรัสแล้วแปลงเป็น WebP ที่ [squoosh.app](https://squoosh.app) (เลือก WebP, Quality ประมาณ 75, Resize 840)

### Prompt กลาง (ใช้กับทุกภาพ เปลี่ยนแค่ {subject})

```
Gritty modern war illustration, cinematic dramatic lighting, smoke and dust in the air,
dark olive green and gunmetal tones with warm yellow and red accents,
{subject},
centered composition, main subject fits inside a circle in the middle of the frame,
square 1:1, no text, no letters, no logo, no flags, no military insignia, no blood, no border
```

### ภาพที่ต้องทำ (4 ไฟล์)

การ์ดชนิดเดียวกันใช้ภาพเดียวกัน การ์ดแต่ละใบแยกกันด้วยแถบสี ชื่อ ชื่อผู้เล่น และตัวเลขบนการ์ด

| ไฟล์ | ใช้กับ | {subject} |
|---|---|---|
| `unit.webp` | หน่วยรบทั้ง 12 ใบ | a soldier holding a rifle, seen from the chest up, neutral grey uniform |
| `ambush.webp` | Ambush | a sniper hidden in thick bushes aiming a rifle straight at the viewer |
| `showdown.webp` | Share, Steal, Grab One & Go | two soldiers facing each other across an open crate of gold bars, tense standoff |
| `gold.webp` | ทองคำทั้ง 3 ค่า | a stack of shining gold bars on an ammunition crate |

ภาพหน่วยรบใช้ชุดสีเทาเป็นกลาง เพราะสีของหน่วยแสดงบนแถบสีของการ์ดอยู่แล้ว

ก่อนอัปโหลด ส่งโฟลเดอร์การ์ดมาให้ตรวจได้ (ตรวจชื่อไฟล์ สัดส่วน ขนาด และข้อความล้น)

## การอัปโหลด

- อัปโหลดตอน**ไม่มีคนเล่น** เพราะ Render จะ deploy ใหม่และเกมที่กำลังเล่นจะหาย
- หน้าเว็บ GitHub อัปได้ครั้งละไม่เกิน 100 ไฟล์
- หลัง deploy เปิด `/preview` บนมือถือจริง ดูว่าการ์ดครบ ภาพขึ้น และไม่มีกรอบแดง (ข้อความล้น)

## หมายเหตุสำหรับขั้นสร้างโค้ด (review-420-code)

template ชุดนี้ใช้ส่วนขยายของ `card.js` อ้างอิง 5 จุด:

1. **ชนิดช่อง `swatch`**: กล่อง `x y w h radius` ที่ระบายสีตามค่าในคอลัมน์ (ต้องเป็น `#RRGGBB` เท่านั้น ค่าอื่นไม่ระบาย)
2. **`font.lineHeight`**: ตั้ง line-height ของช่องข้อความ (ค่าเริ่มต้น 1.15)
3. **`fit: "wrap"` รองรับขึ้นบรรทัดใหม่**: CSS `.ck-wrap span{white-space:pre-line}`
4. **ช่อง `runtime: true`** (`player_name`): ไม่ตรวจกับ CSV แต่ client เติมค่าก่อน render
5. หลายแบบการ์ด: `/api/cards` ส่ง `templates: { unit, ambush, showdown, gold }` และแต่ละการ์ดเลือก template จากคอลัมน์ `template`
