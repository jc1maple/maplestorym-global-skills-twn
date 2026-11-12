/* 2026-11 refinements. Presentation only: the generated cards in index.html stay the source of truth. */
(() => {
  'use strict';

  // --- 1. Readable card meta --------------------------------------------------------------------
  // "技能樹 / 職業專屬 / First / Active / Open Lv 3 / MaxLv 10" -> "一轉・主動・Lv.3 開放・最高 10 級"
  const LAYER = { First: '一轉', Second: '二轉', Third: '三轉', Fourth: '四轉', Hyper: '超技能', LinkSkill: '連結技能' };
  const TYPE = { Active: '主動', Passive: '被動', Buff: 'Buff' };
  const DROP = new Set(['技能樹', 'VSkill', 'HexaCoreSkill', 'Mastery', 'Origin']);

  function readableMeta(raw) {
    const kind = [];   // 一轉 / 主動 / V 強化核心 3 ...
    const scope = [];  // only when it is not the default 職業專屬
    const levels = [];
    for (const token of raw.split(' / ').map(part => part.trim()).filter(Boolean)) {
      let match;
      if (DROP.has(token) || /^\d+$/.test(token)) continue; // internal table names and row numbers
      if (LAYER[token]) kind.push(LAYER[token]);
      else if (TYPE[token]) kind.push(TYPE[token]);
      else if (token === '職業專屬') continue;
      else if (/共通$/.test(token)) scope.push(token);
      else if ((match = token.match(/^Open Lv (\d+)$/))) levels.push(`Lv.${match[1]} 開放`);
      else if ((match = token.match(/^MaxLv (\d+)$/))) { if (match[1] !== '1') levels.push(`最高 ${match[1]} 級`); }
      else if ((match = token.match(/^CoreLv (\d+)$/))) { if (match[1] !== '1') levels.push(`核心 ${match[1]} 級`); }
      else kind.push(token);
    }
    return [...kind, ...scope, ...levels].join('・');
  }

  for (const meta of document.querySelectorAll('.skill-meta')) {
    const raw = meta.textContent.trim();
    meta.dataset.rawMeta = raw;
    meta.textContent = readableMeta(raw);
  }

  // --- 2. Lv.200 sub-groups ---------------------------------------------------------------------
  // The V Matrix section mixes four kinds of cores; group them and follow the six enhancement cores.
  function subgroupOf(card) {
    const core = card.dataset.core;
    if (core === 'v_boost') {
      // One heading for all six enhancement cores; the number badge on the icon says which core a skill belongs to.
      const number = Number((card.querySelector('.skill-meta')?.dataset.rawMeta || '').match(/^V 強化核心 (\d)/)?.[1] || 0);
      const icon = card.querySelector('.skill-icon');
      if (number && icon) icon.dataset.coreNumber = String(number);
      return { key: 'boost', order: 10, label: '強化核心', note: '圖示數字為第幾顆核心', rank: number || 7 };
    }
    if (core === 'v_special') return { key: 'special', order: 30, label: '特殊核心', note: '同時只能裝備 1 個' };
    if (core === 'v_skill' && card.dataset.scope === 'job') return { key: 'job', order: 0, label: '技能核心' };
    return { key: 'shared', order: 20, label: '共用核心' };
  }

  const subheads = [];
  for (const grid of document.querySelectorAll('.stage-section[data-stage-group="lv200"] > .skill-grid')) {
    const groups = new Map();
    for (const card of grid.querySelectorAll(':scope > .skill-card')) {
      const info = subgroupOf(card);
      if (!groups.has(info.key)) groups.set(info.key, { ...info, cards: [] });
      if (info.rank) card.subgroupRank = info.rank;
      groups.get(info.key).cards.push(card);
    }
    if (groups.size < 2) continue;
    const fragment = document.createDocumentFragment();
    let slot = 0;
    for (const group of [...groups.values()].sort((a, b) => a.order - b.order)) {
      slot += 10;
      const head = document.createElement('div');
      head.className = 'skill-subhead';
      head.setAttribute('role', 'heading');
      head.setAttribute('aria-level', '4');
      head.textContent = group.label;
      const note = document.createElement('small');
      head.append(note);
      // The stylesheet orders cards by type with CSS `order`; keep that inside each sub-group and put its heading first.
      head.style.order = String(slot);
      for (const card of group.cards) card.style.order = String(slot + 1 + (card.subgroupRank ?? (Number(getComputedStyle(card).order) || 0)));
      fragment.append(head, ...group.cards);
      subheads.push({ head, note, cards: group.cards, text: group.note || '' });
    }
    grid.append(fragment);
  }

  function syncSubheads() {
    for (const { head, note, cards, text } of subheads) {
      const visible = cards.filter(card => !card.hidden).length;
      head.hidden = visible === 0;
      note.textContent = [String(visible), text].filter(Boolean).join('・');
    }
  }
  document.addEventListener('skills:filter-applied', syncSubheads);
  syncSubheads();

  // --- 3. Sticky toolbar sits flush under the real header ------------------------------------------
  const pageHeader = document.querySelector('header.page-header');
  const measureHeader = () => {
    if (pageHeader) document.documentElement.style.setProperty('--measured-header', `${Math.round(pageHeader.getBoundingClientRect().height)}px`);
  };
  measureHeader();
  window.addEventListener('resize', measureHeader);

  // --- 4. Phones start in the compact list ------------------------------------------------------
  if (window.matchMedia('(max-width: 680px)').matches) document.getElementById('view-list')?.click();
})();
