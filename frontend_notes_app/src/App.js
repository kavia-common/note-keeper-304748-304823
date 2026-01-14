import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import NotesList from "./components/NotesList";
import NoteEditor from "./components/NoteEditor";
import {
  createNote,
  deleteNote,
  getPersistenceModeLabel,
  isBackendEnabled,
  listNotes,
  updateNote,
} from "./services/notesRepository";

/**
 * Friendly short date formatting for note list/editor metadata.
 * - Shows "Today 2:34 PM" / "Yesterday 11:10 AM" when applicable
 * - Otherwise uses a compact "YYYY-MM-DD HH:mm" format
 * Data stays ISO/epoch; this is purely presentation.
 * @param {number|string|Date} value
 * @returns {string}
 */
function formatUpdatedAt(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfThatDay.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));

  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === -1) return `Yesterday ${time}`;

  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Returns a new array sorted by descending updatedAt (most recently updated first).
 * Accepts either ISO string timestamps or numbers.
 * @param {Array<{updatedAt?: any}>} list
 * @returns {Array}
 */
function sortByMostRecentlyUpdated(list) {
  return [...list].sort((a, b) => {
    const aT = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bT = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return (Number.isFinite(bT) ? bT : 0) - (Number.isFinite(aT) ? aT : 0);
  });
}

/**
 * Select the next "logical" note after a delete.
 * Preference: most recently updated (already how the list is ordered).
 * @param {Array<{id: string}>} remainingSorted
 * @param {string} deletedId
 * @returns {string|null}
 */
function pickNextSelectionAfterDelete(remainingSorted, deletedId) {
  const remaining = Array.isArray(remainingSorted) ? remainingSorted.filter((n) => n?.id !== deletedId) : [];
  return remaining[0]?.id ?? null;
}

/**
 * Returns true if two notes differ in title/content (trim-safe).
 * @param {{title?: string, content?: string}|null} a
 * @param {{title?: string, content?: string}|null} b
 * @returns {boolean}
 */
function hasContentChanged(a, b) {
  if (!a || !b) return false;
  return (a.title || "") !== (b.title || "") || (a.content || "") !== (b.content || "");
}

// PUBLIC_INTERFACE
function App() {
  const backendEnabled = isBackendEnabled();

  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Non-intrusive banner area is still used for larger errors, but we avoid spamming it for save churn.
  const [error, setError] = useState("");

  // Editor save UX (subtle, non-blocking)
  const [saveStatus, setSaveStatus] = useState(
    /** @type {"idle"|"dirty"|"saving"|"saved"|"error"} */ ("idle")
  );
  const [saveError, setSaveError] = useState("");

  const searchInputRef = useRef(null);

  const selectedNote = useMemo(() => notes.find((n) => n.id === selectedId) || null, [notes, selectedId]);

  // Local editor draft to make typing instantaneous even if persistence is async.
  const [draft, setDraft] = useState(null);

  // ----- Autosave concurrency control -----
  // We keep autosave logic fully client-side (no repository contract changes).
  const saveTimerRef = useRef(/** @type {number|null} */ (null));
  const saveTokenRef = useRef(/** @type {Record<string, number>} */ ({})); // per-note increasing token
  const inflightRef = useRef(
    /** @type {{noteId: string, token: number}|null} */ (null)
  );
  const queuedSaveRef = useRef(
    /** @type {{noteId: string, token: number, payload: {title?: string, content?: string}}|null} */ (null)
  );

  /**
   * Increment and return the next save token for the given note.
   * @param {string} noteId
   * @returns {number}
   */
  function nextSaveToken(noteId) {
    const current = saveTokenRef.current[noteId] || 0;
    const next = current + 1;
    saveTokenRef.current[noteId] = next;
    return next;
  }

  /**
   * Get current save token for note.
   * @param {string} noteId
   * @returns {number}
   */
  function getSaveToken(noteId) {
    return saveTokenRef.current[noteId] || 0;
  }

  /**
   * Clear any scheduled (debounced) save.
   */
  function cancelScheduledSave() {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }

  /**
   * Apply a saved note to state and keep ordering consistent.
   * @param {any} updated
   */
  function applySavedNote(updated) {
    setNotes((prev) => sortByMostRecentlyUpdated(prev.map((n) => (n.id === updated.id ? updated : n))));
  }

  /**
   * Start a save for a note/payload with a token guard.
   * - If a save is already in-flight, we queue only the latest payload.
   * - Only apply results if token is still current for that note.
   *
   * @param {string} noteId
   * @param {{title?: string, content?: string}} payload
   * @param {{setBusyFlag?: boolean, markStatus?: boolean}=} options
   */
  async function guardedSave(noteId, payload, options = {}) {
    const { setBusyFlag = false, markStatus = true } = options;

    // If another save is in-flight, queue the most recent payload and return.
    if (inflightRef.current) {
      const token = nextSaveToken(noteId);
      queuedSaveRef.current = { noteId, token, payload };
      if (markStatus) setSaveStatus("saving");
      return;
    }

    const token = nextSaveToken(noteId);
    inflightRef.current = { noteId, token };
    if (setBusyFlag) setBusy(true);
    if (markStatus) {
      setSaveStatus("saving");
      setSaveError("");
    }

    try {
      const updated = await updateNote(noteId, payload);

      // Only apply if this is still the latest token for that note.
      if (getSaveToken(noteId) === token) {
        applySavedNote(updated);

        // If the draft is still for this note, we keep it as-is (user may be typing).
        // Save status is "saved" only if current draft matches latest stored content.
        const currentInState = notes.find((n) => n.id === noteId) || null;
        const draftForThis = draft?.id === noteId ? draft : null;
        const changed = draftForThis ? hasContentChanged(draftForThis, currentInState) : false;
        setSaveStatus(changed ? "dirty" : "saved");
      }
    } catch (e) {
      // Only surface save error if this is still the latest token; otherwise ignore stale errors.
      if (getSaveToken(noteId) === token) {
        const message = e instanceof Error ? e.message : "Failed to save note.";
        setSaveStatus("error");
        setSaveError(message);
      }
    } finally {
      inflightRef.current = null;
      if (setBusyFlag) setBusy(false);

      // If there is a queued save, run it next (but only the latest queued payload is kept).
      if (queuedSaveRef.current) {
        const queued = queuedSaveRef.current;
        queuedSaveRef.current = null;

        // If a newer token exists (meaning user typed again after queuing), skip queued.
        if (getSaveToken(queued.noteId) === queued.token) {
          // Run queued save without toggling global busy.
          // Keep status as saving.
          // eslint-disable-next-line no-use-before-define
          await guardedSave(queued.noteId, queued.payload, { setBusyFlag: false, markStatus: true });
        }
      }
    }
  }

  // Track selection id explicitly to implement "unsaved changes" behavior when switching notes.
  const prevSelectedIdRef = useRef(null);

  // Keep draft in sync when switching selection. If there are unsaved changes, try to autosave first,
  // and only fall back to a gentle confirm if saving fails.
  useEffect(() => {
    let alive = true;

    async function handleSelectionChange() {
      const prevSelectedId = prevSelectedIdRef.current;
      const nextSelectedId = selectedId;

      // First run: initialize ref and draft.
      if (prevSelectedId === null) {
        prevSelectedIdRef.current = nextSelectedId;
        if (selectedNote) setDraft(selectedNote);
        else setDraft(null);
        setSaveStatus("idle");
        setSaveError("");
        return;
      }

      // Not a selection switch.
      if (prevSelectedId === nextSelectedId) return;

      // Cancel any scheduled save; we will decide how to handle the previous note now.
      cancelScheduledSave();

      // Attempt to protect unsaved edits on the previous note.
      const prevNote = notes.find((n) => n.id === prevSelectedId) || null;
      const draftIsForPrev = draft?.id === prevSelectedId;

      const hasUnsavedEdits =
        Boolean(prevNote && draftIsForPrev) &&
        ((prevNote.title || "") !== (draft.title || "") || (prevNote.content || "") !== (draft.content || ""));

      if (hasUnsavedEdits) {
        try {
          // Do not block the whole UI with busy for a background save.
          // Also: if a save is already in-flight, guardedSave will queue.
          if (alive) setSaveStatus("saving");
          await guardedSave(prevSelectedId, { title: draft.title, content: draft.content }, { setBusyFlag: false });

          if (!alive) return;

          // If save still ended as error, prompt the user; never lose edits silently.
          if (saveStatus === "error") {
            const discard = window.confirm(
              `We couldn't save your changes:\n\n${saveError || "Failed to save note."}\n\nDiscard changes and switch notes?`
            );
            if (!discard) {
              setSelectedId(prevSelectedId);
              return;
            }
          }
        } catch (e) {
          if (!alive) return;
          const message = e instanceof Error ? e.message : "Failed to save note.";
          const discard = window.confirm(
            `We couldn't save your changes:\n\n${message}\n\nDiscard changes and switch notes?`
          );
          if (!discard) {
            setSelectedId(prevSelectedId);
            return;
          }
        }
      }

      // Safe to switch draft to the new selected note.
      prevSelectedIdRef.current = nextSelectedId;
      setSaveError("");
      setSaveStatus("idle");

      if (!nextSelectedId) {
        setDraft(null);
        return;
      }

      const next = notes.find((n) => n.id === nextSelectedId) || null;
      setDraft(next);
    }

    handleSelectionChange();
    return () => {
      alive = false;
    };
    // Intentionally omit saveStatus/saveError from deps to avoid re-running selection logic due to save churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedNote, notes, draft]);

  // Initial load
  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
      setSaveError("");
      setSaveStatus("idle");
      try {
        const loaded = await listNotes();
        if (!alive) return;
        const sorted = sortByMostRecentlyUpdated(Array.isArray(loaded) ? loaded : []);
        setNotes(sorted);

        if (sorted.length > 0) {
          setSelectedId((prev) => prev || sorted[0].id);
        } else {
          setSelectedId(null);
        }
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load notes.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [backendEnabled]);

  // Debounced autosave (race-safe via tokens + cancellation on selection switch)
  useEffect(() => {
    if (!draft || !draft.id) return;

    const current = notes.find((n) => n.id === draft.id) || null;
    if (!current) return;

    const titleChanged = (current.title || "") !== (draft.title || "");
    const contentChanged = (current.content || "") !== (draft.content || "");
    const changed = titleChanged || contentChanged;

    if (!changed) {
      // If no changes, reflect saved/idle depending on whether we are currently saving.
      if (!inflightRef.current && !queuedSaveRef.current) setSaveStatus("saved");
      return;
    }

    // Mark as dirty immediately for responsive UX.
    setSaveStatus("dirty");
    setSaveError("");

    cancelScheduledSave();
    // Schedule save (debounce)
    saveTimerRef.current = window.setTimeout(() => {
      // Ensure we only autosave the currently selected note (active editor note).
      // If the user has already switched, selection effect handles saving separately.
      if (selectedId !== draft.id) return;

      guardedSave(draft.id, { title: draft.title, content: draft.content }, { setBusyFlag: false, markStatus: true });
    }, 450);

    return () => {
      // If draft changes again within debounce window, this cleanup cancels it.
      cancelScheduledSave();
    };
  }, [draft, notes, selectedId]);

  // Keyboard shortcuts:
  // - Cmd/Ctrl+N => create new note
  // - Cmd/Ctrl+F => focus search
  const handleCreate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const created = await createNote({ title: "Untitled", content: "" });

      // Always keep most recently updated first.
      setNotes((prev) => sortByMostRecentlyUpdated([created, ...prev]));
      setSelectedId(created.id);
      setQuery("");
      // allow editor draft to initialize immediately
      setDraft(created);
      setSaveStatus("saved");
      setSaveError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create note.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      // Settings modal: ESC closes.
      if (e.key === "Escape") {
        setSettingsOpen(false);
        return;
      }

      const isAccel = e.ctrlKey || e.metaKey;
      if (!isAccel) return;

      const key = e.key.toLowerCase();

      if (key === "n") {
        e.preventDefault();
        handleCreate();
        return;
      }

      if (key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCreate]);

  const handleSelect = useCallback((id) => {
    setSelectedId(id);
  }, []);

  const handleDraftChange = useCallback((patch) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
    });
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedNote) return;
    const ok = window.confirm(`Delete "${selectedNote.title || "Untitled"}"? This cannot be undone.`);
    if (!ok) return;

    // Cancel autosave work for this note to avoid late saves after delete.
    cancelScheduledSave();
    queuedSaveRef.current = null;
    inflightRef.current = null;

    setBusy(true);
    setError("");
    try {
      const deletingId = selectedNote.id;
      await deleteNote(deletingId);

      // Compute remaining from latest state, sort, and then select next logical note.
      setNotes((prev) => {
        const remainingSorted = sortByMostRecentlyUpdated(prev.filter((n) => n.id !== deletingId));
        const nextId = pickNextSelectionAfterDelete(remainingSorted, deletingId);

        // Keep selection/draft in sync as part of the same state transition.
        setSelectedId(nextId);
        setDraft(nextId ? remainingSorted.find((n) => n.id === nextId) || null : null);
        setSaveStatus("idle");
        setSaveError("");

        return remainingSorted;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete note.");
    } finally {
      setBusy(false);
    }
  }, [selectedNote]);

  return (
    <div className="appShell">
      <div className="topBar" role="banner">
        <div className="topBarInner">
          <div className="topBarLeft">
            <div className="statusDot" aria-hidden="true" />
            <div className="topBarTitle">Ocean Notes</div>
            <div className="topBarSub">{backendEnabled ? "Synced" : "Local"}</div>
          </div>

          <div className="topBarRight">
            <span
              className={`modePill ${backendEnabled ? "modePillSynced" : "modePillLocal"}`}
              data-testid="persistence-mode-indicator"
              title="Current persistence mode (driven by env configuration)"
            >
              {getPersistenceModeLabel()}
            </span>

            <button
              className="iconBtn"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen ? "true" : "false"}
              data-testid="persistence-settings-button"
            >
              Settings
            </button>

            {busy ? <span className="pill pillBusy">Working…</span> : <span className="pill">Ready</span>}
          </div>
        </div>

        {error ? (
          <div className="errorBanner" role="alert">
            <strong>Error:</strong> <span>{error}</span>
          </div>
        ) : null}
      </div>

      {settingsOpen ? (
        <div
          className="modalOverlay"
          role="presentation"
          onMouseDown={(e) => {
            // Close when clicking outside the modal content.
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
          data-testid="persistence-settings-modal"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Persistence settings"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <div className="modalTitle">Persistence mode</div>
                <div className="modalSub">
                  Current: <strong>{getPersistenceModeLabel()}</strong>
                </div>
              </div>
              <button className="iconBtn" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close">
                Close
              </button>
            </div>

            <div className="modalBody">
              <p className="modalP">
                Ocean Notes can run in <strong>Local (browser)</strong> mode or <strong>Synced (backend)</strong> mode.
                This app selects the mode automatically based on environment variables at build/runtime.
              </p>

              <div className="modalCallout">
                <div className="modalCalloutTitle">How to switch modes</div>
                <div className="modalCalloutText">
                  Set either <span className="kbd">REACT_APP_API_BASE</span> or <span className="kbd">REACT_APP_BACKEND_URL</span>{" "}
                  and then reload/restart the app.
                </div>
              </div>

              <p className="modalP">
                No backend configuration is done inside the UI. If you change env vars, you must refresh the page (and
                typically restart <span className="kbd">npm start</span>) for changes to take effect.
              </p>
            </div>

            <div className="modalFooter">
              <button className="btn" type="button" onClick={() => setSettingsOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="layout">
        <NotesList
          notes={notes}
          selectedId={selectedId}
          query={query}
          onQueryChange={setQuery}
          onCreate={handleCreate}
          onSelect={handleSelect}
          loading={loading}
          backendEnabled={backendEnabled}
          formatUpdatedAt={formatUpdatedAt}
          // internal ref wiring: attach after render
          ref={undefined}
        />

        {/* Attach searchInputRef to the actual DOM input via querySelector as NotesList is simple */}
        <SearchRefBinder query={query} inputRef={searchInputRef} />

        <NoteEditor
          note={draft}
          loading={loading}
          onChange={handleDraftChange}
          onDelete={handleDelete}
          onCreateFirst={handleCreate}
          formatUpdatedAt={formatUpdatedAt}
          saveStatus={saveStatus}
          saveError={saveError}
        />
      </div>
    </div>
  );
}

/**
 * Helper component to bind a ref to the search input in the sidebar without adding ref-forwarding
 * complexity to NotesList (keeping components lightweight).
 * @param {{inputRef: any, query: string}} props
 */
function SearchRefBinder({ inputRef, query }) {
  useEffect(() => {
    inputRef.current = document.getElementById("noteSearch");
  }, [inputRef, query]);

  return null;
}

export default App;
