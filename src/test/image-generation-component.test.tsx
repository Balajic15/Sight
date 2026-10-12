import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ImageGeneration } from "@/components/assistant-ui/elements/image-generation";
import { ShimmerLabel } from "@/components/assistant-ui/surfaces";

describe("ImageGeneration Element Component", () => {
  it("renders with data-slot='image-generation' and default resolution", () => {
    const { container } = render(
      <ImageGeneration prompt="A calm mountain lake at dawn" generating={true} />,
    );

    const slotElement = container.querySelector('[data-slot="image-generation"]');
    expect(slotElement).toBeDefined();
    expect(slotElement).not.toBeNull();
    expect(screen.getByText("1024 × 1024")).toBeDefined();
  });

  it("renders an 8x8 grid of 64 dots with staggered delay", () => {
    const { container } = render(<ImageGeneration prompt="Futuristic city" generating={true} />);

    const grid = container.querySelector(".grid-cols-8");
    expect(grid).not.toBeNull();
    expect(grid?.children.length).toBe(64);
  });

  it("shows shimmering generating label when generating is true", () => {
    render(<ImageGeneration prompt="A white cat sitting by the window" generating={true} />);

    expect(screen.getByText(/Generating/)).toBeDefined();
    expect(screen.getByText(/A white cat sitting by the window/)).toBeDefined();
  });

  it("disables and hides regenerate button while generating is true", () => {
    const onRegenerate = vi.fn();
    render(
      <ImageGeneration prompt="A serene beach" generating={true} onRegenerate={onRegenerate} />,
    );

    const button = screen.getByRole("button", { hidden: true });
    expect(button).toBeDefined();
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(button);
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it("displays prompt and enables regenerate button when generating is false", () => {
    const onRegenerate = vi.fn();
    render(
      <ImageGeneration
        prompt="A calm mountain lake at dawn"
        generating={false}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByText("A calm mountain lake at dawn")).toBeDefined();

    const button = screen.getByRole("button", { name: "Regenerate image" });
    expect(button).toBeDefined();
    expect(button).toHaveProperty("disabled", false);

    fireEvent.click(button);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("renders custom resolution when provided", () => {
    render(
      <ImageGeneration prompt="Custom resolution" generating={false} resolution="512 × 512" />,
    );

    expect(screen.getByText("512 × 512")).toBeDefined();
  });

  it("renders ShimmerLabel with font-mono and animated shimmer class", () => {
    const { container } = render(<ShimmerLabel shimmer={true}>Generating…</ShimmerLabel>);

    const span = container.querySelector("span");
    expect(span?.textContent).toBe("Generating…");
    expect(span?.className).toContain("font-mono");
    expect(span?.className).toContain("animate-shimmer");
  });
});
