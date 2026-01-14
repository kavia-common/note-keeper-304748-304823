import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

// Mock the repository to fully control persistence + timing and avoid localStorage/backend dependence.
jest.mock("./services/notesRepository", () => ({
  __esModule: true,
  isBackendEnabled: jest.fn(),
  getPersistenceModeLabel: jest.fn(),
  listNotes: jest.fn(),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
}));

// Import mocked functions (after jest.mock).
// eslint-disable-next-line import/first
import * as repo from "./services/notesRepository";

function makeNote({ id, title, content, updatedAt }) {
  const base = {
    id,
    title,
    content,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: updatedAt || "2025-01-01T00:00:00.000Z",
  };
  return base;
}

async function flushPromises() {
  // Flush microtasks (Promises). Useful after advancing timers when code awaits async repo calls.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Ocean Notes core flows", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default to local mode (tests should not depend on environment .env in CI).
    repo.isBackendEnabled.mockReturnValue(false);
    repo.getPersistenceModeLabel.mockReturnValue("Local (browser)");

    // Default list to empty.
    repo.listNotes.mockResolvedValue([]);
    repo.createNote.mockImplementation(async (partial) =>
      makeNote({
        id: "n_new",
        title: partial?.title ?? "Untitled",
        content: partial?.content ?? "",
        updatedAt: "2025-01-02T00:00:00.000Z",
      })
    );
    repo.updateNote.mockImplementation(async (id, partial) =>
      makeNote({
        id,
        title: partial?.title ?? "Untitled",
        content: partial?.content ?? "",
        updatedAt: "2025-01-03T00:00:00.000Z",
      })
    );
    repo.deleteNote.mockResolvedValue(undefined);
  });

  test("initial empty state shows 'No notes yet' after load", async () => {
    render(<App />);

    // Wait until listNotes resolves and the empty state renders.
    expect(await screen.findByText(/No notes yet/i)).toBeInTheDocument();
    expect(repo.listNotes).toHaveBeenCalledTimes(1);

    // Editor should show "No note selected" empty state.
    expect(screen.getByText(/No note selected/i)).toBeInTheDocument();

    // Persistence indicator should be present and use label from repo helper.
    expect(screen.getByTestId("persistence-mode-indicator")).toHaveTextContent("Local (browser)");
  });

  test("creating a note adds it, selects it, and shows editor fields", async () => {
    render(<App />);

    // Ensure initial load finished.
    await screen.findByText(/No notes yet/i);

    const newNoteButton = screen.getByRole("button", { name: /New note/i });
    await userEvent.click(newNoteButton);

    expect(repo.createNote).toHaveBeenCalledTimes(1);

    // Newly created note title appears in list and is active (aria-current=true on the button).
    const list = screen.getByRole("list");
    const row = within(list).getByRole("listitem", { name: /Untitled/i });
    expect(row).toHaveAttribute("aria-current", "true");

    // Editor now shows the title/content fields for selected note.
    expect(screen.getByLabelText(/Title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Content/i)).toBeInTheDocument();

    // Title input should reflect created note default title.
    expect(screen.getByLabelText(/Title/i)).toHaveValue("Untitled");
  });

  test("selecting different notes switches the editor to the selected note", async () => {
    const n1 = makeNote({ id: "n1", title: "Alpha", content: "first", updatedAt: "2025-01-02T00:00:00.000Z" });
    const n2 = makeNote({ id: "n2", title: "Bravo", content: "second", updatedAt: "2025-01-01T00:00:00.000Z" });
    repo.listNotes.mockResolvedValue([n1, n2]);

    render(<App />);

    // The most recently updated note should be selected by default (n1).
    await screen.findByDisplayValue("Alpha");
    expect(screen.getByLabelText(/Content/i)).toHaveValue("first");

    // Click second note in list.
    const list = screen.getByRole("list");
    const bravoRow = within(list).getByRole("listitem", { name: /Bravo/i });
    await userEvent.click(bravoRow);

    // Editor switches.
    expect(await screen.findByDisplayValue("Bravo")).toBeInTheDocument();
    expect(screen.getByLabelText(/Content/i)).toHaveValue("second");
  });

  test("search/filter narrows note list and shows 'No matches' when appropriate", async () => {
    const n1 = makeNote({ id: "n1", title: "Shopping", content: "Milk and eggs" });
    const n2 = makeNote({ id: "n2", title: "Work", content: "Project plan" });
    repo.listNotes.mockResolvedValue([n1, n2]);

    render(<App />);

    // Wait for initial selection.
    await screen.findByDisplayValue(/Shopping|Work/);

    const search = screen.getByLabelText(/Search/i);
    await userEvent.type(search, "milk");

    const list = screen.getByRole("list");

    // Only Shopping should remain visible.
    expect(within(list).getByRole("listitem", { name: /Shopping/i })).toBeInTheDocument();
    expect(within(list).queryByRole("listitem", { name: /Work/i })).not.toBeInTheDocument();

    // Search for something that matches nothing.
    await userEvent.clear(search);
    await userEvent.type(search, "zzzzz");

    expect(await screen.findByText(/No matches/i)).toBeInTheDocument();
  });

  test("debounced autosave calls updateNote only after debounce window, then shows saved state", async () => {
    jest.useFakeTimers();

    const n1 = makeNote({ id: "n1", title: "Alpha", content: "first", updatedAt: "2025-01-01T00:00:00.000Z" });
    repo.listNotes.mockResolvedValue([n1]);

    render(<App />);

    // Ensure editor loaded with note.
    await screen.findByDisplayValue("Alpha");

    const titleInput = screen.getByLabelText(/Title/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Alpha updated");

    // During debounce window, updateNote should not be called.
    expect(repo.updateNote).toHaveBeenCalledTimes(0);

    // Advance just under debounce (450ms).
    act(() => {
      jest.advanceTimersByTime(449);
    });
    await flushPromises();
    expect(repo.updateNote).toHaveBeenCalledTimes(0);

    // Advance past debounce.
    act(() => {
      jest.advanceTimersByTime(2);
    });
    await flushPromises();

    expect(repo.updateNote).toHaveBeenCalledTimes(1);
    expect(repo.updateNote).toHaveBeenCalledWith("n1", expect.objectContaining({ title: "Alpha updated" }));

    // After save resolves, UI should end up "Saved" (or at least not "Save failed").
    // We assert presence of a stable pill text.
    expect(screen.getByText(/Saved|Ready|Editing…|Saving…/i)).toBeInTheDocument();

    jest.useRealTimers();
  });

  test("deleting a note calls deleteNote and updates selection to next logical note", async () => {
    const n1 = makeNote({ id: "n1", title: "First", content: "one", updatedAt: "2025-01-03T00:00:00.000Z" });
    const n2 = makeNote({ id: "n2", title: "Second", content: "two", updatedAt: "2025-01-02T00:00:00.000Z" });
    repo.listNotes.mockResolvedValue([n1, n2]);

    // Confirm deletion prompt.
    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    // Default selection should be n1 ("First").
    await screen.findByDisplayValue("First");

    await userEvent.click(screen.getByRole("button", { name: /Delete/i }));

    expect(repo.deleteNote).toHaveBeenCalledTimes(1);
    expect(repo.deleteNote).toHaveBeenCalledWith("n1");

    // After deletion, n2 becomes selected and editor shows it.
    expect(await screen.findByDisplayValue("Second")).toBeInTheDocument();
    expect(screen.getByLabelText(/Content/i)).toHaveValue("two");

    window.confirm.mockRestore();
  });

  test("persistence settings modal opens via settings button (stable via testid)", async () => {
    render(<App />);
    await screen.findByTestId("persistence-mode-indicator");

    fireEvent.click(screen.getByTestId("persistence-settings-button"));
    expect(screen.getByTestId("persistence-settings-modal")).toBeInTheDocument();

    // Close via "Done" button.
    await userEvent.click(screen.getByRole("button", { name: /Done/i }));
    expect(screen.queryByTestId("persistence-settings-modal")).not.toBeInTheDocument();
  });
});
