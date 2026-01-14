import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

test("renders notes app shell and persistence indicator", () => {
  render(<App />);
  expect(screen.getByText(/Ocean Notes/i)).toBeInTheDocument();

  const mode = screen.getByTestId("persistence-mode-indicator");
  expect(mode).toBeInTheDocument();
  // default CI env typically has no backend vars, but we don't hardcode the exact text.
  expect(mode.textContent).toMatch(/Local \(browser\)|Synced \(backend\)/);
});

test("opens persistence settings modal", () => {
  render(<App />);
  fireEvent.click(screen.getByTestId("persistence-settings-button"));
  expect(screen.getByTestId("persistence-settings-modal")).toBeInTheDocument();
  expect(screen.getByText(/How to switch modes/i)).toBeInTheDocument();
});
