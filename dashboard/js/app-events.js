// Part of the Tab Out dashboard. Loaded as an ordered classic script
// (shared global scope) after the earlier js/ parts. See index.html.

/* ----------------------------------------------------------------
   EVENT HANDLERS (using event delegation)

   Instead of attaching a listener to every button, we attach ONE
   listener to the whole document and check what was clicked.
   This is more efficient and works even after we re-render cards.

   Think of it like one security guard watching the whole building
   instead of one guard per door.
   ---------------------------------------------------------------- */

// Intercept clicks on saved/closed/archive title links when the user has
// opted into background opens. Runs in the capture phase so we beat the
// browser's default navigation. Modifier-clicks (cmd/ctrl/middle) pass
// through unchanged so the user can still force a specific behavior.
document.addEventListener('click', (e) => {
  if (!getOpenInBackground()) return;
  const link = e.target.closest('.deferred-title, .archive-item-title');
  if (!link) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  const url = link.getAttribute('href');
  if (!url) return;
  e.preventDefault();
  e.stopPropagation();
  sendToExtension('openTabs', { urls: [url] });
}, true);

document.addEventListener('click', async (e) => {
  // Walk up the DOM from the clicked element to find the nearest
  // element with a data-action attribute
  const actionEl = e.target.closest('[data-action]');

  if (!actionEl) return; // click wasn't on an action button

  const action = actionEl.dataset.action;
  const missionId = actionEl.dataset.missionId;

  // --- Pomodoro controls ---
  if (action === 'pomodoro-toggle') {
    if (pomodoroState.running) { pausePomodoro(); } else { startPomodoro(); }
    return;
  }
  if (action === 'pomodoro-reset') {
    resetPomodoro();
    return;
  }

  // --- Clear recently closed ---
  if (action === 'clear-recently-closed') {
    localStorage.removeItem('tabout-recently-closed');
    renderRecentlyClosed();
    showToast('Cleared recently closed tabs');
    return;
  }

  // --- Sessions ---
  if (action === 'save-session') {
    await saveCurrentSession();
    return;
  }
  if (action === 'sweep-stale') {
    openSweepModal();
    return;
  }
  if (action === 'sweep-domain') {
    await sweepDomain(actionEl.dataset.domainId);
    return;
  }
  if (action === 'toggle-card') {
    toggleCardCollapsed(actionEl.dataset.domainId);
    return;
  }
  if (action === 'edit-note') {
    await editTabNote(actionEl.dataset.tabUrl);
    return;
  }
  if (action === 'snooze-tab') {
    await snoozeTab(actionEl.dataset.tabUrl, actionEl.dataset.tabTitle);
    return;
  }
  if (action === 'unsnooze-now') {
    await unsnoozeNow(actionEl.dataset.snoozeId);
    return;
  }
  if (action === 'cancel-snooze') {
    await cancelSnooze(actionEl.dataset.snoozeId);
    return;
  }
  if (action === 'workspace-tab') {
    currentWorkspace = actionEl.dataset.workspace;
    renderSessions();
    return;
  }
  if (action === 'rename-workspace') {
    await renameWorkspace(actionEl.dataset.sessionId);
    return;
  }
  if (action === 'new-workspace') {
    const name = (prompt('Workspace name:') || '').trim();
    if (name) {
      currentWorkspace = name.slice(0, 50);
      renderSessions();
    }
    return;
  }
  if (action === 'suggest-save') {
    const host = actionEl.dataset.suggestHost;
    const tabs = getRealTabs().filter(t => {
      try { return new URL(t.url).hostname === host; } catch { return false; }
    });
    if (tabs.length === 0) return;
    const name = (prompt(`Name this ${host.replace(/^www\./, '')} session:`, host.replace(/^www\./, '')) || '').trim();
    if (!name) return;
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          workspace: currentWorkspace,
          tabs: tabs.map(t => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl })),
        }),
      });
      await fetchSessions();
      renderSessions();
      const banner = document.getElementById('suggestBanner');
      if (banner) banner.style.display = 'none';
      showToast(`Saved "${name}"`);
    } catch { showToast('Failed to save'); }
    return;
  }
  if (action === 'suggest-dismiss') {
    const host = actionEl.dataset.suggestHost;
    const dismissed = new Set((sessionStorage.getItem('tabout-suggest-dismissed') || '').split(','));
    dismissed.add(host);
    sessionStorage.setItem('tabout-suggest-dismissed', [...dismissed].join(','));
    const banner = document.getElementById('suggestBanner');
    if (banner) banner.style.display = 'none';
    return;
  }
  if (action === 'restore-session') {
    await restoreSession(actionEl.dataset.sessionId);
    return;
  }
  if (action === 'switch-session') {
    await switchToSession(actionEl.dataset.sessionId);
    return;
  }
  if (action === 'delete-session') {
    await deleteSession(actionEl.dataset.sessionId);
    return;
  }

  // --- Close duplicate Tab Out tabs ---
  if (action === 'close-tabout-dupes') {
    await sendToExtension('closeTabOutDupes');
    await fetchOpenTabs();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  // Find the card element so we can animate it
  const card = actionEl.closest('.mission-card');

  // ---- expand-chips: show the hidden tabs in a card ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- focus-tab: switch to a specific open tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) {
      await sendToExtension('focusTab', { url: tabUrl });
    }
    return;
  }

  // ---- close-single-tab: close one specific tab by URL ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger the parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    const chip = actionEl.closest('.page-chip');
    const chipTitle = chip ? (chip.querySelector('.chip-text')?.textContent || tabUrl) : tabUrl;
    saveToRecentlyClosed(tabUrl, chipTitle);
    await sendToExtension('closeTabs', { urls: [tabUrl] });
    playCloseSound();
    await fetchOpenTabs();
    showToast(`Closed "${chipTitle}"`, {
      undo: async () => {
        await sendToExtension('openTabs', { urls: [tabUrl] });
        showToast('Tab restored');
        setTimeout(() => refreshDynamicContent(), 200);
      },
    });

    // Remove the chip from the DOM with confetti
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If this was the last tab in the card, remove the whole card
        const card = document.querySelector(`.mission-card:has(.mission-pages:empty)`);
        if (card) {
          animateCardOut(card);
        }
        // Also check for cards where only overflow/non-tab chips remain
        document.querySelectorAll('.mission-card').forEach(c => {
          const remainingTabs = c.querySelectorAll('.page-chip[data-action="focus-tab"]');
          if (remainingTabs.length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    showToast('Tab closed');
    renderRecentlyClosed();
    return;
  }

  // ---- defer-single-tab: save one tab for later, then close it ----
  if (action === 'defer-single-tab') {
    e.stopPropagation(); // don't trigger the parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to the deferred list on the server
    try {
      await fetch('/api/defer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs: [{ url: tabUrl, title: tabTitle }] }),
      });
    } catch (err) {
      console.error('[tab-out] Failed to defer tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in the browser
    await sendToExtension('closeTabs', { urls: [tabUrl] });
    await fetchOpenTabs();

    // Animate the chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    // Refresh the deferred column to show the new item
    await renderDeferredColumn();
    return;
  }

  // ---- check-deferred: check off a deferred tab (mark as read) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    try {
      await fetch(`/api/deferred/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked: true }),
      });
    } catch (err) {
      console.error('[tab-out] Failed to check deferred tab:', err);
      return;
    }

    // Animate the item: add strikethrough, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh to update counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- dismiss-deferred: dismiss a deferred tab without reading ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    try {
      await fetch(`/api/deferred/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      });
    } catch (err) {
      console.error('[tab-out] Failed to dismiss deferred tab:', err);
      return;
    }

    // Animate the item out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn(); // refresh counts and archive
      }, 300);
    }
    return;
  }

  // ---- close-domain-tabs: close all tabs in a static domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    // Find the group by its stable ID
    const group = domainGroups.find(g => {
      const id = 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-');
      return id === domainId;
    });
    if (!group) return;

    const urls = group.tabs.map(t => t.url);
    group.tabs.forEach(t => saveToRecentlyClosed(t.url, t.title || t.url));
    // Use exact URL matching for landing pages (share domains with content tabs)
    const useExact = group.domain === '__landing-pages__';
    await sendToExtension('closeTabs', { urls, exact: useExact });
    await fetchOpenTabs();

    // Animate the card out
    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory domain groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : friendlyDomain(group.domain);
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);
    renderRecentlyClosed();

    // Update footer tab count
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- close-all-dupes: close every duplicate tab ----

  // ---- dedup-keep-one: close extras but keep one copy of each ----
  if (action === 'dedup-keep-one') {
    // URLs come from the button's data attribute (per-mission duplicates)
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await sendToExtension('closeDuplicates', { urls, keepOne: true });
    playCloseSound();
    await fetchOpenTabs();

    // Remove the dupe button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove all (2x) badges and the "N duplicates" header badge from this card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity = '0';
        setTimeout(() => b.remove(), 200);
      });
      // Remove the amber "N duplicates" badge from the card header
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      // Remove amber highlight from the card border
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
      const statusBar = card.querySelector('.status-bar');
      if (statusBar) statusBar.style.background = '';
    }

    showToast(`Closed duplicates, kept one copy each`);
    return;
  }

  // ---- close-all-open-tabs: close every open tab ----
  if (action === 'close-all-open-tabs') {
    // Use the actual openTabs list from the extension — works regardless of
    // close all domain-grouped tabs
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    // Animate all cards out
    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }

  // ---- close-uncat: close uncategorized tabs by domain ----
  else if (action === 'close-uncat') {
    const domain = actionEl.dataset.domain;
    if (!domain) return;

    // Find all open tabs matching this domain and close them
    const tabsToClose = openTabs.filter(t => {
      try { return new URL(t.url).hostname === domain; }
      catch { return false; }
    });
    const urls = tabsToClose.map(t => t.url);
    await closeTabsByUrls(urls);

    // Animate card removal
    if (card) {
      playCloseSound();
      animateCardOut(card);
    }
    showToast(`Closed ${tabsToClose.length} tab${tabsToClose.length !== 1 ? 's' : ''} from ${domain}`);

  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Recently closed toggle — expand/collapse ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#recentlyClosedToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('recentlyClosedBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  if (q.length < 2) {
    // Reset archive list to show all archived items without re-rendering the whole column
    try {
      const res = await fetch('/api/deferred');
      if (res.ok) {
        const data = await res.json();
        archiveList.innerHTML = (data.archived || []).map(item => renderArchiveItem(item)).join('');
      }
    } catch { }
    return;
  }

  try {
    const res = await fetch(`/api/deferred/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const data = await res.json();
    archiveList.innerHTML = (data.results || []).map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   ACTION HELPERS
   ---------------------------------------------------------------- */

/* ----------------------------------------------------------------
   UPDATE NOTIFICATION (read-only, no code execution)
   ---------------------------------------------------------------- */
async function checkForUpdates() {
  try {
    const res = await fetch('/api/update-status');
    if (!res.ok) return;
    const { updateAvailable } = await res.json();
    if (!updateAvailable) return;

    // Show a simple text notification at the bottom
    const dashboardColumns = document.getElementById('dashboardColumns');
    if (!dashboardColumns) return;
    const notice = document.createElement('div');
    notice.style.cssText = 'text-align:center; padding:8px; font-size:12px; color:var(--muted); margin-top:24px;';
    notice.innerHTML = 'A new version of Tab Out is available. Run <code style="background:var(--warm-gray);padding:2px 6px;border-radius:3px;font-size:11px;user-select:all;cursor:pointer;" title="Click to select">git pull</code> in the tab-out folder to update.';
    dashboardColumns.after(notice);
  } catch { }
}
