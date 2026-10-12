import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { imageGenerationService } from "@/server/image-generation";
import { requireSessionAuth } from "@/server/auth";

const EditImageSchema = z.object({
  operationId: z.string().min(1),
  conversationId: z.string().min(1),
  instruction: z.string().min(1),
  sourceImageId: z.string().optional(),
  parentImageId: z.string().optional(),
  prompt: z.string().optional(),
  image: z.string().optional(),
  userId: z.string().optional(),
  messageId: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  steps: z.number().int().positive().optional(),
  apiKey: z.string().optional(),
});

export const Route = createFileRoute("/api/images/edit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        let body: z.infer<typeof EditImageSchema>;
        try {
          body = EditImageSchema.parse(await request.json());
        } catch {
          return Response.json(
            {
              operationId: "unknown",
              conversationId: "unknown",
              status: "failed",
              imageGenerated: false,
              errorCode: "VALIDATION_ERROR",
              errorMessage: "Invalid image editing request payload.",
            },
            { status: 400 },
          );
        }

        if (body.apiKey && body.apiKey.trim().startsWith("AIza")) {
          body.apiKey = undefined;
        }

        body.userId = auth.session.userId;
        const result = await imageGenerationService.editImage(body);
        return Response.json(result, { status: 200 });
      },
    },
  },
});
