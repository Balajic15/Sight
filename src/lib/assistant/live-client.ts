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

const DEFAULT_SYSTEM = `You are a calm, natural, real-time voice assistant. Your responses are spoken aloud to the user:
- Keep answers concise, natural, and conversational (1-3 sentences unless asked for details).
- Do not use markdown, emojis, bullet points, or special formatting.
- If live visual frames (camera or screen share) are provided, answer questions about what you see directly.
- Never mention any provider, model name, or backend details.`;

export class LiveClient {
  private ws: WebSocket | null = null;
  private state: LiveState = "disconnected";
  private options: LiveClientOptions;
  public playbackRate = 1.0;
  private isReady = false;
  private pendingAudioBuffer: string[] = [];
  public static readonly MAX_PENDING_AUDIO_CHUNKS = 40;

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

  public async connect(params?: { voice?: string; apiKey?: string; rate?: number }) {
    this.disconnect();
    this.setState("connecting");
    sessionLatencyTracker.mark("realtime_connection_started");

    const voice = params?.voice || this.options.voice || "Zephyr";
    let apiKey = (params?.apiKey || this.options.apiKey || "").trim();
    if (typeof params?.rate === "number") {
      this.playbackRate = params.rate;
    }

    this.getOrCreateOutputAudioCtx();

    this.startMic().catch((err) => {
      console.warn("Concurrent microphone acquisition warning:", err);
    });

    // Obtain API key securely from backend if not provided in client settings
    if (!apiKey) {
      try {
        const tokenRes = await authService.fetchWithAuth("/api/live-token");
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          if (tokenData.success && tokenData.apiKey) {
            apiKey = tokenData.apiKey;
          }
        }
      } catch (err) {
        console.warn("[LiveClient] Could not fetch live token:", err);
      }
    }

    if (!apiKey) {
      this.options.onError?.("Google API key is not configured. Please enter your API key in Settings.");
      this.disconnect();
      return;
    }

    // Direct, ultra-low-latency WebSocket to Gemini Live bidiGenerateContent endpoint
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    sessionLatencyTracker.mark("credentials_ready");

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (wsErr) {
      this.options.onError?.("Failed to establish real-time WebSocket connection.");
      this.disconnect();
      return;
    }

    this.ws.onopen = () => {
      sessionLatencyTracker.mark("realtime_connection_established");
      // Send initial BidiGenerateContentSetup handshake
      const setupPayload = {
        setup: {
          model: "models/gemini-3.8-live",
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice,
                },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: DEFAULT_SYSTEM }],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };
      this.ws?.send(JSON.stringify(setupPayload));
    };

    this.ws.onmessage = async (event) => {
      try {
        let textData: string;
        if (typeof event.data === "string") {
          textData = event.data;
        } else if (event.data instanceof Blob) {
          textData = await event.data.text();
        } else if (event.data instanceof ArrayBuffer) {
          textData = new TextDecoder().decode(event.data);
        } else {
          return;
        }

        const msg = JSON.parse(textData);

        if (msg.setupComplete) {
          this.isReady = true;
          sessionLatencyTracker.mark("session_configuration_complete");
          sessionLatencyTracker.mark("session_ready");

          this.setState("connected");
          this.flushPendingAudioBuffer();

          if (this.videoElementGetter) {
            this.startVideoStreaming(this.videoElementGetter);
          }
          this.options.onReady?.();
          return;
        }

        if (msg.serverContent) {
          const sc = msg.serverContent;
          if (sc.interrupted) {
            this.stopAudioPlayback();
            this.options.onInterrupted?.();
            if (this.state === "speaking") {
              this.setState("listening");
            }
          }

          if (sc.inputTranscription?.text) {
            sessionLatencyTracker.mark("first_user_transcription_received");
            this.options.onUserTranscription?.(sc.inputTranscription.text);
          }

          if (sc.outputTranscription?.text) {
            sessionLatencyTracker.mark("first_model_response_received");
            this.options.onAssistantTranscription?.(sc.outputTranscription.text);
          }

          if (sc.modelTurn?.parts) {
            for (const part of sc.modelTurn.parts) {
              if (part.inlineData?.data) {
                sessionLatencyTracker.mark("first_model_response_received");
                this.playPcmChunk(part.inlineData.data);
              }
              if (part.text) {
                sessionLatencyTracker.mark("first_model_response_received");
                this.options.onText?.(part.text);
              }
            }
          }

          if (sc.turnComplete) {
            this.options.onTurnComplete?.();
            if (!this.isModelSpeaking && this.state !== "disconnected") {
              this.setState("listening");
            }
          }
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
        this.sendRealtimeAudio(chunk);
      }
    }
  }

  private sendRealtimeAudio(base64Pcm: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const audioPayload = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64Pcm,
          },
        ],
      },
    };
    this.ws.send(JSON.stringify(audioPayload));
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
    const textPayload = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };
    this.ws.send(JSON.stringify(textPayload));
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

      // 4096 samples at 48kHz ~ 85ms buffer
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      this.processor = processor;

      processor.onaudioprocess = (e) => {
        if (this.isPaused) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = downsampleAndConvertToPCM16(inputData, inputCtx.sampleRate, 16000);
        const base64 = pcm16ToBase64(pcm16);

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isReady) {
          sessionLatencyTracker.mark("first_audio_chunk_sent");
          this.sendRealtimeAudio(base64);
        } else {
          // Bounded audio ring buffer while connecting
          if (this.pendingAudioBuffer.length >= LiveClient.MAX_PENDING_AUDIO_CHUNKS) {
            this.pendingAudioBuffer.shift();
          }
          this.pendingAudioBuffer.push(base64);
        }
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);
    } catch (err) {
      this.options.onError?.("Microphone permission denied or unavailable.");
      this.stopMic();
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
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) return;

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
        const videoPayload = {
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: "image/jpeg",
                data: base64Data,
              },
            ],
          },
        };
        this.ws.send(JSON.stringify(videoPayload));
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
    const avg = count > 0 ? accum / count : 0;
    const s = Math.max(-1, Math.min(1, avg));
    result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function pcm16ToBase64(pcm16: Int16Array): string {
  const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
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
