import fs from "node:fs";
import path from "node:path";

export interface MediaItem {
  id?: string;
  mimeType: string;
  dataBase64: string;
  fileName?: string;
}

export interface NvidiaMultimodalRequest {
  conversationId: string;
  mediaItems: MediaItem[];
  question: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  signal?: AbortSignal;
}

export class NvidiaMultimodalService {
  private static instance: NvidiaMultimodalService;
  private readonly endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";

  private constructor() {}

  public static getInstance(): NvidiaMultimodalService {
    if (!NvidiaMultimodalService.instance) {
      NvidiaMultimodalService.instance = new NvidiaMultimodalService();
    }
    return NvidiaMultimodalService.instance;
  }

  public getNvidiaApiKey(): string | undefined {
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

  public isConfigured(): boolean {
    return Boolean(this.getNvidiaApiKey());
  }

  public getImageModel(): string {
    return process.env["NVIDIA_VISION_MODEL"] || "meta/llama-3.2-11b-vision-instruct";
  }

  public getVideoModel(): string {
    return process.env["NVIDIA_VIDEO_MODEL"] || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
  }

  public async analyzeMediaStream(params: NvidiaMultimodalRequest): Promise<Response> {
    const apiKey = this.getNvidiaApiKey();
    if (!apiKey) {
      return Response.json(
        {
          error:
            "NVIDIA API key is not configured. Set NVIDIA_API_KEY on the backend to enable multimodal analysis.",
        },
        { status: 500 },
      );
    }

    const { mediaItems, question, history = [], signal } = params;
    const hasVideo = mediaItems.some((m) => m.mimeType.startsWith("video/"));
    const selectedModel = hasVideo ? this.getVideoModel() : this.getImageModel();

    // Construct messages payload for OpenAI-compatible chat completions
    const messages: Array<{ role: string; content: unknown }> = [];

    // System prompt
    const systemPrompt = hasVideo
      ? "You are an expert video understanding AI assistant. Analyze the provided video carefully, observe chronological events, audio cues if present, scene changes, actions, and objects, and answer the user's questions accurately and concisely."
      : "You are an expert visual understanding AI assistant. Analyze the provided images carefully, recognize details, text, objects, and relationships, and answer the user's questions directly and accurately.";

    messages.push({ role: "system", content: systemPrompt });

    // Prior conversation history (text-only turns for context)
    for (const h of history.slice(-6)) {
      if (h.text && h.text.trim()) {
        messages.push({
          role: h.role === "assistant" ? "assistant" : "user",
          content: h.text.trim(),
        });
      }
    }

    // User message with multimodal content items
    const contentParts: Array<Record<string, unknown>> = [];

    // Text query
    const promptText =
      question.trim() ||
      (hasVideo
        ? "Explain what happens in this video."
        : "Describe everything visible in this picture.");
    contentParts.push({ type: "text", text: promptText });

    // Multimodal attachments
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
      upstream = await fetch(this.endpoint, {
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

    // Parse SSE stream from NVIDIA and enqueue plain text chunks
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    let buffer = "";

    const textStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            // Process any remaining bytes
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
                  /* ignore partial chunk */
                }
              }
            }
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          // Keep incomplete line in buffer
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
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }
}

export const nvidiaMultimodalService = NvidiaMultimodalService.getInstance();
