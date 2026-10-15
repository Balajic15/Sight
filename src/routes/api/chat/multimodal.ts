import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { imageOrchestratorService } from "@/server/ai/image-orchestrator";
import { multimodalIntentService } from "@/server/ai/multimodal-intent-service";
import { findCandidateImagesByConversation } from "@/server/db";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const MultimodalChatSchema = z.object({
  conversationId: z.string().trim().min(1).max(128),
  userMessageId: z.string().trim().max(128).optional(),
  prompt: z.string().trim().min(1).max(8000),
  explicitSourceImageId: z.string().trim().max(128).optional(),
  apiKey: z.string().trim().optional(),
  nvidiaApiKey: z.string().trim().optional(),
});

export const Route = createFileRoute("/api/chat/multimodal")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),

      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        let body: z.infer<typeof MultimodalChatSchema>;
        try {
          body = MultimodalChatSchema.parse(await request.json());
        } catch (err) {
          const msg = err instanceof z.ZodError ? err.errors[0]?.message : "Invalid payload";
          return corsJson({ status: "error", message: `Validation failed: ${msg}` }, { status: 400 });
        }

        try {
          const recentCandidates = await findCandidateImagesByConversation(body.conversationId, 5);
          const recentImages = (recentCandidates || []).map((c) => ({
            id: c.id,
            url: c.url,
            prompt: c.prompt,
          }));

          const resolvedGeminiKey =
            (body.apiKey && !body.apiKey.startsWith("nvapi-") ? body.apiKey.trim() : undefined) ||
            process.env["GOOGLE_API_KEY"];

          const resolvedNvidiaKey =
            body.nvidiaApiKey?.trim() ||
            process.env["NVIDIA_API_KEY"];

          // 1. Classify image generation/editing intent
          const intentResult = await multimodalIntentService.classify(
            body.prompt,
            recentImages,
            false,
            resolvedGeminiKey,
          );

          if (body.explicitSourceImageId) {
            intentResult.targetImageReference = {
              type: "SPECIFIC_ID",
              referencedId: body.explicitSourceImageId,
            };
          }

          // 2. Execute orchestration pipeline
          const result = await imageOrchestratorService.executeTask({
            conversationId: body.conversationId,
            messageId: body.userMessageId || `msg-${Date.now()}`,
            userPrompt: body.prompt,
            intentResult,
            apiKey: resolvedGeminiKey,
            nvidiaApiKey: resolvedNvidiaKey,
          });

          return corsJson(result);
        } catch (err) {
          console.error("[api/chat/multimodal] Multimodal processing error:", err);
          return corsJson(
            {
              status: "error",
              message: (err as Error)?.message || "Failed to process multimodal request.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
