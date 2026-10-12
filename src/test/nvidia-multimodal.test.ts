import { describe, it, expect, vi, beforeEach } from "vitest";
import { nvidiaMultimodalService } from "@/server/nvidia-multimodal";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { mediaStorageService } from "@/server/media-storage";
import { fileProcessingService } from "@/server/file-processing";
import type { Conversation, ChatAttachment } from "@/lib/assistant/store";

describe("NVIDIA Multimodal Service: Image & Video Understanding", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleImageBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const sampleVideoBase64 = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
  ]).toString("base64");

  it("selects meta/llama-3.2-11b-vision-instruct for images by default", async () => {
    vi.spyOn(nvidiaMultimodalService, "getNvidiaApiKey").mockReturnValue("nvapi-test-key");

    let capturedBody: any;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"There is a cat in the image."}}]}\n\ndata: [DONE]\n\n',
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    const response = await nvidiaMultimodalService.analyzeMediaStream({
      conversationId: "conv-img-1",
      question: "Is there a cat in this image?",
      mediaItems: [
        {
          mimeType: "image/png",
          dataBase64: sampleImageBase64,
          fileName: "cat.png",
        },
      ],
    });

    expect(capturedBody).toBeDefined();
    expect(capturedBody.model).toBe("meta/llama-3.2-11b-vision-instruct");
    expect(capturedBody.stream).toBe(true);

    const userMsg = capturedBody.messages.find((m: any) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg.content).toEqual(
      expect.arrayContaining([
        { type: "text", text: "Is there a cat in this image?" },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${sampleImageBase64}` },
        },
      ]),
    );

    const text = await response.text();
    expect(text).toBe("There is a cat in the image.");
  });

  it("selects nvidia/nemotron-3-nano-omni-30b-a3b-reasoning for video analysis", async () => {
    vi.spyOn(nvidiaMultimodalService, "getNvidiaApiKey").mockReturnValue("nvapi-test-key");

    let capturedBody: any;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"A person enters the room at 0:14."}}]}\n\ndata: [DONE]\n\n',
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    const response = await nvidiaMultimodalService.analyzeMediaStream({
      conversationId: "conv-vid-1",
      question: "At what point does the person enter the room?",
      mediaItems: [
        {
          mimeType: "video/mp4",
          dataBase64: sampleVideoBase64,
          fileName: "security_camera.mp4",
        },
      ],
    });

    expect(capturedBody).toBeDefined();
    expect(capturedBody.model).toBe("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");

    const userMsg = capturedBody.messages.find((m: any) => m.role === "user");
    expect(userMsg.content).toEqual(
      expect.arrayContaining([
        { type: "text", text: "At what point does the person enter the room?" },
        {
          type: "video_url",
          video_url: { url: `data:video/mp4;base64,${sampleVideoBase64}` },
        },
      ]),
    );

    const text = await response.text();
    expect(text).toBe("A person enters the room at 0:14.");
  });

  it("handles chunked SSE streaming with split records across network packets", async () => {
    vi.spyOn(nvidiaMultimodalService, "getNvidiaApiKey").mockReturnValue("nvapi-test-key");

    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            // Packet 1: partial JSON line
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"The car is '),
            );
            // Packet 2: remainder of line + next line
            controller.enqueue(
              encoder.encode(
                'red."}}]}\n\ndata: {"choices":[{"delta":{"content":" It is moving fast."}}]}\n\ndata: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );

    const response = await nvidiaMultimodalService.analyzeMediaStream({
      conversationId: "conv-stream-1",
      question: "What color is the car?",
      mediaItems: [
        {
          mimeType: "image/jpeg",
          dataBase64: sampleImageBase64,
        },
      ],
    });

    const text = await response.text();
    expect(text).toBe("The car is red. It is moving fast.");
  });

  it("handles upstream NVIDIA error codes with clean non-leaking messages", async () => {
    vi.spyOn(nvidiaMultimodalService, "getNvidiaApiKey").mockReturnValue("nvapi-test-key");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized key" }),
    });

    const res401 = await nvidiaMultimodalService.analyzeMediaStream({
      conversationId: "conv-err",
      question: "Analyze image",
      mediaItems: [{ mimeType: "image/png", dataBase64: sampleImageBase64 }],
    });

    expect(res401.status).toBe(401);
    const body401 = await res401.json();
    expect(body401.error).toContain("NVIDIA API authentication failed");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: "Rate limit exceeded" }),
    });

    const res429 = await nvidiaMultimodalService.analyzeMediaStream({
      conversationId: "conv-err",
      question: "Analyze image",
      mediaItems: [{ mimeType: "image/png", dataBase64: sampleImageBase64 }],
    });

    expect(res429.status).toBe(429);
    const body429 = await res429.json();
    expect(body429.error).toContain("rate limited");
  });

  it("handles request cancellation cleanly when abort signal is triggered", async () => {
    vi.spyOn(nvidiaMultimodalService, "getNvidiaApiKey").mockReturnValue("nvapi-test-key");

    const abortController = new AbortController();
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";

    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);

    const response = await nvidiaMultimodalService.analyzeMediaStream({
      conversationId: "conv-abort",
      question: "Cancel this",
      mediaItems: [{ mimeType: "image/png", dataBase64: sampleImageBase64 }],
      signal: abortController.signal,
    });

    expect(response.status).toBe(499);
  });
});

describe("AttachmentContextService: Image vs Video Follow-Up Resolution", () => {
  const videoAtt: ChatAttachment = {
    id: "att-vid-1",
    conversationId: "conv-qa-multi",
    fileName: "product_demo.mp4",
    mimeType: "video/mp4",
    sizeBytes: 15_000_000,
    storageRef: "/api/media?id=media-vid-1",
    status: "ready",
    origin: "uploaded",
  };

  const imageAtt: ChatAttachment = {
    id: "att-img-1",
    conversationId: "conv-qa-multi",
    fileName: "dashboard_chart.png",
    mimeType: "image/png",
    sizeBytes: 450_000,
    storageRef: "/api/media?id=media-img-1",
    status: "ready",
    origin: "uploaded",
  };

  const conversation: Conversation = {
    id: "conv-qa-multi",
    title: "Multimodal Demo",
    updatedAt: Date.now(),
    messages: [
      { id: "m1", role: "user", text: "Here is the video", attachments: [videoAtt] },
      { id: "m2", role: "assistant", text: "I have loaded the video." },
      { id: "m3", role: "user", text: "And here is a screenshot", attachments: [imageAtt] },
      { id: "m4", role: "assistant", text: "I have loaded the screenshot." },
    ],
  };

  it("routes 'Explain what happens in this video.' to the video attachment", () => {
    const resolved = attachmentContextService.resolveContext(
      conversation,
      "Explain what happens in this video.",
    );
    expect(resolved.targetAttachment?.id).toBe("att-vid-1");
    expect(resolved.targetAttachment?.mimeType).toBe("video/mp4");
  });

  it("routes 'Summarize the video.' to the video attachment", () => {
    const resolved = attachmentContextService.resolveContext(conversation, "Summarize the video.");
    expect(resolved.targetAttachment?.id).toBe("att-vid-1");
  });

  it("routes 'Is there a car in this image?' to the image attachment", () => {
    const resolved = attachmentContextService.resolveContext(
      conversation,
      "Is there a car in this image?",
    );
    expect(resolved.targetAttachment?.id).toBe("att-img-1");
    expect(resolved.targetAttachment?.mimeType).toBe("image/png");
  });

  it("routes 'At what point does the person enter the room?' to video", () => {
    const resolved = attachmentContextService.resolveContext(
      conversation,
      "At what point does the person enter the room?",
    );
    expect(resolved.targetAttachment?.id).toBe("att-vid-1");
  });
});

describe("Video File Processing & Validation", () => {
  it("processes MP4 and WebM videos accurately with fileType 'video'", async () => {
    const mp4Bytes = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
    ]);
    const mp4Result = await fileProcessingService.processFile(mp4Bytes, "clip.mp4", "video/mp4");
    expect(mp4Result.success).toBe(true);
    expect(mp4Result.fileType).toBe("video");
    expect(mp4Result.mimeType).toBe("video/mp4");

    const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00]);
    const webmResult = await fileProcessingService.processFile(
      webmBytes,
      "animation.webm",
      "video/webm",
    );
    expect(webmResult.success).toBe(true);
    expect(webmResult.fileType).toBe("video");
    expect(webmResult.mimeType).toBe("video/webm");
  });

  it("validates video buffer signatures correctly in mediaStorageService", () => {
    const mp4Bytes = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
    ]);
    const res = mediaStorageService.validateVideoBuffer(mp4Bytes);
    expect(res.valid).toBe(true);
    expect(res.detectedMime).toBe("video/mp4");

    const invalidBytes = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    expect(mediaStorageService.validateVideoBuffer(invalidBytes).valid).toBe(false);
  });
});
