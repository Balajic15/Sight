import { aiRouter } from "@/server/ai/router";
import { getDbPool, initDb } from "@/server/db";

export interface GenerateImagePayload {
  operationId: string;
  conversationId: string;
  prompt: string;
  image?: string;
  parentImageId?: string;
  userId?: string;
  messageId?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  apiKey?: string;
}

export interface EditImagePayload {
  operationId: string;
  conversationId: string;
  instruction: string;
  sourceImageId?: string;
  parentImageId?: string;
  prompt?: string;
  image?: string;
  userId?: string;
  messageId?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  apiKey?: string;
}

export class ImageGenerationService {
  private static instance: ImageGenerationService;

  public static getInstance(): ImageGenerationService {
    if (!ImageGenerationService.instance) {
      ImageGenerationService.instance = new ImageGenerationService();
    }
    return ImageGenerationService.instance;
  }

  public async generateImage(payload: GenerateImagePayload): Promise<Record<string, unknown>> {
    await initDb();
    const route = aiRouter.resolveRoute({ isImageGeneration: true });

    const result = await aiRouter.executeImageGeneration({
      context: {
        operationId: payload.operationId,
        conversationId: payload.conversationId,
        taskType: "image_generation",
        provider: route.provider,
        model: route.model,
      },
      prompt: payload.prompt,
      width: payload.width,
      height: payload.height,
      seed: payload.seed,
      steps: payload.steps,
      apiKey: payload.apiKey,
    });

    if (result.success && result.data && payload.userId) {
      const pool = getDbPool();
      await pool.query(
        `INSERT INTO conversation_images (id, conversation_id, user_id, url, prompt, version_number, parent_id, created_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7)`,
        [
          result.data.imageId,
          payload.conversationId,
          payload.userId,
          result.data.imageUrl,
          payload.prompt,
          payload.parentImageId || null,
          Date.now(),
        ],
      );
    }

    return result as unknown as Record<string, unknown>;
  }

  public async editImage(payload: EditImagePayload): Promise<Record<string, unknown>> {
    const combinedPrompt = payload.instruction;
    return this.generateImage({
      ...payload,
      prompt: combinedPrompt,
      parentImageId: payload.sourceImageId || payload.parentImageId,
    });
  }
}

export const imageGenerationService = ImageGenerationService.getInstance();
