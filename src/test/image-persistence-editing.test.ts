import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectImageIntent } from "@/lib/assistant/image-intent";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { mediaStorageService } from "@/server/media-storage";
import { imageGenerationService } from "@/server/image-generation";
import type { Conversation, Msg, ChatAttachment } from "@/lib/assistant/store";

describe("Image Persistence, Lineage, and Follow-up Context Regression Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const samplePng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // Test 1: Generate initial image and verify durable persistence and storage ref
  it("Test 1: Persists generated image with full metadata (dimensions, model, prompt, storageRef)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: samplePng, seed: 10, finishReason: "SUCCESS" }],
      }),
    });
    globalThis.fetch = mockFetch;

    const res = await imageGenerationService.generateImage({
      operationId: "op-test-1",
      conversationId: "conv-persisted-1",
      prompt: "a vintage sports car in the rain",
      apiKey: "nvapi-valid-key",
      width: 1024,
      height: 1024,
    });

    expect(res.status).toBe("succeeded");
    expect(res.imageGenerated).toBe(true);
    expect(res.imageId).toBeDefined();
    expect(res.imageUrl).toContain(`/api/media?id=${res.imageId}`);

    // Verify stored media item can be retrieved with all metadata
    const stored = await mediaStorageService.getMedia(res.imageId!);
    expect(stored).toBeDefined();
    expect(stored?.conversationId).toBe("conv-persisted-1");
    expect(stored?.origin).toBe("generated");
    expect(stored?.originalPrompt).toBe("a vintage sports car in the rain");
    expect(stored?.width).toBe(1024);
    expect(stored?.height).toBe(1024);
    expect(stored?.model).toBe("black-forest-labs/flux.2-klein-4b");
  });

  // Test 2: Reload conversation and ensure attachments remain intact
  it("Test 2: Conversation messages preserve attachments across loads without dropping metadata", () => {
    const originalAttachment: ChatAttachment = {
      id: "img-car-1",
      conversationId: "conv-101",
      messageId: "msg-asst-1",
      origin: "generated",
      fileName: "vintage_sports_car.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageRef: "/api/media?id=img-car-1",
      status: "ready",
      prompt: "a vintage sports car in the rain",
      createdAt: 1700000000,
    };

    const conv: Conversation = {
      id: "conv-101",
      title: "Car Discussion",
      updatedAt: 1700000000,
      messages: [
        { id: "m-user-1", role: "user", text: "Generate a sports car" },
        {
          id: "msg-asst-1",
          role: "assistant",
          text: "Here is your generated image:",
          attachments: [originalAttachment],
        },
      ],
    };

    // Serialize / deserialize simulating PostgreSQL JSON round-trip
    const serialized = JSON.stringify(conv);
    const deserialized: Conversation = JSON.parse(serialized);

    expect(deserialized.messages[1]?.attachments).toBeDefined();
    expect(deserialized.messages[1]?.attachments?.length).toBe(1);
    const restoredAtt = deserialized.messages[1]?.attachments?.[0];
    expect(restoredAtt?.id).toBe("img-car-1");
    expect(restoredAtt?.storageRef).toBe("/api/media?id=img-car-1");
    expect(restoredAtt?.prompt).toBe("a vintage sports car in the rain");
  });

  // Test 3: Follow-up edit resolves latest image and sends it as base64 with Image Editing mode
  it("Test 3: Follow-up edit resolves the previous image and dispatches with mode='Image Editing'", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: samplePng, seed: 12, finishReason: "SUCCESS" }],
      }),
    });
    globalThis.fetch = mockFetch;

    const conv: Conversation = {
      id: "conv-edit",
      title: "Car Edit",
      updatedAt: 1700000000,
      messages: [
        {
          id: "m-asst-prev",
          role: "assistant",
          text: "Here is your car",
          attachments: [
            {
              id: "img-orig",
              conversationId: "conv-edit",
              origin: "generated",
              fileName: "car.png",
              mimeType: "image/png",
              sizeBytes: 500,
              storageRef: "/api/media?id=img-orig",
              status: "ready",
              prompt: "a blue sports car",
            },
          ],
        },
      ],
    };

    // Intent detection
    const intent = detectImageIntent("change its color to red", true);
    expect(intent.type).toBe("edit");

    // Context resolution
    const resolved = attachmentContextService.resolveContext(conv, "change its color to red");
    expect(resolved.targetAttachment?.id).toBe("img-orig");

    // Execute generation with image passed and parentImageId set
    const editRes = await imageGenerationService.generateImage({
      operationId: "op-edit-2",
      conversationId: "conv-edit",
      parentImageId: resolved.targetAttachment?.id,
      prompt: "change its color to red",
      image: `data:image/png;base64,${samplePng}`,
      apiKey: "nvapi-valid-key",
    });

    expect(editRes.status).toBe("succeeded");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callArgs = mockFetch.mock.calls[0]!;
    const body = JSON.parse((callArgs[1] as any).body);
    expect(body.mode).toBe("Image Editing");
    expect(typeof body.image).toBe("string");
    expect(body.image).toBe(`data:image/png;base64,${samplePng}`);

    // Verify parentImageId recorded on persisted item
    const storedEdited = await mediaStorageService.getMedia(editRes.imageId!);
    expect(storedEdited?.parentImageId).toBe("img-orig");
  });

  // Test 4: Sequential edits (Image A -> Image B -> Image C)
  it("Test 4: Sequential edits preserve lineage chain across A -> B -> C", async () => {
    // A: initial image
    const itemA = await mediaStorageService.saveMedia({
      id: "img-A",
      conversationId: "conv-seq",
      fileName: "car-A.png",
      mimeType: "image/png",
      dataBase64: samplePng,
      origin: "generated",
      prompt: "a blue sports car",
    });
    expect(itemA.id).toBe("img-A");

    // B: edit of A
    const itemB = await mediaStorageService.saveMedia({
      id: "img-B",
      conversationId: "conv-seq",
      parentImageId: itemA.id,
      fileName: "car-B.png",
      mimeType: "image/png",
      dataBase64: samplePng,
      origin: "generated",
      prompt: "change color to red",
    });
    expect(itemB.parentImageId).toBe("img-A");

    // C: edit of B
    const itemC = await mediaStorageService.saveMedia({
      id: "img-C",
      conversationId: "conv-seq",
      parentImageId: itemB.id,
      fileName: "car-C.png",
      mimeType: "image/png",
      dataBase64: samplePng,
      origin: "generated",
      prompt: "add racing stripes",
    });
    expect(itemC.parentImageId).toBe("img-B");

    // Build conversation with all 3 in sequence
    const conv: Conversation = {
      id: "conv-seq",
      title: "Sequential Edit",
      updatedAt: Date.now(),
      messages: [
        { id: "m1", role: "assistant", text: "", attachments: [itemA] },
        { id: "m2", role: "assistant", text: "", attachments: [itemB] },
        { id: "m3", role: "assistant", text: "", attachments: [itemC] },
      ],
    };

    // Subsequent follow up ("now make wheels chrome") should resolve the newest (img-C)
    const nextResolve = attachmentContextService.resolveContext(conv, "now make wheels chrome");
    expect(nextResolve.targetAttachment?.id).toBe("img-C");
  });

  // Test 5: Explicitly editing an older image by name/prompt
  it("Test 5: Explicitly references older image by description or filename", () => {
    const itemA: ChatAttachment = {
      id: "img-mountain",
      conversationId: "conv-multi",
      fileName: "mountain.png",
      mimeType: "image/png",
      sizeBytes: 100,
      storageRef: "/api/media?id=img-mountain",
      status: "ready",
      origin: "generated",
      prompt: "majestic mountain peak with snow",
    };

    const itemB: ChatAttachment = {
      id: "img-beach",
      conversationId: "conv-multi",
      fileName: "beach.png",
      mimeType: "image/png",
      sizeBytes: 100,
      storageRef: "/api/media?id=img-beach",
      status: "ready",
      origin: "generated",
      prompt: "sunny beach with palm trees",
    };

    const conv: Conversation = {
      id: "conv-multi",
      title: "Multiple Images",
      updatedAt: Date.now(),
      messages: [
        { id: "m1", role: "assistant", text: "", attachments: [itemA] },
        { id: "m2", role: "assistant", text: "", attachments: [itemB] },
      ],
    };

    // Edit specifically referring to mountain
    const resolveMountain = attachmentContextService.resolveContext(
      conv,
      "make the snow on the mountain glow pink at sunset",
    );
    expect(resolveMountain.targetAttachment?.id).toBe("img-mountain");

    // Edit specifically referring to beach
    const resolveBeach = attachmentContextService.resolveContext(
      conv,
      "remove the palm trees from the beach picture",
    );
    expect(resolveBeach.targetAttachment?.id).toBe("img-beach");
  });

  // Test 6: Visual question vs edit intent differentiation
  it("Test 6: Differentiates visual question vs edit intent accurately", () => {
    // Questions
    expect(detectImageIntent("What color is the car in this picture?", true).type).toBe("question");
    expect(detectImageIntent("Describe the background of this image.", true).type).toBe("question");
    expect(detectImageIntent("Is there a dog visible?", true).type).toBe("question");

    // Edits
    expect(detectImageIntent("Change the background color to white", true).type).toBe("edit");
    expect(detectImageIntent("Remove the person in the background", true).type).toBe("edit");
    expect(detectImageIntent("Make this image in cyberpunk style", true).type).toBe("edit");
    expect(detectImageIntent("Turn the car blue", true).type).toBe("edit");
  });

  // Test 7: Ambiguity detection & handling
  it("Test 7: Handles ambiguity correctly with ordinal phrasing like 'first one' or 'second one'", () => {
    const item1: ChatAttachment = {
      id: "img-1",
      conversationId: "conv-amb",
      fileName: "pic1.png",
      mimeType: "image/png",
      sizeBytes: 100,
      storageRef: "/api/media?id=img-1",
      status: "ready",
      origin: "generated",
    };
    const item2: ChatAttachment = {
      id: "img-2",
      conversationId: "conv-amb",
      fileName: "pic2.png",
      mimeType: "image/png",
      sizeBytes: 100,
      storageRef: "/api/media?id=img-2",
      status: "ready",
      origin: "generated",
    };

    const conv: Conversation = {
      id: "conv-amb",
      title: "Ambiguity Test",
      updatedAt: Date.now(),
      messages: [
        { id: "m1", role: "assistant", text: "", attachments: [item1] },
        { id: "m2", role: "assistant", text: "", attachments: [item2] },
      ],
    };

    const first = attachmentContextService.resolveContext(conv, "modify the first one");
    expect(first.targetAttachment?.id).toBe("img-1");

    const second = attachmentContextService.resolveContext(conv, "modify the second one");
    expect(second.targetAttachment?.id).toBe("img-2");
  });

  // Test 8: Prevents cross-conversation image leaks
  it("Test 8: Ensures context resolution is strictly scoped to the active conversation", () => {
    const convA: Conversation = {
      id: "conv-A",
      title: "Conv A",
      updatedAt: Date.now(),
      messages: [
        {
          id: "m-a",
          role: "assistant",
          text: "",
          attachments: [
            {
              id: "img-from-A",
              conversationId: "conv-A",
              origin: "generated",
              fileName: "A.png",
              mimeType: "image/png",
              sizeBytes: 50,
              storageRef: "/api/media?id=img-from-A",
              status: "ready",
            },
          ],
        },
      ],
    };

    const convB: Conversation = {
      id: "conv-B",
      title: "Conv B (empty of media)",
      updatedAt: Date.now(),
      messages: [{ id: "m-b", role: "user", text: "Hello assistant" }],
    };

    const resB = attachmentContextService.resolveContext(convB, "make it red");
    expect(resB.targetAttachment).toBeUndefined();
    expect(resB.allMediaAttachments.length).toBe(0);
  });

  // Test 9: Provider failure does not return false success or corrupt state
  it("Test 9: Gracefully handles provider errors without reporting false success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        message: "Unprocessable Entity: invalid parameter",
      }),
    });
    globalThis.fetch = mockFetch;

    const res = await imageGenerationService.generateImage({
      operationId: "op-fail-test",
      conversationId: "conv-fail-test",
      prompt: "make background starry",
      image: `data:image/png;base64,${samplePng}`,
      apiKey: "nvapi-valid-key",
    });

    expect(res.status).toBe("failed");
    expect(res.imageGenerated).toBe(false);
    expect(res.errorCode).toContain("PROVIDER_ERROR");
    expect(res.imageUrl).toBeUndefined();
  });
});
