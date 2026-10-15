import type { SessionEventEnvelope } from "./session-types";

export interface TranscriptionCallbacks {
  onUserTranscription?: (envelope: SessionEventEnvelope<string>) => void;
  onAssistantTranscription?: (envelope: SessionEventEnvelope<string>) => void;
  onText?: (envelope: SessionEventEnvelope<string>) => void;
  onTurnComplete?: (envelope: SessionEventEnvelope<void>) => void;
  onInterrupted?: (envelope: SessionEventEnvelope<void>) => void;
}

export class TranscriptionService {
  private static instance: TranscriptionService;
  private callbacks: TranscriptionCallbacks = {};

  private constructor() {}

  public static getInstance(): TranscriptionService {
    if (!TranscriptionService.instance) {
      TranscriptionService.instance = new TranscriptionService();
    }
    return TranscriptionService.instance;
  }

  public setCallbacks(callbacks: TranscriptionCallbacks) {
    this.callbacks = callbacks;
  }

  public routeUserTranscription(
    envelope: SessionEventEnvelope<string>,
    expectedSessionId: string,
    expectedConversationId: string | null,
  ): boolean {
    if (!this.isValidEnvelope(envelope, expectedSessionId, expectedConversationId)) {
      return false;
    }
    this.callbacks.onUserTranscription?.(envelope);
    return true;
  }

  public routeAssistantTranscription(
    envelope: SessionEventEnvelope<string>,
    expectedSessionId: string,
    expectedConversationId: string | null,
  ): boolean {
    if (!this.isValidEnvelope(envelope, expectedSessionId, expectedConversationId)) {
      return false;
    }
    this.callbacks.onAssistantTranscription?.(envelope);
    return true;
  }

  public routeText(
    envelope: SessionEventEnvelope<string>,
    expectedSessionId: string,
    expectedConversationId: string | null,
  ): boolean {
    if (!this.isValidEnvelope(envelope, expectedSessionId, expectedConversationId)) {
      return false;
    }
    this.callbacks.onText?.(envelope);
    return true;
  }

  public routeTurnComplete(
    envelope: SessionEventEnvelope<void>,
    expectedSessionId: string,
    expectedConversationId: string | null,
  ): boolean {
    if (!this.isValidEnvelope(envelope, expectedSessionId, expectedConversationId)) {
      return false;
    }
    this.callbacks.onTurnComplete?.(envelope);
    return true;
  }

  public routeInterrupted(
    envelope: SessionEventEnvelope<void>,
    expectedSessionId: string,
    expectedConversationId: string | null,
  ): boolean {
    if (!this.isValidEnvelope(envelope, expectedSessionId, expectedConversationId)) {
      return false;
    }
    this.callbacks.onInterrupted?.(envelope);
    return true;
  }

  private isValidEnvelope<T>(
    envelope: SessionEventEnvelope<T>,
    expectedSessionId: string,
    expectedConversationId: string | null,
  ): boolean {
    if (!envelope || !envelope.sessionId || !envelope.conversationId) return false;
    if (envelope.sessionId !== expectedSessionId) return false;
    if (expectedConversationId !== null && envelope.conversationId !== expectedConversationId) {
      return false;
    }
    return true;
  }
}

export const transcriptionService = TranscriptionService.getInstance();
