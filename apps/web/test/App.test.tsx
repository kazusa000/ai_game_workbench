import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";

afterEach(() => {
  cleanup();
});

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

  it("exposes generation prompts and custom image size as editable controls", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /AI Sprite Animator/i }));

    const imagePrompt = screen.getByLabelText(/^Image Prompt$/i);
    fireEvent.change(imagePrompt, { target: { value: "front-facing pixel knight" } });
    expect(imagePrompt).toHaveValue("front-facing pixel knight");

    const imageInstructions = screen.getByLabelText(/Image Prompt Instructions/i);
    fireEvent.change(imageInstructions, { target: { value: "use a flat magenta background" } });
    expect(imageInstructions).toHaveValue("use a flat magenta background");

    const imageSize = screen.getByLabelText(/Image Generation Size/i);
    fireEvent.change(imageSize, { target: { value: "768" } });
    expect(imageSize).toHaveValue(768);

    const finalImagePrompt = screen.getByLabelText(/Final Image Prompt/i);
    fireEvent.change(finalImagePrompt, { target: { value: "final custom square pixel-art prompt" } });
    expect(finalImagePrompt).toHaveValue("final custom square pixel-art prompt");

    const videoBasePrompt = screen.getByLabelText(/Video Base Prompt/i);
    fireEvent.change(videoBasePrompt, { target: { value: "single sprite, locked camera" } });
    expect(videoBasePrompt).toHaveValue("single sprite, locked camera");

    const templatePrompt = screen.getByLabelText(/Template Prompt/i);
    fireEvent.change(templatePrompt, { target: { value: "front-facing run cycle" } });
    expect(templatePrompt).toHaveValue("front-facing run cycle");

    const actionPrompt = screen.getByLabelText(/Action Prompt/i);
    fireEvent.change(actionPrompt, { target: { value: "running forward in place" } });
    expect(actionPrompt).toHaveValue("running forward in place");

    const finalVideoPrompt = screen.getByLabelText(/Final Video Prompt/i);
    fireEvent.change(finalVideoPrompt, { target: { value: "final custom seedance prompt" } });
    expect(finalVideoPrompt).toHaveValue("final custom seedance prompt");
  });
});
