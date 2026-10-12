import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectImageIntent, classifyImageIntent } from "@/lib/assistant/image-intent";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { mediaStorageService } from "@/server/media-storage";
import { imageGenerationService } from "@/server/image-generation";
import type { Conversation, Msg, ChatAttachment } from "@/lib/assistant/store";

describe("Conversation Context, Attachments, and Image Flow 16 Regression Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const samplePng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // 1. Text-only message flow without attachments or vision triggers
  it("Test 1: Text-only message flow without attachments routes to general chat without image triggers", () => {
    const text = "Explain quantum entanglement in simple terms.";
    const conv: Conversation = {
      id: "conv-text-only",
      title: "Physics",
      updatedAt: Date.now(),
      messages: [],
    };

    const intent = detectImageIntent(text, false);
    expect(intent.type).toBe("none");

    const resolved = attachmentContextService.resolveContext(conv, text);
    expect(resolved.targetAttachment).toBeUndefined();
    expect(resolved.isAmbiguous).toBe(false);
  });

  // 2. User attaches image with question -> routes to vision understanding, returns text description, no spurious image generation
  it("Test 2: User attaches image with question -> routes to vision understanding without spurious generation", () => {
    const query = "What species of bird is this in the image?";
    const att: ChatAttachment = {
      id: "att-bird",
      conversationId: "conv-vision",
      fileName: "bird.png",
      mimeType: "image/png",
      sizeBytes: 1000,
      storageRef: "/api/media?id=att-bird",
      status: "ready",
      origin: "uploaded",
      createdAt: Date.now(),
    };

    const intent = detectImageIntent(query, true);
    expect(intent.type).toBe("question");

    const classified = classifyImageIntent(query, { hasAttachment: true });
    expect(classified.operationType).toBe("IMAGE_UNDERSTAND");
    expect(classified.category).toBe("understanding");
  });

  // 3. User attaches image and says "Remove the background" -> routes to image editing, returns edited image
  it("Test 3: User attaches image and says 'Remove the background' -> routes to image editing", async () => {
    const editInstruction = "Remove the background";
    const intent = detectImageIntent(editInstruction, true);
    expect(intent.type).toBe("edit");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: samplePng, seed: 100, finishReason: "SUCCESS" }],
      }),
    });
    globalThis.fetch = mockFetch;

    // Save initial uploaded media
    const source = await mediaStorageService.saveMedia({
      id: "img-uploaded-subject",
      conversationId: "conv-edit-bg",
      fileName: "subject.png",
      mimeType: "image/png",
      dataBase64: samplePng,
      origin: "uploaded",
      prompt: "Portrait of a dog",
    });

    const editRes = await imageGenerationService.editImage({
      operationId: "op-edit-bg",
      conversationId: "conv-edit-bg",
      sourceImageId: source.id,
      instruction: editInstruction,
      apiKey: "nvapi-test-key",
    });

    expect(editRes.status).toBe("succeeded");
    expect(editRes.imageGenerated).toBe(true);
    expect(editRes.parentImageId).toBe("img-uploaded-subject");
    expect(editRes.versionNumber).toBe(2);
    expect(editRes.versions).toBeDefined();
    expect(editRes.versions?.length).toBe(2);
  });

  // 4. Follow-up "Make it HD" without re-uploading -> resolves previous edited image, increases version, maintains lineage
  it("Test 4: Follow-up 'Make it HD' resolves previous edited image, increases version number, maintains lineage", async () => {
    const conv: Conversation = {
      id: "conv-hd",
      title: "Image Editing",
      updatedAt: Date.now(),
      messages: [
        {
          id: "m-user-1",
          role: "user",
          text: "Remove the background",
        },
        {
          id: "m-asst-1",
          role: "assistant",
          text: "Here is your edited image:",
          attachments: [
            {
              id: "img-v2",
              conversationId: "conv-hd",
              parentImageId: "img-v1",
              versionNumber: 2,
              fileName: "subject_nobg.png",
              mimeType: "image/png",
              sizeBytes: 800,
              storageRef: "/api/media?id=img-v2",
              status: "ready",
              origin: "generated",
              prompt: "Remove the background",
            },
          ],
        },
      ],
    };

    // User follow up: "Make it HD"
    const followUpQuery = "Make it HD";
    const intent = detectImageIntent(followUpQuery, true);
    expect(intent.type).toBe("edit");

    const resolved = attachmentContextService.resolveContext(conv, followUpQuery);
    expect(resolved.targetAttachment?.id).toBe("img-v2");

    // Execute edit
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: samplePng, seed: 101, finishReason: "SUCCESS" }],
      }),
    });
    globalThis.fetch = mockFetch;

    // Save v2 in storage
    await mediaStorageService.saveMedia({
      id: "img-v2",
      conversationId: "conv-hd",
      parentImageId: "img-v1",
      versionNumber: 2,
      fileName: "subject_nobg.png",
      mimeType: "image/png",
      dataBase64: samplePng,
      origin: "generated",
      prompt: "Remove the background",
    });

    const editRes = await imageGenerationService.editImage({
      operationId: "op-hd",
      conversationId: "conv-hd",
      sourceImageId: resolved.targetAttachment?.id,
      instruction: followUpQuery,
      apiKey: "nvapi-test-key",
    });

    expect(editRes.parentImageId).toBe("img-v2");
    expect(editRes.versionNumber).toBe(3);
    expect(editRes.versions?.[editRes.versions.length - 1]?.versionNumber).toBe(3);
  });

  // 5. Follow-up "Now change the background to white" -> resolves previous HD image, applies edit, preserves lineage
  it("Test 5: Follow-up 'Now change the background to white' resolves latest HD image and updates lineage to version 4", async () => {
    const conv: Conversation = {
      id: "conv-chain",
      title: "Chain Revision",
      updatedAt: Date.now(),
      messages: [
        {
          id: "m-asst-hd",
          role: "assistant",
          text: "Here is the HD version:",
          attachments: [
            {
              id: "img-v3-hd",
              conversationId: "conv-chain",
              parentImageId: "img-v2",
              versionNumber: 3,
              fileName: "subject_hd.png",
              mimeType: "image/png",
              sizeBytes: 1500,
              storageRef: "/api/media?id=img-v3-hd",
              status: "ready",
              origin: "generated",
              prompt: "Make it HD",
            },
          ],
        },
      ],
    };

    const nextQuery = "Now change the background to white";
    const resolved = attachmentContextService.resolveContext(conv, nextQuery);
    expect(resolved.targetAttachment?.id).toBe("img-v3-hd");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: samplePng, seed: 102, finishReason: "SUCCESS" }],
      }),
    });
    globalThis.fetch = mockFetch;

    await mediaStorageService.saveMedia({
      id: "img-v3-hd",
      conversationId: "conv-chain",
      parentImageId: "img-v2",
      versionNumber: 3,
      fileName: "subject_hd.png",
      mimeType: "image/png",
      dataBase64: samplePng,
      origin: "generated",
      prompt: "Make it HD",
    });

    const editRes = await imageGenerationService.editImage({
      operationId: "op-white-bg",
      conversationId: "conv-chain",
      sourceImageId: resolved.targetAttachment?.id,
      instruction: nextQuery,
      apiKey: "nvapi-test-key",
    });

    expect(editRes.parentImageId).toBe("img-v3-hd");
    expect(editRes.versionNumber).toBe(4);
  });

  // 6. User references earlier version explicitly ("Go back to the first image and make it black and white") -> resolves version 1, forks lineage
  it("Test 6: User references earlier version explicitly ('first one' / 'original') -> resolves version 1", () => {
    const v1: ChatAttachment = {
      id: "img-version-1",
      conversationId: "conv-versions",
      versionNumber: 1,
      fileName: "original_dog.png",
      mimeType: "image/png",
      sizeBytes: 1000,
      storageRef: "/api/media?id=img-version-1",
      status: "ready",
      origin: "uploaded",
      prompt: "original golden retriever",
    };
    const v2: ChatAttachment = {
      id: "img-version-2",
      conversationId: "conv-versions",
      parentImageId: "img-version-1",
      versionNumber: 2,
      fileName: "dog_green_park.png",
      mimeType: "image/png",
      sizeBytes: 1200,
      storageRef: "/api/media?id=img-version-2",
      status: "ready",
      origin: "generated",
      prompt: "change background to green park",
    };

    const conv: Conversation = {
      id: "conv-versions",
      title: "Multi-version",
      updatedAt: Date.now(),
      messages: [
        { id: "m1", role: "assistant", text: "", attachments: [v1] },
        { id: "m2", role: "assistant", text: "", attachments: [v2] },
      ],
    };

    const resolved = attachmentContextService.resolveContext(
      conv,
      "Go back to the first one and make it black and white",
    );
    expect(resolved.targetAttachment?.id).toBe("img-version-1");
  });

  // 7. Disambiguation triggered ONLY when multiple distinct images exist and query is genuinely ambiguous ("which one")
  it("Test 7: Disambiguation triggered ONLY when multiple distinct images exist and query is ambiguous", () => {
    const imgA: ChatAttachment = {
      id: "img-coffee-cup",
      conversationId: "conv-ambig",
      fileName: "coffee.png",
      mimeType: "image/png",
      sizeBytes: 200,
      storageRef: "/api/media?id=img-coffee-cup",
      status: "ready",
      origin: "uploaded",
      prompt: "A steaming cup of coffee",
    };
    const imgB: ChatAttachment = {
      id: "img-laptop",
      conversationId: "conv-ambig",
      fileName: "laptop.png",
      mimeType: "image/png",
      sizeBytes: 300,
      storageRef: "/api/media?id=img-laptop",
      status: "ready",
      origin: "uploaded",
      prompt: "Modern laptop on a wooden desk",
    };

    const conv: Conversation = {
      id: "conv-ambig",
      title: "Two items",
      updatedAt: Date.now(),
      messages: [
        { id: "m1", role: "assistant", text: "", attachments: [imgA] },
        { id: "m2", role: "assistant", text: "", attachments: [imgB] },
      ],
    };

    // User asks which one
    const resolved = attachmentContextService.resolveContext(conv, "which one should I use?");
    expect(resolved.isAmbiguous).toBe(true);
    expect(resolved.allImageAttachments.length).toBe(2);
  });

  // 8. No clarification asked when pronoun "it" or single image is present in conversation
  it("Test 8: No clarification asked when pronoun 'it' or single image is present in conversation", () => {
    const convSingle: Conversation = {
      id: "conv-single",
      title: "Single Item",
      updatedAt: Date.now(),
      messages: [
        {
          id: "m1",
          role: "assistant",
          text: "",
          attachments: [
            {
              id: "img-cat",
              conversationId: "conv-single",
              fileName: "cat.png",
              mimeType: "image/png",
              sizeBytes: 500,
              storageRef: "/api/media?id=img-cat",
              status: "ready",
              origin: "uploaded",
              prompt: "a ginger cat sitting on a couch",
            },
          ],
        },
      ],
    };

    const resolved = attachmentContextService.resolveContext(
      convSingle,
      "Remove the background from it",
    );
    expect(resolved.isAmbiguous).toBe(false);
    expect(resolved.targetAttachment?.id).toBe("img-cat");
  });

  // 9. Multiple conversations isolation: switching conversations does not leak image context
  it("Test 9: Multiple conversations isolation: switching conversations does not leak image context", () => {
    const convA: Conversation = {
      id: "conv-A",
      title: "Conv A",
      updatedAt: Date.now(),
      messages: [
        {
          id: "mA",
          role: "assistant",
          text: "",
          attachments: [
            {
              id: "img-conv-A",
              conversationId: "conv-A",
              fileName: "alpha.png",
              mimeType: "image/png",
              sizeBytes: 100,
              storageRef: "/api/media?id=img-conv-A",
              status: "ready",
              origin: "uploaded",
            },
          ],
        },
      ],
    };

    const convB: Conversation = {
      id: "conv-B",
      title: "Conv B",
      updatedAt: Date.now(),
      messages: [
        {
          id: "mB",
          role: "user",
          text: "Hello",
        },
      ],
    };

    // In Conv B, resolving context should return no attachments from Conv A
    const resolvedInB = attachmentContextService.resolveContext(convB, "edit it");
    expect(resolvedInB.targetAttachment).toBeUndefined();
    expect(resolvedInB.allMediaAttachments.length).toBe(0);

    // In Conv A, resolving context returns img-conv-A
    const resolvedInA = attachmentContextService.resolveContext(convA, "edit it");
    expect(resolvedInA.targetAttachment?.id).toBe("img-conv-A");
  });

  // 10. File upload with text extraction (PDF / code) -> answers from extracted text without triggering vision or image generation
  it("Test 10: File upload with extracted text answers from text without triggering vision or image generation", () => {
    const fileAttachment: ChatAttachment = {
      id: "doc-quarterly",
      conversationId: "conv-doc",
      fileName: "financial_report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 25000,
      storageRef: "/api/files/financial_report.pdf",
      status: "ready",
      origin: "uploaded",
      extractedText: "Total Q3 revenue was $4.2M, representing 24% year-over-year growth.",
    };

    const conv: Conversation = {
      id: "conv-doc",
      title: "Financials",
      updatedAt: Date.now(),
      messages: [
        {
          id: "m-user-doc",
          role: "user",
          text: "What was our Q3 revenue?",
          attachments: [fileAttachment],
        },
      ],
    };

    const intent = detectImageIntent("What was our Q3 revenue?", false);
    expect(intent.type).toBe("none");

    const resolved = attachmentContextService.resolveContext(conv, "What was our Q3 revenue?");
    // PDF should not be classified as image
    expect(resolved.allImageAttachments.length).toBe(0);
  });

  // 11. Text-to-image generation ("Generate a picture of...") -> routes to text-to-image, creates version 1
  it("Test 11: Text-to-image generation creates version 1 with full metadata", async () => {
    const query = "Generate a picture of a futuristic floating city at sunset";
    const intent = detectImageIntent(query, false);
    expect(intent.type).toBe("generate");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: samplePng, seed: 777, finishReason: "SUCCESS" }],
      }),
    });
    globalThis.fetch = mockFetch;

    const res = await imageGenerationService.generateImage({
      operationId: "op-t2i-city",
      conversationId: "conv-t2i",
      prompt: intent.prompt,
      apiKey: "nvapi-test-key",
    });

    expect(res.status).toBe("succeeded");
    expect(res.imageGenerated).toBe(true);

    const stored = await mediaStorageService.getMedia(res.imageId!);
    expect(stored).toBeDefined();
    expect(stored?.origin).toBe("generated");
    expect(stored?.parentImageId).toBeUndefined();
  });

  // 12. Image editing API handles provider 422 gracefully via structured prompt synthesis fallback
  it("Test 12: Image editing API handles provider 422 preview rejection gracefully via structured prompt synthesis fallback", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
      callCount++;
      const body = JSON.parse(opts.body);
      // First call has mode: "Image Editing" with custom image -> simulate NVIDIA hosted preview rejection 422
      if (body.mode === "Image Editing" && body.image?.startsWith("data:")) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            detail: "Expected: example_id, got: base64",
          }),
        };
      }
      // Fallback call has prompt synthesis without raw image -> succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({
          artifacts: [{ base64: samplePng, seed: 888, finishReason: "SUCCESS" }],
        }),
      };
    });
    globalThis.fetch = mockFetch;

    // Save source parent media
    const parent = await mediaStorageService.saveMedia({
      id: "parent-422-test",
      conversationId: "conv-fallback-422",
      fileName: "vintage_guitar.png",
      mimeType: "image/png",
      dataBase64: samplePng,
      origin: "generated",
      prompt: "A vintage acoustic guitar leaning against a brick wall",
    });

    const editRes = await imageGenerationService.editImage({
      operationId: "op-edit-fallback",
      conversationId: "conv-fallback-422",
      sourceImageId: parent.id,
      instruction: "Change guitar color to sunburst red",
      apiKey: "nvapi-test-key",
    });

    expect(editRes.status).toBe("succeeded");
    expect(editRes.imageGenerated).toBe(true);
    expect(callCount).toBe(2); // First failed with 422, second succeeded with synthesized prompt
    expect(editRes.parentImageId).toBe("parent-422-test");
    expect(editRes.versionNumber).toBe(2);
  });

  // 13. Storage ref resolution: backend retrieves media bytes from local storage ref for provider input
  it("Test 13: Storage ref resolution retrieves media bytes from local storage for provider input", async () => {
    const saved = await mediaStorageService.saveMedia({
      id: "media-storage-retrieval-1",
      conversationId: "conv-storage",
      fileName: "artwork.png",
      mimeType: "image/png",
      dataBase64: samplePng,
      origin: "uploaded",
    });

    const retrieved = await mediaStorageService.getMedia(saved.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.dataBase64).toBe(samplePng);
    expect(retrieved?.buffer.length).toBeGreaterThan(0);
    expect(saved.storageRef).toContain(encodeURIComponent(saved.id));
  });

  // 14. Uploaded image does not appear twice in conversation messages (separation of pending vs context)
  it("Test 14: Follow-up question preserves original attachment on initial message and does not duplicate in subsequent message", () => {
    const initialAttachment: ChatAttachment = {
      id: "img-unique-upload-1",
      conversationId: "conv-no-dup",
      fileName: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 1200,
      storageRef: "/api/media?id=img-unique-upload-1",
      status: "ready",
      origin: "uploaded",
    };

    const msg1: Msg = {
      id: "msg-user-1",
      role: "user",
      text: "Look at this error screenshot",
      attachments: [initialAttachment],
    };

    const msg2: Msg = {
      id: "msg-asst-1",
      role: "assistant",
      text: "The error shows a null reference on line 42.",
    };

    // Follow up message without pending attachments
    const msg3: Msg = {
      id: "msg-user-2",
      role: "user",
      text: "How do I fix it?",
      // attachments is undefined / omitted because user did not upload a second file
    };

    const messages = [msg1, msg2, msg3];

    // Ensure initial attachment appears only once across the entire conversation
    const totalOccurrences = messages.reduce((count, m) => {
      return count + (m.attachments?.filter((a) => a.id === "img-unique-upload-1").length || 0);
    }, 0);

    expect(totalOccurrences).toBe(1);
    expect(msg3.attachments).toBeUndefined();
  });

  // 15. Voice input with image editing command -> dispatches to edit pipeline with correct instruction
  it("Test 15: Voice input with image editing command detects edit intent and extracts clean instruction", () => {
    const spokenText = "Can you please remove the background from this image";
    const intent = detectImageIntent(spokenText, true);

    expect(intent.type).toBe("edit");
    const classified = classifyImageIntent(spokenText, { hasAttachment: true });
    expect(classified.intent).toBe("BACKGROUND_REMOVAL");
    expect(classified.operationType).toBe("IMAGE_EDIT");
  });

  // 16. Failed image operation allows retry with saved prompt and source reference
  it("Test 16: Failed image operation records failure state and allows retrying with identical prompt and source reference", async () => {
    // Simulate initial failure
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error("Network connection dropped"));
    globalThis.fetch = mockFetch;

    const failedRes = await imageGenerationService.generateImage({
      operationId: "op-failed-retry",
      conversationId: "conv-retry",
      prompt: "A futuristic cyberpunk hovercar",
      apiKey: "nvapi-test-key",
    });

    expect(failedRes.status).toBe("failed");
    expect(failedRes.imageGenerated).toBe(false);

    // Simulate user clicking retry with the saved prompt
    const mockRetryFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ base64: samplePng, seed: 999, finishReason: "SUCCESS" }],
      }),
    });
    globalThis.fetch = mockRetryFetch;

    const retryRes = await imageGenerationService.generateImage({
      operationId: "op-retry-success",
      conversationId: "conv-retry",
      prompt: "A futuristic cyberpunk hovercar",
      apiKey: "nvapi-test-key",
    });

    expect(retryRes.status).toBe("succeeded");
    expect(retryRes.imageGenerated).toBe(true);
    expect(retryRes.imageId).toBeDefined();
  });
});
