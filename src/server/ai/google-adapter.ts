import fs from "node:fs";
import path from "node:path";
import type { AIRequestContext } from "./contracts";

export interface GoogleMessagePart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
}

export interface GoogleMessageContent {
  role: "user" | "model";
  parts: GoogleMessagePart[];
}

export interface GoogleChatRequest {
  context: AIRequestContext;
  contents: GoogleMessageContent[];
  systemInstruction?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

export class GoogleGeminiAdapter {
  private static instance: GoogleGeminiAdapter;
  private readonly defaultSystem = `You are a helpful, clear, and concise AI chat assistant.
- Provide direct, well-structured, and helpful text answers.
- Never mention which company, provider or model powers you.
- When an image is attached, describe what is relevant to the question directly.
- When a document or file is attached, analyze and explain its actual extracted content directly.`;

  private constructor() {}

  public static getInstance(): GoogleGeminiAdapter {
    if (!GoogleGeminiAdapter.instance) {
      GoogleGeminiAdapter.instance = new GoogleGeminiAdapter();
    }
    return GoogleGeminiAdapter.instance;
  }

  public getGoogleApiKey(requestKey?: string): string | undefined {
    if (requestKey?.trim()) return requestKey.trim();
    if (process.env["GOOGLE_API_KEY"]) return process.env["GOOGLE_API_KEY"].trim();

    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const match = line.match(/^\s*GOOGLE_API_KEY\s*=\s*(.*?)\s*$/);
          if (match && match[1]) {
            return match[1].replace(/^["']|["']$/g, "").trim();
          }
        }
      }
    } catch {
      /* ignore read errors */
    }
    return undefined;
  }

  public isConfigured(requestKey?: string): boolean {
    return Boolean(this.getGoogleApiKey(requestKey));
  }

  public async streamChat(request: GoogleChatRequest): Promise<Response> {
    const key = this.getGoogleApiKey(request.apiKey);
    if (!key) {
      return Response.json(
        {
          error:
            "Google API key is not configured. Please set your Google API key in Settings or environment.",
        },
        { status: 500 },
      );
    }

    const validModels = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3.1-flash-lite"];
    const selectedModel = validModels.includes(request.context.model)
      ? request.context.model
      : "gemini-2.5-flash-lite";

    const systemPrompt = request.systemInstruction || this.defaultSystem;

    let upstream: Response | null = null;
    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          selectedModel,
        )}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          ...(request.signal ? { signal: request.signal } : {}),
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: request.contents,
          }),
        },
      );
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError" || request.signal?.aborted) {
        return new Response(null, { status: 499 });
      }
      return Response.json(
        { error: "Network error connecting to Google Gemini service." },
        { status: 502 },
      );
    }

    if (!upstream) return new Response(null, { status: 499 });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      const status = upstream.status;
      const errorMsg =
        status === 429
          ? "I'm getting too many requests right now. Try again in a moment."
          : status === 403 || status === 401
            ? "The Google Gemini access key was rejected."
            : "Something went wrong. Please try again.";

      return Response.json({ error: errorMsg, detail: detail.slice(0, 160) }, { status });
    }

    // Process Gemini SSE chunk stream
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    let buf = "";

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (buf.trim()) {
              const remainingLines = buf.split(/\r?\n/);
              for (const line of remainingLines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                try {
                  const payload = trimmed.slice(5).trim();
                  if (payload && payload !== "[DONE]") {
                    const json = JSON.parse(payload);
                    const text = (json.candidates?.[0]?.content?.parts ?? [])
                      .map((p: { text?: string }) => p.text ?? "")
                      .join("");
                    if (text) controller.enqueue(encoder.encode(text));
                  }
                } catch {
                  /* ignore partial chunk */
                }
              }
            }
            controller.close();
            return;
          }

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            try {
              const payload = trimmed.slice(5).trim();
              if (payload && payload !== "[DONE]") {
                const json = JSON.parse(payload);
                const text = (json.candidates?.[0]?.content?.parts ?? [])
                  .map((p: { text?: string }) => p.text ?? "")
                  .join("");
                if (text) controller.enqueue(encoder.encode(text));
              }
            } catch {
              /* ignore partial chunk */
            }
          }
        } catch (err: unknown) {
          const errObj = err as { name?: string };
          if (
            errObj?.name === "AbortError" ||
            request.signal?.aborted ||
            String(err).includes("aborted")
          ) {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
            return;
          }
          controller.error(err);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-cache, no-transform, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
}

export const googleGeminiAdapter = GoogleGeminiAdapter.getInstance();
