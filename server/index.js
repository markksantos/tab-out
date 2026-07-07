// server/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Main entry point for the Tab Out server.
// Serves the dashboard and API routes on localhost.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const path    = require('path');
const config  = require('./config');
const { startUpdateChecker } = require('./updater');

const app = express();

// CORS: the dashboard itself is same-origin (no Origin header on its
// fetches), so cross-origin callers are only the extension's own pages.
// Allow exactly: our own localhost origin, and ONE chrome-extension origin —
// pinned on first use and persisted to config.json (delete `extensionOrigin`
// there to re-pin after reinstalling the extension). Everything else gets a
// 403 so a random local page or rogue extension can't read or mutate state.
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  let allowed = false;
  if (!origin) {
    allowed = true; // same-origin fetches, curl, extension service worker on some Chrome versions
  } else if (origin === `http://localhost:${config.port}` || origin === `http://127.0.0.1:${config.port}`) {
    allowed = true;
  } else if (origin.startsWith('chrome-extension://')) {
    if (!config.extensionOrigin) {
      config.save({ extensionOrigin: origin });
      console.log(`[cors] Pinned extension origin: ${origin}`);
      allowed = true;
    } else {
      allowed = origin === config.extensionOrigin;
    }
  }
  if (!allowed) {
    console.warn(`[cors] Blocked request from origin: ${origin}`);
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Parse JSON request bodies (for POST endpoints)
app.use(express.json());

// Serve the dashboard's static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

// Mount API routes under /api
const apiRouter = require('./routes');
app.use('/api', apiRouter);

// Start the server — loopback only; nothing here belongs on the LAN.
app.listen(config.port, '127.0.0.1', () => {
  console.log(`Tab Out running at http://localhost:${config.port}`);
  startUpdateChecker();
});
