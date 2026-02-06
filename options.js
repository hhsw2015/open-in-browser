const DEFAULT_SETTINGS = {
  apiBase: "http://localhost:5000",
  targets: [
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
  ],
  clearClipboardAfterUse: true
};

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const targetsEl = document.getElementById("targets");
const targetRowTemplate = document.getElementById("target-row-template");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#cf222e" : "#1f883d";
}

function normalizeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeId(value, fallback) {
  const raw = normalizeText(value, fallback).toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function ensureUniqueTargetIds(targets) {
  const seen = new Set();
  return targets.map((target, index) => {
    const base = sanitizeId(target.id, `target-${index + 1}`);
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

function cloneTarget(target, index) {
  const fallback = DEFAULT_SETTINGS.targets[index % DEFAULT_SETTINGS.targets.length];
  return {
    id: sanitizeId(target?.id, fallback.id),
    name: normalizeText(target?.name, fallback.name),
    endpoint: normalizeText(target?.endpoint, fallback.endpoint),
    shortcut: normalizeText(target?.shortcut, fallback.shortcut).toLowerCase()
  };
}

function createTargetRow(target, index) {
  const row = targetRowTemplate.content.firstElementChild.cloneNode(true);
  row.querySelector(".target-id").value = target.id || `target-${index + 1}`;
  row.querySelector(".target-name").value = target.name || "";
  row.querySelector(".target-endpoint").value = target.endpoint || "";
  row.querySelector(".target-shortcut").value = target.shortcut || "";
  return row;
}

function renderTargets(targets) {
  const safeTargets = Array.isArray(targets) && targets.length > 0
    ? targets
    : DEFAULT_SETTINGS.targets;
  targetsEl.innerHTML = "";
  safeTargets.forEach((target, index) => {
    targetsEl.appendChild(createTargetRow(cloneTarget(target, index), index));
  });
}

function fillForm(settings) {
  document.getElementById("apiBase").value = settings.apiBase || DEFAULT_SETTINGS.apiBase;
  document.getElementById("clearClipboardAfterUse").checked = Boolean(settings.clearClipboardAfterUse);
  renderTargets(settings.targets);
}

function readTargetsFromForm() {
  const rows = Array.from(targetsEl.querySelectorAll(".target-row"));
  const targets = rows.map((row, index) => {
    const id = row.querySelector(".target-id").value;
    const name = row.querySelector(".target-name").value;
    const endpoint = row.querySelector(".target-endpoint").value;
    const shortcut = row.querySelector(".target-shortcut").value;

    return {
      id: sanitizeId(id || name, `target-${index + 1}`),
      name: normalizeText(name, `Target ${index + 1}`),
      endpoint: normalizeText(endpoint, "/"),
      shortcut: normalizeText(shortcut, "ctrl+shift+o").toLowerCase()
    };
  });

  return ensureUniqueTargetIds(targets);
}

function readFormSettings() {
  return {
    apiBase: document.getElementById("apiBase").value.trim(),
    targets: readTargetsFromForm(),
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
  const settings = readFormSettings();
  if (!settings.targets.length) {
    setStatus("At least one target is required.", true);
    return;
  }

  setStatus("Saving...");
  try {
    await saveSettings(settings);
    setStatus("Saved.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("add-target").addEventListener("click", () => {
  const index = targetsEl.querySelectorAll(".target-row").length;
  targetsEl.appendChild(
    createTargetRow(
      {
        id: `target-${index + 1}`,
        name: `Target ${index + 1}`,
        endpoint: "/",
        shortcut: "ctrl+shift+o"
      },
      index
    )
  );
});

targetsEl.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-target");
  if (!button) {
    return;
  }
  const row = button.closest(".target-row");
  if (!row) {
    return;
  }
  row.remove();
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
