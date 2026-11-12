/* Aran practice ground. Timings and numbers come from data/aran-practice.json (client tables);
   the figure, the reach of each skill and the dummy are simplified stand-ins, not client data. */
(async () => {
  'use strict';
  const data = await (await fetch('data/aran-practice.json?v=20261112a')).json();
  const byId = Object.fromEntries(data.skills.map(skill => [skill.id, skill]));
  document.getElementById('pr-version').textContent = data.source;
  document.getElementById('pr-note').textContent =
    '動作時間、冷卻、段數與傷害 % 取自用戶端資料；角色外型、技能距離與木樁為簡化示意。自動追加的瑪哈一擊（每 2 秒）與三式後的白虎會自動觸發，其餘追加攻擊未模擬。';

  // --- castable slots: combos are one key that walks through its steps -----------------------------------
  const SLOTS = [
    { id: 'beyonder', key: 'KeyQ', steps: ['beyonder1', 'beyonder2', 'beyonder3'], label: '比耀德 VI', comboWindow: 5000 },
    { id: 'last', key: 'KeyW', steps: ['last1', 'last2', 'last3'], label: '最終勝者', comboWindow: 3000, chainCooldown: 0 },
    { id: 'brandish', key: 'KeyE', steps: ['brandish'] },
    { id: 'hunter', key: 'KeyR', steps: ['hunter'] },
    { id: 'surge', key: 'KeyT', steps: ['surge'] },
    { id: 'tempest', key: 'Digit1', steps: ['tempest'] },
    { id: 'frozen', key: 'Digit2', steps: ['frozen'] },
    { id: 'aura', key: 'Digit3', steps: ['aura'] },
    { id: 'spider', key: 'Digit4', steps: ['spider'] },
    { id: 'origin', key: 'Digit5', steps: ['origin'] },
  ].filter(slot => slot.steps.every(step => byId[step]));
  try {
    const saved = JSON.parse(localStorage.getItem('aran-practice-keys') || '{}');
    for (const slot of SLOTS) if (saved[slot.id]) slot.key = saved[slot.id];
  } catch { /* defaults */ }
  const keyName = code => code.replace(/^Key|^Digit/, '').replace('Arrow', '').replace('Space', '空白');

  // --- world --------------------------------------------------------------------------------------------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, FLOOR = H - 70;
  const WINDOW_MS = 120000, REACH = 300, MOVE = 0.42, GRAVITY = 0.0026, JUMP = 0.92;
  const dummy = { x: W * 0.68, w: 46, h: 96 };
  const images = new Map();
  const image = src => {
    if (!images.has(src)) { const img = new Image(); img.src = src; images.set(src, img); }
    return images.get(src);
  };
  for (const skill of data.skills) if (skill.preview) image(skill.preview.src);

  let state;
  function reset() {
    state = {
      now: 0, startedAt: null, ended: false,
      player: { x: W * 0.3, y: FLOOR, vy: 0, facing: 1, jumps: 0, lockUntil: 0 },
      cooldown: {}, combo: {}, effects: [], floaters: [], pending: [], stats: {}, hits: 0, damage: 0, mahaReady: 0,
    };
    renderLog();
  }

  // --- casting ------------------------------------------------------------------------------------------
  function inReach() {
    const dx = dummy.x - state.player.x;
    return Math.abs(dx) <= REACH && (Math.abs(dx) < 40 || Math.sign(dx) === state.player.facing);
  }
  function record(skill, hits, damagePerHit) {
    const row = state.stats[skill.name] || (state.stats[skill.name] = { casts: 0, hits: 0, damage: 0 });
    row.hits += hits;
    row.damage += hits * damagePerHit;
    state.hits += hits;
    state.damage += hits * damagePerHit;
    state.floaters.push({ text: `${skill.name} ${damagePerHit}% × ${hits}`, x: dummy.x, y: FLOOR - dummy.h - 14, born: state.now });
  }
  function land(skill) {
    if (state.ended) return;
    const hits = Number(skill.hits || 0), damage = Number(skill.damage || 0);
    if (!hits || !inReach()) { state.floaters.push({ text: 'MISS', x: state.player.x, y: state.player.y - 120, born: state.now, miss: true }); return; }
    record(skill, hits, damage);
    // 瑪哈一擊 rides on Beyonder hits with its own 2 s cooldown.
    if (skill.id.startsWith('beyonder') && byId.maha && state.now >= state.mahaReady) {
      state.mahaReady = state.now + (byId.maha.cooldownMs || 2000);
      spawnEffect(byId.maha);
      record(byId.maha, 30, 300);
    }
  }
  function spawnEffect(skill) {
    if (skill.preview) state.effects.push({ skill, x: state.player.x, y: state.player.y, facing: state.player.facing, born: state.now });
  }
  function cast(slot) {
    const p = state.player;
    if (state.ended || state.now < p.lockUntil) return;
    const combo = state.combo[slot.id] || { step: 0, until: 0 };
    let step = slot.steps.length > 1 && state.now <= combo.until ? combo.step : 0;
    const skill = byId[slot.steps[step]];
    if (step === 0 && state.now < (state.cooldown[slot.id] || 0)) return;
    if (state.startedAt === null) state.startedAt = state.now;
    p.lockUntil = state.now + (skill.lockMs || skill.actionMs || 300);
    if (step === 0 && byId[slot.steps[0]].cooldownMs) state.cooldown[slot.id] = state.now + byId[slot.steps[0]].cooldownMs;
    (state.stats[skill.name] || (state.stats[skill.name] = { casts: 0, hits: 0, damage: 0 })).casts += 1;
    spawnEffect(skill.preview ? skill : byId[slot.steps[0]]);
    state.pending.push({ at: state.now + (skill.hitOffsetMs ?? Math.min(skill.actionMs || 300, 300)), skill });
    step += 1;
    if (step >= slot.steps.length) {
      state.combo[slot.id] = { step: 0, until: 0 };
      // third Beyonder form is followed by 終極比耀德・白虎
      if (slot.id === 'beyonder' && byId.white) {
        state.pending.push({ at: p.lockUntil + (byId.white.hitOffsetMs ?? 300), skill: byId.white, effect: true });
        p.lockUntil += byId.white.lockMs || 0;
      }
    } else state.combo[slot.id] = { step, until: state.now + (slot.comboWindow || 3000) };
  }

  // --- input --------------------------------------------------------------------------------------------
  const held = new Set();
  let waitingSlot = null;
  const jump = () => {
    const p = state.player;
    if (p.jumps < 2) { p.vy = -JUMP; p.jumps += 1; }
  };
  window.addEventListener('keydown', event => {
    if (waitingSlot) {
      event.preventDefault();
      if (event.code !== 'Escape') {
        waitingSlot.key = event.code;
        try { localStorage.setItem('aran-practice-keys', JSON.stringify(Object.fromEntries(SLOTS.map(s => [s.id, s.key])))); } catch { /* ignore */ }
      }
      waitingSlot = null;
      renderSlots();
      return;
    }
    if (event.code === 'Escape') { reset(); return; }
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) { held.add(event.code); event.preventDefault(); return; }
    if (['AltLeft', 'AltRight', 'Space', 'ArrowUp'].includes(event.code)) { event.preventDefault(); if (!event.repeat) jump(); return; }
    const slot = SLOTS.find(s => s.key === event.code);
    if (slot) { event.preventDefault(); cast(slot); }
  });
  window.addEventListener('keyup', event => held.delete(event.code));
  window.addEventListener('blur', () => held.clear());
  for (const button of document.querySelectorAll('.pr-touch button')) {
    const hold = button.dataset.hold;
    if (hold) {
      const code = hold === 'left' ? 'ArrowLeft' : 'ArrowRight';
      button.addEventListener('pointerdown', event => { event.preventDefault(); held.add(code); });
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, () => held.delete(code));
    } else button.addEventListener('pointerdown', event => { event.preventDefault(); jump(); });
  }
  document.getElementById('btn-reset').addEventListener('click', reset);

  // --- skill bar ----------------------------------------------------------------------------------------
  const slotsEl = document.getElementById('slots');
  function renderSlots() {
    slotsEl.replaceChildren(...SLOTS.map(slot => {
      const first = byId[slot.steps[0]];
      const el = document.createElement('div');
      el.className = 'pr-slot' + (waitingSlot === slot ? ' is-waiting' : '');
      el.dataset.slot = slot.id;
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const cooldown = first.cooldownMs ? `冷卻 ${first.cooldownMs / 1000} 秒` : '無冷卻';
      el.innerHTML = `<kbd></kbd><img alt=""><b></b><span></span><button class="rebind" type="button">改鍵</button>`;
      el.querySelector('kbd').textContent = waitingSlot === slot ? '按任意鍵…' : keyName(slot.key);
      el.querySelector('img').src = first.icon;
      el.querySelector('b').textContent = slot.label || first.name;
      el.querySelector('span').textContent = `${first.damage}% × ${first.hits} 擊・${cooldown}`;
      el.addEventListener('click', event => {
        if (event.target.closest('.rebind')) { waitingSlot = slot; renderSlots(); return; }
        cast(slot);
      });
      return el;
    }));
  }
  function renderLog() {
    const body = document.getElementById('log-body');
    const rows = Object.entries(state.stats).filter(([, row]) => row.hits || row.casts).sort((a, b) => b[1].damage - a[1].damage);
    if (!rows.length) { body.innerHTML = '<tr><td colspan="5">施放第一招後開始計時 120 秒。</td></tr>'; return; }
    body.replaceChildren(...rows.map(([name, row]) => {
      const tr = document.createElement('tr');
      const share = state.damage ? (row.damage / state.damage * 100).toFixed(1) + '%' : '—';
      for (const value of [name, row.casts || '自動', row.hits, Math.round(row.damage).toLocaleString('en-US'), share]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      return tr;
    }));
  }

  // --- loop ---------------------------------------------------------------------------------------------
  function update(dt) {
    state.now += dt;
    const p = state.player;
    if (state.now >= p.lockUntil || p.y < FLOOR) {
      const dir = (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0) - (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0);
      if (dir) { p.x = Math.max(30, Math.min(W - 30, p.x + dir * MOVE * dt)); p.facing = dir; }
    }
    p.vy += GRAVITY * dt;
    p.y = Math.min(FLOOR, p.y + p.vy * dt);
    if (p.y >= FLOOR) { p.vy = 0; p.jumps = 0; }
    for (const item of state.pending.filter(item => state.now >= item.at)) {
      if (item.effect) { spawnEffect(item.skill); (state.stats[item.skill.name] || (state.stats[item.skill.name] = { casts: 0, hits: 0, damage: 0 })); }
      land(item.skill);
    }
    const before = state.pending.length;
    state.pending = state.pending.filter(item => state.now < item.at);
    state.effects = state.effects.filter(effect => state.now - effect.born < effect.skill.preview.durations.reduce((a, b) => a + b, 0));
    state.floaters = state.floaters.filter(floater => state.now - floater.born < 900);
    if (state.startedAt !== null && !state.ended && state.now - state.startedAt >= WINDOW_MS) state.ended = true;
    if (before !== state.pending.length) renderLog();
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#141a33'); sky.addColorStop(1, '#232b52');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2e3766'; ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = '#3d4884'; ctx.fillRect(0, FLOOR, W, 4);
    // dummy
    ctx.fillStyle = '#b98a54'; ctx.fillRect(dummy.x - 6, FLOOR - dummy.h, 12, dummy.h);
    ctx.fillStyle = '#d9b27c'; ctx.beginPath(); ctx.arc(dummy.x, FLOOR - dummy.h - 16, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(dummy.x - dummy.w / 2, FLOOR - dummy.h + 22, dummy.w, 10);
    ctx.fillStyle = '#8f96ab'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('木樁', dummy.x, FLOOR + 22);
    // reach guide
    const p = state.player;
    ctx.strokeStyle = inReach() ? 'rgba(63,216,209,.55)' : 'rgba(255,255,255,.14)';
    ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(p.x, FLOOR + 10); ctx.lineTo(p.x + p.facing * REACH, FLOOR + 10); ctx.stroke(); ctx.setLineDash([]);
    // player (stand-in figure with a polearm)
    const locked = state.now < p.lockUntil;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.facing, 1);
    ctx.fillStyle = '#e8ecff'; ctx.fillRect(-11, -58, 22, 40);
    ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(0, -70, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a5fd0'; ctx.fillRect(-11, -18, 9, 18); ctx.fillRect(2, -18, 9, 18);
    ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 4; ctx.beginPath();
    if (locked) { ctx.moveTo(-6, -40); ctx.lineTo(64, -56); } else { ctx.moveTo(-18, -4); ctx.lineTo(26, -92); }
    ctx.stroke(); ctx.restore();
    // effects: sprite sheets face left in the client, so mirror them when the character faces right
    for (const effect of state.effects) {
      const pv = effect.skill.preview, img = image(pv.src);
      if (!img.complete || !img.naturalWidth) continue;
      let elapsed = state.now - effect.born, frame = 0;
      while (frame < pv.durations.length - 1 && elapsed >= pv.durations[frame]) { elapsed -= pv.durations[frame]; frame += 1; }
      const sx = (frame % pv.cols) * pv.w, sy = Math.floor(frame / pv.cols) * pv.h;
      const scale = 1.25;
      // Sheets have an opaque near-black backdrop: crush it to pure black, then screen-blend so only the light adds.
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      if ('filter' in ctx) ctx.filter = 'brightness(0.9) contrast(1.3)';
      ctx.translate(effect.x + effect.facing * 70, effect.y - 60); ctx.scale(-effect.facing * scale, scale);
      ctx.drawImage(img, sx, sy, pv.w, pv.h, -pv.w / 2, -pv.h / 2, pv.w, pv.h);
      ctx.restore();
    }
    for (const floater of state.floaters) {
      const age = (state.now - floater.born) / 900;
      ctx.globalAlpha = 1 - age; ctx.fillStyle = floater.miss ? '#ff9db2' : '#ffd76c';
      ctx.font = '700 15px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(floater.text, floater.x, floater.y - age * 46);
      ctx.globalAlpha = 1;
    }
    if (state.ended) {
      ctx.fillStyle = 'rgba(10,14,28,.72)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '800 30px sans-serif';
      ctx.fillText(`120 秒結束：${state.hits.toLocaleString('en-US')} 段`, W / 2, H / 2 - 8);
      ctx.font = '16px sans-serif'; ctx.fillText('按 Esc 或「重新開始」再來一次', W / 2, H / 2 + 26);
    }
  }
  function hud() {
    const elapsed = state.startedAt === null ? 0 : Math.min(WINDOW_MS, state.now - state.startedAt);
    document.getElementById('hud-time').textContent = ((WINDOW_MS - elapsed) / 1000).toFixed(1);
    document.getElementById('hud-hits').textContent = state.hits.toLocaleString('en-US');
    document.getElementById('hud-damage').textContent = Math.round(state.damage).toLocaleString('en-US');
    document.getElementById('hud-rate').textContent = elapsed ? (state.hits / (elapsed / 1000)).toFixed(1) : '0.0';
    for (const slot of SLOTS) {
      const el = slotsEl.querySelector(`[data-slot="${slot.id}"]`);
      const total = byId[slot.steps[0]].cooldownMs || 0, left = Math.max(0, (state.cooldown[slot.id] || 0) - state.now);
      if (!el) continue;
      el.classList.toggle('is-cooling', left > 0);
      el.style.setProperty('--cd', total ? String(left / total) : '0');
    }
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last); last = now;
    if (!state.ended) update(dt);
    draw(); hud();
    requestAnimationFrame(frame);
  }
  reset(); renderSlots();
  window.practice = { state: () => state, cast: id => cast(SLOTS.find(s => s.id === id)), slots: SLOTS };
  requestAnimationFrame(frame);
})();
