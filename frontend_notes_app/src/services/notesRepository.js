/**
 * Notes repository abstraction.
 * - If a backend URL is configured via env vars, uses a simple REST API.
 * - Otherwise falls back to localStorage.
 *
 * Expected backend API shape (optional, best-effort):
 *  - GET    /notes
 *  - POST   /notes
 *  - PUT    /notes/:id
 *  - DELETE /notes/:id
 */

const STORAGE_KEY = "ocean-notes:v1";

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * Returns configured API base URL if present.
 * Uses REACT_APP_API_BASE or REACT_APP_BACKEND_URL. Empty string means "no backend".
 * @returns {string}
 */
function getApiBaseUrl() {
  const base = (process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || "").trim();
  return base.replace(/\/+$/, "");
}

/**
 * Sleep helper for UI loading skeletons (kept short).
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load notes from localStorage.
 * @returns {Note[]}
 */
function loadLocalNotes() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Save notes to localStorage.
 * @param {Note[]} notes
 */
function saveLocalNotes(notes) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

/**
 * Generate a stable, reasonably unique id.
 * @returns {string}
 */
function generateId() {
  return `note_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Create a starter note.
 * @returns {Note}
 */
function createBlankNote() {
  const now = Date.now();
  return {
    id: generateId(),
    title: "Untitled",
    content: "",
    createdAt: now,
    updatedAt: now,
  };
}

async function apiFetch(path, options = {}) {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }

  // Some delete endpoints return empty body
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return null;
}

/**
 * PUBLIC_INTERFACE
 * Returns true if backend URL is configured.
 */
export function isBackendEnabled() {
  return Boolean(getApiBaseUrl());
}

/**
 * PUBLIC_INTERFACE
 * Lists notes (backend or local).
 * @returns {Promise<Note[]>}
 */
export async function listNotes() {
  if (isBackendEnabled()) {
    const data = await apiFetch("/notes", { method: "GET" });
    return Array.isArray(data) ? data : [];
  }

  // small delay so skeletons show briefly (feels smoother)
  await sleep(150);
  return loadLocalNotes();
}

/**
 * PUBLIC_INTERFACE
 * Creates a new note.
 * If payload not provided, creates a blank note.
 * @param {{title?: string, content?: string}=} payload
 * @returns {Promise<Note>}
 */
export async function createNote(payload = {}) {
  if (isBackendEnabled()) {
    const created = await apiFetch("/notes", {
      method: "POST",
      body: JSON.stringify({
        title: payload.title ?? "Untitled",
        content: payload.content ?? "",
      }),
    });
    return created;
  }

  const notes = loadLocalNotes();
  const note = createBlankNote();
  note.title = (payload.title ?? note.title).trim() || "Untitled";
  note.content = payload.content ?? "";
  notes.unshift(note);
  saveLocalNotes(notes);
  return note;
}

/**
 * PUBLIC_INTERFACE
 * Updates note by id.
 * @param {string} id
 * @param {{title?: string, content?: string}} patch
 * @returns {Promise<Note>}
 */
export async function updateNote(id, patch) {
  if (isBackendEnabled()) {
    const updated = await apiFetch(`/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    return updated;
  }

  const notes = loadLocalNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx < 0) throw new Error("Note not found");

  const next = { ...notes[idx] };
  if (typeof patch.title === "string") next.title = patch.title.trim() || "Untitled";
  if (typeof patch.content === "string") next.content = patch.content;
  next.updatedAt = Date.now();

  notes[idx] = next;
  // Keep most recently updated at top
  notes.sort((a, b) => b.updatedAt - a.updatedAt);
  saveLocalNotes(notes);

  return next;
}

/**
 * PUBLIC_INTERFACE
 * Deletes note by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteNote(id) {
  if (isBackendEnabled()) {
    await apiFetch(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    return;
  }

  const notes = loadLocalNotes().filter((n) => n.id !== id);
  saveLocalNotes(notes);
}
