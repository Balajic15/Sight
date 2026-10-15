import type { Settings } from "./store";
import { sessionLatencyTracker } from "./session-latency";

export interface ScreenCleanupResult {
  released: boolean;
  error?: string;
}

export class ScreenShareService {
  private static instance: ScreenShareService;

  private screenStream: MediaStream | null = null;
  private startVersion = 0;
  private onTrackEndedCallback: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): ScreenShareService {
    return (this.instance ??= new ScreenShareService());
  }

  public setOnTrackEnded(callback: (() => void) | null): void {
    this.onTrackEndedCallback = callback;
  }

  public async start(settings: Settings): Promise<MediaStream> {
    this.stop();
    const requestVersion = ++this.startVersion;

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      throw new Error(
        "Screen sharing is not supported by this browser. Try a supported desktop browser.",
      );
    }

    const highQuality = settings.screenQuality === "high";

    sessionLatencyTracker.mark("permission_requested");

    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        width: { ideal: highQuality ? 1920 : 1280 },
        height: { ideal: highQuality ? 1080 : 720 },
        frameRate: {
          ideal: highQuality ? 30 : 15,
          max: highQuality ? 30 : 15,
        },
      },
    });

    if (requestVersion !== this.startVersion) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException(
        "Screen-share request was superseded.",
        "AbortError",
      );
    }

    const track = stream.getVideoTracks()[0];

    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("Screen sharing did not provide a video track.");
    }

    this.screenStream = stream;

    track.addEventListener(
      "ended",
      () => {
        if (this.screenStream !== stream) return;

        this.screenStream = null;
        this.onTrackEndedCallback?.();
      },
      { once: true },
    );

    sessionLatencyTracker.mark("permission_granted");
    sessionLatencyTracker.mark("screen_capture_ready");

    return stream;
  }

  public stop(): ScreenCleanupResult {
    ++this.startVersion;

    const stream = this.screenStream;
    this.screenStream = null;

    if (!stream) {
      return { released: true };
    }

    const errors: string[] = [];

    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return errors.length
      ? { released: false, error: errors.join("; ") }
      : { released: true };
  }

  public getStream(): MediaStream | null {
    return this.screenStream;
  }

  public isActive(): boolean {
    return (
      this.screenStream?.getVideoTracks().some(
        (track) => track.readyState === "live",
      ) ?? false
    );
  }

  public pause(): boolean {
    const tracks = this.screenStream?.getVideoTracks() ?? [];

    if (tracks.length === 0) return false;

    tracks.forEach((track) => {
      track.enabled = false;
    });

    return true;
  }

  public resume(): boolean {
    const tracks = this.screenStream?.getVideoTracks() ?? [];

    if (tracks.length === 0) return false;

    tracks.forEach((track) => {
      track.enabled = true;
    });

    return true;
  }
}

export const screenShareService = ScreenShareService.getInstance();
