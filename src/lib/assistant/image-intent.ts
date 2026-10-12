import type { Conversation } from "./store";
import { attachmentContextService } from "./attachment-context";

export type ImageIntentCategory =
  "understanding" | "comparison" | "generation" | "editing" | "enhancement";

export type ImageOperationType =
  "IMAGE_UNDERSTAND" | "IMAGE_GENERATE" | "IMAGE_EDIT" | "IMAGE_VARIATIONS" | "IMAGE_ENHANCE";

export type ImageIntentName =
  // 1-10: Image understanding and analysis
  | "IMAGE_UNDERSTANDING"
  | "IMAGE_DESCRIPTION"
  | "OBJECT_DETECTION"
  | "OCR_TEXT_EXTRACTION"
  | "SCENE_UNDERSTANDING"
  | "IMAGE_QUESTION_ANSWERING"
  | "IMAGE_QUALITY_ANALYSIS"
  | "IMAGE_AUTHENTICITY_ANALYSIS"
  | "VISUAL_COUNTING"
  | "VISUAL_IDENTIFICATION"
  // 11-20: Image comparison and reference analysis
  | "IMAGE_COMPARISON"
  | "IMAGE_DIFFERENCE_DETECTION"
  | "IMAGE_SIMILARITY_ANALYSIS"
  | "IMAGE_VARIATIONS"
  | "IMAGE_RECREATION"
  | "REFERENCE_BASED_GENERATION"
  | "IMAGE_STYLE_TRANSFER"
  | "IMAGE_COMPOSITION"
  | "IMAGE_LAYOUT_ANALYSIS"
  | "VISUAL_CONSISTENCY_CHECK"
  // 21-30: Image generation
  | "TEXT_TO_IMAGE"
  | "MULTI_IMAGE_GENERATION"
  | "CHARACTER_GENERATION"
  | "PRODUCT_IMAGE_GENERATION"
  | "PORTRAIT_GENERATION"
  | "LANDSCAPE_GENERATION"
  | "LOGO_GENERATION"
  | "POSTER_GENERATION"
  | "INFOGRAPHIC_GENERATION"
  | "UI_MOCKUP_GENERATION"
  // 31-40: Image editing and transformation
  | "BACKGROUND_REPLACEMENT"
  | "BACKGROUND_REMOVAL"
  | "OBJECT_REMOVAL"
  | "OBJECT_ADDITION"
  | "OBJECT_REPLACEMENT"
  | "COLOR_MODIFICATION"
  | "CLOTHING_MODIFICATION"
  | "LIGHTING_ADJUSTMENT"
  | "WEATHER_TRANSFORMATION"
  | "ARTISTIC_STYLE_TRANSFORMATION"
  // 41-50: Image enhancement and advanced operations
  | "IMAGE_UPSCALING"
  | "IMAGE_RESTORATION"
  | "IMAGE_SHARPENING"
  | "IMAGE_NOISE_REDUCTION"
  | "IMAGE_OUTPAINTING"
  | "ASPECT_RATIO_CONVERSION"
  | "SMART_CROPPING"
  | "IMAGE_TEXT_MODIFICATION"
  | "IMAGE_COLORIZATION"
  | "TRANSPARENT_IMAGE_CREATION";

export interface IntentDefinition {
  name: ImageIntentName;
  category: ImageIntentCategory;
  operationType: ImageOperationType;
  requiresImageInput: boolean;
  defaultOutputCount: number;
  description: string;
}

export interface ClassifiedImageIntent {
  intent: ImageIntentName;
  operationType: ImageOperationType;
  category: ImageIntentCategory;
  sourceImageIds: string[];
  conversationId?: string | undefined;
  prompt: string;
  editInstruction?: string | undefined;
  requiresImageInput: boolean;
  outputCount: number;
  confidence: number;
  clarificationNeeded?: boolean | undefined;
  clarificationMessage?: string | undefined;
  targetAspect?: string | undefined;
}

export interface ImageIntentResult {
  type: "generate" | "edit" | "question" | "none";
  prompt: string;
  editInstruction?: string | undefined;
  classifiedIntent?: ClassifiedImageIntent | undefined;
}

export const INTENT_DEFINITIONS: Record<ImageIntentName, IntentDefinition> = {
  // 1-10 Understanding
  IMAGE_UNDERSTANDING: {
    name: "IMAGE_UNDERSTANDING",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "General visual understanding and scene summary",
  },
  IMAGE_DESCRIPTION: {
    name: "IMAGE_DESCRIPTION",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Detailed descriptive analysis of visual contents",
  },
  OBJECT_DETECTION: {
    name: "OBJECT_DETECTION",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Identification and listing of distinct objects",
  },
  OCR_TEXT_EXTRACTION: {
    name: "OCR_TEXT_EXTRACTION",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Optical character recognition and text extraction",
  },
  SCENE_UNDERSTANDING: {
    name: "SCENE_UNDERSTANDING",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Contextual explanation of what is taking place in a scene",
  },
  IMAGE_QUESTION_ANSWERING: {
    name: "IMAGE_QUESTION_ANSWERING",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Answering specific queries regarding image content",
  },
  IMAGE_QUALITY_ANALYSIS: {
    name: "IMAGE_QUALITY_ANALYSIS",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Assessing blurriness, resolution, clarity, and visual fidelity",
  },
  IMAGE_AUTHENTICITY_ANALYSIS: {
    name: "IMAGE_AUTHENTICITY_ANALYSIS",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Checking for digital manipulation, editing artifacts, or AI generation",
  },
  VISUAL_COUNTING: {
    name: "VISUAL_COUNTING",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Quantifying and counting specific items or people",
  },
  VISUAL_IDENTIFICATION: {
    name: "VISUAL_IDENTIFICATION",
    category: "understanding",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Identifying species, breeds, models, brands, or landmarks",
  },

  // 11-20 Comparison & Reference
  IMAGE_COMPARISON: {
    name: "IMAGE_COMPARISON",
    category: "comparison",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Side-by-side comparative analysis of two or more designs",
  },
  IMAGE_DIFFERENCE_DETECTION: {
    name: "IMAGE_DIFFERENCE_DETECTION",
    category: "comparison",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Pinpointing visual differences and changes between images",
  },
  IMAGE_SIMILARITY_ANALYSIS: {
    name: "IMAGE_SIMILARITY_ANALYSIS",
    category: "comparison",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Analyzing visual overlap, style correlation, and similarities",
  },
  IMAGE_VARIATIONS: {
    name: "IMAGE_VARIATIONS",
    category: "comparison",
    operationType: "IMAGE_VARIATIONS",
    requiresImageInput: true,
    defaultOutputCount: 4,
    description: "Generating multiple alternative variations of an existing design",
  },
  IMAGE_RECREATION: {
    name: "IMAGE_RECREATION",
    category: "comparison",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Re-rendering a similar concept conditioned on the source",
  },
  REFERENCE_BASED_GENERATION: {
    name: "REFERENCE_BASED_GENERATION",
    category: "comparison",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Conditioning a new visual design on a source reference image",
  },
  IMAGE_STYLE_TRANSFER: {
    name: "IMAGE_STYLE_TRANSFER",
    category: "comparison",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Applying the artistic style of a reference image to another image",
  },
  IMAGE_COMPOSITION: {
    name: "IMAGE_COMPOSITION",
    category: "comparison",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Combining elements from multiple images into a single cohesive scene",
  },
  IMAGE_LAYOUT_ANALYSIS: {
    name: "IMAGE_LAYOUT_ANALYSIS",
    category: "comparison",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Examining visual hierarchy, grid alignment, and element positioning",
  },
  VISUAL_CONSISTENCY_CHECK: {
    name: "VISUAL_CONSISTENCY_CHECK",
    category: "comparison",
    operationType: "IMAGE_UNDERSTAND",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Validating branding, lighting, and palette coherence across assets",
  },

  // 21-30 Generation
  TEXT_TO_IMAGE: {
    name: "TEXT_TO_IMAGE",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "Standard text prompt to image generation",
  },
  MULTI_IMAGE_GENERATION: {
    name: "MULTI_IMAGE_GENERATION",
    category: "generation",
    operationType: "IMAGE_VARIATIONS",
    requiresImageInput: false,
    defaultOutputCount: 4,
    description: "Generating multiple distinct images from a single request",
  },
  CHARACTER_GENERATION: {
    name: "CHARACTER_GENERATION",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "Designing fictional, fantasy, or cinematic characters",
  },
  PRODUCT_IMAGE_GENERATION: {
    name: "PRODUCT_IMAGE_GENERATION",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "High-end commercial product and advertisement imagery",
  },
  PORTRAIT_GENERATION: {
    name: "PORTRAIT_GENERATION",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "Creating professional human headshots and portraits",
  },
  LANDSCAPE_GENERATION: {
    name: "LANDSCAPE_GENERATION",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "Scenic vistas, natural environments, and digital wallpapers",
  },
  LOGO_GENERATION: {
    name: "LOGO_GENERATION",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "Minimalist brand logos, badges, and vector symbols",
  },
  POSTER_GENERATION: {
    name: "POSTER_GENERATION",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "Promotional event posters, festival flyers, and banners",
  },
  INFOGRAPHIC_GENERATION: {
    name: "INFOGRAPHIC_GENERATION",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "Visual infographics and educational explanatory diagrams",
  },
  UI_MOCKUP_GENERATION: {
    name: "UI_MOCKUP_GENERATION",
    category: "generation",
    operationType: "IMAGE_GENERATE",
    requiresImageInput: false,
    defaultOutputCount: 1,
    description: "App screens, dashboard mockups, and digital UI layouts",
  },

  // 31-40 Editing & Transformation
  BACKGROUND_REPLACEMENT: {
    name: "BACKGROUND_REPLACEMENT",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Replacing current backdrop while preserving primary foreground subject",
  },
  BACKGROUND_REMOVAL: {
    name: "BACKGROUND_REMOVAL",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Stripping background to isolate foreground subjects",
  },
  OBJECT_REMOVAL: {
    name: "OBJECT_REMOVAL",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Erasing specific unwanted people, items, or artifacts from an image",
  },
  OBJECT_ADDITION: {
    name: "OBJECT_ADDITION",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Adding new objects or elements into an existing image composition",
  },
  OBJECT_REPLACEMENT: {
    name: "OBJECT_REPLACEMENT",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Swapping out a specific item for an alternative element",
  },
  COLOR_MODIFICATION: {
    name: "COLOR_MODIFICATION",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Adjusting or recoloring specific items, cars, or items of interest",
  },
  CLOTHING_MODIFICATION: {
    name: "CLOTHING_MODIFICATION",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Changing garments, suits, dresses, shoes, or wearable fashion",
  },
  LIGHTING_ADJUSTMENT: {
    name: "LIGHTING_ADJUSTMENT",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Altering mood, warm/cool tone, highlights, shadows, or exposure",
  },
  WEATHER_TRANSFORMATION: {
    name: "WEATHER_TRANSFORMATION",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Transforming weather conditions (sun, rain, snow, fog, dusk)",
  },
  ARTISTIC_STYLE_TRANSFORMATION: {
    name: "ARTISTIC_STYLE_TRANSFORMATION",
    category: "editing",
    operationType: "IMAGE_EDIT",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Stylizing images into watercolor, oil paint, anime, or 3D art",
  },

  // 41-50 Enhancement & Advanced
  IMAGE_UPSCALING: {
    name: "IMAGE_UPSCALING",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Increasing resolution and fine details via neural super-resolution",
  },
  IMAGE_RESTORATION: {
    name: "IMAGE_RESTORATION",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Repairing vintage scratches, folds, tears, and degradation",
  },
  IMAGE_SHARPENING: {
    name: "IMAGE_SHARPENING",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Enhancing clarity and edges to de-blur an image",
  },
  IMAGE_NOISE_REDUCTION: {
    name: "IMAGE_NOISE_REDUCTION",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Removing ISO grain, sensor artifacts, and noise",
  },
  IMAGE_OUTPAINTING: {
    name: "IMAGE_OUTPAINTING",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Extending scene boundaries outward beyond original canvas borders",
  },
  ASPECT_RATIO_CONVERSION: {
    name: "ASPECT_RATIO_CONVERSION",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Re-framing or re-rendering for wallpapers (16:9, 9:16, 4:3, 1:1)",
  },
  SMART_CROPPING: {
    name: "SMART_CROPPING",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Automatically cropping focal regions around detected subjects",
  },
  IMAGE_TEXT_MODIFICATION: {
    name: "IMAGE_TEXT_MODIFICATION",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Altering, replacing, or correcting typographical text embedded in images",
  },
  IMAGE_COLORIZATION: {
    name: "IMAGE_COLORIZATION",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Injecting realistic colors into historical or black-and-white photos",
  },
  TRANSPARENT_IMAGE_CREATION: {
    name: "TRANSPARENT_IMAGE_CREATION",
    category: "enhancement",
    operationType: "IMAGE_ENHANCE",
    requiresImageInput: true,
    defaultOutputCount: 1,
    description: "Removing backgrounds and rendering transparent alpha PNG cutouts",
  },
};

/**
 * Parses integer counts like "four", "4", "three", "3" from text
 */
function extractOutputCount(text: string): number {
  const match = text.match(
    /\b(two|three|four|five|2|3|4|5)\b(?:\s+(?:separate|different|alternative|versions|images|variations))?/i,
  );
  if (!match) return 1;
  const word = match[1]!.toLowerCase();
  switch (word) {
    case "two":
    case "2":
      return 2;
    case "three":
    case "3":
      return 3;
    case "four":
    case "4":
      return 4;
    case "five":
    case "5":
      return 5;
    default:
      return 1;
  }
}

/**
 * Extracts aspect ratio if mentioned
 */
function extractAspectRatio(text: string): string | undefined {
  if (/\b(phone wallpaper|vertical|story|tiktok|reels|9:16|9\/16)\b/i.test(text)) return "9:16";
  if (/\b(landscape|desktop|wallpaper|youtube|wide|16:9|16\/9)\b/i.test(text)) return "16:9";
  if (/\b(square|instagram|post|avatar|profile|1:1|1\/1)\b/i.test(text)) return "1:1";
  if (/\b(portrait|editorial|4:5|4\/5|3:4|3\/4)\b/i.test(text)) return "4:5";
  return undefined;
}

/**
 * Clean generation prompt prefix
 */
function cleanGeneratePrompt(text: string): string {
  const prefixes = [
    /^(?:can you\s+)?(?:please\s+)?(?:generate|create|make|draw|paint|render)\s+(?:me\s+)?(?:an?\s+)?(?:[a-z-]+\s+)*(?:image|photo|picture|photograph|portrait|wallpaper|illustration|painting|artwork|drawing)(?:\s+(?:of|about|showing|with))?\s*/i,
    /^(?:can you\s+)?(?:please\s+)?(?:generate|create|make|design)\s+(?:me\s+)?(?:an?\s+)?(?:[a-z-]+\s+)*(?:wedding invitation|invitation|poster|logo|banner|flyer|artwork|painting|character|infographic|mockup)(?:\s+(?:with|showing|of|for))?\s*/i,
    /^(?:generate|create|render)\s+(?:image|picture|photo):\s*/i,
  ];
  let res = text;
  for (const regex of prefixes) {
    if (regex.test(res)) {
      res = res.replace(regex, "").trim();
      break;
    }
  }
  return res || text;
}

/**
 * Central Intent Classifier supporting all 50 Image AI Intents
 */
export function classifyImageIntent(
  text: string,
  options?: {
    hasAttachment?: boolean | undefined;
    conversation?: Conversation | undefined;
    selectedAttachmentId?: string | undefined;
  },
): ClassifiedImageIntent {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const hasAttachment = Boolean(
    options?.hasAttachment ||
    (options?.conversation &&
      options.conversation.messages.some(
        (m) => (m.attachments && m.attachments.length > 0) || m.image,
      )),
  );

  let sourceImageIds: string[] = [];
  let clarificationNeeded = false;
  let clarificationMessage: string | undefined;

  // Resolve source attachments if conversation context is available
  if (options?.conversation) {
    const resolved = attachmentContextService.resolveContext(
      options.conversation,
      trimmed,
      options.selectedAttachmentId,
    );
    if (resolved.targetAttachment) {
      sourceImageIds = [resolved.targetAttachment.id];
    }
    if (resolved.isAmbiguous) {
      clarificationNeeded = true;
      clarificationMessage =
        "Multiple images were found. Please select which image you would like to refer to.";
    }
  }

  const outputCount = extractOutputCount(trimmed);
  const targetAspect = extractAspectRatio(trimmed);

  // Helper constructor
  const make = (
    intent: ImageIntentName,
    conf = 0.95,
    customPrompt?: string,
    editInst?: string,
  ): ClassifiedImageIntent => {
    const def = INTENT_DEFINITIONS[intent];
    const cnt = outputCount > 1 ? outputCount : def.defaultOutputCount;
    return {
      intent,
      operationType: def.operationType,
      category: def.category,
      sourceImageIds,
      conversationId: options?.conversation?.id,
      prompt: customPrompt || trimmed,
      editInstruction:
        editInst ||
        (def.operationType === "IMAGE_EDIT" || def.operationType === "IMAGE_ENHANCE"
          ? trimmed
          : undefined),
      requiresImageInput: def.requiresImageInput,
      outputCount: cnt,
      confidence: conf,
      clarificationNeeded,
      clarificationMessage,
      targetAspect,
    };
  };

  // -------------------------------------------------------------
  // A. IMAGE UNDERSTANDING & ANALYSIS (1 - 10)
  // Evaluated primarily when an attachment or image context is present
  // -------------------------------------------------------------
  if (hasAttachment) {
    // 4. OCR_TEXT_EXTRACTION
    if (
      /\b(extract|read|transcribe|get)\s+(?:all\s+)?(?:the\s+)?(?:text|words|writing|letters|receipt|sign)\b/i.test(
        lower,
      ) ||
      /\bwhat\s+(?:does\s+the\s+text\s+say|text\s+is\s+in|words\s+are\s+in)\b/i.test(lower)
    ) {
      return make("OCR_TEXT_EXTRACTION", 0.98);
    }

    // 9. VISUAL_COUNTING
    if (/\b(how many|count the|count how many|number of)\b/i.test(lower)) {
      return make("VISUAL_COUNTING", 0.96);
    }

    // 7. IMAGE_QUALITY_ANALYSIS
    if (
      /\b(blurry|clear|sharpness|resolution|quality|pixelated|fidelity|noise level|is this image blurry)\b/i.test(
        lower,
      ) &&
      /\b(check|analyze|evaluate|tell me|is|quality)\b/i.test(lower)
    ) {
      return make("IMAGE_QUALITY_ANALYSIS", 0.95);
    }

    // 8. IMAGE_AUTHENTICITY_ANALYSIS
    if (
      /\b(signs of editing|edited|photoshopped|fake|authentic|ai generated|manipulated|altered|tampered|deepfake)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_AUTHENTICITY_ANALYSIS", 0.95);
    }

    // 3. OBJECT_DETECTION
    if (
      /\b(identify all objects|detect objects|list all objects|list everything|what objects)\b/i.test(
        lower,
      ) ||
      /\b(find|detect|locate)\s+(?:all\s+)?(?:objects|items|elements)\b/i.test(lower)
    ) {
      return make("OBJECT_DETECTION", 0.96);
    }

    // 10. VISUAL_IDENTIFICATION
    if (
      /\b(identify the type of|what breed|what species|what model|what kind of|what plant|what flower|what dog|what car)\b/i.test(
        lower,
      ) ||
      /\bidentify (?:this|the) (?:flower|plant|bird|animal|car|object|building)\b/i.test(lower)
    ) {
      return make("VISUAL_IDENTIFICATION", 0.95);
    }

    // 5. SCENE_UNDERSTANDING
    if (
      /\b(what is happening in this scene|explain what is happening|explain the scene|context of this scene|what's going on in this)\b/i.test(
        lower,
      )
    ) {
      return make("SCENE_UNDERSTANDING", 0.95);
    }

    // 2. IMAGE_DESCRIPTION
    if (
      /\b(describe this image in detail|detailed description|describe in detail|give a description of this)\b/i.test(
        lower,
      ) ||
      /\bdescribe\s+(?:the\s+|this\s+)?(?:image|picture|photo|background|foreground|scene|everything visible|all the details)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_DESCRIPTION", 0.96);
    }

    // 19. IMAGE_LAYOUT_ANALYSIS
    if (
      /\b(layout and positioning|visual hierarchy|layout grid|positioning of elements|composition grid|ui layout)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_LAYOUT_ANALYSIS", 0.95);
    }

    // 20. VISUAL_CONSISTENCY_CHECK
    if (
      /\b(follow the same style|visual consistency|brand consistency|consistent in style|match the design system)\b/i.test(
        lower,
      )
    ) {
      return make("VISUAL_CONSISTENCY_CHECK", 0.95);
    }

    // 11. IMAGE_COMPARISON
    if (
      /\b(compare these|compare both|compare the two|compare image 1 and image 2|side by side comparison)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_COMPARISON", 0.96);
    }

    // 12. IMAGE_DIFFERENCE_DETECTION
    if (
      /\b(what changed between|show what changed|find the differences|spot the difference|differences between these)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_DIFFERENCE_DETECTION", 0.96);
    }

    // 13. IMAGE_SIMILARITY_ANALYSIS
    if (
      /\b(visual similarities|how similar are|find similarities|common visual elements)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_SIMILARITY_ANALYSIS", 0.95);
    }

    // 1. IMAGE_UNDERSTANDING (General visual inquiry)
    if (
      /\b(what is in this image|what do you see|what's in this picture|what's in this image|analyze this image|explain this image)\b/i.test(
        lower,
      ) ||
      /^(?:explain|analyze|interpret)\s+(?:this|the)\s+(?:image|picture|photo)\b/i.test(lower)
    ) {
      return make("IMAGE_UNDERSTANDING", 0.95);
    }

    // 6. IMAGE_QUESTION_ANSWERING
    if (
      /\b(what brand|where was this|what color is the|who is in|is there a|are there any)\b/i.test(
        lower,
      ) ||
      /\b(?:is|are)\s+.+\s+visible\b/i.test(lower) ||
      (/\b(in|of|on)\s+(?:this|the)\s+(?:image|picture|photo|graphic)\b/i.test(lower) &&
        lower.includes("?"))
    ) {
      return make("IMAGE_QUESTION_ANSWERING", 0.92);
    }
  }

  // -------------------------------------------------------------
  // B. IMAGE EDITING & TRANSFORMATION (31 - 40)
  // When an attachment exists or query explicitly asks to alter/edit/modify
  // -------------------------------------------------------------
  if (hasAttachment) {
    // 48. IMAGE_TEXT_MODIFICATION
    if (
      /\b(replace the heading|change the text (?:on|in)|replace the text|edit text in image|change heading to)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_TEXT_MODIFICATION", 0.95);
    }

    // 49. IMAGE_COLORIZATION
    if (
      /\b(add realistic colors|colorize|colorise|black-and-white to color|color this monochrome)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_COLORIZATION", 0.97);
    }

    // 37. CLOTHING_MODIFICATION
    if (
      /\b(change\s+(?:the\s+)?(?:shirt|jacket|dress|suit|pants|trousers|boots|shoes|outfit|clothes|hat)\s+to|dress\s+.+\s+in|wear\s+(?:a|an))\b/i.test(
        lower,
      ) ||
      /\b(change\s+outfit|change\s+clothing)\b/i.test(lower)
    ) {
      return make("CLOTHING_MODIFICATION", 0.96);
    }

    // 39. WEATHER_TRANSFORMATION
    if (
      /\b(change (?:the )?(?:sunny|rainy|cloudy|clear)?\s*sky to|make it rainy|make it snowy|weather transformation|turn (?:the )?weather|add rain|add snow)\b/i.test(
        lower,
      )
    ) {
      return make("WEATHER_TRANSFORMATION", 0.95);
    }

    // 40. ARTISTIC_STYLE_TRANSFORMATION
    if (
      /\b(convert (?:this )?(?:photo|image|photograph)?\s*into (?:watercolor|oil paint|sketch|anime|cartoon|comic|cyberpunk|line art)(?:\s+(?:art|artwork|painting))?|turn this into (?:watercolor|oil paint|anime|a painting))\b/i.test(
        lower,
      ) ||
      /\b(?:in|into)\s+(?:watercolor|cyberpunk|anime|oil painting|sketch|digital art)\s+style\b/i.test(
        lower,
      )
    ) {
      return make("ARTISTIC_STYLE_TRANSFORMATION", 0.95);
    }

    // 32. BACKGROUND_REMOVAL
    if (
      /\b(remove (?:the )?background|erase (?:the )?background|cut out (?:the )?subject|isolate (?:the )?subject|background removal|drop the background)\b/i.test(
        lower,
      ) &&
      !/\btransparent png\b/i.test(lower) &&
      !/\breplace\b/i.test(lower)
    ) {
      return make("BACKGROUND_REMOVAL", 0.97);
    }

    // 50. TRANSPARENT_IMAGE_CREATION
    if (
      /\b(transparent png|transparent background|export as transparent|make (?:the )?background transparent)\b/i.test(
        lower,
      )
    ) {
      return make("TRANSPARENT_IMAGE_CREATION", 0.97);
    }

    // 31. BACKGROUND_REPLACEMENT
    if (
      /\b(replace (?:the )?background|change (?:the )?background to|swap (?:the )?background|put (?:him|her|it|them|this|the subject) (?:in|on|at|against) (?:a |an )?)\b/i.test(
        lower,
      )
    ) {
      return make("BACKGROUND_REPLACEMENT", 0.97);
    }

    // 33. OBJECT_REMOVAL
    if (
      /\b(remove (?:the |that |this )?(?:person|man|woman|car|dog|cat|object|tree|building|glasses|chair|table|watermark|logo|text|sign|left|right))\b/i.test(
        lower,
      ) ||
      /\b(erase|delete|take off|clear)\s+(?:the\s+)?(?:person|man|woman|car|dog|cat|object|item)\b/i.test(
        lower,
      )
    ) {
      return make("OBJECT_REMOVAL", 0.96);
    }

    // 35. OBJECT_REPLACEMENT
    if (
      /\b(replace\s+(?:the\s+)?[a-z0-9_-]+\s+with\s+.+|swap\s+(?:the\s+)?[a-z0-9_-]+\s+for\s+.+|change\s+(?:the\s+)?[a-z0-9_-]+\s+to\s+(?:a|an)\s+.+)\b/i.test(
        lower,
      )
    ) {
      return make("OBJECT_REPLACEMENT", 0.96);
    }

    // 34. OBJECT_ADDITION
    if (
      /\b(add\s+(?:a|an|some|the)?\s+.+\s+to\s+(?:the|this)|put\s+(?:a|an|some)\s+.+\s+(?:on|in|around)|give\s+(?:him|her|it)\s+(?:a|an))\b/i.test(
        lower,
      ) ||
      /^(?:can you\s+)?(?:please\s+)?add\s+.+/i.test(lower)
    ) {
      return make("OBJECT_ADDITION", 0.95);
    }

    // 36. COLOR_MODIFICATION
    if (
      /\b(change\s+.+\s+from\s+[a-z-]+\s+to\s+[a-z-]+|change\s+.+\s+to\s+(?:red|blue|green|yellow|black|white|purple|pink|orange|brown|lavender|grey|gold|silver|dark|light)|make\s+.+\s+(?:red|blue|green|yellow|black|white|purple|pink|orange|brown|lavender|grey|gold|silver)|turn\s+.+\s+(?:red|blue|green|yellow|black|white|purple|pink|orange|brown|lavender|grey|gold|silver)|recolor|repaint)\b/i.test(
        lower,
      )
    ) {
      return make("COLOR_MODIFICATION", 0.96);
    }

    // 38. LIGHTING_ADJUSTMENT
    if (
      /\b(make (?:the )?lighting|lighting warmer|softer lighting|dramatic lighting|make (?:it|this|the image|the picture)?\s*(?:brighter|darker)|adjust exposure|add rim light|darken|brighten)\b/i.test(
        lower,
      )
    ) {
      return make("LIGHTING_ADJUSTMENT", 0.95);
    }

    // 14. IMAGE_VARIATIONS
    if (
      /\b(different versions of this|create variations|variations of this|alternate versions|generate (?:two|three|four|\d+)?\s*versions)\b/i.test(
        lower,
      ) ||
      /\b(generate|create|make)\s+(?:a\s+)?(?:new\s+)?version\s+(?:in|with|using)\b/i.test(lower) ||
      /\b(make|give me)\s+(?:some|more|another)\s+variations\b/i.test(lower)
    ) {
      return make("IMAGE_VARIATIONS", 0.95);
    }

    // 15. IMAGE_RECREATION
    if (
      /\b(create a similar image|recreate this|remake this image|recreate in this style|produce a similar picture)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_RECREATION", 0.94);
    }

    // 16. REFERENCE_BASED_GENERATION
    if (
      /\b(use this image as a reference|use as reference|reference for a new|based on this reference)\b/i.test(
        lower,
      )
    ) {
      return make("REFERENCE_BASED_GENERATION", 0.95);
    }

    // 17. IMAGE_STYLE_TRANSFER
    if (
      /\b(apply the style of|style transfer|transfer (?:the )?style|apply this style to)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_STYLE_TRANSFER", 0.95);
    }

    // 18. IMAGE_COMPOSITION
    if (
      /\b(combine these two|combine (?:these|the) images|composite these|merge these (?:two )?images into one)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_COMPOSITION", 0.95);
    }

    // -----------------------------------------------------------
    // C. IMAGE ENHANCEMENT & ADVANCED (41 - 50)
    // -----------------------------------------------------------
    // 41. IMAGE_UPSCALING
    if (
      /\b(make\s+(?:it\s+)?(?:hd|4k)|make\s+hd|upscale|higher resolution|increase resolution|enhance resolution|super resolve|4k upscale|high definition)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_UPSCALING", 0.96);
    }

    // 42. IMAGE_RESTORATION
    if (
      /\b(restore this old|fix scratches|damaged photograph|restore (?:old|damaged|vintage|antique))\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_RESTORATION", 0.96);
    }

    // 43. IMAGE_SHARPENING
    if (
      /\b(sharpen|make (?:this )?image clearer and sharper|deblur|reduce blur|unblur)\b/i.test(
        lower,
      )
    ) {
      return make("IMAGE_SHARPENING", 0.95);
    }

    // 44. IMAGE_NOISE_REDUCTION
    if (
      /\b(remove grain|noise reduction|denoise|reduce noise|clean up sensor noise)\b/i.test(lower)
    ) {
      return make("IMAGE_NOISE_REDUCTION", 0.95);
    }

    // 45. IMAGE_OUTPAINTING
    if (
      /\b(outpaint|out-paint|zoom out|extend the image|extend image|expand the canvas|expand canvas|extend left and right|expand borders|widen the scene|widen the view|widen scene)\b/i.test(
        lower,
      ) ||
      /^(?:can you\s+)?(?:please\s+)?expand(?:\s+(?:the\s+)?(?:image|canvas|photo|picture|view|scene|borders|it|this))?$/i.test(
        trimmed,
      ) ||
      /\bexpand\s+(?:the\s+)?(?:image|canvas|photo|picture|view|scene|it|this)\b/i.test(lower)
    ) {
      return make(
        "IMAGE_OUTPAINTING",
        0.97,
        trimmed,
        "Expand the canvas and outpaint the scene boundaries outward with consistent context",
      );
    }

    // 46. ASPECT_RATIO_CONVERSION
    if (
      /\b(phone wallpaper|suitable for a phone|change aspect ratio|convert aspect ratio|make it 16:9|make it 9:16|make it square)\b/i.test(
        lower,
      )
    ) {
      return make("ASPECT_RATIO_CONVERSION", 0.96);
    }

    // 47. SMART_CROPPING
    if (/\b(crop this image|crop around|smart crop|auto crop|crop tightly)\b/i.test(lower)) {
      return make("SMART_CROPPING", 0.95);
    }

    // Fallback for general editing/modifying when attachment is present
    if (/\b(modify|alter|edit|update|retouch|tweak|change)\b/i.test(lower)) {
      return make("COLOR_MODIFICATION", 0.85, trimmed, trimmed);
    }
  }

  // -------------------------------------------------------------
  // D. IMAGE GENERATION (21 - 30)
  // Standalone requests or explicit generation directives
  // -------------------------------------------------------------
  const isGenPrefix =
    /^(?:can you\s+)?(?:please\s+)?(?:generate|create|make|draw|paint|render|design)\b/i.test(
      lower,
    );

  // 22. MULTI_IMAGE_GENERATION
  if (
    isGenPrefix &&
    outputCount > 1 &&
    /\b(separate|different|images|photos|wallpapers|landscapes)\b/i.test(lower)
  ) {
    return make("MULTI_IMAGE_GENERATION", 0.96, cleanGeneratePrompt(trimmed));
  }

  // 23. CHARACTER_GENERATION
  if (
    /\b(fantasy warrior character|anime protagonist|rpg character|superhero character|create a character|character concept)\b/i.test(
      lower,
    ) ||
    (isGenPrefix && /\b(?:fantasy\s+)?character\b/i.test(lower))
  ) {
    return make("CHARACTER_GENERATION", 0.96, cleanGeneratePrompt(trimmed));
  }

  // 24. PRODUCT_IMAGE_GENERATION
  if (
    /\b(product advertisement|perfume advertisement|product photography|commercial product photo|product shot|commercial ad)\b/i.test(
      lower,
    ) ||
    (isGenPrefix && /\bproduct\s+(?:photo|shot|image|advertisement)\b/i.test(lower))
  ) {
    return make("PRODUCT_IMAGE_GENERATION", 0.96, cleanGeneratePrompt(trimmed));
  }

  // 25. PORTRAIT_GENERATION
  if (
    /\b(profile portrait|professional portrait|headshot|profile photo of|portrait photography)\b/i.test(
      lower,
    ) ||
    (isGenPrefix && /\b(?:profile\s+)?(?:portrait|headshot)\b/i.test(lower))
  ) {
    return make("PORTRAIT_GENERATION", 0.96, cleanGeneratePrompt(trimmed));
  }

  // 26. LANDSCAPE_GENERATION
  if (
    /\b(mountain wallpaper|cinematic mountain|landscape wallpaper|scenic forest|nature landscape|ocean sunset wallpaper)\b/i.test(
      lower,
    ) ||
    (isGenPrefix && /\b(?:landscape|scenery|scenic|wallpaper)\b/i.test(lower))
  ) {
    return make("LANDSCAPE_GENERATION", 0.96, cleanGeneratePrompt(trimmed));
  }

  // 27. LOGO_GENERATION
  if (
    /\b(company logo|minimalist technology company logo|vector logo|brand logo|emblem logo|design a logo)\b/i.test(
      lower,
    ) ||
    (isGenPrefix && /\blogo\b/i.test(lower))
  ) {
    return make("LOGO_GENERATION", 0.97, cleanGeneratePrompt(trimmed));
  }

  // 28. POSTER_GENERATION
  if (
    /\b(promotional event poster|event poster|movie poster|concert flyer|festival poster|wedding invitation|invitation|design a poster)\b/i.test(
      lower,
    ) ||
    (isGenPrefix && /\b(?:event\s+)?(?:poster|flyer|invitation|banner)\b/i.test(lower))
  ) {
    return make("POSTER_GENERATION", 0.97, cleanGeneratePrompt(trimmed));
  }

  // 29. INFOGRAPHIC_GENERATION
  if (
    /\b(infographic explaining|create an infographic|design an infographic|educational diagram)\b/i.test(
      lower,
    ) ||
    (isGenPrefix && /\binfographic\b/i.test(lower))
  ) {
    return make("INFOGRAPHIC_GENERATION", 0.97, cleanGeneratePrompt(trimmed));
  }

  // 30. UI_MOCKUP_GENERATION
  if (
    /\b(mobile banking screen|ui mockup|landing page screen|dashboard screen|modern mobile app screen|ui screen)\b/i.test(
      lower,
    ) ||
    (isGenPrefix && /\b(?:ui|mockup|mobile screen|app interface)\b/i.test(lower))
  ) {
    return make("UI_MOCKUP_GENERATION", 0.97, cleanGeneratePrompt(trimmed));
  }

  // 21. TEXT_TO_IMAGE (General generation with prefixes)
  const generalGeneratePrefixes = [
    /^(?:can you\s+)?(?:please\s+)?(?:generate|create|make|draw|paint|render)\s+(?:me\s+)?(?:an?\s+)?(?:[a-z-]+\s+)*(?:image|photo|picture|photograph|portrait|wallpaper|illustration|painting|artwork|drawing)(?:\s+(?:of|about|showing|with))?\s*/i,
    /^(?:can you\s+)?(?:please\s+)?(?:generate|create|make|design)\s+(?:me\s+)?(?:an?\s+)?(?:[a-z-]+\s+)*(?:wedding invitation|invitation|poster|logo|banner|flyer|artwork|painting|character|infographic|mockup)(?:\s+(?:with|showing|of|for))?\s*/i,
    /^(?:generate|create|render)\s+(?:image|picture|photo):\s*/i,
  ];

  for (const regex of generalGeneratePrefixes) {
    if (regex.test(trimmed)) {
      const extracted = trimmed.replace(regex, "").trim();
      return make("TEXT_TO_IMAGE", 0.95, extracted || trimmed);
    }
  }

  if (isGenPrefix) {
    return make("TEXT_TO_IMAGE", 0.95, cleanGeneratePrompt(trimmed));
  }

  // Direct prompt formats:
  // - "Prompt: { ... }" or structured JSON
  if (
    trimmed.startsWith("Prompt: {") ||
    (trimmed.startsWith("{") &&
      (trimmed.includes('"task": "image_generation"') || trimmed.includes('"image_generation"')))
  ) {
    return make("TEXT_TO_IMAGE", 0.99, trimmed);
  }

  // - "photo of a white cat...", "photorealistic luxury fashion editorial..."
  if (
    /^(?:photorealistic\s+|realistic\s+)?(?:photo|picture|illustration|portrait|painting)\s+of\s+/i.test(
      trimmed,
    )
  ) {
    return make("TEXT_TO_IMAGE", 0.92, trimmed);
  }

  // Standalone editorial prompts
  if (/^A photorealistic\s+.+\s+(?:portrait|editorial|photo|shot|scene)/i.test(trimmed)) {
    return make("TEXT_TO_IMAGE", 0.92, trimmed);
  }

  // Fallback check: if user asked an explicit edit command without attachment context
  if (
    /\b(change (?:the )?(?:color|background|outfit|shirt)|make (?:the )?car|turn (?:the )?car|remove the person|add flowers|modify|alter|edit)\b/i.test(
      lower,
    )
  ) {
    return make("COLOR_MODIFICATION", 0.75, trimmed, trimmed);
  }

  // Default: General text chat
  return {
    intent: "IMAGE_UNDERSTANDING",
    operationType: "IMAGE_UNDERSTAND",
    category: "understanding",
    sourceImageIds,
    conversationId: options?.conversation?.id,
    prompt: trimmed,
    requiresImageInput: false,
    outputCount: 1,
    confidence: 0.1,
    clarificationNeeded,
    clarificationMessage,
  };
}

/**
 * Backward-compatible detector preserving existing contract
 */
export function detectImageIntent(text: string, hasAttachment = false): ImageIntentResult {
  const classified = classifyImageIntent(text, { hasAttachment });
  const trimmed = text.trim();

  // If low confidence, it is general chat
  if (classified.confidence < 0.7) {
    return { type: "none", prompt: trimmed, classifiedIntent: classified };
  }

  if (classified.operationType === "IMAGE_GENERATE") {
    return {
      type: "generate",
      prompt: classified.prompt,
      classifiedIntent: classified,
    };
  }

  if (classified.operationType === "IMAGE_VARIATIONS") {
    return {
      type: hasAttachment ? "edit" : "generate",
      prompt: classified.prompt,
      editInstruction: classified.editInstruction,
      classifiedIntent: classified,
    };
  }

  if (classified.operationType === "IMAGE_EDIT" || classified.operationType === "IMAGE_ENHANCE") {
    return {
      type: "edit",
      prompt: classified.prompt,
      editInstruction: classified.editInstruction,
      classifiedIntent: classified,
    };
  }

  if (classified.operationType === "IMAGE_UNDERSTAND" && hasAttachment) {
    return {
      type: "question",
      prompt: classified.prompt,
      classifiedIntent: classified,
    };
  }

  return { type: "none", prompt: trimmed, classifiedIntent: classified };
}
