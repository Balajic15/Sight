import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getConversationsFromDb,
  saveConversationToDb,
  deleteConversationFromDb,
  clearAllConversationsFromDb,
} from "@/server/db";
import type { ChatAttachment } from "@/lib/assistant/store";
import { requireSessionAuth } from "@/server/auth";

const ImageVersionNodeSchema = z.object({
  id: z.string(),
  versionNumber: z.number(),
  url: z.string(),
  prompt: z.string(),
  createdAt: z.number(),
  parentId: z.string().optional(),
});

const MsgAttachmentSchema = z.object({
  id: z.string(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  userId: z.string().optional(),
  parentImageId: z.string().optional(),
  rootImageId: z.string().optional(),
  versionNumber: z.number().optional(),
  versions: z.array(ImageVersionNodeSchema).optional(),
  origin: z.enum(["generated", "uploaded"]).default("uploaded"),
  fileName: z.string().default("file"),
  mimeType: z.string().default("application/octet-stream"),
  sizeBytes: z.number().default(0),
  width: z.number().optional(),
  height: z.number().optional(),
  model: z.string().optional(),
  storageRef: z.string(),
  dataUrl: z.string().optional(),
  status: z.enum(["uploading", "processing", "ready", "failed"]).default("ready"),
  extractedText: z.string().optional(),
  prompt: z.string().optional(),
  createdAt: z.number().optional(),
});

const MsgSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  image: z.string().optional(),
  source: z.enum(["camera", "screen"]).optional(),
  attachments: z.array(MsgAttachmentSchema).optional(),
  generatingImage: z.boolean().optional(),
  generationFailed: z.boolean().optional(),
  imagePrompt: z.string().optional(),
  operationId: z.string().optional(),
});

const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  messages: z.array(MsgSchema),
});

export const Route = createFileRoute("/api/conversations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const list = await getConversationsFromDb(auth.session.userId, auth.session.isAdmin);
          return Response.json(list);
        } catch (error) {
          console.error("Failed to load conversations from DB:", error);
          return Response.json({ error: "Failed to load conversations" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const body = await request.json();
          const parsed = ConversationSchema.parse(body);
          await saveConversationToDb(
            {
              id: parsed.id,
              title: parsed.title,
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
                if (m.source !== undefined) msg.source = m.source;
                if (m.image !== undefined) msg.image = m.image;
                if (m.attachments !== undefined && m.attachments.length > 0) {
                  msg.attachments = m.attachments.map((att) => ({
                    ...att,
                    conversationId: att.conversationId || parsed.id,
                    userId: att.userId || auth.session.userId,
                  }));
                }
                if (m.generatingImage !== undefined) msg.generatingImage = m.generatingImage;
                if (m.generationFailed !== undefined) msg.generationFailed = m.generationFailed;
                if (m.imagePrompt !== undefined) msg.imagePrompt = m.imagePrompt;
                if (m.operationId !== undefined) msg.operationId = m.operationId;
                return msg;
              }),
            },
            auth.session.userId,
            auth.session.isAdmin,
          );
          return Response.json({ success: true, id: parsed.id });
        } catch (error) {
          const msg = (error as Error)?.message || "";
          if (msg.includes("Forbidden")) {
            return Response.json({ error: msg }, { status: 403 });
          }
          console.error("Failed to save conversation to DB:", error);
          return Response.json({ error: "Failed to save conversation" }, { status: 400 });
        }
      },
      DELETE: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const url = new URL(request.url);
          const all = url.searchParams.get("all");
          if (all === "true") {
            await clearAllConversationsFromDb(auth.session.userId);
            return Response.json({ success: true, clearedAll: true });
          }

          const id = url.searchParams.get("id");
          if (!id) {
            return Response.json({ error: "Missing conversation id" }, { status: 400 });
          }

          await deleteConversationFromDb(id, auth.session.userId, auth.session.isAdmin);
          return Response.json({ success: true, deleted: id });
        } catch (error) {
          const msg = (error as Error)?.message || "";
          if (msg.includes("Forbidden")) {
            return Response.json({ error: msg }, { status: 403 });
          }
          console.error("Failed to delete conversation from DB:", error);
          return Response.json({ error: "Failed to delete conversation" }, { status: 500 });
        }
      },
    },
  },
});
