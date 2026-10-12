import { describe, expect, it, beforeEach, vi } from "vitest";
import { SettingsService, settingsService } from "@/lib/assistant/settings-service";
import { HistoryService, historyService } from "@/lib/assistant/history-service";
import { realtimeSessionService } from "@/lib/assistant/session-manager";
import { DEFAULT_SETTINGS, type Settings, type Conversation } from "@/lib/assistant/store";

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

// Mock fetch
globalThis.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  }),
) as any;

describe("SettingsService & Session Integration", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("Persistence and Cold Restarts", () => {
    it("loads default settings when storage is empty", () => {
      const service = SettingsService.getInstance();
      const loaded = service.load();
      expect(loaded.chatModel).toBe(DEFAULT_SETTINGS.chatModel);
      expect(loaded.liveVoice).toBe(DEFAULT_SETTINGS.liveVoice);
      expect(loaded.rate).toBe(1.0);
    });

    it("restores valid persisted settings across reloads", async () => {
      const service = SettingsService.getInstance();
      await service.updateSettings({
        chatModel: "gemini-2.5-flash",
        liveVoice: "Puck",
        rate: 1.5,
        cameraFacing: "user",
        cameraResolution: "1080p",
      });

      // Simulate cold restart by calling load()
      const restored = service.load();
      expect(restored.chatModel).toBe("gemini-2.5-flash");
      expect(restored.liveVoice).toBe("Puck");
      expect(restored.rate).toBe(1.5);
      expect(restored.cameraFacing).toBe("user");
      expect(restored.cameraResolution).toBe("1080p");
    });
  });

  describe("Normalization & Invariant Enforcement", () => {
    it("clamps speaking rate between 0.5x and 2.0x", () => {
      const service = SettingsService.getInstance();
      expect(service.validateAndNormalize({ rate: 0.2 }).rate).toBe(0.5);
      expect(service.validateAndNormalize({ rate: 3.5 }).rate).toBe(2.0);
      expect(service.validateAndNormalize({ rate: 1.25 }).rate).toBe(1.3);
      // Non-numeric fallback
      expect(service.validateAndNormalize({ rate: "fast" as any }).rate).toBe(1.0);
    });

    it("normalizes invalid chat models to default", () => {
      const service = SettingsService.getInstance();
      const normalized = service.validateAndNormalize({ chatModel: "unsupported-gpt-5" });
      expect(normalized.chatModel).toBe(DEFAULT_SETTINGS.chatModel);
    });

    it("normalizes invalid live voice names to default", () => {
      const service = SettingsService.getInstance();
      const normalized = service.validateAndNormalize({ liveVoice: "UnknownVoice" });
      expect(normalized.liveVoice).toBe(DEFAULT_SETTINGS.liveVoice);
    });

    it("normalizes camera facing and resolution", () => {
      const service = SettingsService.getInstance();
      const normalizedFacing = service.validateAndNormalize({ cameraFacing: "macro" as any });
      expect(normalizedFacing.cameraFacing).toBe("environment");

      const normalizedRes = service.validateAndNormalize({ cameraResolution: "4k" as any });
      expect(normalizedRes.cameraResolution).toBe("720p");
    });

    it("sanitizes API keys by trimming whitespace", () => {
      const service = SettingsService.getInstance();
      const normalized = service.validateAndNormalize({ apiKey: "  AIzaSyD-12345  " });
      expect(normalized.apiKey).toBe("AIzaSyD-12345");
    });
  });

  describe("Runtime Application: Immediate vs Deferred", () => {
    it("reports immediate application for rate changes regardless of session state", () => {
      const service = SettingsService.getInstance();
      expect(service.checkIfAppliedImmediately({ rate: 1.2 }, "IDLE")).toBe(true);
      expect(service.checkIfAppliedImmediately({ rate: 1.2 }, "VOICE_ACTIVE")).toBe(true);
      expect(service.checkIfAppliedImmediately({ rate: 1.2 }, "VIDEO_ACTIVE")).toBe(true);
      expect(service.checkIfAppliedImmediately({ rate: 1.2 }, "SCREEN_SHARE_ACTIVE")).toBe(true);
    });

    it("reports immediate application for chat model changes (applies to next request)", () => {
      const service = SettingsService.getInstance();
      expect(service.checkIfAppliedImmediately({ chatModel: "gemini-2.5-flash" }, "IDLE")).toBe(
        true,
      );
      expect(
        service.checkIfAppliedImmediately({ chatModel: "gemini-2.5-flash" }, "VOICE_ACTIVE"),
      ).toBe(true);
    });

    it("defers liveVoice and apiKey changes when a Live session is active", () => {
      const service = SettingsService.getInstance();
      // In IDLE, applied immediately
      expect(service.checkIfAppliedImmediately({ liveVoice: "Kore" }, "IDLE")).toBe(true);
      expect(service.checkIfAppliedImmediately({ apiKey: "new-key" }, "IDLE")).toBe(true);

      // In active Live session, deferred until next connection
      expect(service.checkIfAppliedImmediately({ liveVoice: "Kore" }, "VOICE_ACTIVE")).toBe(false);
      expect(service.checkIfAppliedImmediately({ liveVoice: "Kore" }, "VIDEO_ACTIVE")).toBe(false);
      expect(service.checkIfAppliedImmediately({ apiKey: "new-key" }, "VOICE_ACTIVE")).toBe(false);
      expect(service.checkIfAppliedImmediately({ apiKey: "new-key" }, "SCREEN_SHARE_ACTIVE")).toBe(
        false,
      );
    });

    it("defers camera resolution changes during active video mode", () => {
      const service = SettingsService.getInstance();
      expect(service.checkIfAppliedImmediately({ cameraResolution: "1080p" }, "IDLE")).toBe(true);
      expect(service.checkIfAppliedImmediately({ cameraResolution: "1080p" }, "VIDEO_ACTIVE")).toBe(
        false,
      );
    });
  });

  describe("Active Session Snapshot Registration", () => {
    it("maintains an immutable snapshot of settings active during session lifetime", async () => {
      const service = SettingsService.getInstance();
      const initialSettings = service.getSettings();

      service.registerActiveSession("sess-1", initialSettings);
      const snapshot = service.getActiveSessionSnapshot();
      expect(snapshot?.sessionId).toBe("sess-1");
      expect(snapshot?.settings.chatModel).toBe(initialSettings.chatModel);

      // Modify global settings
      await service.updateSettings({ chatModel: "gemini-3.1-flash-lite" });
      const currentGlobal = service.getSettings();
      expect(currentGlobal.chatModel).toBe("gemini-3.1-flash-lite");

      // Active session snapshot should remain unaffected
      const activeSnapshot = service.getActiveSessionSnapshot();
      expect(activeSnapshot?.settings.chatModel).toBe(initialSettings.chatModel);

      // Clearing active session
      service.clearActiveSession();
      expect(service.getActiveSessionSnapshot()).toBeNull();
    });
  });

  describe("Clear History Isolation", () => {
    it("clears stored conversations without terminating active realtime session", async () => {
      const initialConvos: Conversation[] = [
        {
          id: "c-1",
          title: "Test convo",
          updatedAt: Date.now(),
          messages: [{ id: "m-1", role: "user", text: "Hello" }],
        },
      ];
      const hist = HistoryService.getInstance();
      hist.saveAll(initialConvos);
      expect(hist.getConversations().length).toBe(1);

      // Clear history
      await hist.clearAll();

      // Verify conversations in store are empty
      expect(hist.getConversations().length).toBe(0);

      // Verify that realtimeSessionService state is unaffected
      expect(realtimeSessionService.context.state).toBe("IDLE");
    });
  });
});
