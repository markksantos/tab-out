// server/config.js
// ─────────────────────────────────────────────────────────────────────────────
// Configuration loader for Tab Out.
//
// Reads settings from ~/.mission-control/config.json.
// If that file exists, values from it override the defaults below.
// If the file doesn't exist or is malformed, defaults are used.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_DIR = path.join(os.homedir(), ".mission-control");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  port: 3456,
  userName: "",
  pomodoroWorkMinutes: 25,
  pomodoroBreakMinutes: 5,
  clockShowSeconds: false,
  clockFormat: "12",
  quoteText: "The impediment to action advances action. What stands in the way becomes the way.",
  quoteAuthor: "Marcus Aurelius",
  useDynamicQuote: false,
  searchEngine: "google",
  quickLinks: [],
  staleWhitelist: [],
  // Section visibility — each flag gates one dashboard region
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
  // Behavior knobs
  autoRefreshSeconds: 30,    // 0 = manual only
  soundEffects: true,
  confettiEffects: true,
  staleThresholdDays: 7,
  heatmapWeeks: 26,
  compactMode: false,
  animationsEnabled: true,
  weekStartsOnMonday: false,
  suggestThreshold: 5,       // min tab count to surface "save as session" banner
  tabCapWarning: 0,          // 0 = off; otherwise warn when open tabs > N
};

const VALID_SEARCH_ENGINES = ["google", "bing", "duckduckgo", "brave", "ecosia"];
const VALID_CLOCK_FORMATS = ["12", "24"];

function loadConfig() {
  let fileConfig = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf8");
      fileConfig = JSON.parse(raw);
    } catch (err) {
      console.warn(
        `[config] Warning: could not parse ${CONFIG_FILE}: ${err.message}`,
      );
      console.warn("[config] Falling back to defaults.");
    }
  } else {
    console.warn(
      `[config] No config file found at ${CONFIG_FILE}. Using defaults.`,
    );
  }

  return Object.assign({}, DEFAULTS, fileConfig);
}

const config = loadConfig();

config.CONFIG_DIR = CONFIG_DIR;
config.CONFIG_FILE = CONFIG_FILE;
config.DEFAULTS = DEFAULTS;

config.save = function saveConfig(updates) {
  // Type-check every update against the DEFAULTS shape so a bad payload
  // (autoRefreshSeconds: "abc", quickLinks: "x") can't persist to disk and
  // break the dashboard on next load. Keys not in DEFAULTS (extensionOrigin)
  // pass through untyped.
  for (const [key, value] of Object.entries(updates || {})) {
    const def = DEFAULTS[key];
    if (def === undefined || value === undefined) continue;
    if (Array.isArray(def)) {
      if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
    } else if (typeof value !== typeof def) {
      throw new Error(`${key} must be a ${typeof def}`);
    }
    if (typeof def === 'number' && !Number.isFinite(value)) {
      throw new Error(`${key} must be a finite number`);
    }
  }
  const merged = Object.assign({}, loadConfig(), updates);
  if (merged.searchEngine && !VALID_SEARCH_ENGINES.includes(merged.searchEngine)) {
    throw new Error(`Invalid searchEngine: ${merged.searchEngine}`);
  }
  if (merged.clockFormat && !VALID_CLOCK_FORMATS.includes(merged.clockFormat)) {
    throw new Error(`Invalid clockFormat: ${merged.clockFormat}`);
  }
  if (merged.pomodoroWorkMinutes !== undefined && (merged.pomodoroWorkMinutes < 1 || merged.pomodoroWorkMinutes > 120)) {
    throw new Error("pomodoroWorkMinutes must be between 1 and 120");
  }
  if (merged.pomodoroBreakMinutes !== undefined && (merged.pomodoroBreakMinutes < 1 || merged.pomodoroBreakMinutes > 60)) {
    throw new Error("pomodoroBreakMinutes must be between 1 and 60");
  }
  delete merged.CONFIG_DIR;
  delete merged.CONFIG_FILE;
  delete merged.DEFAULTS;
  delete merged.save;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n");
  Object.assign(config, merged);
  config.CONFIG_DIR = CONFIG_DIR;
  config.CONFIG_FILE = CONFIG_FILE;
  config.DEFAULTS = DEFAULTS;
  config.save = saveConfig;
};

const saveConfig = config.save;

module.exports = config;
