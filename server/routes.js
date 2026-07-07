// server/routes.js
// ─────────────────────────────────────────────────────────────────────────────
// Express API routes for Tab Out.
//
// Think of this file as the "front desk" of the app's backend. The browser
// sends requests here, and these routes figure out what data to fetch or what
// action to take, then send back a JSON response.
//
// Every endpoint path starts with /api/, so:
//   - The browser asks  →  GET /api/missions
//   - This file handles →  router.get('/missions', ...)
//   - The main server (index.js) mounts this router at /api
//
// All "prepared statements" from db.js follow the better-sqlite3 pattern:
//   - .all()    → returns an array of rows (for SELECT queries)
//   - .run()    → executes a write (INSERT / UPDATE / DELETE)
//   - .get()    → returns a single row or undefined
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const path = require('path');
const config = require('./config');
const { getUpdateStatus } = require('./updater');

// Pull in the database prepared statements we need
const {
  getMissions,
  getMissionUrls,
  dismissMission,
  archiveMission,
  getMeta,
  setMeta,
  db,
  getDeferredActive,
  getDeferredArchived,
  insertDeferred,
  checkDeferred,
  dismissDeferred,
  ageOutDeferred,
  searchDeferredArchived,
  insertSession,
  getSessions,
  getSession,
  deleteSession,
  updateSessionWorkspace,
  updateSessionUrls,
  upsertNote,
  deleteNote,
  getAllNotes,
  insertSnooze,
  getActiveSnoozes,
  getDueSnoozes,
  markSnoozeWoken,
  deleteSnooze,
  upsertDailyStat,
  replaceDailyStat,
  getDailyStat,
  getDailyStatsRange,
  insertDailyStatIfMissing,
} = require('./db');

// An Express Router is like a mini-app: it holds a group of related routes.
// We export it and mount it on the main Express app in index.js.
const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/missions
//
// Returns all non-dismissed missions, each with their URLs attached.
//
// The database stores missions and URLs in separate tables (a "one-to-many"
// relationship). This endpoint joins them together in JavaScript — we first
// fetch all missions, then for each mission, fetch its URLs and attach them
// as a `urls` property on the mission object.
//
// Response shape:
//   [
//     {
//       id: "abc123",
//       name: "Planning Tokyo Trip",
//       summary: "...",
//       status: "active",
//       last_activity: "2024-01-15T10:00:00Z",
//       urls: [
//         { id: 1, mission_id: "abc123", url: "https://...", title: "...", visit_count: 3 },
//         ...
//       ]
//     },
//     ...
//   ]
// ─────────────────────────────────────────────────────────────────────────────
router.get('/missions', (req, res) => {
  try {
    // Fetch all non-dismissed missions (ordered by status priority, then recency)
    const missions = getMissions.all();

    // For each mission, fetch its associated URLs and attach them
    const missionsWithUrls = missions.map(mission => ({
      ...mission,                                    // spread all mission fields
      urls: getMissionUrls.all({ id: mission.id }),  // attach urls array
    }));

    res.json(missionsWithUrls);
  } catch (err) {
    console.error('[routes] GET /missions failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch missions' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/missions/:id/dismiss
//
// Soft-deletes a mission by marking it dismissed = 1 in the database.
// The mission data is kept (for history) but it won't appear in the main list.
//
// :id is a URL parameter — e.g. POST /api/missions/abc123/dismiss
//
// Response: { success: true }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/missions/:id/dismiss', (req, res) => {
  try {
    const { id } = req.params; // extract the mission ID from the URL

    // Run the UPDATE query: sets dismissed = 1 for this mission id
    dismissMission.run({ id });

    res.json({ success: true });
  } catch (err) {
    console.error('[routes] POST /missions/:id/dismiss failed:', err.message);
    res.status(500).json({ error: 'Failed to dismiss mission' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/missions/:id/archive
//
// Saves a snapshot of the mission into the archives table, then dismisses it.
// Archiving is "dismiss + save a record". It's useful for reviewing what you
// worked on in the past — the archive keeps the name and URLs even after dismiss.
//
// Steps:
//   1. Find the mission by id (return 404 if not found)
//   2. Fetch its associated URLs
//   3. Insert a row into the archives table (mission + urls as JSON)
//   4. Dismiss the mission (soft-delete it from the active list)
//
// Response: { success: true }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/missions/:id/archive', (req, res) => {
  try {
    const { id } = req.params;

    // ── Step 1: Find the mission ───────────────────────────────────────────────
    // db.prepare().get() returns a single row object or undefined.
    // We need to check if the mission actually exists before archiving it.
    const mission = db
      .prepare('SELECT * FROM missions WHERE id = ? AND dismissed = 0')
      .get(id);

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found or already dismissed' });
    }

    // ── Step 2: Fetch the mission's URLs ───────────────────────────────────────
    const urls = getMissionUrls.all({ id: mission.id });

    // ── Step 3: Insert into archives ───────────────────────────────────────────
    // We store the URLs as a JSON string (urls_json) because the archives table
    // only needs to display them as a list — we don't need to query individual
    // archived URLs. Storing as JSON keeps the archives table simple.
    archiveMission.run({
      mission_id: mission.id,
      mission_name: mission.name,
      urls_json: JSON.stringify(urls),      // array of URL objects → JSON string
      archived_at: new Date().toISOString(),  // ISO timestamp of when archived
    });

    // ── Step 4: Dismiss the mission ────────────────────────────────────────────
    // This soft-deletes it from the active list (dismissed = 1).
    // We do this after archiving so we don't lose data if the archive insert fails.
    dismissMission.run({ id: mission.id });

    res.json({ success: true });
  } catch (err) {
    console.error('[routes] POST /missions/:id/archive failed:', err.message);
    res.status(500).json({ error: 'Failed to archive mission' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stats
//
// Returns summary statistics about the current state of missions.
// Used by the dashboard footer to show things like open tab count.
//
// Response:
//   {
//     totalMissions:    14,   // non-dismissed missions
//     totalUrls:        87,   // total URLs across all active missions
//     abandonedMissions: 3,   // missions with status = 'abandoned'
//     lastAnalysis:     "2024-01-15T10:30:00Z"  // ISO timestamp (or null)
//   }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    // Count total non-dismissed missions
    // .get() returns a single row — here it's { count: 14 }
    const { count: totalMissions } = db
      .prepare('SELECT COUNT(*) as count FROM missions WHERE dismissed = 0')
      .get();

    // Count total URLs across all active (non-dismissed) missions
    // We join mission_urls to missions to only count URLs from active missions
    const { count: totalUrls } = db
      .prepare(`
        SELECT COUNT(*) as count
        FROM   mission_urls mu
        JOIN   missions m ON mu.mission_id = m.id
        WHERE  m.dismissed = 0
      `)
      .get();

    // Count missions with status = 'abandoned' (non-dismissed only)
    const { count: abandonedMissions } = db
      .prepare(`
        SELECT COUNT(*) as count
        FROM   missions
        WHERE  dismissed = 0
          AND  status    = 'abandoned'
      `)
      .get();

    // Get last_analysis timestamp from the meta key-value store
    // getMeta.get() returns { value: "2024-01-15T..." } or undefined if never run
    const metaRow = getMeta.get({ key: 'last_analysis' });
    const lastAnalysis = metaRow ? metaRow.value : null;

    res.json({
      totalMissions,
      totalUrls,
      abandonedMissions,
      lastAnalysis,
    });
  } catch (err) {
    console.error('[routes] GET /stats failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/update-status
//
// Read-only check: is there a newer version on GitHub?
// No shell commands, no code execution. Just returns a boolean.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/update-status', (req, res) => {
  try {
    res.json(getUpdateStatus());
  } catch {
    res.json({ updateAvailable: false });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/defer
//
// Save one or more tabs for later. The browser closes them; we store them here
// so they appear in the "Saved for Later" checklist on the dashboard.
//
// Expects: { tabs: [{ url, title, favicon_url?, source_mission? }] }
// Returns: { success: true, deferred: [{ id, url, title, ... }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/defer', (req, res) => {
  try {
    const { tabs } = req.body;
    if (!tabs || !Array.isArray(tabs) || tabs.length === 0) {
      return res.status(400).json({ error: 'tabs array is required' });
    }

    const created = [];
    for (const tab of tabs) {
      if (!tab.url || !tab.title) continue; // skip incomplete entries
      const result = insertDeferred.run({
        url: tab.url,
        title: tab.title,
        favicon_url: tab.favicon_url || null,
        source_mission: tab.source_mission || null,
      });
      created.push({
        id: result.lastInsertRowid,
        url: tab.url,
        title: tab.title,
        favicon_url: tab.favicon_url || null,
        source_mission: tab.source_mission || null,
        deferred_at: new Date().toISOString(),
      });
    }

    res.json({ success: true, deferred: created });
  } catch (err) {
    console.error('[tab-out] Error deferring tabs:', err);
    res.status(500).json({ error: 'Failed to defer tabs' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/deferred
//
// Returns both active and archived deferred tabs. Also runs the 30-day
// age-out check — any deferred tab older than 30 days gets auto-archived.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/deferred', (req, res) => {
  try {
    // Auto-archive anything older than 30 days
    ageOutDeferred.run();

    const active = getDeferredActive.all();
    const archived = getDeferredArchived.all();

    res.json({ active, archived });
  } catch (err) {
    console.error('[tab-out] Error fetching deferred tabs:', err);
    res.status(500).json({ error: 'Failed to fetch deferred tabs' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/deferred/search?q=query
//
// Search archived deferred tabs by title or URL. Returns up to 50 matches.
//
// IMPORTANT: This route MUST come before PATCH /deferred/:id. Express matches
// routes in order — if the PATCH came first, "search" would be treated as the
// :id parameter and this endpoint would never be reached.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/deferred/search', (req, res) => {
  try {
    const q = req.query.q || '';
    if (q.length < 2) {
      return res.json({ results: [] });
    }
    const results = searchDeferredArchived.all({ q });
    res.json({ results });
  } catch (err) {
    console.error('[tab-out] Error searching deferred tabs:', err);
    res.status(500).json({ error: 'Failed to search deferred tabs' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/deferred/:id
//
// Update a deferred tab — either check it off or dismiss it.
// Expects: { checked: true } or { dismissed: true }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/deferred/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });

    if (req.body.checked) {
      checkDeferred.run({ id });
    } else if (req.body.dismissed) {
      dismissDeferred.run({ id });
    } else {
      return res.status(400).json({ error: 'Must provide checked or dismissed' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[tab-out] Error updating deferred tab:', err);
    res.status(500).json({ error: 'Failed to update deferred tab' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS — save/list/restore/delete a named set of tabs.
//
// A "session" is a named snapshot of tabs. The user clicks Save on the
// dashboard → we store the current tab URLs as JSON. Later they can restore
// the session (extension reopens each URL as a new tab) or delete it.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/sessions', (req, res) => {
  try {
    const rows = getSessions.all();
    const sessions = rows.map(r => ({
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      workspace: r.workspace || 'Default',
      tabs: safeParseTabs(r.urls_json),
    }));
    res.json({ sessions });
  } catch (err) {
    console.error('[routes] GET /sessions failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

router.post('/sessions', (req, res) => {
  try {
    const name = (req.body && req.body.name || '').trim();
    const tabs = req.body && req.body.tabs;
    const workspace = ((req.body && req.body.workspace) || 'Default').toString().slice(0, 50) || 'Default';
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!Array.isArray(tabs) || tabs.length === 0) {
      return res.status(400).json({ error: 'tabs array is required' });
    }
    // Strip to just the fields we want stored — extension Tab objects can be huge
    const slim = tabs
      .filter(t => t && t.url)
      .map(t => ({ url: t.url, title: t.title || '', favIconUrl: t.favIconUrl || null }));
    if (slim.length === 0) {
      return res.status(400).json({ error: 'no valid tabs to save' });
    }
    const result = insertSession.run({
      name: name.slice(0, 100),
      urls_json: JSON.stringify(slim),
      workspace,
    });
    const row = getSession.get({ id: result.lastInsertRowid });
    res.json({
      session: {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
        workspace: row.workspace,
        tabs: safeParseTabs(row.urls_json),
      },
    });
  } catch (err) {
    console.error('[routes] POST /sessions failed:', err.message);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

router.patch('/sessions/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });
    const workspace = ((req.body && req.body.workspace) || '').toString().slice(0, 50);
    if (!workspace) return res.status(400).json({ error: 'workspace is required' });
    updateSessionWorkspace.run({ id, workspace });
    res.json({ success: true });
  } catch (err) {
    console.error('[routes] PATCH /sessions/:id failed:', err.message);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

router.post('/sessions/:id/tabs', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });
    const newTab = req.body && req.body.tab;
    if (!newTab || !newTab.url) return res.status(400).json({ error: 'tab.url required' });
    const row = getSession.get({ id });
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const existing = safeParseTabs(row.urls_json);
    // Skip if URL already in this session
    if (existing.some(t => t.url === newTab.url)) {
      return res.json({ session: { id, name: row.name, tabs: existing }, added: false });
    }
    existing.push({
      url: newTab.url,
      title: newTab.title || '',
      favIconUrl: newTab.favIconUrl || null,
    });
    updateSessionUrls.run({ id, urls_json: JSON.stringify(existing) });
    res.json({ session: { id, name: row.name, tabs: existing }, added: true });
  } catch (err) {
    console.error('[routes] POST /sessions/:id/tabs failed:', err.message);
    res.status(500).json({ error: 'Failed to add tab to session' });
  }
});

router.delete('/sessions/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });
    deleteSession.run({ id });
    res.json({ success: true });
  } catch (err) {
    console.error('[routes] DELETE /sessions/:id failed:', err.message);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TAB NOTES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/notes', (req, res) => {
  try {
    const rows = getAllNotes.all();
    const notes = {};
    for (const r of rows) notes[r.url] = { note: r.note, updated_at: r.updated_at };
    res.json({ notes });
  } catch (err) {
    console.error('[routes] GET /notes failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

router.put('/notes', (req, res) => {
  try {
    const url = (req.body && req.body.url || '').toString();
    const note = (req.body && req.body.note || '').toString().slice(0, 1000);
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (note.trim() === '') {
      deleteNote.run({ url });
    } else {
      upsertNote.run({ url, note });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[routes] PUT /notes failed:', err.message);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SNOOZED TABS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/snoozes', (req, res) => {
  try {
    const active = getActiveSnoozes.all();
    res.json({ snoozes: active });
  } catch (err) {
    console.error('[routes] GET /snoozes failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch snoozes' });
  }
});

router.post('/snoozes', (req, res) => {
  try {
    const { url, title, favicon_url, wake_at } = req.body || {};
    if (!url || !wake_at) return res.status(400).json({ error: 'url and wake_at required' });
    insertSnooze.run({
      url: String(url),
      title: title ? String(title).slice(0, 300) : null,
      favicon_url: favicon_url || null,
      wake_at: String(wake_at),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[routes] POST /snoozes failed:', err.message);
    res.status(500).json({ error: 'Failed to snooze' });
  }
});

router.delete('/snoozes/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });
    deleteSnooze.run({ id });
    res.json({ success: true });
  } catch (err) {
    console.error('[routes] DELETE /snoozes/:id failed:', err.message);
    res.status(500).json({ error: 'Failed to remove snooze' });
  }
});

// Polled by the extension's chrome.alarms hook to find tabs ready to wake
router.get('/snoozes/due', (req, res) => {
  try {
    const due = getDueSnoozes.all();
    res.json({ due });
  } catch (err) {
    console.error('[routes] GET /snoozes/due failed:', err.message);
    res.status(500).json({ error: 'Failed to check due snoozes' });
  }
});

router.post('/snoozes/:id/woken', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });
    markSnoozeWoken.run({ id });
    res.json({ success: true });
  } catch (err) {
    console.error('[routes] POST /snoozes/:id/woken failed:', err.message);
    res.status(500).json({ error: 'Failed to mark snooze woken' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DAILY STATS — increments come from the extension's tab event listeners
// ─────────────────────────────────────────────────────────────────────────────

router.get('/stats/yesterday', (req, res) => {
  try {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const day = d.toISOString().slice(0, 10);
    const row = getDailyStat.get({ day });
    if (!row) return res.json({ stat: null });
    let domains = {};
    try { domains = JSON.parse(row.domains_json); } catch { }
    res.json({
      stat: {
        day: row.day,
        tabs_opened: row.tabs_opened,
        tabs_closed: row.tabs_closed,
        domains,
      },
    });
  } catch (err) {
    console.error('[routes] GET /stats/yesterday failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/stats/range', (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 182, 7), 730);
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    const startDay = start.toISOString().slice(0, 10);
    const endDay = end.toISOString().slice(0, 10);
    const rows = getDailyStatsRange.all({ start: startDay, end: endDay });
    const map = {};
    for (const r of rows) {
      let domains = {};
      try { domains = JSON.parse(r.domains_json); } catch { }
      map[r.day] = {
        tabs_opened: r.tabs_opened,
        tabs_closed: r.tabs_closed,
        total: r.tabs_opened + r.tabs_closed,
        domains,
      };
    }
    res.json({ start: startDay, end: endDay, days, stats: map });
  } catch (err) {
    console.error('[routes] GET /stats/range failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch range' });
  }
});

router.get('/stats/day/:day', (req, res) => {
  try {
    const day = String(req.params.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ error: 'day must be YYYY-MM-DD' });
    }
    const row = getDailyStat.get({ day });
    if (!row) return res.json({ stat: null });
    let domains = {};
    try { domains = JSON.parse(row.domains_json); } catch { }
    res.json({
      stat: {
        day: row.day,
        tabs_opened: row.tabs_opened,
        tabs_closed: row.tabs_closed,
        domains,
      },
    });
  } catch (err) {
    console.error('[routes] GET /stats/day/:day failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch day' });
  }
});

// Bulk backfill from chrome.history. Body: { days: [{day, opens, closes,
// domains}], replace?: boolean }. Default mode (replace omitted/false) only
// fills days that don't already have a row, so live event counters are
// preserved. When replace=true, historical days are overwritten with the
// fresher numbers — but TODAY is never touched, since the running browser is
// still emitting live events into it.
router.post('/stats/backfill', (req, res) => {
  try {
    const body = req.body || {};
    const days = body.days || [];
    const replace = body.replace === true;
    if (!Array.isArray(days)) return res.status(400).json({ error: 'days array required' });
    const today = new Date().toISOString().slice(0, 10);
    let written = 0;
    for (const d of days) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)) continue;
      const useReplace = replace && d.day < today;
      const stmt = useReplace ? replaceDailyStat : insertDailyStatIfMissing;
      const result = stmt.run({
        day: d.day,
        tabs_opened: Number(d.opens) || 0,
        tabs_closed: Number(d.closes) || 0,
        domains_json: JSON.stringify(d.domains || {}),
      });
      if (result.changes > 0) written += 1;
    }
    res.json({ success: true, inserted: written, total: days.length, replace });
  } catch (err) {
    console.error('[routes] POST /stats/backfill failed:', err.message);
    res.status(500).json({ error: 'Failed to backfill' });
  }
});

router.post('/stats/event', (req, res) => {
  try {
    const { type, domain } = req.body || {};
    if (type !== 'open' && type !== 'close') {
      return res.status(400).json({ error: 'type must be open or close' });
    }
    const day = new Date().toISOString().slice(0, 10);
    const existing = getDailyStat.get({ day });
    let domains = {};
    if (existing) {
      try { domains = JSON.parse(existing.domains_json); } catch { }
    }
    if (domain) domains[domain] = (domains[domain] || 0) + 1;
    upsertDailyStat.run({
      day,
      tabs_opened: type === 'open' ? 1 : 0,
      tabs_closed: type === 'close' ? 1 : 0,
      domains_json: JSON.stringify(domains),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[routes] POST /stats/event failed:', err.message);
    res.status(500).json({ error: 'Failed to record event' });
  }
});

function safeParseTabs(urlsJson) {
  try {
    const arr = JSON.parse(urlsJson);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/quote
//
// Proxies the daily quote from ZenQuotes. The browser can't fetch
// zenquotes.io directly due to CORS restrictions, so we route it
// through the server.
//
// Response: { text, author } or { error } on failure.
// ─────────────────────────────────────────────────────────────────────────────
const QUOTE_CACHE_KEY = 'cached_quote';
const QUOTE_FRESH_MS = 6 * 60 * 60 * 1000; // serve cached quote up to 6h without refetching

function readCachedQuote() {
  try {
    const row = getMeta.get({ key: QUOTE_CACHE_KEY });
    return row ? JSON.parse(row.value) : null;
  } catch { return null; }
}

router.get('/quote', async (req, res) => {
  const cached = readCachedQuote();
  if (cached && Date.now() - cached.fetchedAt < QUOTE_FRESH_MS) {
    return res.json({ text: cached.text, author: cached.author });
  }
  try {
    const resp = await fetch('https://zenquotes.io/api/random', {
      signal: AbortSignal.timeout(5000),
    });
    const json = await resp.json();
    if (Array.isArray(json) && json.length > 0) {
      const quote = { text: json[0].q, author: json[0].a, fetchedAt: Date.now() };
      setMeta.run({ key: QUOTE_CACHE_KEY, value: JSON.stringify(quote) });
      return res.json({ text: quote.text, author: quote.author });
    }
  } catch (err) {
    // fall through to stale cache
  }
  if (cached) return res.json({ text: cached.text, author: cached.author });
  res.status(502).json({ error: 'Failed to fetch quote' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/config
//
// Returns the current dashboard configuration (port, userName, pomodoro, clock,
// search engine, quote visibility, quick links).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  try {
    const c = config;
    res.json({
      port: c.port,
      userName: c.userName,
      pomodoroWorkMinutes: c.pomodoroWorkMinutes,
      pomodoroBreakMinutes: c.pomodoroBreakMinutes,
      clockShowSeconds: c.clockShowSeconds,
      clockFormat: c.clockFormat,
      quoteText: c.quoteText,
      quoteAuthor: c.quoteAuthor,
      useDynamicQuote: c.useDynamicQuote,
      searchEngine: c.searchEngine,
      quickLinks: c.quickLinks || [],
      staleWhitelist: c.staleWhitelist || [],
      showWeather: c.showWeather !== false,
      showQuote: c.showQuote !== false,
      showPomodoro: c.showPomodoro !== false,
      showQuickLinks: c.showQuickLinks !== false,
      showSearch: c.showSearch !== false,
      showRecentlyClosed: c.showRecentlyClosed !== false,
      showYesterdaySummary: c.showYesterdaySummary !== false,
      showHeatmap: c.showHeatmap !== false,
      showSuggestions: c.showSuggestions !== false,
      showSessions: c.showSessions !== false,
      autoRefreshSeconds: typeof c.autoRefreshSeconds === 'number' ? c.autoRefreshSeconds : 30,
      soundEffects: c.soundEffects !== false,
      confettiEffects: c.confettiEffects !== false,
      staleThresholdDays: typeof c.staleThresholdDays === 'number' ? c.staleThresholdDays : 7,
      heatmapWeeks: typeof c.heatmapWeeks === 'number' ? c.heatmapWeeks : 26,
      compactMode: c.compactMode === true,
      animationsEnabled: c.animationsEnabled !== false,
      weekStartsOnMonday: c.weekStartsOnMonday === true,
      suggestThreshold: typeof c.suggestThreshold === 'number' ? c.suggestThreshold : 5,
      tabCapWarning: typeof c.tabCapWarning === 'number' ? c.tabCapWarning : 0,
    });
  } catch (err) {
    console.error('[routes] GET /config failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/config
//
// Updates configuration values. Only known keys are accepted; unknown keys
// are silently ignored. Validates ranges and enums before saving.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/config', (req, res) => {
  try {
    const allowed = [
      'userName', 'pomodoroWorkMinutes', 'pomodoroBreakMinutes', 'clockShowSeconds',
      'clockFormat', 'quoteText', 'quoteAuthor', 'useDynamicQuote', 'searchEngine',
      'quickLinks', 'staleWhitelist',
      'showWeather', 'showQuote', 'showPomodoro', 'showQuickLinks', 'showSearch',
      'showRecentlyClosed', 'showYesterdaySummary', 'showHeatmap', 'showSuggestions',
      'showSessions',
      'autoRefreshSeconds', 'soundEffects', 'confettiEffects', 'staleThresholdDays',
      'heatmapWeeks', 'compactMode', 'animationsEnabled', 'weekStartsOnMonday',
      'suggestThreshold', 'tabCapWarning',
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid config keys provided' });
    }
    config.save(updates);
    const c = config;
    res.json({
      port: c.port,
      userName: c.userName,
      pomodoroWorkMinutes: c.pomodoroWorkMinutes,
      pomodoroBreakMinutes: c.pomodoroBreakMinutes,
      clockShowSeconds: c.clockShowSeconds,
      clockFormat: c.clockFormat,
      quoteText: c.quoteText,
      quoteAuthor: c.quoteAuthor,
      useDynamicQuote: c.useDynamicQuote,
      searchEngine: c.searchEngine,
      quickLinks: c.quickLinks || [],
      staleWhitelist: c.staleWhitelist || [],
      showWeather: c.showWeather !== false,
      showQuote: c.showQuote !== false,
      showPomodoro: c.showPomodoro !== false,
      showQuickLinks: c.showQuickLinks !== false,
      showSearch: c.showSearch !== false,
      showRecentlyClosed: c.showRecentlyClosed !== false,
      showYesterdaySummary: c.showYesterdaySummary !== false,
      showHeatmap: c.showHeatmap !== false,
      showSuggestions: c.showSuggestions !== false,
      showSessions: c.showSessions !== false,
      autoRefreshSeconds: typeof c.autoRefreshSeconds === 'number' ? c.autoRefreshSeconds : 30,
      soundEffects: c.soundEffects !== false,
      confettiEffects: c.confettiEffects !== false,
      staleThresholdDays: typeof c.staleThresholdDays === 'number' ? c.staleThresholdDays : 7,
      heatmapWeeks: typeof c.heatmapWeeks === 'number' ? c.heatmapWeeks : 26,
      compactMode: c.compactMode === true,
      animationsEnabled: c.animationsEnabled !== false,
      weekStartsOnMonday: c.weekStartsOnMonday === true,
      suggestThreshold: typeof c.suggestThreshold === 'number' ? c.suggestThreshold : 5,
      tabCapWarning: typeof c.tabCapWarning === 'number' ? c.tabCapWarning : 0,
    });
  } catch (err) {
    console.error('[routes] PATCH /config failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Export
//
// The main Express app (index.js) does:
//   const routes = require('./routes');
//   app.use('/api', routes);
//
// That mounts all of our router.get('/missions') etc. at /api/missions.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = router;
