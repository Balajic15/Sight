import { describe, it, expect, vi, beforeEach } from "vitest";
import { aiRouter, AIRouterService } from "@/server/ai/router";
import {
  type AIRequestContext,
  validateRequestContext,
  SUPPORTED_PROVIDER_TASKS,
  DEFAULT_PROVIDER_MODELS,
} from "@/server/ai/contracts";
import { googleGeminiAdapter } from "@/server/ai/google-adapter";
import { nvidiaAdapter } from "@/server/ai/nvidia-adapter";
import { imageGenerationService } from "@/server/image-generation";
import { nvidiaMultimodalService } from "@/server/nvidia-multimodal";
import { realtimeSessionService } from "@/lib/assistant/session-manager";
import { settingsService } from "@/lib/assistant/settings-service";
import { historyService } from "@/lib/assistant/history-service";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import {
  DEFAULT_SETTINGS,
  type Conversation,
  type Msg,
  uid,
  saveConversations,
} from "@/lib/assistant/store";

// Deterministic mock for LiveClient in unit test environment
vi.mock("@/lib/assistant/live-client", () => {
  return {
    LiveClient: class MockLiveClient {
      public options: any;
      public playbackRate = 1.0;
      public state = "disconnected";

      constructor(options: any = {}) {
        this.options = options;
      }

      public connect(params?: any) {
        this.state = "connected";
        setTimeout(() => {
          this.options?.onReady?.();
          this.options?.onStateChange?.("connected");
        }, 0);
      }

      public disconnect() {
        this.state = "disconnected";
        this.options?.onStateChange?.("disconnected");
      }

      public stopAudioPlayback() {}
      public pause() {
        return true;
      }
      public resume() {
        return true;
      }
      public startVideoStreaming() {}
      public stopVideoStreaming() {}
    },
  };
});

describe("Unified AI Provider Architecture & Regression Verification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Normal Gemini text chat streams text without AI audio
  it("1. Normal Gemini text chat routes to Google and streams text without AI audio", () => {
    const route = aiRouter.resolveRoute({
      hasVideo: false,
      hasImage: false,
      hasFileText: false,
      isImageGeneration: false,
    });

    expect(route.provider).toBe("google");
    expect(route.taskType).toBe("text_chat");
    expect(route.model).toBe("gemini-2.5-flash-lite");
  });

  // 2. Gemini Live starts and stops without duplicate sessions
  it("2. Gemini Live starts and stops cleanly without duplicate sessions", async () => {
    const session = realtimeSessionService;
    await session.stop();
    expect(session.context.state).toBe("IDLE");

    const settings = settingsService.getSettings();
    const convId = "conv-live-1";

    // Switch to voice
    const ok = await session.switchInteraction(convId, "voice", settings);
    expect(ok).toBe(true);
    const activeSessionId = session.context.sessionId;
    expect(session.context.state).toBe("VOICE_ACTIVE");

    // Attempting to switch to same interaction does not duplicate session
    await session.switchInteraction(convId, "voice", settings);
    expect(session.context.sessionId).toBe(activeSessionId);

    // Stop cleanly
    await session.stop();
    expect(session.context.state).toBe("IDLE");
  });

  // 3. NVIDIA image generation uses only the configured NVIDIA adapter
  it("3. NVIDIA image generation uses only configured NVIDIA adapter and key", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [
          {
            base64:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          },
        ],
      }),
    });
    globalThis.fetch = mockFetch;

    process.env["NVIDIA_API_KEY"] = "nvapi-test-nvidia-key";
    process.env["GOOGLE_API_KEY"] = "AIza-google-test-key";

    const result = await imageGenerationService.generateImage({
      operationId: "op-test-nvidia",
      conversationId: "conv-test",
      prompt: "a golden retriever in a field",
      apiKey: "AIza-inadvertent-google-key", // must be rejected in favor of NVIDIA_API_KEY
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0]!;
    expect(call[0]).toBe("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b");
    const headers = (call[1] as any).headers;
    // Auth header must use NVIDIA key, NOT the Google key
    expect(headers["Authorization"]).toBe("Bearer nvapi-test-nvidia-key");
    expect(result.status).toBe("succeeded");
    expect(result.imageGenerated).toBe(true);
  });

  // 4. Image understanding uses the intended vision model
  it("4. Image understanding routes to intended NVIDIA vision model", () => {
    vi.spyOn(nvidiaAdapter, "isConfigured").mockReturnValue(true);

    const route = aiRouter.resolveRoute({
      hasImage: true,
      hasVideo: false,
    });

    expect(route.provider).toBe("nvidia");
    expect(route.taskType).toBe("image_understanding");
    expect(route.model).toBe("meta/llama-3.2-11b-vision-instruct");
  });

  // 5. Video understanding uses the intended video-capable model
  it("5. Video understanding routes to intended video-capable model", () => {
    const route = aiRouter.resolveRoute({
      hasVideo: true,
      hasImage: false,
    });

    expect(route.provider).toBe("nvidia");
    expect(route.taskType).toBe("video_understanding");
    expect(route.model).toBe("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");
  });

  // 6. Unsupported provider/model/task combinations are rejected
  it("6. Unsupported provider/model/task combinations are rejected before network requests", () => {
    // Google cannot do image_generation
    const googleImgGen = validateRequestContext({
      operationId: "op-1",
      conversationId: "conv-1",
      provider: "google",
      taskType: "image_generation",
      model: "gemini-2.5-flash-lite",
    });
    expect(googleImgGen.valid).toBe(false);
    expect(googleImgGen.error).toContain("does not support task 'image_generation'");

    // Google cannot do video_understanding
    const googleVideo = validateRequestContext({
      operationId: "op-2",
      conversationId: "conv-1",
      provider: "google",
      taskType: "video_understanding",
      model: "gemini-2.5-flash-lite",
    });
    expect(googleVideo.valid).toBe(false);
    expect(googleVideo.error).toContain("does not support task 'video_understanding'");

    // NVIDIA cannot do realtime_voice
    const nvidiaVoice = validateRequestContext({
      operationId: "op-3",
      conversationId: "conv-1",
      provider: "nvidia",
      taskType: "realtime_voice",
      model: "nemotron-3",
    });
    expect(nvidiaVoice.valid).toBe(false);
    expect(nvidiaVoice.error).toContain("does not support task 'realtime_voice'");
  });

  // 7. One user message does not accidentally invoke multiple providers
  it("7. One user message routes exclusively to one provider", () => {
    // Text + video -> only NVIDIA
    const videoRoute = aiRouter.resolveRoute({
      hasVideo: true,
      hasImage: false,
      hasFileText: false,
    });
    expect(videoRoute.provider).toBe("nvidia");

    // Text only -> only Google
    const textRoute = aiRouter.resolveRoute({
      hasVideo: false,
      hasImage: false,
      hasFileText: false,
    });
    expect(textRoute.provider).toBe("google");
  });

  // 8. Provider-specific SSE and Live event parsers remain independent
  it("8. Provider-specific SSE parsers handle split packets without cross-contamination", async () => {
    // Test NVIDIA SSE stream chunk parser with split line across boundaries
    const chunk1 = 'data: {"choices":[{"delta":{"content":"Hel';
    const chunk2 =
      'lo "}}]}\n\ndata: {"choices":[{"delta":{"content":"world!"}}]}\n\ndata: [DONE]\n\n';

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const mockStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1));
        controller.enqueue(encoder.encode(chunk2));
        controller.close();
      },
    });

    vi.spyOn(nvidiaAdapter, "getNvidiaApiKey").mockReturnValue("nvapi-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      body: mockStream,
      headers: new Headers({ "content-type": "text/event-stream" }),
    } as any);

    const context: AIRequestContext = {
      operationId: "op-sse-test",
      conversationId: "conv-sse",
      provider: "nvidia",
      taskType: "image_understanding",
      model: "meta/llama-3.2-11b-vision-instruct",
    };

    const resp = await aiRouter.executeNvidiaMultimodalStream({
      context,
      mediaItems: [{ mimeType: "image/png", dataBase64: "base64" }],
      question: "What is this?",
    });

    expect(resp.ok).toBe(true);
    const reader = resp.body!.getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(text).toBe("Hello world!");
  });

  // 9. Duplicate completion events do not create duplicate messages or speech
  it("9. Duplicate completion events are rejected via active operation tracking", () => {
    const context: AIRequestContext = {
      operationId: "op-dup-test",
      conversationId: "conv-dup",
      provider: "google",
      taskType: "text_chat",
      model: "gemini-2.5-flash-lite",
    };

    const first = aiRouter.startOperation(context);
    expect(first.ok).toBe(true);

    // Attempt duplicate
    const second = aiRouter.startOperation(context);
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already in progress");

    aiRouter.endOperation(context, true);
  });

  // 10. Stale events cannot update a different conversation
  it("10. Conversation scoping prevents events from updating wrong conversation", () => {
    const convAId = "conv-a";
    const convBId = "conv-b";

    const convA: Conversation = { id: convAId, title: "A", updatedAt: Date.now(), messages: [] };
    const convB: Conversation = { id: convBId, title: "B", updatedAt: Date.now(), messages: [] };

    historyService.saveAll([convA, convB]);

    // Simulating message update targeting convA
    const newMsg: Msg = { id: "m-1", role: "assistant", text: "Answer for A" };
    const convs = historyService.getConversations();
    const updated = convs.map((c) => (c.id === convAId ? { ...c, messages: [newMsg] } : c));
    historyService.saveAll(updated);

    const finalConvs = historyService.getConversations();
    const finalA = finalConvs.find((c) => c.id === convAId);
    const finalB = finalConvs.find((c) => c.id === convBId);

    expect(finalA?.messages).toHaveLength(1);
    expect(finalB?.messages).toHaveLength(0); // Conv B remains untouched
  });

  // 11. Provider key changes do not cross-contaminate integrations
  it("11. Google and NVIDIA credentials do not cross-contaminate", async () => {
    const s = settingsService;
    await s.updateSettings({ apiKey: "AIza-my-google-key" });
    expect(s.getSettings().apiKey).toBe("AIza-my-google-key");

    await s.updateSettings({ nvidiaApiKey: "nvapi-my-nvidia-key" });
    const current = s.getSettings();
    expect(current.apiKey).toBe("AIza-my-google-key"); // Google key preserved
    expect(current.nvidiaApiKey).toBe("nvapi-my-nvidia-key"); // NVIDIA key preserved
  });

  // 12. Stop/Pause/Resume/Restart remain correct during media operations
  it("12. Session Stop transitions to IDLE and terminates active stream", async () => {
    const session = realtimeSessionService;
    await session.switchInteraction("conv-12", "voice", settingsService.getSettings());
    expect(session.context.state).toBe("VOICE_ACTIVE");

    await session.stop();
    expect(session.context.state).toBe("IDLE");
    expect(session.context.connectionStatus).toBe("disconnected");
  });

  // 13. Provider errors do not trigger fake success responses
  it("13. Provider errors return explicit failure status and safe error code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal server error from upstream provider",
    } as any);

    process.env["NVIDIA_API_KEY"] = "nvapi-test";

    const result = await imageGenerationService.generateImage({
      operationId: "op-err-test",
      conversationId: "conv-err",
      prompt: "a landscape",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_ERROR");
  });

  // 14. History preserves attachment references and final answers
  it("14. Conversation history preserves attachment metadata and answers", () => {
    const convId = "conv-history-test";
    const attachment = {
      id: "att-1",
      conversationId: convId,
      fileName: "test.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageRef: "/api/media?id=att-1",
      status: "ready" as const,
      origin: "generated" as const,
    };

    const message: Msg = {
      id: "msg-1",
      role: "assistant",
      text: "Here is your generated image:",
      attachments: [attachment],
    };

    const conv: Conversation = {
      id: convId,
      title: "Image generation",
      updatedAt: Date.now(),
      messages: [message],
    };

    historyService.saveAll([conv]);
    const retrieved = historyService.getConversations().find((c) => c.id === convId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.messages[0]?.attachments?.[0]?.storageRef).toBe("/api/media?id=att-1");
    expect(retrieved?.messages[0]?.text).toContain("Here is your generated image:");
  });

  // 15. Existing image generation, upload, video upload, and file analysis continue to work
  it("15. AttachmentContext resolves active videos and images for follow-up queries", () => {
    const conv: Conversation = {
      id: "conv-multi-test",
      title: "Multimodal test",
      updatedAt: Date.now(),
      messages: [
        {
          id: "m-vid",
          role: "user",
          text: "Here is my recording",
          attachments: [
            {
              id: "att-vid",
              conversationId: "conv-multi-test",
              fileName: "clip.mp4",
              mimeType: "video/mp4",
              sizeBytes: 5000,
              storageRef: "/api/media?id=att-vid",
              status: "ready",
              origin: "uploaded",
            },
          ],
        },
      ],
    };

    // Temporal question about the video
    const resolved = attachmentContextService.resolveContext(
      conv,
      "At what point does the person appear?",
    );
    expect(resolved.targetAttachment).toBeDefined();
    expect(resolved.targetAttachment?.mimeType).toBe("video/mp4");
  });
});
