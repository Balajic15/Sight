import { LiveClient, type LiveState } from "./live-client";
import { type Settings, uid } from "./store";
import { cameraService } from "./camera-service";
import { screenShareService } from "./screen-share-service";
import { audioRecorder } from "./audio-recorder";
import { transcriptionService } from "./transcription-service";
import { settingsService } from "./settings-service";
import { sessionLatencyTracker } from "./session-latency";
import {
  type InteractionType,
  type SessionLifecycleState,
  type SessionContext,
  type SessionSnapshot,
  type TransitionRequest,
  type CleanupResult,
  type SessionEventEnvelope,
  type ConnectionStatus,
  type ResourceStatus,
  type AudioPlaybackStatus,
  type TranscriptionStatus,
  normalizeInteractionType,
} from "./session-types";

// Re-export types for consumers
export * from "./session-types";
export { sessionLatencyTracker } from "./session-latency";

// ============================================================================
// Explicit Allowed State Transitions Map
// ============================================================================

const ALLOWED_TRANSITIONS: Record<SessionLifecycleState, SessionLifecycleState[]> = {
  IDLE: ["SWITCHING", "CONNECTING", "STOPPING", "ERROR"],
  CONNECTING: [
    "CONNECTED",
    "VOICE_ACTIVE",
    "VIDEO_ACTIVE",
    "SCREEN_SHARE_ACTIVE",
    "SWITCHING",
    "STOPPING",
    "IDLE",
    "ERROR",
  ],
  CONNECTED: [
    "VOICE_ACTIVE",
    "VIDEO_ACTIVE",
    "SCREEN_SHARE_ACTIVE",
    "SWITCHING",
    "STOPPING",
    "IDLE",
    "RECONNECTING",
    "ERROR",
  ],
  VOICE_ACTIVE: [
    "VIDEO_ACTIVE",
    "SCREEN_SHARE_ACTIVE",
    "SWITCHING",
    "STOPPING",
    "IDLE",
    "RECONNECTING",
    "ERROR",
  ],
  VIDEO_ACTIVE: [
    "VOICE_ACTIVE",
    "SCREEN_SHARE_ACTIVE",
    "SWITCHING",
    "STOPPING",
    "IDLE",
    "RECONNECTING",
    "ERROR",
  ],
  SCREEN_SHARE_ACTIVE: [
    "VOICE_ACTIVE",
    "VIDEO_ACTIVE",
    "SWITCHING",
    "STOPPING",
    "IDLE",
    "RECONNECTING",
    "ERROR",
  ],
  SWITCHING: [
    "CONNECTING",
    "CONNECTED",
    "VOICE_ACTIVE",
    "VIDEO_ACTIVE",
    "SCREEN_SHARE_ACTIVE",
    "STOPPING",
    "IDLE",
    "ERROR",
  ],
  STOPPING: [
    "IDLE",
    "CONNECTING",
    "SWITCHING",
    "VOICE_ACTIVE",
    "VIDEO_ACTIVE",
    "SCREEN_SHARE_ACTIVE",
    "ERROR",
  ],
  RECONNECTING: [
    "CONNECTED",
    "VOICE_ACTIVE",
    "VIDEO_ACTIVE",
    "SCREEN_SHARE_ACTIVE",
    "STOPPING",
    "IDLE",
    "ERROR",
  ],
  ERROR: ["IDLE", "SWITCHING", "CONNECTING", "STOPPING"],
};

// ============================================================================
// Privacy-Safe Structured Logger
// ============================================================================

export function sessionLog(action: string, meta?: Record<string, unknown>) {
  if (typeof process !== "undefined" && process.env && process.env["NODE_ENV"] === "test") return;
  const timestamp = new Date().toISOString();
  const sanitized = meta ? { ...meta } : undefined;
  if (sanitized && "apiKey" in sanitized) delete sanitized["apiKey"];
  if (sanitized && "text" in sanitized) delete sanitized["text"];
  if (sanitized && "transcript" in sanitized) delete sanitized["transcript"];

  console.info(`[Session ${timestamp}] ${action}`, sanitized || "");
}

export interface SessionCallbacks {
  onUserTranscription?: (conversationId: string, text: string) => void;
  onAssistantTranscription?: (conversationId: string, text: string) => void;
  onText?: (conversationId: string, text: string) => void;
  onTurnComplete?: (conversationId: string) => void;
  onInterrupted?: (conversationId: string) => void;
  onError?: (conversationId: string, error: string) => void;
  onStateChange?: (context: SessionContext) => void;
}

// ============================================================================
// SessionManagerService (Authoritative Lifecycle Coordinator)
// ============================================================================

export class SessionManagerService {
  private static instance: SessionManagerService;

  private _context: SessionContext = {
    state: "IDLE",
    sessionId: uid(),
    conversationId: null,
    interactionType: null,
    transitionId: uid(),
    selectedConversationId: null,
    activeInteractionType: "none",
    connectionStatus: "disconnected",
    microphoneStatus: "idle",
    cameraStatus: "idle",
    screenCaptureStatus: "idle",
    audioPlaybackStatus: "idle",
    transcriptionStatus: "idle",
    currentSessionId: uid(),
    currentTransitionId: uid(),
    errorMessage: null,
  };

  private liveClient: LiveClient | null = null;
  private subscribers: Array<(context: SessionContext) => void> = [];
  private callbacks: SessionCallbacks = {};
  private videoElementGetter: (() => HTMLVideoElement | null) | null = null;

  private transitionAbortController: AbortController | null = null;
  private isTransitioning = false;
  private pendingTransitionId: string | null = null;

  private constructor() {
    this.setupLifecycleListeners();
    this.setupResourceListeners();
  }

  public static getInstance(): SessionManagerService {
    if (!SessionManagerService.instance) {
      SessionManagerService.instance = new SessionManagerService();
    }
    return SessionManagerService.instance;
  }

  public get context(): SessionContext {
    return this._context;
  }

  public getContext(): SessionContext {
    return this._context;
  }

  public getSnapshot(): SessionSnapshot {
    return {
      state: this._context.state,
      activeSessionId: this._context.sessionId,
      activeConversationId: this._context.conversationId,
      activeInteraction: this._context.interactionType,
      pendingTransitionId: this.pendingTransitionId,
      errorCode: this._context.errorMessage || null,
      connectionStatus: this._context.connectionStatus,
      microphoneStatus: this._context.microphoneStatus,
      cameraStatus: this._context.cameraStatus,
      screenCaptureStatus: this._context.screenCaptureStatus,
      audioPlaybackStatus: this._context.audioPlaybackStatus,
      transcriptionStatus: this._context.transcriptionStatus,
      isPaused: this._context.isPaused ?? false,
    };
  }

  public subscribe(fn: (context: SessionContext) => void): () => void {
    this.subscribers.push(fn);
    fn(this._context);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== fn);
    };
  }

  public setCallbacks(callbacks: SessionCallbacks) {
    this.callbacks = callbacks;
    transcriptionService.setCallbacks({
      onUserTranscription: (envelope) => {
        this.callbacks.onUserTranscription?.(envelope.conversationId, envelope.event);
      },
      onAssistantTranscription: (envelope) => {
        this.callbacks.onAssistantTranscription?.(envelope.conversationId, envelope.event);
      },
      onText: (envelope) => {
        this.callbacks.onText?.(envelope.conversationId, envelope.event);
      },
      onTurnComplete: (envelope) => {
        this.callbacks.onTurnComplete?.(envelope.conversationId);
      },
      onInterrupted: (envelope) => {
        this.callbacks.onInterrupted?.(envelope.conversationId);
      },
    });
  }

  public setVideoElementGetter(getter: () => HTMLVideoElement | null) {
    this.videoElementGetter = getter;
  }

  private notify() {
    for (const sub of this.subscribers) {
      try {
        sub(this._context);
      } catch (err) {
        console.error("Session subscriber error:", err);
      }
    }
    this.callbacks.onStateChange?.(this._context);
  }

  private transitionTo(
    nextState: SessionLifecycleState,
    updates?: Partial<SessionContext>,
  ): boolean {
    const currentState = this._context.state;
    if (currentState === nextState) {
      if (updates) {
        this._context = { ...this._context, ...updates };
        this.notify();
      }
      return true;
    }

    const allowed = ALLOWED_TRANSITIONS[currentState] || [];
    if (!allowed.includes(nextState)) {
      sessionLog(`Invalid transition rejected: ${currentState} -> ${nextState}`);
      return false;
    }

    this._context = {
      ...this._context,
      state: nextState,
      ...(updates || {}),
    };
    this.notify();
    return true;
  }

  // ============================================================================
  // Serialized Atomic Transition Coordination
  // ============================================================================

  public async switchInteraction(
    targetConversationIdOrRequest: string | TransitionRequest,
    targetTypeOrSettings?: InteractionType | Settings,
    settingsOrOptions?:
      Settings | { videoElement?: HTMLVideoElement | null; forceNewSession?: boolean },
    maybeOptions?: { videoElement?: HTMLVideoElement | null; forceNewSession?: boolean },
  ): Promise<boolean> {
    let targetConversationId: string;
    let targetType: InteractionType;
    let settings: Settings;
    let options: { videoElement?: HTMLVideoElement | null; forceNewSession?: boolean } | undefined;

    if (typeof targetConversationIdOrRequest === "object") {
      const req = targetConversationIdOrRequest as TransitionRequest;
      targetConversationId = req.conversationId;
      targetType = req.targetInteraction;
      settings = req.settings || ({} as Settings);
      options = req.options;
    } else {
      targetConversationId = targetConversationIdOrRequest;
      targetType = targetTypeOrSettings as InteractionType;
      settings = (settingsOrOptions as Settings) || ({} as Settings);
      options = maybeOptions;
    }

    const normalizedTarget = normalizeInteractionType(targetType);
    const transitionId = uid();
    this.pendingTransitionId = transitionId;

    sessionLog("Start serialized transition", {
      targetConversationId,
      normalizedTarget,
      transitionId,
    });

    // Abort previous in-flight transition
    if (this.transitionAbortController) {
      this.transitionAbortController.abort();
    }
    this.transitionAbortController = new AbortController();
    const { signal } = this.transitionAbortController;

    this.isTransitioning = true;
    this.transitionTo("SWITCHING", {
      currentTransitionId: transitionId,
      transitionId,
      errorMessage: null,
    });

    if (normalizedTarget !== "TEXT_CHAT") {
      const modeKey =
        normalizedTarget === "VIDEO"
          ? "video"
          : normalizedTarget === "SCREEN_SHARE"
            ? "screen"
            : "voice";
      sessionLatencyTracker.startSession(transitionId, modeKey);
    }

    try {
      const isSwitchingConversation =
        this._context.selectedConversationId !== null &&
        this._context.selectedConversationId !== targetConversationId;

      // 1. TEXT_CHAT / none: Shutdown realtime resources and transition to IDLE
      if (normalizedTarget === "TEXT_CHAT") {
        await this.performCleanup(false);
        if (signal.aborted) return false;

        this.transitionTo("IDLE", {
          selectedConversationId: targetConversationId,
          conversationId: targetConversationId,
          activeInteractionType: "none",
          interactionType: "TEXT_CHAT",
          connectionStatus: "disconnected",
        });
        this.pendingTransitionId = null;
        return true;
      }

      // 2. Different conversation: Full termination of outgoing session for isolation
      if (isSwitchingConversation || options?.forceNewSession) {
        await this.performCleanup(false);
      }

      if (signal.aborted) return false;

      // Reuse existing Live connection if compatible with conversation and connected
      const isAlreadyConnected =
        !isSwitchingConversation &&
        this.liveClient !== null &&
        this._context.connectionStatus === "connected";

      const sessionId = isAlreadyConnected ? this._context.currentSessionId : uid();
      this._context = {
        ...this._context,
        selectedConversationId: targetConversationId,
        conversationId: targetConversationId,
        currentSessionId: sessionId,
        sessionId,
      };

      // 3. Stop incompatible capture resources according to Resource Compatibility Table
      if (normalizedTarget !== "VIDEO" && cameraService.isActive()) {
        cameraService.stop();
        this._context = { ...this._context, cameraStatus: "idle" };
      }
      if (normalizedTarget !== "SCREEN_SHARE" && screenShareService.isActive()) {
        screenShareService.stop();
        this._context = { ...this._context, screenCaptureStatus: "idle" };
      }

      // 4. Connect Live Transport concurrently with media capture
      const livePromise = isAlreadyConnected
        ? Promise.resolve()
        : this.initializeLiveClient(settings, sessionId, targetConversationId, signal).then(() => {
            settingsService.registerActiveSession(sessionId, settings);
          });

      if (!isAlreadyConnected) {
        this.transitionTo("CONNECTING", { connectionStatus: "connecting" });
      }

      // 5. Initialize requested resource
      if (normalizedTarget === "VOICE") {
        await livePromise;
        if (signal.aborted) {
          return false;
        }

        this._context = {
          ...this._context,
          activeInteractionType: "voice",
          interactionType: "VOICE",
          microphoneStatus: "active",
        };
        this.transitionTo("VOICE_ACTIVE");
        sessionLatencyTracker.mark("session_ready");
      } else if (normalizedTarget === "VIDEO") {
        this._context = { ...this._context, cameraStatus: "requesting" };
        let stream: MediaStream | null = null;
        try {
          stream = await cameraService.start(settings);
          if (signal.aborted) {
            cameraService.stop();
            return false;
          }
          if (!stream) {
            throw new Error("Camera initialization failed");
          }

          const targetVideoEl =
            options?.videoElement || (this.videoElementGetter ? this.videoElementGetter() : null);
          if (targetVideoEl) {
            targetVideoEl.srcObject = stream;
            await targetVideoEl.play().catch(() => {});
          }

          this.startLiveVideoFeed();
          this._context = {
            ...this._context,
            activeInteractionType: "video",
            interactionType: "VIDEO",
            cameraStatus: "active",
          };
          this.transitionTo("VIDEO_ACTIVE");
          sessionLatencyTracker.mark("session_ready");

          // Await live assistant in background; if serverless/Vercel WebSocket fails,
          // do NOT kill the working camera feed
          livePromise.catch((liveErr) => {
            console.warn("[SessionManager] Live assistant connection warning in video mode:", liveErr);
            this.callbacks.onError?.(
              targetConversationId,
              "Live voice channel is offline on this server. Camera visual mode is active.",
            );
          });
        } catch (camErr) {
          if (signal.aborted) return false;
          cameraService.stop();
          this._context = { ...this._context, cameraStatus: "idle" };
          try {
            await livePromise;
          } catch {
            // ignore
          }
          if (this.liveClient && this._context.connectionStatus === "connected") {
            this._context = {
              ...this._context,
              activeInteractionType: "voice",
              interactionType: "VOICE",
              cameraStatus: "idle",
            };
            this.transitionTo("VOICE_ACTIVE");
            sessionLatencyTracker.mark("session_ready");
            this.callbacks.onError?.(
              targetConversationId,
              "Camera permission denied. Fell back to Voice mode.",
            );
            return false;
          }
          throw camErr;
        }
      } else if (normalizedTarget === "SCREEN_SHARE") {
        this._context = { ...this._context, screenCaptureStatus: "requesting" };
        let stream: MediaStream | null = null;
        try {
          stream = await screenShareService.start(settings);
          if (signal.aborted) {
            screenShareService.stop();
            return false;
          }
          if (!stream) {
            throw new Error("Screen sharing cancelled or failed");
          }

          // Await live assistant in background without killing screen sharing if WebSocket fails
          livePromise.catch((liveErr) => {
            console.warn("[SessionManager] Live assistant connection warning in screen share mode:", liveErr);
            this.callbacks.onError?.(
              targetConversationId,
              "Live voice channel is offline on this server. Screen visual mode is active.",
            );
          });

          const targetVideoEl =
            options?.videoElement || (this.videoElementGetter ? this.videoElementGetter() : null);
          if (targetVideoEl) {
            targetVideoEl.srcObject = stream;
            await targetVideoEl.play().catch(() => {});
          }

          this.startLiveVideoFeed();
          this._context = {
            ...this._context,
            activeInteractionType: "screen",
            interactionType: "SCREEN_SHARE",
            screenCaptureStatus: "active",
          };
          this.transitionTo("SCREEN_SHARE_ACTIVE");
          sessionLatencyTracker.mark("session_ready");
        } catch (screenErr) {
          if (signal.aborted) return false;
          try {
            await livePromise;
          } catch {
            // ignore
          }
          if (
            isAlreadyConnected &&
            this.liveClient &&
            this._context.connectionStatus === "connected"
          ) {
            screenShareService.stop();
            this._context = {
              ...this._context,
              activeInteractionType: "voice",
              interactionType: "VOICE",
              screenCaptureStatus: "idle",
            };
            this.transitionTo("VOICE_ACTIVE");
            sessionLatencyTracker.mark("session_ready");
            this.callbacks.onError?.(
              targetConversationId,
              "Screen sharing denied. Retained existing Voice session.",
            );
            return false;
          }

          await this.performCleanup(true);
          this.callbacks.onError?.(targetConversationId, "Screen sharing was cancelled or denied.");
          return false;
        }
      }

      sessionLog("Transition committed successfully", {
        targetConversationId,
        normalizedTarget,
        sessionId,
      });

      this.pendingTransitionId = null;
      return true;
    } catch (err) {
      if (signal.aborted) return false;

      const errorMsg = (err as Error)?.message || "Failed to start session";
      sessionLog("Transition failed", { error: errorMsg });

      await this.performCleanup(false);
      this.transitionTo("ERROR", {
        errorMessage: errorMsg,
        connectionStatus: "error",
      });

      this.callbacks.onError?.(targetConversationId, errorMsg);
      this.pendingTransitionId = null;
      return false;
    } finally {
      this.isTransitioning = false;
    }
  }

  // ============================================================================
  // Initialize Authoritative Live Transport
  // ============================================================================

  private initializeLiveClient(
    settings: Settings,
    sessionId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const onAbort = () => {
        if (!resolved) {
          resolved = true;
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }
      };

      if (signal?.aborted) {
        return resolve();
      }

      signal?.addEventListener("abort", onAbort);

      if (this.liveClient) {
        try {
          this.liveClient.disconnect();
        } catch {
          /* ignore */
        }
        this.liveClient = null;
      }

      const lc = new LiveClient({
        voice: settings.liveVoice || "Zephyr",
        apiKey: settings.apiKey,
        rate: settings.rate,
        onReady: () => {
          if (sessionId !== this._context.currentSessionId) return;
          this._context = { ...this._context, connectionStatus: "connected" };
          if (!resolved) {
            resolved = true;
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }
        },
        onStateChange: (st: LiveState) => {
          if (sessionId !== this._context.currentSessionId) return;

          if (st === "speaking") {
            this._context = { ...this._context, audioPlaybackStatus: "playing" };
          } else if (st === "listening") {
            this._context = { ...this._context, audioPlaybackStatus: "idle" };
          } else if (st === "connected") {
            this._context = {
              ...this._context,
              connectionStatus: "connected",
              audioPlaybackStatus: "idle",
            };
            if (!resolved) {
              resolved = true;
              signal?.removeEventListener("abort", onAbort);
              resolve();
            }
          } else if (st === "disconnected") {
            const isActive =
              this._context.state === "VOICE_ACTIVE" ||
              this._context.state === "VIDEO_ACTIVE" ||
              this._context.state === "SCREEN_SHARE_ACTIVE";
            if (isActive && !this.isTransitioning) {
              this.handleUnexpectedDisconnect(settings, sessionId, conversationId);
            } else {
              this._context = {
                ...this._context,
                connectionStatus: "disconnected",
                audioPlaybackStatus: "idle",
              };
              this.notify();
            }
          }
          this.notify();
        },
        onUserTranscription: (text) => {
          const envelope: SessionEventEnvelope<string> = {
            sessionId,
            conversationId,
            transitionId: this._context.currentTransitionId,
            event: text,
            timestamp: Date.now(),
          };
          const routed = transcriptionService.routeUserTranscription(
            envelope,
            this._context.currentSessionId,
            this._context.selectedConversationId,
          );
          if (routed) {
            this._context = { ...this._context, transcriptionStatus: "active" };
            this.notify();
          }
        },
        onAssistantTranscription: (text) => {
          const envelope: SessionEventEnvelope<string> = {
            sessionId,
            conversationId,
            transitionId: this._context.currentTransitionId,
            event: text,
            timestamp: Date.now(),
          };
          const routed = transcriptionService.routeAssistantTranscription(
            envelope,
            this._context.currentSessionId,
            this._context.selectedConversationId,
          );
          if (routed) {
            this._context = { ...this._context, transcriptionStatus: "active" };
            this.notify();
          }
        },
        onText: (text) => {
          const envelope: SessionEventEnvelope<string> = {
            sessionId,
            conversationId,
            transitionId: this._context.currentTransitionId,
            event: text,
            timestamp: Date.now(),
          };
          transcriptionService.routeText(
            envelope,
            this._context.currentSessionId,
            this._context.selectedConversationId,
          );
        },
        onTurnComplete: () => {
          const envelope: SessionEventEnvelope<void> = {
            sessionId,
            conversationId,
            transitionId: this._context.currentTransitionId,
            event: undefined,
            timestamp: Date.now(),
          };
          const routed = transcriptionService.routeTurnComplete(
            envelope,
            this._context.currentSessionId,
            this._context.selectedConversationId,
          );
          if (routed) {
            this._context = { ...this._context, transcriptionStatus: "idle" };
            this.notify();
          }
        },
        onInterrupted: () => {
          const envelope: SessionEventEnvelope<void> = {
            sessionId,
            conversationId,
            transitionId: this._context.currentTransitionId,
            event: undefined,
            timestamp: Date.now(),
          };
          const routed = transcriptionService.routeInterrupted(
            envelope,
            this._context.currentSessionId,
            this._context.selectedConversationId,
          );
          if (routed) {
            this._context = { ...this._context, audioPlaybackStatus: "interrupted" };
            this.notify();
          }
        },
        onError: (err) => {
          if (sessionId !== this._context.currentSessionId) return;
          if (!resolved) {
            resolved = true;
            signal?.removeEventListener("abort", onAbort);
            reject(new Error(err));
          } else {
            this.callbacks.onError?.(conversationId, err);
          }
        },
      });

      this.liveClient = lc;
      lc.connect({
        voice: settings.liveVoice || "Zephyr",
        apiKey: settings.apiKey,
        rate: settings.rate,
      });

      // Timeout safety: fail if connection takes more than 12 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          signal?.removeEventListener("abort", onAbort);
          reject(new Error("Connection to live assistant timed out"));
        }
      }, 12000);
    });
  }

  // ============================================================================
  // Reconnection and Recovery Logic
  // ============================================================================

  public async recoverSession(): Promise<void> {
    const convoId = this._context.selectedConversationId;
    if (!convoId) return;
    await this.handleUnexpectedDisconnect({} as Settings, this._context.currentSessionId, convoId);
  }

  private async handleUnexpectedDisconnect(
    settings: Settings,
    _oldSessionId: string,
    conversationId: string,
  ) {
    const previousState = this._context.state;
    sessionLog("Attempting connection recovery", {
      from: previousState,
      conversationId,
    });

    if (!this.transitionTo("RECONNECTING", { connectionStatus: "reconnecting" })) {
      return;
    }

    try {
      const newSessionId = uid();
      this._context = {
        ...this._context,
        currentSessionId: newSessionId,
        sessionId: newSessionId,
      };
      await this.initializeLiveClient(settings, newSessionId, conversationId);
      if (newSessionId !== this._context.currentSessionId) return;

      this.transitionTo("CONNECTED", { connectionStatus: "connected" });
      this.transitionTo(previousState);
      sessionLog("Connection recovery succeeded", { restoredState: previousState });
    } catch (err) {
      sessionLog("Connection recovery failed", { error: (err as Error)?.message });
      this.transitionTo("ERROR", {
        errorMessage: "Connection recovery failed",
        connectionStatus: "error",
      });
      this.callbacks.onError?.(conversationId, "Connection recovery failed.");
    }
  }

  private startLiveVideoFeed() {
    if (!this.liveClient) return;
    this.liveClient.startVideoStreaming(() => {
      if (this.videoElementGetter) {
        return this.videoElementGetter();
      }
      return null;
    });
  }

  // Delegated camera controls
  public async flipCamera(settings: Settings): Promise<boolean> {
    if (this._context.state !== "VIDEO_ACTIVE") return false;
    const v = this.videoElementGetter ? this.videoElementGetter() : null;
    return cameraService.flip(settings, v);
  }

  public async toggleTorch(): Promise<boolean> {
    return cameraService.toggleTorch();
  }

  public getTorchState(): boolean {
    return cameraService.getTorchState();
  }

  public getFacingMode(): "environment" | "user" {
    return cameraService.getFacingMode();
  }

  public setFacingMode(mode: "environment" | "user") {
    cameraService.setFacingMode(mode);
  }

  public getActiveStream(): MediaStream | null {
    return cameraService.getStream() || screenShareService.getStream() || null;
  }

  public setPlaybackRate(rate: number) {
    if (this.liveClient) {
      this.liveClient.playbackRate = rate;
    }
  }

  public pause(): boolean {
    if (this._context.state === "IDLE" || this._context.isPaused) return false;
    this._context = { ...this._context, isPaused: true };
    this.liveClient?.pause();
    cameraService.pause();
    screenShareService.pause();
    this.notify();
    return true;
  }

  public resume(): boolean {
    if (this._context.state === "IDLE" || !this._context.isPaused) return false;
    this._context = { ...this._context, isPaused: false };
    this.liveClient?.resume();
    cameraService.resume();
    screenShareService.resume();
    this.notify();
    return true;
  }

  public async restart(
    conversationId?: string,
    interactionType?: InteractionType,
    settings?: Settings,
  ): Promise<boolean> {
    const targetConvoId = conversationId || this._context.selectedConversationId || "default";
    const targetType = interactionType || this._context.activeInteractionType || "voice";
    const targetSettings = settings || settingsService.getSettings();

    // Cleanly stop any existing session and release all resources
    await this.stop();

    // Start fresh session with the target parameters
    return this.switchInteraction(targetConvoId, targetType, targetSettings);
  }

  // ============================================================================
  // Idempotent and Awaitable Cleanup Protocol
  // ============================================================================

  public async stop(): Promise<void> {
    await this.stopActiveSession("Stop requested by user");
  }

  public async stopActiveSession(_reason?: string): Promise<CleanupResult> {
    sessionLog("Stop requested", { reason: _reason });
    return this.performCleanup(true);
  }

  private async performCleanup(transitionToIdle = true): Promise<CleanupResult> {
    if (transitionToIdle && this.transitionAbortController) {
      this.transitionAbortController.abort();
      this.transitionAbortController = null;
    }

    sessionLog("Performing resource cleanup", {
      sessionId: this._context.currentSessionId,
    });

    if (transitionToIdle) {
      if (this._context.state !== "IDLE" && this._context.state !== "STOPPING") {
        this.transitionTo("STOPPING");
      }
    }

    const failedResources: string[] = [];

    // 1. Release camera via CameraService
    const camRes = cameraService.stop();
    if (!camRes.released) {
      failedResources.push("camera");
    }

    // 2. Release screen via ScreenShareService
    const screenRes = screenShareService.stop();
    if (!screenRes.released) {
      failedResources.push("screen");
    }

    // 3. Release any active voice dictation capture
    try {
      audioRecorder.release();
    } catch {
      /* ignore */
    }

    // 4. Disconnect Live Transport
    if (this.liveClient) {
      try {
        this.liveClient.disconnect();
      } catch (err) {
        console.error("LiveClient disconnect error:", err);
        failedResources.push("liveTransport");
      }
      this.liveClient = null;
    }
    settingsService.clearActiveSession();

    // 5. Reset statuses without clearing conversation messages
    this._context = {
      ...this._context,
      activeInteractionType: "none",
      interactionType: null,
      connectionStatus: "disconnected",
      microphoneStatus: "idle",
      cameraStatus: "idle",
      screenCaptureStatus: "idle",
      audioPlaybackStatus: "idle",
      transcriptionStatus: "idle",
      currentSessionId: uid(),
      sessionId: uid(),
      selectedConversationId: transitionToIdle ? null : this._context.selectedConversationId,
      conversationId: transitionToIdle ? null : this._context.conversationId,
      errorMessage: null,
      isPaused: false,
    };

    if (transitionToIdle) {
      this.transitionTo("IDLE");
    }

    return {
      completed: failedResources.length === 0,
      failedResources,
    };
  }

  // ============================================================================
  // Lifecycle Listeners
  // ============================================================================

  private setupResourceListeners() {
    cameraService.setOnTrackEnded(() => {
      if (this._context.state === "VIDEO_ACTIVE") {
        const convoId = this._context.selectedConversationId || "";
        this.switchInteraction(convoId, "voice", {} as Settings);
      }
    });

    screenShareService.setOnTrackEnded(() => {
      if (this._context.state === "SCREEN_SHARE_ACTIVE") {
        sessionLog("Screen sharing track ended, stopping session and microphone completely");
        void this.stop();
      }
    });
  }

  private setupLifecycleListeners() {
    if (typeof document === "undefined") return;

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        sessionLog("App moved to background, releasing hardware capture");
        if (this._context.state === "VIDEO_ACTIVE") {
          cameraService.stop();
          this._context = {
            ...this._context,
            activeInteractionType: "voice",
            interactionType: "VOICE",
            cameraStatus: "idle",
            screenCaptureStatus: "idle",
          };
          this.transitionTo("VOICE_ACTIVE");
        } else if (this._context.state === "SCREEN_SHARE_ACTIVE") {
          screenShareService.stop();
          this._context = {
            ...this._context,
            activeInteractionType: "voice",
            interactionType: "VOICE",
            cameraStatus: "idle",
            screenCaptureStatus: "idle",
          };
          this.transitionTo("VOICE_ACTIVE");
        }
      } else {
        sessionLog("App returned to foreground");
        if (this.liveClient && this._context.connectionStatus === "connected") {
          this.notify();
        }
      }
    });
  }
}

export const sessionManagerService = SessionManagerService.getInstance();
export const realtimeSessionService = sessionManagerService;
// Backwards compatible type alias
export const RealtimeSessionService = SessionManagerService;
