// Part of the Tab Out dashboard. Loaded as an ordered classic script
// (shared global scope) after the earlier js/ parts. See index.html.

/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
renderDashboard();
checkForUpdates();

/* ----------------------------------------------------------------
   HISTORY BACKFILL HOOK — listen for the new-tab page telling us
   it just finished aggregating chrome.history into daily_stats, and
   refresh the heatmap so the user sees the populated calendar
   without having to open another tab.
   ---------------------------------------------------------------- */
window.addEventListener('message', async (event) => {
  const data = event.data || {};
  if (data.type !== 'historyBackfillComplete') return;
  try {
    await fetchHeatmap();
    renderHeatmap();
  } catch { /* heatmap may be hidden in settings — ignore */ }
});

/* ----------------------------------------------------------------
   AUTO-REFRESH — refresh dynamic content every 30 seconds

   Re-fetches open tabs from the extension and re-renders tab cards,
   stats, quote, and the saved-for-later list. Does NOT re-initialize
   static UI (clock, dark mode, settings panel, pomodoro) so no
   event listeners are duplicated and timer state is preserved.
   ---------------------------------------------------------------- */
// Auto-refresh is now driven by applyAutoRefreshInterval() so it can be
// retuned (or disabled) from the settings panel.

// Refresh the moment the tab regains focus — catches reopened tabs being
// auto-removed from Saved for Later without waiting for the timer.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDynamicContent();
});
