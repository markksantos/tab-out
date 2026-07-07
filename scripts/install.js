// scripts/install.js
// ─────────────────────────────────────────────────────────────────────────────
// One-time setup script for Tab Out. Cross-platform: macOS, Windows, Linux.
//
// Run with: npm run install-service
//
// What it does:
//   1. Creates the ~/.mission-control/ directory (data + config)
//   2. Creates ~/.mission-control/logs/ (server output)
//   3. Creates a default config.json IF one doesn't already exist
//   4. Installs a platform-specific auto-start service:
//      - macOS:   Launch Agent (~/Library/LaunchAgents/)
//      - Linux:   systemd user service (~/.config/systemd/user/)
//      - Windows: Startup folder shortcut or VBS script
// ─────────────────────────────────────────────────────────────────────────────

const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const { execSync } = require('child_process');

// Import config paths and defaults
const config = require('../server/config.js');
const CONFIG_DIR  = config.CONFIG_DIR;
const CONFIG_FILE = config.CONFIG_FILE;
const DEFAULTS    = config.DEFAULTS;

// ── Shared paths ─────────────────────────────────────────────────────────────
const LOGS_DIR     = path.join(CONFIG_DIR, 'logs');
const PROJECT_DIR  = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.resolve(PROJECT_DIR, 'server', 'index.js');

// Resolve the node binary path
let NODE_BIN;
try {
  NODE_BIN = execSync(process.platform === 'win32' ? 'where node' : 'which node',
    { encoding: 'utf8' }).trim().split('\n')[0].trim();
} catch (_) {
  NODE_BIN = process.execPath;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`  Created: ${dirPath}`);
  } else {
    console.log(`  Exists:  ${dirPath}`);
  }
}

// ── macOS: Launch Agent ──────────────────────────────────────────────────────

function installMacOS() {
  const plistDir  = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistFile = path.join(plistDir, 'com.tab-out.server.plist');
  const label     = 'com.tab-out.server';

  ensureDir(plistDir);

  // Run the server via a self-owned copy of the node binary named
  // "tab-out-server". Two reasons:
  //   1. A node-version-manager wipe/relocation can't break boot.
  //   2. macOS Login Items shows the item as "tab-out-server" instead of an
  //      anonymous "node", so it doesn't get toggled off by accident — a
  //      BTM-disallowed item silently never starts at login even though
  //      launchctl reports it enabled.
  const runtimeDir = path.join(PROJECT_DIR, '.runtime');
  const runtimeBin = path.join(runtimeDir, 'tab-out-server');
  ensureDir(runtimeDir);
  if (!fs.existsSync(runtimeBin)) {
    fs.copyFileSync(NODE_BIN, runtimeBin);
    fs.chmodSync(runtimeBin, 0o755);
    console.log(`  Copied node → ${runtimeBin}`);
  } else {
    console.log(`  Exists:  ${runtimeBin}`);
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${runtimeBin}</string>
    <string>${SERVER_ENTRY}</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(LOGS_DIR, 'tab-out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(LOGS_DIR, 'tab-out.error.log')}</string>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
</dict>
</plist>`;

  fs.writeFileSync(plistFile, plist);
  console.log(`  Wrote Launch Agent: ${plistFile}`);

  // Remove superseded Launch Agents (migration)
  const uid = process.getuid();
  for (const oldName of ['com.mission-control.plist', 'com.tab-out.plist']) {
    const oldPlist = path.join(plistDir, oldName);
    if (fs.existsSync(oldPlist)) {
      try { execSync(`launchctl bootout gui/${uid} "${oldPlist}" 2>/dev/null`, { stdio: 'pipe' }); } catch {}
      fs.unlinkSync(oldPlist);
      console.log(`  Removed old Launch Agent: ${oldName}`);
    }
  }

  // Modern bootstrap — the legacy `launchctl load -w` can leave the agent
  // enabled but never actually loaded into the gui domain.
  try {
    try { execSync(`launchctl bootout gui/${uid}/${label} 2>/dev/null`, { stdio: 'pipe' }); } catch {}
    execSync(`launchctl enable gui/${uid}/${label}`, { stdio: 'pipe' });
    execSync(`launchctl bootstrap gui/${uid} "${plistFile}"`, { stdio: 'inherit' });
    console.log('  Launch Agent bootstrapped — Tab Out will start on login');
  } catch (err) {
    console.warn(`  Warning: launchctl bootstrap failed: ${err.message}`);
    console.warn(`  Run manually: launchctl bootstrap gui/${uid} "${plistFile}"`);
  }
}

// ── Linux: systemd user service ──────────────────────────────────────────────

function installLinux() {
  const serviceDir  = path.join(os.homedir(), '.config', 'systemd', 'user');
  const serviceFile = path.join(serviceDir, 'tab-out.service');

  ensureDir(serviceDir);

  const service = `[Unit]
Description=Tab Out — browser tab dashboard
After=network.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${SERVER_ENTRY}
WorkingDirectory=${PROJECT_DIR}
Restart=always
RestartSec=5
StandardOutput=append:${path.join(LOGS_DIR, 'tab-out.log')}
StandardError=append:${path.join(LOGS_DIR, 'tab-out.error.log')}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(serviceFile, service);
  console.log(`  Wrote systemd service: ${serviceFile}`);

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    execSync('systemctl --user enable tab-out', { stdio: 'pipe' });
    execSync('systemctl --user start tab-out', { stdio: 'pipe' });
    console.log('  systemd service enabled and started — Tab Out will start on login');
  } catch (err) {
    console.warn(`  Warning: systemctl failed: ${err.message}`);
    console.warn('  Run manually:');
    console.warn('    systemctl --user daemon-reload');
    console.warn('    systemctl --user enable tab-out');
    console.warn('    systemctl --user start tab-out');
  }
}

// ── Windows: Startup folder VBS script ───────────────────────────────────────

function installWindows() {
  // Windows Startup folder — programs/scripts here run on login
  const startupDir = path.join(os.homedir(), 'AppData', 'Roaming',
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');

  // Use a VBS wrapper so the server runs without a visible console window
  const vbsFile = path.join(startupDir, 'tab-out.vbs');

  // The VBS script silently runs node in the background
  const vbs = `' Tab Out — auto-start script (runs without visible window)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "${PROJECT_DIR.replace(/\\/g, '\\\\')}"
WshShell.Run """${NODE_BIN.replace(/\\/g, '\\\\')}"" ""${SERVER_ENTRY.replace(/\\/g, '\\\\')}"" > ""${path.join(LOGS_DIR, 'tab-out.log').replace(/\\/g, '\\\\')}"" 2>&1", 0, False
`;

  if (fs.existsSync(startupDir)) {
    fs.writeFileSync(vbsFile, vbs);
    console.log(`  Wrote startup script: ${vbsFile}`);
    console.log('  Tab Out will start automatically on login (no console window)');
  } else {
    // Fallback: try creating a batch file in startup
    console.warn(`  Startup folder not found at: ${startupDir}`);
    const batFile = path.join(PROJECT_DIR, 'start-tab-out.bat');
    const bat = `@echo off\ncd /d "${PROJECT_DIR}"\nstart /b "" "${NODE_BIN}" "${SERVER_ENTRY}"\n`;
    fs.writeFileSync(batFile, bat);
    console.log(`  Created ${batFile} — add this to your startup manually`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const platform = process.platform;
  console.log('\n=== Tab Out — Install ===\n');
  console.log(`Platform: ${platform}`);
  console.log(`Node: ${NODE_BIN}`);
  console.log(`Server: ${SERVER_ENTRY}\n`);

  // Step 1: Data directory
  console.log('1. Data directory');
  ensureDir(CONFIG_DIR);

  // Step 2: Logs directory
  console.log('\n2. Logs directory');
  ensureDir(LOGS_DIR);

  // Step 3: Config file
  console.log('\n3. Config file');
  if (fs.existsSync(CONFIG_FILE)) {
    console.log(`  Exists: ${CONFIG_FILE} (not overwriting)`);
  } else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2), 'utf8');
    console.log(`  Created: ${CONFIG_FILE}`);
    console.log('  Run: npm start');
  }

  // Step 4: Platform-specific auto-start
  console.log('\n4. Auto-start service');
  if (platform === 'darwin') {
    installMacOS();
  } else if (platform === 'linux') {
    installLinux();
  } else if (platform === 'win32') {
    installWindows();
  } else {
    console.warn(`  Unsupported platform: ${platform}`);
    console.warn('  You will need to start the server manually with: npm start');
  }

  console.log('\n=== Installation complete! ===\n');
  console.log(`Config: ${CONFIG_FILE}`);
  console.log(`Logs:   ${LOGS_DIR}`);
  console.log('Start:  npm start');
  console.log('');
}

main();
