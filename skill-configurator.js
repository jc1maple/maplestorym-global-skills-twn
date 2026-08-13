(() => {
  'use strict';

  const openButton = document.getElementById('skill-config-open');
  const jobSelect = document.getElementById('job');
  if (!openButton || !jobSelect) return;

  const STORE_KEY = 'maplestorym-skill-config-v2';
  const queryApi = new URLSearchParams(window.location.search).get('skill_api');
  const configuredApi = String(window.MSM_SKILL_CONFIG_ENDPOINT || window.MSM_VISITOR_LOG_ENDPOINT || '');
  const CONFIG_ENDPOINT = resolveConfigEndpoint(queryApi, configuredApi);
  const COMBO_REF_PREFIX = '@combo:';
  const MODE_LABELS = {
    mobile: ['技能按鍵', '依照遊戲 Type B 技能盤配置；與 PC 鍵盤相同鍵位雙向同步。'],
    combo: ['組合技能', '依照遊戲 Preset 8×8 結構：P1–P8，每組可依序放入 8 個技能。'],
    pc: ['PC 鍵盤配置', '兩頁快捷欄與技能圓盤相同鍵位雙向同步；功能快捷欄獨立設定。']
  };
  const TYPE_LABELS = { active: '主動', buff: 'BUFF', combo: '組合技能' };
  const DEFAULT_KEYS = {
    mobile: ['T', 'Tab', 'Delete', 'W', 'E', 'R', 'Q', 'Enter'],
    pc: [
      ['Q', 'W', 'E', 'R', 'T', 'Tab', 'Delete', 'Enter'],
      ['A', 'S', 'D', 'F', 'L.Alt', 'PgDn', 'R.Ctrl', 'R.Shift']
    ],
    functions: ['1', '2', '3', '4']
  };
  // Type B round-pad positions: T, Tab, Delete / W, E, R / Q, Enter.
  // PC pages list keys horizontally: Q, W, E, R, T, Tab, Delete, Enter.
  const MOBILE_TO_PC = [4, 5, 6, 1, 2, 3, 0, 7];
  const PC_TO_MOBILE = [6, 3, 4, 5, 0, 1, 2, 7];

  const state = {
    mode: 'mobile',
    mobilePage: 0,
    comboGroup: 0,
    libraryType: 'all',
    libraryQuery: '',
    target: null,
    recording: null,
    skills: [],
    skillMap: new Map(),
    skillAliases: new Map(),
    skillsReady: false,
    configs: loadStore(),
    configRevisions: new Map(),
    publishedDefaults: new Map(),
    defaultRequests: new Map(),
    defaultRequestVersions: new Map(),
    toastTimer: 0,
    metaSaveTimer: 0,
    noteSaveTimer: 0,
    workspaceRenderVersion: 0,
    submitting: false,
    applyingPublishedDefault: false,
    returnFocus: null,
    submitReturnFocus: null,
    pageBackground: [],
    submitBackground: [],
    submissionKey: '',
    submissionFingerprint: ''
  };

  const shell = document.createElement('div');
  shell.className = 'sc-shell';
  shell.hidden = true;
  shell.innerHTML = `
    <section class="sc-app" role="dialog" aria-modal="true" aria-labelledby="sc-title">
      <header class="sc-topbar">
        <div class="sc-title">
          <span class="sc-eyebrow">MAPLESTORY M · GAME UI</span>
          <h2 id="sc-title">技能</h2>
        </div>
        <span class="sc-job-chip" id="sc-job-name"></span>
        <button class="sc-close" type="button" aria-label="關閉技能配置">×</button>
      </header>
      <nav class="sc-tabs" aria-label="配置模式">
        <button class="sc-tab" type="button" data-mode="mobile" role="tab" aria-selected="true">技能按鍵</button>
        <button class="sc-tab" type="button" data-mode="combo" role="tab" aria-selected="false">組合技能 <span>8×8</span></button>
        <button class="sc-tab" type="button" data-mode="pc" role="tab" aria-selected="false">PC 鍵盤</button>
      </nav>
      <div class="sc-main">
        <section class="sc-workspace" aria-live="polite"></section>
        <aside class="sc-library">
          <div class="sc-library-head">
            <h3>可配置技能</h3>
            <input class="sc-search" type="search" placeholder="搜尋技能名稱…" aria-label="搜尋可配置技能">
          </div>
          <div class="sc-library-filters" aria-label="技能類型">
            <button class="sc-filter is-active" type="button" data-type="all">全部</button>
            <button class="sc-filter" type="button" data-type="active">主動</button>
            <button class="sc-filter" type="button" data-type="buff">BUFF</button>
            <button class="sc-filter" type="button" data-type="combo">組合</button>
          </div>
          <div class="sc-palette"></div>
          <div class="sc-library-note">先點左側欄位，再點技能即可配置；P1–P8 可放進技能按鍵與 PC 鍵盤，但不能放進另一個組合或功能快捷欄。</div>
        </aside>
      </div>
      <footer class="sc-footer">
        <button class="sc-button is-suggestion" type="button" data-action="apply-default" title="以站長審核發布的配置覆蓋目前職業草稿">套用建議</button>
        <button class="sc-button is-danger" type="button" data-action="clear">清空目前</button>
        <button class="sc-button" type="button" data-action="save">儲存草稿</button>
        <button class="sc-button is-primary" type="button" data-action="submit">提交建議</button>
      </footer>
      <div class="sc-toast" role="status"></div>
      <div class="sc-submit-overlay" hidden>
        <form class="sc-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-submit-title">
          <div class="sc-submit-head">
            <div>
              <span>PLAYER RECOMMENDATION</span>
              <h3 id="sc-submit-title">提交技能配置建議</h3>
            </div>
            <button type="button" class="sc-submit-close" aria-label="關閉提交視窗">×</button>
          </div>
          <p class="sc-submit-summary"></p>
          <label class="sc-submit-field">
            <span>玩家名稱（選填）</span>
            <input name="submitter_name" maxlength="40" autocomplete="nickname" placeholder="方便站長辨識這份建議">
          </label>
          <label class="sc-submit-field">
            <span>配置說明（選填）</span>
            <textarea name="message" maxlength="500" rows="4" placeholder="例如：打王配置、練等配置，或推薦這樣安排的原因"></textarea>
          </label>
          <label class="sc-honeypot" aria-hidden="true">網站<input name="website" tabindex="-1" autocomplete="off"></label>
          <p class="sc-submit-note">會送出目前職業的兩頁技能按鍵、8 組組合技能、PC 鍵盤配置、每個按鍵的使用註記，以及職業爆發與整體玩法說明。</p>
          <p class="sc-submit-error" role="alert"></p>
          <div class="sc-submit-actions">
            <button type="button" class="sc-button sc-submit-cancel">取消</button>
            <button type="submit" class="sc-button is-primary sc-submit-confirm">確認提交</button>
          </div>
        </form>
      </div>
    </section>`;
  document.body.appendChild(shell);

  const app = shell.querySelector('.sc-app');
  const mainPanel = shell.querySelector('.sc-main');
  const workspace = shell.querySelector('.sc-workspace');
  const palette = shell.querySelector('.sc-palette');
  const searchInput = shell.querySelector('.sc-search');
  const jobChip = shell.querySelector('#sc-job-name');
  const closeButton = shell.querySelector('.sc-close');
  const toast = shell.querySelector('.sc-toast');
  const submitOverlay = shell.querySelector('.sc-submit-overlay');
  const submitForm = shell.querySelector('.sc-submit-dialog');
  const submitSummary = shell.querySelector('.sc-submit-summary');
  const submitError = shell.querySelector('.sc-submit-error');
  const submitConfirm = shell.querySelector('.sc-submit-confirm');
  const applyDefaultButton = shell.querySelector('[data-action="apply-default"]');
  const clearButton = shell.querySelector('[data-action="clear"]');

  function normalizedHttpEndpoint(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch (_) {
      return '';
    }
  }

  function isLoopbackHost(hostname) {
    const host = String(hostname || '').toLocaleLowerCase('en-US');
    return host === '127.0.0.1' || host === '[::1]' || host === '::1' || host === 'localhost' || host.endsWith('.localhost');
  }

  function resolveConfigEndpoint(override, configured) {
    const fallback = normalizedHttpEndpoint(configured);
    const candidate = normalizedHttpEndpoint(override);
    if (!candidate) return fallback;
    try {
      const url = new URL(candidate);
      const officialOrigin = 'https://maplestorym-skills-visitor-logger.ace1eetfps.workers.dev';
      const isOfficial = url.protocol === 'https:' && candidate === officialOrigin;
      const isLocalDevelopment = isLoopbackHost(url.hostname);
      return isOfficial || isLocalDevelopment ? candidate : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveStore(message = '') {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.configs));
      if (message) showToast(message);
      return true;
    } catch (_) {
      showToast('無法儲存草稿：瀏覽器儲存空間不可用', 3200);
      return false;
    }
  }

  function configRevision(jobCode = currentJobCode()) {
    return state.configRevisions.get(jobCode) || 0;
  }

  function markConfigEdited(jobCode = currentJobCode()) {
    state.configRevisions.set(jobCode, configRevision(jobCode) + 1);
  }

  function showToast(message, duration = 1500) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), duration);
  }

  function currentJobCode() {
    return jobSelect.value || document.querySelector('.job-section:not([hidden])')?.dataset.job || 'SoulMaster';
  }

  function currentJobName() {
    const code = currentJobCode();
    return [...jobSelect.options].find(option => option.value === code)?.textContent?.trim() || code;
  }

  function comboRef(index) {
    return `${COMBO_REF_PREFIX}${index}`;
  }

  function comboIndexFromRef(value) {
    const match = /^@combo:([0-7])$/.exec(String(value || ''));
    return match ? Number(match[1]) : -1;
  }

  function comboAssignment(index, cfg = config()) {
    if (!Number.isInteger(index) || index < 0 || index > 7) return null;
    const items = cfg.combos?.[index] || [];
    const lead = state.skillMap.get(items.find(id => state.skillMap.has(id)));
    const meta = cfg.comboMeta?.[index] || {};
    const used = items.filter(id => state.skillMap.has(id)).length;
    const name = shortClientText(meta.name || `${index + 1} 號自訂`, 32);
    const description = shortClientText(meta.description || '', 300);
    return {
      id: comboRef(index),
      kind: 'combo',
      comboIndex: index,
      name,
      description,
      icon: lead?.icon || '',
      type: 'combo',
      stage: `P${index + 1} · ${used}/8`,
      used,
      searchable: `P${index + 1} ${name} ${description}`.toLocaleLowerCase('zh-Hant')
    };
  }

  function assignmentForId(id, cfg = config()) {
    const comboIndex = comboIndexFromRef(id);
    if (comboIndex >= 0) return comboAssignment(comboIndex, cfg);
    const skill = state.skillMap.get(id);
    return skill ? { ...skill, kind: 'skill' } : null;
  }

  function canAssignTo(ref, id) {
    if (!ref || !id) return false;
    if (state.skillMap.has(id)) return true;
    return comboIndexFromRef(id) >= 0 && (ref.area === 'mobile' || ref.area === 'pc');
  }

  function assignmentRestrictionMessage(id) {
    return comboIndexFromRef(id) >= 0
      ? '組合技能只能放在技能按鍵或 PC 鍵盤欄位'
      : '這個項目不能放在目前欄位';
  }

  function extractSkills() {
    const section = document.querySelector(`.job-section[data-job="${CSS.escape(currentJobCode())}"]`);
    state.skillAliases = new Map();
    state.skillsReady = Boolean(section);
    if (!section) return [];
    const seenLegacyBases = new Set();
    const stableRecords = new Map();
    return [...section.querySelectorAll('.skill-card')].flatMap((card, index) => {
      const type = card.dataset.type;
      if (!['active', 'buff'].includes(type)) return [];
      const name = card.querySelector('.skill-title h3')?.textContent?.trim() || card.querySelector('.skill-icon img')?.alt || `技能 ${index + 1}`;
      const icon = card.querySelector('.skill-icon img')?.getAttribute('src') || '';
      const code = (card.dataset.text || '').match(/\bskill_[a-z0-9_]+/i)?.[0];
      const legacyBase = code || `${name}|${icon}`;
      const legacyId = seenLegacyBases.has(legacyBase) ? `${legacyBase}|${index}` : legacyBase;
      seenLegacyBases.add(legacyBase);
      const identityTokens = [...new Set((card.dataset.text || '').match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi) || [])]
        .map(token => token.toLocaleLowerCase('en-US'))
        .sort()
        .join('|');
      const identity = [legacyBase, type, card.dataset.stage || '', card.dataset.core || '', card.dataset.scope || '', identityTokens].join('|');
      let id = code ? `${code}|v2:${stableToken(identity)}` : `skill:v2:${stableToken(identity)}`;
      const semantic = [name, icon, type, card.dataset.stage || '', card.dataset.core || '', identityTokens].join('|');
      const existingSemantic = stableRecords.get(id);
      if (existingSemantic && existingSemantic !== semantic) id = `${id}:${stableToken(semantic)}`;
      if (!state.skillAliases.has(legacyBase)) state.skillAliases.set(legacyBase, id);
      state.skillAliases.set(legacyId, id);
      state.skillAliases.set(id, id);
      if (stableRecords.has(id)) return [];
      stableRecords.set(id, semantic);
      return [{
        id,
        name,
        icon,
        type,
        stage: stageLabel(card.dataset.stage),
        searchable: `${name} ${code || ''}`.toLocaleLowerCase('zh-Hant')
      }];
    });
  }

  function stableToken(value) {
    const text = String(value || '');
    let first = 2166136261;
    let second = 2246822507;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 3266489909);
    }
    return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
  }

  function resolvedAssignmentId(value, allowCombo = false) {
    if (value == null || value === '') return null;
    const id = String(value);
    if (allowCombo && comboIndexFromRef(id) >= 0) return id;
    if (!state.skillsReady) return id;
    if (state.skillMap.has(id)) return id;
    const alias = state.skillAliases.get(id);
    if (alias && state.skillMap.has(alias)) return alias;
    const legacyBase = id.replace(/\|\d+$/, '');
    const legacyAlias = state.skillAliases.get(legacyBase);
    return legacyAlias && state.skillMap.has(legacyAlias) ? legacyAlias : null;
  }

  function fixedAssignmentArray(value, length, fallback, allowCombo = false) {
    return fixedArray(value, length, fallback).map(item => resolvedAssignmentId(item, allowCombo));
  }

  function stageLabel(stage) {
    if (!stage) return '';
    if (stage === 'v') return 'V 技能';
    if (stage === 'hexa') return 'HEXA';
    if (stage === 'hyper') return '超技能';
    if (stage === 'origin') return '起源技能';
    return stage.replace(/^lv/i, 'Lv.');
  }

  function makeGeneratedRecommendedConfig() {
    return {
      schemaVersion: 2,
      mobilePages: Array.from({ length: 2 }, () => Array(8).fill(null)),
      combos: Array.from({ length: 8 }, () => Array(8).fill(null)),
      comboMeta: Array.from({ length: 8 }, (_, i) => ({ name: `${i + 1} 號自訂`, description: '' })),
      pc: Array.from({ length: 2 }, () => Array(8).fill(null)),
      functions: Array(4).fill(null),
      slotNotes: {
        mobilePages: Array.from({ length: 2 }, () => Array(8).fill('')),
        pc: Array.from({ length: 2 }, () => Array(8).fill('')),
        functions: Array(4).fill('')
      },
      jobGuide: { description: '' },
      keys: {
        mobile: [...DEFAULT_KEYS.mobile],
        pc: DEFAULT_KEYS.pc.map(row => [...row]),
        functions: [...DEFAULT_KEYS.functions]
      }
    };
  }

  function recommendedForCurrentJob() {
    const published = state.publishedDefaults.get(currentJobCode());
    return cloneValue(published || makeGeneratedRecommendedConfig());
  }

  function normalizeConfig(config, fallback = recommendedForCurrentJob()) {
    const fresh = fallback && typeof fallback === 'object' ? fallback : makeGeneratedRecommendedConfig();
    const source = config && typeof config === 'object' ? config : fresh;
    const legacyMobile = Array.isArray(source.mobile) ? source.mobile : null;
    const mobilePages = Array.from({ length: 2 }, (_, page) => fixedAssignmentArray(
      source.mobilePages?.[page] || (page === 0 ? legacyMobile : null),
      8,
      fresh.mobilePages?.[page] || [],
      true
    ));
    const pc = Array.from({ length: 2 }, (_, page) => fixedAssignmentArray(source.pc?.[page], 8, fresh.pc?.[page] || [], true));
    const mobileNotes = Array.from({ length: 2 }, (_, page) => fixedTextArray(source.slotNotes?.mobilePages?.[page], 8, 300));
    const pcNotes = Array.from({ length: 2 }, (_, page) => fixedTextArray(source.slotNotes?.pc?.[page], 8, 300));
    for (let page = 0; page < 2; page += 1) {
      for (let mobileIndex = 0; mobileIndex < 8; mobileIndex += 1) {
        const pcIndex = MOBILE_TO_PC[mobileIndex];
        const assignment = mobilePages[page][mobileIndex] ?? pc[page][pcIndex] ?? null;
        const note = mobileNotes[page][mobileIndex] || pcNotes[page][pcIndex] || '';
        mobilePages[page][mobileIndex] = assignment;
        pc[page][pcIndex] = assignment;
        mobileNotes[page][mobileIndex] = note;
        pcNotes[page][pcIndex] = note;
      }
    }
    const pcKeys = Array.from({ length: 2 }, (_, page) => fixedKeyArray(source.keys?.pc?.[page], 8, fresh.keys.pc[page]));
    if (!Array.isArray(source.keys?.pc?.[0]) && Array.isArray(source.keys?.mobile)) {
      fixedArray(source.keys.mobile, 8, fresh.keys.mobile).forEach((key, mobileIndex) => {
        pcKeys[0][MOBILE_TO_PC[mobileIndex]] = key;
      });
    }
    const functionKeys = fixedKeyArray(source.keys?.functions, 4, fresh.keys.functions);
    ensureUniqueKeyBindings(pcKeys, functionKeys);
    return {
      schemaVersion: 2,
      mobilePages,
      combos: Array.from({ length: 8 }, (_, i) => fixedAssignmentArray(source.combos?.[i], 8, fresh.combos?.[i] || [])),
      comboMeta: Array.from({ length: 8 }, (_, i) => ({
        name: shortClientText(source.comboMeta?.[i]?.name || fresh.comboMeta?.[i]?.name || `${i + 1} 號自訂`, 32),
        description: shortClientText(source.comboMeta?.[i]?.description || '', 300)
      })),
      pc,
      functions: fixedAssignmentArray(source.functions, 4, fresh.functions),
      slotNotes: {
        mobilePages: mobileNotes,
        pc: pcNotes,
        functions: fixedTextArray(source.slotNotes?.functions, 4, 300)
      },
      jobGuide: {
        description: shortClientText(source.jobGuide?.description || '', 2000)
      },
      keys: {
        mobile: MOBILE_TO_PC.map(pcIndex => pcKeys[0][pcIndex]),
        pc: pcKeys,
        functions: functionKeys
      }
    };
  }

  function cloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function shortClientText(value, maxLength) {
    return String(value ?? '').slice(0, maxLength);
  }

  function fixedArray(value, length, fallback) {
    const source = Array.isArray(value) ? value : fallback;
    return Array.from({ length }, (_, i) => source?.[i] ?? null);
  }

  function fixedTextArray(value, length, maxLength) {
    const source = Array.isArray(value) ? value : [];
    return Array.from({ length }, (_, i) => shortClientText(source[i] || '', maxLength));
  }

  function fixedKeyArray(value, length, fallback) {
    const source = Array.isArray(value) ? value : fallback;
    return Array.from({ length }, (_, index) => shortClientText(source?.[index] ?? fallback?.[index] ?? '', 20));
  }

  function ensureUniqueKeyBindings(pcKeys, functionKeys) {
    const defaults = [...DEFAULT_KEYS.pc.flat(), ...DEFAULT_KEYS.functions];
    const used = new Set();
    [...pcKeys.flat(), ...functionKeys].forEach((value, flatIndex) => {
      const normalized = String(value || '').trim();
      let replacement = normalized;
      if (!replacement || used.has(replacement.toLocaleLowerCase('en-US'))) {
        replacement = defaults.find(candidate => !used.has(candidate.toLocaleLowerCase('en-US'))) || `Key${flatIndex + 1}`;
      }
      used.add(replacement.toLocaleLowerCase('en-US'));
      if (flatIndex < 16) pcKeys[Math.floor(flatIndex / 8)][flatIndex % 8] = replacement;
      else functionKeys[flatIndex - 16] = replacement;
    });
  }

  function config() {
    const job = currentJobCode();
    state.configs[job] = normalizeConfig(state.configs[job]);
    return state.configs[job];
  }

  async function requestPublishedDefault(jobCode) {
    const requestVersion = (state.defaultRequestVersions.get(jobCode) || 0) + 1;
    state.defaultRequestVersions.set(jobCode, requestVersion);
    if (!CONFIG_ENDPOINT) return { ok: false, error: 'unavailable', requestVersion };
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${CONFIG_ENDPOINT}/skill-defaults?job_code=${encodeURIComponent(jobCode)}`, {
        mode: 'cors', cache: 'no-store', credentials: 'omit', signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: data.error || 'request_failed', requestVersion };
      if (!data.default?.config) return { ok: true, found: false, requestVersion };
      const normalized = currentJobCode() === jobCode
        ? normalizeConfig(data.default.config, makeGeneratedRecommendedConfig())
        : cloneValue(data.default.config);
      return {
        ok: true,
        found: true,
        config: normalized,
        suggestionId: String(data.default.suggestion_id || ''),
        updatedAt: String(data.default.updated_at || ''),
        requestVersion
      };
    } catch (error) {
      return { ok: false, error: error?.name === 'AbortError' ? 'timeout' : 'network_error', requestVersion };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function isLatestPublishedDefaultRequest(jobCode, result) {
    return result?.requestVersion === state.defaultRequestVersions.get(jobCode);
  }

  async function loadPublishedDefault(jobCode, applyWhenNoLocal = false, force = false) {
    if (!CONFIG_ENDPOINT) return false;
    if (!force && state.publishedDefaults.has(jobCode)) return true;
    if (!force && state.defaultRequests.has(jobCode)) return state.defaultRequests.get(jobCode);
    const requestedRevision = configRevision(jobCode);
    let request;
    request = (async () => {
      try {
        const result = await requestPublishedDefault(jobCode);
        if (!isLatestPublishedDefaultRequest(jobCode, result)) return false;
        if (result.ok && !result.found) state.publishedDefaults.delete(jobCode);
        if (!result.ok || !result.found) return false;
        state.publishedDefaults.set(jobCode, result.config);
        if (applyWhenNoLocal && currentJobCode() === jobCode && configRevision(jobCode) === requestedRevision) {
          state.configs[jobCode] = cloneValue(result.config);
          saveStore();
          if (!shell.hidden) renderWorkspace();
        }
        return true;
      } catch (_) {
        return false;
      } finally {
        if (state.defaultRequests.get(jobCode) === request) state.defaultRequests.delete(jobCode);
      }
    })();
    state.defaultRequests.set(jobCode, request);
    return request;
  }

  async function applyPublishedDefault() {
    if (state.applyingPublishedDefault) return;
    const jobCode = currentJobCode();
    const jobName = currentJobName();
    state.applyingPublishedDefault = true;
    applyDefaultButton.disabled = true;
    applyDefaultButton.setAttribute('aria-busy', 'true');
    applyDefaultButton.textContent = '讀取中…';
    try {
      const result = await requestPublishedDefault(jobCode);
      if (shell.hidden || currentJobCode() !== jobCode) {
        if (!shell.hidden) showToast('職業已切換，未套用建議', 2800);
        return;
      }
      if (!isLatestPublishedDefaultRequest(jobCode, result)) {
        showToast('網站建議已更新，請再按一次套用', 3000);
        return;
      }
      if (!result.ok) {
        const message = result.error === 'unavailable'
          ? '建議服務尚未設定'
          : result.error === 'timeout'
            ? '讀取網站建議逾時，請再試一次'
            : '無法取得網站建議，請檢查網路後再試';
        showToast(message, 3200);
        return;
      }
      if (!result.found) {
        state.publishedDefaults.delete(jobCode);
        document.dispatchEvent(new CustomEvent('skills:published-default-changed', { detail: { jobCode, published: false } }));
        showToast(`${jobName} 尚未發布網站建議`, 2800);
        return;
      }

      const confirmed = window.confirm(
        `確定套用「${jobName}」的網站建議嗎？\n\n` +
        '目前這個職業的兩頁技能按鍵、8 組組合技能、PC 鍵盤、註記與玩法說明都會被完整覆蓋。\n' +
        '其他職業不受影響。'
      );
      if (!confirmed || shell.hidden || currentJobCode() !== jobCode) return;

      cancelKeyRecording();
      state.publishedDefaults.set(jobCode, result.config);
      state.configs[jobCode] = cloneValue(result.config);
      markConfigEdited(jobCode);
      state.target = null;
      const saved = saveStore();
      render();
      if (saved) showToast(`${jobName} 已套用網站建議`, 2600);
    } finally {
      state.applyingPublishedDefault = false;
      applyDefaultButton.disabled = false;
      applyDefaultButton.removeAttribute('aria-busy');
      applyDefaultButton.textContent = '套用建議';
      if (!shell.hidden && currentJobCode() === jobCode) applyDefaultButton.focus({ preventScroll: true });
    }
  }

  function makeElementsInert(elements) {
    return [...elements].map(element => {
      const snapshot = {
        element,
        inert: element.hasAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden')
      };
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
      return snapshot;
    });
  }

  function restoreInertElements(snapshots) {
    snapshots.forEach(({ element, inert, ariaHidden }) => {
      if (!element?.isConnected) return;
      if (inert) element.setAttribute('inert', '');
      else element.removeAttribute('inert');
      if (ariaHidden == null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', ariaHidden);
    });
  }

  function visibleFocusableElements(container) {
    if (!container) return [];
    return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.tabIndex >= 0 && !element.disabled && !element.hidden && !element.closest('[hidden], [inert]'));
  }

  function activeDialogScope() {
    return !submitOverlay.hidden ? submitForm : app;
  }

  function trapModalFocus(event) {
    if (shell.hidden || event.key !== 'Tab') return;
    const scope = activeDialogScope();
    const focusable = visibleFocusableElements(scope);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!scope.contains(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  }

  function keepFocusInsideModal(event) {
    if (shell.hidden) return;
    const scope = activeDialogScope();
    if (scope.contains(event.target)) return;
    visibleFocusableElements(scope)[0]?.focus({ preventScroll: true });
  }

  function open() {
    if (!shell.hidden) return;
    const jobCode = currentJobCode();
    const hadLocalConfig = Boolean(state.configs[jobCode]);
    state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : openButton;
    state.skills = extractSkills();
    state.skillMap = new Map(state.skills.map(skill => [skill.id, skill]));
    const beforeNormalization = JSON.stringify(state.configs[jobCode] ?? null);
    config();
    if (beforeNormalization !== JSON.stringify(state.configs[jobCode])) saveStore();
    state.target = null;
    jobChip.textContent = currentJobName();
    shell.hidden = false;
    state.pageBackground = makeElementsInert([...document.body.children].filter(element => element !== shell));
    document.body.classList.add('sc-locked');
    render({ resetScroll: true });
    closeButton.focus({ preventScroll: true });
    loadPublishedDefault(jobCode, !hadLocalConfig);
  }

  function close() {
    cancelKeyRecording();
    closeSubmitDialog(false);
    shell.hidden = true;
    document.body.classList.remove('sc-locked');
    restoreInertElements(state.pageBackground);
    state.pageBackground = [];
    const returnFocus = state.returnFocus?.isConnected ? state.returnFocus : openButton;
    state.returnFocus = null;
    returnFocus.focus({ preventScroll: true });
  }

  function render(options = {}) {
    renderWorkspace(options);
    renderPalette();
    shell.querySelectorAll('.sc-tab').forEach(tab => {
      tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
    });
  }

  function renderWorkspace({ resetScroll = false } = {}) {
    const previousComboGroups = workspace.querySelector('.sc-combo-groups');
    const workspaceScrollTop = resetScroll ? 0 : workspace.scrollTop;
    const mainScrollTop = resetScroll ? 0 : mainPanel.scrollTop;
    const comboScrollTop = resetScroll ? 0 : previousComboGroups?.scrollTop || 0;
    const comboScrollLeft = resetScroll ? 0 : previousComboGroups?.scrollLeft || 0;
    const renderVersion = ++state.workspaceRenderVersion;
    const [title, description] = MODE_LABELS[state.mode];
    let body = '';
    if (state.mode === 'mobile') body = renderMobile();
    if (state.mode === 'combo') body = renderCombos();
    if (state.mode === 'pc') body = renderPc();
    workspace.innerHTML = `<div class="sc-workspace-inner">
      <div class="sc-mode-heading">
        <div><h3>${title}</h3><p>${description}</p></div>
        <span class="sc-help-chip">點按鍵 → 配置技能／撰寫註記</span>
      </div>${body}</div>`;
    bindSlots();
    const restoreScrollPosition = () => {
      if (renderVersion !== state.workspaceRenderVersion) return;
      workspace.scrollTop = workspaceScrollTop;
      mainPanel.scrollTop = mainScrollTop;
      const comboGroups = workspace.querySelector('.sc-combo-groups');
      if (comboGroups) {
        comboGroups.scrollTop = comboScrollTop;
        comboGroups.scrollLeft = comboScrollLeft;
      }
    };
    restoreScrollPosition();
    if (!resetScroll) {
      window.requestAnimationFrame(() => {
        restoreScrollPosition();
        window.requestAnimationFrame(restoreScrollPosition);
      });
    }
    updateClearAction();
  }

  function renderMobile() {
    const page = state.mobilePage;
    const slots = config().mobilePages[page];
    return `<div class="sc-config-stack sc-mobile-config-stack">
      <div class="sc-mobile-frame">
        <div class="sc-mobile-board sc-mobile-gamepad">
          ${slots.map((id, index) => slotMarkup({ area: 'mobile', page, index, id, key: getKey({ area: 'mobile', page, index }) })).join('')}
          <aside class="sc-mobile-page-control" aria-label="技能按鍵換頁">
            <span class="sc-game-page-indicator" aria-hidden="true">
              <img class="sc-page-indicator-bg" src="assets/game-ui/skill-config/main-hud/Preset_page_bg.png" alt="">
              <img class="sc-page-indicator-dot sc-page-indicator-dot--one" src="assets/game-ui/skill-config/main-hud/${page === 0 ? 'Preset_page_A.png' : 'Preset_page_D.png'}" alt="">
              <img class="sc-page-indicator-dot sc-page-indicator-dot--two" src="assets/game-ui/skill-config/main-hud/${page === 1 ? 'Preset_page_A.png' : 'Preset_page_D.png'}" alt="">
            </span>
            <button class="sc-mobile-page-switch" type="button" aria-label="切換到技能按鍵頁面 ${page === 0 ? 2 : 1}" title="切換技能按鍵頁面">
              <img src="assets/game-ui/skill-config/main-hud/Swap_btn_L.png" alt="">
            </button>
          </aside>
        </div>
      </div>
      ${renderSlotNoteEditor()}
      ${renderJobGuideEditor()}
    </div>`;
  }

  function renderCombos() {
    const groups = config().combos.map((items, index) => {
      const used = items.filter(Boolean).length;
      const lead = state.skillMap.get(items.find(Boolean));
      const meta = config().comboMeta[index];
      return `<section class="sc-combo-row${index === state.comboGroup ? ' is-active' : ''}">
        <button class="sc-group-button" type="button" data-group="${index}" aria-label="選擇 P${index + 1}">
          <strong>P${index + 1}</strong>
          <span class="sc-group-preview">${lead ? `<img src="${escapeAttr(lead.icon)}" alt="">` : '<i>＋</i>'}</span>
          <span><span class="sc-group-name-display">${escapeHtml(meta.name)}</span><small>${used} / 8</small></span>
        </button>
        <span class="sc-combo-arrow" aria-hidden="true">≪</span>
        <div class="sc-combo-body">
          <div class="sc-combo-editor">
            <label><span>自訂名稱</span><input class="sc-combo-name" data-combo-index="${index}" maxlength="32" value="${escapeAttr(meta.name)}" aria-label="P${index + 1} 組合名稱"></label>
            <label class="is-description"><span>配置說明</span><textarea class="sc-combo-description" data-combo-index="${index}" maxlength="300" rows="2" aria-label="P${index + 1} 配置說明" placeholder="輸入用途、施放順序或注意事項…">${escapeHtml(meta.description)}</textarea></label>
          </div>
          <div class="sc-combo-grid">${items.map((id, slotIndex) => slotMarkup({ area: 'combo', group: index, index: slotIndex, id })).join('')}</div>
        </div>
      </section>`;
    }).join('');
    return `<div class="sc-config-stack">
      <div class="sc-combo-layout">
        <div class="sc-combo-title"><strong>技能自訂</strong><span>觀看順序　●</span></div>
        <div class="sc-combo-groups" aria-label="組合技能群組">${groups}</div>
      </div>
      ${renderJobGuideEditor()}
    </div>`;
  }

  function renderPc() {
    const pages = config().pc.map((items, page) => `<section class="sc-pc-page">
      <div class="sc-pc-page-title"><span>技能快速欄位頁面 ${page + 1}</span><b>${page === 0 ? 'PAGE 1' : 'PAGE 2'}</b></div>
      <div class="sc-pc-grid">${items.map((id, index) => slotMarkup({ area: 'pc', page, index, id, key: config().keys.pc[page][index] })).join('')}</div>
    </section>`).join('');
    const functions = config().functions.map((id, index) => slotMarkup({ area: 'functions', index, id, key: config().keys.functions[index] })).join('');
    return `<div class="sc-config-stack">
      <div class="sc-pc-layout">
        <div class="sc-pc-pages">${pages}</div>
        <aside class="sc-pc-side">
          <div class="sc-function-title">功能快捷欄位</div>
          <div class="sc-function-grid">${functions}</div>
          <div class="sc-pc-options">
            <div><span>操作類型設定</span><b>類型 B　●</b></div>
            <div><span>快捷欄位尺寸套用 2 倍率</span><b>○　off</b></div>
          </div>
        </aside>
      </div>
      ${renderSlotNoteEditor()}
      ${renderJobGuideEditor()}
    </div>`;
  }

  function renderSlotNoteEditor() {
    const ref = state.target;
    const canDescribe = ref && ['mobile', 'pc', 'functions'].includes(ref.area);
    const assignment = canDescribe ? assignmentForId(getSlot(ref)) : null;
    if (!canDescribe || !assignment) {
      const message = canDescribe
        ? '這個按鍵目前是空的；先配置技能或組合技能後即可撰寫用法。'
        : '點選上方任一已配置按鍵，說明這個技能怎麼用、什麼時候使用。';
      return `<section class="sc-slot-note-panel is-idle" aria-label="按鍵使用註記">
        <span class="sc-note-pencil" aria-hidden="true">✎</span>
        <div><span>BUTTON NOTE</span><strong>按鍵使用註記</strong><p>${message}</p></div>
      </section>`;
    }
    const encoded = encodeURIComponent(JSON.stringify(refIdentity(ref)));
    const note = getSlotNote(ref);
    const key = getKey(ref) || '未設定';
    const isCombo = assignment.kind === 'combo';
    const visual = assignment.icon
      ? `<img src="${escapeAttr(assignment.icon)}" alt="">`
      : isCombo ? `<span>P${assignment.comboIndex + 1}</span>` : '<span>技</span>';
    const comboBadge = isCombo
      ? `<b class="sc-note-combo-badge sc-combo-color-${assignment.comboIndex + 1}">P${assignment.comboIndex + 1}</b>`
      : '';
    return `<section class="sc-slot-note-panel" aria-label="${escapeAttr(assignment.name)} 按鍵使用註記">
      <header class="sc-slot-note-head">
        <span class="sc-note-skill-icon">${visual}${comboBadge}</span>
        <span class="sc-slot-note-title"><small>${escapeHtml(slotLocationLabel(ref))} · ${escapeHtml(key)}</small><strong>${escapeHtml(assignment.name)}</strong></span>
        <span class="sc-auto-save">自動儲存</span>
      </header>
      <label class="sc-slot-note-field">
        <span>使用時機與操作說明</span>
        <textarea class="sc-slot-note-input" data-note-ref="${encoded}" maxlength="300" rows="4" placeholder="例如：進場先施放、爆發前開啟、Boss 進入無敵後保留，或說明搭配技能與操作順序…">${escapeHtml(note)}</textarea>
        <small><span class="sc-slot-note-count">${note.length}</span> / 300</small>
      </label>
    </section>`;
  }

  function renderJobGuideEditor() {
    const description = config().jobGuide.description;
    return `<section class="sc-job-guide-panel" aria-label="職業爆發與整體玩法">
      <header>
        <span><small>JOB PLAY GUIDE</small><strong>職業爆發與整體玩法</strong></span>
        <span class="sc-auto-save">自動儲存</span>
      </header>
      <p>整理爆發前準備、Buff 與技能順序、平時循環、保命方式及 Boss 注意事項，讓其他玩家了解整體玩法。</p>
      <label>
        <span>玩法建議</span>
        <textarea class="sc-job-guide-input" maxlength="2000" rows="7" placeholder="例如：120 秒爆發流程、入場準備、主要輸出循環、爆發空窗期操作、位移與保命技能使用時機…">${escapeHtml(description)}</textarea>
        <small><span class="sc-job-guide-count">${description.length}</span> / 2000</small>
      </label>
    </section>`;
  }

  function slotLocationLabel(ref) {
    if (ref.area === 'mobile') return `技能按鍵第 ${(ref.page ?? state.mobilePage) + 1} 頁`;
    if (ref.area === 'pc') return `PC 鍵盤第 ${ref.page + 1} 頁`;
    return '功能快捷欄';
  }

  function slotMarkup(ref) {
    const id = ref.id;
    const assignment = id ? assignmentForId(id) : null;
    const isCombo = assignment?.kind === 'combo';
    const encoded = encodeURIComponent(JSON.stringify(refIdentity(ref)));
    const isTarget = sameTarget(ref, state.target);
    const hasNote = Boolean(assignment && getSlotNote(ref).trim());
    const key = ref.key != null
      ? `<button class="sc-key" type="button" data-key-ref="${encoded}" title="點一下後按新的鍵">${escapeHtml(ref.key || '未設定')}</button>`
      : '';
    const visual = assignment?.icon
      ? `<img src="${escapeAttr(assignment.icon)}" alt="">`
      : isCombo
        ? `<span class="sc-slot-combo-placeholder">P${assignment.comboIndex + 1}</span>`
        : '';
    const comboBadge = isCombo
      ? `<span class="sc-slot-combo-badge sc-combo-color-${assignment.comboIndex + 1}">P${assignment.comboIndex + 1}</span>`
      : '';
    const content = assignment
      ? `${visual}${comboBadge}<span class="sc-slot-name">${escapeHtml(assignment.name)}</span><button class="sc-remove" type="button" aria-label="移除 ${escapeAttr(assignment.name)}">×</button>`
      : `<span class="sc-slot-number">${ref.index + 1}</span>`;
    const comboTitle = isCombo ? `P${assignment.comboIndex + 1}｜${assignment.name}｜${assignment.used}/8 個技能` : assignment?.name;
    const title = assignment ? `${comboTitle}${hasNote ? '｜已有註記' : ''}` : '選擇此欄位';
    return `<div class="sc-slot sc-slot--${escapeAttr(ref.area)}${assignment ? ' has-skill' : ' is-empty'}${isCombo ? ' has-combo' : ''}${hasNote ? ' has-note' : ''}${isTarget ? ' is-target' : ''}" role="button" tabindex="0" draggable="${Boolean(assignment)}" data-slot-ref="${encoded}" aria-label="${assignment ? escapeAttr(title) : `空白欄位 ${ref.index + 1}`}" title="${escapeAttr(title)}">${key}${content}</div>`;
  }

  function refIdentity(ref) {
    const out = { area: ref.area, index: ref.index };
    if (Number.isInteger(ref.group)) out.group = ref.group;
    if (Number.isInteger(ref.page)) out.page = ref.page;
    return out;
  }

  function sameTarget(a, b) {
    return Boolean(a && b && a.area === b.area && a.index === b.index && a.group === b.group && a.page === b.page);
  }

  function bindSlots() {
    workspace.querySelector('.sc-mobile-page-switch')?.addEventListener('click', () => {
      state.mobilePage = state.mobilePage === 0 ? 1 : 0;
      state.target = null;
      renderWorkspace();
    });

    workspace.querySelectorAll('[data-group]').forEach(button => {
      button.addEventListener('click', () => {
        state.comboGroup = Number(button.dataset.group);
        state.target = null;
        workspace.querySelectorAll('.sc-combo-row').forEach((row, index) => row.classList.toggle('is-active', index === state.comboGroup));
        updateClearAction();
      });
    });

    workspace.querySelectorAll('.sc-combo-name, .sc-combo-description').forEach(field => {
      field.addEventListener('click', event => event.stopPropagation());
      field.addEventListener('input', () => {
        const index = Number(field.dataset.comboIndex);
        if (!Number.isInteger(index) || !config().comboMeta[index]) return;
        const key = field.classList.contains('sc-combo-name') ? 'name' : 'description';
        const limit = key === 'name' ? 32 : 300;
        config().comboMeta[index][key] = shortClientText(field.value, limit);
        markConfigEdited();
        if (key === 'name') {
          const display = field.closest('.sc-combo-row')?.querySelector('.sc-group-name-display');
          if (display) display.textContent = config().comboMeta[index].name || `${index + 1} 號自訂`;
        }
        clearTimeout(state.metaSaveTimer);
        state.metaSaveTimer = setTimeout(() => saveStore(), 250);
      });
      field.addEventListener('change', () => saveStore('組合資料已儲存'));
    });

    const slotNoteInput = workspace.querySelector('.sc-slot-note-input');
    if (slotNoteInput) {
      slotNoteInput.addEventListener('input', () => {
        const ref = decodeRef(slotNoteInput.dataset.noteRef);
        const value = shortClientText(slotNoteInput.value, 300);
        setSlotNote(ref, value);
        const counter = workspace.querySelector('.sc-slot-note-count');
        if (counter) counter.textContent = String(value.length);
        workspace.querySelector('.sc-slot.is-target')?.classList.toggle('has-note', Boolean(value.trim()));
        clearTimeout(state.noteSaveTimer);
        state.noteSaveTimer = setTimeout(() => saveStore(), 250);
      });
      slotNoteInput.addEventListener('change', () => saveStore('按鍵註記已儲存'));
    }

    const jobGuideInput = workspace.querySelector('.sc-job-guide-input');
    if (jobGuideInput) {
      jobGuideInput.addEventListener('input', () => {
        const value = shortClientText(jobGuideInput.value, 2000);
        config().jobGuide.description = value;
        markConfigEdited();
        const counter = workspace.querySelector('.sc-job-guide-count');
        if (counter) counter.textContent = String(value.length);
        clearTimeout(state.noteSaveTimer);
        state.noteSaveTimer = setTimeout(() => saveStore(), 250);
      });
      jobGuideInput.addEventListener('change', () => saveStore('職業玩法已儲存'));
    }

    workspace.querySelectorAll('.sc-slot').forEach(slot => {
      const ref = decodeRef(slot.dataset.slotRef);
      slot.addEventListener('click', event => {
        if (event.target.closest('.sc-remove, .sc-key')) return;
        state.target = ref;
        renderWorkspace();
      });
      slot.addEventListener('keydown', event => {
        if (event.target !== slot) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          state.target = ref;
          renderWorkspace();
        }
      });
      slot.addEventListener('dragstart', event => {
        const id = getSlot(ref);
        if (!id) return event.preventDefault();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
        event.dataTransfer.setData('application/x-msm-origin', JSON.stringify(ref));
      });
      slot.addEventListener('dragover', event => {
        event.preventDefault();
        slot.classList.add('is-over');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('is-over'));
      slot.addEventListener('drop', event => {
        event.preventDefault();
        slot.classList.remove('is-over');
        const id = event.dataTransfer.getData('text/plain');
        if (!canAssignTo(ref, id)) return showToast(assignmentRestrictionMessage(id));
        const originRaw = event.dataTransfer.getData('application/x-msm-origin');
        let origin = null;
        try { origin = originRaw ? JSON.parse(originRaw) : null; } catch (_) {}
        if (origin && !sameTarget(origin, ref)) {
          const displaced = getSlot(ref);
          if (displaced && !canAssignTo(origin, displaced)) {
            return showToast('無法交換：組合技能不能移入組合內容或功能快捷欄');
          }
          const originNote = getSlotNote(origin);
          const targetNote = getSlotNote(ref);
          setSlot(origin, displaced || null, true);
          setSlot(ref, id, true);
          setSlotNote(origin, targetNote);
          setSlotNote(ref, originNote);
        } else {
          setSlot(ref, id, Boolean(origin));
        }
        state.target = ref;
        saveStore('配置已更新');
        renderWorkspace();
      });
    });

    workspace.querySelectorAll('.sc-remove').forEach(button => {
      button.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        button.click();
      });
      button.addEventListener('click', event => {
        event.stopPropagation();
        const ref = decodeRef(button.closest('.sc-slot').dataset.slotRef);
        setSlot(ref, null);
        saveStore('技能已移除');
        renderWorkspace();
      });
    });

    workspace.querySelectorAll('.sc-key').forEach(button => {
      button.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        button.click();
      });
      button.addEventListener('click', event => {
        event.stopPropagation();
        startKeyRecording(button, decodeRef(button.dataset.keyRef));
      });
    });
  }

  function renderPalette() {
    const query = state.libraryQuery.trim().toLocaleLowerCase('zh-Hant');
    const filteredSkills = state.skills.filter(skill => {
      const matchesType = state.libraryType === 'all' || skill.type === state.libraryType;
      return state.libraryType !== 'combo' && matchesType && (!query || skill.searchable.includes(query));
    });
    const comboItems = state.mode === 'combo' || !['all', 'combo'].includes(state.libraryType)
      ? []
      : Array.from({ length: 8 }, (_, index) => comboAssignment(index))
        .filter(item => item.used > 0 && (!query || item.searchable.includes(query)));
    const comboCards = comboItems.map(item => `
      <button class="sc-palette-card is-combo" type="button" draggable="true" data-skill-id="${escapeAttr(item.id)}" title="配置 P${item.comboIndex + 1}｜${escapeAttr(item.name)}">
        <span class="sc-palette-combo-visual">
          ${item.icon ? `<img src="${escapeAttr(item.icon)}" alt="">` : `<i>P${item.comboIndex + 1}</i>`}
          <b class="sc-palette-combo-badge sc-combo-color-${item.comboIndex + 1}">P${item.comboIndex + 1}</b>
        </span>
        <span><strong>${escapeHtml(item.name)}</strong><span>組合技能 · ${item.used}/8</span></span>
      </button>`).join('');
    const skillCards = filteredSkills.map(skill => `
      <button class="sc-palette-card" type="button" draggable="true" data-skill-id="${escapeAttr(skill.id)}" title="配置 ${escapeAttr(skill.name)}">
        <img src="${escapeAttr(skill.icon)}" alt=""><span><strong>${escapeHtml(skill.name)}</strong><span>${TYPE_LABELS[skill.type]} · ${escapeHtml(skill.stage)}</span></span>
      </button>`).join('');
    const sections = [];
    if (comboCards) sections.push(`<div class="sc-palette-section-title"><strong>組合技能 P1–P8</strong><span>可配置到技能按鍵與 PC 鍵盤</span></div>${comboCards}`);
    if (skillCards) {
      const skillTitle = comboCards ? '<div class="sc-palette-section-title"><strong>單一技能</strong></div>' : '';
      sections.push(`${skillTitle}${skillCards}`);
    }
    if (!sections.length && state.libraryType === 'combo' && state.mode === 'combo') {
      sections.push('<p class="sc-empty-palette">組合技能不能放進另一個組合技能；請切換到技能按鍵或 PC 鍵盤配置。</p>');
    }
    palette.innerHTML = sections.join('') || '<p class="sc-empty-palette">找不到符合條件的技能</p>';

    palette.querySelectorAll('.sc-palette-card').forEach(card => {
      const id = card.dataset.skillId;
      card.addEventListener('click', () => assignSkill(id));
      card.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', id);
      });
    });
  }

  function assignSkill(id) {
    let target = state.target;
    if (!target) target = firstEmptyInCurrentMode();
    if (!target) return showToast('請先選擇一個欄位');
    if (!canAssignTo(target, id)) return showToast(assignmentRestrictionMessage(id));
    setSlot(target, id);
    state.target = target;
    saveStore(comboIndexFromRef(id) >= 0 ? '組合技能已配置' : '技能已配置');
    renderWorkspace();
  }

  function firstEmptyInCurrentMode() {
    if (state.mode === 'mobile') {
      const index = config().mobilePages[state.mobilePage].findIndex(value => !value);
      return index >= 0 ? { area: 'mobile', page: state.mobilePage, index } : null;
    }
    if (state.mode === 'combo') {
      const index = config().combos[state.comboGroup].findIndex(value => !value);
      return index >= 0 ? { area: 'combo', group: state.comboGroup, index } : null;
    }
    for (let page = 0; page < 2; page += 1) {
      const index = config().pc[page].findIndex(value => !value);
      if (index >= 0) return { area: 'pc', page, index };
    }
    return null;
  }

  function slotValue(cfg, ref) {
    if (ref.area === 'mobile') return cfg.mobilePages[ref.page ?? state.mobilePage][ref.index];
    if (ref.area === 'combo') return cfg.combos[ref.group][ref.index];
    if (ref.area === 'pc') return cfg.pc[ref.page][ref.index];
    if (ref.area === 'functions') return cfg.functions[ref.index];
    return null;
  }

  function getSlot(ref) {
    return slotValue(config(), ref);
  }

  function linkedSkillRef(ref) {
    if (ref.area === 'mobile') {
      return { area: 'pc', page: ref.page ?? state.mobilePage, index: MOBILE_TO_PC[ref.index] };
    }
    if (ref.area === 'pc') {
      return { area: 'mobile', page: ref.page, index: PC_TO_MOBILE[ref.index] };
    }
    return null;
  }

  function setSlot(ref, value, preserveNote = false) {
    const cfg = config();
    // Read from this exact normalized object. Calling getSlot() here would
    // normalize again, replace state.configs[job], and leave `cfg` stale.
    const previous = slotValue(cfg, ref);
    if (ref.area === 'mobile') cfg.mobilePages[ref.page ?? state.mobilePage][ref.index] = value;
    if (ref.area === 'combo') cfg.combos[ref.group][ref.index] = value;
    if (ref.area === 'pc') cfg.pc[ref.page][ref.index] = value;
    if (ref.area === 'functions') cfg.functions[ref.index] = value;
    const linked = linkedSkillRef(ref);
    if (linked?.area === 'mobile') cfg.mobilePages[linked.page][linked.index] = value;
    if (linked?.area === 'pc') cfg.pc[linked.page][linked.index] = value;
    if (!preserveNote && previous !== value) setSlotNote(ref, '');
    markConfigEdited();
  }

  function getSlotNote(ref) {
    const notes = config().slotNotes;
    if (ref.area === 'mobile') return notes.mobilePages[ref.page ?? state.mobilePage][ref.index] || '';
    if (ref.area === 'pc') return notes.pc[ref.page][ref.index] || '';
    if (ref.area === 'functions') return notes.functions[ref.index] || '';
    return '';
  }

  function setSlotNote(ref, value) {
    const notes = config().slotNotes;
    const clean = shortClientText(value, 300);
    if (ref.area === 'mobile') notes.mobilePages[ref.page ?? state.mobilePage][ref.index] = clean;
    if (ref.area === 'pc') notes.pc[ref.page][ref.index] = clean;
    if (ref.area === 'functions') notes.functions[ref.index] = clean;
    const linked = linkedSkillRef(ref);
    if (linked?.area === 'mobile') notes.mobilePages[linked.page][linked.index] = clean;
    if (linked?.area === 'pc') notes.pc[linked.page][linked.index] = clean;
    markConfigEdited();
  }

  function getKey(ref) {
    const keys = config().keys;
    if (ref.area === 'mobile') return keys.pc[ref.page ?? state.mobilePage][MOBILE_TO_PC[ref.index]] || keys.mobile[ref.index];
    if (ref.area === 'pc') return keys.pc[ref.page][ref.index];
    if (ref.area === 'functions') return keys.functions[ref.index];
    return '';
  }

  function canonicalKeyRef(ref) {
    if (ref.area === 'mobile') {
      return { area: 'pc', page: ref.page ?? state.mobilePage, index: MOBILE_TO_PC[ref.index] };
    }
    return refIdentity(ref);
  }

  function keyBindingRefs() {
    return [
      ...Array.from({ length: 2 }, (_, page) => Array.from({ length: 8 }, (_, index) => ({ area: 'pc', page, index }))).flat(),
      ...Array.from({ length: 4 }, (_, index) => ({ area: 'functions', index }))
    ];
  }

  function sameKeyRef(a, b) {
    return Boolean(a && b && a.area === b.area && a.page === b.page && a.index === b.index);
  }

  function configKeyValue(cfg, ref) {
    if (ref.area === 'pc') return cfg.keys.pc[ref.page][ref.index];
    if (ref.area === 'functions') return cfg.keys.functions[ref.index];
    return '';
  }

  function writeConfigKey(cfg, ref, value) {
    if (ref.area === 'pc') cfg.keys.pc[ref.page][ref.index] = value;
    if (ref.area === 'functions') cfg.keys.functions[ref.index] = value;
  }

  function setKey(ref, value) {
    const cfg = config();
    const target = canonicalKeyRef(ref);
    const next = shortClientText(String(value || '').trim(), 20);
    const previous = configKeyValue(cfg, target);
    if (!next || next.toLocaleLowerCase('en-US') === String(previous).toLocaleLowerCase('en-US')) return false;
    const conflict = keyBindingRefs().find(candidate => (
      !sameKeyRef(candidate, target) &&
      String(configKeyValue(cfg, candidate)).toLocaleLowerCase('en-US') === next.toLocaleLowerCase('en-US')
    ));
    if (conflict) writeConfigKey(cfg, conflict, previous);
    writeConfigKey(cfg, target, next);
    cfg.keys.mobile = MOBILE_TO_PC.map(pcIndex => cfg.keys.pc[0][pcIndex]);
    markConfigEdited();
    return Boolean(conflict);
  }

  function startKeyRecording(button, ref) {
    cancelKeyRecording();
    const old = getKey(ref);
    state.recording = { button, ref, old };
    button.classList.add('is-recording');
    button.textContent = '按任意鍵…';
    window.addEventListener('keydown', captureKey, true);
  }

  function captureKey(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!state.recording) return;
    if (event.key === 'Escape') return cancelKeyRecording();
    const ref = state.recording.ref;
    const swapped = setKey(ref, displayKey(event));
    state.recording = null;
    window.removeEventListener('keydown', captureKey, true);
    saveStore(swapped ? '按鍵已交換' : '按鍵已變更');
    renderWorkspace();
  }

  function cancelKeyRecording() {
    if (!state.recording) return;
    state.recording.button.classList.remove('is-recording');
    state.recording.button.textContent = state.recording.old;
    state.recording = null;
    window.removeEventListener('keydown', captureKey, true);
  }

  function displayKey(event) {
    const aliases = {
      ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Control: event.location === 2 ? 'R.Ctrl' : 'L.Ctrl',
      Shift: event.location === 2 ? 'R.Shift' : 'L.Shift',
      Alt: event.location === 2 ? 'R.Alt' : 'L.Alt',
      PageDown: 'PgDn', PageUp: 'PgUp', Delete: 'Delete', Enter: 'Enter', Tab: 'Tab'
    };
    return aliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  }

  function currentClearScope() {
    if (state.mode === 'mobile') {
      const page = state.mobilePage + 1;
      return {
        button: `清空按鍵第 ${page} 頁`,
        label: `技能按鍵第 ${page} 頁`,
        detail: `同步的 PC 鍵盤第 ${page} 頁也會一併清空。`
      };
    }
    if (state.mode === 'combo') {
      return {
        button: `清空 P${state.comboGroup + 1} 技能`,
        label: `P${state.comboGroup + 1} 的 8 個組合技能`,
        detail: '自訂名稱與配置說明會保留。'
      };
    }
    return {
      button: '清空全部 PC 欄位',
      label: '兩頁 PC 鍵盤與功能快捷欄',
      detail: '同步的兩頁技能按鍵也會一併清空。'
    };
  }

  function updateClearAction() {
    if (!clearButton) return;
    const scope = currentClearScope();
    clearButton.textContent = scope.button;
    clearButton.setAttribute('aria-label', `${scope.button}；${scope.detail}`);
  }

  function clearCurrent() {
    const scope = currentClearScope();
    if (!window.confirm(`確定要清空「${scope.label}」嗎？\n${scope.detail}\n這個動作無法復原。`)) return;
    const cfg = config();
    if (state.mode === 'mobile') {
      cfg.mobilePages[state.mobilePage].fill(null);
      cfg.pc[state.mobilePage].fill(null);
      cfg.slotNotes.mobilePages[state.mobilePage].fill('');
      cfg.slotNotes.pc[state.mobilePage].fill('');
    }
    if (state.mode === 'combo') cfg.combos[state.comboGroup].fill(null);
    if (state.mode === 'pc') {
      cfg.mobilePages.forEach(page => page.fill(null));
      cfg.pc.forEach(page => page.fill(null));
      cfg.functions.fill(null);
      cfg.slotNotes.mobilePages.forEach(page => page.fill(''));
      cfg.slotNotes.pc.forEach(page => page.fill(''));
      cfg.slotNotes.functions.fill('');
    }
    markConfigEdited();
    state.target = null;
    saveStore(`${scope.label}已清空`);
    renderWorkspace();
  }

  function openSubmitDialog() {
    if (!submitOverlay.hidden) return;
    saveStore();
    const cfg = config();
    const mobileCount = cfg.mobilePages.flat().filter(Boolean).length;
    const comboCount = cfg.combos.flat().filter(Boolean).length;
    const pcCount = cfg.pc.flat().concat(cfg.functions).filter(Boolean).length;
    const noteCount = cfg.slotNotes.mobilePages.flat().concat(cfg.slotNotes.functions).filter(note => note.trim()).length;
    const guide = cfg.jobGuide.description.trim() ? '已填' : '未填';
    submitSummary.textContent = `${currentJobName()}｜技能按鍵 ${mobileCount}/16｜組合技能 ${comboCount}/64｜PC 鍵盤 ${pcCount}/20｜按鍵註記 ${noteCount}｜職業玩法 ${guide}`;
    submitError.textContent = '';
    state.submitReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : shell.querySelector('[data-action="submit"]');
    state.submitBackground = makeElementsInert([...app.children].filter(element => element !== submitOverlay));
    submitOverlay.hidden = false;
    submitForm.querySelector('[name="submitter_name"]').focus({ preventScroll: true });
  }

  function closeSubmitDialog(restoreFocus = true) {
    if (!submitOverlay || submitOverlay.hidden || state.submitting) return;
    submitOverlay.hidden = true;
    submitError.textContent = '';
    restoreInertElements(state.submitBackground);
    state.submitBackground = [];
    if (restoreFocus) {
      const returnFocus = state.submitReturnFocus?.isConnected ? state.submitReturnFocus : shell.querySelector('[data-action="submit"]');
      returnFocus?.focus({ preventScroll: true });
    }
    state.submitReturnFocus = null;
  }

  function usedSkillIds(cfg) {
    return [...new Set([
      ...cfg.mobilePages.flat(),
      ...cfg.combos.flat(),
      ...cfg.pc.flat(),
      ...cfg.functions
    ].filter(Boolean))];
  }

  function buildSkillCatalog(cfg) {
    const catalog = Object.create(null);
    usedSkillIds(cfg).forEach(id => {
      const assignment = assignmentForId(id, cfg);
      catalog[id] = assignment ? {
        name: assignment.name,
        icon: assignment.icon,
        type: assignment.type,
        stage: assignment.stage
      } : { name: id, icon: '', type: '', stage: '' };
    });
    return catalog;
  }

  function submissionErrorMessage(code, fallback) {
    const messages = {
      origin_not_allowed: '目前的網站來源不允許提交。',
      invalid_payload: '配置資料格式不正確，請重新整理後再試。',
      payload_too_large: '這份配置資料太大，無法提交。',
      rate_limited: '短時間提交次數過多，請稍後再試。',
      invalid_idempotency_key: '提交識別碼無效，請關閉視窗後再試。',
      idempotency_key_mismatch: '提交識別碼不一致，請關閉視窗後再試。',
      idempotency_conflict: '配置已變更，請再按一次確認提交。',
      unavailable: '建議服務目前無法使用。'
    };
    return messages[code] || fallback || '提交失敗，請稍後再試。';
  }

  async function submitRecommendation(event) {
    event.preventDefault();
    if (state.submitting) return;
    if (!CONFIG_ENDPOINT) {
      submitError.textContent = '尚未設定建議服務網址。';
      return;
    }

    const cfg = normalizeConfig(cloneValue(config()));
    const payload = {
      schema_version: 2,
      job_code: currentJobCode(),
      job_name: currentJobName(),
      submitter_name: submitForm.querySelector('[name="submitter_name"]').value.trim(),
      message: submitForm.querySelector('[name="message"]').value.trim(),
      website: submitForm.querySelector('[name="website"]').value,
      config: cfg,
      skill_catalog: buildSkillCatalog(cfg)
    };
    const fingerprint = JSON.stringify(payload);
    if (!state.submissionKey || state.submissionFingerprint !== fingerprint) {
      state.submissionKey = createSubmissionKey();
      state.submissionFingerprint = fingerprint;
    }
    payload.idempotency_key = state.submissionKey;

    state.submitting = true;
    submitConfirm.disabled = true;
    submitConfirm.textContent = '提交中…';
    submitError.textContent = '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${CONFIG_ENDPOINT}/skill-suggestions`, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.error === 'idempotency_conflict') {
          state.submissionKey = '';
          state.submissionFingerprint = '';
        }
        throw new Error(submissionErrorMessage(data.error, response.statusText));
      }
      state.submitting = false;
      const saved = saveStore();
      closeSubmitDialog();
      submitForm.reset();
      state.submissionKey = '';
      state.submissionFingerprint = '';
      showToast(`建議已送出｜編號 ${String(data.id || '').slice(0, 8)}${saved ? '' : '｜草稿未儲存'}`, 3600);
    } catch (error) {
      const message = error.name === 'AbortError' ? '提交逾時，請確認網路後再試。' : error.message;
      submitError.textContent = message;
    } finally {
      clearTimeout(timer);
      state.submitting = false;
      submitConfirm.disabled = false;
      submitConfirm.textContent = '確認提交';
    }
  }

  function createSubmissionKey() {
    if (typeof window.crypto?.randomUUID === 'function') return `web:${window.crypto.randomUUID()}`;
    const random = Math.random().toString(36).slice(2);
    return `web:${Date.now().toString(36)}:${random}`;
  }

  function decodeRef(value) {
    return JSON.parse(decodeURIComponent(value));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function escapeAttr(value) { return escapeHtml(value); }

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  shell.addEventListener('click', event => { if (event.target === shell) close(); });
  submitForm.addEventListener('submit', submitRecommendation);
  submitForm.querySelector('.sc-submit-close').addEventListener('click', closeSubmitDialog);
  submitForm.querySelector('.sc-submit-cancel').addEventListener('click', closeSubmitDialog);
  submitOverlay.addEventListener('click', event => { if (event.target === submitOverlay) closeSubmitDialog(); });
  window.addEventListener('keydown', trapModalFocus, true);
  document.addEventListener('focusin', keepFocusInsideModal, true);
  shell.querySelector('.sc-tabs').addEventListener('click', event => {
    const tab = event.target.closest('.sc-tab');
    if (!tab) return;
    cancelKeyRecording();
    state.mode = tab.dataset.mode;
    if (state.mode === 'combo' && state.libraryType === 'combo') {
      state.libraryType = 'all';
      shell.querySelectorAll('.sc-filter').forEach(item => item.classList.toggle('is-active', item.dataset.type === 'all'));
    }
    state.target = null;
    render({ resetScroll: true });
  });
  shell.querySelector('.sc-library-filters').addEventListener('click', event => {
    const button = event.target.closest('.sc-filter');
    if (!button) return;
    state.libraryType = button.dataset.type;
    shell.querySelectorAll('.sc-filter').forEach(item => item.classList.toggle('is-active', item === button));
    renderPalette();
  });
  searchInput.addEventListener('input', () => {
    state.libraryQuery = searchInput.value;
    renderPalette();
  });
  shell.querySelector('.sc-footer').addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'apply-default') applyPublishedDefault();
    if (action === 'clear') clearCurrent();
    if (action === 'save') saveStore('草稿已儲存');
    if (action === 'submit') openSubmitDialog();
  });
  window.addEventListener('keydown', event => {
    if (shell.hidden || event.key !== 'Escape' || state.recording) return;
    if (!submitOverlay.hidden) closeSubmitDialog();
    else close();
  });
  jobSelect.addEventListener('change', () => {
    if (shell.hidden) return;
    const jobCode = currentJobCode();
    const hadLocalConfig = Boolean(state.configs[jobCode]);
    state.skills = extractSkills();
    state.skillMap = new Map(state.skills.map(skill => [skill.id, skill]));
    const beforeNormalization = JSON.stringify(state.configs[jobCode] ?? null);
    config();
    if (beforeNormalization !== JSON.stringify(state.configs[jobCode])) saveStore();
    jobChip.textContent = currentJobName();
    state.target = null;
    render({ resetScroll: true });
    loadPublishedDefault(jobCode, !hadLocalConfig);
  });
})();
