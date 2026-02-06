(function () {
  const MAIN_WORLD_CHANNEL_KEY = "__openInBrowserMainWorld";
  const MAIN_WORLD_READY_TYPE = "MAIN_WORLD_READY";
  const MAIN_WORLD_UPDATE_TYPE = "UPDATE_SHORTCUTS";
  const MAIN_WORLD_TRIGGER_TYPE = "TRIGGER_SHORTCUT";
  const READY_RETRY_INTERVAL_MS = 300;
  const READY_RETRY_MAX_ATTEMPTS = 20;

  let activeBindings = [];
  let hasReceivedBindings = false;

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

  function normalizeBindings(rawBindings) {
    if (!Array.isArray(rawBindings)) {
      return [];
    }

    const normalized = [];
    for (const item of rawBindings) {
      const id = typeof item?.id === "string" ? item.id : "";
      const shortcut = item?.shortcut || {};
      const code = typeof shortcut.code === "string" ? shortcut.code : "";
      if (!id || !code) {
        continue;
      }
      normalized.push({
        id,
        shortcut: {
          ctrl: Boolean(shortcut.ctrl),
          alt: Boolean(shortcut.alt),
          meta: Boolean(shortcut.meta),
          shift: Boolean(shortcut.shift),
          code
        }
      });
    }
    return normalized;
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

  function findBindingByEvent(event) {
    for (const binding of activeBindings) {
      if (matchShortcut(event, binding.shortcut)) {
        return binding;
      }
    }
    return null;
  }

  function buildSignature(targetId, event) {
    return [
      targetId,
      event.code,
      event.ctrlKey ? "1" : "0",
      event.altKey ? "1" : "0",
      event.metaKey ? "1" : "0",
      event.shiftKey ? "1" : "0"
    ].join("|");
  }

  function hasAnyModifier(shortcut) {
    return Boolean(shortcut.ctrl || shortcut.alt || shortcut.meta || shortcut.shift);
  }

  function postTrigger(binding, event) {
    window.postMessage(
      {
        [MAIN_WORLD_CHANNEL_KEY]: true,
        type: MAIN_WORLD_TRIGGER_TYPE,
        targetId: binding.id,
        signature: buildSignature(binding.id, event)
      },
      "*"
    );
  }

  window.addEventListener(
    "message",
    (event) => {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || data[MAIN_WORLD_CHANNEL_KEY] !== true || data.type !== MAIN_WORLD_UPDATE_TYPE) {
        return;
      }
      activeBindings = normalizeBindings(data.bindings);
      hasReceivedBindings = true;
    },
    true
  );

  function handleKeyEvent(event) {
    if (event.type === "keydown" && event.repeat) {
      return;
    }
    const binding = findBindingByEvent(event);
    if (!binding) {
      return;
    }
    if (isEditableTarget(event.target) && !hasAnyModifier(binding.shortcut)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    postTrigger(binding, event);
  }

  window.addEventListener("keydown", handleKeyEvent, true);
  window.addEventListener("keyup", handleKeyEvent, true);

  function postReadySignal() {
    window.postMessage(
      {
        [MAIN_WORLD_CHANNEL_KEY]: true,
        type: MAIN_WORLD_READY_TYPE
      },
      "*"
    );
  }

  postReadySignal();

  let readyAttempts = 0;
  const readyTimer = setInterval(() => {
    if (hasReceivedBindings || readyAttempts >= READY_RETRY_MAX_ATTEMPTS) {
      clearInterval(readyTimer);
      return;
    }
    readyAttempts += 1;
    postReadySignal();
  }, READY_RETRY_INTERVAL_MS);
})();
