import type { Settings } from "./store";
import { sessionLatencyTracker } from "./session-latency";

export interface ScreenCleanupResult {
  released: boolean;
  error?: string | undefined;
}

export class ScreenShareService {
  private static instance: ScreenShareService;
  private screenStream: MediaStream | null = null;
  private onTrackEndedCallback: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): ScreenShareService {
    if (!ScreenShareService.instance) {
      ScreenShareService.instance = new ScreenShareService();
    }
    return ScreenShareService.instance;
  }

  public setOnTrackEnded(callback: (() => void) | null) {
    this.onTrackEndedCallback = callback;
  }

  public async start(settings: Settings): Promise<MediaStream> {
    this.stop();
    const isHigh = settings.screenQuality === "high";
    sessionLatencyTracker.mark("permission_requested");
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: isHigh ? 1920 : 1280 },
        height: { ideal: isHigh ? 1080 : 720 },
        frameRate: { ideal: isHigh ? 30 : 15, max: isHigh ? 30 : 15 },
      },
    });

    sessionLatencyTracker.mark("permission_granted");
    sessionLatencyTracker.mark("screen_capture_ready");

    this.screenStream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        this.stop();
        this.onTrackEndedCallback?.();
      };
    }
    return stream;
  }

  public stop(): ScreenCleanupResult {
    let released = true;
    let errMessage: string | undefined;
    if (this.screenStream) {
      try {
        this.screenStream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch (e) {
            released = false;
            errMessage = (e as Error).message;
          }
        });
      } catch (e) {
        released = false;
        errMessage = (e as Error).message;
      }
      this.screenStream = null;
    }
    return { released, error: errMessage };
  }

  public getStream(): MediaStream | null {
    return this.screenStream;
  }

  public isActive(): boolean {
    return this.screenStream !== null;
  }

  public pause(): boolean {
    if (!this.screenStream) return false;
    this.screenStream.getVideoTracks().forEach((t) => {
      t.enabled = false;
    });
    return true;
  }

  public resume(): boolean {
    if (!this.screenStream) return false;
    this.screenStream.getVideoTracks().forEach((t) => {
      t.enabled = true;
    });
    return true;
  }
}

export const screenShareService = ScreenShareService.getInstance();
