import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Mic,
  MoreVertical,
  Square,
  X,
  Plus,
  History,
  Settings as SettingsIcon,
  Trash2,
  Camera,
  Monitor,
  Eye,
  EyeOff,
  Radio,
  Menu,
  SquarePen,
  Pencil,
  Check,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Video as VideoIcon,
  Sparkles,
  Lightbulb,
  Copy,
  Download,
  Maximize2,
  KeyRound,
  Shield,
  Clock,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { CameraPanel } from "@/components/CameraPanel";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { AudioWaveform } from "@/components/AudioWaveform";
import { ImageModal } from "@/components/ImageModal";
import { ImageGeneration } from "@/components/ImageGeneration";
import { InvitationKeyScreen } from "@/components/InvitationKeyScreen";
import { InvitationKeysSettingsSection } from "@/components/InvitationKeysSettingsSection";
import { SearchDialog } from "@/components/SearchDialog";
import { authService, type AuthState } from "@/lib/assistant/auth-service";
import { audioRecorder, type AudioCaptureSession } from "@/lib/assistant/audio-recorder";
import { detectImageIntent } from "@/lib/assistant/image-intent";
import { attachmentContextService } from "@/lib/assistant/attachment-context";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { detectVisualIntent, type VisualSource } from "@/lib/assistant/intent";
import { getRecognition, Speaker } from "@/lib/assistant/speech";
import { realtimeSessionService, type SessionContext } from "@/lib/assistant/session-manager";
import { settingsService } from "@/lib/assistant/settings-service";
import { historyService } from "@/lib/assistant/history-service";
import {
  type Conversation,
  type Msg,
  type ChatAttachment,
  type Settings,
  DEFAULT_SETTINGS,
  loadConversations,
  loadSettings,
  saveConversations,
  saveSettings,
  fetchConversationsFromDb,
  syncConversationToDb,
  deleteConversationFromDbRemote,
  clearAllConversationsFromDbRemote,
  fetchSettingsFromDb,
  syncSettingsToDb,
  uid,
} from "@/lib/assistant/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Echo — Voice assistant" },
      {
        name: "description",
        content: "Talk naturally. Echo listens, sees when needed, and answers out loud.",
      },
      { property: "og:title", content: "Echo — Voice assistant" },
      {
        property: "og:description",
        content: "Talk naturally. Echo listens, sees when needed, and answers out loud.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Assistant,
});

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return "Just now";
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

type Phase = "idle" | "listening" | "thinking" | "speaking";

function AccessTimerCountdown({ expiresAt }: { expiresAt: number | null }) {
  const [remainingMs, setRemainingMs] = useState<number>(() => {
    if (!expiresAt) return 0;
    return Math.max(0, expiresAt - Date.now());
  });

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const rem = Math.max(0, expiresAt - Date.now());
      setRemainingMs(rem);
      if (rem <= 0) {
        authService.validateSessionWithServer();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (!expiresAt) {
    return <span className="text-sm font-mono font-bold text-foreground">Permanent Admin</span>;
  }

  const totalSecs = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const formatted = `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

  return (
    <span className="text-sm font-mono font-bold text-foreground tabular-nums">
      {formatted}
    </span>
  );
}

function Assistant() {
  const [authState, setAuthState] = useState<AuthState>(() => authService.getState());
  const [settings, setSettings] = useState<Settings>(() => settingsService.getSettings());
  const [convos, setConvos] = useState<Conversation[]>(() => historyService.getConversations());
  const [current, setCurrent] = useState<Conversation>(() => ({
    id: uid(),
    title: "",
    updatedAt: 0,
    messages: [],
  }));
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [sessionContext, setSessionContext] = useState<SessionContext>(
    () => realtimeSessionService.context,
  );
  const [showConnectedFeedback, setShowConnectedFeedback] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showNvidiaKey, setShowNvidiaKey] = useState(false);
  const [clearHistoryDialogOpen, setClearHistoryDialogOpen] = useState(false);
  const [editingConvoId, setEditingConvoId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const feedbackTimeoutRef = useRef<number | null>(null);
  const currentUserMsgIdRef = useRef<string | null>(null);
  const currentAsstMsgIdRef = useRef<string | null>(null);
  const currentSpokenTextRef = useRef("");
  const activeImageOperationsRef = useRef<Set<string>>(new Set());
  const completedImageOperationsRef = useRef<Set<string>>(new Set());

  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  type DictationState = "idle" | "requesting" | "recording" | "finalizing";
  const [dictationState, setDictationState] = useState<DictationState>("idle");
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [dictationPartialText, setDictationPartialText] = useState("");
  const dictationSessionRef = useRef<AudioCaptureSession | null>(null);
  const dictationSpeechRecRef = useRef<ReturnType<typeof getRecognition>>(null);
  const dictationFinalTextRef = useRef("");
  const dictationInterimTextRef = useRef("");
  const dictationOperationIdRef = useRef(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraPanelOpen, setIsCameraPanelOpen] = useState(false);
  const [isCameraInitializing, setIsCameraInitializing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraSessionSeqRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<ReturnType<typeof getRecognition>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const currentGenerationIdRef = useRef<string | null>(null);
  const [isImageGenerating, setIsImageGenerating] = useState(false);
  const isGenerating = Boolean(streamingMessageId) || isImageGenerating;
  const speakerRef = useRef<Speaker | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const isAtBottomRef = useRef(true);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const prevUserIdRef = useRef<string | null>(authService.getUserId());
  const stateRef = useRef({ current, settings, phase, sessionContext, isGenerating });
  stateRef.current = { current, settings, phase, sessionContext, isGenerating };

  // Global Ctrl+K / Cmd+K listener to trigger search modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Load persisted data after hydration & sync with Supabase PostgreSQL
  useEffect(() => {
    const unsubAuth = authService.subscribe((s) => {
      setAuthState(s);

      // Account switch or logout: wipe transient in-memory chat state and reload new user's isolated data
      if (s.userId !== prevUserIdRef.current) {
        prevUserIdRef.current = s.userId;
        abortRef.current?.abort();
        abortRef.current = null;
        setCurrent({
          id: uid(),
          title: "",
          updatedAt: 0,
          messages: [],
        });
        setPendingAttachments([]);
        setInput("");
        setInterim("");
        setStreamingMessageId(null);
        setIsImageGenerating(false);

        if (s.status === "authenticated" && s.userId) {
          const userConvos = historyService.getConversations(s.userId);
          setConvos(userConvos);
          historyService.syncRemote(s.userId).then((dbList) => {
            if (dbList) setConvos(dbList);
          });
          const userSettings = settingsService.load(s.userId);
          setSettings(userSettings);
          fetchSettingsFromDb().then((dbSettings) => {
            if (dbSettings) {
              settingsService.updateSettings(
                dbSettings,
                realtimeSessionService.context.state,
                s.userId || undefined,
              );
            }
          });
        } else {
          setConvos([]);
        }
      }
    });
    authService.init();

    const unsubSettings = settingsService.subscribe((s) => {
      setSettings(s);
    });

    if (authService.isAuthenticated()) {
      historyService.syncRemote(authService.getUserId() || undefined).then((dbList) => {
        if (dbList && dbList.length > 0) {
          setConvos(dbList);
        }
      });

      fetchSettingsFromDb().then((dbSettings) => {
        if (dbSettings) {
          settingsService.updateSettings(
            dbSettings,
            realtimeSessionService.context.state,
            authService.getUserId() || undefined,
          );
        }
      });
    }

    const sp = new Speaker();
    sp.onStart = () => setPhase("speaking");
    sp.onIdle = () => {
      setPhase((p) => (p === "speaking" ? "idle" : p));
      if (stateRef.current.settings.handsFree && !abortRef.current)
        setTimeout(() => startListening(), 250);
    };
    speakerRef.current = sp;
    const loadVoices = () => setVoices(speechSynthesis.getVoices());
    if (typeof speechSynthesis !== "undefined") {
      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    // Auto-focus input when the app loads
    inputRef.current?.focus();
    return () => {
      currentGenerationIdRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
      unsubAuth();
      unsubSettings();
      sp.stop();
      realtimeSessionService.stop();
      audioRecorder.release();
      dictationSpeechRecRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync data on successful authentication state change
  useEffect(() => {
    if (authState.status === "authenticated") {
      historyService.syncRemote().then((dbList) => {
        if (dbList && dbList.length > 0) {
          setConvos(dbList);
        }
      });
      fetchSettingsFromDb().then((dbSettings) => {
        if (dbSettings) {
          settingsService.updateSettings(dbSettings, realtimeSessionService.context.state);
        }
      });
    }
  }, [authState.status]);

  useEffect(() => {
    if (speakerRef.current) {
      speakerRef.current.voiceURI = settings.voiceURI;
      speakerRef.current.rate = settings.rate;
    }
  }, [settings]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Auto-scroll only if user is already near bottom (within 120px)
    if (isAtBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [current.messages, interim]);

  // Restore scroll position on conversation switch
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollPositionsRef.current[current.id];
    if (saved !== undefined) {
      el.scrollTop = saved;
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 100;
    } else {
      el.scrollTop = el.scrollHeight;
      isAtBottomRef.current = true;
    }
  }, [current.id]);

  // Auto-resize textarea height to accommodate multiline input
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const handleCopyMessage = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      toast("Failed to copy message");
    }
  };

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    scrollPositionsRef.current[stateRef.current.current.id] = el.scrollTop;
    // Check if user is within 100px from the bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 100;
    isAtBottomRef.current = atBottom;
  }, []);

  useEffect(() => {
    realtimeSessionService.setVideoElementGetter(() => videoRef.current);

    realtimeSessionService.setCallbacks({
      onUserTranscription: (conversationId, text) => {
        if (!text.trim()) return;
        currentSpokenTextRef.current = (currentSpokenTextRef.current + " " + text.trim()).trim();
        setInterim("");
        setCurrent((prev) => {
          if (prev.id !== conversationId) return prev;
          const messages = [...prev.messages];
          if (!currentUserMsgIdRef.current) {
            currentUserMsgIdRef.current = uid();
            messages.push({ id: currentUserMsgIdRef.current, role: "user", text: text.trim() });
          } else {
            const idx = messages.findIndex((m) => m.id === currentUserMsgIdRef.current);
            if (idx !== -1) {
              const prevText = messages[idx]!.text;
              messages[idx] = { ...messages[idx]!, text: (prevText + " " + text.trim()).trim() };
            } else {
              messages.push({ id: currentUserMsgIdRef.current, role: "user", text: text.trim() });
            }
          }
          const next = {
            ...prev,
            title: prev.title || text.trim().slice(0, 60),
            updatedAt: Date.now(),
            messages,
          };
          persist(next);
          return next;
        });
      },
      onAssistantTranscription: (conversationId, text) => {
        if (!text) return;
        currentUserMsgIdRef.current = null;
        setCurrent((prev) => {
          if (prev.id !== conversationId) return prev;
          const messages = [...prev.messages];
          if (!currentAsstMsgIdRef.current) {
            currentAsstMsgIdRef.current = uid();
            messages.push({ id: currentAsstMsgIdRef.current, role: "assistant", text });
          } else {
            const idx = messages.findIndex((m) => m.id === currentAsstMsgIdRef.current);
            if (idx !== -1) {
              const prevText = messages[idx]!.text;
              messages[idx] = { ...messages[idx]!, text: prevText + text };
            } else {
              messages.push({ id: currentAsstMsgIdRef.current, role: "assistant", text });
            }
          }
          const next = { ...prev, updatedAt: Date.now(), messages };
          persist(next);
          return next;
        });
      },
      onText: (conversationId, text) => {
        if (!text) return;
        currentUserMsgIdRef.current = null;
        setCurrent((prev) => {
          if (prev.id !== conversationId) return prev;
          const messages = [...prev.messages];
          if (!currentAsstMsgIdRef.current) {
            currentAsstMsgIdRef.current = uid();
            messages.push({ id: currentAsstMsgIdRef.current, role: "assistant", text });
          } else {
            const idx = messages.findIndex((m) => m.id === currentAsstMsgIdRef.current);
            if (idx !== -1) {
              messages[idx] = { ...messages[idx]!, text: messages[idx]!.text + text };
            } else {
              messages.push({ id: currentAsstMsgIdRef.current, role: "assistant", text });
            }
          }
          const next = { ...prev, updatedAt: Date.now(), messages };
          persist(next);
          return next;
        });
      },
      onTurnComplete: () => {
        currentAsstMsgIdRef.current = null;
        currentUserMsgIdRef.current = null;
        const spoken = currentSpokenTextRef.current.trim();
        currentSpokenTextRef.current = "";
        if (spoken) {
          const hasExisting = stateRef.current.current.messages.some(
            (m) => (m.attachments && m.attachments.length > 0) || m.image,
          );
          const intent = detectImageIntent(spoken, hasExisting);
          if (intent.type === "generate") {
            generateImageAction(stateRef.current.current.id, intent.prompt, true);
          } else if (intent.type === "edit") {
            editImageAction(
              stateRef.current.current.id,
              intent.editInstruction || intent.prompt,
              true,
            );
          }
        }
      },
      onInterrupted: () => {
        currentAsstMsgIdRef.current = null;
        currentUserMsgIdRef.current = null;
        toast("Interrupted");
      },
      onError: (_conversationId, err) => {
        if (isCameraInitializing || isCameraPanelOpen) {
          setCameraError(err);
          setIsCameraInitializing(false);
        }
        toast(err);
      },
      onStateChange: (ctx) => {
        if (ctx.connectionStatus === "connected") {
          setShowConnectedFeedback(true);
          if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
          feedbackTimeoutRef.current = window.setTimeout(() => {
            setShowConnectedFeedback(false);
          }, 5000);
        } else if (ctx.connectionStatus === "disconnected") {
          setShowConnectedFeedback(false);
        }
      },
    });

    const unsubscribe = realtimeSessionService.subscribe((ctx) => {
      setSessionContext(ctx);
    });

    return () => {
      unsubscribe();
    };
  }, [isCameraInitializing, isCameraPanelOpen]);

  // Synchronize camera panel opening and closing with session lifecycle states
  useEffect(() => {
    if (sessionContext.state === "VIDEO_ACTIVE") {
      setIsCameraPanelOpen(true);
      setIsCameraInitializing(false);
      setCameraError(null);
    } else if (
      (sessionContext.state === "IDLE" || sessionContext.state === "VOICE_ACTIVE") &&
      !isCameraInitializing &&
      !cameraError
    ) {
      setIsCameraPanelOpen(false);
    } else if (sessionContext.state === "ERROR") {
      if (isCameraPanelOpen) {
        setIsCameraInitializing(false);
        setCameraError(sessionContext.errorMessage || "Camera session error");
      }
    }
  }, [
    sessionContext.state,
    isCameraInitializing,
    isCameraPanelOpen,
    cameraError,
    sessionContext.errorMessage,
  ]);

  // Sync media stream with video DOM element immediately when stream or panel is ready
  useEffect(() => {
    const stream = realtimeSessionService.getActiveStream();
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [sessionContext.state, isCameraPanelOpen]);

  // Keep live playback rate in sync with settings
  useEffect(() => {
    realtimeSessionService.setPlaybackRate(settings.rate);
  }, [settings.rate]);

  const captureFrame = (): string | undefined => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  };

  // ---------- Conversation ----------
  const persist = (conv: Conversation) => {
    if (conv.messages.length === 0) return;
    setConvos((prev) => {
      const next = [conv, ...prev.filter((c) => c.id !== conv.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      saveConversations(next);
      syncConversationToDb(conv);
      return next;
    });
  };

  const updateConversationMessages = (
    targetConvId: string,
    updater: (messages: Msg[]) => Msg[],
  ) => {
    if (stateRef.current.current.id === targetConvId) {
      setCurrent((prev) => {
        if (prev.id !== targetConvId) return prev;
        const messages = updater(prev.messages);
        const next = { ...prev, updatedAt: Date.now(), messages };
        persist(next);
        return next;
      });
    } else {
      setConvos((prev) => {
        const existing = prev.find((c) => c.id === targetConvId);
        if (!existing) return prev;
        const messages = updater(existing.messages);
        const nextConv = { ...existing, updatedAt: Date.now(), messages };
        const nextList = [nextConv, ...prev.filter((c) => c.id !== targetConvId)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        saveConversations(nextList);
        syncConversationToDb(nextConv);
        return nextList;
      });
    }
  };

  const handleRenameSave = (id: string) => {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingConvoId(null);
      return;
    }
    setConvos((prev) => {
      const next = prev.map((c) =>
        c.id === id ? { ...c, title: trimmed, updatedAt: Date.now() } : c,
      );
      saveConversations(next);
      const target = next.find((c) => c.id === id);
      if (target) syncConversationToDb(target);
      return next;
    });
    if (current.id === id) {
      setCurrent((prev) => ({ ...prev, title: trimmed }));
    }
    setEditingConvoId(null);
    toast("Conversation renamed");
  };

  const handleDeleteConvo = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = convos.filter((x) => x.id !== id);
    setConvos(next);
    saveConversations(next);
    deleteConversationFromDbRemote(id);
    if (current.id === id) {
      newChat();
    }
    toast("Conversation deleted");
  };

  const startVoiceForConversation = async (target: Conversation) => {
    interrupt();
    setInterim("");
    setInput("");
    setCurrent(target);
    setHistoryOpen(false);

    if (
      sessionContext.state === "VOICE_ACTIVE" &&
      sessionContext.selectedConversationId === target.id
    ) {
      await realtimeSessionService.stop();
      return;
    }

    await realtimeSessionService.switchInteraction(target.id, "voice", settings);
  };

  const openCameraMode = async (conversationId: string) => {
    const currentSeq = ++cameraSessionSeqRef.current;
    setCameraError(null);
    setIsCameraPanelOpen(true);
    setIsCameraInitializing(true);

    try {
      const ok = await realtimeSessionService.switchInteraction(
        conversationId,
        "video",
        settings,
        {
          videoElement: videoRef.current,
        },
      );

      // Check if user cancelled or closed while starting
      if (cameraSessionSeqRef.current !== currentSeq) {
        if (!isCameraPanelOpen) {
          await realtimeSessionService.stop();
        }
        return;
      }

      if (!ok) {
        setIsCameraInitializing(false);
        const ctxErr = realtimeSessionService.context.errorMessage;
        if (ctxErr) {
          setCameraError(ctxErr);
        }
      } else {
        setIsCameraInitializing(false);
      }
    } catch (err) {
      if (cameraSessionSeqRef.current === currentSeq) {
        setIsCameraInitializing(false);
        setCameraError((err as Error)?.message || "Failed to start camera");
      }
    }
  };

  const stopCameraMode = async () => {
    cameraSessionSeqRef.current += 1;
    setIsCameraPanelOpen(false);
    setIsCameraInitializing(false);
    setCameraError(null);
    await realtimeSessionService.stop();
  };

  const startVideoForConversation = async (target: Conversation) => {
    interrupt();
    setInterim("");
    setInput("");
    setCurrent(target);
    setHistoryOpen(false);

    if (
      (isCameraPanelOpen || sessionContext.state === "VIDEO_ACTIVE") &&
      sessionContext.selectedConversationId === target.id
    ) {
      await stopCameraMode();
      return;
    }

    await openCameraMode(target.id);
  };

  const startScreenForConversation = async (target: Conversation) => {
    interrupt();
    setInterim("");
    setInput("");
    setCurrent(target);
    setHistoryOpen(false);

    if (
      sessionContext.state === "SCREEN_SHARE_ACTIVE" &&
      sessionContext.selectedConversationId === target.id
    ) {
      await realtimeSessionService.stop();
      return;
    }

    await realtimeSessionService.switchInteraction(target.id, "screen", settings);
  };

  const cancelDictation = () => {
    dictationOperationIdRef.current += 1;
    if (dictationSpeechRecRef.current) {
      try {
        dictationSpeechRecRef.current.stop();
      } catch {
        /* ignore */
      }
      dictationSpeechRecRef.current = null;
    }
    if (dictationSessionRef.current) {
      dictationSessionRef.current.stop().catch(() => {});
      dictationSessionRef.current = null;
    }
    audioRecorder.release();
    setAnalyserNode(null);
    setDictationState("idle");
    setDictationPartialText("");
  };

  const startDictation = async () => {
    if (sessionContext.state !== "IDLE") {
      await realtimeSessionService.stop();
    }
    interrupt();
    dictationOperationIdRef.current += 1;
    const opId = dictationOperationIdRef.current;

    dictationFinalTextRef.current = "";
    dictationInterimTextRef.current = "";
    setDictationPartialText("");
    setDictationState("requesting");

    try {
      const session = await audioRecorder.startCapture();
      if (dictationOperationIdRef.current !== opId) {
        session.stop();
        return;
      }

      dictationSessionRef.current = session;
      setAnalyserNode(session.analyser);
      setDictationState("recording");

      const rec = getRecognition();
      if (rec) {
        dictationSpeechRecRef.current = rec;
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e) => {
          if (dictationOperationIdRef.current !== opId) return;
          let finalChunk = "";
          let interimChunk = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]!;
            if (r.isFinal) finalChunk += r[0].transcript;
            else interimChunk += r[0].transcript;
          }
          if (finalChunk) {
            dictationFinalTextRef.current = (
              dictationFinalTextRef.current +
              " " +
              finalChunk
            ).trim();
          }
          dictationInterimTextRef.current = interimChunk.trim();
          const combined = [dictationFinalTextRef.current, dictationInterimTextRef.current]
            .filter(Boolean)
            .join(" ");
          setDictationPartialText(combined);
        };
        rec.onerror = (e) => {
          console.warn("[Dictation SpeechRecognition error]", e);
        };
        rec.onend = () => {
          // keep recorder alive until stopped
        };
        try {
          rec.start();
        } catch {
          // ignore
        }
      }
    } catch {
      if (dictationOperationIdRef.current === opId) {
        setDictationState("idle");
        toast("Microphone access was denied or is unavailable.");
      }
    }
  };

  const stopDictation = async (autoSubmit = false) => {
    const opId = dictationOperationIdRef.current;
    if (dictationState === "idle" || dictationState === "finalizing") return;

    setDictationState("finalizing");

    if (dictationSpeechRecRef.current) {
      try {
        dictationSpeechRecRef.current.stop();
      } catch {
        /* ignore */
      }
      dictationSpeechRecRef.current = null;
    }

    const session = dictationSessionRef.current;
    dictationSessionRef.current = null;
    let blob: Blob | null = null;
    if (session) {
      blob = await session.stop();
    } else {
      audioRecorder.release();
    }
    setAnalyserNode(null);

    if (dictationOperationIdRef.current !== opId) return;

    let recognized = [dictationFinalTextRef.current, dictationInterimTextRef.current]
      .filter(Boolean)
      .join(" ")
      .trim();

    // Fallback to /api/transcribe if Web Speech produced no text and audio was buffered
    if (!recognized && blob && blob.size > 1000) {
      try {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
        });
        reader.readAsDataURL(blob);
        const base64Audio = await base64Promise;
        if (dictationOperationIdRef.current === opId && base64Audio) {
          const res = await authService.fetchWithAuth("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audio: base64Audio,
              mimeType: blob.type || "audio/webm",
              apiKey: stateRef.current.settings.apiKey,
              model: stateRef.current.settings.chatModel,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.text) {
              recognized = data.text.trim();
            }
          }
        }
      } catch (err) {
        console.warn("[Dictation fallback error]", err);
      }
    }

    if (dictationOperationIdRef.current !== opId) return;

    setDictationState("idle");
    setDictationPartialText("");

    if (autoSubmit) {
      if (recognized) {
        const fullText = input.trim() ? `${input.trim()} ${recognized}` : recognized;
        send(fullText);
      } else {
        toast("No speech detected.");
      }
    } else {
      if (recognized) {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${recognized}` : recognized));
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const interrupt = () => {
    currentGenerationIdRef.current = null;
    cancelDictation();
    abortRef.current?.abort();
    abortRef.current = null;
    speakerRef.current?.stop();
    setStreamingMessageId(null);
    activeImageOperationsRef.current.forEach((opId) => {
      completedImageOperationsRef.current.add(opId);
    });
    activeImageOperationsRef.current.clear();
    setIsImageGenerating(false);
    setPhase("idle");
  };

  const handleFileUpload = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast("File is too large. Max size is 25MB.");
      return;
    }
    const tempId = uid();
    setPendingAttachments((prev) => [
      ...prev,
      {
        id: tempId,
        conversationId: stateRef.current.current.id,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        storageRef: "",
        status: "uploading",
        origin: "uploaded",
      },
    ]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversationId", stateRef.current.current.id);

      const res = await authService.fetchWithAuth("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }

      const data = await res.json();
      if (data.attachment) {
        setPendingAttachments((prev) => prev.map((a) => (a.id === tempId ? data.attachment : a)));
        toast(`Attached ${file.name}`);
      }
    } catch (err) {
      setPendingAttachments((prev) => prev.filter((a) => a.id !== tempId));
      toast((err as Error).message || "Failed to upload file");
    }
  };

  const generateImageAction = async (convId: string, prompt: string, fromVoice = false) => {
    const opId = uid();
    const asstMsgId = uid();
    activeImageOperationsRef.current.add(opId);
    setIsImageGenerating(true);

    const asstMsg: Msg = {
      id: asstMsgId,
      role: "assistant",
      text: "",
      generatingImage: true,
      imagePrompt: prompt,
      operationId: opId,
    };

    updateConversationMessages(convId, (messages) => [...messages, asstMsg]);

    try {
      const res = await authService.fetchWithAuth("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: opId,
          conversationId: convId,
          prompt,
          messageId: asstMsgId,
          ...(stateRef.current.settings.nvidiaApiKey
            ? { apiKey: stateRef.current.settings.nvidiaApiKey }
            : {}),
        }),
      });

      const data = await res.json();
      if (completedImageOperationsRef.current.has(opId)) return;
      completedImageOperationsRef.current.add(opId);

      const isSessionValidForSpeech =
        stateRef.current.sessionContext.state !== "IDLE" &&
        stateRef.current.sessionContext.selectedConversationId === convId;

      if (data.imageGenerated && (data.imageUrl || data.dataUrl)) {
        const imgId = data.imageId || opId;
        const mainUrl = data.dataUrl || data.imageUrl;
        const attachment: ChatAttachment = {
          id: imgId,
          conversationId: convId,
          messageId: asstMsgId,
          fileName:
            data.imageName ||
            `${
              prompt
                .slice(0, 30)
                .trim()
                .replace(/[^\w\s-]/g, "") || "generated_image"
            }.png`,
          mimeType: "image/png",
          sizeBytes: 0,
          storageRef: data.imageUrl || mainUrl,
          ...(data.dataUrl ? { dataUrl: data.dataUrl } : {}),
          status: "ready",
          origin: "generated",
          prompt,
          versionNumber: 1,
          versions: [
            {
              id: imgId,
              versionNumber: 1,
              url: mainUrl,
              prompt,
              createdAt: Date.now(),
            },
          ],
          createdAt: Date.now(),
        };

        updateConversationMessages(convId, (messages) =>
          messages.map((m) =>
            m.id === asstMsgId
              ? {
                  ...m,
                  generatingImage: false,
                  generationFailed: false,
                  text: "Here is your generated image:",
                  attachments: [attachment],
                }
              : m,
          ),
        );
      } else {
        updateConversationMessages(convId, (messages) =>
          messages.map((m) =>
            m.id === asstMsgId
              ? {
                  ...m,
                  generatingImage: false,
                  generationFailed: true,
                  imagePrompt: prompt,
                  text: data.errorMessage || "I couldn't generate the image. Please try again.",
                }
              : m,
          ),
        );

        const failureAnnouncement = "I couldn't generate the image. Please try again.";
        if (
          (fromVoice && isSessionValidForSpeech) ||
          (!fromVoice && stateRef.current.settings.speak && stateRef.current.current.id === convId)
        ) {
          speakerRef.current?.say(failureAnnouncement);
        }
      }
    } catch {
      if (completedImageOperationsRef.current.has(opId)) return;
      completedImageOperationsRef.current.add(opId);

      const isSessionValidForSpeech =
        stateRef.current.sessionContext.state !== "IDLE" &&
        stateRef.current.sessionContext.selectedConversationId === convId;

      updateConversationMessages(convId, (messages) =>
        messages.map((m) =>
          m.id === asstMsgId
            ? {
                ...m,
                generatingImage: false,
                generationFailed: true,
                imagePrompt: prompt,
                text: "I couldn't generate the image. Please try again.",
              }
            : m,
        ),
      );

      const failureAnnouncement = "I couldn't generate the image. Please try again.";
      if (
        (fromVoice && stateRef.current.sessionContext.state !== "IDLE") ||
        stateRef.current.settings.speak
      ) {
        speakerRef.current?.say(failureAnnouncement);
      }
    } finally {
      activeImageOperationsRef.current.delete(opId);
      if (activeImageOperationsRef.current.size === 0) {
        setIsImageGenerating(false);
      }
    }
  };

  const editImageAction = async (convId: string, _prompt: string, fromVoice = false) => {
    const editNotice = "Image Editing Coming soon. Stay tuned . You will be Excited";
    toast.info(editNotice);
    const asstMsg: Msg = {
      id: uid(),
      role: "assistant",
      text: editNotice,
    };
    updateConversationMessages(convId, (messages) => [...messages, asstMsg]);
    if (
      (fromVoice && stateRef.current.sessionContext.state !== "IDLE") ||
      stateRef.current.settings.speak
    ) {
      speakerRef.current?.say(editNotice);
    }
  };

  const send = async (raw: string) => {
    let text = raw.trim();
    const attached = [...pendingAttachments];
    setPendingAttachments([]);

    if (!text && attached.length === 0) return;

    // If submitted attachment without question, supply helpful default prompt
    if (!text && attached.length > 0) {
      const hasVid = attached.some((a) => a.mimeType.startsWith("video/"));
      const hasImg = attached.some((a) => a.mimeType.startsWith("image/"));
      if (hasVid) text = "Explain what happens in this video.";
      else if (hasImg) text = "Describe everything visible in this picture.";
      else text = "Explain the contents of the attached file.";
    }

    if (sessionContext.state !== "IDLE") {
      await realtimeSessionService.stop();
    }
    interrupt();
    setInput("");
    setInterim("");
    const { settings: s } = stateRef.current;
    const convId = stateRef.current.current.id;

    const hasExistingMedia =
      attached.some((a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/")) ||
      stateRef.current.current.messages.some(
        (m) =>
          (m.attachments &&
            m.attachments.some(
              (a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/"),
            )) ||
          m.image,
      );

    const imgIntent = detectImageIntent(text, hasExistingMedia);

    if (imgIntent.type === "generate") {
      const userMsg: Msg = {
        id: uid(),
        role: "user",
        text,
        ...(attached.length > 0 ? { attachments: attached } : {}),
      };
      setCurrent((prev) => {
        const next = {
          ...prev,
          title: prev.title || text.slice(0, 60),
          updatedAt: Date.now(),
          messages: [...prev.messages, userMsg],
        };
        persist(next);
        return next;
      });
      await generateImageAction(convId, imgIntent.prompt, false);
      return;
    }

    // If user asks for editing an image
    if (imgIntent.type === "edit") {
      const editNotice = "Image Editing Coming soon. Stay tuned . You will be Excited";
      toast.info(editNotice);
      const userMsg: Msg = {
        id: uid(),
        role: "user",
        text,
        ...(attached.length > 0 ? { attachments: attached } : {}),
      };
      const asstMsg: Msg = {
        id: uid(),
        role: "assistant",
        text: editNotice,
      };
      setCurrent((prev) => {
        const next = {
          ...prev,
          title: prev.title || text.slice(0, 60),
          updatedAt: Date.now(),
          messages: [...prev.messages, userMsg, asstMsg],
        };
        persist(next);
        return next;
      });
      if (s.speak) {
        speakerRef.current?.say(editNotice);
      }
      return;
    }

    let image: string | undefined;
    let source: VisualSource = null;

    // Contextual media resolution for follow-up questions without duplicating attachments
    if (attached.length === 0 && attachmentContextService.isMediaRelatedQuery(text)) {
      const resolved = attachmentContextService.resolveContext(stateRef.current.current, text);
      if (resolved.targetAttachment) {
        if (resolved.targetAttachment.mimeType.startsWith("image/")) {
          if (resolved.targetAttachment.dataUrl) {
            image = resolved.targetAttachment.dataUrl;
          } else {
            const loaded = await attachmentContextService.loadMediaDataUri(
              resolved.targetAttachment.storageRef,
            );
            if (loaded) image = loaded;
          }
        }
      }
    }

    const attachedImg = attached.find((a) => a.mimeType.startsWith("image/"));
    if (attachedImg && !image) {
      if (attachedImg.dataUrl) {
        image = attachedImg.dataUrl;
      } else {
        const loaded = await attachmentContextService.loadMediaDataUri(attachedImg.storageRef);
        if (loaded) image = loaded;
      }
    }

    if (!image && s.autoVision) {
      const currentVisual =
        sessionContext.state === "VIDEO_ACTIVE"
          ? "camera"
          : sessionContext.state === "SCREEN_SHARE_ACTIVE"
            ? "screen"
            : null;
      const intent = detectVisualIntent(text, currentVisual);
      if (intent === "stop" || intent === null) {
        if (currentVisual) {
          await realtimeSessionService.switchInteraction(current.id, "voice", s);
        }
      } else {
        if (intent === "camera") {
          await openCameraMode(current.id);
          if (realtimeSessionService.context.state === "VIDEO_ACTIVE") {
            image = captureFrame();
            source = intent;
          }
        } else {
          const ok = await realtimeSessionService.switchInteraction(
            current.id,
            "screen",
            s,
          );
          if (ok) {
            image = captureFrame();
            source = intent;
          }
        }
      }
    }

    const userMsg: Msg = {
      id: uid(),
      role: "user",
      text,
      ...(image ? { image } : {}),
      ...(source ? { source } : {}),
      ...(attached.length > 0 ? { attachments: attached } : {}),
    };
    const asstMsg: Msg = { id: uid(), role: "assistant", text: "" };
    setCurrent((prev) => ({
      ...prev,
      title: prev.title || text.slice(0, 60),
      updatedAt: Date.now(),
      messages: [...prev.messages, userMsg, asstMsg],
    }));
    const generationId = uid();
    currentGenerationIdRef.current = generationId;
    setPhase("thinking");
    setStreamingMessageId(asstMsg.id);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let full = "";
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const history = [...stateRef.current.current.messages, userMsg].slice(-20);
      const res = await authService.fetchWithAuth("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          apiKey: s.apiKey,
          model: s.chatModel,
          messages: history.map((m, i) => ({
            role: m.role,
            text: m.text,
            ...(i === history.length - 1 && m.image ? { image: m.image } : {}),
            ...(m.attachments && m.attachments.length > 0 ? { attachments: m.attachments } : {}),
          })),
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Something went wrong. Please try again.");
      }
      reader = res.body.getReader();
      const dec = new TextDecoder("utf-8");

      let received = "";
      let displayed = "";
      let isReaderDone = false;
      let readerError: unknown = null;

      // Background reader task that pulls chunks as fast as the network provides
      const readerPromise = (async () => {
        try {
          while (true) {
            const { done, value } = await reader!.read();
            if (done || ctrl.signal.aborted || currentGenerationIdRef.current !== generationId) {
              break;
            }
            const chunk = dec.decode(value, { stream: true });
            if (chunk) {
              received += chunk;
            }
          }
        } catch (err) {
          if ((err as Error)?.name !== "AbortError" && !ctrl.signal.aborted) {
            readerError = err;
          }
        } finally {
          isReaderDone = true;
        }
      })();

      // Pacing animation loop: streams words smoothly (not too fast, not waiting for completion)
      while (!isReaderDone || displayed.length < received.length) {
        if (ctrl.signal.aborted || currentGenerationIdRef.current !== generationId) break;

        if (displayed.length < received.length) {
          const remaining = received.slice(displayed.length);
          // Grab either the next word or up to 4 characters
          const wordMatch = remaining.match(/^(\S+\s*)/);
          const sliceLen = wordMatch ? wordMatch[0].length : Math.min(3, remaining.length);
          displayed += remaining.slice(0, sliceLen);
          full = displayed;

          setCurrent((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) => (m.id === asstMsg.id ? { ...m, text: full } : m)),
                }
              : c,
          );

          // Pacing delay: 25ms per word for a smooth, natural reading pace (adaptive if buffer grows)
          const lag = received.length - displayed.length;
          const delay = lag > 80 ? 10 : lag > 40 ? 18 : 26;
          await new Promise((r) => setTimeout(r, delay));
        } else {
          // Waiting for more network chunks
          await new Promise((r) => setTimeout(r, 20));
        }
      }

      await readerPromise;
      if (readerError && !ctrl.signal.aborted) throw readerError;

      full = received || displayed;
    } catch (e) {
      if ((e as Error).name === "AbortError" || ctrl.signal.aborted) {
        if (!full) full = "…";
      } else {
        // If error occurred after receiving partial text, preserve partial text and append notification
        if (full) {
          full = `${full}\n\n*(Response interrupted. Please try again.)*`;
        } else {
          full = (e as Error).message;
        }
      }
    } finally {
      try {
        reader?.cancel().catch(() => {});
      } catch {
        /* ignore */
      }

      if (currentGenerationIdRef.current === generationId) {
        currentGenerationIdRef.current = null;
        if (abortRef.current === ctrl) {
          abortRef.current = null;
        }
        setStreamingMessageId(null);
        setPhase((p) => (p === "thinking" ? "idle" : p));
      }

      setCurrent((c) => {
        const updatedMessages = c.messages.map((m) =>
          m.id === asstMsg.id ? { ...m, text: full } : m,
        );
        const updated = {
          ...c,
          updatedAt: Date.now(),
          messages: updatedMessages,
        };
        persist(updated);
        return updated;
      });
    }
  };

  // ---------- Listening ----------
  const startListening = () => {
    interrupt();
    const rec = getRecognition();
    if (!rec) {
      toast("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    recRef.current = rec;
    let finalText = "";
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(finalText + interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") toast("Microphone access was not allowed.");
    };
    rec.onend = () => {
      recRef.current = null;
      setPhase((p) => (p === "listening" ? "idle" : p));
      if (finalText.trim()) send(finalText);
      else setInterim("");
    };
    setPhase("listening");
    setInterim("");
    rec.start();
  };

  const startNewChat = async (mode: "text" | "voice" | "video" | "screen" = "text") => {
    interrupt();
    await realtimeSessionService.stop();
    setInterim("");
    setInput("");
    const freshConvo: Conversation = { id: uid(), title: "", updatedAt: 0, messages: [] };
    setCurrent(freshConvo);

    if (mode === "text") {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return;
    }

    if (mode === "voice") {
      await realtimeSessionService.switchInteraction(freshConvo.id, "voice", settings);
    } else if (mode === "video") {
      await openCameraMode(freshConvo.id);
    } else if (mode === "screen") {
      await realtimeSessionService.switchInteraction(freshConvo.id, "screen", settings);
    }
  };

  const newChat = () => startNewChat("text");

  const updateSettings = async (patch: Partial<Settings>) => {
    const res = await settingsService.updateSettings(patch, sessionContext.state);
    if (!res.success && res.error) {
      toast(res.error);
    }
  };

  const isVisualActive = isCameraPanelOpen || sessionContext.state === "VIDEO_ACTIVE";
  const empty = current.messages.length === 0;

  const displayConvos = convos.some((c) => c.id === current.id)
    ? convos
    : current.messages.length > 0 || current.title
      ? [current, ...convos]
      : convos.length > 0
        ? convos
        : [current];

  if (!authService.isAuthenticated()) {
    return <InvitationKeyScreen authState={authState} />;
  }

  return (
    <div className="relative flex h-[100dvh] flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/40 px-3 sm:px-4">
        {/* Left: Hamburger menu + App Title + Active Model Badge + Auth Status */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            aria-label={historyOpen ? "Close history" : "Open history"}
            title="Conversation history"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 select-none">
            <span className="text-[15px] font-semibold tracking-tight">Echo</span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center rounded-full bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="Click to configure settings"
            >
              {settings.chatModel === "gemini-2.5-flash-lite"
                ? "Flash Lite"
                : settings.chatModel === "gemini-2.5-flash"
                  ? "Flash"
                  : "3.1 Flash Lite"}
            </button>
            {sessionContext.state !== "IDLE" && (
              <div
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[11px] font-medium"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    sessionContext.connectionStatus === "connecting"
                      ? "bg-amber-500 animate-pulse"
                      : sessionContext.connectionStatus === "error"
                        ? "bg-destructive"
                        : sessionContext.audioPlaybackStatus === "playing"
                          ? "bg-primary animate-pulse"
                          : sessionContext.microphoneStatus === "active"
                            ? "bg-emerald-500 animate-pulse"
                            : "bg-emerald-500"
                  }`}
                />
                <span className="text-muted-foreground">
                  {sessionContext.connectionStatus === "connecting"
                    ? "Connecting…"
                    : sessionContext.connectionStatus === "error"
                      ? "Error"
                      : sessionContext.audioPlaybackStatus === "playing"
                        ? "Speaking"
                        : sessionContext.microphoneStatus === "active"
                          ? "Listening"
                          : "Ready"}
                </span>
                <button
                  type="button"
                  onClick={() => realtimeSessionService.stop()}
                  title="Disconnect live session"
                  aria-label="Disconnect live session"
                  className="ml-0.5 rounded hover:text-foreground text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: New Chat action + Settings */}
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="New chat"
                title="Start new chat"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none"
              >
                <SquarePen className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 shadow-2xl border border-border/80">
              <DropdownMenuLabel>Start new chat</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => startNewChat("text")} className="cursor-pointer">
                <SquarePen className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">New Chat</span>
                  <span className="text-[11px] text-muted-foreground font-normal">
                    Standard text chat
                  </span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={() => startNewChat("voice")} className="cursor-pointer">
                <Mic className="mr-2 h-4 w-4 text-primary" />
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">Voice</span>
                  <span className="text-[11px] text-muted-foreground font-normal">
                    Realtime voice assistant
                  </span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => startNewChat("video")} className="cursor-pointer">
                <Camera className="mr-2 h-4 w-4 text-primary" />
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">Video Visual</span>
                  <span className="text-[11px] text-muted-foreground font-normal">
                    Camera feed with AI
                  </span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => startNewChat("screen")} className="cursor-pointer">
                <Monitor className="mr-2 h-4 w-4 text-primary" />
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">Screen Share</span>
                  <span className="text-[11px] text-muted-foreground font-normal">
                    Screen capture with AI
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Screen share background video context (kept clean and minimal) */}
      {sessionContext.state === "SCREEN_SHARE_ACTIVE" && (
        <div className="relative mx-5 mb-2 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-[4/3] max-h-[38vh] w-full object-cover"
          />
          <button
            aria-label="Close"
            onClick={() => realtimeSessionService.stop()}
            className="absolute right-3 top-3 rounded-full bg-background/90 p-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Camera bottom panel (smooth bottom-sheet transition: touches left, right, bottom; rounded top corners 28px; occupies bottom 60%) */}
      <CameraPanel
        isOpen={isCameraPanelOpen}
        videoRef={videoRef}
        onClose={stopCameraMode}
        onFlipCamera={() => realtimeSessionService.flipCamera(settings)}
        onToggleTorch={() => realtimeSessionService.toggleTorch()}
        isTorchOn={realtimeSessionService.getTorchState()}
        isInitializing={isCameraInitializing}
        errorMessage={cameraError}
        onRetry={() => openCameraMode(current.id)}
      />

      {/* Conversation */}
      <main
        ref={scrollRef}
        onScroll={handleScroll}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.types.includes("Files")) {
            setIsDraggingOver(true);
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDraggingOver(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOver(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
              await handleFileUpload(e.dataTransfer.files[i]!);
            }
          }
        }}
        className="relative flex-1 overflow-y-auto px-5"
      >
        {/* Drag and drop overlay */}
        <AnimatePresence>
          {isDraggingOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-x-5 inset-y-3 z-30 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-primary bg-background/85 backdrop-blur-xs shadow-xl"
            >
              <Paperclip className="h-10 w-10 text-primary animate-bounce mb-2" />
              <p className="text-base font-semibold text-foreground">Drop files here</p>
              <p className="text-xs text-muted-foreground mt-1">
                Images, PDF documents, code, or text files
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Discreet "Connected" feedback banner shown for ~5 seconds when connection starts */}
        <AnimatePresence>
          {showConnectedFeedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="sticky top-2 z-10 flex justify-center py-1"
            >
              <div className="rounded-full bg-muted/90 px-3 py-1 text-xs font-medium text-foreground backdrop-blur-sm border border-border/50 shadow-sm">
                Connected
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {empty && !interim ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-4">
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
              How can I help you today?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-md">
              Start typing, use voice dictation, or upload media for multimodal analysis.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-lg">
              <button
                type="button"
                onClick={() => {
                  setInput("Generate an image of ");
                  inputRef.current?.focus();
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Generate an image</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <ImageIcon className="h-3.5 w-3.5 text-primary" />
                <span>Analyze image or video</span>
              </button>
              <button
                type="button"
                onClick={startDictation}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <Mic className="h-3.5 w-3.5 text-primary" />
                <span>Voice dictation</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInput("Help me brainstorm ideas for ");
                  inputRef.current?.focus();
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <Lightbulb className="h-3.5 w-3.5 text-primary" />
                <span>Brainstorm ideas</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-5 py-4">
            {current.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} id={`msg-${m.id}`} className="flex flex-col items-end gap-1.5 scroll-mt-20">
                  {m.image && !m.attachments?.some((att) => att.mimeType.startsWith("image/")) && (
                    <img
                      src={m.image}
                      alt=""
                      onClick={() => setSelectedImageModal(m.image!)}
                      className="w-24 rounded-lg border border-border cursor-pointer hover:opacity-90 transition"
                    />
                  )}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-end mb-1">
                      {m.attachments.map((att) =>
                        att.mimeType.startsWith("video/") ? (
                          <div
                            key={att.id}
                            className="overflow-hidden rounded-xl border border-border max-w-[220px] sm:max-w-[260px] bg-black/90 shadow-xs"
                          >
                            <video
                              src={att.storageRef}
                              controls
                              playsInline
                              preload="metadata"
                              className="w-full h-auto max-h-40 object-contain"
                            />
                            <div className="px-2.5 py-1 text-[11px] font-mono text-muted-foreground truncate border-t border-border/40 bg-muted/40">
                              {att.fileName}
                            </div>
                          </div>
                        ) : att.mimeType.startsWith("image/") ? (
                          <div
                            key={att.id}
                            onClick={() => setSelectedImageModal(att.dataUrl || att.storageRef)}
                            className="group relative cursor-pointer overflow-hidden rounded-xl border border-border max-w-[160px] shadow-xs"
                          >
                            <img
                              src={att.dataUrl || att.storageRef}
                              alt={att.fileName ? att.fileName.slice(0, 30) : "Image"}
                              onError={(e) => {
                                if (att.dataUrl && e.currentTarget.src !== att.dataUrl) {
                                  e.currentTarget.src = att.dataUrl;
                                }
                              }}
                              className="w-full h-auto object-cover max-h-28 transition group-hover:scale-105"
                            />
                          </div>
                        ) : (
                          <div
                            key={att.id}
                            className="flex items-center gap-2 rounded-xl border border-border bg-muted/80 px-3 py-1.5 text-xs text-foreground"
                          >
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <span className="truncate max-w-[150px] font-medium">
                              {att.fileName}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-muted/90 px-4 py-2.5 text-[15px] leading-relaxed select-text shadow-xs">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} id={`msg-${m.id}`} className="group max-w-[92%] leading-relaxed flex flex-col gap-2 scroll-mt-20">
                  {m.generatingImage && (
                    <div className="my-1">
                      <ImageGeneration prompt={m.imagePrompt || ""} generating={true} />
                    </div>
                  )}
                  {m.text ? (
                    <MarkdownMessage content={m.text} isStreaming={streamingMessageId === m.id} />
                  ) : !m.generatingImage ? (
                    <span className="inline-flex gap-1 py-2">
                      <Dot />
                      <Dot d={150} />
                      <Dot d={300} />
                    </span>
                  ) : null}
                  {m.text && streamingMessageId !== m.id && (
                    <div className="flex items-center gap-2 pt-0.5 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(m.id, m.text)}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition px-2 py-1 rounded-lg hover:bg-muted/60 cursor-pointer"
                        aria-label="Copy response"
                      >
                        {copiedMsgId === m.id ? (
                          <>
                            <Check className="h-3 w-3 text-green-500" />
                            <span className="text-green-500">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                  {m.generationFailed && m.imagePrompt && (
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const hasExistingMedia = current.messages.some(
                            (msg) => (msg.attachments && msg.attachments.length > 0) || msg.image,
                          );
                          const intent = detectImageIntent(m.imagePrompt!, hasExistingMedia);
                          if (intent.type === "edit") {
                            editImageAction(current.id, m.imagePrompt!);
                          } else {
                            generateImageAction(current.id, m.imagePrompt!);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border border-border bg-background hover:bg-muted text-foreground transition-all cursor-pointer shadow-xs active:scale-95"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry
                      </button>
                    </div>
                  )}
                  {m.requiresDisambiguation &&
                    m.candidateImages &&
                    m.candidateImages.length > 0 && (
                      <div className="mt-2.5 flex flex-col gap-2 rounded-2xl border border-border/80 bg-muted/30 p-3 max-w-md">
                        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span>Select an image to continue:</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                          {m.candidateImages.map((candidate, idx) => (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={() => {
                                toast.info(
                                  "Image Editing Coming soon. Stay tuned . You will be Excited",
                                );
                              }}
                              className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-background hover:border-primary/80 transition-all cursor-pointer text-left hover:shadow-md active:scale-98"
                            >
                              <div className="aspect-square w-full bg-black/40 overflow-hidden relative">
                                <img
                                  src={candidate.url}
                                  alt={candidate.prompt}
                                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors flex items-center justify-center">
                                  <span className="opacity-0 group-hover:opacity-100 bg-background/90 text-foreground text-[10px] font-medium px-2 py-0.5 rounded-full shadow-xs transition-opacity">
                                    Select
                                  </span>
                                </div>
                              </div>
                              <div className="p-2 flex flex-col gap-0.5">
                                <span className="text-[11px] font-semibold text-foreground truncate">
                                  Image #{idx + 1}
                                </span>
                                <span className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">
                                  {candidate.prompt || "Generated image"}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex flex-col gap-2 mt-1">
                      {m.attachments.map((att) =>
                        att.mimeType.startsWith("video/") ? (
                          <div
                            key={att.id}
                            className="overflow-hidden rounded-2xl border border-border max-w-sm sm:max-w-md bg-black/90 shadow-md"
                          >
                            <video
                              src={att.storageRef}
                              controls
                              playsInline
                              preload="metadata"
                              className="w-full h-auto max-h-56 object-contain"
                            />
                            <div className="p-2.5 text-xs text-muted-foreground border-t border-border/40 bg-muted/40 truncate">
                              {att.fileName}
                            </div>
                          </div>
                        ) : att.mimeType.startsWith("image/") ? (
                          (() => {
                            const activeVerId = selectedVersions[att.id];
                            const currentVersionNode =
                              att.versions && activeVerId
                                ? att.versions.find((v) => v.id === activeVerId) ||
                                  att.versions[att.versions.length - 1]
                                : att.versions && att.versions.length > 0
                                  ? att.versions[att.versions.length - 1]
                                  : undefined;

                            const displayUrl = currentVersionNode?.url || att.storageRef;
                            const displayPrompt = currentVersionNode?.prompt || att.prompt;
                            const displayVersionNum =
                              currentVersionNode?.versionNumber || att.versionNumber || 1;

                            return (
                              <div
                                key={att.id}
                                className="group relative overflow-hidden rounded-2xl border border-border shadow-md max-w-[260px] sm:max-w-[280px] bg-muted/20 flex flex-col"
                              >
                                <div
                                  onClick={() => setSelectedImageModal(displayUrl)}
                                  className="cursor-pointer overflow-hidden aspect-square w-full bg-black/40 flex items-center justify-center relative"
                                >
                                  <img
                                    src={displayUrl}
                                    alt={
                                      att.fileName ? att.fileName.slice(0, 30) : "Generated image"
                                    }
                                    onError={(e) => {
                                      if (att.dataUrl && e.currentTarget.src !== att.dataUrl) {
                                        e.currentTarget.src = att.dataUrl;
                                      }
                                    }}
                                    className="w-full h-full object-cover transition-transform group-hover:scale-[1.01]"
                                  />
                                  {att.versions && att.versions.length > 1 && (
                                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-[10px] font-mono font-medium text-white border border-white/10 shadow-xs">
                                      v{displayVersionNum} of {att.versions.length}
                                    </div>
                                  )}
                                </div>
                                {displayPrompt ? (
                                  <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/40 bg-muted/30 truncate">
                                    {displayPrompt}
                                  </div>
                                ) : null}

                                {/* Action Bar */}
                                <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5 border-t border-border/40 bg-muted/40">
                                  <div className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        toast.info(
                                          "Image Editing Coming soon. Stay tuned . You will be Excited",
                                        );
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/80 transition cursor-pointer"
                                      aria-label="Edit image"
                                    >
                                      <Pencil className="h-3 w-3" />
                                      <span>Edit</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const link = document.createElement("a");
                                        link.href = displayUrl;
                                        link.download = `v${displayVersionNum}-${att.fileName || "image.png"}`;
                                        link.click();
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/80 transition cursor-pointer"
                                      aria-label="Download image"
                                    >
                                      <Download className="h-3 w-3" />
                                      <span>Download</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedImageModal(displayUrl)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/80 transition cursor-pointer"
                                      aria-label="Expand image"
                                    >
                                      <Maximize2 className="h-3 w-3" />
                                      <span>Expand</span>
                                    </button>
                                  </div>

                                  {att.versions && att.versions.length > 1 && (
                                    <div className="flex items-center gap-1.5 text-xs ml-auto">
                                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                        Version:
                                      </span>
                                      <select
                                        value={currentVersionNode?.id || att.id}
                                        onChange={(e) => {
                                          setSelectedVersions((prev) => ({
                                            ...prev,
                                            [att.id]: e.target.value,
                                          }));
                                        }}
                                        className="bg-background text-foreground border border-border/80 rounded-md px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer hover:border-foreground/40 transition"
                                        aria-label="Select image version"
                                      >
                                        {att.versions.map((ver) => (
                                          <option key={ver.id} value={ver.id}>
                                            v{ver.versionNumber}{" "}
                                            {ver.prompt ? `— ${ver.prompt.slice(0, 18)}...` : ""}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div
                            key={att.id}
                            className="flex items-center gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2 text-xs text-foreground max-w-xs"
                          >
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <span className="truncate font-medium">{att.fileName}</span>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
            {interim && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl border border-dashed border-border px-4 py-2.5 text-[15px] text-muted-foreground">
                  {interim}
                </div>
              </div>
            )}
            {/* Reserve space smoothly for the camera bottom sheet so messages stay visible above it without jumping */}
            <div
              className="shrink-0 transition-[height] duration-450 ease-out"
              style={{ height: isCameraPanelOpen ? "60vh" : 0 }}
              aria-hidden="true"
            />
          </div>
        )}
      </main>

      {/* Input bar - animatedly disappears when camera or screen share is used */}
      <AnimatePresence>
        {!isVisualActive && (
          <motion.footer
            key="input-footer"
            initial={{ opacity: 0, y: 30, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 40, height: 0 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="shrink-0 overflow-hidden px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
          >
            <div className="mx-auto max-w-2xl">
              {/* Pending attachment preview strip */}
              {pendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 py-1.5 mb-2">
                  {pendingAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="group flex items-center gap-2 rounded-xl border border-border bg-muted/80 pl-2.5 pr-1.5 py-1 text-xs text-foreground shadow-xs animate-in fade-in transition"
                    >
                      {att.status === "uploading" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                      ) : att.mimeType.startsWith("image/") ? (
                        att.storageRef ? (
                          <img
                            src={att.storageRef}
                            alt=""
                            className="h-5 w-5 rounded object-cover shrink-0"
                          />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                        )
                      ) : att.mimeType.startsWith("video/") ? (
                        <VideoIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                      )}
                      <span className="max-w-[140px] truncate font-medium">{att.fileName}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id))
                        }
                        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground transition cursor-pointer"
                        aria-label="Remove attachment"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <AnimatePresence mode="wait">
                {dictationState === "idle" ? (
                  <motion.form
                    key="text-input-mode"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.28, ease: "easeInOut" }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (isGenerating) return;
                      if (input.trim() || pendingAttachments.length > 0) {
                        send(input);
                      }
                    }}
                    className="flex items-end gap-2 rounded-2xl sm:rounded-[26px] border border-border bg-background py-1.5 pl-3 pr-2 shadow-sm focus-within:ring-1 focus-within:ring-ring/50 transition-all"
                  >
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Attach file"
                      title="Attach file, image, or video"
                      className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground shrink-0 cursor-pointer self-end mb-0.5"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*,.pdf,.txt,.md,.json,.js,.ts,.py,.csv,.docx,.xlsx"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleFileUpload(e.target.files[0]!);
                          e.target.value = "";
                        }
                      }}
                    />
                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (isGenerating) return;
                          if (input.trim() || pendingAttachments.length > 0) {
                            send(input);
                          }
                        }
                      }}
                      placeholder="Ask anything..."
                      className="min-w-0 flex-1 bg-transparent text-[15px] leading-relaxed outline-none resize-none placeholder:text-muted-foreground py-1.5 max-h-40 overflow-y-auto"
                    />
                    <div className="flex items-center gap-1 shrink-0 self-end mb-0.5">
                      <button
                        type="button"
                        onClick={startDictation}
                        aria-label="Voice input"
                        title="Start voice dictation"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
                      >
                        <Mic className="h-4 w-4" />
                      </button>
                      {isGenerating ? (
                        <button
                          type="button"
                          onClick={interrupt}
                          aria-label="Stop"
                          title="Stop generation"
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors cursor-pointer"
                        >
                          <Square className="h-3.5 w-3.5 fill-current" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          aria-label="Send"
                          disabled={!input.trim() && pendingAttachments.length === 0}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95 cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </motion.form>
                ) : (
                  <motion.div
                    key="voice-dictation-mode"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.28, ease: "easeInOut" }}
                    className="flex min-h-[52px] items-center gap-2 sm:gap-3 rounded-2xl sm:rounded-[26px] border border-border bg-background py-1.5 pl-4 pr-1.5 shadow-sm"
                  >
                    {/* Left: Recording indicator */}
                    <div className="flex items-center gap-2 shrink-0 select-none pl-1">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                      </span>
                      {dictationState === "requesting" ? (
                        <span className="text-[12px] text-muted-foreground">Listening...</span>
                      ) : dictationState === "finalizing" ? (
                        <span className="text-[12px] text-muted-foreground">Processing...</span>
                      ) : null}
                    </div>

                    {/* Center: Live Audio Waveform & optional partial text */}
                    <div className="flex-1 flex flex-col justify-center min-w-0 px-1 sm:px-2">
                      <AudioWaveform
                        analyser={analyserNode}
                        isRecording={dictationState === "recording"}
                        className="h-7 w-full text-foreground/80"
                        barCount={28}
                      />
                      {dictationPartialText ? (
                        <div className="truncate text-[11px] text-muted-foreground/80 text-center font-normal">
                          {dictationPartialText}
                        </div>
                      ) : null}
                    </div>

                    {/* Right: Stop button and Up Arrow submit button */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => stopDictation(false)}
                        disabled={dictationState === "finalizing"}
                        aria-label="Stop recording and keep text"
                        title="Stop recording and keep text in input"
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-muted/50 text-foreground transition hover:bg-muted active:scale-95 disabled:opacity-50"
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                      </button>

                      <button
                        type="button"
                        onClick={() => stopDictation(true)}
                        disabled={dictationState === "finalizing"}
                        aria-label="Transcribe and send"
                        title="Transcribe and send message"
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95 disabled:opacity-50"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* History Drawer / Sidebar */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="left"
          className="flex h-full w-80 sm:w-88 flex-col p-0 bg-background border-r border-border"
        >
          <SheetHeader className="px-5 pt-5 pb-2">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base font-semibold tracking-tight">
                Conversations
              </SheetTitle>
            </div>
          </SheetHeader>

          {/* New Chat top action in drawer */}
          <div className="px-4 py-2 border-b border-border/40">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/40 hover:bg-muted px-3.5 py-2.5 text-sm font-medium transition shadow-xs group cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4 text-primary" />
                    New chat
                  </span>
                  <SquarePen className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-56 shadow-2xl border border-border/80"
              >
                <DropdownMenuLabel>Start new chat</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    startNewChat("text");
                    setHistoryOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <SquarePen className="mr-2 h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">New Chat</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Standard text chat
                    </span>
                  </div>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => {
                    startNewChat("voice");
                    setHistoryOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Mic className="mr-2 h-4 w-4 text-primary" />
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">Voice</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Realtime voice assistant
                    </span>
                  </div>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => {
                    startNewChat("video");
                    setHistoryOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Camera className="mr-2 h-4 w-4 text-primary" />
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">Video Visual</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Camera feed with AI
                    </span>
                  </div>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => {
                    startNewChat("screen");
                    setHistoryOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Monitor className="mr-2 h-4 w-4 text-primary" />
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">Screen Share</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Screen capture with AI
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Unified Search button */}
            <button
              type="button"
              onClick={() => {
                setSearchOpen(true);
                setHistoryOpen(false);
              }}
              className="mt-2 flex w-full items-center justify-between rounded-xl border border-border/70 bg-background hover:bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition shadow-2xs group cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition" />
                <span>Search all conversations...</span>
              </span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground bg-muted border border-border rounded">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Conversation history items list */}
          <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
            {displayConvos.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <p className="text-sm font-medium">No conversations yet</p>
                <p className="mt-1 text-xs">
                  Start a chat and your history will be preserved here.
                </p>
              </div>
            ) : (
              displayConvos.map((c) => (
                <div key={c.id}>
                  {editingConvoId === c.id ? (
                    <div className="flex items-center gap-1 rounded-xl bg-muted p-1.5">
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSave(c.id);
                          if (e.key === "Escape") setEditingConvoId(null);
                        }}
                        autoFocus
                        className="min-w-0 flex-1 bg-background px-2.5 py-1 text-sm rounded-lg outline-none border border-border"
                      />
                      <button
                        type="button"
                        onClick={() => handleRenameSave(c.id)}
                        className="p-1.5 text-primary hover:bg-background rounded-md transition"
                        title="Save title"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingConvoId(null)}
                        className="p-1.5 text-muted-foreground hover:bg-background rounded-md transition"
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`group flex items-center justify-between rounded-xl px-2.5 py-2 text-sm transition ${
                        c.id === current.id
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => {
                          interrupt();
                          if (sessionContext.state !== "IDLE") {
                            realtimeSessionService.stop();
                          }
                          setInterim("");
                          setInput("");
                          setCurrent(c);
                          setHistoryOpen(false);
                        }}
                      >
                        <span className="block truncate">{c.title || "Untitled conversation"}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {formatTimeAgo(c.updatedAt)}
                        </span>
                      </button>

                      {/* Three-Dot Contextual Menu */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="Conversation options"
                            title="More options"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-lg p-1.5 text-muted-foreground opacity-60 hover:opacity-100 hover:bg-background hover:text-foreground transition focus:opacity-100 group-hover:opacity-100"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-52 shadow-xl border border-border/80"
                        >
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              startVoiceForConversation(c);
                            }}
                            className="cursor-pointer"
                          >
                            <Mic
                              className={`mr-2 h-4 w-4 ${
                                sessionContext.state === "VOICE_ACTIVE" && current.id === c.id
                                  ? "text-primary animate-pulse"
                                  : "text-muted-foreground"
                              }`}
                            />
                            <span>
                              {sessionContext.state === "VOICE_ACTIVE" && current.id === c.id
                                ? "Disconnect Voice"
                                : "Voice Mode"}
                            </span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              startVideoForConversation(c);
                            }}
                            className="cursor-pointer"
                          >
                            <Camera
                              className={`mr-2 h-4 w-4 ${
                                (isCameraPanelOpen || sessionContext.state === "VIDEO_ACTIVE") && current.id === c.id
                                  ? "text-primary animate-pulse"
                                  : "text-muted-foreground"
                              }`}
                            />
                            <span>
                              {(isCameraPanelOpen || sessionContext.state === "VIDEO_ACTIVE") && current.id === c.id
                                ? "Stop Video"
                                : "Video / Visual"}
                            </span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              startScreenForConversation(c);
                            }}
                            className="cursor-pointer"
                          >
                            <Monitor
                              className={`mr-2 h-4 w-4 ${
                                sessionContext.state === "SCREEN_SHARE_ACTIVE" &&
                                current.id === c.id
                                  ? "text-primary animate-pulse"
                                  : "text-muted-foreground"
                              }`}
                            />
                            <span>
                              {sessionContext.state === "SCREEN_SHARE_ACTIVE" && current.id === c.id
                                ? "Stop Screen Sharing"
                                : "Screen Sharing"}
                            </span>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingConvoId(c.id);
                              setEditingTitle(c.title || "Untitled");
                            }}
                            className="cursor-pointer"
                          >
                            <Pencil className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>Rename</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={(e) => handleDeleteConvo(c.id, e)}
                            className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Drawer footer */}
          <div className="p-3 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {convos.length} {convos.length === 1 ? "conversation" : "conversations"}
            </span>
            {convos.length > 0 && (
              <button
                type="button"
                onClick={() => setClearHistoryDialogOpen(true)}
                className="text-destructive hover:underline font-medium"
              >
                Clear all
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Settings Navigation with 4 Independent Functional Sections */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent
          side="right"
          className="flex h-full w-[92vw] sm:w-[480px] flex-col p-0 bg-background"
        >
          <SheetHeader className="px-6 pt-5 pb-3 border-b border-border/40">
            <SheetTitle className="text-base font-semibold">Settings</SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="chat" className="flex flex-col flex-1 overflow-hidden">
            <TabsList className="grid grid-cols-6 mx-6 mt-3 mb-1 bg-muted/60 p-1 rounded-xl">
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="voice">Voice</TabsTrigger>
              <TabsTrigger value="video">Video</TabsTrigger>
              <TabsTrigger value="screen">Screen</TabsTrigger>
              <TabsTrigger value="nvidia">NVIDIA</TabsTrigger>
              {authState.isAdmin ? (
                <TabsTrigger value="keys" className="text-primary font-medium">Keys</TabsTrigger>
              ) : (
                <TabsTrigger value="access">Access</TabsTrigger>
              )}
            </TabsList>

            {/* 1. Chat Settings */}
            <TabsContent
              value="chat"
              className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 text-sm"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">Chat model</label>
                  <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    Applies next request
                  </span>
                </div>
                <select
                  value={settings.chatModel}
                  onChange={(e) => updateSettings({ chatModel: e.target.value })}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                >
                  <option value="gemini-2.5-flash-lite">
                    Gemini 2.5 Flash Lite (Fastest ~1s, Recommended)
                  </option>
                  <option value="gemini-2.5-flash">
                    Gemini 2.5 Flash (Balanced speed & depth)
                  </option>
                  <option value="gemini-3.1-flash-lite">
                    Gemini 3.1 Flash Lite (Next-gen reasoning)
                  </option>
                </select>
                <span className="text-xs text-muted-foreground leading-normal">
                  Controls the Google Gemini model used for text generation and chat streaming. Text
                  chat remains silent.
                </span>
              </div>

              <SettingRow
                label="Speak replies"
                hint="Read text chat responses out loud using device speech synthesis"
              >
                <Switch
                  checked={settings.speak}
                  onCheckedChange={(v) => updateSettings({ speak: v })}
                />
              </SettingRow>

              <SettingRow
                label="Hands-free"
                hint="Keep listening automatically after speech synthesis completes"
              >
                <Switch
                  checked={settings.handsFree}
                  onCheckedChange={(v) => updateSettings({ handsFree: v })}
                />
              </SettingRow>

              <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                <label className="font-medium text-foreground">Speech voice (Browser TTS)</label>
                <select
                  value={settings.voiceURI}
                  onChange={(e) => updateSettings({ voiceURI: e.target.value })}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                >
                  <option value="">Default system voice</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  Voice synthesized when Speak replies is activated for text responses.
                </span>
              </div>

              <div className="pt-2 border-t border-border/40">
                <div className="flex flex-col gap-2">
                  <span className="font-medium text-foreground">Conversation storage</span>
                  <span className="text-xs text-muted-foreground">
                    Permanently delete all stored conversations from local cache and remote
                    database. Does not interrupt active sessions.
                  </span>
                  <button
                    type="button"
                    className="mt-1 w-full rounded-xl border border-destructive/30 px-3 py-2 text-center text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                    onClick={() => setClearHistoryDialogOpen(true)}
                  >
                    Clear history
                  </button>
                </div>
              </div>
            </TabsContent>

            {/* 2. Voice Settings */}
            <TabsContent
              value="voice"
              className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 text-sm"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">Live voice</label>
                  {sessionContext.state !== "IDLE" && (
                    <span className="text-[11px] font-medium text-amber-500/90 bg-amber-500/10 px-2 py-0.5 rounded-full">
                      Applies next session
                    </span>
                  )}
                </div>
                <select
                  value={settings.liveVoice}
                  onChange={(e) => updateSettings({ liveVoice: e.target.value })}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                >
                  {["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Aoede"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  Voice persona used for bidirectional Gemini Live audio sessions.
                </span>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">Speaking speed</span>
                  <div className="flex items-center gap-1.5">
                    {sessionContext.state !== "IDLE" && (
                      <span className="text-[11px] font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        Applied live
                      </span>
                    )}
                    <span className="text-xs font-mono rounded bg-muted px-2 py-0.5 text-muted-foreground">
                      {settings.rate.toFixed(1)}×
                    </span>
                  </div>
                </div>
                <Slider
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={[settings.rate]}
                  onValueChange={([v]) => {
                    const rate = v ?? 1.0;
                    updateSettings({ rate });
                    if (speakerRef.current) speakerRef.current.rate = rate;
                    realtimeSessionService.setPlaybackRate(rate);
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  Controls playback rate (0.5×–2.0×) for both Live voice and text-to-speech.
                </span>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">Google API Key</label>
                  {sessionContext.state !== "IDLE" && (
                    <span className="text-[11px] font-medium text-amber-500/90 bg-amber-500/10 px-2 py-0.5 rounded-full">
                      Applies next connection
                    </span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={settings.apiKey}
                    placeholder="Optional (uses server default if empty)"
                    onChange={(e) => updateSettings({ apiKey: e.target.value.trim() })}
                    className="w-full rounded-xl border border-border bg-background py-2 pl-3 pr-10 text-sm outline-none focus:border-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 text-muted-foreground hover:text-foreground"
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <span className="text-xs text-muted-foreground">
                  Masked key for direct Gemini Live and multimodal APIs. Leave empty to use server
                  environment default.
                </span>
              </div>
            </TabsContent>

            {/* 3. Video Settings */}
            <TabsContent
              value="video"
              className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 text-sm"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">Default camera</label>
                  {sessionContext.state === "VIDEO_ACTIVE" && (
                    <span className="text-[11px] font-medium text-amber-500/90 bg-amber-500/10 px-2 py-0.5 rounded-full">
                      Applies next camera start
                    </span>
                  )}
                </div>
                <select
                  value={settings.cameraFacing}
                  onChange={(e) => {
                    const next = e.target.value as "environment" | "user";
                    updateSettings({ cameraFacing: next });
                    realtimeSessionService.setFacingMode(next);
                  }}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                >
                  <option value="environment">Back Camera (Environment / Rear)</option>
                  <option value="user">Front Camera (Selfie / Face)</option>
                </select>
                <span className="text-xs text-muted-foreground">
                  Initial lens facing mode used when opening camera visual mode.
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">Camera resolution</label>
                  {sessionContext.state === "VIDEO_ACTIVE" && (
                    <span className="text-[11px] font-medium text-amber-500/90 bg-amber-500/10 px-2 py-0.5 rounded-full">
                      Applies next camera start
                    </span>
                  )}
                </div>
                <select
                  value={settings.cameraResolution}
                  onChange={(e) =>
                    updateSettings({ cameraResolution: e.target.value as "720p" | "1080p" })
                  }
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>

              <SettingRow
                label="Automatic camera"
                hint="Open camera or screen when asking visual questions (e.g. 'what is this?')"
              >
                <Switch
                  checked={settings.autoVision}
                  onCheckedChange={(v) => updateSettings({ autoVision: v })}
                />
              </SettingRow>
            </TabsContent>

            {/* 4. Screen Sharing Settings */}
            <TabsContent
              value="screen"
              className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 text-sm"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">Capture quality</label>
                  <span className="text-xs font-medium text-muted-foreground">
                    {sessionContext.state === "SCREEN_SHARE_ACTIVE" ? (
                      <span className="text-emerald-500 font-medium inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        Screen sharing active
                      </span>
                    ) : (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                        Idle
                      </span>
                    )}
                  </span>
                </div>
                <select
                  value={settings.screenQuality}
                  onChange={(e) =>
                    updateSettings({ screenQuality: e.target.value as "standard" | "high" })
                  }
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                >
                  <option value="standard">
                    Standard (720p @ 15fps) — Balanced data and performance
                  </option>
                  <option value="high">
                    High Definition (1080p @ 30fps) — Crisp text and high detail
                  </option>
                </select>
                <span className="text-xs text-muted-foreground">
                  Display media frame rate and resolution constraints applied to screen capture.
                </span>
              </div>

              <div className="rounded-2xl border border-border/80 bg-muted/40 p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 font-medium text-foreground text-sm">
                  <Monitor className="h-4 w-4 text-primary" />
                  <span>Screen sharing & privacy notice</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  • Screen sharing captures frames solely during an active visual session.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  • The operating system prompt requests explicit permission each time screen
                  capture begins. You can revoke permission at any moment via the system indicator
                  or by closing the session.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  • Captured frames are streamed to the AI for visual analysis and are never
                  persisted permanently.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  • Audio from your screen or other applications is not captured or recorded.
                </p>
              </div>
            </TabsContent>

            {/* 5. NVIDIA Settings */}
            <TabsContent
              value="nvidia"
              className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 text-sm"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">NVIDIA API Key</label>
                  <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    FLUX.2 & Vision
                  </span>
                </div>
                <div className="relative flex items-center">
                  <input
                    type={showNvidiaKey ? "text" : "password"}
                    value={settings.nvidiaApiKey || ""}
                    placeholder="nvapi-..."
                    onChange={(e) => updateSettings({ nvidiaApiKey: e.target.value.trim() })}
                    className="w-full rounded-xl border border-border bg-background py-2 pl-3 pr-10 text-sm outline-none focus:border-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNvidiaKey(!showNvidiaKey)}
                    className="absolute right-3 text-muted-foreground hover:text-foreground cursor-pointer"
                    aria-label={showNvidiaKey ? "Hide NVIDIA API key" : "Show NVIDIA API key"}
                  >
                    {showNvidiaKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <span className="text-xs text-muted-foreground leading-normal">
                  Used for NVIDIA FLUX.2 Klein 4B image generation & editing, and Nemotron/Llama
                  multimodal vision. Leave empty to use server environment default.
                </span>
              </div>

              <div className="rounded-2xl border border-border/80 bg-muted/40 p-4 flex flex-col gap-2.5">
                <div className="font-medium text-foreground text-sm flex items-center gap-1.5">
                  <span>Supported NVIDIA Features</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  • <strong>Image Generation & Editing:</strong> Black Forest Labs FLUX.2 Klein 4B
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  • <strong>Image Understanding:</strong> Meta Llama 3.2 11B Vision Instruct
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  • <strong>Video Understanding:</strong> NVIDIA Nemotron-3 Nano Omni 30B
                </p>
              </div>
            </TabsContent>

            {/* 6. Admin Keys Tab (Visible only to authenticated administrator) */}
            {authState.isAdmin && (
              <TabsContent
                value="keys"
                className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 text-sm"
              >
                <InvitationKeysSettingsSection />
                <div className="pt-2 border-t border-border/40">
                  <button
                    type="button"
                    onClick={async () => {
                      setSettingsOpen(false);
                      await authService.logout();
                    }}
                    className="w-full rounded-xl border border-destructive/30 px-3 py-2 text-center text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    Log Out Administrator Session
                  </button>
                </div>
              </TabsContent>
            )}

            {/* Access & Session info for ordinary users */}
            {!authState.isAdmin && (
              <TabsContent
                value="access"
                className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 text-sm"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-foreground">Access Session</label>
                    <span className="text-xs font-mono font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Active
                    </span>
                  </div>
                  <div className="rounded-2xl border border-border/80 bg-muted/40 p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Remaining Access</span>
                      <AccessTimerCountdown expiresAt={authState.expiresAt} />
                    </div>
                    {authState.expiresAt && (
                      <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 pt-2">
                        <span>Expires At</span>
                        <span>
                          {new Date(authState.expiresAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      Access is granted for your invitation key's configured duration. Closing, minimizing, or refreshing does not pause or extend this time window.
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/40 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      setSettingsOpen(false);
                      await authService.logout();
                    }}
                    className="w-full rounded-xl border border-destructive/30 px-3 py-2 text-center text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    Log Out / Switch Invitation Key
                  </button>
                </div>
              </TabsContent>
            )}
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Clear History Confirmation Dialog */}
      <AlertDialog open={clearHistoryDialogOpen} onOpenChange={setClearHistoryDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear conversation history?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all saved conversations. Your current active conversation
              will not be closed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setConvos([]);
                await historyService.clearAll();
                setCurrent((prev) => ({
                  ...prev,
                  messages: [],
                  title: "",
                  updatedAt: Date.now(),
                }));
                setClearHistoryDialogOpen(false);
                toast("History cleared");
              }}
            >
              Clear history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unified Search Modal */}
      <SearchDialog
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectConversation={(conversationId) => {
          const found = convos.find((c) => c.id === conversationId);
          if (found) {
            interrupt();
            if (sessionContext.state !== "IDLE") {
              realtimeSessionService.stop();
            }
            setCurrent(found);
          } else {
            // If conversation isn't in local state yet, fetch from DB
            fetchConversationsFromDb(authService.getUserId()).then((fresh) => {
              const matched = fresh.find((c) => c.id === conversationId);
              if (matched) {
                setConvos(fresh);
                setCurrent(matched);
              }
            });
          }
        }}
        onSelectMessage={(conversationId, messageId) => {
          const loadAndScroll = (targetConvo: Conversation) => {
            interrupt();
            if (sessionContext.state !== "IDLE") {
              realtimeSessionService.stop();
            }
            setCurrent(targetConvo);
            setTimeout(() => {
              const element = document.getElementById(`msg-${messageId}`);
              if (element) {
                element.scrollIntoView({ behavior: "smooth", block: "center" });
                element.classList.add("ring-2", "ring-primary", "transition-all");
                setTimeout(() => {
                  element.classList.remove("ring-2", "ring-primary");
                }, 2000);
              }
            }, 150);
          };

          const found = convos.find((c) => c.id === conversationId);
          if (found) {
            loadAndScroll(found);
          } else {
            fetchConversationsFromDb(authService.getUserId()).then((fresh) => {
              const matched = fresh.find((c) => c.id === conversationId);
              if (matched) {
                setConvos(fresh);
                loadAndScroll(matched);
              }
            });
          }
        }}
        onSelectMedia={(_mediaId, url) => {
          setSelectedImageModal(url);
        }}
      />

      {/* Image Modal Lightbox */}
      <ImageModal src={selectedImageModal} onClose={() => setSelectedImageModal(null)} />
    </div>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
      style={{ animationDelay: `${d}ms` }}
    />
  );
}
