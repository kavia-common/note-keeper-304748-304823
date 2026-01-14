/**
 * Notes repository abstraction.
 *
 * This module provides a stable, hardened contract for the rest of the app to interact with notes.
 * It supports two modes:
 *
 * 1) Backend mode (enabled when either env var is set):
 *    - REACT_APP_API_BASE
 *    - REACT_APP_BACKEND_URL
 *
 * 2) Local mode (default, browser-only):
 *    - Uses localStorage for persistence
 *
 * -----------------------------------------------------------------------------
 * Note Contract (ALWAYS returned by this repository)
 * -----------------------------------------------------------------------------
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {string} createdAt ISO timestamp
 * @property {string} updatedAt ISO timestamp
 *
 * -----------------------------------------------------------------------------
 * Expected backend endpoints & payloads (when backend mode enabled)
 * -----------------------------------------------------------------------------
 * Base URL: ${REACT_APP_API_BASE || REACT_APP_BACKEND_URL} (no trailing slash)
 *
 * Endpoints (best-effort; this repo normalizes responses):
 * - GET    /notes
 *      -> returns Note[] or an array of note-like objects
 * - GET    /notes/:id
 *      -> returns Note or a note-like object
 * - POST   /notes
 *      body: { title: string, content: string }
 *      -> returns created note
 * - PUT    /notes/:id
 *      body: partial { title?: string, content?: string }
 *      -> returns updated note
 * - DELETE /notes/:id
 *      -> may return empty body
 *
 * Note: backend may return timestamps as numbers, Date strings, or fields like
 * `created_at` / `updated_at`. This repository normalizes those fields to the
 * Note contract above.
 */

const STORAGE_KEY = "ocean-notes:v1";

/**
 * @typedef {Object} RepositoryEnv
 * @property {string} apiBaseUrl - Normalized base URL (no trailing slash) or empty string.
 * @property {boolean} backendEnabled - True when apiBaseUrl is non-empty.
 */

/**
 * Converts various timestamp representations into an ISO string.
 * @param {unknown} value
 * @returns {string}
 */
function toIsoString(value) {
  // If it's already an ISO string, keep it as-is when parseable.
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // If it's numeric (epoch ms or seconds), try to interpret it.
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: treat <= 1e12 as seconds, otherwise milliseconds.
    const ms = value <= 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // If it's a Date.
  if (value instanceof Date) {
    const d = value;
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // Fallback to "now".
  return new Date().toISOString();
}

/**
 * Normalize an arbitrary backend/local object into the repository's Note contract.
 * Missing/invalid fields are defaulted safely.
 *
 * @param {any} raw
 * @param {Partial<Note>=} fallback
 * @returns {Note}
 */
function normalizeNote(raw, fallback = {}) {
  const obj = raw && typeof raw === "object" ? raw : {};

  const id = String(obj.id ?? fallback.id ?? "");
  const title = String(obj.title ?? fallback.title ?? "Untitled").trim() || "Untitled";
  const content = String(obj.content ?? fallback.content ?? "");

  // Common variants from APIs.
  const createdCandidate = obj.createdAt ?? obj.created_at ?? fallback.createdAt;
  const updatedCandidate = obj.updatedAt ?? obj.updated_at ?? fallback.updatedAt ?? createdCandidate;

  const createdAt = toIsoString(createdCandidate);
  const updatedAt = toIsoString(updatedCandidate);

  // Ensure we always have a non-empty id; generate one in local use-cases,
  // but avoid silently generating ids for backend responses unless absolutely needed.
  const finalId = id || String(fallback.id || generateId());

  return { id: finalId, title, content, createdAt, updatedAt };
}

/**
 * Sort notes by updatedAt desc (most recent first).
 * @param {Note[]} notes
 * @returns {Note[]}
 */
function sortNotesByUpdatedAtDesc(notes) {
  return [...notes].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

/**
 * Centralized environment detection for repo mode.
 * Only REACT_APP_API_BASE / REACT_APP_BACKEND_URL control behavior.
 *
 * @returns {RepositoryEnv}
 */
function getRepositoryEnv() {
  const base = (process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || "").trim();
  const apiBaseUrl = base.replace(/\/+$/, "");
  return {
    apiBaseUrl,
    backendEnabled: Boolean(apiBaseUrl),
  };
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
 * Load notes from localStorage, normalized to Note contract.
 * @returns {Note[]}
 */
function loadLocalNotes() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((n) => normalizeNote(n));
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
 * Create a starter note (normalized Note contract).
 * @param {{title?: string, content?: string}=} payload
 * @returns {Note}
 */
function createLocalNote(payload = {}) {
  const nowIso = new Date().toISOString();
  const note = normalizeNote(
    {
      id: generateId(),
      title: payload.title ?? "Untitled",
      content: payload.content ?? "",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {}
  );

  // Enforce trimming/Untitled logic.
  return {
    ...note,
    title: String(note.title || "").trim() || "Untitled",
    content: String(note.content || ""),
  };
}

/**
 * A user-friendly Error that repository methods throw.
 * @param {string} message
 * @param {unknown=} cause
 * @returns {Error}
 */
function repoError(message, cause) {
  const e = new Error(message);
  // @ts-ignore - keep extra debug info without requiring TS
  e.cause = cause;
  return e;
}

/**
 * Build a nice error message for network issues / API failures.
 * @param {unknown} err
 * @returns {string}
 */
function toUserFriendlyErrorMessage(err) {
  if (err instanceof Error) {
    // Fetch often throws TypeError("Failed to fetch") on network errors
    if (err.name === "TypeError" && /failed to fetch/i.test(err.message)) {
      return "Could not reach the notes server. Check your connection and try again.";
    }
    return err.message || "Something went wrong. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

/**
 * Low-level fetch wrapper for backend mode.
 * - Adds JSON headers
 * - Parses JSON when present
 * - Throws user-friendly errors for network or server problems
 *
 * @param {string} path
 * @param {RequestInit=} options
 * @returns {Promise<any>}
 */
async function apiFetch(path, options = {}) {
  const { apiBaseUrl } = getRepositoryEnv();
  const url = `${apiBaseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
  } catch (err) {
    throw repoError(toUserFriendlyErrorMessage(err), err);
  }

  // Try to read response body safely (might not be JSON).
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  let parsedBody = null;
  if (isJson) {
    try {
      parsedBody = await res.json();
    } catch {
      parsedBody = null;
    }
  } else {
    // Might be empty for DELETE or text error responses.
    try {
      parsedBody = await res.text();
    } catch {
      parsedBody = "";
    }
  }

  if (!res.ok) {
    const detail =
      typeof parsedBody === "string"
        ? parsedBody
        : parsedBody && typeof parsedBody === "object"
          ? JSON.stringify(parsedBody)
          : "";

    // Keep detail short-ish to avoid noisy banners.
    const trimmedDetail = (detail || "").trim();
    const detailSuffix = trimmedDetail ? ` (${trimmedDetail.slice(0, 180)})` : "";

    throw repoError(`Notes server error: ${res.status} ${res.statusText}${detailSuffix}`, {
      status: res.status,
      statusText: res.statusText,
      body: parsedBody,
    });
  }

  // If it's JSON, return object/array; if it was text and empty, return null.
  if (isJson) return parsedBody;
  const text = typeof parsedBody === "string" ? parsedBody.trim() : "";
  return text ? text : null;
}

/**
 * PUBLIC_INTERFACE
 * Returns true if backend URL is configured (REACT_APP_API_BASE or REACT_APP_BACKEND_URL).
 * @returns {boolean}
 */
export function isBackendEnabled() {
  return getRepositoryEnv().backendEnabled;
}

/**
 * PUBLIC_INTERFACE
 * Returns the current persistence mode for the UI, based solely on repository env detection.
 * - "Local (browser)" when no backend env vars are set
 * - "Synced (backend)" when REACT_APP_API_BASE or REACT_APP_BACKEND_URL is set
 *
 * @returns {"Local (browser)"|"Synced (backend)"}
 */
export function getPersistenceModeLabel() {
  return isBackendEnabled() ? "Synced (backend)" : "Local (browser)";
}

/**
 * PUBLIC_INTERFACE
 * Lists notes (backend or local) in consistent updatedAt-desc order.
 * @returns {Promise<Note[]>}
 */
export async function listNotes() {
  if (isBackendEnabled()) {
    try {
      const data = await apiFetch("/notes", { method: "GET" });
      const list = Array.isArray(data) ? data : [];
      return sortNotesByUpdatedAtDesc(list.map((n) => normalizeNote(n)));
    } catch (err) {
      throw repoError(toUserFriendlyErrorMessage(err), err);
    }
  }

  // small delay so skeletons show briefly (feels smoother)
  await sleep(150);
  return sortNotesByUpdatedAtDesc(loadLocalNotes());
}

/**
 * PUBLIC_INTERFACE
 * Fetch a single note by id (backend or local).
 * @param {string} id
 * @returns {Promise<Note>}
 */
export async function getNote(id) {
  if (!id) throw repoError("Note id is required.");

  if (isBackendEnabled()) {
    try {
      const data = await apiFetch(`/notes/${encodeURIComponent(id)}`, { method: "GET" });
      if (!data) throw repoError("Note not found.");
      return normalizeNote(data, { id });
    } catch (err) {
      throw repoError(toUserFriendlyErrorMessage(err), err);
    }
  }

  const notes = loadLocalNotes();
  const found = notes.find((n) => n.id === id);
  if (!found) throw repoError("Note not found.");
  return normalizeNote(found);
}

/**
 * PUBLIC_INTERFACE
 * Creates a new note.
 * @param {{title?: string, content?: string}=} partial
 * @returns {Promise<Note>}
 */
export async function createNote(partial = {}) {
  if (isBackendEnabled()) {
    try {
      const created = await apiFetch("/notes", {
        method: "POST",
        body: JSON.stringify({
          title: (partial.title ?? "Untitled").toString(),
          content: (partial.content ?? "").toString(),
        }),
      });
      return normalizeNote(created);
    } catch (err) {
      throw repoError(toUserFriendlyErrorMessage(err), err);
    }
  }

  const notes = loadLocalNotes();
  const note = createLocalNote(partial);

  notes.unshift(note);
  saveLocalNotes(sortNotesByUpdatedAtDesc(notes));

  return note;
}

/**
 * PUBLIC_INTERFACE
 * Updates note by id.
 * @param {string} id
 * @param {{title?: string, content?: string}} partial
 * @returns {Promise<Note>}
 */
export async function updateNote(id, partial) {
  if (!id) throw repoError("Note id is required.");
  if (!partial || typeof partial !== "object") throw repoError("Update payload is required.");

  if (isBackendEnabled()) {
    try {
      const updated = await apiFetch(`/notes/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...(typeof partial.title === "string" ? { title: partial.title } : {}),
          ...(typeof partial.content === "string" ? { content: partial.content } : {}),
        }),
      });
      return normalizeNote(updated, { id });
    } catch (err) {
      throw repoError(toUserFriendlyErrorMessage(err), err);
    }
  }

  const notes = loadLocalNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx < 0) throw repoError("Note not found.");

  const existing = normalizeNote(notes[idx], { id });

  const next = normalizeNote(
    {
      ...existing,
      ...(typeof partial.title === "string" ? { title: partial.title } : {}),
      ...(typeof partial.content === "string" ? { content: partial.content } : {}),
      updatedAt: new Date().toISOString(),
    },
    existing
  );

  // Ensure trimming/Untitled logic.
  next.title = String(next.title || "").trim() || "Untitled";
  next.content = String(next.content || "");

  const updatedList = [...notes];
  updatedList[idx] = next;

  saveLocalNotes(sortNotesByUpdatedAtDesc(updatedList));
  return next;
}

/**
 * PUBLIC_INTERFACE
 * Deletes note by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteNote(id) {
  if (!id) throw repoError("Note id is required.");

  if (isBackendEnabled()) {
    try {
      await apiFetch(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
      return;
    } catch (err) {
      throw repoError(toUserFriendlyErrorMessage(err), err);
    }
  }

  const notes = loadLocalNotes().filter((n) => n.id !== id);
  saveLocalNotes(sortNotesByUpdatedAtDesc(notes));
}
