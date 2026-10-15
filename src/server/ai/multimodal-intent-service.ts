export interface IntentClassificationResult {
  intent: "IMAGE_GENERATION" | "IMAGE_EDIT" | "TEXT_QUERY" | "IMAGE_INQUIRY";
  confidence: number;
  extractedPrompt?: string;
  targetImageReference?: {
    type: "SPECIFIC_ID" | "RECENT_IMAGE" | "NONE";
    referencedId?: string;
  };
}

export class MultimodalIntentService {
  private static instance: MultimodalIntentService;

  public static getInstance(): MultimodalIntentService {
    if (!MultimodalIntentService.instance) {
      MultimodalIntentService.instance = new MultimodalIntentService();
    }
    return MultimodalIntentService.instance;
  }

  public async classify(
    prompt: string,
    recentImages: Array<{ id: string; url: string; prompt: string }>,
    hasVideo = false,
    _apiKey?: string,
  ): Promise<IntentClassificationResult> {
    const p = prompt.toLowerCase().trim();

    const isEdit =
      /\b(edit|change|modify|remove|add to|recolor|replace|make it)\b/.test(p) &&
      recentImages.length > 0;

    if (isEdit) {
      return {
        intent: "IMAGE_EDIT",
        confidence: 0.9,
        extractedPrompt: prompt,
        targetImageReference: {
          type: "RECENT_IMAGE",
          referencedId: recentImages[0]?.id,
        },
      };
    }

    const isGen = /\b(generate|create|draw|paint|illustrate|render|make a picture of|make an image)\b/.test(
      p,
    );
    if (isGen) {
      return {
        intent: "IMAGE_GENERATION",
        confidence: 0.95,
        extractedPrompt: prompt.replace(/^(generate|create|draw|render|make a picture of)\s+/i, ""),
        targetImageReference: { type: "NONE" },
      };
    }

    if (recentImages.length > 0 || hasVideo) {
      return {
        intent: "IMAGE_INQUIRY",
        confidence: 0.85,
        targetImageReference: {
          type: recentImages.length > 0 ? "RECENT_IMAGE" : "NONE",
          referencedId: recentImages[0]?.id,
        },
      };
    }

    return {
      intent: "TEXT_QUERY",
      confidence: 1.0,
      targetImageReference: { type: "NONE" },
    };
  }
}

export const multimodalIntentService = MultimodalIntentService.getInstance();
