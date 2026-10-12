import {
  type AIProvider,
  type TaskType,
  type AIRequestContext,
  type AIResult,
  validateRequestContext,
  DEFAULT_PROVIDER_MODELS,
} from "./contracts";
import { googleGeminiAdapter, type GoogleChatRequest } from "./google-adapter";
import {
  nvidiaAdapter,
  type NvidiaImageGenerationRequest,
  type NvidiaMultimodalRequest,
} from "./nvidia-adapter";

export interface RouteResolution {
  provider: AIProvider;
  model: string;
  taskType: TaskType;
}

export class AIRouterService {
  private static instance: AIRouterService;
  private readonly activeOperations = new Set<string>();

  private constructor() {}

  public static getInstance(): AIRouterService {
    if (!AIRouterService.instance) {
      AIRouterService.instance = new AIRouterService();
    }
    return AIRouterService.instance;
  }

  /**
   * Determine the authoritative provider and model for a given request.
   */
  public resolveRoute(params: {
    hasVideo?: boolean | undefined;
    hasImage?: boolean | undefined;
    hasFileText?: boolean | undefined;
    isImageGeneration?: boolean | undefined;
    preferredModel?: string | undefined;
  }): RouteResolution {
    if (params.isImageGeneration) {
      return {
        provider: "nvidia",
        model: DEFAULT_PROVIDER_MODELS.nvidia.image_generation!,
        taskType: "image_generation",
      };
    }

    if (params.hasVideo) {
      return {
        provider: "nvidia",
        model: nvidiaAdapter.getVideoModel(),
        taskType: "video_understanding",
      };
    }

    if (params.hasImage) {
      // If NVIDIA is configured, route to NVIDIA vision model
      if (nvidiaAdapter.isConfigured()) {
        return {
          provider: "nvidia",
          model: nvidiaAdapter.getImageModel(),
          taskType: "image_understanding",
        };
      }
      // Otherwise fallback to Google Gemini vision
      return {
        provider: "google",
        model: params.preferredModel || DEFAULT_PROVIDER_MODELS.google.text_chat!,
        taskType: "image_understanding",
      };
    }

    if (params.hasFileText) {
      return {
        provider: "google",
        model: params.preferredModel || DEFAULT_PROVIDER_MODELS.google.file_understanding!,
        taskType: "file_understanding",
      };
    }

    // Default: normal text chat
    return {
      provider: "google",
      model: params.preferredModel || DEFAULT_PROVIDER_MODELS.google.text_chat!,
      taskType: "text_chat",
    };
  }

  /**
   * Validate context and register operation for idempotency.
   */
  public startOperation(context: AIRequestContext): { ok: boolean; error?: string | undefined } {
    const validation = validateRequestContext(context);
    if (!validation.valid) {
      return { ok: false, error: validation.error };
    }

    if (this.activeOperations.has(context.operationId)) {
      return {
        ok: false,
        error: `Duplicate operation: operationId '${context.operationId}' is already in progress.`,
      };
    }

    this.activeOperations.add(context.operationId);
    this.logOperation("STARTED", context);
    return { ok: true };
  }

  public endOperation(context: AIRequestContext, success: boolean, errorCode?: string | undefined) {
    this.activeOperations.delete(context.operationId);
    this.logOperation(success ? "COMPLETED" : "FAILED", context, errorCode);
  }

  public isOperationActive(operationId: string): boolean {
    return this.activeOperations.has(operationId);
  }

  /**
   * Execute Image Generation via authoritative NVIDIA adapter
   */
  public async executeImageGeneration(
    req: NvidiaImageGenerationRequest,
  ): Promise<AIResult<{ imageId: string; imageUrl: string; imageName: string; status: string }>> {
    const start = this.startOperation(req.context);
    if (!start.ok) {
      return {
        operationId: req.context.operationId,
        conversationId: req.context.conversationId,
        provider: req.context.provider,
        model: req.context.model,
        success: false,
        errorCode: "BAD_REQUEST",
        errorMessage: start.error,
      };
    }

    try {
      const result = await nvidiaAdapter.generateImage(req);
      this.endOperation(req.context, result.success, result.errorCode);
      return result;
    } catch (err: unknown) {
      this.endOperation(req.context, false, "PROVIDER_ERROR");
      return {
        operationId: req.context.operationId,
        conversationId: req.context.conversationId,
        provider: req.context.provider,
        model: req.context.model,
        success: false,
        errorCode: "PROVIDER_ERROR",
        errorMessage: (err as Error)?.message || "Image generation failed.",
      };
    }
  }

  /**
   * Execute Multimodal Streaming via authoritative NVIDIA adapter
   */
  public async executeNvidiaMultimodalStream(req: NvidiaMultimodalRequest): Promise<Response> {
    const start = this.startOperation(req.context);
    if (!start.ok) {
      return Response.json({ error: start.error }, { status: 400 });
    }

    try {
      const resp = await nvidiaAdapter.streamMultimodal(req);
      this.endOperation(req.context, resp.ok, resp.ok ? undefined : `HTTP_${resp.status}`);
      return resp;
    } catch (err: unknown) {
      this.endOperation(req.context, false, "NETWORK_ERROR");
      throw err;
    }
  }

  /**
   * Execute Chat Streaming via authoritative Google Gemini adapter
   */
  public async executeGoogleChatStream(req: GoogleChatRequest): Promise<Response> {
    const start = this.startOperation(req.context);
    if (!start.ok) {
      return Response.json({ error: start.error }, { status: 400 });
    }

    try {
      const resp = await googleGeminiAdapter.streamChat(req);
      this.endOperation(req.context, resp.ok, resp.ok ? undefined : `HTTP_${resp.status}`);
      return resp;
    } catch (err: unknown) {
      this.endOperation(req.context, false, "NETWORK_ERROR");
      throw err;
    }
  }

  private logOperation(status: string, context: AIRequestContext, errorCode?: string) {
    if (typeof process !== "undefined" && process.env && process.env["NODE_ENV"] === "test") return;
    const ts = new Date().toISOString();

    console.info(`[AIRouter ${ts}] ${status}`, {
      operationId: context.operationId,
      conversationId: context.conversationId,
      provider: context.provider,
      taskType: context.taskType,
      model: context.model,
      ...(errorCode ? { errorCode } : {}),
    });
  }
}

export const aiRouter = AIRouterService.getInstance();
