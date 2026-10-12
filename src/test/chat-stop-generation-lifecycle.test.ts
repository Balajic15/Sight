import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Generation Lifecycle Engine & State Simulator to verify full lifecycle rules
describe("Chat Generation Lifecycle & Stop/Send Controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  class ChatGenerationManager {
    public isGenerating = false;
    public streamingMessageId: string | null = null;
    public currentGenerationId: string | null = null;
    public abortController: AbortController | null = null;
    public messages: Array<{ id: string; role: string; text: string }> = [];
    public activeSessionState: "IDLE" | "VOICE_ACTIVE" | "VIDEO_ACTIVE" | "SCREEN_SHARE_ACTIVE" =
      "IDLE";
    public activeImageOperations = new Set<string>();

    public interrupt() {
      this.currentGenerationId = null;
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      this.streamingMessageId = null;
      this.isGenerating = false;
    }

    public async send(
      text: string,
      streamGenerator: (signal: AbortSignal) => AsyncIterable<string>,
    ) {
      this.interrupt();

      const asstMsgId = `asst_${Date.now()}`;
      const genId = `gen_${Math.random().toString(36).slice(2)}`;

      this.currentGenerationId = genId;
      this.streamingMessageId = asstMsgId;
      this.isGenerating = true;

      const ctrl = new AbortController();
      this.abortController = ctrl;

      const userMsg = { id: `user_${Date.now()}`, role: "user", text };
      const asstMsg = { id: asstMsgId, role: "assistant", text: "" };
      this.messages.push(userMsg, asstMsg);

      let full = "";

      try {
        for await (const chunk of streamGenerator(ctrl.signal)) {
          if (ctrl.signal.aborted || this.currentGenerationId !== genId) {
            break;
          }
          full += chunk;
          asstMsg.text = full;
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || ctrl.signal.aborted) {
          if (!full) full = "…";
        } else {
          full = full ? `${full}\n\n*(Error)*` : (err as Error).message;
        }
      } finally {
        if (this.currentGenerationId === genId) {
          this.currentGenerationId = null;
          if (this.abortController === ctrl) {
            this.abortController = null;
          }
          this.streamingMessageId = null;
          this.isGenerating = false;
        }
        asstMsg.text = full;
      }
    }

    public getButtonType(): "stop" | "send" {
      return this.isGenerating ? "stop" : "send";
    }

    public switchConversation() {
      this.interrupt();
      this.messages = [];
    }

    public startNewChat() {
      this.interrupt();
      this.messages = [];
    }
  }

  it("Requirement 1: Stop is visible during active generation and disappears after successful completion", async () => {
    const chat = new ChatGenerationManager();
    expect(chat.getButtonType()).toBe("send");

    async function* slowStream(signal: AbortSignal) {
      yield "Hello ";
      await new Promise((r) => setTimeout(r, 100));
      if (signal.aborted) return;
      yield "world!";
    }

    const sendPromise = chat.send("Hi", slowStream);

    // Active generation
    expect(chat.isGenerating).toBe(true);
    expect(chat.streamingMessageId).toBeTruthy();
    expect(chat.getButtonType()).toBe("stop");

    await vi.advanceTimersByTimeAsync(150);
    await sendPromise;

    // Successful completion
    expect(chat.isGenerating).toBe(false);
    expect(chat.streamingMessageId).toBeNull();
    expect(chat.getButtonType()).toBe("send");
    expect(chat.messages[1]?.text).toBe("Hello world!");
  });

  it("Requirement 2: Stop disappears when stream ends normally or returns empty response", async () => {
    const chat = new ChatGenerationManager();

    async function* emptyStream() {
      // Empty stream yields nothing
    }

    await chat.send("Empty", emptyStream);

    expect(chat.isGenerating).toBe(false);
    expect(chat.streamingMessageId).toBeNull();
    expect(chat.getButtonType()).toBe("send");
    expect(chat.messages[1]?.text).toBe("");
  });

  it("Requirement 3: Stop disappears and Send arrow is restored after HTTP or network error", async () => {
    const chat = new ChatGenerationManager();

    async function* failingStream() {
      yield "Initial part";
      throw new Error("Network connection lost");
    }

    await chat.send("Test failure", failingStream);

    expect(chat.isGenerating).toBe(false);
    expect(chat.streamingMessageId).toBeNull();
    expect(chat.getButtonType()).toBe("send");
    expect(chat.messages[1]?.text).toContain("Initial part");
  });

  it("Requirement 4: Stop disappears and input controls restore immediately upon user cancellation", async () => {
    const chat = new ChatGenerationManager();

    async function* infiniteStream(signal: AbortSignal) {
      yield "Thinking...";
      while (!signal.aborted) {
        await new Promise((r) => setTimeout(r, 500));
        yield "more text...";
      }
    }

    const sendPromise = chat.send("Infinite", infiniteStream);

    // Allow first yield to process
    await vi.advanceTimersByTimeAsync(10);

    expect(chat.isGenerating).toBe(true);
    expect(chat.getButtonType()).toBe("stop");
    expect(chat.messages[1]?.text).toBe("Thinking...");

    // User clicks Stop
    chat.interrupt();

    expect(chat.isGenerating).toBe(false);
    expect(chat.streamingMessageId).toBeNull();
    expect(chat.getButtonType()).toBe("send");

    await vi.advanceTimersByTimeAsync(600);
    await sendPromise;

    // Confirms partial text preserved
    expect(chat.messages[1]?.text).toBe("Thinking...");
  });

  it("Requirement 5: A new conversation resets the generation UI state immediately", async () => {
    const chat = new ChatGenerationManager();

    async function* longStream() {
      yield "Draft text";
      await new Promise((r) => setTimeout(r, 1000));
      yield "Done";
    }

    const sendPromise = chat.send("Query", longStream);
    expect(chat.getButtonType()).toBe("stop");

    chat.startNewChat();

    expect(chat.isGenerating).toBe(false);
    expect(chat.streamingMessageId).toBeNull();
    expect(chat.getButtonType()).toBe("send");
    expect(chat.messages.length).toBe(0);

    await vi.advanceTimersByTimeAsync(1100);
    await sendPromise;
  });

  it("Requirement 6: Switching conversations resets active generation and cancels stream", async () => {
    const chat = new ChatGenerationManager();

    async function* longStream() {
      yield "Initial";
      await new Promise((r) => setTimeout(r, 800));
      yield "Final";
    }

    const sendPromise = chat.send("Query", longStream);
    expect(chat.getButtonType()).toBe("stop");

    chat.switchConversation();

    expect(chat.isGenerating).toBe(false);
    expect(chat.getButtonType()).toBe("send");

    await vi.advanceTimersByTimeAsync(900);
    await sendPromise;
  });

  it("Requirement 7: A previous request cannot change or clear the state of a newer request", async () => {
    const chat = new ChatGenerationManager();

    async function* firstStream(signal: AbortSignal) {
      await new Promise((r) => setTimeout(r, 300));
      if (!signal.aborted) yield "First response";
    }

    async function* secondStream(signal: AbortSignal) {
      await new Promise((r) => setTimeout(r, 100));
      if (!signal.aborted) yield "Second response";
    }

    const firstPromise = chat.send("First message", firstStream);
    expect(chat.isGenerating).toBe(true);
    const firstGenId = chat.currentGenerationId;

    // Superseded by second message before first finishes
    const secondPromise = chat.send("Second message", secondStream);
    expect(chat.isGenerating).toBe(true);
    expect(chat.currentGenerationId).not.toBe(firstGenId);

    // Let second finish
    await vi.advanceTimersByTimeAsync(150);
    await secondPromise;
    expect(chat.isGenerating).toBe(false);
    expect(chat.getButtonType()).toBe("send");

    // Advance to when first would have finished
    await vi.advanceTimersByTimeAsync(300);
    await firstPromise;

    // Still clean and not desynchronized
    expect(chat.isGenerating).toBe(false);
    expect(chat.getButtonType()).toBe("send");
  });

  it("Requirement 8: Voice sessions and image tasks do not hijack or display chat Stop button", () => {
    const chat = new ChatGenerationManager();

    // Voice session active
    chat.activeSessionState = "VOICE_ACTIVE";
    expect(chat.getButtonType()).toBe("send");

    // Video session active
    chat.activeSessionState = "VIDEO_ACTIVE";
    expect(chat.getButtonType()).toBe("send");

    // Screen sharing active
    chat.activeSessionState = "SCREEN_SHARE_ACTIVE";
    expect(chat.getButtonType()).toBe("send");

    // Image operation in progress
    chat.activeImageOperations.add("img_op_123");
    expect(chat.getButtonType()).toBe("send");

    // Stop icon is ONLY shown when chat.isGenerating is true
    chat.isGenerating = true;
    expect(chat.getButtonType()).toBe("stop");
    chat.isGenerating = false;
    expect(chat.getButtonType()).toBe("send");
  });
});
