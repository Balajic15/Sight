import type { Plugin } from "vite";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { validateSessionTokenDb } from "./db";

const DEFAULT_SYSTEM = `You are a calm, natural, real-time voice assistant. Your responses are spoken aloud:
- Keep answers concise, natural, and conversational (1-3 sentences unless asked for details).
- Do not use markdown, emojis, or bullet points.
- If live camera or screen frames are provided, describe and answer directly.`;

export function liveProxyPlugin(): Plugin {
  return {
    name: "gemini-live-proxy",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
        if (url.pathname === "/api/live") {
          wss.handleUpgrade(req, socket, head, async (clientWs: WebSocket) => {
            const token = url.searchParams.get("token")?.trim();
            if (token) {
              const validation = await validateSessionTokenDb(token);
              if (!validation.valid) {
                clientWs.send(JSON.stringify({ type: "error", message: "Session expired", code: "SESSION_EXPIRED" }));
                clientWs.close(1008, "Session expired");
                return;
              }
            }

            const apiKey = process.env.GOOGLE_API_KEY;
            if (!apiKey) {
              clientWs.send(JSON.stringify({ type: "error", message: "Server Google API key is unconfigured." }));
              clientWs.close(1008, "Missing API key");
              return;
            }

            const voice = url.searchParams.get("voice") || "Zephyr";
            const upstream = new WebSocket(
              `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`,
            );

            let isReady = false;
            const queued: string[] = [];

            upstream.on("open", () => {
              upstream.send(
                JSON.stringify({
                  setup: {
                    model: "models/gemini-3.1-flash-live-preview",
                    generationConfig: {
                      responseModalities: ["AUDIO"],
                      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
                    },
                    systemInstruction: { parts: [{ text: DEFAULT_SYSTEM }] },
                  },
                }),
              );
            });

            upstream.on("message", (raw: RawData) => {
              try {
                const msg = JSON.parse(raw.toString());
                if (msg.setupComplete) {
                  isReady = true;
                  clientWs.send(JSON.stringify({ type: "ready" }));
                  while (queued.length > 0) {
                    const item = queued.shift();
                    if (item && upstream.readyState === WebSocket.OPEN) upstream.send(item);
                  }
                }
                if (msg.serverContent) {
                  const sc = msg.serverContent;
                  if (sc.interrupted) clientWs.send(JSON.stringify({ type: "interrupted" }));
                  if (sc.modelTurn?.parts) {
                    for (const p of sc.modelTurn.parts) {
                      if (p.inlineData?.data) {
                        clientWs.send(JSON.stringify({ type: "audio", data: p.inlineData.data }));
                      }
                      if (p.text) clientWs.send(JSON.stringify({ type: "text", text: p.text }));
                    }
                  }
                  if (sc.turnComplete) clientWs.send(JSON.stringify({ type: "turnComplete" }));
                }
              } catch {}
            });

            clientWs.on("message", (raw: RawData) => {
              try {
                const data = JSON.parse(raw.toString());
                let payload: string | null = null;
                if (data.type === "audio" && data.data) {
                  payload = JSON.stringify({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: data.data } } });
                } else if (data.type === "image" && data.data) {
                  payload = JSON.stringify({ realtimeInput: { video: { mimeType: "image/jpeg", data: data.data } } });
                }
                if (payload) {
                  if (isReady && upstream.readyState === WebSocket.OPEN) upstream.send(payload);
                  else queued.push(payload);
                }
              } catch {}
            });

            clientWs.on("close", () => upstream.close());
            upstream.on("close", () => clientWs.close());
          });
        }
      });
    },
  };
}
