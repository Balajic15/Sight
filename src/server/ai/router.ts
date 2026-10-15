import {
  type AIProvider,
  type TaskType,
  type AIRequestContext,
  type AIResult,
  validateRequestContext,
  DEFAULT_PROVIDER_MODELS,
} from "./contracts";
import { googleGeminiAdapter } from "./google-adapter";
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
  private readonly activeOperations = new Map<string, number>();
  private readonly OPERATION_TTL_MS = 120_000; // 2 minutes max operation lifetime

  private constructor() {
    // Periodic sweep to prevent orphaned operation ID memory leaks
    setInterval(() => {
      const now = Date.now();
      for (const [id, timestamp] of this.activeOperations.entries()) {
        if (now - timestamp > this.OPERATION_TTL_MS) {
          this.activeOperations.delete(id);
        }
      }
    }, 30_000).unref();
  }

  public static getInstance(): AIRouterService {
    return (this.instance ??= new AIRouterService());
  }

  public resolveRoute(params: {
    hasVideo?: boolean;
    hasImage?: boolean;
    hasFileText?: boolean;
    isImageGeneration?: boolean;
    preferredModel?: string;
  }): RouteResolution {
    if (params.isImageGeneration) {
      return {
        provider: "nvidia",
        model: DEFAULT_PROVIDER_MODELS.nvidia.image_generation!,
        taskType: "image_generation",
      };
    }

    if (params.hasVideo && nvidiaAdapter.isConfigured()) {
      return {
        provider: "nvidia",
        model: nvidiaAdapter.getVideoModel(),
        taskType: "video_understanding",
      };
    }

    if (params.hasImage && nvidiaAdapter.isConfigured()) {
      return {
        provider: "nvidia",
        model: nvidiaAdapter.getImageModel(),
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

    return {
      provider: "google",
      model: params.preferredModel || DEFAULT_PROVIDER_MODELS.google.text_chat!,
      taskType: "text_chat",
    };
  }

  public startOperation(context: AIRequestContext): { ok: boolean; error?: string } {
    const validation = validateRequestContext(context);
    if (!validation.valid) {
      return { ok: false, error: validation.error };
    }

    if (this.activeOperations.has(context.operationId)) {
      return {
        ok: false,
        error: `Duplicate operation: '${context.operationId}' is already running.`,
      };
    }

    this.activeOperations.set(context.operationId, Date.now());
    return { ok: true };
  }

  public endOperation(context: AIRequestContext): void {
    this.activeOperations.delete(context.operationId);
  }

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
      return result;
    } catch (err) {
      return {
        operationId: req.context.operationId,
        conversationId: req.context.conversationId,
        provider: req.context.provider,
        model: req.context.model,
        success: false,
        errorCode: "PROVIDER_ERROR",
        errorMessage: err instanceof Error ? err.message : "Image generation failed.",
      };
    } finally {
      this.endOperation(req.context);
    }
  }

  public async executeNvidiaMultimodalStream(req: NvidiaMultimodalRequest): Promise<Response> {
    const start = this.startOperation(req.context);
    if (!start.ok) {
      return Response.json({ error: start.error }, { status: 400 });
    }

    try {
      return await nvidiaAdapter.streamMultimodal(req);
    } finally {
      this.endOperation(req.context);
    }
  }
}

export const aiRouter = AIRouterService.getInstance();
