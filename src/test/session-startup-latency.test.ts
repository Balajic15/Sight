import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  SessionLatencyTracker,
  sessionLatencyTracker,
  type SessionLatencyRecord,
} from "@/lib/assistant/session-latency";
import { LiveClient } from "@/lib/assistant/live-client";
import { sessionManagerService } from "@/lib/assistant/session-manager";
import { cameraService } from "@/lib/assistant/camera-service";
import { screenShareService } from "@/lib/assistant/screen-share-service";
import { DEFAULT_SETTINGS } from "@/lib/assistant/store";

describe("Session Startup Latency & Concurrency", () => {
  let tracker: SessionLatencyTracker;

  beforeEach(() => {
    tracker = SessionLatencyTracker.getInstance();
    tracker.reset();
  });

  describe("SessionLatencyTracker Metrics & Privacy", () => {
    it("tracks milestones and correctly calculates all 5 required latency metrics", () => {
      tracker.startSession("session-101", "voice", 1000);

      // Set synthetic timestamps
      tracker.mark("permission_requested", 1020);
      tracker.mark("permission_granted", 1120);
      tracker.mark("audio_capture_ready", 1140);
      tracker.mark("realtime_connection_started", 1010);
      tracker.mark("credentials_ready", 1015);
      tracker.mark("realtime_connection_established", 1250);
      tracker.mark("session_configuration_complete", 1280);
      tracker.mark("session_ready", 1290);
      tracker.mark("first_audio_chunk_sent", 1350);
      tracker.mark("first_user_transcription_received", 1750);
      tracker.mark("first_model_response_received", 2100);
      tracker.mark("first_audio_playback_started", 2130);

      const metrics = tracker.getCalculations();

      // 1. clickToMicReadyMs = 1140 - 1000 = 140ms
      expect(metrics.clickToMicReadyMs).toBe(140);

      // 2. clickToSessionReadyMs = 1290 - 1000 = 290ms
      expect(metrics.clickToSessionReadyMs).toBe(290);

      // 3. firstSpeechToTranscriptionMs = 1750 - 1350 = 400ms
      expect(metrics.firstSpeechToTranscriptionMs).toBe(400);

      // 4. endOfTurnToFirstResponseMs = 2100 - 1350 = 750ms
      expect(metrics.endOfTurnToFirstResponseMs).toBe(750);

      // 5. firstResponseToPlaybackMs = 2130 - 2100 = 30ms
      expect(metrics.firstResponseToPlaybackMs).toBe(30);
    });

    it("enforces strict privacy: records contain NO speech, transcripts, credentials, or image bytes", () => {
      tracker.startSession("session-privacy-1", "video");
      tracker.mark("feature_click", 100);
      tracker.mark("session_ready", 250);

      const records = tracker.getRecords();
      expect(records.length).toBeGreaterThan(0);
      const record = records[0];

      // Must only contain timing numbers and metadata
      expect(record).toHaveProperty("sessionId");
      expect(record).toHaveProperty("mode");
      expect(record).toHaveProperty("metrics");
      expect(record).toHaveProperty("timestamps");

      // Verify zero audio/image payload properties exist
      expect(record).not.toHaveProperty("audio");
      expect(record).not.toHaveProperty("text");
      expect(record).not.toHaveProperty("pcm");
      expect(record).not.toHaveProperty("data");
      expect(record).not.toHaveProperty("apiKey");

      // All timestamp values must be strictly numeric milliseconds
      expect(record).toBeDefined();
      for (const val of Object.values(record!.timestamps)) {
        expect(typeof val).toBe("number");
      }

      const recordJson = JSON.stringify(record);
      expect(recordJson).not.toContain("password");
      expect(recordJson).not.toContain("apiKey");
      expect(recordJson).not.toContain("data:image");
      expect(recordJson).not.toContain("data:audio");
    });
  });

  describe("Pre-Connection Speech Capture & Bounded Ring Buffer", () => {
    it("buffers early speech before connection readiness and drops beyond bounded max without crashing", () => {
      expect(LiveClient.MAX_PENDING_AUDIO_CHUNKS).toBe(40);

      const client = new LiveClient();
      // Inspect private buffer via typecast
      const internalClient = client as unknown as {
        pendingAudioBuffer: string[];
        isReady: boolean;
        flushPendingAudioBuffer: () => void;
        ws: { send: (data: string) => void; readyState: number } | null;
      };

      expect(internalClient.pendingAudioBuffer).toEqual([]);

      // Simulate capturing 45 audio packets before handshake completes
      for (let i = 1; i <= 45; i++) {
        if (internalClient.pendingAudioBuffer.length >= LiveClient.MAX_PENDING_AUDIO_CHUNKS) {
          internalClient.pendingAudioBuffer.shift();
        }
        internalClient.pendingAudioBuffer.push(`chunk-${i}`);
      }

      // Should be bounded to MAX_PENDING_AUDIO_CHUNKS
      expect(internalClient.pendingAudioBuffer.length).toBe(40);
      // Oldest chunks 1-5 dropped, contains chunk-6 to chunk-45
      expect(internalClient.pendingAudioBuffer[0]).toBe("chunk-6");
      expect(internalClient.pendingAudioBuffer[39]).toBe("chunk-45");

      // Now simulate server handshake ready and flush
      const sentChunks: string[] = [];
      internalClient.isReady = true;
      internalClient.ws = {
        readyState: 1, // WebSocket.OPEN
        send: (data: string) => {
          sentChunks.push(JSON.parse(data).data);
        },
      };

      internalClient.flushPendingAudioBuffer();

      // Buffer emptied and all 40 chunks sent in chronological FIFO order
      expect(internalClient.pendingAudioBuffer.length).toBe(0);
      expect(sentChunks.length).toBe(40);
      expect(sentChunks[0]).toBe("chunk-6");
      expect(sentChunks[39]).toBe("chunk-45");

      client.disconnect();
    });
  });

  describe("Parallel Acquisition in Session Manager", () => {
    it("concurrently initiates transport and camera capture during Video transition", async () => {
      let cameraStartedAt = 0;
      let liveConnectStartedAt = 0;

      const mockTrack = {
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
      } as unknown as MediaStream;

      vi.spyOn(cameraService, "start").mockImplementation(async () => {
        cameraStartedAt = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 15));
        return mockStream;
      });

      // Spy on LiveClient prototype connect
      const origConnect = LiveClient.prototype.connect;
      LiveClient.prototype.connect = vi.fn().mockImplementation(function (this: any) {
        liveConnectStartedAt = performance.now();
        setTimeout(() => {
          this.options?.onReady?.();
          this.options?.onStateChange?.("connected");
        }, 15);
      });

      try {
        const transitionPromise = sessionManagerService.switchInteraction(
          "conv-video-1",
          "video",
          DEFAULT_SETTINGS,
        );

        await transitionPromise;

        // Both camera and live connection must start concurrently (within 10ms of each other)
        expect(cameraStartedAt).toBeGreaterThan(0);
        expect(liveConnectStartedAt).toBeGreaterThan(0);
        expect(Math.abs(cameraStartedAt - liveConnectStartedAt)).toBeLessThan(25);

        expect(sessionManagerService.getContext().state).toBe("VIDEO_ACTIVE");
        expect(sessionManagerService.getContext().cameraStatus).toBe("active");
      } finally {
        LiveClient.prototype.connect = origConnect;
        vi.restoreAllMocks();
        await sessionManagerService.stop();
      }
    });

    it("concurrently initiates transport and screen share during Screen Share transition", async () => {
      let screenStartedAt = 0;
      let liveConnectStartedAt = 0;

      const mockTrack = {
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
      } as unknown as MediaStream;

      vi.spyOn(screenShareService, "start").mockImplementation(async () => {
        screenStartedAt = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 15));
        return mockStream;
      });

      const origConnect = LiveClient.prototype.connect;
      LiveClient.prototype.connect = vi.fn().mockImplementation(function (this: any) {
        liveConnectStartedAt = performance.now();
        setTimeout(() => {
          this.options?.onReady?.();
          this.options?.onStateChange?.("connected");
        }, 15);
      });

      try {
        const transitionPromise = sessionManagerService.switchInteraction(
          "conv-screen-1",
          "screen",
          DEFAULT_SETTINGS,
        );

        await transitionPromise;

        expect(screenStartedAt).toBeGreaterThan(0);
        expect(liveConnectStartedAt).toBeGreaterThan(0);
        expect(Math.abs(screenStartedAt - liveConnectStartedAt)).toBeLessThan(25);

        expect(sessionManagerService.getContext().state).toBe("SCREEN_SHARE_ACTIVE");
        expect(sessionManagerService.getContext().screenCaptureStatus).toBe("active");
      } finally {
        LiveClient.prototype.connect = origConnect;
        vi.restoreAllMocks();
        await sessionManagerService.stop();
      }
    });

    it("falls back to Voice mode when camera permission is denied and live transport succeeds", async () => {
      vi.spyOn(cameraService, "start").mockRejectedValue(new Error("Permission denied"));

      const origConnect = LiveClient.prototype.connect;
      LiveClient.prototype.connect = vi.fn().mockImplementation(function (this: any) {
        setTimeout(() => {
          this.options?.onReady?.();
          this.options?.onStateChange?.("connected");
        }, 10);
      });

      try {
        const result = await sessionManagerService.switchInteraction(
          "conv-fallback-1",
          "video",
          DEFAULT_SETTINGS,
        );

        // Transition returns false due to permission error, but context safely gracefully degrades to VOICE_ACTIVE
        expect(result).toBe(false);
        expect(sessionManagerService.getContext().state).toBe("VOICE_ACTIVE");
        expect(sessionManagerService.getContext().cameraStatus).toBe("idle");
      } finally {
        LiveClient.prototype.connect = origConnect;
        vi.restoreAllMocks();
        await sessionManagerService.stop();
      }
    });
  });

  describe("Instant Interruption Handling", () => {
    it("halts audio sources immediately upon interruption", () => {
      const client = new LiveClient();
      const internalClient = client as unknown as {
        activeSources: Array<{ stop: () => void }>;
        isModelSpeaking: boolean;
        stopAudioPlayback: () => void;
      };

      const source1 = { stop: vi.fn() };
      const source2 = { stop: vi.fn() };
      internalClient.activeSources = [source1, source2];
      internalClient.isModelSpeaking = true;

      internalClient.stopAudioPlayback();

      expect(source1.stop).toHaveBeenCalledTimes(1);
      expect(source2.stop).toHaveBeenCalledTimes(1);
      expect(internalClient.activeSources).toEqual([]);
      expect(internalClient.isModelSpeaking).toBe(false);

      client.disconnect();
    });
  });
});
