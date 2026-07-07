/* ================================================================
   Tab Out — Dashboard App

   This file is the brain of the dashboard. It:
   1. Talks to the Chrome extension (to read/close actual browser tabs)
   2. Groups open tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus)
   ================================================================ */

'use strict';

/* ----------------------------------------------------------------
   THEME — applied immediately to prevent a flash of the wrong palette.
   localStorage key `tabout-theme` is one of: 'system' | 'light' | 'dark'.
   We migrate the legacy boolean `tabout-dark-mode` once, then forget it.
   ---------------------------------------------------------------- */
(function migrateLegacyDarkMode() {
  if (localStorage.getItem('tabout-theme')) return;
  const legacy = localStorage.getItem('tabout-dark-mode');
  if (legacy === 'true') {
    localStorage.setItem('tabout-theme', 'dark');
  } else if (legacy === 'false') {
    localStorage.setItem('tabout-theme', 'light');
  }
  localStorage.removeItem('tabout-dark-mode');
})();

function getStoredTheme() {
  const t = localStorage.getItem('tabout-theme');
  return t === 'light' || t === 'dark' || t === 'system' ? t : 'system';
}

function resolveTheme(theme) {
  if (theme === 'system') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  document.body.classList.toggle('dark-mode', resolved === 'dark');
}

applyTheme(getStoredTheme());

// Per-device preference: when on, clicking a URL in Saved for Later /
// Recently Closed / Archive opens it in a background tab via the extension
// instead of navigating the foreground.
function getOpenInBackground() {
  return localStorage.getItem('tabout-open-in-background') === 'true';
}

// Live-update when the OS theme flips (only matters in 'system' mode)
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  });
}

/* ----------------------------------------------------------------
   APP CONFIG — fetched from server, controls all customizations
   ---------------------------------------------------------------- */
let appConfig = {
  userName: '',
  pomodoroWorkMinutes: 25,
  pomodoroBreakMinutes: 5,
  clockShowSeconds: false,
  clockFormat: '12',
  quoteText: '',
  quoteAuthor: '',
  useDynamicQuote: false,
  searchEngine: 'google',
  quickLinks: [],
  staleWhitelist: [],
  showWeather: true,
  showQuote: true,
  showPomodoro: true,
  showQuickLinks: true,
  showSearch: true,
  showRecentlyClosed: true,
  showYesterdaySummary: true,
  showHeatmap: true,
  showSuggestions: true,
  showSessions: true,
  autoRefreshSeconds: 30,
  soundEffects: true,
  confettiEffects: true,
  staleThresholdDays: 7,
  heatmapWeeks: 26,
  compactMode: false,
  animationsEnabled: true,
  weekStartsOnMonday: false,
  suggestThreshold: 5,
  tabCapWarning: 0,
};

const SEARCH_ENGINES = {
  google: { name: 'Google', action: 'https://www.google.com/search', param: 'q' },
  bing: { name: 'Bing', action: 'https://www.bing.com/search', param: 'q' },
  duckduckgo: { name: 'DuckDuckGo', action: 'https://duckduckgo.com/', param: 'q' },
  brave: { name: 'Brave', action: 'https://search.brave.com/search', param: 'q' },
  ecosia: { name: 'Ecosia', action: 'https://www.ecosia.org/search', param: 'q' },
};

async function loadAppConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      appConfig = { ...appConfig, ...data };
    }
  } catch { /* use defaults */ }
}

async function saveAppConfig(updates) {
  try {
    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = await res.json();
      appConfig = { ...appConfig, ...data };
      applyConfigToUI();
      showToast('Settings saved');
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to save settings');
    }
  } catch {
    showToast('Failed to save settings');
  }
}

function applyConfigToUI() {
  const greetingEl = document.getElementById('greeting');
  if (greetingEl) greetingEl.textContent = getGreeting();

  const dateEl = document.getElementById('dateDisplay');
  if (dateEl) dateEl.textContent = getDateDisplay();

  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  if (searchForm && searchInput) {
    const engine = SEARCH_ENGINES[appConfig.searchEngine] || SEARCH_ENGINES.google;
    searchForm.action = engine.action;
    searchForm.method = 'get';
    searchInput.name = engine.param;
    searchInput.placeholder = `Search ${engine.name}...`;
  }

  const clockEl = document.getElementById('headerClock');
  if (clockEl) {
    const opts = { hour: 'numeric', minute: '2-digit', hour12: appConfig.clockFormat !== '24' };
    if (appConfig.clockShowSeconds) opts.second = '2-digit';
    clockEl.textContent = new Date().toLocaleTimeString('en-US', opts);
  }

  resetPomodoro();
  renderQuickLinks();
  applySectionVisibility();
  applyDisplayMode();
  applyAutoRefreshInterval();
}

// Section visibility — show/hide each major dashboard region based on the
// flags in appConfig. Re-runs on every config save so toggles are instant.
function applySectionVisibility() {
  const map = {
    showWeather: '#weatherWidget',
    showQuote: '#dailyQuote',
    showPomodoro: '#pomodoro',
    showQuickLinks: '#quickLinksNav',
    showSearch: '#searchForm',
    showRecentlyClosed: '#recentlyClosedSection',
    showYesterdaySummary: '#summaryCard',
    showHeatmap: '#heatmapSection',
    showSuggestions: '#suggestBanner',
    showSessions: '#sessionsSection',
  };
  for (const [flag, sel] of Object.entries(map)) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (appConfig[flag] === false) {
      el.dataset.hiddenByConfig = '1';
      el.style.display = 'none';
    } else {
      // Don't override sections that legitimately stay hidden (e.g. weather
      // until it loads, sessions when empty). Only clear our own flag and let
      // the natural render decide.
      if (el.dataset.hiddenByConfig === '1') {
        delete el.dataset.hiddenByConfig;
        el.style.display = '';
      }
    }
  }
}

// Compact mode + animations — both apply via body classes that the CSS keys off
function applyDisplayMode() {
  document.body.classList.toggle('compact-mode', appConfig.compactMode === true);
  document.body.classList.toggle('animations-off', appConfig.animationsEnabled === false);
}

// Auto-refresh interval: clear any prior timer and re-arm with the chosen rate.
let refreshIntervalId = null;
function applyAutoRefreshInterval() {
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  refreshIntervalId = null;
  const seconds = appConfig.autoRefreshSeconds;
  if (typeof seconds === 'number' && seconds > 0) {
    refreshIntervalId = setInterval(() => refreshDynamicContent(), seconds * 1000);
  }
}

const ICON_SUN = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>';
const ICON_MOON = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>';

// Pomodoro icons — same Lucide line style + 14px sizing as the rest of the
// header buttons so play / pause / reset all read at one visual weight.
const ICON_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
const ICON_PAUSE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
const ICON_RESET = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

/* ----------------------------------------------------------------
   QUICK LINKS DATA
   ---------------------------------------------------------------- */
const DEFAULT_QUICK_LINKS = [
  { url: 'https://www.google.com', title: 'Google', icon: 'https://www.google.com/favicon.ico' },
  { url: 'https://mail.google.com/chat/', title: 'Google Chat', icon: 'https://www.google.com/s2/favicons?domain=chat.google.com&sz=32' },
  { url: 'https://web.whatsapp.com', title: 'WhatsApp', icon: 'https://web.whatsapp.com/favicon.ico' },
  { url: 'https://www.fiverr.com/seller_dashboard', title: 'Fiverr', icon: 'https://www.fiverr.com/favicon.ico' },
  { url: 'https://docs.google.com/spreadsheets/d/14JdVdf0upNUuH7U3YjANOgfE29zsTCarbCCaPNrkoHc/edit?pli=1&gid=1805970936#gid=1805970936', title: 'Master Sheet', icon: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico' },
  { url: 'https://app.rocketmoney.com/', title: 'Rocket Money', icon: 'https://www.google.com/s2/favicons?domain=rocketmoney.com&sz=32' },
  { url: 'https://github.com', title: 'GitHub', icon: 'https://github.com/favicon.ico' },
  { url: 'https://www.perplexity.ai/', title: 'Perplexity', icon: 'https://www.google.com/s2/favicons?domain=perplexity.ai&sz=32' },
  { url: 'https://claude.ai', title: 'Claude', icon: 'https://www.google.com/s2/favicons?domain=claude.ai&sz=32' },
  { url: 'https://aistudio.google.com/prompts/new_chat', title: 'AI Studio', icon: 'https://www.google.com/s2/favicons?domain=aistudio.google.com&sz=32' },
  { url: 'https://chatgpt.com/', title: 'ChatGPT', icon: 'https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32' },
  { url: 'https://grok.com/', title: 'Grok', icon: 'https://www.google.com/s2/favicons?domain=grok.com&sz=32' },
  { url: 'https://gemini.google.com/', title: 'Gemini', icon: 'https://www.google.com/s2/favicons?domain=gemini.google.com&sz=32' },
  { url: 'https://portal.markstudios.com/', title: 'Mark Studios Portal', icon: 'https://www.google.com/s2/favicons?domain=markstudios.com&sz=32' },
  { url: 'https://x.com', title: 'X', icon: 'https://www.google.com/s2/favicons?domain=x.com&sz=32' },
  { url: 'https://www.youtube.com', title: 'YouTube', icon: 'https://www.youtube.com/favicon.ico' },
  { url: 'https://kick.com/', title: 'Kick', icon: 'https://www.google.com/s2/favicons?domain=kick.com&sz=32' },
  { url: 'https://letterboxd.com/', title: 'Letterboxd', icon: 'https://www.google.com/s2/favicons?domain=letterboxd.com&sz=32' },
];

/* ----------------------------------------------------------------
   DAILY QUOTES
   ---------------------------------------------------------------- */
const QUOTES = [
  { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Chinese Proverb' },
  { text: 'Done is better than perfect.', author: 'Sheryl Sandberg' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Ship it.', author: 'Every startup ever' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius' },
  { text: 'Discipline equals freedom.', author: 'Jocko Willink' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Aristotle' },
  { text: 'Stay hungry. Stay foolish.', author: 'Steve Jobs' },
  { text: 'Your time is limited, don\'t waste it living someone else\'s life.', author: 'Steve Jobs' },
  { text: 'Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.', author: 'Antoine de Saint-Exupery' },
  { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'Everything you\'ve ever wanted is on the other side of fear.', author: 'George Addair' },
  { text: 'The man who moves a mountain begins by carrying away small stones.', author: 'Confucius' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'Hard choices, easy life. Easy choices, hard life.', author: 'Jerzy Gregorek' },
  { text: 'If you want to go fast, go alone. If you want to go far, go together.', author: 'African Proverb' },
  { text: 'Focus is saying no to a thousand good ideas.', author: 'Steve Jobs' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'What gets measured gets managed.', author: 'Peter Drucker' },
  { text: 'Be so good they can\'t ignore you.', author: 'Steve Martin' },
  { text: 'The obstacle is the way.', author: 'Ryan Holiday' },
  { text: 'Move fast and break things. Unless you are breaking stuff, you are not moving fast enough.', author: 'Mark Zuckerberg' },
  { text: 'Ideas are easy. Implementation is hard.', author: 'Guy Kawasaki' },
  { text: 'A year from now you may wish you had started today.', author: 'Karen Lamb' },
  { text: 'Luck is what happens when preparation meets opportunity.', author: 'Seneca' },
];

function getDailyQuote() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return QUOTES[dayOfYear % QUOTES.length];
}

/* ----------------------------------------------------------------
   POMODORO STATE
   ---------------------------------------------------------------- */
let pomodoroState = { running: false, secondsLeft: 25 * 60, isBreak: false, intervalId: null, lastTick: null };

function loadPomodoroState() {
  const saved = localStorage.getItem('tabout-pomodoro');
  if (!saved) return;
  try {
    const s = JSON.parse(saved);
    pomodoroState.secondsLeft = s.secondsLeft;
    pomodoroState.isBreak = s.isBreak;
    pomodoroState.running = s.running;
    pomodoroState.lastTick = s.lastTick;
    // Account for time elapsed while page was closed
    if (s.running && s.lastTick) {
      const elapsed = Math.floor((Date.now() - s.lastTick) / 1000);
      pomodoroState.secondsLeft = Math.max(0, s.secondsLeft - elapsed);
    }
  } catch { /* ignore */ }
}

function savePomodoroState() {
  localStorage.setItem('tabout-pomodoro', JSON.stringify({
    secondsLeft: pomodoroState.secondsLeft,
    isBreak: pomodoroState.isBreak,
    running: pomodoroState.running,
    lastTick: pomodoroState.running ? Date.now() : null,
  }));
}

function updatePomodoroDisplay() {
  const el = document.getElementById('pomodoroTime');
  if (!el) return;
  const m = Math.floor(pomodoroState.secondsLeft / 60);
  const s = pomodoroState.secondsLeft % 60;
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  const container = document.getElementById('pomodoro');
  if (container) {
    container.classList.toggle('running', pomodoroState.running && !pomodoroState.isBreak);
    container.classList.toggle('on-break', pomodoroState.running && pomodoroState.isBreak);
  }
}

function pomodoroTick() {
  pomodoroState.secondsLeft--;
  pomodoroState.lastTick = Date.now();
  if (pomodoroState.secondsLeft <= 0) {
    pomodoroState.running = false;
    clearInterval(pomodoroState.intervalId);
    pomodoroState.intervalId = null;
    if (pomodoroState.isBreak) {
      showToast('Break over! Time to focus.');
      pomodoroState.isBreak = false;
      pomodoroState.secondsLeft = 25 * 60;
    } else {
      showToast('Time for a break!');
      pomodoroState.isBreak = true;
      pomodoroState.secondsLeft = 5 * 60;
    }
    const btn = document.querySelector('[data-action="pomodoro-toggle"]');
    if (btn) btn.innerHTML = ICON_PLAY;
  }
  savePomodoroState();
  updatePomodoroDisplay();
}

function startPomodoro() {
  pomodoroState.running = true;
  pomodoroState.lastTick = Date.now();
  pomodoroState.intervalId = setInterval(pomodoroTick, 1000);
  const btn = document.querySelector('[data-action="pomodoro-toggle"]');
  if (btn) btn.innerHTML = ICON_PAUSE;
  savePomodoroState();
  updatePomodoroDisplay();
}

function pausePomodoro() {
  pomodoroState.running = false;
  clearInterval(pomodoroState.intervalId);
  pomodoroState.intervalId = null;
  const btn = document.querySelector('[data-action="pomodoro-toggle"]');
  if (btn) btn.innerHTML = '&#9654;';
  savePomodoroState();
  updatePomodoroDisplay();
}

function resetPomodoro() {
  pomodoroState.running = false;
  pomodoroState.isBreak = false;
  pomodoroState.secondsLeft = (appConfig.pomodoroWorkMinutes || 25) * 60;
  clearInterval(pomodoroState.intervalId);
  pomodoroState.intervalId = null;
  const btn = document.querySelector('[data-action="pomodoro-toggle"]');
  if (btn) btn.innerHTML = '&#9654;';
  savePomodoroState();
  updatePomodoroDisplay();
}

function pomodoroTick() {
  pomodoroState.secondsLeft--;
  pomodoroState.lastTick = Date.now();
  if (pomodoroState.secondsLeft <= 0) {
    pomodoroState.running = false;
    clearInterval(pomodoroState.intervalId);
    pomodoroState.intervalId = null;
    if (pomodoroState.isBreak) {
      showToast('Break over! Time to focus.');
      pomodoroState.isBreak = false;
      pomodoroState.secondsLeft = (appConfig.pomodoroWorkMinutes || 25) * 60;
    } else {
      showToast('Time for a break!');
      pomodoroState.isBreak = true;
      pomodoroState.secondsLeft = (appConfig.pomodoroBreakMinutes || 5) * 60;
    }
    const btn = document.querySelector('[data-action="pomodoro-toggle"]');
    if (btn) btn.innerHTML = ICON_PLAY;
  }
  savePomodoroState();
  updatePomodoroDisplay();
}

/* ----------------------------------------------------------------
   RECENTLY CLOSED TABS
   ---------------------------------------------------------------- */
function saveToRecentlyClosed(url, title) {
  const key = 'tabout-recently-closed';
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list.unshift({ url, title, closedAt: new Date().toISOString() });
  if (list.length > 20) list.length = 20;
  localStorage.setItem(key, JSON.stringify(list));
}

function renderRecentlyClosed() {
  const section = document.getElementById('recentlyClosedSection');
  const list = JSON.parse(localStorage.getItem('tabout-recently-closed') || '[]');
  if (!section) return;
  if (appConfig.showRecentlyClosed === false || list.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  const countEl = document.getElementById('recentlyClosedCount');
  if (countEl) countEl.textContent = list.length;
  const listEl = document.getElementById('recentlyClosedList');
  if (!listEl) return;
  listEl.innerHTML = list.map((item, i) => {
    const domain = (() => { try { return new URL(item.url).hostname; } catch { return ''; } })();
    return `<div class="archive-item">
      <a href="${item.url}" target="_top" class="archive-item-title" data-action="reopen-closed-tab" data-index="${i}" title="${item.title}">${item.title || item.url}</a>
      <span class="archive-item-date">${timeAgo(item.closedAt)}</span>
    </div>`;
  }).join('');
}

/* ----------------------------------------------------------------
   QUICK LINKS — render + drag-to-reorder
   ---------------------------------------------------------------- */
function getQuickLinks() {
  if (appConfig.quickLinks && appConfig.quickLinks.length > 0) {
    return appConfig.quickLinks;
  }
  const saved = localStorage.getItem('tabout-quick-links-order');
  if (saved) {
    try { return JSON.parse(saved); } catch { /* fall through */ }
  }
  return DEFAULT_QUICK_LINKS;
}

function saveQuickLinksOrder(links) {
  localStorage.setItem('tabout-quick-links-order', JSON.stringify(links));
}

function renderQuickLinks() {
  const nav = document.getElementById('quickLinksNav');
  if (!nav) return;
  const links = getQuickLinks();
  nav.innerHTML = links.map((link, i) =>
    `<a href="${link.url}" class="quick-link" target="_top" title="${link.title}" draggable="true" data-link-index="${i}">
      <img src="${link.icon}" alt="${link.title}" class="quick-link-icon">
    </a>`
  ).join('');
  initQuickLinkDrag();
}

function initQuickLinkDrag() {
  const nav = document.getElementById('quickLinksNav');
  if (!nav) return;
  let dragSrcIndex = null;

  nav.addEventListener('dragstart', (e) => {
    const link = e.target.closest('.quick-link');
    if (!link) return;
    dragSrcIndex = parseInt(link.dataset.linkIndex);
    link.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcIndex);
  });

  nav.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.quick-link');
    nav.querySelectorAll('.quick-link').forEach(l => l.classList.remove('drag-over'));
    if (target) target.classList.add('drag-over');
  });

  nav.addEventListener('dragleave', (e) => {
    const target = e.target.closest('.quick-link');
    if (target) target.classList.remove('drag-over');
  });

  nav.addEventListener('dragend', (e) => {
    nav.querySelectorAll('.quick-link').forEach(l => {
      l.classList.remove('dragging', 'drag-over');
    });
  });

  nav.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.quick-link');
    if (!target) return;
    const dropIndex = parseInt(target.dataset.linkIndex);
    if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;
    const links = getQuickLinks();
    const [moved] = links.splice(dragSrcIndex, 1);
    links.splice(dropIndex, 0, moved);
    saveQuickLinksOrder(links);
    renderQuickLinks();
    showToast('Links reordered');
  });
}

/* ----------------------------------------------------------------
   WEATHER
   ---------------------------------------------------------------- */
async function fetchWeather() {
  const cacheKey = 'tabout-weather-cache';
  const tempPattern = /^[+\-]?\d+°[CF]$/;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached);
      const fresh = Date.now() - data.timestamp < 30 * 60 * 1000;
      if (fresh && tempPattern.test(data.temp)) return data;
    } catch { /* refetch */ }
  }
  const resp = await fetch('https://wttr.in/?format=%t+%C');
  const text = (await resp.text()).trim();
  // wttr.in occasionally returns an HTML error page instead of the requested
  // plain-text format. Reject anything that isn't "+72°F Sunny" shaped so we
  // don't dump raw markup into the widget or poison the cache.
  const match = text.match(/^([+\-]?\d+°[CF])\s+(.+)$/);
  if (!match) throw new Error('wttr.in returned unexpected response');
  const result = { temp: match[1], condition: match[2], timestamp: Date.now() };
  localStorage.setItem(cacheKey, JSON.stringify(result));
  return result;
}

async function renderWeather() {
  const el = document.getElementById('weatherWidget');
  if (!el) return;
  try {
    const w = await fetchWeather();
    el.textContent = w.condition ? `${w.temp} · ${w.condition}` : w.temp;
    el.style.display = 'block';
  } catch {
    el.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   EXTENSION BRIDGE

   The dashboard runs in an iframe inside the Chrome extension's
   new-tab page. To communicate with the extension's background
   script, we use window.postMessage — the extension's content
   script listens and relays messages.

   When running in a regular browser tab (dev mode), we gracefully
   fall back without crashing.
   ---------------------------------------------------------------- */

// Track whether the extension is actually available (set after first successful call)
let extensionAvailable = false;

// Track all open tabs fetched from the extension (array of tab objects)
let openTabs = [];

/**
 * sendToExtension(action, data)
 *
 * Sends a message to the parent frame (the Chrome extension) and
 * waits up to 3 seconds for a response.
 *
 * Think of it like sending a text message and waiting for a reply —
 * if no reply comes in 3 seconds, we give up gracefully.
 */
function sendToExtension(action, data = {}) {
  return new Promise((resolve) => {
    // If we're not inside an iframe, there's no extension to talk to
    if (window.parent === window) {
      resolve({ success: false, reason: 'not-in-extension' });
      return;
    }

    // Generate a random ID so we can match the response to this specific request
    const messageId = 'tmc-' + Math.random().toString(36).slice(2);

    // Set a 3-second timeout in case the extension doesn't respond
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ success: false, reason: 'timeout' });
    }, 3000);

    // Listen for the matching response from the extension
    function handler(event) {
      if (event.data && event.data.messageId === messageId) {
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(event.data);
      }
    }

    window.addEventListener('message', handler);

    // Send the message to the parent frame (extension)
    window.parent.postMessage({ action, messageId, ...data }, '*');
  });
}

/**
 * fetchOpenTabs()
 *
 * Asks the extension for the list of currently open browser tabs.
 * Sets extensionAvailable = true if it works, false otherwise.
 */
async function fetchOpenTabs() {
  const result = await sendToExtension('getTabs');
  if (result && result.success && Array.isArray(result.tabs)) {
    openTabs = result.tabs;
    extensionAvailable = true;
  } else {
    openTabs = [];
    extensionAvailable = false;
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Tells the extension to close all tabs matching the given URLs.
 * After closing, we re-fetch the tab list so our state stays accurate.
 */
async function closeTabsByUrls(urls) {
  if (!extensionAvailable || !urls || urls.length === 0) return;
  await sendToExtension('closeTabs', { urls });
  // Refresh our local tab list to reflect what was closed
  await fetchOpenTabs();
}

/**
 * focusTabsByUrls(urls)
 *
 * Tells the extension to bring the first matching tab into focus
 * (switch to that tab in Chrome). Used by the "Focus on this" button.
 */
async function focusTabsByUrls(urls) {
  if (!extensionAvailable || !urls || urls.length === 0) return;
  await sendToExtension('focusTabs', { urls });
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * showToast(message)
 *
 * Shows a brief pop-up notification at the bottom of the screen.
 * Like the little notification that pops up when you send a message.
 */
/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  if (appConfig.soundEffects === false) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — this creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 *
 * Each particle:
 * - Is either a circle or a square (randomly chosen)
 * - Uses the dashboard's color palette: amber, sage, slate, with some light variants
 * - Flies outward in a random direction with a gravity arc
 * - Fades out over ~800ms, then is removed from the DOM
 *
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  if (appConfig.confettiEffects === false) return;
  // Color palette drawn from the dashboard's CSS variables
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    // Randomly decide: circle or square
    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px

    // Pick a random color from the palette
    const color = colors[Math.floor(Math.random() * colors.length)];

    // Style the particle
    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle = Math.random() * Math.PI * 2;           // random direction (radians)
    const speed = 60 + Math.random() * 120;              // px/second
    const vx = Math.cos(angle) * speed;               // horizontal velocity
    const vy = Math.sin(angle) * speed - 80;          // vertical: bias upward a bit
    const gravity = 200;                                   // downward pull (px/s²)

    const startTime = performance.now();
    const duration = 700 + Math.random() * 200;          // 700–900ms

    // Animate with requestAnimationFrame for buttery-smooth motion
    function frame(now) {
      const elapsed = (now - startTime) / 1000; // seconds
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) {
        el.remove();
        return;
      }

      // Position: initial velocity + gravity arc
      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;

      // Fade out during the second half of the animation
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;

      // Slight rotation for realism
      const rotate = elapsed * 200 * (isCircle ? 0 : 1); // squares spin, circles don't

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card in two phases:
 * 1. Fade out + scale down (GPU-accelerated, smooth)
 * 2. After fade completes, remove from DOM
 *
 * Also fires confetti from the card's center for a satisfying "done!" moment.
 */
function animateCardOut(card) {
  if (!card) return;

  // Get the card's center position on screen for the confetti origin
  const rect = card.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // Shoot confetti from the card's center
  shootConfetti(cx, cy);

  // Phase 1: fade + scale down
  card.classList.add('closing');
  // Phase 2: remove from DOM after animation
  setTimeout(() => {
    card.remove();
    // After card is gone, check if the missions grid is now empty
    // and show the empty state if so
    checkAndShowEmptyState();
  }, 300);
}

// showToast(message, options?)
//   options.undo = async function — shows an Undo link for ~5s; clicking it
//                  hides the toast and runs the function.
//   options.duration = number ms (defaults: 2500 normal / 5000 with undo)
let toastTimer = null;
function showToast(message, options = {}) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const text = document.getElementById('toastText');
  if (text) text.textContent = message;
  // Drop any prior undo button
  toast.querySelectorAll('.toast-undo').forEach(b => b.remove());
  if (typeof options.undo === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-undo';
    btn.textContent = 'Undo';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await options.undo(); } catch { }
      toast.classList.remove('visible');
    });
    toast.appendChild(btn);
  }
  toast.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  const duration = options.duration || (options.undo ? 5000 : 2500);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    toast.querySelectorAll('.toast-undo').forEach(b => b.remove());
  }, duration);
}

/**
 * checkAndShowEmptyState()
 *
 * Called after each card is removed from the DOM. If all mission cards
 * are gone (the grid is empty), we swap in a fun empty state instead of
 * showing a blank, lifeless grid.
 *
 */
function checkAndShowEmptyState() {

  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  // Count remaining mission cards (excludes anything already animating out)
  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  // All missions are gone — show the empty state
  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  // Update the section count to reflect the clear state
  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 missions';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * e.g. "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';

  const then = new Date(dateStr);
  const now = new Date();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting()
 *
 * Returns an appropriate greeting based on the current hour.
 * Morning = before noon, Afternoon = noon–5pm, Evening = after 5pm.
 * No name — Tab Out is for everyone now.
 */
function getGreeting() {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  else greeting = 'Good evening';
  if (appConfig.userName && appConfig.userName.trim()) {
    greeting += ', ' + appConfig.userName.trim();
  }
  return greeting;
}

/**
 * getDateDisplay()
 *
 * Returns a formatted date string like "Friday, April 4, 2026".
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * countOpenTabsForMission(missionUrls)
 *
 * Counts how many of the user's currently open browser tabs
 * match any of the URLs associated with a mission.
 *
 * We match by domain (hostname) rather than exact URL, because
 * the exact URL often changes (e.g. page IDs, session tokens).
 */
function countOpenTabsForMission(missionUrls) {
  return getOpenTabsForMission(missionUrls).length;
}

/**
 * getOpenTabsForMission(missionUrls)
 *
 * Returns the actual tab objects from openTabs that match
 * any URL in the mission's URL list (matched by domain).
 */
function getOpenTabsForMission(missionUrls) {
  if (!missionUrls || missionUrls.length === 0 || openTabs.length === 0) return [];

  // Extract the domains from the mission's saved URLs
  // missionUrls can be either URL strings or objects with a .url property
  const missionDomains = missionUrls.map(item => {
    const urlStr = (typeof item === 'string') ? item : (item.url || '');
    try {
      return new URL(urlStr.startsWith('http') ? urlStr : 'https://' + urlStr).hostname;
    } catch {
      return urlStr;
    }
  });

  // Find open tabs whose hostname matches any mission domain
  return openTabs.filter(tab => {
    try {
      const tabDomain = new URL(tab.url).hostname;
      return missionDomains.some(d => tabDomain.includes(d) || d.includes(tabDomain));
    } catch {
      return false;
    }
  });
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS

   We store these as a constant so we can reuse them in buttons
   without writing raw SVG every time. Each value is an HTML string
   ready to be injected with innerHTML.
   ---------------------------------------------------------------- */
/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS

   Make domain names and tab titles more readable.
   - friendlyDomain() turns "github.com" into "GitHub"
   - cleanTitle() strips redundant site names from the end of titles
   ---------------------------------------------------------------- */

// Map of known domains → friendly display names.
// Covers the most common sites; everything else gets a smart fallback.
const FRIENDLY_DOMAINS = {
  'github.com': 'GitHub',
  'www.github.com': 'GitHub',
  'gist.github.com': 'GitHub Gist',
  'youtube.com': 'YouTube',
  'www.youtube.com': 'YouTube',
  'music.youtube.com': 'YouTube Music',
  'x.com': 'X',
  'www.x.com': 'X',
  'twitter.com': 'X',
  'www.twitter.com': 'X',
  'reddit.com': 'Reddit',
  'www.reddit.com': 'Reddit',
  'old.reddit.com': 'Reddit',
  'substack.com': 'Substack',
  'www.substack.com': 'Substack',
  'medium.com': 'Medium',
  'www.medium.com': 'Medium',
  'linkedin.com': 'LinkedIn',
  'www.linkedin.com': 'LinkedIn',
  'stackoverflow.com': 'Stack Overflow',
  'www.stackoverflow.com': 'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com': 'Google',
  'www.google.com': 'Google',
  'mail.google.com': 'Gmail',
  'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive',
  'calendar.google.com': 'Google Calendar',
  'meet.google.com': 'Google Meet',
  'gemini.google.com': 'Gemini',
  'chatgpt.com': 'ChatGPT',
  'www.chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'www.claude.ai': 'Claude',
  'code.claude.com': 'Claude Code',
  'notion.so': 'Notion',
  'www.notion.so': 'Notion',
  'figma.com': 'Figma',
  'www.figma.com': 'Figma',
  'slack.com': 'Slack',
  'app.slack.com': 'Slack',
  'discord.com': 'Discord',
  'www.discord.com': 'Discord',
  'wikipedia.org': 'Wikipedia',
  'en.wikipedia.org': 'Wikipedia',
  'amazon.com': 'Amazon',
  'www.amazon.com': 'Amazon',
  'netflix.com': 'Netflix',
  'www.netflix.com': 'Netflix',
  'spotify.com': 'Spotify',
  'open.spotify.com': 'Spotify',
  'vercel.com': 'Vercel',
  'www.vercel.com': 'Vercel',
  'npmjs.com': 'npm',
  'www.npmjs.com': 'npm',
  'developer.mozilla.org': 'MDN',
  'arxiv.org': 'arXiv',
  'www.arxiv.org': 'arXiv',
  'huggingface.co': 'Hugging Face',
  'www.huggingface.co': 'Hugging Face',
  'producthunt.com': 'Product Hunt',
  'www.producthunt.com': 'Product Hunt',
  'xiaohongshu.com': 'RedNote',
  'www.xiaohongshu.com': 'RedNote',
  'local-files': 'Local Files',
};

/**
 * friendlyDomain(hostname)
 *
 * Turns a raw hostname into a human-readable name.
 * 1. Check the lookup map for known domains
 * 2. For subdomains of known domains, check if the parent matches
 *    (e.g. "docs.github.com" → "GitHub Docs")
 * 3. Fallback: strip "www.", strip TLD, capitalize
 *    (e.g. "minttr.com" → "Minttr", "blog.example.co.uk" → "Blog Example")
 */
function getTabFavicon(tab) {
  if (tab.favIconUrl) return tab.favIconUrl;
  try {
    const domain = new URL(tab.url).hostname;
    return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
  } catch { return ''; }
}

function friendlyDomain(hostname) {
  if (!hostname) return '';

  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname === 'local-files') return 'Local Files';

  // chrome-extension:// hostnames are extension IDs — show "Extensions" for the card
  if (/^[a-z]{32}$/.test(hostname)) return 'Extensions';

  // Check for *.substack.com pattern (e.g. "lenny.substack.com" → "Lenny's Substack")
  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    const sub = hostname.replace('.substack.com', '');
    return capitalize(sub) + "'s Substack";
  }

  // Check for *.github.io pattern
  if (hostname.endsWith('.github.io')) {
    const sub = hostname.replace('.github.io', '');
    return capitalize(sub) + ' (GitHub Pages)';
  }

  // Fallback: strip www, strip common TLDs, capitalize each word
  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  // If it's a subdomain like "blog.example", keep it readable
  return clean
    .split('.')
    .map(part => capitalize(part))
    .join(' ');
}

/**
 * capitalize(str)
 * "github" → "GitHub" (okay, just "Github" — but close enough for fallback)
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * stripTitleNoise(title)
 *
 * Removes common noise from browser tab titles:
 * - Leading notification counts: "(2) Vibe coding ideas" → "Vibe coding ideas"
 * - Trailing email addresses: "Subject - user@gmail.com" → "Subject"
 * - X/Twitter cruft: "Name on X: \"quote\" / X" → "Name: \"quote\""
 * - Trailing "/ X" or "| LinkedIn" etc (handled by cleanTitle, but the
 *   "on X:" pattern needs special handling here)
 */
function stripTitleNoise(title) {
  if (!title) return '';

  // 1. Strip leading notification count: "(2) Title" or "(99+) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');

  // 1b. Strip inline counts like "Inbox (16,359)" or "Messages (42)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');

  // 2. Strip email addresses anywhere in the title (privacy + cleaner display)
  //    Catches patterns like "Subject - user@example.com - Gmail"
  //    First remove "- email@domain.com" segments (with separator)
  title = title.replace(/\s*[\-\u2010\u2011\u2012\u2013\u2014\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  //    Then catch any remaining bare email addresses
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');

  // 3. Clean up X/Twitter title format: "Name on X: \"quote text\"" → "Name: \"quote text\""
  title = title.replace(/\s+on X:\s*/, ': ');

  // 4. Strip trailing "/ X" (X/Twitter appends this)
  title = title.replace(/\s*\/\s*X\s*$/, '');

  return title.trim();
}

/**
 * cleanTitle(title, hostname)
 *
 * Strips redundant site name suffixes from tab titles.
 * Many sites append their name: "Article Title - Medium" or "Post | Reddit"
 * If the suffix matches the domain, we remove it for a cleaner look.
 */
function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain = hostname.replace(/^www\./, '');

  // Common separator patterns at the end of titles
  // "Article Title - Site Name", "Article Title | Site Name", "Article Title — Site Name"
  const separators = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of separators) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;

    const suffix = title.slice(idx + sep.length).trim();
    const suffixLower = suffix.toLowerCase();

    // Check if the suffix matches the domain name, friendly name, or common variations
    if (
      suffixLower === domain.toLowerCase() ||
      suffixLower === friendly.toLowerCase() ||
      suffixLower === domain.replace(/\.\w+$/, '').toLowerCase() || // "github" from "github.com"
      domain.toLowerCase().includes(suffixLower) ||
      friendly.toLowerCase().includes(suffixLower)
    ) {
      const cleaned = title.slice(0, idx).trim();
      // Only strip if we're left with something meaningful (at least 5 chars)
      if (cleaned.length >= 5) return cleaned;
    }
  }

  return title;
}

/**
 * smartTitle(title, url)
 *
 * When the tab title is useless (just the URL, or a generic site name),
 * try to extract something meaningful from the URL itself.
 * Works for X/Twitter posts, GitHub repos, YouTube videos, Reddit threads, etc.
 */
function smartTitle(title, url) {
  if (!url) return title || '';

  let pathname = '';
  let hostname = '';
  try {
    const u = new URL(url);
    pathname = u.pathname;
    hostname = u.hostname;
  } catch {
    return title || '';
  }

  // Check if the title is basically just the URL (useless)
  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  // X / Twitter — extract @username from /username/status/123456 URLs
  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) {
      // If the title has actual content (not just URL), clean it and keep it
      if (!titleIsUrl) return title;
      return `Post by @${username}`;
    }
  }

  // GitHub — extract owner/repo or owner/repo/path context
  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1];
      if (parts[2] === 'issues' && parts[3]) return `${owner}/${repo} Issue #${parts[3]}`;
      if (parts[2] === 'pull' && parts[3]) return `${owner}/${repo} PR #${parts[3]}`;
      if (parts[2] === 'blob' || parts[2] === 'tree') return `${owner}/${repo} — ${parts.slice(4).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  // YouTube — if title is just a URL, at least say "YouTube Video"
  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  // Reddit — extract subreddit and post hint from URL
  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      const sub = parts[subIdx + 1];
      if (titleIsUrl) return `r/${sub} post`;
    }
  }

  return title || url;
}


const ICONS = {
  // Tab/browser icon — used in the "N tabs open" badge
  tabs: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,

  // X / close icon — used in "Close N tabs" button
  close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,

  // Archive / trash icon — used in "Close & archive" button
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,

  // Arrow up-right — used in "Focus on this" button
  focus: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`
};


/* ----------------------------------------------------------------
   ---------------------------------------------------------------- */

/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS

   domainGroups is populated by renderStaticDashboard().
   ---------------------------------------------------------------- */
let domainGroups = [];
let duplicateTabs = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   We call this in multiple places, so it lives in one spot.
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns all open tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc. We only want to show and manage actual websites.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://') &&
      !t.isTabOut
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out new-tab pages are open (they show up as
 * chrome-extension://XXXXX/newtab.html in the tab list). If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  // Each tab has an isTabOut flag set by the extension's handleGetTabs()
  const tabOutTabs = openTabs.filter(t => t.isTabOut);

  const banner = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER (for static default view)

   Groups open tabs by domain (e.g. all github.com tabs together)
   and renders a card per domain.
   ---------------------------------------------------------------- */

// Live inline filter for the open-tabs grid. Matches against visible chip
// text + tab URL + domain name. Doesn't reveal chips hidden inside the
// overflow ("+N more") section — those become visible when the user expands.
let openTabsFilterQuery = '';
function applyOpenTabsFilter() {
  const q = openTabsFilterQuery.trim().toLowerCase();
  document.querySelectorAll('.mission-card.domain-card').forEach(card => {
    const name = (card.querySelector('.mission-name')?.textContent || '').toLowerCase();
    const domainMatch = !q || name.includes(q);
    let chipMatchCount = 0;
    card.querySelectorAll('.page-chip[data-tab-url]').forEach(chip => {
      // Skip chips inside the collapsed overflow — keep their inline display
      if (chip.closest('.page-chips-overflow')) return;
      const haystack = (chip.textContent + ' ' + (chip.dataset.tabUrl || '')).toLowerCase();
      const matches = !q || domainMatch || haystack.includes(q);
      chip.style.display = matches ? '' : 'none';
      if (matches) chipMatchCount += 1;
    });
    card.style.display = (domainMatch || chipMatchCount > 0) ? '' : 'none';
  });
}

function initOpenTabsFilter() {
  const input = document.getElementById('openTabsFilter');
  if (!input) return;
  input.addEventListener('input', () => {
    openTabsFilterQuery = input.value;
    applyOpenTabsFilter();
  });
  // Cmd+/ focuses the filter
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// A tab is "stale" if Chrome reports it hasn't been visited in 7+ days.
// chrome.tabs.Tab.lastAccessed is unix-ms, available in Chrome 121+. When the
// field is null/missing we treat the tab as fresh — never falsely flag.
function isStaleTab(tab) {
  if (!tab || typeof tab.lastAccessed !== 'number') return false;
  const days = appConfig.staleThresholdDays || 7;
  const threshold = days * 24 * 60 * 60 * 1000;
  if (Date.now() - tab.lastAccessed <= threshold) return false;
  // Honor the whitelist — domains the user explicitly never wants flagged
  // (Gmail, Slack, Calendar) so the sweep doesn't nag about always-on tabs.
  const whitelist = appConfig.staleWhitelist || [];
  if (whitelist.length === 0) return true;
  try {
    const host = new URL(tab.url).hostname.toLowerCase();
    return !whitelist.some(entry => {
      const e = (entry || '').toLowerCase().trim();
      if (!e) return false;
      return host === e || host.endsWith('.' + e);
    });
  } catch { return true; }
}

function getStaleTabs() {
  return getRealTabs().filter(isStaleTab);
}

// Compact relative-age string for chip labels — "1h", "3d", "2mo".
// Returns '' when chrome.tabs.lastAccessed isn't available (older Chrome).
function formatTabAge(tab) {
  if (!tab || typeof tab.lastAccessed !== 'number') return '';
  const ms = Date.now() - tab.lastAccessed;
  if (ms < 60 * 1000) return 'now';
  if (ms < 60 * 60 * 1000) return Math.floor(ms / (60 * 1000)) + 'm';
  if (ms < 24 * 60 * 60 * 1000) return Math.floor(ms / (60 * 60 * 1000)) + 'h';
  if (ms < 30 * 24 * 60 * 60 * 1000) return Math.floor(ms / (24 * 60 * 60 * 1000)) + 'd';
  return Math.floor(ms / (30 * 24 * 60 * 60 * 1000)) + 'mo';
}

function formatStaleAge(ms) {
  if (typeof ms !== 'number') return '';
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function openSweepModal() {
  const stale = getStaleTabs();
  if (stale.length === 0) return;
  const overlay = document.getElementById('sweepOverlay');
  const list = document.getElementById('sweepList');
  const title = document.getElementById('sweepTitle');
  if (!overlay || !list || !title) return;

  title.textContent = `Sweep stale tabs (${stale.length})`;
  list.innerHTML = stale.map((t, i) => {
    let host = '';
    try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch { }
    const age = formatStaleAge(t.lastAccessed);
    const safeTitle = (t.title || t.url || '').replace(/</g, '&lt;');
    const favicon = getTabFavicon(t);
    return `<label class="sweep-row" data-sweep-index="${i}">
      <input type="checkbox" checked data-sweep-checkbox>
      ${favicon ? `<img class="sweep-favicon" src="${favicon}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="sweep-title">${safeTitle}</span>
      <span class="sweep-host">${host}</span>
      <span class="sweep-age">${age}</span>
    </label>`;
  }).join('');

  // Stash the tabs on the overlay so the confirm handler reads the same set
  overlay._staleTabs = stale;
  overlay.style.display = 'flex';
  updateSweepConfirmCount();
}

function closeSweepModal() {
  const overlay = document.getElementById('sweepOverlay');
  if (overlay) overlay.style.display = 'none';
}

function getSweepSelectedTabs() {
  const overlay = document.getElementById('sweepOverlay');
  if (!overlay || !overlay._staleTabs) return [];
  const list = document.getElementById('sweepList');
  const rows = list ? list.querySelectorAll('.sweep-row') : [];
  const selected = [];
  rows.forEach(row => {
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb && cb.checked) {
      const idx = Number(row.dataset.sweepIndex);
      const tab = overlay._staleTabs[idx];
      if (tab) selected.push(tab);
    }
  });
  return selected;
}

function updateSweepConfirmCount() {
  const countEl = document.getElementById('sweepConfirmCount');
  const confirmBtn = document.getElementById('sweepConfirm');
  if (!countEl || !confirmBtn) return;
  const n = getSweepSelectedTabs().length;
  countEl.textContent = n;
  confirmBtn.disabled = n === 0;
}

async function confirmSweep() {
  const selected = getSweepSelectedTabs();
  if (selected.length === 0) return;
  closeSweepModal();
  let deferredIds = [];
  try {
    const resp = await fetch('/api/defer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabs: selected.map(t => ({
          url: t.url,
          title: t.title || t.url,
          favicon_url: t.favIconUrl || null,
        })),
      }),
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (Array.isArray(data.deferred)) deferredIds = data.deferred.map(d => d.id);
    }
  } catch { }
  const urls = selected.map(t => t.url).filter(Boolean);
  await sendToExtension('closeTabs', { urls, exact: true });
  playCloseSound();
  showToast(`Swept ${selected.length} stale tab${selected.length !== 1 ? 's' : ''}`, {
    undo: async () => {
      await sendToExtension('openTabs', { urls });
      await Promise.all(deferredIds.map(id =>
        fetch(`/api/deferred/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dismissed: true }),
        }).catch(() => null)
      ));
      showToast(`Restored ${selected.length} tab${selected.length !== 1 ? 's' : ''}`);
      setTimeout(() => refreshDynamicContent(), 200);
    },
  });
  setTimeout(() => refreshDynamicContent(), 300);
}

function initSweepModal() {
  const overlay = document.getElementById('sweepOverlay');
  const list = document.getElementById('sweepList');
  const closeBtn = document.getElementById('sweepClose');
  const cancelBtn = document.getElementById('sweepCancel');
  const confirmBtn = document.getElementById('sweepConfirm');
  if (!overlay) return;

  if (closeBtn) closeBtn.addEventListener('click', closeSweepModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeSweepModal);
  if (confirmBtn) confirmBtn.addEventListener('click', confirmSweep);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSweepModal();
  });

  if (list) {
    list.addEventListener('change', (e) => {
      if (e.target.matches('input[type="checkbox"]')) updateSweepConfirmCount();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') {
      closeSweepModal();
    }
  });
}

async function sweepDomain(domainId) {
  // Find the matching group by reversing the stableId encoding from renderDomainCard
  const group = domainGroups.find(g => 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId);
  if (!group || !group.tabs || group.tabs.length === 0) return;
  const tabs = group.tabs.map(t => ({ url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || null }));

  // Defer first so they're recoverable even if Undo is missed
  let deferredIds = [];
  try {
    const resp = await fetch('/api/defer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabs: tabs.map(t => ({ url: t.url, title: t.title, favicon_url: t.favIconUrl })),
      }),
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (Array.isArray(data.deferred)) deferredIds = data.deferred.map(d => d.id);
    }
  } catch { }
  const urls = tabs.map(t => t.url).filter(Boolean);
  await sendToExtension('closeTabs', { urls, exact: true });
  playCloseSound();
  showToast(`Swept ${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`, {
    undo: async () => {
      // Reopen the URLs and dismiss the deferred records we just created
      await sendToExtension('openTabs', { urls });
      await Promise.all(deferredIds.map(id =>
        fetch(`/api/deferred/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dismissed: true }),
        }).catch(() => null)
      ));
      showToast(`Restored ${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`);
      setTimeout(() => refreshDynamicContent(), 200);
    },
  });
  setTimeout(() => refreshDynamicContent(), 300);
}

function updateSweepStaleButton() {
  const btn = document.getElementById('sweepStaleBtn');
  const label = document.getElementById('sweepStaleLabel');
  if (!btn) return;
  const count = getStaleTabs().length;
  if (count === 0) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';
  if (label) label.textContent = `Sweep ${count} stale tab${count !== 1 ? 's' : ''}`;
}

/**
 * buildOverflowChips(hiddenTabs, urlCounts)
 *
 * Builds the expandable "+N more" section for tab lists that exceed 8 items.
 * Returns HTML string with hidden chips and a clickable expand button.
 * Used by domain cards when there are more than 8 tabs.
 */
function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count = urlCounts[tab.url] || 1;
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    let chipClass = count > 1 ? ' chip-has-dupes' : '';
    if (isStaleTab(tab)) chipClass += ' chip-stale';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    const faviconUrl = getTabFavicon(tab);
    const ageLabel = formatTabAge(tab);
    const ageHtml = ageLabel ? `<span class="chip-age">${ageLabel}</span>` : '';
    return `<div class="page-chip clickable${chipClass}" draggable="true" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}${ageHtml}
      <div class="chip-actions">
        <button class="chip-action chip-note${tabNotes[tab.url] ? ' chip-note-active' : ''}" data-action="edit-note" data-tab-url="${safeUrl}" title="${tabNotes[tab.url] ? 'Edit note' : 'Add a note'}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487zM19.5 7.125l-3-3"/></svg>
        </button>
        <button class="chip-action chip-snooze" data-action="snooze-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Snooze">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M9 9h6l-6 6h6"/></svg>
        </button>
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card in the static view.
 * "group" is: { domain, tabs: [{ url, title, tabId }] }
 *
 * Visually similar to renderOpenTabsMissionCard() but with a neutral
 * gray status bar (amber if duplicates exist).
 */
function renderDomainCard(group, groupIndex) {
  const tabs = group.tabs || [];
  const tabCount = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Detect duplicates within this domain group (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) {
    urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  }
  const dupeUrls = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  // Tab count badge
  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  // Duplicate warning badge
  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color: var(--accent-amber); background: rgba(200, 113, 58, 0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once with (Nx) badge if duplicated
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) {
      seen.add(tab.url);
      uniqueTabs.push(tab);
    }
  }
  // Cap visible chips so a single very-active domain doesn't tower over
  // the masonry. Anything past the cap collapses into a "+N more" chip,
  // and the shortest-column packer fills the leftover column space with
  // single-tab cards instead.
  const VISIBLE_CHIP_LIMIT = 5;
  const visibleTabs = uniqueTabs.slice(0, VISIBLE_CHIP_LIMIT);
  const extraCount = uniqueTabs.length - visibleTabs.length;
  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend the port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) {
        label = `${parsed.port} ${label}`;
      }
    } catch { }
    const count = urlCounts[tab.url];
    const dupeTag = count > 1
      ? ` <span class="chip-dupe-badge">(${count}x)</span>`
      : '';
    let chipClass = count > 1 ? ' chip-has-dupes' : '';
    if (isStaleTab(tab)) chipClass += ' chip-stale';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    const faviconUrl = getTabFavicon(tab);
    const ageLabel = formatTabAge(tab);
    const ageHtml = ageLabel ? `<span class="chip-age">${ageLabel}</span>` : '';
    return `<div class="page-chip clickable${chipClass}" draggable="true" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}${ageHtml}
      <div class="chip-actions">
        <button class="chip-action chip-note${tabNotes[tab.url] ? ' chip-note-active' : ''}" data-action="edit-note" data-tab-url="${safeUrl}" title="${tabNotes[tab.url] ? 'Edit note' : 'Add a note'}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487zM19.5 7.125l-3-3"/></svg>
        </button>
        <button class="chip-action chip-snooze" data-action="snooze-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Snooze">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M9 9h6l-6 6h6"/></svg>
        </button>
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(VISIBLE_CHIP_LIMIT), urlCounts) : '');

  // Use amber status bar if there are duplicates
  const statusBarClass = hasDupes ? 'active' : 'neutral';
  const statusBarStyle = hasDupes ? ' style="background: var(--accent-amber);"' : '';

  // Actions: only show bulk close/sweep when there's more than one tab —
  // the chip's own X already handles a single tab, no need for a redundant
  // "Close all 1 tab" button.
  let actionsHtml = '';
  if (tabCount > 1) {
    actionsHtml += `
      <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
        ${ICONS.close}
        Close all ${tabCount} tabs
      </button>
      <button class="action-btn" data-action="sweep-domain" data-domain-id="${stableId}" title="Save all to Saved for Later, then close">
        Sweep all (save first)
      </button>`;
  }

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  const collapsed = isCardCollapsed(stableId);
  const collapsedClass = collapsed ? ' card-collapsed' : '';
  // Cards with a single tab get a compact look — the dashboard wastes a lot
  // of vertical space when every 1-tab domain has a full header + padding
  // around what is essentially one chip.
  const singleClass = tabCount === 1 ? ' mission-card-single' : '';
  // Multi-tab cards are the visual anchors of the masonry layout. The CSS
  // lets them grow vertically when they're alone in a column shorter than
  // its neighbours, so column heights line up instead of leaving a stub.
  return `
    <div class="mission-card domain-card${collapsedClass}${singleClass} ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"${statusBarStyle}></div>
      <div class="mission-content">
        <div class="mission-top" data-action="toggle-card" data-domain-id="${stableId}" title="Click to collapse / expand">
          <svg class="card-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          <span class="mission-name">${isLanding ? 'Homepages' : friendlyDomain(group.domain)}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}

/* ----------------------------------------------------------------
   MISSIONS MASONRY LAYOUT

   CSS-columns balanced packing puts a 1-tab card next to the tall Claude
   card to even out the column heights — but visually that wastes a whole
   column on a tiny chip and looks unbalanced when the right columns also
   have room. Instead, we render a true Pinterest-style masonry: render
   each card once into a flat container, measure its height, then bucket
   it into the currently-shortest column. Tall cards naturally end up
   alone in their own column when no shorter card can balance them.
   ---------------------------------------------------------------- */
const COLUMN_TARGET_WIDTH = 280;
const COLUMN_GAP = 12;

function computeColumnCount(container) {
  let width = container.clientWidth || container.getBoundingClientRect().width || 0;
  // If the container itself is unsized (e.g. parent is briefly display:none),
  // walk up to the nearest sized ancestor so we don't collapse to a single
  // column. Worst-case fall back to the viewport, minus the page padding.
  if (width <= 0) {
    let p = container.parentElement;
    while (p && width <= 0) {
      width = p.clientWidth || p.getBoundingClientRect().width || 0;
      p = p.parentElement;
    }
  }
  if (width <= 0) width = Math.max(0, window.innerWidth - 64);
  const count = Math.floor((width + COLUMN_GAP) / (COLUMN_TARGET_WIDTH + COLUMN_GAP));
  return Math.max(1, count);
}

function layoutMissionsMasonry(container, groups) {
  if (!container) return;
  if (!groups || groups.length === 0) {
    container.innerHTML = '';
    return;
  }

  const cardsHtml = groups.map((g, idx) => renderDomainCard(g, idx));
  const colCount = computeColumnCount(container);

  // Single column — skip the measurement pass entirely.
  if (colCount === 1) {
    container.innerHTML = `<div class="missions-column">${cardsHtml.join('')}</div>`;
    return;
  }

  // Render cards once into a hidden probe to measure their actual heights,
  // including title wrap, action buttons, and "+N more" overflow.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:' +
    Math.floor((container.clientWidth - COLUMN_GAP * (colCount - 1)) / colCount) + 'px;';
  probe.innerHTML = cardsHtml.join('');
  container.appendChild(probe);
  const heights = Array.from(probe.children).map(el => el.getBoundingClientRect().height);
  container.removeChild(probe);

  // Two-phase distribution:
  //   1. Compute per-column TARGET COUNTS so the edge columns each get
  //      floor(N / cols) cards and the middle column(s) absorb everything
  //      else — gives the "tall middle, light edges" shape the user asked
  //      for (e.g. 11 cards across 3 columns → [3, 5, 3]).
  //   2. ROUND-ROBIN the multi-tab cards across columns first, so the
  //      visually heavy cards anchor different columns instead of all
  //      stacking on the left. Then drop the singles into whatever slots
  //      remain, left to right.
  const effectiveColCount = Math.min(colCount, cardsHtml.length);
  if (effectiveColCount <= 1) {
    container.innerHTML = `<div class="missions-column">${cardsHtml.join('')}</div>`;
    return;
  }

  const targetCounts = Array(effectiveColCount).fill(0);
  if (effectiveColCount === 2) {
    targetCounts[0] = Math.ceil(cardsHtml.length / 2);
    targetCounts[1] = cardsHtml.length - targetCounts[0];
  } else {
    const edgeCount = Math.floor(cardsHtml.length / effectiveColCount);
    targetCounts[0] = edgeCount;
    targetCounts[effectiveColCount - 1] = edgeCount;
    let remaining = cardsHtml.length - edgeCount * 2;
    const middleCount = effectiveColCount - 2;
    const perMiddle = Math.floor(remaining / middleCount);
    for (let c = 1; c < effectiveColCount - 1; c++) targetCounts[c] = perMiddle;
    let middleExtras = remaining - perMiddle * middleCount;
    for (let c = 1; c < effectiveColCount - 1 && middleExtras > 0; c++, middleExtras--) {
      targetCounts[c] += 1;
    }
  }

  const cols = Array.from({ length: effectiveColCount }, (_, i) => ({
    items: [],
    remainingSlots: targetCounts[i],
  }));

  // Split cards into anchors (multi-tab) and fillers (single-tab).
  const anchorIndices = [];
  const fillerIndices = [];
  for (let i = 0; i < groups.length; i++) {
    if ((groups[i].tabs || []).length > 1) anchorIndices.push(i);
    else fillerIndices.push(i);
  }

  // Phase A: round-robin anchor cards across columns. If the next column
  // is already full, skip ahead to the next one with room.
  let colCursor = 0;
  for (const idx of anchorIndices) {
    let placed = false;
    for (let attempt = 0; attempt < effectiveColCount; attempt++) {
      const c = (colCursor + attempt) % effectiveColCount;
      if (cols[c].remainingSlots > 0) {
        cols[c].items.push(cardsHtml[idx]);
        cols[c].remainingSlots--;
        colCursor = (c + 1) % effectiveColCount;
        placed = true;
        break;
      }
    }
    if (!placed) break; // Should never happen — sums match by construction.
  }

  // Phase B: drop fillers (single-tab cards) into remaining slots, left
  // to right. Singles stack underneath whatever anchor landed in their
  // column.
  let fillerCursor = 0;
  for (let c = 0; c < effectiveColCount && fillerCursor < fillerIndices.length; c++) {
    while (cols[c].remainingSlots > 0 && fillerCursor < fillerIndices.length) {
      cols[c].items.push(cardsHtml[fillerIndices[fillerCursor]]);
      cols[c].remainingSlots--;
      fillerCursor++;
    }
  }

  // (heights[] is left unused below — it was only needed by the previous
  // shortest-column packer; the deterministic distribution above doesn't
  // need per-card measurements.)
  void heights;

  container.innerHTML = cols
    .map(col => `<div class="missions-column">${col.items.join('')}</div>`)
    .join('');
}

// Re-layout on window resize so the column count tracks the viewport.
let _missionsResizeTimer = null;
window.addEventListener('resize', () => {
  if (_missionsResizeTimer) clearTimeout(_missionsResizeTimer);
  _missionsResizeTimer = setTimeout(() => {
    const el = document.getElementById('openTabsMissions');
    if (el && domainGroups.length > 0) {
      layoutMissionsMasonry(el, domainGroups);
      applyOpenTabsFilter();
    }
  }, 120);
});

// Per-domain collapse state, persisted in localStorage
function getCollapsedSet() {
  try {
    const raw = localStorage.getItem('tabout-collapsed-cards') || '[]';
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function isCardCollapsed(stableId) { return getCollapsedSet().has(stableId); }
function toggleCardCollapsed(stableId) {
  const set = getCollapsedSet();
  if (set.has(stableId)) set.delete(stableId); else set.add(stableId);
  localStorage.setItem('tabout-collapsed-cards', JSON.stringify([...set]));
  const card = document.querySelector(`.mission-card[data-domain-id="${stableId}"]`);
  if (card) card.classList.toggle('card-collapsed', set.has(stableId));
}


/* ----------------------------------------------------------------
   DEFERRED TABS — "Saved for Later" checklist column

   Fetches deferred tabs from the server and renders:
   1. Active items as a checklist (checkbox + title + dismiss)
   2. Archived items in a collapsible section with search
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Fetches all deferred tabs (active + archived) from the API and
 * renders them into the right-side column. Called on every dashboard
 * load.
 */
async function renderDeferredColumn() {
  const column = document.getElementById('deferredColumn');
  const list = document.getElementById('deferredList');
  const empty = document.getElementById('deferredEmpty');
  const countEl = document.getElementById('deferredCount');
  const archiveEl = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList = document.getElementById('archiveList');

  if (!column) return;

  try {
    const res = await fetch('/api/deferred');
    if (!res.ok) throw new Error('Failed to fetch deferred tabs');
    const data = await res.json();

    let active = data.active || [];
    const archived = data.archived || [];

    // Auto-archive any deferred tabs whose URL is open again. If the user
    // reopens a saved tab (history, link, session restore), it shouldn't
    // keep nagging them from Saved for Later. Match by exact URL — different
    // URLs on the same host are genuinely different things.
    const openUrls = new Set((openTabs || []).map(t => t.url).filter(Boolean));
    const reopened = active.filter(item => openUrls.has(item.url));
    if (reopened.length > 0) {
      active = active.filter(item => !openUrls.has(item.url));
      // Fire dismissals in parallel; we don't need to await them — the next
      // refresh will pick up the canonical server state.
      Promise.all(reopened.map(item =>
        fetch(`/api/deferred/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dismissed: true }),
        }).catch(() => { /* ignore — best-effort cleanup */ })
      ));
    }

    // Hide the whole section when there are no active items. The archive
    // alone isn't worth keeping the section on screen — it'll come back the
    // moment the user defers a new tab.
    if (active.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load deferred tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds the HTML for a single checklist item in the Saved for Later column.
 * Each item has: checkbox, title (clickable link), domain, time ago, dismiss X.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch { }
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.deferred_at);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds the HTML for a single item in the collapsed archive list.
 * Simpler than active items — just title link + date.
 */
function renderArchiveItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch { }
  const ago = item.archived_at ? timeAgo(item.archived_at) : '';

  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   LANDING PAGE PATTERNS

   Landing pages are homepages, inboxes, and feeds that you keep open
   out of habit. These get pulled into their own group so you can close
   them all at once. A specific email thread or tweet is NOT a landing
   page — those belong with their domain.
   ---------------------------------------------------------------- */
const LANDING_PAGE_PATTERNS = [
  {
    hostname: 'mail.google.com', test: (p, h) => {
      // Only the inbox itself, not individual emails.
      // Gmail inbox URLs end with #inbox (no message ID after it)
      // Individual emails look like #inbox/FMfcgz...
      return !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/');
    }
  },
  { hostname: 'x.com', pathExact: ['/home'] },
  { hostname: 'www.linkedin.com', pathExact: ['/'] },
  { hostname: 'github.com', pathExact: ['/'] },
  { hostname: 'www.youtube.com', pathExact: ['/'] },
];

function isLandingPage(url) {
  try {
    const parsed = new URL(url);
    return LANDING_PAGE_PATTERNS.some(p => {
      if (parsed.hostname !== p.hostname) return false;
      if (p.test) return p.test(parsed.pathname, url);
      if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
      if (p.pathExact) return p.pathExact.includes(parsed.pathname);
      return parsed.pathname === '/';
    });
  } catch { return false; }
}

/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER

   renderStaticDashboard() — sets up static UI, then calls
   refreshDynamicContent() for the tab data.
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main view. Loads instantly:
 * 1. Paint greeting + date
 * 2. Fetch open tabs from the extension
 * 3. Group tabs by domain (with landing pages pulled out)
 * 4. Render domain cards
 * 5. Update footer stats
 */
async function renderStaticDashboard() {
  // --- Header: greeting + date ---
  const greetingEl = document.getElementById('greeting');
  const dateEl = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl) dateEl.textContent = getDateDisplay();

  // --- Header: live clock ---
  const clockEl = document.getElementById('headerClock');
  if (clockEl) {
    function updateClock() {
      const opts = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: appConfig.clockFormat !== '24',
      };
      if (appConfig.clockShowSeconds) {
        opts.second = '2-digit';
      }
      clockEl.textContent = new Date().toLocaleTimeString('en-US', opts);
    }
    updateClock();
    setInterval(updateClock, 1000);
  }

  // --- Dark mode toggle icon ---
  const darkToggle = document.getElementById('darkModeToggle');
  if (darkToggle) {
    const iconEl = document.getElementById('darkModeIcon');
    if (iconEl) {
      iconEl.outerHTML = document.body.classList.contains('dark-mode') ? ICON_SUN : ICON_MOON;
    }
    darkToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      localStorage.setItem('tabout-dark-mode', isDark);
      darkToggle.innerHTML = isDark ? ICON_SUN : ICON_MOON;
    });
  }

  // --- Quick links ---
  renderQuickLinks();

  // --- Weather ---
  renderWeather();

  // --- Pomodoro ---
  loadPomodoroState();
  updatePomodoroDisplay();
  if (pomodoroState.running) {
    // Resume the timer if it was running
    if (pomodoroState.secondsLeft > 0) {
      startPomodoro();
    } else {
      pomodoroTick(); // will handle completion
    }
  }

  // --- Command palette (Cmd/Ctrl+K) ---
  initCommandPalette();

  // --- Sweep stale tabs preview modal ---
  initSweepModal();

  // --- Inline filter for open tabs ---
  initOpenTabsFilter();

  // --- Tab activity heatmap ---
  initHeatmap();

  // --- UX upgrades: snooze/note popovers, shortcut sheet, settings search,
  //     context menu, multi-select, drag-to-session ---
  initSnoozePopover();
  initNotePopover();
  initShortcutSheet();
  initSettingsNav();
  initSettingsSearch();
  initChipContextMenu();
  initMultiSelect();
  initChipDragToSession();

  // ── Fetch tabs + render dynamic content ────────────────────────────────
  await refreshDynamicContent();
}

/**
 * fetchDynamicQuote()
 *
 * Fetches the quote of the day from ZenQuotes API.
 * Caches the result in localStorage for 24 hours to avoid
 * hitting the API on every page load / refresh cycle.
 *
 * Returns { text, author } or null on failure.
 */
let _lastQuote = null;
let _lastQuoteTime = 0;
const QUOTE_THROTTLE_MS = 30_000;

async function fetchDynamicQuote() {
  const now = Date.now();
  if (_lastQuote && now - _lastQuoteTime < QUOTE_THROTTLE_MS) {
    return _lastQuote;
  }

  try {
    const resp = await fetch('/api/quote');
    if (resp.ok) {
      const { text, author } = await resp.json();
      if (text) {
        _lastQuote = { text, author };
        _lastQuoteTime = now;
        return _lastQuote;
      }
    }
  } catch {
    // API unavailable — fall through
  }
  return _lastQuote;
}

/**
 * refreshQuote()
 *
 * Renders the daily quote into the dashboard.
 * If useDynamicQuote is enabled, fetches from ZenQuotes API.
 * Otherwise uses the manual quote from config.
 */
async function refreshQuote() {
  const quoteEl = document.getElementById('dailyQuote');
  if (!quoteEl) return;

  let text = '';
  let author = '';

  if (appConfig.useDynamicQuote) {
    const dynamic = await fetchDynamicQuote();
    if (dynamic) {
      text = dynamic.text;
      author = dynamic.author;
    }
  }

  // Fall back to manual quote if dynamic is off or failed
  if (!text) {
    text = (appConfig.quoteText || '').trim();
    author = (appConfig.quoteAuthor || '').trim();
  }

  if (text) {
    quoteEl.innerHTML = `\u201c${text}\u201d${author ? ` <span class="quote-author">\u2014 ${author}</span>` : ''}`;
    quoteEl.style.display = 'block';
  } else {
    quoteEl.style.display = 'none';
  }
}

/**
 * refreshDynamicContent()
 *
 * Refreshes only the dynamic parts of the dashboard:
 * - Open tabs (fetched from the extension)
 * - Tab domain cards
 * - Footer stats
 * - Duplicate tab checks
 * - Saved for later list
 * - Recently closed tabs
 * - Daily quote
 *
 * Safe to call repeatedly — no event listeners are attached,
 * no intervals are created. Used by the 30-second auto-refresh.
 */
async function refreshDynamicContent() {
  // ── Refresh quote ─────────────────────────────────────────────────────────
  refreshQuote();

  // ── Fetch open tabs ───────────────────────────────────────────────────────
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // ── Group open tabs by domain ─────────────────────────────────────────────
  domainGroups = [];
  const groupMap = {};
  const landingTabs = [];

  for (const tab of realTabs) {
    try {
      // Check if this tab is a landing page first
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // file:// URLs have no hostname — group them under "Local Files"
      // chrome-extension:// URLs — group them under "Extensions"
      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else if (tab.url && tab.url.startsWith('chrome-extension://')) {
        hostname = new URL(tab.url).hostname;
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue; // skip if still empty
      if (!groupMap[hostname]) {
        groupMap[hostname] = { domain: hostname, tabs: [] };
      }
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  // Add landing pages as a special group at the end (if any)
  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: the combined "Homepages" group always pins to the top, then every
  // other domain by tab count desc. Largest cards rendering first lets the
  // masonry layout below give them their own columns instead of wedging a
  // 1-tab card next to them.
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;
    return b.tabs.length - a.tabs.length;
  });

  // ── Render domain cards ───────────────────────────────────────────────────
  const openTabsSection = document.getElementById('openTabsSection');
  const openTabsMissionsEl = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    // Make the section visible BEFORE laying out so the masonry can measure
    // the container's real width — when display:none, clientWidth is 0 and
    // the layout collapses to a single column.
    openTabsSection.style.display = 'block';
    layoutMissionsMasonry(openTabsMissionsEl, domainGroups);
    applyOpenTabsFilter();
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // ── Footer stats ──────────────────────────────────────────────────────────
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // ── Check for duplicate Tab Out tabs ────────────────────────────────────
  checkTabOutDupes();

  // ── Render the "Saved for Later" checklist column ────────────────────────
  await renderDeferredColumn();

  // ── Render recently closed tabs ─────────────────────────────────────────
  renderRecentlyClosed();

  // ── Load notes + sessions + snoozes + yesterday stats + heatmap in parallel ─
  await Promise.all([fetchSessions(), fetchTabNotes(), fetchSnoozes(), fetchYesterdayStats(), fetchHeatmap()]);
  renderSessions();
  renderSnoozes();
  renderYesterdaySummary();
  renderSessionSuggestions();
  renderHeatmap();

  // ── Update Sweep Stale button visibility + count ─────────────────────────
  updateSweepStaleButton();

  // ── Soft tab-cap banner (off when cap = 0) ───────────────────────────────
  updateTabCapBanner(realTabs.length);
}

function updateTabCapBanner(currentCount) {
  let banner = document.getElementById('tabCapBanner');
  const cap = appConfig.tabCapWarning || 0;
  if (cap === 0 || currentCount <= cap) {
    if (banner) banner.style.display = 'none';
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'tabCapBanner';
    banner.className = 'tab-cap-banner';
    const container = document.querySelector('.container');
    const after = document.getElementById('tabOutDupeBanner');
    if (after && after.parentElement === container) {
      container.insertBefore(banner, after.nextSibling);
    } else if (container) {
      container.insertBefore(banner, container.firstChild);
    }
  }
  banner.innerHTML = `Tab cap exceeded — <strong>${currentCount}</strong> open, your soft cap is <strong>${cap}</strong>. Time to sweep some?`;
  banner.style.display = 'block';
}


/**
 * renderDashboard()
 *
 * Entry point — just calls renderStaticDashboard().
 */
async function renderDashboard() {
  await loadAppConfig();
  applyConfigToUI();
  initSettingsPanel();
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS (using event delegation)

   Instead of attaching a listener to every button, we attach ONE
   listener to the whole document and check what was clicked.
   This is more efficient and works even after we re-render cards.

   Think of it like one security guard watching the whole building
   instead of one guard per door.
   ---------------------------------------------------------------- */

// Intercept clicks on saved/closed/archive title links when the user has
// opted into background opens. Runs in the capture phase so we beat the
// browser's default navigation. Modifier-clicks (cmd/ctrl/middle) pass
// through unchanged so the user can still force a specific behavior.
document.addEventListener('click', (e) => {
  if (!getOpenInBackground()) return;
  const link = e.target.closest('.deferred-title, .archive-item-title');
  if (!link) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  const url = link.getAttribute('href');
  if (!url) return;
  e.preventDefault();
  e.stopPropagation();
  sendToExtension('openTabs', { urls: [url] });
}, true);

document.addEventListener('click', async (e) => {
  // Walk up the DOM from the clicked element to find the nearest
  // element with a data-action attribute
  const actionEl = e.target.closest('[data-action]');

  if (!actionEl) return; // click wasn't on an action button

  const action = actionEl.dataset.action;
  const missionId = actionEl.dataset.missionId;

  // --- Pomodoro controls ---
  if (action === 'pomodoro-toggle') {
    if (pomodoroState.running) { pausePomodoro(); } else { startPomodoro(); }
    return;
  }
  if (action === 'pomodoro-reset') {
    resetPomodoro();
    return;
  }

  // --- Clear recently closed ---
  if (action === 'clear-recently-closed') {
    localStorage.removeItem('tabout-recently-closed');
    renderRecentlyClosed();
    showToast('Cleared recently closed tabs');
    return;
  }

  // --- Sessions ---
  if (action === 'save-session') {
    await saveCurrentSession();
    return;
  }
  if (action === 'sweep-stale') {
    openSweepModal();
    return;
  }
  if (action === 'sweep-domain') {
    await sweepDomain(actionEl.dataset.domainId);
    return;
  }
  if (action === 'toggle-card') {
    toggleCardCollapsed(actionEl.dataset.domainId);
    return;
  }
  if (action === 'edit-note') {
    await editTabNote(actionEl.dataset.tabUrl);
    return;
  }
  if (action === 'snooze-tab') {
    await snoozeTab(actionEl.dataset.tabUrl, actionEl.dataset.tabTitle);
    return;
  }
  if (action === 'unsnooze-now') {
    await unsnoozeNow(actionEl.dataset.snoozeId);
    return;
  }
  if (action === 'cancel-snooze') {
    await cancelSnooze(actionEl.dataset.snoozeId);
    return;
  }
  if (action === 'workspace-tab') {
    currentWorkspace = actionEl.dataset.workspace;
    renderSessions();
    return;
  }
  if (action === 'rename-workspace') {
    await renameWorkspace(actionEl.dataset.sessionId);
    return;
  }
  if (action === 'new-workspace') {
    const name = (prompt('Workspace name:') || '').trim();
    if (name) {
      currentWorkspace = name.slice(0, 50);
      renderSessions();
    }
    return;
  }
  if (action === 'suggest-save') {
    const host = actionEl.dataset.suggestHost;
    const tabs = getRealTabs().filter(t => {
      try { return new URL(t.url).hostname === host; } catch { return false; }
    });
    if (tabs.length === 0) return;
    const name = (prompt(`Name this ${host.replace(/^www\./, '')} session:`, host.replace(/^www\./, '')) || '').trim();
    if (!name) return;
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          workspace: currentWorkspace,
          tabs: tabs.map(t => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl })),
        }),
      });
      await fetchSessions();
      renderSessions();
      const banner = document.getElementById('suggestBanner');
      if (banner) banner.style.display = 'none';
      showToast(`Saved "${name}"`);
    } catch { showToast('Failed to save'); }
    return;
  }
  if (action === 'suggest-dismiss') {
    const host = actionEl.dataset.suggestHost;
    const dismissed = new Set((sessionStorage.getItem('tabout-suggest-dismissed') || '').split(','));
    dismissed.add(host);
    sessionStorage.setItem('tabout-suggest-dismissed', [...dismissed].join(','));
    const banner = document.getElementById('suggestBanner');
    if (banner) banner.style.display = 'none';
    return;
  }
  if (action === 'restore-session') {
    await restoreSession(actionEl.dataset.sessionId);
    return;
  }
  if (action === 'switch-session') {
    await switchToSession(actionEl.dataset.sessionId);
    return;
  }
  if (action === 'delete-session') {
    await deleteSession(actionEl.dataset.sessionId);
    return;
  }

  // --- Close duplicate Tab Out tabs ---
  if (action === 'close-tabout-dupes') {
    await sendToExtension('closeTabOutDupes');
    await fetchOpenTabs();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  // Find the card element so we can animate it
  const card = actionEl.closest('.mission-card');

  // ---- expand-chips: show the hidden tabs in a card ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- focus-tab: switch to a specific open tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) {
      await sendToExtension('focusTab', { url: tabUrl });
    }
    return;
  }

  // ---- close-single-tab: close one specific tab by URL ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger the parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    const chip = actionEl.closest('.page-chip');
    const chipTitle = chip ? (chip.querySelector('.chip-text')?.textContent || tabUrl) : tabUrl;
    saveToRecentlyClosed(tabUrl, chipTitle);
    await sendToExtension('closeTabs', { urls: [tabUrl] });
    playCloseSound();
    await fetchOpenTabs();
    showToast(`Closed "${chipTitle}"`, {
      undo: async () => {
        await sendToExtension('openTabs', { urls: [tabUrl] });
        showToast('Tab restored');
        setTimeout(() => refreshDynamicContent(), 200);
      },
    });

    // Remove the chip from the DOM with confetti
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If this was the last tab in the card, remove the whole card
        const card = document.querySelector(`.mission-card:has(.mission-pages:empty)`);
        if (card) {
          animateCardOut(card);
        }
        // Also check for cards where only overflow/non-tab chips remain
        document.querySelectorAll('.mission-card').forEach(c => {
          const remainingTabs = c.querySelectorAll('.page-chip[data-action="focus-tab"]');
          if (remainingTabs.length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    showToast('Tab closed');
    renderRecentlyClosed();
    return;
  }

  // ---- defer-single-tab: save one tab for later, then close it ----
  if (action === 'defer-single-tab') {
    e.stopPropagation(); // don't trigger the parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to the deferred list on the server
    try {
      await fetch('/api/defer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs: [{ url: tabUrl, title: tabTitle }] }),
      });
    } catch (err) {
      console.error('[tab-out] Failed to defer tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in the browser
    await sendToExtension('closeTabs', { urls: [tabUrl] });
    await fetchOpenTabs();

    // Animate the chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    // Refresh the deferred column to show the new item
    await renderDeferredColumn();
    return;
  }

  // ---- check-deferred: check off a deferred tab (mark as read) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    try {
      await fetch(`/api/deferred/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked: true }),
      });
    } catch (err) {
      console.error('[tab-out] Failed to check deferred tab:', err);
      return;
    }

    // Animate the item: add strikethrough, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh to update counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- dismiss-deferred: dismiss a deferred tab without reading ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    try {
      await fetch(`/api/deferred/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      });
    } catch (err) {
      console.error('[tab-out] Failed to dismiss deferred tab:', err);
      return;
    }

    // Animate the item out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn(); // refresh counts and archive
      }, 300);
    }
    return;
  }

  // ---- close-domain-tabs: close all tabs in a static domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    // Find the group by its stable ID
    const group = domainGroups.find(g => {
      const id = 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-');
      return id === domainId;
    });
    if (!group) return;

    const urls = group.tabs.map(t => t.url);
    group.tabs.forEach(t => saveToRecentlyClosed(t.url, t.title || t.url));
    // Use exact URL matching for landing pages (share domains with content tabs)
    const useExact = group.domain === '__landing-pages__';
    await sendToExtension('closeTabs', { urls, exact: useExact });
    await fetchOpenTabs();

    // Animate the card out
    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory domain groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : friendlyDomain(group.domain);
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);
    renderRecentlyClosed();

    // Update footer tab count
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- close-all-dupes: close every duplicate tab ----

  // ---- dedup-keep-one: close extras but keep one copy of each ----
  if (action === 'dedup-keep-one') {
    // URLs come from the button's data attribute (per-mission duplicates)
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await sendToExtension('closeDuplicates', { urls, keepOne: true });
    playCloseSound();
    await fetchOpenTabs();

    // Remove the dupe button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove all (2x) badges and the "N duplicates" header badge from this card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity = '0';
        setTimeout(() => b.remove(), 200);
      });
      // Remove the amber "N duplicates" badge from the card header
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      // Remove amber highlight from the card border
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
      const statusBar = card.querySelector('.status-bar');
      if (statusBar) statusBar.style.background = '';
    }

    showToast(`Closed duplicates, kept one copy each`);
    return;
  }

  // ---- close-all-open-tabs: close every open tab ----
  if (action === 'close-all-open-tabs') {
    // Use the actual openTabs list from the extension — works regardless of
    // close all domain-grouped tabs
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    // Animate all cards out
    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }

  // ---- archive: close tabs + mark mission as archived, then remove card ----
  else if (action === 'archive') {
    const mission = await fetchMissionById(missionId);
    if (!mission) return;

    const urls = (mission.urls || []).map(u => u.url);
    await closeTabsByUrls(urls);

    // Tell the server to archive this mission
    try {
      await fetch(`/api/missions/${missionId}/archive`, { method: 'POST' });
    } catch (err) {
      console.warn('[tab-out] Could not archive mission:', err);
    }

    // Animate the card out
    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    showToast(`Archived "${mission.name}"`);

  }

  // ---- dismiss: close tabs (if any), mark as dismissed, remove card ----
  else if (action === 'dismiss') {
    const mission = await fetchMissionById(missionId);
    if (!mission) return;

    // If tabs are open, close them first
    const tabCount = card
      ? (card.querySelector('.open-tabs-badge')?.textContent.match(/\d+/)?.[0] || 0)
      : 0;

    if (parseInt(tabCount) > 0) {
      const urls = (mission.urls || []).map(u => u.url);
      await closeTabsByUrls(urls);
    }

    // Tell the server this mission is dismissed
    try {
      await fetch(`/api/missions/${missionId}/dismiss`, { method: 'POST' });
    } catch (err) {
      console.warn('[tab-out] Could not dismiss mission:', err);
    }

    // Animate the card out
    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    showToast(`Let go of "${mission.name}"`);

  }

  // ---- focus: bring the mission's tabs to the front ----
  else if (action === 'focus') {
    const mission = await fetchMissionById(missionId);
    if (!mission) return;

    const urls = (mission.urls || []).map(u => u.url);
    await focusTabsByUrls(urls);
    showToast(`Focused on "${mission.name}"`);
  }

  // ---- close-uncat: close uncategorized tabs by domain ----
  else if (action === 'close-uncat') {
    const domain = actionEl.dataset.domain;
    if (!domain) return;

    // Find all open tabs matching this domain and close them
    const tabsToClose = openTabs.filter(t => {
      try { return new URL(t.url).hostname === domain; }
      catch { return false; }
    });
    const urls = tabsToClose.map(t => t.url);
    await closeTabsByUrls(urls);

    // Animate card removal
    if (card) {
      playCloseSound();
      animateCardOut(card);
    }
    showToast(`Closed ${tabsToClose.length} tab${tabsToClose.length !== 1 ? 's' : ''} from ${domain}`);

  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Recently closed toggle — expand/collapse ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#recentlyClosedToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('recentlyClosedBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  if (q.length < 2) {
    // Reset archive list to show all archived items without re-rendering the whole column
    try {
      const res = await fetch('/api/deferred');
      if (res.ok) {
        const data = await res.json();
        archiveList.innerHTML = (data.archived || []).map(item => renderArchiveItem(item)).join('');
      }
    } catch { }
    return;
  }

  try {
    const res = await fetch(`/api/deferred/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const data = await res.json();
    archiveList.innerHTML = (data.results || []).map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   ACTION HELPERS
   ---------------------------------------------------------------- */

/**
 * fetchMissionById(missionId)
 *
 * Fetches a single mission object by ID from the server.
 * Returns null if the fetch fails.
 */
async function fetchMissionById(missionId) {
  try {
    const res = await fetch('/api/missions');
    if (!res.ok) return null;
    const missions = await res.json();
    return missions.find(m => String(m.id) === String(missionId)) || null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------
   UPDATE NOTIFICATION (read-only, no code execution)
   ---------------------------------------------------------------- */
async function checkForUpdates() {
  try {
    const res = await fetch('/api/update-status');
    if (!res.ok) return;
    const { updateAvailable } = await res.json();
    if (!updateAvailable) return;

    // Show a simple text notification at the bottom
    const dashboardColumns = document.getElementById('dashboardColumns');
    if (!dashboardColumns) return;
    const notice = document.createElement('div');
    notice.style.cssText = 'text-align:center; padding:8px; font-size:12px; color:var(--muted); margin-top:24px;';
    notice.innerHTML = 'A new version of Tab Out is available. Run <code style="background:var(--warm-gray);padding:2px 6px;border-radius:3px;font-size:11px;user-select:all;cursor:pointer;" title="Click to select">git pull https://github.com/zarazhangrui/tab-out</code> to update.';
    dashboardColumns.after(notice);
  } catch { }
}

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
      const icon = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : '';
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
      <img src="${link.icon || ''}" alt="" class="settings-quick-link-icon" onerror="this.style.display='none'">
      <span class="settings-quick-link-title">${link.title}</span>
      <span class="settings-quick-link-url">${link.url}</span>
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
    tabLine.innerHTML = `<span class="note-tab-host">${host}</span> · <span class="note-tab-title">${(tab?.title || url).replace(/</g, '&lt;')}</span>`;
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
      <div class="context-menu-item" data-context-act="save" data-url="${url.replace(/"/g, '&quot;')}" data-title="${title.replace(/"/g, '&quot;')}">Save for later</div>
      <div class="context-menu-item" data-context-act="snooze" data-url="${url.replace(/"/g, '&quot;')}" data-title="${title.replace(/"/g, '&quot;')}">Snooze…</div>
      <div class="context-menu-item" data-context-act="note" data-url="${url.replace(/"/g, '&quot;')}">${hasNote ? 'Edit note' : 'Add note'}</div>
      <div class="context-menu-item" data-context-act="copy" data-url="${url.replace(/"/g, '&quot;')}">Copy URL</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-item-danger" data-context-act="close" data-url="${url.replace(/"/g, '&quot;')}">Close tab</div>
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
        ${top.map(([host, n]) => `<div class="day-domain"><span class="day-domain-name">${host}</span><span class="day-domain-count">${n}</span></div>`).join('')}
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
    const safe = (w || '').replace(/"/g, '&quot;');
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
    list.innerHTML = `<div class="sessions-empty" style="display:block">Nothing in <strong>${currentWorkspace}</strong> yet.</div>`;
    return;
  }

  list.innerHTML = filtered.map(s => {
    const tabCount = (s.tabs || []).length;
    const safeName = (s.name || '').replace(/"/g, '&quot;');
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
    const safeUrl = (s.url || '').replace(/"/g, '&quot;');
    return `<div class="snooze-row">
      <div class="snooze-info">
        <a class="snooze-title" href="${safeUrl}" target="_top">${(s.title || s.url || '').replace(/</g, '&lt;')}</a>
        <div class="snooze-meta"><span>${host}</span><span>wakes ${inLabel} (${wakeStr})</span></div>
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
      <div class="summary-top-list">${top3.map(([d, n]) => `<span><strong>${d}</strong> ${n}</span>`).join('') || '<span class="muted">—</span>'}</div>
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
    <span class="suggest-text">You have <strong>${n} ${host.replace(/^www\./, '')}</strong> tabs open. Save them as a session?</span>
    <div class="suggest-actions">
      <button class="suggest-btn suggest-btn-primary" data-action="suggest-save" data-suggest-host="${host}" data-suggest-count="${n}">Save as session</button>
      <button class="suggest-btn" data-action="suggest-dismiss" data-suggest-host="${host}">Dismiss</button>
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

function filterPalette(query) {
  const raw = query || '';
  const isCmd = raw.startsWith('>');
  const q = (isCmd ? raw.slice(1) : raw).trim().toLowerCase();
  if (isCmd) {
    const cmds = getPaletteCommands();
    palette.filtered = (q
      ? cmds.filter(c => c.label.toLowerCase().includes(q))
      : cmds
    ).slice(0, 50).map(c => ({ kind: 'command', label: c.label, run: c.run }));
  } else {
    const tabs = getRealTabs();
    const matched = q
      ? tabs.filter(t => {
          const title = (t.title || '').toLowerCase();
          const url = (t.url || '').toLowerCase();
          return title.includes(q) || url.includes(q);
        })
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
        <span class="palette-title">${entry.label.replace(/</g, '&lt;')}</span>
      </div>`;
    }
    const t = entry.tab;
    let host = '';
    try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch { }
    const safeUrl = (t.url || '').replace(/"/g, '&quot;');
    const title = (t.title || t.url || '').replace(/</g, '&lt;');
    const favicon = getTabFavicon(t);
    return `<div class="palette-row${activeCls}" data-palette-index="${i}" data-palette-url="${safeUrl}">
      ${favicon ? `<img class="palette-favicon" src="${favicon}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="palette-title">${title}</span>
      <span class="palette-host">${host}</span>
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


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
renderDashboard();
// checkForUpdates();

/* ----------------------------------------------------------------
   HISTORY BACKFILL HOOK — listen for the new-tab page telling us
   it just finished aggregating chrome.history into daily_stats, and
   refresh the heatmap so the user sees the populated calendar
   without having to open another tab.
   ---------------------------------------------------------------- */
window.addEventListener('message', async (event) => {
  const data = event.data || {};
  if (data.type !== 'historyBackfillComplete') return;
  try {
    await fetchHeatmap();
    renderHeatmap();
  } catch { /* heatmap may be hidden in settings — ignore */ }
});

/* ----------------------------------------------------------------
   AUTO-REFRESH — refresh dynamic content every 30 seconds

   Re-fetches open tabs from the extension and re-renders tab cards,
   stats, quote, and the saved-for-later list. Does NOT re-initialize
   static UI (clock, dark mode, settings panel, pomodoro) so no
   event listeners are duplicated and timer state is preserved.
   ---------------------------------------------------------------- */
// Auto-refresh is now driven by applyAutoRefreshInterval() so it can be
// retuned (or disabled) from the settings panel.

// Refresh the moment the tab regains focus — catches reopened tabs being
// auto-removed from Saved for Later without waiting for the timer.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDynamicContent();
});
