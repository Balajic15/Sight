import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  X,
  MessageSquare,
  FileText,
  Image as ImageIcon,
  Clock,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface SearchResultItem {
  id: string;
  type: "conversation" | "message" | "media";
  title: string;
  subtitle?: string;
  conversationId: string;
  messageId?: string;
  updatedAt?: string | number;
  dataUrl?: string;
  storageRef?: string;
}

interface SearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (conversationId: string) => void;
  onSelectMessage?: (conversationId: string, messageId: string) => void;
  onSelectMedia?: (mediaId: string, url: string) => void;
}

export function SearchDialog({
  isOpen,
  onClose,
  onSelectConversation,
  onSelectMessage,
  onSelectMedia,
}: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "conversations" | "messages" | "media">("all");
  const [results, setResults] = useState<{
    conversations: Array<{ id: string; title: string; updated_at?: string }>;
    messages: Array<{
      id: string;
      conversation_id: string;
      role: string;
      text_content: string;
      title: string;
      created_at?: string;
    }>;
    media: Array<{
      id: string;
      conversation_id: string;
      file_name: string;
      mime_type: string;
      original_prompt?: string;
      created_at?: string;
    }>;
  }>({
    conversations: [],
    messages: [],
    media: [],
  });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults({ conversations: [], messages: [], media: [] });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ conversations: [], messages: [], media: [] });
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=30`, {
          credentials: "include",
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.results) {
            setResults(json.results);
          }
        }
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  if (!isOpen) return null;

  const convCount = results.conversations.length;
  const msgCount = results.messages.length;
  const mediaCount = results.media.length;
  const totalCount = convCount + msgCount + mediaCount;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-xs p-4 pt-16 sm:pt-24"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-background border border-border shadow-2xl flex flex-col max-h-[75vh]"
        >
          {/* Top Search Input Bar */}
          <div className="flex items-center px-4 py-3 border-b border-border gap-3">
            <Search className="h-5 w-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations, messages, files and prompts..."
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none text-foreground"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
            {query && !loading && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground bg-muted border border-border rounded">
              ESC
            </kbd>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/60 bg-muted/20 text-xs overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                activeTab === "all"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              All {totalCount > 0 && `(${totalCount})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("conversations")}
              className={`px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1.5 ${
                activeTab === "conversations"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <MessageSquare className="h-3 w-3" />
              Chats {convCount > 0 && `(${convCount})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("messages")}
              className={`px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1.5 ${
                activeTab === "messages"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <FileText className="h-3 w-3" />
              Messages {msgCount > 0 && `(${msgCount})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("media")}
              className={`px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1.5 ${
                activeTab === "media"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <ImageIcon className="h-3 w-3" />
              Media {mediaCount > 0 && `(${mediaCount})`}
            </button>
          </div>

          {/* Results List */}
          <div className="flex-1 overflow-y-auto p-2 divide-y divide-border/30">
            {!query.trim() ? (
              <div className="py-12 text-center text-muted-foreground text-xs">
                Type keywords above to search your complete chat history, attachments, and generated images.
              </div>
            ) : totalCount === 0 && !loading ? (
              <div className="py-12 text-center text-muted-foreground text-xs">
                No matching content found for "{query}".
              </div>
            ) : (
              <>
                {/* Conversations Section */}
                {(activeTab === "all" || activeTab === "conversations") &&
                  results.conversations.length > 0 && (
                    <div className="py-2">
                      <div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
                        Conversations
                      </div>
                      {results.conversations.map((c) => (
                        <button
                          key={`conv-${c.id}`}
                          type="button"
                          onClick={() => {
                            onSelectConversation(c.id);
                            onClose();
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-muted/70 transition group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <MessageSquare className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm font-medium text-foreground truncate">
                              {c.title || "Untitled chat"}
                            </span>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition">
                            Open chat →
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                {/* Messages Section */}
                {(activeTab === "all" || activeTab === "messages") &&
                  results.messages.length > 0 && (
                    <div className="py-2">
                      <div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
                        Messages
                      </div>
                      {results.messages.map((m) => (
                        <button
                          key={`msg-${m.id}`}
                          type="button"
                          onClick={() => {
                            if (onSelectMessage) {
                              onSelectMessage(m.conversation_id, m.id);
                            } else {
                              onSelectConversation(m.conversation_id);
                            }
                            onClose();
                          }}
                          className="w-full flex flex-col px-3 py-2.5 rounded-xl text-left hover:bg-muted/70 transition group gap-1"
                        >
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="font-semibold capitalize text-foreground/80">
                              {m.role === "assistant" ? "Echo" : "You"} · {m.title || "Conversation"}
                            </span>
                            <span className="text-[10px] opacity-0 group-hover:opacity-100 transition">
                              Jump to message →
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground line-clamp-2">
                            {m.text_content}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                {/* Media Section */}
                {(activeTab === "all" || activeTab === "media") &&
                  results.media.length > 0 && (
                    <div className="py-2">
                      <div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
                        Files & Images
                      </div>
                      {results.media.map((med) => (
                        <button
                          key={`med-${med.id}`}
                          type="button"
                          onClick={() => {
                            if (onSelectMedia) {
                              onSelectMedia(med.id, `/api/media?id=${encodeURIComponent(med.id)}`);
                            } else {
                              onSelectConversation(med.conversation_id);
                            }
                            onClose();
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-muted/70 transition group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {med.mime_type.startsWith("image/") ? (
                              <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                            ) : (
                              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-medium text-foreground truncate">
                                {med.file_name}
                              </span>
                              {med.original_prompt && (
                                <span className="text-[11px] text-muted-foreground truncate">
                                  Prompt: {med.original_prompt}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition">
                            View file →
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
