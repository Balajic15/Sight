import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioRecorder, audioRecorder } from "@/lib/assistant/audio-recorder";
import { realtimeSessionService } from "@/lib/assistant/session-manager";

describe("Voice Dictation & AudioRecorder Engine", () => {
  let mockTrack: { stop: ReturnType<typeof vi.fn> };
  let mockStream: { getTracks: ReturnType<typeof vi.fn> };
  let mockAnalyser: {
    fftSize: number;
    smoothingTimeConstant: number;
    frequencyBinCount: number;
    getByteFrequencyData: ReturnType<typeof vi.fn>;
  };
  let activeAudioCtxInstance: any;

  class MockAudioContext {
    static defaultState = "running";
    state = MockAudioContext.defaultState;
    resume = vi.fn().mockImplementation(async () => {
      this.state = "running";
    });
    close = vi.fn().mockResolvedValue(undefined);
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
    createAnalyser = vi.fn(() => mockAnalyser);

    constructor() {
      this.state = MockAudioContext.defaultState;
      activeAudioCtxInstance = this;
    }
  }

  beforeEach(() => {
    MockAudioContext.defaultState = "running";
    mockTrack = { stop: vi.fn() };
    mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
    };

    mockAnalyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      getByteFrequencyData: vi.fn(),
    };

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      configurable: true,
      writable: true,
    });

    // Mock AudioContext as constructible class
    (globalThis as any).AudioContext = MockAudioContext;
    (window as any).AudioContext = MockAudioContext;
  });

  afterEach(() => {
    audioRecorder.release();
    vi.restoreAllMocks();
  });

  it("should be a singleton instance", () => {
    const instanceA = AudioRecorder.getInstance();
    const instanceB = AudioRecorder.getInstance();
    expect(instanceA).toBe(instanceB);
    expect(instanceA).toBe(audioRecorder);
  });

  it("should initialize Web Audio API AnalyserNode with fftSize 64 and smoothingTimeConstant 0.75", async () => {
    const session = await audioRecorder.startCapture();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    expect(activeAudioCtxInstance.createAnalyser).toHaveBeenCalled();
    expect(session.analyser.fftSize).toBe(64);
    expect(session.analyser.smoothingTimeConstant).toBe(0.75);
    expect(session.stream).toBe(mockStream);
    expect(session.audioCtx).toBe(activeAudioCtxInstance);
  });

  it("should release microphone tracks and audio context on release()", async () => {
    await audioRecorder.startCapture();
    audioRecorder.release();

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(activeAudioCtxInstance.close).toHaveBeenCalled();
  });

  it("should resume suspended AudioContext on startCapture()", async () => {
    MockAudioContext.defaultState = "suspended";
    await audioRecorder.startCapture();

    expect(activeAudioCtxInstance.resume).toHaveBeenCalled();
  });

  it("should stop session cleanly and release underlying resources", async () => {
    const session = await audioRecorder.startCapture();
    await session.stop();

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(activeAudioCtxInstance.close).toHaveBeenCalled();
  });

  it("should keep voice dictation strictly isolated from Live realtime session", async () => {
    // Initial state of realtime session is IDLE
    expect(realtimeSessionService.context.state).toBe("IDLE");

    // Starting dictation capture
    const session = await audioRecorder.startCapture();
    expect(session).toBeDefined();

    // The realtime session state MUST remain IDLE
    // Dictation must never trigger Live WebSockets or multimodal audio synthesis
    expect(realtimeSessionService.context.state).toBe("IDLE");

    audioRecorder.release();
    expect(realtimeSessionService.context.state).toBe("IDLE");
  });
});
