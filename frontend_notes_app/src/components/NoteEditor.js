import React from "react";

/**
 * @param {object} props
 * @param {object|null} props.note
 * @param {boolean} props.loading
 * @param {(patch: {title?: string, content?: string}) => void} props.onChange
 * @param {() => void} props.onDelete
 * @param {() => void} props.onCreateFirst
 */
function NoteEditor({ note, loading, onChange, onDelete, onCreateFirst }) {
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
            <div className="emptyTitle">Select a note</div>
            <div className="emptyText">Choose a note from the sidebar, or create a new one.</div>
            <button className="btn btnPrimary" onClick={onCreateFirst} type="button">
              Create a note
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="editor" aria-label="Editor">
      <div className="editorCard">
        <div className="editorHeader">
          <div>
            <div className="editorKicker">Editor</div>
            <div className="editorMeta">
              <span className="pill">Autosaved</span>
              <span className="dot" aria-hidden="true" />
              <span className="muted">
                Updated {new Date(note.updatedAt || Date.now()).toLocaleString()}
              </span>
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
            placeholder="Write your note… (Markdown optional)"
          />
        </label>

        <div className="hint">
          Tip: Use <span className="kbd">Ctrl</span> / <span className="kbd">⌘</span> +{" "}
          <span className="kbd">K</span> to focus search.
        </div>
      </div>
    </main>
  );
}

export default NoteEditor;
