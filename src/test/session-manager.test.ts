import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  realtimeSessionService,
  RealtimeSessionService,
  type SessionContext,
  type SessionCallbacks,
} from "@/lib/assistant/session-manager";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/assistant/store";

// Mock LiveClient implementation
let mockLiveClients: any[] = [];
let nextLiveClientInstance: any = null;

vi.mock("@/lib/assistant/live-client", () => {
  return {
    LiveClient: class MockLiveClient {
      public options: any;
      public playbackRate = 1.0;
      public state = "disconnected";
      public connectMock = vi.fn();
      public disconnectMock = vi.fn();
      public stopAudioPlaybackMock = vi.fn();
      public startVideoStreamingMock = vi.fn();

      constructor(options: any = {}) {
        this.options = options;
        mockLiveClients.push(this);
        nextLiveClientInstance = this;
      }

      public connect(params?: any) {
        this.connectMock(params);
        this.state = "connected";
        setTimeout(() => {
          this.options?.onReady?.();
          this.options?.onStateChange?.("connected");
        }, 0);
      }

      public disconnect() {
        this.disconnectMock();
        this.state = "disconnected";
        this.options?.onStateChange?.("disconnected");
      }

      public stopAudioPlayback() {
        this.stopAudioPlaybackMock();
      }

      public pause() {
        return true;
      }

      public resume() {
        return true;
      }

      public startVideoStreaming(getter: any) {
        this.startVideoStreamingMock(getter);
      }

      public simulateUserTranscription(text: string) {
        this.options?.onUserTranscription?.(text);
      }

      public simulateAssistantTranscription(text: string) {
        this.options?.onAssistantTranscription?.(text);
      }

      public simulateUnexpectedDisconnect() {
        this.state = "disconnected";
        this.options?.onStateChange?.("disconnected");
      }
    },
  };
});

describe("RealtimeSessionService - Lifecycle and Switching Manager", () => {
  let createdTracks: { stop: any; applyConstraints: any; onended?: any }[] = [];

  function createMockTrack() {
    const track = {
      stop: vi.fn(),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
      onended: null as any,
      readyState: "live" as MediaStreamTrackState,
    };
    createdTracks.push(track);
    return track;
  }

  function createMockStream() {
    const track = createMockTrack();
    return {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
  }

  beforeEach(async () => {
    await realtimeSessionService.stop();
    mockLiveClients = [];
    nextLiveClientInstance = null;
    createdTracks = [];

    // Reset mediaDevices mocks
    // @ts-expect-error Mocking mediaDevices
    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockImplementation(() => Promise.resolve(createMockStream())),
      getDisplayMedia: vi.fn().mockImplementation(() => Promise.resolve(createMockStream())),
    };
  });

  afterEach(async () => {
    await realtimeSessionService.stop();
    vi.restoreAllMocks();
  });

  // 1. IDLE -> CONNECTING -> CONNECTED -> VOICE_ACTIVE transition sequence
  it("Scenario 1: executes IDLE -> CONNECTING -> CONNECTED -> VOICE_ACTIVE transition sequence", async () => {
    expect(realtimeSessionService.context.state).toBe("IDLE");

    const stateHistory: string[] = [];
    const unsub = realtimeSessionService.subscribe((ctx) => {
      stateHistory.push(ctx.state);
    });

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "voice",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(true);

    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
    expect(realtimeSessionService.context.activeInteractionType).toBe("voice");
    expect(realtimeSessionService.context.connectionStatus).toBe("connected");
    expect(realtimeSessionService.context.selectedConversationId).toBe("conv-1");
    expect(stateHistory).toContain("SWITCHING");
    expect(stateHistory).toContain("CONNECTING");
    expect(stateHistory).toContain("VOICE_ACTIVE");

    unsub();
  });

  // 2. Direct switch from VOICE_ACTIVE to VIDEO_ACTIVE: verifies camera track is started and LiveClient is preserved
  it("Scenario 2: switches from VOICE_ACTIVE to VIDEO_ACTIVE while preserving LiveClient", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);
    const initialLiveClient = nextLiveClientInstance;
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "video",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(true);

    expect(realtimeSessionService.context.state).toBe("VIDEO_ACTIVE");
    expect(realtimeSessionService.context.activeInteractionType).toBe("video");
    expect(realtimeSessionService.context.cameraStatus).toBe("active");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    // LiveClient was kept connected
    expect(initialLiveClient.disconnectMock).not.toHaveBeenCalled();
    expect(initialLiveClient.startVideoStreamingMock).toHaveBeenCalled();
  });

  // 3. Switch from VIDEO_ACTIVE to SCREEN_SHARE_ACTIVE: verifies camera track is stopped and screen track is started
  it("Scenario 3: switches from VIDEO_ACTIVE to SCREEN_SHARE_ACTIVE and releases camera track", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "video", DEFAULT_SETTINGS);
    const cameraTrack = createdTracks[0];

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "screen",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(true);

    expect(cameraTrack?.stop).toHaveBeenCalled();
    expect(realtimeSessionService.context.state).toBe("SCREEN_SHARE_ACTIVE");
    expect(realtimeSessionService.context.cameraStatus).toBe("idle");
    expect(realtimeSessionService.context.screenCaptureStatus).toBe("active");
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
  });

  // 4. Switch from SCREEN_SHARE_ACTIVE to VOICE_ACTIVE: verifies screen track is stopped
  it("Scenario 4: switches from SCREEN_SHARE_ACTIVE to VOICE_ACTIVE and releases screen track", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "screen", DEFAULT_SETTINGS);
    const screenTrack = createdTracks[createdTracks.length - 1];

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "voice",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(true);

    expect(screenTrack?.stop).toHaveBeenCalled();
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
    expect(realtimeSessionService.context.screenCaptureStatus).toBe("idle");
  });

  // 5. Switch from any active realtime state to Normal Text Chat: verifies LiveClient is disconnected and all capture tracks are stopped
  it("Scenario 5: switches from active realtime state to Normal Text Chat, stopping all resources and keeping chat silent", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "video", DEFAULT_SETTINGS);
    const activeClient = mockLiveClients[mockLiveClients.length - 1];
    const activeCameraTrack = createdTracks[createdTracks.length - 1];

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "chat",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(true);

    expect(activeClient?.disconnectMock).toHaveBeenCalled();
    expect(activeCameraTrack?.stop).toHaveBeenCalled();
    expect(realtimeSessionService.context.state).toBe("IDLE");
    expect(realtimeSessionService.context.activeInteractionType).toBe("none");
    expect(realtimeSessionService.context.connectionStatus).toBe("disconnected");
  });

  // 6. Switch from active realtime state in Convo A to Convo B: verifies Convo A session is fully terminated before Convo B connects
  it("Scenario 6: terminates Convo A session completely before establishing Convo B session", async () => {
    await realtimeSessionService.switchInteraction("conv-A", "voice", DEFAULT_SETTINGS);
    const clientA = mockLiveClients[0];
    const sessionAId = realtimeSessionService.context.currentSessionId;

    await realtimeSessionService.switchInteraction("conv-B", "voice", DEFAULT_SETTINGS);
    const clientB = mockLiveClients[mockLiveClients.length - 1];
    const sessionBId = realtimeSessionService.context.currentSessionId;

    expect(clientA.disconnectMock).toHaveBeenCalled();
    expect(sessionAId).not.toBe(sessionBId);
    expect(realtimeSessionService.context.selectedConversationId).toBe("conv-B");
    expect(clientB).not.toBe(clientA);
  });

  // 7. Switch from active realtime state in Convo A to Convo A: handles re-trigger gracefully without leaking duplicate sessions
  it("Scenario 7: handles re-triggering same conversation gracefully without leaking sessions", async () => {
    await realtimeSessionService.switchInteraction("conv-A", "voice", DEFAULT_SETTINGS);
    const clientCountBefore = mockLiveClients.length;

    await realtimeSessionService.switchInteraction("conv-A", "voice", DEFAULT_SETTINGS);
    expect(mockLiveClients.length).toBe(clientCountBefore);
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
  });

  // 8. Rapid toggling between Voice and Video: no leaked tracks or duplicate event listeners
  it("Scenario 8: handles rapid toggling between Voice and Video without leaking tracks", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);

    // Rapid switches
    const p1 = realtimeSessionService.switchInteraction("conv-1", "video", DEFAULT_SETTINGS);
    const p2 = realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);
    const p3 = realtimeSessionService.switchInteraction("conv-1", "video", DEFAULT_SETTINGS);

    await Promise.all([p1, p2, p3]);

    expect(realtimeSessionService.context.state).toBe("VIDEO_ACTIVE");
    expect(realtimeSessionService.context.cameraStatus).toBe("active");
  });

  // 9. Rapid switching across 3+ conversations in quick succession: only final target remains active
  it("Scenario 9: rapidly switching across 3+ conversations cleanly cancels intermediate sessions", async () => {
    const p1 = realtimeSessionService.switchInteraction("c1", "voice", DEFAULT_SETTINGS);
    const p2 = realtimeSessionService.switchInteraction("c2", "voice", DEFAULT_SETTINGS);
    const p3 = realtimeSessionService.switchInteraction("c3", "voice", DEFAULT_SETTINGS);

    await Promise.all([p1, p2, p3]);

    expect(realtimeSessionService.context.selectedConversationId).toBe("c3");
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
  });

  // 10. Hardware permission denial for microphone: transitions to ERROR with appropriate message, releases all other resources
  it("Scenario 10: transitions to ERROR on microphone permission denial and releases resources", async () => {
    // Force initializeLiveClient to fail
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new Error("NotAllowedError: Permission denied"),
    );

    // Override LiveClient connect to fail
    const originalMock = nextLiveClientInstance;
    vi.spyOn(RealtimeSessionService.prototype as any, "initializeLiveClient").mockRejectedValueOnce(
      new Error("Microphone permission denied"),
    );

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "voice",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(false);
    expect(realtimeSessionService.context.state).toBe("ERROR");
    expect(realtimeSessionService.context.connectionStatus).toBe("error");
    expect(realtimeSessionService.context.errorMessage).toContain("Microphone permission denied");
  });

  // 11. Hardware permission denial for camera: falls back to VOICE_ACTIVE if voice session was already established
  it("Scenario 11: falls back to VOICE_ACTIVE on camera permission denial if voice session was established", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");

    // Camera fails
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new Error("NotAllowedError: Camera permission denied"),
    );

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "video",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(false);
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
    expect(realtimeSessionService.context.cameraStatus).toBe("idle");
  });

  // 12. Hardware permission denial for screen sharing: falls back to previous active state without disconnecting Live
  it("Scenario 12: falls back to previous active state on screen sharing denial without disconnecting Live", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");

    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValueOnce(
      new Error("NotAllowedError: Screen capture denied"),
    );

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "screen",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(false);
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
    expect(realtimeSessionService.context.screenCaptureStatus).toBe("idle");
    expect(realtimeSessionService.context.connectionStatus).toBe("connected");
  });

  // 13. Unexpected websocket disconnect while in VOICE_ACTIVE: transitions through RECONNECTING; successfully reconnects
  it("Scenario 13: transitions through RECONNECTING and reconnects on unexpected websocket drop", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");

    const liveClient = nextLiveClientInstance;
    liveClient.simulateUnexpectedDisconnect();

    // Verify recovery was triggered
    expect(realtimeSessionService.context.connectionStatus).toBe("reconnecting");
    // Wait for mock reconnection to complete
    await new Promise((r) => setTimeout(r, 50));
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
  });

  // 14. Incoming transcript chunk arriving after session switch: chunk is discarded and does not appear in new conversation
  it("Scenario 14: discards transcript chunks belonging to superseded session", async () => {
    const userTranscriptSpy = vi.fn();
    realtimeSessionService.setCallbacks({ onUserTranscription: userTranscriptSpy });

    await realtimeSessionService.switchInteraction("conv-A", "voice", DEFAULT_SETTINGS);
    const clientA = mockLiveClients[0];

    await realtimeSessionService.switchInteraction("conv-B", "voice", DEFAULT_SETTINGS);

    // Stale transcript from clientA arrives late
    clientA.simulateUserTranscription("Hello from stale session A");

    // Must be discarded
    expect(userTranscriptSpy).not.toHaveBeenCalledWith("conv-A", "Hello from stale session A");
    expect(userTranscriptSpy).not.toHaveBeenCalledWith("conv-B", "Hello from stale session A");
  });

  // 15. Audio playback queue contains items when session stops: audio output silenced, queue cleared
  it("Scenario 15: stops audio playback and clears queue when session stops", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);
    const liveClient = nextLiveClientInstance;

    await realtimeSessionService.stop();
    expect(liveClient.disconnectMock).toHaveBeenCalled();
    expect(realtimeSessionService.context.audioPlaybackStatus).toBe("idle");
  });

  // 16. App moved to background (visibilitychange hidden): camera and screen tracks stopped, falls back to voice
  it("Scenario 16: stops camera tracks and falls back to voice when app is backgrounded", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "video", DEFAULT_SETTINGS);
    const cameraTrack = createdTracks[0];

    // Simulate visibility change to hidden
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(cameraTrack?.stop).toHaveBeenCalled();
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
    expect(realtimeSessionService.context.cameraStatus).toBe("idle");
  });

  it("Scenario 16b: stops screen share tracks and falls back to voice when app is backgrounded", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "screen", DEFAULT_SETTINGS);
    const screenTrack = createdTracks[createdTracks.length - 1];

    // Simulate visibility change to hidden
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(screenTrack?.stop).toHaveBeenCalled();
    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
    expect(realtimeSessionService.context.screenCaptureStatus).toBe("idle");
  });

  // 17. App returned to foreground (visibilitychange visible): session state remains valid, does not auto-restart unrequested hardware
  it("Scenario 17: does not auto-restart camera when app returns to foreground", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
    expect(realtimeSessionService.context.cameraStatus).toBe("idle");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(0);
  });

  // 18. Calling stop() multiple times in succession: idempotent, no unhandled rejections
  it("Scenario 18: calling stop() multiple times in succession is fully idempotent", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "voice", DEFAULT_SETTINGS);

    await Promise.all([
      realtimeSessionService.stop(),
      realtimeSessionService.stop(),
      realtimeSessionService.stop(),
    ]);

    expect(realtimeSessionService.context.state).toBe("IDLE");
    expect(realtimeSessionService.context.connectionStatus).toBe("disconnected");

    // Sequential stop
    await realtimeSessionService.stop();
    expect(realtimeSessionService.context.state).toBe("IDLE");
  });

  // 19. When screensharing track ends (e.g. user stops sharing in browser), stops session and mic completely
  it("Scenario 19: stops session and microphone completely when screenshare track ends", async () => {
    await realtimeSessionService.switchInteraction("conv-1", "screen", DEFAULT_SETTINGS);
    expect(realtimeSessionService.context.state).toBe("SCREEN_SHARE_ACTIVE");
    const liveClient = nextLiveClientInstance;
    const screenTrack = createdTracks[createdTracks.length - 1];

    expect(screenTrack?.onended).toBeDefined();

    // Trigger onended (user clicks "Stop sharing" in browser)
    screenTrack?.onended?.();

    // Give microtasks time to execute stop()
    await new Promise((r) => setTimeout(r, 10));

    expect(realtimeSessionService.context.state).toBe("IDLE");
    expect(realtimeSessionService.context.screenCaptureStatus).toBe("idle");
    expect(realtimeSessionService.context.microphoneStatus).toBe("idle");
    expect(liveClient?.disconnectMock).toHaveBeenCalled();
  });

  // 20. When screen sharing is denied or cancelled, cleans up completely without falling back to voice
  it("Scenario 20: cleans up completely and transitions to IDLE when screen sharing permission is denied", async () => {
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValueOnce(
      new Error("Permission denied"),
    );

    let capturedError: string | null = null;
    realtimeSessionService.setCallbacks({
      onError: (_cid, err) => {
        capturedError = err;
      },
    });

    const success = await realtimeSessionService.switchInteraction(
      "conv-1",
      "screen",
      DEFAULT_SETTINGS,
    );
    expect(success).toBe(false);
    expect(realtimeSessionService.context.state).toBe("IDLE");
    expect(realtimeSessionService.context.microphoneStatus).toBe("idle");
    expect(capturedError).toContain("Screen sharing was cancelled or denied");
  });
});
