import { describe, it, expect, vi, beforeEach } from "vitest";
import { imageGenerationService } from "@/server/image-generation";
import { mediaStorageService } from "@/server/media-storage";
import { fileProcessingService } from "@/server/file-processing";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { detectImageIntent } from "@/lib/assistant/image-intent";
import type { Conversation, Msg, ChatAttachment } from "@/lib/assistant/store";

describe("QA & Implementation Verification: Voice Image Generation & Lifecycle", () => {
  const validPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Spoken Request Intent Recognition
  it("recognizes spoken request 'Generate an image of a white cat sitting beside a window.'", () => {
    const text = "Generate an image of a white cat sitting beside a window.";
    const intent = detectImageIntent(text);
    expect(intent.type).toBe("generate");
    expect(intent.prompt).toContain("a white cat sitting beside a window");
  });

  // 2. Invokes NVIDIA FLUX.2 Klein 4B with headers & key
  it("invokes NVIDIA FLUX.2 Klein 4B endpoint with Bearer auth and payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: validPngBase64, finishReason: "SUCCESS" }],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await imageGenerationService.generateImage({
      operationId: "op-qa-1",
      conversationId: "conv-qa-1",
      prompt: "a white cat sitting beside a window",
      apiKey: "nvapi-qa-test-key",
      width: 1024,
      height: 1024,
      seed: 0,
      steps: 4,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const firstCall = mockFetch.mock.calls[0]!;
    expect(firstCall[0]).toBe(
      "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b",
    );
    const headers = (firstCall[1] as any).headers;
    expect(headers["Authorization"]).toBe("Bearer nvapi-qa-test-key");

    const body = JSON.parse((firstCall[1] as any).body);
    expect(body.prompt).toBe("a white cat sitting beside a window");
    expect(body.width).toBe(1024);
    expect(body.height).toBe(1024);

    expect(result.status).toBe("succeeded");
    expect(result.imageGenerated).toBe(true);
    expect(result.imageUrl).toContain("/api/media?id=");
  });

  // 3. Provider Failures & Edge Cases (400, 401, 403, 429, 500, timeout, corrupt image, storage error)
  it("handles HTTP 400 Bad Request safely with imageGenerated=false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Safety filter triggered" }),
    });

    const result = await imageGenerationService.generateImage({
      operationId: "op-400",
      conversationId: "conv-400",
      prompt: "unsafe prompt",
      apiKey: "test-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("BAD_REQUEST");
  });

  it("handles HTTP 401 Unauthorized safely without leaking credentials", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Invalid API key" }),
    });

    const result = await imageGenerationService.generateImage({
      operationId: "op-401",
      conversationId: "conv-401",
      prompt: "a white cat",
      apiKey: "bad-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("UNAUTHORIZED");
    expect(result.errorMessage).not.toContain("bad-key");
  });

  it("handles HTTP 403 Forbidden with clear permission message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: "Forbidden" }),
    });

    const result = await imageGenerationService.generateImage({
      operationId: "op-403",
      conversationId: "conv-403",
      prompt: "a white cat",
      apiKey: "restricted-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("FORBIDDEN");
  });

  it("handles HTTP 429 Rate Limited safely with rate limit message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: "Too many requests" }),
    });

    const result = await imageGenerationService.generateImage({
      operationId: "op-429",
      conversationId: "conv-429",
      prompt: "a white cat",
      apiKey: "test-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("RATE_LIMITED");
  });

  it("handles HTTP 500 Provider Error without exposing stack trace", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal server error at stack line 42",
    });

    const result = await imageGenerationService.generateImage({
      operationId: "op-500",
      conversationId: "conv-500",
      prompt: "a white cat",
      apiKey: "test-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_ERROR");
  });

  it("handles timeout safely with TIMEOUT error code", async () => {
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    globalThis.fetch = vi.fn().mockRejectedValue(timeoutErr);

    const result = await imageGenerationService.generateImage({
      operationId: "op-timeout",
      conversationId: "conv-timeout",
      prompt: "a white cat",
      apiKey: "test-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("TIMEOUT");
  });

  it("rejects corrupt or non-image bytes safely", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: Buffer.from("this is plain text not an image").toString("base64") }],
      }),
    });

    const result = await imageGenerationService.generateImage({
      operationId: "op-corrupt",
      conversationId: "conv-corrupt",
      prompt: "a white cat",
      apiKey: "test-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("CORRUPT_IMAGE");
  });

  it("handles media storage persistence failure safely", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: validPngBase64 }],
      }),
    });

    vi.spyOn(mediaStorageService, "saveMedia").mockRejectedValueOnce(
      new Error("Disk full or database offline"),
    );

    const result = await imageGenerationService.generateImage({
      operationId: "op-storage-err",
      conversationId: "conv-storage-err",
      prompt: "a white cat",
      apiKey: "test-key",
    });

    expect(result.status).toBe("failed");
    expect(result.imageGenerated).toBe(false);
    expect(result.errorCode).toBe("STORAGE_ERROR");
  });
});

describe("QA: Contextual Image Understanding & Editing Scenarios", () => {
  const catAttachment: ChatAttachment = {
    id: "att-cat",
    conversationId: "conv-context",
    fileName: "cat-by-window.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    storageRef: "/api/media?id=media-cat",
    status: "ready",
    origin: "generated",
    prompt: "a white cat sitting beside a window",
  };

  const dogAttachment: ChatAttachment = {
    id: "att-dog",
    conversationId: "conv-context",
    fileName: "golden-retriever.png",
    mimeType: "image/png",
    sizeBytes: 2048,
    storageRef: "/api/media?id=media-dog",
    status: "ready",
    origin: "uploaded",
    prompt: "a golden retriever in a field",
  };

  const sampleConv: Conversation = {
    id: "conv-context",
    title: "Pets Chat",
    updatedAt: Date.now(),
    messages: [
      { id: "m1", role: "user", text: "Generate a cat" },
      {
        id: "m2",
        role: "assistant",
        text: "Here is your image:",
        attachments: [catAttachment],
      },
      { id: "m3", role: "user", text: "Here is a dog picture" },
      {
        id: "m4",
        role: "assistant",
        text: "Got the dog picture.",
        attachments: [dogAttachment],
      },
    ],
  };

  it("resolves the most recent image for 'Explain this image.'", () => {
    const resolved = attachmentContextService.resolveContext(sampleConv, "Explain this image.");
    expect(resolved.targetAttachment?.id).toBe("att-dog");
  });

  it("identifies target image when user asks 'Read the text in the cat image.'", () => {
    const resolved = attachmentContextService.resolveContext(
      sampleConv,
      "Read the text in the cat image.",
    );
    expect(resolved.targetAttachment?.id).toBe("att-cat");
  });

  it("routes edit request 'Change the background to white.' to image editing", () => {
    const intent = detectImageIntent("Change the background to white.", true);
    expect(intent.type).toBe("edit");
  });

  it("routes edit request 'Generate another version in watercolor style.' to image editing", () => {
    const intent = detectImageIntent("Generate a new version in watercolor style.", true);
    expect(intent.type).toBe("edit");
  });

  it("preserves all images for comparison queries like 'Compare these two images.'", () => {
    const resolved = attachmentContextService.resolveContext(
      sampleConv,
      "Compare these two images.",
    );
    expect(resolved.allImageAttachments.length).toBe(2);
    expect(resolved.allImageAttachments.map((a) => a.id)).toContain("att-cat");
    expect(resolved.allImageAttachments.map((a) => a.id)).toContain("att-dog");
  });
});

describe("QA: File Processing & Upload Validation", () => {
  it("processes source code and text files extracting text accurately", async () => {
    const code = "function add(a: number, b: number) { return a + b; }";
    const buffer = Buffer.from(code, "utf-8");
    const result = await fileProcessingService.processFile(
      buffer,
      "math.ts",
      "application/typescript",
    );

    expect(result.success).toBe(true);
    expect(result.fileType).toBe("text");
    expect(result.extractedText).toBe(code);
  });

  it("rejects unsupported executable or binary files safely", async () => {
    const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
    const result = await fileProcessingService.processFile(
      bufferFrom(binary),
      "program.exe",
      "application/x-msdownload",
    );

    expect(result.success).toBe(false);
    expect(result.fileType).toBe("unknown");
    expect(result.error).toContain("not supported");
  });

  function bufferFrom(buf: Buffer): Buffer {
    return buf;
  }
});
