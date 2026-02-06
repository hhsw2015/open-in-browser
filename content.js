(function () {
  const TOAST_ID = "__open_in_browser_toast";
  const DEFAULT_CLEAR_CLIPBOARD_AFTER_USE = true;
  const DEFAULT_TARGETS = [
    { id: "atlas", name: "ChatGPT Atlas", shortcut: "ctrl+shift+o" },
    { id: "dia", name: "ChatGPT Dia", shortcut: "alt+shift+o" },
    { id: "gemini", name: "Gemini (Chrome)", shortcut: "meta+shift+o" }
  ];

  let activeTargetBindings = [];
  let activeClearClipboardAfterUse = DEFAULT_CLEAR_CLIPBOARD_AFTER_USE;
  let hoveredLinkUrl = "";
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

  function normalizeTargetId(value, fallback) {
    if (typeof value !== "string" || !value.trim()) {
      return fallback;
    }
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  function buildTargetBindings(settings) {
    const rawTargets = Array.isArray(settings?.targets) && settings.targets.length > 0
      ? settings.targets
      : DEFAULT_TARGETS;
    const bindings = [];

    for (let index = 0; index < rawTargets.length; index += 1) {
      const rawTarget = rawTargets[index];
      const fallback = DEFAULT_TARGETS[index % DEFAULT_TARGETS.length];
      const id = normalizeTargetId(rawTarget?.id, fallback.id);
      const name = (
        typeof rawTarget?.name === "string" && rawTarget.name.trim()
          ? rawTarget.name.trim()
          : fallback.name
      );
      const shortcutText = (
        typeof rawTarget?.shortcut === "string" && rawTarget.shortcut.trim()
          ? rawTarget.shortcut.trim().toLowerCase()
          : fallback.shortcut
      );
      const shortcut = parseShortcut(shortcutText);
      if (!shortcut) {
        continue;
      }
      bindings.push({ id, name, shortcut });
    }

    return bindings;
  }

  function buildRuntimeSettings(settings) {
    return {
      targetBindings: buildTargetBindings(settings),
      clearClipboardAfterUse: typeof settings?.clearClipboardAfterUse === "boolean"
        ? settings.clearClipboardAfterUse
        : DEFAULT_CLEAR_CLIPBOARD_AFTER_USE
    };
  }

  async function loadRuntimeSettingsFromStorage() {
    try {
      const { settings } = await chrome.storage.sync.get("settings");
      const runtimeSettings = buildRuntimeSettings(settings || {});
      activeTargetBindings = runtimeSettings.targetBindings;
      activeClearClipboardAfterUse = runtimeSettings.clearClipboardAfterUse;
    } catch (_error) {
      const runtimeSettings = buildRuntimeSettings({});
      activeTargetBindings = runtimeSettings.targetBindings;
      activeClearClipboardAfterUse = runtimeSettings.clearClipboardAfterUse;
    }
  }

  function matchShortcut(event, shortcut) {
    return (
      event.ctrlKey === shortcut.ctrl &&
      event.altKey === shortcut.alt &&
      event.metaKey === shortcut.meta &&
      event.shiftKey === shortcut.shift &&
      event.code === shortcut.code
    );
  }

  function matchModifiers(event, shortcut) {
    return (
      event.ctrlKey === shortcut.ctrl &&
      event.altKey === shortcut.alt &&
      event.metaKey === shortcut.meta &&
      event.shiftKey === shortcut.shift
    );
  }

  function findTargetByKeyEvent(event) {
    for (const binding of activeTargetBindings) {
      if (matchShortcut(event, binding.shortcut)) {
        return binding;
      }
    }
    return null;
  }

  function findTargetByModifierClick(event) {
    for (const binding of activeTargetBindings) {
      const shortcut = binding.shortcut;
      const hasAnyModifier = shortcut.ctrl || shortcut.alt || shortcut.meta || shortcut.shift;
      if (!hasAnyModifier) {
        continue;
      }
      if (matchModifiers(event, shortcut)) {
        return binding;
      }
    }
    return null;
  }

  function getSelectedTextSafe() {
    try {
      const selection = window.getSelection();
      return selection ? selection.toString() : "";
    } catch (_error) {
      return "";
    }
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

  function handleResponse(response, clearedBeforeSend) {
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.settings) {
      return;
    }
    const runtimeSettings = buildRuntimeSettings(changes.settings.newValue || {});
    activeTargetBindings = runtimeSettings.targetBindings;
    activeClearClipboardAfterUse = runtimeSettings.clearClipboardAfterUse;
  });

  window.addEventListener(
    "keydown",
    async (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const target = findTargetByKeyEvent(event);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const selectedText = getSelectedTextSafe();
      const selectedTextUrl = extractFirstUrl(selectedText);
      const clipboardText = await readClipboardTextSafe();
      const clipboardUrl = extractFirstUrl(clipboardText);
      const hoveredUrl = extractFirstUrl(hoveredLinkUrl);
      const shouldTryClearFirst = (
        Boolean(clipboardUrl) &&
        activeClearClipboardAfterUse &&
        !hoveredUrl &&
        !selectedTextUrl
      );
      let clearedBeforeSend = false;
      if (shouldTryClearFirst) {
        clearedBeforeSend = await clearClipboardSafe();
      }

      showToast(`Sending to ${target.name}...`);
      chrome.runtime.sendMessage(
        {
          type: "OPEN_CURRENT_PAGE",
          target: target.id,
          hoveredLinkUrl,
          selectedText,
          url: window.location.href,
          clipboardText,
          clipboardClearedByClient: clearedBeforeSend
        },
        (response) => {
          if (chrome.runtime.lastError) {
            showToast("Extension error", true);
            return;
          }
          handleResponse(response, clearedBeforeSend);
        }
      );
    },
    true
  );

  document.addEventListener(
    "click",
    async (event) => {
      if (event.button !== 0) {
        return;
      }
      if (!(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest("a[href]");
      if (!anchor) {
        return;
      }

      const target = findTargetByModifierClick(event);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const selectedText = getSelectedTextSafe();
      const selectedTextUrl = extractFirstUrl(selectedText);
      const clipboardText = await readClipboardTextSafe();
      const clipboardUrl = extractFirstUrl(clipboardText);
      const clickedHttpUrl = extractFirstUrl(anchor.href);
      const hoveredUrl = extractFirstUrl(hoveredLinkUrl);
      const shouldTryClearFirst = (
        Boolean(clipboardUrl) &&
        activeClearClipboardAfterUse &&
        !clickedHttpUrl &&
        !hoveredUrl &&
        !selectedTextUrl
      );
      let clearedBeforeSend = false;
      if (shouldTryClearFirst) {
        clearedBeforeSend = await clearClipboardSafe();
      }

      showToast(`Opening link in ${target.name}...`);
      chrome.runtime.sendMessage(
        {
          type: "OPEN_CURRENT_PAGE",
          target: target.id,
          clickedLinkUrl: anchor.href,
          hoveredLinkUrl,
          selectedText,
          url: window.location.href,
          clipboardText,
          clipboardClearedByClient: clearedBeforeSend
        },
        (response) => {
          if (chrome.runtime.lastError) {
            showToast("Extension error", true);
            return;
          }
          handleResponse(response, clearedBeforeSend);
        }
      );
    },
    true
  );

  document.addEventListener(
    "mouseover",
    (event) => {
      if (!(event.target instanceof Element)) {
        hoveredLinkUrl = "";
        return;
      }
      const anchor = event.target.closest("a[href]");
      hoveredLinkUrl = anchor ? anchor.href : "";
    },
    true
  );

  loadRuntimeSettingsFromStorage();
})();
