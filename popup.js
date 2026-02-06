const statusEl = document.getElementById("status");
const DEFAULT_CLEAR_CLIPBOARD_AFTER_USE = true;

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

async function openCurrentPage(target) {
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
    target,
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

document.querySelectorAll("button[data-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await openCurrentPage(button.dataset.target);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
});

document.getElementById("open-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
