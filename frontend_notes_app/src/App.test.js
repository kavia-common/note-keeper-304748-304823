import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders notes app shell", () => {
  render(<App />);
  expect(screen.getByText(/Ocean Notes/i)).toBeInTheDocument();
});
