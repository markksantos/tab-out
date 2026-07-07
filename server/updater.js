// server/updater.js
// ─────────────────────────────────────────────────────────────────────────────
// Read-only update checker. Asks GitHub how the local commit relates to
// origin/main using the compare API, so local (unpushed) commits do NOT
// count as "update available" — only commits on the remote that are missing
// locally do. No shell network operations, no code execution.
// ─────────────────────────────────────────────────────────────────────────────

const { execSync } = require('child_process');
const path = require('path');

const REPO = 'markksantos/tab-out';
const CHECK_INTERVAL = 48 * 60 * 60 * 1000; // 48 hours
const PROJECT_ROOT = path.resolve(__dirname, '..');

let status = {
  updateAvailable: false,
  currentCommit: '',
  checkedAt: null,
};

function getLocalCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function checkForUpdate() {
  try {
    const localCommit = getLocalCommit();
    if (!localCommit) return;

    // compare/<local>...main → ahead_by = commits on main that local lacks.
    // 404 means the local commit was never pushed; that's development, not
    // an available update.
    const res = await fetch(`https://api.github.com/repos/${REPO}/compare/${localCommit}...main`, {
      headers: { 'User-Agent': 'tab-out-updater' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return;

    const data = await res.json();
    const aheadBy = typeof data.ahead_by === 'number' ? data.ahead_by : 0;

    status = {
      updateAvailable: aheadBy > 0,
      currentCommit: localCommit.slice(0, 7),
      checkedAt: new Date().toISOString(),
    };

    if (status.updateAvailable) {
      console.log(`[updater] Update available: origin/main is ${aheadBy} commit(s) ahead of ${status.currentCommit}`);
    }
  } catch {
    // Fail silently -- offline, rate limited, etc.
  }
}

function startUpdateChecker() {
  checkForUpdate();
  setInterval(checkForUpdate, CHECK_INTERVAL);
}

function getUpdateStatus() {
  return status;
}

module.exports = { startUpdateChecker, getUpdateStatus };
