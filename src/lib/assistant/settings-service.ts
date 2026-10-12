import {
  type Settings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  syncSettingsToDb,
} from "./store";
import type { InteractionType, SessionLifecycleState } from "./session-types";

export interface SettingsSaveResult {
  success: boolean;
  version: number;
  appliedImmediately: boolean;
  error?: string;
}

export class SettingsService {
  private static instance: SettingsService;
  private currentSettings: Settings = DEFAULT_SETTINGS;
  private configVersion = 0;
  private activeSessionSettings: {
    sessionId: string;
    settings: Settings;
    version: number;
  } | null = null;
  private subscribers: Array<(s: Settings) => void> = [];

  private constructor() {
    this.currentSettings = this.load();
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  public load(userId?: string): Settings {
    const loaded = loadSettings(userId);
    this.currentSettings = this.validateAndNormalize(loaded);
    this.notify();
    return this.currentSettings;
  }

  public getSettings(): Settings {
    return { ...this.currentSettings };
  }

  public subscribe(fn: (s: Settings) => void): () => void {
    this.subscribers.push(fn);
    fn(this.getSettings());
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== fn);
    };
  }

  private notify() {
    const copy = this.getSettings();
    for (const sub of this.subscribers) {
      try {
        sub(copy);
      } catch (err) {
        console.error("Settings subscriber error:", err);
      }
    }
  }

  public validateAndNormalize(input: Partial<Settings>): Settings {
    const merged = { ...DEFAULT_SETTINGS, ...this.currentSettings, ...input };

    // 1. Clamping speaking rate
    if (typeof merged.rate === "number") {
      merged.rate = Math.max(0.5, Math.min(2.0, Number(merged.rate.toFixed(1))));
    } else {
      merged.rate = 1.0;
    }

    // 2. Chat model validation
    const validChatModels = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3.1-flash-lite"];
    if (!validChatModels.includes(merged.chatModel)) {
      merged.chatModel = DEFAULT_SETTINGS.chatModel;
    }

    // 3. Live voice validation
    const validLiveVoices = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Aoede"];
    if (!validLiveVoices.includes(merged.liveVoice)) {
      merged.liveVoice = DEFAULT_SETTINGS.liveVoice;
    }

    // 4. Camera facing validation
    if (merged.cameraFacing !== "user" && merged.cameraFacing !== "environment") {
      merged.cameraFacing = "environment";
    }

    // 5. Camera resolution validation
    if (merged.cameraResolution !== "720p" && merged.cameraResolution !== "1080p") {
      merged.cameraResolution = "720p";
    }

    // 6. Screen quality validation
    if (merged.screenQuality !== "standard" && merged.screenQuality !== "high") {
      merged.screenQuality = "standard";
    }

    // 7. API key sanitization (Google API Key and NVIDIA API key are tracked separately)
    merged.apiKey = typeof merged.apiKey === "string" ? merged.apiKey.trim() : "";
    merged.nvidiaApiKey = typeof merged.nvidiaApiKey === "string" ? merged.nvidiaApiKey.trim() : "";

    return merged;
  }

  public async updateSettings(
    patch: Partial<Settings>,
    activeState?: SessionLifecycleState,
    userId?: string,
  ): Promise<SettingsSaveResult> {
    const targetVersion = ++this.configVersion;
    const validated = this.validateAndNormalize(patch);
    this.currentSettings = validated;

    try {
      saveSettings(validated, userId);
      await syncSettingsToDb(patch);

      // Determine immediate vs deferred application according to exact change rules
      const appliedImmediately = this.checkIfAppliedImmediately(patch, activeState);

      this.notify();
      return {
        success: true,
        version: targetVersion,
        appliedImmediately,
      };
    } catch (err) {
      return {
        success: false,
        version: targetVersion,
        appliedImmediately: false,
        error: (err as Error)?.message || "Failed to persist settings",
      };
    }
  }

  public registerActiveSession(sessionId: string, settings: Settings) {
    this.activeSessionSettings = {
      sessionId,
      settings: { ...settings },
      version: this.configVersion,
    };
  }

  public clearActiveSession() {
    this.activeSessionSettings = null;
  }

  public getActiveSessionSnapshot() {
    return this.activeSessionSettings ? { ...this.activeSessionSettings } : null;
  }

  public checkIfAppliedImmediately(
    patch: Partial<Settings>,
    activeState?: SessionLifecycleState,
  ): boolean {
    const isLiveActive =
      activeState === "VOICE_ACTIVE" ||
      activeState === "VIDEO_ACTIVE" ||
      activeState === "SCREEN_SHARE_ACTIVE";

    // Speaking speed is applied live via AudioContext playbackRate
    if ("rate" in patch) {
      return true;
    }

    // Chat model applies to next text chat request
    if ("chatModel" in patch) {
      return true;
    }

    // If live is active, changing Live Voice or API key requires a fresh connection and is deferred
    if (isLiveActive && ("liveVoice" in patch || "apiKey" in patch)) {
      return false;
    }

    // Video settings: cameraResolution is deferred until next camera start
    if (activeState === "VIDEO_ACTIVE" && "cameraResolution" in patch) {
      return false;
    }

    return true;
  }
}

export const settingsService = SettingsService.getInstance();
