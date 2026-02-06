const statusEl = document.getElementById("status");
const targetButtonsEl = document.getElementById("target-buttons");
const DEFAULT_CLEAR_CLIPBOARD_AFTER_USE = true;
const DEFAULT_TARGETS = [
  { id: "atlas", name: "ChatGPT Atlas" },
  { id: "dia", name: "ChatGPT Dia" },
  { id: "gemini", name: "Gemini (Chrome)" }
];

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#d1242f" : "#57606a";
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

function normalizeTargets(settings) {
  if (Array.isArray(settings?.targets) && settings.targets.length > 0) {
    return settings.targets
      .map((target, index) => ({
        id: typeof target?.id === "string" && target.id.trim()
          ? target.id.trim()
          : `target-${index + 1}`,
        name: typeof target?.name === "string" && target.name.trim()
          ? target.name.trim()
          : `Target ${index + 1}`
      }));
  }
  return DEFAULT_TARGETS;
}

async function getClearClipboardAfterUse() {
  try {
    const { settings } = await chrome.storage.sync.get("settings");
    if (typeof settings?.clearClipboardAfterUse === "boolean") {
      return settings.clearClipboardAfterUse;
    }
  } catch (_error) {
    // fall through
  }
  return DEFAULT_CLEAR_CLIPBOARD_AFTER_USE;
}

async function openCurrentPage(targetId) {
  setStatus("Sending request...");
  const clipboardText = await readClipboardTextSafe();
  const clipboardUrl = extractFirstUrl(clipboardText);
  const clearClipboardAfterUse = await getClearClipboardAfterUse();
  let clearedBeforeSend = false;
  if (clipboardUrl && clearClipboardAfterUse) {
    clearedBeforeSend = await clearClipboardSafe();
  }

  const response = await chrome.runtime.sendMessage({
    type: "OPEN_CURRENT_PAGE",
    target: targetId,
    clipboardText,
    clipboardClearedByClient: clearedBeforeSend
  });

  if (!response?.ok) {
    const msg = response?.error || "Request failed.";
    throw new Error(msg);
  }

  if (response?.shouldClearClipboard) {
    if (clearedBeforeSend) {
      setStatus("Done. Clipboard cleared.");
      return;
    }
    const cleared = await clearClipboardSafe();
    if (cleared) {
      setStatus("Done. Clipboard cleared.");
      return;
    }
    setStatus("Done. Clipboard not cleared.");
    return;
  }

  setStatus("Done.");
}

function renderTargetButtons(settings) {
  const targets = normalizeTargets(settings);
  targetButtonsEl.innerHTML = "";
  for (const target of targets) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.target = target.id;
    button.textContent = target.name;
    targetButtonsEl.appendChild(button);
  }
}

async function loadTargets() {
  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to load targets.");
  }
  renderTargetButtons(response.settings);
}

targetButtonsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-target]");
  if (!button) {
    return;
  }

  try {
    await openCurrentPage(button.dataset.target);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("open-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadTargets().catch((error) => {
  setStatus(error.message, true);
});
