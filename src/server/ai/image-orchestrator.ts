import { imageGenerationService } from "@/server/image-generation";
import type { IntentClassificationResult } from "./multimodal-intent-service";

export interface ImageOrchestratorTask {
  conversationId: string;
  messageId: string;
  userPrompt: string;
  intentResult: IntentClassificationResult;
  apiKey?: string;
  nvidiaApiKey?: string;
}

export class ImageOrchestratorService {
  private static instance: ImageOrchestratorService;

  public static getInstance(): ImageOrchestratorService {
    if (!ImageOrchestratorService.instance) {
      ImageOrchestratorService.instance = new ImageOrchestratorService();
    }
    return ImageOrchestratorService.instance;
  }

  public async executeTask(task: ImageOrchestratorTask): Promise<Record<string, unknown>> {
    const operationId = `op_${Date.now()}`;

    if (task.intentResult.intent === "IMAGE_EDIT") {
      return imageGenerationService.editImage({
        operationId,
        conversationId: task.conversationId,
        instruction: task.userPrompt,
        sourceImageId: task.intentResult.targetImageReference?.referencedId,
        messageId: task.messageId,
        apiKey: task.apiKey,
      });
    }

    if (task.intentResult.intent === "IMAGE_GENERATION") {
      return imageGenerationService.generateImage({
        operationId,
        conversationId: task.conversationId,
        prompt: task.intentResult.extractedPrompt || task.userPrompt,
        messageId: task.messageId,
        apiKey: task.apiKey,
      });
    }

    return {
      status: "unhandled_intent",
      intent: task.intentResult.intent,
      message: "Task is not an image generation or editing intent.",
    };
  }
}

export const imageOrchestratorService = ImageOrchestratorService.getInstance();
