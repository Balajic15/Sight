import type { AIRequestContext, AIResult } from "./contracts";

export interface NvidiaImageGenerationRequest {
  context: AIRequestContext;
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  apiKey?: string;
}

export interface NvidiaMultimodalRequest {
  context: AIRequestContext;
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
  apiKey?: string;
}

export class NvidiaAdapter {
  private static instance: NvidiaAdapter;
  private readonly defaultImageModel = "black-forest-labs/flux.2-klein-4b";
  private readonly defaultVideoModel = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
  private readonly defaultVisionModel = "meta/llama-3.2-11b-vision-instruct";

  public static getInstance(): NvidiaAdapter {
    if (!NvidiaAdapter.instance) {
      NvidiaAdapter.instance = new NvidiaAdapter();
    }
    return NvidiaAdapter.instance;
  }

  public isConfigured(): boolean {
    return Boolean(process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY);
  }

  public getImageModel(): string {
    return this.defaultVisionModel;
  }

  public getVideoModel(): string {
    return this.defaultVideoModel;
  }

  private getApiKey(override?: string): string {
    const key = override || process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY;
    if (!key) throw new Error("Missing NVIDIA API key in environment or request.");
    return key;
  }

  public async generateImage(
    req: NvidiaImageGenerationRequest,
  ): Promise<AIResult<{ imageId: string; imageUrl: string; imageName: string; status: string }>> {
    const apiKey = this.getApiKey(req.apiKey);
    const model = req.context.model || this.defaultImageModel;

    const response = await fetch("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        prompt: req.prompt,
        width: req.width || 1024,
        height: req.height || 1024,
        seed: req.seed,
        steps: req.steps || 4,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        operationId: req.context.operationId,
        conversationId: req.context.conversationId,
        provider: "nvidia",
        model,
        success: false,
        errorCode: `HTTP_${response.status}`,
        errorMessage: errText || "NVIDIA NIM image generation failed.",
      };
    }

    const data = (await response.json()) as { artifacts?: Array<{ base64?: string }> };
    const b64 = data.artifacts?.[0]?.base64;
    if (!b64) {
      return {
        operationId: req.context.operationId,
        conversationId: req.context.conversationId,
        provider: "nvidia",
        model,
        success: false,
        errorCode: "MALFORMED_RESPONSE",
        errorMessage: "No image artifact returned from NVIDIA API.",
      };
    }

    return {
      operationId: req.context.operationId,
      conversationId: req.context.conversationId,
      provider: "nvidia",
      model,
      success: true,
      data: {
        imageId: `img_${Date.now()}`,
        imageUrl: `data:image/jpeg;base64,${b64}`,
        imageName: `gen_${Date.now()}.jpg`,
        status: "completed",
      },
    };
  }

  public async streamMultimodal(req: NvidiaMultimodalRequest): Promise<Response> {
    const apiKey = this.getApiKey(req.apiKey);
    const model = req.context.model || this.defaultVisionModel;

    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: req.messages,
        stream: true,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: err }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
}

export const nvidiaAdapter = NvidiaAdapter.getInstance();
