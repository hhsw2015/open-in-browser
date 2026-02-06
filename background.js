const DEFAULT_SETTINGS = {
  apiBase: "http://localhost:5000",
  endpoints: {
    atlas: "/talkWithChatgptAltas",
    dia: "/talkWithChatgptDia",
    gemini: "/talkWithGemini"
  },
  shortcuts: {
    atlas: "ctrl+shift+o",
    dia: "alt+shift+o",
    gemini: "meta+shift+o"
  },
  clearClipboardAfterUse: true
};

const TARGETS = {
  atlas: { menuTitle: "Open current page in ChatGPT Atlas" },
  dia: { menuTitle: "Open current page in ChatGPT Dia" },
  gemini: { menuTitle: "Open current page in Gemini (Chrome)" }
};

let badgeClearTimer = null;

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  if (badgeClearTimer) {
    clearTimeout(badgeClearTimer);
  }
  badgeClearTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, 1800);
}

function stripHash(url) {
  const hashIndex = url.indexOf("#");
  return hashIndex === -1 ? url : url.slice(0, hashIndex);
}

function extractFirstUrl(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  const match = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match) {
    return null;
  }

  try {
    return new URL(match[0]).toString();
  } catch (_error) {
    return null;
  }
}

function normalizeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeEndpoint(value, fallback) {
  const raw = normalizeText(value, fallback);
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function normalizeApiBase(value) {
  const raw = normalizeText(value, DEFAULT_SETTINGS.apiBase);
  return raw.replace(/\/+$/, "");
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function normalizeSettings(rawSettings) {
  const merged = {
    apiBase: normalizeApiBase(rawSettings?.apiBase),
    endpoints: {
      atlas: normalizeEndpoint(rawSettings?.endpoints?.atlas, DEFAULT_SETTINGS.endpoints.atlas),
      dia: normalizeEndpoint(rawSettings?.endpoints?.dia, DEFAULT_SETTINGS.endpoints.dia),
      gemini: normalizeEndpoint(rawSettings?.endpoints?.gemini, DEFAULT_SETTINGS.endpoints.gemini)
    },
    shortcuts: {
      atlas: normalizeText(rawSettings?.shortcuts?.atlas, DEFAULT_SETTINGS.shortcuts.atlas).toLowerCase(),
      dia: normalizeText(rawSettings?.shortcuts?.dia, DEFAULT_SETTINGS.shortcuts.dia).toLowerCase(),
      gemini: normalizeText(rawSettings?.shortcuts?.gemini, DEFAULT_SETTINGS.shortcuts.gemini).toLowerCase()
    },
    clearClipboardAfterUse: normalizeBoolean(
      rawSettings?.clearClipboardAfterUse,
      DEFAULT_SETTINGS.clearClipboardAfterUse
    )
  };
  return merged;
}

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return normalizeSettings(settings || {});
}

async function ensureSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  const normalized = normalizeSettings(settings || {});
  if (JSON.stringify(settings || {}) !== JSON.stringify(normalized)) {
    await chrome.storage.sync.set({ settings: normalized });
  }
  return normalized;
}

function getActiveTabUrl() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const tab = tabs[0];
      if (!tab || !tab.url) {
        reject(new Error("No active tab URL found."));
        return;
      }
      resolve(tab.url);
    });
  });
}

async function callLocalApi(targetKey, rawUrl, settingsOverride = null) {
  const settings = settingsOverride || await getSettings();
  const endpoint = settings.endpoints[targetKey];
  if (!endpoint) {
    throw new Error(`Unknown target: ${targetKey}`);
  }

  const url = stripHash(rawUrl);
  const endpointUrl = /^https?:\/\//i.test(endpoint)
    ? endpoint
    : `${settings.apiBase}${endpoint}`;

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({ url }).toString()
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

function recreateContextMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const [key, config] of Object.entries(TARGETS)) {
      chrome.contextMenus.create({
        id: `open-with-${key}`,
        title: config.menuTitle,
        contexts: ["page"]
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSettings();
  recreateContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  recreateContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith("open-with-")) {
    return;
  }

  const target = info.menuItemId.replace("open-with-", "");
  const pageUrl = info.pageUrl || tab?.url;
  if (!pageUrl) {
    return;
  }

  try {
    await callLocalApi(target, pageUrl);
    flashBadge("OK", "#2ea043");
  } catch (error) {
    flashBadge("ERR", "#d1242f");
    console.error("Failed to open page:", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SAVE_SETTINGS") {
    const normalized = normalizeSettings(message.settings || {});
    chrome.storage.sync.set({ settings: normalized })
      .then(() => sendResponse({ ok: true, settings: normalized }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type !== "OPEN_CURRENT_PAGE" || !message?.target) {
    return;
  }

  (async () => {
    try {
      const settings = await getSettings();
      const clipboardUrl = extractFirstUrl(message.clipboardText);
      const preferredUrl = clipboardUrl || message.url || sender?.tab?.url;
      const urlToOpen = preferredUrl || await getActiveTabUrl();
      await callLocalApi(message.target, urlToOpen, settings);
      flashBadge("OK", "#2ea043");
      sendResponse({
        ok: true,
        usedClipboardUrl: Boolean(clipboardUrl),
        shouldClearClipboard: Boolean(clipboardUrl) && settings.clearClipboardAfterUse
      });
    } catch (error) {
      flashBadge("ERR", "#d1242f");
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});
