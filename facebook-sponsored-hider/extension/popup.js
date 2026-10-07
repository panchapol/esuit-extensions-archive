"use strict";

const toggle = document.getElementById("enabled");
const flashToggle = document.getElementById("prevent-flashes");
const version = chrome.runtime.getManifest().version;
document.getElementById("version").textContent = `v${version}`;
const count = document.getElementById("count");
const status = document.getElementById("status");
const rescan = document.getElementById("rescan");
const contentCount = document.getElementById('content-count');
const filters = globalThis.FbContentFilters;
const filterToggles = new Map();
for (const group of ['Topics', 'Formats', 'Sources']) {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = group;
  fieldset.append(legend);
  for (const definition of filters.definitions.filter(item => item.group === group)) {
    const label = document.createElement('label');
    label.className = 'setting filter-setting';
    const span = document.createElement('span');
    span.textContent = definition.label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = definition.key;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', `Hide ${definition.label}`);
    input.disabled = true;
    label.append(span, input);
    fieldset.append(label);
    filterToggles.set(definition.key, input);
    input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        await chrome.storage.local.set({ [definition.key]: input.checked });
        await refresh();
      } catch {
        input.checked = !input.checked;
        status.textContent = 'Could not save the setting. Please try again.';
      } finally { input.disabled = false; }
    });
  }
  document.getElementById('filters').append(fieldset);
}
let tabId;

async function refresh(type = "getStatus") {
  try {
    if (tabId === undefined) throw new Error("No active tab");
    const result = await chrome.tabs.sendMessage(tabId, { type });
    if (!result?.ready) throw new Error("Content script not ready");
    if (result.version !== version) {
      count.textContent = "—";
      contentCount.textContent = '—';
      status.textContent = `Refresh Facebook to apply v${version}. This tab is using an older build.`;
      rescan.disabled = true;
      return;
    }
    count.textContent = String(result.hiddenCount);
    contentCount.textContent = String(result.contentCount);
    status.textContent = result.enabled ? `${result.feedCount} feed ads · ${result.sidebarCount} sponsored sections hidden.${result.pendingCount ? ` ${result.pendingCount} posts waiting for labels.` : ""}` : (result.filtersActive ? 'Ad hiding is off. Your content filters are active.' : 'All hiding is off.');
    rescan.disabled = !result.enabled && !result.filtersActive;
  } catch {
    count.textContent = "—";
    contentCount.textContent = '—';
    status.textContent = "Open Facebook in this tab, then refresh the page if you just installed the extension.";
    rescan.disabled = true;
  }
}

toggle.addEventListener("change", async () => {
  toggle.disabled = true;
  try {
    await chrome.storage.local.set({ enabled: toggle.checked });
    await refresh();
  } catch {
    toggle.checked = !toggle.checked;
    status.textContent = "Could not save the setting. Please try again.";
  } finally {
    toggle.disabled = false;
  }
});
flashToggle.addEventListener("change", async () => {
  flashToggle.disabled = true;
  try {
    await chrome.storage.local.set({ preventFlashes: flashToggle.checked });
    await refresh();
  } catch {
    flashToggle.checked = !flashToggle.checked;
    status.textContent = "Could not save the setting. Please try again.";
  } finally { flashToggle.disabled = false; }
});
rescan.addEventListener("click", () => refresh("rescan"));

async function initialize() {
  try {
    const settings = await chrome.storage.local.get({ enabled: true, preventFlashes: true, ...filters.defaults });
    for (const [key, input] of filterToggles) {
      input.checked = settings[key] === true;
      input.disabled = false;
    }
    toggle.checked = settings.enabled !== false;
    toggle.disabled = false;
    flashToggle.checked = settings.preventFlashes !== false;
    flashToggle.disabled = false;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    await refresh();
  } catch {
    status.textContent = "Could not load settings. Reopen this popup to try again.";
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ['enabled', 'preventFlashes', ...filterToggles.keys()].some(key => changes[key])) {
    for (const [key, input] of filterToggles) if (changes[key]) input.checked = changes[key].newValue === true;
    if (changes.enabled) toggle.checked = changes.enabled.newValue !== false;
    if (changes.preventFlashes) flashToggle.checked = changes.preventFlashes.newValue !== false;
    refresh();
  }
});
initialize();
setInterval(refresh, 1000);
