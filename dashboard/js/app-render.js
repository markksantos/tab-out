// Part of the Tab Out dashboard. Loaded as an ordered classic script
// (shared global scope) after the earlier js/ parts. See index.html.

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
// Google's s2 service tops out around 32px and returns fuzzy bitmaps;
// DuckDuckGo's ip3 service serves the site's real 48–64px icon and renders
// crisply on Retina. Prefer Chrome's own favicon when we have it.
function faviconForDomain(domain) {
  return domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : '';
}

function getTabFavicon(tab) {
  if (tab.favIconUrl) return tab.favIconUrl;
  try {
    return faviconForDomain(new URL(tab.url).hostname);
  } catch { return ''; }
}

// Chrome tab-group colors → CSS values, matching Chrome's own palette.
const GROUP_COLORS = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00',
  green: '#188038', pink: '#d01884', purple: '#9334e6', cyan: '#007b83',
  orange: '#fa903e',
};

// A small colored pill showing which Chrome tab group a tab belongs to.
// Untitled groups still get a colored dot so the grouping is visible.
function groupTag(tab) {
  if (tab.groupId == null || tab.groupColor == null) return '';
  const color = GROUP_COLORS[tab.groupColor] || GROUP_COLORS.grey;
  const label = tab.groupTitle ? esc(tab.groupTitle) : '';
  return `<span class="chip-group" style="--group-color:${color}" title="${label || 'Tab group'}">${label}</span>`;
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
    const safeTitle = esc(t.title || t.url || '');
    const favicon = getTabFavicon(t);
    return `<label class="sweep-row" data-sweep-index="${i}">
      <input type="checkbox" checked data-sweep-checkbox>
      ${favicon ? `<img class="sweep-favicon" src="${esc(favicon)}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="sweep-title">${safeTitle}</span>
      <span class="sweep-host">${esc(host)}</span>
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
    const safeUrl = esc(tab.url || '');
    const safeTitle = esc(label);
    const faviconUrl = getTabFavicon(tab);
    const ageLabel = formatTabAge(tab);
    const ageHtml = ageLabel ? `<span class="chip-age">${ageLabel}</span>` : '';
    return `<div class="page-chip clickable${chipClass}" draggable="true" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${esc(faviconUrl)}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${safeTitle}</span>${dupeTag}${ageHtml}${groupTag(tab)}
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
    const safeUrl = esc(tab.url || '');
    const safeTitle = esc(label);
    const faviconUrl = getTabFavicon(tab);
    const ageLabel = formatTabAge(tab);
    const ageHtml = ageLabel ? `<span class="chip-age">${ageLabel}</span>` : '';
    return `<div class="page-chip clickable${chipClass}" draggable="true" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${esc(faviconUrl)}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${safeTitle}</span>${dupeTag}${ageHtml}${groupTag(tab)}
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
