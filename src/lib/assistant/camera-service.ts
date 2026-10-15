import type { Settings } from "./store";
import { sessionLatencyTracker } from "./session-latency";

export interface CameraCleanupResult {
  released: boolean;
  error?: string;
}

type FacingMode = "environment" | "user";

function getMediaDevices(): MediaDevices {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("Camera access is unavailable in this browser.");
  }

  return navigator.mediaDevices;
}

export class CameraService {
  private static instance: CameraService;

  private cameraStream: MediaStream | null = null;
  private facingMode: FacingMode = "environment";
  private torchOn = false;
  private startVersion = 0;
  private onTrackEndedCallback: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): CameraService {
    return (this.instance ??= new CameraService());
  }

  public setOnTrackEnded(callback: (() => void) | null): void {
    this.onTrackEndedCallback = callback;
  }

  public async start(settings: Settings): Promise<MediaStream> {
    this.stop();
    const requestVersion = ++this.startVersion;

    const facing = (settings.cameraFacing || this.facingMode) as FacingMode;
    const is1080p = settings.cameraResolution === "1080p";

    sessionLatencyTracker.mark("permission_requested");

    const stream = await getMediaDevices().getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: is1080p ? 1920 : 1280 },
        height: { ideal: is1080p ? 1080 : 720 },
      },
    });

    // A later start/stop call superseded this pending permission request.
    if (requestVersion !== this.startVersion) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Camera request was superseded.", "AbortError");
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("The camera did not provide a video track.");
    }

    this.cameraStream = stream;
    this.facingMode = facing;
    this.torchOn = false;

    track.addEventListener(
      "ended",
      () => {
        if (this.cameraStream !== stream) return;

        this.cameraStream = null;
        this.torchOn = false;
        this.onTrackEndedCallback?.();
      },
      { once: true },
    );

    sessionLatencyTracker.mark("permission_granted");
    sessionLatencyTracker.mark("camera_ready");

    return stream;
  }

  public stop(): CameraCleanupResult {
    ++this.startVersion;

    const stream = this.cameraStream;
    this.cameraStream = null;
    this.torchOn = false;

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

  public async flip(
    settings: Settings,
    videoElement?: HTMLVideoElement | null,
  ): Promise<boolean> {
    const nextFacing: FacingMode =
      this.facingMode === "environment" ? "user" : "environment";

    try {
      const stream = await this.start({
        ...settings,
        cameraFacing: nextFacing,
      });

      if (videoElement) {
        videoElement.srcObject = stream;
        await videoElement.play().catch(() => undefined);
      }

      return true;
    } catch {
      return false;
    }
  }

  public async toggleTorch(): Promise<boolean> {
    const track = this.cameraStream?.getVideoTracks()[0];

    if (!track || track.readyState !== "live") {
      return false;
    }

    const trackWithCapabilities = track as MediaStreamTrack & {
      getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
    };

    try {
      const capabilities = trackWithCapabilities.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined;

      if (!capabilities?.torch) {
        return false;
      }

      const nextState = !this.torchOn;

      await track.applyConstraints({
        advanced: [{ torch: nextState } as MediaTrackConstraintSet],
      });

      this.torchOn = nextState;
      return true;
    } catch {
      return false;
    }
  }

  public pause(): boolean {
    const tracks = this.cameraStream?.getVideoTracks() ?? [];

    if (tracks.length === 0) return false;

    tracks.forEach((track) => {
      track.enabled = false;
    });

    return true;
  }

  public resume(): boolean {
    const tracks = this.cameraStream?.getVideoTracks() ?? [];

    if (tracks.length === 0) return false;

    tracks.forEach((track) => {
      track.enabled = true;
    });

    return true;
  }

  public getTorchState(): boolean {
    return this.torchOn;
  }

  public getFacingMode(): FacingMode {
    return this.facingMode;
  }

  public setFacingMode(mode: FacingMode): void {
    this.facingMode = mode;
  }

  public getStream(): MediaStream | null {
    return this.cameraStream;
  }

  public isActive(): boolean {
    return (
      this.cameraStream?.getVideoTracks().some(
        (track) => track.readyState === "live",
      ) ?? false
    );
  }
}

export const cameraService = CameraService.getInstance();
