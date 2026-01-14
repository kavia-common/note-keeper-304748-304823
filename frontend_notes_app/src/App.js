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

  // Keep draft in sync when switching selection or when notes update.
  useEffect(() => {
    if (!selectedNote) {
      setDraft(null);
      return;
    }
    setDraft(selectedNote);
  }, [selectedNote?.id]); // intentionally only when selection changes

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
        setNotes(loaded);

        if (loaded.length > 0) {
          setSelectedId((prev) => prev || loaded[0].id);
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
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)).sort((a, b) => b.updatedAt - a.updatedAt));
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

  // Keyboard shortcut: Ctrl/Cmd+K to focus search.
  useEffect(() => {
    function onKeyDown(e) {
      const isK = e.key.toLowerCase() === "k";
      if (!isK) return;
      const isAccel = e.ctrlKey || e.metaKey;
      if (!isAccel) return;
      e.preventDefault();
      searchInputRef.current?.focus?.();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleCreate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const created = await createNote({ title: "Untitled", content: "" });
      setNotes((prev) => [created, ...prev]);
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
      setNotes((prev) => prev.filter((n) => n.id !== selectedNote.id));

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
            <div className="topBarTitle">Notes</div>
            <div className="topBarSub">Ocean Professional</div>
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
