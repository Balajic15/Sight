import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { imageGenerationService } from "@/server/image-generation";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const GenerateImageSchema = z.object({
  operationId: z.string().min(1),
  conversationId: z.string().min(1),
  prompt: z.string().min(1),
  image: z.string().optional(),
  parentImageId: z.string().optional(),
  userId: z.string().optional(),
  messageId: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  steps: z.number().int().positive().optional(),
  apiKey: z.string().optional(),
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
          return corsJson(
            {
              operationId: "unknown",
              conversationId: "unknown",
              status: "failed",
              imageGenerated: false,
              errorCode: "VALIDATION_ERROR",
              errorMessage: "Invalid image generation request payload.",
            },
            { status: 400 },
          );
        }

        if (body.apiKey && body.apiKey.trim().startsWith("AIza")) {
          body.apiKey = undefined;
        }

        body.userId = auth.session.userId;

        const result = await imageGenerationService.generateImage(body);
        return corsJson(result, { status: 200 }); // Return 200 with typed failure status per contract
      },
    },
  },
});
