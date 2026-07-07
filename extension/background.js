/**
 * background.js — Service Worker for Badge Updates
 *
 * Keeps the toolbar badge showing the current OPEN TAB COUNT, straight from
 * chrome.tabs — no server round-trip, so it works even when the dashboard
 * server is down. Color coding gives an at-a-glance workload signal:
 *   Green  (#3d7a4a) → under 25 tabs  (in control)
 *   Amber  (#b8892e) → 25–49 tabs     (piling up)
 *   Red    (#b35a5a) → 50+ tabs       (time to sweep)
 */

// ─── Badge updater ────────────────────────────────────────────────────────────

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    const count = tabs.length;

    chrome.action.setBadgeText({ text: String(count) });

    let badgeColor;
    if (count < 25) {
      badgeColor = '#3d7a4a'; // Green — you're in control
    } else if (count < 50) {
      badgeColor = '#b8892e'; // Amber — things are piling up
    } else {
      badgeColor = '#b35a5a'; // Red — time to focus and close some tabs
    }

    chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

chrome.tabs.onCreated.addListener((tab) => {
  updateBadge();
  recordTabEvent('open', tab && tab.url);
});

chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
  recordTabEvent('close', null);
});

// ─── Daily stats tracking ──────────────────────────────────────────────────
// Lightweight fire-and-forget events to the local server so the dashboard
// can show "yesterday at a glance." We only send the hostname, not the full
// URL, and never block on a failed network call.
async function recordTabEvent(type, url) {
  try {
    let domain = null;
    if (url) {
      try { domain = new URL(url).hostname; } catch { /* skip */ }
    }
    await fetch('http://localhost:3456/api/stats/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, domain }),
    });
  } catch { /* server may be down — drop the event */ }
}

// History backfill lives in newtab.js — the new-tab page has chrome.history
// access too and runs reliably on every dashboard open, so we don't need to
// duplicate it here in the service worker.

// ─── Periodic tick ─────────────────────────────────────────────────────────
// One chrome.alarms tick per minute drives both the snooze waker and a badge
// refresh. MV3 service workers are put to sleep, which silently kills
// setInterval — alarms keep firing regardless.

chrome.alarms.create('tabout-tick', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tabout-tick' && alarm.name !== 'tabout-snooze-check') return;
  updateBadge();
  await wakeDueSnoozes();
});

async function wakeDueSnoozes() {
  try {
    const res = await fetch('http://localhost:3456/api/snoozes/due');
    if (!res.ok) return;
    const data = await res.json();
    const due = Array.isArray(data.due) ? data.due : [];
    if (due.length === 0) return;
    const win = await chrome.windows.getCurrent().catch(() => null);
    for (const s of due) {
      try {
        await chrome.tabs.create({
          url: s.url,
          windowId: win ? win.id : undefined,
          active: false,
        });
        await fetch(`http://localhost:3456/api/snoozes/${s.id}/woken`, { method: 'POST' });
      } catch { /* skip URLs Chrome refuses */ }
    }
  } catch { /* server may be down */ }
}

// Run once when the service worker (re)starts
updateBadge();
