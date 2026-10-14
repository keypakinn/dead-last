'use strict';
// กติกาทั้งหมดของ Dead Last (spec v2.1) แยกจาก network เพื่อให้ทดสอบได้
// รหัส R-x-xx ใน comment อ้างถึงกติกาใน spec
const crypto = require('crypto');

class GameError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; if (extra) this.extra = extra; }
}

const PH = {
  LOBBY: 'LOBBY', CONSPIRE: 'CONSPIRE', VOTE: 'VOTE', AMBUSH_PICK: 'AMBUSH_PICK', RESULT: 'RESULT',
  ROUND_END: 'ROUND_END', SD_TALK: 'SHOWDOWN_TALK', SD_PICK: 'SHOWDOWN_PICK', SD_RESULT: 'SHOWDOWN_RESULT',
  END: 'GAME_END',
};
const SD_CHOICES = ['SHARE', 'STEAL', 'GRAB'];
const REQUIRED_CARDS = ['ambush', 'share', 'steal', 'grab', 'gold-3', 'gold-4', 'gold-5'];
const LOBBY_DROP_MS = 2 * 60 * 1000;   // Q6: หลุดใน Lobby เกิน 2 นาที เอาออก
const TAKEOVER_TTL_MS = 2 * 60 * 1000;  // Q7: คำขอเปลี่ยนเครื่องหมดอายุ
const NAME_MAX = 16;

const defaultRand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32; // R-12-04
const newToken = () => crypto.randomBytes(16).toString('hex');
const newId = () => crypto.randomBytes(6).toString('hex');
const normName = (s) => String(s).trim().toLowerCase();

// R-8-20 ตารางผล Showdown: [A ได้, B ได้, กองกลางที่ค้าง, ทองชดเชยคนนอก]
function showdownOutcome(a, b) {
  const k = a + '/' + b;
  switch (k) {
    case 'SHARE/SHARE': return { a: 2, b: 2, keep: 0, comp: false };
    case 'SHARE/STEAL': return { a: 0, b: 4, keep: 0, comp: false };
    case 'STEAL/SHARE': return { a: 4, b: 0, keep: 0, comp: false };
    case 'SHARE/GRAB': return { a: 3, b: 1, keep: 0, comp: false };
    case 'GRAB/SHARE': return { a: 1, b: 3, keep: 0, comp: false };
    case 'STEAL/GRAB': return { a: 3, b: 1, keep: 0, comp: false };
    case 'GRAB/STEAL': return { a: 1, b: 3, keep: 0, comp: false };
    case 'STEAL/STEAL': return { a: 0, b: 0, keep: 4, comp: true };
    case 'GRAB/GRAB': return { a: 1, b: 1, keep: 2, comp: false };
  }
  throw new Error('bad showdown pair ' + k);
}

class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.cfg = opts.config;
    this.cards = opts.cards || { byId: {}, units: [], ok: false, missing: REQUIRED_CARDS.slice() };
    this.onChange = opts.onChange || (() => {});
    this.onNotice = opts.onNotice || (() => {});
    this.rand = opts.rand || defaultRand;
    this.now = opts.now || (() => Date.now());
    this.quiet = !!opts.quiet;
    this.players = new Map();
    this.order = [];            // ลำดับเข้าห้อง (seatOrder)
    this.gmId = null;
    this.phase = PH.LOBBY;
    this.phaseSeq = 0;          // stateVersion ที่ client ส่งกลับ (R-12-10)
    this.version = 0;
    this.timer = null;          // { endsAt, onEnd, handle }
    this.paused = null;         // { remaining }
    this.g = null;              // state ของเกมที่กำลังเล่น
    this.chat = [];
    this.audit = [];
    this.events = [];           // EventLog (R-12-13)
    this.requests = new Map();  // reqId -> คำขอเปลี่ยนเครื่อง
    this.seen = new Map();      // pid -> Set(requestId) กันกดซ้ำ
    this.lastChatAt = new Map();
    this.emptySince = null;
    this.seq = 0;
  }

  // ---------- utilities ----------
  randInt(n) { return Math.floor(this.rand() * n); }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = this.randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  log(type, data) { this.events.push({ t: this.now(), type, data }); if (this.events.length > 5000) this.events.shift(); }
  telemetry(type, data) { if (!this.quiet) console.log(JSON.stringify({ tel: type, room: this.code, ...data })); }
  changed() { this.version++; try { this.onChange(this); } catch (e) { console.error('onChange error', e); } }
  player(pid) { const p = this.players.get(pid); if (!p) throw new GameError('NOT_IN_ROOM', 'ไม่พบผู้เล่นนี้ในห้อง'); return p; }
  get cfgWin() { const t = this.cfg.winPointsByPlayers, n = Math.max(2, Math.min(12, this.order.length)); return t[n]; } // R-5-05 เกณฑ์ชนะตามจำนวนผู้เล่น
  connectedCount() { let n = 0; for (const p of this.players.values()) if (p.connected) n++; return n; }

  // ---------- ห้องและผู้เล่น ----------
  validName(name) {
    if (typeof name !== 'string') throw new GameError('NAME_INVALID', 'กรุณาใส่ชื่อ');
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 1 || [...n].length > NAME_MAX) throw new GameError('NAME_INVALID', `ชื่อต้องยาว 1–${NAME_MAX} ตัวอักษร`);
    return n;
  }
  findByName(name) { const k = normName(name); for (const p of this.players.values()) if (normName(p.name) === k) return p; return null; }

  addPlayer(name) { // R-5-01, R-5-02, R-5-08
    const n = this.validName(name);
    if (this.phase !== PH.LOBBY) throw new GameError('GAME_STARTED', 'เกมเริ่มไปแล้ว เข้าร่วมไม่ได้');
    if (this.findByName(n)) throw new GameError('NAME_TAKEN', 'ชื่อนี้มีคนใช้แล้ว');
    if (this.players.size >= this.cfg.maxPlayers) throw new GameError('ROOM_FULL', 'ห้องเต็มแล้ว');
    const p = { id: newId(), token: newToken(), name: n, seat: ++this.seq, connected: true, discAt: null,
      unitId: this.freeUnit(), status: 'alive', outAtVote: null, bars: [] };
    this.players.set(p.id, p); this.order.push(p.id);
    if (!this.gmId) this.gmId = p.id;
    this.log('join', { pid: p.id, name: n });
    this.changed();
    return p;
  }
  freeUnit() { const used = new Set([...this.players.values()].map(p => p.unitId)); return this.cards.units.find(u => !used.has(u)) || null; }
  removePlayer(pid) {
    if (!this.players.has(pid)) return;
    this.players.delete(pid); this.order = this.order.filter(x => x !== pid);
    if (this.gmId === pid) this.gmId = this.order.find(id => this.players.get(id).connected) || this.order[0] || null;
    this.changed();
  }
  setConnected(pid, on) {
    const p = this.players.get(pid); if (!p) return;
    p.connected = on; p.discAt = on ? null : this.now();
    this.log(on ? 'connect' : 'disconnect', { pid });
    if (!on) this.telemetry('player_disconnect', { pid }); else this.telemetry('player_rejoin', { pid });
    this.changed();
  }
  resume(pid, token) { // R-12-06
    const p = this.players.get(pid);
    if (!p || typeof token !== 'string' || p.token !== token) throw new GameError('BAD_TOKEN', 'ไม่พบที่นั่งเดิม กรุณาเข้าห้องใหม่');
    return p;
  }

  // Q7: เข้าด้วยชื่อเดิมหลังเกมเริ่ม → GM อนุมัติ
  requestTakeover(name) {
    const n = this.validName(name);
    const p = this.findByName(n);
    if (!p) throw new GameError('GAME_STARTED', 'เกมเริ่มไปแล้ว เข้าร่วมไม่ได้');
    const reqId = newId();
    this.requests.set(reqId, { reqId, pid: p.id, name: p.name, at: this.now() });
    this.log('takeover_request', { pid: p.id });
    this.changed();
    return reqId;
  }
  cancelRequest(reqId) { if (this.requests.delete(reqId)) this.changed(); }
  answerTakeover(gmPid, reqId, approve) {
    this.requireGm(gmPid);
    const r = this.requests.get(reqId);
    if (!r) throw new GameError('REQUEST_GONE', 'คำขอนี้หมดอายุแล้ว');
    this.requests.delete(reqId);
    const p = this.players.get(r.pid);
    if (!p) { this.changed(); throw new GameError('REQUEST_GONE', 'ผู้เล่นนี้ไม่อยู่ในห้องแล้ว'); }
    if (approve) p.token = newToken();
    this.addAudit(gmPid, approve ? 'approve_device' : 'deny_device', p.name);
    this.changed();
    return { approve, pid: p.id, token: approve ? p.token : null };
  }

  requireGm(pid) { if (pid !== this.gmId) throw new GameError('NOT_GM', 'เฉพาะ GM เท่านั้น'); }
  addAudit(pid, action, detail) {
    const p = this.players.get(pid);
    const e = { at: this.now(), actor: p ? p.name : '-', action, detail: detail || '' };
    this.audit.push(e); if (this.audit.length > 100) this.audit.shift();
    this.log('audit', e);
    this.telemetry('gm_action', { action });
    this.onNotice(this, `${e.actor} (GM): ${AUDIT_TEXT[action] || action}${detail ? ' ' + detail : ''}`);
  }

  // งานเบื้องหลัง เรียกจาก server ทุก 2 วินาที
  tick() {
    const now = this.now();
    // R-12-08 ย้าย GM เมื่อหลุดนานเกิน gmHandoverSeconds
    const gm = this.players.get(this.gmId);
    if (gm && !gm.connected && gm.discAt && now - gm.discAt >= this.cfg.gmHandoverSeconds * 1000) {
      const next = this.order.map(id => this.players.get(id)).find(p => p.connected);
      if (next) {
        this.gmId = next.id;
        this.addAudit(next.id, 'gm_handover', `แทน ${gm.name}`);
        this.changed();
      }
    }
    // Q6 Lobby: หลุดเกิน 2 นาที เอาออก
    if (this.phase === PH.LOBBY) {
      for (const p of [...this.players.values()]) if (!p.connected && p.discAt && now - p.discAt >= LOBBY_DROP_MS) this.removePlayer(p.id);
    }
    for (const r of [...this.requests.values()]) if (now - r.at >= TAKEOVER_TTL_MS) this.cancelRequest(r.reqId);
    if (this.connectedCount() === 0) { if (!this.emptySince) this.emptySince = now; } else this.emptySince = null;
  }
  isIdle() { return this.emptySince && this.now() - this.emptySince >= this.cfg.roomIdleMinutes * 60000; }

  // ---------- timer ของเฟส ----------
  setPhase(phase, seconds, onEnd) {
    this.clearTimer();
    this.phase = phase; this.phaseSeq++; this.paused = null;
    this.log('phase', { phase, seconds });
    if (seconds != null) this.schedule(seconds * 1000, onEnd);
    this.changed();
  }
  schedule(ms, onEnd) {
    const t = { endsAt: this.now() + ms, onEnd, handle: null };
    t.handle = setTimeout(() => this.fire(t), ms);
    if (t.handle.unref) t.handle.unref();
    this.timer = t;
  }
  fire(t) {
    if (this.timer !== t) return;
    this.timer = null;
    this.runEnd(t.onEnd);
  }
  runEnd(onEnd) {
    try { onEnd(); } catch (e) { // ห้ามให้ error ใน timer ทำให้ทั้งเซิร์ฟเวอร์ล่ม
      console.error(`[room ${this.code}] error at end of ${this.phase}:`, e);
      this.log('error', { phase: this.phase, message: String(e && e.message) });
      this.onNotice(this, 'เกิดข้อผิดพลาดในเกม กรุณาให้ GM เริ่มเกมใหม่');
    }
  }
  clearTimer() { if (this.timer) { clearTimeout(this.timer.handle); this.timer = null; } this.paused = null; }
  endPhaseNow() { // สำหรับ test และ GM ข้ามช่วง
    if (this.paused) { const p = this.paused; this.paused = null; this.runEnd(p.onEnd); return; }
    if (this.timer) { const t = this.timer; clearTimeout(t.handle); this.fire(t); }
  }
  checkEarly(allDone) { if (allDone && !this.paused && this.timer) this.endPhaseNow(); }

  // ---------- เริ่มเกม ----------
  start(pid) { // R-5-04 ถึง R-5-07, R-4.1-03
    this.requireGm(pid);
    if (this.phase !== PH.LOBBY && this.phase !== PH.END) throw new GameError('WRONG_PHASE', 'เกมกำลังเล่นอยู่');
    const n = this.players.size;
    if (n < this.cfg.minPlayers) throw new GameError('NOT_ENOUGH_PLAYERS', `ต้องมีผู้เล่นอย่างน้อย ${this.cfg.minPlayers} คน (ตอนนี้ ${n} คน)`);
    if (n > this.cfg.maxPlayers) throw new GameError('ROOM_FULL', 'ผู้เล่นเกินจำนวนสูงสุด');
    const missing = this.cards.missing.slice();
    for (const p of this.players.values()) if (!p.unitId) { missing.push('unit-xx'); break; }
    if (missing.length) throw new GameError('CARDS_MISSING', 'การ์ดไม่ครบ เริ่มเกมไม่ได้: ' + missing.join(', '), { missing });
    const deck = [];
    let k = 0;
    for (const [v, c] of [[3, this.cfg.deckCount3], [4, this.cfg.deckCount4], [5, this.cfg.deckCount5]]) {
      for (let i = 0; i < c; i++) deck.push({ id: 'B' + String(++k).padStart(3, '0'), value: v });
    }
    this.shuffle(deck);
    this.log('shuffle', { order: deck.map(b => b.id) });
    const bars = {}; for (const b of deck) bars[b.id] = b;
    this.g = { bars, total: deck.length, deck: deck.map(b => b.id), pot: [], discard: [], tx: [], given: new Set(),
      round: 0, voteNo: 0, eligible: [], votes: new Map(), vr: null, sd: null, tb: null, deckShort: false,
      history: [], roundEnd: null, winners: null, winPoints: this.cfgWin, startedAt: this.now() };
    for (const p of this.players.values()) { p.bars = []; p.status = 'alive'; p.outAtVote = null; }
    this.addAudit(pid, 'start');
    this.startRound();
  }

  playAgain(pid) { // R-9-09
    this.requireGm(pid);
    if (this.phase !== PH.END) throw new GameError('WRONG_PHASE', 'เล่นใหม่ได้เมื่อจบเกมเท่านั้น');
    this.clearTimer(); this.g = null; this.chat = [];
    for (const p of this.players.values()) { p.bars = []; p.status = 'alive'; p.outAtVote = null; }
    this.addAudit(pid, 'play_again');
    this.setPhase(PH.LOBBY, null);
  }

  // ---------- ทอง ----------
  draw(n) { const out = []; while (out.length < n && this.g.deck.length) out.push(this.g.deck.shift()); return out; }
  points(pid) { const p = this.players.get(pid); return p ? p.bars.reduce((s, id) => s + this.g.bars[id].value, 0) : 0; }
  give(pid, barId, reason) { // R-4-01, R-8-40
    const g = this.g;
    if (g.given.has(barId)) throw new Error('bar already given ' + barId);
    g.given.add(barId);
    this.players.get(pid).bars.push(barId);
    g.tx.push({ txId: g.tx.length + 1, round: g.round, pid, barId, value: g.bars[barId].value, reason, at: this.now() });
  }
  giveRandom(pid, pool, count, reason) {
    const got = [];
    for (let i = 0; i < count && pool.length; i++) {
      const idx = this.randInt(pool.length);
      const [bar] = pool.splice(idx, 1);
      this.give(pid, bar, reason); got.push(bar);
    }
    this.log('random_bars', { pid, bars: got });
    return got;
  }
  compensate(pids, reason) { // R-8-11, R-8-20, R-8-31
    const order = this.shuffle(pids.slice());
    this.log('random_comp_order', { order });
    const items = [];
    for (const pid of order) {
      for (let i = 0; i < this.cfg.compensationBars; i++) {
        const [bar] = this.draw(1);
        if (!bar) { if (!this.g.deckShort) this.telemetry('deck_short', { needed: 1, available: 0 }); this.g.deckShort = true; break; }
        this.give(pid, bar, reason); items.push(pid);
      }
    }
    return items;
  }

  // ---------- รอบ ----------
  startRound() { // R-8-30
    const g = this.g;
    g.round++; g.voteNo = 0; g.roundEnd = null; g.sd = null; g.vr = null;
    for (const p of this.players.values()) { p.status = 'alive'; p.outAtVote = null; }
    const need = this.cfg.potSize - g.pot.length;
    if (need > 0) {
      const got = this.draw(need);
      g.pot.push(...got);
      if (got.length < need) { g.deckShort = true; this.telemetry('deck_short', { needed: need, available: got.length }); }
    }
    this.log('round_start', { round: g.round, pot: g.pot.slice() });
    this.nextVote();
  }
  alive() { return this.order.filter(id => this.players.get(id).status === 'alive'); }

  nextVote() { // R-7-01
    const g = this.g;
    g.voteNo++; g.eligible = this.alive(); g.votes = new Map(); g.vr = null;
    const secs = g.voteNo === 1 ? this.cfg.conspireSecondsFirst : this.cfg.conspireSecondsNext; // ครั้งแรกของรอบ / โหวตซ้ำ
    this.setPhase(PH.CONSPIRE, secs, () => this.startVote());
  }
  startVote() { this.setPhase(PH.VOTE, this.cfg.voteSeconds, () => this.resolveVote()); }

  voteSelect(pid, target) { // R-7-10, R-7-11, R-7-12
    const g = this.g;
    if (this.phase !== PH.VOTE) throw new GameError('WRONG_PHASE', 'ยังไม่ใช่ช่วงโหวต');
    if (!g.eligible.includes(pid)) throw new GameError('NOT_ELIGIBLE', 'คุณไม่มีสิทธิ์โหวตครั้งนี้');
    const v = g.votes.get(pid);
    if (v && v.locked) throw new GameError('ALREADY_LOCKED', 'ล็อกไปแล้ว');
    if (target !== 'AMBUSH' && (target === pid || !g.eligible.includes(target))) throw new GameError('INVALID_TARGET', 'เลือกคนนี้ไม่ได้');
    g.votes.set(pid, { choice: target, locked: false });
    this.changed();
  }
  voteLock(pid) {
    const g = this.g;
    if (this.phase !== PH.VOTE) throw new GameError('WRONG_PHASE', 'ยังไม่ใช่ช่วงโหวต');
    if (!g.eligible.includes(pid)) throw new GameError('NOT_ELIGIBLE', 'คุณไม่มีสิทธิ์โหวตครั้งนี้');
    const v = g.votes.get(pid);
    if (!v) throw new GameError('NOTHING_SELECTED', 'เลือกก่อนแล้วค่อยล็อก');
    if (v.locked) throw new GameError('ALREADY_LOCKED', 'ล็อกไปแล้ว');
    v.locked = true; v.lockedAt = this.now();
    this.changed();
    this.checkEarly(g.eligible.every(id => (g.votes.get(id) || {}).locked)); // R-7-14
  }

  resolveVote() { // R-8-01 ขั้น 1–5
    const g = this.g;
    const choices = {}, byTimeout = [];
    for (const id of g.eligible) {
      const v = g.votes.get(id);
      choices[id] = v ? v.choice : 'NONE'; // R-7-15
      if (!v || !v.locked) byTimeout.push(id);
    }
    const tally = {};
    for (const id of g.eligible) tally[id] = 0;
    for (const c of Object.values(choices)) if (c !== 'AMBUSH' && c !== 'NONE') tally[c]++;
    const max = Math.max(0, ...Object.values(tally));
    const targets = max > 0 ? g.eligible.filter(id => tally[id] === max) : []; // R-8-01 ขั้น 2–3
    const e1 = new Set();
    for (const id of g.eligible) {
      const isTarget = targets.includes(id);
      if (isTarget && choices[id] !== 'AMBUSH') e1.add(id);
      if (!isTarget && !targets.includes(choices[id])) e1.add(id);
    }
    const ambush = targets.filter(id => choices[id] === 'AMBUSH').map(id => ({
      ambusher: id,
      candidates: g.eligible.filter(v => choices[v] === id && !e1.has(v)), // R-7-21
      pick: null, locked: false, auto: false, byTimeout: false,
    }));
    for (const a of ambush) {
      if (a.candidates.length === 1) { a.pick = a.candidates[0]; a.locked = true; a.auto = true; } // R-7-22
      else if (a.candidates.length === 0) { a.locked = true; a.auto = true; } // R-7-21 ไม่มีคนให้เลือก → ข้าม
    }
    g.vr = { round: g.round, voteNo: g.voteNo, eligible: g.eligible.slice(), choices, tally, targets, e1: [...e1], ambush, byTimeout, final: false };
    const ambushers = Object.values(choices).filter(c => c === 'AMBUSH').length;
    this.telemetry('vote_reveal', { round: g.round, voteNo: g.voteNo, timeouts: byTimeout.length, ambushers, ambushTargets: ambush.length });
    this.log('vote_reveal', { choices, tally, targets });
    if (ambush.some(a => !a.locked)) this.setPhase(PH.AMBUSH_PICK, this.cfg.ambushPickSeconds, () => this.finishVote());
    else this.finishVote();
  }
  ambushEntry(pid) {
    if (this.phase !== PH.AMBUSH_PICK) throw new GameError('WRONG_PHASE', 'ยังไม่ใช่ช่วงเลือกคนที่จะกำจัด');
    const a = this.g.vr.ambush.find(x => x.ambusher === pid && !x.auto && x.candidates.length > 1);
    if (!a) throw new GameError('NOT_ELIGIBLE', 'คุณไม่ต้องเลือกในช่วงนี้');
    return a;
  }
  ambushSelect(pid, victim) {
    const a = this.ambushEntry(pid);
    if (a.locked) throw new GameError('ALREADY_LOCKED', 'ล็อกไปแล้ว');
    if (!a.candidates.includes(victim)) throw new GameError('INVALID_VICTIM', 'เลือกได้เฉพาะคนที่โหวตคุณ');
    a.pick = victim; this.changed();
  }
  ambushLock(pid) {
    const a = this.ambushEntry(pid);
    if (a.locked) throw new GameError('ALREADY_LOCKED', 'ล็อกไปแล้ว');
    if (!a.pick) throw new GameError('NOTHING_SELECTED', 'เลือกก่อนแล้วค่อยล็อก');
    a.locked = true; this.changed();
    this.checkEarly(this.g.vr.ambush.every(x => x.locked));
  }

  finishVote() { // R-8-01 ขั้น 6–8, R-7-24
    const g = this.g, vr = g.vr;
    for (const a of vr.ambush) {
      if (a.locked) continue;
      a.byTimeout = true; a.locked = true;
      if (!a.pick && a.candidates.length && this.cfg.ambushTimeoutPick === 'random') {
        a.pick = a.candidates[this.randInt(a.candidates.length)];
        this.log('random_ambush_pick', { ambusher: a.ambusher, pick: a.pick });
      }
      this.telemetry('ambush_pick', { byTimeout: true });
    }
    const out = new Set(vr.e1);
    for (const a of vr.ambush) if (a.pick) out.add(a.pick);
    const reasons = {};
    for (const id of out) {
      const c = vr.choices[id];
      if (vr.targets.includes(id) && c !== 'AMBUSH') reasons[id] = 'target';
      else if (vr.ambush.some(a => a.pick === id)) reasons[id] = 'ambushed';
      else if (c === 'AMBUSH') reasons[id] = 'ambush_miss';
      else if (c === 'NONE') reasons[id] = 'no_vote';
      else reasons[id] = 'wrong_vote';
      const p = this.players.get(id); p.status = 'out'; p.outAtVote = g.voteNo;
    }
    vr.eliminated = vr.eligible.filter(id => out.has(id));
    vr.reasons = reasons;
    vr.survivors = vr.eligible.filter(id => !out.has(id));
    vr.final = true;
    g.history.push({ kind: 'vote', round: g.round, voteNo: g.voteNo, choices: vr.choices, tally: vr.tally, targets: vr.targets,
      eliminated: vr.eliminated, reasons, picks: vr.ambush.map(a => ({ ambusher: a.ambusher, pick: a.pick })) });
    this.log('vote_result', { eliminated: vr.eliminated, reasons, survivors: vr.survivors });
    this.setPhase(PH.RESULT, this.cfg.voteResultSeconds, () => this.afterResult());
  }

  afterResult() {
    const alive = this.alive();
    if (alive.length >= 3) return this.nextVote();
    if (alive.length === 2) return this.startShowdown('NORMAL', alive);
    this.roundEndSmall(alive);
  }

  roundEndSmall(alive) { // R-8-10, R-8-11
    const g = this.g;
    const items = [];
    let outcome;
    if (alive.length === 1) {
      outcome = 'ONE';
      const pid = alive[0], pot = g.pot.slice(); g.pot = [];
      for (const b of pot) this.give(pid, b, 'ONE_SURVIVOR');
      items.push({ pid, count: pot.length, reason: 'ONE_SURVIVOR' });
    } else {
      outcome = 'ZERO';
      if (this.cfg.zeroSurvivorCompensation) {
        const rec = this.order.filter(id => { const p = this.players.get(id); return p.outAtVote != null && p.outAtVote < g.voteNo; });
        const got = this.compensate(rec, 'ZERO_COMP');
        for (const pid of new Set(got)) items.push({ pid, count: got.filter(x => x === pid).length, reason: 'ZERO_COMP' });
      }
    }
    g.roundEnd = { outcome, items, carried: g.pot.length };
    g.history.push({ kind: 'award', round: g.round, outcome, items });
    this.telemetry('round_end', { round: g.round, outcome, votes: g.voteNo, compensationBars: items.filter(i => i.reason === 'ZERO_COMP').length });
    this.setPhase(PH.ROUND_END, this.cfg.roundEndSeconds, () => this.winCheck());
  }

  // ---------- Showdown ----------
  startShowdown(type, pair, pot) { // R-7-30, R-9-05
    const g = this.g;
    g.sd = { type, a: pair[0], b: pair[1], pot: type === 'NORMAL' ? null : pot, choice: {}, locked: {}, result: null };
    this.setPhase(PH.SD_TALK, this.cfg.showdownTalkSeconds, () =>
      this.setPhase(PH.SD_PICK, this.cfg.showdownPickSeconds, () => this.resolveShowdown()));
  }
  sdCheck(pid) {
    if (this.phase !== PH.SD_PICK) throw new GameError('WRONG_PHASE', 'ยังไม่ใช่ช่วงเลือกไพ่');
    const sd = this.g.sd;
    if (pid !== sd.a && pid !== sd.b) throw new GameError('NOT_ELIGIBLE', 'คุณไม่ได้อยู่ในการดวลนี้');
    if (sd.locked[pid]) throw new GameError('ALREADY_LOCKED', 'ล็อกไปแล้ว');
    return sd;
  }
  showdownSelect(pid, choice) {
    const sd = this.sdCheck(pid);
    if (!SD_CHOICES.includes(choice)) throw new GameError('INVALID_CHOICE', 'ไพ่ไม่ถูกต้อง');
    sd.choice[pid] = choice; this.changed();
  }
  showdownLock(pid) {
    const sd = this.sdCheck(pid);
    if (!sd.choice[pid]) throw new GameError('NOTHING_SELECTED', 'เลือกไพ่ก่อนแล้วค่อยล็อก');
    sd.locked[pid] = true; this.changed();
    this.checkEarly(sd.locked[sd.a] && sd.locked[sd.b]);
  }
  timeoutChoice() { // R-7-33
    const c = this.cfg.showdownTimeoutChoice;
    if (c === 'random') { const r = SD_CHOICES[this.randInt(3)]; this.log('random_showdown_choice', { choice: r }); return r; }
    return c.toUpperCase();
  }
  resolveShowdown() { // R-8-20 ถึง R-8-22, R-9-05
    const g = this.g, sd = g.sd;
    const byTimeout = [];
    for (const pid of [sd.a, sd.b]) if (!sd.choice[pid]) { sd.choice[pid] = this.timeoutChoice(); byTimeout.push(pid); }
    const ca = sd.choice[sd.a], cb = sd.choice[sd.b];
    const o = showdownOutcome(ca, cb);
    const pool = sd.type === 'NORMAL' ? g.pot : sd.pot;
    const reason = sd.type === 'NORMAL' ? 'SHOWDOWN' : 'TIEBREAK';
    const gotA = this.giveRandom(sd.a, pool, o.a, reason);
    const gotB = this.giveRandom(sd.b, pool, o.b, reason);
    let comp = [];
    if (sd.type === 'NORMAL') {
      if (o.comp) comp = this.compensate(this.order.filter(id => id !== sd.a && id !== sd.b), 'STEAL_STEAL_COMP');
      // pool คือ g.pot: แท่งที่เหลือค้างไว้รอบหน้า (Steal/Steal 4 แท่ง, Grab/Grab 2 แท่ง)
    } else { g.discard.push(...pool.splice(0)); }
    sd.result = { choiceA: ca, choiceB: cb, toA: gotA.length, toB: gotB.length, left: sd.type === 'NORMAL' ? g.pot.length : 0,
      comp: [...new Set(comp)].map(pid => ({ pid, count: comp.filter(x => x === pid).length })), byTimeout };
    g.history.push({ kind: 'showdown', round: g.round, type: sd.type, a: sd.a, b: sd.b, ...sd.result });
    this.telemetry('showdown_reveal', { choiceA: ca, choiceB: cb, byTimeout: byTimeout.length, type: sd.type });
    this.log('showdown_result', { a: sd.a, b: sd.b, ca, cb, gotA, gotB, comp });
    this.setPhase(PH.SD_RESULT, this.cfg.showdownResultSeconds, () => (sd.type === 'NORMAL' ? this.winCheck() : this.tiebreakCheck()));
  }

  // ---------- ชนะ ----------
  winCheck() { // R-9-01 ถึง R-9-06, R-8-31
    const g = this.g, win = g.winPoints;
    const all = this.order.slice();
    const qual = all.filter(id => this.points(id) >= win);
    this.telemetry('win_check', { qualifiers: qual.length, deckShort: g.deckShort });
    if (!qual.length && !g.deckShort) return this.startRound();
    const pool = qual.length ? qual : all;
    const max = Math.max(...pool.map(id => this.points(id)));
    const top = pool.filter(id => this.points(id) === max);
    if (g.deckShort || top.length === 1 || top.length >= 3) return this.endGame(top, top.length > 1 ? 'shared' : 'win');
    return this.startTiebreak(top);
  }
  startTiebreak(pair) {
    if (this.cfg.tiebreakMaxShowdowns <= 0) return this.endGame(pair, 'shared');
    this.g.tb = { pair, count: 0 };
    this.tiebreakRound();
  }
  tiebreakRound() { // R-9-05, R-9-07
    const g = this.g, tb = g.tb;
    const bars = this.draw(this.cfg.potSize);
    if (bars.length < this.cfg.potSize) { g.deck.unshift(...bars); return this.endGame(tb.pair, 'shared'); }
    tb.count++;
    for (const id of this.order) this.players.get(id).status = tb.pair.includes(id) ? 'alive' : 'out';
    this.startShowdown('TIEBREAK', tb.pair, bars);
  }
  tiebreakCheck() {
    const tb = this.g.tb, [a, b] = tb.pair, pa = this.points(a), pb = this.points(b);
    if (pa !== pb) return this.endGame([pa > pb ? a : b], 'win');
    if (tb.count < this.cfg.tiebreakMaxShowdowns) return this.tiebreakRound();
    this.endGame(tb.pair, 'shared');
  }
  endGame(winners, kind) {
    const g = this.g;
    g.winners = winners.slice(); g.winKind = kind;
    this.telemetry('game_end', { players: this.order.length, rounds: g.round, minutes: Math.round((this.now() - g.startedAt) / 60000), winners: winners.length, tiebreak: g.tb ? g.tb.count : 0 });
    this.log('game_end', { winners, points: Object.fromEntries(this.order.map(id => [id, this.points(id)])) });
    this.setPhase(PH.END, null);
  }

  // ---------- GM ----------
  pause(pid) {
    this.requireGm(pid);
    if (!this.timer || this.paused) throw new GameError('WRONG_PHASE', 'หยุดเกมตอนนี้ไม่ได้');
    const t = this.timer; clearTimeout(t.handle); this.timer = null;
    this.paused = { remaining: Math.max(0, t.endsAt - this.now()), onEnd: t.onEnd };
    this.addAudit(pid, 'pause'); this.changed();
  }
  resume2(pid) {
    this.requireGm(pid);
    if (!this.paused) throw new GameError('WRONG_PHASE', 'เกมไม่ได้หยุดอยู่');
    const p = this.paused; this.paused = null;
    this.schedule(p.remaining, p.onEnd);
    this.addAudit(pid, 'resume'); this.changed();
  }
  skip(pid) { // R-7-03
    this.requireGm(pid);
    if (this.phase !== PH.CONSPIRE && this.phase !== PH.SD_TALK) throw new GameError('WRONG_PHASE', 'ข้ามได้เฉพาะช่วงเจรจา');
    this.addAudit(pid, 'skip', PHASE_TH[this.phase]);
    this.endPhaseNow();
  }
  kick(pid, target) {
    this.requireGm(pid);
    if (this.phase !== PH.LOBBY) throw new GameError('WRONG_PHASE', 'เตะผู้เล่นได้เฉพาะใน Lobby');
    if (target === pid || !this.players.has(target)) throw new GameError('INVALID_TARGET', 'เลือกผู้เล่นไม่ถูกต้อง');
    const name = this.players.get(target).name;
    this.removePlayer(target);
    this.addAudit(pid, 'kick', name);
  }
  setUnit(pid, unitId) { // R-4.1-04 เลือกการ์ดหน่วยรบ (= สี)
    if (this.phase !== PH.LOBBY) throw new GameError('WRONG_PHASE', 'เปลี่ยนหน่วยได้เฉพาะใน Lobby');
    if (!this.cards.units.includes(unitId)) throw new GameError('INVALID_CHOICE', 'ไม่มีหน่วยนี้');
    for (const p of this.players.values()) if (p.id !== pid && p.unitId === unitId) throw new GameError('CARD_TAKEN', 'หน่วยนี้มีคนเลือกแล้ว');
    this.player(pid).unitId = unitId; this.changed();
  }

  // ---------- แชท (R-7-40 ถึง R-7-46) ----------
  chatSend(pid, text) {
    const p = this.player(pid);
    if (typeof text !== 'string') throw new GameError('CHAT_EMPTY', 'พิมพ์ข้อความก่อน');
    const t = text.replace(/[\r\n]+/g, ' ').trim();
    if (!t) throw new GameError('CHAT_EMPTY', 'พิมพ์ข้อความก่อน');
    if ([...t].length > this.cfg.chatMaxLength) throw new GameError('CHAT_TOO_LONG', `ข้อความยาวเกิน ${this.cfg.chatMaxLength} ตัวอักษร`);
    const now = this.now(), last = this.lastChatAt.get(pid) || 0;
    if (now - last < this.cfg.chatMinIntervalMs) throw new GameError('CHAT_RATE_LIMIT', 'ส่งเร็วไป รอสักครู่');
    this.lastChatAt.set(pid, now);
    const unit = this.cards.byId[p.unitId];
    const msg = { id: newId(), playerId: pid, name: p.name, color: unit ? unit.color : '#888888', text: t, at: now, phase: this.phase };
    this.chat.push(msg); while (this.chat.length > this.cfg.chatHistory) this.chat.shift();
    return msg;
  }

  // ---------- ตัวรับ action ----------
  action(pid, a) {
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') throw new GameError('BAD_REQUEST', 'คำสั่งไม่ถูกต้อง');
    this.player(pid);
    if (a.requestId != null) { // R-12-10 กันกดซ้ำ
      const rid = String(a.requestId).slice(0, 64);
      let s = this.seen.get(pid); if (!s) { s = new Set(); this.seen.set(pid, s); }
      if (s.has(rid)) return { duplicate: true };
      s.add(rid); if (s.size > 200) s.delete(s.values().next().value);
    }
    const stateless = ['chat:send', 'history:download'];
    if (!stateless.includes(a.type) && a.stateVersion != null && a.stateVersion !== this.phaseSeq) {
      throw new GameError('STALE_STATE', 'หน้าจอยังไม่อัปเดต ลองกดอีกครั้ง');
    }
    if (this.phase !== PH.LOBBY) this.log('intent', { pid, type: a.type });
    switch (a.type) {
      case 'lobby:setColor': return this.setUnit(pid, a.unitId);
      case 'lobby:start': return this.start(pid);
      case 'vote:select': return this.voteSelect(pid, a.target);
      case 'vote:lock': return this.voteLock(pid);
      case 'ambush:select': return this.ambushSelect(pid, a.victimId);
      case 'ambush:lock': return this.ambushLock(pid);
      case 'showdown:select': return this.showdownSelect(pid, a.choice);
      case 'showdown:lock': return this.showdownLock(pid);
      case 'gm:pause': return this.pause(pid);
      case 'gm:resume': return this.resume2(pid);
      case 'gm:skip': return this.skip(pid);
      case 'gm:kick': return this.kick(pid, a.playerId);
      case 'gm:takeover': return this.answerTakeover(pid, a.reqId, !!a.approve);
      case 'game:playAgain': return this.playAgain(pid);
      case 'history:download':
        if (this.phase !== PH.END) throw new GameError('WRONG_PHASE', 'ดาวน์โหลดประวัติได้เมื่อจบเกม');
        return { history: { room: this.code, players: this.order.map(id => ({ id, name: this.players.get(id).name })), events: this.events, tx: this.g ? this.g.tx : [] } };
      default: throw new GameError('BAD_REQUEST', 'ไม่รู้จักคำสั่งนี้');
    }
  }

  // ---------- state ตามสิทธิ์ (R-12-02, R-12-03) ----------
  getState(pid) {
    const me = this.players.get(pid);
    const g = this.g, ended = this.phase === PH.END;
    const showAll = ended || !this.cfg.hiddenScores;
    const players = this.order.map(id => {
      const p = this.players.get(id);
      const o = { id, name: p.name, unitId: p.unitId, connected: p.connected, gm: id === this.gmId, seat: p.seat,
        status: g ? p.status : 'alive', barCount: p.bars.length };
      if (g && (showAll || id === pid)) { o.points = this.points(id); o.bars = p.bars.map(b => g.bars[b].value); }
      return o;
    });
    const s = {
      code: this.code, me: me ? { id: me.id, name: me.name, gm: me.id === this.gmId } : null, players,
      phase: this.phase, stateVersion: this.phaseSeq,
      endsAt: this.timer ? this.timer.endsAt : null, paused: !!this.paused, remaining: this.paused ? this.paused.remaining : null,
      serverNow: this.now(), audit: this.audit.slice(-30),
      config: publicConfig(this.cfg), minPlayers: this.cfg.minPlayers, maxPlayers: this.cfg.maxPlayers,
      cardsOk: !this.cards.missing.length, cardsMissing: this.cards.missing,
    };
    if (me && me.id === this.gmId) s.requests = [...this.requests.values()].map(r => ({ reqId: r.reqId, name: r.name }));
    if (!g) return s;
    s.round = g.round; s.voteNo = g.voteNo; s.potCount = g.pot.length; s.winPoints = g.winPoints;
    s.deckCount = g.deck.length; s.history = g.history;
    if (this.phase === PH.VOTE || this.phase === PH.CONSPIRE) {
      s.eligible = g.eligible;
      s.locked = g.eligible.filter(id => (g.votes.get(id) || {}).locked); // R-7-13 เห็นแค่ใครล็อก
      const mv = g.votes.get(pid);
      s.myVote = mv ? { choice: mv.choice, locked: mv.locked } : null;
    }
    if (g.vr && (this.phase === PH.AMBUSH_PICK || this.phase === PH.RESULT)) {
      const vr = g.vr;
      s.vote = { choices: vr.choices, tally: vr.tally, targets: vr.targets, e1: vr.e1, final: vr.final,
        ambush: vr.ambush.map(a => ({ ambusher: a.ambusher, candidates: a.candidates, locked: a.locked, auto: a.auto,
          pick: vr.final || a.auto || a.ambusher === pid ? a.pick : null })) };
      if (vr.final) { s.vote.eliminated = vr.eliminated; s.vote.reasons = vr.reasons; s.vote.survivors = vr.survivors; }
    }
    if (this.phase === PH.ROUND_END) s.roundEnd = g.roundEnd;
    if (g.sd && [PH.SD_TALK, PH.SD_PICK, PH.SD_RESULT].includes(this.phase)) {
      const sd = g.sd;
      s.showdown = { type: sd.type, a: sd.a, b: sd.b, locked: [sd.a, sd.b].filter(x => sd.locked[x]),
        myChoice: (pid === sd.a || pid === sd.b) ? (sd.choice[pid] || null) : null,
        tiebreak: g.tb ? { count: g.tb.count, max: this.cfg.tiebreakMaxShowdowns } : null,
        potCount: sd.type === 'NORMAL' ? g.pot.length : this.cfg.potSize };
      if (this.phase === PH.SD_RESULT) s.showdown.result = sd.result;
    }
    if (ended) { s.winners = g.winners; s.winKind = g.winKind; }
    return s;
  }
}

function publicConfig(c) {
  const keys = ['conspireSecondsFirst', 'conspireSecondsNext', 'voteSeconds', 'ambushPickSeconds', 'showdownTalkSeconds', 'showdownPickSeconds',
    'voteResultSeconds', 'roundEndSeconds', 'showdownResultSeconds', 'timerWarnSeconds',
    'minPlayers', 'maxPlayers', 'winPointsByPlayers', 'tiebreakMaxShowdowns',
    'deckCount3', 'deckCount4', 'deckCount5', 'potSize', 'compensationBars', 'chatMaxLength',
    'zeroSurvivorCompensation', 'hiddenScores', 'showdownTimeoutChoice', 'ambushTimeoutPick'];
  const o = {}; for (const k of keys) o[k] = c[k]; return o;
}

const PHASE_TH = { LOBBY: 'Lobby', CONSPIRE: 'ช่วงเจรจา', VOTE: 'ช่วงโหวต', AMBUSH_PICK: 'ซุ่มโจมตีเลือกคน', RESULT: 'ผลโหวต',
  ROUND_END: 'จบรอบ', SHOWDOWN_TALK: 'เจรจาก่อนดวล', SHOWDOWN_PICK: 'ดวลสุดท้าย', SHOWDOWN_RESULT: 'ผลการดวล', GAME_END: 'จบเกม' };
const AUDIT_TEXT = { start: 'เริ่มเกม', pause: 'หยุดเกมชั่วคราว', resume: 'เล่นต่อ', skip: 'ข้าม', kick: 'เตะ', play_again: 'เริ่มเกมใหม่',
  gm_handover: 'ได้สิทธิ์ GM', approve_device: 'อนุมัติเปลี่ยนเครื่องของ', deny_device: 'ปฏิเสธเปลี่ยนเครื่องของ' };

module.exports = { Room, GameError, PH, showdownOutcome, publicConfig, REQUIRED_CARDS, PHASE_TH };
