const MENU_ID_PREFIX = "open-with-";

const DEFAULT_TARGETS = [
  {
    id: "atlas",
    name: "ChatGPT Atlas",
    endpoint: "/talkWithChatgptAltas",
    shortcut: "ctrl+shift+o"
  },
  {
    id: "dia",
    name: "ChatGPT Dia",
    endpoint: "/talkWithChatgptDia",
    shortcut: "alt+shift+o"
  },
  {
    id: "gemini",
    name: "Gemini (Chrome)",
    endpoint: "/talkWithGemini",
    shortcut: "meta+shift+o"
  }
];

const DEFAULT_SETTINGS = {
  apiBase: "http://localhost:5000",
  targets: DEFAULT_TARGETS,
  clearClipboardAfterUse: true
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

function extractUrlsFromText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  const matches = text.match(/https?:\/\/[^\s<>"'`]+/ig);
  if (!matches) {
    return [];
  }

  const urls = [];
  const seen = new Set();
  for (const match of matches) {
    try {
      const parsed = new URL(match).toString();
      if (!seen.has(parsed)) {
        seen.add(parsed);
        urls.push(parsed);
      }
    } catch (_error) {
      continue;
    }
  }
  return urls;
}

function toHttpUrl(url) {
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeUrlPayload(rawUrls) {
  const values = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
  const normalized = [];
  const seen = new Set();

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const stripped = stripHash(value.trim());
    if (!stripped || seen.has(stripped)) {
      continue;
    }
    seen.add(stripped);
    normalized.push(stripped);
  }

  return normalized;
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

function sanitizeTargetId(value, fallback) {
  const raw = normalizeText(value, fallback).toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function ensureUniqueTargetIds(targets) {
  const seen = new Set();
  return targets.map((target, index) => {
    const base = sanitizeTargetId(target.id, `target-${index + 1}`);
    let id = base;
    let n = 2;
    while (seen.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    seen.add(id);
    return { ...target, id };
  });
}

function normalizeTarget(target, fallback, index) {
  const targetFallback = fallback || {
    id: `target-${index + 1}`,
    name: `Target ${index + 1}`,
    endpoint: "/",
    shortcut: "ctrl+shift+o"
  };
  return {
    id: sanitizeTargetId(target?.id, targetFallback.id),
    name: normalizeText(target?.name, targetFallback.name),
    endpoint: normalizeEndpoint(target?.endpoint, targetFallback.endpoint),
    shortcut: normalizeText(target?.shortcut, targetFallback.shortcut).toLowerCase()
  };
}

function migrateTargetsFromLegacySettings(rawSettings) {
  const legacy = [
    {
      id: "atlas",
      name: "ChatGPT Atlas",
      endpoint: rawSettings?.endpoints?.atlas,
      shortcut: rawSettings?.shortcuts?.atlas
    },
    {
      id: "dia",
      name: "ChatGPT Dia",
      endpoint: rawSettings?.endpoints?.dia,
      shortcut: rawSettings?.shortcuts?.dia
    },
    {
      id: "gemini",
      name: "Gemini (Chrome)",
      endpoint: rawSettings?.endpoints?.gemini,
      shortcut: rawSettings?.shortcuts?.gemini
    }
  ];

  return legacy.map((target, index) => normalizeTarget(target, DEFAULT_TARGETS[index], index));
}

function normalizeTargets(rawSettings) {
  let normalized = [];
  if (Array.isArray(rawSettings?.targets) && rawSettings.targets.length > 0) {
    normalized = rawSettings.targets.map((target, index) =>
      normalizeTarget(target, DEFAULT_TARGETS[index % DEFAULT_TARGETS.length], index)
    );
  } else {
    normalized = migrateTargetsFromLegacySettings(rawSettings || {});
  }
  return ensureUniqueTargetIds(normalized);
}

function normalizeSettings(rawSettings) {
  return {
    apiBase: normalizeApiBase(rawSettings?.apiBase),
    targets: normalizeTargets(rawSettings),
    clearClipboardAfterUse: normalizeBoolean(
      rawSettings?.clearClipboardAfterUse,
      DEFAULT_SETTINGS.clearClipboardAfterUse
    )
  };
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

function findTargetById(settings, id) {
  return settings.targets.find((target) => target.id === id) || null;
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

async function callLocalApi(targetId, rawUrls, settingsOverride = null) {
  const settings = settingsOverride || await getSettings();
  const target = findTargetById(settings, targetId);
  if (!target) {
    throw new Error(`Unknown target: ${targetId}`);
  }

  const urls = normalizeUrlPayload(rawUrls);
  if (urls.length === 0) {
    throw new Error("No valid URL found.");
  }
  const endpointUrl = /^https?:\/\//i.test(target.endpoint)
    ? target.endpoint
    : `${settings.apiBase}${target.endpoint}`;

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({ url: urls.join("*") }).toString()
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

async function recreateContextMenus() {
  const settings = await getSettings();
  chrome.contextMenus.removeAll(() => {
    for (const target of settings.targets) {
      chrome.contextMenus.create({
        id: `${MENU_ID_PREFIX}${target.id}`,
        title: `Open link/current page in ${target.name}`,
        contexts: ["page", "link", "selection"]
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSettings();
  await recreateContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  recreateContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith(MENU_ID_PREFIX)) {
    return;
  }

  const targetId = info.menuItemId.slice(MENU_ID_PREFIX.length);
  const linkUrl = toHttpUrl(info.linkUrl);
  const selectionUrls = extractUrlsFromText(info.selectionText);
  const pageUrl = toHttpUrl(info.pageUrl) || toHttpUrl(tab?.url);
  let chosenUrls = [];
  if (linkUrl) {
    chosenUrls = [linkUrl];
  } else if (selectionUrls.length > 0) {
    chosenUrls = selectionUrls;
  } else if (pageUrl) {
    chosenUrls = [pageUrl];
  }
  if (chosenUrls.length === 0) {
    return;
  }

  try {
    await callLocalApi(targetId, chosenUrls);
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
    (async () => {
      try {
        const normalized = normalizeSettings(message.settings || {});
        await chrome.storage.sync.set({ settings: normalized });
        await recreateContextMenus();
        sendResponse({ ok: true, settings: normalized });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type !== "OPEN_CURRENT_PAGE" || !message?.target) {
    return;
  }

  (async () => {
    try {
      const settings = await getSettings();
      const clickedLinkUrl = toHttpUrl(message.clickedLinkUrl);
      const hoveredLinkUrl = toHttpUrl(message.hoveredLinkUrl);
      const selectedTextUrls = extractUrlsFromText(message.selectedText);
      const clipboardUrls = extractUrlsFromText(message.clipboardText);
      const pageUrl = toHttpUrl(message.url) || toHttpUrl(sender?.tab?.url);
      const hasClipboardBatch = clipboardUrls.length > 1;

      let source = "none";
      let preferredUrls = [];
      if (clickedLinkUrl) {
        source = "clicked-link";
        preferredUrls = [clickedLinkUrl];
      } else if (hasClipboardBatch) {
        source = "clipboard";
        preferredUrls = clipboardUrls;
      } else if (hoveredLinkUrl) {
        source = "hovered-link";
        preferredUrls = [hoveredLinkUrl];
      } else if (selectedTextUrls.length > 0) {
        source = "selected-text";
        preferredUrls = selectedTextUrls;
      } else if (clipboardUrls.length > 0) {
        source = "clipboard";
        preferredUrls = clipboardUrls;
      } else if (pageUrl) {
        source = "page";
        preferredUrls = [pageUrl];
      }

      let urlsToOpen = preferredUrls;
      if (urlsToOpen.length === 0) {
        const fallbackUrl = await getActiveTabUrl();
        urlsToOpen = [fallbackUrl];
      }
      const normalizedUrls = normalizeUrlPayload(urlsToOpen);
      await callLocalApi(message.target, normalizedUrls, settings);
      flashBadge("OK", "#2ea043");
      sendResponse({
        ok: true,
        source,
        urlCount: normalizedUrls.length,
        usedClipboardUrl: source === "clipboard",
        shouldClearClipboard: (
          source === "clipboard" &&
          settings.clearClipboardAfterUse &&
          !message.clipboardClearedByClient
        )
      });
    } catch (error) {
      flashBadge("ERR", "#d1242f");
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});
