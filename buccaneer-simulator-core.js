(function attachBuccaneerSimulator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BuccaneerSimulatorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBuccaneerSimulator() {
  'use strict';

  const WINDOW_MS = 120000;
  const MODEL_ID = 'buccaneer-search-v2-trigger-state-machine';
  const LEGACY_MODEL_ID = 'buccaneer-center-v1-trigger-charge-ledger';
  const SEARCH_BEAM_WIDTH = 420;
  const DATA_BUILD = Object.freeze({
    manifest: '2.420.5698_3617075a',
    build: '20260812_170341',
    actionSource: 'Global/TWN Activator.tbl + Skill.tbl'
  });

  const GROUPS = Object.freeze({
    origin: { label: '起源', color: '#7657e8' },
    burst: { label: '爆發主動', color: '#2667ff' },
    charge: { label: '充能技能', color: '#ff8150' },
    filler: { label: '填充', color: '#11182e' },
    summon: { label: '召喚／持續', color: '#14a6a1' },
    trigger: { label: '觸發／校正', color: '#ef476f' },
    passive: { label: 'Buff／狀態', color: '#3f9bb8' }
  });

  const SKILLS = Object.freeze({
    origin: skill('origin', '海龍霸拳', 'icons/LiberateNeptunes.png', 'origin', 240000, 4320),
    neptune: skill('neptune', '尼普頓之怒', 'icons/LiberateNeptunes.png', 'trigger', 4500, 0),
    charge: skill('charge', '海龍衝鋒', 'icons/FuriousCharge.png', 'charge', 500, 300),
    howling: skill('howling', '海龍正拳', 'icons/HowlingFist.png', 'burst', 120000, 2520),
    meltdown: skill('meltdown', '海之霸主', 'icons/Meltdown_R.png', 'summon', 120000, 1260),
    stimulate: skill('stimulate', '暴能續發', 'icons/Stimulate_R.png', 'passive', 120000, 450),
    lordDeep: skill('lordDeep', '海龍螺旋', 'icons/LordoftheDeep.png', 'summon', 0, 450),
    filler: skill('filler', '閃・連殺VI', 'icons/FistEnrage_VI.png', 'filler', 0, 570),
    nautilus: skill('nautilus', '戰艦鯨魚號', 'icons/BattleshipNautilus_R.png', 'trigger', 30000, 900),
    serpent: skill('serpent', '海龍之怒／突擊之怒', 'icons/SerpentAssaultEnrage_R.png', 'trigger', 2500, 0),
    spider: skill('spider', '鏡之蜘蛛', 'icons/SpiderinMirror.png', 'summon', 120000, 1080),
    armorBreak: skill('armorBreak', '破壞防具4', 'icons/ArmorPiercing_R.png', 'passive', 30000, 0)
  });

  const PRESETS = Object.freeze({
    optimizer: Object.freeze({
      id: 'optimizer', label: '最佳化搜尋 Beta', fillerLimit: 999, inputGapMs: 0,
      meltdownBallHits: 500, assaultEnrageHits: 44, superFistBonus: 4,
      help: '用 Beam Search 比較合法施放順序；充能、共享冷卻、海龍石與 80 秒暴能視窗都是搜尋狀態。'
    }),
    center: Object.freeze({
      id: 'center', label: '實戰中心', fillerLimit: 130, inputGapMs: 0,
      battleshipHits: 3000, meltdownHits: 1500, serpentHits: 2700,
      help: '以 22,000 段實戰校正建立事件帳本；中心結果固定對帳 21,744 段。'
    }),
    client: Object.freeze({
      id: 'client', label: '客戶端主動作上限', fillerLimit: 999, inputGapMs: 0,
      battleshipHits: 3200, meltdownHits: 1800, serpentHits: 3000,
      help: '填滿所有可用主動作空檔，持續物件採校正上緣；代表理論輸入上限，不是保證實戰值。'
    }),
    conservative: Object.freeze({
      id: 'conservative', label: '保守可行', fillerLimit: 120, inputGapMs: 100,
      battleshipHits: 2700, meltdownHits: 1000, serpentHits: 2300,
      help: '每次切招保留 100ms，背景持續傷害採校正下緣。'
    })
  });

  function skill(id, name, icon, group, cooldownMs, lockMs) {
    return Object.freeze({ id, name, icon, group, cooldownMs, lockMs });
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeOptions(input) {
    const presetId = input?.preset && PRESETS[input.preset] ? input.preset : 'optimizer';
    const base = PRESETS[presetId];
    return Object.freeze({
      preset: presetId,
      startingCharges: Math.round(clampNumber(input?.startingCharges, 0, 6, 6)),
      freeMode: input?.freeMode == null ? true : Boolean(input.freeMode),
      precastSpider: input?.precastSpider == null ? true : Boolean(input.precastSpider),
      fillerLimit: base.fillerLimit,
      inputGapMs: base.inputGapMs,
      battleshipHits: base.battleshipHits,
      meltdownHits: base.meltdownHits,
      serpentHits: base.serpentHits,
      meltdownBallHits: base.meltdownBallHits ?? 500,
      assaultEnrageHits: base.assaultEnrageHits ?? 44,
      superFistBonus: base.superFistBonus ?? 4
    });
  }

  function createState(options) {
    return {
      options,
      nextId: 1,
      actions: [],
      hits: [],
      countdown: [],
      diagnostics: [],
      chargeSpent: 0,
      chargeGenerated: 0,
      chargeOverflow: 0,
      attackAnchors: []
    };
  }

  function addAction(state, data) {
    const action = {
      id: state.nextId++, type: data.type || 'foreground', skillId: data.skillId,
      startMs: Math.round(data.startMs), endMs: Math.round(data.endMs ?? data.startMs),
      reason: data.reason || '', units: Math.max(0, Number(data.units ?? 1)),
      countsAsUse: data.countsAsUse !== false, parentId: data.parentId || null
    };
    state.actions.push(action);
    return action;
  }

  function addHit(state, data) {
    const hit = {
      id: state.nextId++, type: 'background', skillId: data.skillId,
      timeMs: Math.round(data.timeMs), hits: Math.max(0, Math.round(data.hits || 0)),
      reason: data.reason || '', parentId: data.parentId || null
    };
    if (hit.timeMs >= 0 && hit.timeMs < WINDOW_MS && hit.hits > 0) state.hits.push(hit);
    return hit;
  }

  function schedulePrecasts(state) {
    const options = state.options;
    addAction(state, { type: 'background', skillId: 'lordDeep', startMs: 0, endMs: WINDOW_MS, reason: '倒數時啟動並保持貼王；中心模型校正為 80 次攻擊。', countsAsUse: true });
    state.countdown.push({ skillId: 'lordDeep', startMs: -1530, label: '預先啟動持續攻擊' });
    for (let index = 1; index <= 80; index += 1) addHit(state, { skillId: 'lordDeep', timeMs: index * 1500 - 1, hits: 24, reason: `持續攻擊 ${index}/80` });

    if (options.precastSpider) {
      state.countdown.push({ skillId: 'spider', startMs: -1080, label: '預放，0 秒起計入落地傷害' });
      const spider = addAction(state, { type: 'background', skillId: 'spider', startMs: -1080, endMs: 30000, reason: '倒數預放；嚴格只計 0～120 秒命中。' });
      addHit(state, { skillId: 'spider', timeMs: 0, hits: 96, reason: '鏡之蜘蛛直接傷害', parentId: spider.id });
      for (let index = 1; index <= 10; index += 1) addHit(state, { skillId: 'spider', timeMs: index * 2000, hits: 18, reason: `蜘蛛之腿 ${index}/10`, parentId: spider.id });
    }
  }

  function spendStartingCharges(state, cursor) {
    const count = state.options.startingCharges;
    if (!count) return cursor;
    if (state.options.freeMode) {
      const action = addAction(state, {
        skillId: 'charge', startMs: cursor, endMs: cursor + SKILLS.charge.lockMs,
        units: count, reason: `海龍自由模式一次消耗開場 ${count} 層，避免充能上限溢出。`
      });
      addHit(state, { skillId: 'charge', timeMs: action.endMs, hits: count * 92, reason: `${count} 層 × 92 段`, parentId: action.id });
      state.chargeSpent += count;
      state.attackAnchors.push(action.endMs);
      return action.endMs + state.options.inputGapMs;
    }

    let nextStart = cursor;
    for (let index = 0; index < count; index += 1) {
      const action = addAction(state, { skillId: 'charge', startMs: nextStart, endMs: nextStart + 300, reason: `逐層施放開場充能 ${index + 1}/${count}。` });
      addHit(state, { skillId: 'charge', timeMs: action.endMs, hits: 92, reason: '海龍衝鋒 92 段', parentId: action.id });
      state.chargeSpent += 1;
      state.attackAnchors.push(action.endMs);
      nextStart += 500 + state.options.inputGapMs;
    }
    return nextStart - 200;
  }

  function scheduleOpening(state) {
    let cursor = spendStartingCharges(state, 0);

    const origin = addAction(state, { skillId: 'origin', startMs: cursor, endMs: cursor + 4320, reason: '先清空充能後立即施放起源，接著以高頻攻擊觸發 30 秒尼普頓之怒。' });
    addHit(state, { skillId: 'origin', timeMs: origin.endMs, hits: 4620, reason: '起源根技能：42×50 + 42×60', parentId: origin.id });
    cursor = origin.endMs + state.options.inputGapMs;

    const howling = addAction(state, { skillId: 'howling', startMs: cursor, endMs: cursor + 2520, reason: '360ms 前置＋16 段連打階段＋240ms 結尾，完整打完 1,740 段。' });
    addHit(state, { skillId: 'howling', timeMs: howling.endMs, hits: 1740, reason: '66×16 + 684', parentId: howling.id });
    state.attackAnchors.push(howling.endMs);
    cursor = howling.endMs + state.options.inputGapMs;

    for (let index = 1; index <= 3; index += 1) {
      const ball = addAction(state, { skillId: 'meltdown', startMs: cursor, endMs: cursor + 1260, reason: `海之霸主能量球 ${index}/3；每顆建立 6 秒持續物件。` });
      scheduleDistributedHits(state, 'meltdown', ball.endMs, 6000, state.options.meltdownHits / 3, 12, `能量球 ${index}/3`, ball.id);
      cursor = ball.endMs + state.options.inputGapMs;
    }

    const nautilus = addAction(state, { skillId: 'nautilus', startMs: cursor, endMs: cursor + 900, reason: '開始 30 秒直接傷害冷卻；追加爆炸另以校正帳本結算。' });
    addHit(state, { skillId: 'nautilus', timeMs: nautilus.endMs, hits: 5, reason: '戰艦直接傷害', parentId: nautilus.id });
    cursor = nautilus.endMs + state.options.inputGapMs;

    return { cursor, originEndMs: origin.endMs, firstNautilusStart: nautilus.startMs };
  }

  function scheduleLoop(state, opening) {
    const options = state.options;
    const rechargeTimes = [];
    for (let timeMs = 5000; timeMs < WINDOW_MS; timeMs += 5000) rechargeTimes.push(timeMs);
    let rechargeIndex = 0;
    let charges = 0;
    let cursor = opening.cursor;
    let lastChargeStart = -Infinity;
    let fillerCount = 0;
    let nautilusUses = 1;
    let nextNautilus = opening.firstNautilusStart + 30000;
    const spreadInterval = options.fillerLimit >= 999 ? 0 : Math.max(570, (WINDOW_MS - cursor - 571) / Math.max(1, options.fillerLimit - 1));
    let nextFillerTarget = cursor;

    function accrue(untilMs) {
      while (rechargeIndex < rechargeTimes.length && rechargeTimes[rechargeIndex] <= untilMs) {
        if (charges < 6) charges += 1;
        else state.chargeOverflow += 1;
        state.chargeGenerated += 1;
        rechargeIndex += 1;
      }
    }

    while (cursor < WINDOW_MS) {
      accrue(cursor);

      if (nautilusUses < 4 && nextNautilus <= cursor) {
        if (cursor + 900 > WINDOW_MS) break;
        const action = addAction(state, { skillId: 'nautilus', startMs: cursor, endMs: cursor + 900, reason: `第 ${nautilusUses + 1}/4 次，30 秒冷卻到點後優先施放。` });
        addHit(state, { skillId: 'nautilus', timeMs: action.endMs, hits: 5, reason: '戰艦直接傷害', parentId: action.id });
        nautilusUses += 1;
        nextNautilus = action.startMs + 30000;
        cursor = action.endMs + options.inputGapMs;
        continue;
      }

      if (charges > 0 && cursor >= lastChargeStart + 500) {
        if (cursor + 300 > WINDOW_MS) break;
        const action = addAction(state, { skillId: 'charge', startMs: cursor, endMs: cursor + 300, reason: '5 秒補充完成即消耗，避免 6 層上限造成未來充能損失。' });
        addHit(state, { skillId: 'charge', timeMs: action.endMs, hits: 92, reason: '海龍衝鋒 92 段', parentId: action.id });
        charges -= 1;
        state.chargeSpent += 1;
        lastChargeStart = action.startMs;
        state.attackAnchors.push(action.endMs);
        cursor = action.endMs + options.inputGapMs;
        continue;
      }

      const canFill = fillerCount < options.fillerLimit && (options.fillerLimit >= 999 || cursor >= nextFillerTarget);
      if (canFill && cursor + 570 < WINDOW_MS) {
        const action = addAction(state, { skillId: 'filler', startMs: cursor, endMs: cursor + 570, reason: '高優先技能未就緒，以閃・連殺VI維持海龍之怒與戰艦追加觸發。' });
        const hits = fillerCount < 5 ? 15 : 17;
        addHit(state, { skillId: 'filler', timeMs: action.endMs, hits, reason: fillerCount < 5 ? '海龍強化前 15 段' : '海龍強化 Buff：15 + 2 段', parentId: action.id });
        state.attackAnchors.push(action.endMs);
        fillerCount += 1;
        nextFillerTarget = opening.cursor + fillerCount * spreadInterval;
        cursor = action.endMs + options.inputGapMs;
        continue;
      }

      const nextRecharge = rechargeIndex < rechargeTimes.length ? rechargeTimes[rechargeIndex] : Infinity;
      const nextFiller = fillerCount < options.fillerLimit ? nextFillerTarget : Infinity;
      const nextEvent = Math.min(nextRecharge, nextNautilus, nextFiller, WINDOW_MS);
      if (!Number.isFinite(nextEvent) || nextEvent <= cursor) cursor += 1;
      else cursor = nextEvent;
    }

    accrue(WINDOW_MS - 1);
    return { fillerCount, nautilusUses, charges };
  }

  function scheduleOriginFollowups(state, originEndMs) {
    for (let index = 0; index < 7; index += 1) {
      addHit(state, { skillId: 'neptune', timeMs: originEndMs + index * 4500, hits: 160, reason: `尼普頓之怒 ${index + 1}/7；4.5 秒重新觸發` });
    }
  }

  function scheduleCalibrationBundles(state) {
    const directNautilus = state.hits.filter(hit => hit.skillId === 'nautilus').reduce((sum, hit) => sum + hit.hits, 0);
    distributeOnAnchors(state, 'nautilus', Math.max(0, state.options.battleshipHits - directNautilus), '戰艦 0.15 秒追加傷害校正');
    distributeOnAnchors(state, 'serpent', state.options.serpentHits, '海龍之怒／突擊之怒／超級閃連殺校正');
  }

  function distributeOnAnchors(state, skillId, totalHits, reason) {
    const anchors = state.attackAnchors.filter(timeMs => timeMs >= 0 && timeMs < WINDOW_MS).sort((a, b) => a - b);
    if (!anchors.length || totalHits <= 0) return;
    const base = Math.floor(totalHits / anchors.length);
    let remainder = totalHits - base * anchors.length;
    anchors.forEach((timeMs, index) => {
      const hits = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      addHit(state, { skillId, timeMs, hits, reason: `${reason} ${index + 1}/${anchors.length}` });
    });
  }

  function scheduleDistributedHits(state, skillId, startMs, durationMs, totalHits, count, reason, parentId) {
    const roundedTotal = Math.round(totalHits);
    const base = Math.floor(roundedTotal / count);
    let remainder = roundedTotal - base * count;
    for (let index = 1; index <= count; index += 1) {
      const hits = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      addHit(state, { skillId, timeMs: startMs + durationMs * index / count, hits, reason: `${reason} 持續命中 ${index}/${count}`, parentId });
    }
  }

  function scheduleStatusWindows(state, originEndMs) {
    for (let index = 0; index < 4; index += 1) {
      const startMs = originEndMs + index * 30000;
      addAction(state, { type: 'background', skillId: 'armorBreak', startMs, endMs: Math.min(WINDOW_MS, startMs + 15000), reason: `第 ${index + 1} 個 50 段觸發後的破壞防具4視窗。`, countsAsUse: false });
    }
  }

  function summarize(state, loop) {
    const bySkill = Object.create(null);
    Object.values(SKILLS).forEach(def => { bySkill[def.id] = { skillId: def.id, uses: 0, hits: 0, hitEvents: 0 }; });
    for (const action of state.actions) if (action.countsAsUse && bySkill[action.skillId]) bySkill[action.skillId].uses += action.units;
    for (const hit of state.hits) {
      if (!bySkill[hit.skillId]) continue;
      bySkill[hit.skillId].hits += hit.hits;
      bySkill[hit.skillId].hitEvents += 1;
    }
    const foreground = state.actions.filter(action => action.type === 'foreground' && action.startMs >= 0 && action.endMs <= WINDOW_MS);
    const busyMs = foreground.reduce((sum, action) => sum + action.endMs - action.startMs, 0);
    const totalHits = Object.values(bySkill).reduce((sum, row) => sum + row.hits, 0);
    const calibratedHits = bySkill.nautilus.hits + bySkill.meltdown.hits + bySkill.serpent.hits;
    return {
      totalHits, bySkill, actionCount: foreground.reduce((sum, action) => sum + Math.max(1, action.units), 0),
      busyMs, idleMs: WINDOW_MS - busyMs, calibratedHits,
      charge: {
        start: state.options.startingCharges, generated: state.chargeGenerated, spent: state.chargeSpent,
        overflow: state.chargeOverflow, end: loop.charges, uses: bySkill.charge.uses
      }
    };
  }

  function audit(state, summary) {
    const rows = [];
    const overlaps = validateForeground(state.actions);
    rows.push(overlaps.length ? auditRow('error', '主動作發生重疊', overlaps[0]) : auditRow('pass', '主動作時間線無重疊', `占用 ${(summary.busyMs / 1000).toFixed(2)} 秒，所有按鍵動作依序完成。`));
    rows.push(summary.charge.overflow ? auditRow('warning', '仍有充能溢出', `浪費 ${summary.charge.overflow} 次補充。`) : auditRow('pass', '海龍衝鋒沒有溢出', `起始 ${summary.charge.start} 層＋${summary.charge.generated} 次補充，共施放 ${summary.charge.spent} 層。`));
    if (isCenterSignature(state.options)) rows.push(summary.totalHits === 21744 ? auditRow('pass', '中心模型對帳成功', '固定核心 12,344＋戰艦 3,000＋海之霸主 1,500＋海龍組 2,700＋填充 2,200＝21,744。') : auditRow('error', '中心模型對帳失敗', `目前為 ${summary.totalHits} 段。`));
    else rows.push(auditRow('warning', '自訂模型已啟用', '起始充能、自由模式或蜘蛛設定已改變，結果不再是 21,744 中心簽章。'));
    rows.push(auditRow('warning', '背景傷害仍含校正項', `${summary.calibratedHits.toLocaleString('zh-TW')} 段來自尚未完全解出 Server cadence 的戰艦追加、能量球與海龍持續物件。`));
    return rows;
  }

  function validateForeground(actions) {
    const list = actions.filter(action => action.type === 'foreground').sort(sortByStart);
    const issues = [];
    for (let index = 1; index < list.length; index += 1) if (list[index].startMs < list[index - 1].endMs) issues.push(`${list[index - 1].skillId} 與 ${list[index].skillId} 重疊。`);
    return issues;
  }

  function isCenterSignature(options) {
    return options.preset === 'center' && options.startingCharges === 6 && options.freeMode && options.precastSpider;
  }

  function createSearchState(options) {
    return {
      t: 0, score: 0, charges: options.startingCharges, nextRechargeMs: 5000,
      generated: 0, overflow: 0, spent: 0, chargeReady: 0,
      originUsed: false, originEndMs: -1, howlingUsed: false,
      meltdownUsed: false, meltdownUntil: 0, balls: 0,
      nautilusReady: 0, nautilusUses: 0, fillerCount: 0,
      serpentReady: 0, stoneStacks: 5, assaultReady: true,
      fistBuffUntil: 0, superUntil: 0,
      neptuneUntil: 0, nextNeptune: Infinity,
      trail: null, depth: 0
    };
  }

  function accrueSearchCharges(state, untilMs) {
    while (state.nextRechargeMs <= untilMs && state.nextRechargeMs < WINDOW_MS) {
      state.generated += 1;
      if (state.charges < 6) state.charges += 1;
      else state.overflow += 1;
      state.nextRechargeMs += 5000;
    }
  }

  function searchActions(state, options) {
    const list = [];
    if (!state.originUsed) list.push('origin');
    if (!state.howlingUsed) list.push('howling');
    if (!state.meltdownUsed) list.push('meltdownStart');
    if (state.balls > 0 && state.t < state.meltdownUntil) list.push('meltdownBall');
    if (state.t >= state.nautilusReady) list.push('nautilus');
    if (state.charges > 0 && state.t >= state.chargeReady) list.push('charge');
    if (state.fillerCount < options.fillerLimit) list.push('filler');
    return list.filter(actionId => state.t + searchLock(actionId, options) < WINDOW_MS);
  }

  function searchLock(actionId, options) {
    const base = {
      origin: 4320, howling: 2520, meltdownStart: 450,
      meltdownBall: 1260, nautilus: 900, charge: 300, filler: 570
    }[actionId];
    return base + options.inputGapMs;
  }

  function searchTransition(previous, actionId, options) {
    const state = { ...previous };
    const startMs = state.t;
    const lockMs = searchLock(actionId, options);
    const endMs = startMs + lockMs;
    const events = [];
    let units = 1;
    let reason = '';
    let offensive = false;
    let serpentKind = '';
    let nautilusEligible = false;

    if (actionId === 'origin') {
      state.originUsed = true;
      state.originEndMs = endMs;
      state.neptuneUntil = endMs + 30000;
      state.nextNeptune = endMs;
      events.push(hitEvent('origin', 4620, '起源根技能：42×50 + 42×60'));
      reason = '搜尋器選擇的起源開啟點；後續 30 秒以攻擊觸發尼普頓。';
      offensive = true;
    } else if (actionId === 'howling') {
      state.howlingUsed = true;
      events.push(hitEvent('howling', 1740, '海龍正拳 66×16 + 684'));
      reason = '搜尋器在可完整打完 2,520ms 動作的位置插入。';
      offensive = true;
      serpentKind = 'nonFist';
      nautilusEligible = true;
    } else if (actionId === 'meltdownStart') {
      state.meltdownUsed = true;
      state.meltdownUntil = endMs + 40000;
      state.balls = 3;
      reason = '先以客戶端 Activator 450ms 開啟 40 秒 Buff，三顆球改由搜尋器決定時點。';
    } else if (actionId === 'meltdownBall') {
      state.balls -= 1;
      events.push({ ...hitEvent('meltdown', options.meltdownBallHits, '能量球 6 秒持續命中校正'), spreadMs: 6000, spreadCount: 12 });
      reason = `Buff 視窗內發射第 ${3 - state.balls}/3 顆能量球；次序由搜尋得出。`;
      offensive = true;
    } else if (actionId === 'nautilus') {
      state.nautilusUses += 1;
      state.nautilusReady = startMs + 30000;
      events.push(hitEvent('nautilus', 5, '戰艦鯨魚號直接傷害'));
      reason = `第 ${state.nautilusUses} 次戰艦；30 秒冷卻與其他動作一起交給搜尋比較。`;
      offensive = true;
    } else if (actionId === 'charge') {
      units = options.freeMode ? state.charges : 1;
      state.charges -= units;
      state.spent += units;
      state.chargeReady = startMs + 500;
      events.push(hitEvent('charge', units * 92, `${units} 層 × 92 段`));
      reason = options.freeMode ? `自由模式消耗當前 ${units} 層，搜尋器同時考慮未來 5 秒補充。` : '單層消耗，遵守 0.5 秒技能冷卻。';
      offensive = true;
      serpentKind = 'nonFist';
      nautilusEligible = true;
    } else if (actionId === 'filler') {
      const strengthened = endMs < state.fistBuffUntil ? 2 : 0;
      const superBonus = endMs < state.superUntil ? options.superFistBonus : 0;
      state.fillerCount += 1;
      events.push(hitEvent('filler', 15 + strengthened + superBonus, superBonus ? `15 + 海龍強化 ${strengthened} + 超級閃連殺校正 ${superBonus}` : `15 + 海龍強化 ${strengthened}`));
      reason = '基礎輸出；海龍強化與超級閃連殺是依當下 Buff 狀態結算。';
      offensive = true;
      serpentKind = 'fist';
      nautilusEligible = true;
    }

    if (nautilusEligible) {
      const triggerCount = actionId === 'howling' ? 17 : actionId === 'filler' ? 4 : 2;
      events.push(hitEvent('nautilus', triggerCount * 4, `0.15 秒追加攻擊節點估計 ${triggerCount} 次 × 4`));
    }

    if (serpentKind && endMs >= state.serpentReady) {
      const stimulateActive = endMs < 80000;
      const assault = stimulateActive || state.assaultReady;
      if (serpentKind === 'fist') {
        if (assault) {
          events.push(hitEvent('serpent', options.assaultEnrageHits, `海龍突擊之怒持續命中校正 ${options.assaultEnrageHits} 段`));
          state.superUntil = endMs + 5000;
        } else {
          events.push(hitEvent('serpent', 10, '海龍之怒 10 段'));
          state.fistBuffUntil = endMs + 15000;
        }
      } else {
        events.push(hitEvent('serpent', 3, assault ? '海龍突擊 3 段' : '海龍爆裂 3 段'));
      }
      if (stimulateActive) {
        state.assaultReady = true;
        state.stoneStacks = 5;
      } else if (assault) {
        state.assaultReady = false;
        state.stoneStacks = 0;
      } else {
        state.stoneStacks = Math.min(5, state.stoneStacks + 1);
        if (state.stoneStacks === 5) state.assaultReady = true;
      }
      const cooldown = serpentKind === 'fist' ? (stimulateActive ? 1500 : 2500) : (stimulateActive ? 5000 : 8000);
      state.serpentReady = endMs + cooldown;
    }

    if (offensive && endMs < state.neptuneUntil && endMs >= state.nextNeptune) {
      events.push(hitEvent('neptune', 160, '攻擊命中且尼普頓 4.5 秒觸發已就緒'));
      state.nextNeptune = endMs + 4500;
    }

    state.t = endMs;
    accrueSearchCharges(state, endMs);
    state.score += events.reduce((sum, event) => sum + event.hits, 0);
    state.depth += 1;
    state.trail = { actionId, previous: previous.trail };
    return { state, startMs, endMs, units, reason, events };
  }

  function hitEvent(skillId, hits, reason) { return { skillId, hits, reason }; }

  function searchKey(state) {
    const q = value => Number.isFinite(value) ? Math.round(value / 150) : -1;
    return [q(state.t), state.charges, q(state.nextRechargeMs), state.originUsed ? 1 : 0,
      state.howlingUsed ? 1 : 0, state.meltdownUsed ? 1 : 0, state.balls,
      q(state.meltdownUntil), q(state.nautilusReady), q(state.chargeReady),
      q(state.serpentReady), state.stoneStacks, state.assaultReady ? 1 : 0,
      q(state.fistBuffUntil), q(state.superUntil), q(state.neptuneUntil), q(state.nextNeptune)
    ].join('|');
  }

  function optimisticScore(state, options) {
    const remaining = Math.max(0, WINDOW_MS - state.t);
    const originLock = state.originUsed ? 0 : searchLock('origin', options);
    const howlingLock = state.howlingUsed ? 0 : searchLock('howling', options);
    const meltdownLock = state.meltdownUsed ? state.balls * searchLock('meltdownBall', options) : searchLock('meltdownStart', options) + 3 * searchLock('meltdownBall', options);
    const reservedMs = originLock + howlingLock + meltdownLock;
    let estimate = state.score + Math.floor(Math.max(0, remaining - reservedMs) / searchLock('filler', options)) * (35 + options.superFistBonus);
    if (!state.originUsed) {
      const originEnd = state.t + searchLock('origin', options);
      const triggerCount = Math.max(0, Math.min(7, Math.ceil((WINDOW_MS - originEnd) / 4500)));
      estimate += 4620 + triggerCount * 160;
    } else if (state.t < state.neptuneUntil) estimate += Math.max(0, Math.ceil((state.neptuneUntil - Math.max(state.t, state.nextNeptune)) / 4500)) * 160;
    if (!state.howlingUsed) estimate += 1811;
    if (!state.meltdownUsed) estimate += options.meltdownBallHits * 3;
    else estimate += state.balls * options.meltdownBallHits;
    estimate += state.charges * 100;
    return estimate;
  }

  function optimizeRotation(options) {
    let beam = [createSearchState(options)];
    let exploredStates = 0;
    let terminal = beam[0];
    const maxDepth = 260;
    for (let depth = 0; depth < maxDepth && beam.length; depth += 1) {
      const deduped = new Map();
      let expanded = false;
      for (const candidate of beam) {
        const actions = searchActions(candidate, options);
        if (!actions.length) {
          if (candidate.score > terminal.score) terminal = candidate;
          continue;
        }
        expanded = true;
        for (const actionId of actions) {
          const next = searchTransition(candidate, actionId, options).state;
          exploredStates += 1;
          const key = searchKey(next);
          const kept = deduped.get(key);
          if (!kept || next.score > kept.score) deduped.set(key, next);
        }
      }
      if (!expanded) break;
      beam = Array.from(deduped.values()).sort((a, b) => optimisticScore(b, options) - optimisticScore(a, options) || b.score - a.score).slice(0, SEARCH_BEAM_WIDTH);
      for (const candidate of beam) if (candidate.score > terminal.score) terminal = candidate;
    }
    for (const candidate of beam) if (candidate.score > terminal.score) terminal = candidate;
    const path = [];
    for (let node = terminal.trail; node; node = node.previous) path.push(node.actionId);
    path.reverse();
    return { path, terminal, exploredStates, beamWidth: SEARCH_BEAM_WIDTH };
  }

  function simulateOptimizer(options) {
    const search = optimizeRotation(options);
    const state = createState(options);
    schedulePrecasts(state);
    state.countdown.push({ skillId: 'stimulate', startMs: -450, label: '預先施放，0 秒起進入 80 秒最大海龍石視窗' });
    addAction(state, { type: 'background', skillId: 'stimulate', startMs: -450, endMs: 80000, reason: '客戶端動作 450ms；Buff 80 秒、海龍之怒冷卻改 1.5 秒。' });
    let replay = createSearchState(options);
    for (const actionId of search.path) {
      const transition = searchTransition(replay, actionId, options);
      const skillId = actionId.startsWith('meltdown') ? 'meltdown' : actionId;
      const action = addAction(state, { skillId, startMs: transition.startMs, endMs: transition.endMs, units: transition.units, reason: transition.reason });
      for (const event of transition.events) {
        if (event.spreadMs) scheduleDistributedHits(state, event.skillId, transition.endMs, event.spreadMs, event.hits, event.spreadCount, event.reason, action.id);
        else addHit(state, { skillId: event.skillId, timeMs: transition.endMs, hits: event.hits, reason: event.reason, parentId: action.id });
      }
      replay = transition.state;
    }
    if (replay.originEndMs >= 0) scheduleStatusWindows(state, replay.originEndMs);
    state.chargeGenerated = replay.generated;
    state.chargeSpent = replay.spent;
    state.chargeOverflow = replay.overflow;
    const loop = { charges: replay.charges };
    const summary = summarize(state, loop);
    summary.search = {
      algorithm: 'Beam Search', beamWidth: search.beamWidth, exploredStates: search.exploredStates,
      scoredForegroundHits: search.terminal.score, provenOptimal: false
    };
    const rows = audit(state, summary).filter(row => row.title !== '中心模型對帳失敗' && row.title !== '自訂模型已啟用');
    rows.unshift(auditRow('pass', '施放順序由搜尋器產生', `實際擴展 ${search.exploredStates.toLocaleString('zh-TW')} 個合法狀態，Beam 寬度 ${search.beamWidth}。`));
    rows.push(auditRow('warning', '不是數學上的窮舉證明', 'Beam Search 會保留最有潛力的候選解；未解的持續攻擊頻率仍會影響最終次序。'));
    return Object.freeze({
      modelId: MODEL_ID, dataBuild: DATA_BUILD, options, preset: PRESETS.optimizer,
      windowMs: WINDOW_MS, skills: SKILLS, groups: GROUPS,
      countdown: state.countdown.slice().sort((a, b) => a.startMs - b.startMs),
      actions: state.actions.slice().sort(sortByStart),
      hits: state.hits.slice().sort((a, b) => a.timeMs - b.timeMs || a.id - b.id),
      summary, audit: rows, assumptions: optimizerAssumptions(options)
    });
  }

  function optimizerAssumptions(options) {
    return [
      '結算視窗固定為 0 ≤ hit_time < 120,000ms；搜尋目標是單體頂傷環境的總段數。',
      `Beam Search 寬度 ${SEARCH_BEAM_WIDTH}；會搜尋起源、海龍正拳、海之霸主與三顆球、戰艦、海龍衝鋒、閃連殺的合法順序。`,
      '暴能續發由 -0.450s 預放；前 80 秒使海龍石處於最大狀態，拳技觸發冷卻 1.5 秒，其後回到 2.5 秒。',
      '海龍石、突擊狀態、海龍之怒／爆裂共享冷卻、15 秒海龍強化、5 秒超級閃連殺都逐事件更新。',
      `海龍突擊之怒 5 秒持續物件暫以 ${options.assaultEnrageHits} 段，超級閃連殺每拳暫加 ${options.superFistBonus} 段；這兩個 Server cadence 尚未從客戶端表完整解出。`,
      `海之霸主每顆球暫以 ${options.meltdownBallHits} 段校正；搜尋器會決定發射時點，但不會偽稱持續命中頻率已精確解出。`,
      '戰艦追加以 0.15 秒觸發窗近似攻擊動作內可用節點；此為根據客戶端 ICD 的事件估計，不是封包實測 cadence。',
      '海龍螺旋仍採現行 80 次、每次 24 段的實戰中心帳本；鏡之蜘蛛預放時計 276 段。'
    ];
  }

  function assumptionsFor(options) {
    return [
      '結算視窗固定為 0 ≤ hit_time < 120,000ms；單一固定 Boss、全程命中、以頂傷環境總段數為目標。',
      `開場海龍衝鋒 ${options.startingCharges}/6 層；每 5 秒補充 1 層、上限 6，${options.freeMode ? '使用自由模式一次清空開場層數' : '逐層施放並遵守 0.5 秒技能冷卻'}。`,
      '海龍霸拳 Activator 動作鎖 4,320ms；根技能 4,620 段，30 秒內尼普頓之怒以 4.5 秒間隔觸發 7 次、每次 160 段。',
      '閃・連殺VI 動作鎖 570ms；中心預設 130 次。海龍強化前按 15 段，之後按 17 段，中心合計 2,200 段。',
      '海龍衝鋒自由／單次 Activator 動作均為 300ms；中心由 6 層開場加 23 次補充，共 29 次、2,668 段。',
      '海之霸主每顆能量球動作暫採 1,260ms Attack activator，持續 6 秒；三顆總段數仍採中心實測校正 1,500。',
      '戰艦鯨魚號直接動作 900ms、每次 5 段；直接傷害與 0.15 秒追加爆炸合計校正為 3,000 段。',
      '海龍之怒／海龍突擊之怒／超級閃・連殺合併校正 2,700 段；等 Server cadence 完整解出後應拆成獨立技能。',
      `${options.precastSpider ? '鏡之蜘蛛於 -1.080s 預放，計入 276 段。' : '本次停用鏡之蜘蛛，相關傷害為 0。'}`
    ];
  }

  function simulate(input) {
    const options = normalizeOptions(input || {});
    if (options.preset === 'optimizer') return simulateOptimizer(options);
    const state = createState(options);
    schedulePrecasts(state);
    const opening = scheduleOpening(state);
    const loop = scheduleLoop(state, opening);
    scheduleOriginFollowups(state, opening.originEndMs);
    scheduleCalibrationBundles(state);
    scheduleStatusWindows(state, opening.originEndMs);
    const summary = summarize(state, loop);
    return Object.freeze({
      modelId: LEGACY_MODEL_ID, dataBuild: DATA_BUILD, options, preset: PRESETS[options.preset],
      windowMs: WINDOW_MS, skills: SKILLS, groups: GROUPS,
      countdown: state.countdown.slice().sort((a, b) => a.startMs - b.startMs),
      actions: state.actions.slice().sort(sortByStart),
      hits: state.hits.slice().sort((a, b) => a.timeMs - b.timeMs || a.id - b.id),
      summary, audit: audit(state, summary), assumptions: assumptionsFor(options)
    });
  }

  function exportResult(result) {
    return {
      modelId: result.modelId, dataBuild: result.dataBuild, generatedAt: new Date().toISOString(),
      windowMs: result.windowMs, options: result.options,
      summary: { ...result.summary, bySkill: Object.values(result.summary.bySkill).filter(row => row.hits || row.uses) },
      actions: result.actions, hitEvents: result.hits, audit: result.audit, assumptions: result.assumptions
    };
  }

  function auditRow(level, title, detail) { return { level, title, detail }; }
  function sortByStart(a, b) { return a.startMs - b.startMs || a.endMs - b.endMs || a.id - b.id; }
  function formatTime(ms) { return `${(ms / 1000).toFixed(3)}s`; }
  function formatNumber(value) { return new Intl.NumberFormat('zh-TW').format(Math.round(value || 0)); }

  return Object.freeze({ WINDOW_MS, MODEL_ID, LEGACY_MODEL_ID, DATA_BUILD, GROUPS, SKILLS, PRESETS, normalizeOptions, simulate, optimizeRotation, exportResult, formatTime, formatNumber });
});
