// tests/api.test.js
// ─────────────────────────────────────────────────────────────────────────────
// API tests for the Tab Out server. Uses Node's built-in test runner and
// global fetch — no external test deps (keeps `npm test` working under the
// ignore-scripts npmrc). Each run points the app at a throwaway data dir via
// TABOUT_CONFIG_DIR, so it never touches ~/.mission-control.
// ─────────────────────────────────────────────────────────────────────────────

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate the data dir BEFORE requiring the app (config reads it at import).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tabout-test-'));
process.env.TABOUT_CONFIG_DIR = TMP_DIR;

const app = require('../server/index.js');

let server, base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const api = (p, opts) => fetch(base + p, opts);
const post = (p, body) => api(p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const patch = (p, body) => api(p, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Snooze due logic (regression test for the ISO-vs-datetime bug) ───────────
test('a past snooze is due, a future snooze is not', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  await post('/api/snoozes', { url: 'https://past.test/', title: 'past', wake_at: past });
  await post('/api/snoozes', { url: 'https://future.test/', title: 'future', wake_at: future });

  const due = (await (await api('/api/snoozes/due')).json()).due;
  const dueUrls = due.map(s => s.url);
  assert.ok(dueUrls.includes('https://past.test/'), 'past snooze should be due');
  assert.ok(!dueUrls.includes('https://future.test/'), 'future snooze should not be due');
});

// ── Defer dedupe + check/archive flow ────────────────────────────────────────
test('deferring the same url twice keeps one active row with the latest title', async () => {
  await post('/api/defer', { tabs: [{ url: 'https://dedupe.test/', title: 'first' }] });
  await post('/api/defer', { tabs: [{ url: 'https://dedupe.test/', title: 'second' }] });

  const { active } = await (await api('/api/deferred')).json();
  const rows = active.filter(r => r.url === 'https://dedupe.test/');
  assert.strictEqual(rows.length, 1, 'should be exactly one active row');
  assert.strictEqual(rows[0].title, 'second', 'title should be updated to latest');
});

test('checking a deferred tab moves it from active to archived', async () => {
  await post('/api/defer', { tabs: [{ url: 'https://check.test/', title: 'check me' }] });
  let { active } = await (await api('/api/deferred')).json();
  const row = active.find(r => r.url === 'https://check.test/');
  assert.ok(row, 'deferred row should exist');

  const res = await patch(`/api/deferred/${row.id}`, { checked: true });
  assert.strictEqual(res.status, 200);

  const after = await (await api('/api/deferred')).json();
  assert.ok(!after.active.some(r => r.id === row.id), 'should leave active list');
  assert.ok(after.archived.some(r => r.id === row.id), 'should appear in archive');
});

// ── Config validation ────────────────────────────────────────────────────────
test('config rejects a wrong-typed value and accepts a valid one', async () => {
  const bad = await patch('/api/config', { autoRefreshSeconds: 'abc' });
  assert.strictEqual(bad.status, 400, 'string for a number field should 400');

  const good = await patch('/api/config', { autoRefreshSeconds: 45 });
  assert.strictEqual(good.status, 200);
  const cfg = await good.json();
  assert.strictEqual(cfg.autoRefreshSeconds, 45);
});

test('config rejects a non-array quickLinks', async () => {
  const res = await patch('/api/config', { quickLinks: 'not-an-array' });
  assert.strictEqual(res.status, 400);
});

// ── Backfill never overwrites today's live counters ──────────────────────────
test('backfill replace=true skips today so live event counters survive', async () => {
  const today = new Date().toISOString().slice(0, 10);

  // A live "open" event lands in today's row.
  await post('/api/stats/event', { type: 'open', domain: 'live.test' });

  // A backfill claiming today has 999 opens must NOT clobber the live row.
  await post('/api/stats/backfill', {
    replace: true,
    days: [{ day: today, opens: 999, closes: 999, domains: { 'backfill.test': 999 } }],
  });

  const { stat } = await (await api(`/api/stats/day/${today}`)).json();
  assert.ok(stat, 'today should have a stat row');
  assert.ok(stat.tabs_opened < 999, `today's live counter (${stat.tabs_opened}) must not be overwritten by backfill`);
});

test('backfill fills a missing historical day', async () => {
  const res = await post('/api/stats/backfill', {
    days: [{ day: '2020-01-15', opens: 5, closes: 3, domains: { 'old.test': 5 } }],
  });
  assert.strictEqual(res.status, 200);
  const { stat } = await (await api('/api/stats/day/2020-01-15')).json();
  assert.strictEqual(stat.tabs_opened, 5);
  assert.strictEqual(stat.tabs_closed, 3);
});
