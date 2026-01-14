import React from "react";

/**
 * @param {object} props
 * @param {object|null} props.note
 * @param {boolean} props.loading
 * @param {(patch: {title?: string, content?: string}) => void} props.onChange
 * @param {() => void} props.onDelete
 * @param {() => void} props.onCreateFirst
 * @param {(value: number|string|Date) => string} props.formatUpdatedAt
 * @param {"idle"|"dirty"|"saving"|"saved"|"error"} [props.saveStatus]
 * @param {string} [props.saveError]
 */
function NoteEditor({
  note,
  loading,
  onChange,
  onDelete,
  onCreateFirst,
  formatUpdatedAt,
  saveStatus = "idle",
  saveError = "",
}) {
  if (loading) {
    return (
      <main className="editor" aria-label="Editor">
        <div className="editorCard">
          <div className="editorHeader">
            <div className="skeleton skeletonTitle" />
            <div className="skeleton skeletonPill" />
          </div>
          <div className="skeleton skeletonInput" />
          <div className="skeleton skeletonTextarea" />
        </div>
      </main>
    );
  }

  if (!note) {
    return (
      <main className="editor" aria-label="Editor">
        <div className="editorCard">
          <div className="emptyState" role="status" aria-live="polite">
            <div className="emptyTitle">No note selected</div>
            <div className="emptyText">Select a note from the sidebar, or create a new one.</div>
            <button className="btn btnPrimary" onClick={onCreateFirst} type="button">
              Create a note
            </button>
          </div>
        </div>
      </main>
    );
  }

  const updatedLabel = formatUpdatedAt?.(note.updatedAt || Date.now());

  const statusLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "dirty"
        ? "Editing…"
        : saveStatus === "error"
          ? "Save failed"
          : saveStatus === "saved"
            ? "Saved"
            : "Ready";

  const statusPillClass = saveStatus === "saving" || saveStatus === "dirty" ? "pill pillBusy" : "pill";

  return (
    <main className="editor" aria-label="Editor">
      <div className="editorCard">
        <div className="editorHeader">
          <div>
            <div className="editorKicker">Editor</div>
            <div className="editorMeta" aria-live="polite">
              <span className={statusPillClass}>{statusLabel}</span>
              {updatedLabel ? (
                <>
                  <span className="dot" aria-hidden="true" />
                  <span className="muted">Updated {updatedLabel}</span>
                </>
              ) : null}
              {saveStatus === "error" && saveError ? (
                <>
                  <span className="dot" aria-hidden="true" />
                  <span className="muted" title={saveError}>
                    Could not save (changes kept locally)
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <button className="btn btnDanger" onClick={onDelete} type="button">
            Delete
          </button>
        </div>

        <label className="field" htmlFor="noteTitle">
          <span className="fieldLabel">Title</span>
          <input
            id="noteTitle"
            className="input inputTitle"
            value={note.title || ""}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Untitled"
          />
        </label>

        <label className="field" htmlFor="noteContent">
          <span className="fieldLabel">Content</span>
          <textarea
            id="noteContent"
            className="textarea"
            value={note.content || ""}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder="Write your note…"
          />
        </label>

        <div className="hint">
          Shortcuts: <span className="kbd">Ctrl</span> / <span className="kbd">⌘</span> + <span className="kbd">N</span>{" "}
          new note, <span className="kbd">Ctrl</span> / <span className="kbd">⌘</span> + <span className="kbd">F</span>{" "}
          search.
        </div>
      </div>
    </main>
  );
}

export default NoteEditor;
