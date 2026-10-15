export type AIProvider = "google" | "nvidia";

export type TaskType =
  | "text_chat"
  | "realtime_voice"
  | "image_generation"
  | "image_understanding"
  | "video_understanding"
  | "file_understanding";

export interface AIRequestContext {
  operationId: string;
  conversationId: string;
  taskType: TaskType;
  provider: AIProvider;
  model: string;
  sessionId?: string;
}

export interface AIResult<T = unknown> {
  operationId: string;
  conversationId: string;
  provider: AIProvider;
  model: string;
  success: boolean;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
}

export type AIStreamEvent =
  | { type: "text_delta"; operationId: string; text: string }
  | { type: "completed"; operationId: string }
  | { type: "failed"; operationId: string; errorCode: string; errorMessage: string }
  | { type: "media_ready"; operationId: string; mediaId: string; mediaUrl?: string };

export const SUPPORTED_PROVIDER_TASKS: Record<AIProvider, readonly TaskType[]> = {
  google: ["text_chat", "file_understanding", "realtime_voice", "image_understanding"],
  nvidia: ["image_generation", "image_understanding", "video_understanding"],
} as const;

export const DEFAULT_PROVIDER_MODELS: Record<AIProvider, Partial<Record<TaskType, string>>> = {
  google: {
    text_chat: "gemini-2.5-flash-lite",
    file_understanding: "gemini-2.5-flash-lite",
    realtime_voice: "models/gemini-3.1-flash-live-preview",
    image_understanding: "gemini-2.5-flash-lite",
  },
  nvidia: {
    image_generation: "black-forest-labs/flux.2-klein-4b",
    image_understanding: "meta/llama-3.2-11b-vision-instruct",
    video_understanding: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  },
};

export function validateRequestContext(ctx: AIRequestContext): { valid: boolean; error?: string } {
  if (!ctx.operationId?.trim()) return { valid: false, error: "Missing required operationId." };
  if (!ctx.conversationId?.trim()) return { valid: false, error: "Missing required conversationId." };
  if (ctx.provider !== "google" && ctx.provider !== "nvidia") {
    return { valid: false, error: `Unsupported AI provider: ${ctx.provider}` };
  }
  const supported = SUPPORTED_PROVIDER_TASKS[ctx.provider];
  if (!supported.includes(ctx.taskType)) {
    return { valid: false, error: `Provider '${ctx.provider}' does not support '${ctx.taskType}'` };
  }
  return { valid: true };
}
