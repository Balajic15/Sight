import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  sessionManagerService,
  type TransitionRequest,
  type SessionEventEnvelope,
} from "@/lib/assistant/session-manager";
import { transcriptionService } from "@/lib/assistant/transcription-service";
import { cameraService } from "@/lib/assistant/camera-service";
import { screenShareService } from "@/lib/assistant/screen-share-service";
import { DEFAULT_SETTINGS } from "@/lib/assistant/store";

let mockLiveClients: any[] = [];

vi.mock("@/lib/assistant/live-client", () => {
  return {
    LiveClient: class MockLiveClient {
      public options: any;
      public playbackRate = 1.0;
      public state = "disconnected";
      public connectMock = vi.fn();
      public disconnectMock = vi.fn();
      public stopAudioPlaybackMock = vi.fn();

      constructor(options: any = {}) {
        this.options = options;
        mockLiveClients.push(this);
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

      public startVideoStreaming() {}
    },
  };
});

describe("SessionManagerService - Engineering Contracts & Boundaries", () => {
  function createMockTrack() {
    return {
      stop: vi.fn(),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
      onended: null as any,
      readyState: "live" as MediaStreamTrackState,
    };
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
    await sessionManagerService.stop();
    mockLiveClients = [];

    // @ts-expect-error Mocking mediaDevices
    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockImplementation(() => Promise.resolve(createMockStream())),
      getDisplayMedia: vi.fn().mockImplementation(() => Promise.resolve(createMockStream())),
    };
  });

  afterEach(async () => {
    await sessionManagerService.stop();
    vi.restoreAllMocks();
  });

  it("Contract: getSnapshot returns fully typed SessionSnapshot", async () => {
    const initialSnapshot = sessionManagerService.getSnapshot();
    expect(initialSnapshot.state).toBe("IDLE");
    expect(initialSnapshot.activeConversationId).toBeNull();
    expect(initialSnapshot.connectionStatus).toBe("disconnected");

    const req: TransitionRequest = {
      conversationId: "convo-101",
      targetInteraction: "VOICE",
      reason: "USER_REQUEST",
      settings: DEFAULT_SETTINGS,
    };
    await sessionManagerService.switchInteraction(req);

    const activeSnapshot = sessionManagerService.getSnapshot();
    expect(activeSnapshot.state).toBe("VOICE_ACTIVE");
    expect(activeSnapshot.activeConversationId).toBe("convo-101");
    expect(activeSnapshot.activeInteraction).toBe("VOICE");
    expect(activeSnapshot.connectionStatus).toBe("connected");
    expect(activeSnapshot.microphoneStatus).toBe("active");
  });

  it("Contract: stopActiveSession returns awaitable CleanupResult", async () => {
    await sessionManagerService.switchInteraction({
      conversationId: "convo-102",
      targetInteraction: "VIDEO",
      reason: "USER_REQUEST",
      settings: DEFAULT_SETTINGS,
    });

    const cleanup = await sessionManagerService.stopActiveSession("User closed session");
    expect(cleanup.completed).toBe(true);
    expect(cleanup.failedResources).toEqual([]);
    expect(sessionManagerService.context.state).toBe("IDLE");
  });

  it("Contract: CleanupResult accurately reports partial resource failure", async () => {
    await sessionManagerService.switchInteraction({
      conversationId: "convo-103",
      targetInteraction: "VIDEO",
      reason: "USER_REQUEST",
      settings: DEFAULT_SETTINGS,
    });

    // Simulate camera track stop error
    vi.spyOn(cameraService, "stop").mockReturnValueOnce({
      released: false,
      error: "Device busy",
    });

    const cleanup = await sessionManagerService.stopActiveSession("Test failure");
    expect(cleanup.completed).toBe(false);
    expect(cleanup.failedResources).toContain("camera");
  });

  it("Invariant: Normal Text Chat never plays AI audio or keeps realtime live tracks", async () => {
    // Start active voice
    await sessionManagerService.switchInteraction({
      conversationId: "convo-104",
      targetInteraction: "VOICE",
      reason: "USER_REQUEST",
      settings: DEFAULT_SETTINGS,
    });
    const liveClient = mockLiveClients[0];

    // Transition to TEXT_CHAT
    await sessionManagerService.switchInteraction({
      conversationId: "convo-104",
      targetInteraction: "TEXT_CHAT",
      reason: "USER_REQUEST",
    });

    expect(liveClient.disconnectMock).toHaveBeenCalled();
    expect(sessionManagerService.context.state).toBe("IDLE");
    expect(sessionManagerService.context.audioPlaybackStatus).toBe("idle");
    expect(cameraService.isActive()).toBe(false);
    expect(screenShareService.isActive()).toBe(false);
  });

  it("Contract: TranscriptionService validates SessionEventEnvelope and drops stale conversation events", () => {
    const userTranscriptSpy = vi.fn();
    transcriptionService.setCallbacks({
      onUserTranscription: userTranscriptSpy,
    });

    const validEnvelope: SessionEventEnvelope<string> = {
      sessionId: "session-1",
      conversationId: "convo-A",
      transitionId: "trans-1",
      event: "Valid message chunk",
      timestamp: Date.now(),
    };

    // Correct session and conversation
    const ok = transcriptionService.routeUserTranscription(validEnvelope, "session-1", "convo-A");
    expect(ok).toBe(true);
    expect(userTranscriptSpy).toHaveBeenCalledWith(validEnvelope);

    // Mismatched conversation (stale chunk from previous convo)
    const droppedConvo = transcriptionService.routeUserTranscription(
      validEnvelope,
      "session-1",
      "convo-B",
    );
    expect(droppedConvo).toBe(false);

    // Mismatched session (superseded connection)
    const droppedSession = transcriptionService.routeUserTranscription(
      validEnvelope,
      "session-2",
      "convo-A",
    );
    expect(droppedSession).toBe(false);
  });

  it("Transition Matrix: Rejects invalid direct jumps", () => {
    expect(sessionManagerService.context.state).toBe("IDLE");

    const invalidJump = (sessionManagerService as any).transitionTo("VOICE_ACTIVE");
    expect(invalidJump).toBe(false);
    expect(sessionManagerService.context.state).toBe("IDLE");
  });
});
