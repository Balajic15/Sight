import { sessionLatencyTracker } from "./session-latency";
import { authService } from "./auth-service";

export type LiveState = "disconnected" | "connecting" | "connected" | "listening" | "speaking";

export interface LiveClientOptions {
  voice?: string;
  apiKey?: string;
  rate?: number;
  onStateChange?: (state: LiveState) => void;
  onInterrupted?: () => void;
  onError?: (error: string) => void;
  onText?: (text: string) => void;
  onUserTranscription?: (text: string) => void;
  onAssistantTranscription?: (text: string) => void;
  onTurnComplete?: () => void;
  onReady?: () => void;
}

export class LiveClient {
  private ws: WebSocket | null = null;
  private state: LiveState = "disconnected";
  private options: LiveClientOptions;
  public playbackRate = 1.0;
  private isReady = false;
  private pendingAudioBuffer: string[] = [];
  public static readonly MAX_PENDING_AUDIO_CHUNKS = 40; // ~1.7s buffer at 42ms chunks

  // Audio recording
  private isAcquiringMic = false;
  private micStream: MediaStream | null = null;
  private inputAudioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  // Audio playback
  private outputAudioCtx: AudioContext | null = null;
  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private isModelSpeaking = false;

  // Video streaming
  private videoInterval: number | null = null;
  private videoElementGetter: (() => HTMLVideoElement | null) | null = null;
  private isPaused = false;

  constructor(options: LiveClientOptions = {}) {
    this.options = options;
    if (typeof options.rate === "number") {
      this.playbackRate = options.rate;
    }
  }

  public getState(): LiveState {
    return this.state;
  }

  private setState(state: LiveState) {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  public connect(params?: { voice?: string; apiKey?: string; rate?: number }) {
    // Completely clear prior session and resources before initiating another one
    this.disconnect();

    this.setState("connecting");
    sessionLatencyTracker.mark("realtime_connection_started");

    const voice = params?.voice || this.options.voice || "Zephyr";
    const apiKey = params?.apiKey || this.options.apiKey || "";
    if (typeof params?.rate === "number") {
      this.playbackRate = params.rate;
    }

    // Pre-warm output audio context concurrently with connection establishment
    this.getOrCreateOutputAudioCtx();

    // Start microphone acquisition concurrently on user click rather than waiting for server handshake
    this.startMic().catch((err) => {
      console.warn("Concurrent microphone acquisition warning:", err);
    });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = `${protocol}//${window.location.host}/api/live?voice=${encodeURIComponent(voice)}`;
    if (apiKey.trim()) {
      wsUrl += `&key=${encodeURIComponent(apiKey.trim())}`;
    }
    const token = authService.getSessionToken();
    if (token) {
      wsUrl += `&token=${encodeURIComponent(token)}`;
    }
    sessionLatencyTracker.mark("credentials_ready");

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      // WebSocket transport connected; waiting for Gemini Live setup handshake
      sessionLatencyTracker.mark("realtime_connection_established");
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "ready") {
          this.isReady = true;
          sessionLatencyTracker.mark("session_configuration_complete");
          sessionLatencyTracker.mark("session_ready");

          this.setState("connected");
          this.flushPendingAudioBuffer();

          if (this.videoElementGetter) {
            this.startVideoStreaming(this.videoElementGetter);
          }
          this.options.onReady?.();
        } else if (msg.type === "audio" && msg.data) {
          sessionLatencyTracker.mark("first_model_response_received");
          this.playPcmChunk(msg.data);
        } else if (msg.type === "text" && msg.text) {
          sessionLatencyTracker.mark("first_model_response_received");
          this.options.onText?.(msg.text);
        } else if (msg.type === "userTranscription" && msg.text) {
          sessionLatencyTracker.mark("first_user_transcription_received");
          this.options.onUserTranscription?.(msg.text);
        } else if (msg.type === "assistantTranscription" && msg.text) {
          sessionLatencyTracker.mark("first_model_response_received");
          this.options.onAssistantTranscription?.(msg.text);
        } else if (msg.type === "interrupted") {
          this.stopAudioPlayback();
          this.options.onInterrupted?.();
          if (this.state === "speaking") {
            this.setState("listening");
          }
        } else if (msg.type === "turnComplete") {
          this.options.onTurnComplete?.();
          // Model finished its turn; when audio finishes playing it will transition to listening
          if (!this.isModelSpeaking && this.state !== "disconnected") {
            this.setState("listening");
          }
        } else if (msg.type === "error") {
          this.options.onError?.(msg.message || "Live session error");
        }
      } catch (e) {
        console.error("LiveClient parse error:", e);
      }
    };

    this.ws.onerror = (e) => {
      console.error("LiveClient ws error:", e);
      this.options.onError?.("Connection error to live assistant");
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.disconnect();
      if (event.code !== 1000 && event.code !== 1005) {
        this.options.onError?.(event.reason || "Live voice session disconnected.");
      }
    };
  }

  private flushPendingAudioBuffer() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) return;
    while (this.pendingAudioBuffer.length > 0) {
      const chunk = this.pendingAudioBuffer.shift();
      if (chunk) {
        sessionLatencyTracker.mark("first_audio_chunk_sent");
        this.ws.send(JSON.stringify({ type: "audio", data: chunk }));
      }
    }
  }

  public disconnect() {
    this.isReady = false;
    this.pendingAudioBuffer = [];
    this.stopMic();
    this.stopVideoStreaming();
    this.stopAudioPlayback();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore close error */
      }
      this.ws = null;
    }

    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch {
        /* ignore close error */
      }
      this.outputAudioCtx = null;
    }

    this.activeSources = [];
    this.isModelSpeaking = false;
    this.nextPlayTime = 0;
    this.videoElementGetter = null;

    this.setState("disconnected");
  }

  public sendText(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "text", text }));
  }

  // ---------- Microphone Capture (16kHz PCM Int16) ----------
  public async startMic() {
    if (this.micStream || this.isAcquiringMic) return;
    this.isAcquiringMic = true;

    sessionLatencyTracker.mark("permission_requested");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // If disconnected or stopped while awaiting microphone permission, release tracks immediately!
      if (!this.isAcquiringMic || this.state === "disconnected") {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* ignore */
          }
        });
        return;
      }

      this.micStream = stream;
      sessionLatencyTracker.mark("permission_granted");
      sessionLatencyTracker.mark("audio_capture_ready");

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const inputCtx = new AudioContextClass();
      this.inputAudioCtx = inputCtx;

      const source = inputCtx.createMediaStreamSource(stream);
      this.micSource = source;

      // 2048 buffer size cuts latency down to ~42-45ms chunks at 44.1k/48k (half of 4096)
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      this.processor = processor;

      processor.onaudioprocess = (e) => {
        if (this.isPaused) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = downsampleAndConvertToPCM16(inputData, inputCtx.sampleRate, 16000);
        if (pcm16.length === 0) return;

        const base64Audio = int16ToBase64(pcm16);

        // If connection is already verified and ready, stream directly
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isReady) {
          if (this.pendingAudioBuffer.length > 0) {
            this.flushPendingAudioBuffer();
          }
          sessionLatencyTracker.mark("first_audio_chunk_sent");
          this.ws.send(JSON.stringify({ type: "audio", data: base64Audio }));
        } else if (!this.isReady) {
          // While connection handshake is completing, buffer recent speech up to bounded limit (~1.7s)
          if (this.pendingAudioBuffer.length >= LiveClient.MAX_PENDING_AUDIO_CHUNKS) {
            this.pendingAudioBuffer.shift();
          }
          this.pendingAudioBuffer.push(base64Audio);
        }
      };

      const muteGain = inputCtx.createGain();
      muteGain.gain.value = 0;

      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(inputCtx.destination);

      if (this.state !== "speaking") {
        this.setState("listening");
      }
    } catch (err) {
      console.error("Microphone capture error:", err);
      this.options.onError?.("Microphone access failed.");
    } finally {
      this.isAcquiringMic = false;
    }
  }

  public stopMic() {
    this.isAcquiringMic = false;
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        /* ignore disconnect error */
      }
      this.processor = null;
    }
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        /* ignore disconnect error */
      }
      this.micSource = null;
    }
    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch {
        /* ignore close error */
      }
      this.inputAudioCtx = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      this.micStream = null;
    }
  }

  // ---------- Video Streaming (1 FPS, max 640px JPEG) ----------
  public startVideoStreaming(getVideoElement: () => HTMLVideoElement | null) {
    this.videoElementGetter = getVideoElement;
    if (this.videoInterval !== null) {
      clearInterval(this.videoInterval);
      this.videoInterval = null;
    }

    const captureAndSend = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const video = getVideoElement();
      if (!video || !video.videoWidth || !video.videoHeight) return;

      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
      const base64Data = dataUrl.split(",")[1];
      if (base64Data) {
        this.ws.send(JSON.stringify({ type: "image", data: base64Data }));
      }
    };

    captureAndSend();
    this.videoInterval = window.setInterval(captureAndSend, 1000);
  }

  public stopVideoStreaming() {
    this.videoElementGetter = null;
    if (this.videoInterval !== null) {
      clearInterval(this.videoInterval);
      this.videoInterval = null;
    }
  }

  // ---------- Audio Playback (24kHz PCM Int16) ----------
  private getOrCreateOutputAudioCtx(): AudioContext {
    if (!this.outputAudioCtx || this.outputAudioCtx.state === "closed") {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.outputAudioCtx = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.outputAudioCtx.currentTime;
    }
    if (this.outputAudioCtx.state === "suspended") {
      this.outputAudioCtx.resume().catch(() => {});
    }
    return this.outputAudioCtx;
  }

  private playPcmChunk(base64: string) {
    try {
      const audioCtx = this.getOrCreateOutputAudioCtx();
      const pcm16 = base64ToPCM16(base64);
      if (pcm16.length === 0) return;

      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = (pcm16[i] ?? 0) / 32768;
      }

      const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.copyToChannel(float32, 0);

      const rate = Math.max(0.5, Math.min(2.0, this.playbackRate || 1.0));
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = rate;
      source.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      const startTime = Math.max(now, this.nextPlayTime);
      source.start(startTime);
      sessionLatencyTracker.mark("first_audio_playback_started");
      const effectiveDuration = audioBuffer.duration / rate;
      this.nextPlayTime = startTime + effectiveDuration;

      this.activeSources.push(source);
      this.isModelSpeaking = true;
      this.setState("speaking");

      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) {
          this.activeSources.splice(idx, 1);
        }
        if (this.activeSources.length === 0) {
          this.isModelSpeaking = false;
          if (this.state !== "disconnected") {
            this.setState("listening");
          }
        }
      };
    } catch (err) {
      console.error("Error playing audio chunk:", err);
    }
  }

  public stopAudioPlayback() {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        /* ignore audio stop error */
      }
    }
    this.activeSources = [];
    this.isModelSpeaking = false;
    if (this.outputAudioCtx) {
      this.nextPlayTime = this.outputAudioCtx.currentTime;
    }
  }

  public pause(): boolean {
    if (this.isPaused) return false;
    this.isPaused = true;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
    }
    this.stopAudioPlayback();
    if (this.outputAudioCtx && this.outputAudioCtx.state === "running") {
      this.outputAudioCtx.suspend().catch(() => {});
    }
    return true;
  }

  public resume(): boolean {
    if (!this.isPaused) return false;
    this.isPaused = false;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
    }
    if (this.outputAudioCtx && this.outputAudioCtx.state === "suspended") {
      this.outputAudioCtx.resume().catch(() => {});
    }
    return true;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }
}

// ---------- Helper functions ----------

function downsampleAndConvertToPCM16(
  buffer: Float32Array,
  inputRate: number,
  outputRate = 16000,
): Int16Array {
  if (inputRate === outputRate) {
    const pcm16 = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i] ?? 0));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i] ?? 0;
      count++;
    }
    const sample = count > 0 ? accum / count : (buffer[offsetBuffer] ?? 0);
    const s = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  const CHUNK_SIZE = 0x4000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]!);
    }
  }
  return btoa(binary);
}

function base64ToPCM16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}
