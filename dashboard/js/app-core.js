// Part of the Tab Out dashboard. Loaded as an ordered classic script
// (shared global scope) after the earlier js/ parts. See index.html.

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

/* ----------------------------------------------------------------
   HTML ESCAPING

   Tab titles and URLs come from arbitrary web pages — a page can name
   itself "<img src=x onerror=...>". Every interpolation into innerHTML
   must go through esc(); every href through safeHref() (which also
   rejects javascript: URLs).
   ---------------------------------------------------------------- */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(url) {
  const u = String(url || '').trim();
  return /^(https?|file|chrome-extension|chrome|about):/i.test(u) ? esc(u) : '#';
}

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
  { url: 'https://web.whatsapp.com', title: 'WhatsApp', icon: 'https://icons.duckduckgo.com/ip3/web.whatsapp.com.ico' },
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
      <a href="${safeHref(item.url)}" target="_top" class="archive-item-title" data-action="reopen-closed-tab" data-index="${i}" title="${esc(item.title)}">${esc(item.title || item.url)}</a>
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
  nav.innerHTML = links.map((link, i) => {
    let host = '';
    try { host = new URL(link.url).hostname; } catch { }
    // If the configured icon 404s (favicon services are occasionally flaky),
    // fall back once to a different provider, then to a letter monogram — so
    // a quick link never shows a broken-image glyph.
    const fallback = host ? `https://www.google.com/s2/favicons?domain=${esc(host)}&sz=64` : '';
    const monogram = esc((link.title || host || '?').trim().charAt(0).toUpperCase() || '?');
    const onerr = `if(this.dataset.fb){this.outerHTML='<span class=\\'quick-link-icon quick-link-monogram\\'>${monogram}</span>';}else{this.dataset.fb=1;this.src='${fallback}';}`;
    return `<a href="${safeHref(link.url)}" class="quick-link" target="_top" title="${esc(link.title)}" draggable="true" data-link-index="${i}">
      <img src="${esc(link.icon)}" alt="${esc(link.title)}" class="quick-link-icon" onerror="${onerr}">
    </a>`;
  }).join('');
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
