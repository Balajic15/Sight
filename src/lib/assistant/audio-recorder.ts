export interface AudioCaptureSession {
  stream: MediaStream;
  audioCtx: AudioContext;
  analyser: AnalyserNode;
  getRecordedBlob: () => Promise<Blob | null>;
  stop: () => Promise<Blob | null>;
}

export class AudioRecorder {
  private static instance: AudioRecorder;
  private currentStream: MediaStream | null = null;
  private currentAudioCtx: AudioContext | null = null;
  private currentMediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  private constructor() {}

  public static getInstance(): AudioRecorder {
    if (!AudioRecorder.instance) {
      AudioRecorder.instance = new AudioRecorder();
    }
    return AudioRecorder.instance;
  }

  public async startCapture(): Promise<AudioCaptureSession> {
    // Clean up any stale sessions first
    this.release();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.currentStream = stream;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    this.currentAudioCtx = audioCtx;

    if (audioCtx.state === "suspended") {
      await audioCtx.resume().catch(() => {});
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    // Buffer audio chunks via MediaRecorder for fallback transcription
    this.recordedChunks = [];
    if (typeof MediaRecorder !== "undefined") {
      try {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : MediaRecorder.isTypeSupported("audio/mp4")
              ? "audio/mp4"
              : "";

        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.recordedChunks.push(e.data);
          }
        };

        recorder.start(100);
        this.currentMediaRecorder = recorder;
      } catch {
        /* MediaRecorder not critical if web speech is available */
      }
    }

    const getRecordedBlob = async (): Promise<Blob | null> => {
      if (this.recordedChunks.length === 0) return null;
      const type = this.recordedChunks[0]?.type || "audio/webm";
      return new Blob(this.recordedChunks, { type });
    };

    const stop = async (): Promise<Blob | null> => {
      let finalBlob: Blob | null = null;
      if (this.currentMediaRecorder && this.currentMediaRecorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          if (!this.currentMediaRecorder) return resolve();
          this.currentMediaRecorder.onstop = () => resolve();
          try {
            this.currentMediaRecorder.stop();
          } catch {
            resolve();
          }
        });
        finalBlob = await getRecordedBlob();
      }
      this.release();
      return finalBlob;
    };

    return {
      stream,
      audioCtx,
      analyser,
      getRecordedBlob,
      stop,
    };
  }

  public release(): void {
    if (this.currentMediaRecorder && this.currentMediaRecorder.state !== "inactive") {
      try {
        this.currentMediaRecorder.stop();
      } catch {
        /* ignore */
      }
      this.currentMediaRecorder = null;
    }

    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      });
      this.currentStream = null;
    }

    if (this.currentAudioCtx && this.currentAudioCtx.state !== "closed") {
      try {
        this.currentAudioCtx.close().catch(() => {});
      } catch {
        /* ignore */
      }
      this.currentAudioCtx = null;
    }

    this.recordedChunks = [];
  }
}

export const audioRecorder = AudioRecorder.getInstance();
