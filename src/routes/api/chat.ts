import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mediaStorageService } from "@/server/media-storage";
import { nvidiaMultimodalService, type MediaItem } from "@/server/nvidia-multimodal";
import { aiRouter } from "@/server/ai/router";
import type { AIRequestContext } from "@/server/ai/contracts";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { requireSessionAuth, corsJson, corsOptions, CORS_HEADERS } from "@/server/auth";

const AttachmentSchema = z.object({
  id: z.string(),
  fileName: z.string().default("file"),
  mimeType: z.string().default("text/plain"),
  extractedText: z.string().optional(),
  storageRef: z.string().optional(),
});

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(30000),
  image: z.string().max(12_000_000).optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(100),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

const SYSTEM_INSTRUCTION = `You are a helpful, clear, and concise AI chat assistant.
- Provide direct, well-structured, and helpful text answers.
- Never mention which company, provider or model powers you.
- When an image is attached, describe what is relevant to the question directly.
- When a document is attached, analyze and explain its extracted content accurately.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return corsJson({ error: "Invalid request payload format." }, { status: 400 });
        }

        const validMessages = body.messages.filter((m) => m.text?.trim().length > 0);
        const latestUserMsg =
          [...validMessages].reverse().find((m) => m.role === "user") ||
          validMessages[validMessages.length - 1];
        const questionText = latestUserMsg?.text || "";

        // 1. Gather Media Items
        const mediaItems: MediaItem[] = [];
        const attachments = latestUserMsg?.attachments || [];

        for (const att of attachments) {
          if (att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/")) {
            const mediaId = att.storageRef?.includes("id=")
              ? att.storageRef.split("id=")[1]?.split("&")[0]
              : att.id;
            if (mediaId) {
              const media = await mediaStorageService.getMedia(
                mediaId,
                auth.session.userId,
                auth.session.isAdmin,
              );
              const b64 = media?.stream ? media.stream.toString("base64") : media?.item.base64Data;
              if (media && b64) {
                mediaItems.push({
                  id: media.item.id,
                  mimeType: media.item.mimeType || att.mimeType,
                  dataBase64: b64,
                });
              }
            }
          }
        }

        if (latestUserMsg?.image && mediaItems.length === 0) {
          const match = latestUserMsg.image.match(/^data:([^;]+);base64,(.+)$/);
          if (match?.[1] && match[2]) {
            mediaItems.push({
              id: "inline-image",
              mimeType: match[1],
              dataBase64: match[2],
            });
          }
        }

        // 2. Multimodal Routing Resolution
        const hasVideo = mediaItems.some((m) => m.mimeType.startsWith("video/"));
        const hasImage = mediaItems.some((m) => m.mimeType.startsWith("image/"));
        const hasFileText = validMessages.some((m) =>
          m.attachments?.some((a) => Boolean(a.extractedText)),
        );

        const route = aiRouter.resolveRoute({
          hasVideo,
          hasImage,
          hasFileText,
          preferredModel: body.model,
        });

        if (route.provider === "nvidia" && nvidiaMultimodalService.isConfigured()) {
          const context: AIRequestContext = {
            operationId: `chat-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
            conversationId: "default",
            provider: "nvidia",
            taskType: route.taskType,
            model: route.model,
          };

          const userContent = await nvidiaMultimodalService.buildMultimodalMessage(questionText, mediaItems);
          const messages = [
            ...validMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.text })),
            { role: "user", content: userContent },
          ];

          return aiRouter.executeNvidiaMultimodalStream({
            context,
            messages,
          });
        }

        // 3. Google Gemini Fallback Engine
        const apiKey =
          (body.apiKey && !body.apiKey.startsWith("nvapi-") ? body.apiKey.trim() : undefined) ||
          process.env["GOOGLE_API_KEY"];

        if (!apiKey) {
          return corsJson(
            { error: "Google API key is not configured on the backend." },
            { status: 500 },
          );
        }

        const contents = validMessages.map((m) => {
          const parts: Array<Record<string, unknown>> = [];

          if (m.attachments) {
            for (const att of m.attachments) {
              if (att.extractedText) {
                parts.push({
                  text: `[Attached Document: ${att.fileName}]\n${att.extractedText}\n[End of Document]`,
                });
              }
            }
          }

          parts.push({ text: m.text });
          return { role: m.role === "assistant" ? "model" : "user", parts };
        });

        const selectedModel = body.model || "gemini-2.5-flash";
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            selectedModel,
          )}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            signal: request.signal,
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
              contents,
            }),
          },
        );

        if (!upstream.ok || !upstream.body) {
          return corsJson(
            { error: "Upstream generation failed.", status: upstream.status },
            { status: upstream.status },
          );
        }

        // Streaming Transform
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";

        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const jsonText = trimmed.slice(5).trim();
                if (!jsonText || jsonText === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(jsonText);
                  const text = parsed.candidates?.[0]?.content?.parts
                    ?.map((p: { text?: string }) => p.text || "")
                    .join("");
                  if (text) {
                    controller.enqueue(encoder.encode(text));
                  }
                } catch {
                  // Buffer partial chunk until complete
                }
              }
            } catch (err) {
              controller.error(err);
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
