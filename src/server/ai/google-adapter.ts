import type { AIRequestContext } from "./contracts";

export interface GoogleChatRequest {
  context: AIRequestContext;
  messages: Array<{ role: string; content: string }>;
  systemInstruction?: string;
  apiKey?: string;
}

export class GoogleGeminiAdapter {
  private static instance: GoogleGeminiAdapter;

  public static getInstance(): GoogleGeminiAdapter {
    if (!GoogleGeminiAdapter.instance) {
      GoogleGeminiAdapter.instance = new GoogleGeminiAdapter();
    }
    return GoogleGeminiAdapter.instance;
  }

  private getApiKey(override?: string): string {
    const key = override || process.env.GOOGLE_API_KEY;
    if (!key) throw new Error("Missing Google Gemini API key in environment or request.");
    return key;
  }

  public async streamChat(req: GoogleChatRequest): Promise<Response> {
    const apiKey = this.getApiKey(req.apiKey);
    const model = req.context.model || "gemini-2.5-flash-lite";

    const contents = req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = { contents };
    if (req.systemInstruction) {
      body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err }), {
        status: resp.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(resp.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
}

export const googleGeminiAdapter = GoogleGeminiAdapter.getInstance();
