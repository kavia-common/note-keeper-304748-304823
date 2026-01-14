import React, { useMemo } from "react";

/**
 * @param {object} props
 * @param {Array} props.notes
 * @param {string|null} props.selectedId
 * @param {string} props.query
 * @param {(q: string) => void} props.onQueryChange
 * @param {() => void} props.onCreate
 * @param {(id: string) => void} props.onSelect
 * @param {boolean} props.loading
 * @param {boolean} props.backendEnabled
 */
function NotesList({ notes, selectedId, query, onQueryChange, onCreate, onSelect, loading, backendEnabled }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;

    return notes.filter((n) => {
      const title = (n.title || "").toLowerCase();
      const content = (n.content || "").toLowerCase();
      return title.includes(q) || content.includes(q);
    });
  }, [notes, query]);

  return (
    <aside className="sidebar" aria-label="Notes list">
      <div className="sidebarTop">
        <div className="brand">
          <div className="brandMark" aria-hidden="true" />
          <div className="brandText">
            <div className="brandTitle">Ocean Notes</div>
            <div className="brandSub">
              {backendEnabled ? "Synced (backend)" : "Local (browser)"}
            </div>
          </div>
        </div>

        <button className="btn btnPrimary btnBlock" onClick={onCreate} type="button">
          New note
        </button>

        <label className="field" htmlFor="noteSearch">
          <span className="fieldLabel">Search</span>
          <input
            id="noteSearch"
            className="input"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter by title or content…"
            type="search"
          />
        </label>
      </div>

      <div className="sidebarList" role="list">
        {loading ? (
          <div className="listSkeleton">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="noteRowSkeleton" key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="emptyState compact" role="status" aria-live="polite">
            <div className="emptyTitle">{notes.length === 0 ? "No notes yet" : "No matches"}</div>
            <div className="emptyText">
              {notes.length === 0
                ? "Create your first note to get started."
                : "Try a different search term."}
            </div>
            {notes.length === 0 && (
              <button className="btn btnSecondary" onClick={onCreate} type="button">
                Create a note
              </button>
            )}
          </div>
        ) : (
          filtered.map((n) => {
            const isActive = n.id === selectedId;
            const subtitle = (n.content || "").trim().split("\n").find(Boolean) || "No content";
            return (
              <button
                key={n.id}
                className={`noteRow ${isActive ? "active" : ""}`}
                onClick={() => onSelect(n.id)}
                type="button"
                role="listitem"
                aria-current={isActive ? "true" : "false"}
              >
                <div className="noteRowTitle">{n.title || "Untitled"}</div>
                <div className="noteRowSub">{subtitle}</div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

export default NotesList;
