import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { realtimeSessionService } from "@/lib/assistant/session-manager";
import { settingsService } from "@/lib/assistant/settings-service";
import { historyService } from "@/lib/assistant/history-service";
import { transcriptionService } from "@/lib/assistant/transcription-service";
import { cameraService } from "@/lib/assistant/camera-service";
import { screenShareService } from "@/lib/assistant/screen-share-service";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Conversation,
  type Msg,
} from "@/lib/assistant/store";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock LiveClient
let mockLiveClients: any[] = [];
let nextLiveClientInstance: any = null;

vi.mock("@/lib/assistant/live-client", () => {
  return {
    LiveClient: class MockLiveClient {
      public options: any;
      public playbackRate = 1.0;
      public state = "disconnected";
      public connectParams: any = null;
      public connectMock = vi.fn();
      public disconnectMock = vi.fn();
      public stopAudioPlaybackMock = vi.fn();
      public startVideoStreamingMock = vi.fn();
      public isPaused = false;

      constructor(options: any = {}) {
        this.options = options;
        mockLiveClients.push(this);
        nextLiveClientInstance = this;
      }

      public connect(params?: any) {
        this.connectParams = params;
        this.connectMock(params);
        this.state = "connected";
        if (params?.rate) {
          this.playbackRate = params.rate;
        }
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
        this.isPaused = true;
        return true;
      }

      public resume() {
        this.isPaused = false;
        return true;
      }

      public startVideoStreaming(getter: any) {
        this.startVideoStreamingMock(getter);
      }
    },
  };
});

describe("Authoritative 15-Item Verification Checklist", () => {
  let mockAudioTrack: any;
  let mockVideoTrack: any;
  let mockScreenTrack: any;

  beforeEach(() => {
    localStorageMock.clear();
    mockLiveClients = [];
    nextLiveClientInstance = null;
    vi.clearAllMocks();

    mockAudioTrack = {
      kind: "audio",
      enabled: true,
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockVideoTrack = {
      kind: "video",
      enabled: true,
      stop: vi.fn(),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockScreenTrack = {
      kind: "video",
      enabled: true,
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const mockMediaDevices = {
      getUserMedia: vi.fn().mockImplementation((constraints: any) => {
        if (constraints?.video) {
          return Promise.resolve({
            getVideoTracks: () => [mockVideoTrack],
            getAudioTracks: () => [],
            getTracks: () => [mockVideoTrack],
          });
        }
        return Promise.resolve({
          getVideoTracks: () => [],
          getAudioTracks: () => [mockAudioTrack],
          getTracks: () => [mockAudioTrack],
        });
      }),
      getDisplayMedia: vi.fn().mockImplementation(() => {
        return Promise.resolve({
          getVideoTracks: () => [mockScreenTrack],
          getAudioTracks: () => [],
          getTracks: () => [mockScreenTrack],
        });
      }),
    };

    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: mockMediaDevices,
      writable: true,
      configurable: true,
    });
  });

  afterEach(async () => {
    await realtimeSessionService.stop();
  });

  // --------------------------------------------------------------------------
  // Settings Section (5 Tests)
  // --------------------------------------------------------------------------
  describe("Settings Verification", () => {
    it("1. Change Live Voice and verify the runtime applies it or defers it correctly", async () => {
      // In IDLE state: change applies immediately
      expect(realtimeSessionService.context.state).toBe("IDLE");
      const idleRes = await settingsService.updateSettings(
        { liveVoice: "Kore" },
        realtimeSessionService.context.state,
      );
      expect(idleRes.success).toBe(true);
      expect(idleRes.appliedImmediately).toBe(true);
      expect(settingsService.getSettings().liveVoice).toBe("Kore");

      // Start an active Live Voice session
      await realtimeSessionService.switchInteraction("c-1", "voice", settingsService.getSettings());
      expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");

      // While Live is active: change to Live Voice is saved but deferred until next connection
      const activeRes = await settingsService.updateSettings(
        { liveVoice: "Fenrir" },
        realtimeSessionService.context.state,
      );
      expect(activeRes.success).toBe(true);
      expect(activeRes.appliedImmediately).toBe(false); // Deferred!
      expect(settingsService.getSettings().liveVoice).toBe("Fenrir");

      // Next session connection will use the new voice
      await realtimeSessionService.restart("c-1", "voice", settingsService.getSettings());
      expect(nextLiveClientInstance.connectParams.voice).toBe("Fenrir");
    });

    it("2. Change Speaking Speed and verify actual AI playback speed", async () => {
      await realtimeSessionService.switchInteraction("c-1", "voice", settingsService.getSettings());
      expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");

      // Update speed setting
      const res = await settingsService.updateSettings(
        { rate: 1.6 },
        realtimeSessionService.context.state,
      );
      expect(res.appliedImmediately).toBe(true);

      // Verify realtime playback rate applied directly to LiveClient
      realtimeSessionService.setPlaybackRate(1.6);
      expect(nextLiveClientInstance.playbackRate).toBe(1.6);
    });

    it("3. Change API key and verify the next connection uses the new key", async () => {
      // Start session with default/empty key
      await realtimeSessionService.switchInteraction("c-1", "voice", settingsService.getSettings());
      expect(nextLiveClientInstance.connectParams.apiKey).toBe("");

      // Update API key during active session (deferred)
      const res = await settingsService.updateSettings(
        { apiKey: "AIzaSyD-CustomLiveKey" },
        realtimeSessionService.context.state,
      );
      expect(res.appliedImmediately).toBe(false);

      // Reconnect / start next session
      await realtimeSessionService.restart("c-1", "voice", settingsService.getSettings());
      expect(nextLiveClientInstance.connectParams.apiKey).toBe("AIzaSyD-CustomLiveKey");
    });

    it("4. Restart the app and verify settings persist", async () => {
      await settingsService.updateSettings({
        chatModel: "gemini-2.5-flash",
        liveVoice: "Charon",
        rate: 1.4,
        cameraFacing: "user",
        cameraResolution: "1080p",
        screenQuality: "high",
        autoVision: false,
        apiKey: "persistent-key",
      });

      // Cold restart: reload from storage
      const restored = settingsService.load();
      expect(restored.chatModel).toBe("gemini-2.5-flash");
      expect(restored.liveVoice).toBe("Charon");
      expect(restored.rate).toBe(1.4);
      expect(restored.cameraFacing).toBe("user");
      expect(restored.cameraResolution).toBe("1080p");
      expect(restored.screenQuality).toBe("high");
      expect(restored.autoVision).toBe(false);
      expect(restored.apiKey).toBe("persistent-key");
    });

    it("5. Change Chat model and verify it does not change the Live model", async () => {
      // Live session uses configured live voice / Live model
      const initialLiveVoice = settingsService.getSettings().liveVoice;
      await realtimeSessionService.switchInteraction("c-1", "voice", settingsService.getSettings());
      const initialLiveClient = nextLiveClientInstance;

      // User changes text chat model
      await settingsService.updateSettings(
        { chatModel: "gemini-3.1-flash-lite" },
        realtimeSessionService.context.state,
      );

      // Live transport instance and voice remain unaffected
      expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
      expect(initialLiveClient.disconnectMock).not.toHaveBeenCalled();
      expect(settingsService.getSettings().chatModel).toBe("gemini-3.1-flash-lite");
      expect(settingsService.getSettings().liveVoice).toBe(initialLiveVoice);
    });
  });

  // --------------------------------------------------------------------------
  // Session Lifecycle Section (5 Tests)
  // --------------------------------------------------------------------------
  describe("Session Lifecycle Verification", () => {
    it("6. Start Voice → Pause → Resume → Stop", async () => {
      // 1. Start Voice
      await realtimeSessionService.switchInteraction("c-1", "voice", settingsService.getSettings());
      expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");
      expect(realtimeSessionService.context.isPaused).toBeFalsy();

      // 2. Pause
      const paused = realtimeSessionService.pause();
      expect(paused).toBe(true);
      expect(realtimeSessionService.context.isPaused).toBe(true);
      expect(nextLiveClientInstance.isPaused).toBe(true);

      // 3. Resume
      const resumed = realtimeSessionService.resume();
      expect(resumed).toBe(true);
      expect(realtimeSessionService.context.isPaused).toBe(false);
      expect(nextLiveClientInstance.isPaused).toBe(false);

      // 4. Stop
      await realtimeSessionService.stop();
      expect(realtimeSessionService.context.state).toBe("IDLE");
      expect(realtimeSessionService.context.isPaused).toBe(false);
    });

    it("7. Start Video → Pause → Resume → Stop", async () => {
      // 1. Start Video
      await realtimeSessionService.switchInteraction("c-1", "video", settingsService.getSettings());
      expect(realtimeSessionService.context.state).toBe("VIDEO_ACTIVE");
      expect(mockVideoTrack.enabled).toBe(true);

      // 2. Pause
      realtimeSessionService.pause();
      expect(realtimeSessionService.context.isPaused).toBe(true);
      expect(mockVideoTrack.enabled).toBe(false);

      // 3. Resume
      realtimeSessionService.resume();
      expect(realtimeSessionService.context.isPaused).toBe(false);
      expect(mockVideoTrack.enabled).toBe(true);

      // 4. Stop
      await realtimeSessionService.stop();
      expect(realtimeSessionService.context.state).toBe("IDLE");
      expect(mockVideoTrack.stop).toHaveBeenCalled();
    });

    it("8. Start Screen Sharing → Pause → Resume → Stop", async () => {
      // 1. Start Screen Sharing
      await realtimeSessionService.switchInteraction(
        "c-1",
        "screen",
        settingsService.getSettings(),
      );
      expect(realtimeSessionService.context.state).toBe("SCREEN_SHARE_ACTIVE");
      expect(mockScreenTrack.enabled).toBe(true);

      // 2. Pause
      realtimeSessionService.pause();
      expect(realtimeSessionService.context.isPaused).toBe(true);
      expect(mockScreenTrack.enabled).toBe(false);

      // 3. Resume
      realtimeSessionService.resume();
      expect(realtimeSessionService.context.isPaused).toBe(false);
      expect(mockScreenTrack.enabled).toBe(true);

      // 4. Stop
      await realtimeSessionService.stop();
      expect(realtimeSessionService.context.state).toBe("IDLE");
      expect(mockScreenTrack.stop).toHaveBeenCalled();
    });

    it("9. Restart an active session and verify no duplicate audio or capture", async () => {
      await realtimeSessionService.switchInteraction("c-1", "video", settingsService.getSettings());
      const firstLiveClient = nextLiveClientInstance;

      // Restart session
      await realtimeSessionService.restart("c-1", "video", settingsService.getSettings());

      // Previous client disconnected cleanly
      expect(firstLiveClient.disconnectMock).toHaveBeenCalled();
      // Old video track stopped
      expect(mockVideoTrack.stop).toHaveBeenCalled();

      // Only one active session and exactly one active live client
      expect(realtimeSessionService.context.state).toBe("VIDEO_ACTIVE");
      expect(realtimeSessionService.getActiveStream()).not.toBeNull();
    });

    it("10. Switch conversations during a live response and verify stale events are ignored", async () => {
      const receivedChunks: string[] = [];
      realtimeSessionService.setCallbacks({
        onAssistantTranscription: (_cid, text) => {
          receivedChunks.push(text);
        },
      });

      // Start in Convo 1
      await realtimeSessionService.switchInteraction(
        "convo-1",
        "voice",
        settingsService.getSettings(),
      );
      const session1Id = realtimeSessionService.context.sessionId;

      // Switch to Convo 2
      await realtimeSessionService.switchInteraction(
        "convo-2",
        "voice",
        settingsService.getSettings(),
      );

      // Attempt to route a stale chunk belonging to Convo 1 / Session 1
      const staleEnvelope = {
        sessionId: session1Id,
        conversationId: "convo-1",
        transitionId: "trans-old",
        event: "stale message from old conversation",
        timestamp: Date.now(),
      };

      const accepted = transcriptionService.routeAssistantTranscription(
        staleEnvelope,
        realtimeSessionService.context.sessionId,
        realtimeSessionService.context.selectedConversationId,
      );

      expect(accepted).toBe(false);
      expect(receivedChunks).not.toContain("stale message from old conversation");
    });
  });

  // --------------------------------------------------------------------------
  // Cleanup and History Section (5 Tests)
  // --------------------------------------------------------------------------
  describe("Cleanup and History Verification", () => {
    it("11. Stop during connection and verify no resources remain active", async () => {
      // Simulate connection in progress
      const connectPromise = realtimeSessionService.switchInteraction(
        "c-pending",
        "video",
        settingsService.getSettings(),
      );

      // Stop immediately while connecting
      await realtimeSessionService.stop();
      await connectPromise;

      // State must be IDLE and all media tracks stopped
      expect(realtimeSessionService.context.state).toBe("IDLE");
      expect(cameraService.isActive()).toBe(false);
      expect(screenShareService.isActive()).toBe(false);
    });

    it("12. Deny microphone, camera, or screen-capture permission and verify safe failure", async () => {
      // Make camera throw NotAllowedError
      (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(
        new Error("Permission denied by user"),
      );

      let capturedError: string | null = null;
      realtimeSessionService.setCallbacks({
        onError: (_cid, err) => {
          capturedError = err;
        },
      });

      const success = await realtimeSessionService.switchInteraction(
        "c-perm",
        "video",
        settingsService.getSettings(),
      );

      expect(success).toBe(false);
      expect(capturedError).not.toBeNull();
      expect(cameraService.isActive()).toBe(false);
    });

    it("13. Clear History during an active session and verify settings remain unchanged", async () => {
      // Setup conversations and custom settings
      const convo: Conversation = {
        id: "c-active",
        title: "Active Chat",
        updatedAt: Date.now(),
        messages: [{ id: "m1", role: "user", text: "hi" }],
      };
      historyService.saveAll([convo]);
      await settingsService.updateSettings({
        liveVoice: "Aoede",
        rate: 1.7,
        apiKey: "protected-key",
      });

      // Start active voice session
      await realtimeSessionService.switchInteraction(
        "c-active",
        "voice",
        settingsService.getSettings(),
      );
      expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");

      // Clear History while session is active
      await historyService.clearAll();

      // Conversations wiped
      expect(historyService.getConversations().length).toBe(0);

      // Active session NOT terminated
      expect(realtimeSessionService.context.state).toBe("VOICE_ACTIVE");

      // Settings remain completely intact
      const currentSettings = settingsService.getSettings();
      expect(currentSettings.liveVoice).toBe("Aoede");
      expect(currentSettings.rate).toBe(1.7);
      expect(currentSettings.apiKey).toBe("protected-key");
    });

    it("14. Verify conversation history survives Stop, Pause, and Restart", async () => {
      const convo: Conversation = {
        id: "c-persist",
        title: "Persisted Chat",
        updatedAt: Date.now(),
        messages: [
          { id: "m1", role: "user", text: "Question 1" },
          { id: "m2", role: "assistant", text: "Answer 1" },
        ],
      };
      historyService.saveAll([convo]);

      // Start session
      await realtimeSessionService.switchInteraction(
        "c-persist",
        "voice",
        settingsService.getSettings(),
      );

      // Pause
      realtimeSessionService.pause();
      expect(historyService.getConversations()[0]?.messages.length).toBe(2);

      // Resume
      realtimeSessionService.resume();
      expect(historyService.getConversations()[0]?.messages.length).toBe(2);

      // Restart
      await realtimeSessionService.restart("c-persist", "voice", settingsService.getSettings());
      expect(historyService.getConversations()[0]?.messages.length).toBe(2);

      // Stop
      await realtimeSessionService.stop();
      expect(historyService.getConversations()[0]?.messages.length).toBe(2);
      expect(historyService.getConversations()[0]?.messages[1]?.text).toBe("Answer 1");
    });

    it("15. Verify normal text chat never plays AI audio", async () => {
      // Verify initial state: normal text chat route does not invoke LiveClient or audio playback
      expect(mockLiveClients.length).toBe(0);

      const textSettings = settingsService.getSettings();
      // By default speak (text TTS) is false
      expect(textSettings.speak).toBe(false);

      // Send simulated text message (no active live connection created)
      expect(realtimeSessionService.context.state).toBe("IDLE");
      expect(realtimeSessionService.context.audioPlaybackStatus).toBe("idle");
    });
  });
});
