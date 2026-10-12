import fs from "node:fs";
import path from "node:path";
import type { AIRequestContext, AIResult } from "./contracts";
import { mediaStorageService } from "@/server/media-storage";

export interface NvidiaMediaItem {
  id?: string;
  mimeType: string;
  dataBase64: string;
  fileName?: string;
}

export interface NvidiaMultimodalRequest {
  context: AIRequestContext;
  mediaItems: NvidiaMediaItem[];
  question: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface NvidiaImageGenerationRequest {
  context: AIRequestContext;
  prompt: string;
  image?: string | undefined;
  parentImageId?: string | undefined;
  userId?: string | undefined;
  messageId?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  seed?: number | undefined;
  steps?: number | undefined;
  apiKey?: string | undefined;
}

export class NvidiaAdapter {
  private static instance: NvidiaAdapter;
  private readonly chatEndpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
  private readonly imageEndpoint =
    "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b";

  private constructor() {}

  public static getInstance(): NvidiaAdapter {
    if (!NvidiaAdapter.instance) {
      NvidiaAdapter.instance = new NvidiaAdapter();
    }
    return NvidiaAdapter.instance;
  }

  public getNvidiaApiKey(requestKey?: string): string | undefined {
    // Note: strictly ignore Google API keys if passed
    if (requestKey && requestKey.trim() && !requestKey.startsWith("AIza")) {
      return requestKey.trim();
    }
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
      /* ignore read errors */
    }
    return undefined;
  }

  public isConfigured(requestKey?: string): boolean {
    return Boolean(this.getNvidiaApiKey(requestKey));
  }

  public getImageModel(): string {
    return process.env["NVIDIA_VISION_MODEL"] || "meta/llama-3.2-11b-vision-instruct";
  }

  public getVideoModel(): string {
    return process.env["NVIDIA_VIDEO_MODEL"] || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
  }

  public async generateImage(
    req: NvidiaImageGenerationRequest,
  ): Promise<AIResult<{ imageId: string; imageUrl: string; imageName: string; status: string }>> {
    const { context, prompt } = req;

    if (!prompt || !prompt.trim()) {
      return {
        operationId: context.operationId,
        conversationId: context.conversationId,
        provider: "nvidia",
        model: context.model,
        success: false,
        errorCode: "BAD_REQUEST",
        errorMessage: "Please provide a description of the image you want to generate.",
      };
    }

    const apiKey = this.getNvidiaApiKey(req.apiKey);
    if (!apiKey) {
      return {
        operationId: context.operationId,
        conversationId: context.conversationId,
        provider: "nvidia",
        model: context.model,
        success: false,
        errorCode: "AUTHENTICATION_FAILED",
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

    const payload: Record<string, unknown> = {
      prompt: cleanPrompt.slice(0, 790),
      width,
      height,
      seed,
      steps,
    };

    if (req.image) {
      let dataUri = req.image.trim();
      if (!dataUri.startsWith("data:")) {
        dataUri = `data:image/png;base64,${dataUri}`;
      }
      payload["image"] = dataUri;
      payload["mode"] = "Image Editing";
    }

    try {
      const resp = await fetch(this.imageEndpoint, {
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
              ? "AUTHENTICATION_FAILED"
              : resp.status === 403
                ? "FORBIDDEN"
                : resp.status === 429
                  ? "RATE_LIMITED"
                  : "PROVIDER_ERROR";

        return {
          operationId: context.operationId,
          conversationId: context.conversationId,
          provider: "nvidia",
          model: context.model,
          success: false,
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
          operationId: context.operationId,
          conversationId: context.conversationId,
          provider: "nvidia",
          model: context.model,
          success: false,
          errorCode: "MALFORMED_RESPONSE",
          errorMessage: "Provider returned an unparseable response.",
        };
      }

      const rawBase64 =
        body.artifacts?.[0]?.base64 ||
        body.artifacts?.[0]?.b64_json ||
        body.image ||
        body.data?.[0]?.b64_json;

      if (!rawBase64 || typeof rawBase64 !== "string") {
        return {
          operationId: context.operationId,
          conversationId: context.conversationId,
          provider: "nvidia",
          model: context.model,
          success: false,
          errorCode: "MALFORMED_RESPONSE",
          errorMessage: "Provider response did not contain valid image bytes.",
        };
      }

      const cleanBase64 = rawBase64.replace(/^data:image\/[a-z]+;base64,/, "");
      const imageName = prompt.slice(0, 36).replace(/[^a-zA-Z0-9_-]/g, "_") || "generated_image";
      const fileName = `${imageName}.png`;

      const saved = await mediaStorageService.saveMedia({
        conversationId: context.conversationId,
        userId: req.userId,
        messageId: req.messageId,
        parentImageId: req.parentImageId,
        model: context.model,
        width,
        height,
        fileName,
        mimeType: "image/png",
        dataBase64: cleanBase64,
        origin: "generated",
        prompt: prompt.trim(),
      });

      return {
        operationId: context.operationId,
        conversationId: context.conversationId,
        provider: "nvidia",
        model: context.model,
        success: true,
        data: {
          imageId: saved.id,
          imageUrl: `/api/media?id=${saved.id}`,
          imageName: fileName,
          status: "succeeded",
        },
      };
    } catch (err: unknown) {
      const errObj = err as Error;
      return {
        operationId: context.operationId,
        conversationId: context.conversationId,
        provider: "nvidia",
        model: context.model,
        success: false,
        errorCode: errObj?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
        errorMessage: `Failed to connect to image generation service: ${errObj?.message || "Unknown error"}`,
      };
    }
  }

  public async streamMultimodal(params: NvidiaMultimodalRequest): Promise<Response> {
    const apiKey = this.getNvidiaApiKey(params.apiKey);
    if (!apiKey) {
      return Response.json(
        {
          error:
            "NVIDIA API key is not configured. Set NVIDIA_API_KEY on the backend to enable multimodal analysis.",
        },
        { status: 500 },
      );
    }

    const { context, mediaItems, question, history = [], signal } = params;
    const hasVideo = mediaItems.some((m) => m.mimeType.startsWith("video/"));
    const selectedModel = context.model || (hasVideo ? this.getVideoModel() : this.getImageModel());

    // Validate payload against model capabilities
    if (hasVideo && !selectedModel.includes("nemotron") && !selectedModel.includes("video")) {
      return Response.json(
        {
          error: `Model '${selectedModel}' does not support video understanding. Use '${this.getVideoModel()}'.`,
        },
        { status: 400 },
      );
    }

    const messages: Array<{ role: string; content: unknown }> = [];

    const systemPrompt = hasVideo
      ? "You are an expert video understanding AI assistant. Analyze the provided video carefully, observe chronological events, audio cues if present, scene changes, actions, and objects, and answer the user's questions accurately and concisely."
      : "You are an expert visual understanding AI assistant. Analyze the provided images carefully, recognize details, text, objects, and relationships, and answer the user's questions directly and accurately.";

    messages.push({ role: "system", content: systemPrompt });

    for (const h of history.slice(-6)) {
      if (h.text && h.text.trim()) {
        messages.push({
          role: h.role === "assistant" ? "assistant" : "user",
          content: h.text.trim(),
        });
      }
    }

    const contentParts: Array<Record<string, unknown>> = [];
    const promptText =
      question.trim() ||
      (hasVideo
        ? "Explain what happens in this video."
        : "Describe everything visible in this picture.");
    contentParts.push({ type: "text", text: promptText });

    for (const item of mediaItems) {
      let cleanBase64 = item.dataBase64.trim();
      if (cleanBase64.startsWith("data:")) {
        const parts = cleanBase64.split(",");
        cleanBase64 = parts[1] || cleanBase64;
      }

      if (item.mimeType.startsWith("video/")) {
        contentParts.push({
          type: "video_url",
          video_url: {
            url: `data:${item.mimeType};base64,${cleanBase64}`,
          },
        });
      } else {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:${item.mimeType};base64,${cleanBase64}`,
          },
        });
      }
    }

    messages.push({ role: "user", content: contentParts });

    const payload = {
      model: selectedModel,
      messages,
      max_tokens: 2048,
      temperature: 0.2,
      stream: true,
    };

    let upstream: Response;
    try {
      upstream = await fetch(this.chatEndpoint, {
        method: "POST",
        ...(signal ? { signal } : {}),
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      const errObj = err as Error;
      if (errObj?.name === "AbortError" || signal?.aborted) {
        return new Response(null, { status: 499 });
      }
      return Response.json(
        {
          error: `Network error connecting to NVIDIA multimodal service: ${errObj?.message || "Unknown"}`,
        },
        { status: 502 },
      );
    }

    if (!upstream.ok || !upstream.body) {
      let errDetail = "";
      try {
        const errJson = await upstream.json();
        errDetail = errJson.message || errJson.detail || JSON.stringify(errJson);
      } catch {
        errDetail = await upstream.text().catch(() => "");
      }

      const status = upstream.status;
      const errorMsg =
        status === 400
          ? `NVIDIA multimodal model rejected the input (${selectedModel}): ${errDetail.slice(0, 160) || "Invalid media format or size."}`
          : status === 401
            ? "NVIDIA API authentication failed. Please verify NVIDIA_API_KEY."
            : status === 403
              ? `Access to NVIDIA model ${selectedModel} is forbidden. Please check model permissions.`
              : status === 429
                ? "NVIDIA multimodal service is rate limited. Please try again shortly."
                : `NVIDIA multimodal provider error (${status}): ${errDetail.slice(0, 160) || "Service unavailable."}`;

      return Response.json({ error: errorMsg }, { status });
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    let buffer = "";

    const textStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              const lines = buffer.split(/\r?\n/);
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === "[DONE]") continue;
                try {
                  const json = JSON.parse(dataStr);
                  const text = json.choices?.[0]?.delta?.content || "";
                  if (text) controller.enqueue(encoder.encode(text));
                } catch {
                  /* ignore incomplete chunk */
                }
              }
            }
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === "[DONE]") continue;
            try {
              const json = JSON.parse(dataStr);
              const text =
                json.choices?.[0]?.delta?.content ||
                json.choices?.[0]?.delta?.reasoning_content ||
                "";
              if (text) {
                controller.enqueue(encoder.encode(text));
              }
            } catch {
              /* ignore incomplete chunk */
            }
          }
        } catch (err: unknown) {
          const errObj = err as Error;
          if (errObj?.name === "AbortError" || signal?.aborted) {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
            return;
          }
          controller.error(err);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(textStream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-cache, no-transform, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
}

export const nvidiaAdapter = NvidiaAdapter.getInstance();
