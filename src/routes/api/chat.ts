import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mediaStorageService } from "@/server/media-storage";
import { nvidiaMultimodalService, type MediaItem } from "@/server/nvidia-multimodal";
import { aiRouter } from "@/server/ai/router";
import type { AIRequestContext } from "@/server/ai/contracts";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const AttachmentSchema = z.object({
  id: z.string(),
  fileName: z.string().default("file"),
  mimeType: z.string().default("text/plain"),
  extractedText: z.string().optional(),
  storageRef: z.string().optional(),
});

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(20000),
  image: z.string().max(8_000_000).optional(), // data URL (jpeg/png)
  attachments: z.array(AttachmentSchema).optional(),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(60),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

const SYSTEM = `You are a helpful, clear, and concise AI chat assistant.
- Provide direct, well-structured, and helpful text answers.
- Never mention which company, provider or model powers you.
- When an image is attached, describe what is relevant to the question directly.
- When a document or file is attached, analyze and explain its actual extracted content directly.`;

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
          return corsJson({ error: "Invalid request." }, { status: 400 });
        }

        const validMessages = body.messages.filter(
          (m) => m.text?.trim() && m.text !== "Something went wrong. Please try again.",
        );
        const latestUserMsg =
          [...validMessages].reverse().find((m) => m.role === "user") ||
          validMessages[validMessages.length - 1];
        const questionText = latestUserMsg?.text || "";

        // 1. Gather media items ONLY for the active query
        const mediaItems: MediaItem[] = [];

        // Check if the current user message has direct media attachments
        const latestMediaAttachments = (latestUserMsg?.attachments || []).filter(
          (a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/"),
        );

        let relevantAttachments = latestMediaAttachments;

        // If no direct media attachments on the latest user message, check if the question specifically asks about conversation media
        if (relevantAttachments.length === 0 && !latestUserMsg?.image) {
          if (attachmentContextService.isMediaRelatedQuery(questionText)) {
            const historyMedia = body.messages
              .flatMap((m) => m.attachments || [])
              .filter((a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/"));
            if (historyMedia.length > 0) {
              relevantAttachments = [historyMedia[historyMedia.length - 1]!];
            }
          }
        }

        // Deduplicate attachments by id
        const seenAttIds = new Set<string>();
        for (const att of relevantAttachments) {
          if (seenAttIds.has(att.id)) continue;
          seenAttIds.add(att.id);

          if (att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/")) {
            const mediaId = att.storageRef?.includes("id=")
              ? att.storageRef.split("id=")[1]?.split("&")[0]
              : att.id;
            if (mediaId) {
              const item = await mediaStorageService.getMedia(mediaId);
              if (item && item.dataBase64) {
                mediaItems.push({
                  id: item.id,
                  mimeType: item.mimeType || att.mimeType,
                  dataBase64: item.dataBase64,
                  fileName: att.fileName,
                });
              }
            }
          }
        }

        // Check if inline image data URI is present on latest message
        if (latestUserMsg?.image && !mediaItems.some((m) => m.dataBase64.length > 100)) {
          const match = latestUserMsg.image.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (match) {
            mediaItems.push({
              mimeType: match[1]!,
              dataBase64: match[2]!,
              fileName: "image.png",
            });
          }
        }

        // 2. Authoritative Multimodal & Provider Routing
        const hasMedia = mediaItems.length > 0;
        const hasVideo = mediaItems.some((m) => m.mimeType.startsWith("video/"));
        const hasImage = mediaItems.some((m) => m.mimeType.startsWith("image/"));
        const hasFileText = body.messages.some((m) =>
          m.attachments?.some((a) => Boolean(a.extractedText)),
        );

        const route = aiRouter.resolveRoute({
          hasVideo,
          hasImage,
          hasFileText,
          preferredModel: body.model,
        });

        if (route.provider === "nvidia") {
          if (nvidiaMultimodalService.isConfigured()) {
            const context: AIRequestContext = {
              operationId: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              conversationId: "default",
              provider: "nvidia",
              taskType: route.taskType,
              model: route.model,
            };

            return aiRouter.executeNvidiaMultimodalStream({
              context,
              mediaItems,
              question: questionText,
              history: validMessages.slice(0, -1).map((m) => ({ role: m.role, text: m.text })),
              signal: request.signal,
            });
          }

          if (hasVideo) {
            return Response.json(
              {
                error:
                  "NVIDIA API key is required to analyze videos with Nemotron-3. Please set NVIDIA_API_KEY on the backend.",
              },
              { status: 500 },
            );
          }
        }

        // 3. Fallback to Google Gemini for text chat, file analysis, and standard image queries
        const key =
          (body.apiKey && !body.apiKey.startsWith("nvapi-") ? body.apiKey.trim() : undefined) ||
          process.env["GOOGLE_API_KEY"];
        if (!key) {
          return Response.json(
            {
              error:
                "Google API key is not configured. Please set your API key in Settings or environment.",
            },
            { status: 500 },
          );
        }

        const contents = await Promise.all(
          body.messages
            .filter((m) => m.text?.trim() && m.text !== "Something went wrong. Please try again.")
            .map(async (m, idx, arr) => {
              const isLatestUser = m === latestUserMsg || idx === arr.length - 1;
              const parts: Array<Record<string, unknown>> = [];

              // IMPORTANT: inline_data is ONLY allowed in role: "user" in Gemini API (forbidden in role: "model")
              if (m.role === "user" && isLatestUser && m.image) {
                const match = m.image.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
                if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
              }

              if (m.attachments && m.attachments.length > 0) {
                for (const att of m.attachments) {
                  if (att.extractedText) {
                    parts.push({
                      text: `--- Attached File: ${att.fileName} (${att.mimeType}) ---\n${att.extractedText}\n--- End of File ---`,
                    });
                  } else if (
                    m.role === "user" &&
                    isLatestUser &&
                    att.mimeType.startsWith("image/") &&
                    (att.storageRef || att.id)
                  ) {
                    const mediaId = att.storageRef?.includes("id=")
                      ? att.storageRef.split("id=")[1]?.split("&")[0]
                      : att.id;
                    if (mediaId) {
                      const item = await mediaStorageService.getMedia(mediaId);
                      if (item && item.dataBase64) {
                        parts.push({
                          inline_data: {
                            mime_type: item.mimeType || att.mimeType,
                            data: item.dataBase64,
                          },
                        });
                      }
                    }
                  }
                }
              }
              parts.push({ text: m.text });
              return { role: m.role === "assistant" ? "model" : "user", parts };
            }),
        );

        const validModels = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3.1-flash-lite"];
        const selectedModel =
          body.model && validModels.includes(body.model) ? body.model : "gemini-2.5-flash-lite";

        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            signal: request.signal,
            headers: { "content-type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: SYSTEM }] },
              contents,
            }),
          },
        ).catch((e) => {
          if ((e as Error).name === "AbortError") return null;
          throw e;
        });

        if (!upstream) return new Response(null, { status: 499 });
        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          console.error("chat upstream error", upstream.status, detail.slice(0, 500));
          const msg =
            upstream.status === 429
              ? "I'm getting too many requests right now. Try again in a moment."
              : upstream.status === 403 || upstream.status === 401
                ? "The assistant's access key was rejected."
                : "Something went wrong. Please try again.";
          return corsJson({ error: msg }, { status: upstream.status });
        }

        // Re-emit only plain text chunks immediately so no provider details reach the client.
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder("utf-8");
        const encoder = new TextEncoder();
        let buf = "";

        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                // Process any final remaining buffer
                if (buf.trim()) {
                  const remainingLines = buf.split(/\r?\n/);
                  for (const line of remainingLines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) continue;
                    try {
                      const payload = trimmed.slice(5).trim();
                      if (payload && payload !== "[DONE]") {
                        const json = JSON.parse(payload);
                        const text = (json.candidates?.[0]?.content?.parts ?? [])
                          .map((p: { text?: string }) => p.text ?? "")
                          .join("");
                        if (text) controller.enqueue(encoder.encode(text));
                      }
                    } catch {
                      /* ignore partial */
                    }
                  }
                }
                controller.close();
                return;
              }

              buf += decoder.decode(value, { stream: true });
              const lines = buf.split(/\r?\n/);
              // Keep the last incomplete fragment in the buffer
              buf = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                try {
                  const payload = trimmed.slice(5).trim();
                  if (payload && payload !== "[DONE]") {
                    const json = JSON.parse(payload);
                    const text = (json.candidates?.[0]?.content?.parts ?? [])
                      .map((p: { text?: string }) => p.text ?? "")
                      .join("");
                    if (text) controller.enqueue(encoder.encode(text));
                  }
                } catch {
                  /* ignore partial chunk */
                }
              }
            } catch (err) {
              // Client abort/disconnect is a normal event, not a 500 server crash
              if (
                (err as Error)?.name === "AbortError" ||
                request.signal.aborted ||
                String(err).includes("aborted")
              ) {
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
                return;
              }
              controller.error(err);
            }
          },
          cancel() {
            try {
              reader.cancel().catch(() => {});
            } catch {
              /* ignore */
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-cache, no-transform, no-store",
            "x-content-type-options": "nosniff",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-session-token",
          },
        });
      },
    },
  },
});
