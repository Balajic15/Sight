import type { Plugin } from "vite";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import fs from "node:fs";
import path from "node:path";
import { validateSessionTokenDb } from "./db";

function getApiKey(): string | undefined {
  if (process.env["GOOGLE_API_KEY"]) return process.env["GOOGLE_API_KEY"];
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*GOOGLE_API_KEY\s*=\s*(.*?)\s*$/);
        if (match && match[1]) return match[1].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* ignore read errors */
  }
  return undefined;
}

const DEFAULT_SYSTEM = `You are a calm, natural, real-time voice assistant. Your responses are spoken aloud to the user:
- Keep answers concise, natural, and conversational (1-3 sentences unless asked for details).
- Do not use markdown, emojis, bullet points, or special formatting.
- If live visual frames (camera or screen share) are provided, answer questions about what you see directly.
- Never mention any provider, model name, or backend details.`;

export function liveProxyPlugin(): Plugin {
  return {
    name: "gemini-live-proxy",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
        if (url.pathname === "/api/live") {
          wss.handleUpgrade(req, socket, head, async (clientWs: WebSocket) => {
            const sessionToken = url.searchParams.get("token")?.trim();
            if (sessionToken) {
              const validation = await validateSessionTokenDb(sessionToken);
              if (!validation.valid) {
                clientWs.send(
                  JSON.stringify({
                    type: "error",
                    message: "Your 3-hour access has expired. Enter a new Invitation Key to continue.",
                    code: "SESSION_EXPIRED",
                  }),
                );
                clientWs.close(1008, "Session expired");
                return;
              }
            }

            const clientApiKey = url.searchParams.get("key")?.trim();
            const apiKey =
              (clientApiKey && !clientApiKey.startsWith("nvapi-") ? clientApiKey : undefined) ||
              getApiKey();
            if (!apiKey) {
              clientWs.send(
                JSON.stringify({
                  type: "error",
                  message: "Google API key is not configured. Please set your API key in Settings.",
                }),
              );
              clientWs.close(1008, "Missing API key");
              return;
            }

            const voice = url.searchParams.get("voice") || "Zephyr";

            const upstreamUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
            const upstreamWs = new WebSocket(upstreamUrl);

            let isSetupDone = false;
            const pendingClientMessages: string[] = [];

            upstreamWs.on("open", () => {
              const setupPayload = {
                setup: {
                  model: "models/gemini-3.1-flash-live-preview",
                  generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName: voice || "Zephyr",
                        },
                      },
                    },
                    mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
                  },
                  systemInstruction: {
                    parts: [{ text: DEFAULT_SYSTEM }],
                  },
                  inputAudioTranscription: {},
                  outputAudioTranscription: {},
                },
              };
              upstreamWs.send(JSON.stringify(setupPayload));
            });

            upstreamWs.on("message", (raw: RawData) => {
              try {
                const msg = JSON.parse(raw.toString());
                if (msg.setupComplete) {
                  isSetupDone = true;
                  clientWs.send(JSON.stringify({ type: "ready" }));
                  while (pendingClientMessages.length > 0) {
                    const pending = pendingClientMessages.shift();
                    if (pending && upstreamWs.readyState === WebSocket.OPEN) {
                      upstreamWs.send(pending);
                    }
                  }
                }

                if (msg.serverContent) {
                  const sc = msg.serverContent;
                  if (sc.interrupted) {
                    clientWs.send(JSON.stringify({ type: "interrupted" }));
                  }
                  if (sc.inputTranscription?.text) {
                    clientWs.send(
                      JSON.stringify({
                        type: "userTranscription",
                        text: sc.inputTranscription.text,
                      }),
                    );
                  }
                  if (sc.outputTranscription?.text) {
                    clientWs.send(
                      JSON.stringify({
                        type: "assistantTranscription",
                        text: sc.outputTranscription.text,
                      }),
                    );
                  }
                  if (sc.modelTurn?.parts) {
                    for (const part of sc.modelTurn.parts) {
                      if (part.inlineData?.data) {
                        clientWs.send(
                          JSON.stringify({
                            type: "audio",
                            data: part.inlineData.data,
                            mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
                          }),
                        );
                      }
                      if (part.text) {
                        clientWs.send(JSON.stringify({ type: "text", text: part.text }));
                      }
                    }
                  }
                  if (sc.turnComplete) {
                    clientWs.send(JSON.stringify({ type: "turnComplete" }));
                  }
                }
              } catch (e) {
                console.error("Live proxy upstream message error:", e);
              }
            });

            upstreamWs.on("error", (err: Error) => {
              console.error("Live proxy upstream error:", err.message);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "error", message: err.message }));
              }
            });

            upstreamWs.on("close", (code: number, reason: Buffer) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close(code, reason.toString());
              }
            });

            clientWs.on("message", (raw: RawData) => {
              try {
                const data = JSON.parse(raw.toString());

                if (data.type === "audio" && data.data) {
                  const payload = JSON.stringify({
                    realtimeInput: {
                      audio: {
                        mimeType: "audio/pcm;rate=16000",
                        data: data.data,
                      },
                    },
                  });
                  if (isSetupDone && upstreamWs.readyState === WebSocket.OPEN) {
                    upstreamWs.send(payload);
                  } else {
                    pendingClientMessages.push(payload);
                  }
                } else if (data.type === "image" && data.data) {
                  const payload = JSON.stringify({
                    realtimeInput: {
                      video: {
                        mimeType: "image/jpeg",
                        data: data.data,
                      },
                    },
                  });
                  if (isSetupDone && upstreamWs.readyState === WebSocket.OPEN) {
                    upstreamWs.send(payload);
                  }
                } else if (data.type === "text" && data.text) {
                  const payload = JSON.stringify({
                    clientContent: {
                      turns: [
                        {
                          role: "user",
                          parts: [{ text: data.text }],
                        },
                      ],
                      turnComplete: true,
                    },
                  });
                  if (isSetupDone && upstreamWs.readyState === WebSocket.OPEN) {
                    upstreamWs.send(payload);
                  } else {
                    pendingClientMessages.push(payload);
                  }
                }
              } catch (e) {
                console.error("Live proxy client message error:", e);
              }
            });

            clientWs.on("close", () => {
              if (upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.close();
              }
            });

            clientWs.on("error", () => {
              if (upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.close();
              }
            });
          });
        }
      });
    },
  };
}
