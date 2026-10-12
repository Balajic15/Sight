import { describe, it, expect } from "vitest";
import {
  classifyImageIntent,
  detectImageIntent,
  INTENT_DEFINITIONS,
  type ImageIntentName,
} from "@/lib/assistant/image-intent";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import type { Conversation, ChatAttachment } from "@/lib/assistant/store";

describe("50 Image AI Intents Master Suite", () => {
  const dummyConvoWithImage: Conversation = {
    id: "conv-intents-1",
    title: "50 Intents Conversation",
    updatedAt: Date.now(),
    messages: [
      {
        id: "m-user-1",
        role: "user",
        text: "Generate a sports car",
      },
      {
        id: "m-asst-1",
        role: "assistant",
        text: "Here is your car",
        attachments: [
          {
            id: "img-car-101",
            conversationId: "conv-intents-1",
            messageId: "m-asst-1",
            origin: "generated",
            fileName: "sports_car.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            storageRef: "/api/media?id=img-car-101",
            status: "ready",
            prompt: "a white sports car at night",
            createdAt: Date.now(),
          },
        ],
      },
    ],
  };

  const dummyConvoWithTwoImages: Conversation = {
    id: "conv-intents-2",
    title: "Dual Image Conversation",
    updatedAt: Date.now(),
    messages: [
      {
        id: "m-asst-dual",
        role: "assistant",
        text: "Two designs",
        attachments: [
          {
            id: "img-design-a",
            conversationId: "conv-intents-2",
            origin: "uploaded",
            fileName: "design_a.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            storageRef: "/api/media?id=img-design-a",
            status: "ready",
            createdAt: Date.now() - 1000,
          },
          {
            id: "img-design-b",
            conversationId: "conv-intents-2",
            origin: "uploaded",
            fileName: "design_b.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            storageRef: "/api/media?id=img-design-b",
            status: "ready",
            createdAt: Date.now(),
          },
        ],
      },
    ],
  };

  describe("Category 1: Image Understanding & Analysis (1 - 10)", () => {
    it("1. IMAGE_UNDERSTANDING - 'What is in this image?'", () => {
      const res = classifyImageIntent("What is in this image?", { hasAttachment: true });
      expect(res.intent).toBe("IMAGE_UNDERSTANDING");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
      expect(res.requiresImageInput).toBe(true);
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("2. IMAGE_DESCRIPTION - 'Describe this image in detail.'", () => {
      const res = classifyImageIntent("Describe this image in detail.", { hasAttachment: true });
      expect(res.intent).toBe("IMAGE_DESCRIPTION");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("3. OBJECT_DETECTION - 'Identify all objects in this picture.'", () => {
      const res = classifyImageIntent("Identify all objects in this picture.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("OBJECT_DETECTION");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("4. OCR_TEXT_EXTRACTION - 'Extract all the text from this image.'", () => {
      const res = classifyImageIntent("Extract all the text from this image.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("OCR_TEXT_EXTRACTION");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("5. SCENE_UNDERSTANDING - 'Explain what is happening in this scene.'", () => {
      const res = classifyImageIntent("Explain what is happening in this scene.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("SCENE_UNDERSTANDING");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("6. IMAGE_QUESTION_ANSWERING - 'What brand is shown on this package?'", () => {
      const res = classifyImageIntent("What brand is shown on this package?", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_QUESTION_ANSWERING");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("7. IMAGE_QUALITY_ANALYSIS - 'Check whether this image is blurry or clear.'", () => {
      const res = classifyImageIntent("Check whether this image is blurry or clear.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_QUALITY_ANALYSIS");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("8. IMAGE_AUTHENTICITY_ANALYSIS - 'Does this image show signs of editing?'", () => {
      const res = classifyImageIntent("Does this image show signs of editing?", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_AUTHENTICITY_ANALYSIS");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("9. VISUAL_COUNTING - 'How many cars are visible?'", () => {
      const res = classifyImageIntent("How many cars are visible?", { hasAttachment: true });
      expect(res.intent).toBe("VISUAL_COUNTING");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("10. VISUAL_IDENTIFICATION - 'Identify the type of flower in this picture.'", () => {
      const res = classifyImageIntent("Identify the type of flower in this picture.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("VISUAL_IDENTIFICATION");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });
  });

  describe("Category 2: Image Comparison & Reference Analysis (11 - 20)", () => {
    it("11. IMAGE_COMPARISON - 'Compare these two designs.'", () => {
      const res = classifyImageIntent("Compare these two designs.", { hasAttachment: true });
      expect(res.intent).toBe("IMAGE_COMPARISON");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("12. IMAGE_DIFFERENCE_DETECTION - 'Show what changed between these images.'", () => {
      const res = classifyImageIntent("Show what changed between these images.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_DIFFERENCE_DETECTION");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("13. IMAGE_SIMILARITY_ANALYSIS - 'Find the visual similarities between these pictures.'", () => {
      const res = classifyImageIntent("Find the visual similarities between these pictures.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_SIMILARITY_ANALYSIS");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("14. IMAGE_VARIATIONS - 'Generate four different versions of this design.'", () => {
      const res = classifyImageIntent("Generate four different versions of this design.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_VARIATIONS");
      expect(res.operationType).toBe("IMAGE_VARIATIONS");
      expect(res.outputCount).toBe(4);
    });

    it("15. IMAGE_RECREATION - 'Create a similar image in this style.'", () => {
      const res = classifyImageIntent("Create a similar image in this style.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_RECREATION");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("16. REFERENCE_BASED_GENERATION - 'Use this image as a reference for a new design.'", () => {
      const res = classifyImageIntent("Use this image as a reference for a new design.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("REFERENCE_BASED_GENERATION");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("17. IMAGE_STYLE_TRANSFER - 'Apply the style of the second image to the first.'", () => {
      const res = classifyImageIntent("Apply the style of the second image to the first.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_STYLE_TRANSFER");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("18. IMAGE_COMPOSITION - 'Combine these two images into one scene.'", () => {
      const res = classifyImageIntent("Combine these two images into one scene.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_COMPOSITION");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("19. IMAGE_LAYOUT_ANALYSIS - 'Explain the layout and positioning of elements.'", () => {
      const res = classifyImageIntent("Explain the layout and positioning of elements.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_LAYOUT_ANALYSIS");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });

    it("20. VISUAL_CONSISTENCY_CHECK - 'Check whether these product images follow the same style.'", () => {
      const res = classifyImageIntent("Check whether these product images follow the same style.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("VISUAL_CONSISTENCY_CHECK");
      expect(res.operationType).toBe("IMAGE_UNDERSTAND");
    });
  });

  describe("Category 3: Image Generation (21 - 30)", () => {
    it("21. TEXT_TO_IMAGE - 'Generate a futuristic city at night.'", () => {
      const res = classifyImageIntent("Generate a futuristic city at night.");
      expect(res.intent).toBe("TEXT_TO_IMAGE");
      expect(res.operationType).toBe("IMAGE_GENERATE");
      expect(res.requiresImageInput).toBe(false);
    });

    it("22. MULTI_IMAGE_GENERATION - 'Generate four separate mountain landscape images.'", () => {
      const res = classifyImageIntent("Generate four separate mountain landscape images.");
      expect(res.intent).toBe("MULTI_IMAGE_GENERATION");
      expect(res.operationType).toBe("IMAGE_VARIATIONS");
      expect(res.outputCount).toBe(4);
    });

    it("23. CHARACTER_GENERATION - 'Create a fantasy warrior character.'", () => {
      const res = classifyImageIntent("Create a fantasy warrior character.");
      expect(res.intent).toBe("CHARACTER_GENERATION");
      expect(res.operationType).toBe("IMAGE_GENERATE");
    });

    it("24. PRODUCT_IMAGE_GENERATION - 'Create a premium perfume advertisement.'", () => {
      const res = classifyImageIntent("Create a premium perfume advertisement.");
      expect(res.intent).toBe("PRODUCT_IMAGE_GENERATION");
      expect(res.operationType).toBe("IMAGE_GENERATE");
    });

    it("25. PORTRAIT_GENERATION - 'Generate a professional profile portrait.'", () => {
      const res = classifyImageIntent("Generate a professional profile portrait.");
      expect(res.intent).toBe("PORTRAIT_GENERATION");
      expect(res.operationType).toBe("IMAGE_GENERATE");
    });

    it("26. LANDSCAPE_GENERATION - 'Create a cinematic mountain wallpaper.'", () => {
      const res = classifyImageIntent("Create a cinematic mountain wallpaper.");
      expect(res.intent).toBe("LANDSCAPE_GENERATION");
      expect(res.operationType).toBe("IMAGE_GENERATE");
    });

    it("27. LOGO_GENERATION - 'Create a minimalist technology company logo.'", () => {
      const res = classifyImageIntent("Create a minimalist technology company logo.");
      expect(res.intent).toBe("LOGO_GENERATION");
      expect(res.operationType).toBe("IMAGE_GENERATE");
    });

    it("28. POSTER_GENERATION - 'Design a promotional event poster.'", () => {
      const res = classifyImageIntent("Design a promotional event poster.");
      expect(res.intent).toBe("POSTER_GENERATION");
      expect(res.operationType).toBe("IMAGE_GENERATE");
    });

    it("29. INFOGRAPHIC_GENERATION - 'Create an infographic explaining cloud computing.'", () => {
      const res = classifyImageIntent("Create an infographic explaining cloud computing.");
      expect(res.intent).toBe("INFOGRAPHIC_GENERATION");
      expect(res.operationType).toBe("IMAGE_GENERATE");
    });

    it("30. UI_MOCKUP_GENERATION - 'Generate a modern mobile banking screen.'", () => {
      const res = classifyImageIntent("Generate a modern mobile banking screen.");
      expect(res.intent).toBe("UI_MOCKUP_GENERATION");
      expect(res.operationType).toBe("IMAGE_GENERATE");
    });
  });

  describe("Category 4: Image Editing & Transformation (31 - 40)", () => {
    it("31. BACKGROUND_REPLACEMENT - 'Replace the background with a beach at sunset.'", () => {
      const res = classifyImageIntent("Replace the background with a beach at sunset.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("BACKGROUND_REPLACEMENT");
      expect(res.operationType).toBe("IMAGE_EDIT");
      expect(res.requiresImageInput).toBe(true);
    });

    it("32. BACKGROUND_REMOVAL - 'Remove the background and keep the subject.'", () => {
      const res = classifyImageIntent("Remove the background and keep the subject.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("BACKGROUND_REMOVAL");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("33. OBJECT_REMOVAL - 'Remove the person standing on the left.'", () => {
      const res = classifyImageIntent("Remove the person standing on the left.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("OBJECT_REMOVAL");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("34. OBJECT_ADDITION - 'Add flowers to the table.'", () => {
      const res = classifyImageIntent("Add flowers to the table.", { hasAttachment: true });
      expect(res.intent).toBe("OBJECT_ADDITION");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("35. OBJECT_REPLACEMENT - 'Replace the phone with a laptop.'", () => {
      const res = classifyImageIntent("Replace the phone with a laptop.", { hasAttachment: true });
      expect(res.intent).toBe("OBJECT_REPLACEMENT");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("36. COLOR_MODIFICATION - 'Change the car from white to red.'", () => {
      const res = classifyImageIntent("Change the car from white to red.", { hasAttachment: true });
      expect(res.intent).toBe("COLOR_MODIFICATION");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("37. CLOTHING_MODIFICATION - 'Change the shirt to a black formal suit.'", () => {
      const res = classifyImageIntent("Change the shirt to a black formal suit.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("CLOTHING_MODIFICATION");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("38. LIGHTING_ADJUSTMENT - 'Make the lighting warmer and softer.'", () => {
      const res = classifyImageIntent("Make the lighting warmer and softer.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("LIGHTING_ADJUSTMENT");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("39. WEATHER_TRANSFORMATION - 'Change the sunny sky to a rainy evening.'", () => {
      const res = classifyImageIntent("Change the sunny sky to a rainy evening.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("WEATHER_TRANSFORMATION");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });

    it("40. ARTISTIC_STYLE_TRANSFORMATION - 'Convert this photograph into watercolor artwork.'", () => {
      const res = classifyImageIntent("Convert this photograph into watercolor artwork.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("ARTISTIC_STYLE_TRANSFORMATION");
      expect(res.operationType).toBe("IMAGE_EDIT");
    });
  });

  describe("Category 5: Image Enhancement & Advanced Operations (41 - 50)", () => {
    it("41. IMAGE_UPSCALING - 'Upscale this image to a higher resolution.'", () => {
      const res = classifyImageIntent("Upscale this image to a higher resolution.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_UPSCALING");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });

    it("42. IMAGE_RESTORATION - 'Restore this old damaged photograph.'", () => {
      const res = classifyImageIntent("Restore this old damaged photograph.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_RESTORATION");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });

    it("43. IMAGE_SHARPENING - 'Make this image clearer and sharper.'", () => {
      const res = classifyImageIntent("Make this image clearer and sharper.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_SHARPENING");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });

    it("44. IMAGE_NOISE_REDUCTION - 'Remove grain and visual noise.'", () => {
      const res = classifyImageIntent("Remove grain and visual noise.", { hasAttachment: true });
      expect(res.intent).toBe("IMAGE_NOISE_REDUCTION");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });

    it("45. IMAGE_OUTPAINTING - 'Extend the image to the left and right.'", () => {
      const res = classifyImageIntent("Extend the image to the left and right.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_OUTPAINTING");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });

    it("46. ASPECT_RATIO_CONVERSION - 'Make this suitable for a phone wallpaper.'", () => {
      const res = classifyImageIntent("Make this suitable for a phone wallpaper.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("ASPECT_RATIO_CONVERSION");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
      expect(res.targetAspect).toBe("9:16");
    });

    it("47. SMART_CROPPING - 'Crop this image around the main subject.'", () => {
      const res = classifyImageIntent("Crop this image around the main subject.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("SMART_CROPPING");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });

    it("48. IMAGE_TEXT_MODIFICATION - 'Replace the heading with Grand Opening.'", () => {
      const res = classifyImageIntent("Replace the heading with Grand Opening.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_TEXT_MODIFICATION");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });

    it("49. IMAGE_COLORIZATION - 'Add realistic colors to this black-and-white photo.'", () => {
      const res = classifyImageIntent("Add realistic colors to this black-and-white photo.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("IMAGE_COLORIZATION");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });

    it("50. TRANSPARENT_IMAGE_CREATION - 'Remove the background and export as transparent PNG.'", () => {
      const res = classifyImageIntent("Remove the background and export as transparent PNG.", {
        hasAttachment: true,
      });
      expect(res.intent).toBe("TRANSPARENT_IMAGE_CREATION");
      expect(res.operationType).toBe("IMAGE_ENHANCE");
    });
  });

  describe("Context Resolution & Lineage Rules", () => {
    it("resolves the correct source image ID in conversational context", () => {
      const res = classifyImageIntent("Change the car to red", {
        conversation: dummyConvoWithImage,
      });
      expect(res.sourceImageIds).toContain("img-car-101");
      expect(res.intent).toBe("COLOR_MODIFICATION");
    });

    it("preserves explicit selection over recency", () => {
      const res = classifyImageIntent("Modify this design", {
        conversation: dummyConvoWithTwoImages,
        selectedAttachmentId: "img-design-a",
      });
      expect(res.sourceImageIds[0]).toBe("img-design-a");
    });

    it("detects ambiguity when user queries an ambiguous ordinal without clear target", () => {
      const res = classifyImageIntent("Which one is better?", {
        conversation: dummyConvoWithTwoImages,
      });
      expect(res.clarificationNeeded).toBe(true);
      expect(res.clarificationMessage).toBeDefined();
    });

    it("accurately reports definitions for all 50 intents", () => {
      const allIntents = Object.keys(INTENT_DEFINITIONS) as ImageIntentName[];
      expect(allIntents.length).toBe(50);
      for (const name of allIntents) {
        const def = INTENT_DEFINITIONS[name];
        expect(def.name).toBe(name);
        expect(def.category).toBeDefined();
        expect(def.operationType).toBeDefined();
        expect(def.description.length).toBeGreaterThan(5);
      }
    });
  });
});
