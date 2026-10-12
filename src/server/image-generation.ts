import fs from "node:fs";
import path from "node:path";
import { mediaStorageService } from "./media-storage";
import type { ImageVersionNode } from "@/lib/assistant/store";

export type ImageGenerationStatus = "queued" | "generating" | "succeeded" | "failed" | "cancelled";

export interface ImageGenerationResult {
  operationId: string;
  conversationId: string;
  status: ImageGenerationStatus;
  imageGenerated: boolean;
  imageId?: string;
  imageUrl?: string;
  dataUrl?: string;
  imageName?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ImageGenerationRequest {
  operationId: string;
  conversationId: string;
  prompt: string;
  image?: string | undefined; // base64 or data URL for image editing
  parentImageId?: string | undefined;
  rootImageId?: string | undefined;
  versionNumber?: number | undefined;
  versions?: ImageVersionNode[] | undefined;
  userId?: string | undefined;
  messageId?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  seed?: number | undefined;
  steps?: number | undefined;
  apiKey?: string | undefined;
}

export interface ImageEditRequest {
  operationId: string;
  conversationId: string;
  instruction: string;
  sourceImageId?: string | undefined;
  parentImageId?: string | undefined;
  prompt?: string | undefined;
  image?: string | undefined;
  userId?: string | undefined;
  messageId?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  seed?: number | undefined;
  steps?: number | undefined;
  apiKey?: string | undefined;
}

export interface ImageEditResult extends ImageGenerationResult {
  parentImageId?: string | undefined;
  versionNumber?: number | undefined;
  versions?: ImageVersionNode[] | undefined;
}

export class ImageGenerationService {
  private static instance: ImageGenerationService;
  private readonly endpoint =
    "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b";

  private constructor() {}

  public static getInstance(): ImageGenerationService {
    if (!ImageGenerationService.instance) {
      ImageGenerationService.instance = new ImageGenerationService();
    }
    return ImageGenerationService.instance;
  }

  private getNvidiaApiKey(requestKey?: string): string | undefined {
    // Strictly isolate credentials: do not accept Google API keys (e.g. AIza...)
    if (requestKey?.trim() && !requestKey.trim().startsWith("AIza")) return requestKey.trim();
    if (process.env["NVIDIA_API_KEY"]) return process.env["NVIDIA_API_KEY"].trim();

    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const match = line.match(/^\s*NVIDIA_API_KEY\s*=\s*(.*?)\s*$/);
          if (match && match[1]) {
            return match[1].replace(/^["']|["']$/g, "").trim();
          }
        }
      }
    } catch {
      /* ignore env read error */
    }
    return undefined;
  }

  public async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const { operationId, conversationId, prompt } = req;

    if (!prompt || !prompt.trim()) {
      return {
        operationId,
        conversationId,
        status: "failed",
        imageGenerated: false,
        errorCode: "INVALID_PROMPT",
        errorMessage: "Please provide a description of the image you want to generate.",
      };
    }

    const apiKey = this.getNvidiaApiKey(req.apiKey);
    if (!apiKey) {
      return {
        operationId,
        conversationId,
        status: "failed",
        imageGenerated: false,
        errorCode: "MISSING_API_KEY",
        errorMessage: "NVIDIA API key is not configured. Set NVIDIA_API_KEY in the environment.",
      };
    }

    const width = req.width || 1024;
    const height = req.height || 1024;
    const seed = req.seed !== undefined ? req.seed : 0;
    const steps = req.steps || 4;

    // Clean box-drawing characters (e.g. │ from terminal copies)
    let cleanPrompt = prompt.replace(/[│┃|]/g, " ").replace(/\s+/g, " ").trim();

    // If user copied an entire chat response containing prompt + breakdown ("This prompt describes..."), extract the prompt
    const breakdownIndex = cleanPrompt.search(
      /\b(?:This prompt describes|Here's a breakdown|Subject and Pose:)\b/i,
    );
    if (breakdownIndex !== -1 && breakdownIndex > 30) {
      cleanPrompt = cleanPrompt
        .slice(0, breakdownIndex)
        .replace(/["“”]+$/g, "")
        .trim();
    }

    // Clean stray leading/trailing quotes
    cleanPrompt = cleanPrompt.replace(/^["“”]+|["“”]+$/g, "").trim();

    // Handle structured JSON prompts (e.g. from automated prompt generators)
    if (
      (cleanPrompt.startsWith("{") && cleanPrompt.includes('"scene"')) ||
      cleanPrompt.startsWith("Prompt: {")
    ) {
      try {
        const jsonStr = cleanPrompt.startsWith("Prompt: ")
          ? cleanPrompt.slice(8).trim()
          : cleanPrompt;
        const endBrace = jsonStr.lastIndexOf("}");
        if (endBrace !== -1) {
          const rawJson = jsonStr.slice(0, endBrace + 1);
          const trailingText = jsonStr.slice(endBrace + 1).trim();
          if (trailingText && trailingText.length > 50) {
            cleanPrompt = trailingText;
          } else {
            const parsed = JSON.parse(rawJson);
            const style = parsed.style || "";
            const subject = parsed.scene?.main_subject?.subject || "";
            const pose = parsed.scene?.main_subject?.pose || "";
            const outfit = Object.values(parsed.scene?.main_subject?.outfit || {}).join(", ");
            const loc = parsed.scene?.environment?.location || "";
            cleanPrompt = [style, subject, pose, outfit, loc].filter(Boolean).join(". ");
          }
        }
      } catch {
        /* keep original prompt */
      }
    }

    // Clean Midjourney / SD parameter flags like --ar 2:3, --v 6
    cleanPrompt = cleanPrompt
      .replace(/--ar\s+\d+:\d+/gi, "")
      .replace(/--(?:v|q|s|c|chaos|stylize|no|stop|repeat)\s+[\w.]+/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    // NVIDIA FLUX endpoint strictly enforces a maximum prompt length of 800 characters
    if (cleanPrompt.length > 790) {
      const truncated = cleanPrompt.slice(0, 790);
      const lastPunctuation = Math.max(
        truncated.lastIndexOf(". "),
        truncated.lastIndexOf(", "),
        truncated.lastIndexOf("; "),
      );
      if (lastPunctuation > 400) {
        cleanPrompt = truncated.slice(0, lastPunctuation + 1).trim();
      } else {
        const lastSpace = truncated.lastIndexOf(" ");
        cleanPrompt = (lastSpace > 400 ? truncated.slice(0, lastSpace) : truncated).trim();
      }
    }

    // Prepare payload (FLUX.2 Klein 4B strictly requires 1024x1024 or valid supported resolution; mode is only valid for editing)
    const payload: Record<string, unknown> = {
      prompt: cleanPrompt.slice(0, 790),
      width,
      height,
      seed,
      steps,
    };

    // If this is an image-editing request with existing image
    if (req.image) {
      let dataUri = req.image.trim();
      if (!dataUri.startsWith("data:")) {
        dataUri = `data:image/png;base64,${dataUri}`;
      }
      payload["image"] = dataUri;
      payload["mode"] = "Image Editing";
    }

    try {
      const resp = await fetch(this.endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(60000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        let errDetail = "";
        try {
          const errJson = await resp.json();
          if (typeof errJson === "string") {
            errDetail = errJson;
          } else if (errJson) {
            const detail = errJson.detail || errJson.message;
            if (typeof detail === "string") {
              errDetail = detail;
            } else if (Array.isArray(detail)) {
              errDetail = detail
                .map((d: any) => {
                  const loc = Array.isArray(d.loc) ? d.loc.join(".") : "";
                  const msg = d.msg || (typeof d === "string" ? d : JSON.stringify(d));
                  return loc ? `${loc}: ${msg}` : msg;
                })
                .join("; ");
            } else if (detail && typeof detail === "object") {
              errDetail = JSON.stringify(detail);
            } else {
              errDetail = JSON.stringify(errJson);
            }
          }
        } catch {
          errDetail = await resp.text().catch(() => "");
        }

        const errorCode =
          resp.status === 400
            ? "BAD_REQUEST"
            : resp.status === 401
              ? "UNAUTHORIZED"
              : resp.status === 403
                ? "FORBIDDEN"
                : resp.status === 429
                  ? "RATE_LIMITED"
                  : resp.status >= 500
                    ? "PROVIDER_ERROR"
                    : `PROVIDER_ERROR_${resp.status}`;

        return {
          operationId,
          conversationId,
          status: "failed",
          imageGenerated: false,
          errorCode,
          errorMessage:
            resp.status === 400
              ? "Image generation request was rejected. Please refine the prompt."
              : resp.status === 401
                ? "Image generation authentication failed. Please verify the NVIDIA API key."
                : resp.status === 403
                  ? "Access denied by image generation service. Please check API key permissions."
                  : resp.status === 429
                    ? "Image generation service is busy. Please try again shortly."
                    : `Image generation provider error (${resp.status}): ${errDetail.slice(0, 140)}`,
        };
      }

      const body = await resp.json().catch(() => null);
      if (!body) {
        return {
          operationId,
          conversationId,
          status: "failed",
          imageGenerated: false,
          errorCode: "INVALID_RESPONSE",
          errorMessage: "Provider returned an unparseable response.",
        };
      }

      // Check artifacts[0].base64 or b64_json
      const rawBase64 =
        body.artifacts?.[0]?.base64 ||
        body.artifacts?.[0]?.b64_json ||
        body.image ||
        body.data?.[0]?.b64_json;

      if (!rawBase64 || typeof rawBase64 !== "string") {
        return {
          operationId,
          conversationId,
          status: "failed",
          imageGenerated: false,
          errorCode: "NO_IMAGE_DATA",
          errorMessage: "Provider response did not contain valid image bytes.",
        };
      }

      const imageBuffer = Buffer.from(rawBase64, "base64");
      const validation = mediaStorageService.validateImageBuffer(imageBuffer);
      if (!validation.valid) {
        return {
          operationId,
          conversationId,
          status: "failed",
          imageGenerated: false,
          errorCode: "CORRUPT_IMAGE",
          errorMessage: "Decoded image data is corrupted or not a valid image format.",
        };
      }

      // Derive safe image name from prompt
      const safeName =
        prompt
          .trim()
          .replace(/^[^\w]+/, "")
          .slice(0, 40)
          .replace(/[^\w\s-]/g, "")
          .trim() || "generated-image";

      const fileName = `${safeName.replace(/\s+/g, "_")}.png`;
      const mimeType = validation.detectedMime || "image/png";

      // Persist to Media Storage Service
      try {
        const attachment = await mediaStorageService.saveMedia({
          conversationId,
          userId: req.userId,
          messageId: req.messageId,
          parentImageId: req.parentImageId,
          rootImageId: req.rootImageId,
          versionNumber: req.versionNumber || (req.parentImageId ? 2 : 1),
          versions: req.versions,
          model: "black-forest-labs/flux.2-klein-4b",
          width,
          height,
          fileName,
          mimeType,
          dataBase64: rawBase64,
          origin: "generated",
          prompt: prompt.trim(),
        });

        return {
          operationId,
          conversationId,
          status: "succeeded",
          imageGenerated: true,
          imageId: attachment.id,
          imageUrl: attachment.storageRef,
          dataUrl: attachment.dataUrl || `data:${mimeType};base64,${rawBase64}`,
          imageName: safeName,
        };
      } catch (storageErr) {
        return {
          operationId,
          conversationId,
          status: "failed",
          imageGenerated: false,
          errorCode: "STORAGE_ERROR",
          errorMessage: "Failed to persist generated image to storage.",
        };
      }
    } catch (err: unknown) {
      const errObj = err as Error;
      if (errObj?.name === "TimeoutError" || errObj?.name === "AbortError") {
        return {
          operationId,
          conversationId,
          status: "failed",
          imageGenerated: false,
          errorCode: "TIMEOUT",
          errorMessage: "Image generation request timed out after 60 seconds.",
        };
      }

      return {
        operationId,
        conversationId,
        status: "failed",
        imageGenerated: false,
        errorCode: "NETWORK_ERROR",
        errorMessage:
          (err as Error)?.message || "Failed to communicate with image generation service.",
      };
    }
  }

  public async editImage(req: ImageEditRequest): Promise<ImageEditResult> {
    const targetId = req.sourceImageId || req.parentImageId;
    let parentMedia: Awaited<ReturnType<typeof mediaStorageService.getMedia>> = null;
    if (targetId) {
      parentMedia = await mediaStorageService.getMedia(targetId);
    }

    const parentVersion = parentMedia?.versionNumber || 1;
    const newVersionNumber = parentVersion + 1;
    const rootImageId = parentMedia?.rootImageId || targetId;
    const parentPrompt = parentMedia?.originalPrompt || parentMedia?.fileName || "";

    // Synthesize prompt combining parent context and editing instruction
    let synthesizedPrompt = "";
    if (req.prompt && req.prompt.trim()) {
      synthesizedPrompt = req.prompt.trim();
    } else if (parentPrompt) {
      synthesizedPrompt = `${parentPrompt}. Modification: ${req.instruction.trim()}, preserve primary subject, ultra high resolution, clean finish`;
    } else {
      synthesizedPrompt = req.instruction.trim();
    }

    // Prepare image payload if available
    let imagePayload = req.image;
    if (!imagePayload && parentMedia?.dataBase64) {
      imagePayload = `data:${parentMedia.mimeType};base64,${parentMedia.dataBase64}`;
    }

    const priorVersions: ImageVersionNode[] = parentMedia
      ? [
          {
            id: parentMedia.id,
            versionNumber: parentVersion,
            url: `/api/media?id=${encodeURIComponent(parentMedia.id)}`,
            prompt: parentPrompt || "Original image",
            createdAt: parentMedia.createdAt || Date.now(),
          },
        ]
      : [];

    // Attempt generation with image payload
    let res = await this.generateImage({
      operationId: req.operationId,
      conversationId: req.conversationId,
      prompt: synthesizedPrompt,
      image: imagePayload,
      parentImageId: targetId,
      rootImageId,
      versionNumber: newVersionNumber,
      userId: req.userId,
      messageId: req.messageId,
      width: req.width,
      height: req.height,
      seed: req.seed,
      steps: req.steps,
      apiKey: req.apiKey,
    });

    // If endpoint rejects raw binary data with 422 or unsupported image editing mode, fallback gracefully to structured prompt synthesis
    if (
      !res.imageGenerated &&
      imagePayload &&
      (res.errorCode?.includes("422") ||
        res.errorCode === "BAD_REQUEST" ||
        res.errorMessage?.includes("example_id") ||
        res.errorMessage?.includes("mode") ||
        res.errorMessage?.includes("422"))
    ) {
      res = await this.generateImage({
        operationId: req.operationId,
        conversationId: req.conversationId,
        prompt: synthesizedPrompt,
        image: undefined, // Omit raw payload to avoid provider rejection
        parentImageId: targetId,
        rootImageId,
        versionNumber: newVersionNumber,
        userId: req.userId,
        messageId: req.messageId,
        width: req.width,
        height: req.height,
        seed: req.seed,
        steps: req.steps,
        apiKey: req.apiKey,
      });
    }

    if (res.imageGenerated && res.imageId && res.imageUrl) {
      const newVersionNode: ImageVersionNode = {
        id: res.imageId,
        versionNumber: newVersionNumber,
        url: res.imageUrl,
        prompt: req.instruction.trim(),
        createdAt: Date.now(),
        parentId: targetId,
      };

      const allVersions = [...priorVersions, newVersionNode];

      return {
        ...res,
        parentImageId: targetId,
        versionNumber: newVersionNumber,
        versions: allVersions,
      };
    }

    return {
      ...res,
      parentImageId: targetId,
      versionNumber: newVersionNumber,
      versions: priorVersions,
    };
  }
}

export const imageGenerationService = ImageGenerationService.getInstance();
