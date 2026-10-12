import type { Settings } from "./store";
import { sessionLatencyTracker } from "./session-latency";

export interface CameraCleanupResult {
  released: boolean;
  error?: string | undefined;
}

export class CameraService {
  private static instance: CameraService;
  private cameraStream: MediaStream | null = null;
  private facingMode: "environment" | "user" = "environment";
  private isTorchOn = false;
  private onTrackEndedCallback: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): CameraService {
    if (!CameraService.instance) {
      CameraService.instance = new CameraService();
    }
    return CameraService.instance;
  }

  public setOnTrackEnded(callback: (() => void) | null) {
    this.onTrackEndedCallback = callback;
  }

  public async start(settings: Settings): Promise<MediaStream> {
    this.stop();
    const is1080p = settings.cameraResolution === "1080p";
    const facing = settings.cameraFacing || this.facingMode;
    sessionLatencyTracker.mark("permission_requested");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width: { ideal: is1080p ? 1920 : 1280 },
        height: { ideal: is1080p ? 1080 : 720 },
      },
    });

    sessionLatencyTracker.mark("permission_granted");
    sessionLatencyTracker.mark("camera_ready");

    this.cameraStream = stream;
    this.facingMode = facing;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        this.stop();
        this.onTrackEndedCallback?.();
      };
    }
    return stream;
  }

  public stop(): CameraCleanupResult {
    let released = true;
    let errMessage: string | undefined;
    if (this.cameraStream) {
      try {
        this.cameraStream.getTracks().forEach((t) => {
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
      this.cameraStream = null;
    }
    this.isTorchOn = false;
    return { released, error: errMessage };
  }

  public async flip(settings: Settings, videoElement?: HTMLVideoElement | null): Promise<boolean> {
    const nextFacing = this.facingMode === "environment" ? "user" : "environment";
    this.facingMode = nextFacing;

    try {
      const stream = await this.start({
        ...settings,
        cameraFacing: nextFacing,
      });
      if (stream && videoElement) {
        videoElement.srcObject = stream;
        await videoElement.play().catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  public async toggleTorch(): Promise<boolean> {
    if (!this.cameraStream) return false;
    const track = this.cameraStream.getVideoTracks()[0];
    if (!track) return false;

    try {
      const next = !this.isTorchOn;
      // @ts-expect-error Torch constraint on ImageCapture
      await track.applyConstraints({ advanced: [{ torch: next }] });
      this.isTorchOn = next;
      return true;
    } catch {
      return false;
    }
  }

  public pause(): boolean {
    if (!this.cameraStream) return false;
    this.cameraStream.getVideoTracks().forEach((t) => {
      t.enabled = false;
    });
    return true;
  }

  public resume(): boolean {
    if (!this.cameraStream) return false;
    this.cameraStream.getVideoTracks().forEach((t) => {
      t.enabled = true;
    });
    return true;
  }

  public getTorchState(): boolean {
    return this.isTorchOn;
  }

  public getFacingMode(): "environment" | "user" {
    return this.facingMode;
  }

  public setFacingMode(mode: "environment" | "user") {
    this.facingMode = mode;
  }

  public getStream(): MediaStream | null {
    return this.cameraStream;
  }

  public isActive(): boolean {
    return this.cameraStream !== null;
  }
}

export const cameraService = CameraService.getInstance();
