import { describe, it, expect, vi, beforeEach } from "vitest";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { detectImageIntent } from "@/lib/assistant/image-intent";
import { aiRouter } from "@/server/ai/router";
import type { ChatAttachment, Conversation, Msg } from "@/lib/assistant/store";

describe("Critical Bug Fix: Normal Text Chat Resumption After Image Generation", () => {
  let convWithImage: Conversation;

  beforeEach(() => {
    const generatedAttachment: ChatAttachment = {
      id: "generated-cafe-img",
      conversationId: "conv-1",
      fileName: "cafe.png",
      mimeType: "image/png",
      sizeBytes: 150000,
      storageRef: "/api/media?id=generated-cafe-img",
      dataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      status: "ready",
      origin: "generated",
      prompt: "3D chibi-style miniature concept store of Balaji's Cafe",
      createdAt: Date.now() - 5000,
    };

    convWithImage = {
      id: "conv-1",
      title: "Cafe concept",
      updatedAt: Date.now(),
      messages: [
        {
          id: "m-user-gen",
          role: "user",
          text: "Generate image of 3D chibi-style miniature concept store of Balaji's Cafe",
        },
        {
          id: "m-asst-gen",
          role: "assistant",
          text: "Here is your generated image:",
          attachments: [generatedAttachment],
        },
      ],
    };
  });

  // Scenario 1: Generate an image -> send "Hi" -> receive a normal text response (no image context attached, route to text_chat)
  it("Scenario 1: Generate an image -> send 'Hi' -> classifies as general chat and does not attach image", () => {
    const intent = detectImageIntent("Hi", true);
    expect(intent.type).toBe("none");

    const resolved = attachmentContextService.resolveContext(convWithImage, "Hi");
    expect(resolved.targetAttachment).toBeUndefined();

    const route = aiRouter.resolveRoute({
      hasVideo: false,
      hasImage: Boolean(resolved.targetAttachment),
      hasFileText: false,
    });
    expect(route.taskType).toBe("text_chat");
    expect(route.provider).toBe("google");
  });

  // Scenario 2: Generate an image -> ask "What is Java?" -> receive normal explanation
  it("Scenario 2: Generate an image -> ask 'What is Java?' -> routes to normal text chat", () => {
    const intent = detectImageIntent("What is Java?", true);
    expect(intent.type).toBe("none");

    const resolved = attachmentContextService.resolveContext(convWithImage, "What is Java?");
    expect(resolved.targetAttachment).toBeUndefined();

    const route = aiRouter.resolveRoute({
      hasVideo: false,
      hasImage: false,
      hasFileText: false,
    });
    expect(route.taskType).toBe("text_chat");
  });

  // Scenario 3: Generate an image -> ask for a Java program -> receive normal code
  it("Scenario 3: Generate an image -> ask for a Java program -> routes to normal text chat", () => {
    const query = "Write a Java program to reverse a linked list";
    const intent = detectImageIntent(query, true);
    expect(intent.type).toBe("none");

    const resolved = attachmentContextService.resolveContext(convWithImage, query);
    expect(resolved.targetAttachment).toBeUndefined();

    const route = aiRouter.resolveRoute({
      hasVideo: false,
      hasImage: false,
      hasFileText: false,
    });
    expect(route.taskType).toBe("text_chat");
  });

  // Scenario 4: Generate an image -> ask "Make it brighter" -> detects editing intent and resolves previous image
  it("Scenario 4: Generate an image -> ask 'Make it brighter' -> detects edit intent and binds to previous image", () => {
    const query = "Make it brighter";
    const intent = detectImageIntent(query, true);
    expect(intent.type).toBe("edit");

    const resolved = attachmentContextService.resolveContext(convWithImage, query);
    expect(resolved.targetAttachment).toBeDefined();
    expect(resolved.targetAttachment?.id).toBe("generated-cafe-img");
  });

  // Scenario 5: Generate an image -> ask "What does this image show?" -> performs image understanding
  it("Scenario 5: Generate an image -> ask 'What does this image show?' -> resolves target image and routes to image understanding", () => {
    const query = "What does this image show?";
    const intent = detectImageIntent(query, true);
    expect(["question", "none"]).toContain(intent.type);

    const resolved = attachmentContextService.resolveContext(convWithImage, query);
    expect(resolved.targetAttachment).toBeDefined();
    expect(resolved.targetAttachment?.id).toBe("generated-cafe-img");

    const route = aiRouter.resolveRoute({
      hasVideo: false,
      hasImage: true,
      hasFileText: false,
    });
    expect(route.taskType).toBe("image_understanding");
  });

  // Scenario 6: Generate an image -> send several normal messages consecutively
  it("Scenario 6: Generate an image -> send several normal messages consecutively without getting trapped in image mode", () => {
    const normalQueries = [
      "Hi",
      "Explain recursion in simple words",
      "Give me 3 examples",
      "What is AI?",
      "Thanks, that was clear!",
    ];

    for (const q of normalQueries) {
      const intent = detectImageIntent(q, true);
      expect(intent.type).toBe("none");

      const resolved = attachmentContextService.resolveContext(convWithImage, q);
      expect(resolved.targetAttachment).toBeUndefined();

      const route = aiRouter.resolveRoute({
        hasVideo: false,
        hasImage: false,
        hasFileText: false,
      });
      expect(route.taskType).toBe("text_chat");
    }
  });

  // Scenario 7: Generate an image -> trigger provider failure -> verify normal chat still works
  it("Scenario 7: Image generation failure records failure state and does not prevent subsequent normal chat", () => {
    const failedMsg: Msg = {
      id: "m-failed",
      role: "assistant",
      text: "I couldn't generate the image. Please try again.",
      generatingImage: false,
      generationFailed: true,
      imagePrompt: "failing prompt",
    };
    const convFailed = {
      ...convWithImage,
      messages: [...convWithImage.messages, failedMsg],
    };

    // Subsequent normal message should work independently
    const nextIntent = detectImageIntent("What is the capital of France?", true);
    expect(nextIntent.type).toBe("none");

    const resolved = attachmentContextService.resolveContext(
      convFailed,
      "What is the capital of France?",
    );
    expect(resolved.targetAttachment).toBeUndefined();

    const route = aiRouter.resolveRoute({
      hasVideo: false,
      hasImage: false,
      hasFileText: false,
    });
    expect(route.taskType).toBe("text_chat");
  });

  // Scenario 8: Switch conversations during image generation -> verify no stale state leaks
  it("Scenario 8: Context resolution is isolated between conversations", () => {
    const convEmpty: Conversation = {
      id: "conv-2-clean",
      title: "New clean chat",
      updatedAt: Date.now(),
      messages: [
        {
          id: "m-clean",
          role: "user",
          text: "What is 2 + 2?",
        },
      ],
    };

    const resolvedInClean = attachmentContextService.resolveContext(convEmpty, "Hi");
    expect(resolvedInClean.targetAttachment).toBeUndefined();
    expect(resolvedInClean.allMediaAttachments.length).toBe(0);
  });

  // Scenario 9: Verify image remains visible in history after normal messages are sent
  it("Scenario 9: Generated image remains intact in conversation history after normal messages are added", () => {
    const updatedConv: Conversation = {
      ...convWithImage,
      messages: [
        ...convWithImage.messages,
        { id: "m-user-norm", role: "user", text: "What is AI?" },
        { id: "m-asst-norm", role: "assistant", text: "Artificial Intelligence refers to..." },
      ],
    };

    const initialAsstMsg = updatedConv.messages.find((m) => m.id === "m-asst-gen");
    expect(initialAsstMsg?.attachments?.length).toBe(1);
    expect(initialAsstMsg?.attachments?.[0]?.storageRef).toBe("/api/media?id=generated-cafe-img");

    // Later question about the image can still find it!
    const visualFollowup = attachmentContextService.resolveContext(
      updatedConv,
      "What color is the cafe in that picture?",
    );
    expect(visualFollowup.targetAttachment?.id).toBe("generated-cafe-img");
  });

  // Scenario 10: Verify message intent classification separates text chat from image generation and editing
  it("Scenario 10: Classifies diverse prompts into their independent operation modes", () => {
    // Text queries
    expect(detectImageIntent("Hi").type).toBe("none");
    expect(detectImageIntent("Explain Java inheritance").type).toBe("none");
    expect(detectImageIntent("Write a Java program").type).toBe("none");
    expect(detectImageIntent("What is AI?").type).toBe("none");

    // New generation queries
    expect(detectImageIntent("Generate image of a futuristic cafe").type).toBe("generate");
    expect(detectImageIntent("Create a picture of an astronaut riding a horse").type).toBe(
      "generate",
    );

    // Editing queries (with existing media present)
    expect(detectImageIntent("Make it brighter", true).type).toBe("edit");
    expect(detectImageIntent("Remove the background", true).type).toBe("edit");
    expect(detectImageIntent("Expand", true).type).toBe("edit");
  });
});
