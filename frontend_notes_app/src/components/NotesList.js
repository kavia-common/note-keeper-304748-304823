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
 * @param {(value: number|string|Date) => string} props.formatUpdatedAt
 */
function NotesList({
  notes,
  selectedId,
  query,
  onQueryChange,
  onCreate,
  onSelect,
  loading,
  backendEnabled,
  formatUpdatedAt,
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;

    return notes.filter((n) => {
      const title = (n.title || "").toLowerCase();
      const content = (n.content || "").toLowerCase();
      return title.includes(q) || content.includes(q);
    });
  }, [notes, query]);

  /**
   * Keyboard navigation for the note list:
   * - ArrowUp/ArrowDown selects previous/next note (single-select)
   * - Home/End select first/last
   * This preserves native Tab navigation (Tab goes into the list, then to the focused option).
   * @param {React.KeyboardEvent} e
   */
  function onListKeyDown(e) {
    if (loading) return;
    if (!filtered.length) return;

    const key = e.key;
    const keysWeHandle = ["ArrowUp", "ArrowDown", "Home", "End"];
    if (!keysWeHandle.includes(key)) return;

    e.preventDefault();

    const currentIndex = Math.max(
      0,
      filtered.findIndex((n) => n.id === selectedId)
    );

    let nextIndex = currentIndex;

    if (key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
    if (key === "ArrowDown") nextIndex = Math.min(filtered.length - 1, currentIndex + 1);
    if (key === "Home") nextIndex = 0;
    if (key === "End") nextIndex = filtered.length - 1;

    const next = filtered[nextIndex];
    if (!next?.id) return;

    onSelect(next.id);

    // Move focus to the newly selected row for better screen reader & keyboard continuity.
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`noteRow_${next.id}`);
      el?.focus?.();
    });
  }

  const emptyTitle = notes.length === 0 ? "No notes yet" : "No matches";
  const emptyText = notes.length === 0 ? "Create your first note in Ocean Notes." : "Try a different search.";

  return (
    <aside className="sidebar" aria-label="Notes sidebar">
      <div className="sidebarTop">
        <div className="brand">
          <div className="brandMark" aria-hidden="true" />
          <div className="brandText">
            <div className="brandTitle">Ocean Notes</div>
            <div className="brandSub">{backendEnabled ? "Synced (backend)" : "Local (browser)"}</div>
          </div>
        </div>

        <button className="btn btnPrimary btnBlock" onClick={onCreate} type="button" aria-label="New note">
          New note
        </button>

        <label className="field" htmlFor="noteSearch">
          <span className="fieldLabel">Search</span>
          <input
            id="noteSearch"
            className="input"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search notes…"
            type="search"
            aria-label="Search notes"
            autoComplete="off"
          />
        </label>
      </div>

      {/* Use proper list semantics + listbox for single-select keyboard navigation */}
      <div className="sidebarList">
        {loading ? (
          <div className="listSkeleton" role="status" aria-live="polite" aria-label="Loading notes">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="noteRowSkeleton" key={i} aria-hidden="true" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="emptyState compact" role="status" aria-live="polite">
            <div className="emptyTitle">{emptyTitle}</div>
            <div className="emptyText">{emptyText}</div>
            {notes.length === 0 && (
              <button className="btn btnSecondary" onClick={onCreate} type="button" aria-label="Create your first note">
                Create a note
              </button>
            )}
          </div>
        ) : (
          <ul
            role="listbox"
            aria-label="Notes"
            aria-activedescendant={selectedId ? `noteRow_${selectedId}` : undefined}
            aria-busy={loading ? "true" : "false"}
            onKeyDown={onListKeyDown}
            style={{ listStyle: "none", padding: 0, margin: 0 }}
          >
            {filtered.map((n) => {
              const isActive = n.id === selectedId;
              const snippet = (n.content || "").trim().split("\n").find(Boolean) || "No content yet";
              const updatedLabel = formatUpdatedAt?.(n.updatedAt || n.createdAt || Date.now());
              const title = n.title || "Untitled";

              return (
                <li key={n.id} role="presentation">
                  <button
                    id={`noteRow_${n.id}`}
                    className={`noteRow ${isActive ? "active" : ""}`}
                    onClick={() => onSelect(n.id)}
                    type="button"
                    role="option"
                    aria-selected={isActive ? "true" : "false"}
                    aria-label={`${title}${updatedLabel ? `, updated ${updatedLabel}` : ""}`}
                    tabIndex={isActive ? 0 : -1}
                  >
                    <div className="noteRowTitle">{title}</div>
                    <div className="noteRowSub">{updatedLabel ? `Updated ${updatedLabel} • ${snippet}` : snippet}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

export default NotesList;
