import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getConversationsFromDb,
  saveConversationToDb,
  deleteConversationFromDb,
  clearAllConversationsFromDb,
} from "@/server/db";
import type { ChatAttachment } from "@/lib/assistant/store";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const ImageVersionNodeSchema = z.object({
  id: z.string().trim().min(1).max(128),
  versionNumber: z.number().int().min(1),
  url: z.string().trim().url().or(z.string().trim().startsWith("/")),
  prompt: z.string().max(4000),
  createdAt: z.number().int().positive(),
  parentId: z.string().trim().min(1).max(128).optional(),
});

const MsgAttachmentSchema = z.object({
  id: z.string().trim().min(1).max(128),
  conversationId: z.string().trim().min(1).max(128).optional(),
  messageId: z.string().trim().min(1).max(128).optional(),
  userId: z.string().trim().min(1).max(128).optional(),
  parentImageId: z.string().trim().min(1).max(128).optional(),
  rootImageId: z.string().trim().min(1).max(128).optional(),
  versionNumber: z.number().int().min(1).optional(),
  versions: z.array(ImageVersionNodeSchema).max(50).optional(),
  origin: z.enum(["generated", "uploaded"]).default("uploaded"),
  fileName: z.string().trim().max(255).default("file"),
  mimeType: z.string().trim().max(100).default("application/octet-stream"),
  sizeBytes: z.number().int().nonnegative().max(100 * 1024 * 1024).default(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  model: z.string().trim().max(100).optional(),
  storageRef: z.string().trim().min(1).max(512),
  dataUrl: z.string().max(2 * 1024 * 1024).optional(),
  status: z.enum(["uploading", "processing", "ready", "failed"]).default("ready"),
  extractedText: z.string().max(500000).optional(),
  prompt: z.string().max(4000).optional(),
  createdAt: z.number().int().positive().optional(),
});

const MsgSchema = z.object({
  id: z.string().trim().min(1).max(128),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(100000),
  image: z.string().max(5 * 1024 * 1024).optional(),
  source: z.enum(["camera", "screen"]).optional(),
  attachments: z.array(MsgAttachmentSchema).max(20).optional(),
  generatingImage: z.boolean().optional(),
  generationFailed: z.boolean().optional(),
  imagePrompt: z.string().max(4000).optional(),
  operationId: z.string().trim().max(128).optional(),
});

const ConversationSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(255),
  updatedAt: z.number().int().positive(),
  messages: z.array(MsgSchema).max(1000),
});

export const Route = createFileRoute("/api/conversations")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),

      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const list = await getConversationsFromDb(auth.session.userId, auth.session.isAdmin);
          return corsJson(list || []);
        } catch (error) {
          console.error("[api/conversations] Failed to load conversations:", error);
          return corsJson({ error: "Failed to load conversations." }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        let parsed: z.infer<typeof ConversationSchema>;
        try {
          const body = await request.json();
          parsed = ConversationSchema.parse(body);
        } catch (err) {
          const message = err instanceof z.ZodError ? err.errors[0]?.message : "Invalid payload";
          return corsJson({ error: `Validation failed: ${message}` }, { status: 400 });
        }

        try {
          await saveConversationToDb(
            {
              id: parsed.id,
              title: parsed.title,
              createdAt: parsed.updatedAt,
              updatedAt: parsed.updatedAt,
              messages: parsed.messages.map((m) => {
                const msg: {
                  id: string;
                  role: "user" | "assistant";
                  text: string;
                  image?: string;
                  source?: "camera" | "screen";
                  attachments?: ChatAttachment[];
                  generatingImage?: boolean;
                  generationFailed?: boolean;
                  imagePrompt?: string;
                  operationId?: string;
                } = {
                  id: m.id,
                  role: m.role,
                  text: m.text,
                };
                if (m.source) msg.source = m.source;
                if (m.image) msg.image = m.image;
                if (m.attachments && m.attachments.length > 0) {
                  msg.attachments = m.attachments.map((att) => ({
                    ...att,
                    conversationId: att.conversationId || parsed.id,
                    userId: att.userId || auth.session.userId,
                  }));
                }
                if (m.generatingImage !== undefined) msg.generatingImage = m.generatingImage;
                if (m.generationFailed !== undefined) msg.generationFailed = m.generationFailed;
                if (m.imagePrompt) msg.imagePrompt = m.imagePrompt;
                if (m.operationId) msg.operationId = m.operationId;
                return msg;
              }),
            },
            auth.session.userId,
            auth.session.isAdmin,
          );

          return corsJson({ success: true, id: parsed.id });
        } catch (error) {
          const msg = (error as Error)?.message || "";
          if (msg.includes("Forbidden") || msg.includes("Access denied")) {
            return corsJson({ error: "You do not have permission to modify this conversation." }, { status: 403 });
          }
          console.error("[api/conversations] Failed to save conversation:", error);
          return corsJson({ error: "Failed to save conversation." }, { status: 500 });
        }
      },

      DELETE: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const url = new URL(request.url);
          const all = url.searchParams.get("all") === "true";

          if (all) {
            await clearAllConversationsFromDb(auth.session.userId);
            return corsJson({ success: true, clearedAll: true });
          }

          const rawId = url.searchParams.get("id");
          const id = rawId ? rawId.trim().replace(/^["']|["']$/g, "") : null;

          if (!id || id.length > 128) {
            return corsJson({ error: "Missing or invalid conversation id" }, { status: 400 });
          }

          await deleteConversationFromDb(id, auth.session.userId, auth.session.isAdmin);
          return corsJson({ success: true, deleted: id });
        } catch (error) {
          const msg = (error as Error)?.message || "";
          if (msg.includes("Forbidden") || msg.includes("Access denied")) {
            return corsJson({ error: "You do not have permission to delete this conversation." }, { status: 403 });
          }
          console.error("[api/conversations] Failed to delete conversation:", error);
          return corsJson({ error: "Failed to delete conversation." }, { status: 500 });
        }
      },
    },
  },
});
