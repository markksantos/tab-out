// server/db.js
// ─────────────────────────────────────────────────────────────────────────────
// Database layer for Tab Out.
//
// Think of this file as the "filing cabinet" for the whole app. It sets up a
// SQLite database — a single file that stores saved-for-later tabs, their
// URLs, and archives. SQLite is like a tiny, self-contained spreadsheet
// engine that lives right on your computer with no separate server needed.
//
// We use "better-sqlite3" which is a Node.js library that makes SQLite very
// fast and easy to use. Unlike most database libraries, it's "synchronous"
// (blocking), which actually makes the code simpler and avoids a class of bugs
// common in async database code.
//
// Database file location: ~/.mission-control/missions.db
// ─────────────────────────────────────────────────────────────────────────────

const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

// Pull in our config to get the CONFIG_DIR path (~/.mission-control)
const config = require('./config');

// ─────────────────────────────────────────────────────────────────────────────
// Database initialisation
//
// Make sure the ~/.mission-control directory exists before we try to create
// the database file inside it. fs.mkdirSync with { recursive: true } is like
// `mkdir -p` — it won't error if the folder already exists.
// ─────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(config.CONFIG_DIR, { recursive: true });

const DB_PATH = path.join(config.CONFIG_DIR, 'missions.db');

// Open (or create) the database file. The { verbose } option is optional
// but omitted here to keep logs clean in production.
const db = new Database(DB_PATH);

// ─────────────────────────────────────────────────────────────────────────────
// WAL mode (Write-Ahead Logging)
//
// WAL is a performance setting for SQLite. By default SQLite uses "journal
// mode" which can be slow when writing. WAL lets reads and writes happen
// simultaneously without blocking each other — important for a server that
// might be reading missions while also writing updates.
// Think of it like a post-it note system: writes go on a sticky note first,
// reads can still see the old data, and they get merged together later.
// ─────────────────────────────────────────────────────────────────────────────
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────────────────────────────────────────
// Schema creation
//
// db.exec() runs raw SQL and is used here for setup (not for queries with
// user input — those use prepared statements to prevent SQL injection).
//
// "IF NOT EXISTS" means these statements are safe to run every time the app
// starts — they won't error or overwrite data if the tables already exist.
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  -- ──────────────────────────────────────────────────────────────────────────
  -- meta table
  -- A simple key-value store for app-wide settings and state.
  -- For example: { key: 'last_sync', value: '2024-01-15T10:30:00' }
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- ──────────────────────────────────────────────────────────────────────────
  -- deferred_tabs table
  -- Tabs the user has "saved for later." They're closed in the browser but
  -- live here until the user checks them off, dismisses them, or they age
  -- out after 30 days. Think of it like a reading list with an expiry date.
  --   checked = 1   → user checked it off (read it)
  --   dismissed = 1  → user clicked X (skipped it intentionally)
  --   archived = 1   → moved to archive (via check, dismiss, or 30-day age-out)
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS deferred_tabs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    url            TEXT    NOT NULL,
    title          TEXT    NOT NULL,
    favicon_url    TEXT,
    source_mission TEXT,
    deferred_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    checked        INTEGER NOT NULL DEFAULT 0,
    checked_at     TEXT,
    dismissed      INTEGER NOT NULL DEFAULT 0,
    archived       INTEGER NOT NULL DEFAULT 0,
    archived_at    TEXT
  );

  -- ──────────────────────────────────────────────────────────────────────────
  -- sessions table
  -- A named snapshot of a set of tabs ("Mr Client research", "Friday inbox
  -- triage"). User clicks Save → the current tab list is stored as JSON.
  -- Restore opens each URL as a new tab. Sessions are durable across restarts
  -- and live until the user deletes them.
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    urls_json   TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ──────────────────────────────────────────────────────────────────────────
  -- tab_notes table
  -- One free-text note per URL. Solves "why is this tab still open" for
  -- chronic tab-hoarders. Note is keyed by URL so it follows the page even
  -- after the tab is closed and reopened.
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS tab_notes (
    url        TEXT PRIMARY KEY,
    note       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ──────────────────────────────────────────────────────────────────────────
  -- snoozed_tabs table
  -- Tabs the user has snoozed — closed in the browser, scheduled to be
  -- reopened at wake_at. The extension's chrome.alarms reads this and
  -- creates the tab when the time arrives.
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS snoozed_tabs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT NOT NULL,
    title       TEXT,
    favicon_url TEXT,
    wake_at     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    woken       INTEGER NOT NULL DEFAULT 0
  );

  -- ──────────────────────────────────────────────────────────────────────────
  -- daily_stats table
  -- Lightweight per-day counters for the "yesterday" summary card.
  -- The extension's background script writes increments via the API.
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS daily_stats (
    day            TEXT PRIMARY KEY,
    tabs_opened    INTEGER NOT NULL DEFAULT 0,
    tabs_closed    INTEGER NOT NULL DEFAULT 0,
    domains_json   TEXT NOT NULL DEFAULT '{}'
  );
`);

// Add workspace column to sessions for the workspaces feature. Older DBs
// created before this column was added will need it.
try {
  db.prepare("SELECT workspace FROM sessions LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE sessions ADD COLUMN workspace TEXT NOT NULL DEFAULT 'Default'");
}

// One active saved-for-later entry per URL. Archive older duplicates that
// predate this rule, then enforce it with a partial unique index (also the
// conflict target for insertDeferred's upsert).
db.exec(`
  UPDATE deferred_tabs
  SET    archived = 1,
         archived_at = datetime('now')
  WHERE  archived = 0
    AND  id NOT IN (
      SELECT MAX(id) FROM deferred_tabs WHERE archived = 0 GROUP BY url
    );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_deferred_active_url
    ON deferred_tabs(url) WHERE archived = 0;
  CREATE INDEX IF NOT EXISTS idx_deferred_archived
    ON deferred_tabs(archived, deferred_at);
  CREATE INDEX IF NOT EXISTS idx_snoozed_pending
    ON snoozed_tabs(woken, wake_at);
`);

// ─────────────────────────────────────────────────────────────────────────────
// Prepared statements — query helpers
//
// A "prepared statement" is a pre-compiled SQL query. Think of it like a
// form with blank fields: you write the structure once, then fill in the
// values each time you use it. This is:
//   1. Faster (SQLite compiles the query once, not every call)
//   2. Safer (prevents SQL injection — user data can never become SQL code)
//
// db.prepare() compiles the SQL. Calling .run(), .get(), or .all() executes it.
// ─────────────────────────────────────────────────────────────────────────────

// ── READ QUERIES ─────────────────────────────────────────────────────────────

// ── WRITE QUERIES ─────────────────────────────────────────────────────────────

// ── META KEY-VALUE HELPERS ────────────────────────────────────────────────────

/**
 * getMeta
 * Retrieves a single meta value by its key.
 * Returns the whole row object { key, value } or undefined if not found.
 */
const getMeta = db.prepare(`
  SELECT value
  FROM   meta
  WHERE  key = :key
`);

/**
 * setMeta
 * Inserts or updates a meta key-value pair.
 * INSERT OR REPLACE works fine here because there's no extra data to preserve.
 */
const setMeta = db.prepare(`
  INSERT OR REPLACE INTO meta (key, value)
  VALUES (:key, :value)
`);

// ── DEFERRED TABS QUERIES ─────────────────────────────────────────────────

/**
 * getDeferredActive
 * Returns all deferred tabs that haven't been archived yet.
 * Ordered by most recently deferred first (newest at top of checklist).
 */
const getDeferredActive = db.prepare(`
  SELECT *
  FROM   deferred_tabs
  WHERE  archived = 0
  ORDER BY deferred_at DESC
`);

/**
 * getDeferredArchived
 * Returns all archived deferred tabs (checked off, dismissed, or aged out).
 * Most recently archived first.
 */
const getDeferredArchived = db.prepare(`
  SELECT *
  FROM   deferred_tabs
  WHERE  archived = 1
  ORDER BY archived_at DESC
`);

/**
 * insertDeferred
 * Saves a new deferred tab. Called when the user clicks the save/bookmark
 * icon on a tab chip.
 */
const insertDeferred = db.prepare(`
  INSERT INTO deferred_tabs (url, title, favicon_url, source_mission)
  VALUES (:url, :title, :favicon_url, :source_mission)
  ON CONFLICT(url) WHERE archived = 0 DO UPDATE SET
    title       = excluded.title,
    favicon_url = excluded.favicon_url,
    deferred_at = datetime('now')
`);

/**
 * checkDeferred
 * Marks a deferred tab as checked off (user read it) and archives it.
 */
const checkDeferred = db.prepare(`
  UPDATE deferred_tabs
  SET    checked = 1,
         checked_at = datetime('now'),
         archived = 1,
         archived_at = datetime('now')
  WHERE  id = :id
`);

/**
 * dismissDeferred
 * Marks a deferred tab as dismissed (user skipped it) and archives it.
 */
const dismissDeferred = db.prepare(`
  UPDATE deferred_tabs
  SET    dismissed = 1,
         archived = 1,
         archived_at = datetime('now')
  WHERE  id = :id
`);

/**
 * ageOutDeferred
 * Archives any deferred tabs older than 30 days that haven't been
 * checked or dismissed yet. Called on each dashboard load.
 */
const ageOutDeferred = db.prepare(`
  UPDATE deferred_tabs
  SET    archived = 1,
         archived_at = datetime('now')
  WHERE  archived = 0
    AND  deferred_at < datetime('now', '-30 days')
`);

/**
 * searchDeferredArchived
 * Search archived deferred tabs by title or URL. Uses LIKE for
 * simple substring matching.
 */
const searchDeferredArchived = db.prepare(`
  SELECT *
  FROM   deferred_tabs
  WHERE  archived = 1
    AND  (title LIKE '%' || :q || '%' OR url LIKE '%' || :q || '%')
  ORDER BY archived_at DESC
  LIMIT 50
`);

// ── SESSIONS QUERIES ──────────────────────────────────────────────────────

const insertSession = db.prepare(`
  INSERT INTO sessions (name, urls_json, workspace)
  VALUES (:name, :urls_json, :workspace)
`);

const getSessions = db.prepare(`
  SELECT id, name, urls_json, created_at, workspace
  FROM   sessions
  ORDER BY created_at DESC
`);

const getSession = db.prepare(`
  SELECT id, name, urls_json, created_at, workspace
  FROM   sessions
  WHERE  id = :id
`);

const deleteSession = db.prepare(`
  DELETE FROM sessions
  WHERE id = :id
`);

const updateSessionWorkspace = db.prepare(`
  UPDATE sessions SET workspace = :workspace WHERE id = :id
`);

const updateSessionUrls = db.prepare(`
  UPDATE sessions SET urls_json = :urls_json WHERE id = :id
`);

// ── TAB NOTES ──────────────────────────────────────────────────────────────

const upsertNote = db.prepare(`
  INSERT INTO tab_notes (url, note, updated_at)
  VALUES (:url, :note, datetime('now'))
  ON CONFLICT(url) DO UPDATE SET
    note = excluded.note,
    updated_at = excluded.updated_at
`);

const deleteNote = db.prepare(`
  DELETE FROM tab_notes
  WHERE url = :url
`);

const getAllNotes = db.prepare(`
  SELECT url, note, updated_at FROM tab_notes
`);

// ── SNOOZED TABS ───────────────────────────────────────────────────────────

const insertSnooze = db.prepare(`
  INSERT INTO snoozed_tabs (url, title, favicon_url, wake_at)
  VALUES (:url, :title, :favicon_url, :wake_at)
`);

const getActiveSnoozes = db.prepare(`
  SELECT * FROM snoozed_tabs
  WHERE  woken = 0
  ORDER BY wake_at ASC
`);

// wake_at is stored as an ISO string ("2026-07-07T15:00:00.000Z") while
// datetime('now') renders "2026-07-07 15:00:00" — 'T' sorts after ' ', so a
// plain string compare against datetime('now') never matches until the UTC
// date rolls over. Compare against the same ISO shape instead.
const getDueSnoozes = db.prepare(`
  SELECT * FROM snoozed_tabs
  WHERE  woken = 0 AND wake_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`);

const markSnoozeWoken = db.prepare(`
  UPDATE snoozed_tabs SET woken = 1 WHERE id = :id
`);

const deleteSnooze = db.prepare(`
  DELETE FROM snoozed_tabs WHERE id = :id
`);

// ── DAILY STATS ────────────────────────────────────────────────────────────

const upsertDailyStat = db.prepare(`
  INSERT INTO daily_stats (day, tabs_opened, tabs_closed, domains_json)
  VALUES (:day, :tabs_opened, :tabs_closed, :domains_json)
  ON CONFLICT(day) DO UPDATE SET
    tabs_opened  = tabs_opened + excluded.tabs_opened,
    tabs_closed  = tabs_closed + excluded.tabs_closed,
    domains_json = excluded.domains_json
`);

const getDailyStat = db.prepare(`
  SELECT * FROM daily_stats WHERE day = :day
`);

const getDailyStatsRange = db.prepare(`
  SELECT day, tabs_opened, tabs_closed, domains_json
  FROM   daily_stats
  WHERE  day >= :start AND day <= :end
  ORDER BY day ASC
`);

// Insert-or-ignore: only fills days that don't yet have a row. Used by the
// chrome.history backfill so we never clobber the live tab-event counters.
const insertDailyStatIfMissing = db.prepare(`
  INSERT OR IGNORE INTO daily_stats (day, tabs_opened, tabs_closed, domains_json)
  VALUES (:day, :tabs_opened, :tabs_closed, :domains_json)
`);

// Replace-mode insert: overwrites existing rows. Used by re-backfills that
// have a more accurate per-visit count than what was previously stored.
// Callers must guard against clobbering today's live event counters.
const replaceDailyStat = db.prepare(`
  INSERT OR REPLACE INTO daily_stats (day, tabs_opened, tabs_closed, domains_json)
  VALUES (:day, :tabs_opened, :tabs_closed, :domains_json)
`);

// ─────────────────────────────────────────────────────────────────────────────
// Exports
//
// We export the raw db instance (for advanced queries if needed) plus all the
// prepared statement helpers. Other modules import only what they need:
//   const { getMissions, upsertMission } = require('./db');
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  db,               // Raw better-sqlite3 Database instance
  getMeta,          // ({ key }) → { value } or undefined
  setMeta,          // ({ key, value })
  getDeferredActive,    // () → array of active (non-archived) deferred tabs
  getDeferredArchived,  // () → array of archived deferred tabs
  insertDeferred,       // ({ url, title, favicon_url, source_mission })
  checkDeferred,        // ({ id }) → marks as checked + archived
  dismissDeferred,      // ({ id }) → marks as dismissed + archived
  ageOutDeferred,       // () → archives tabs older than 30 days
  searchDeferredArchived, // ({ q }) → search archived by title/url
  insertSession,    // ({ name, urls_json }) → inserts a new session
  getSessions,      // () → all sessions ordered newest first
  getSession,       // ({ id }) → single session row or undefined
  deleteSession,    // ({ id }) → deletes a session
  updateSessionWorkspace, // ({ id, workspace })
  updateSessionUrls,      // ({ id, urls_json })
  upsertNote,       // ({ url, note })
  deleteNote,       // ({ url })
  getAllNotes,      // () → all notes
  insertSnooze,     // ({ url, title, favicon_url, wake_at })
  getActiveSnoozes, // () → all not-yet-woken snoozes
  getDueSnoozes,    // () → snoozes whose wake_at <= now
  markSnoozeWoken,  // ({ id })
  deleteSnooze,     // ({ id })
  upsertDailyStat,  // ({ day, tabs_opened, tabs_closed, domains_json })
  getDailyStat,     // ({ day })
  getDailyStatsRange, // ({ start, end }) → array of rows
  insertDailyStatIfMissing, // ({ day, tabs_opened, tabs_closed, domains_json })
  replaceDailyStat,         // ({ day, tabs_opened, tabs_closed, domains_json })
};
