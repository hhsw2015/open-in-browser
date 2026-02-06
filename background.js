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

async function callLocalApi(targetId, rawUrl, settingsOverride = null) {
  const settings = settingsOverride || await getSettings();
  const target = findTargetById(settings, targetId);
  if (!target) {
    throw new Error(`Unknown target: ${targetId}`);
  }

  const url = stripHash(rawUrl);
  const endpointUrl = /^https?:\/\//i.test(target.endpoint)
    ? target.endpoint
    : `${settings.apiBase}${target.endpoint}`;

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
  const selectionUrl = extractFirstUrl(info.selectionText);
  const pageUrl = toHttpUrl(info.pageUrl) || toHttpUrl(tab?.url);
  const chosenUrl = linkUrl || selectionUrl || pageUrl;
  if (!chosenUrl) {
    return;
  }

  try {
    await callLocalApi(targetId, chosenUrl);
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
      const selectedTextUrl = extractFirstUrl(message.selectedText);
      const clipboardUrl = extractFirstUrl(message.clipboardText);
      const pageUrl = toHttpUrl(message.url) || toHttpUrl(sender?.tab?.url);

      let source = "none";
      let preferredUrl = null;
      if (clickedLinkUrl) {
        source = "clicked-link";
        preferredUrl = clickedLinkUrl;
      } else if (hoveredLinkUrl) {
        source = "hovered-link";
        preferredUrl = hoveredLinkUrl;
      } else if (selectedTextUrl) {
        source = "selected-text";
        preferredUrl = selectedTextUrl;
      } else if (clipboardUrl) {
        source = "clipboard";
        preferredUrl = clipboardUrl;
      } else if (pageUrl) {
        source = "page";
        preferredUrl = pageUrl;
      }

      const urlToOpen = preferredUrl || await getActiveTabUrl();
      await callLocalApi(message.target, urlToOpen, settings);
      flashBadge("OK", "#2ea043");
      sendResponse({
        ok: true,
        source,
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
