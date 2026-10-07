(() => {
  "use strict";

  const detector = globalThis.FbSponsoredDetector;
  const ATTRIBUTE = "data-fb-sponsored-hider";
  const hidden = new Set();
  const filtered = new Set();
  const filters = globalThis.FbContentFilters;
  let filterSettings = { ...filters.defaults };
  const previousMatches = new WeakMap();
  const active = () => enabled || filters.active(filterSettings);
  const sidebarHidden = new Set();
  const pending = new Set();
  const waiting = new Set();
  const knownAds = new WeakSet();
  const collapsedSlots = new Map();
  const waitState = new WeakMap();
  const nearViewport = new WeakMap();
  const MAX_WAIT_MS = 1500;
  let waitTimer;
  const version = chrome.runtime.getManifest().version;
  let enabled = false;
  let preventFlashes = true;
  let scheduled = false;
  let ready = false;
  let preferenceFailed = false;
  let observer;

  function releaseSlot(post) {
    collapsedSlots.get(post)?.removeAttribute('data-fb-sponsored-hider-slot');
    collapsedSlots.delete(post);
  }

  function hide(post, matches = null) {
    post.setAttribute(ATTRIBUTE, "hidden");
    if (matches) {
      filtered.add(post);
      hidden.delete(post);
      previousMatches.set(post, matches);
    } else {
      hidden.add(post);
      filtered.delete(post);
      knownAds.add(post);
    }
    waiting.delete(post);
    const slot = detector.collapseTarget(post);
    slot.setAttribute('data-fb-sponsored-hider-slot', 'collapsed');
    collapsedSlots.set(post, slot);
  }

  function restore(post) {
    releaseSlot(post);
    post.setAttribute(ATTRIBUTE, "visible");
    hidden.delete(post);
    filtered.delete(post);
    waiting.delete(post);
  }

  function syncRootState() {
    const gate = ready ? (enabled && preventFlashes ? "on" : "off") : (preferenceFailed ? "off" : "loading");
    document.documentElement?.setAttribute("data-fb-sponsored-hider-gate", gate);
    document.documentElement?.setAttribute("data-fb-sponsored-hider-version", version);
  }

  function scan(post) {
    if (!post.isConnected) {
      releaseSlot(post);
      post.removeAttribute(ATTRIBUTE);
      hidden.delete(post);
      filtered.delete(post);
      waiting.delete(post);
      return;
    }
    releaseSlot(post);
    // Recycled containers must be checked again with their layout temporarily restored.
    post.setAttribute(ATTRIBUTE, "checking");
    if (!detector.isTopLevelPost(post)) { restore(post); return; }
    if (!nearViewport.has(post)) {
      const rect = post.getBoundingClientRect();
      nearViewport.set(post, rect.bottom >= -200 && rect.top <= innerHeight + 600);
    }
    const placeholder = detector.isVirtualPlaceholder(post);
    const matches = filters.active(filterSettings) ? (placeholder ? previousMatches.get(post) || [] : filters.classify(post)) : [];
    if (!placeholder) previousMatches.set(post, matches);
    const sponsored = detector.isSponsored(post);
    if (!placeholder && !sponsored) knownAds.delete(post);
    if (enabled && ((knownAds.has(post) && placeholder) || sponsored)) {
      hide(post);
    } else if (matches.some(key => filterSettings[key] === true)) {
      hide(post, matches);
    } else {
      filtered.delete(post);
      if (!detector.isVirtualPlaceholder(post)) knownAds.delete(post);
      // Reset the bounded wait only when content/label identity changes, not for
      // our own attributes, recurring style mutations, or manual rescans.
      const signature = post.textContent.slice(0, 1024) + Array.from(post.querySelectorAll('[aria-labelledby]'))
        .map((label) => label.getAttribute('aria-labelledby')).join('|') +
        post.getAttribute('data-fb-sponsored-hider-data');
      let state = waitState.get(post);
      if (!state || state.signature !== signature) {
        state = { signature, deadline: performance.now() + MAX_WAIT_MS };
        waitState.set(post, state);
      }
      if (enabled && preventFlashes && detector.isTopLevelPost(post) &&
          !detector.isNonPostUnit(post) && !detector.hasOrdinaryMetadata(post) && performance.now() < state.deadline) {
        hidden.delete(post);
        waiting.add(post);
        post.setAttribute(ATTRIBUTE, "pending");
      } else restore(post);
    }
  }

  function scheduleWaitExpiry() {
    clearTimeout(waitTimer);
    if (!waiting.size) return;
    const deadline = Math.min(...Array.from(waiting, (post) => waitState.get(post).deadline));
    waitTimer = setTimeout(() => {
      for (const post of waiting) pending.add(post);
      schedule();
    }, Math.max(1, deadline - performance.now()));
  }

  function flush() {
    scheduled = false;
    // Do not observe our own hide/restore attributes or generate an endless rescan loop.
    observer.disconnect();
    try {
      syncRootState();
      for (const post of [...hidden, ...filtered]) if (!post.isConnected) restore(post);
      for (const post of waiting) if (!post.isConnected) restore(post);
      for (const post of pending) scan(post);
      pending.clear();
      for (const section of sidebarHidden) section.removeAttribute(ATTRIBUTE);
      sidebarHidden.clear();
      if (enabled) {
        for (const section of detector.sponsoredSections()) {
          section.setAttribute(ATTRIBUTE, "hidden");
          sidebarHidden.add(section);
        }
      }
    } finally {
      scheduleWaitExpiry();
      observe();
    }
  }

  function schedule() {
    if (ready && !scheduled) {
      scheduled = true;
      // MutationObserver + microtask runs before rendering, without a timer delay.
      queueMicrotask(() => { if (scheduled) flush(); });
    }
  }

  function collectReference(id) {
    if (!id) return;
    for (const owner of document.querySelectorAll(`[aria-labelledby~="${CSS.escape(id)}"]`)) {
      const post = detector.topPost(owner);
      if (post) pending.add(post);
    }
  }

  function collect(element) {
    if (!(element instanceof Element)) return;
    const containing = detector.topPost(element);
    if (containing) pending.add(containing);
    for (const post of element.querySelectorAll(detector.POST_SELECTOR)) {
      if (detector.isTopLevelPost(post)) pending.add(post);
      else if (!post.hasAttribute(ATTRIBUTE)) post.setAttribute(ATTRIBUTE, "visible");
    }
    if (element.matches(detector.POST_SELECTOR) && !detector.isTopLevelPost(element) && !element.hasAttribute(ATTRIBUTE)) element.setAttribute(ATTRIBUTE, "visible");
    // Some current Facebook labels point to text elsewhere via aria-labelledby.
    // Follow DOM references when that text changes; never fetch page content.
    let reference = element;
    for (let depth = 0; reference && depth < 16; depth++, reference = reference.parentElement) {
      if (!reference.id) continue;
      collectReference(reference.id);
    }
    schedule();
  }

  function rescan() {
    collect(document.documentElement);
    flush();
  }

  function checkViewport() {
    if (!ready || !active()) return;
    for (const post of document.querySelectorAll(detector.POST_SELECTOR)) {
      if (!detector.isTopLevelPost(post) || detector.isVirtualPlaceholder(post)) continue;
      const rect = post.getBoundingClientRect();
      const near = rect.bottom >= -200 && rect.top <= innerHeight + 600;
      const wasNear = nearViewport.get(post);
      nearViewport.set(post, near);
      if (!near) continue;
      if (wasNear === false) {
        const state = waitState.get(post);
        if (state) state.deadline = performance.now() + MAX_WAIT_MS;
      }
      pending.add(post);
    }
    schedule();
  }

  document.addEventListener('scroll', checkViewport, { passive: true, capture: true });
  window.addEventListener('resize', checkViewport, { passive: true });
  // Intrinsic media dimensions can arrive without a DOM attribute mutation.
  document.addEventListener('load', event => { if (active() && event.target instanceof Element && event.target.matches('img, video')) collect(event.target); }, true);
  document.addEventListener('loadedmetadata', event => { if (active() && event.target instanceof Element && event.target.matches('video')) collect(event.target); }, true);

  function observe() {
    // At document_start the document element may not exist yet.
    observer.observe(document, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
      attributeFilter: ["aria-label", "aria-labelledby", "title", "class", "style", "hidden", "role", "data-pagelet", "data-virtualized", "data-fb-sponsored-hider-data", "id", "href", "src", "alt", "width", "height"]
    });
  }

  observer = new MutationObserver((records) => {
    // Stored preferences can resolve before <html> exists at document_start.
    syncRootState();
    if (!active()) return;
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (record.type === "childList") {
        const post = target && detector.topPost(target);
        if (post) pending.add(post);
        else if (target) collect(target);
        for (const node of record.addedNodes) {
          collect(node);
          // Facebook may insert an entire label portal rather than the label
          // itself. References can occur anywhere inside that added subtree.
          if (node instanceof Element) for (const reference of node.querySelectorAll('[id]')) collectReference(reference.id);
        }
        // Removed accessible label nodes may belong to a portal outside the post.
        for (const node of record.removedNodes) {
          if (node instanceof Element) {
            collectReference(node.id);
            for (const reference of node.querySelectorAll('[id]')) collectReference(reference.id);
          }
        }
        // Feed removal must also prune the hidden count.
        if (record.removedNodes.length) schedule();
      } else if (target) {
        // Ancestor visibility/class changes can change a whole collection of labels.
        collect(target);
        if (record.attributeName === "id") collectReference(record.oldValue);
      }
    }
    schedule();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !["enabled", "preventFlashes", ...Object.keys(filters.defaults)].some(key => changes[key])) return;
    for (const key of Object.keys(filters.defaults)) if (changes[key]) filterSettings[key] = changes[key].newValue === true;
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.preventFlashes) preventFlashes = changes.preventFlashes.newValue !== false;
    if (ready) {
      if (active()) rescan();
      else {
        observer.disconnect();
        for (const post of [...hidden, ...filtered]) restore(post);
        for (const post of waiting) restore(post);
        for (const section of sidebarHidden) section.removeAttribute(ATTRIBUTE);
        sidebarHidden.clear();
        pending.clear();
        clearTimeout(waitTimer);
        syncRootState();
        observe();
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!message || !["getStatus", "rescan"].includes(message.type)) return;
    if (message.type === "rescan" && ready) rescan();
    for (const post of hidden) if (!post.isConnected) { releaseSlot(post); hidden.delete(post); }
    for (const post of filtered) if (!post.isConnected) { releaseSlot(post); filtered.delete(post); }
    for (const section of sidebarHidden) if (!section.isConnected) sidebarHidden.delete(section);
    for (const post of waiting) if (!post.isConnected) waiting.delete(post);
    respond({ enabled, preventFlashes, contentCount: filtered.size, filtersActive: filters.active(filterSettings), hiddenCount: hidden.size + sidebarHidden.size, feedCount: hidden.size, sidebarCount: sidebarHidden.size, pendingCount: waiting.size, version, ready });
  });

  document.addEventListener("DOMContentLoaded", syncRootState, { once: true });

  chrome.storage.local.get({ enabled: true, preventFlashes: true, ...filters.defaults }).then((settings) => {
    filterSettings = Object.fromEntries(Object.keys(filters.defaults).map(key => [key, settings[key] === true]));
    enabled = settings.enabled !== false;
    preventFlashes = settings.preventFlashes !== false;
    ready = true;
    observe();
    syncRootState();
    if (active()) rescan();
  }).catch(() => {
    // Leave the page intact if preferences cannot be read (e.g. extension reloaded).
    ready = false;
    preferenceFailed = true;
    syncRootState();
  });
})();
