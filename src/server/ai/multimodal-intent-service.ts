import { classifyImageIntent } from "@/lib/assistant/image-intent";
import { googleGeminiAdapter } from "./google-adapter";

export type MultimodalIntent =
  | "GENERATE_NEW_IMAGE"
  | "EDIT_EXISTING_IMAGE"
  | "IMAGE_UNDERSTANDING"
  | "REFERENCE_BASED_GENERATION"
  | "TEXT_CHAT";

export interface IntentClassificationResult {
  intent: MultimodalIntent;
  targetImageReference?:
    | {
        type: "LATEST" | "SPECIFIC_ID" | "FIRST_VERSION" | "AMBIGUOUS" | "ATTACHED";
        referencedId?: string | undefined;
        versionIndex?: number | undefined;
      }
    | undefined;
  refinedInstruction: string;
  preservationRules?: string[] | undefined;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | undefined;
}

export class MultimodalIntentService {
  private static instance: MultimodalIntentService;

  private constructor() {}

  public static getInstance(): MultimodalIntentService {
    if (!MultimodalIntentService.instance) {
      MultimodalIntentService.instance = new MultimodalIntentService();
    }
    return MultimodalIntentService.instance;
  }

  /**
   * Classifies user intent by analyzing prompt, conversation history, and attached/prior images.
   */
  async classify(
    userPrompt: string,
    recentImages: Array<{ id: string; version: number; prompt: string; createdAt?: string }>,
    hasAttachment: boolean,
    customApiKey?: string,
  ): Promise<IntentClassificationResult> {
    const trimmed = userPrompt.trim();
    const lower = trimmed.toLowerCase();

    // 1. Run deterministic 50-intent classifier first
    const classified = classifyImageIntent(trimmed, { hasAttachment });

    // Derive aspect ratio
    let aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" = "1:1";
    if (classified.targetAspect === "16:9") aspectRatio = "16:9";
    else if (classified.targetAspect === "9:16") aspectRatio = "9:16";
    else if (classified.targetAspect === "4:3") aspectRatio = "4:3";

    // Detect target image reference
    let targetType: "LATEST" | "SPECIFIC_ID" | "FIRST_VERSION" | "AMBIGUOUS" | "ATTACHED" =
      hasAttachment ? "ATTACHED" : "LATEST";
    let referencedId: string | undefined = undefined;
    let versionIndex: number | undefined = undefined;

    // Check for "first version" / "original" / "v1"
    if (
      /\b(first (?:version|image|one)|go back to (?:the )?first|original (?:image|version)|v1)\b/i.test(
        lower,
      )
    ) {
      targetType = "FIRST_VERSION";
      versionIndex = 1;
      const rootImg = recentImages.find((img) => img.version === 1);
      if (rootImg) referencedId = rootImg.id;
    } else if (/\b(second (?:version|image|one)|v2)\b/i.test(lower)) {
      targetType = "SPECIFIC_ID";
      versionIndex = 2;
      const v2Img = recentImages.find((img) => img.version === 2);
      if (v2Img) referencedId = v2Img.id;
    } else if (
      classified.clarificationNeeded ||
      (recentImages.length > 1 &&
        /\b(which one|both images|either of them)\b/i.test(lower) &&
        !/\b(first|second|latest|last)\b/i.test(lower))
    ) {
      targetType = "AMBIGUOUS";
    } else if (recentImages.length > 0) {
      targetType = "LATEST";
      referencedId = recentImages[0]?.id;
    }

    // Extract preservation rules
    const preservationRules: string[] = [];
    if (/\b(keep (?:the )?(?:subject|composition|person|car|face|pose))\b/i.test(lower)) {
      preservationRules.push("composition and subject pose");
    }
    if (/\b(keep (?:the )?(?:background|lighting|colors))\b/i.test(lower)) {
      preservationRules.push("background environment and lighting");
    }

    // Map 50-intent operation type to MultimodalIntent
    let intent: MultimodalIntent = "TEXT_CHAT";
    if (classified.operationType === "IMAGE_GENERATE") {
      intent = "GENERATE_NEW_IMAGE";
    } else if (classified.intent === "REFERENCE_BASED_GENERATION") {
      intent = "REFERENCE_BASED_GENERATION";
    } else if (
      classified.operationType === "IMAGE_EDIT" ||
      classified.operationType === "IMAGE_ENHANCE" ||
      classified.operationType === "IMAGE_VARIATIONS"
    ) {
      intent =
        hasAttachment || recentImages.length > 0 ? "EDIT_EXISTING_IMAGE" : "GENERATE_NEW_IMAGE";
    } else if (
      classified.operationType === "IMAGE_UNDERSTAND" &&
      (hasAttachment || recentImages.length > 0)
    ) {
      intent = "IMAGE_UNDERSTANDING";
    }

    // Optional LLM enhancement via Gemini if key is configured and prompt is complex
    const apiKey = googleGeminiAdapter.getGoogleApiKey(customApiKey);
    if (apiKey && !apiKey.startsWith("mock") && classified.confidence < 0.8) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `You are a multimodal intent router for an AI assistant. Analyze user input: "${userPrompt}". Recent images count: ${recentImages.length}. Return JSON: {"intent": "GENERATE_NEW_IMAGE"|"EDIT_EXISTING_IMAGE"|"IMAGE_UNDERSTANDING"|"REFERENCE_BASED_GENERATION"|"TEXT_CHAT", "preservationRules": []}`,
                    },
                  ],
                },
              ],
              generationConfig: { responseMimeType: "application/json" },
            }),
          },
        );
        if (resp.ok) {
          const data = await resp.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const parsed = JSON.parse(text);
            if (parsed.intent) intent = parsed.intent;
            if (Array.isArray(parsed.preservationRules)) {
              preservationRules.push(...parsed.preservationRules);
            }
          }
        }
      } catch {
        /* fallback to deterministic output */
      }
    }

    return {
      intent,
      targetImageReference: {
        type: targetType,
        referencedId,
        versionIndex,
      },
      refinedInstruction: classified.prompt,
      preservationRules: preservationRules.length > 0 ? preservationRules : undefined,
      aspectRatio,
    };
  }
}

export const multimodalIntentService = MultimodalIntentService.getInstance();
