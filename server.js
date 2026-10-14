'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Room, GameError, publicConfig } = require('./game');
const settings = require('./server/settings');
const { loadCards } = require('./server/cards');

const CFG = settings.load();
const CARDS_DIR = path.join(__dirname, 'cards');
const CARDS = loadCards(CARDS_DIR);
for (const e of CARDS.errors) console.error('[cards] ' + e);
for (const w of CARDS.warnings) console.warn('[cards] ' + w);
console.log(JSON.stringify({ tel: 'cards_loaded', count: CARDS.cards.length, missing: CARDS.missing, missingArt: CARDS.artMissing, version: CARDS.version }));

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();
const sockRoom = new Map();     // socket.id -> { code, pid }
const pendingJoin = new Map();  // reqId -> { socketId, code }

app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/api/cards', (req, res) => res.json({ version: CARDS.version, templates: CARDS.templates, cards: CARDS.cards,
  missing: CARDS.missing, artMissing: CARDS.artMissing, frames: CARDS.frames, hasBack: CARDS.hasBack, errors: CARDS.errors }));
app.get('/api/config', (req, res) => res.json(publicConfig(CFG)));
app.get('/preview', (req, res) => res.sendFile(path.join(__dirname, 'public', 'preview.html')));
app.use('/cards', express.static(CARDS_DIR, { maxAge: '30d', index: false }));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- ห้อง ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ไม่มี O และ I (R-5-01)
function newCode() {
  for (let i = 0; i < 1000; i++) {
    let c = ''; for (let j = 0; j < 4; j++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new GameError('SERVER_BUSY', 'สร้างห้องไม่ได้ ลองใหม่อีกครั้ง');
}
const pending = new Set();
function scheduleBroadcast(room) {
  if (pending.has(room)) return;
  pending.add(room);
  setImmediate(() => {
    pending.delete(room);
    try {
      for (const [sid, info] of sockRoom) {
        if (info.code !== room.code) continue;
        const s = io.sockets.sockets.get(sid);
        if (s) s.emit('state', room.getState(info.pid));
      }
    } catch (e) { console.error('broadcast error', e); }
  });
}
function createRoom() {
  const code = newCode();
  const room = new Room(code, { config: CFG, cards: CARDS, onChange: scheduleBroadcast,
    onNotice: (r, text) => io.to('room:' + r.code).emit('notice', { kind: 'GM_ACTION', text }) });
  rooms.set(code, room);
  return room;
}
function getRoom(code) {
  const room = rooms.get(String(code || '').trim().toUpperCase());
  if (!room) throw new GameError('ROOM_NOT_FOUND', 'ไม่พบห้องนี้');
  return room;
}
function attach(socket, room, pid) {
  detach(socket);
  sockRoom.set(socket.id, { code: room.code, pid });
  socket.join('room:' + room.code);
  room.setConnected(pid, true);
  socket.emit('chatHistory', { messages: room.chat });
  scheduleBroadcast(room);
}
function socketsOf(code, pid) { return [...sockRoom].filter(([, i]) => i.code === code && i.pid === pid).map(([sid]) => sid); }
function detach(socket) {
  const info = sockRoom.get(socket.id);
  if (!info) return;
  sockRoom.delete(socket.id);
  socket.leave('room:' + info.code);
  const room = rooms.get(info.code);
  if (room && room.players.has(info.pid) && socketsOf(info.code, info.pid).length === 0) room.setConnected(info.pid, false);
}
function safe(ack, fn) {
  const reply = typeof ack === 'function' ? ack : () => {};
  try { reply({ ok: true, ...(fn() || {}) }); }
  catch (e) {
    if (e instanceof GameError) reply({ ok: false, code: e.code, error: e.message, ...(e.extra || {}) });
    else { console.error(e); reply({ ok: false, code: 'SERVER_ERROR', error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง' }); }
  }
}
const obj = (x) => (x && typeof x === 'object' ? x : {});

io.on('connection', (socket) => {
  socket.on('create', (p, ack) => safe(ack, () => {
    p = obj(p);
    const room = createRoom();
    try {
      const pl = room.addPlayer(p.name);
      attach(socket, room, pl.id);
      return { code: room.code, playerId: pl.id, token: pl.token };
    } catch (e) { rooms.delete(room.code); throw e; }
  }));

  socket.on('join', (p, ack) => safe(ack, () => {
    p = obj(p);
    const room = getRoom(p.code);
    if (room.phase !== 'LOBBY') { // Q7 เข้าด้วยชื่อเดิมกลางเกม → รอ GM อนุมัติ
      const reqId = room.requestTakeover(p.name);
      pendingJoin.set(reqId, { socketId: socket.id, code: room.code });
      return { pending: true, reqId, code: room.code };
    }
    const pl = room.addPlayer(p.name);
    attach(socket, room, pl.id);
    return { code: room.code, playerId: pl.id, token: pl.token };
  }));

  socket.on('cancelJoin', (p, ack) => safe(ack, () => {
    p = obj(p);
    const r = pendingJoin.get(p.reqId);
    if (r && r.socketId === socket.id) { pendingJoin.delete(p.reqId); const room = rooms.get(r.code); if (room) room.cancelRequest(p.reqId); }
  }));

  socket.on('resume', (p, ack) => safe(ack, () => {
    p = obj(p);
    const room = getRoom(p.code);
    const pl = room.resume(p.playerId, p.token);
    attach(socket, room, pl.id);
    return { code: room.code, playerId: pl.id };
  }));

  socket.on('leave', (p, ack) => safe(ack, () => {
    const info = sockRoom.get(socket.id);
    if (!info) return;
    const room = rooms.get(info.code);
    detach(socket);
    if (room && room.phase === 'LOBBY') room.removePlayer(info.pid);
  }));

  socket.on('action', (a, ack) => safe(ack, () => {
    const info = sockRoom.get(socket.id);
    if (!info) throw new GameError('NOT_IN_ROOM', 'คุณยังไม่ได้อยู่ในห้อง');
    const room = getRoom(info.code);
    a = obj(a);
    if (a.type === 'chat:send') { // R-7-40 ถึง R-7-43
      const msg = room.chatSend(info.pid, a.text);
      io.to('room:' + room.code).emit('chat', msg);
      return {};
    }
    const res = room.action(info.pid, a);
    if (a.type === 'gm:kick') {
      for (const sid of socketsOf(room.code, a.playerId)) {
        const s = io.sockets.sockets.get(sid);
        sockRoom.delete(sid);
        if (s) { s.leave('room:' + room.code); s.emit('kicked', { text: 'GM นำคุณออกจากห้อง' }); }
      }
    }
    if (a.type === 'gm:takeover' && res) {
      const pj = pendingJoin.get(a.reqId); pendingJoin.delete(a.reqId);
      const req = pj && io.sockets.sockets.get(pj.socketId);
      if (res.approve) {
        for (const sid of socketsOf(room.code, res.pid)) { // ตัดเครื่องเก่า
          const s = io.sockets.sockets.get(sid);
          sockRoom.delete(sid);
          if (s) { s.leave('room:' + room.code); s.emit('kicked', { text: 'มีการเข้าที่นั่งนี้จากเครื่องอื่น' }); }
        }
        if (req) { req.emit('takeover', { code: room.code, playerId: res.pid, token: res.token }); attach(req, room, res.pid); }
      } else if (req) req.emit('takeover', { denied: true });
      return {};
    }
    return res && res.history ? { history: res.history } : {};
  }));

  socket.on('disconnect', () => {
    for (const [reqId, r] of pendingJoin) if (r.socketId === socket.id) {
      pendingJoin.delete(reqId); const room = rooms.get(r.code); if (room) room.cancelRequest(reqId);
    }
    detach(socket);
  });
});

// งานเบื้องหลัง: ย้าย GM, ล้าง Lobby, ลบห้องร้าง (R-12-08, R-12-09)
setInterval(() => {
  for (const room of [...rooms.values()]) {
    try {
      room.tick();
      if (room.isIdle()) { room.clearTimer(); rooms.delete(room.code); console.log(`ลบห้อง ${room.code} (ไม่มีใครออนไลน์)`); }
    } catch (e) { console.error('tick error', room.code, e); }
  }
}, 2000).unref();

process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Dead Last พร้อมที่ http://localhost:${PORT} (การ์ด ${CARDS.cards.length} ใบ, เวอร์ชัน ${CARDS.version})`));
