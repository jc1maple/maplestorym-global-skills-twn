(() => {
  const body = document.body;
  const search = document.getElementById("q");
  const job = document.getElementById("job");
  const sidebar = document.getElementById("filter-sidebar");
  const filterToggle = document.getElementById("mobile-filter-toggle");
  const filterClose = document.getElementById("filter-close");
  const filterScrim = document.getElementById("filter-scrim");
  const activeFilterCount = document.getElementById("active-filter-count");
  const resultSummary = document.getElementById("result-summary");
  const resultDetail = document.getElementById("result-detail");
  const toolbarFilterButton = document.getElementById("toolbar-filter-button");
  const viewGrid = document.getElementById("view-grid");
  const viewList = document.getElementById("view-list");
  const showcaseJobName = document.getElementById("showcase-job-name");
  const showcaseCode = document.getElementById("showcase-code");
  const showcaseDescription = document.getElementById("showcase-description");
  const showcaseStats = document.getElementById("showcase-stats");
  const stageShortcuts = document.getElementById("stage-shortcuts");
  const showcaseIcons = document.getElementById("showcase-icons");
  let pinnedAnimation = null;
  let publishedJobCodes = new Set();
  let publishedIndexGeneration = 0;
  let publishedIndexRequestedAt = 0;
  let publishedIndexLoading = false;
  let publishedIndexRefreshQueued = false;
  let jobPicker = null;
  let jobPickerTypeahead = "";
  let jobPickerTypeaheadTimer = 0;

  function normalizedEndpoint(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "";
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch (_) {
      return "";
    }
  }

  function publishedIndexEndpoint() {
    const configured = normalizedEndpoint(window.MSM_SKILL_CONFIG_ENDPOINT || window.MSM_VISITOR_LOG_ENDPOINT || "");
    const override = normalizedEndpoint(new URLSearchParams(window.location.search).get("skill_api"));
    if (!override) return configured;
    try {
      const url = new URL(override);
      const host = url.hostname.toLocaleLowerCase("en-US");
      const isLocal = host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1" || host.endsWith(".localhost");
      const isOfficial = url.protocol === "https:" && override === "https://maplestorym-skills-visitor-logger.ace1eetfps.workers.dev";
      return isLocal || isOfficial ? override : configured;
    } catch (_) {
      return configured;
    }
  }

  function jobOptionName(option) {
    return option?.textContent?.trim() || "全部職業";
  }

  function syncJobPickerSelection() {
    if (!jobPicker || !job) return;
    const selectedIndex = Math.max(0, Array.from(job.options).findIndex((option) => option.value === job.value));
    const selected = jobPicker.options[selectedIndex] || jobPicker.options[0];
    if (!selected) return;
    const published = Boolean(selected.value && publishedJobCodes.has(selected.value));
    jobPicker.value.textContent = selected.name;
    jobPicker.field.classList.toggle("has-published-default", published);
    jobPicker.currentBadge.hidden = !published;
    const nextStatus = published ? `${selected.name}已有通過審核並套用的網站預設` : "";
    if (jobPicker.status.textContent !== nextStatus) jobPicker.status.textContent = nextStatus;
    jobPicker.options.forEach((item, index) => {
      const isSelected = index === selectedIndex;
      item.element.classList.toggle("is-selected", isSelected);
      item.element.setAttribute("aria-selected", String(isSelected));
    });
    if (!jobPicker.open) setJobPickerActive(selectedIndex);
  }

  function syncPublishedJobDecorations() {
    if (!jobPicker) return;
    jobPicker.options.forEach((item) => {
      const published = Boolean(item.value && publishedJobCodes.has(item.value));
      item.element.classList.toggle("is-published", published);
      item.badge.hidden = !published;
      item.gem.hidden = !published;
      item.element.setAttribute("aria-label", `${item.name}${published ? "，已有網站預設" : ""}`);
    });
    syncJobPickerSelection();
  }

  function setJobPickerActive(index) {
    if (!jobPicker?.options.length) return;
    const next = Math.max(0, Math.min(index, jobPicker.options.length - 1));
    jobPicker.activeIndex = next;
    jobPicker.options.forEach((item, itemIndex) => item.element.classList.toggle("is-active", itemIndex === next));
    const active = jobPicker.options[next];
    if (jobPicker.open) {
      jobPicker.trigger.setAttribute("aria-activedescendant", active.element.id);
      active.element.scrollIntoView({ block: "nearest" });
    } else {
      jobPicker.trigger.removeAttribute("aria-activedescendant");
      window.clearTimeout(jobPickerTypeaheadTimer);
      jobPickerTypeahead = "";
    }
  }

  function setJobPickerOpen(open) {
    if (!jobPicker || jobPicker.open === open) return;
    jobPicker.open = open;
    jobPicker.menu.hidden = !open;
    jobPicker.field.classList.toggle("is-picker-open", open);
    jobPicker.trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      const selectedIndex = Math.max(0, jobPicker.options.findIndex((item) => item.value === job.value));
      setJobPickerActive(selectedIndex);
      window.requestAnimationFrame(() => jobPicker.options[jobPicker.activeIndex]?.element.scrollIntoView({ block: "nearest" }));
    } else {
      jobPicker.trigger.removeAttribute("aria-activedescendant");
    }
  }

  function selectJobPickerOption(index) {
    if (!jobPicker || !job) return;
    const item = jobPicker.options[index];
    if (!item) return;
    const changed = job.value !== item.value;
    job.value = item.value;
    syncJobPickerSelection();
    setJobPickerOpen(false);
    jobPicker.trigger.focus({ preventScroll: true });
    if (changed) job.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setupJobPicker() {
    const field = job?.closest(".job-field");
    if (!job || !field || field.dataset.pickerReady === "true") return;

    const pickerRoot = document.createElement("div");
    pickerRoot.className = "job-picker";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "job-picker-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-labelledby", "job-field-label job-picker-value");

    const value = document.createElement("span");
    value.className = "job-picker-value";
    value.id = "job-picker-value";
    const currentBadge = document.createElement("span");
    currentBadge.className = "job-picker-current-badge";
    currentBadge.hidden = true;
    currentBadge.setAttribute("aria-hidden", "true");
    currentBadge.innerHTML = '<i>◆</i><span>網站預設</span>';
    trigger.append(value, currentBadge);

    const menu = document.createElement("div");
    menu.className = "job-picker-menu";
    menu.id = "job-picker-listbox";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-labelledby", "job-field-label");
    menu.hidden = true;
    trigger.setAttribute("aria-controls", menu.id);

    const status = document.createElement("span");
    status.className = "job-picker-status";
    status.id = "job-picker-status";
    status.setAttribute("aria-live", "polite");
    trigger.setAttribute("aria-describedby", status.id);

    const options = Array.from(job.options).map((option, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "job-picker-option";
      item.tabIndex = -1;
      item.id = `job-picker-option-${index}`;
      item.setAttribute("role", "option");
      item.dataset.value = option.value;

      const gem = document.createElement("span");
      gem.className = "job-picker-gem";
      gem.textContent = "◆";
      gem.hidden = true;
      gem.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "job-picker-option-name";
      name.textContent = jobOptionName(option);
      const badge = document.createElement("span");
      badge.className = "job-picker-option-badge";
      badge.textContent = "網站預設";
      badge.hidden = true;
      badge.setAttribute("aria-hidden", "true");
      item.append(gem, name, badge);
      item.addEventListener("click", () => selectJobPickerOption(index));
      menu.append(item);
      return { element: item, badge, gem, name: name.textContent, value: option.value };
    });

    pickerRoot.append(trigger, menu);
    field.append(pickerRoot, status);
    job.classList.add("job-native-select");
    job.hidden = true;
    job.tabIndex = -1;
    job.setAttribute("aria-hidden", "true");
    field.dataset.pickerReady = "true";
    jobPicker = { field, root: pickerRoot, trigger, value, currentBadge, menu, status, options, activeIndex: 0, open: false };

    trigger.addEventListener("click", () => setJobPickerOpen(!jobPicker.open));
    trigger.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        if (!jobPicker.open) setJobPickerOpen(true);
        else setJobPickerActive(jobPicker.activeIndex + (key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (key === "Home" || key === "End") {
        if (!jobPicker.open) return;
        event.preventDefault();
        setJobPickerActive(key === "Home" ? 0 : jobPicker.options.length - 1);
        return;
      }
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        if (jobPicker.open) selectJobPickerOption(jobPicker.activeIndex);
        else setJobPickerOpen(true);
        return;
      }
      if (key === "Escape" && jobPicker.open) {
        event.preventDefault();
        setJobPickerOpen(false);
      } else if (key === "Tab") {
        setJobPickerOpen(false);
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        window.clearTimeout(jobPickerTypeaheadTimer);
        jobPickerTypeahead += key.toLocaleLowerCase("zh-TW");
        jobPickerTypeaheadTimer = window.setTimeout(() => { jobPickerTypeahead = ""; }, 650);
        if (!jobPicker.open) setJobPickerOpen(true);
        const start = (jobPicker.activeIndex + 1) % jobPicker.options.length;
        const match = Array.from({ length: jobPicker.options.length }, (_, offset) => (start + offset) % jobPicker.options.length)
          .find((index) => {
            const item = jobPicker.options[index];
            return item.name.toLocaleLowerCase("zh-TW").startsWith(jobPickerTypeahead) ||
              item.value.toLocaleLowerCase("en-US").startsWith(jobPickerTypeahead);
          });
        if (match !== undefined) setJobPickerActive(match);
      }
    });
    job.addEventListener("change", syncJobPickerSelection);
    document.addEventListener("pointerdown", (event) => {
      if (jobPicker?.open && !field.contains(event.target)) setJobPickerOpen(false);
    });
    window.addEventListener("resize", () => setJobPickerOpen(false));
    syncJobPickerSelection();
  }

  async function refreshPublishedJobIndex({ force = false } = {}) {
    const endpoint = publishedIndexEndpoint();
    if (!endpoint || !jobPicker) return;
    if (!force && Date.now() - publishedIndexRequestedAt < 15000) return;
    if (publishedIndexLoading) {
      if (force) publishedIndexRefreshQueued = true;
      return;
    }
    publishedIndexLoading = true;
    const generation = ++publishedIndexGeneration;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${endpoint}/skill-defaults/index`, {
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !Array.isArray(data.results) || generation !== publishedIndexGeneration) return;
      const knownCodes = new Set(jobPicker.options.map((item) => item.value).filter(Boolean));
      publishedJobCodes = new Set(
        data.results
          .map((item) => String(item?.job_code || ""))
          .filter((code) => knownCodes.has(code)),
      );
      publishedIndexRequestedAt = Date.now();
      syncPublishedJobDecorations();
    } catch (_) {
      // The native/custom job picker remains fully usable when the optional marker service is unavailable.
    } finally {
      window.clearTimeout(timeout);
      publishedIndexLoading = false;
      if (publishedIndexRefreshQueued) {
        publishedIndexRefreshQueued = false;
        refreshPublishedJobIndex({ force: true });
      }
    }
  }

  body.classList.add("has-modern-ui");

  function openFilters() {
    body.classList.add("filter-open");
    filterToggle?.setAttribute("aria-expanded", "true");
    window.setTimeout(() => filterClose?.focus(), 220);
  }

  function closeFilters({ restoreFocus = false } = {}) {
    body.classList.remove("filter-open");
    filterToggle?.setAttribute("aria-expanded", "false");
    if (restoreFocus) filterToggle?.focus();
  }

  filterToggle?.addEventListener("click", () => {
    if (body.classList.contains("filter-open")) {
      closeFilters();
    } else {
      openFilters();
    }
  });
  filterClose?.addEventListener("click", () => closeFilters({ restoreFocus: true }));
  filterScrim?.addEventListener("click", () => closeFilters({ restoreFocus: true }));
  toolbarFilterButton?.addEventListener("click", openFilters);

  function setView(mode) {
    const isList = mode === "list";
    body.classList.toggle("view-list", isList);
    viewGrid?.classList.toggle("is-active", !isList);
    viewList?.classList.toggle("is-active", isList);
    viewGrid?.setAttribute("aria-pressed", String(!isList));
    viewList?.setAttribute("aria-pressed", String(isList));
  }

  viewGrid?.addEventListener("click", () => setView("grid"));
  viewList?.addEventListener("click", () => setView("list"));

  function parsePinnedDurations(value) {
    const parsed = (value || "")
      .split(",")
      .map((item) => Number.parseInt(item, 10))
      .filter((item) => Number.isFinite(item) && item > 0);
    return parsed.length ? parsed : [60];
  }

  function syncBulkSkillToggle() {
    const button = document.getElementById("toggle-all-skills");
    if (!button) return;
    const visibleCards = Array.from(document.querySelectorAll(".skill-card")).filter(
      (card) => !card.hidden && !card.closest(".job-section")?.hidden && !card.closest(".stage-section")?.hidden,
    );
    button.textContent = visibleCards.some((card) => !card.classList.contains("is-collapsed"))
      ? "全部收起"
      : "全部展開";
  }

  function createPlayerButton(label, symbol, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = symbol;
    return button;
  }

  function setPinnedFrame(state, index) {
    if (!state || state.kind === "video") return;
    const column = state.columns <= 1 ? 0 : index % state.columns;
    const row = state.rows <= 1 ? 0 : Math.floor(index / state.columns);
    const x = state.columns <= 1 ? 0 : (column / (state.columns - 1)) * 100;
    const y = state.rows <= 1 ? 0 : (row / (state.rows - 1)) * 100;
    state.stage.style.backgroundPosition = `${x}% ${y}%`;
  }

  function clearPinnedTimer(state) {
    if (!state?.timer) return;
    window.clearTimeout(state.timer);
    state.timer = null;
  }

  function schedulePinnedFrame(state) {
    clearPinnedTimer(state);
    if (pinnedAnimation !== state || state.paused || state.frameCount <= 1) return;
    const delay = state.durations[state.frame] || state.durations[0] || 60;
    state.timer = window.setTimeout(() => {
      if (pinnedAnimation !== state || state.paused) return;
      state.frame = (state.frame + 1) % state.frameCount;
      setPinnedFrame(state, state.frame);
      schedulePinnedFrame(state);
    }, delay);
  }

  function playPinnedVideoSource(state, index, restart = true) {
    if (!state?.video || !state.sources.length) return;
    state.sourceIndex = index % state.sources.length;
    state.video.loop = state.sources.length === 1;
    if (state.video.src !== new URL(state.sources[state.sourceIndex], document.baseURI).href) {
      state.video.src = state.sources[state.sourceIndex];
    }
    if (restart) state.video.currentTime = 0;
    if (!state.paused) {
      const promise = state.video.play();
      if (promise && typeof promise.catch === "function") promise.catch(() => {});
    }
  }

  function syncPinnedPauseButton(state) {
    if (!state?.pauseButton) return;
    state.pauseButton.textContent = state.paused ? "▶" : "Ⅱ";
    state.pauseButton.setAttribute("aria-label", state.paused ? "繼續播放動畫" : "暫停動畫");
    state.pauseButton.setAttribute("aria-pressed", String(state.paused));
    state.pauseButton.title = state.paused ? "繼續播放動畫" : "暫停動畫";
  }

  function syncCardToggle(card, expanded) {
    const toggle = card?.querySelector?.(".skill-title[data-card-toggle]");
    if (!(toggle instanceof HTMLElement)) {
      card?.setAttribute?.("aria-expanded", String(expanded));
      return;
    }
    const skillName = toggle.querySelector("h3")?.textContent?.trim() || "技能";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "收起" : "展開"} ${skillName} 詳細資料`);
    card.removeAttribute("aria-expanded");
  }

  function setPinnedPaused(state, paused) {
    if (pinnedAnimation !== state) return;
    state.paused = paused;
    syncPinnedPauseButton(state);
    if (state.kind === "video") {
      if (paused) {
        state.video.pause();
      } else {
        const promise = state.video.play();
        if (promise && typeof promise.catch === "function") promise.catch(() => {});
      }
      return;
    }
    if (paused) clearPinnedTimer(state);
    else schedulePinnedFrame(state);
  }

  function restartPinnedAnimation(state) {
    if (pinnedAnimation !== state) return;
    state.paused = false;
    syncPinnedPauseButton(state);
    if (state.kind === "video") {
      playPinnedVideoSource(state, 0, true);
      return;
    }
    state.frame = 0;
    setPinnedFrame(state, 0);
    schedulePinnedFrame(state);
  }

  function closePinnedAnimation({ collapseCard = false } = {}) {
    const state = pinnedAnimation;
    if (!state) return;
    clearPinnedTimer(state);
    if (state.video) {
      state.video.pause();
      state.video.removeAttribute("src");
      state.video.load();
    }
    state.player.remove();
    state.card.classList.remove("has-pinned-animation");
    state.icon.classList.remove("is-pinned");
    state.icon.setAttribute("aria-pressed", "false");
    if (collapseCard) {
      state.card.classList.add("is-collapsed");
      syncCardToggle(state.card, false);
    }
    pinnedAnimation = null;
    syncBulkSkillToggle();
  }

  function openPinnedAnimation(icon) {
    const card = icon.closest(".skill-card");
    if (!(card instanceof HTMLElement) || !icon.dataset.previewSrc) return;
    if (pinnedAnimation?.icon === icon) {
      closePinnedAnimation();
      return;
    }
    closePinnedAnimation();

    const hoverPopover = document.getElementById("skill-preview-popover");
    if (typeof window.hideSkillPreview === "function") {
      window.hideSkillPreview();
    } else {
      hoverPopover?.classList.remove("is-visible");
      hoverPopover?.setAttribute("aria-hidden", "true");
    }

    card.classList.remove("is-collapsed");
    card.classList.add("has-pinned-animation");
    syncCardToggle(card, true);
    icon.classList.add("is-pinned");
    icon.setAttribute("aria-pressed", "true");

    const skillName = card.querySelector(".skill-title h3")?.textContent?.trim() || "技能動畫";
    const player = document.createElement("section");
    player.className = "skill-animation-player";
    player.setAttribute("aria-label", `${skillName}動畫播放器`);

    const playerHeader = document.createElement("header");
    playerHeader.className = "skill-animation-player-header";
    const heading = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = "SKILL ANIMATION";
    const title = document.createElement("strong");
    title.textContent = skillName;
    heading.append(eyebrow, title);

    const controls = document.createElement("div");
    controls.className = "skill-animation-controls";
    const pauseButton = createPlayerButton("暫停動畫", "Ⅱ", "animation-pause");
    const restartButton = createPlayerButton("重新播放動畫", "↻", "animation-restart");
    const fullscreenButton = createPlayerButton("全螢幕播放", "⛶", "animation-fullscreen");
    const closeButton = createPlayerButton("關閉動畫播放器", "×", "animation-close");
    controls.append(pauseButton, restartButton, fullscreenButton, closeButton);
    playerHeader.append(heading, controls);

    const stage = document.createElement("div");
    stage.className = "skill-animation-stage";
    const width = Math.max(1, Number.parseInt(icon.dataset.previewWidth || "380", 10));
    const height = Math.max(1, Number.parseInt(icon.dataset.previewHeight || "240", 10));
    stage.style.aspectRatio = `${width} / ${height}`;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    stage.append(video);

    const playerFooter = document.createElement("footer");
    playerFooter.className = "skill-animation-player-footer";
    const animationName = document.createElement("span");
    animationName.textContent = icon.dataset.previewAnimation || "循環動畫";
    const hint = document.createElement("span");
    hint.textContent = "移開游標仍會持續播放";
    playerFooter.append(animationName, hint);
    player.append(playerHeader, stage, playerFooter);

    const divider = card.querySelector(".skill-divider");
    if (divider) divider.before(player);
    else card.querySelector(".skill-top")?.after(player);

    const kind = (icon.dataset.previewKind || "spritesheet").toLowerCase();
    const state = {
      icon,
      card,
      player,
      stage,
      video,
      pauseButton,
      kind,
      paused: false,
      timer: null,
      frame: 0,
      frameCount: Math.max(1, Number.parseInt(icon.dataset.previewFrames || "1", 10)),
      columns: Math.max(1, Number.parseInt(icon.dataset.previewCols || icon.dataset.previewFrames || "1", 10)),
      rows: Math.max(1, Number.parseInt(icon.dataset.previewRows || "1", 10)),
      durations: parsePinnedDurations(icon.dataset.previewDurations),
      sources: (icon.dataset.previewSources || icon.dataset.previewSrc).split("|").filter(Boolean),
      sourceIndex: 0,
    };
    pinnedAnimation = state;

    player.addEventListener("mousedown", (event) => event.stopPropagation());
    player.addEventListener("click", (event) => event.stopPropagation());
    player.addEventListener("keydown", (event) => event.stopPropagation());
    pauseButton.addEventListener("click", () => setPinnedPaused(state, !state.paused));
    restartButton.addEventListener("click", () => restartPinnedAnimation(state));
    fullscreenButton.addEventListener("click", () => {
      if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    });
    closeButton.addEventListener("click", () => closePinnedAnimation());
    video.addEventListener("ended", () => {
      if (pinnedAnimation !== state) return;
      if (!state.paused && state.sources.length > 1) {
        playPinnedVideoSource(state, state.sourceIndex + 1, true);
        return;
      }
      state.paused = true;
      syncPinnedPauseButton(state);
    });
    video.addEventListener("play", () => {
      if (pinnedAnimation !== state) return;
      state.paused = false;
      syncPinnedPauseButton(state);
    });
    video.addEventListener("pause", () => {
      if (pinnedAnimation !== state || video.ended) return;
      state.paused = true;
      syncPinnedPauseButton(state);
    });

    if (kind === "video") {
      stage.classList.add("is-video");
      video.controls = true;
      playPinnedVideoSource(state, 0, true);
    } else {
      stage.style.backgroundImage = `url("${icon.dataset.previewSrc.replace(/"/g, "%22")}")`;
      stage.style.backgroundSize = `${state.columns * 100}% ${state.rows * 100}%`;
      setPinnedFrame(state, 0);
      schedulePinnedFrame(state);
    }
    syncBulkSkillToggle();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && body.classList.contains("filter-open")) {
      closeFilters({ restoreFocus: true });
      return;
    }
    const target = event.target;
    const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if (event.key === "/" && !isTyping && search) {
      event.preventDefault();
      search.focus();
    }
  });

  function checkedSpecificFilters() {
    const specific = Array.from(
      sidebar?.querySelectorAll(".stage-check:checked, .type-check:checked, .core-check:checked") || [],
    ).length;
    const defaultScopes = new Set(["job", "class", "group"]);
    const selectedScopes = new Set(
      Array.from(sidebar?.querySelectorAll(".scope-check:checked") || []).map((input) => input.value),
    );
    const scopeChanged = selectedScopes.size !== defaultScopes.size
      || Array.from(defaultScopes).some((value) => !selectedScopes.has(value));
    return specific + (scopeChanged ? 1 : 0);
  }

  function setStageCollapsed(section, collapsed) {
    if (!(section instanceof HTMLElement)) return;
    if (collapsed && pinnedAnimation?.card && section.contains(pinnedAnimation.card)) {
      closePinnedAnimation();
    }
    section.classList.toggle("is-stage-collapsed", collapsed);
    const header = section.querySelector(".stage-header");
    const label = header?.querySelector("h3")?.textContent?.trim() || "此階段";
    header?.setAttribute("aria-expanded", String(!collapsed));
    header?.setAttribute("aria-label", `${collapsed ? "展開" : "收起"} ${label} 技能`);
  }

  document.querySelectorAll(".stage-section").forEach((section) => {
    const header = section.querySelector(".stage-header");
    if (!(header instanceof HTMLElement)) return;
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    setStageCollapsed(section, false);
    const toggle = () => setStageCollapsed(section, !section.classList.contains("is-stage-collapsed"));
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
  });

  document.querySelectorAll(".skill-icon.has-preview").forEach((icon) => {
    const card = icon.closest(".skill-card");
    const skillName = card?.querySelector(".skill-title h3")?.textContent?.trim() || "技能";
    icon.setAttribute("aria-hidden", "false");
    icon.setAttribute("role", "button");
    icon.setAttribute("tabindex", "0");
    icon.setAttribute("aria-pressed", "false");
    icon.setAttribute("aria-label", `完整播放 ${skillName} 動畫`);
    icon.title = "停留快速預覽；點擊開啟完整動畫播放器";
    const activate = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPinnedAnimation(icon);
    };
    icon.addEventListener("mousedown", (event) => event.stopPropagation(), true);
    icon.addEventListener("click", activate, true);
    icon.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      activate(event);
    }, true);
  });

  document.querySelectorAll(".skill-card").forEach((card) => {
    const titleToggle = card.querySelector(".skill-title");
    if (titleToggle instanceof HTMLElement) {
      card.removeAttribute("role");
      card.removeAttribute("tabindex");
      card.removeAttribute("aria-expanded");
      titleToggle.dataset.cardToggle = "";
      titleToggle.setAttribute("role", "button");
      titleToggle.setAttribute("tabindex", "0");
      syncCardToggle(card, !card.classList.contains("is-collapsed"));
    }
    const closeIfCollapsed = () => {
      if (pinnedAnimation?.card === card && card.classList.contains("is-collapsed")) {
        closePinnedAnimation();
      }
      syncCardToggle(card, !card.classList.contains("is-collapsed"));
    };
    card.addEventListener("click", closeIfCollapsed);
    card.addEventListener("keydown", closeIfCollapsed);
  });

  document.getElementById("toggle-all-skills")?.addEventListener("click", () => {
    window.requestAnimationFrame(() => {
      if (pinnedAnimation?.card.classList.contains("is-collapsed")) closePinnedAnimation();
    });
  });

  function updateShowcase({ visibleCards, visibleJobs, selectedJobName }) {
    const selectedSection = visibleJobs.length === 1 ? visibleJobs[0] : null;
    const code = selectedSection?.dataset.job || "ALL JOBS";
    const visibleJobName = selectedSection?.querySelector(".job-header h2")?.textContent?.trim();
    const rawCountText = selectedSection?.querySelector(".job-count")?.textContent || "";
    const rawCount = Number.parseInt(rawCountText, 10) || visibleCards.length;
    const visibleStages = selectedSection
      ? Array.from(selectedSection.querySelectorAll(".stage-section")).filter((section) => !section.hidden)
      : [];
    const displayName = selectedSection ? (visibleJobName || selectedJobName) : "全職業技能索引";

    if (showcaseJobName) showcaseJobName.textContent = displayName;
    if (showcaseCode) {
      showcaseCode.textContent = code
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .toUpperCase();
    }
    if (showcaseDescription) {
      showcaseDescription.textContent = selectedSection
        ? `目前呈現 ${visibleCards.length.toLocaleString("zh-TW")} / ${rawCount.toLocaleString("zh-TW")} 筆技能，可依轉職階段、型態、核心與適用範圍交叉檢視。`
        : `跨 ${visibleJobs.length.toLocaleString("zh-TW")} 個職業瀏覽 Global／TWN 客戶端技能資料，並保留原始欄位與來源層級。`;
    }

    const stats = showcaseStats?.querySelectorAll("span") || [];
    const statValues = selectedSection
      ? [
          [visibleCards.length, "目前顯示"],
          [rawCount, "原始技能"],
          [visibleStages.length, "技能階段"],
        ]
      : [
          [visibleCards.length, "目前顯示"],
          [visibleJobs.length, "職業數量"],
          [checkedSpecificFilters(), "篩選條件"],
        ];
    stats.forEach((stat, index) => {
      const [value, label] = statValues[index];
      const strong = stat.querySelector("strong");
      const small = stat.querySelector("small");
      if (strong) strong.textContent = Number(value).toLocaleString("zh-TW");
      if (small) small.textContent = label;
    });

    if (stageShortcuts) {
      const fragment = document.createDocumentFragment();
      visibleStages.slice(0, 10).forEach((section) => {
        const label = section.querySelector(".stage-header h3")?.textContent?.trim();
        const count = section.querySelector(".stage-header span")?.textContent?.trim();
        if (!label) return;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${label}${count ? ` · ${count}` : ""}`;
        button.addEventListener("click", () => {
          const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
          setStageCollapsed(section, false);
          window.requestAnimationFrame(() => section.scrollIntoView({ behavior, block: "start" }));
        });
        fragment.append(button);
      });
      stageShortcuts.replaceChildren(fragment);
      stageShortcuts.hidden = !selectedSection || visibleStages.length === 0;
    }

    if (showcaseIcons) {
      const fragment = document.createDocumentFragment();
      visibleCards.slice(0, 6).forEach((card) => {
        const source = card.querySelector(".skill-icon img");
        if (!(source instanceof HTMLImageElement)) return;
        const frame = document.createElement("span");
        frame.className = "showcase-icon";
        const image = document.createElement("img");
        image.src = source.currentSrc || source.src;
        image.alt = "";
        image.loading = "eager";
        frame.append(image);
        fragment.append(frame);
      });
      showcaseIcons.replaceChildren(fragment);
    }
  }

  function updateSummary(filterSnapshot = null) {
    const visibleCards = Array.isArray(filterSnapshot?.visibleCards)
      ? filterSnapshot.visibleCards
      : Array.from(document.querySelectorAll(".skill-card")).filter(
          (card) => !card.hidden && !card.closest(".job-section")?.hidden && !card.closest(".stage-section")?.hidden,
        );
    const visibleJobs = Array.isArray(filterSnapshot?.visibleJobs)
      ? filterSnapshot.visibleJobs
      : Array.from(document.querySelectorAll(".job-section")).filter((section) => !section.hidden);
    const selectedJobName = job?.selectedOptions?.[0]?.textContent?.trim() || "全部職業";
    const specificCount = checkedSpecificFilters();
    const term = search?.value.trim() || "";

    if (pinnedAnimation && !visibleCards.includes(pinnedAnimation.card)) {
      closePinnedAnimation();
    }

    if (resultSummary) {
      resultSummary.textContent = `${selectedJobName} · ${visibleCards.length.toLocaleString("zh-TW")} 個技能`;
    }
    if (resultDetail) {
      const details = [];
      if (visibleJobs.length > 1) details.push(`${visibleJobs.length} 個職業`);
      if (specificCount) details.push(`${specificCount} 個條件`);
      if (term) details.push(`搜尋「${term}」`);
      resultDetail.textContent = details.length ? details.join(" · ") : "依轉職階段分組顯示，點擊卡片查看完整數值";
    }
    if (activeFilterCount && filterToggle) {
      activeFilterCount.textContent = String(specificCount);
      filterToggle.classList.toggle("has-active", specificCount > 0);
    }
    toolbarFilterButton?.classList.toggle("has-active", specificCount > 0);
    toolbarFilterButton?.setAttribute(
      "aria-label",
      specificCount ? `進階篩選，目前套用 ${specificCount} 個條件` : "進階篩選",
    );
    syncJobPickerSelection();
    updateShowcase({ visibleCards, visibleJobs, selectedJobName });
  }

  let summaryFrame = 0;
  let pendingFilterSnapshot = null;
  function scheduleSummaryUpdate(event) {
    if (event?.detail) pendingFilterSnapshot = event.detail;
    if (summaryFrame) cancelAnimationFrame(summaryFrame);
    summaryFrame = requestAnimationFrame(() => {
      summaryFrame = 0;
      const snapshot = pendingFilterSnapshot;
      pendingFilterSnapshot = null;
      updateSummary(snapshot);
    });
  }

  document.addEventListener("skills:filter-applied", scheduleSummaryUpdate);

  if (job) {
    job.addEventListener("change", () => {
      if (window.matchMedia("(max-width: 980px)").matches) closeFilters();
    });
  }

  setupJobPicker();
  refreshPublishedJobIndex({ force: true });
  window.addEventListener("focus", () => refreshPublishedJobIndex());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refreshPublishedJobIndex({ force: true });
  });
  document.addEventListener("skills:published-default-changed", () => refreshPublishedJobIndex({ force: true }));
  updateSummary();
})();
