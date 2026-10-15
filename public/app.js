// หน้าเว็บ Dead Last: state เดียว (S) + render() ใหม่ทั้งหน้าเมื่อมีอะไรเปลี่ยน
// ทุกข้อความจากผู้เล่นผ่าน esc() ก่อนใส่ลง HTML
(function () {
  'use strict';
  const socket = io();
  const SKEY = 'deadlast.session';
  const $ = (q, el) => (el || document).querySelector(q);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);

  const S = {
    st: null, cat: null, byId: {}, cfg: null, pending: null, modal: null,
    chat: [], unread: 0, chatOpen: false, offset: 0, connected: false, seq: -1,
    form: { name: '', code: (params.get('room') || '').toUpperCase().slice(0, 4) },
  };

  const PHASE_TH = { LOBBY: 'Lobby', CONSPIRE: 'เจรจา', VOTE: 'โหวต', AMBUSH_PICK: 'DEFENSE!', RESULT: 'ผลโหวต',
    ROUND_END: 'จบรอบ', SHOWDOWN_TALK: 'เจรจาก่อนดวล', SHOWDOWN_PICK: 'ดวลสุดท้าย', SHOWDOWN_RESULT: 'ผลการดวล', GAME_END: 'จบเกม' };
  const REASON = { target: 'ได้โหวตมากที่สุด', ambushed: 'โดน DEFENSE สวนกลับ', ambush_miss: 'ใช้ DEFENSE แต่ไม่ได้เป็นเป้าหมาย', no_vote: 'ไม่ได้โหวต', wrong_vote: 'โหวตคนที่ไม่ใช่เป้าหมาย' };
  const SD_ID = { SHARE: 'share', STEAL: 'steal', GRAB: 'grab' };
  const SD_NAME = { SHARE: 'SHARE', STEAL: 'STEAL', GRAB: 'GRAB ONE & GO' };

  // ---------- session (localStorage อาจใช้ไม่ได้ในบางเบราว์เซอร์) ----------
  function loadSession() { try { const v = JSON.parse(localStorage.getItem(SKEY)); return v && v.code && v.playerId && v.token ? v : null; } catch (e) { return null; } }
  function saveSession(v) { try { localStorage.setItem(SKEY, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function clearSession() { try { localStorage.removeItem(SKEY); } catch (e) { /* ignore */ } }

  // ---------- แจ้งเตือน ----------
  let toastT = null;
  function toast(text, info) {
    const el = $('#toast'); el.textContent = text; el.className = 'toast' + (info ? ' info' : '');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  // ---------- ส่งคำสั่ง ----------
  const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  function act(type, extra) {
    return new Promise((resolve) => {
      const a = Object.assign({ type, requestId: rid() }, extra || {});
      if (S.st && type !== 'chat:send' && type !== 'history:download') a.stateVersion = S.st.stateVersion;
      socket.emit('action', a, (r) => {
        if (!r || !r.ok) toast((r && r.error) || 'ทำรายการไม่สำเร็จ');
        resolve(r || { ok: false });
      });
    });
  }

  // ---------- การ์ด ----------
  const cardCache = new Map();
  function unitCard(p) { const c = p && S.byId[p.unitId]; return c ? Object.assign({}, c, { player_name: p.name }) : null; }
  function slot(id, opts) {
    opts = opts || {};
    return `<div class="cardslot" data-cid="${esc(id)}" data-pn="${esc(opts.pn || '')}" data-mode="${opts.mode || 'thumb'}"></div>`;
  }
  function fillCards(scope) {
    scope.querySelectorAll('.cardslot').forEach((el) => {
      const id = el.dataset.cid, pn = el.dataset.pn, mode = el.dataset.mode;
      const base = S.byId[id];
      const key = id + '|' + pn + '|' + mode;
      let node = cardCache.get(key);
      if (!node || node.isConnected) {
        node = CardKit.render(base ? Object.assign({}, base, pn ? { player_name: pn } : {}) : { id, name: id }, { mode });
        if (!cardCache.has(key) || cardCache.get(key).isConnected === false) cardCache.set(key, node);
      }
      el.appendChild(node);
    });
    CardKit.fitAll(scope);
  }

  // ---------- ตัวช่วยข้อมูล ----------
  const P = (id) => (S.st ? S.st.players.find((p) => p.id === id) : null);
  const pname = (id) => { const p = P(id); return p ? p.name : '?'; };
  const pcolor = (id) => { const p = P(id); const c = p && S.byId[p.unitId]; return c ? c.color : '#777'; };
  const dot = (id) => `<span class="dot" style="background:${esc(pcolor(id))}"></span>`;
  const meId = () => (S.st && S.st.me ? S.st.me.id : null);
  const isGm = () => !!(S.st && S.st.me && S.st.me.gm);
  const cfg = () => (S.st ? S.st.config : S.cfg) || {};
  const shareLink = (code) => `${location.origin}/?room=${code}`;

  // ---------- หน้าจอ ----------
  function viewHome() {
    const hasRoom = !!S.form.code;
    return `
<div class="title"><h1>DEAD LAST</h1><p>สมรภูมิล่าทอง</p></div>
<div class="hazard"></div>
<div class="panel">
  <label class="lbl" for="in-name">ชื่อของคุณ</label>
  <input id="in-name" class="field" maxlength="16" autocomplete="nickname" value="${esc(S.form.name)}" placeholder="เช่น ต้น">
  <label class="lbl" for="in-code">รหัสห้อง (ถ้าจะเข้าห้องเพื่อน)</label>
  <input id="in-code" class="field" maxlength="4" autocapitalize="characters" value="${esc(S.form.code)}" placeholder="ABCD" style="text-transform:uppercase;letter-spacing:4px">
  <div class="stack" style="margin-top:14px">
    <button class="btn block ${hasRoom ? 'gold' : ''}" data-act="join">เข้าห้อง</button>
    <button class="btn block ${hasRoom ? '' : 'gold'}" data-act="create">สร้างห้องใหม่</button>
  </div>
</div>
<p class="center"><button class="btn ghost" data-act="rules">📖 วิธีเล่น</button></p>`;
  }
  function viewPending() {
    return `<div class="title"><h1>DEAD LAST</h1></div><div class="panel center stack">
<p class="big">รอ GM อนุมัติ…</p><p class="muted">เกมในห้อง ${esc(S.pending.code)} เริ่มไปแล้ว ถ้าคุณเป็นผู้เล่นเดิมที่เปลี่ยนเครื่อง GM จะกดอนุมัติให้</p>
<button class="btn block" data-act="cancel-join">ยกเลิก</button></div>`;
  }

  function viewLobby() {
    const st = S.st, me = meId(), c = cfg();
    const n = st.players.length;
    const taken = {}; st.players.forEach((p) => { if (p.unitId) taken[p.unitId] = p; });
    const mine = P(me);
    const units = (S.cat ? S.cat.cards : []).filter((x) => x.template === 'unit');
    const canStart = n >= st.minPlayers && st.cardsOk;
    return `
<div class="row"><h2 class="grow">ห้อง <span class="goldtxt" style="letter-spacing:4px">${esc(st.code)}</span></h2>
  <button class="help-btn" data-act="help" aria-label="ช่วยเหลือ">?</button></div>
<div class="row wrap"><button class="btn sm" data-act="copy">🔗 คัดลอกลิงก์ห้อง</button><button class="btn sm ghost" data-act="rules">📖 วิธีเล่น</button></div>
<div class="hazard"></div>
<div class="panel">
  <div class="row"><b class="grow">ผู้เล่น ${n} / ${st.maxPlayers}</b><span class="muted small">ต้องมีอย่างน้อย ${st.minPlayers} คน</span></div>
  <ul class="plist">${st.players.map((p) => `<li>${dot(p.id)}<span class="grow">${esc(p.name)}${p.id === me ? ' (คุณ)' : ''}
    ${p.gm ? '<span class="chip"><span class="tag">GM</span></span>' : ''}${p.connected ? '' : ' <span class="muted small">หลุด</span>'}</span>
    ${isGm() && p.id !== me ? `<button class="btn sm ghost" data-act="kick" data-id="${esc(p.id)}">เตะ</button>` : ''}</li>`).join('')}</ul>
</div>
${mine && mine.unitId ? `<h3 class="center">การ์ดหน่วยรบของคุณ</h3><div class="mycard">${slot(mine.unitId, { pn: mine.name, mode: 'full' })}</div>` : ''}
<h3>เลือกหน่วยรบ (สี)</h3>
<div class="grid3">${units.map((u) => {
    const t = taken[u.id]; const isMine = t && t.id === me;
    return `<button class="pick ${isMine ? 'mine' : t ? 'taken' : ''}" data-act="color" data-id="${esc(u.id)}" ${t && !isMine ? 'disabled' : ''}>
      ${slot(u.id, { pn: t ? t.name : '', mode: 'thumb' })}<div class="cap">${esc(u.name)}</div></button>`;
  }).join('')}</div>
${st.cardsOk ? '' : `<p class="err">ขาดการ์ด: ${esc(st.cardsMissing.join(', '))} — เพิ่มใน cards/data.csv ก่อนเริ่มเกม</p>`}
<div class="stack foot">
${isGm() ? `<button class="btn block gold" data-act="start" ${canStart ? '' : 'disabled'}>เริ่มเกม</button>
  ${n < st.minPlayers ? `<p class="muted small center">รออีก ${st.minPlayers - n} คน</p>` : ''}` : '<p class="muted center">รอ GM เริ่มเกม…</p>'}
<button class="btn block ghost" data-act="leave">ออกจากห้อง</button>
</div>
<p class="muted small center">เวลาเจรจา ${c.conspireSecondsFirst} วิ · โหวต ${c.voteSeconds} วิ · เป้าหมาย ${c.winPointsByPlayers ? c.winPointsByPlayers[Math.max(2, Math.min(12, n))] : '-'} แต้ม (${n} คน)</p>`;
  }

  function hud() {
    const st = S.st, me = P(meId());
    const ph = st.phase;
    const tools = [];
    if (isGm() && ph !== 'GAME_END') {
      if (st.paused) tools.push('<button class="btn sm gold" data-act="resume">▶ เล่นต่อ</button>');
      else if (st.endsAt) tools.push('<button class="btn sm" data-act="pause">⏸ หยุด</button>');
      if (st.endsAt || st.paused) tools.push('<button class="btn sm" data-act="skip">⏭ ข้าม</button>');
    }
    const reqs = (st.requests || []).map((r) => `<div class="notice row"><span class="grow">${esc(r.name)} ขอเข้าเล่นจากเครื่องใหม่</span>
      <button class="btn sm gold" data-act="approve" data-id="${esc(r.reqId)}">อนุมัติ</button><button class="btn sm" data-act="deny" data-id="${esc(r.reqId)}">ไม่</button></div>`).join('');
    return `<div class="hud">
  <div class="row"><span class="phase grow">${esc(PHASE_TH[ph] || ph)}</span><button class="help-btn" data-act="help" aria-label="ช่วยเหลือ">?</button></div>
  <div id="led" class="led">--:--</div>
  <div class="meta">รอบ ${st.round || '-'}${st.voteNo ? ` · โหวตครั้งที่ ${st.voteNo}` : ''} · กลางวง <span class="goldtxt">${st.potCount} แท่ง</span>
    · เป้า ${st.winPoints} แต้ม${me && me.points != null ? ` · คุณ <b class="goldtxt">${me.points}</b>` : ''}</div>
</div>
${tools.length ? `<div class="hud-tools">${tools.join('')}</div>` : ''}${reqs}`;
  }

  // สถานะการเลือกของแต่ละคน (ไม่บอกว่าเลือกอะไร): 'done' ยืนยันแล้ว, 'chosen' เลือกแล้วยังไม่ยืนยัน, 'wait' ยังไม่เลือก
  function pickStatus() {
    const st = S.st, m = {};
    if (st.phase === 'VOTE') {
      const lk = new Set(st.locked || []), ch = new Set(st.chosen || []);
      for (const id of st.eligible || []) m[id] = lk.has(id) ? 'done' : ch.has(id) ? 'chosen' : 'wait';
    } else if (st.phase === 'AMBUSH_PICK' && st.vote) {
      for (const a of st.vote.ambush) if (!a.auto) m[a.ambusher] = a.locked ? 'done' : a.chosen ? 'chosen' : 'wait';
    } else if (st.phase === 'SHOWDOWN_PICK' && st.showdown) {
      const sd = st.showdown;
      for (const id of [sd.a, sd.b]) m[id] = sd.locked.includes(id) ? 'done' : sd.chosen.includes(id) ? 'chosen' : 'wait';
    }
    return m;
  }
  const STATUS_MARK = { done: '<span class="ok" title="ยืนยันแล้ว">✔</span>', chosen: '<span class="chosen" title="เลือกแล้ว ยังไม่ยืนยัน">●</span>', wait: '<span class="muted" title="ยังไม่เลือก">…</span>' };
  function chips() {
    const st = S.st, ps = pickStatus(), any = Object.keys(ps).length;
    return `<div class="players">${st.players.map((p) => `<span class="chip ${p.status === 'out' ? 'out' : ''} ${p.connected ? '' : 'off'}">${dot(p.id)}
      ${esc(p.name)}${p.gm ? '<span class="tag">GM</span>' : ''}<span class="bars">${p.barCount}▮</span>${ps[p.id] ? STATUS_MARK[ps[p.id]] : ''}</span>`).join('')}</div>
${any ? '<p class="legend small muted"><span class="ok">✔</span> ยืนยันแล้ว · <span class="chosen">●</span> เลือกแล้ว ยังไม่ยืนยัน · … ยังไม่เลือก</p>' : ''}`;
  }
  const UNCONFIRMED = '<p class="hint small">ยังไม่กดยืนยัน — ถ้าหมดเวลา ระบบจะใช้ใบที่เลือกไว้</p>';

  function myHand() {
    const me = P(meId());
    if (!me) return '';
    const bars = (me.bars || []).slice().sort((a, b) => a - b);
    return `<div class="panel foot"><div class="row"><b class="grow">ทองของคุณ</b><span class="goldtxt big">${me.points != null ? me.points : 0} แต้ม</span></div>
<div class="hand" style="margin-top:8px">${bars.length ? bars.map((v) => slot('gold-' + v, { mode: 'thumb' })).join('') : '<span class="muted small">ยังไม่มีทอง</span>'}</div></div>`;
  }

  function voteTable(vr) {
    const ids = Object.keys(vr.choices);
    const out = new Set(vr.eliminated || []);
    const tg = new Set(vr.targets);
    return `<table class="res">${ids.map((id) => {
      const c = vr.choices[id];
      const what = c === 'AMBUSH' ? '<b class="defense">DEFENSE</b>' : c === 'NONE' ? '<span class="muted">ไม่ได้โหวต</span>' : `→ ${dot(c)}${esc(pname(c))}`;
      const fate = vr.final ? (out.has(id) ? `<div class="why">ตกรอบ: ${esc(REASON[vr.reasons[id]] || '')}</div>` : '<div class="surv">รอด</div>') : '';
      return `<tr class="${out.has(id) ? 'out' : ''}"><td>${dot(id)}${esc(pname(id))}${tg.has(id) ? '<span class="badge-t">เป้าหมาย</span>' : ''}${fate}</td>
        <td>${what}</td><td class="goldtxt" style="text-align:right">${vr.tally[id] || 0} โหวต</td></tr>`;
    }).join('')}</table>`;
  }

  function bodyConspire() {
    const st = S.st, alive = st.eligible || [];
    const amIn = alive.includes(meId());
    return `<div class="panel stack"><p class="big">${amIn ? 'คุยกันในแชท ตกลงว่าจะโหวตใคร' : 'คุณตกรอบในรอบนี้แล้ว ดูและแชทได้'}</p>
<p class="muted">ยังรอด ${alive.length} คน: ${alive.map((id) => dot(id) + esc(pname(id))).join(' ')}</p>
<button class="btn block" data-act="open-chat">💬 เปิดแชท</button></div>`;
  }

  function bodyVote() {
    const st = S.st, me = meId(), elig = st.eligible || [];
    const done = `ยืนยันแล้ว ${(st.locked || []).length} / ${elig.length} คน`;
    if (!elig.includes(me)) return `<div class="panel"><p class="big">กำลังโหวต</p><p class="muted">${done}</p></div>`;
    const mv = st.myVote;
    const label = (c) => (c === 'AMBUSH' ? '<b class="defense">DEFENSE</b>' : esc(pname(c)));
    if (mv && mv.locked) return `<div class="panel center stack"><p class="big">ยืนยันแล้ว ✔</p><p>คุณเลือก ${label(mv.choice)}</p>
<p class="muted">รอคนอื่น · ${done}</p></div>`;
    const sel = mv ? mv.choice : null;
    const others = elig.filter((id) => id !== me);
    // DEFENSE อยู่แถวบนสุดแยกต่างหาก การ์ดตัวละครเรียงด้านล่าง
    return `<p class="muted center small">แตะการ์ดเพื่อดูเต็มใบ แล้วกด "เลือกใบนี้"</p>
<div class="grid3 defense-row"><button class="pick ${sel === 'AMBUSH' ? 'sel' : ''}" data-act="view" data-kind="vote" data-id="AMBUSH">${slot('defense')}<div class="cap">DEFENSE</div>${sel === 'AMBUSH' ? '<span class="mark">เลือก</span>' : ''}</button></div>
<p class="divider small muted">หรือโหวตกำจัด</p>
<div class="grid3">${others.map((id) => { const p = P(id); return `<button class="pick ${sel === id ? 'sel' : ''}" data-act="view" data-kind="vote" data-id="${esc(id)}">
  ${slot(p.unitId, { pn: p.name })}<div class="cap">${esc(p.name)}</div>${sel === id ? '<span class="mark">เลือก</span>' : ''}</button>`; }).join('')}
</div>
<div class="stack foot"><p class="center">${sel ? `เลือก: ${label(sel)}` : '<span class="muted">ยังไม่ได้เลือก</span>'}</p>
<button class="btn block gold" data-act="vote-lock" ${sel ? '' : 'disabled'}>✅ ยืนยัน</button>
${sel ? UNCONFIRMED : ''}
<p class="muted small center">${done}</p></div>`;
  }

  function bodyAmbush() {
    const vr = S.st.vote, me = meId();
    const mine = vr.ambush.find((a) => a.ambusher === me && !a.auto && a.candidates.length > 1);
    let top = '';
    if (mine && !mine.locked) {
      top = `<div class="panel stack"><p class="big defense">DEFENSE สำเร็จ! เลือกกำจัดคนที่โหวตคุณ 1 คน</p>
<div class="grid3">${mine.candidates.map((id) => { const p = P(id); return `<button class="pick ${mine.pick === id ? 'sel' : ''}" data-act="view" data-kind="ambush" data-id="${esc(id)}">
  ${slot(p.unitId, { pn: p.name })}<div class="cap">${esc(p.name)}</div></button>`; }).join('')}</div>
<button class="btn block gold" data-act="ambush-lock" ${mine.pick ? '' : 'disabled'}>✅ ยืนยันกำจัด ${mine.pick ? esc(pname(mine.pick)) : ''}</button>${mine.pick ? UNCONFIRMED : ''}</div>`;
    } else {
      const waiting = vr.ambush.filter((a) => !a.locked).map((a) => esc(pname(a.ambusher)));
      top = `<div class="notice">${waiting.length ? `รอ ${waiting.join(', ')} (DEFENSE) เลือกคนที่จะกำจัด` : 'เลือกครบแล้ว'}</div>`;
    }
    return top + `<div class="panel foot">${voteTable(vr)}</div>`;
  }

  function bodyResult() {
    const vr = S.st.vote;
    const picks = vr.ambush.filter((a) => a.pick).map((a) => `<div class="notice">${dot(a.ambusher)}${esc(pname(a.ambusher))} ใช้ DEFENSE สวนกลับ กำจัด ${dot(a.pick)}${esc(pname(a.pick))}</div>`).join('');
    const s = (vr.survivors || []).length;
    const next = s >= 3 ? `เหลือ ${s} คน โหวตต่อ` : s === 2 ? 'เหลือ 2 คน ไปดวลสุดท้าย!' : s === 1 ? 'เหลือคนเดียว ได้ทองกลางวงทั้งหมด!' : 'ไม่มีใครรอดเลย';
    return `${picks}<div class="panel">${voteTable(vr)}</div><p class="center big goldtxt">${next}</p>`;
  }

  function bodyRoundEnd() {
    const re = S.st.roundEnd; if (!re) return '';
    if (re.outcome === 'ONE') {
      const it = re.items[0];
      return `<div class="panel center stack"><p class="big">${dot(it.pid)}${esc(pname(it.pid))} รอดคนเดียว!</p><p class="goldtxt big">ได้ทอง ${it.count} แท่ง</p></div>`;
    }
    return `<div class="panel stack"><p class="big center">ไม่มีผู้รอด</p><p class="center">ทอง ${re.carried} แท่งค้างไว้กลางวงรอบหน้า</p>
${re.items.length ? `<p class="muted">ทองปลอบใจ:</p><ul class="plist">${re.items.map((i) => `<li>${dot(i.pid)}<span class="grow">${esc(pname(i.pid))}</span><span class="goldtxt">+${i.count} แท่ง</span></li>`).join('')}</ul>` : ''}</div>`;
  }

  function duelHead() {
    const sd = S.st.showdown, pa = P(sd.a), pb = P(sd.b);
    const tb = sd.type === 'TIEBREAK' && sd.tiebreak ? `<div class="notice center">ดวลตัดสินผู้ชนะ ครั้งที่ ${sd.tiebreak.count} / ${sd.tiebreak.max} (ไม่มีทองปลอบใจ)</div>` : '';
    const ps = pickStatus(), TXT = { done: 'ยืนยันแล้ว ✔', chosen: 'เลือกแล้ว ยังไม่ยืนยัน', wait: 'กำลังเลือก…' }, CLS = { done: 'alive', chosen: 'chosen', wait: 'muted' };
    const side = (p) => `<div><div class="card">${slot(p.unitId, { pn: p.name })}</div><div class="who">${esc(p.name)}</div>
      ${ps[p.id] ? `<div class="small ${CLS[ps[p.id]]}">${TXT[ps[p.id]]}</div>` : ''}</div>`;
    return `${tb}<div class="panel"><div class="duel">${side(pa)}<div class="vs">VS</div>${side(pb)}</div>
${S.st.phase === 'SHOWDOWN_RESULT' ? '' : `<p class="center">เดิมพัน <b class="goldtxt">${sd.potCount} แท่ง</b></p>`}</div>`;
  }

  function bodyShowdown() {
    const st = S.st, sd = st.showdown, me = meId();
    const duelist = me === sd.a || me === sd.b;
    let body = '';
    if (st.phase === 'SHOWDOWN_TALK') {
      body = `<div class="panel stack center"><p>${duelist ? 'คุยกับคู่ดวลในแชทได้ แล้วจะเข้าช่วงเลือกไพ่' : 'ดูและแชทเชียร์ได้'}</p><button class="btn block" data-act="open-chat">💬 เปิดแชท</button></div>`;
    } else if (st.phase === 'SHOWDOWN_PICK') {
      if (!duelist) body = '<p class="center muted">รอทั้งสองคนเลือกไพ่…</p>';
      else if (sd.locked.includes(me)) body = `<div class="panel center"><p class="big">ยืนยันแล้ว ✔</p><p>คุณเลือก <b>${esc(SD_NAME[sd.myChoice] || '')}</b> รออีกฝ่าย…</p></div>`;
      else {
        const sel = sd.myChoice;
        body = `<p class="muted center small">แตะการ์ดเพื่อดูเต็มใบ แล้วกด "เลือกใบนี้"</p><div class="grid3">${['SHARE', 'STEAL', 'GRAB'].map((ch) => `<button class="pick ${sel === ch ? 'sel' : ''}" data-act="view" data-kind="sd" data-id="${ch}">
  ${slot(SD_ID[ch])}<div class="cap">${SD_NAME[ch]}</div>${sel === ch ? '<span class="mark">เลือก</span>' : ''}</button>`).join('')}</div>
<button class="btn block gold foot" data-act="sd-lock" ${sel ? '' : 'disabled'}>✅ ยืนยัน${sel ? ' ' + SD_NAME[sel] : ''}</button>${sel ? UNCONFIRMED : ''}`;
      }
    } else if (sd.result) {
      const r = sd.result;
      const to = (n) => (n ? `<span class="goldtxt big">+${n} แท่ง</span>` : '<span class="muted">ไม่ได้</span>');
      const side = (id, ch, n) => `<div><div class="card">${slot(SD_ID[ch])}</div><div class="who">${esc(pname(id))}</div><div>${to(n)}</div>
        ${(r.byTimeout || []).includes(id) ? '<div class="small muted">หมดเวลา ระบบเลือกให้</div>' : ''}</div>`;
      body = `<div class="panel"><div class="duel">${side(sd.a, r.choiceA, r.toA)}<div class="vs">VS</div>${side(sd.b, r.choiceB, r.toB)}</div>
${r.left ? `<p class="center">ทอง ${r.left} แท่งค้างไว้รอบหน้า</p>` : ''}
${r.comp && r.comp.length ? `<p class="muted">ทองปลอบใจ:</p><ul class="plist">${r.comp.map((i) => `<li>${dot(i.pid)}<span class="grow">${esc(pname(i.pid))}</span><span class="goldtxt">+${i.count}</span></li>`).join('')}</ul>` : ''}</div>`;
    }
    return duelHead() + body;
  }

  function bodyEnd() {
    const st = S.st, win = new Set(st.winners || []);
    const rows = st.players.slice().sort((a, b) => (b.points || 0) - (a.points || 0));
    return `<div class="panel center stack"><p class="muted">${st.winKind === 'shared' ? 'ชนะร่วม' : 'ผู้ชนะ'}</p>
<p class="big goldtxt">🏆 ${[...win].map((id) => esc(pname(id))).join(' & ')}</p></div>
<div class="panel foot"><table class="res">${rows.map((p) => `<tr><td>${dot(p.id)}${esc(p.name)}${win.has(p.id) ? ' 🏆' : ''}</td>
  <td class="small muted">${(p.bars || []).join(' + ')}</td><td class="goldtxt" style="text-align:right"><b>${p.points || 0}</b></td></tr>`).join('')}</table></div>
<div class="stack foot"><button class="btn block" data-act="history">⬇ ดาวน์โหลดประวัติเกม</button>
${isGm() ? '<button class="btn block gold" data-act="again">เล่นอีกครั้ง</button>' : '<p class="muted center">รอ GM เริ่มเกมใหม่</p>'}</div>`;
  }

  function viewGame() {
    const ph = S.st.phase;
    let body = '';
    if (ph === 'CONSPIRE') body = bodyConspire();
    else if (ph === 'VOTE') body = bodyVote();
    else if (ph === 'AMBUSH_PICK') body = bodyAmbush();
    else if (ph === 'RESULT') body = bodyResult();
    else if (ph === 'ROUND_END') body = bodyRoundEnd();
    else if (ph.startsWith('SHOWDOWN')) body = S.st.showdown ? bodyShowdown() : '';
    else if (ph === 'GAME_END') body = bodyEnd();
    const lastAudit = (S.st.audit || []).slice(-1)[0];
    return hud() + chips() + body + (ph !== 'GAME_END' ? myHand() : '') +
      (lastAudit ? `<p class="muted small center">GM ล่าสุด: ${esc(lastAudit.actor)} ${esc(auditText(lastAudit))}</p>` : '');
  }
  const AUD = { start: 'เริ่มเกม', pause: 'หยุดเกมชั่วคราว', resume: 'เล่นต่อ', skip: 'ข้าม', kick: 'เตะ', play_again: 'เริ่มเกมใหม่',
    gm_handover: 'ได้สิทธิ์ GM', approve_device: 'อนุมัติเปลี่ยนเครื่องของ', deny_device: 'ปฏิเสธเปลี่ยนเครื่องของ' };
  const auditText = (a) => `${AUD[a.action] || a.action} ${a.detail || ''}`;

  function render() {
    const app = $('#app');
    if (!S.st) app.innerHTML = S.pending ? viewPending() : viewHome();
    else app.innerHTML = S.st.phase === 'LOBBY' ? viewLobby() : viewGame();
    fillCards(app);
    $('#chat-btn').classList.toggle('hidden', !S.st);
    if (!S.st) { $('#chat').classList.add('hidden'); S.chatOpen = false; }
    tickTimer();
    renderModal();
  }

  // ---------- modal ----------
  function renderModal() {
    const m = S.modal, el = $('#modal');
    if (!m) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    let html = '';
    if (m.kind === 'rules') html = `<div class="box rules"><div class="close-row"><button class="icon" data-act="close">✕</button></div><h1 class="goldtxt">วิธีเล่น Dead Last</h1>${RULES.page(cfg())}
      <button class="btn block foot" data-act="close">ปิด</button></div>`;
    else if (m.kind === 'help') html = `<div class="box"><div class="close-row"><button class="icon" data-act="close">✕</button></div>
      <h2 class="goldtxt">${esc(PHASE_TH[m.phase] || '')}</h2><p>${RULES.help(m.phase, cfg())}</p>
      <div class="row foot"><button class="btn grow" data-act="rules">📖 กติกาทั้งหมด</button><button class="btn gold grow" data-act="close">เข้าใจแล้ว</button></div></div>`;
    else if (m.kind === 'skip') {
      const c = cfg();
      const waitTxt = m.phase === 'VOTE' ? 'จะตกรอบเพราะไม่ได้โหวต'
        : m.phase === 'SHOWDOWN_PICK' ? `ระบบจะเลือก ${esc(String(c.showdownTimeoutChoice || 'share').toUpperCase())} ให้`
        : c.defenseTimeoutPick === 'random' ? 'ระบบจะสุ่มคนที่ถูกกำจัดให้' : 'จะไม่มีใครถูกกำจัดเพิ่ม';
      html = `<div class="box"><h2 class="goldtxt">ข้ามเลยไหม?</h2>
        ${m.wait ? `<p>ยังมี <b>${m.wait} คน</b> ที่ยังไม่ได้เลือก — ${waitTxt}</p>` : ''}
        ${m.chosen ? `<p><b>${m.chosen} คน</b> เลือกแล้วแต่ยังไม่ยืนยัน — ระบบจะใช้ใบที่เลือกไว้</p>` : ''}
        <div class="row foot"><button class="btn grow" data-act="close">รอก่อน</button><button class="btn danger grow" data-act="skip-now">ข้ามเลย</button></div></div>`;
    }
    else if (m.kind === 'card') html = `<div class="box cardbox">${slot(m.cid, { pn: m.pn, mode: 'full' })}
      <div class="row"><button class="btn grow" data-act="close">กลับ</button>${m.label ? `<button class="btn gold grow" data-act="${m.act}" data-id="${esc(m.id)}">${esc(m.label)}</button>` : ''}</div></div>`;
    el.innerHTML = html; el.classList.remove('hidden');
    fillCards(el);
  }
  function openCard(kind, id) {
    if (kind === 'vote') {
      if (id === 'AMBUSH') S.modal = { kind: 'card', cid: 'defense', act: 'vote-select', id, label: 'เลือกใบนี้' };
      else { const p = P(id); S.modal = { kind: 'card', cid: p.unitId, pn: p.name, act: 'vote-select', id, label: `โหวต ${p.name}` }; }
    } else if (kind === 'ambush') { const p = P(id); S.modal = { kind: 'card', cid: p.unitId, pn: p.name, act: 'ambush-select', id, label: `กำจัด ${p.name}` }; }
    else if (kind === 'sd') S.modal = { kind: 'card', cid: SD_ID[id], act: 'sd-select', id, label: 'เลือกใบนี้' };
    else S.modal = { kind: 'card', cid: id };
    renderModal();
  }

  // ---------- นาฬิกา LED ----------
  function tickTimer() {
    const el = $('#led'); if (!el || !S.st) return;
    const st = S.st;
    if (st.paused) { el.textContent = 'หยุดชั่วคราว'; el.className = 'led paused'; return; }
    if (!st.endsAt) { el.textContent = '--:--'; el.className = 'led'; return; }
    const ms = Math.max(0, st.endsAt - (Date.now() + S.offset));
    const s = Math.ceil(ms / 1000);
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const warnAt = Number(cfg().timerWarnSeconds); // config.js: timerWarnSeconds
    const low = warnAt > 0 && s <= warnAt;
    el.className = 'led' + (low ? ' low' : '');
    // สั่นครั้งเดียวต่อช่วง เมื่อเริ่มกะพริบและเรายังต้องเลือก/ยืนยันอยู่ (Android; iPhone ไม่รองรับ)
    if (low && s > 0 && S.buzzed !== st.endsAt && pickStatus()[meId()] && pickStatus()[meId()] !== 'done') {
      S.buzzed = st.endsAt;
      try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ }
    }
  }
  setInterval(tickTimer, 250);

  // ---------- แชท ----------
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function chatLine(m) {
    if (m.sys) return `<div class="m sys">📢 ${esc(m.text)}</div>`;
    const col = /^#[0-9A-Fa-f]{6}$/.test(m.color) ? m.color : '#888888';
    return `<div class="m"><span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${col};margin-right:4px"></span><b>${esc(m.name)}</b>${esc(m.text)}<span class="t">${hhmm(m.at)}</span></div>`;
  }
  function renderChat() {
    const list = $('#chat-list');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = S.chat.map(chatLine).join('') || '<p class="muted small">ยังไม่มีข้อความ</p>';
    if (atBottom || S.chatOpen) list.scrollTop = list.scrollHeight;
    const b = $('#chat-badge'); b.textContent = S.unread > 99 ? '99+' : S.unread; b.classList.toggle('hidden', !S.unread);
  }
  function setChat(open) {
    S.chatOpen = open; $('#chat').classList.toggle('hidden', !open);
    if (open) { S.unread = 0; renderChat(); const l = $('#chat-list'); l.scrollTop = l.scrollHeight; }
  }
  $('#chat-btn').addEventListener('click', () => setChat(!S.chatOpen));
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#chat-in'), text = inp.value;
    if (!text.trim()) return;
    const r = await act('chat:send', { text });
    if (r.ok) inp.value = '';
  });

  // ---------- ปุ่มทั้งหมด ----------
  function readForm() {
    const n = $('#in-name'), c = $('#in-code');
    if (n) S.form.name = n.value; if (c) S.form.code = c.value.trim().toUpperCase();
  }
  document.addEventListener('input', (e) => { if (e.target.id === 'in-name' || e.target.id === 'in-code') readForm(); });
  function enterRoom(r) {
    saveSession({ code: r.code, playerId: r.playerId, token: r.token });
    try { history.replaceState(null, '', '/?room=' + r.code); } catch (e) { /* ignore */ }
  }
  const H = {
    create() {
      readForm(); if (!S.form.name.trim()) return toast('ใส่ชื่อก่อน');
      socket.emit('create', { name: S.form.name }, (r) => { if (!r || !r.ok) return toast((r && r.error) || 'สร้างห้องไม่ได้'); enterRoom(r); });
    },
    join() {
      readForm(); if (!S.form.name.trim()) return toast('ใส่ชื่อก่อน'); if (!S.form.code) return toast('ใส่รหัสห้อง');
      socket.emit('join', { name: S.form.name, code: S.form.code }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || 'เข้าห้องไม่ได้');
        if (r.pending) { S.pending = { reqId: r.reqId, code: r.code }; render(); return; }
        enterRoom(r);
      });
    },
    'cancel-join'() { if (S.pending) socket.emit('cancelJoin', { reqId: S.pending.reqId }); S.pending = null; render(); },
    start() { act('lobby:start'); },
    color(el) { act('lobby:setColor', { unitId: el.dataset.id }); },
    kick(el) { act('gm:kick', { playerId: el.dataset.id }); },
    leave() { socket.emit('leave', {}, () => {}); clearSession(); S.st = null; S.chat = []; render(); renderChat(); },
    copy() {
      const link = shareLink(S.st.code);
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('คัดลอกลิงก์แล้ว', true), () => toast(link, true));
      else toast(link, true);
    },
    view(el) { openCard(el.dataset.kind, el.dataset.id); },
    async 'vote-select'(el) { S.modal = null; renderModal(); await act('vote:select', { target: el.dataset.id }); },
    'vote-lock'() { act('vote:lock'); },
    async 'ambush-select'(el) { S.modal = null; renderModal(); await act('ambush:select', { victimId: el.dataset.id }); },
    'ambush-lock'() { act('ambush:lock'); },
    async 'sd-select'(el) { S.modal = null; renderModal(); await act('showdown:select', { choice: el.dataset.id }); },
    'sd-lock'() { act('showdown:lock'); },
    pause() { act('gm:pause'); }, resume() { act('gm:resume'); },
    // ข้ามช่วงที่ต้องเลือก: ถาม GM ก่อนถ้ายังมีคนไม่ได้เลือก หรือเลือกแล้วยังไม่ยืนยัน
    skip() {
      const ps = Object.values(pickStatus());
      const wait = ps.filter((x) => x === 'wait').length, chosen = ps.filter((x) => x === 'chosen').length;
      if (!wait && !chosen) return act('gm:skip');
      S.modal = { kind: 'skip', wait, chosen, phase: S.st.phase }; renderModal();
    },
    'skip-now'() { S.modal = null; renderModal(); act('gm:skip'); },
    approve(el) { act('gm:takeover', { reqId: el.dataset.id, approve: true }); },
    deny(el) { act('gm:takeover', { reqId: el.dataset.id, approve: false }); },
    again() { act('game:playAgain'); },
    async history() {
      const r = await act('history:download'); if (!r.ok || !r.history) return;
      const blob = new Blob([JSON.stringify(r.history, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dead-last-${S.st.code}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    rules() { S.modal = { kind: 'rules' }; renderModal(); $('#modal').scrollTop = 0; },
    help() { S.modal = { kind: 'help', phase: S.st ? S.st.phase : 'LOBBY' }; renderModal(); },
    close() { S.modal = null; renderModal(); },
    'open-chat'() { setChat(true); },
  };
  document.addEventListener('click', (e) => {
    const ui = e.target.closest('[data-ui]');
    if (ui && ui.dataset.ui === 'chat-close') return setChat(false);
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) { if (e.target.id === 'modal') { S.modal = null; renderModal(); } return; }
    const fn = H[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 'in-name' || e.target.id === 'in-code')) (S.form.code ? H.join : H.create)();
    if (e.key === 'Escape' && S.modal) { S.modal = null; renderModal(); }
  });

  // ---------- socket ----------
  function tryResume() {
    const s = loadSession();
    if (!s) return;
    const want = (params.get('room') || '').toUpperCase();
    if (want && want !== s.code && !S.st) return; // เปิดลิงก์ห้องอื่น → ให้กรอกชื่อเข้าห้องใหม่
    socket.emit('resume', { code: s.code, playerId: s.playerId, token: s.token }, (r) => {
      if (r && r.ok) return;
      clearSession(); S.st = null; render();
      if (r && r.code !== 'ROOM_NOT_FOUND') toast(r.error || 'กลับเข้าห้องไม่ได้');
      else toast('ห้องเดิมปิดไปแล้ว', true);
    });
  }
  socket.on('connect', () => { S.connected = true; $('#banner').classList.add('hidden'); tryResume(); });
  socket.on('disconnect', () => { S.connected = false; if (S.st) $('#banner').classList.remove('hidden'); });
  socket.on('state', (st) => {
    const prev = S.st;
    S.st = st; S.offset = st.serverNow - Date.now();
    if (st.stateVersion !== S.seq || !prev || prev.phase !== st.phase) { if (S.modal && S.modal.kind === 'card') S.modal = null; }
    S.seq = st.stateVersion; S.pending = null;
    render();
  });
  socket.on('chatHistory', (d) => { S.chat = (d && d.messages) || []; renderChat(); });
  socket.on('chat', (m) => { S.chat.push(m); if (S.chat.length > 200) S.chat.shift(); if (!S.chatOpen) S.unread++; renderChat(); });
  socket.on('notice', (n) => { const text = n && n.text ? n.text : ''; toast(text, true); S.chat.push({ sys: true, text }); renderChat(); });
  socket.on('kicked', (d) => { clearSession(); S.st = null; S.modal = null; render(); toast((d && d.text) || 'คุณถูกนำออกจากห้อง'); });
  socket.on('takeover', (d) => {
    S.pending = null;
    if (!d || d.denied) { toast('GM ไม่อนุมัติ'); render(); return; }
    enterRoom(d);
  });

  // ---------- โหลดข้อมูลการ์ดและ config ----------
  Promise.all([fetch('/api/cards').then((r) => r.json()), fetch('/api/config').then((r) => r.json())]).then(([cat, c]) => {
    S.cat = cat; S.cfg = c; S.byId = {}; cardCache.clear();
    for (const x of cat.cards) S.byId[x.id] = x;
    CardKit.init(cat.templates, cat.version, '/cards/');
    render();
  }).catch(() => toast('โหลดข้อมูลการ์ดไม่ได้ ลองรีเฟรช'));
  render(); renderChat();
})();
