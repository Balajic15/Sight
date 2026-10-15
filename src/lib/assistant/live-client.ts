import { sessionLatencyTracker } from "./session-latency";
import { authService } from "./auth-service";

export type LiveState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "listening"
  | "speaking";

export interface LiveClientOptions {
  voice?: string;
  apiKey?: string;
  rate?: number;
  model?: string;
  onStateChange?: (state: LiveState) => void;
  onInterrupted?: () => void;
  onError?: (error: string) => void;
  onText?: (text: string) => void;
  onUserTranscription?: (text: string) => void;
  onAssistantTranscription?: (text: string) => void;
  onTurnComplete?: () => void;
  onReady?: () => void;
}

const DEFAULT_SYSTEM = `You are a calm, natural, real-time voice assistant.
Your responses are spoken aloud to the user:
- Keep answers concise, natural, and conversational (1-3 sentences unless asked for details).
- Do not use markdown, emojis, bullet points, or special formatting.
- If live visual frames (camera or screen share) are provided, answer questions about what you see directly.
- Never mention any provider, model name, or backend details.`;

const DEFAULT_MODEL = "models/gemini-3.1-flash-live-preview";
const MAX_PENDING_AUDIO_CHUNKS = 40;
const MAX_SOCKET_BUFFERED_BYTES = 1_000_000;
const VIDEO_FRAME_INTERVAL_MS = 1_000;
const MAX_VIDEO_DIMENSION = 640;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Cleanup should continue even if an individual track fails to stop.
    }
  });
}

function createAudioContext(): AudioContext {
  const AudioContextConstructor =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;

  if (!AudioContextConstructor) {
    throw new Error("Web Audio is not supported in this browser.");
  }

  return new AudioContextConstructor();
}

export class LiveClient {
  public static readonly MAX_PENDING_AUDIO_CHUNKS = MAX_PENDING_AUDIO_CHUNKS;

  public playbackRate = 1;

  private ws: WebSocket | null = null;
  private state: LiveState = "disconnected";
  private readonly options: LiveClientOptions;

  private isReady = false;
  private isPaused = false;
  private connectionVersion = 0;
  private pendingAudioBuffer: string[] = [];

  // Microphone capture.
  private isAcquiringMic = false;
  private micRequestVersion = 0;
  private micStream: MediaStream | null = null;
  private inputAudioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  // Audio playback.
  private outputAudioCtx: AudioContext | null = null;
  private nextPlayTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private playbackVersion = 0;
  private isModelSpeaking = false;

  // Video streaming.
  private videoInterval: number | null = null;
  private videoElementGetter: (() => HTMLVideoElement | null) | null = null;
  private videoCanvas: HTMLCanvasElement | null = null;

  // Public callbacks for direct assignment
  public onStatusChange: ((status: string) => void) | null = null;
  public onAgentSpeakingChange: ((speaking: boolean) => void) | null = null;
  public onMessageReceived: ((msg: string) => void) | null = null;

  constructor(options: LiveClientOptions = {}) {
    this.options = options;

    if (typeof options.rate === "number") {
      this.playbackRate = this.clampPlaybackRate(options.rate);
    }
  }

  public getState(): LiveState {
    return this.state;
  }

  private setState(state: LiveState): void {
    if (this.state === state) return;

    this.state = state;

    try {
      this.options.onStateChange?.(state);
      this.onStatusChange?.(state);
    } catch (error) {
      console.error("[LiveClient] onStateChange callback failed:", error);
    }
  }

  private notifyError(message: string): void {
    try {
      this.options.onError?.(message);
    } catch (error) {
      console.error("[LiveClient] onError callback failed:", error);
    }
  }

  private clampPlaybackRate(rate: number): number {
    return Math.max(0.5, Math.min(2, rate));
  }

  public async connect(
    apiKeyOrParams?:
      | string
      | {
          voice?: string;
          apiKey?: string;
          rate?: number;
          model?: string;
        },
    optionalModel?: string,
  ): Promise<void> {
    const params =
      typeof apiKeyOrParams === "string"
        ? { apiKey: apiKeyOrParams, model: optionalModel }
        : (apiKeyOrParams ?? {});

    this.disconnect();

    const connectionVersion = this.connectionVersion;
    this.isPaused = false;
    this.setState("connecting");
    sessionLatencyTracker.mark("realtime_connection_started");

    const voice = params.voice || this.options.voice || "Zephyr";
    let apiKey = (params.apiKey || this.options.apiKey || "").trim();
    let selectedModel = params.model || this.options.model || DEFAULT_MODEL;

    if (typeof params?.rate === "number") {
      this.playbackRate = this.clampPlaybackRate(params.rate);
    }

    // Create/resume the output context as early as possible, often directly
    // from the user's click or tap that initiated connect().
    try {
      this.getOrCreateOutputAudioCtx();
    } catch (error) {
      this.notifyError(
        error instanceof Error ? error.message : "Audio output is unavailable.",
      );
    }

    if (!apiKey) {
      try {
        const response = await authService.fetchWithAuth("/api/live-token");

        if (connectionVersion !== this.connectionVersion) return;

        if (response.ok) {
          const tokenData: unknown = await response.json();

          if (isRecord(tokenData)) {
            if (
              tokenData.success === true &&
              typeof tokenData.apiKey === "string"
            ) {
              apiKey = tokenData.apiKey.trim();
            }

            if (
              typeof tokenData.model === "string" &&
              !this.options.model
            ) {
              selectedModel = tokenData.model;
            }
          }
        }
      } catch (error) {
        console.warn("[LiveClient] Could not fetch live token:", error);
      }
    }

    if (connectionVersion !== this.connectionVersion) return;

    if (!apiKey) {
      this.notifyError(
        "Google API key is not configured. Please enter your API key in Settings.",
      );
      this.disconnect();
      return;
    }

    const wsUrl =
      "wss://generativelanguage.googleapis.com/ws/" +
      "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent" +
      `?key=${encodeURIComponent(apiKey)}`;

    sessionLatencyTracker.mark("credentials_ready");

    let socket: WebSocket;

    try {
      socket = new WebSocket(wsUrl);
    } catch {
      this.notifyError("Failed to establish the real-time WebSocket connection.");
      this.disconnect();
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      if (!this.isCurrentSocket(socket, connectionVersion)) return;

      sessionLatencyTracker.mark("realtime_connection_established");

      const setupPayload = {
        setup: {
          model: selectedModel,
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

      this.sendJson(socket, setupPayload);
    };

    socket.onmessage = (event: MessageEvent<unknown>) => {
      void this.handleSocketMessage(
        socket,
        connectionVersion,
        event.data,
      );
    };

    socket.onerror = () => {
      if (!this.isCurrentSocket(socket, connectionVersion)) return;

      console.error("[LiveClient] WebSocket connection error.");
      this.notifyError("Connection error to the live assistant.");
    };

    socket.onclose = (event: CloseEvent) => {
      if (!this.isCurrentSocket(socket, connectionVersion)) return;

      this.ws = null;
      this.cleanupSession();
      this.setState("disconnected");

      if (event.code !== 1000 && event.code !== 1005) {
        this.notifyError(event.reason || "Live voice session disconnected.");
      }
    };
  }

  private isCurrentSocket(
    socket: WebSocket,
    connectionVersion: number,
  ): boolean {
    return (
      this.ws === socket &&
      this.connectionVersion === connectionVersion
    );
  }

  private async handleSocketMessage(
    socket: WebSocket,
    connectionVersion: number,
    data: unknown,
  ): Promise<void> {
    try {
      let textData: string;

      if (typeof data === "string") {
        textData = data;
      } else if (data instanceof Blob) {
        textData = await data.text();
      } else if (data instanceof ArrayBuffer) {
        textData = new TextDecoder().decode(data);
      } else if (ArrayBuffer.isView(data)) {
        textData = new TextDecoder().decode(data);
      } else {
        return;
      }

      if (!this.isCurrentSocket(socket, connectionVersion)) return;

      const message: unknown = JSON.parse(textData);
      if (!isRecord(message)) return;

      if (message.setupComplete) {
        this.isReady = true;

        sessionLatencyTracker.mark("session_configuration_complete");
        sessionLatencyTracker.mark("session_ready");

        this.setState("connected");
        this.flushPendingAudioBuffer();
        this.options.onReady?.();

        if (this.videoElementGetter) {
          this.startVideoStreaming(this.videoElementGetter);
        }

        // Start mic capture only after the session is configured.
        void this.startMic(connectionVersion);
        return;
      }

      const serverContent = message.serverContent;
      if (isRecord(serverContent)) {
        await this.handleServerContent(serverContent);
        return;
      }

      const error = message.error;
      if (isRecord(error)) {
        const messageText =
          typeof error.message === "string"
            ? error.message
            : "The live assistant returned an error.";

        this.notifyError(messageText);
      }
    } catch (error) {
      console.error("[LiveClient] Message handling failed:", error);
    }
  }

  private async handleServerContent(
    serverContent: JsonRecord,
  ): Promise<void> {
    if (serverContent.interrupted === true) {
      this.stopAudioPlayback();

      try {
        this.options.onInterrupted?.();
      } catch (error) {
        console.error("[LiveClient] onInterrupted callback failed:", error);
      }

      if (this.state === "speaking") {
        this.setState("listening");
      }
    }

    const inputTranscription = serverContent.inputTranscription;
    if (
      isRecord(inputTranscription) &&
      typeof inputTranscription.text === "string"
    ) {
      sessionLatencyTracker.mark("first_user_transcription_received");

      try {
        this.options.onUserTranscription?.(inputTranscription.text);
      } catch (error) {
        console.error(
          "[LiveClient] onUserTranscription callback failed:",
          error,
        );
      }
    }

    const outputTranscription = serverContent.outputTranscription;
    if (
      isRecord(outputTranscription) &&
      typeof outputTranscription.text === "string"
    ) {
      sessionLatencyTracker.mark("first_model_response_received");

      try {
        this.options.onAssistantTranscription?.(outputTranscription.text);
      } catch (error) {
        console.error(
          "[LiveClient] onAssistantTranscription callback failed:",
          error,
        );
      }
    }

    const modelTurn = serverContent.modelTurn;
    if (isRecord(modelTurn) && Array.isArray(modelTurn.parts)) {
      for (const part of modelTurn.parts) {
        if (!isRecord(part)) continue;

        const inlineData = part.inlineData;
        if (isRecord(inlineData) && typeof inlineData.data === "string") {
          sessionLatencyTracker.mark("first_model_response_received");
          this.playPcmChunk(inlineData.data);
        }

        if (typeof part.text === "string") {
          sessionLatencyTracker.mark("first_model_response_received");

          try {
            this.options.onText?.(part.text);
            this.onMessageReceived?.(part.text);
          } catch (error) {
            console.error("[LiveClient] onText callback failed:", error);
          }
        }
      }
    }

    if (serverContent.turnComplete === true) {
      try {
        this.options.onTurnComplete?.();
      } catch (error) {
        console.error("[LiveClient] onTurnComplete callback failed:", error);
      }

      if (!this.isModelSpeaking && this.state !== "disconnected") {
        this.setState("listening");
      }
    }
  }

  private sendJson(socket: WebSocket, payload: unknown): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;

    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      console.warn("[LiveClient] Failed to send WebSocket message:", error);
      return false;
    }
  }

  private flushPendingAudioBuffer(): void {
    if (!this.ws || !this.isReady) return;

    while (this.pendingAudioBuffer.length > 0) {
      const chunk = this.pendingAudioBuffer.shift();
      if (chunk) {
        this.sendRealtimeAudio(chunk);
      }
    }
  }

  private sendRealtimeAudio(base64Pcm: string): boolean {
    const socket = this.ws;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !this.isReady ||
      socket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES
    ) {
      return false;
    }

    const sent = this.sendJson(socket, {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64Pcm,
          },
        ],
      },
    });

    if (sent) {
      sessionLatencyTracker.mark("first_audio_chunk_sent");
    }

    return sent;
  }

  public disconnect(): void {
    ++this.connectionVersion;
    this.isReady = false;
    this.pendingAudioBuffer = [];

    const socket = this.ws;
    this.ws = null;

    this.cleanupSession();

    if (socket) {
      try {
        socket.close(1000, "Client disconnected");
      } catch {
        // Ignore errors from an already closed socket.
      }
    }

    this.setState("disconnected");
  }

  private cleanupSession(): void {
    this.isReady = false;
    this.pendingAudioBuffer = [];

    this.stopMic();
    this.stopVideoStreaming();
    this.stopAudioPlayback();

    this.videoElementGetter = null;

    const outputContext = this.outputAudioCtx;
    this.outputAudioCtx = null;

    if (outputContext && outputContext.state !== "closed") {
      void outputContext.close().catch(() => undefined);
    }

    this.nextPlayTime = 0;
    this.isPaused = false;
  }

  public sendText(text: string): void {
    const cleanText = text.trim();
    const socket = this.ws;

    if (
      !cleanText ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !this.isReady
    ) {
      return;
    }

    this.sendJson(socket, {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: cleanText }],
          },
        ],
        turnComplete: true,
      },
    });
  }

  // Microphone capture and conversion to 16 kHz mono PCM.
  private async startMic(connectionVersion: number): Promise<void> {
    if (
      this.micStream ||
      this.isAcquiringMic ||
      this.isPaused ||
      connectionVersion !== this.connectionVersion
    ) {
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.notifyError("Microphone access is unavailable in this browser.");
      return;
    }

    const requestVersion = ++this.micRequestVersion;
    this.isAcquiringMic = true;

    let stream: MediaStream | null = null;
    let inputContext: AudioContext | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      if (
        requestVersion !== this.micRequestVersion ||
        connectionVersion !== this.connectionVersion ||
        this.isPaused
      ) {
        stopTracks(stream);
        return;
      }

      inputContext = createAudioContext();

      if (inputContext.state === "suspended") {
        await inputContext.resume().catch(() => undefined);
      }

      if (
        requestVersion !== this.micRequestVersion ||
        connectionVersion !== this.connectionVersion ||
        this.isPaused
      ) {
        stopTracks(stream);
        if (inputContext.state !== "closed") {
          void inputContext.close().catch(() => undefined);
        }
        return;
      }

      const source = inputContext.createMediaStreamSource(stream);
      const processor = inputContext.createScriptProcessor(4096, 1, 1);

      this.micStream = stream;
      this.inputAudioCtx = inputContext;
      this.micSource = source;
      this.processor = processor;

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (
          this.isPaused ||
          requestVersion !== this.micRequestVersion ||
          connectionVersion !== this.connectionVersion
        ) {
          return;
        }

        const channel = event.inputBuffer.getChannelData(0);
        const pcm16 = downsampleAndConvertToPCM16(
          channel,
          inputContext!.sampleRate,
          16000,
        );

        if (pcm16.length === 0) return;

        const base64 = pcm16ToBase64(pcm16);

        if (this.ws?.readyState === WebSocket.OPEN && this.isReady) {
          this.sendRealtimeAudio(base64);
          return;
        }

        if (this.pendingAudioBuffer.length >= MAX_PENDING_AUDIO_CHUNKS) {
          this.pendingAudioBuffer.shift();
        }

        this.pendingAudioBuffer.push(base64);
      };

      source.connect(processor);
      // ScriptProcessorNode requires a destination connection to run.
      processor.connect(inputContext.destination);
    } catch (error) {
      stopTracks(stream);

      if (inputContext && inputContext.state !== "closed") {
        void inputContext.close().catch(() => undefined);
      }

      if (
        requestVersion === this.micRequestVersion &&
        connectionVersion === this.connectionVersion
      ) {
        console.warn("[LiveClient] Microphone acquisition failed:", error);
        this.notifyError("Microphone permission denied or unavailable.");
      }
    } finally {
      if (requestVersion === this.micRequestVersion) {
        this.isAcquiringMic = false;
      }
    }
  }

  public stopMic(): void {
    ++this.micRequestVersion;
    this.isAcquiringMic = false;

    const processor = this.processor;
    const source = this.micSource;
    const inputContext = this.inputAudioCtx;
    const stream = this.micStream;

    this.processor = null;
    this.micSource = null;
    this.inputAudioCtx = null;
    this.micStream = null;

    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        // Ignore already-disconnected node.
      }
    }

    try {
      source?.disconnect();
    } catch {
      // Ignore already-disconnected node.
    }

    stopTracks(stream);

    if (inputContext && inputContext.state !== "closed") {
      void inputContext.close().catch(() => undefined);
    }
  }

  // Video streaming at approximately one frame per second.
  public startVideoStreaming(
    getVideoElement: () => HTMLVideoElement | null,
  ): void {
    this.videoElementGetter = getVideoElement;

    if (this.videoInterval !== null) {
      window.clearInterval(this.videoInterval);
      this.videoInterval = null;
    }

    if (this.isReady) {
      this.captureAndSendVideoFrame();
    }

    this.videoInterval = window.setInterval(() => {
      this.captureAndSendVideoFrame();
    }, VIDEO_FRAME_INTERVAL_MS);
  }

  private captureAndSendVideoFrame(): void {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      !this.isReady ||
      this.isPaused
    ) {
      return;
    }

    const video = this.videoElementGetter?.();

    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    const scale = Math.min(
      1,
      MAX_VIDEO_DIMENSION / Math.max(video.videoWidth, video.videoHeight),
    );

    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    if (!this.videoCanvas) {
      this.videoCanvas = document.createElement("canvas");
    }

    const canvas = this.videoCanvas;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return;

    try {
      context.drawImage(video, 0, 0, width, height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
      const base64Data = dataUrl.slice(dataUrl.indexOf(",") + 1);

      if (base64Data) {
        this.sendRealtimeVideoFrame(base64Data);
      }
    } catch (error) {
      console.warn("[LiveClient] Failed to capture video frame:", error);
    }
  }

  public sendRealtimeVideoFrame(base64Data: string): void {
    const socket = this.ws;

    if (
      !base64Data ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !this.isReady ||
      socket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES
    ) {
      return;
    }

    this.sendJson(socket, {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "image/jpeg",
            data: base64Data,
          },
        ],
      },
    });
  }

  public stopVideoStreaming(): void {
    this.videoElementGetter = null;

    if (this.videoInterval !== null) {
      window.clearInterval(this.videoInterval);
      this.videoInterval = null;
    }
  }

  private getOrCreateOutputAudioCtx(): AudioContext {
    if (!this.outputAudioCtx || this.outputAudioCtx.state === "closed") {
      this.outputAudioCtx = createAudioContext();
    }

    if (this.outputAudioCtx.state === "suspended") {
      void this.outputAudioCtx.resume().catch(() => undefined);
    }

    return this.outputAudioCtx;
  }

  private playPcmChunk(base64Pcm: string): void {
    try {
      const audioContext = this.getOrCreateOutputAudioCtx();
      const pcm16 = base64ToPCM16(base64Pcm);

      if (pcm16.length === 0) return;

      const float32 = new Float32Array(pcm16.length);

      for (let index = 0; index < pcm16.length; index++) {
        const sample = pcm16[index] ?? 0;
        float32[index] =
          sample < 0 ? sample / 0x8000 : sample / 0x7fff;
      }

      const audioBuffer = audioContext.createBuffer(
        1,
        float32.length,
        24000,
      );

      audioBuffer.copyToChannel(float32, 0);

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = this.clampPlaybackRate(this.playbackRate);
      source.connect(audioContext.destination);

      const playbackVersion = this.playbackVersion;
      const startTime = Math.max(
        audioContext.currentTime,
        this.nextPlayTime,
      );

      source.start(startTime);

      sessionLatencyTracker.mark("first_audio_playback_started");

      this.nextPlayTime =
        startTime + audioBuffer.duration / source.playbackRate.value;

      this.activeSources.add(source);
      this.isModelSpeaking = true;
      this.onAgentSpeakingChange?.(true);
      this.setState("speaking");

      source.onended = () => {
        this.activeSources.delete(source);

        // Ignore end events from audio stopped during interruption/cleanup.
        if (playbackVersion !== this.playbackVersion) return;

        if (this.activeSources.size === 0) {
          this.isModelSpeaking = false;
          this.onAgentSpeakingChange?.(false);

          if (this.state !== "disconnected") {
            this.setState("listening");
          }
        }
      };
    } catch (error) {
      console.error("[LiveClient] Error playing audio chunk:", error);
    }
  }

  public stopAudioPlayback(): void {
    ++this.playbackVersion;

    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // It may already have ended.
      }
    }

    this.activeSources.clear();
    this.isModelSpeaking = false;

    if (this.outputAudioCtx) {
      this.nextPlayTime = this.outputAudioCtx.currentTime;
    }
  }

  public pause(): boolean {
    if (this.isPaused) return false;

    this.isPaused = true;
    this.pendingAudioBuffer = [];

    this.micStream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });

    this.stopAudioPlayback();

    if (this.outputAudioCtx?.state === "running") {
      void this.outputAudioCtx.suspend().catch(() => undefined);
    }

    return true;
  }

  public resume(): boolean {
    if (!this.isPaused) return false;

    this.isPaused = false;

    this.micStream?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });

    if (this.outputAudioCtx?.state === "suspended") {
      void this.outputAudioCtx.resume().catch(() => undefined);
    }

    if (this.isReady && this.state !== "disconnected") {
      this.setState("listening");
    }

    return true;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }
}

function downsampleAndConvertToPCM16(
  input: Float32Array,
  inputRate: number,
  outputRate = 16000,
): Int16Array {
  if (
    input.length === 0 ||
    !Number.isFinite(inputRate) ||
    !Number.isFinite(outputRate) ||
    inputRate <= 0 ||
    outputRate <= 0
  ) {
    return new Int16Array(0);
  }

  const outputLength = Math.max(
    1,
    Math.floor((input.length * outputRate) / inputRate),
  );
  const output = new Int16Array(outputLength);

  if (inputRate === outputRate) {
    for (let index = 0; index < outputLength; index++) {
      output[index] = floatToInt16(input[index] ?? 0);
    }
    return output;
  }

  if (inputRate > outputRate) {
    // Average the source samples covered by each output sample.
    const ratio = inputRate / outputRate;

    for (let outputIndex = 0; outputIndex < outputLength; outputIndex++) {
      const start = outputIndex * ratio;
      const end = Math.min(input.length, (outputIndex + 1) * ratio);

      let weightedTotal = 0;
      let totalWeight = 0;

      for (
        let inputIndex = Math.floor(start);
        inputIndex < Math.ceil(end) && inputIndex < input.length;
        inputIndex++
      ) {
        const overlap = Math.max(
          0,
          Math.min(end, inputIndex + 1) - Math.max(start, inputIndex),
        );

        weightedTotal += (input[inputIndex] ?? 0) * overlap;
        totalWeight += overlap;
      }

      const average = totalWeight > 0 ? weightedTotal / totalWeight : 0;
      output[outputIndex] = floatToInt16(average);
    }

    return output;
  }

  // Linear interpolation for the less common upsampling case.
  const ratio = inputRate / outputRate;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex++) {
    const sourcePosition = outputIndex * ratio;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const fraction = sourcePosition - leftIndex;

    const left = input[leftIndex] ?? 0;
    const right = input[rightIndex] ?? left;

    output[outputIndex] = floatToInt16(
      left + (right - left) * fraction,
    );
  }

  return output;
}

function floatToInt16(value: number): number {
  const sample = Math.max(-1, Math.min(1, value));
  return sample < 0
    ? Math.round(sample * 0x8000)
    : Math.round(sample * 0x7fff);
}

function pcm16ToBase64(pcm16: Int16Array): string {
  const bytes = new Uint8Array(
    pcm16.buffer,
    pcm16.byteOffset,
    pcm16.byteLength,
  );

  // Build little-endian PCM bytes explicitly.
  const littleEndianBytes = new Uint8Array(bytes.length);
  const view = new DataView(littleEndianBytes.buffer);

  for (let index = 0; index < pcm16.length; index++) {
    view.setInt16(index * 2, pcm16[index] ?? 0, true);
  }

  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < littleEndianBytes.length; offset += chunkSize) {
    const chunk = littleEndianBytes.subarray(
      offset,
      Math.min(offset + chunkSize, littleEndianBytes.length),
    );
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToPCM16(base64: string): Int16Array {
  const binary = atob(base64);
  const sampleCount = Math.floor(binary.length / 2);
  const pcm16 = new Int16Array(sampleCount);

  for (let index = 0; index < sampleCount; index++) {
    const byteOffset = index * 2;
    const low = binary.charCodeAt(byteOffset);
    const high = binary.charCodeAt(byteOffset + 1);
    const unsigned = low | (high << 8);

    pcm16[index] = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
  }

  return pcm16;
}
