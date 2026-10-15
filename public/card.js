// CardKit: วาดการ์ด 3 ชั้น (ภาพ + กรอบ + ข้อความ) จาก template-<kind>.json และ data.csv (ระบบการ์ด 420)
// ส่วนขยายของเกมนี้: ช่อง swatch, font.lineHeight, fit:wrap ขึ้นบรรทัดใหม่ได้, ช่อง runtime (player_name),
// หลาย template เลือกตามคอลัมน์ template, ภาพจาก card.artFile (webp/png/jpg) ใช้ร่วมกันหลายใบได้
// v2: ช่อง outline (กรอบสีตามคอลัมน์), colorFrom (สีตัวอักษรจากคอลัมน์ เช่นสีทีม), style:"team" (สีเข้ม = ขอบขาว, สีอื่น = เรืองแสง),
//     glow (เรืองแสงสีเดียวกับตัวอักษร), letterSpacing
(function (root) {
  'use strict';
  let T = {}, VER = '0', BASE = '/cards/';
  function init(templates, version, base) { T = templates || {}; VER = version || '0'; if (base) BASE = base; }
  const pct = (v, t) => (v / t * 100) + '%';
  const cq = (px, b) => (px / b.w * 100) + 'cqw';
  const HEX = /^#[0-9a-fA-F]{6}$/;
  // ความสว่างตามมาตรฐาน WCAG: ต่ำกว่า 0.08 ถือว่าสีเข้มจนกลืนพื้นการ์ด
  function lum(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const isDark = (hex) => HEX.test(hex) && lum(hex) < 0.08;
  function textShadow(color, b, team) {
    if (team && isDark(color)) { const w = cq(2, b); return [`${w} 0 0 #FFF`, `-${w} 0 0 #FFF`, `0 ${w} 0 #FFF`, `0 -${w} 0 #FFF`, `${w} ${w} 0 #FFF`, `-${w} -${w} 0 #FFF`, `${w} -${w} 0 #FFF`, `-${w} ${w} 0 #FFF`].join(','); }
    return `0 0 ${cq(14, b)} ${color}99`;
  }
  function box(el, s, b) {
    el.style.left = pct(s.x, b.w); el.style.top = pct(s.y, b.h);
    if (s.w != null) el.style.width = pct(s.w, b.w);
    if (s.h != null) el.style.height = pct(s.h, b.h);
  }
  function textSlot(s, v, b, card) {
    const el = document.createElement('div');
    el.className = `ck-slot ck-text ck-${s.fit || 'shrink'}`; box(el, s, b);
    const f = s.font || {};
    Object.assign(el.style, {
      fontFamily: `'${f.family || 'Chakra Petch'}', sans-serif`, fontWeight: f.weight || 400,
      fontStyle: f.italic ? 'italic' : 'normal', textAlign: s.align || 'left',
      justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[s.valign || 'middle'],
    });
    if (f.lineHeight) el.style.lineHeight = f.lineHeight;
    const from = s.colorFrom && card[s.colorFrom];
    const color = from && HEX.test(from) ? from : (s.color || 'inherit');
    el.style.color = color;
    if (s.letterSpacing) el.style.letterSpacing = cq(s.letterSpacing, b);
    if ((s.style === 'team' || s.glow) && HEX.test(color)) el.style.textShadow = textShadow(color, b, s.style === 'team');
    const span = document.createElement('span');
    span.textContent = (s.prefix || '') + v + (s.suffix || '');
    el.appendChild(span);
    el.dataset.size = f.size || 24; el.dataset.min = f.min || f.size || 24;
    return el;
  }
  // ลดขนาดตัวอักษรทีละ 1px จนพอดีช่อง ถ้าถึงขั้นต่ำแล้วยังล้น ติด data-overflow ให้หน้า /preview เห็น
  function fit(el, b) {
    if (!el.isConnected || !el.clientWidth) return false;
    let size = +el.dataset.size; const min = +el.dataset.min, span = el.firstChild;
    for (;;) {
      el.style.fontSize = cq(size, b);
      if (span.scrollWidth <= el.clientWidth + 1 && span.offsetHeight <= el.clientHeight + 1) { delete el.dataset.overflow; return true; }
      if (size <= min) { el.dataset.overflow = '1'; return true; }
      size = Math.max(min, size - 1);
    }
  }
  function swatch(s, v, b) {
    const el = document.createElement('div'); el.className = 'ck-slot ck-swatch'; box(el, s, b);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) el.style.background = v;
    el.style.borderRadius = cq(s.radius || 0, b); return el;
  }
  // กรอบเส้นรอบช่อง สีจากคอลัมน์ (กรอบรอบชื่อผู้เล่น = สีทีม)
  function outline(s, v, b) {
    const el = document.createElement('div'); el.className = 'ck-slot ck-outline'; box(el, s, b);
    if (!HEX.test(v)) return el;
    el.style.boxSizing = 'border-box'; el.style.borderRadius = cq(s.radius || 0, b);
    el.style.border = `${cq(s.width || 4, b)} solid ${v}`;
    if (s.style === 'team') el.style.boxShadow = isDark(v) ? `0 0 0 ${cq(2, b)} #FFF, inset 0 0 0 ${cq(2, b)} #FFF` : `0 0 ${cq(14, b)} ${v}88`;
    return el;
  }
  const MAKE = { text: textSlot, number: textSlot, swatch, outline };
  function fallbackArt(art, tpl, card) {
    const fb = tpl.fallback || {};
    art.style.background = fb.bg || '#24331F'; art.style.color = fb.color || '#F2C230';
    art.textContent = card[fb.column || 'name'] || card.id;
  }
  // card = แถวจาก /api/cards (+ ช่อง runtime เช่น player_name) ; opts.mode = 'full' | 'thumb'
  function render(card, opts = {}) {
    const tpl = T[card && card.template];
    const mode = opts.mode || 'full';
    const el = document.createElement('div');
    el.className = 'ck-card ck-' + mode;
    if (!tpl) { el.classList.add('ck-missing'); el.textContent = (card && card.name) || '?'; return el; }
    const b = tpl.base;
    el.dataset.id = card.id; el.style.aspectRatio = `${b.w} / ${b.h}`;
    const art = document.createElement('div'); art.className = 'ck-art'; box(art, tpl.art, b);
    art.style.borderRadius = cq(tpl.art.radius || 0, b);
    if (card.artFile) {
      const img = new Image(); img.alt = ''; img.decoding = 'async';
      img.src = `${BASE}art/${encodeURIComponent(card.artFile)}?v=${VER}`;
      img.onerror = () => { img.remove(); fallbackArt(art, tpl, card); };
      art.appendChild(img);
    } else fallbackArt(art, tpl, card);
    el.appendChild(art);
    if (tpl.frame) { const fr = new Image(); fr.className = 'ck-frame'; fr.alt = ''; fr.src = `${BASE}${tpl.frame}?v=${VER}`; el.appendChild(fr); }
    const hide = mode === 'thumb' ? ((tpl.thumb || {}).hide || []) : [];
    for (const s of tpl.slots) {
      const v = card[s.column];
      if (hide.includes(s.id) || v == null || v === '' || !MAKE[s.type]) continue;
      el.appendChild(MAKE[s.type](s, String(v), b, card));
    }
    el._fit = () => { let ok = true; el.querySelectorAll('.ck-text').forEach(n => { ok = fit(n, b) && ok; }); return ok; };
    return el;
  }
  // เรียกหลังวางการ์ดลงหน้าแล้ว (ต้องรู้ขนาดจริงก่อนจึงย่อข้อความได้)
  function fitAll(scope) {
    const run = () => (scope || document).querySelectorAll('.ck-card').forEach(c => { if (c._fit && !c._fitted) c._fitted = c._fit(); });
    requestAnimationFrame(run);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      (scope || document).querySelectorAll('.ck-card').forEach(c => { c._fitted = false; });
      requestAnimationFrame(run);
    });
  }
  function back() {
    const el = document.createElement('div'); el.className = 'ck-card ck-back'; el.style.aspectRatio = '600 / 900';
    const img = new Image(); img.alt = ''; img.src = `${BASE}back.png?v=${VER}`; img.className = 'ck-frame'; el.appendChild(img);
    return el;
  }
  root.CardKit = { init, render, fitAll, back };
})(window);
