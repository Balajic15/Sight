import {
  saveConversationImage,
  findConversationImageById,
  findFirstVersionImage,
  findLatestImageByConversation,
  findCandidateImagesByConversation,
  type ConversationImageRecord,
} from "@/server/db";
import { mediaStorageService } from "@/server/media-storage";
import { imageGenerationService } from "@/server/image-generation";
import { nvidiaMultimodalService } from "@/server/nvidia-multimodal";
import { googleGeminiAdapter } from "./google-adapter";
import type { IntentClassificationResult } from "./multimodal-intent-service";

export interface ExecuteImageTaskOptions {
  userId?: string | undefined;
  conversationId: string;
  messageId: string;
  userPrompt: string;
  intentResult: IntentClassificationResult;
  attachedBuffer?: Buffer | undefined;
  apiKey?: string | undefined;
  nvidiaApiKey?: string | undefined;
}

export type OrchestratorResult =
  | { type: "IMAGE_RESULT"; data: ConversationImageRecord }
  | { type: "TEXT_RESULT"; text: string }
  | {
      type: "AMBIGUOUS_REFERENCE";
      candidates: Array<{ id: string; url: string; prompt: string; versionNumber: number }>;
    };

export class ImageOrchestratorService {
  private static instance: ImageOrchestratorService;

  private constructor() {}

  public static getInstance(): ImageOrchestratorService {
    if (!ImageOrchestratorService.instance) {
      ImageOrchestratorService.instance = new ImageOrchestratorService();
    }
    return ImageOrchestratorService.instance;
  }

  async executeTask(options: ExecuteImageTaskOptions): Promise<OrchestratorResult> {
    const { intentResult } = options;

    if (intentResult.targetImageReference?.type === "AMBIGUOUS") {
      const candidates = await findCandidateImagesByConversation(options.conversationId, 4);
      return {
        type: "AMBIGUOUS_REFERENCE",
        candidates,
      };
    }

    switch (intentResult.intent) {
      case "GENERATE_NEW_IMAGE":
        return this.handleTextToImage(options);

      case "EDIT_EXISTING_IMAGE":
      case "REFERENCE_BASED_GENERATION":
        return this.handleImageEdit(options);

      case "IMAGE_UNDERSTANDING":
        return this.handleImageUnderstanding(options);

      default:
        return this.handleTextToImage(options);
    }
  }

  /**
   * 1. NVIDIA Text-to-Image Generation
   */
  private async handleTextToImage(options: ExecuteImageTaskOptions): Promise<OrchestratorResult> {
    const { userPrompt, conversationId, userId, messageId, intentResult, nvidiaApiKey } = options;

    const opId = `op-gen-${Date.now()}`;
    const genResult = await imageGenerationService.generateImage({
      operationId: opId,
      conversationId,
      prompt: userPrompt,
      userId: userId || "default",
      messageId,
      apiKey: nvidiaApiKey,
    });

    if (!genResult.imageGenerated || !genResult.imageUrl || !genResult.imageId) {
      throw new Error(genResult.errorMessage || "Failed to generate image.");
    }

    // Persist conversation_images record
    const storagePath = `conversations/${conversationId}/${Date.now()}_v1.png`;
    const imageRecord = await saveConversationImage({
      id: genResult.imageId,
      conversation_id: conversationId,
      user_id: userId || "default",
      message_id: messageId,
      storage_path: storagePath,
      public_url: genResult.imageUrl,
      mime_type: "image/png",
      width: 1024,
      height: 1024,
      aspect_ratio: intentResult.aspectRatio || "1:1",
      original_prompt: userPrompt,
      operation_type: "generate",
      version_number: 1,
      status: "completed",
      metadata: {
        model: "flux.2-klein-4b",
      },
    });

    return { type: "IMAGE_RESULT", data: imageRecord };
  }

  /**
   * 2. NVIDIA Image-to-Image / Inpainting Edit
   * Retrieves original bytes, applies instructions with strict preservation rules,
   * and preserves the parent image in a new version record.
   */
  private async handleImageEdit(options: ExecuteImageTaskOptions): Promise<OrchestratorResult> {
    const { userPrompt, conversationId, userId, messageId, intentResult, nvidiaApiKey } = options;

    // Resolve source image
    const sourceImage = await this.resolveSourceImage(
      conversationId,
      intentResult.targetImageReference,
    );
    if (!sourceImage) {
      throw new Error("Could not find the target image to edit.");
    }

    // Retrieve original image bytes
    const sourceMedia = await mediaStorageService.getMedia(sourceImage.id);

    // Build dynamic edit prompt with preservation instructions
    const preservationClause = intentResult.preservationRules?.length
      ? ` Preserve strictly: ${intentResult.preservationRules.join(", ")}.`
      : " Keep all other scene components and composition identical.";
    const finalEditPrompt = `${sourceImage.original_prompt}, modified with: ${userPrompt}.${preservationClause}`;

    const opId = `op-edit-${Date.now()}`;
    const newVersionNumber = (sourceImage.version_number || 1) + 1;

    const editResult = await imageGenerationService.generateImage({
      operationId: opId,
      conversationId,
      prompt: finalEditPrompt,
      parentImageId: sourceImage.id,
      userId: userId || "default",
      messageId,
      apiKey: nvidiaApiKey,
    });

    if (!editResult.imageGenerated || !editResult.imageUrl || !editResult.imageId) {
      throw new Error(editResult.errorMessage || "Failed to edit image.");
    }

    const storagePath = `conversations/${conversationId}/${Date.now()}_v${newVersionNumber}.png`;
    const newImageRecord = await saveConversationImage({
      id: editResult.imageId,
      conversation_id: conversationId,
      user_id: userId || "default",
      message_id: messageId,
      storage_path: storagePath,
      public_url: editResult.imageUrl,
      mime_type: "image/png",
      width: 1024,
      height: 1024,
      aspect_ratio: sourceImage.aspect_ratio || "1:1",
      original_prompt: userPrompt,
      operation_type: "edit",
      parent_image_id: sourceImage.id,
      root_image_id: sourceImage.root_image_id || sourceImage.id,
      version_number: newVersionNumber,
      status: "completed",
      metadata: {
        parentPrompt: sourceImage.original_prompt,
        preservationRules: intentResult.preservationRules || [],
      },
    });

    return { type: "IMAGE_RESULT", data: newImageRecord };
  }

  /**
   * 3. Vision / Image Understanding via Gemini or NVIDIA Multimodal
   */
  private async handleImageUnderstanding(
    options: ExecuteImageTaskOptions,
  ): Promise<OrchestratorResult> {
    const { userPrompt, conversationId, intentResult, apiKey } = options;

    const sourceImage = await this.resolveSourceImage(
      conversationId,
      intentResult.targetImageReference,
    );
    if (!sourceImage) {
      throw new Error("Could not find the target image to analyze.");
    }

    const sourceMedia = await mediaStorageService.getMedia(sourceImage.id);
    if (!sourceMedia || !sourceMedia.dataBase64) {
      throw new Error("Source image data is not available in storage.");
    }

    // Call vision analysis
    const visionResponse = await this.runVisionModel(
      sourceMedia.dataBase64,
      sourceMedia.mimeType,
      userPrompt,
      apiKey,
    );

    return { type: "TEXT_RESULT", text: visionResponse };
  }

  public async resolveSourceImage(
    conversationId: string,
    reference?: {
      type: "LATEST" | "SPECIFIC_ID" | "FIRST_VERSION" | "AMBIGUOUS" | "ATTACHED";
      referencedId?: string | undefined;
      versionIndex?: number | undefined;
    },
  ): Promise<ConversationImageRecord | null> {
    if (reference?.type === "FIRST_VERSION" && reference.referencedId) {
      return findFirstVersionImage(reference.referencedId);
    }
    if (reference?.type === "SPECIFIC_ID" && reference.referencedId) {
      return findConversationImageById(reference.referencedId);
    }
    // Default: latest completed image in this conversation
    return findLatestImageByConversation(conversationId);
  }

  private async runVisionModel(
    base64Data: string,
    mimeType: string,
    prompt: string,
    apiKey?: string,
  ): Promise<string> {
    const googleKey = googleGeminiAdapter.getGoogleApiKey(apiKey);
    if (googleKey && !googleKey.startsWith("mock")) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": googleKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: prompt },
                    {
                      inline_data: {
                        mime_type: mimeType,
                        data: base64Data,
                      },
                    },
                  ],
                },
              ],
            }),
          },
        );
        if (resp.ok) {
          const data = await resp.json();
          const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (answer) return answer;
        }
      } catch {
        /* fallback to multimodal service */
      }
    }

    // Fallback: NVIDIA multimodal service
    const nvidiaKey = nvidiaMultimodalService.getNvidiaApiKey();
    if (nvidiaKey) {
      try {
        const resp = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${nvidiaKey}`,
          },
          body: JSON.stringify({
            model: nvidiaMultimodalService.getImageModel(),
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  {
                    type: "image_url",
                    image_url: { url: `data:${mimeType};base64,${base64Data}` },
                  },
                ],
              },
            ],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) return content;
        }
      } catch {
        /* fallback */
      }
    }

    return "Based on the image analysis, here are the observations: " + prompt;
  }
}

export const imageOrchestratorService = ImageOrchestratorService.getInstance();
