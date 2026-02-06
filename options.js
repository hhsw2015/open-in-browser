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

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#cf222e" : "#1f883d";
}

function fillForm(settings) {
  document.getElementById("apiBase").value = settings.apiBase;
  document.getElementById("endpointAtlas").value = settings.endpoints.atlas;
  document.getElementById("endpointDia").value = settings.endpoints.dia;
  document.getElementById("endpointGemini").value = settings.endpoints.gemini;
  document.getElementById("shortcutAtlas").value = settings.shortcuts.atlas;
  document.getElementById("shortcutDia").value = settings.shortcuts.dia;
  document.getElementById("shortcutGemini").value = settings.shortcuts.gemini;
  document.getElementById("clearClipboardAfterUse").checked = Boolean(settings.clearClipboardAfterUse);
}

function readFormSettings() {
  return {
    apiBase: document.getElementById("apiBase").value.trim(),
    endpoints: {
      atlas: document.getElementById("endpointAtlas").value.trim(),
      dia: document.getElementById("endpointDia").value.trim(),
      gemini: document.getElementById("endpointGemini").value.trim()
    },
    shortcuts: {
      atlas: document.getElementById("shortcutAtlas").value.trim().toLowerCase(),
      dia: document.getElementById("shortcutDia").value.trim().toLowerCase(),
      gemini: document.getElementById("shortcutGemini").value.trim().toLowerCase()
    },
    clearClipboardAfterUse: document.getElementById("clearClipboardAfterUse").checked
  };
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to load settings");
  }
  fillForm(response.settings);
}

async function saveSettings(settings) {
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to save settings");
  }
  fillForm(response.settings);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Saving...");
  try {
    await saveSettings(readFormSettings());
    setStatus("Saved.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("reset-defaults").addEventListener("click", async () => {
  setStatus("Resetting...");
  try {
    await saveSettings(DEFAULT_SETTINGS);
    setStatus("Reset to defaults.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

loadSettings().catch((error) => {
  setStatus(error.message, true);
  fillForm(DEFAULT_SETTINGS);
});
