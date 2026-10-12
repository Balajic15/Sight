// ============================================================================
// Concrete Engineering Contracts and Session Lifecycle Models
// ============================================================================

export type InteractionType =
  | "TEXT_CHAT"
  | "VOICE"
  | "VIDEO"
  | "SCREEN_SHARE"
  // Backwards compatibility aliases
  | "none"
  | "chat"
  | "voice"
  | "video"
  | "screen";

export type SessionLifecycleState =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "VOICE_ACTIVE"
  | "VIDEO_ACTIVE"
  | "SCREEN_SHARE_ACTIVE"
  | "SWITCHING"
  | "STOPPING"
  | "RECONNECTING"
  | "ERROR";

// Backwards compatibility alias
export type SessionState = SessionLifecycleState;

export type ConnectionStatus =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export type ResourceStatus = "idle" | "requesting" | "active" | "error";

export type AudioPlaybackStatus = "idle" | "playing" | "interrupted";

export type TranscriptionStatus = "idle" | "active";

export interface SessionContext {
  state: SessionLifecycleState;
  sessionId: string;
  conversationId: string | null;
  interactionType: InteractionType | null;
  transitionId: string;
  selectedConversationId: string | null;
  activeInteractionType: InteractionType;
  connectionStatus: ConnectionStatus;
  microphoneStatus: ResourceStatus;
  cameraStatus: ResourceStatus;
  screenCaptureStatus: ResourceStatus;
  audioPlaybackStatus: AudioPlaybackStatus;
  transcriptionStatus: TranscriptionStatus;
  currentSessionId: string;
  currentTransitionId: string;
  errorMessage?: string | null;
  isPaused?: boolean | undefined;
}

export interface SessionSnapshot {
  state: SessionLifecycleState;
  activeSessionId: string | null;
  activeConversationId: string | null;
  activeInteraction: InteractionType | null;
  pendingTransitionId: string | null;
  errorCode: string | null;
  connectionStatus: ConnectionStatus;
  microphoneStatus: ResourceStatus;
  cameraStatus: ResourceStatus;
  screenCaptureStatus: ResourceStatus;
  audioPlaybackStatus: AudioPlaybackStatus;
  transcriptionStatus: TranscriptionStatus;
  isPaused?: boolean | undefined;
}

export interface TransitionRequest {
  conversationId: string;
  targetInteraction: InteractionType;
  reason: "USER_REQUEST" | "CONVERSATION_SWITCH" | "RECONNECT" | "CLEANUP";
  settings?: any;
  options?: {
    videoElement?: HTMLVideoElement | null;
    forceNewSession?: boolean;
  };
}

export interface CleanupResult {
  completed: boolean;
  failedResources: string[];
}

export interface SessionEventEnvelope<T = unknown> {
  sessionId: string;
  conversationId: string;
  transitionId: string;
  event: T;
  timestamp: number;
}

export function normalizeInteractionType(type: InteractionType): InteractionType {
  switch (type) {
    case "none":
    case "chat":
    case "TEXT_CHAT":
      return "TEXT_CHAT";
    case "voice":
    case "VOICE":
      return "VOICE";
    case "video":
    case "VIDEO":
      return "VIDEO";
    case "screen":
    case "SCREEN_SHARE":
      return "SCREEN_SHARE";
    default:
      return "TEXT_CHAT";
  }
}
