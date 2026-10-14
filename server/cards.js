'use strict';
// อ่านและตรวจไฟล์การ์ด (R-4.1-01 ถึง R-4.1-03, R-4.1-08)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SCHEMA = require('../shared/card-schema');

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM จาก Excel
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

// ตรวจแถวตาม schema คืน { cards, errors, warnings }
function validateRows(rows) {
  const errors = [], warnings = [];
  if (!rows.length) return { cards: [], errors: ['data.csv ว่าง'], warnings };
  const head = rows[0].map(h => h.trim().toLowerCase());
  for (const c of ['id', 'template', 'name', 'kind_label']) if (!head.includes(c)) errors.push(`data.csv ไม่มีคอลัมน์ ${c}`);
  const cards = [], ids = new Set(), colors = new Map();
  for (let r = 1; r < rows.length; r++) {
    const line = r + 1, o = {};
    head.forEach((h, i) => { if (h) o[h] = (rows[r][i] || '').trim(); });
    const bad = (m) => errors.push(`data.csv แถว ${line}: ${m} — ข้ามแถวนี้`);
    if (!SCHEMA.idPattern.test(o.id || '')) { bad(`id "${o.id || ''}" ไม่ถูกรูปแบบ`); continue; }
    if (ids.has(o.id)) { bad(`id "${o.id}" ซ้ำ`); continue; }
    if (!SCHEMA.templates.includes(o.template)) { bad(`template "${o.template || ''}" ไม่ถูกต้อง`); continue; }
    if (!o.name) { bad('name ว่าง'); continue; }
    if (!o.kind_label) { bad('kind_label ว่าง'); continue; }
    if (o.art && !SCHEMA.idPattern.test(o.art)) { bad(`art "${o.art}" ไม่ถูกรูปแบบ`); continue; }
    const card = { id: o.id, template: o.template, name: o.name, kind_label: o.kind_label, effect: o.effect || '', art: o.art || '' };
    if (o.template === 'unit') {
      if (!/^#[0-9A-Fa-f]{6}$/.test(o.color || '')) { bad(`color "${o.color || ''}" ต้องเป็น #RRGGBB`); continue; }
      const key = o.color.toUpperCase();
      if (colors.has(key)) { bad(`color ${o.color} ซ้ำกับ ${colors.get(key)}`); continue; }
      colors.set(key, o.id); card.color = o.color;
    }
    if (o.template === 'gold') {
      const v = Number(o.value);
      if (!/^\d+$/.test(o.value || '') || !SCHEMA.columns.value.values.includes(v)) { bad(`value "${o.value || ''}" ต้องเป็น 3, 4 หรือ 5`); continue; }
      if (o.id !== 'gold-' + v) { bad(`id ของทองค่า ${v} ต้องเป็น gold-${v}`); continue; }
      card.value = v;
    }
    if (['share', 'steal', 'grab'].includes(o.id) && o.template !== 'showdown') { bad(`${o.id} ต้องใช้ template showdown`); continue; }
    if (o.id === 'ambush' && o.template !== 'ambush') { bad('ambush ต้องใช้ template ambush'); continue; }
    for (const [col, def] of Object.entries(SCHEMA.columns)) {
      if (def.max && card[col] && [...card[col]].length > def.max) warnings.push(`data.csv แถว ${line}: ${col} ยาวเกิน ${def.max} ตัวอักษร อาจล้นการ์ด`);
    }
    ids.add(o.id); cards.push(card);
  }
  return { cards, errors, warnings };
}

function scanArt(artDir) {
  const map = {}, warnings = [];
  let files = [];
  try { files = fs.readdirSync(artDir); } catch (e) { return { map, warnings, listing: '' }; }
  const listing = [];
  for (const f of files.sort()) {
    const m = /^([a-z0-9][a-z0-9-]{0,39})\.(webp|png|jpg)$/.exec(f);
    if (!m) { if (!f.startsWith('.')) warnings.push(`art/${f}: ชื่อไฟล์ต้องเป็นตัวพิมพ์เล็กและนามสกุล .webp .png หรือ .jpg — ไม่ใช้ไฟล์นี้`); continue; }
    let size = 0; try { size = fs.statSync(path.join(artDir, f)).size; } catch (e) { /* ignore */ }
    listing.push(f + ':' + size);
    if (size > 300 * 1024) warnings.push(`art/${f}: ขนาด ${Math.round(size / 1024)} KB ใหญ่กว่า 300 KB อาจโหลดช้าบนมือถือ`);
    const stem = m[1], ext = m[2];
    const cur = map[stem];
    if (!cur || SCHEMA.artExt.indexOf(ext) < SCHEMA.artExt.indexOf(cur.split('.').pop())) map[stem] = f;
  }
  return { map, warnings, listing: listing.join('|') };
}

function loadCards(dir) {
  const errors = [], warnings = [];
  const templates = {}; let tplText = '';
  for (const k of SCHEMA.templates) {
    const f = path.join(dir, `template-${k}.json`);
    try { const txt = fs.readFileSync(f, 'utf8'); templates[k] = JSON.parse(txt); tplText += txt; }
    catch (e) { errors.push(`อ่าน template-${k}.json ไม่ได้: ${e.message}`); }
  }
  let csvText = '';
  try { csvText = fs.readFileSync(path.join(dir, 'data.csv'), 'utf8'); }
  catch (e) { errors.push('ไม่พบ cards/data.csv'); }
  const v = csvText ? validateRows(parseCSV(csvText)) : { cards: [], errors: [], warnings: [] };
  errors.push(...v.errors); warnings.push(...v.warnings);
  const art = scanArt(path.join(dir, 'art'));
  warnings.push(...art.warnings);
  const byId = {};
  const cards = v.cards.filter(c => templates[c.template]).map(c => ({ ...c, artFile: art.map[c.art || c.id] || null }));
  for (const c of v.cards) if (!templates[c.template]) errors.push(`การ์ด ${c.id}: ไม่มี template-${c.template}.json`);
  for (const c of cards) byId[c.id] = c;
  const units = cards.filter(c => c.template === 'unit').map(c => c.id).sort();
  const missing = SCHEMA.required.filter(id => !byId[id]);
  const artMissing = [...new Set(cards.filter(c => !c.artFile).map(c => c.art || c.id))];
  const frames = {};
  for (const [k, t] of Object.entries(templates)) frames[k] = fs.existsSync(path.join(dir, t.frame || '')) ? t.frame : null;
  const version = crypto.createHash('sha1').update(tplText).update(csvText).update(art.listing).digest('hex').slice(0, 10);
  return { version, templates, cards, byId, units, missing, artMissing, errors, warnings, frames,
    hasBack: fs.existsSync(path.join(dir, 'back.png')) };
}

module.exports = { parseCSV, validateRows, loadCards, scanArt };
