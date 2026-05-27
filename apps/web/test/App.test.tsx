import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("App", () => {
  it("opens the AI Sprite Animator module from the workbench hub", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /AI Game Workbench/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /AI Sprite Animator/i }));

    expect(screen.getByRole("heading", { name: /AI Sprite Animator/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload First Frame/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate First Frame/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Direction/i)).toHaveValue("front");
    expect(screen.getByLabelText(/Asset Key/i)).toHaveValue("hero_mecha");
    expect(screen.getByLabelText(/Animation Key/i)).toHaveValue("idle");
  });
});
