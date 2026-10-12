/**
 * Session Latency Instrumentation
 * Measures privacy-safe startup and interaction timings across Voice, Video, and Screen Share modes.
 * Strictly avoids logging raw speech, audio samples, screen images, or API credentials.
 */

export type LatencyEventName =
  | "feature_click"
  | "permission_requested"
  | "permission_granted"
  | "audio_capture_ready"
  | "camera_ready"
  | "screen_capture_ready"
  | "credentials_ready"
  | "realtime_connection_started"
  | "realtime_connection_established"
  | "session_configuration_complete"
  | "first_audio_chunk_sent"
  | "first_user_transcription_received"
  | "first_model_response_received"
  | "first_audio_playback_started"
  | "session_ready";

export interface SessionLatencyRecord {
  sessionId: string;
  mode: "voice" | "video" | "screen" | "text";
  timestamps: Partial<Record<LatencyEventName, number>>;
  calculations: LatencyCalculations;
  metrics: LatencyCalculations;
}

export interface LatencyCalculations {
  clickToMicReadyMs: number | null;
  clickToSessionReadyMs: number | null;
  firstSpeechToTranscriptionMs: number | null;
  endOfTurnToFirstResponseMs: number | null;
  firstResponseToPlaybackMs: number | null;
}

export class SessionLatencyTracker {
  private static instance: SessionLatencyTracker;
  private currentSessionId: string | null = null;
  private currentMode: "voice" | "video" | "screen" | "text" = "voice";
  private timestamps: Partial<Record<LatencyEventName, number>> = {};
  private sessionHistory: SessionLatencyRecord[] = [];

  private constructor() {}

  public static getInstance(): SessionLatencyTracker {
    if (!SessionLatencyTracker.instance) {
      SessionLatencyTracker.instance = new SessionLatencyTracker();
    }
    return SessionLatencyTracker.instance;
  }

  public startSession(
    sessionId: string,
    mode: "voice" | "video" | "screen" | "text",
    timestamp?: number,
  ) {
    this.currentSessionId = sessionId;
    this.currentMode = mode;
    this.timestamps = {};
    this.mark("feature_click", timestamp, true);
  }

  public mark(event: LatencyEventName, timestamp: number = performance.now(), force = false): void {
    if (force || !this.timestamps[event]) {
      this.timestamps[event] = timestamp;
      this.evaluateEvent(event);
    }
  }

  private evaluateEvent(event: LatencyEventName) {
    if (event === "session_ready" || event === "first_audio_playback_started") {
      this.snapshot();
    }
  }

  public getCalculations(): LatencyCalculations {
    const t = this.timestamps;
    const click = t.feature_click ?? null;
    const mic = t.audio_capture_ready ?? null;
    const session = t.session_ready ?? null;
    const firstAudio = t.first_audio_chunk_sent ?? null;
    const userTranscript = t.first_user_transcription_received ?? null;
    const modelResp = t.first_model_response_received ?? null;
    const playback = t.first_audio_playback_started ?? null;

    return {
      clickToMicReadyMs:
        click !== null && mic !== null ? Math.max(0, Math.round(mic - click)) : null,
      clickToSessionReadyMs:
        click !== null && session !== null ? Math.max(0, Math.round(session - click)) : null,
      firstSpeechToTranscriptionMs:
        firstAudio !== null && userTranscript !== null
          ? Math.max(0, Math.round(userTranscript - firstAudio))
          : null,
      endOfTurnToFirstResponseMs:
        firstAudio !== null && modelResp !== null
          ? Math.max(0, Math.round(modelResp - firstAudio))
          : null,
      firstResponseToPlaybackMs:
        modelResp !== null && playback !== null
          ? Math.max(0, Math.round(playback - modelResp))
          : null,
    };
  }

  public snapshot(): SessionLatencyRecord | null {
    if (!this.currentSessionId) return null;
    const calcs = this.getCalculations();
    const record: SessionLatencyRecord = {
      sessionId: this.currentSessionId,
      mode: this.currentMode,
      timestamps: { ...this.timestamps },
      calculations: calcs,
      metrics: calcs,
    };

    const existingIdx = this.sessionHistory.findIndex((r) => r.sessionId === this.currentSessionId);
    if (existingIdx !== -1) {
      this.sessionHistory[existingIdx] = record;
    } else {
      this.sessionHistory.push(record);
      if (this.sessionHistory.length > 20) {
        this.sessionHistory.shift();
      }
    }
    return record;
  }

  public getRecords(): SessionLatencyRecord[] {
    return [...this.sessionHistory];
  }

  public getLatest(): SessionLatencyRecord | null {
    if (this.sessionHistory.length === 0) return this.snapshot();
    return this.sessionHistory[this.sessionHistory.length - 1] ?? null;
  }

  public reset(): void {
    this.currentSessionId = null;
    this.timestamps = {};
  }
}

export const sessionLatencyTracker = SessionLatencyTracker.getInstance();
