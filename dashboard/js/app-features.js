// Part of the Tab Out dashboard. Loaded as an ordered classic script
// (shared global scope) after the earlier js/ parts. See index.html.

/* ----------------------------------------------------------------
   SETTINGS PANEL
   ---------------------------------------------------------------- */
function initSettingsPanel() {
  const toggle = document.getElementById('settingsToggle');
  const overlay = document.getElementById('settingsOverlay');
  const close = document.getElementById('settingsClose');
  const save = document.getElementById('settingsSave');

  if (!toggle || !overlay) return;

  toggle.addEventListener('click', () => {
    populateSettingsForm();
    overlay.style.display = 'flex';
  });

  // Theme is per-device, not part of saved server config — apply on change
  const themeSelect = document.getElementById('settingTheme');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      const choice = themeSelect.value;
      localStorage.setItem('tabout-theme', choice);
      applyTheme(choice);
    });
  }

  // Background-open click behavior — also per-device
  const bgToggle = document.getElementById('settingOpenInBackground');
  if (bgToggle) {
    bgToggle.addEventListener('change', () => {
      localStorage.setItem('tabout-open-in-background', bgToggle.checked ? 'true' : 'false');
    });
  }

  // Backup: export / import the whole dataset as JSON
  const exportBtn = document.getElementById('settingsExportBtn');
  const importBtn = document.getElementById('settingsImportBtn');
  const importFile = document.getElementById('settingsImportFile');
  const backupStatus = document.getElementById('settingsBackupStatus');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/export');
        if (!res.ok) throw new Error('export failed');
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `tab-out-backup-${stamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (backupStatus) backupStatus.textContent = 'Backup downloaded.';
      } catch {
        if (backupStatus) backupStatus.textContent = 'Export failed.';
      }
    });
  }
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      if (!confirm('Importing replaces all current sessions, notes, saved-for-later, snoozes, and stats with the backup. Continue?')) {
        importFile.value = '';
        return;
      }
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || 'import failed');
        if (backupStatus) backupStatus.textContent = 'Backup restored. Reloading…';
        await loadAppConfig();
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        if (backupStatus) backupStatus.textContent = 'Import failed: ' + (err.message || 'invalid file');
      } finally {
        importFile.value = '';
      }
    });
  }

  close.addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

  save.addEventListener('click', async () => {
    const updates = {
      userName: document.getElementById('settingUserName').value.trim(),
      pomodoroWorkMinutes: parseInt(document.getElementById('settingWorkMin').value, 10) || 25,
      pomodoroBreakMinutes: parseInt(document.getElementById('settingBreakMin').value, 10) || 5,
      clockShowSeconds: document.getElementById('settingShowSeconds').checked,
      clockFormat: document.getElementById('settingClockFormat').value,
      useDynamicQuote: document.getElementById('settingUseDynamicQuote').checked,
      quoteText: document.getElementById('settingQuoteText').value,
      quoteAuthor: document.getElementById('settingQuoteAuthor').value.trim(),
      searchEngine: document.getElementById('settingSearchEngine').value,
      staleWhitelist: (document.getElementById('settingStaleWhitelist').value || '')
        .split('\n')
        .map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
        .filter(Boolean),
      // Section visibility
      showWeather: document.getElementById('settingShowWeather').checked,
      showQuote: document.getElementById('settingShowQuote').checked,
      showPomodoro: document.getElementById('settingShowPomodoro').checked,
      showQuickLinks: document.getElementById('settingShowQuickLinks').checked,
      showSearch: document.getElementById('settingShowSearch').checked,
      showRecentlyClosed: document.getElementById('settingShowRecentlyClosed').checked,
      showYesterdaySummary: document.getElementById('settingShowYesterdaySummary').checked,
      showHeatmap: document.getElementById('settingShowHeatmap').checked,
      showSuggestions: document.getElementById('settingShowSuggestions').checked,
      showSessions: document.getElementById('settingShowSessions').checked,
      // Behavior
      autoRefreshSeconds: parseInt(document.getElementById('settingAutoRefresh').value, 10) || 0,
      soundEffects: document.getElementById('settingSoundEffects').checked,
      confettiEffects: document.getElementById('settingConfetti').checked,
      staleThresholdDays: parseInt(document.getElementById('settingStaleDays').value, 10) || 7,
      heatmapWeeks: parseInt(document.getElementById('settingHeatmapWeeks').value, 10) || 26,
      compactMode: document.getElementById('settingCompactMode').checked,
      animationsEnabled: document.getElementById('settingAnimations').checked,
      weekStartsOnMonday: document.getElementById('settingWeekStartsMonday').checked,
      suggestThreshold: parseInt(document.getElementById('settingSuggestThreshold').value, 10) || 5,
      tabCapWarning: parseInt(document.getElementById('settingTabCap').value, 10) || 0,
    };
    await saveAppConfig(updates);
    // Refresh dependent surfaces immediately
    refreshDynamicContent();
    overlay.style.display = 'none';
  });

  const addBtn = document.getElementById('settingsAddLink');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const title = document.getElementById('settingsNewLinkTitle').value.trim();
      const url = document.getElementById('settingsNewLinkUrl').value.trim();
      if (!url) return;
      let host = '';
      try { host = new URL(url).hostname; } catch { }
      const icon = faviconForDomain(host);
      const current = [...getQuickLinks()];
      current.push({ url, title: title || host || url, icon: icon || '' });
      await saveAppConfig({ quickLinks: current });
      document.getElementById('settingsNewLinkTitle').value = '';
      document.getElementById('settingsNewLinkUrl').value = '';
      renderSettingsQuickLinks();
    });
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="remove-quick-link"]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.linkIndex, 10);
    const current = [...getQuickLinks()];
    current.splice(idx, 1);
    await saveAppConfig({ quickLinks: current });
    renderSettingsQuickLinks();
  });
}

function populateSettingsForm() {
  const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const c = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

  f('settingTheme', getStoredTheme());
  c('settingOpenInBackground', getOpenInBackground());
  f('settingStaleWhitelist', (appConfig.staleWhitelist || []).join('\n'));
  f('settingUserName', appConfig.userName || '');
  // Section visibility
  c('settingShowWeather', appConfig.showWeather !== false);
  c('settingShowQuote', appConfig.showQuote !== false);
  c('settingShowPomodoro', appConfig.showPomodoro !== false);
  c('settingShowQuickLinks', appConfig.showQuickLinks !== false);
  c('settingShowSearch', appConfig.showSearch !== false);
  c('settingShowRecentlyClosed', appConfig.showRecentlyClosed !== false);
  c('settingShowYesterdaySummary', appConfig.showYesterdaySummary !== false);
  c('settingShowHeatmap', appConfig.showHeatmap !== false);
  c('settingShowSuggestions', appConfig.showSuggestions !== false);
  c('settingShowSessions', appConfig.showSessions !== false);
  // Behavior
  f('settingAutoRefresh', String(typeof appConfig.autoRefreshSeconds === 'number' ? appConfig.autoRefreshSeconds : 30));
  f('settingStaleDays', appConfig.staleThresholdDays || 7);
  f('settingHeatmapWeeks', String(appConfig.heatmapWeeks || 26));
  f('settingSuggestThreshold', appConfig.suggestThreshold || 5);
  f('settingTabCap', appConfig.tabCapWarning || 0);
  c('settingWeekStartsMonday', appConfig.weekStartsOnMonday === true);
  c('settingSoundEffects', appConfig.soundEffects !== false);
  c('settingConfetti', appConfig.confettiEffects !== false);
  c('settingCompactMode', appConfig.compactMode === true);
  c('settingAnimations', appConfig.animationsEnabled !== false);
  f('settingWorkMin', appConfig.pomodoroWorkMinutes);
  f('settingBreakMin', appConfig.pomodoroBreakMinutes);
  f('settingClockFormat', appConfig.clockFormat);
  f('settingSearchEngine', appConfig.searchEngine);
  f('settingQuoteText', appConfig.quoteText || '');
  f('settingQuoteAuthor', appConfig.quoteAuthor || '');
  c('settingShowSeconds', appConfig.clockShowSeconds);
  c('settingUseDynamicQuote', appConfig.useDynamicQuote);

  // Dim manual quote fields when dynamic quote is enabled
  const manualFields = document.getElementById('manualQuoteFields');
  if (manualFields) {
    manualFields.style.opacity = appConfig.useDynamicQuote ? '0.4' : '1';
    manualFields.style.pointerEvents = appConfig.useDynamicQuote ? 'none' : 'auto';
  }
  const dynamicToggle = document.getElementById('settingUseDynamicQuote');
  if (dynamicToggle) {
    dynamicToggle.addEventListener('change', () => {
      if (manualFields) {
        manualFields.style.opacity = dynamicToggle.checked ? '0.4' : '1';
        manualFields.style.pointerEvents = dynamicToggle.checked ? 'none' : 'auto';
      }
    });
  }

  renderSettingsQuickLinks();
}

function renderSettingsQuickLinks() {
  const container = document.getElementById('settingsQuickLinksList');
  if (!container) return;
  const links = getQuickLinks();
  if (links.length === 0) {
    container.innerHTML = '<div class="settings-hint" style="text-align:center;padding:8px 0">No quick links yet. Add one below.</div>';
    return;
  }
  container.innerHTML = links.map((link, i) =>
    `<div class="settings-quick-link-item" data-link-index="${i}">
      <img src="${esc(link.icon || '')}" alt="" class="settings-quick-link-icon" onerror="this.style.display='none'">
      <span class="settings-quick-link-title">${esc(link.title)}</span>
      <span class="settings-quick-link-url">${esc(link.url)}</span>
      <button class="settings-quick-link-remove" data-action="remove-quick-link" data-link-index="${i}" title="Remove">&times;</button>
    </div>`
  ).join('');
}

/* ----------------------------------------------------------------
   SESSIONS — save/list/restore/delete a named set of tabs
   ---------------------------------------------------------------- */

let savedSessions = [];
let tabNotes = {};         // { url: { note, updated_at } }
let activeSnoozes = [];    // [{ id, url, title, wake_at }]
let yesterdayStat = null;  // { day, tabs_opened, tabs_closed, domains }
let currentWorkspace = 'Default';

async function fetchTabNotes() {
  try {
    const res = await fetch('/api/notes');
    if (!res.ok) return;
    const data = await res.json();
    tabNotes = data.notes || {};
  } catch { /* leave previous map */ }
}

// Open the inline note editor popover for a given URL
let noteContextUrl = null;
function editTabNote(url) {
  if (!url) return;
  noteContextUrl = url;
  const overlay = document.getElementById('noteOverlay');
  const ta = document.getElementById('noteTextarea');
  const tabLine = document.getElementById('noteTabLine');
  const deleteBtn = document.getElementById('noteDeleteBtn');
  if (!overlay || !ta) return;

  // Show the tab title/host as context
  const tab = (openTabs || []).find(t => t.url === url);
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { }
  if (tabLine) {
    tabLine.innerHTML = `<span class="note-tab-host">${esc(host)}</span> · <span class="note-tab-title">${esc(tab?.title || url)}</span>`;
  }

  const existing = tabNotes[url] ? tabNotes[url].note : '';
  ta.value = existing;
  if (deleteBtn) deleteBtn.style.display = existing ? '' : 'none';

  overlay.style.display = 'flex';
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
}

function closeNotePopover() {
  const overlay = document.getElementById('noteOverlay');
  if (overlay) overlay.style.display = 'none';
  noteContextUrl = null;
}

async function saveNote(note) {
  if (!noteContextUrl) return;
  const url = noteContextUrl;
  try {
    await fetch('/api/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, note }),
    });
    if (note.trim() === '') {
      delete tabNotes[url];
      showToast('Note removed');
    } else {
      tabNotes[url] = { note, updated_at: new Date().toISOString() };
      showToast('Note saved');
    }
    closeNotePopover();
    refreshDynamicContent();
  } catch { showToast('Failed to save note'); }
}

// Multi-select chips for batch actions. Click while holding shift toggles
// a chip into a "selected" set; a floating bar appears at the bottom of the
// viewport with batch Save / Close / Snooze / Clear.
const chipSelection = new Set();

function clearChipSelection() {
  chipSelection.clear();
  document.querySelectorAll('.page-chip.chip-selected').forEach(el => el.classList.remove('chip-selected'));
  updateBatchBar();
}

function toggleChipSelection(url, chipEl) {
  if (chipSelection.has(url)) {
    chipSelection.delete(url);
    chipEl.classList.remove('chip-selected');
  } else {
    chipSelection.add(url);
    chipEl.classList.add('chip-selected');
  }
  updateBatchBar();
}

function updateBatchBar() {
  let bar = document.getElementById('batchBar');
  const n = chipSelection.size;
  if (n === 0) {
    if (bar) bar.style.display = 'none';
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'batchBar';
    bar.className = 'batch-bar';
    bar.innerHTML = `
      <span class="batch-count" id="batchCount"></span>
      <div class="batch-actions">
        <button class="batch-btn" data-batch-act="save">Save all</button>
        <button class="batch-btn" data-batch-act="snooze">Snooze all</button>
        <button class="batch-btn batch-btn-danger" data-batch-act="close">Close all</button>
        <button class="batch-btn" data-batch-act="clear">Clear</button>
      </div>`;
    document.body.appendChild(bar);
    bar.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-batch-act]');
      if (!btn) return;
      const act = btn.dataset.batchAct;
      const urls = [...chipSelection];
      if (act === 'clear') { clearChipSelection(); return; }
      if (act === 'save') {
        const tabs = urls.map(u => {
          const t = (openTabs || []).find(x => x.url === u);
          return { url: u, title: t?.title || u, favicon_url: t?.favIconUrl || null };
        });
        await fetch('/api/defer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tabs }),
        }).catch(() => null);
        await sendToExtension('closeTabs', { urls, exact: true });
        playCloseSound();
        showToast(`Saved ${urls.length} tabs`, {
          undo: async () => {
            await sendToExtension('openTabs', { urls });
            setTimeout(() => refreshDynamicContent(), 200);
          },
        });
        clearChipSelection();
        setTimeout(() => refreshDynamicContent(), 200);
      } else if (act === 'close') {
        await sendToExtension('closeTabs', { urls, exact: true });
        playCloseSound();
        showToast(`Closed ${urls.length} tabs`, {
          undo: async () => {
            await sendToExtension('openTabs', { urls });
            setTimeout(() => refreshDynamicContent(), 200);
          },
        });
        clearChipSelection();
        setTimeout(() => refreshDynamicContent(), 200);
      } else if (act === 'snooze') {
        // Snooze all to the same time using the popover with the first URL
        // and then iterate. Simpler: use a default of "tomorrow 9am" and
        // skip the popover for batch.
        const wakeAt = parseSnoozeChoice('tomorrow 9am');
        for (const u of urls) {
          const t = (openTabs || []).find(x => x.url === u);
          await fetch('/api/snoozes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: u,
              title: t?.title || u,
              favicon_url: t?.favIconUrl || null,
              wake_at: wakeAt,
            }),
          }).catch(() => null);
        }
        await sendToExtension('closeTabs', { urls, exact: true });
        playCloseSound();
        showToast(`Snoozed ${urls.length} tabs until tomorrow 9am`);
        clearChipSelection();
        setTimeout(() => refreshDynamicContent(), 200);
      }
    });
  }
  bar.style.display = 'flex';
  document.getElementById('batchCount').textContent = `${n} tab${n !== 1 ? 's' : ''} selected`;
}

function initMultiSelect() {
  document.addEventListener('click', (e) => {
    if (!e.shiftKey) return;
    const chip = e.target.closest('.page-chip[data-tab-url]');
    if (!chip) return;
    // Don't trigger when clicking inside chip-actions buttons
    if (e.target.closest('.chip-actions')) return;
    e.preventDefault();
    e.stopPropagation();
    toggleChipSelection(chip.dataset.tabUrl, chip);
  }, true);
}

// Right-click context menu on chips. Provides Save / Snooze / Note /
// Copy URL / Close in one place — useful when chip-action icons are crowded.
// HTML5 drag-and-drop: drag a chip onto a session row to add the tab to
// that session. The chip carries its URL+title via the dataTransfer payload.
function initChipDragToSession() {
  document.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.page-chip[draggable="true"]');
    if (!chip) return;
    const url = chip.dataset.tabUrl;
    const title = chip.querySelector('.chip-text')?.textContent || url;
    if (!url) return;
    e.dataTransfer.setData('application/tabout-url', url);
    e.dataTransfer.setData('application/tabout-title', title);
    e.dataTransfer.effectAllowed = 'copy';
    chip.classList.add('chip-dragging');
  });
  document.addEventListener('dragend', (e) => {
    const chip = e.target.closest('.page-chip');
    if (chip) chip.classList.remove('chip-dragging');
  });

  // Delegate dragover / drop to the sessions list
  const list = document.getElementById('sessionsList');
  if (!list) return;
  list.addEventListener('dragover', (e) => {
    const row = e.target.closest('.session-row');
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    row.classList.add('session-row-drop-target');
  });
  list.addEventListener('dragleave', (e) => {
    const row = e.target.closest('.session-row');
    if (row) row.classList.remove('session-row-drop-target');
  });
  list.addEventListener('drop', async (e) => {
    const row = e.target.closest('.session-row');
    if (!row) return;
    e.preventDefault();
    row.classList.remove('session-row-drop-target');
    const url = e.dataTransfer.getData('application/tabout-url');
    const title = e.dataTransfer.getData('application/tabout-title');
    const sessionId = row.dataset.sessionId;
    if (!url || !sessionId) return;
    const tab = (openTabs || []).find(t => t.url === url);
    try {
      const resp = await fetch(`/api/sessions/${sessionId}/tabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab: { url, title, favIconUrl: tab?.favIconUrl || null },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data.added === false) {
        showToast('Tab already in this session');
      } else {
        const sessionName = savedSessions.find(s => s.id === Number(sessionId))?.name || 'session';
        showToast(`Added to "${sessionName}"`);
      }
      await fetchSessions();
      renderSessions();
    } catch { showToast('Failed to add tab'); }
  });
}

function setSettingsTab(tab) {
  const body = document.querySelector('.settings-body');
  if (!body) return;
  body.dataset.activeTab = tab;
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // Scroll body to top when switching tabs
  body.scrollTop = 0;
}

function initSettingsNav() {
  const nav = document.getElementById('settingsNav');
  if (!nav) return;
  // Default to Appearance
  const body = document.querySelector('.settings-body');
  if (body && !body.dataset.activeTab) body.dataset.activeTab = 'appearance';
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-nav-item');
    if (!btn) return;
    setSettingsTab(btn.dataset.tab);
    // Clear search when changing tabs so the user sees that tab's groups
    const search = document.getElementById('settingsSearch');
    if (search && search.value) {
      search.value = '';
      applySettingsSearch();
    }
  });
}

function applySettingsSearch() {
  const input = document.getElementById('settingsSearch');
  const body = document.querySelector('.settings-body');
  if (!input || !body) return;
  const q = input.value.trim().toLowerCase();
  if (!q) {
    body.classList.remove('searching');
    body.querySelectorAll('.settings-group.search-hidden').forEach(g => g.classList.remove('search-hidden'));
    return;
  }
  body.classList.add('searching');
  body.querySelectorAll('.settings-group').forEach(group => {
    const text = group.textContent.toLowerCase();
    group.classList.toggle('search-hidden', !text.includes(q));
  });
}

function initSettingsSearch() {
  const input = document.getElementById('settingsSearch');
  if (!input) return;
  input.addEventListener('input', applySettingsSearch);
  // Reset search + tab when reopening settings
  document.getElementById('settingsToggle')?.addEventListener('click', () => {
    setTimeout(() => {
      input.value = '';
      setSettingsTab('appearance');
      applySettingsSearch();
    }, 0);
  });
}

function initShortcutSheet() {
  const overlay = document.getElementById('shortcutsOverlay');
  const close = document.getElementById('shortcutsCloseBtn');
  if (!overlay) return;
  const open = () => { overlay.style.display = 'flex'; };
  const closeFn = () => { overlay.style.display = 'none'; };
  if (close) close.addEventListener('click', closeFn);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });
  document.addEventListener('keydown', (e) => {
    // ? toggles the sheet, but only when the user isn't typing
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      if (overlay.style.display === 'flex') closeFn(); else open();
    }
    if (e.key === 'Escape' && overlay.style.display === 'flex') closeFn();
  });
}

function initChipContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (!menu) return;
  document.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('.page-chip[data-tab-url]');
    if (!chip) return;
    e.preventDefault();
    const url = chip.dataset.tabUrl;
    const title = chip.querySelector('.chip-text')?.textContent || url;
    const hasNote = !!tabNotes[url];
    menu.innerHTML = `
      <div class="context-menu-item" data-context-act="save" data-url="${esc(url)}" data-title="${esc(title)}">Save for later</div>
      <div class="context-menu-item" data-context-act="snooze" data-url="${esc(url)}" data-title="${esc(title)}">Snooze…</div>
      <div class="context-menu-item" data-context-act="note" data-url="${esc(url)}">${hasNote ? 'Edit note' : 'Add note'}</div>
      <div class="context-menu-item" data-context-act="copy" data-url="${esc(url)}">Copy URL</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-item-danger" data-context-act="close" data-url="${esc(url)}">Close tab</div>
    `;
    // Position the menu near the cursor, clamped to viewport
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 240);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
  });
  // Hide on any click outside
  document.addEventListener('click', (e) => {
    if (menu.style.display === 'none') return;
    if (e.target.closest('.context-menu')) return;
    menu.style.display = 'none';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.style.display = 'none';
  });
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    const act = item.dataset.contextAct;
    const url = item.dataset.url;
    const title = item.dataset.title;
    menu.style.display = 'none';
    if (act === 'save') {
      await fetch('/api/defer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs: [{ url, title, favicon_url: null }] }),
      }).catch(() => null);
      await sendToExtension('closeTabs', { urls: [url], exact: true });
      showToast('Saved for later');
      setTimeout(() => refreshDynamicContent(), 200);
    } else if (act === 'snooze') {
      openSnoozePopover(url, title);
    } else if (act === 'note') {
      editTabNote(url);
    } else if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(url);
        showToast('URL copied');
      } catch { showToast('Could not copy'); }
    } else if (act === 'close') {
      await sendToExtension('closeTabs', { urls: [url], exact: true });
      playCloseSound();
      showToast(`Closed "${title}"`, {
        undo: async () => {
          await sendToExtension('openTabs', { urls: [url] });
          setTimeout(() => refreshDynamicContent(), 200);
        },
      });
      setTimeout(() => refreshDynamicContent(), 200);
    }
  });
}

function initNotePopover() {
  const overlay = document.getElementById('noteOverlay');
  if (!overlay) return;
  document.getElementById('noteCloseBtn')?.addEventListener('click', closeNotePopover);
  document.getElementById('noteCancelBtn')?.addEventListener('click', closeNotePopover);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeNotePopover(); });
  document.getElementById('noteSaveBtn')?.addEventListener('click', () => {
    const ta = document.getElementById('noteTextarea');
    saveNote(ta.value || '');
  });
  document.getElementById('noteDeleteBtn')?.addEventListener('click', () => saveNote(''));
  document.getElementById('noteTextarea')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveNote(e.target.value || '');
    }
  });
}

async function fetchSnoozes() {
  try {
    const res = await fetch('/api/snoozes');
    if (!res.ok) return;
    const data = await res.json();
    activeSnoozes = Array.isArray(data.snoozes) ? data.snoozes : [];
  } catch { activeSnoozes = []; }
}

function parseSnoozeChoice(choice) {
  // Accepts "1h", "tomorrow", "tomorrow 9am", "monday", "friday 5pm",
  // or a plain number of hours. Returns ISO string or null.
  const c = (choice || '').trim().toLowerCase();
  if (!c) return null;
  const now = new Date();
  // Plain hours: "3h", "30m"
  let m = c.match(/^(\d+)\s*([hm])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const ms = m[2] === 'h' ? n * 3600 * 1000 : n * 60 * 1000;
    return new Date(now.getTime() + ms).toISOString();
  }
  // "tomorrow [9am]"
  if (c.startsWith('tomorrow')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    const t = c.replace('tomorrow', '').trim();
    if (t) applyTimeOfDay(d, t); else d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  // "monday", "tuesday", ...
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < days.length; i++) {
    if (c.startsWith(days[i])) {
      const d = new Date(now);
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      const t = c.replace(days[i], '').trim();
      if (t) applyTimeOfDay(d, t); else d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }
  return null;
}

function applyTimeOfDay(date, t) {
  // "9am", "5pm", "13:30"
  const m12 = t.match(/^(\d+)(?::(\d+))?\s*(am|pm)$/);
  if (m12) {
    let h = parseInt(m12[1], 10) % 12;
    if (m12[3] === 'pm') h += 12;
    date.setHours(h, m12[2] ? parseInt(m12[2], 10) : 0, 0, 0);
    return;
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    date.setHours(parseInt(m24[1], 10), parseInt(m24[2], 10), 0, 0);
    return;
  }
  date.setHours(9, 0, 0, 0);
}

// Open the snooze popover for a given URL. Quick-pick buttons or a custom
// natural-language string both produce an ISO wake_at and submit the same way.
let snoozeContext = { url: null, title: null };
function openSnoozePopover(url, title) {
  if (!url) return;
  snoozeContext = { url, title: title || '' };
  const overlay = document.getElementById('snoozeOverlay');
  const titleEl = document.getElementById('snoozeTitle');
  if (titleEl) titleEl.textContent = title ? `Snooze "${title.length > 40 ? title.slice(0, 40) + '…' : title}"` : 'Snooze tab';

  // Update relative-time hints on the quick-pick buttons
  const now = new Date();
  const fmt = (d) => d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const in1h = new Date(now.getTime() + 3600 * 1000);
  const in3h = new Date(now.getTime() + 3 * 3600 * 1000);
  const sat = new Date(now); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(9, 0, 0, 0);
  const setHint = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setHint('snoozeHint1h', fmt(in1h));
  setHint('snoozeHint3h', fmt(in3h));
  setHint('snoozeHintWeekend', fmt(sat));

  document.getElementById('snoozeCustomInput').value = '';
  if (overlay) overlay.style.display = 'flex';
}

function closeSnoozePopover() {
  const overlay = document.getElementById('snoozeOverlay');
  if (overlay) overlay.style.display = 'none';
  snoozeContext = { url: null, title: null };
}

async function commitSnooze(wakeAt) {
  if (!snoozeContext.url || !wakeAt) return;
  const url = snoozeContext.url;
  const title = snoozeContext.title;
  const tab = (openTabs || []).find(t => t.url === url);
  try {
    await fetch('/api/snoozes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        title: title || (tab && tab.title) || url,
        favicon_url: tab && tab.favIconUrl || null,
        wake_at: wakeAt,
      }),
    });
    await sendToExtension('closeTabs', { urls: [url], exact: true });
    playCloseSound();
    closeSnoozePopover();
    const when = new Date(wakeAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    showToast(`Snoozed until ${when}`);
    setTimeout(() => refreshDynamicContent(), 300);
  } catch {
    showToast('Failed to snooze');
  }
}

function resolveSnoozeChoice(choice) {
  // Map the quick-pick keys to the existing parser format
  const map = {
    '1h': '1h',
    '3h': '3h',
    'tonight': null, // computed manually
    'tomorrow': 'tomorrow 9am',
    'monday': 'monday 9am',
    'weekend': null, // computed manually
  };
  if (choice === 'tonight') {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (choice === 'weekend') {
    const d = new Date();
    const days = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  if (map[choice]) return parseSnoozeChoice(map[choice]);
  return parseSnoozeChoice(choice);
}

function initSnoozePopover() {
  const overlay = document.getElementById('snoozeOverlay');
  if (!overlay) return;
  document.getElementById('snoozeCloseBtn')?.addEventListener('click', closeSnoozePopover);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSnoozePopover(); });
  document.querySelectorAll('.snooze-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      const wakeAt = resolveSnoozeChoice(btn.dataset.snoozeChoice);
      if (wakeAt) commitSnooze(wakeAt);
    });
  });
  const customBtn = document.getElementById('snoozeCustomBtn');
  const customIn = document.getElementById('snoozeCustomInput');
  const submitCustom = () => {
    const wakeAt = parseSnoozeChoice(customIn.value);
    if (!wakeAt) { showToast("Couldn't parse that time"); return; }
    commitSnooze(wakeAt);
  };
  customBtn?.addEventListener('click', submitCustom);
  customIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCustom(); });
}

// Public entry — backwards compatible with prior callers
function snoozeTab(url, title) {
  openSnoozePopover(url, title);
}

async function unsnoozeNow(id) {
  try {
    const snooze = activeSnoozes.find(s => s.id === Number(id));
    if (snooze) {
      await sendToExtension('openTabs', { urls: [snooze.url] });
    }
    await fetch(`/api/snoozes/${id}`, { method: 'DELETE' });
    showToast('Tab restored');
    setTimeout(() => refreshDynamicContent(), 300);
  } catch { showToast('Failed to restore'); }
}

async function cancelSnooze(id) {
  try {
    await fetch(`/api/snoozes/${id}`, { method: 'DELETE' });
    showToast('Snooze cancelled');
    setTimeout(() => refreshDynamicContent(), 300);
  } catch { showToast('Failed to cancel'); }
}

// Tab activity heatmap — last 26 weeks of daily_stats rendered as a
// GitHub-contribution-graph. Color buckets are computed against the max
// activity in the window so the gradient self-scales to the user's volume.
let heatmapData = null;

async function fetchHeatmap() {
  const weeks = Math.max(4, Math.min(52, appConfig.heatmapWeeks || 26));
  try {
    const res = await fetch(`/api/stats/range?days=${weeks * 7}`);
    if (!res.ok) return;
    heatmapData = await res.json();
  } catch { heatmapData = null; }
}

function bucketForCount(count, max) {
  if (!count || count <= 0) return 0;
  if (max <= 1) return 1;
  const ratio = count / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function renderHeatmap() {
  const section = document.getElementById('heatmapSection');
  const grid = document.getElementById('heatmapGrid');
  const months = document.getElementById('heatmapMonths');
  const totalEl = document.getElementById('heatmapTotal');
  if (!section || !grid || !heatmapData) return;
  if (appConfig.showHeatmap === false) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  const stats = heatmapData.stats || {};
  // Rebuild the dense 7-row grid going backward from today.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Anchor on the end-of-week so each column is one full week.
  // Weekend day = 6 (Saturday) when starting on Sunday, or 0 (Sunday) when starting on Monday.
  const lastDay = new Date(today);
  const weekEndDay = appConfig.weekStartsOnMonday ? 0 : 6;
  while (lastDay.getDay() !== weekEndDay) lastDay.setDate(lastDay.getDate() + 1);

  const weeks = Math.max(4, Math.min(52, appConfig.heatmapWeeks || 26));
  const totalDays = weeks * 7;
  const days = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(lastDay);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  // Compute max for color scaling
  let maxCount = 0;
  let total = 0;
  const dayCounts = days.map(d => {
    const key = d.toISOString().slice(0, 10);
    const s = stats[key];
    const n = s ? s.total : 0;
    if (n > maxCount) maxCount = n;
    total += n;
    return { date: d, key, count: n, future: d > today };
  });

  if (totalEl) totalEl.textContent = `${total} tab events · last ${weeks} weeks`;

  // Sync the day-name labels with the chosen week start
  const labelRow = document.querySelector('.heatmap-days-label');
  if (labelRow) {
    const labels = appConfig.weekStartsOnMonday
      ? ['Mon', '', 'Wed', '', 'Fri', '', '']
      : ['', 'Mon', '', 'Wed', '', 'Fri', ''];
    labelRow.innerHTML = labels.map(l => `<span>${l}</span>`).join('');
  }

  // Build month labels — show a label at the column where a new month starts.
  // Each column is 7 days; we mark the column index of the first cell of each month.
  const monthLabels = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let col = 0; col < weeks; col++) {
    const firstCellInCol = dayCounts[col * 7];
    if (!firstCellInCol) continue;
    const month = firstCellInCol.date.getMonth();
    const prevCol = col > 0 ? dayCounts[(col - 1) * 7] : null;
    if (!prevCol || prevCol.date.getMonth() !== month) {
      monthLabels.push({ col, label: monthNames[month] });
    }
  }
  if (months) {
    months.innerHTML = '';
    months.style.gridTemplateColumns = `repeat(${weeks}, 14px)`;
    for (let col = 0; col < weeks; col++) {
      const m = monthLabels.find(x => x.col === col);
      const span = document.createElement('span');
      if (m) span.textContent = m.label;
      months.appendChild(span);
    }
  }

  // Render the grid: 7 rows × weeks columns, column-major fill so each column
  // is a Sunday→Saturday week.
  grid.style.gridTemplateColumns = `repeat(${weeks}, 14px)`;
  grid.innerHTML = '';
  // Build per-day cells in row-major order so CSS grid places them correctly:
  //  cells must be ordered row-by-row (all of row 0 across columns, then row 1, ...)
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < weeks; col++) {
      const idx = col * 7 + row;
      const d = dayCounts[idx];
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      if (!d || d.future) {
        cell.classList.add('heatmap-cell-empty');
      } else {
        cell.classList.add(`heatmap-cell-l${bucketForCount(d.count, maxCount)}`);
        cell.dataset.day = d.key;
        cell.title = `${formatHeatmapDate(d.date)} — ${d.count} event${d.count !== 1 ? 's' : ''}`;
      }
      grid.appendChild(cell);
    }
  }
}

function formatHeatmapDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function openDayDetail(dayKey) {
  if (!dayKey) return;
  const overlay = document.getElementById('dayOverlay');
  const title = document.getElementById('dayTitle');
  const body = document.getElementById('dayBody');
  if (!overlay || !body) return;

  const d = new Date(dayKey + 'T00:00:00');
  if (title) title.textContent = formatHeatmapDate(d);
  body.innerHTML = `<div class="day-loading">Loading...</div>`;
  overlay.style.display = 'flex';

  try {
    const res = await fetch(`/api/stats/day/${dayKey}`);
    const data = await res.json();
    if (!data.stat) {
      body.innerHTML = `<div class="day-empty">No tab activity recorded for this day.</div>`;
      return;
    }
    const top = Object.entries(data.stat.domains || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    body.innerHTML = `
      <div class="day-stats">
        <div class="day-stat"><div class="day-stat-num">${data.stat.tabs_opened}</div><div class="day-stat-label">Opened</div></div>
        <div class="day-stat"><div class="day-stat-num">${data.stat.tabs_closed}</div><div class="day-stat-label">Closed</div></div>
        <div class="day-stat"><div class="day-stat-num">${Object.keys(data.stat.domains || {}).length}</div><div class="day-stat-label">Domains</div></div>
      </div>
      ${top.length ? `<div class="day-section-title">Most active domains</div>
      <div class="day-domains">
        ${top.map(([host, n]) => `<div class="day-domain"><span class="day-domain-name">${esc(host)}</span><span class="day-domain-count">${n}</span></div>`).join('')}
      </div>` : ''}
    `;
  } catch {
    body.innerHTML = `<div class="day-empty">Failed to load this day.</div>`;
  }
}

function closeDayDetail() {
  const overlay = document.getElementById('dayOverlay');
  if (overlay) overlay.style.display = 'none';
}

function initHeatmap() {
  const grid = document.getElementById('heatmapGrid');
  const overlay = document.getElementById('dayOverlay');
  const close = document.getElementById('dayClose');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.heatmap-cell');
      if (!cell || !cell.dataset.day) return;
      openDayDetail(cell.dataset.day);
    });
  }
  if (close) close.addEventListener('click', closeDayDetail);
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDayDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') {
      closeDayDetail();
    }
  });
}

async function fetchYesterdayStats() {
  try {
    const res = await fetch('/api/stats/yesterday');
    if (!res.ok) return;
    const data = await res.json();
    yesterdayStat = data.stat;
  } catch { yesterdayStat = null; }
}

async function fetchSessions() {
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) return;
    const data = await res.json();
    savedSessions = Array.isArray(data.sessions) ? data.sessions : [];
  } catch { savedSessions = []; }
}

function formatSessionDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function getWorkspaces() {
  const set = new Set(['Default']);
  for (const s of savedSessions) set.add(s.workspace || 'Default');
  return [...set];
}

function renderWorkspaceTabs() {
  const tabs = document.getElementById('workspaceTabs');
  if (!tabs) return;
  const workspaces = getWorkspaces();
  // Make sure currentWorkspace exists in list, otherwise reset
  if (!workspaces.includes(currentWorkspace)) currentWorkspace = workspaces[0];
  tabs.innerHTML = workspaces.map(w => {
    const safe = esc(w || '');
    const cls = w === currentWorkspace ? 'workspace-tab active' : 'workspace-tab';
    const count = savedSessions.filter(s => (s.workspace || 'Default') === w).length;
    return `<button class="${cls}" data-action="workspace-tab" data-workspace="${safe}">${safe} <span class="workspace-count">${count}</span></button>`;
  }).join('') + `<button class="workspace-tab workspace-tab-new" data-action="new-workspace" title="Create workspace">+</button>`;
}

function renderSessions() {
  const section = document.getElementById('sessionsSection');
  const list = document.getElementById('sessionsList');
  const empty = document.getElementById('sessionsEmpty');
  const countEl = document.getElementById('sessionsCount');
  if (!section || !list) return;

  if (appConfig.showSessions === false || savedSessions.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  countEl.textContent = `(${savedSessions.length})`;
  renderWorkspaceTabs();

  const filtered = savedSessions.filter(s => (s.workspace || 'Default') === currentWorkspace);

  if (filtered.length === 0) {
    list.innerHTML = `<div class="sessions-empty" style="display:block">Nothing in <strong>${esc(currentWorkspace)}</strong> yet.</div>`;
    return;
  }

  list.innerHTML = filtered.map(s => {
    const tabCount = (s.tabs || []).length;
    const safeName = esc(s.name || '');
    return `<div class="session-row" data-session-id="${s.id}">
      <div class="session-info">
        <div class="session-name" title="${safeName}">${safeName}</div>
        <div class="session-meta">${tabCount} tab${tabCount !== 1 ? 's' : ''} · ${formatSessionDate(s.created_at)}</div>
      </div>
      <div class="session-actions">
        <button class="session-btn session-btn-switch" data-action="switch-session" data-session-id="${s.id}" title="Close current tabs (auto-saved) and open this session">Switch</button>
        <button class="session-btn session-btn-restore" data-action="restore-session" data-session-id="${s.id}" title="Open this session's tabs alongside current ones">Restore</button>
        <button class="session-btn" data-action="rename-workspace" data-session-id="${s.id}" title="Move to workspace">Move</button>
        <button class="session-btn session-btn-delete" data-action="delete-session" data-session-id="${s.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  if (empty) empty.style.display = 'none';
}

async function renameWorkspace(sessionId) {
  const session = savedSessions.find(s => s.id === Number(sessionId));
  if (!session) return;
  const next = prompt('Move to workspace:', session.workspace || 'Default');
  if (!next) return;
  try {
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: next.trim().slice(0, 50) || 'Default' }),
    });
    if (!res.ok) { showToast('Failed to move'); return; }
    await fetchSessions();
    currentWorkspace = next.trim() || 'Default';
    renderSessions();
    showToast(`Moved to ${currentWorkspace}`);
  } catch { showToast('Failed to move'); }
}

function renderSnoozes() {
  const section = document.getElementById('snoozeSection');
  const list = document.getElementById('snoozeList');
  const countEl = document.getElementById('snoozeCount');
  if (!section || !list) return;
  if (activeSnoozes.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  if (countEl) countEl.textContent = `${activeSnoozes.length} tab${activeSnoozes.length !== 1 ? 's' : ''}`;
  list.innerHTML = activeSnoozes.map(s => {
    const wake = new Date(s.wake_at.replace(' ', 'T') + (s.wake_at.endsWith('Z') ? '' : 'Z'));
    const wakeStr = isNaN(wake.getTime()) ? s.wake_at : wake.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const ms = wake.getTime() - Date.now();
    const inLabel = ms <= 0 ? 'now' : msToHumanIn(ms);
    let host = '';
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { }
    return `<div class="snooze-row">
      <div class="snooze-info">
        <a class="snooze-title" href="${safeHref(s.url)}" target="_top">${esc(s.title || s.url || '')}</a>
        <div class="snooze-meta"><span>${esc(host)}</span><span>wakes ${inLabel} (${wakeStr})</span></div>
      </div>
      <div class="snooze-actions">
        <button class="session-btn" data-action="unsnooze-now" data-snooze-id="${s.id}">Wake now</button>
        <button class="session-btn session-btn-delete" data-action="cancel-snooze" data-snooze-id="${s.id}">Cancel</button>
      </div>
    </div>`;
  }).join('');
}

function msToHumanIn(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.round(h / 24);
  return `in ${d}d`;
}

function renderYesterdaySummary() {
  const card = document.getElementById('summaryCard');
  const stats = document.getElementById('summaryStats');
  if (!card || !stats) return;
  if (appConfig.showYesterdaySummary === false || !yesterdayStat) {
    card.style.display = 'none';
    return;
  }
  const top3 = Object.entries(yesterdayStat.domains || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if ((yesterdayStat.tabs_opened || 0) === 0 && (yesterdayStat.tabs_closed || 0) === 0 && top3.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  stats.innerHTML = `
    <div class="summary-stat"><div class="summary-stat-num">${yesterdayStat.tabs_opened || 0}</div><div class="summary-stat-label">opened</div></div>
    <div class="summary-stat"><div class="summary-stat-num">${yesterdayStat.tabs_closed || 0}</div><div class="summary-stat-label">closed</div></div>
    <div class="summary-stat summary-stat-top">
      <div class="summary-stat-label">Top domains</div>
      <div class="summary-top-list">${top3.map(([d, n]) => `<span><strong>${esc(d)}</strong> ${n}</span>`).join('') || '<span class="muted">—</span>'}</div>
    </div>`;
}

// Surface a "save these as a session?" banner when 5+ open tabs share a host
function renderSessionSuggestions() {
  const banner = document.getElementById('suggestBanner');
  if (!banner) return;
  if (appConfig.showSuggestions === false) { banner.style.display = 'none'; return; }
  const threshold = Math.max(3, Math.min(50, appConfig.suggestThreshold || 5));
  const tabs = getRealTabs();
  if (tabs.length < threshold) { banner.style.display = 'none'; return; }
  const groups = {};
  for (const t of tabs) {
    try {
      const host = new URL(t.url).hostname;
      if (!host) continue;
      groups[host] = (groups[host] || 0) + 1;
    } catch { }
  }
  const dismissed = new Set((sessionStorage.getItem('tabout-suggest-dismissed') || '').split(','));
  const candidates = Object.entries(groups)
    .filter(([host, n]) => n >= threshold && !dismissed.has(host))
    .filter(([host]) => !savedSessions.some(s => (s.name || '').toLowerCase().includes(host)))
    .sort((a, b) => b[1] - a[1]);
  if (candidates.length === 0) { banner.style.display = 'none'; return; }
  const [host, n] = candidates[0];
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span class="suggest-text">You have <strong>${n} ${esc(host.replace(/^www\./, ''))}</strong> tabs open. Save them as a session?</span>
    <div class="suggest-actions">
      <button class="suggest-btn suggest-btn-primary" data-action="suggest-save" data-suggest-host="${esc(host)}" data-suggest-count="${n}">Save as session</button>
      <button class="suggest-btn" data-action="suggest-dismiss" data-suggest-host="${esc(host)}">Dismiss</button>
    </div>`;
}

async function saveCurrentSession() {
  const realTabs = getRealTabs();
  if (realTabs.length === 0) {
    showToast('No tabs to save');
    return;
  }
  const name = (prompt(`Name this session (${realTabs.length} tabs):`) || '').trim();
  if (!name) return;
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        tabs: realTabs.map(t => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl })),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to save session');
      return;
    }
    await fetchSessions();
    renderSessions();
    showToast(`Saved "${name}"`);
    // Scroll the new session into view
    const section = document.getElementById('sessionsSection');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch {
    showToast('Failed to save session');
  }
}

async function restoreSession(id) {
  const session = savedSessions.find(s => s.id === Number(id));
  if (!session) return;
  const urls = (session.tabs || []).map(t => t.url).filter(Boolean);
  if (urls.length === 0) {
    showToast('Session has no URLs to restore');
    return;
  }
  const result = await sendToExtension('openTabs', { urls });
  if (result && result.success) {
    showToast(`Restored ${result.openedCount || urls.length} tabs`);
    setTimeout(() => refreshDynamicContent(), 300);
  } else {
    showToast('Could not restore — extension not available');
  }
}

async function switchToSession(id) {
  const target = savedSessions.find(s => s.id === Number(id));
  if (!target) return;
  const targetUrls = (target.tabs || []).map(t => t.url).filter(Boolean);
  if (targetUrls.length === 0) {
    showToast('Session has no URLs to switch to');
    return;
  }
  const currentTabs = getRealTabs();
  const currentUrls = currentTabs.map(t => t.url).filter(Boolean);

  // Step 1: auto-save current tabs (skip if there are none open)
  if (currentTabs.length > 0) {
    const stamp = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Auto-saved · ${stamp}`,
          tabs: currentTabs.map(t => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl })),
        }),
      });
    } catch { /* if save fails, still proceed — better to switch than block */ }
  }

  // Step 2: open the target session's tabs first (so we never end up with zero)
  const opened = await sendToExtension('openTabs', { urls: targetUrls });
  if (!opened || !opened.success) {
    showToast('Could not switch — extension not available');
    return;
  }

  // Step 3: close the previously-open tabs by exact URL match
  if (currentUrls.length > 0) {
    await sendToExtension('closeTabs', { urls: currentUrls, exact: true });
  }

  showToast(`Switched to "${target.name}"`);
  setTimeout(() => refreshDynamicContent(), 400);
}

async function deleteSession(id) {
  // Snapshot the session so we can recreate it on undo
  const snapshot = savedSessions.find(s => s.id === Number(id));
  if (!snapshot) return;
  try {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('Failed to delete session');
      return;
    }
    await fetchSessions();
    renderSessions();
    showToast(`Deleted "${snapshot.name}"`, {
      undo: async () => {
        try {
          await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: snapshot.name,
              workspace: snapshot.workspace || 'Default',
              tabs: snapshot.tabs || [],
            }),
          });
          await fetchSessions();
          renderSessions();
          showToast('Session restored');
        } catch { showToast('Failed to restore'); }
      },
    });
  } catch {
    showToast('Failed to delete session');
  }
}


/* ----------------------------------------------------------------
   COMMAND PALETTE — Cmd/Ctrl+K to jump to any open tab
   ---------------------------------------------------------------- */

const palette = {
  open: false,
  filtered: [],
  cursor: 0,
};

function openPalette() {
  if (palette.open) return;
  const overlay = document.getElementById('paletteOverlay');
  const input = document.getElementById('paletteInput');
  if (!overlay || !input) return;
  palette.open = true;
  palette.cursor = 0;
  overlay.style.display = 'flex';
  input.value = '';
  filterPalette('');
  // Focus on next frame to win against the keydown that opened us
  requestAnimationFrame(() => input.focus());
}

function closePalette() {
  if (!palette.open) return;
  palette.open = false;
  const overlay = document.getElementById('paletteOverlay');
  if (overlay) overlay.style.display = 'none';
}

// Available commands when the palette query starts with `>`. Each command
// has a label (shown in the row) and a run() function called on Enter.
function getPaletteCommands() {
  const cmds = [
    { label: 'Save current tabs as session', run: () => saveCurrentSession() },
    { label: 'Sweep stale tabs', run: () => openSweepModal() },
    { label: 'Switch theme: System', run: () => { localStorage.setItem('tabout-theme', 'system'); applyTheme('system'); showToast('Theme: System'); } },
    { label: 'Switch theme: Light', run: () => { localStorage.setItem('tabout-theme', 'light'); applyTheme('light'); showToast('Theme: Light'); } },
    { label: 'Switch theme: Dark', run: () => { localStorage.setItem('tabout-theme', 'dark'); applyTheme('dark'); showToast('Theme: Dark'); } },
    { label: 'Open settings', run: () => document.getElementById('settingsToggle')?.click() },
    { label: 'Refresh dashboard', run: () => refreshDynamicContent() },
    { label: 'Clear recently closed', run: () => { localStorage.removeItem('tabout-recently-closed'); renderRecentlyClosed(); showToast('Cleared'); } },
  ];
  for (const s of savedSessions) {
    cmds.push({
      label: `Switch to session: ${s.name}`,
      run: () => switchToSession(s.id),
    });
    cmds.push({
      label: `Restore session: ${s.name}`,
      run: () => restoreSession(s.id),
    });
  }
  return cmds;
}

// Fuzzy subsequence scorer. Returns a score (higher = better) or -1 if `q`
// isn't a subsequence of `text`. Rewards consecutive runs, matches at word
// boundaries, and matches near the start — so "gh pr" ranks "GitHub · Pull
// Request" above an incidental mid-word match.
function fuzzyScore(text, q) {
  if (!q) return 0;
  text = (text || '').toLowerCase();
  let ti = 0, score = 0, run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    if (c === ' ') { run = 0; continue; } // spaces just separate, don't need to match
    const found = text.indexOf(c, ti);
    if (found === -1) return -1;
    let bonus = 1;
    if (found === ti) { run++; bonus += run * 2; } else { run = 1; }
    const prev = found > 0 ? text[found - 1] : ' ';
    if (/[\s\/\-_.·—|:]/.test(prev)) bonus += 4; // word-boundary start
    if (found < 12) bonus += 1;                  // near the front
    score += bonus;
    ti = found + 1;
  }
  return score;
}

function filterPalette(query) {
  const raw = query || '';
  const isCmd = raw.startsWith('>');
  const q = (isCmd ? raw.slice(1) : raw).trim().toLowerCase();
  if (isCmd) {
    const cmds = getPaletteCommands();
    palette.filtered = (q
      ? cmds.map(c => ({ c, s: fuzzyScore(c.label, q) }))
          .filter(x => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .map(x => x.c)
      : cmds
    ).slice(0, 50).map(c => ({ kind: 'command', label: c.label, run: c.run }));
  } else {
    const tabs = getRealTabs();
    const matched = q
      ? tabs.map(t => ({ t, s: Math.max(fuzzyScore(t.title || '', q), fuzzyScore(t.url || '', q)) }))
          .filter(x => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .map(x => x.t)
      : tabs;
    palette.filtered = matched.slice(0, 50).map(t => ({ kind: 'tab', tab: t }));
  }
  palette.cursor = 0;
  renderPalette();
}

function renderPalette() {
  const results = document.getElementById('paletteResults');
  if (!results) return;
  if (palette.filtered.length === 0) {
    results.innerHTML = `<div class="palette-empty">No matches</div>`;
    return;
  }
  results.innerHTML = palette.filtered.map((entry, i) => {
    const activeCls = i === palette.cursor ? ' active' : '';
    if (entry.kind === 'command') {
      return `<div class="palette-row palette-row-cmd${activeCls}" data-palette-index="${i}">
        <span class="palette-cmd-icon">›</span>
        <span class="palette-title">${esc(entry.label)}</span>
      </div>`;
    }
    const t = entry.tab;
    let host = '';
    try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch { }
    const safeUrl = esc(t.url || '');
    const title = esc(t.title || t.url || '');
    const favicon = getTabFavicon(t);
    return `<div class="palette-row${activeCls}" data-palette-index="${i}" data-palette-url="${safeUrl}">
      ${favicon ? `<img class="palette-favicon" src="${esc(favicon)}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="palette-title">${title}</span>
      <span class="palette-host">${esc(host)}</span>
    </div>`;
  }).join('');

  // Make sure the active row is in view
  const active = results.querySelector('.palette-row.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function movePaletteCursor(delta) {
  if (palette.filtered.length === 0) return;
  palette.cursor = (palette.cursor + delta + palette.filtered.length) % palette.filtered.length;
  renderPalette();
}

async function activatePaletteRow(idx) {
  const entry = palette.filtered[idx];
  if (!entry) return;
  closePalette();
  if (entry.kind === 'command') {
    try { await entry.run(); } catch { }
    return;
  }
  await sendToExtension('focusTab', { url: entry.tab.url });
}

function initCommandPalette() {
  const overlay = document.getElementById('paletteOverlay');
  const input = document.getElementById('paletteInput');
  const results = document.getElementById('paletteResults');
  if (!overlay || !input || !results) return;

  // Cmd/Ctrl+K opens the palette from anywhere
  document.addEventListener('keydown', (e) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (palette.open) { closePalette(); } else { openPalette(); }
      return;
    }
    if (!palette.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      movePaletteCursor(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      movePaletteCursor(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activatePaletteRow(palette.cursor);
    }
  });

  input.addEventListener('input', () => filterPalette(input.value));

  results.addEventListener('click', (e) => {
    const row = e.target.closest('[data-palette-index]');
    if (!row) return;
    activatePaletteRow(Number(row.dataset.paletteIndex));
  });

  results.addEventListener('mousemove', (e) => {
    const row = e.target.closest('[data-palette-index]');
    if (!row) return;
    const idx = Number(row.dataset.paletteIndex);
    if (idx !== palette.cursor) {
      palette.cursor = idx;
      renderPalette();
    }
  });

  // Click outside the palette closes it
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePalette();
  });
}
