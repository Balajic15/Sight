import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { imageOrchestratorService } from "@/server/ai/image-orchestrator";
import { multimodalIntentService } from "@/server/ai/multimodal-intent-service";
import { findCandidateImagesByConversation } from "@/server/db";
import { requireSessionAuth } from "@/server/auth";

const MultimodalChatSchema = z.object({
  conversationId: z.string().min(1),
  userMessageId: z.string().optional(),
  prompt: z.string().min(1),
  explicitSourceImageId: z.string().optional(),
  apiKey: z.string().optional(),
  nvidiaApiKey: z.string().optional(),
});

export const Route = createFileRoute("/api/chat/multimodal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        let body: z.infer<typeof MultimodalChatSchema>;
        try {
          body = MultimodalChatSchema.parse(await request.json());
        } catch {
          return Response.json(
            { status: "error", message: "Invalid request payload." },
            { status: 400 },
          );
        }

        const recentCandidates = await findCandidateImagesByConversation(body.conversationId, 5);
        const recentImages = recentCandidates.map((c) => ({
          id: c.id,
          version: c.versionNumber,
          prompt: c.prompt,
        }));

        // 1. Classify intent
        const intentResult = await multimodalIntentService.classify(
          body.prompt,
          recentImages,
          false,
          body.apiKey,
        );

        if (body.explicitSourceImageId) {
          intentResult.targetImageReference = {
            type: "SPECIFIC_ID",
            referencedId: body.explicitSourceImageId,
          };
        }

        try {
          const result = await imageOrchestratorService.executeTask({
            conversationId: body.conversationId,
            messageId: body.userMessageId || `msg-${Date.now()}`,
            userPrompt: body.prompt,
            intentResult,
            apiKey: body.apiKey,
            nvidiaApiKey: body.nvidiaApiKey,
          });

          return Response.json(result);
        } catch (err: any) {
          return Response.json(
            {
              status: "error",
              message: err?.message || "Failed to process multimodal request.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
