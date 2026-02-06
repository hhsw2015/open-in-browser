(function () {
  const TOAST_ID = "__open_in_browser_toast";
  const TARGET_KEYS = ["atlas", "dia", "gemini"];
  const DEFAULT_SHORTCUTS = {
    atlas: "ctrl+shift+o",
    dia: "alt+shift+o",
    gemini: "meta+shift+o"
  };
  const DEFAULT_CLEAR_CLIPBOARD_AFTER_USE = true;

  let activeShortcuts = {};
  let activeClearClipboardAfterUse = DEFAULT_CLEAR_CLIPBOARD_AFTER_USE;
  let toastTimer = null;

  function getToastEl() {
    let el = document.getElementById(TOAST_ID);
    if (el) {
      return el;
    }
    el = document.createElement("div");
    el.id = TOAST_ID;
    el.style.position = "fixed";
    el.style.zIndex = "2147483647";
    el.style.top = "12px";
    el.style.right = "12px";
    el.style.padding = "8px 10px";
    el.style.borderRadius = "8px";
    el.style.fontSize = "12px";
    el.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    el.style.color = "#fff";
    el.style.background = "rgba(36, 41, 47, 0.9)";
    el.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
    el.style.pointerEvents = "none";
    el.style.opacity = "0";
    el.style.transition = "opacity 120ms ease";
    document.documentElement.appendChild(el);
    return el;
  }

  function showToast(text, isError = false) {
    const el = getToastEl();
    el.textContent = text;
    el.style.background = isError ? "rgba(209, 36, 47, 0.92)" : "rgba(36, 41, 47, 0.9)";
    el.style.opacity = "1";
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, 1400);
  }

  function isEditableTarget(target) {
    if (!target) {
      return false;
    }
    const tag = target.tagName ? target.tagName.toLowerCase() : "";
    return (
      target.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select"
    );
  }

  function parseShortcut(shortcutText) {
    if (typeof shortcutText !== "string") {
      return null;
    }

    const tokens = shortcutText
      .toLowerCase()
      .replace(/\s+/g, "")
      .split("+")
      .filter(Boolean);

    const shortcut = {
      ctrl: false,
      alt: false,
      meta: false,
      shift: false,
      code: null
    };

    for (const token of tokens) {
      if (token === "ctrl" || token === "control" || token === "macctrl") {
        shortcut.ctrl = true;
        continue;
      }
      if (token === "alt" || token === "option") {
        shortcut.alt = true;
        continue;
      }
      if (token === "meta" || token === "cmd" || token === "command") {
        shortcut.meta = true;
        continue;
      }
      if (token === "shift") {
        shortcut.shift = true;
        continue;
      }

      if (/^[a-z]$/.test(token)) {
        shortcut.code = `Key${token.toUpperCase()}`;
        continue;
      }
      if (/^[0-9]$/.test(token)) {
        shortcut.code = `Digit${token}`;
        continue;
      }
      return null;
    }

    return shortcut.code ? shortcut : null;
  }

  function matchShortcut(event, shortcut) {
    if (!shortcut) {
      return false;
    }
    return (
      event.ctrlKey === shortcut.ctrl &&
      event.altKey === shortcut.alt &&
      event.metaKey === shortcut.meta &&
      event.shiftKey === shortcut.shift &&
      event.code === shortcut.code
    );
  }

  function buildShortcuts(settings) {
    const shortcuts = settings?.shortcuts || {};
    const result = {};
    for (const target of TARGET_KEYS) {
      const raw = shortcuts[target] || DEFAULT_SHORTCUTS[target];
      result[target] = parseShortcut(raw);
    }
    return result;
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

  function buildRuntimeSettings(settings) {
    return {
      shortcuts: buildShortcuts(settings),
      clearClipboardAfterUse: typeof settings?.clearClipboardAfterUse === "boolean"
        ? settings.clearClipboardAfterUse
        : DEFAULT_CLEAR_CLIPBOARD_AFTER_USE
    };
  }

  async function loadRuntimeSettingsFromStorage() {
    try {
      const { settings } = await chrome.storage.sync.get("settings");
      const runtimeSettings = buildRuntimeSettings(settings || {});
      activeShortcuts = runtimeSettings.shortcuts;
      activeClearClipboardAfterUse = runtimeSettings.clearClipboardAfterUse;
    } catch (_error) {
      const runtimeSettings = buildRuntimeSettings({});
      activeShortcuts = runtimeSettings.shortcuts;
      activeClearClipboardAfterUse = runtimeSettings.clearClipboardAfterUse;
    }
  }

  function findTargetByEvent(event) {
    for (const target of TARGET_KEYS) {
      if (matchShortcut(event, activeShortcuts[target])) {
        return target;
      }
    }
    return null;
  }

  async function readClipboardTextSafe() {
    try {
      const text = await navigator.clipboard.readText();
      return typeof text === "string" ? text : "";
    } catch (_error) {
      return "";
    }
  }

  async function clearClipboardSafe() {
    try {
      await navigator.clipboard.writeText("");
      return true;
    } catch (_error) {
      return false;
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.settings) {
      return;
    }
    const runtimeSettings = buildRuntimeSettings(changes.settings.newValue || {});
    activeShortcuts = runtimeSettings.shortcuts;
    activeClearClipboardAfterUse = runtimeSettings.clearClipboardAfterUse;
  });

  window.addEventListener(
    "keydown",
    async (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const target = findTargetByEvent(event);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const clipboardText = await readClipboardTextSafe();
      const clipboardUrl = extractFirstUrl(clipboardText);
      const shouldTryClearFirst = Boolean(clipboardUrl) && activeClearClipboardAfterUse;
      let clearedBeforeSend = false;
      if (shouldTryClearFirst) {
        clearedBeforeSend = await clearClipboardSafe();
      }

      showToast(`Sending to ${target}...`);
      chrome.runtime.sendMessage(
        {
          type: "OPEN_CURRENT_PAGE",
          target,
          url: window.location.href,
          clipboardText,
          clipboardClearedByClient: clearedBeforeSend
        },
        (response) => {
          if (chrome.runtime.lastError) {
            showToast("Extension error", true);
            return;
          }
          if (!response?.ok) {
            showToast(response?.error || "Request failed", true);
            return;
          }
          if (response?.shouldClearClipboard) {
            if (clearedBeforeSend) {
              showToast("Opened, clipboard cleared");
              return;
            }
            clearClipboardSafe().then((cleared) => {
              if (cleared) {
                showToast("Opened, clipboard cleared");
                return;
              }
              showToast("Opened (clipboard not cleared)");
            });
            return;
          }
          showToast("Opened");
        }
      );
    },
    true
  );

  loadRuntimeSettingsFromStorage();
})();
