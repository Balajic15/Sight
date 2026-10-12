import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionAuth } from "@/server/auth";

const TranscribeSchema = z.object({
  audio: z.string().min(1), // base64 encoded audio string
  mimeType: z.string().default("audio/webm"),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        let body: z.infer<typeof TranscribeSchema>;
        try {
          body = TranscribeSchema.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request payload." }, { status: 400 });
        }

        const key =
          (body.apiKey && !body.apiKey.startsWith("nvapi-") ? body.apiKey.trim() : undefined) ||
          process.env["GOOGLE_API_KEY"];
        if (!key) {
          return Response.json(
            { error: "Google API key is not configured. Set your API key in Settings." },
            { status: 500 },
          );
        }

        const model = body.model?.trim() || "gemini-2.5-flash-lite";

        // Clean base64 data
        let base64Data = body.audio;
        if (base64Data.includes(",")) {
          base64Data = base64Data.split(",")[1] || base64Data;
        }

        const prompt =
          "Transcribe the spoken audio into plain text accurately. Output only the verbatim transcribed words with natural capitalization and punctuation. Do not add introductory remarks, timestamps, quotation marks, or explanations. If the audio is silent or contains no speech, output nothing.";

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model,
        )}:generateContent?key=${encodeURIComponent(key)}`;

        try {
          const resp = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inline_data: {
                        mime_type: body.mimeType,
                        data: base64Data,
                      },
                    },
                    { text: prompt },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.0,
                maxOutputTokens: 1024,
              },
            }),
          });

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            return Response.json(
              { error: err.error?.message || "Transcription request failed." },
              { status: resp.status },
            );
          }

          const data = await resp.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

          return Response.json({ text });
        } catch (err) {
          return Response.json(
            { error: (err as Error)?.message || "Failed to contact transcription service." },
            { status: 500 },
          );
        }
      },
    },
  },
});
