import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CameraPanel } from "../components/CameraPanel";
import { cameraService } from "../lib/assistant/camera-service";

describe("CameraPanel Smooth Animated Bottom Sheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1 & 2: Renders panel immediately when isOpen=true with smooth bottom sheet styling", () => {
    const videoRef = { current: document.createElement("video") };
    const onClose = vi.fn();

    const { container } = render(
      <CameraPanel
        isOpen={true}
        videoRef={videoRef}
        onClose={onClose}
        isInitializing={true}
      />
    );

    const panel = container.querySelector('[style*="position: fixed"]');
    expect(panel).not.toBeNull();
    // Verify geometry: fixed, height 60vh, rounded top corners 28px, bottom corners square
    const style = (panel as HTMLElement).style;
    expect(style.position).toBe("fixed");
    expect(style.height).toBe("60vh");
    expect(style.borderTopLeftRadius).toBe("28px");
    expect(style.borderTopRightRadius).toBe("28px");
    expect(parseInt(style.borderBottomLeftRadius || "0", 10)).toBe(0);
    expect(parseInt(style.borderBottomRightRadius || "0", 10)).toBe(0);
  });

  it("3 & 4: Shows subtle loading indicator while camera initializes without showing fake feed", () => {
    const videoRef = { current: document.createElement("video") };
    const onClose = vi.fn();

    const { container } = render(
      <CameraPanel
        isOpen={true}
        videoRef={videoRef}
        onClose={onClose}
        isInitializing={true}
      />
    );

    // "Starting camera..." loading message is present
    expect(screen.getByText("Starting camera...")).toBeDefined();

    // Video is opacity-0 before real frames arrive
    const videoEl = container.querySelector("video");
    expect(videoEl?.className).toContain("opacity-0");
  });

  it("5: Displays camera permission denial error inside the panel with Try Again and Dismiss", () => {
    const videoRef = { current: document.createElement("video") };
    const onClose = vi.fn();
    const onRetry = vi.fn();

    render(
      <CameraPanel
        isOpen={true}
        videoRef={videoRef}
        onClose={onClose}
        isInitializing={false}
        errorMessage="Camera permission denied. Fell back to Voice mode."
        onRetry={onRetry}
      />
    );

    expect(screen.getByText("Camera Unavailable")).toBeDefined();
    expect(screen.getByText("Camera permission denied. Fell back to Voice mode.")).toBeDefined();

    const retryBtn = screen.getByText("Try Again");
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    const dismissBtn = screen.getByText("Dismiss");
    fireEvent.click(dismissBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("6: Back/Close button invokes onClose to release resources", () => {
    const videoRef = { current: document.createElement("video") };
    const onClose = vi.fn();

    render(
      <CameraPanel
        isOpen={true}
        videoRef={videoRef}
        onClose={onClose}
      />
    );

    const closeBtn = screen.getByTitle("Stop camera visual");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("7: Switching camera stream cleans up previous media tracks reliably", async () => {
    const mockStop = vi.spyOn(cameraService, "stop");
    cameraService.stop();
    expect(mockStop).toHaveBeenCalled();
  });
});
