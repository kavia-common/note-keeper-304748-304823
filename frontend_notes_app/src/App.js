import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import NotesList from "./components/NotesList";
import NoteEditor from "./components/NoteEditor";
import { createNote, deleteNote, isBackendEnabled, listNotes, updateNote } from "./services/notesRepository";

/**
 * Small debounce hook to prevent writing to storage on every keystroke.
 * @param {any} value
 * @param {number} delayMs
 * @returns {any}
 */
function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

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
 * @param {Array<{updatedAt?: number}>} list
 * @returns {Array}
 */
function sortByMostRecentlyUpdated(list) {
  return [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// PUBLIC_INTERFACE
function App() {
  const backendEnabled = isBackendEnabled();

  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const searchInputRef = useRef(null);

  const selectedNote = useMemo(() => notes.find((n) => n.id === selectedId) || null, [notes, selectedId]);

  // Local editor draft to make typing instantaneous even if persistence is async.
  const [draft, setDraft] = useState(null);

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
        return;
      }

      // Not a selection switch.
      if (prevSelectedId === nextSelectedId) return;

      // Attempt to protect unsaved edits on the previous note.
      const prevNote = notes.find((n) => n.id === prevSelectedId) || null;
      const draftIsForPrev = draft?.id === prevSelectedId;

      const hasUnsavedEdits =
        Boolean(prevNote && draftIsForPrev) &&
        ((prevNote.title || "") !== (draft.title || "") || (prevNote.content || "") !== (draft.content || ""));

      if (hasUnsavedEdits) {
        try {
          setBusy(true);
          const updated = await updateNote(prevSelectedId, { title: draft.title, content: draft.content });
          if (!alive) return;

          setNotes((prev) => sortByMostRecentlyUpdated(prev.map((n) => (n.id === updated.id ? updated : n))));
        } catch (e) {
          if (!alive) return;

          const message = e instanceof Error ? e.message : "Failed to save note.";
          // Gentle confirm fallback: never lose edits silently.
          const discard = window.confirm(
            `We couldn't save your changes:\n\n${message}\n\nDiscard changes and switch notes?`
          );
          if (!discard) {
            // Revert the selection back; keep the draft in place.
            setSelectedId(prevSelectedId);
            return;
          }
        } finally {
          if (alive) setBusy(false);
        }
      }

      // Safe to switch draft to the new selected note.
      prevSelectedIdRef.current = nextSelectedId;
      if (!selectedNote) {
        setDraft(null);
      } else {
        setDraft(selectedNote);
      }
    }

    handleSelectionChange();
    return () => {
      alive = false;
    };
  }, [selectedId, selectedNote, notes, draft]);

  const debouncedDraft = useDebouncedValue(draft, 350);

  // Initial load
  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
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

  // Autosave debounced draft changes into repository + notes state
  useEffect(() => {
    let alive = true;

    async function persist() {
      if (!debouncedDraft) return;
      if (!debouncedDraft.id) return;

      // If title/content didn't change versus current notes, skip.
      const current = notes.find((n) => n.id === debouncedDraft.id);
      if (!current) return;

      const titleChanged = (current.title || "") !== (debouncedDraft.title || "");
      const contentChanged = (current.content || "") !== (debouncedDraft.content || "");
      if (!titleChanged && !contentChanged) return;

      try {
        const updated = await updateNote(debouncedDraft.id, {
          title: debouncedDraft.title,
          content: debouncedDraft.content,
        });

        if (!alive) return;
        setNotes((prev) => sortByMostRecentlyUpdated(prev.map((n) => (n.id === updated.id ? updated : n))));
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to save note.");
      }
    }

    persist();
    return () => {
      alive = false;
    };
  }, [debouncedDraft, notes]);

  // Keyboard shortcuts:
  // - Cmd/Ctrl+N => create new note
  // - Cmd/Ctrl+F => focus search
  useEffect(() => {
    function onKeyDown(e) {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create note.");
    } finally {
      setBusy(false);
    }
  }, []);

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

    setBusy(true);
    setError("");
    try {
      await deleteNote(selectedNote.id);
      setNotes((prev) => sortByMostRecentlyUpdated(prev.filter((n) => n.id !== selectedNote.id)));

      // Select next best note
      const remaining = notes.filter((n) => n.id !== selectedNote.id);
      setSelectedId(remaining[0]?.id ?? null);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete note.");
    } finally {
      setBusy(false);
    }
  }, [notes, selectedNote]);

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
            {busy ? <span className="pill pillBusy">Working…</span> : <span className="pill">Ready</span>}
          </div>
        </div>
        {error ? (
          <div className="errorBanner" role="alert">
            <strong>Error:</strong> <span>{error}</span>
          </div>
        ) : null}
      </div>

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
