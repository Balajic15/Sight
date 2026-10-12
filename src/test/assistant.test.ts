import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadConversations,
  loadSettings,
  saveConversations,
  saveSettings,
  uid,
  type Conversation,
} from "@/lib/assistant/store";
import { detectVisualIntent } from "@/lib/assistant/intent";
import { Speaker, getRecognition, speechSupported } from "@/lib/assistant/speech";

describe("Assistant Store & Persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads default settings when storage is empty", () => {
    const s = loadSettings();
    expect(s.speak).toBe(false);
    expect(s.autoVision).toBe(true);
    expect(s.handsFree).toBe(false);
    expect(s.liveVoice).toBe("Zephyr");
    expect(s.apiKey).toBe("");
    expect(s.chatModel).toBe("gemini-2.5-flash-lite");
    expect(s.cameraFacing).toBe("environment");
    expect(s.cameraResolution).toBe("720p");
    expect(s.screenQuality).toBe("standard");
  });

  it("does not leak hardcoded secret API keys", () => {
    const s = loadSettings();
    expect(s.apiKey).not.toContain("AIzaSy");
    expect(DEFAULT_SETTINGS.apiKey).toBe("");
  });

  it("persists and restores custom settings correctly", () => {
    saveSettings({
      chatModel: "gemini-2.5-flash",
      speak: false,
      autoVision: false,
      voiceURI: "Google UK English Female",
      rate: 1.2,
      handsFree: true,
      liveVoice: "Puck",
      cameraFacing: "user",
      cameraResolution: "1080p",
      screenQuality: "high",
      apiKey: "custom-test-key",
    });

    const loaded = loadSettings();
    expect(loaded.chatModel).toBe("gemini-2.5-flash");
    expect(loaded.speak).toBe(false);
    expect(loaded.autoVision).toBe(false);
    expect(loaded.voiceURI).toBe("Google UK English Female");
    expect(loaded.rate).toBe(1.2);
    expect(loaded.handsFree).toBe(true);
    expect(loaded.liveVoice).toBe("Puck");
    expect(loaded.cameraFacing).toBe("user");
    expect(loaded.cameraResolution).toBe("1080p");
    expect(loaded.screenQuality).toBe("high");
    expect(loaded.apiKey).toBe("custom-test-key");
  });

  it("clamps speaking rate between 0.5 and 2.0", () => {
    saveSettings({ ...DEFAULT_SETTINGS, rate: 5.0 });
    expect(loadSettings().rate).toBe(2.0);

    saveSettings({ ...DEFAULT_SETTINGS, rate: 0.1 });
    expect(loadSettings().rate).toBe(0.5);
  });

  it("loads and saves conversations, stripping image payloads to save space", () => {
    const testConvo: Conversation = {
      id: "c1",
      title: "Test Conversation",
      updatedAt: 12345678,
      messages: [
        {
          id: "m1",
          role: "user",
          text: "What is this?",
          image: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
          source: "camera",
        },
        {
          id: "m2",
          role: "assistant",
          text: "This is a coffee cup.",
        },
      ],
    };

    saveConversations([testConvo]);
    const loaded = loadConversations();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.title).toBe("Test Conversation");
    expect(loaded[0]!.messages[0]!.text).toBe("What is this?");
    // Image data URL should be stripped to conserve localStorage quota
    expect(loaded[0]!.messages[0]!.image).toBeUndefined();
    expect(loaded[0]!.messages[0]!.source).toBe("camera");
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem("echo.conversations.v1", "INVALID_JSON{");
    localStorage.setItem("echo.settings.v1", "{invalid");

    expect(loadConversations()).toEqual([]);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("generates unique IDs", () => {
    const id1 = uid();
    const id2 = uid();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });
});

describe("Visual Intent Detection", () => {
  it("detects camera requests", () => {
    expect(detectVisualIntent("what's this?", null)).toBe("camera");
    expect(detectVisualIntent("what am I looking at?", null)).toBe("camera");
    expect(detectVisualIntent("what is in front of me", null)).toBe("camera");
    expect(detectVisualIntent("describe what you see", null)).toBe("camera");
    expect(detectVisualIntent("open the camera", null)).toBe("camera");
  });

  it("detects screen sharing requests", () => {
    expect(detectVisualIntent("share my screen", null)).toBe("screen");
    expect(detectVisualIntent("look at this code error on my screen", null)).toBe("screen");
    expect(detectVisualIntent("check this page", null)).toBe("screen");
  });

  it("detects stop requests", () => {
    expect(detectVisualIntent("turn off camera", "camera")).toBe("stop");
    expect(detectVisualIntent("close the screen share", "screen")).toBe("stop");
    expect(detectVisualIntent("stop looking", "camera")).toBe("stop");
  });

  it("maintains current vision context on short follow-ups", () => {
    expect(detectVisualIntent("what about this one?", "camera")).toBe("camera");
    expect(detectVisualIntent("and now?", "camera")).toBe("camera");
    expect(detectVisualIntent("the right one", "screen")).toBe("screen");
  });

  it("returns null for non-visual general queries", () => {
    expect(detectVisualIntent("what is the capital of France?", null)).toBeNull();
    expect(detectVisualIntent("tell me a short joke", null)).toBeNull();
    expect(detectVisualIntent("how do airplanes fly?", "camera")).toBeNull();
  });
});

describe("Speaker & Speech Helpers", () => {
  it("checks speech support without throwing", () => {
    expect(typeof speechSupported()).toBe("boolean");
  });

  it("Speaker sentence buffering and chunking", () => {
    const speaker = new Speaker();
    const spokenUtterances: string[] = [];

    // Mock speechSynthesis
    const mockSpeak = vi.fn((utterance: SpeechSynthesisUtterance) => {
      spokenUtterances.push(utterance.text);
    });
    const mockCancel = vi.fn();

    vi.stubGlobal("speechSynthesis", {
      speak: mockSpeak,
      cancel: mockCancel,
      getVoices: () => [],
      speaking: false,
      pending: false,
    });

    speaker.push("Hello there! ");
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(spokenUtterances[0]).toBe("Hello there!");

    speaker.push("How are you today? ");
    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(spokenUtterances[1]).toBe("How are you today?");

    // Unfinished sentence is buffered
    speaker.push("I am feeling");
    expect(mockSpeak).toHaveBeenCalledTimes(2);

    // flush sends the remaining buffered text
    speaker.flush();
    expect(mockSpeak).toHaveBeenCalledTimes(3);
    expect(spokenUtterances[2]).toBe("I am feeling");

    // stop calls cancel and triggers idle
    const onIdle = vi.fn();
    speaker.onIdle = onIdle;
    speaker.stop();
    expect(mockCancel).toHaveBeenCalled();
    expect(onIdle).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
