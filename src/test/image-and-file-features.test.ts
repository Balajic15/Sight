import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectImageIntent } from "@/lib/assistant/image-intent";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { mediaStorageService } from "@/server/media-storage";
import { fileProcessingService } from "@/server/file-processing";
import { imageGenerationService } from "@/server/image-generation";
import type { Conversation, Msg, ChatAttachment } from "@/lib/assistant/store";

describe("Voice-Controlled Image Generation & Intent Recognition", () => {
  it("should recognize spoken image generation requests accurately", () => {
    const examples = [
      "Generate an image of a futuristic city at night.",
      "Create a realistic photo of a white cat sitting beside a window.",
      "Generate a wedding invitation with a dark green and gold theme.",
      "Create an image of a red sports car in the mountains.",
      "Please draw an illustration of a dragon flying over clouds.",
      "Can you make a picture of a cozy coffee shop in rainy weather?",
    ];

    for (const text of examples) {
      const intent = detectImageIntent(text);
      expect(intent.type).toBe("generate");
      expect(intent.prompt.length).toBeGreaterThan(0);
    }
  });

  it("should extract clean prompts from spoken requests", () => {
    const intent = detectImageIntent("Generate an image of a futuristic city at night.");
    expect(intent.type).toBe("generate");
    expect(intent.prompt).toBe("a futuristic city at night.");
  });

  it("should distinguish image questions from generation when an attachment exists", () => {
    const question1 = detectImageIntent("Explain this image.", true);
    expect(question1.type).toBe("question");

    const question2 = detectImageIntent("What is happening in this picture?", true);
    expect(question2.type).toBe("question");

    const question3 = detectImageIntent("Read the text in the image.", true);
    expect(question3.type).toBe("question");
  });

  it("should distinguish image edit requests from questions and general text", () => {
    const edit1 = detectImageIntent("Change the background to white.", true);
    expect(edit1.type).toBe("edit");

    const edit2 = detectImageIntent("Make the image brighter.", true);
    expect(edit2.type).toBe("edit");

    const edit3 = detectImageIntent("Generate a new version in a watercolor style.", true);
    expect(edit3.type).toBe("edit");

    const edit4 = detectImageIntent("Change shirt color to lavendar", true);
    expect(edit4.type).toBe("edit");

    const edit5 = detectImageIntent("Make his shirt purple", true);
    expect(edit5.type).toBe("edit");
  });
});

describe("Contextual Attachment Resolver", () => {
  const dummyConvo: Conversation = {
    id: "conv-1",
    title: "Test Conversation",
    updatedAt: Date.now(),
    messages: [
      {
        id: "m1",
        role: "user",
        text: "Generate a picture of a mountain.",
      },
      {
        id: "m2",
        role: "assistant",
        text: "Here is your generated image:",
        attachments: [
          {
            id: "att-mountain",
            conversationId: "conv-1",
            origin: "generated",
            fileName: "mountain.png",
            mimeType: "image/png",
            sizeBytes: 12000,
            storageRef: "/api/media?id=att-mountain",
            status: "ready",
            prompt: "a majestic snow mountain at sunrise",
          },
        ],
      },
      {
        id: "m3",
        role: "user",
        text: "Generate an image of a sunset beach.",
      },
      {
        id: "m4",
        role: "assistant",
        text: "Here is your generated image:",
        attachments: [
          {
            id: "att-beach",
            conversationId: "conv-1",
            origin: "generated",
            fileName: "sunset_beach.png",
            mimeType: "image/png",
            sizeBytes: 15000,
            storageRef: "/api/media?id=att-beach",
            status: "ready",
            prompt: "golden sunset over tropical beach",
          },
        ],
      },
    ],
  };

  it("should resolve the most recent attachment by default", () => {
    const resolved = attachmentContextService.resolveContext(dummyConvo, "Make it brighter");
    expect(resolved.targetAttachment?.id).toBe("att-beach");
  });

  it("should prefer explicitly mentioned attachment by filename or prompt", () => {
    const resolved = attachmentContextService.resolveContext(
      dummyConvo,
      "Make the mountain picture darker",
    );
    expect(resolved.targetAttachment?.id).toBe("att-mountain");
  });

  it("should handle explicit ordinal selections like 'first one'", () => {
    const resolved = attachmentContextService.resolveContext(dummyConvo, "Explain the first one");
    expect(resolved.targetAttachment?.id).toBe("att-mountain");
  });
});

describe("Media Storage & File Processing Pipeline", () => {
  it("should validate and store image media with accessible storageRef", async () => {
    // 1x1 PNG base64
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const attachment = await mediaStorageService.saveMedia({
      conversationId: "conv-test",
      fileName: "sample.png",
      mimeType: "image/png",
      dataBase64: pngBase64,
      origin: "generated",
    });

    expect(attachment.id).toBeDefined();
    expect(attachment.storageRef).toContain("/api/media?id=");
    expect(attachment.origin).toBe("generated");

    // Retrieve media from service
    const stored = await mediaStorageService.getMedia(attachment.id);
    expect(stored).toBeDefined();
    expect(stored?.fileName).toBe("sample.png");
    expect(stored?.buffer.length).toBeGreaterThan(0);
  });

  it("should process plain text and code files with extracted text", async () => {
    const code = 'function hello() { return "world"; }';
    const buf = Buffer.from(code, "utf-8");

    const result = await fileProcessingService.processFile(
      buf,
      "hello.ts",
      "application/typescript",
    );
    expect(result.success).toBe(true);
    expect(result.fileType).toBe("text");
    expect(result.extractedText).toBe(code);
  });

  it("should reject unsupported binary formats safely", async () => {
    const randomBinary = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44]);
    const result = await fileProcessingService.processFile(
      randomBinary,
      "unknown.xyz",
      "application/xyz",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not supported");
  });
});

describe("NVIDIA FLUX.2 Klein 4B Integration Contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should construct correct payload and produce ImageGenerationResult on success", async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    // Mock fetch for NVIDIA endpoint
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [
          {
            base64: pngBase64,
            seed: 0,
            finishReason: "SUCCESS",
          },
        ],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await imageGenerationService.generateImage({
      operationId: "op-123",
      conversationId: "conv-456",
      prompt: "a futuristic city at night",
      apiKey: "nvapi-test-key",
      width: 1024,
      height: 1024,
      seed: 0,
      steps: 4,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const firstCall = mockFetch.mock.calls[0]!;
    const calledUrl = firstCall[0];
    const calledOpts = firstCall[1] as any;
    expect(calledUrl).toBe("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b");
    expect(calledOpts.headers["Authorization"]).toBe("Bearer nvapi-test-key");

    const bodyObj = JSON.parse(calledOpts.body);
    expect(bodyObj.prompt).toBe("a futuristic city at night");
    expect(bodyObj.width).toBe(1024);
    expect(bodyObj.height).toBe(1024);
    expect(bodyObj.seed).toBe(0);
    expect(bodyObj.steps).toBe(4);

    expect(result.status).toBe("succeeded");
    expect(result.imageGenerated).toBe(true);
    expect(result.imageId).toBeDefined();
    expect(result.imageUrl).toContain("/api/media?id=");
  });

  it("should pass real image data URI when performing image editing", async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [
          {
            base64: pngBase64,
            seed: 0,
            finishReason: "SUCCESS",
          },
        ],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await imageGenerationService.generateImage({
      operationId: "op-edit-1",
      conversationId: "conv-edit-1",
      prompt: "make the background white",
      image: `data:image/png;base64,${pngBase64}`,
      apiKey: "nvapi-test-key",
    });

    expect(result.imageGenerated).toBe(true);
    const firstCall = mockFetch.mock.calls[0]!;
    const bodyObj = JSON.parse((firstCall[1] as any).body);
    expect(bodyObj.image).toBeDefined();
    expect(bodyObj.image).toBe(`data:image/png;base64,${pngBase64}`);
    expect(bodyObj.mode).toBe("Image Editing");
  });

  it("should return failure result and not set imageGenerated on provider error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        message: "Unauthorized request",
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await imageGenerationService.generateImage({
      operationId: "op-fail",
      conversationId: "conv-fail",
      prompt: "a red car",
      apiKey: "invalid-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("UNAUTHORIZED");
    expect(result.imageUrl).toBeUndefined();
  });
});
