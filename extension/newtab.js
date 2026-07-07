/**
 * newtab.js — PostMessage Bridge
 *
 * This script is the middleman between the dashboard (running inside the iframe
 * at localhost:3456) and Chrome's tabs API.
 *
 * Why do we need a bridge? Chrome extensions can call chrome.tabs.query(),
 * chrome.tabs.remove(), etc. — but a plain webpage (even one running locally)
 * cannot. The dashboard is a webpage, so it has to ask the extension to do
 * those privileged operations on its behalf. It does this via postMessage, and
 * this script listens for those messages, performs the Chrome API calls, and
 * posts the results back.
 */

// ─── Element references ───────────────────────────────────────────────────────
const frame = document.getElementById('dashboard-frame');
const fallback = document.getElementById('fallback');

// ─── 1. Check whether the server is reachable ────────────────────────────────
// We use 'no-cors' mode so the fetch doesn't fail due to CORS headers. We don't
// need to read the response — we just need to know *something* answered.
fetch('http://localhost:3456', { mode: 'no-cors' })
  .then(() => {
    // Server is up — keep the iframe visible (it's already loading)
    // Kick off a one-time history backfill in the background so the
    // activity heatmap reflects the user's real browsing past, not just
    // events recorded since Tab Out was installed. Runs from the new-tab
    // page (rather than the service worker) so it triggers reliably on
    // every dashboard open without depending on onInstalled/onStartup.
    backfillHistoryIfNeeded();
  })
  .catch(() => {
    // Server is down — hide the iframe and reveal the human-readable fallback
    showFallback();
  });

// ─── 2. Iframe load-error handler ────────────────────────────────────────────
// This catches cases where the fetch succeeded but the iframe itself errors
// (e.g. the server starts then immediately crashes).
frame.addEventListener('error', showFallback);

// While the fallback is visible, keep probing the server every 3 seconds and
// swap the dashboard back in the moment it answers — a slow launchd start
// (node takes a few seconds to boot) then never shows a dead page.
let reconnectTimer = null;

function showFallback() {
  frame.classList.add('hidden');
  fallback.classList.remove('hidden');
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    fetch('http://localhost:3456', { mode: 'no-cors' })
      .then(() => {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
        frame.src = 'http://localhost:3456'; // reload — first load was aborted
        frame.classList.remove('hidden');
        fallback.classList.add('hidden');
        backfillHistoryIfNeeded();
      })
      .catch(() => { /* still down — keep waiting */ });
  }, 3000);
}

// ─── 3. PostMessage listener ─────────────────────────────────────────────────
// The dashboard posts a message like:
//   { messageId: 'abc123', action: 'getTabs', payload: { ... } }
// We handle the action, then reply with the same messageId so the dashboard
// can match the response to the original request.
window.addEventListener('message', async (event) => {
  // Security: only accept messages from our dashboard origin
  if (event.origin !== 'http://localhost:3456') return;

  const msg = event.data || {};
  const { messageId, action } = msg;
  if (!messageId || !action) return; // Ignore malformed messages

  let response;

  try {
    if (action === 'getTabs') {
      response = await handleGetTabs();

    } else if (action === 'closeTabs') {
      // Dashboard sends urls flat: { action, messageId, urls: [...] }
      // If exact: true, match by exact URL instead of hostname
      response = msg.exact
        ? await handleCloseTabsExact(msg.urls)
        : await handleCloseTabs({ urls: msg.urls });

    } else if (action === 'focusTabs') {
      // Dashboard sends urls as an array; we focus the first match
      response = await handleFocusTabs({ urls: msg.urls });

    } else if (action === 'focusTab') {
      // Focus a single specific tab by exact URL match
      response = await handleFocusSingleTab(msg.url);

    } else if (action === 'closeDuplicates') {
      // Close duplicate tabs — either all copies or keep one of each
      response = await handleCloseDuplicates(msg.urls, msg.keepOne);

    } else if (action === 'closeTabOutDupes') {
      // Close extra Tab Out new-tab pages, keeping only the current one
      response = await handleCloseTabOutDupes();

    } else if (action === 'openTabs') {
      // Open a list of URLs as new background tabs (used by Restore Session)
      response = await handleOpenTabs(msg.urls);

    } else {
      response = { error: `Unknown action: ${action}` };
    }
  } catch (err) {
    response = { error: err.message };
  }

  // Always include success flag — the dashboard checks for it
  if (!response.error) {
    response.success = true;
  }

  // Send the response back to the dashboard inside the iframe
  frame.contentWindow.postMessage(
    { messageId, ...response },
    'http://localhost:3456'
  );
});

// ─── Action handlers ─────────────────────────────────────────────────────────

/**
 * getTabs — Returns a trimmed list of all open Chrome tabs.
 * We only send the fields the dashboard actually needs; the full Tab object
 * from Chrome has many noisy fields we don't want to expose.
 */
async function handleGetTabs() {
  const tabs = await chrome.tabs.query({});
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/newtab.html`;

  const simpleTabs = tabs.map(tab => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl || null,
    windowId: tab.windowId,
    active: tab.active,
    // tab.lastAccessed is a unix-ms timestamp (Chrome 121+). Undefined on
    // older Chrome — the dashboard treats missing values as "fresh" so it
    // never falsely flags tabs as stale.
    lastAccessed: typeof tab.lastAccessed === 'number' ? tab.lastAccessed : null,
    isTabOut: tab.url === newtabUrl || tab.url === 'chrome://newtab/',
  }));
  return { tabs: simpleTabs };
}

/**
 * closeTabs — Closes all tabs whose hostname matches any of the given URLs.
 *
 * Why match by hostname rather than exact URL? If the user wants to close
 * "twitter.com" tabs, we should close all of them regardless of which tweet
 * they're on. Matching by hostname (e.g. "twitter.com") is more intuitive
 * than requiring an exact URL match.
 *
 * @param {Object} payload - { urls: string[] }  — list of URLs to match
 */
async function handleCloseTabs({ urls = [] } = {}) {
  // Split URLs into two groups: file:// URLs (match by exact URL since they
  // have no hostname) and regular URLs (match by hostname as before).
  const targetHostnames = [];
  const targetExactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      targetExactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable URLs */ }
    }
  }

  const allTabs = await chrome.tabs.query({});

  // Find tabs that match either by hostname or exact URL
  const matchingTabIds = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      // Exact match for file:// URLs
      if (tabUrl.startsWith('file://') && targetExactUrls.has(tabUrl)) return true;
      // Hostname match for regular URLs
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch {
        return false;
      }
    })
    .map(tab => tab.id);

  if (matchingTabIds.length > 0) {
    await chrome.tabs.remove(matchingTabIds);
  }

  return { closedCount: matchingTabIds.length };
}

/**
 * focusTabs — Switches Chrome's view to the first tab matching the given URL.
 *
 * "Focusing" means: make that tab the active tab in its window, and bring
 * that window to the front.
 *
 * @param {Object} payload - { url: string }
 */
async function handleFocusTabs({ urls = [] } = {}) {
  if (!urls || urls.length === 0) return { error: 'No URLs provided' };

  // Extract hostnames from all URLs we want to match
  const targetHostnames = urls.map(u => {
    try { return new URL(u).hostname; }
    catch { return null; }
  }).filter(Boolean);

  if (targetHostnames.length === 0) return { error: 'No valid URLs' };

  const allTabs = await chrome.tabs.query({});

  // Find the first tab whose hostname matches any target
  const matchingTab = allTabs.find(tab => {
    try { return targetHostnames.includes(new URL(tab.url).hostname); }
    catch { return false; }
  });

  if (!matchingTab) {
    return { error: 'No matching tab found' };
  }

  // Make the tab active within its window
  await chrome.tabs.update(matchingTab.id, { active: true });

  // Bring the window itself into focus (puts it on top of other windows)
  await chrome.windows.update(matchingTab.windowId, { focused: true });

  return { focusedTabId: matchingTab.id };
}

/**
 * focusSingleTab — Switches to a specific tab by exact URL match.
 * Used when the user clicks a page chip to jump to that exact tab.
 */
async function handleFocusSingleTab(url) {
  if (!url) return { error: 'No URL provided' };

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first, then fall back to hostname match.
  // Prefer tabs in OTHER windows — if the user is clicking a chip, they
  // probably want to jump to that tab, not the one already behind this page.
  let matches = allTabs.filter(t => t.url === url);
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch { }
  }

  if (matches.length === 0) return { error: 'Tab not found' };

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];

  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
  return { focusedTabId: match.id };
}

/**
 * closeDuplicates — Closes duplicate tabs for the given URLs.
 *
 * @param {string[]} urls  — URLs that have duplicates
 * @param {boolean} keepOne — if true, keep one copy of each; if false, close all copies
 */
async function handleCloseDuplicates(urls = [], keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const tabIdsToClose = [];

  for (const url of urls) {
    // Find all tabs with this exact URL
    const matching = allTabs.filter(t => t.url === url);

    if (keepOne) {
      // Keep the first one (or the active one if any), close the rest
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) tabIdsToClose.push(tab.id);
      }
    } else {
      // Close all copies
      for (const tab of matching) tabIdsToClose.push(tab.id);
    }
  }

  if (tabIdsToClose.length > 0) {
    await chrome.tabs.remove(tabIdsToClose);
  }

  return { closedCount: tabIdsToClose.length };
}

/**
 * closeTabOutDupes — Closes all duplicate Tab Out new-tab pages except the
 * one the user is currently looking at. Tab Out tabs show up as
 * chrome-extension://XXXXX/newtab.html in chrome.tabs — we find all of them
 * and close every one except the active tab in the current window.
 */
async function handleCloseTabOutDupes() {
  const allTabs = await chrome.tabs.query({});

  // Find all tabs that are Tab Out new-tab pages.
  // Chrome may report the URL as chrome://newtab/ or the full extension URL.
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/newtab.html`;

  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) {
    return { closedCount: 0 };
  }

  // Keep the active one in the focused window; if none is active, keep the first
  const keep = tabOutTabs.find(t => t.active) || tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);

  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose);
  }

  return { closedCount: toClose.length };
}

/**
 * openTabs — Opens a list of URLs as new background tabs in the current
 * window. Used to restore saved sessions.
 */
async function handleOpenTabs(urls = []) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return { error: 'No URLs provided' };
  }
  const win = await chrome.windows.getCurrent();
  let opened = 0;
  for (const url of urls) {
    if (!url || typeof url !== 'string') continue;
    try {
      await chrome.tabs.create({ url, windowId: win.id, active: false });
      opened += 1;
    } catch { /* skip URLs Chrome refuses (chrome://, etc.) */ }
  }
  return { openedCount: opened };
}

/**
 * closeTabsExact — Closes tabs matching exact URLs (not by hostname).
 * Used for landing pages so closing "Gmail inbox" doesn't also close
 * individual email threads on the same domain.
 */
async function handleCloseTabsExact(urls = []) {
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const matchingIds = allTabs
    .filter(tab => urlSet.has(tab.url))
    .map(tab => tab.id);

  if (matchingIds.length > 0) {
    await chrome.tabs.remove(matchingIds);
  }
  return { closedCount: matchingIds.length };
}

// ─── History backfill ────────────────────────────────────────────────────────
// Pulls the user's chrome.history visits (last ~365 days) and aggregates them
// into daily_stats so the heatmap reflects their actual browsing past, not
// just events recorded since Tab Out was installed.
//
// This runs from the new-tab page (rather than the service worker) so it
// triggers reliably whenever the user opens a new tab — no dependency on
// onInstalled/onStartup, which can miss in-flight code updates.
//
// Versioned: bump BACKFILL_VERSION whenever the aggregation logic changes
// so existing installs re-run with the better numbers. v2 switched from
// "one event per HistoryItem at lastVisitTime" (which dramatically
// undercounts active users) to fetching real per-visit timestamps via
// chrome.history.getVisits, and uses the server's replace mode to overwrite
// previously-undercounted historical rows.

const BACKFILL_VERSION = 3;
let backfillRunning = false;

async function backfillHistoryIfNeeded() {
  if (backfillRunning) return;
  backfillRunning = true;
  try {
    if (!chrome.history || !chrome.history.search || !chrome.history.getVisits) return;

    const stored = await chrome.storage.local.get('historyBackfillVersion');
    if (stored.historyBackfillVersion === BACKFILL_VERSION) return;

    console.log('[tab-out] running history backfill v' + BACKFILL_VERSION + '...');

    const startTime = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const items = await chrome.history.search({
      text: '',
      startTime,
      maxResults: 100000,
    });
    if (!Array.isArray(items) || items.length === 0) {
      await chrome.storage.local.set({ historyBackfillVersion: BACKFILL_VERSION });
      console.log('[tab-out] history backfill: no items returned');
      return;
    }

    // Aggregate: per-day visit count + per-domain counts. For URLs visited
    // more than once, resolve real per-visit timestamps via
    // chrome.history.getVisits so each visit is counted on the correct day.
    // URLs with a single visit skip the extra round-trip.
    const byDay = {};
    const bumpDay = (timestamp, host) => {
      if (!timestamp || timestamp < startTime) return;
      const day = new Date(timestamp).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { opens: 0, domains: {} };
      byDay[day].opens += 1;
      if (host) byDay[day].domains[host] = (byDay[day].domains[host] || 0) + 1;
    };

    let multiVisitFetched = 0;
    for (const item of items) {
      let host = null;
      try { host = new URL(item.url).hostname; } catch { /* skip */ }
      const visitCount = item.visitCount || 0;
      if (visitCount <= 1) {
        bumpDay(item.lastVisitTime, host);
        continue;
      }
      try {
        const visits = await chrome.history.getVisits({ url: item.url });
        multiVisitFetched += 1;
        if (Array.isArray(visits) && visits.length > 0) {
          for (const v of visits) bumpDay(v.visitTime, host);
        } else {
          bumpDay(item.lastVisitTime, host);
        }
      } catch {
        bumpDay(item.lastVisitTime, host);
      }
    }

    const days = Object.entries(byDay).map(([day, agg]) => ({
      day,
      opens: agg.opens,
      closes: 0,                // history doesn't track tab closes
      domains: agg.domains,
    }));

    const res = await fetch('http://localhost:3456/api/stats/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days, replace: true }),
    });
    if (res.ok) {
      const summary = await res.json().catch(() => ({}));
      console.log(
        '[tab-out] history backfill v' + BACKFILL_VERSION + ' wrote ' +
        (summary.inserted ?? '?') + ' of ' + days.length + ' days (' +
        items.length + ' URLs scanned, ' + multiVisitFetched + ' multi-visit lookups)'
      );
      await chrome.storage.local.set({ historyBackfillVersion: BACKFILL_VERSION });
      // Tell the dashboard the heatmap data is fresh so it can re-render
      // without the user having to open another new tab.
      try {
        frame.contentWindow.postMessage(
          { type: 'historyBackfillComplete', daysWritten: summary.inserted || 0 },
          'http://localhost:3456'
        );
      } catch { /* iframe may be gone */ }
    } else {
      console.warn('[tab-out] history backfill: server returned', res.status);
    }
  } catch (err) {
    console.warn('[tab-out] history backfill failed:', err && err.message);
  } finally {
    backfillRunning = false;
  }
}
