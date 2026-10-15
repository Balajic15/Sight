import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { imageGenerationService } from "@/server/image-generation";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const GenerateImageSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
  conversationId: z.string().trim().min(1).max(128),
  prompt: z.string().trim().min(1).max(4000),
  image: z.string().max(10 * 1024 * 1024).optional(),
  parentImageId: z.string().trim().max(128).optional(),
  userId: z.string().trim().max(128).optional(),
  messageId: z.string().trim().max(128).optional(),
  width: z.number().int().min(256).max(2048).optional(),
  height: z.number().int().min(256).max(2048).optional(),
  seed: z.number().int().optional(),
  steps: z.number().int().min(1).max(100).optional(),
  apiKey: z.string().trim().optional(),
});

export const Route = createFileRoute("/api/images/generate")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),

      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        let body: z.infer<typeof GenerateImageSchema>;
        try {
          body = GenerateImageSchema.parse(await request.json());
        } catch (err) {
          const msg = err instanceof z.ZodError ? err.errors[0]?.message : "Invalid payload";
          return corsJson(
            {
              operationId: "unknown",
              conversationId: "unknown",
              status: "failed",
              imageGenerated: false,
              errorCode: "VALIDATION_ERROR",
              errorMessage: `Invalid image generation payload: ${msg}`,
            },
            { status: 400 },
          );
        }

        // Prevent passing invalid Google keys to the image model provider
        if (body.apiKey && body.apiKey.trim().startsWith("AIza")) {
          body.apiKey = undefined;
        }

        // Always lock image ownership to the authenticated session
        body.userId = auth.session.userId;

        try {
          const result = await imageGenerationService.generateImage(body);
          return corsJson(result, { status: 200 });
        } catch (err) {
          console.error("[api/images/generate] Image generation failed:", err);
          return corsJson(
            {
              operationId: body.operationId,
              conversationId: body.conversationId,
              status: "failed",
              imageGenerated: false,
              errorCode: "GENERATION_FAILED",
              errorMessage: (err as Error)?.message || "Failed to generate image.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
