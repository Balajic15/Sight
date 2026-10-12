import type { ChatAttachment, Conversation, Msg } from "./store";

export interface ResolvedAttachmentContext {
  targetAttachment?: ChatAttachment | undefined;
  allMediaAttachments: ChatAttachment[];
  allImageAttachments: ChatAttachment[];
  allVideoAttachments: ChatAttachment[];
  isAmbiguous: boolean;
}

export class AttachmentContextService {
  private static instance: AttachmentContextService;

  private constructor() {}

  public static getInstance(): AttachmentContextService {
    if (!AttachmentContextService.instance) {
      AttachmentContextService.instance = new AttachmentContextService();
    }
    return AttachmentContextService.instance;
  }

  /**
   * Resolves the most appropriate image or video attachment for follow-up questions
   */
  public resolveContext(
    conversation: Conversation,
    queryText = "",
    selectedAttachmentId?: string,
  ): ResolvedAttachmentContext {
    const allImages: ChatAttachment[] = [];
    const allVideos: ChatAttachment[] = [];
    const allMedia: ChatAttachment[] = [];

    // Traverse messages in reverse to find recent attachments
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const msg = conversation.messages[i]!;
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.mimeType.startsWith("video/")) {
            allVideos.push(att);
            allMedia.push(att);
          } else if (att.mimeType.startsWith("image/")) {
            allImages.push(att);
            allMedia.push(att);
          }
        }
      }
      if (msg.image) {
        const syntheticImg: ChatAttachment = {
          id: `msg-img-${msg.id}`,
          conversationId: conversation.id,
          fileName: "image.png",
          mimeType: "image/png",
          sizeBytes: 0,
          storageRef: msg.image,
          status: "ready",
          origin: "uploaded",
          createdAt: 0,
        };
        allImages.push(syntheticImg);
        allMedia.push(syntheticImg);
      }
    }

    if (allMedia.length === 0) {
      return {
        allMediaAttachments: [],
        allImageAttachments: [],
        allVideoAttachments: [],
        isAmbiguous: false,
      };
    }

    // 1. Explicit user selection
    if (selectedAttachmentId) {
      const found = allMedia.find((a) => a.id === selectedAttachmentId);
      if (found) {
        return {
          targetAttachment: found,
          allMediaAttachments: allMedia,
          allImageAttachments: allImages,
          allVideoAttachments: allVideos,
          isAmbiguous: false,
        };
      }
    }

    const lower = queryText.toLowerCase();
    const isVideoQuery =
      /\b(video|clip|footage|recording|movie|watch|scenes|timeline|seconds|timestamp|point|minute|moment|happens|enter|duration)\b/i.test(
        lower,
      ) || /\b(at what point|when does|what time|near the end|end of the)\b/i.test(lower);
    const isImageQuery =
      /\b(image|picture|photo|photograph|screenshot|diagram|drawing|painting)\b/i.test(lower);

    const candidates =
      isVideoQuery && allVideos.length > 0
        ? allVideos
        : isImageQuery && allImages.length > 0
          ? allImages
          : allMedia;

    // 2. Check if user mentions a specific file name or prompt keyword
    for (const item of candidates) {
      const baseName = item.fileName.replace(/\.[^.]+$/, "").toLowerCase();
      if (baseName && baseName.length >= 3 && lower.includes(baseName)) {
        return {
          targetAttachment: item,
          allMediaAttachments: allMedia,
          allImageAttachments: allImages,
          allVideoAttachments: allVideos,
          isAmbiguous: false,
        };
      }
      if (item.fileName && lower.includes(item.fileName.toLowerCase())) {
        return {
          targetAttachment: item,
          allMediaAttachments: allMedia,
          allImageAttachments: allImages,
          allVideoAttachments: allVideos,
          isAmbiguous: false,
        };
      }
      if (item.prompt && lower.includes(item.prompt.toLowerCase())) {
        return {
          targetAttachment: item,
          allMediaAttachments: allMedia,
          allImageAttachments: allImages,
          allVideoAttachments: allVideos,
          isAmbiguous: false,
        };
      }

      // Check significant words in baseName or prompt
      const words = [
        ...baseName.split(/[-_\s]+/),
        ...(item.prompt ? item.prompt.toLowerCase().split(/[-_\s]+/) : []),
      ].filter(
        (w) => w.length >= 3 && !["the", "and", "for", "with", "from", "this", "that"].includes(w),
      );

      for (const word of words) {
        const wordRegex = new RegExp(`\\b${word}\\b`, "i");
        if (wordRegex.test(lower)) {
          return {
            targetAttachment: item,
            allMediaAttachments: allMedia,
            allImageAttachments: allImages,
            allVideoAttachments: allVideos,
            isAmbiguous: false,
          };
        }
      }
    }

    // 3. Ambiguity check: if user says "first one", "second one", or ambiguous "which one"
    if (candidates.length > 1) {
      if (
        lower.includes("which one") &&
        !lower.includes("first one") &&
        !lower.includes("second one")
      ) {
        return {
          allMediaAttachments: allMedia,
          allImageAttachments: allImages,
          allVideoAttachments: allVideos,
          isAmbiguous: true,
        };
      }
      if (lower.includes("first one") || lower.includes("left")) {
        return {
          targetAttachment: candidates[candidates.length - 1],
          allMediaAttachments: allMedia,
          allImageAttachments: allImages,
          allVideoAttachments: allVideos,
          isAmbiguous: false,
        };
      }
      if (
        lower.includes("second one") ||
        lower.includes("right") ||
        lower.includes("latest") ||
        lower.includes("last")
      ) {
        return {
          targetAttachment: candidates[0],
          allMediaAttachments: allMedia,
          allImageAttachments: allImages,
          allVideoAttachments: allVideos,
          isAmbiguous: false,
        };
      }
    }

    // 4. Default to latest candidate attachment ONLY if the query is asking about or referring to media
    if (this.isMediaRelatedQuery(queryText)) {
      return {
        targetAttachment: candidates[0],
        allMediaAttachments: allMedia,
        allImageAttachments: allImages,
        allVideoAttachments: allVideos,
        isAmbiguous: false,
      };
    }

    // Unrelated general query (e.g., 'Hi', 'What is Java?', 'Write a Java program', 'What is AI?')
    return {
      targetAttachment: undefined,
      allMediaAttachments: allMedia,
      allImageAttachments: allImages,
      allVideoAttachments: allVideos,
      isAmbiguous: false,
    };
  }

  /**
   * Returns true if query text refers to media, visual content, or timeline events
   */
  public isMediaRelatedQuery(queryText = ""): boolean {
    if (!queryText || !queryText.trim()) return false;
    const lower = queryText.toLowerCase().trim();

    // 1. Explicit media nouns
    if (
      /\b(image|picture|photo|photograph|screenshot|diagram|drawing|painting|artwork|video|clip|footage|recording|movie)\b/i.test(
        lower,
      )
    ) {
      return true;
    }

    // 2. Visual inspection questions
    if (
      /\b(what(?:'s| is) (?:shown|in|on|visible|this|that|it)|describe (?:this|that|it|the)|explain (?:this|what happens)|tell me about (?:this|that|it)|what color|who is in|read the text|what does (?:this|it) (?:look like|show|say)|look at (?:this|that)|see (?:in|inside))\b/i.test(
        lower,
      )
    ) {
      return true;
    }

    // 3. Video-specific questions
    if (
      /\b(at what point|when does|what time|near the end|end of the|scenes|timeline|seconds|timestamp|duration|enter|leaves)\b/i.test(
        lower,
      )
    ) {
      return true;
    }

    // 4. Visual editing / transformation terms (background, colors, visual edits, make it...)
    if (
      /\b(background|foreground|canvas|border|aspect ratio|lighting|brighter|darker|hdr?|upscale|crop|outpaint|expand|zoom|sharpen|unblur|denoise|filter|palette|greyscale|grayscale|black and white|color|colour|wheels|texture|portrait|miniature)\b/i.test(
        lower,
      )
    ) {
      return true;
    }

    // 5. Actions on visual subjects / deictic references ('make it...', 'change it...', 'remove... from it', 'now make...', 'edit it')
    if (
      /\b(make (?:it|this)|change (?:it|this|the)|remove (?:it|this|the|[\w\s]+ from it)|replace (?:it|this|the)|turn (?:it|this) into|now make|add \w+ to (?:it|this)|edit (?:it|this|the|image|photo)?|modify (?:it|this|the)?)\b/i.test(
        lower,
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Helper to load media data (base64) from media storage endpoint
   */
  public async loadMediaDataUri(storageRef: string): Promise<string | null> {
    if (storageRef.startsWith("data:")) return storageRef;
    try {
      const res = await fetch(storageRef);
      if (!res.ok) return null;
      const blob = await res.blob();
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }
}

export const attachmentContextService = AttachmentContextService.getInstance();
