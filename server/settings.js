'use strict';
// อ่านและตรวจ config.js (R-3-01 ถึง R-3-04)
const DEFAULTS = {
  conspireSeconds: [90, 10, 600], voteSeconds: [30, 10, 300], ambushPickSeconds: [20, 5, 120],
  showdownTalkSeconds: [60, 0, 600], showdownPickSeconds: [30, 10, 300], resultSeconds: [8, 3, 60],
  gmHandoverSeconds: [30, 10, 300], roomIdleMinutes: [30, 5, 240],
  minPlayers: [6, 3, 12], maxPlayers: [12, 3, 12], largeGroupFrom: [10, 3, 12],
  winPointsSmall: [25, 5, 100], winPointsLarge: [24, 5, 100], tiebreakMaxShowdowns: [3, 0, 10],
  deckCount3: [26, 0, 200], deckCount4: [43, 0, 200], deckCount5: [11, 0, 200],
  potSize: [4, 1, 10], compensationBars: [1, 0, 5],
  chatMaxLength: [200, 20, 1000], chatMinIntervalMs: [1000, 0, 10000], chatHistory: [100, 10, 500],
};
const CHOICES = {
  zeroSurvivorCompensation: [true, [true, false]],
  hiddenScores: [true, [true, false]],
  showdownTimeoutChoice: ['share', ['share', 'grab', 'random']],
  ambushTimeoutPick: ['random', ['random', 'none']],
};

function validate(raw, warn = (m) => console.warn('[config] ' + m)) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, [def, min, max]] of Object.entries(DEFAULTS)) {
    const v = raw[k];
    if (v === undefined) { out[k] = def; continue; }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      warn(`${k} = ${JSON.stringify(v)} ไม่ถูกต้อง (ต้องเป็นจำนวนเต็ม ${min}–${max}) ใช้ ${def} แทน`);
      out[k] = def;
    } else out[k] = v;
  }
  for (const [k, [def, allowed]] of Object.entries(CHOICES)) {
    const v = raw[k];
    if (v === undefined) { out[k] = def; continue; }
    if (!allowed.includes(v)) { warn(`${k} = ${JSON.stringify(v)} ไม่ถูกต้อง ใช้ ${JSON.stringify(def)} แทน`); out[k] = def; }
    else out[k] = v;
  }
  // R-3-03 ค่าที่ขัดกันเอง ใช้ค่าเริ่มต้นทั้งกลุ่ม
  if (out.minPlayers > out.maxPlayers) {
    warn('minPlayers มากกว่า maxPlayers ใช้ค่าเริ่มต้น 6 และ 12');
    out.minPlayers = DEFAULTS.minPlayers[0]; out.maxPlayers = DEFAULTS.maxPlayers[0];
  }
  if (out.deckCount3 + out.deckCount4 + out.deckCount5 < out.potSize) {
    warn('จำนวนทองรวมน้อยกว่า potSize ใช้ค่าเริ่มต้นของกลุ่มทอง');
    out.deckCount3 = 26; out.deckCount4 = 43; out.deckCount5 = 11; out.potSize = 4;
  }
  return out;
}

function load(env = process.env) {
  let raw = {};
  try { raw = require('../config.js'); } catch (e) {
    // R-3-04 ถ้า config.js พิมพ์ผิดจนอ่านไม่ได้ ให้เห็นใน log ชัด ๆ แล้วหยุด
    console.error('[config] อ่าน config.js ไม่ได้ กรุณาแก้ไฟล์:', e.message);
    throw e;
  }
  const cfg = validate(raw);
  // ใช้ตอนทดสอบเท่านั้น: เริ่มเกมด้วยคนน้อยกว่าปกติ
  const mp = Number(env.MIN_PLAYERS);
  if (Number.isInteger(mp) && mp >= 2 && mp <= cfg.maxPlayers) cfg.minPlayers = mp;
  return Object.freeze(cfg);
}

module.exports = { validate, load, DEFAULTS };
