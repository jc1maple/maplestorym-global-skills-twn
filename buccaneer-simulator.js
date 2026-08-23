(function initializeBuccaneerSimulator() {
  'use strict';

  const core = window.BuccaneerSimulatorCore;
  if (!core) throw new Error('BuccaneerSimulatorCore is required');

  const STORE_KEY = 'maplestorym-buccaneer-simulator-v1';
  const TRACKS = ['origin', 'neptune', 'howling', 'meltdown', 'charge', 'filler', 'nautilus', 'serpent', 'lordDeep', 'spider', 'armorBreak'];
  const dom = {
    results: document.querySelector('.hs-results'), form: byId('bs-controls'), preset: byId('bs-preset'),
    presetHelp: byId('bs-preset-help'), startingCharges: byId('bs-start-charges'), freeMode: byId('bs-free-mode'),
    spider: byId('bs-spider'), reset: byId('bs-reset'), totalHits: byId('bs-total-hits'), hitRange: byId('bs-hit-range'),
    actionCount: byId('bs-action-count'), busyTime: byId('bs-busy-time'), chargeCount: byId('bs-charge-count'),
    chargeDetail: byId('bs-charge-detail'), calibratedHits: byId('bs-calibrated-hits'), calibratedShare: byId('bs-calibrated-share'),
    legend: byId('bs-legend'), countdown: byId('bs-countdown'), timeline: byId('bs-timeline'), breakdown: byId('bs-breakdown'),
    audit: byId('bs-audit'), assumptions: byId('bs-assumption-list'), actionFilter: byId('bs-action-filter'),
    actionRows: byId('bs-action-rows'), exportButton: byId('bs-export')
  };
  let currentResult = null;
  let renderTimer = 0;

  function byId(id) { return document.getElementById(id); }

  function presetToControls(presetId) {
    const preset = core.PRESETS[presetId] || core.PRESETS.center;
    dom.preset.value = preset.id;
    dom.presetHelp.textContent = preset.help;
  }

  function optionsFromControls() {
    return {
      preset: dom.preset.value,
      startingCharges: Number(dom.startingCharges.value),
      freeMode: dom.freeMode.checked,
      precastSpider: dom.spider.checked
    };
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(runSimulation, 50);
  }

  function runSimulation() {
    dom.results.setAttribute('aria-busy', 'true');
    currentResult = core.simulate(optionsFromControls());
    render(currentResult);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(optionsFromControls())); } catch (_) { /* optional */ }
    dom.results.setAttribute('aria-busy', 'false');
  }

  function render(result) {
    const summary = result.summary;
    dom.totalHits.textContent = formatNumber(summary.totalHits);
    dom.hitRange.textContent = isCenter(result) ? '中心事件帳本對帳 21,744 · 嚴格 [0, 120s)' : `${result.preset.label} · 嚴格 [0, 120s)`;
    dom.actionCount.textContent = formatNumber(summary.actionCount);
    dom.busyTime.textContent = `占用 ${formatSeconds(summary.busyMs)} · 空檔 ${formatSeconds(summary.idleMs)}`;
    dom.chargeCount.textContent = `${formatNumber(summary.charge.spent)} 次`;
    dom.chargeDetail.textContent = `起始 ${summary.charge.start}＋補充 ${summary.charge.generated} · 溢出 ${summary.charge.overflow}`;
    dom.calibratedHits.textContent = formatNumber(summary.calibratedHits);
    dom.calibratedShare.textContent = `占總段數 ${(summary.calibratedHits / Math.max(1, summary.totalHits) * 100).toFixed(1)}% · 頁面明確標記`;
    dom.presetHelp.textContent = result.preset.help;
    renderLegend(result);
    renderCountdown(result);
    renderTimeline(result);
    renderBreakdown(result);
    renderAudit(result);
    dom.assumptions.innerHTML = result.assumptions.map(item => `<li>${escapeHtml(item)}</li>`).join('');
    renderActionRows(result, dom.actionFilter.value);
  }

  function renderLegend(result) {
    dom.legend.innerHTML = Object.values(result.groups).map(group => `<span><i style="background:${escapeAttr(group.color)}"></i>${escapeHtml(group.label)}</span>`).join('');
  }

  function renderCountdown(result) {
    dom.countdown.innerHTML = result.countdown.map(item => {
      const skill = result.skills[item.skillId];
      return `<span class="hs-countdown-item"><img src="${escapeAttr(skill.icon)}" alt=""><b>${formatSignedTime(item.startMs)}</b>${escapeHtml(skill.name)} · ${escapeHtml(item.label)}</span>`;
    }).join('');
  }

  function renderTimeline(result) {
    const actionMap = groupBy(result.actions.filter(action => action.startMs >= 0 && action.startMs < result.windowMs), 'skillId');
    const hitMap = groupBy(result.hits, 'skillId');
    const ticks = Array.from({ length: 13 }, (_, index) => `<i class="hs-time-tick" style="left:${index / 12 * 100}%"><span>${index * 10}s</span></i>`).join('');
    const tracks = TRACKS.map(skillId => {
      const skill = result.skills[skillId];
      const group = result.groups[skill.group];
      const actions = actionMap.get(skillId) || [];
      const hits = hitMap.get(skillId) || [];
      const summary = result.summary.bySkill[skillId];
      const blocks = actions.filter(action => action.endMs > action.startMs).map(action => {
        const left = action.startMs / result.windowMs * 100;
        const width = Math.max(.18, (action.endMs - action.startMs) / result.windowMs * 100);
        const stateClass = action.type === 'background' ? ' hs-timeline-block--state' : '';
        return `<span class="hs-timeline-block${stateClass}" style="left:${left}%;width:${width}%;background:${escapeAttr(group.color)}" title="${escapeAttr(`${formatTime(action.startMs)}–${formatTime(action.endMs)} ${skill.name}｜${action.reason}`)}"><span>${width > 1.8 ? escapeHtml(shortName(skill.name)) : ''}</span></span>`;
      }).join('');
      const stride = Math.max(1, Math.ceil(hits.length / 75));
      const pins = hits.filter((_, index) => index % stride === 0).map(hit => `<i class="hs-timeline-pin hs-timeline-pin--background" style="left:${hit.timeMs / result.windowMs * 100}%" title="${escapeAttr(`${formatTime(hit.timeMs)} ${skill.name} ${formatNumber(hit.hits)}段`) }"></i>`).join('');
      return `<div class="hs-track"><div class="hs-track-label"><img src="${escapeAttr(skill.icon)}" alt=""><span><b>${escapeHtml(skill.name)}</b><small>${formatNumber(summary.uses)} 次 · ${formatNumber(summary.hits)} 段</small></span></div><div class="hs-track-lane">${blocks}${pins}</div></div>`;
    }).join('');
    dom.timeline.style.setProperty('--hs-track-count', TRACKS.length);
    dom.timeline.innerHTML = `<div class="hs-time-ruler">${ticks}</div>${tracks}`;
  }

  function renderBreakdown(result) {
    const rows = Object.values(result.summary.bySkill).filter(row => row.hits > 0).sort((a, b) => b.hits - a.hits);
    const max = rows[0]?.hits || 1;
    dom.breakdown.innerHTML = rows.map(row => {
      const skill = result.skills[row.skillId];
      const share = row.hits / result.summary.totalHits * 100;
      const calibrated = ['nautilus', 'meltdown', 'serpent'].includes(row.skillId) ? '<em class="bs-calibrated-tag">校正</em>' : '';
      return `<div class="hs-breakdown-row"><div class="hs-breakdown-skill"><img src="${escapeAttr(skill.icon)}" alt=""><span><b>${escapeHtml(skill.name)}${calibrated}</b><small>${formatNumber(row.uses)} 次施放 · ${formatNumber(row.hitEvents)} 個命中事件</small></span></div><div class="hs-breakdown-bar"><i style="width:${row.hits / max * 100}%"></i></div><div class="hs-breakdown-hits">${formatNumber(row.hits)}</div><div class="hs-breakdown-share">${share.toFixed(1)}%</div></div>`;
    }).join('');
  }

  function renderAudit(result) {
    dom.audit.innerHTML = result.audit.map(item => {
      const marker = item.level === 'pass' ? '✓' : item.level === 'error' ? '!' : '△';
      return `<div class="hs-audit-item is-${escapeAttr(item.level)}"><span class="hs-audit-icon">${marker}</span><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.detail)}</small></span></div>`;
    }).join('');
  }

  function renderActionRows(result, filter) {
    const rows = buildRows(result, filter);
    dom.actionRows.innerHTML = rows.map((row, index) => {
      const skill = result.skills[row.skillId];
      const group = result.groups[skill.group];
      const tag = row.kind === 'hit' ? '命中' : row.type === 'background' ? '狀態' : '按鍵';
      const charge = row.skillId === 'charge' && row.kind === 'action' ? `消耗 ${row.units}` : '—';
      return `<tr><td class="hs-event-index">${index + 1}</td><td class="hs-event-time">${formatTime(row.startMs)}</td><td class="hs-event-time">${row.endMs === row.startMs ? '—' : formatTime(row.endMs)}</td><td><div class="hs-event-skill"><img src="${escapeAttr(skill.icon)}" alt=""><span><b>${escapeHtml(skill.name)}<em class="hs-event-tag" style="color:${escapeAttr(group.color)}">${tag}</em></b><small>${escapeHtml(group.label)}</small></span></div></td><td class="hs-event-hits">${row.hits == null ? '—' : formatNumber(row.hits)}</td><td class="hs-event-energy">${charge}</td><td class="hs-event-reason">${escapeHtml(row.reason || '')}</td></tr>`;
    }).join('');
  }

  function buildRows(result, filter) {
    if (filter === 'background') return result.hits.map(hit => ({ kind: 'hit', type: 'background', skillId: hit.skillId, startMs: hit.timeMs, endMs: hit.timeMs, hits: hit.hits, reason: hit.reason }));
    const actions = result.actions.filter(action => action.startMs >= 0).filter(action => filter === 'all' || action.type === 'foreground').map(action => ({ ...action, kind: 'action', hits: aggregateActionHits(result, action.id) }));
    if (filter !== 'all') return actions.sort(sortRows);
    const hits = result.hits.map(hit => ({ kind: 'hit', type: 'background', skillId: hit.skillId, startMs: hit.timeMs, endMs: hit.timeMs, hits: hit.hits, reason: hit.reason }));
    return actions.concat(hits).sort(sortRows);
  }

  function aggregateActionHits(result, actionId) { return result.hits.filter(hit => hit.parentId === actionId).reduce((sum, hit) => sum + hit.hits, 0); }
  function sortRows(a, b) { return a.startMs - b.startMs || (a.kind === 'action' ? -1 : 1); }
  function groupBy(list, key) { const map = new Map(); list.forEach(item => { const value = item[key]; if (!map.has(value)) map.set(value, []); map.get(value).push(item); }); return map; }
  function shortName(name) { return name.replace(/（.*?）/g, '').replace('海龍', '海龍'); }
  function isCenter(result) { return result.options.preset === 'center' && result.options.startingCharges === 6 && result.options.freeMode && result.options.precastSpider; }
  function formatNumber(value) { return new Intl.NumberFormat('zh-TW').format(Math.round(value || 0)); }
  function formatSeconds(ms) { return `${(ms / 1000).toFixed(2)} 秒`; }
  function formatTime(ms) { return `${(ms / 1000).toFixed(3)}s`; }
  function formatSignedTime(ms) { return `${ms < 0 ? '-' : '+'}${Math.abs(ms / 1000).toFixed(3)}s`; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

  function exportJson() {
    if (!currentResult) return;
    const blob = new Blob([JSON.stringify(core.exportResult(currentResult), null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `buccaneer-120s-${currentResult.options.preset}-${currentResult.summary.totalHits}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (_) { /* ignore */ }
    const value = core.normalizeOptions(saved || { preset: 'center' });
    presetToControls(value.preset);
    dom.startingCharges.value = value.startingCharges;
    dom.freeMode.checked = value.freeMode;
    dom.spider.checked = value.precastSpider;
  }

  dom.preset.addEventListener('change', () => { presetToControls(dom.preset.value); scheduleRender(); });
  dom.form.addEventListener('input', scheduleRender);
  dom.actionFilter.addEventListener('change', () => currentResult && renderActionRows(currentResult, dom.actionFilter.value));
  dom.reset.addEventListener('click', () => { presetToControls('center'); dom.startingCharges.value = 6; dom.freeMode.checked = true; dom.spider.checked = true; runSimulation(); });
  dom.exportButton.addEventListener('click', exportJson);
  restore();
  runSimulation();
})();
