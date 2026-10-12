export type AttachmentOrigin = "generated" | "uploaded";

export interface ImageVersionNode {
  id: string;
  versionNumber: number;
  url: string;
  prompt: string;
  createdAt: number;
  parentId?: string | undefined;
}

export interface ChatAttachment {
  id: string;
  conversationId: string;
  messageId?: string | undefined;
  userId?: string | undefined;
  parentImageId?: string | undefined;
  rootImageId?: string | undefined;
  versionNumber?: number | undefined;
  aspectRatio?: string | undefined;
  versions?: ImageVersionNode[] | undefined;
  origin: AttachmentOrigin;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | undefined;
  height?: number | undefined;
  model?: string | undefined;
  storageRef: string;
  dataUrl?: string | undefined;
  status: "uploading" | "processing" | "ready" | "failed";
  extractedText?: string | undefined;
  prompt?: string | undefined;
  createdAt?: number | undefined;
}

export type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  image?: string | undefined;
  source?: "camera" | "screen" | undefined;
  attachments?: ChatAttachment[] | undefined;
  generatingImage?: boolean | undefined;
  generationFailed?: boolean | undefined;
  imagePrompt?: string | undefined;
  operationId?: string | undefined;
  requiresDisambiguation?: boolean | undefined;
  candidateImages?: Array<{ id: string; url: string; prompt: string }> | undefined;
};
export type Conversation = { id: string; title: string; updatedAt: number; messages: Msg[] };
export type Settings = {
  chatModel: string;
  speak: boolean;
  autoVision: boolean;
  voiceURI: string;
  rate: number;
  handsFree: boolean;
  liveVoice: string;
  cameraFacing: "environment" | "user";
  cameraResolution: "720p" | "1080p";
  screenQuality: "standard" | "high";
  apiKey: string;
  nvidiaApiKey?: string;
};

export const DEFAULT_SETTINGS: Settings = {
  chatModel: "gemini-2.5-flash-lite",
  speak: false,
  autoVision: true,
  voiceURI: "",
  rate: 1.0,
  handsFree: false,
  liveVoice: "Zephyr",
  cameraFacing: "environment",
  cameraResolution: "720p",
  screenQuality: "standard",
  apiKey: "",
  nvidiaApiKey: "",
};

import { authService } from "./auth-service";

const CK = "echo.conversations.v1";
const SK = "echo.settings.v1";

function getConversationsStorageKey(userId?: string): string {
  const effectiveUserId = userId || authService.getUserId();
  return effectiveUserId ? `${CK}.${effectiveUserId}` : CK;
}

function getSettingsStorageKey(userId?: string): string {
  const effectiveUserId = userId || authService.getUserId();
  return effectiveUserId ? `${SK}.${effectiveUserId}` : SK;
}

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function loadConversations(userId?: string): Conversation[] {
  try {
    const key = getConversationsStorageKey(userId);
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
    // Fallback to legacy key only if unauthenticated
    if (!userId && !authService.getUserId()) {
      return JSON.parse(localStorage.getItem(CK) || "[]");
    }
    return [];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[], userId?: string) {
  const key = getConversationsStorageKey(userId);
  // Strip images to keep storage small.
  const slim = list
    .slice(0, 50)
    .map((c) => ({ ...c, messages: c.messages.map(({ image: _i, ...m }) => m) }));
  try {
    localStorage.setItem(key, JSON.stringify(slim));
  } catch {
    // Quota exceeded: try persisting fewer recent conversations
    try {
      localStorage.setItem(key, JSON.stringify(slim.slice(0, 20)));
    } catch {
      /* quota exceeded */
    }
  }
}

export function loadSettings(userId?: string): Settings {
  try {
    const key = getSettingsStorageKey(userId);
    let loaded = JSON.parse(localStorage.getItem(key) || "{}");
    if (Object.keys(loaded).length === 0 && (userId || authService.getUserId())) {
      // Fallback read from baseline settings if user doesn't have custom settings yet
      loaded = JSON.parse(localStorage.getItem(SK) || "{}");
    }
    const apiKey = typeof loaded.apiKey === "string" ? loaded.apiKey.trim() : "";
    return {
      ...DEFAULT_SETTINGS,
      ...loaded,
      chatModel:
        typeof loaded.chatModel === "string" && loaded.chatModel
          ? loaded.chatModel
          : DEFAULT_SETTINGS.chatModel,
      speak: typeof loaded.speak === "boolean" ? loaded.speak : DEFAULT_SETTINGS.speak,
      autoVision:
        typeof loaded.autoVision === "boolean" ? loaded.autoVision : DEFAULT_SETTINGS.autoVision,
      handsFree:
        typeof loaded.handsFree === "boolean" ? loaded.handsFree : DEFAULT_SETTINGS.handsFree,
      rate: typeof loaded.rate === "number" ? Math.max(0.5, Math.min(2.0, loaded.rate)) : 1.0,
      liveVoice:
        typeof loaded.liveVoice === "string" && loaded.liveVoice ? loaded.liveVoice : "Zephyr",
      voiceURI: typeof loaded.voiceURI === "string" ? loaded.voiceURI : "",
      cameraFacing:
        loaded.cameraFacing === "user" || loaded.cameraFacing === "environment"
          ? loaded.cameraFacing
          : DEFAULT_SETTINGS.cameraFacing,
      cameraResolution:
        loaded.cameraResolution === "1080p" ? "1080p" : DEFAULT_SETTINGS.cameraResolution,
      screenQuality: loaded.screenQuality === "high" ? "high" : DEFAULT_SETTINGS.screenQuality,
      apiKey,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, userId?: string) {
  try {
    const key = getSettingsStorageKey(userId);
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* quota or security error */
  }
}

export async function fetchConversationsFromDb(): Promise<Conversation[]> {
  try {
    const res = await authService.fetchWithAuth("/api/conversations");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function syncConversationToDb(conv: Conversation): Promise<void> {
  try {
    const slim = {
      ...conv,
      messages: conv.messages.map(({ image: _i, ...m }) => m),
    };
    await authService.fetchWithAuth("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slim),
    });
  } catch {
    /* offline / network error */
  }
}

export async function deleteConversationFromDbRemote(id: string): Promise<void> {
  try {
    await authService.fetchWithAuth(`/api/conversations?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch {
    /* offline / network error */
  }
}

export async function clearAllConversationsFromDbRemote(): Promise<void> {
  try {
    await authService.fetchWithAuth("/api/conversations?all=true", {
      method: "DELETE",
    });
  } catch {
    /* offline / network error */
  }
}

export async function fetchSettingsFromDb(): Promise<Partial<Settings> | null> {
  try {
    const res = await authService.fetchWithAuth("/api/settings");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function syncSettingsToDb(settings: Partial<Settings>): Promise<void> {
  try {
    await authService.fetchWithAuth("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
  } catch {
    /* offline / network error */
  }
}
