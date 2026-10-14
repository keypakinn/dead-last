'use strict';
// จำลองกติกา Dead Last ตาม test scenario ใน spec v2.1 (T-xx) — รันด้วย npm test
const assert = require('assert');
const path = require('path');
const { Room, GameError, PH, showdownOutcome } = require('../game');
const { validate } = require('../server/settings');
const { loadCards, parseCSV, validateRows } = require('../server/cards');

const CARDS = loadCards(path.join(__dirname, '..', 'cards'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); }
}
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// สร้างห้อง n คน ชื่อ P1..Pn (หรือชื่อที่ให้) แล้วเริ่มเกม คืน { room, id: {ชื่อ: pid}, ids }
function mk(n, over = {}, opts = {}) {
  const clock = { t: 1_000_000 };
  const warns = [];
  const cfg = validate({ minPlayers: 3, ...over }, (m) => warns.push(m));
  const room = new Room('TEST', { config: cfg, cards: opts.cards || CARDS, rand: mulberry(opts.seed || 1), quiet: true, now: () => clock.t });
  const names = opts.names || Array.from({ length: n }, (_, i) => 'P' + (i + 1));
  const id = {};
  for (const nm of names) id[nm] = room.addPlayer(nm).id;
  if (opts.start !== false) room.start(room.gmId);
  return { room, id, ids: names.map(n2 => id[n2]), clock, warns, cfg };
}
const name2 = (room, pid) => room.players.get(pid).name;
function toVote(room) { if (room.phase === PH.CONSPIRE) room.endPhaseNow(); assert.strictEqual(room.phase, PH.VOTE); }
// votes: { ชื่อผู้โหวต: ชื่อเป้า | 'AMBUSH' } ทุกคนล็อก
function vote(t, votes, { lock = true, finish = true } = {}) {
  const { room, id } = t;
  toVote(room);
  for (const [v, target] of Object.entries(votes)) {
    room.voteSelect(id[v], target === 'AMBUSH' ? 'AMBUSH' : id[target]);
    if (lock) room.voteLock(id[v]);
  }
  if (finish && room.phase === PH.VOTE) room.endPhaseNow();
}
const outNames = (t) => t.room.g.vr.eliminated.map(p => name2(t.room, p)).sort();
const aliveNames = (t) => t.room.alive().map(p => name2(t.room, p)).sort();
function nextFromResult(room) { assert.strictEqual(room.phase, PH.RESULT); room.endPhaseNow(); }
function barsInvariant(room) {
  const g = room.g;
  let held = 0; for (const p of room.players.values()) held += p.bars.length;
  assert.strictEqual(g.deck.length + g.pot.length + held + g.discard.length + (g.sd && g.sd.pot ? g.sd.pot.length : 0), g.total, 'จำนวนแท่งรวมต้องคงที่ (R-4-02)');
}
// พา 6 คนไปถึง Showdown ระหว่าง P2 กับ P4
function toShowdown6(over, opts) {
  const t = mk(6, over, opts);
  vote(t, { P1: 'P5', P2: 'P5', P3: 'P5', P4: 'P5', P5: 'P1', P6: 'P1' });
  nextFromResult(t.room);
  vote(t, { P1: 'P3', P2: 'P3', P3: 'P1', P4: 'P1' });
  assert.deepStrictEqual(aliveNames(t), ['P2', 'P4']);
  nextFromResult(t.room);
  assert.strictEqual(t.room.phase, PH.SD_TALK);
  t.room.endPhaseNow();
  assert.strictEqual(t.room.phase, PH.SD_PICK);
  return t;
}
function pickSd(t, a, b) {
  const { room, id } = t;
  room.showdownSelect(id.P2, a); room.showdownLock(id.P2);
  room.showdownSelect(id.P4, b); room.showdownLock(id.P4);
  assert.strictEqual(room.phase, PH.SD_RESULT);
}

console.log('การโหวตและการตกรอบ');
test('T-01 8 คน: A F G H ตกรอบ แล้วเริ่มเจรจาการโหวตครั้งที่ 2 (R-8-01)', () => {
  const t = mk(8, {}, { names: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] });
  vote(t, { B: 'A', C: 'A', D: 'A', E: 'A', A: 'B', F: 'B', G: 'C', H: 'D' });
  assert.deepStrictEqual(outNames(t), ['A', 'F', 'G', 'H']);
  assert.deepStrictEqual(t.room.g.vr.reasons[t.id.A], 'target');
  assert.deepStrictEqual(t.room.g.vr.reasons[t.id.F], 'wrong_vote');
  nextFromResult(t.room);
  assert.strictEqual(t.room.phase, PH.CONSPIRE);
  assert.strictEqual(t.room.g.voteNo, 2);
  assert.deepStrictEqual(aliveNames(t), ['B', 'C', 'D', 'E']);
});
test('T-02 ไม่มีผู้รอด + ทองชดเชย และกองกลางค้าง (R-8-11, R-8-30)', () => {
  const t = mk(6);
  const pot = t.room.g.pot.slice();
  vote(t, { P1: 'P4', P2: 'P4', P3: 'P4', P4: 'P1', P5: 'P1', P6: 'P2' });
  assert.deepStrictEqual(aliveNames(t), ['P1', 'P2', 'P3']);
  nextFromResult(t.room);
  vote(t, { P1: 'P2', P2: 'P3', P3: 'P1' });
  assert.deepStrictEqual(aliveNames(t), []);
  nextFromResult(t.room);
  assert.strictEqual(t.room.phase, PH.ROUND_END);
  for (const n of ['P4', 'P5', 'P6']) assert.strictEqual(t.room.players.get(t.id[n]).bars.length, 1, n + ' ได้ 1 แท่ง');
  for (const n of ['P1', 'P2', 'P3']) assert.strictEqual(t.room.players.get(t.id[n]).bars.length, 0);
  const deckBefore = t.room.g.deck.length;
  t.room.endPhaseNow();
  assert.strictEqual(t.room.g.round, 2);
  assert.deepStrictEqual(t.room.g.pot, pot, 'กองกลางเป็น 4 แท่งเดิม');
  assert.strictEqual(t.room.g.deck.length, deckBefore, 'ไม่จั่วเพิ่ม');
  barsInvariant(t.room);
});
test('T-03 ไม่มีผู้รอด และปิดทองชดเชย', () => {
  const t = mk(6, { zeroSurvivorCompensation: false });
  vote(t, { P1: 'P4', P2: 'P4', P3: 'P4', P4: 'P1', P5: 'P1', P6: 'P2' });
  nextFromResult(t.room);
  vote(t, { P1: 'P2', P2: 'P3', P3: 'P1' });
  nextFromResult(t.room);
  for (const p of t.room.players.values()) assert.strictEqual(p.bars.length, 0);
});
test('ไม่มีผู้รอดตั้งแต่การโหวตครั้งที่ 1 → ไม่มีใครได้ทองชดเชย (R-8-11)', () => {
  const t = mk(3);
  vote(t, { P1: 'P2', P2: 'P3', P3: 'P1' });
  nextFromResult(t.room);
  for (const p of t.room.players.values()) assert.strictEqual(p.bars.length, 0);
});
test('T-04 ทุกคนเลือก Ambush → ไม่มี Target ทุกคนตกรอบ (R-8-01 ขั้น 2)', () => {
  const t = mk(3);
  vote(t, { P1: 'AMBUSH', P2: 'AMBUSH', P3: 'AMBUSH' });
  assert.deepStrictEqual(t.room.g.vr.targets, []);
  assert.deepStrictEqual(outNames(t), ['P1', 'P2', 'P3']);
});
test('T-05 Ambush ไม่มีคนให้เลือก → ข้าม และ A กับ D เข้า Showdown (R-7-21)', () => {
  const t = mk(4, {}, { names: ['A', 'B', 'C', 'D'] });
  vote(t, { A: 'AMBUSH', B: 'A', C: 'B', D: 'C' });
  assert.strictEqual(t.room.phase, PH.RESULT, 'ไม่ต้องเข้าช่วงเลือก');
  assert.deepStrictEqual(t.room.g.vr.targets.map(p => name2(t.room, p)).sort(), ['A', 'B', 'C']);
  assert.deepStrictEqual(outNames(t), ['B', 'C']);
  nextFromResult(t.room);
  assert.strictEqual(t.room.phase, PH.SD_TALK);
  assert.deepStrictEqual([t.room.g.sd.a, t.room.g.sd.b].map(p => name2(t.room, p)).sort(), ['A', 'D']);
});
test('T-06 Ambush หมดเวลาเลือก → สุ่ม 1 คนและบันทึกใน EventLog (R-7-24, R-12-04)', () => {
  const t = mk(5, {}, { names: ['A', 'B', 'C', 'D', 'E'] });
  vote(t, { A: 'AMBUSH', B: 'A', C: 'A', D: 'A', E: 'A' });
  assert.strictEqual(t.room.phase, PH.AMBUSH_PICK);
  t.room.endPhaseNow();
  assert.strictEqual(t.room.g.vr.eliminated.length, 1);
  assert.ok(t.room.events.some(e => e.type === 'random_ambush_pick'));
  assert.strictEqual(t.room.alive().length, 4);
});
test('T-07 Ambush หมดเวลา ambushTimeoutPick = none → ไม่กำจัดใคร', () => {
  const t = mk(5, { ambushTimeoutPick: 'none' }, { names: ['A', 'B', 'C', 'D', 'E'] });
  vote(t, { A: 'AMBUSH', B: 'A', C: 'A', D: 'A', E: 'A' });
  t.room.endPhaseNow();
  assert.strictEqual(t.room.alive().length, 5);
});
test('Ambush เลือกเองและล็อก → คนที่เลือกตกรอบ ตัวเลือกเป็นความลับก่อนเปิด (R-7-23)', () => {
  const t = mk(5, {}, { names: ['A', 'B', 'C', 'D', 'E'] });
  vote(t, { A: 'AMBUSH', B: 'A', C: 'A', D: 'A', E: 'A' });
  assert.throws(() => t.room.ambushSelect(t.id.A, t.id.A), e => e.code === 'INVALID_VICTIM');
  t.room.ambushSelect(t.id.A, t.id.C);
  const sB = t.room.getState(t.id.B);
  assert.strictEqual(sB.vote.ambush[0].pick, null, 'คนอื่นยังไม่เห็นว่า A เลือกใคร');
  t.room.ambushLock(t.id.A);
  assert.strictEqual(t.room.phase, PH.RESULT);
  assert.deepStrictEqual(outNames(t), ['C']);
  assert.strictEqual(t.room.g.vr.reasons[t.id.C], 'ambushed');
});
test('T-08 Ambush มีตัวเลือกคนเดียว → เลือกให้ทันที ไม่เข้าช่วงเลือก (R-7-22)', () => {
  const t = mk(5, {}, { names: ['A', 'B', 'C', 'D', 'E'] });
  vote(t, { A: 'AMBUSH', B: 'A', C: 'A', D: 'B', E: 'B' });
  assert.strictEqual(t.room.phase, PH.RESULT);
  assert.deepStrictEqual(outNames(t), ['B', 'C']);
  assert.deepStrictEqual(aliveNames(t), ['A', 'D', 'E']);
});
test('T-29 เลือก Ambush แต่ไม่เป็น Target → ตกรอบ', () => {
  const t = mk(4, {}, { names: ['A', 'B', 'C', 'D'] });
  vote(t, { A: 'AMBUSH', B: 'C', C: 'B', D: 'B' });
  assert.ok(outNames(t).includes('A'));
  assert.strictEqual(t.room.g.vr.reasons[t.id.A], 'ambush_miss');
});
test('T-12 หมดเวลา: เลือกไว้แต่ไม่ล็อกนับให้ ไม่ได้เลือกตกรอบ (R-7-15)', () => {
  const t = mk(6, {}, { names: ['A', 'B', 'C', 'D', 'E', 'F'] });
  toVote(t.room);
  for (const n of ['A', 'C', 'D']) { t.room.voteSelect(t.id[n], t.id.B); t.room.voteLock(t.id[n]); }
  t.room.voteSelect(t.id.B, t.id.A); t.room.voteLock(t.id.B);
  t.room.voteSelect(t.id.E, t.id.B); // ไม่ล็อก
  t.room.endPhaseNow();
  assert.strictEqual(t.room.g.vr.tally[t.id.B], 4, 'โหวตของ E นับ');
  assert.strictEqual(t.room.g.vr.choices[t.id.F], 'NONE');
  assert.strictEqual(t.room.g.vr.reasons[t.id.F], 'no_vote');
});
test('T-13 ล็อกครบก่อนหมดเวลา → เปิดผลทันที (R-7-14)', () => {
  const t = mk(3);
  vote(t, { P1: 'P2', P2: 'P1', P3: 'P2' }, { finish: false });
  assert.strictEqual(t.room.phase, PH.RESULT);
});
test('T-19 โหวตตัวเอง → INVALID_TARGET และ state ไม่เปลี่ยน (R-7-11)', () => {
  const t = mk(3); toVote(t.room);
  assert.throws(() => t.room.voteSelect(t.id.P1, t.id.P1), e => e.code === 'INVALID_TARGET');
  assert.strictEqual(t.room.g.votes.size, 0);
  assert.throws(() => t.room.voteSelect(t.id.P1, 'nobody'), e => e.code === 'INVALID_TARGET');
  assert.throws(() => t.room.voteLock(t.id.P1), e => e.code === 'NOTHING_SELECTED');
});
test('ล็อกแล้วเปลี่ยนไม่ได้ และคนที่ตกรอบโหวตไม่ได้ (R-7-10, R-7-12)', () => {
  const t = mk(6);
  vote(t, { P1: 'P5', P2: 'P5', P3: 'P5', P4: 'P5', P5: 'P1', P6: 'P1' });
  nextFromResult(t.room); toVote(t.room);
  assert.throws(() => t.room.voteSelect(t.id.P5, t.id.P1), e => e.code === 'NOT_ELIGIBLE');
  t.room.voteSelect(t.id.P1, t.id.P2); t.room.voteLock(t.id.P1);
  assert.throws(() => t.room.voteSelect(t.id.P1, t.id.P3), e => e.code === 'ALREADY_LOCKED');
});
test('ส่งโหวตหลังเปิดผล → WRONG_PHASE', () => {
  const t = mk(3);
  vote(t, { P1: 'P2', P2: 'P1', P3: 'P2' });
  assert.throws(() => t.room.voteSelect(t.id.P1, t.id.P2), e => e.code === 'WRONG_PHASE');
});
test('ผู้รอด 1 คนเกิดได้เฉพาะเมื่อมี Ambush และได้ทองทั้งกอง (R-8-03, R-8-10)', () => {
  const t = mk(4, {}, { names: ['A', 'B', 'C', 'D'] });
  vote(t, { A: 'AMBUSH', B: 'A', C: 'A', D: 'C' });
  // A เป้า (2) รอด เลือก B หรือ C ได้ → ล็อกเลือก B ; D โหวต C ไม่ใช่เป้า → ตก
  t.room.ambushSelect(t.id.A, t.id.B); t.room.ambushLock(t.id.A);
  assert.deepStrictEqual(aliveNames(t), ['A', 'C']);
  // สุ่มเล่นโดยไม่มี Ambush 300 ครั้ง ต้องไม่เหลือ 1 คน
  for (let s = 1; s <= 300; s++) {
    const r = mk(6, {}, { seed: s });
    toVote(r.room);
    for (const pid of r.room.g.eligible) { const others = r.room.g.eligible.filter(x => x !== pid); r.room.voteSelect(pid, others[r.room.randInt(others.length)]); }
    r.room.endPhaseNow();
    assert.notStrictEqual(r.room.alive().length, 1);
  }
});
test('ผู้รอด 1 คนได้ทองทั้งกองกลาง', () => {
  const t = mk(3, {}, { names: ['A', 'B', 'C'] });
  vote(t, { A: 'AMBUSH', B: 'A', C: 'B' }); // A,B เสมอเป็นเป้า B ตก C โหวต B รอด candidates ของ A = B(ตกแล้ว) → ไม่มี
  assert.deepStrictEqual(aliveNames(t), ['A', 'C']);
  const t2 = mk(3, {}, { names: ['A', 'B', 'C'] });
  vote(t2, { A: 'AMBUSH', B: 'A', C: 'A' });
  t2.room.ambushSelect(t2.id.A, t2.id.B); t2.room.ambushLock(t2.id.A);
  assert.deepStrictEqual(aliveNames(t2), ['A', 'C']);
  const t3 = mk(4, {}, { names: ['A', 'B', 'C', 'D'] });
  vote(t3, { A: 'AMBUSH', B: 'A', C: 'A', D: 'B' }); // D ตก (B ไม่ใช่เป้า) A เลือก B หรือ C
  t3.room.ambushSelect(t3.id.A, t3.id.B); t3.room.ambushLock(t3.id.A);
  assert.deepStrictEqual(aliveNames(t3), ['A', 'C']);
  const t4 = mk(3, {}, { names: ['A', 'B', 'C'] });
  vote(t4, { A: 'AMBUSH', B: 'A', C: 'B' });
  const t5 = mk(4, {}, { names: ['A', 'B', 'C', 'D'] });
  vote(t5, { A: 'AMBUSH', B: 'A', C: 'D', D: 'A' }); // A เป้า 2, C ผิด → ตก; A เลือก B หรือ D
  t5.room.ambushSelect(t5.id.A, t5.id.B); t5.room.ambushLock(t5.id.A);
  assert.deepStrictEqual(aliveNames(t5), ['A', 'D']);
  // 3 คน: A ซุ่ม B,C โหวต A → A เลือก B, C เหลือกับ A = 2 ; ทำให้เหลือ 1: 2 คน? เริ่มที่ 3 คนแล้วให้เหลือ 1
  const t6 = mk(3, {}, { names: ['A', 'B', 'C'] });
  vote(t6, { A: 'AMBUSH', B: 'A', C: 'AMBUSH' }); // A เป้า C ซุ่มพลาด → ตก ; A เลือก B (คนเดียว) → เหลือ A
  assert.deepStrictEqual(aliveNames(t6), ['A']);
  const pot = t6.room.g.pot.slice();
  nextFromResult(t6.room);
  assert.strictEqual(t6.room.phase, PH.ROUND_END);
  assert.deepStrictEqual(t6.room.players.get(t6.id.A).bars, pot);
  barsInvariant(t6.room);
});

console.log('Final Showdown');
test('T-09 ตารางผล 6 คู่ (ทั้งสองฝั่ง) ตรง R-8-20 และแท่งที่ได้มาจากกองกลาง', () => {
  const exp = { 'SHARE/SHARE': [2, 2, 0], 'SHARE/STEAL': [0, 4, 0], 'STEAL/SHARE': [4, 0, 0], 'SHARE/GRAB': [3, 1, 0], 'GRAB/SHARE': [1, 3, 0],
    'STEAL/GRAB': [3, 1, 0], 'GRAB/STEAL': [1, 3, 0], 'STEAL/STEAL': [0, 0, 4], 'GRAB/GRAB': [1, 1, 2] };
  for (const [k, [a, b, left]] of Object.entries(exp)) {
    const [ca, cb] = k.split('/');
    const o = showdownOutcome(ca, cb);
    assert.deepStrictEqual([o.a, o.b, o.keep], [a, b, left], k);
    const t = toShowdown6();
    const pot = t.room.g.pot.slice();
    pickSd(t, ca, cb);
    const A = t.room.players.get(t.id.P2).bars, B = t.room.players.get(t.id.P4).bars;
    assert.deepStrictEqual([A.length, B.length, t.room.g.pot.length], [a, b, left], k);
    for (const bar of [...A, ...B]) assert.ok(pot.includes(bar), 'แท่งมาจากกองกลาง');
    barsInvariant(t.room);
  }
});
test('T-10 STEAL/STEAL: คนนอก 4 คนได้คนละ 1 แท่ง กองกลาง 4 แท่งเดิม สำรับลด 4', () => {
  const t = toShowdown6();
  const pot = t.room.g.pot.slice(), deck = t.room.g.deck.length;
  pickSd(t, 'STEAL', 'STEAL');
  for (const n of ['P1', 'P3', 'P5', 'P6']) assert.strictEqual(t.room.players.get(t.id[n]).bars.length, 1, n);
  t.room.endPhaseNow(); // win check → รอบใหม่
  assert.deepStrictEqual(t.room.g.pot, pot);
  assert.strictEqual(t.room.g.deck.length, deck - 4);
});
test('T-11 GRAB/GRAB: คนละ 1 แท่ง รอบหน้ากองกลาง = 2 แท่งเดิม + 2 แท่งใหม่', () => {
  const t = toShowdown6();
  pickSd(t, 'GRAB', 'GRAB');
  const left = t.room.g.pot.slice();
  assert.strictEqual(left.length, 2);
  t.room.endPhaseNow();
  assert.strictEqual(t.room.g.pot.length, 4);
  assert.deepStrictEqual(t.room.g.pot.slice(0, 2), left);
});
test('หมดเวลาเลือกไพ่ Showdown → ใช้ SHARE ตาม config (R-7-33)', () => {
  const t = toShowdown6();
  t.room.showdownSelect(t.id.P2, 'STEAL'); // ไม่ล็อก ใช้ตัวที่เลือก
  t.room.endPhaseNow();
  assert.strictEqual(t.room.g.sd.result.choiceA, 'STEAL');
  assert.strictEqual(t.room.g.sd.result.choiceB, 'SHARE');
});
test('ไพ่ Showdown ของอีกฝ่ายเป็นความลับจนเปิด', () => {
  const t = toShowdown6();
  t.room.showdownSelect(t.id.P2, 'STEAL');
  const s4 = t.room.getState(t.id.P4), s1 = t.room.getState(t.id.P1);
  assert.strictEqual(s4.showdown.myChoice, null);
  assert.ok(!JSON.stringify(s4).includes('STEAL'));
  assert.ok(!JSON.stringify(s1).includes('STEAL'));
  assert.throws(() => t.room.showdownSelect(t.id.P1, 'SHARE'), e => e.code === 'NOT_ELIGIBLE');
  assert.throws(() => t.room.showdownSelect(t.id.P2, 'NUKE'), e => e.code === 'INVALID_CHOICE');
});

console.log('การชนะ');
function giveTo(room, pid, target) { // ให้ทองจากสำรับจนแต้มเท่ากับ target พอดี (ใช้ในการทดสอบเท่านั้น)
  const g = room.g;
  while (room.points(pid) < target) {
    const need = target - room.points(pid);
    let idx = g.deck.findIndex(b => g.bars[b].value === need);
    if (idx < 0) idx = g.deck.findIndex(b => g.bars[b].value <= need - 3 || g.bars[b].value === 3);
    const [bar] = g.deck.splice(idx, 1);
    room.give(pid, bar, 'TEST');
  }
  assert.strictEqual(room.points(pid), target);
}
test('T-14 แต้มสูงสุดเสมอ 2 คน → Tie-break STEAL/STEAL ครบ 3 ครั้ง → ชนะร่วม แท่งไปกองทิ้ง (R-9-05)', () => {
  const t = toShowdown6();
  giveTo(t.room, t.id.P2, 21); giveTo(t.room, t.id.P4, 21);
  const g = t.room.g;
  const fours = g.deck.filter(b => g.bars[b].value === 4).slice(0, 4 - g.pot.length);
  g.deck = g.deck.filter(b => !fours.includes(b)); // ทำให้กองกลางเป็นค่า 4 ทั้งหมด
  const old = g.pot.splice(0); g.deck.push(...old);
  const four4 = g.deck.filter(b => g.bars[b].value === 4).slice(0, 4);
  g.deck = g.deck.filter(b => !four4.includes(b)); g.pot = four4; g.deck.push(...fours);
  pickSd(t, 'SHARE', 'SHARE');
  assert.strictEqual(t.room.points(t.id.P2), 29); assert.strictEqual(t.room.points(t.id.P4), 29);
  t.room.endPhaseNow();
  assert.strictEqual(t.room.phase, PH.SD_TALK);
  assert.strictEqual(g.sd.type, 'TIEBREAK');
  for (let i = 0; i < 3; i++) {
    t.room.endPhaseNow(); pickSd(t, 'STEAL', 'STEAL');
    for (const n of ['P1', 'P3']) assert.ok(t.room.players.get(t.id[n]).bars.length <= 1, 'Tie-break ไม่มีทองชดเชย');
    t.room.endPhaseNow();
  }
  assert.strictEqual(t.room.phase, PH.END);
  assert.strictEqual(g.winKind, 'shared');
  assert.deepStrictEqual(g.winners.slice().sort(), [t.id.P2, t.id.P4].sort());
  assert.strictEqual(g.discard.length, 12);
  barsInvariant(t.room);
});
test('Tie-break มีคนแต้มสูงกว่า → ชนะทันที', () => {
  const t = toShowdown6();
  giveTo(t.room, t.id.P2, 26); giveTo(t.room, t.id.P4, 26);
  t.room.startTiebreak([t.id.P2, t.id.P4]);
  t.room.endPhaseNow(); pickSd(t, 'STEAL', 'SHARE');
  t.room.endPhaseNow();
  assert.strictEqual(t.room.phase, PH.END);
  assert.deepStrictEqual(t.room.g.winners, [t.id.P2]);
});
test('T-15 แต้มสูงสุดเสมอ 3 คน → ชนะร่วมทันที (R-9-06)', () => {
  const t = mk(6);
  for (const n of ['P1', 'P2', 'P3']) giveTo(t.room, t.id[n], 26);
  t.room.winCheck();
  assert.strictEqual(t.room.phase, PH.END);
  assert.strictEqual(t.room.g.winners.length, 3);
});
test('T-16 ถึงเกณฑ์ 2 คน 26 กับ 28 → 28 ชนะ (R-9-04)', () => {
  const t = mk(6);
  giveTo(t.room, t.id.P1, 26); giveTo(t.room, t.id.P2, 28);
  t.room.winCheck();
  assert.deepStrictEqual(t.room.g.winners, [t.id.P2]);
});
test('T-28 เกณฑ์ชนะ: 9 คน = 25, 10 คน = 24 (R-5-05)', () => {
  assert.strictEqual(mk(9).room.g.winPoints, 25);
  assert.strictEqual(mk(10).room.g.winPoints, 24);
});
test('T-27 สำรับเหลือ 2 แท่ง + STEAL/STEAL → 2 คนได้ทอง แล้วจบเกม คนแต้มสูงสุดชนะ (R-8-31)', () => {
  const t = toShowdown6();
  giveTo(t.room, t.id.P1, 10);
  const g = t.room.g; g.discard.push(...g.deck.splice(0, g.deck.length - 2));
  pickSd(t, 'STEAL', 'STEAL');
  const got = ['P1', 'P3', 'P5', 'P6'].filter(n => t.room.players.get(t.id[n]).bars.length > (n === 'P1' ? 3 : 0));
  assert.ok(g.deckShort);
  assert.strictEqual(g.deck.length, 0);
  t.room.endPhaseNow();
  assert.strictEqual(t.room.phase, PH.END);
  const max = Math.max(...t.room.order.map(id => t.room.points(id)));
  for (const w of g.winners) assert.strictEqual(t.room.points(w), max);
  assert.ok(got.length >= 1);
  barsInvariant(t.room);
});

console.log('ข้อมูลลับและการส่ง state');
test('T-17 hiddenScores: คนอื่นเห็นแค่จำนวนแท่ง ไม่เห็นค่า (R-12-02)', () => {
  const t = mk(6);
  giveTo(t.room, t.id.P1, 8);
  const s = t.room.getState(t.id.P2);
  const p1 = s.players.find(p => p.id === t.id.P1);
  assert.ok(p1.barCount >= 2);
  assert.strictEqual(p1.points, undefined); assert.strictEqual(p1.bars, undefined);
  const mine = t.room.getState(t.id.P1).players.find(p => p.id === t.id.P1);
  assert.strictEqual(mine.points, 8);
  const open = mk(6, { hiddenScores: false }); giveTo(open.room, open.id.P1, 8);
  assert.strictEqual(open.room.getState(open.id.P2).players.find(p => p.id === open.id.P1).points, 8);
});
test('T-34 payload ไม่มี id หรือค่าแท่งของคนอื่น และไม่มีลำดับสำรับ (R-4.1-06)', () => {
  const t = mk(6);
  giveTo(t.room, t.id.P1, 9);
  const txt = JSON.stringify(t.room.getState(t.id.P2));
  for (const b of t.room.players.get(t.id.P1).bars) assert.ok(!txt.includes(b));
  for (const b of t.room.g.pot.concat(t.room.g.deck.slice(0, 5))) assert.ok(!txt.includes('"' + b + '"'));
  assert.ok(!txt.includes(t.room.players.get(t.id.P1).token));
});
test('T-18 ระหว่างโหวต: ตัวเลือกของคนอื่นไม่อยู่ใน payload มีแค่สถานะล็อก (R-7-13)', () => {
  const t = mk(4);
  toVote(t.room);
  t.room.voteSelect(t.id.P1, t.id.P3); t.room.voteLock(t.id.P1);
  const s = t.room.getState(t.id.P2);
  assert.deepStrictEqual(s.locked, [t.id.P1]);
  assert.strictEqual(s.myVote, null);
  assert.ok(!JSON.stringify(s).includes('"choice"'));
  assert.strictEqual(s.vote, undefined);
});
test('T-22 ข้อมูลที่ผู้เล่นเห็นหลังกลับเข้า: ตัวเลือกที่ยังไม่ล็อกของตัวเองยังอยู่ (R-12-06)', () => {
  const t = mk(4); toVote(t.room);
  t.room.voteSelect(t.id.P1, t.id.P3);
  const p = t.room.resume(t.id.P1, t.room.players.get(t.id.P1).token);
  assert.deepStrictEqual(t.room.getState(p.id).myVote, { choice: t.id.P3, locked: false });
  assert.throws(() => t.room.resume(t.id.P1, 'wrong'), e => e.code === 'BAD_TOKEN');
});

console.log('คำสั่งและ GM');
test('T-20 requestId ซ้ำ → ทำครั้งเดียว ไม่มี error (R-12-10)', () => {
  const t = mk(3); toVote(t.room);
  const sv = t.room.phaseSeq;
  t.room.action(t.id.P1, { type: 'vote:select', target: t.id.P2, requestId: 'a1', stateVersion: sv });
  t.room.action(t.id.P1, { type: 'vote:lock', requestId: 'a2', stateVersion: sv });
  const r = t.room.action(t.id.P1, { type: 'vote:lock', requestId: 'a2', stateVersion: sv });
  assert.deepStrictEqual(r, { duplicate: true });
});
test('T-21 stateVersion เก่า → STALE_STATE (R-12-10)', () => {
  const t = mk(3); toVote(t.room);
  assert.throws(() => t.room.action(t.id.P1, { type: 'vote:select', target: t.id.P2, stateVersion: t.room.phaseSeq - 1 }), e => e.code === 'STALE_STATE');
});
test('payload ผิดรูปแบบถูกปฏิเสธอย่างสุภาพ', () => {
  const t = mk(3); toVote(t.room);
  for (const bad of [null, 5, 'x', {}, { type: 7 }, { type: 'nope' }, { type: 'vote:select', target: { a: 1 } }]) {
    assert.throws(() => t.room.action(t.id.P1, bad), e => e instanceof GameError);
  }
});
test('T-23 GM หลุดเกิน gmHandoverSeconds → ย้าย GM ไปคนที่เข้าห้องก่อนและออนไลน์ (R-12-08)', () => {
  const t = mk(4);
  const gm = t.room.gmId;
  t.room.setConnected(gm, false);
  t.clock.t += 29_000; t.room.tick(); assert.strictEqual(t.room.gmId, gm);
  t.clock.t += 2_000; t.room.tick();
  assert.strictEqual(t.room.gmId, t.id.P2);
  assert.ok(t.room.audit.some(a => a.action === 'gm_handover'));
});
test('T-24 GM ข้ามช่วงเจรจา → ลง AuditLog และส่ง notice (R-7-03)', () => {
  const t = mk(3); const notes = []; t.room.onNotice = (r, x) => notes.push(x);
  t.room.action(t.id.P1, { type: 'gm:skip' });
  assert.strictEqual(t.room.phase, PH.VOTE);
  assert.ok(t.room.audit.some(a => a.action === 'skip'));
  assert.strictEqual(notes.length, 1);
  assert.throws(() => t.room.action(t.id.P2, { type: 'gm:skip' }), e => e.code === 'NOT_GM');
});
test('GM หยุดแล้วเล่นต่อ เวลาที่เหลือถูกต้อง', () => {
  const t = mk(3);
  const ends = t.room.timer.endsAt;
  t.clock.t += 10_000;
  t.room.pause(t.id.P1);
  assert.strictEqual(t.room.paused.remaining, ends - t.clock.t);
  t.clock.t += 60_000;
  t.room.resume2(t.id.P1);
  assert.strictEqual(t.room.timer.endsAt - t.clock.t, ends - (t.clock.t - 60_000));
  t.room.pause(t.id.P1); t.room.skip(t.id.P1);
  assert.strictEqual(t.room.phase, PH.VOTE, 'ข้ามได้ตอนหยุด');
});
test('Lobby: ชื่อซ้ำ ห้องเต็ม เตะผู้เล่น เลือกหน่วย (R-5-02, R-4.1-04)', () => {
  const t = mk(2, {}, { start: false });
  assert.throws(() => t.room.addPlayer(' p1 '), e => e.code === 'NAME_TAKEN');
  assert.throws(() => t.room.addPlayer('x'.repeat(17)), e => e.code === 'NAME_INVALID');
  assert.throws(() => t.room.setUnit(t.id.P2, t.room.players.get(t.id.P1).unitId), e => e.code === 'CARD_TAKEN');
  t.room.setUnit(t.id.P2, 'unit-12');
  assert.strictEqual(t.room.players.get(t.id.P2).unitId, 'unit-12');
  t.room.kick(t.id.P1, t.id.P2);
  assert.strictEqual(t.room.players.size, 1);
  for (let i = 0; i < 11; i++) t.room.addPlayer('X' + i);
  assert.throws(() => t.room.addPlayer('Y'), e => e.code === 'ROOM_FULL');
});
test('เริ่มเกมด้วยคนไม่พอ → NOT_ENOUGH_PLAYERS', () => {
  const t = mk(2, { minPlayers: 6 }, { start: false });
  assert.throws(() => t.room.start(t.id.P1), e => e.code === 'NOT_ENOUGH_PLAYERS');
});
test('เปลี่ยนเครื่องกลางเกม: GM อนุมัติแล้ว token เก่าใช้ไม่ได้ (Q7)', () => {
  const t = mk(3);
  const old = t.room.players.get(t.id.P2).token;
  const req = t.room.requestTakeover('p2');
  assert.strictEqual(t.room.getState(t.id.P1).requests.length, 1);
  assert.strictEqual(t.room.getState(t.id.P2).requests, undefined);
  const r = t.room.answerTakeover(t.id.P1, req, true);
  assert.notStrictEqual(r.token, old);
  assert.throws(() => t.room.resume(t.id.P2, old), e => e.code === 'BAD_TOKEN');
  assert.throws(() => t.room.requestTakeover('ใครก็ไม่รู้'), e => e.code === 'GAME_STARTED');
  const req2 = t.room.requestTakeover('P3'); t.clock.t += 121_000; t.room.tick();
  assert.throws(() => t.room.answerTakeover(t.id.P1, req2, true), e => e.code === 'REQUEST_GONE');
});
test('เล่นใหม่: ล้างทองและแชท ผู้เล่นเดิมกลับ Lobby (R-9-09)', () => {
  const t = mk(6);
  for (const n of ['P1']) giveTo(t.room, t.id[n], 30);
  t.room.winCheck();
  t.room.chatSend(t.id.P1, 'gg');
  t.room.playAgain(t.id.P1);
  assert.strictEqual(t.room.phase, PH.LOBBY);
  assert.strictEqual(t.room.g, null); assert.strictEqual(t.room.chat.length, 0);
  assert.strictEqual(t.room.players.size, 6);
  t.room.start(t.id.P1);
  assert.strictEqual(t.room.points(t.id.P1), 0);
});

console.log('config');
test('T-25 voteSeconds = 5 → ใช้ 30 และมีคำเตือน (R-3-02)', () => {
  const w = []; const c = validate({ voteSeconds: 5, hiddenScores: 'yes' }, m => w.push(m));
  assert.strictEqual(c.voteSeconds, 30); assert.strictEqual(c.hiddenScores, true);
  assert.strictEqual(w.length, 2);
  const c2 = validate({ minPlayers: 10, maxPlayers: 8 }, () => {});
  assert.deepStrictEqual([c2.minPlayers, c2.maxPlayers], [6, 12]);
});
test('T-26 conspireSeconds = 45 → ช่วงเจรจา 45 วินาที (R-3-01)', () => {
  const t = mk(3, { conspireSeconds: 45 });
  assert.strictEqual(t.room.timer.endsAt - t.clock.t, 45_000);
});

console.log('แชท');
test('T-36 ส่งแชท: server เติมชื่อ สี เวลา (R-7-40, R-7-43)', () => {
  const t = mk(3);
  const m = t.room.chatSend(t.id.P1, '  โหวต P3 นะ\nโอเค ');
  assert.strictEqual(m.text, 'โหวต P3 นะ โอเค');
  assert.strictEqual(m.name, 'P1'); assert.ok(/^#[0-9A-F]{6}$/i.test(m.color)); assert.strictEqual(m.at, t.clock.t);
  vote(t, { P1: 'AMBUSH', P2: 'AMBUSH', P3: 'AMBUSH' });
  t.clock.t += 5000;
  t.room.chatSend(t.id.P2, 'คนตกรอบพิมพ์ได้');
});
test('T-37 ยาวเกิน → CHAT_TOO_LONG, ส่งเร็วเกิน → CHAT_RATE_LIMIT, ว่าง → CHAT_EMPTY (R-7-41, R-7-42)', () => {
  const t = mk(3);
  assert.throws(() => t.room.chatSend(t.id.P1, 'ก'.repeat(201)), e => e.code === 'CHAT_TOO_LONG');
  t.room.chatSend(t.id.P1, 'ก'.repeat(200));
  t.clock.t += 200;
  assert.throws(() => t.room.chatSend(t.id.P1, 'อีก'), e => e.code === 'CHAT_RATE_LIMIT');
  assert.throws(() => t.room.chatSend(t.id.P2, '   '), e => e.code === 'CHAT_EMPTY');
  assert.throws(() => t.room.chatSend(t.id.P2, 42), e => e.code === 'CHAT_EMPTY');
});
test('T-38 เก็บแชท 100 ข้อความล่าสุด (R-7-44)', () => {
  const t = mk(3);
  for (let i = 0; i < 150; i++) { t.clock.t += 1000; t.room.chatSend(t.id.P1, 'm' + i); }
  assert.strictEqual(t.room.chat.length, 100);
  assert.strictEqual(t.room.chat[0].text, 'm50');
});

console.log('การ์ด');
test('T-31 data.csv จริง 19 แถว steal มีผล 3 บรรทัด (R-4.1-01)', () => {
  assert.deepStrictEqual(CARDS.errors, []);
  assert.strictEqual(CARDS.cards.length, 19);
  assert.strictEqual(CARDS.byId.steal.effect.split('\n').length, 3);
  assert.strictEqual(CARDS.byId.steal.name, 'STEAL');
  assert.strictEqual(CARDS.units.length, 12);
  assert.deepStrictEqual(CARDS.missing, []);
  assert.strictEqual(CARDS.byId['unit-01'].art, 'unit');
});
test('T-32 CSV มี BOM, CRLF, id ซ้ำ, สีผิด, value = 7, แถวว่าง → แถวผิดถูกข้ามพร้อมเลขแถว (R-4.1-02)', () => {
  const text = '﻿id,template,name,kind_label,effect,color,value\r\n' +
    'unit-01,unit,หน่วย ก,หน่วยรบ,"มี, จุลภาค และ ""คำพูด""",#112233,\r\n' +
    'unit-01,unit,ซ้ำ,หน่วยรบ,,#445566,\r\n' +
    'unit-02,unit,สีผิด,หน่วยรบ,,blue,\r\n' +
    ',,,,,,\r\n' +
    'gold-5,gold,ทอง,ทองคำ,,,7\r\n' +
    'gold-3,gold,ทอง,ทองคำ,"สอง\nบรรทัด",,3\r\n' +
    'unit-03,unit,สีซ้ำ,หน่วยรบ,,#112233,\r\n';
  const rows = parseCSV(text);
  const v = validateRows(rows);
  assert.deepStrictEqual(v.cards.map(c => c.id), ['unit-01', 'gold-3']);
  assert.strictEqual(v.cards[0].effect, 'มี, จุลภาค และ "คำพูด"');
  assert.strictEqual(v.cards[1].effect, 'สอง\nบรรทัด');
  assert.ok(v.errors.some(e => e.includes('แถว 3') && e.includes('ซ้ำ')));
  assert.ok(v.errors.some(e => e.includes('แถว 4')));
  assert.ok(v.errors.some(e => e.includes('แถว 5') && e.includes('value')));
  assert.ok(v.errors.some(e => e.includes('แถว 7') && e.includes('color')));
});
test('T-33 ไม่มีการ์ด grab → เริ่มเกมไม่ได้ CARDS_MISSING พร้อม id (R-4.1-03)', () => {
  const cards = { ...CARDS, missing: ['grab'] };
  const t = mk(3, {}, { cards, start: false });
  assert.throws(() => t.room.start(t.id.P1), e => e.code === 'CARDS_MISSING' && e.message.includes('grab'));
  assert.strictEqual(t.room.getState(t.id.P1).cardsOk, false);
});
test('การ์ดหน่วยรบไม่พอกับจำนวนผู้เล่น → CARDS_MISSING', () => {
  const cards = { ...CARDS, units: CARDS.units.slice(0, 2) };
  const t = mk(3, {}, { cards, start: false });
  assert.strictEqual(t.room.players.get(t.id.P3).unitId, null);
  assert.throws(() => t.room.start(t.id.P1), e => e.code === 'CARDS_MISSING');
});
test('template ทุกช่องอ้างคอลัมน์ที่มีใน schema (หรือ runtime)', () => {
  const SCHEMA = require('../shared/card-schema');
  for (const [k, t] of Object.entries(CARDS.templates)) for (const s of t.slots) {
    assert.ok(SCHEMA.columns[s.column] || SCHEMA.runtime.includes(s.column), `${k}.${s.id} → ${s.column}`);
  }
});

console.log('จำลองเล่นสุ่ม');
test('T-30 เล่นสุ่ม 1,000 เกม 6–12 คน: ทุกเกมจบ ทองรวมคงที่ แต้ม = ผลรวม transaction (R-4-02, R-8-41)', () => {
  let rounds = 0, ties = 0;
  for (let gno = 0; gno < 1000; gno++) {
    const n = 6 + (gno % 7);
    const t = mk(n, {}, { seed: 1000 + gno });
    const room = t.room, rnd = mulberry(77 + gno);
    let steps = 0;
    while (room.phase !== PH.END) {
      if (++steps > 20000) throw new Error('เกมไม่จบ seed ' + gno);
      if (room.phase === PH.VOTE) {
        for (const pid of room.g.eligible) {
          if (rnd() < 0.05) continue; // บางคนไม่โหวต
          const others = room.g.eligible.filter(x => x !== pid);
          room.voteSelect(pid, rnd() < 0.07 ? 'AMBUSH' : others[Math.floor(rnd() * others.length)]);
          if (rnd() < 0.9) room.voteLock(pid);
        }
      } else if (room.phase === PH.SD_PICK) {
        const sd = room.g.sd;
        for (const pid of [sd.a, sd.b]) if (rnd() < 0.95) room.showdownSelect(pid, ['SHARE', 'STEAL', 'GRAB'][Math.floor(rnd() * 3)]);
      }
      if (room.phase !== PH.END) room.endPhaseNow();
      if (room.g) barsInvariant(room);
    }
    rounds += room.g.round;
    if (room.g.winKind === 'shared') ties++;
    for (const p of room.players.values()) {
      const sum = room.g.tx.filter(x => x.pid === p.id).reduce((s, x) => s + x.value, 0);
      assert.strictEqual(room.points(p.id), sum);
    }
    const w = room.g.winners;
    assert.ok(w.length >= 1);
  }
  console.log(`      เฉลี่ย ${(rounds / 1000).toFixed(1)} รอบต่อเกม, ชนะร่วม ${ties} เกม`);
});

console.log(`\nผ่าน ${passed} ไม่ผ่าน ${failed}`);
process.exit(failed ? 1 : 0);
