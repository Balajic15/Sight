import React, { useState, useRef, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CameraService } from "@/lib/camera-service";
import { ScreenShareService } from "@/lib/screen-share-service";
import { LiveClient } from "@/lib/live-client";
import { authService } from "@/lib/auth-service";
import { AudioVisualizer } from "@/components/audio/AudioVisualizer";
import { ImageVersionTreeModal, type ImageVersionNode } from "@/components/media/ImageVersionTreeModal";

export const Route = createFileRoute("/")({
  component: MainWorkspaceComponent,
});

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  image?: string;
  attachments?: any[];
  generatingImage?: boolean;
}

function MainWorkspaceComponent() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Vision & Live Audio States
  const [cameraActive, setCameraActive] = useState(false);
  const [screenActive, setScreenActive] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  // Image Lineage Modal State
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [activeVersionNodes, setActiveVersionNodes] = useState<ImageVersionNode[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveClientRef = useRef<LiveClient | null>(null);

  const cameraService = CameraService.getInstance();
  const screenShareService = ScreenShareService.getInstance();

  useEffect(() => {
    liveClientRef.current = new LiveClient();

    liveClientRef.current.onStatusChange = (status) => {
      setLiveConnected(status === "connected");
    };

    liveClientRef.current.onAgentSpeakingChange = (speaking) => {
      setAgentSpeaking(speaking);
    };

    liveClientRef.current.onMessageReceived = (msg) => {
      setMessages((prev) => [...prev, { id: `ai-${Date.now()}`, role: "assistant", text: msg }]);
    };

    return () => {
      cameraService.stop();
      screenShareService.stop();
      liveClientRef.current?.disconnect();
    };
  }, []);

  const toggleCamera = async () => {
    if (cameraActive) {
      cameraService.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraActive(false);
    } else {
      try {
        const stream = await cameraService.start({
          cameraResolution: "720p",
          cameraFacing: "environment",
        } as any);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setCameraActive(true);
        setScreenActive(false);
      } catch (err) {
        alert("Camera permission denied or camera unavailable.");
      }
    }
  };

  const toggleScreen = async () => {
    if (screenActive) {
      screenShareService.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
      setScreenActive(false);
    } else {
      try {
        const stream = await screenShareService.start({ screenQuality: "standard" } as any);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setScreenActive(true);
        setCameraActive(false);
      } catch (err) {
        alert("Screen sharing cancelled or unavailable.");
      }
    }
  };

  const toggleLiveVoice = async () => {
    if (liveConnected) {
      liveClientRef.current?.disconnect();
    } else {
      try {
        const token = authService.getStoredToken();
        const res = await fetch("/api/live-token", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!data.apiKey) throw new Error(data.error || "Missing API key");
        await liveClientRef.current?.connect(data.apiKey, data.model);
      } catch (err) {
        alert("Failed to initiate Live Voice session: " + (err as Error).message);
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending) return;

    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      text: inputText.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsSending(true);

    try {
      const token = authService.getStoredToken();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: [...messages, userMsg],
        }),
      });

      if (!res.ok) throw new Error("Chat request failed.");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let aiText = "";

      const aiMsgId = `ai-${Date.now()}`;
      setMessages((prev) => [...prev, { id: aiMsgId, role: "assistant", text: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          aiText += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, text: aiText } : m))
          );
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", text: "Something went wrong. Please try again." },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-full w-full">
      {/* Left Chat & Stream Viewport */}
      <div className="flex flex-1 flex-col h-full bg-neutral-950">
        {/* Viewfinder Window (Camera or Screen) */}
        {(cameraActive || screenActive) && (
          <div className="relative h-64 w-full bg-black border-b border-neutral-800 flex items-center justify-center overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
            <div className="absolute top-2 left-2 flex items-center gap-2 rounded bg-black/60 px-2 py-1 text-[11px] text-white backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              {cameraActive ? "Live Camera Viewfinder" : "Live Screen Stream"}
            </div>
          </div>
        )}

        {/* Message Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-neutral-500 space-y-2">
              <div className="text-3xl">🎙️</div>
              <div className="text-sm font-medium text-neutral-400">Ready to converse</div>
              <div className="text-xs max-w-sm">
                Speak directly in Live Voice mode, share your camera or screen, or type a query below.
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-sky-600 text-white"
                      : "bg-neutral-900 text-neutral-200 border border-neutral-800"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Live Audio Visualizer Bar */}
        <div className="px-4 py-2 bg-neutral-900/40 border-t border-neutral-800/60 flex items-center gap-3">
          <AudioVisualizer
            isActive={liveConnected}
            isSpeaking={agentSpeaking}
            className="flex-1 h-8"
          />
          <button
            onClick={toggleLiveVoice}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition ${
              liveConnected
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500 hover:text-white"
                : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-white"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${liveConnected ? "bg-rose-500 animate-ping" : "bg-emerald-500"}`} />
            {liveConnected ? "Disconnect Voice" : "Start Live Voice"}
          </button>
        </div>

        {/* Bottom Input Area */}
        <div className="p-4 bg-neutral-900 border-t border-neutral-800">
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleCamera}
              className={`rounded-xl border p-2.5 text-sm transition ${
                cameraActive
                  ? "border-sky-500 bg-sky-500 text-white"
                  : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:text-white"
              }`}
              title="Toggle Camera"
            >
              📷
            </button>

            <button
              type="button"
              onClick={toggleScreen}
              className={`rounded-xl border p-2.5 text-sm transition ${
                screenActive
                  ? "border-sky-500 bg-sky-500 text-white"
                  : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:text-white"
              }`}
              title="Toggle Screen Share"
            >
              🖥️
            </button>

            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask anything or request image generation..."
              className="flex-1 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none"
            />

            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 transition"
            >
              Send
            </button>
          </form>
        </div>
      </div>

      <ImageVersionTreeModal
        isOpen={versionModalOpen}
        onClose={() => setVersionModalOpen(false)}
        versions={activeVersionNodes}
        onSelectVersion={() => {}}
      />
    </div>
  );
}
