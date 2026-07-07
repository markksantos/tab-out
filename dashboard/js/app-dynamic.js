// Part of the Tab Out dashboard. Loaded as an ordered classic script
// (shared global scope) after the earlier js/ parts. See index.html.

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
  let host = '';
  let domain = '';
  try { host = new URL(item.url).hostname; domain = host.replace(/^www\./, ''); } catch { }
  const faviconUrl = item.favicon_url || faviconForDomain(host);
  const ago = timeAgo(item.deferred_at);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${safeHref(item.url)}" target="_blank" rel="noopener" class="deferred-title" title="${esc(item.title)}">
          <img src="${esc(faviconUrl)}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${esc(item.title || item.url)}
        </a>
        <div class="deferred-meta">
          <span>${esc(domain)}</span>
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
      <a href="${safeHref(item.url)}" target="_blank" rel="noopener" class="archive-item-title" title="${esc(item.title)}">
        ${esc(item.title || item.url)}
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
    quoteEl.innerHTML = `\u201c${esc(text)}\u201d${author ? ` <span class="quote-author">\u2014 ${esc(author)}</span>` : ''}`;
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
// Signature of everything that affects the rendered domain cards, so the
// 30s auto-refresh can skip a full masonry rebuild when nothing changed.
// Covers grouping/order, per-tab identity + staleness + favicon, which tabs
// have notes, and which cards are collapsed.
let _lastMasonrySig = '';
function computeMasonrySignature(groups) {
  const collapsed = [...getCollapsedSet()].sort().join(',');
  const noteKeys = Object.keys(tabNotes || {}).sort().join(',');
  const parts = groups.map(g =>
    g.domain + ':' + g.tabs.map(t =>
      `${t.url}|${t.title || ''}|${t.favIconUrl || ''}|${isStaleTab(t) ? 1 : 0}|${t.groupId ?? ''}:${t.groupTitle || ''}:${t.groupColor || ''}`
    ).join('~')
  );
  return parts.join('§') + '§§' + collapsed + '§§' + noteKeys;
}

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
    // Rebuilding the masonry blows away hover/scroll state and re-fetches
    // every favicon. On the 30s auto-refresh the tab set is usually
    // identical, so skip the rebuild unless something that affects the
    // rendered cards actually changed.
    const sig = computeMasonrySignature(domainGroups);
    if (sig !== _lastMasonrySig || openTabsMissionsEl.childElementCount === 0) {
      _lastMasonrySig = sig;
      layoutMissionsMasonry(openTabsMissionsEl, domainGroups);
    }
    applyOpenTabsFilter();
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
    _lastMasonrySig = '';
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
