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
  let lastKeyboardTriggerSignature = "";
  let lastKeyboardTriggerAt = 0;
  const KEYBOARD_TRIGGER_DEDUP_MS = 800;
  const MAIN_WORLD_CHANNEL_KEY = "__openInBrowserMainWorld";
  const MAIN_WORLD_READY_TYPE = "MAIN_WORLD_READY";
  const MAIN_WORLD_UPDATE_TYPE = "UPDATE_SHORTCUTS";
  const MAIN_WORLD_TRIGGER_TYPE = "TRIGGER_SHORTCUT";
  const MAIN_WORLD_SYNC_INTERVAL_MS = 500;
  const MAIN_WORLD_SYNC_MAX_ATTEMPTS = 10;
  let mainWorldHotkeyReady = false;
  let mainWorldSyncAttempts = 0;
  let mainWorldSyncTimer = null;

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

  function toHttpUrl(urlText) {
    if (typeof urlText !== "string" || !urlText.trim()) {
      return null;
    }
    try {
      const parsed = new URL(urlText, window.location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      return parsed.toString();
    } catch (_error) {
      return null;
    }
  }

  function extractUrlFromAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) {
      return null;
    }

    const directHref = toHttpUrl(anchor.href);
    if (directHref) {
      return directHref;
    }

    const hrefAttr = anchor.getAttribute("href");
    const hrefFromAttr = toHttpUrl(hrefAttr);
    if (hrefFromAttr) {
      return hrefFromAttr;
    }

    const attributeCandidates = [
      anchor.getAttribute("data-url"),
      anchor.getAttribute("data-href"),
      anchor.getAttribute("data-link"),
      anchor.getAttribute("onclick"),
      anchor.getAttribute("onmouseover")
    ];

    for (const candidate of attributeCandidates) {
      const found = extractFirstUrl(candidate);
      if (found) {
        return found;
      }
    }

    for (const value of Object.values(anchor.dataset || {})) {
      const found = extractFirstUrl(value);
      if (found) {
        return found;
      }
    }

    return null;
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
      publishShortcutBindingsToMainWorld();
    } catch (_error) {
      const runtimeSettings = buildRuntimeSettings({});
      activeTargetBindings = runtimeSettings.targetBindings;
      activeClearClipboardAfterUse = runtimeSettings.clearClipboardAfterUse;
      publishShortcutBindingsToMainWorld();
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

  function hasAnyModifier(shortcut) {
    return Boolean(shortcut.ctrl || shortcut.alt || shortcut.meta || shortcut.shift);
  }

  function getKeyboardTriggerSignature(target, event) {
    return [
      target.id,
      event.code,
      event.ctrlKey ? "1" : "0",
      event.altKey ? "1" : "0",
      event.metaKey ? "1" : "0",
      event.shiftKey ? "1" : "0"
    ].join("|");
  }

  function publishShortcutBindingsToMainWorld() {
    const bindings = activeTargetBindings.map((binding) => ({
      id: binding.id,
      shortcut: {
        ctrl: binding.shortcut.ctrl,
        alt: binding.shortcut.alt,
        meta: binding.shortcut.meta,
        shift: binding.shortcut.shift,
        code: binding.shortcut.code
      }
    }));

    window.postMessage(
      {
        [MAIN_WORLD_CHANNEL_KEY]: true,
        type: MAIN_WORLD_UPDATE_TYPE,
        bindings
      },
      "*"
    );
  }

  function ensureMainWorldBindingsSync() {
    if (mainWorldSyncTimer) {
      return;
    }
    mainWorldSyncAttempts = 0;
    mainWorldSyncTimer = setInterval(() => {
      if (mainWorldSyncAttempts >= MAIN_WORLD_SYNC_MAX_ATTEMPTS) {
        clearInterval(mainWorldSyncTimer);
        mainWorldSyncTimer = null;
        return;
      }
      mainWorldSyncAttempts += 1;
      publishShortcutBindingsToMainWorld();
    }, MAIN_WORLD_SYNC_INTERVAL_MS);
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

    const urlCount = Number.isFinite(response?.urlCount) ? response.urlCount : 1;
    const openedText = urlCount > 1 ? `Opened ${urlCount} URLs` : "Opened";

    if (response?.shouldClearClipboard) {
      if (clearedBeforeSend) {
        showToast(`${openedText}, clipboard cleared`);
        return;
      }
      clearClipboardSafe().then((cleared) => {
        if (cleared) {
          showToast(`${openedText}, clipboard cleared`);
          return;
        }
        showToast(`${openedText} (clipboard not cleared)`);
      });
      return;
    }

    showToast(openedText);
  }

  async function sendOpenCurrentPageForTarget(target) {
    const selectedText = getSelectedTextSafe();
    const selectedTextUrl = extractFirstUrl(selectedText);
    const clipboardText = await readClipboardTextSafe();
    const clipboardUrl = extractFirstUrl(clipboardText);
    const hoveredUrl = hoveredLinkUrl || null;
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
  }

  async function sendOpenCurrentPageFromKeyboard(event, target) {
    event.preventDefault();
    event.stopImmediatePropagation();
    await sendOpenCurrentPageForTarget(target);
  }

  window.addEventListener(
    "message",
    (event) => {
      if (event.source !== window) {
        return;
      }

      const data = event.data;
      if (!data || data[MAIN_WORLD_CHANNEL_KEY] !== true || typeof data.type !== "string") {
        return;
      }

      if (data.type === MAIN_WORLD_READY_TYPE) {
        mainWorldHotkeyReady = true;
        publishShortcutBindingsToMainWorld();
        ensureMainWorldBindingsSync();
        return;
      }

      if (data.type !== MAIN_WORLD_TRIGGER_TYPE || typeof data.targetId !== "string") {
        return;
      }

      const target = activeTargetBindings.find((binding) => binding.id === data.targetId);
      if (!target) {
        return;
      }

      const signature = typeof data.signature === "string"
        ? data.signature
        : `${target.id}|main`;
      const now = Date.now();
      const recentlyHandled = (
        signature === lastKeyboardTriggerSignature &&
        (now - lastKeyboardTriggerAt) < KEYBOARD_TRIGGER_DEDUP_MS
      );
      if (recentlyHandled) {
        return;
      }

      lastKeyboardTriggerSignature = signature;
      lastKeyboardTriggerAt = now;
      void sendOpenCurrentPageForTarget(target);
    },
    true
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.settings) {
      return;
    }
    const runtimeSettings = buildRuntimeSettings(changes.settings.newValue || {});
    activeTargetBindings = runtimeSettings.targetBindings;
    activeClearClipboardAfterUse = runtimeSettings.clearClipboardAfterUse;
    publishShortcutBindingsToMainWorld();
  });

  window.addEventListener(
    "keydown",
    async (event) => {
      if (mainWorldHotkeyReady) {
        return;
      }
      if (event.repeat) {
        return;
      }

      const target = findTargetByKeyEvent(event);
      if (!target) {
        return;
      }
      if (isEditableTarget(event.target) && !hasAnyModifier(target.shortcut)) {
        return;
      }

      lastKeyboardTriggerSignature = getKeyboardTriggerSignature(target, event);
      lastKeyboardTriggerAt = Date.now();
      await sendOpenCurrentPageFromKeyboard(event, target);
    },
    true
  );

  window.addEventListener(
    "keyup",
    async (event) => {
      if (mainWorldHotkeyReady) {
        return;
      }

      const target = findTargetByKeyEvent(event);
      if (!target) {
        return;
      }
      if (isEditableTarget(event.target) && !hasAnyModifier(target.shortcut)) {
        return;
      }

      const signature = getKeyboardTriggerSignature(target, event);
      const now = Date.now();
      const handledByRecentKeydown = (
        signature === lastKeyboardTriggerSignature &&
        (now - lastKeyboardTriggerAt) < KEYBOARD_TRIGGER_DEDUP_MS
      );
      if (handledByRecentKeydown) {
        return;
      }

      await sendOpenCurrentPageFromKeyboard(event, target);
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
      const clickedHttpUrl = extractUrlFromAnchor(anchor);
      const hoveredUrl = hoveredLinkUrl || null;
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
          clickedLinkUrl: clickedHttpUrl || anchor.href,
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
      hoveredLinkUrl = anchor ? (extractUrlFromAnchor(anchor) || "") : "";
    },
    true
  );

  loadRuntimeSettingsFromStorage();
})();
