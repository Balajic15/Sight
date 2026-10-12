import {
  type Conversation,
  type Msg,
  loadConversations,
  saveConversations,
  syncConversationToDb,
  deleteConversationFromDbRemote,
  clearAllConversationsFromDbRemote,
  fetchConversationsFromDb,
} from "./store";

export class HistoryService {
  private static instance: HistoryService;

  private constructor() {}

  public static getInstance(): HistoryService {
    if (!HistoryService.instance) {
      HistoryService.instance = new HistoryService();
    }
    return HistoryService.instance;
  }

  public getConversations(userId?: string): Conversation[] {
    return loadConversations(userId);
  }

  public saveAll(convos: Conversation[], userId?: string) {
    saveConversations(convos, userId);
  }

  public saveConversation(convo: Conversation, userId?: string) {
    if (convo.messages.length === 0) return;
    const all = loadConversations(userId);
    const next = [convo, ...all.filter((c) => c.id !== convo.id)].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    saveConversations(next, userId);
    syncConversationToDb(convo);
  }

  public appendMessage(conversationId: string, message: Msg, userId?: string): Conversation | null {
    const all = loadConversations(userId);
    const existing = all.find((c) => c.id === conversationId);
    if (!existing) return null;

    const updated: Conversation = {
      ...existing,
      updatedAt: Date.now(),
      messages: [...existing.messages, message],
    };
    this.saveConversation(updated, userId);
    return updated;
  }

  public deleteConversation(conversationId: string, userId?: string): Conversation[] {
    const all = loadConversations(userId);
    const next = all.filter((c) => c.id !== conversationId);
    saveConversations(next, userId);
    deleteConversationFromDbRemote(conversationId);
    return next;
  }

  public async clearAll(userId?: string): Promise<void> {
    saveConversations([], userId);
    await clearAllConversationsFromDbRemote();
  }

  public async syncRemote(userId?: string): Promise<Conversation[]> {
    const remote = await fetchConversationsFromDb();
    if (remote && remote.length > 0) {
      saveConversations(remote, userId);
      return remote;
    }
    return loadConversations(userId);
  }
}

export const historyService = HistoryService.getInstance();
